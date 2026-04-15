from __future__ import annotations

import json
import math
import re
import ssl
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from queue import Empty, Full, Queue
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import certifi

from app.config import get_settings
from app.schemas import FuelStop, RoutePoint

settings = get_settings()
ssl_context = ssl.create_default_context(cafile=certifi.where())

OFFICIAL_SITE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}
LOVES_LOCATIONS_URL = "https://www.loves.com/locations"
LOVES_SITEMAP_URL = "https://www.loves.com/sitemap-locations.xml"
PILOT_LOCATIONS_URL = "https://locations.pilotflyingj.com/"
PILOT_SITEMAP_URL = "https://locations.pilotflyingj.com/sitemap.xml"
PILOT_LAMBDA_PROXY_URL = "https://ogc8wzyh57.execute-api.us-east-1.amazonaws.com/prod/get"
PILOT_FUEL_API_ROOT = "https://api.cp.pilotflyingj.com/pfj-loyaltymkt-yext-e/api/v1/site"
CATALOG_VERSION = 1
CATALOG_MAX_AGE = timedelta(days=7)
CATALOG_WORKERS = 18
DEFAULT_ROUTE_CORRIDOR_MILES = 35.0
SHORTLISTED_ROUTE_STATION_LIMIT = 80
ROUTE_REFINE_LIMIT = 12
LIVE_PRICE_REFRESH_WORKERS = 12
LIVE_PRICE_ROUTE_ENQUEUE_LIMIT = 48
ROUTE_REFINE_WORKERS = 4
ROUTE_DETOUR_TIMEOUT_SECONDS = 6.0
EARTH_RADIUS_M = 6371000.0
CATALOG_PATH = Path(__file__).resolve().parent / "data" / "official_station_catalog.json"
LIVE_PRICE_CACHE_VERSION = 1
LIVE_PRICE_CACHE_PATH = Path(__file__).resolve().parent / "data" / "live_price_cache.json"
LIVE_PRICE_CACHE_LOCK = threading.Lock()
LIVE_PRICE_CACHE: dict[str, dict] = {}
LIVE_PRICE_CACHE_LOADED = False
LIVE_PRICE_CACHE_DIRTY = False
LIVE_PRICE_CACHE_LAST_PERSIST = 0.0
LIVE_PRICE_TASK_QUEUE: Queue[tuple[str, dict] | None] = Queue(maxsize=max(256, settings.live_price_queue_max_size))
LIVE_PRICE_INFLIGHT: set[str] = set()
LIVE_PRICE_INFLIGHT_LOCK = threading.Lock()
LIVE_PRICE_RUNTIME_LOCK = threading.Lock()
LIVE_PRICE_WORKER_STOP = threading.Event()
LIVE_PRICE_WORKERS: list[threading.Thread] = []
LIVE_PRICE_RUNTIME = {
    "started": False,
    "enqueued": 0,
    "processed": 0,
    "errors": 0,
    "dropped": 0,
    "last_success_at": None,
    "last_error_at": None,
}
ShortlistedOfficialStation = tuple[FuelStop, dict, int]

def safe_http_request(url: str, headers: dict | None = None, timeout_seconds: float = 30.0) -> str | None:
    request = Request(url, headers=headers or OFFICIAL_SITE_HEADERS)
    try:
        with urlopen(request, timeout=timeout_seconds, context=ssl_context) as response:
            return response.read().decode("utf-8", errors="replace")
    except Exception:
        return None



def http_json(url: str, headers: dict | None = None, timeout_seconds: float = 30.0):
    request = Request(url, headers=headers or OFFICIAL_SITE_HEADERS)
    with urlopen(request, timeout=timeout_seconds, context=ssl_context) as response:
        return json.loads(response.read().decode("utf-8", errors="replace"))






def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()



def unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = re.sub(r"\s+", " ", (value or "")).strip()
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
    return result



def fuel_label_key(value: str) -> str:
    return normalize_text(value).replace(" ", "")



def choose_fuel_price(price_map: dict[str, float | None], fuel_type: str) -> float | None:
    normalized = normalize_text(fuel_type)
    if "unleaded" in normalized or "gas" in normalized:
        return price_map.get("unleaded")
    if "diesel" in normalized:
        return price_map.get("auto_diesel")
    return price_map.get("auto_diesel") or price_map.get("unleaded")



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



def extract_next_data(html: str) -> dict:
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.I | re.S)
    if not match:
        return {}
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return {}



def extract_json_string(field_name: str, html: str) -> str | None:
    match = re.search(rf'"{re.escape(field_name)}":"((?:\\.|[^"])*)"', html, re.I | re.S)
    if not match:
        return None
    return json.loads(f'"{match.group(1)}"')



def extract_json_array(field_name: str, html: str) -> list:
    match = re.search(rf'"{re.escape(field_name)}":(\[[^<]*?\])(?:,|\}})', html, re.I | re.S)
    if not match:
        return []
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return []



def guess_restaurant_name(icon_path: str | None) -> str | None:
    if not icon_path:
        return None
    slug = Path(icon_path).stem
    slug = re.sub(r"\d+$", "", slug)
    slug = slug.replace("-", " ").replace("_", " ").strip()
    if not slug:
        return None
    words = [word.capitalize() for word in slug.split()]
    return " ".join(words) if words else None



def format_full_address(street: str, city: str, state_code: str, postal_code: str) -> str:
    locality = ", ".join(part for part in [city, state_code] if part)
    return ", ".join(part for part in [street, locality, postal_code] if part)



