import json
import math
import re
import ssl
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time
from dataclasses import dataclass
from difflib import SequenceMatcher
from functools import lru_cache
from itertools import combinations
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import certifi
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai_settings import (
    UNITEDLANE_CHAT_IDENTITY,
    UNITEDLANE_IDENTITY,
    UnitedLaneChatProviderError,
    generate_unitedlane_chat_reply,
    generate_unitedlane_route_guidance,
)
from app.auth import is_admin, require_user_department
from app.config import get_settings
from app.database import get_db
from app.models import RoutingFuelStop, RoutingRequest, RoutingRoute, User
from app.official_stations import (
    ShortlistedOfficialStation,
    finalize_shortlisted_official_stations,
    refresh_shortlisted_live_prices,
    refine_shortlisted_detours,
    shortlist_official_stations_along_route,
)
from app.schemas import (
    ApiCapability,
    FuelStop,
    FuelStrategy,
    FuelStrategyStop,
    GeocodedPoint,
    LocationSuggestion,
    LocationSuggestionResponse,
    RouteAssistantRequest,
    RouteAssistantResponse,
    RouteHistoryFuelStop,
    RouteHistoryItem,
    RouteHistoryResponse,
    RouteHistoryRoute,
    RouteHistoryUser,
    RouteOption,
    RoutePoint,
    TomTomCapabilityCatalog,
    UnitedLaneChatRequest,
    UnitedLaneChatResponse,
)

router = APIRouter(prefix="/navigation", tags=["navigation"])
settings = get_settings()
ssl_context = ssl.create_default_context(cafile=certifi.where())
TOMTOM_BRAND_KEYWORDS = [
    "pilot",
    "pilot travel center",
    "flying j",
    "flying j travel center",
    "pilot flying j",
    "love's",
    "loves",
    "love's travel stop",
    "loves travel stop",
]
ALONG_ROUTE_PAGE_SIZE = 100
ALONG_ROUTE_MAX_RESULTS = 180
BRAND_SEARCH_DETOUR_SECONDS = 2400
OFFICIAL_SITE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36"
}
LOVES_SITEMAP_URL = "https://www.loves.com/sitemap-locations.xml"
PILOT_SITEMAP_URL = "https://locations.pilotflyingj.com/sitemap.xml"
MAX_LOVES_CITY_CANDIDATES = 6
MAX_PILOT_CITY_CANDIDATES = 8
DEFAULT_CURRENT_FUEL_GALLONS = 100.0
DEFAULT_TANK_CAPACITY_GALLONS = 200.0
DEFAULT_TRUCK_MPG = 6.0
FUEL_TIME_VALUE_PER_HOUR = 75.0
FUEL_DETOUR_PRICE_SPREAD_GALLONS = 50.0
FUEL_STOP_SERVICE_SECONDS = 10 * 60
MAX_SMART_FUEL_STOPS = 3
MAX_STRATEGY_CANDIDATES = 40
AUDIT_ROUTE_STOP_LIMIT = 30
STRATEGY_ROUTE_BANDS = 8
STRATEGY_BAND_KEEP = 3
CHEAP_STRATEGY_GLOBAL_KEEP = 24
CHEAP_STRATEGY_EDGE_KEEP = 4
FUEL_SAFETY_BUFFER_RATIO = 0.05
FUEL_SAFETY_BUFFER_MIN_MILES = 10.0
FUEL_SAFETY_BUFFER_MAX_MILES = 35.0
FUEL_EPSILON = 0.001
SORT_CODE_MAP = {
    "cheapest": "price",
    "lowest_retail": "price",
    "distance": "distance",
    "nearest": "distance",
    "cost_less_tax": "price",
    "score": "score",
    "rating": "score",
    "best": "score",
    "all": "score",
}

TOMTOM_CAPABILITIES = [
    ApiCapability(id="assets-api", name="Assets API", category="Operations", status="Requires Access", description="Enterprise asset inventory and file delivery services."),
    ApiCapability(id="batch-search-api", name="Batch Search API", category="Search", status="Ready", description="Batch geocoding and search jobs for large dispatch datasets."),
    ApiCapability(id="ev-charging-availability", name="EV Charging Stations Availability API", category="Search", status="Requires Access", description="Live EV charger availability and connector state data."),
    ApiCapability(id="extended-routing-api", name="Extended Routing API", category="Routing", status="Requires Access", description="Advanced routing profiles and enterprise-grade route controls."),
    ApiCapability(id="geocoding-api", name="Geocoding API", category="Search", status="Live", description="Turns addresses, cities, and pickup points into coordinates."),
    ApiCapability(id="geofencing-api", name="Geofencing API", category="Operations", status="Requires Access", description="Geofence lookup and zone event validation for fleet workflows."),
    ApiCapability(id="location-history-api", name="Location History API", category="Operations", status="Requires Access", description="Historical device trails and movement timelines."),
    ApiCapability(id="map-display-api", name="Map Display API", category="Maps", status="Live", description="Interactive map tiles and cartography for the route workspace."),
    ApiCapability(id="maps-assets-api", name="Maps Assets API", category="Maps", status="Requires Access", description="Hosted map assets and custom cartographic asset management."),
    ApiCapability(id="matrix-routing-v2-api", name="Matrix Routing v2 API", category="Routing", status="Ready", description="Travel time matrices for multi-stop planning and assignment logic."),
    ApiCapability(id="mcp-server", name="MCP Server", category="Platform", status="Requires Access", description="Agent and platform connector support for managed TomTom tooling."),
    ApiCapability(id="notifications-api", name="Notifications API", category="Operations", status="Requires Access", description="Push notifications for geofence, route, and mobility events."),
    ApiCapability(id="reverse-geocoding-api", name="Reverse Geocoding API", category="Search", status="Ready", description="Resolves GPS coordinates back into readable addresses."),
    ApiCapability(id="routing-api", name="Routing API", category="Routing", status="Live", description="Builds route alternatives, ETAs, and truck/car drive paths."),
    ApiCapability(id="search-api", name="Search API", category="Search", status="Live", description="Finds gas stations, POIs, and along-route stops."),
    ApiCapability(id="snap-to-roads-api", name="Snap to Roads API", category="Routing", status="Ready", description="Cleans noisy GPS traces and aligns them to the road network."),
    ApiCapability(id="traffic-api", name="Traffic API", category="Traffic", status="Ready", description="Traffic service family for congestion and incident intelligence."),
    ApiCapability(id="traffic-flow-api", name="Traffic Flow API", category="Traffic", status="Ready", description="Road speed and congestion layer support for live map overlays."),
    ApiCapability(id="traffic-incidents-api", name="Traffic Incidents API", category="Traffic", status="Ready", description="Accidents, closures, and delays for operations visibility."),
    ApiCapability(id="waypoint-optimization-api", name="Waypoint Optimization API", category="Routing", status="Ready", description="Optimizes stop order for efficient multi-stop dispatch trips."),
]


@dataclass
class RouteStationContext:
    index: int
    summary: dict
    route_points: list[RoutePoint]
    routing_points: list[RoutePoint]
    shortlisted_stations: list[ShortlistedOfficialStation]


def http_request(url: str, method: str = "GET", body: bytes | None = None, headers: dict | None = None) -> str:
    request = Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urlopen(request, timeout=25, context=ssl_context) as response:
            return response.read().decode("utf-8", errors="replace")
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Navigation provider error: {exc}") from exc


