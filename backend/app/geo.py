from __future__ import annotations

import json
import math
import re
import ssl
from functools import lru_cache
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import certifi


SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
COORDINATE_QUERY_RE = re.compile(r"^\s*\(?\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?\s*$")
APPROXIMATE_DISTANCE_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s*(?:mi|mile|miles|km|kilometer|kilometers)\s+"
    r"(?:n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)\s+of\b",
    re.IGNORECASE,
)
COARSE_AREA_PREFIX_RE = re.compile(r"^(?:city|town|village|county|borough|township)\s+of\s+", re.IGNORECASE)
REVERSE_GEOCODE_TIMEOUT_SECONDS = 10


def _clean_text(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    text = str(value).strip()
    return text or None


def _first_text(*values: object) -> str | None:
    for value in values:
        text = _clean_text(value)
        if text:
            return text
    return None


def parse_coordinate_query(value: object) -> tuple[float, float] | None:
    text = _clean_text(value)
    if not text:
        return None
    match = COORDINATE_QUERY_RE.match(text)
    if not match:
        return None
    lat = float(match.group(1))
    lon = float(match.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


def format_coordinate_label(lat: object, lon: object, precision: int = 5) -> str:
    try:
        parsed_lat = float(lat)
        parsed_lon = float(lon)
    except (TypeError, ValueError):
        return ""
    if not math.isfinite(parsed_lat) or not math.isfinite(parsed_lon):
        return ""
    return f"{parsed_lat:.{precision}f}, {parsed_lon:.{precision}f}"


def looks_approximate_location_label(value: object) -> bool:
    text = _clean_text(value)
    if not text:
        return False
    if parse_coordinate_query(text):
        return False
    return bool(APPROXIMATE_DISTANCE_RE.search(text))


def looks_coarse_location_label(value: object) -> bool:
    text = _clean_text(value)
    if not text:
        return False
    if parse_coordinate_query(text):
        return False
    if COARSE_AREA_PREFIX_RE.match(text):
        return True
    if re.search(r"\d", text):
        return False
    parts = [part.strip() for part in text.split(",") if part.strip()]
    if len(parts) <= 2:
        return True
    return False


@lru_cache(maxsize=4096)
def _reverse_geocode_cached(lat_key: float, lon_key: float, api_key: str) -> dict | None:
    if not api_key:
        return None

    params = urlencode({"key": api_key, "language": "en-US"})
    request = Request(
        f"https://api.tomtom.com/search/2/reverseGeocode/{lat_key},{lon_key}.json?{params}",
        headers={"Accept": "application/json"},
    )
    try:
        with urlopen(request, timeout=REVERSE_GEOCODE_TIMEOUT_SECONDS, context=SSL_CONTEXT) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except Exception:
        return None

    addresses = payload.get("addresses") or payload.get("results") or []
    first = addresses[0] if isinstance(addresses, list) and addresses else {}
    address = first.get("address") if isinstance(first, dict) else {}
    if not isinstance(address, dict):
        address = {}

    city = _first_text(
        address.get("municipality"),
        address.get("municipalitySubdivision"),
        address.get("countrySecondarySubdivision"),
    )
    state = _first_text(address.get("countrySubdivisionName"), address.get("countrySubdivision"))
    postal_code = _first_text(address.get("postalCode"))
    country = _first_text(address.get("countryCodeISO3"), address.get("countryCode"), address.get("country"))
    street = " ".join(part for part in [_first_text(address.get("streetNumber")), _first_text(address.get("streetName"))] if part)
    label = _first_text(
        address.get("freeformAddress"),
        ", ".join(part for part in [street, city, state, postal_code] if part),
        street,
    )

    if not label and city and state:
        label = f"{city}, {state}"
    return {
        "label": label,
        "city": city,
        "state": state,
        "postal_code": postal_code,
        "country": country,
    }


def reverse_geocode_point(lat: object, lon: object, api_key: str) -> dict | None:
    try:
        parsed_lat = float(lat)
        parsed_lon = float(lon)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed_lat) or not math.isfinite(parsed_lon):
        return None
    return _reverse_geocode_cached(round(parsed_lat, 4), round(parsed_lon, 4), api_key)