def parse_loves_prices(fuel_entries: list[dict]) -> dict[str, float | None]:
    diesel_price = None
    auto_diesel_price = None
    unleaded_price = None
    for entry in fuel_entries or []:
        fuel_name = normalize_text(str(entry.get("fuelType") or entry.get("displayName") or entry.get("productName") or ""))
        cash_price = entry.get("cashPrice")
        if cash_price is None:
            continue
        price_value = float(cash_price)
        if "auto diesel" in fuel_name and auto_diesel_price is None:
            auto_diesel_price = price_value
        elif fuel_name == "diesel" or ("diesel" in fuel_name and "auto" not in fuel_name and diesel_price is None):
            diesel_price = price_value
        elif "unleaded" in fuel_name and unleaded_price is None:
            unleaded_price = price_value
    return {
        "diesel_price": diesel_price,
        "auto_diesel_price": auto_diesel_price,
        "unleaded_price": unleaded_price,
    }



@lru_cache(maxsize=2048)
def parse_loves_page(url: str) -> dict | None:
    html = safe_http_request(url)
    if not html:
        return None

    next_data = extract_next_data(html)
    page_props = ((next_data.get("props") or {}).get("pageProps") or {})
    location_data = page_props.get("locationData") or {}
    mapped_custom_fields = location_data.get("mappedCustomFields") or {}
    jsonld_objects = extract_jsonld_objects(html)
    local_business = next((item for item in jsonld_objects if item.get("address") and item.get("geo")), {})
    geo = local_business.get("geo") or {}
    address = local_business.get("address") or {}

    store_number = str(location_data.get("storeNumber") or location_data.get("number") or "").strip()
    location_type = str(location_data.get("facilitySubtypeName") or "").strip() or "Travel Stop"
    name = f"Love's {location_type} #{store_number}" if store_number else f"Love's {location_type}"

    street = str(location_data.get("address") or address.get("streetAddress") or "").strip()
    city = str(location_data.get("city") or address.get("addressLocality") or "").strip()
    state_code = str(location_data.get("state") or address.get("addressRegion") or "").strip().upper()
    postal_code = str(location_data.get("zip") or address.get("postalCode") or "").strip()
    lat = location_data.get("latitude") or geo.get("latitude")
    lon = location_data.get("longitude") or geo.get("longitude")
    if lat is None or lon is None:
        return None

    amenity_names = [
        str(item.get("fieldName") or "")
        for item in mapped_custom_fields.get("amenities", [])
        if str(item.get("fieldValue") or "").lower() == "true"
    ]
    restaurant_names = [
        guess_restaurant_name(item.get("iconPath"))
        for item in mapped_custom_fields.get("restaurants", [])
    ]
    jsonld_amenities = [
        str(item.get("name") or "")
        for entry in jsonld_objects
        for item in (entry.get("amenityFeature") or [])
        if isinstance(item, dict) and item.get("value")
    ]
    amenities = unique_strings(amenity_names + restaurant_names + jsonld_amenities)

    prices = parse_loves_prices(location_data.get("fuelPrices") or [])
    diesel_time_match = re.search(r'"productName":"DIESEL".*?"lastCheckInDateTime":"([^"]+)"', html, re.S)
    if not diesel_time_match:
        diesel_time_match = re.search(r'"productName":"DIESEL".*?"lastPriceChangeDateTime":"([^"]+)"', html, re.S)

    fuel_types = unique_strings([
        str(item.get("fuelType") or item.get("displayName") or "")
        for item in (location_data.get("fuelPrices") or [])
    ])

    return {
        "id": f"loves:{store_number or url}",
        "brand": "Love's",
        "name": name,
        "location_type": location_type,
        "store_number": store_number or None,
        "source_url": url,
        "street": street,
        "city": city,
        "state_code": state_code,
        "postal_code": postal_code,
        "address": format_full_address(street, city, state_code, postal_code),
        "lat": float(lat),
        "lon": float(lon),
        "phone": str(location_data.get("mainPhone") or local_business.get("telephone") or "").strip() or None,
        "fax": str(location_data.get("fax") or "").strip() or None,
        "highway": str(location_data.get("highway") or "").strip() or None,
        "exit_number": str(location_data.get("exitNumber") or "").strip() or None,
        "amenities": amenities,
        "fuel_types": fuel_types,
        "parking_spaces": None,
        "diesel_price": prices.get("diesel_price"),
        "auto_diesel_price": prices.get("auto_diesel_price"),
        "unleaded_price": prices.get("unleaded_price"),
        "price_date": diesel_time_match.group(1) if diesel_time_match else None,
        "price_source": "Love's official site",
        "network_url": LOVES_LOCATIONS_URL,
    }



@lru_cache(maxsize=2048)
def parse_pilot_prices(site_id: str) -> dict[str, float | None]:
    request_url = f"{PILOT_FUEL_API_ROOT}/{site_id}/fuelPrices"
    proxy_url = f"{PILOT_LAMBDA_PROXY_URL}?{urlencode({'requestUrl': request_url})}"
    try:
        data = http_json(proxy_url)
    except Exception:
        return {
            "diesel_price": None,
            "auto_diesel_price": None,
            "unleaded_price": None,
            "fuel_types": [],
        }

    price_by_label: dict[str, float] = {}
    for item in data if isinstance(data, list) else []:
        description = str(item.get("description") or "").strip()
        price = item.get("price")
        if description and price is not None:
            price_by_label[description] = float(price)

    diesel_price = None
    for label in ["Diesel #2", "Diesel #1", "Marked Diesel", "Dyed Diesel #2"]:
        if label in price_by_label:
            diesel_price = price_by_label[label]
            break

    auto_diesel_price = price_by_label.get("Auto Diesel")
    unleaded_price = price_by_label.get("Unleaded")
    fuel_types = unique_strings(list(price_by_label.keys()))
    return {
        "diesel_price": diesel_price,
        "auto_diesel_price": auto_diesel_price,
        "unleaded_price": unleaded_price,
        "fuel_types": fuel_types,
    }



