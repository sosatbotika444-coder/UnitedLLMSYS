import json
import math
import re
import ssl
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from functools import lru_cache
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import certifi
from fastapi import APIRouter, Depends, HTTPException, status

from app.ai_settings import UNITEDLANE_IDENTITY, generate_unitedlane_chat_reply, generate_unitedlane_route_guidance
from app.auth import get_current_user
from app.config import get_settings
from app.models import User
from app.schemas import (
    ApiCapability,
    FuelStop,
    GeocodedPoint,
    RouteAssistantRequest,
    RouteAssistantResponse,
    RouteOption,
    RoutePoint,
    TomTomCapabilityCatalog,
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
MAX_LOVES_CITY_CANDIDATES = 6
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
    for entry in extract_jsonld_objects(html):
        address = entry.get("address")
        if isinstance(address, dict) and address.get("streetAddress"):
            street = address.get("streetAddress", "")
            city = address.get("addressLocality", "")
            state = address.get("addressRegion", "")
            postal_code = address.get("postalCode", "")
            break

    if not street:
        street_match = re.search(r'"streetAddress"\s*:\s*"([^"]+)"', html)
        city_match = re.search(r'"addressLocality"\s*:\s*"([^"]+)"', html)
        state_match = re.search(r'"addressRegion"\s*:\s*"([^"]+)"', html)
        postal_match = re.search(r'"postalCode"\s*:\s*"([^"]+)"', html)
        street = street_match.group(1) if street_match else ""
        city = city_match.group(1) if city_match else ""
        state = state_match.group(1) if state_match else ""
        postal_code = postal_match.group(1) if postal_match else ""

    prices: dict[str, float] = {}
    for base_value, superscript_digit, label in re.findall(r'<h3>\$(\d+\.\d+)<sup>(\d)</sup></h3><span>\s*([^<]+?)\s*</span>', html, re.I):
        prices[normalize_text(label)] = parse_sup_price(base_value, superscript_digit)

    diesel_time_match = re.search(r'"productName":"DIESEL".*?"lastCheckInDateTime":"([^"]+)"', html, re.S)
    if not diesel_time_match:
        diesel_time_match = re.search(r'"productName":"DIESEL".*?"lastPriceChangeDateTime":"([^"]+)"', html, re.S)

    return {
        "url": url,
        "html": html,
        "street": street,
        "city": city,
        "state": state,
        "postal_code": postal_code,
        "house_number": extract_house_number(street),
        "diesel_price": prices.get("diesel") or prices.get("auto diesel"),
        "diesel_time": diesel_time_match.group(1) if diesel_time_match else None,
        "auto_diesel_price": prices.get("auto diesel"),
        "unleaded_price": prices.get("unleaded"),
    }


def select_loves_candidate(stop: FuelStop) -> dict | None:
    if not stop.city or not stop.state_code:
        return None

    target_city = normalize_text(stop.city)
    target_state = (stop.state_code or "").upper()
    street_line = normalize_text(extract_street_line(stop.address))
    house_number = extract_house_number(stop.address)

    candidates = [entry["url"] for entry in load_loves_location_index() if entry["state"] == target_state and entry["city"] == target_city]
    if not candidates and target_city:
        candidates = [entry["url"] for entry in load_loves_location_index() if entry["state"] == target_state and target_city.replace(" ", "-") in entry["url"]]
    if not candidates:
        return None

    best_match = None
    best_score = -1
    for url in candidates[:MAX_LOVES_CITY_CANDIDATES]:
        summary = load_loves_page_summary(url)
        if not summary:
            continue
        score = 0
        if normalize_text(summary.get("city", "")) == target_city:
            score += 24
        if (summary.get("state") or "").upper() == target_state:
            score += 18
        summary_house_number = summary.get("house_number")
        if house_number and summary_house_number and house_number == summary_house_number:
            score += 42
        summary_street = normalize_text(summary.get("street", ""))
        if street_line and summary_street:
            score += int(SequenceMatcher(None, street_line, summary_street).ratio() * 36)
        if score > best_score:
            best_match = summary
            best_score = score
    return best_match if best_score >= 40 else None


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


def resolve_pilot_official_url(stop: FuelStop) -> str | None:
    if not stop.state_code or not stop.city or not stop.address:
        return None
    street_line = extract_street_line(stop.address)
    if not street_line:
        return None
    candidate = f"https://locations.pilotflyingj.com/us/{slugify_segment(stop.state_code)}/{slugify_segment(stop.city)}/{slugify_segment(street_line)}"
    html = fetch_official_page(candidate)
    if not html:
        return None
    street_match = re.search(r'itemprop="streetAddress"\s+content="([^"]+)"', html)
    city_match = re.search(r'itemprop="addressLocality"\s+content="([^"]+)"', html)
    state_match = re.search(r'itemprop="addressRegion">?([A-Z]{2})', html)
    candidate_street = street_match.group(1) if street_match else ""
    candidate_city = city_match.group(1) if city_match else ""
    candidate_state = state_match.group(1) if state_match else (stop.state_code or "")
    if normalize_text(candidate_city) != normalize_text(stop.city):
        return None
    if (candidate_state or "").upper() != (stop.state_code or "").upper():
        return None
    if address_consistency_score(candidate_street, extract_street_line(stop.address)) < 55:
        return None
    return candidate


def enrich_loves_stop(stop: FuelStop) -> FuelStop:
    match = select_loves_candidate(stop)
    if not match:
        stop.price_source = stop.price_source or "Love's official page match unavailable"
        return stop
    stop.source_url = match.get("url")
    if match.get("diesel_price") is not None:
        stop.price = match.get("diesel_price")
        stop.price_date = match.get("diesel_time")
        stop.price_source = "Love's official site"
        stop.overall_score = round((stop.overall_score or 0) + 10, 1)
    else:
        stop.price_source = "Love's official site (diesel price unavailable)"
    return stop


def enrich_pilot_stop(stop: FuelStop) -> FuelStop:
    official_url = resolve_pilot_official_url(stop)
    if not official_url:
        stop.price_source = stop.price_source or "Pilot Flying J official page match unavailable"
        return stop
    stop.source_url = official_url
    stop.price_source = "Pilot Flying J official site (diesel price not published)"
    return stop


def enrich_stop_with_official_site(stop: FuelStop) -> FuelStop:
    haystack = normalize_text(f"{stop.brand} {stop.name}")
    if "love" in haystack:
        return enrich_loves_stop(stop)
    if "pilot" in haystack or "flying j" in haystack:
        return enrich_pilot_stop(stop)
    return stop


def enrich_stops_with_official_sites(stops: list[FuelStop]) -> list[FuelStop]:
    if not stops:
        return []
    max_workers = min(8, len(stops))
    if max_workers <= 1:
        return [enrich_stop_with_official_site(stop) for stop in stops]
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        return list(executor.map(enrich_stop_with_official_site, stops))


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


def get_routes(origin: GeocodedPoint, destination: GeocodedPoint, vehicle_type: str):
    route_points = f"{origin.lat},{origin.lon}:{destination.lat},{destination.lon}"
    params = urlencode({
        "key": settings.tomtom_api_key,
        "maxAlternatives": 2,
        "routeRepresentation": "polyline",
        "computeTravelTimeFor": "all",
        "travelMode": "truck" if vehicle_type.lower() == "truck" else "car",
    })
    return http_json(f"https://api.tomtom.com/routing/1/calculateRoute/{route_points}/json?{params}").get("routes", [])


def to_route_points(route: dict) -> list[RoutePoint]:
    points: list[RoutePoint] = []
    for leg in route.get("legs", []):
        for point in leg.get("points", []):
            points.append(RoutePoint(lat=point.get("latitude"), lon=point.get("longitude")))
    if len(points) <= 220:
        return points
    step = max(1, len(points) // 220)
    sampled = points[::step]
    if sampled[-1] != points[-1]:
        sampled.append(points[-1])
    return sampled


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
        price_source="TomTom Brand Search",
        amenity_score=keyword_score(matched_keyword),
        overall_score=0,
        source_url=None,
    )
    stop.off_route_miles = round((stop.detour_distance_meters or 0) * 0.000621371, 1) if stop.detour_distance_meters is not None else None
    stop.overall_score = round((stop.amenity_score or 0) * 0.65 + max(0, 34 - (stop.off_route_miles or 0)), 1)
    return stop


def merge_stop(stops_by_id: dict[str, FuelStop], stop: FuelStop):
    existing = stops_by_id.get(stop.id)
    if not existing:
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


def build_unitedlane_message(origin: GeocodedPoint, destination: GeocodedPoint, stop: FuelStop | None, fuel_type: str, station_map_link: str | None) -> str:
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


@router.get("/tomtom-capabilities", response_model=TomTomCapabilityCatalog)
def tomtom_capabilities(current_user: User = Depends(get_current_user)):
    live = sum(1 for item in TOMTOM_CAPABILITIES if item.status == "Live")
    ready = sum(1 for item in TOMTOM_CAPABILITIES if item.status == "Ready")
    requires_access = sum(1 for item in TOMTOM_CAPABILITIES if item.status == "Requires Access")
    return TomTomCapabilityCatalog(total=len(TOMTOM_CAPABILITIES), live=live, ready=ready, requires_access=requires_access, capabilities=TOMTOM_CAPABILITIES)


@router.post("/route-assistant", response_model=RouteAssistantResponse)
def route_assistant(payload: RouteAssistantRequest, current_user: User = Depends(get_current_user)):
    if not settings.tomtom_api_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="TOMTOM_API_KEY is missing on the backend")

    origin = geocode_address(payload.origin)
    destination = geocode_address(payload.destination)
    raw_routes = get_routes(origin, destination, payload.vehicle_type)
    if not raw_routes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No route alternatives found")

    routes: list[RouteOption] = []
    combined_stops: dict[str, FuelStop] = {}
    for index, route in enumerate(raw_routes[:3], start=1):
        summary = route.get("summary", {})
        route_points = to_route_points(route)
        fuel_stops = sort_stops(search_tomtom_brand_stops(route_points), payload.sort_by)
        for stop in fuel_stops:
            merge_stop(combined_stops, stop)
        routes.append(RouteOption(
            id=f"route-{index}",
            label=f"Option {index}",
            distance_meters=int(summary.get("lengthInMeters", 0)),
            travel_time_seconds=int(summary.get("travelTimeInSeconds", 0)),
            traffic_delay_seconds=int(summary.get("trafficDelayInSeconds", 0)),
            points=route_points,
            fuel_stops=fuel_stops,
        ))

    top_fuel_stops = sort_stops(list(combined_stops.values()), payload.sort_by)[:24]
    selected_stop = top_fuel_stops[0] if top_fuel_stops else None
    station_map_link = build_station_map_link(origin, selected_stop) if selected_stop else None
    assistant_message = build_unitedlane_message(origin, destination, selected_stop, payload.fuel_type, station_map_link)
    price_support = "UnitedLane picks the strongest nearby Love's or Pilot Flying J stop, shows any official price we can confirm, and explains the drive in polite English. Use the live map for the final live turns into the station."
    return RouteAssistantResponse(
        origin=origin,
        destination=destination,
        routes=routes,
        top_fuel_stops=top_fuel_stops,
        selected_stop=selected_stop,
        assistant_name=UNITEDLANE_IDENTITY,
        assistant_message=assistant_message,
        price_support=price_support,
        map_link=build_map_link(origin.label, destination.label),
        station_map_link=station_map_link,
        data_source="TomTom + Official Network Pages + UnitedLane Guidance",
    )

@router.post("/assistant-chat", response_model=UnitedLaneChatResponse)
def assistant_chat(payload: UnitedLaneChatRequest, current_user: User = Depends(get_current_user)):
    reply = generate_unitedlane_chat_reply(message=payload.message, context=payload.context)
    return UnitedLaneChatResponse(assistant_name=UNITEDLANE_IDENTITY, message=reply)
