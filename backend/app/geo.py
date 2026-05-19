from __future__ import annotations

import json
import math
import re
import ssl
from functools import lru_cache
from urllib.parse import unquote, urlencode
from urllib.request import Request, urlopen

import certifi


SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
NUMBER_PATTERN = r"[-+]?(?:\d+(?:\.\d+)?|\.\d+)"
COORDINATE_QUERY_RE = re.compile(rf"^\s*\(?\s*({NUMBER_PATTERN})\s*[,;\s]\s*({NUMBER_PATTERN})\s*\)?\s*$")
COORDINATE_PAIR_RE = re.compile(rf"(?<![\w.])({NUMBER_PATTERN})\s*[,;]\s*({NUMBER_PATTERN})(?![\w.])")
DECIMAL_COORDINATE_PAIR_RE = re.compile(r"(?<![\w.])([-+]?\d{1,3}\.\d+)\s+([-+]?\d{1,3}\.\d+)(?![\w.])")
NAMED_LAT_LON_RE = re.compile(
    rf"\b(?:lat|latitude)\s*[:=]\s*({NUMBER_PATTERN}).{{0,40}}?\b(?:lon|lng|long|longitude)\s*[:=]\s*({NUMBER_PATTERN})",
    re.IGNORECASE,
)
NAMED_LON_LAT_RE = re.compile(
    rf"\b(?:lon|lng|long|longitude)\s*[:=]\s*({NUMBER_PATTERN}).{{0,40}}?\b(?:lat|latitude)\s*[:=]\s*({NUMBER_PATTERN})",
    re.IGNORECASE,
)
WKT_POINT_RE = re.compile(rf"\bPOINT\s*\(\s*({NUMBER_PATTERN})\s+({NUMBER_PATTERN})\s*\)", re.IGNORECASE)
GOOGLE_3D_4D_RE = re.compile(rf"!3d({NUMBER_PATTERN})!4d({NUMBER_PATTERN})", re.IGNORECASE)
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


def _coordinate_pair(lat: object, lon: object) -> tuple[float, float] | None:
    try:
        parsed_lat = float(lat)
        parsed_lon = float(lon)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed_lat) or not math.isfinite(parsed_lon):
        return None
    if -90 <= parsed_lat <= 90 and -180 <= parsed_lon <= 180:
        return parsed_lat, parsed_lon
    return None


def _looks_like_us_lon_lat(first: float, second: float) -> bool:
    return -170 <= first <= -50 and 15 <= second <= 75


def _normalize_coordinate_order(first: object, second: object) -> tuple[float, float] | None:
    direct = _coordinate_pair(first, second)
    swapped = _coordinate_pair(second, first)
    if direct and swapped:
        parsed_first = float(first)
        parsed_second = float(second)
        if abs(parsed_first) > 90 or _looks_like_us_lon_lat(parsed_first, parsed_second):
            return swapped
        return direct
    return direct or swapped


def parse_coordinate_query(value: object) -> tuple[float, float] | None:
    text = _clean_text(value)
    if not text:
        return None

    decoded_text = unquote(text)

    match = GOOGLE_3D_4D_RE.search(decoded_text)
    if match:
        coordinate_pair = _coordinate_pair(match.group(1), match.group(2))
        if coordinate_pair:
            return coordinate_pair

    match = WKT_POINT_RE.search(decoded_text)
    if not match:
        match = NAMED_LAT_LON_RE.search(decoded_text)
        if match:
            coordinate_pair = _coordinate_pair(match.group(1), match.group(2))
            if coordinate_pair:
                return coordinate_pair

    if match:
        coordinate_pair = _coordinate_pair(match.group(2), match.group(1))
        if coordinate_pair:
            return coordinate_pair

    match = NAMED_LON_LAT_RE.search(decoded_text)
    if match:
        coordinate_pair = _coordinate_pair(match.group(2), match.group(1))
        if coordinate_pair:
            return coordinate_pair

    match = COORDINATE_QUERY_RE.match(decoded_text)
    if match:
        coordinate_pair = _normalize_coordinate_order(match.group(1), match.group(2))
        if coordinate_pair:
            return coordinate_pair

    for pattern in (COORDINATE_PAIR_RE, DECIMAL_COORDINATE_PAIR_RE):
        match = pattern.search(decoded_text)
        if match:
            coordinate_pair = _normalize_coordinate_order(match.group(1), match.group(2))
            if coordinate_pair:
                return coordinate_pair

    return None


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