@lru_cache(maxsize=2048)
def parse_pilot_page(url: str) -> dict | None:
    html = safe_http_request(url)
    if not html:
        return None

    site_id_match = re.search(r'Yext\["cfID"\]\s*=\s*"([^"]+)"', html)
    site_id = site_id_match.group(1) if site_id_match else ""
    name = extract_json_string("c_pagesName", html) or "Pilot Flying J"
    street_match = re.search(r'<span class="c-address-street-1">([^<]+)</span>', html)
    city_match = re.search(r'<span class="c-address-city">([^<]+)</span>', html)
    state_match = re.search(r'itemprop="addressRegion">([A-Z]{2})<', html)
    postal_match = re.search(r'itemprop="postalCode">([^<]+)<', html)
    phone_match = re.search(r'id="phone-main">([^<]+)<', html)
    fax_match = re.search(r'id="phone-fax">([^<]+)<', html)
    coords_match = re.search(r'"yextDisplayCoordinate":\{"lat":([\-0-9.]+),"long":([\-0-9.]+)\}', html)
    if not coords_match:
        coords_match = re.search(r'itemprop="latitude"[^>]*content="([\-0-9.]+)".*?itemprop="longitude"[^>]*content="([\-0-9.]+)"', html, re.S)
    if not coords_match:
        return None

    location_type = None
    normalized_name = normalize_text(name)
    if "travel center" in normalized_name:
        location_type = "Travel Center"
    elif "one9" in normalized_name:
        location_type = "One9"
    elif "flying j" in normalized_name:
        location_type = "Flying J"
    else:
        location_type = "Truck Stop"

    amenities = extract_json_array("c_pagesAmenities", html)
    amenities_extra = extract_json_array("c_pagesAmenities1", html)
    restaurants = extract_json_array("c_pagesQSRList", html)
    public_parking = extract_json_string("c_pagesPublicParkingCount", html)
    prime_parking = extract_json_string("c_pagesPrimeParkingCount", html)
    showers_count = extract_json_string("c_pagesShowersCount", html)
    fuel_lane_count = extract_json_string("c_pagesFuelLaneCount", html)
    interstate = re.search(r'<span class="Text--bold">Interstate:</span>\s*([^<]+)', html)

    all_amenities = unique_strings((amenities if isinstance(amenities, list) else []) + (amenities_extra if isinstance(amenities_extra, list) else []) + (restaurants if isinstance(restaurants, list) else []))
    if public_parking:
        all_amenities.append(f"Public Parking {public_parking}")
    if prime_parking:
        all_amenities.append(f"Prime Parking {prime_parking}")
    if showers_count:
        all_amenities.append(f"Showers {showers_count}")
    if fuel_lane_count:
        all_amenities.append(f"Fuel Lanes {fuel_lane_count}")
    all_amenities = unique_strings(all_amenities)

    fuel_prices = parse_pilot_prices(site_id) if site_id else {
        "diesel_price": None,
        "auto_diesel_price": None,
        "unleaded_price": None,
        "fuel_types": [],
    }

    street = street_match.group(1).strip() if street_match else ""
    city = city_match.group(1).strip() if city_match else ""
    state_code = state_match.group(1).strip().upper() if state_match else ""
    postal_code = postal_match.group(1).strip() if postal_match else ""
    parking_spaces = None
    if public_parking or prime_parking:
        parking_spaces = " / ".join(part for part in [f"public {public_parking}" if public_parking else None, f"prime {prime_parking}" if prime_parking else None] if part)

    return {
        "id": f"pilot:{site_id or url}",
        "brand": "Pilot Flying J",
        "name": name,
        "location_type": location_type,
        "store_number": site_id or None,
        "site_id": site_id or None,
        "source_url": url,
        "street": street,
        "city": city,
        "state_code": state_code,
        "postal_code": postal_code,
        "address": format_full_address(street, city, state_code, postal_code),
        "lat": float(coords_match.group(1)),
        "lon": float(coords_match.group(2)),
        "phone": phone_match.group(1).strip() if phone_match else None,
        "fax": fax_match.group(1).strip() if fax_match else None,
        "highway": interstate.group(1).strip() if interstate else None,
        "exit_number": None,
        "amenities": all_amenities,
        "fuel_types": fuel_prices.get("fuel_types") or [],
        "parking_spaces": parking_spaces,
        "diesel_price": fuel_prices.get("diesel_price"),
        "auto_diesel_price": fuel_prices.get("auto_diesel_price"),
        "unleaded_price": fuel_prices.get("unleaded_price"),
        "price_date": None,
        "price_source": "Pilot official fuel API",
        "network_url": PILOT_LOCATIONS_URL,
    }



def is_truck_relevant(record: dict) -> bool:
    haystack = normalize_text(" ".join(record.get("amenities") or []))
    fuel_haystack = normalize_text(" ".join(record.get("fuel_types") or []))
    if "diesel" in fuel_haystack or "diesel" in haystack:
        return True
    if record.get("brand") == "Pilot Flying J":
        return True
    return record.get("brand") == "Love's"



@lru_cache(maxsize=1)
def load_loves_location_urls() -> list[str]:
    xml_text = safe_http_request(LOVES_SITEMAP_URL)
    if not xml_text:
        return []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [(node.text or "").strip() for node in root.findall(".//sm:loc", namespace)]
    return [url for url in urls if "/locations/" in url]