def http_json(url: str, method: str = "GET", body: dict | None = None, headers: dict | None = None):
    data = None
    request_headers = headers.copy() if headers else {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    return json.loads(http_request(url, method=method, body=data, headers=request_headers))



def safe_http_request(url: str, method: str = "GET", body: bytes | None = None, headers: dict | None = None) -> str | None:
    request = Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urlopen(request, timeout=20, context=ssl_context) as response:
            return response.read().decode("utf-8", errors="replace")
    except Exception:
        return None


@lru_cache(maxsize=256)
def fetch_official_page(url: str) -> str | None:
    return safe_http_request(url, headers=OFFICIAL_SITE_HEADERS)


def slugify_segment(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")


def extract_street_line(address: str) -> str:
    return (address or "").split(",")[0].strip()


def extract_house_number(value: str) -> str | None:
    match = re.search(r"\b(\d+)\b", value or "")
    return match.group(1) if match else None


def parse_sup_price(base_value: str, superscript_digit: str) -> float:
    normalized = base_value.replace(",", "")
    return round(float(f"{normalized}{superscript_digit}" if "." in normalized else f"{normalized}.{superscript_digit}"), 3)


@lru_cache(maxsize=1)
def load_loves_location_index() -> list[dict[str, str]]:
    xml_text = safe_http_request(LOVES_SITEMAP_URL, headers=OFFICIAL_SITE_HEADERS)
    if not xml_text:
        return []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    entries: list[dict[str, str]] = []
    for node in root.findall(".//sm:loc", namespace):
        url = (node.text or "").strip()
        match = re.search(r"/locations/([a-z]{2})/([^/]+)/", url)
        if not match:
            continue
        entries.append({
            "url": url,
            "state": match.group(1).upper(),
            "city": normalize_text(match.group(2).replace("-", " ")),
        })
    return entries


@lru_cache(maxsize=1)
def load_pilot_location_index() -> list[dict[str, str]]:
    xml_text = safe_http_request(PILOT_SITEMAP_URL, headers=OFFICIAL_SITE_HEADERS)
    if not xml_text:
        return []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    entries: list[dict[str, str]] = []
    for node in root.findall('.//sm:loc', namespace):
        url = (node.text or '').strip()
        match = re.search(r'/us/([a-z]{2})/([^/]+)/([^?#]+)$', url)
        if not match:
            continue
        entries.append({
            "url": url,
            "state": match.group(1).upper(),
            "city": normalize_text(match.group(2).replace('-', ' ')),
            "street_slug": normalize_text(match.group(3).replace('-', ' ')),
        })
    return entries


def extract_jsonld_objects(html: str) -> list[dict]:
    objects: list[dict] = []
    for payload in re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.I | re.S):
        try:
            parsed = json.loads(payload.strip())
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            objects.append(parsed)
        elif isinstance(parsed, list):
            objects.extend(item for item in parsed if isinstance(item, dict))
    return objects


@lru_cache(maxsize=256)
def load_loves_page_summary(url: str) -> dict | None:
    html = fetch_official_page(url)
    if not html:
        return None

    street = ""
    city = ""
    state = ""
    postal_code = ""
    lat = None
    lon = None
    location_name = ""
    amenities: set[str] = set()
    for entry in extract_jsonld_objects(html):
        address = entry.get("address")
        if isinstance(address, dict) and address.get("streetAddress") and not street:
            street = address.get("streetAddress", "")
            city = address.get("addressLocality", "")
            state = address.get("addressRegion", "")
            postal_code = address.get("postalCode", "")
        geo = entry.get("geo")
        if isinstance(geo, dict):
            lat = geo.get("latitude", lat)
            lon = geo.get("longitude", lon)
        if entry.get("name") and not location_name:
            location_name = str(entry.get("name"))
        for feature in entry.get("amenityFeature", []) or []:
            if isinstance(feature, dict) and feature.get("value") and feature.get("name"):
                amenities.add(str(feature.get("name")).strip())
        catalog = entry.get("hasOfferCatalog")
        if isinstance(catalog, dict):
            for item in catalog.get("itemListElement", []) or []:
                if isinstance(item, dict) and item.get("name"):
                    amenities.add(str(item.get("name")).strip())

    if not street:
        street_match = re.search(r'"streetAddress"\s*:\s*"([^"]+)"', html)
        city_match = re.search(r'"addressLocality"\s*:\s*"([^"]+)"', html)
        state_match = re.search(r'"addressRegion"\s*:\s*"([^"]+)"', html)
        postal_match = re.search(r'"postalCode"\s*:\s*"([^"]+)"', html)
        street = street_match.group(1) if street_match else ""
        city = city_match.group(1) if city_match else ""
        state = state_match.group(1) if state_match else ""
        postal_code = postal_match.group(1) if postal_match else ""

    if lat is None or lon is None:
        lat_match = re.search(r'"latitude"\s*:\s*"?([0-9\.-]+)"?', html)
        lon_match = re.search(r'"longitude"\s*:\s*"?([0-9\.-]+)"?', html)
        lat = float(lat_match.group(1)) if lat_match else None
        lon = float(lon_match.group(1)) if lon_match else None

    prices: dict[str, float] = {}
    for base_value, superscript_digit, label in re.findall(r'<h3>\$(\d+\.\d+)<sup>(\d)</sup></h3><span>\s*([^<]+?)\s*</span>', html, re.I):
        prices[normalize_text(label)] = parse_sup_price(base_value, superscript_digit)

    diesel_time_match = re.search(r'"productName":"DIESEL".*?"lastCheckInDateTime":"([^"]+)"', html, re.S)
    if not diesel_time_match:
        diesel_time_match = re.search(r'"productName":"DIESEL".*?"lastPriceChangeDateTime":"([^"]+)"', html, re.S)

    return {
        "url": url,
        "html": html,
        "name": location_name or "Love's",
        "street": street,
        "city": city,
        "state": state,
        "postal_code": postal_code,
        "house_number": extract_house_number(street),
        "lat": lat,
        "lon": lon,
        "amenities": sorted(amenities),
        "diesel_price": prices.get("diesel") or prices.get("auto diesel"),
        "diesel_time": diesel_time_match.group(1) if diesel_time_match else None,
        "auto_diesel_price": prices.get("auto diesel"),
        "unleaded_price": prices.get("unleaded"),
    }


@lru_cache(maxsize=256)
def load_pilot_page_summary(url: str) -> dict | None:
    html = fetch_official_page(url)
    if not html:
        return None

    street_match = re.search(r'itemprop="streetAddress"\s+content="([^"]+)"', html)
    city_match = re.search(r'itemprop="addressLocality"\s+content="([^"]+)"', html)
    state_match = re.search(r'itemprop="addressRegion"(?:\s+content="([A-Z]{2})"|>\s*([A-Z]{2}))', html)
    postal_match = re.search(r'itemprop="postalCode"\s+content="([^"]+)"', html)
    lat_match = re.search(r'itemprop="latitude"[^>]*content="([0-9\.-]+)"', html)
    lon_match = re.search(r'itemprop="longitude"[^>]*content="([0-9\.-]+)"', html)
    title_match = re.search(r'<title>(.*?)</title>', html, re.I | re.S)
    title_text = re.sub(r'\s+', ' ', title_match.group(1)).strip() if title_match else 'Pilot Flying J'
    state = ''
    if state_match:
        state = state_match.group(1) or state_match.group(2) or ''
    if not state:
        fallback_state = re.search(r' in .*?,\s*([A-Z]{2})\s*\|', title_text)
        state = fallback_state.group(1) if fallback_state else ''

    amenities: list[str] = []
    amenity_signals = [
        ('Truck Parking', r'truck parking'),
        ('Showers', r'showers'),
        ('CAT Scale', r'cat scale|\bscale\b'),
        ('Laundry', r'laundry'),
        ('Truck Care', r'truck care'),
        ('Restaurants', r'restaurants?'),
        ('Fast Food', r'fast food|food'),
        ('ATM', r'\batm\b'),
        ('Bulk Propane', r'bulk propane'),
        ('DEF', r'\bdef\b'),
        ('RV Services', r'\brv\b'),
        ('Wi-Fi', r'wi-?fi'),
    ]
    lowered_html = html.lower()
    for label, pattern in amenity_signals:
        if re.search(pattern, lowered_html):
            amenities.append(label)

    return {
        'url': url,
        'html': html,
        'name': title_text.split('|')[0].strip(),
        'street': street_match.group(1) if street_match else '',
        'city': city_match.group(1) if city_match else '',
        'state': state,
        'postal_code': postal_match.group(1) if postal_match else '',
        'house_number': extract_house_number(street_match.group(1) if street_match else ''),
        'lat': float(lat_match.group(1)) if lat_match else None,
        'lon': float(lon_match.group(1)) if lon_match else None,
        'amenities': amenities,
    }



def derive_location_type(name: str) -> str | None:
    haystack = normalize_text(name)
    if 'travel center' in haystack:
        return 'Travel Center'
    if 'country store' in haystack:
        return 'Country Store'
    if 'truck care' in haystack:
        return 'Truck Care'
    if 'rv stop' in haystack:
        return 'RV Stop'
    if 'service center' in haystack:
        return 'Service Center'
    return None

def select_loves_candidate(stop: FuelStop) -> dict | None:
    if not stop.city or not stop.state_code:
        return None

    target_city = normalize_text(stop.city)
    target_state = (stop.state_code or '').upper()
    street_line = extract_street_line(stop.address)

    candidates = [entry['url'] for entry in load_loves_location_index() if entry['state'] == target_state and entry['city'] == target_city]
    if not candidates and target_city:
        candidates = [entry['url'] for entry in load_loves_location_index() if entry['state'] == target_state and target_city.replace(' ', '-') in entry['url']]
    if not candidates:
        return None

    best_match = None
    best_score = -1
    for url in candidates[:MAX_LOVES_CITY_CANDIDATES]:
        summary = load_loves_page_summary(url)
        if not summary:
            continue
        score = 0
        if normalize_text(summary.get('city', '')) == target_city:
            score += 20
        if (summary.get('state') or '').upper() == target_state:
            score += 16
        score += min(address_consistency_score(summary.get('street', ''), street_line), 84)
        if score > best_score:
            best_match = summary
            best_score = score

    if best_score < 78:
        return None
    return best_match



def address_consistency_score(left: str, right: str) -> int:
    left_normalized = normalize_text(left)
    right_normalized = normalize_text(right)
    if not left_normalized or not right_normalized:
        return 0
    score = int(SequenceMatcher(None, left_normalized, right_normalized).ratio() * 100)
    left_number = extract_house_number(left)
    right_number = extract_house_number(right)
    if left_number and right_number and left_number == right_number:
        score += 25
    return score



def select_pilot_candidate(stop: FuelStop) -> dict | None:
    if not stop.state_code or not stop.city or not stop.address:
        return None

    target_state = (stop.state_code or '').upper()
    target_city = normalize_text(stop.city)
    street_line = extract_street_line(stop.address)
    candidates = [entry['url'] for entry in load_pilot_location_index() if entry['state'] == target_state and entry['city'] == target_city]
    if not candidates:
        return None

    best_match = None
    best_score = -1
    for url in candidates[:MAX_PILOT_CITY_CANDIDATES]:
        summary = load_pilot_page_summary(url)
        if not summary:
            continue
        score = 0
        if normalize_text(summary.get('city', '')) == target_city:
            score += 24
        if (summary.get('state') or '').upper() == target_state:
            score += 18
        score += min(address_consistency_score(summary.get('street', ''), street_line), 70)
        if score > best_score:
            best_match = summary
            best_score = score
    return best_match if best_score >= 72 else None



def apply_official_summary(stop: FuelStop, summary: dict, brand_name: str, price_source: str) -> FuelStop:
    official_name = summary.get('name') or stop.name
    street = summary.get('street') or extract_street_line(stop.address)
    city = summary.get('city') or stop.city
    state = (summary.get('state') or stop.state_code or '').upper() or None
    postal_code = summary.get('postal_code') or ''
    full_address = ', '.join(part for part in [street, ', '.join(part for part in [city, state] if part).strip(', '), postal_code] if part)

    stop.id = summary.get('url') or stop.id
    stop.name = official_name
    stop.brand = brand_name
    stop.city = city
    stop.state_code = state
    stop.address = full_address or stop.address
    stop.lat = float(summary.get('lat')) if summary.get('lat') is not None else stop.lat
    stop.lon = float(summary.get('lon')) if summary.get('lon') is not None else stop.lon
    stop.source_url = summary.get('url')
    stop.location_type = derive_location_type(official_name)
    stop.amenities = list(summary.get('amenities') or [])
    stop.official_match = True
    stop.price_source = price_source
    stop.amenity_score = round((stop.amenity_score or 0) + min(len(stop.amenities), 12) * 1.4 + 18, 1)
    stop.overall_score = round((stop.overall_score or 0) + 28 + min(len(stop.amenities), 10) * 1.6, 1)
    return stop



def enrich_loves_stop(stop: FuelStop) -> FuelStop:
    match = select_loves_candidate(stop)
    if not match:
        stop.brand = "Love's"
        stop.price_source = stop.price_source or "Love's route candidate (official page match unavailable)"
        return stop
    stop = apply_official_summary(stop, match, "Love's", "Love's official site")
    if match.get('auto_diesel_price') is not None:
        stop.auto_diesel_price = match.get('auto_diesel_price')
        stop.price = match.get('auto_diesel_price')
        stop.price_date = match.get('diesel_time')
        stop.overall_score = round((stop.overall_score or 0) + 10, 1)
    else:
        stop.price_source = "Love's official site (auto diesel price unavailable)"
    return stop



def enrich_pilot_stop(stop: FuelStop) -> FuelStop:
    match = select_pilot_candidate(stop)
    if not match:
        stop.brand = 'Pilot Flying J'
        stop.price_source = stop.price_source or 'Pilot Flying J route candidate (official page match unavailable)'
        return stop
    return apply_official_summary(stop, match, 'Pilot Flying J', 'Pilot Flying J official site (auto diesel price not published)')



def enrich_stop_with_official_site(stop: FuelStop) -> FuelStop | None:
    haystack = normalize_text(f'{stop.brand} {stop.name}')
    if 'love' in haystack:
        return enrich_loves_stop(stop)
    if 'pilot' in haystack or 'flying j' in haystack:
        return enrich_pilot_stop(stop)
    return stop



def enrich_stops_with_official_sites(stops: list[FuelStop]) -> list[FuelStop]:
    if not stops:
        return []
    max_workers = min(8, len(stops))
    if max_workers <= 1:
        results = [enrich_stop_with_official_site(stop) for stop in stops]
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            results = list(executor.map(enrich_stop_with_official_site, stops))
    return [stop for stop in results if stop is not None]

def build_location_secondary_text(address: dict) -> str:
    parts: list[str] = []
    for value in [
        address.get("municipality"),
        address.get("countrySubdivision") or address.get("countrySubdivisionName"),
        address.get("country"),
    ]:
        if value and value not in parts:
            parts.append(value)
    return ", ".join(parts)


def search_location_suggestions(query: str, limit: int = 6) -> list[LocationSuggestion]:
    trimmed_query = (query or "").strip()
    if len(trimmed_query) < 2 or not settings.tomtom_api_key:
        return []

    encoded_query = quote(trimmed_query)
    params = urlencode({
        "key": settings.tomtom_api_key,
        "limit": max(1, min(limit, 8)),
        "typeahead": "true",
        "language": "en-US",
        "countrySet": "US,CA",
    })
    data = http_json(f"https://api.tomtom.com/search/2/search/{encoded_query}.json?{params}")
    seen: set[str] = set()
    suggestions: list[LocationSuggestion] = []

    for item in data.get("results", []):
        position = item.get("position") or {}
        lat = position.get("lat")
        lon = position.get("lon")
        if lat is None or lon is None:
            continue

        address = item.get("address") or {}
        label = address.get("freeformAddress") or item.get("poi", {}).get("name") or trimmed_query
        secondary_text = build_location_secondary_text(address)
        suggestion_type = item.get("entityType") or item.get("type")
        dedupe_key = f"{label.strip().lower()}|{round(float(lat), 5)}|{round(float(lon), 5)}"
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        suggestions.append(LocationSuggestion(
            id=str(item.get("id") or dedupe_key),
            label=label,
            secondary_text=secondary_text,
            lat=float(lat),
            lon=float(lon),
            type=str(suggestion_type) if suggestion_type else None,
        ))

    return suggestions


@lru_cache(maxsize=512)
def geocode_address(query: str) -> GeocodedPoint:
    encoded_query = quote(query)
    params = urlencode({"key": settings.tomtom_api_key, "limit": 1})
    data = http_json(f"https://api.tomtom.com/search/2/geocode/{encoded_query}.json?{params}")
    results = data.get("results", [])
    if not results:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Address not found: {query}")
    first = results[0]
    position = first.get("position", {})
    address = first.get("address", {})
    return GeocodedPoint(label=address.get("freeformAddress", query), lat=position.get("lat"), lon=position.get("lon"))


def build_map_link(origin: str, destination: str) -> str:
    return f"https://www.google.com/maps/dir/?api=1&origin={quote(origin)}&destination={quote(destination)}&travelmode=driving"


def build_station_map_link(origin: GeocodedPoint, stop: FuelStop) -> str:
    return f"https://www.google.com/maps/dir/?api=1&origin={quote(origin.label)}&destination={stop.lat},{stop.lon}&travelmode=driving"


@lru_cache(maxsize=256)
def get_routes_cached(origin_lat: float, origin_lon: float, destination_lat: float, destination_lon: float, vehicle_type: str):
    route_points = f"{origin_lat},{origin_lon}:{destination_lat},{destination_lon}"
    params = urlencode({
        "key": settings.tomtom_api_key,
        "maxAlternatives": 2,
        "routeRepresentation": "polyline",
        "computeTravelTimeFor": "all",
        "travelMode": "truck" if vehicle_type.lower() == "truck" else "car",
    })
    return http_json(f"https://api.tomtom.com/routing/1/calculateRoute/{route_points}/json?{params}").get("routes", [])


def get_routes(origin: GeocodedPoint, destination: GeocodedPoint, vehicle_type: str):
    return get_routes_cached(
        round(float(origin.lat), 5),
        round(float(origin.lon), 5),
        round(float(destination.lat), 5),
        round(float(destination.lon), 5),
        vehicle_type.lower(),
    )


def to_route_points(route: dict, max_points: int = 220) -> list[RoutePoint]:
    points: list[RoutePoint] = []
    for leg in route.get("legs", []):
        for point in leg.get("points", []):
            points.append(RoutePoint(lat=point.get("latitude"), lon=point.get("longitude")))
    if len(points) <= max_points:
        return points
    step = max(1, len(points) // max_points)
    sampled = points[::step]
    if sampled[-1] != points[-1]:
        sampled.append(points[-1])
    return sampled


def build_route_station_context(index: int, route: dict, fuel_type: str) -> RouteStationContext:
    summary = route.get("summary", {})
    route_points = to_route_points(route)
    routing_points = to_route_points(route, max_points=360)
    return RouteStationContext(
        index=index,
        summary=summary,
        route_points=route_points,
        routing_points=routing_points,
        shortlisted_stations=shortlist_official_stations_along_route(routing_points, fuel_type),
    )


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def detect_keyword_match(name: str, brand: str) -> str | None:
    haystack = normalize_text(f"{brand} {name}")
    ranked_keywords = sorted({normalize_text(item) for item in TOMTOM_BRAND_KEYWORDS}, key=len, reverse=True)
    for keyword in ranked_keywords:
        if keyword and keyword in haystack:
            return keyword
    return None


def detect_brand_family(name: str, brand: str) -> str | None:
    haystack = normalize_text(f"{brand} {name}")
    loves_signals = ["love s", "loves", "love s travel stop", "loves travel stop"]
    pilot_signals = ["pilot", "pilot travel center", "pilot flying j", "flying j", "flying j travel center"]
    if any(signal in haystack for signal in loves_signals):
        return "Love's"
    if any(signal in haystack for signal in pilot_signals):
        return "Pilot Flying J"
    return None


def keyword_family(keyword: str | None, name: str, brand: str = "") -> str | None:
    explicit = detect_brand_family(name, brand)
    if explicit:
        return explicit
    haystack = normalize_text(f"{keyword or ''} {brand} {name}")
    if "love" in haystack:
        return "Love's"
    if "pilot" in haystack or "flying j" in haystack:
        return "Pilot Flying J"
    return None


def keyword_score(keyword: str | None) -> float:
    normalized = normalize_text(keyword or "")
    if normalized in {"pilot travel center", "flying j travel center", "pilot flying j", "love s travel stop", "loves travel stop"}:
        return 100
    if normalized in {"pilot", "flying j", "love s", "loves"}:
        return 92
    return 68


def to_fuel_stop(item: dict, matched_keyword: str | None) -> FuelStop:
    poi = item.get("poi", {})
    address = item.get("address", {})
    position = item.get("position", {})
    brands = poi.get("brands", []) or []
    brand_name = brands[0].get("name") if brands else None
    family = keyword_family(matched_keyword, poi.get("name", ""), brand_name or "") or "Unknown"
    display_name = poi.get("name") or brand_name or family
    display_brand = family
    subdivision = address.get("countrySubdivisionCode")
    state_code = subdivision.split("-")[-1] if subdivision else None
    stop = FuelStop(
        id=str(item.get("id", display_name)),
        name=display_name,
        brand=display_brand,
        city=address.get("municipality", ""),
        address=address.get("freeformAddress", "Address unavailable"),
        state_code=state_code,
        lat=position.get("lat"),
        lon=position.get("lon"),
        detour_distance_meters=item.get("detourDistance"),
        detour_time_seconds=item.get("detourTime"),
        origin_miles=None,
        off_route_miles=None,
        fuel_types=poi.get("fuelTypes", []),
        price=None,
        price_less_tax=None,
        price_source="TomTom route candidate",
        amenity_score=keyword_score(matched_keyword),
        overall_score=0,
        source_url=None,
        amenities=[],
        location_type=derive_location_type(display_name),
        official_match=False,
    )
    stop.off_route_miles = round((stop.detour_distance_meters or 0) * 0.000621371, 1) if stop.detour_distance_meters is not None else None
    stop.overall_score = round((stop.amenity_score or 0) * 0.65 + max(0, 34 - (stop.off_route_miles or 0)), 1)
    return stop


def merge_stop(stops_by_id: dict[str, FuelStop], stop: FuelStop):
    existing = stops_by_id.get(stop.id)
    if not existing:
        stops_by_id[stop.id] = stop
        return
    if stop.official_match and not existing.official_match:
        stops_by_id[stop.id] = stop
        return
    current_score = existing.overall_score if existing.overall_score is not None else -1
    next_score = stop.overall_score if stop.overall_score is not None else -1
    if next_score > current_score:
        stops_by_id[stop.id] = stop


def search_tomtom_brand_stops(route_points: list[RoutePoint]) -> list[FuelStop]:
    if len(route_points) < 2:
        return []
    body = {"route": {"points": [point.model_dump() for point in route_points]}}
    stops_by_id: dict[str, FuelStop] = {}
    normalized_keywords = []
    for keyword in TOMTOM_BRAND_KEYWORDS:
        normalized = normalize_text(keyword)
        if normalized not in normalized_keywords:
            normalized_keywords.append(normalized)

    for keyword in normalized_keywords:
        offset = 0
        while offset < ALONG_ROUTE_MAX_RESULTS:
            params = urlencode({
                "key": settings.tomtom_api_key,
                "limit": ALONG_ROUTE_PAGE_SIZE,
                "offset": offset,
                "maxDetourTime": BRAND_SEARCH_DETOUR_SECONDS,
                "sortBy": "detourTime",
            })
            encoded_query = quote(keyword)
            data = http_json(f"https://api.tomtom.com/search/2/searchAlongRoute/{encoded_query}.json?{params}", method="POST", body=body)
            batch = data.get("results", [])
            if not batch:
                break
            for item in batch:
                poi = item.get("poi", {})
                brands = poi.get("brands", []) or []
                brand_name = brands[0].get("name") if brands else ""
                matched_keyword = detect_keyword_match(poi.get("name", ""), brand_name) or keyword
                family = keyword_family(matched_keyword, poi.get("name", ""), brand_name)
                if family not in {"Love's", "Pilot Flying J"}:
                    continue
                merge_stop(stops_by_id, to_fuel_stop(item, matched_keyword))
            if len(batch) < ALONG_ROUTE_PAGE_SIZE:
                break
            offset += ALONG_ROUTE_PAGE_SIZE
    return enrich_stops_with_official_sites(list(stops_by_id.values()))


def sort_stops(stops: list[FuelStop], sort_key: str) -> list[FuelStop]:
    mode = SORT_CODE_MAP.get(sort_key.lower(), "score")
    if mode == "distance":
        return sorted(stops, key=lambda stop: (stop.detour_distance_meters or 999999, -(stop.amenity_score or 0), stop.name.lower()))
    if mode == "brand":
        return sorted(stops, key=lambda stop: (-(stop.amenity_score or 0), stop.detour_distance_meters or 999999, stop.name.lower()))
    if mode == "price":
        return sorted(stops, key=lambda stop: (stop.price is None, stop.price if stop.price is not None else 999999, stop.detour_distance_meters or 999999, stop.name.lower()))
    return sorted(stops, key=lambda stop: (-(stop.overall_score or 0), stop.detour_distance_meters or 999999, stop.name.lower()))


def format_price_text(stop: FuelStop, fuel_type: str) -> str:
    if stop.price is None:
        return f"not currently published for {fuel_type.lower()}"
    return f"${stop.price:.3f} per gallon"


def minutes_from_seconds(value: int | None) -> int | None:
    if value is None:
        return None
    return max(1, math.ceil(value / 60))


def meters_to_miles(value: int | float | None) -> float:
    return float(value or 0) * 0.000621371


def parse_float_input(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def parse_positive_input(value) -> float | None:
    parsed = parse_float_input(value)
    return parsed if parsed is not None and parsed > 0 else None


def parse_non_negative_input(value) -> float | None:
    parsed = parse_float_input(value)
    return parsed if parsed is not None and parsed >= 0 else None


def resolve_fuel_inputs(payload: RouteAssistantRequest) -> tuple[float, float, float, list[str]]:
    warnings: list[str] = []
    tank_capacity = parse_positive_input(payload.tank_capacity_gallons) or DEFAULT_TANK_CAPACITY_GALLONS
    full_range_miles = parse_positive_input(payload.full_range)
    mpg = parse_positive_input(payload.mpg)
    if mpg is None and full_range_miles is not None and tank_capacity > 0:
        mpg = full_range_miles / tank_capacity
    if mpg is None:
        mpg = DEFAULT_TRUCK_MPG

    current_fuel = parse_non_negative_input(payload.current_fuel_gallons)
    start_range_miles = parse_non_negative_input(payload.start_range)
    if current_fuel is None and start_range_miles is not None and mpg > 0:
        current_fuel = start_range_miles / mpg
    if current_fuel is None:
        current_fuel = min(tank_capacity, DEFAULT_CURRENT_FUEL_GALLONS)

    if current_fuel > tank_capacity:
        warnings.append("Current fuel was higher than tank capacity, so the plan clamps it to a full tank.")
        current_fuel = tank_capacity

    return current_fuel, tank_capacity, mpg, warnings


def resolve_price_target(payload: RouteAssistantRequest) -> float | None:
    return parse_positive_input(payload.price_target)


def price_target_overage(price: float | None, price_target: float | None) -> float:
    if price is None or price_target is None:
        return 0.0
    return max(0.0, price - price_target)


def strategy_prefers_low_price(sort_by: str = "") -> bool:
    return SORT_CODE_MAP.get((sort_by or "").lower(), "score") == "price"


def strategy_average_price(item: FuelStrategy) -> float:
    gallons = parse_float_input(item.required_purchase_gallons) or 0.0
    if gallons <= FUEL_EPSILON:
        return 0.0
    return (parse_float_input(item.estimated_fuel_cost) or 0.0) / gallons


def strategy_peak_stop_price(item: FuelStrategy) -> float:
    prices = [
        price
        for price in (parse_float_input(stop.auto_diesel_price) for stop in item.stops)
        if price is not None
    ]
    return max(prices) if prices else 0.0


def strategy_rank_key(item: FuelStrategy, price_target: float | None = None, sort_by: str = "") -> tuple:
    prefers_low_price = strategy_prefers_low_price(sort_by)
    if price_target is not None and prefers_low_price:
        return (
            0 if item.price_target_breach_count == 0 else 1,
            item.price_target_breach_count,
            item.price_target_total_overage,
            item.price_target_max_overage,
            item.estimated_fuel_cost,
            strategy_average_price(item),
            strategy_peak_stop_price(item),
            item.stop_count,
            item.estimated_total_time_seconds,
            item.decision_score,
            item.total_route_miles,
        )
    if price_target is not None:
        return (
            0 if item.price_target_breach_count == 0 else 1,
            item.price_target_breach_count,
            item.price_target_total_overage,
            item.price_target_max_overage,
            item.decision_score,
            item.estimated_fuel_cost,
            item.stop_count,
            item.estimated_total_time_seconds,
            item.total_route_miles,
        )
    if prefers_low_price:
        return (
            item.estimated_fuel_cost,
            strategy_average_price(item),
            strategy_peak_stop_price(item),
            item.stop_count,
            item.estimated_total_time_seconds,
            item.decision_score,
            item.total_route_miles,
        )
    return (
        item.decision_score,
        item.estimated_fuel_cost,
        item.stop_count,
        item.estimated_total_time_seconds,
        item.total_route_miles,
    )


def stop_auto_diesel_price(stop: FuelStop) -> float | None:
    value = parse_float_input(stop.auto_diesel_price)
    return value if value is not None and value >= 0 else None


def stop_route_miles(stop: FuelStop) -> float | None:
    value = parse_float_input(stop.origin_miles)
    return value if value is not None and value >= 0 else None


def stop_detour_total_miles(stop: FuelStop) -> float:
    if stop.detour_distance_meters:
        return max(0.0, meters_to_miles(stop.detour_distance_meters))
    off_route = parse_float_input(stop.off_route_miles) or 0.0
    return max(0.0, off_route * 2.0)


def stop_access_miles(stop: FuelStop) -> float:
    return stop_detour_total_miles(stop) / 2.0


def stop_choice_key(stop: FuelStop, position: float, mpg: float = DEFAULT_TRUCK_MPG) -> tuple[float, float, int, float]:
    price = stop_auto_diesel_price(stop) or float("inf")
    detour_seconds = stop.detour_time_seconds or 0
    detour_gallons = stop_detour_total_miles(stop) / max(mpg, 1)
    detour_cost = (detour_seconds / 3600) * FUEL_TIME_VALUE_PER_HOUR + (detour_gallons * price)
    adjusted_price = price + (detour_cost / FUEL_DETOUR_PRICE_SPREAD_GALLONS)
    return (adjusted_price, price, detour_seconds, position)


def stop_low_price_key(stop: FuelStop) -> tuple[bool, float, float, float, str]:
    price = stop_auto_diesel_price(stop)
    position = stop_route_miles(stop)
    return (
        price is None,
        price if price is not None else float("inf"),
        stop_detour_total_miles(stop),
        position if position is not None else float("inf"),
        (stop.brand or stop.name or "").lower(),
    )


def drive_miles_between(from_stop: FuelStop | None, from_route_miles: float, to_stop: FuelStop | None, to_route_miles: float) -> float:
    exit_miles = stop_access_miles(from_stop) if from_stop else 0.0
    entry_miles = stop_access_miles(to_stop) if to_stop else 0.0
    route_delta = max(0.0, to_route_miles - from_route_miles)
    return exit_miles + route_delta + entry_miles


def stop_leg_miles(current_route_miles: float, stop: FuelStop) -> float:
    return drive_miles_between(None, current_route_miles, stop, stop_route_miles(stop) or current_route_miles)


def desired_safety_buffer_miles(leg_miles: float) -> float:
    return min(FUEL_SAFETY_BUFFER_MAX_MILES, max(FUEL_SAFETY_BUFFER_MIN_MILES, leg_miles * FUEL_SAFETY_BUFFER_RATIO))


def capped_safety_buffer_miles(leg_miles: float, max_range_miles: float) -> float:
    if leg_miles >= max_range_miles:
        return 0.0
    return min(desired_safety_buffer_miles(leg_miles), max(0.0, max_range_miles - leg_miles))


def build_strategy_map_link(origin: GeocodedPoint, destination: GeocodedPoint, stops: list[FuelStop]) -> str:
    params = {
        "api": "1",
        "origin": origin.label or f"{origin.lat},{origin.lon}",
        "destination": destination.label or f"{destination.lat},{destination.lon}",
        "travelmode": "driving",
    }
    if stops:
        params["waypoints"] = "|".join(f"{stop.lat},{stop.lon}" for stop in stops)
    return f"https://www.google.com/maps/dir/?{urlencode(params)}"


def priced_route_stops(route: RouteOption, route_miles: float) -> list[FuelStop]:
    by_id: dict[str, FuelStop] = {}
    for stop in route.fuel_stops:
        price = stop_auto_diesel_price(stop)
        position = stop_route_miles(stop)
        if price is None or position is None:
            continue
        if position < 0 or position > route_miles + 5:
            continue
        key = stop.id or f"{stop.lat},{stop.lon}"
        current = by_id.get(key)
        if current is None:
            by_id[key] = stop
            continue
        current_price = stop_auto_diesel_price(current) or float("inf")
        if (price, stop_detour_total_miles(stop), position) < (current_price, stop_detour_total_miles(current), stop_route_miles(current) or float("inf")):
            by_id[key] = stop
    return sorted(by_id.values(), key=lambda item: (stop_route_miles(item) or 0, stop_choice_key(item, stop_route_miles(item) or 0)))

def strategy_candidate_stops(
    stops: list[FuelStop],
    route_miles: float,
    price_target: float | None,
    sort_by: str,
    current_fuel: float,
    tank_capacity: float,
    mpg: float,
) -> list[FuelStop]:
    if len(stops) <= MAX_STRATEGY_CANDIDATES:
        return stops

    prefers_low_price = strategy_prefers_low_price(sort_by)
    selected: list[FuelStop] = []
    seen: set[str] = set()

    def add(stop: FuelStop):
        key = stop.id or f"{stop.lat},{stop.lon}"
        if key in seen:
            return
        seen.add(key)
        selected.append(stop)

    if prefers_low_price:
        for stop in sorted(stops, key=stop_low_price_key)[:CHEAP_STRATEGY_GLOBAL_KEEP]:
            add(stop)

    for stop in stops[:8]:
        add(stop)

    band_size = max(route_miles / STRATEGY_ROUTE_BANDS, 1.0)
    for band_index in range(STRATEGY_ROUTE_BANDS):
        band_start = band_index * band_size
        band_end = route_miles + 1 if band_index == STRATEGY_ROUTE_BANDS - 1 else (band_index + 1) * band_size
        band_stops = [
            stop for stop in stops
            if band_start <= (stop_route_miles(stop) or 0) < band_end
        ]
        band_sort_key = stop_low_price_key if prefers_low_price else (lambda item: stop_choice_key(item, stop_route_miles(item) or 0, mpg))
        for stop in sorted(band_stops, key=band_sort_key)[:STRATEGY_BAND_KEEP]:
            add(stop)

    full_range_miles = tank_capacity * mpg
    target_miles = current_fuel * mpg
    while target_miles < route_miles + full_range_miles:
        for stop in sorted(stops, key=lambda item: abs((stop_route_miles(item) or 0) - target_miles))[:4]:
            add(stop)
        target_miles += max(full_range_miles * 0.85, 1.0)

    for stop in sorted(stops, key=lambda item: stop_choice_key(item, stop_route_miles(item) or 0, mpg))[:16]:
        add(stop)

    if prefers_low_price:
        for stop in sorted(
            stops,
            key=stop_low_price_key,
        )[:16]:
            add(stop)

    if price_target is not None:
        for stop in sorted(stops, key=lambda item: (price_target_overage(stop_auto_diesel_price(item), price_target), stop_choice_key(item, stop_route_miles(item) or 0, mpg)))[:16]:
            add(stop)

    for stop in stops[-4:]:
        add(stop)

    if len(selected) <= MAX_STRATEGY_CANDIDATES:
        return sorted(selected, key=lambda item: stop_route_miles(item) or 0)

    if not prefers_low_price:
        return sorted(selected[:MAX_STRATEGY_CANDIDATES], key=lambda item: stop_route_miles(item) or 0)

    trimmed: list[FuelStop] = []
    trimmed_seen: set[str] = set()

    def add_trimmed(stop: FuelStop):
        key = stop.id or f"{stop.lat},{stop.lon}"
        if key in trimmed_seen or len(trimmed) >= MAX_STRATEGY_CANDIDATES:
            return
        trimmed_seen.add(key)
        trimmed.append(stop)

    route_sorted_selected = sorted(selected, key=lambda item: stop_route_miles(item) or 0)
    for stop in route_sorted_selected[:CHEAP_STRATEGY_EDGE_KEEP]:
        add_trimmed(stop)
    for stop in route_sorted_selected[-CHEAP_STRATEGY_EDGE_KEEP:]:
        add_trimmed(stop)

    for band_index in range(STRATEGY_ROUTE_BANDS):
        band_start = band_index * band_size
        band_end = route_miles + 1 if band_index == STRATEGY_ROUTE_BANDS - 1 else (band_index + 1) * band_size
        band_stops = [
            stop for stop in route_sorted_selected
            if band_start <= (stop_route_miles(stop) or 0) < band_end
        ]
        if band_stops:
            add_trimmed(sorted(band_stops, key=stop_low_price_key)[0])

    for stop in sorted(selected, key=stop_low_price_key):
        add_trimmed(stop)

    return sorted(trimmed, key=lambda item: stop_route_miles(item) or 0)

def strategy_stop_sequences(stops: list[FuelStop]):
    max_count = min(MAX_SMART_FUEL_STOPS, len(stops))
    for stop_count in range(1, max_count + 1):
        yield from combinations(range(len(stops)), stop_count)


def simulate_fuel_sequence(
    route: RouteOption,
    stops: list[FuelStop],
    sequence: tuple[int, ...],
    current_fuel: float,
    tank_capacity: float,
    mpg: float,
    route_miles: float,
    price_target: float | None,
    origin: GeocodedPoint,
    destination: GeocodedPoint,
    base_warnings: list[str],
) -> FuelStrategy | None:
    sequence_stops = [stops[index] for index in sequence]
    sequence_positions = [stop_route_miles(stop) or 0.0 for stop in sequence_stops]
    if any(left >= right for left, right in zip(sequence_positions, sequence_positions[1:])):
        return None

    fuel_gallons = current_fuel
    current_stop: FuelStop | None = None
    current_position = 0.0
    planned_stops: list[FuelStrategyStop] = []
    total_cost = 0.0
    total_gallons = 0.0
    total_detour_seconds = 0
    reduced_buffer = False

    target_index = 0
    while target_index <= len(sequence_stops):
        next_stop = sequence_stops[target_index] if target_index < len(sequence_stops) else None
        next_position = sequence_positions[target_index] if next_stop else route_miles
        leg_miles = drive_miles_between(current_stop, current_position, next_stop, next_position)
        available_range = fuel_gallons * mpg
        if leg_miles > available_range + FUEL_EPSILON:
            return None

        fuel_gallons = max(0.0, fuel_gallons - (leg_miles / mpg))
        if next_stop is None:
            current_position = route_miles
            break

        current_stop = next_stop
        current_position = next_position
        target_index += 1

        destination_leg_now = drive_miles_between(current_stop, current_position, None, route_miles)
        destination_buffer_now = capped_safety_buffer_miles(destination_leg_now, tank_capacity * mpg)
        if destination_leg_now + destination_buffer_now <= (fuel_gallons * mpg) + FUEL_EPSILON:
            continue

        current_price = stop_auto_diesel_price(current_stop)
        if current_price is None:
            return None

        chosen_target_index: int | None = None
        chosen_target_stop: FuelStop | None = None
        chosen_target_position = route_miles
        chosen_target_label = destination.label
        chosen_leg_miles = drive_miles_between(current_stop, current_position, None, route_miles)
        reason = "Buy enough Auto Diesel to reach destination with a small safety buffer."

        best_future_key: tuple[float, float, float, int] | None = None
        for future_index in range(target_index, len(sequence_stops)):
            future_stop = sequence_stops[future_index]
            future_price = stop_auto_diesel_price(future_stop)
            future_position = sequence_positions[future_index]
            future_leg_miles = drive_miles_between(current_stop, current_position, future_stop, future_position)
            if future_leg_miles > tank_capacity * mpg + FUEL_EPSILON:
                break
            if future_price is not None and future_price < current_price - FUEL_EPSILON:
                candidate_key = (
                    future_price,
                    stop_detour_total_miles(future_stop),
                    -future_position,
                    future_index,
                )
                if best_future_key is not None and candidate_key >= best_future_key:
                    continue
                best_future_key = candidate_key
                chosen_target_index = future_index
                chosen_target_stop = future_stop
                chosen_target_position = future_position
                chosen_target_label = future_stop.brand or future_stop.name
                chosen_leg_miles = future_leg_miles
                reason = "Buy only enough to reach the lowest-priced reachable Auto Diesel stop ahead, with a small reserve."

        if chosen_target_stop is None and chosen_leg_miles > tank_capacity * mpg + FUEL_EPSILON:
            if target_index >= len(sequence_stops):
                return None
            chosen_target_index = target_index
            chosen_target_stop = sequence_stops[target_index]
            chosen_target_position = sequence_positions[target_index]
            chosen_target_label = chosen_target_stop.brand or chosen_target_stop.name
            chosen_leg_miles = drive_miles_between(current_stop, current_position, chosen_target_stop, chosen_target_position)
            reason = "Fill only what is needed to reach the next required Auto Diesel stop with reserve."

        if chosen_leg_miles > tank_capacity * mpg + FUEL_EPSILON:
            return None

        desired_buffer = desired_safety_buffer_miles(chosen_leg_miles)
        safety_buffer = capped_safety_buffer_miles(chosen_leg_miles, tank_capacity * mpg)
        if safety_buffer + FUEL_EPSILON < desired_buffer:
            reduced_buffer = True
        required_gallons = min(tank_capacity, (chosen_leg_miles + safety_buffer) / mpg)
        gallons_to_buy = min(tank_capacity - fuel_gallons, max(0.0, required_gallons - fuel_gallons))
        if (fuel_gallons + gallons_to_buy) * mpg + FUEL_EPSILON < chosen_leg_miles:
            return None

        fuel_before = fuel_gallons
        fuel_after = fuel_gallons + gallons_to_buy
        if gallons_to_buy > 0.05:
            estimated_cost = gallons_to_buy * current_price
            planned_stops.append(FuelStrategyStop(
                sequence=len(planned_stops) + 1,
                stop=current_stop,
                route_miles=round(current_position, 1),
                miles_to_next=round(chosen_leg_miles, 1),
                gallons_to_buy=round(gallons_to_buy, 1),
                estimated_cost=round(estimated_cost, 2),
                fuel_before_gallons=round(fuel_before, 1),
                fuel_after_gallons=round(fuel_after, 1),
                auto_diesel_price=round(current_price, 3),
                safety_buffer_miles=round(safety_buffer, 1),
                reason=reason,
                next_target_label=chosen_target_label,
            ))
            total_cost += estimated_cost
            total_gallons += gallons_to_buy
            total_detour_seconds += current_stop.detour_time_seconds or 0

        if len(planned_stops) > MAX_SMART_FUEL_STOPS:
            return None

        fuel_gallons = fuel_after
        if chosen_target_stop is None:
            fuel_gallons = max(0.0, fuel_gallons - (chosen_leg_miles / mpg))
            current_position = route_miles
            break

        if chosen_target_index is not None:
            while target_index < chosen_target_index:
                target_index += 1

    if current_position < route_miles - FUEL_EPSILON:
        return None

    warnings = list(base_warnings)
    if reduced_buffer:
        warnings.append("Safety buffer was reduced on one leg because the tank range is tight.")

    price_target_breach_count = 0
    price_target_total_overage = 0.0
    price_target_max_overage = 0.0
    if price_target is not None:
        for item in planned_stops:
            overage = price_target_overage(item.auto_diesel_price, price_target)
            if overage > FUEL_EPSILON:
                price_target_breach_count += 1
                price_target_total_overage += overage
                price_target_max_overage = max(price_target_max_overage, overage)
        if price_target_breach_count:
            stop_word = "stop" if price_target_breach_count == 1 else "stops"
            warnings.append(
                f"Smart price target ${price_target:.3f}/gal could not be held on every leg, so the planner allows {price_target_breach_count} higher-priced {stop_word} where reachability or trip efficiency required it."
            )

    service_seconds = len(planned_stops) * FUEL_STOP_SERVICE_SECONDS
    estimated_total_time = route.travel_time_seconds + total_detour_seconds + service_seconds
    stop_count_penalty = len(planned_stops) * ((FUEL_STOP_SERVICE_SECONDS / 3600) * FUEL_TIME_VALUE_PER_HOUR)
    decision_score = total_cost + ((estimated_total_time / 3600) * FUEL_TIME_VALUE_PER_HOUR) + stop_count_penalty
    map_link = build_strategy_map_link(origin, destination, [item.stop for item in planned_stops])
    return FuelStrategy(
        status="planned" if planned_stops else "direct",
        route_id=route.id,
        route_label=route.label,
        total_route_miles=round(route_miles, 1),
        current_fuel_gallons=round(current_fuel, 1),
        tank_capacity_gallons=round(tank_capacity, 1),
        mpg=round(mpg, 2),
        starting_range_miles=round(current_fuel * mpg, 1),
        full_tank_range_miles=round(tank_capacity * mpg, 1),
        required_purchase_gallons=round(total_gallons, 1),
        estimated_fuel_cost=round(total_cost, 2),
        estimated_detour_time_seconds=total_detour_seconds,
        estimated_service_time_seconds=service_seconds,
        estimated_total_time_seconds=estimated_total_time,
        decision_score=round(decision_score, 2),
        stop_count=len(planned_stops),
        price_target=round(price_target, 3) if price_target is not None else None,
        price_target_breach_count=price_target_breach_count,
        price_target_total_overage=round(price_target_total_overage, 3),
        price_target_max_overage=round(price_target_max_overage, 3),
        stops=planned_stops,
        warnings=warnings,
        map_link=map_link,
        max_stop_count=MAX_SMART_FUEL_STOPS,
        safety_buffer_policy=f"Small reserve per leg: {FUEL_SAFETY_BUFFER_MIN_MILES:.0f}-{FUEL_SAFETY_BUFFER_MAX_MILES:.0f} miles, capped by tank range.",
    )


def build_route_fuel_strategy(route: RouteOption, payload: RouteAssistantRequest, origin: GeocodedPoint, destination: GeocodedPoint) -> FuelStrategy:
    current_fuel, tank_capacity, mpg, warnings = resolve_fuel_inputs(payload)
    price_target = resolve_price_target(payload)
    route_miles = meters_to_miles(route.distance_meters)
    full_range_miles = tank_capacity * mpg
    starting_range_miles = current_fuel * mpg
    base = {
        "route_id": route.id,
        "route_label": route.label,
        "total_route_miles": round(route_miles, 1),
        "current_fuel_gallons": round(current_fuel, 1),
        "tank_capacity_gallons": round(tank_capacity, 1),
        "mpg": round(mpg, 2),
        "starting_range_miles": round(starting_range_miles, 1),
        "full_tank_range_miles": round(full_range_miles, 1),
        "estimated_total_time_seconds": route.travel_time_seconds,
        "map_link": build_strategy_map_link(origin, destination, []),
        "max_stop_count": MAX_SMART_FUEL_STOPS,
        "price_target": round(price_target, 3) if price_target is not None else None,
        "price_target_breach_count": 0,
        "price_target_total_overage": 0,
        "price_target_max_overage": 0,
        "safety_buffer_policy": f"Small reserve per leg: {FUEL_SAFETY_BUFFER_MIN_MILES:.0f}-{FUEL_SAFETY_BUFFER_MAX_MILES:.0f} miles, capped by tank range.",
    }

    if route_miles <= 0:
        return FuelStrategy(status="unreachable", warnings=warnings + ["Route distance is missing."], **base)

    direct_buffer = capped_safety_buffer_miles(route_miles, starting_range_miles)
    if starting_range_miles >= route_miles + direct_buffer - FUEL_EPSILON:
        direct_warnings = list(warnings)
        if direct_buffer + FUEL_EPSILON < desired_safety_buffer_miles(route_miles):
            direct_warnings.append("Current fuel can reach destination, but the small safety buffer is reduced because range is tight.")
        decision_score = (route.travel_time_seconds / 3600) * FUEL_TIME_VALUE_PER_HOUR
        return FuelStrategy(
            status="direct",
            decision_score=round(decision_score, 2),
            warnings=direct_warnings + ["Current fuel is enough to reach destination without buying fuel."],
            **base,
        )

    stops = priced_route_stops(route, route_miles)
    stops = strategy_candidate_stops(stops, route_miles, price_target, payload.sort_by, current_fuel, tank_capacity, mpg)
    if not stops:
        return FuelStrategy(status="unreachable", warnings=warnings + ["No published Auto Diesel stops were found on this route."], **base)

    best_strategy: FuelStrategy | None = None
    best_key: tuple | None = None
    for sequence in strategy_stop_sequences(stops):
        strategy = simulate_fuel_sequence(route, stops, sequence, current_fuel, tank_capacity, mpg, route_miles, price_target, origin, destination, warnings)
        if strategy and strategy.status in {"planned", "direct"} and strategy.stop_count <= MAX_SMART_FUEL_STOPS:
            strategy_key = strategy_rank_key(strategy, price_target, payload.sort_by)
            if best_key is None or strategy_key < best_key:
                best_strategy = strategy
                best_key = strategy_key

    if best_strategy is not None:
        return best_strategy

    unreachable_warnings = warnings + [
        f"No safe Auto Diesel plan could be completed within {MAX_SMART_FUEL_STOPS} stops. Increase starting fuel, tank capacity, or choose a route with closer priced stops."
    ]
    if price_target is not None:
        unreachable_warnings.append(
            f"Smart price target ${price_target:.3f}/gal was kept as a planning preference, but there still was no safe route plan with the current truck range."
        )

    return FuelStrategy(
        status="unreachable",
        warnings=unreachable_warnings,
        **base,
    )


def choose_best_fuel_strategy(payload: RouteAssistantRequest, origin: GeocodedPoint, destination: GeocodedPoint, routes: list[RouteOption]) -> FuelStrategy | None:
    if not routes:
        return None
    price_target = resolve_price_target(payload)
    strategies = [build_route_fuel_strategy(route, payload, origin, destination) for route in routes]
    feasible = [strategy for strategy in strategies if strategy.status in {"planned", "direct"}]
    if feasible:
        return min(feasible, key=lambda item: strategy_rank_key(item, price_target, payload.sort_by))
    return min(strategies, key=lambda item: strategy_rank_key(item, price_target, payload.sort_by) + (item.total_route_miles, item.route_label or ""))



def priority_live_price_candidates(route_contexts: list[RouteStationContext], sort_by: str = "", limit: int = 36) -> list:
    candidates = [item for context in route_contexts for item in context.shortlisted_stations]
    if strategy_prefers_low_price(sort_by):
        candidates.sort(key=lambda item: (
            stop_auto_diesel_price(item[0]) is None,
            stop_auto_diesel_price(item[0]) if stop_auto_diesel_price(item[0]) is not None else float("inf"),
            stop_detour_total_miles(item[0]),
            stop_route_miles(item[0]) if stop_route_miles(item[0]) is not None else float("inf"),
            item[0].brand,
            item[0].name,
        ))
    else:
        candidates.sort(key=lambda item: (
            -(item[0].overall_score or 0),
            item[0].off_route_miles if item[0].off_route_miles is not None else 9999,
            item[0].origin_miles if item[0].origin_miles is not None else 9999,
            item[0].brand,
            item[0].name,
        ))
    return candidates[:limit]


def point_payload(point: RoutePoint) -> dict:
    return {"lat": point.lat, "lon": point.lon}


def save_route_audit(
    db: Session,
    current_user: User,
    payload: RouteAssistantRequest,
    origin: GeocodedPoint,
    destination: GeocodedPoint,
    routes: list[RouteOption],
    top_fuel_stops: list[FuelStop],
    selected_stop: FuelStop | None,
    fuel_strategy: FuelStrategy | None,
    assistant_message: str,
    price_support: str,
    map_link: str,
    station_map_link: str | None,
    data_source: str,
) -> RoutingRequest:
    top_stop_ids = {stop.id for stop in top_fuel_stops}
    selected_stop_id = selected_stop.id if selected_stop else None
    request_record = RoutingRequest(
        user_id=current_user.id,
        origin_query=payload.origin,
        destination_query=payload.destination,
        vehicle_type=payload.vehicle_type,
        fuel_type=payload.fuel_type,
        sort_by=payload.sort_by,
        origin_label=origin.label,
        origin_lat=origin.lat,
        origin_lon=origin.lon,
        destination_label=destination.label,
        destination_lat=destination.lat,
        destination_lon=destination.lon,
        map_link=map_link,
        station_map_link=station_map_link,
        data_source=data_source,
        price_support=price_support,
        assistant_message=assistant_message,
        selected_stop_id=selected_stop_id,
        raw_request=payload.model_dump(),
        response_summary={
            "route_count": len(routes),
            "top_fuel_stop_count": len(top_fuel_stops),
            "selected_stop_id": selected_stop_id,
            "fuel_strategy": fuel_strategy.model_dump() if fuel_strategy else None,
        },
    )
    db.add(request_record)
    db.flush()

    for route in routes:
        db.add(RoutingRoute(
            routing_request_id=request_record.id,
            route_id=route.id,
            label=route.label,
            distance_meters=route.distance_meters,
            travel_time_seconds=route.travel_time_seconds,
            traffic_delay_seconds=route.traffic_delay_seconds,
            fuel_stop_count=len(route.fuel_stops),
            points=[point_payload(point) for point in route.points],
        ))

        for stop_rank, stop in enumerate(route.fuel_stops[:AUDIT_ROUTE_STOP_LIMIT], start=1):
            db.add(RoutingFuelStop(
                routing_request_id=request_record.id,
                route_id=route.id,
                route_label=route.label,
                stop_rank=stop_rank,
                stop_id=stop.id,
                is_top_stop=stop.id in top_stop_ids,
                is_selected=stop.id == selected_stop_id,
                name=stop.name or "",
                brand=stop.brand or "",
                city=stop.city or "",
                address=stop.address or "",
                state_code=stop.state_code,
                postal_code=stop.postal_code,
                lat=stop.lat,
                lon=stop.lon,
                detour_distance_meters=stop.detour_distance_meters,
                detour_time_seconds=stop.detour_time_seconds,
                origin_miles=stop.origin_miles,
                off_route_miles=stop.off_route_miles,
                price=stop.price,
                price_less_tax=stop.price_less_tax,
                price_source=stop.price_source,
                price_date=stop.price_date,
                diesel_price=stop.diesel_price,
                auto_diesel_price=stop.auto_diesel_price,
                unleaded_price=stop.unleaded_price,
                parking_spaces=stop.parking_spaces,
                phone=stop.phone,
                fax=stop.fax,
                store_number=stop.store_number,
                highway=stop.highway,
                exit_number=stop.exit_number,
                amenity_score=stop.amenity_score,
                overall_score=stop.overall_score,
                source_url=stop.source_url,
                fuel_types=stop.fuel_types or [],
                amenities=stop.amenities or [],
                location_type=stop.location_type,
                official_match=stop.official_match,
            ))

    db.commit()
    db.refresh(request_record)
    return request_record

def build_unitedlane_message(
    origin: GeocodedPoint,
    destination: GeocodedPoint,
    stop: FuelStop | None,
    fuel_type: str,
    station_map_link: str | None,
    fuel_strategy: FuelStrategy | None = None,
) -> str:
    if fuel_strategy and fuel_strategy.status == "direct":
        return (
            f"Hello, this is {UNITEDLANE_IDENTITY}, your AI route and fuel assistant. "
            f"Your current fuel plan shows enough range to travel from {origin.label} to {destination.label} without buying {fuel_type.lower()} on this trip. "
            "Keep the live route open, stay with the planned path, and continue monitoring fuel level, traffic, and any operating changes while en route."
        )
    if not stop or not station_map_link:
        return (
            f"Hello, this is {UNITEDLANE_IDENTITY}, your AI route and fuel assistant. "
            f"I could map your trip from {origin.label} to {destination.label}, but I could not confirm a nearby Love's or Pilot Flying J stop on this pass. "
            "Please keep the live route open and try a nearby city, highway exit, or a wider search so I can guide you more precisely."
        )
    return generate_unitedlane_route_guidance(
        origin_label=origin.label,
        destination_label=destination.label,
        station_name=stop.name or stop.brand,
        station_address=stop.address,
        fuel_type=fuel_type,
        price_text=format_price_text(stop, fuel_type),
        off_route_miles=stop.off_route_miles,
        detour_time_minutes=minutes_from_seconds(stop.detour_time_seconds),
        map_link=station_map_link,
    )



def route_history_raw_request(record: RoutingRequest) -> dict:
    raw_request = record.raw_request or {}
    if isinstance(raw_request, dict):
        return raw_request
    if isinstance(raw_request, str):
        try:
            parsed = json.loads(raw_request)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def route_history_summary(record: RoutingRequest) -> dict:
    summary = record.response_summary or {}
    if isinstance(summary, dict):
        return summary
    if isinstance(summary, str):
        try:
            parsed = json.loads(summary)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def optional_float(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def optional_int(value) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def route_history_stop_model(stop: RoutingFuelStop) -> RouteHistoryFuelStop:
    return RouteHistoryFuelStop(
        id=stop.id,
        stop_id=stop.stop_id,
        route_id=stop.route_id,
        route_label=stop.route_label,
        stop_rank=stop.stop_rank,
        is_top_stop=stop.is_top_stop,
        is_selected=stop.is_selected,
        name=stop.name,
        brand=stop.brand,
        city=stop.city,
        address=stop.address,
        state_code=stop.state_code,
        lat=stop.lat,
        lon=stop.lon,
        off_route_miles=stop.off_route_miles,
        auto_diesel_price=stop.auto_diesel_price,
        diesel_price=stop.diesel_price,
        price=stop.price,
        price_date=stop.price_date,
        source_url=stop.source_url,
    )


def route_history_route_model(route: RoutingRoute) -> RouteHistoryRoute:
    return RouteHistoryRoute(
        id=route.id,
        route_id=route.route_id,
        label=route.label,
        distance_meters=route.distance_meters,
        travel_time_seconds=route.travel_time_seconds,
        traffic_delay_seconds=route.traffic_delay_seconds,
        fuel_stop_count=route.fuel_stop_count,
    )


def route_history_search_blob(record: RoutingRequest, user: User, raw_request: dict) -> str:
    created_at = record.created_at
    date_text = created_at.strftime("%Y-%m-%d") if isinstance(created_at, datetime) else ""
    parts = [
        record.origin_query,
        record.destination_query,
        record.origin_label,
        record.destination_label,
        record.vehicle_type,
        record.fuel_type,
        record.sort_by,
        raw_request.get("driver_name"),
        raw_request.get("driver"),
        raw_request.get("vehicle_number"),
        raw_request.get("truck"),
        raw_request.get("vehicle_id"),
        user.full_name,
        user.email,
        user.username,
        user.department,
        date_text,
        str(created_at or ""),
    ]
    return " ".join(str(part or "").casefold() for part in parts)


def build_route_history_item(
    record: RoutingRequest,
    user: User,
    route_rows: list[RoutingRoute],
    stop_rows: list[RoutingFuelStop],
    include_email: bool = False,
) -> RouteHistoryItem:
    raw_request = route_history_raw_request(record)
    summary = route_history_summary(record)
    selected_stop_row = next((stop for stop in stop_rows if stop.is_selected), None)
    if not selected_stop_row and record.selected_stop_id:
        selected_stop_row = next((stop for stop in stop_rows if stop.stop_id == record.selected_stop_id), None)
    highlighted_stop_rows = [stop for stop in stop_rows if stop.is_selected or stop.is_top_stop]
    highlighted_stop_rows.sort(key=lambda stop: (not stop.is_selected, stop.route_label or "", stop.stop_rank, stop.id))

    return RouteHistoryItem(
        id=record.id,
        created_at=record.created_at,
        status=record.status,
        user=RouteHistoryUser(
            id=user.id,
            full_name=user.full_name,
            email=user.email if include_email else "",
            username=user.username,
            department=user.department,
        ),
        origin_query=record.origin_query,
        destination_query=record.destination_query,
        origin_label=record.origin_label,
        destination_label=record.destination_label,
        vehicle_id=optional_int(raw_request.get("vehicle_id")),
        vehicle_number=str(raw_request.get("vehicle_number") or raw_request.get("truck") or ""),
        driver_name=str(raw_request.get("driver_name") or raw_request.get("driver") or ""),
        vehicle_type=record.vehicle_type,
        fuel_type=record.fuel_type,
        sort_by=record.sort_by,
        current_fuel_gallons=optional_float(raw_request.get("current_fuel_gallons")),
        tank_capacity_gallons=optional_float(raw_request.get("tank_capacity_gallons")),
        mpg=optional_float(raw_request.get("mpg")),
        map_link=record.map_link,
        station_map_link=record.station_map_link,
        data_source=record.data_source,
        price_support=record.price_support,
        assistant_message=record.assistant_message,
        selected_stop_id=record.selected_stop_id,
        route_count=int(summary.get("route_count") or len(route_rows)),
        top_fuel_stop_count=int(summary.get("top_fuel_stop_count") or len(highlighted_stop_rows)),
        routes=[route_history_route_model(route) for route in route_rows],
        top_fuel_stops=[route_history_stop_model(stop) for stop in highlighted_stop_rows[:12]],
        selected_stop=route_history_stop_model(selected_stop_row) if selected_stop_row else None,
        fuel_strategy=summary.get("fuel_strategy") if isinstance(summary.get("fuel_strategy"), dict) else None,
    )


@router.get("/route-history", response_model=RouteHistoryResponse)
def route_history(
    search: str = Query(default="", max_length=255),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    limit: int = Query(default=250, ge=1, le=500),
    current_user: User = Depends(require_user_department("fuel")),
    db: Session = Depends(get_db),
):
    statement = select(RoutingRequest, User).join(User, RoutingRequest.user_id == User.id)
    if not is_admin(current_user):
        statement = statement.where(RoutingRequest.user_id == current_user.id)
    if date_from:
        statement = statement.where(RoutingRequest.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        statement = statement.where(RoutingRequest.created_at <= datetime.combine(date_to, time.max))
    rows = db.execute(statement.order_by(RoutingRequest.created_at.desc(), RoutingRequest.id.desc())).all()
    request_ids = [record.id for record, _user in rows]

    routes_by_request: dict[int, list[RoutingRoute]] = {}
    stops_by_request: dict[int, list[RoutingFuelStop]] = {}
    if request_ids:
        route_records = db.scalars(
            select(RoutingRoute)
            .where(RoutingRoute.routing_request_id.in_(request_ids))
            .order_by(RoutingRoute.routing_request_id.desc(), RoutingRoute.id.asc())
        ).all()
        stop_records = db.scalars(
            select(RoutingFuelStop)
            .where(RoutingFuelStop.routing_request_id.in_(request_ids))
            .order_by(RoutingFuelStop.routing_request_id.desc(), RoutingFuelStop.is_selected.desc(), RoutingFuelStop.is_top_stop.desc(), RoutingFuelStop.route_label.asc(), RoutingFuelStop.stop_rank.asc(), RoutingFuelStop.id.asc())
        ).all()
        for route in route_records:
            routes_by_request.setdefault(route.routing_request_id, []).append(route)
        for stop in stop_records:
            stops_by_request.setdefault(stop.routing_request_id, []).append(stop)

    normalized_search = search.strip().casefold()
    matched_items: list[RouteHistoryItem] = []
    for record, owner in rows:
        raw_request = route_history_raw_request(record)
        if normalized_search and normalized_search not in route_history_search_blob(record, owner, raw_request):
            continue
        matched_items.append(build_route_history_item(
            record=record,
            user=owner,
            route_rows=routes_by_request.get(record.id, []),
            stop_rows=stops_by_request.get(record.id, []),
            include_email=is_admin(current_user),
        ))

    return RouteHistoryResponse(total=len(matched_items), returned=min(len(matched_items), limit), items=matched_items[:limit])

@router.get("/location-suggestions", response_model=LocationSuggestionResponse)
def location_suggestions(
    q: str = Query(min_length=2, max_length=255),
    limit: int = Query(default=6, ge=1, le=8),
    current_user: User = Depends(require_user_department("fuel", "driver")),
):
    return LocationSuggestionResponse(query=q, suggestions=search_location_suggestions(q, limit=limit))


@router.get("/tomtom-capabilities", response_model=TomTomCapabilityCatalog)
def tomtom_capabilities(current_user: User = Depends(require_user_department("fuel", "driver"))):
    live = sum(1 for item in TOMTOM_CAPABILITIES if item.status == "Live")
    ready = sum(1 for item in TOMTOM_CAPABILITIES if item.status == "Ready")
    requires_access = sum(1 for item in TOMTOM_CAPABILITIES if item.status == "Requires Access")
    return TomTomCapabilityCatalog(total=len(TOMTOM_CAPABILITIES), live=live, ready=ready, requires_access=requires_access, capabilities=TOMTOM_CAPABILITIES)


@router.post("/route-assistant", response_model=RouteAssistantResponse)
def route_assistant(payload: RouteAssistantRequest, current_user: User = Depends(require_user_department("fuel", "driver")), db: Session = Depends(get_db)):
    if not settings.tomtom_api_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="TOMTOM_API_KEY is missing on the backend")

    origin = geocode_address(payload.origin)
    destination = geocode_address(payload.destination)
    raw_routes = get_routes(origin, destination, payload.vehicle_type)
    if not raw_routes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No route alternatives found")

    route_items = list(enumerate(raw_routes[:3], start=1))
    with ThreadPoolExecutor(max_workers=min(3, len(route_items) or 1)) as executor:
        route_contexts = list(executor.map(lambda item: build_route_station_context(item[0], item[1], payload.fuel_type), route_items))

    def refine_context_detours(context: RouteStationContext):
        refine_shortlisted_detours(context.shortlisted_stations, context.routing_points, payload.vehicle_type)
        return context

    with ThreadPoolExecutor(max_workers=min(3, len(route_contexts) or 1)) as executor:
        route_contexts = list(executor.map(refine_context_detours, route_contexts))

    priority_price_candidates = priority_live_price_candidates(route_contexts, payload.sort_by)
    refresh_shortlisted_live_prices(priority_price_candidates, payload.fuel_type)
    refresh_shortlisted_live_prices(
        [item for context in route_contexts for item in context.shortlisted_stations],
        payload.fuel_type,
        blocking_limit=0,
        timeout_seconds=0,
    )

    routes: list[RouteOption] = []
    combined_stops: dict[str, FuelStop] = {}
    for context in route_contexts:
        fuel_stops = sort_stops(finalize_shortlisted_official_stations(context.shortlisted_stations), payload.sort_by)
        for stop in fuel_stops:
            merge_stop(combined_stops, stop)
        routes.append(RouteOption(
            id=f"route-{context.index}",
            label=f"Option {context.index}",
            distance_meters=int(context.summary.get("lengthInMeters", 0)),
            travel_time_seconds=int(context.summary.get("travelTimeInSeconds", 0)),
            traffic_delay_seconds=int(context.summary.get("trafficDelayInSeconds", 0)),
            points=context.route_points,
            fuel_stops=fuel_stops,
        ))

    top_fuel_stops = sort_stops(list(combined_stops.values()), payload.sort_by)[:24]
    fuel_strategy = choose_best_fuel_strategy(payload, origin, destination, routes)
    if fuel_strategy and fuel_strategy.status == "planned" and fuel_strategy.stops:
        selected_stop = fuel_strategy.stops[0].stop
    elif fuel_strategy and fuel_strategy.status == "direct":
        selected_stop = None
    else:
        selected_stop = top_fuel_stops[0] if top_fuel_stops else None
    station_map_link = build_station_map_link(origin, selected_stop) if selected_stop else None
    assistant_message = build_unitedlane_message(
        origin,
        destination,
        selected_stop,
        payload.fuel_type,
        station_map_link,
        fuel_strategy=fuel_strategy,
    )
    price_support = "UnitedLane uses the cached official Love's/Pilot station catalog for fast routing, then refreshes live official fuel prices for priority route stops within a short time budget and queues the rest in the background."
    if payload.price_target:
        price_support += f" Smart routing also tries to stay at or below ${payload.price_target:.3f}/gal and only goes above that target when the route cannot be completed safely or efficiently otherwise."
    map_link = build_map_link(origin.label, destination.label)
    data_source = "TomTom routing + parsed official Love's/Pilot station catalog + UnitedLane guidance"
    try:
        route_audit = save_route_audit(
            db=db,
            current_user=current_user,
            payload=payload,
            origin=origin,
            destination=destination,
            routes=routes,
            top_fuel_stops=top_fuel_stops,
            selected_stop=selected_stop,
            fuel_strategy=fuel_strategy,
            assistant_message=assistant_message,
            price_support=price_support,
            map_link=map_link,
            station_map_link=station_map_link,
            data_source=data_source,
        )
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Route was calculated, but database logging failed") from exc

    return RouteAssistantResponse(
        routing_request_id=route_audit.id,
        origin=origin,
        destination=destination,
        routes=routes,
        top_fuel_stops=top_fuel_stops,
        selected_stop=selected_stop,
        fuel_strategy=fuel_strategy,
        assistant_name=UNITEDLANE_IDENTITY,
        assistant_message=assistant_message,
        price_support=price_support,
        map_link=map_link,
        station_map_link=station_map_link,
        data_source=data_source,
    )

@router.post("/assistant-chat", response_model=UnitedLaneChatResponse)
def assistant_chat(payload: UnitedLaneChatRequest, current_user: User = Depends(require_user_department("safety"))):
    try:
        reply = generate_unitedlane_chat_reply(
            message=payload.message,
            context=payload.context,
            image_data_url=payload.image_data_url,
            image_name=payload.image_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except UnitedLaneChatProviderError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return UnitedLaneChatResponse(assistant_name=UNITEDLANE_CHAT_IDENTITY, message=reply)