@lru_cache(maxsize=1)
def load_pilot_location_urls() -> list[str]:
    xml_text = safe_http_request(PILOT_SITEMAP_URL)
    if not xml_text:
        return []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = []
    for node in root.findall(".//sm:loc", namespace):
        url = (node.text or "").strip()
        if re.search(r"/us/[a-z]{2}/[^/]+/[^/?#]+$", url):
            urls.append(url)
    return urls



def build_station_catalog() -> list[dict]:
    records: list[dict] = []
    loves_urls = load_loves_location_urls()
    pilot_urls = load_pilot_location_urls()

    with ThreadPoolExecutor(max_workers=CATALOG_WORKERS) as executor:
        for item in executor.map(parse_loves_page, loves_urls):
            if item and is_truck_relevant(item):
                records.append(item)
        for item in executor.map(parse_pilot_page, pilot_urls):
            if item and is_truck_relevant(item):
                records.append(item)

    records.sort(key=lambda item: (item.get("brand", ""), item.get("state_code", ""), item.get("city", ""), item.get("name", "")))
    return records



def read_catalog_cache() -> list[dict] | None:
    if not CATALOG_PATH.exists():
        return None
    try:
        payload = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None

    if payload.get("version") != CATALOG_VERSION:
        return None
    generated_at_raw = payload.get("generated_at")
    if not generated_at_raw:
        return None
    try:
        generated_at = datetime.fromisoformat(generated_at_raw)
    except ValueError:
        return None
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - generated_at > CATALOG_MAX_AGE:
        return None

    stations = payload.get("stations")
    if not isinstance(stations, list):
        return None
    return stations



def write_catalog_cache(stations: list[dict]):
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": CATALOG_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stations": stations,
    }
    CATALOG_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")



@lru_cache(maxsize=1)
def get_official_station_catalog() -> list[dict]:
    cached = read_catalog_cache()
    if cached is not None:
        return cached
    stations = build_station_catalog()
    write_catalog_cache(stations)
    return stations



def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.atan2(math.sqrt(a), math.sqrt(1 - a))



def project_xy(lat: float, lon: float, ref_lat: float) -> tuple[float, float]:
    x = math.radians(lon) * math.cos(math.radians(ref_lat)) * EARTH_RADIUS_M
    y = math.radians(lat) * EARTH_RADIUS_M
    return x, y



def distance_to_route(lat: float, lon: float, route_points: list[RoutePoint], cumulative_meters: list[float]) -> tuple[float, float, int]:
    ref_lat = lat
    px, py = project_xy(lat, lon, ref_lat)
    best_distance = float("inf")
    best_route_meters = 0.0
    best_index = 0

    for index in range(len(route_points) - 1):
        a = route_points[index]
        b = route_points[index + 1]
        ax, ay = project_xy(a.lat, a.lon, ref_lat)
        bx, by = project_xy(b.lat, b.lon, ref_lat)
        abx = bx - ax
        aby = by - ay
        apx = px - ax
        apy = py - ay
        segment_length_sq = abx * abx + aby * aby
        t = 0.0 if segment_length_sq == 0 else max(0.0, min(1.0, (apx * abx + apy * aby) / segment_length_sq))
        closest_x = ax + t * abx
        closest_y = ay + t * aby
        distance = math.hypot(px - closest_x, py - closest_y)
        if distance < best_distance:
            best_distance = distance
            best_route_meters = cumulative_meters[index] + t * haversine_m(a.lat, a.lon, b.lat, b.lon)
            best_index = index if haversine_m(lat, lon, a.lat, a.lon) <= haversine_m(lat, lon, b.lat, b.lon) else index + 1

    return best_distance, best_route_meters, best_index



def build_route_cumulative(route_points: list[RoutePoint]) -> list[float]:
    cumulative = [0.0]
    total = 0.0
    for index in range(1, len(route_points)):
        total += haversine_m(route_points[index - 1].lat, route_points[index - 1].lon, route_points[index].lat, route_points[index].lon)
        cumulative.append(total)
    return cumulative



def to_float(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except Exception:
        return None



def clone_record_as_stop(record: dict, fuel_type: str, off_route_m: float, origin_m: float) -> FuelStop:
    diesel_price = to_float(record.get("diesel_price"))
    auto_diesel_price = to_float(record.get("auto_diesel_price"))
    unleaded_price = to_float(record.get("unleaded_price"))
    price_map = {
        "diesel": diesel_price,
        "auto_diesel": auto_diesel_price,
        "unleaded": unleaded_price,
    }
    selected_price = choose_fuel_price(price_map, fuel_type)
    amenity_bonus = min(len(record.get("amenities") or []), 16) * 1.8
    price_bonus = 10 if selected_price is not None else 0
    location_bonus = 8 if record.get("location_type") in {"Travel Center", "Truck Stop", "Country Store", "One9"} else 0
    score = round(115 + amenity_bonus + price_bonus + location_bonus - (off_route_m * 0.000621371 * 2.2), 1)

    return FuelStop(
        id=str(record.get("id") or record.get("source_url") or record.get("name")),
        name=str(record.get("name") or record.get("brand") or "Fuel Stop"),
        brand=str(record.get("brand") or "Fuel Stop"),
        city=str(record.get("city") or ""),
        address=str(record.get("address") or "Address unavailable"),
        state_code=str(record.get("state_code") or "") or None,
        lat=float(record.get("lat")),
        lon=float(record.get("lon")),
        detour_distance_meters=int(off_route_m * 2.0),
        detour_time_seconds=max(300, int((off_route_m * 2.0) / 19.0)) if off_route_m > 0 else 300,
        origin_miles=round(origin_m * 0.000621371, 1),
        off_route_miles=round(off_route_m * 0.000621371, 1),
        fuel_types=list(record.get("fuel_types") or []),
        price=selected_price,
        price_less_tax=None,
        price_source=str(record.get("price_source") or "Official network page"),
        price_date=str(record.get("price_date") or "") or None,
        parking_spaces=str(record.get("parking_spaces") or "") or None,
        amenity_score=round(amenity_bonus + location_bonus, 1),
        overall_score=score,
        source_url=str(record.get("source_url") or "") or None,
        amenities=list(record.get("amenities") or []),
        location_type=str(record.get("location_type") or "") or None,
        official_match=True,
        postal_code=str(record.get("postal_code") or "") or None,
        phone=str(record.get("phone") or "") or None,
        fax=str(record.get("fax") or "") or None,
        store_number=str(record.get("store_number") or "") or None,
        diesel_price=diesel_price,
        auto_diesel_price=auto_diesel_price,
        unleaded_price=unleaded_price,
        highway=str(record.get("highway") or "") or None,
        exit_number=str(record.get("exit_number") or "") or None,
    )



def fetch_live_loves_record(url: str) -> dict | None:
    html = safe_http_request(url)
    if not html:
        return None

    next_data = extract_next_data(html)
    page_props = ((next_data.get("props") or {}).get("pageProps") or {})
    location_data = page_props.get("locationData") or {}
    prices = parse_loves_prices(location_data.get("fuelPrices") or [])
    diesel_time_match = re.search(r'"productName":"DIESEL".*?"lastCheckInDateTime":"([^"]+)"', html, re.S)
    if not diesel_time_match:
        diesel_time_match = re.search(r'"productName":"DIESEL".*?"lastPriceChangeDateTime":"([^"]+)"', html, re.S)

    fuel_types = unique_strings([
        str(item.get("fuelType") or item.get("displayName") or "")
        for item in (location_data.get("fuelPrices") or [])
    ])

    return {
        "diesel_price": prices.get("diesel_price"),
        "auto_diesel_price": prices.get("auto_diesel_price"),
        "unleaded_price": prices.get("unleaded_price"),
        "fuel_types": fuel_types,
        "price_date": diesel_time_match.group(1) if diesel_time_match else None,
        "price_source": "Love's official site",
    }


def fetch_live_pilot_prices(site_id: str) -> dict[str, float | None]:
    request_url = f"{PILOT_FUEL_API_ROOT}/{site_id}/fuelPrices"
    proxy_url = f"{PILOT_LAMBDA_PROXY_URL}?{urlencode({'requestUrl': request_url})}"
    try:
        data = http_json(proxy_url)
    except Exception:
        return {
            "diesel_price": None,
            "auto_diesel_price": None,
            "unleaded_price": None,
            "fuel_types": [],
        }

    price_by_label: dict[str, float] = {}
    for item in data if isinstance(data, list) else []:
        description = str(item.get("description") or "").strip()
        price = item.get("price")
        if description and price is not None:
            price_by_label[description] = float(price)

    diesel_price = None
    for label in ["Diesel #2", "Diesel #1", "Marked Diesel", "Dyed Diesel #2"]:
        if label in price_by_label:
            diesel_price = price_by_label[label]
            break

    auto_diesel_price = price_by_label.get("Auto Diesel")
    unleaded_price = price_by_label.get("Unleaded")
    fuel_types = unique_strings(list(price_by_label.keys()))
    return {
        "diesel_price": diesel_price,
        "auto_diesel_price": auto_diesel_price,
        "unleaded_price": unleaded_price,
        "fuel_types": fuel_types,
    }


def build_live_price_payload(record: dict) -> dict | None:
    brand = record.get("brand")
    if brand == "Pilot Flying J" and record.get("site_id"):
        live_prices = fetch_live_pilot_prices(str(record.get("site_id")))
        return {
            "diesel_price": live_prices.get("diesel_price"),
            "auto_diesel_price": live_prices.get("auto_diesel_price"),
            "unleaded_price": live_prices.get("unleaded_price"),
            "fuel_types": list(live_prices.get("fuel_types") or []),
            "price_source": "Pilot official fuel API",
            "price_date": None,
        }
    if brand == "Love's" and record.get("source_url"):
        live_record = fetch_live_loves_record(str(record.get("source_url")))
        if live_record:
            return {
                "diesel_price": to_float(live_record.get("diesel_price")),
                "auto_diesel_price": to_float(live_record.get("auto_diesel_price")),
                "unleaded_price": to_float(live_record.get("unleaded_price")),
                "fuel_types": list(live_record.get("fuel_types") or []),
                "price_source": str(live_record.get("price_source") or "Love's official site"),
                "price_date": str(live_record.get("price_date") or "") or None,
            }
    return None


def apply_live_price_payload(stop: FuelStop, payload: dict, fuel_type: str):
    stop.diesel_price = to_float(payload.get("diesel_price"))
    stop.auto_diesel_price = to_float(payload.get("auto_diesel_price"))
    stop.unleaded_price = to_float(payload.get("unleaded_price"))
    stop.fuel_types = unique_strings(list(stop.fuel_types or []) + list(payload.get("fuel_types") or []))
    stop.price_source = str(payload.get("price_source") or stop.price_source or "Official network page")
    stop.price_date = str(payload.get("price_date") or "") or stop.price_date
    stop.price = choose_fuel_price(
        {
            "diesel": stop.diesel_price,
            "auto_diesel": stop.auto_diesel_price,
            "unleaded": stop.unleaded_price,
        },
        fuel_type,
    )


def _load_live_price_cache_locked():
    global LIVE_PRICE_CACHE, LIVE_PRICE_CACHE_LOADED
    if LIVE_PRICE_CACHE_LOADED:
        return
    LIVE_PRICE_CACHE = {}
    if LIVE_PRICE_CACHE_PATH.exists():
        try:
            payload = json.loads(LIVE_PRICE_CACHE_PATH.read_text(encoding="utf-8"))
            if payload.get("version") == LIVE_PRICE_CACHE_VERSION and isinstance(payload.get("entries"), dict):
                LIVE_PRICE_CACHE = payload.get("entries") or {}
        except Exception:
            LIVE_PRICE_CACHE = {}
    LIVE_PRICE_CACHE_LOADED = True


def _purge_expired_live_price_entries_locked(now_ts: float | None = None):
    now_ts = now_ts or time.time()
    expired_keys = [key for key, entry in LIVE_PRICE_CACHE.items() if float(entry.get("stale_until_ts") or 0.0) <= now_ts]
    for key in expired_keys:
        LIVE_PRICE_CACHE.pop(key, None)


def persist_live_price_cache(force: bool = False):
    global LIVE_PRICE_CACHE_DIRTY, LIVE_PRICE_CACHE_LAST_PERSIST
    with LIVE_PRICE_CACHE_LOCK:
        _load_live_price_cache_locked()
        _purge_expired_live_price_entries_locked()
        if not LIVE_PRICE_CACHE_DIRTY:
            return
        interval = max(1, settings.live_price_cache_persist_seconds)
        if not force and (time.monotonic() - LIVE_PRICE_CACHE_LAST_PERSIST) < interval:
            return
        LIVE_PRICE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": LIVE_PRICE_CACHE_VERSION,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "entries": LIVE_PRICE_CACHE,
        }
        tmp_path = LIVE_PRICE_CACHE_PATH.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp_path.replace(LIVE_PRICE_CACHE_PATH)
        LIVE_PRICE_CACHE_DIRTY = False
        LIVE_PRICE_CACHE_LAST_PERSIST = time.monotonic()


def store_live_price_cache_entry(task_key: str, payload: dict):
    global LIVE_PRICE_CACHE_DIRTY
    now_ts = time.time()
    entry = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "fresh_until_ts": now_ts + max(60, settings.live_price_cache_ttl_seconds),
        "stale_until_ts": now_ts + max(max(60, settings.live_price_cache_ttl_seconds), settings.live_price_cache_stale_ttl_seconds),
        "diesel_price": to_float(payload.get("diesel_price")),
        "auto_diesel_price": to_float(payload.get("auto_diesel_price")),
        "unleaded_price": to_float(payload.get("unleaded_price")),
        "fuel_types": list(payload.get("fuel_types") or []),
        "price_source": str(payload.get("price_source") or "Official network page"),
        "price_date": str(payload.get("price_date") or "") or None,
    }
    with LIVE_PRICE_CACHE_LOCK:
        _load_live_price_cache_locked()
        LIVE_PRICE_CACHE[task_key] = entry
        _purge_expired_live_price_entries_locked(now_ts)
        LIVE_PRICE_CACHE_DIRTY = True
    persist_live_price_cache()


def get_live_price_cache_entry(task_key: str) -> dict | None:
    with LIVE_PRICE_CACHE_LOCK:
        _load_live_price_cache_locked()
        _purge_expired_live_price_entries_locked()
        entry = LIVE_PRICE_CACHE.get(task_key)
        return dict(entry) if entry else None


def is_live_price_entry_fresh(entry: dict | None, now_ts: float | None = None) -> bool:
    if not entry:
        return False
    now_ts = now_ts or time.time()
    return float(entry.get("fresh_until_ts") or 0.0) > now_ts


def is_live_price_entry_usable(entry: dict | None, now_ts: float | None = None) -> bool:
    if not entry:
        return False
    now_ts = now_ts or time.time()
    return float(entry.get("stale_until_ts") or 0.0) > now_ts


def apply_cached_live_price_entry(stop: FuelStop, entry: dict, fuel_type: str):
    apply_live_price_payload(stop, entry, fuel_type)


def _update_live_price_runtime(**changes):
    with LIVE_PRICE_RUNTIME_LOCK:
        for key, value in changes.items():
            LIVE_PRICE_RUNTIME[key] = value


def _increment_live_price_runtime(key: str, amount: int = 1):
    with LIVE_PRICE_RUNTIME_LOCK:
        LIVE_PRICE_RUNTIME[key] = int(LIVE_PRICE_RUNTIME.get(key) or 0) + amount


def live_price_runtime_status() -> dict:
    with LIVE_PRICE_CACHE_LOCK:
        _load_live_price_cache_locked()
        _purge_expired_live_price_entries_locked()
        cache_entries = len(LIVE_PRICE_CACHE)
    with LIVE_PRICE_RUNTIME_LOCK:
        runtime = dict(LIVE_PRICE_RUNTIME)
    return {
        **runtime,
        "enabled": bool(settings.live_price_background_refresh_enabled),
        "workers": len(LIVE_PRICE_WORKERS),
        "queue_size": LIVE_PRICE_TASK_QUEUE.qsize(),
        "cache_entries": cache_entries,
        "inflight": len(LIVE_PRICE_INFLIGHT),
    }


def enqueue_live_price_refresh(task_key: str, record: dict) -> bool:
    if not settings.live_price_background_refresh_enabled:
        return False
    start_live_price_refresh_workers()
    with LIVE_PRICE_INFLIGHT_LOCK:
        if task_key in LIVE_PRICE_INFLIGHT:
            return False
        LIVE_PRICE_INFLIGHT.add(task_key)
    try:
        LIVE_PRICE_TASK_QUEUE.put_nowait((task_key, dict(record)))
    except Full:
        with LIVE_PRICE_INFLIGHT_LOCK:
            LIVE_PRICE_INFLIGHT.discard(task_key)
        _increment_live_price_runtime("dropped")
        return False
    _increment_live_price_runtime("enqueued")
    return True


def _live_price_worker_loop(worker_index: int):
    while not LIVE_PRICE_WORKER_STOP.is_set():
        try:
            task = LIVE_PRICE_TASK_QUEUE.get(timeout=0.5)
        except Empty:
            persist_live_price_cache()
            continue

        if task is None:
            LIVE_PRICE_TASK_QUEUE.task_done()
            break

        task_key, record = task
        try:
            payload = build_live_price_payload(record)
            if payload:
                store_live_price_cache_entry(task_key, payload)
                _increment_live_price_runtime("processed")
                _update_live_price_runtime(last_success_at=datetime.now(timezone.utc).isoformat())
            else:
                _increment_live_price_runtime("errors")
                _update_live_price_runtime(last_error_at=datetime.now(timezone.utc).isoformat())
        except Exception:
            _increment_live_price_runtime("errors")
            _update_live_price_runtime(last_error_at=datetime.now(timezone.utc).isoformat())
        finally:
            with LIVE_PRICE_INFLIGHT_LOCK:
                LIVE_PRICE_INFLIGHT.discard(task_key)
            LIVE_PRICE_TASK_QUEUE.task_done()

    persist_live_price_cache(force=True)


def start_live_price_refresh_workers():
    if not settings.live_price_background_refresh_enabled:
        return
    with LIVE_PRICE_RUNTIME_LOCK:
        if LIVE_PRICE_RUNTIME.get("started"):
            return
        LIVE_PRICE_RUNTIME["started"] = True
    with LIVE_PRICE_CACHE_LOCK:
        _load_live_price_cache_locked()
    LIVE_PRICE_WORKER_STOP.clear()
    worker_count = max(1, min(settings.live_price_queue_workers, LIVE_PRICE_REFRESH_WORKERS))
    for index in range(worker_count):
        worker = threading.Thread(target=_live_price_worker_loop, args=(index + 1,), name=f"live-price-worker-{index + 1}", daemon=True)
        LIVE_PRICE_WORKERS.append(worker)
        worker.start()


def stop_live_price_refresh_workers():
    with LIVE_PRICE_RUNTIME_LOCK:
        started = bool(LIVE_PRICE_RUNTIME.get("started"))
        LIVE_PRICE_RUNTIME["started"] = False
    if not started:
        return
    LIVE_PRICE_WORKER_STOP.set()
    for _ in LIVE_PRICE_WORKERS:
        try:
            LIVE_PRICE_TASK_QUEUE.put_nowait(None)
        except Full:
            break
    while LIVE_PRICE_WORKERS:
        worker = LIVE_PRICE_WORKERS.pop()
        worker.join(timeout=2.0)
    persist_live_price_cache(force=True)


def refresh_live_prices(stop: FuelStop, record: dict, fuel_type: str):
    payload = build_live_price_payload(record)
    if payload:
        apply_live_price_payload(stop, payload, fuel_type)
        task_key = live_price_task_key(stop, record)
        if task_key:
            store_live_price_cache_entry(task_key, payload)
        return

    cached_entry = get_live_price_cache_entry(live_price_task_key(stop, record))
    if cached_entry and is_live_price_entry_usable(cached_entry):
        apply_cached_live_price_entry(stop, cached_entry, fuel_type)


def live_price_task_key(stop: FuelStop, record: dict) -> str:
    brand = str(record.get("brand") or "")
    site_id = str(record.get("site_id") or "").strip()
    if brand == "Pilot Flying J" and site_id:
        return f"pilot:{site_id}"
    source_url = str(record.get("source_url") or "").strip()
    if brand == "Love's" and source_url:
        return f"loves:{source_url}"
    return stop.id



def copy_live_price_fields(source: FuelStop, target: FuelStop):
    target.diesel_price = source.diesel_price
    target.auto_diesel_price = source.auto_diesel_price
    target.unleaded_price = source.unleaded_price
    target.fuel_types = list(source.fuel_types or [])
    target.price = source.price
    target.price_date = source.price_date
    target.price_source = source.price_source



def refresh_shortlisted_live_prices(
    shortlisted: list[ShortlistedOfficialStation],
    fuel_type: str,
    max_workers: int = LIVE_PRICE_REFRESH_WORKERS,
    blocking: bool | None = None,
):
    if not shortlisted:
        return

    if blocking is None:
        blocking = not settings.live_price_background_refresh_enabled

    grouped: dict[str, list[ShortlistedOfficialStation]] = {}
    for stop, record, nearest_index in shortlisted:
        grouped.setdefault(live_price_task_key(stop, record), []).append((stop, record, nearest_index))

    if blocking:
        def refresh_group(group: list[ShortlistedOfficialStation]):
            primary_stop, record, _ = group[0]
            refresh_live_prices(primary_stop, record, fuel_type)
            for stop, _, _ in group[1:]:
                copy_live_price_fields(primary_stop, stop)

        with ThreadPoolExecutor(max_workers=min(max_workers, len(grouped) or 1)) as executor:
            list(executor.map(refresh_group, grouped.values()))
        persist_live_price_cache()
        return

    enqueued_for_route = 0
    for task_key, group in grouped.items():
        cached_entry = get_live_price_cache_entry(task_key)
        if cached_entry and is_live_price_entry_usable(cached_entry):
            for stop, _, _ in group:
                apply_cached_live_price_entry(stop, cached_entry, fuel_type)
            if is_live_price_entry_fresh(cached_entry):
                continue
        if enqueued_for_route >= LIVE_PRICE_ROUTE_ENQUEUE_LIMIT:
            continue
        if enqueue_live_price_refresh(task_key, group[0][1]):
            enqueued_for_route += 1


def refine_detour(stop: FuelStop, route_points: list[RoutePoint], nearest_index: int, vehicle_type: str):
    if not settings.tomtom_api_key:
        return
    anchor = route_points[min(max(nearest_index, 0), len(route_points) - 1)]
    route_points_string = f"{anchor.lat},{anchor.lon}:{stop.lat},{stop.lon}"
    params = urlencode({
        "key": settings.tomtom_api_key,
        "routeRepresentation": "none",
        "computeTravelTimeFor": "all",
        "travelMode": "truck" if vehicle_type.lower() == "truck" else "car",
    })
    try:
        data = http_json(f"https://api.tomtom.com/routing/1/calculateRoute/{route_points_string}/json?{params}", timeout_seconds=ROUTE_DETOUR_TIMEOUT_SECONDS)
    except Exception:
        return
    routes = data.get("routes") or []
    if not routes:
        return
    summary = routes[0].get("summary") or {}
    one_way_meters = int(summary.get("lengthInMeters") or 0)
    one_way_seconds = int(summary.get("travelTimeInSeconds") or 0)
    if one_way_meters <= 0:
        return
    stop.detour_distance_meters = one_way_meters * 2
    stop.detour_time_seconds = max(300, one_way_seconds * 2)
    stop.off_route_miles = round(stop.detour_distance_meters * 0.000621371, 1)
    price_bonus = 10 if stop.price is not None else 0
    amenity_bonus = min(len(stop.amenities or []), 16) * 1.8
    location_bonus = 8 if stop.location_type in {"Travel Center", "Truck Stop", "Country Store", "One9"} else 0
    stop.overall_score = round(115 + amenity_bonus + price_bonus + location_bonus - (stop.off_route_miles or 0) * 2.2, 1)



def refine_shortlisted_detours(
    shortlisted: list[ShortlistedOfficialStation],
    route_points: list[RoutePoint],
    vehicle_type: str,
    limit: int = ROUTE_REFINE_LIMIT,
    max_workers: int = ROUTE_REFINE_WORKERS,
):
    refine_candidates = shortlisted[:limit]
    if not refine_candidates:
        return
    with ThreadPoolExecutor(max_workers=min(max_workers, len(refine_candidates) or 1)) as executor:
        list(executor.map(lambda item: refine_detour(item[0], route_points, item[2], vehicle_type), refine_candidates))



def finalize_shortlisted_official_stations(shortlisted: list[ShortlistedOfficialStation]) -> list[FuelStop]:
    stops = [item[0] for item in shortlisted]
    deduped: dict[str, FuelStop] = {}
    for stop in stops:
        current = deduped.get(stop.id)
        if current is None or (stop.overall_score or 0) > (current.overall_score or 0):
            deduped[stop.id] = stop
    return list(deduped.values())



def shortlist_official_stations_along_route(route_points: list[RoutePoint], fuel_type: str) -> list[ShortlistedOfficialStation]:
    if len(route_points) < 2:
        return []

    catalog = get_official_station_catalog()
    cumulative_meters = build_route_cumulative(route_points)
    corridor_meters = DEFAULT_ROUTE_CORRIDOR_MILES * 1609.344
    min_lat = min(point.lat for point in route_points)
    max_lat = max(point.lat for point in route_points)
    min_lon = min(point.lon for point in route_points)
    max_lon = max(point.lon for point in route_points)
    lat_padding = DEFAULT_ROUTE_CORRIDOR_MILES / 69.0
    lon_padding = DEFAULT_ROUTE_CORRIDOR_MILES / max(10.0, 69.0 * math.cos(math.radians((min_lat + max_lat) / 2 or 1)))

    candidates: list[ShortlistedOfficialStation] = []
    for record in catalog:
        lat = float(record.get("lat"))
        lon = float(record.get("lon"))
        if lat < min_lat - lat_padding or lat > max_lat + lat_padding:
            continue
        if lon < min_lon - lon_padding or lon > max_lon + lon_padding:
            continue
        distance_m, origin_m, nearest_index = distance_to_route(lat, lon, route_points, cumulative_meters)
        if distance_m > corridor_meters:
            continue
        stop = clone_record_as_stop(record, fuel_type, distance_m, origin_m)
        candidates.append((stop, record, nearest_index))

    candidates.sort(key=lambda item: (item[0].off_route_miles or 9999, item[0].origin_miles or 9999, item[0].name.lower()))
    return candidates[:SHORTLISTED_ROUTE_STATION_LIMIT]



def find_official_stations_along_route(route_points: list[RoutePoint], vehicle_type: str, fuel_type: str) -> list[FuelStop]:
    shortlisted = shortlist_official_stations_along_route(route_points, fuel_type)
    refresh_shortlisted_live_prices(shortlisted, fuel_type)
    refine_shortlisted_detours(shortlisted, route_points, vehicle_type)
    return finalize_shortlisted_official_stations(shortlisted)
