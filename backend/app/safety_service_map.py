from __future__ import annotations

import json
import math
import ssl
import threading
import time
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import certifi
from app.config import Settings
from app.official_stations import get_official_station_catalog, haversine_m
from app.provider_errors import ProviderRequestError, build_provider_request_error

ssl_context = ssl.create_default_context(cafile=certifi.where())
EMERGENCY_CACHE_LOCK = threading.Lock()
EMERGENCY_CACHE: dict[tuple, dict[str, object]] = {}
EMERGENCY_CACHE_TTL_SECONDS = 300
DEFAULT_RADIUS_MILES = 80
MAX_RADIUS_MILES = 180
MAX_SERVICE_RESULTS = 80
MAX_EMERGENCY_RESULTS = 28
TOMTOM_POI_ACCESS: bool | None = None

SERVICE_CATEGORY_DEFS = [
    {"id": "all", "label": "All Services", "keywords": []},
    {"id": "fuel_def", "label": "Fuel & DEF", "keywords": ["diesel", "fuel", "gas", "def", "propane", "auto diesel", "commercial diesel"]},
    {"id": "repair", "label": "Repair", "keywords": ["repair", "mechanical", "oil change", "truck care", "service center", "preventative maintenance", "speedco", "freightliner", "international warranty"]},
    {"id": "tires", "label": "Tires", "keywords": ["tire", "tirepass", "bridgestone", "flat tire"]},
    {"id": "parking_rest", "label": "Parking & Rest", "keywords": ["parking", "showers", "laundry", "drivers lounge", "idleair", "rv dump", "wifi", "dog park"]},
    {"id": "compliance", "label": "Scales & Compliance", "keywords": ["cat scale", "scale", "transflo", "inspection", "weigh"]},
    {"id": "driver_services", "label": "Driver Services", "keywords": ["atm", "wifi", "laundry", "showers", "lounge", "coffee", "food offerings"]},
    {"id": "food", "label": "Food", "keywords": ["food", "restaurant", "mcdonald", "subway", "wendy", "arbys", "cinnabon", "denny", "pizza", "taco"]},
]
EMERGENCY_SCENARIOS = [
    {
        "id": "flat_tire",
        "label": "Flat Tire",
        "description": "Nearest tire help and roadside-capable truck service.",
        "queries": ["truck tire repair", "commercial tire service", "roadside truck tire repair"],
        "categories": ["tires", "repair"],
    },
    {
        "id": "mechanical",
        "label": "Mechanical Issue",
        "description": "Truck repair, mobile mechanics, and roadside service.",
        "queries": ["truck repair", "mobile truck repair", "roadside assistance"],
        "categories": ["repair", "tires"],
    },
    {
        "id": "towing",
        "label": "Towing",
        "description": "Heavy duty towing and breakdown recovery nearby.",
        "queries": ["heavy duty towing", "truck towing service", "semi truck towing"],
        "categories": [],
    },
    {
        "id": "no_fuel",
        "label": "Low Fuel",
        "description": "Nearest fuel, DEF, and truck stop options.",
        "queries": ["truck stop", "diesel fuel", "gas station"],
        "categories": ["fuel_def"],
    },
    {
        "id": "need_parking",
        "label": "Need Parking",
        "description": "Parking, showers, and safe stop options nearby.",
        "queries": ["truck parking", "rest area", "travel center"],
        "categories": ["parking_rest"],
    },
]
CATEGORY_LABELS = {item["id"]: item["label"] for item in SERVICE_CATEGORY_DEFS}
SCENARIO_DEFS = {item["id"]: item for item in EMERGENCY_SCENARIOS}


def _clean_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _normalize_text(value: object) -> str:
    return " ".join(_clean_text(value).lower().replace("&", " and ").replace("/", " ").split())


def _contains_keyword(text: str, keywords: list[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def _radius_miles(value: float | int | None) -> int:
    try:
        parsed = int(float(value or DEFAULT_RADIUS_MILES))
    except (TypeError, ValueError):
        parsed = DEFAULT_RADIUS_MILES
    return max(10, min(MAX_RADIUS_MILES, parsed))


def _service_filters() -> dict:
    return {
        "categories": [{"id": item["id"], "label": item["label"]} for item in SERVICE_CATEGORY_DEFS],
        "scenarios": [{"id": item["id"], "label": item["label"], "description": item["description"]} for item in EMERGENCY_SCENARIOS],
        "radius_options": [25, 50, 80, 120, 180],
    }


def _http_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": "UnitedLLMSYS/1.0"})
    try:
        with urlopen(request, timeout=20, context=ssl_context) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except Exception as exc:
        raise build_provider_request_error(
            "Emergency POI search",
            exc,
            access_hint="Showing official nearby truck stops instead of the live emergency POI feed.",
        ) from exc


def _vehicle_options(snapshot: dict) -> list[dict]:
    options: list[dict] = []
    for vehicle in snapshot.get("vehicles") or []:
        location = vehicle.get("location") or {}
        resolved_driver = vehicle.get("resolved_driver") or vehicle.get("driver") or vehicle.get("permanent_driver") or {}
        lat = location.get("lat")
        lon = location.get("lon")
        if lat is None or lon is None:
            continue
        options.append({
            "id": vehicle.get("id"),
            "number": vehicle.get("number") or f"Truck {vehicle.get('id')}",
            "label": vehicle.get("number") or f"Truck {vehicle.get('id')}",
            "driver_name": _clean_text(resolved_driver.get("full_name")),
            "lat": lat,
            "lon": lon,
            "address": _clean_text(location.get("address")) or ", ".join(part for part in [_clean_text(location.get("city")), _clean_text(location.get("state"))] if part),
            "is_stale": bool(vehicle.get("is_stale")),
            "is_moving": bool(vehicle.get("is_moving")),
        })
    options.sort(key=lambda item: (_clean_text(item.get("number")), item.get("id") or 0))
    return options

def _pick_vehicle(vehicle_options: list[dict], vehicle_id: int | None) -> dict | None:
    if vehicle_id is not None:
        for vehicle in vehicle_options:
            if str(vehicle.get("id")) == str(vehicle_id):
                return vehicle
    return vehicle_options[0] if vehicle_options else None


def _bounding_box(lat: float, lon: float, radius_miles: int) -> tuple[float, float, float, float]:
    lat_pad = radius_miles / 69.0
    lon_pad = radius_miles / max(10.0, 69.0 * math.cos(math.radians(lat or 1)))
    return lat - lat_pad, lat + lat_pad, lon - lon_pad, lon + lon_pad


def _categories_for_text(text: str) -> list[str]:
    matched = []
    for item in SERVICE_CATEGORY_DEFS:
        if item["id"] == "all":
            continue
        if _contains_keyword(text, item["keywords"]):
            matched.append(item["id"])
    return matched


def _record_text(record: dict) -> str:
    values = [
        record.get("name"),
        record.get("brand"),
        record.get("location_type"),
        record.get("address"),
        record.get("city"),
        record.get("state_code"),
        record.get("parking_spaces"),
        " ".join(record.get("amenities") or []),
        " ".join(record.get("fuel_types") or []),
    ]
    return _normalize_text(" ".join(_clean_text(value) for value in values if value))


def _matches_category(category_id: str, categories: list[str]) -> bool:
    return category_id == "all" or category_id in categories


def _official_items(lat: float, lon: float, radius_miles: int, category_id: str) -> list[dict]:
    min_lat, max_lat, min_lon, max_lon = _bounding_box(lat, lon, radius_miles)
    radius_m = radius_miles * 1609.344
    items: list[dict] = []
    for record in get_official_station_catalog():
        record_lat = float(record.get("lat") or 0)
        record_lon = float(record.get("lon") or 0)
        if record_lat < min_lat or record_lat > max_lat or record_lon < min_lon or record_lon > max_lon:
            continue
        distance_m = haversine_m(lat, lon, record_lat, record_lon)
        if distance_m > radius_m:
            continue
        record_text = _record_text(record)
        categories = _categories_for_text(record_text)
        if not categories:
            categories = ["driver_services"] if record.get("phone") else []
        if not _matches_category(category_id, categories):
            continue
        services = list(record.get("amenities") or [])[:14]
        if not services:
            services = [CATEGORY_LABELS[category] for category in categories[:3]]
        items.append({
            "id": str(record.get("id") or record.get("source_url") or record.get("name")),
            "name": _clean_text(record.get("name")) or "Service location",
            "brand": _clean_text(record.get("brand")) or "Official station",
            "kind": "official",
            "address": _clean_text(record.get("address")) or "Address unavailable",
            "city": _clean_text(record.get("city")),
            "state_code": _clean_text(record.get("state_code")),
            "lat": record_lat,
            "lon": record_lon,
            "distance_miles": round(distance_m * 0.000621371, 1),
            "phone": _clean_text(record.get("phone")),
            "highway": _clean_text(record.get("highway")),
            "exit_number": _clean_text(record.get("exit_number")),
            "location_type": _clean_text(record.get("location_type")) or "Travel center",
            "services": services,
            "service_categories": categories,
            "source_url": _clean_text(record.get("source_url")),
            "official_match": True,
            "fuel_price": record.get("auto_diesel_price") or record.get("diesel_price") or record.get("unleaded_price"),
            "parking_spaces": _clean_text(record.get("parking_spaces")),
            "emergency_ready": bool(_clean_text(record.get("phone")) and _contains_keyword(record_text, ["tire", "repair", "truck care", "service center", "towing", "mechanical"])),
            "match_summary": ", ".join(CATEGORY_LABELS.get(category, category) for category in categories[:3]) or "Official service station",
        })
    items.sort(key=lambda item: (item.get("distance_miles") or 9999, item.get("name") or ""))
    return items[:MAX_SERVICE_RESULTS]


def _scenario_keywords(scenario_id: str) -> list[str]:
    scenario = SCENARIO_DEFS.get(scenario_id) or SCENARIO_DEFS["mechanical"]
    return [_normalize_text(query) for query in scenario.get("queries") or []]


def _emergency_cache_key(query: str, lat: float, lon: float, radius_m: int, limit: int) -> tuple:
    return (_normalize_text(query), round(lat, 3), round(lon, 3), int(radius_m), int(limit))


def _cached_tomtom_poi_search(query: str, lat: float, lon: float, radius_m: int, limit: int, settings: Settings) -> tuple[list[dict], str | None]:
    global TOMTOM_POI_ACCESS
    if not settings.tomtom_api_key or TOMTOM_POI_ACCESS is False:
        return [], None
    cache_key = _emergency_cache_key(query, lat, lon, radius_m, limit)
    now = time.time()
    with EMERGENCY_CACHE_LOCK:
        cached = EMERGENCY_CACHE.get(cache_key)
        if cached and now - float(cached.get("stored_at") or 0.0) < EMERGENCY_CACHE_TTL_SECONDS:
            return list(cached.get("items") or []), None

    params = urlencode({
        "key": settings.tomtom_api_key,
        "lat": lat,
        "lon": lon,
        "radius": radius_m,
        "limit": limit,
        "language": "en-US",
    })
    url = f"https://api.tomtom.com/search/2/poiSearch/{quote(query)}.json?{params}"
    try:
        data = _http_json(url)
        TOMTOM_POI_ACCESS = True
    except ProviderRequestError as exc:
        if exc.code in {401, 403}:
            TOMTOM_POI_ACCESS = False
        return [], str(exc)
    results = data.get("results") if isinstance(data, dict) else []
    if not isinstance(results, list):
        results = []
    with EMERGENCY_CACHE_LOCK:
        EMERGENCY_CACHE[cache_key] = {"stored_at": now, "items": results}
    return list(results), None

def _poi_item_from_result(result: dict, lat: float, lon: float, scenario_id: str) -> dict | None:
    poi = result.get("poi") or {}
    address = result.get("address") or {}
    position = result.get("position") or {}
    item_lat = position.get("lat")
    item_lon = position.get("lon")
    if item_lat is None or item_lon is None:
        return None

    categories = [_normalize_text(value) for value in (poi.get("categories") or []) if value]
    class_name = _normalize_text(((poi.get("classifications") or [{}])[0] or {}).get("code"))
    category_set = poi.get("categorySet") or []
    category_set_text = " ".join(str(value) for value in category_set if value) if isinstance(category_set, list) else _clean_text(category_set)
    detail_text = " ".join(
        part for part in [
            _clean_text(poi.get("name")),
            category_set_text,
            " ".join(str(value) for value in (poi.get("categories") or []) if value),
            class_name,
        ] if part
    )
    matched_categories = _categories_for_text(_normalize_text(detail_text))
    scenario_keywords = _scenario_keywords(scenario_id)
    tags = []
    if _contains_keyword(_normalize_text(detail_text), ["towing"]):
        tags.append("Towing")
    if _contains_keyword(_normalize_text(detail_text), ["tire"]):
        tags.append("Tires")
    if _contains_keyword(_normalize_text(detail_text), ["repair", "mechanical", "service"]):
        tags.append("Repair")
    tags.extend(value.title() for value in categories[:3] if value)
    deduped_tags = []
    for tag in tags:
        if tag not in deduped_tags:
            deduped_tags.append(tag)

    distance_m = haversine_m(lat, lon, float(item_lat), float(item_lon))
    phone = _clean_text(poi.get("phone")) or _clean_text((poi.get("phoneNumber") or {}).get("number"))
    website = _clean_text(poi.get("url")) or _clean_text(result.get("url"))
    relevance = 0
    if phone:
        relevance += 12
    if _contains_keyword(_normalize_text(detail_text), scenario_keywords):
        relevance += 18
    if _contains_keyword(_normalize_text(detail_text), ["truck", "heavy duty", "semi", "roadside", "24/7", "24 7"]):
        relevance += 10

    freeform_address = _clean_text(address.get("freeformAddress")) or ", ".join(part for part in [_clean_text(address.get("streetName")), _clean_text(address.get("municipality")), _clean_text(address.get("countrySubdivision"))] if part)
    return {
        "id": f"poi:{_clean_text(result.get('id')) or _clean_text(poi.get('name'))}:{item_lat}:{item_lon}",
        "name": _clean_text(poi.get("name")) or "Emergency service",
        "brand": "TomTom POI",
        "kind": "poi",
        "address": freeform_address or "Address unavailable",
        "city": _clean_text(address.get("municipality")),
        "state_code": _clean_text(address.get("countrySubdivision")),
        "lat": float(item_lat),
        "lon": float(item_lon),
        "distance_miles": round(distance_m * 0.000621371, 1),
        "phone": phone,
        "highway": "",
        "exit_number": "",
        "location_type": _clean_text((poi.get("classifications") or [{}])[0].get("code")) or "POI",
        "services": deduped_tags[:8],
        "service_categories": matched_categories,
        "source_url": website,
        "official_match": False,
        "fuel_price": None,
        "parking_spaces": "",
        "emergency_ready": bool(phone or website),
        "match_summary": "Live emergency POI search",
        "relevance_score": relevance,
    }


def _merge_items(primary: list[dict], secondary: list[dict], *, limit: int) -> list[dict]:
    by_key: dict[str, dict] = {}
    for item in [*primary, *secondary]:
        key = f"{_normalize_text(item.get('name'))}:{round(float(item.get('lat') or 0.0), 3)}:{round(float(item.get('lon') or 0.0), 3)}"
        existing = by_key.get(key)
        if not existing:
            by_key[key] = item
            continue
        existing_phone = 1 if existing.get("phone") else 0
        next_phone = 1 if item.get("phone") else 0
        existing_score = (existing.get("official_match") is True, existing_phone, -(existing.get("distance_miles") or 9999))
        next_score = (item.get("official_match") is True, next_phone, -(item.get("distance_miles") or 9999))
        if next_score > existing_score:
            by_key[key] = item
    return list(by_key.values())[:limit]


def _sort_service_items(items: list[dict], *, emergency: bool) -> list[dict]:
    def sort_key(item: dict):
        distance = float(item.get("distance_miles") or 9999)
        relevance = int(item.get("relevance_score") or 0)
        phone = 1 if item.get("phone") else 0
        official = 1 if item.get("official_match") else 0
        emergency_ready = 1 if item.get("emergency_ready") else 0
        if emergency:
            return (-relevance, -emergency_ready, -phone, distance, -official, item.get("name") or "")
        return (distance, -official, -phone, item.get("name") or "")
    return sorted(items, key=sort_key)


def _emergency_items(lat: float, lon: float, radius_miles: int, scenario_id: str, settings: Settings) -> tuple[list[dict], str | None]:
    scenario = SCENARIO_DEFS.get(scenario_id) or SCENARIO_DEFS["mechanical"]
    official_matches = _official_items(lat, lon, radius_miles, "all")
    category_ids = scenario.get("categories") or []
    filtered_official = [
        item for item in official_matches
        if not category_ids or any(category in (item.get("service_categories") or []) for category in category_ids)
    ]
    radius_m = radius_miles * 1609
    live_items: list[dict] = []
    provider_warning = None
    for query in scenario.get("queries") or []:
        results, warning = _cached_tomtom_poi_search(query, lat, lon, radius_m, 12, settings)
        if warning and provider_warning is None:
            provider_warning = warning
        for result in results:
            item = _poi_item_from_result(result, lat, lon, scenario_id)
            if item:
                live_items.append(item)
    merged = _merge_items(filtered_official, live_items, limit=MAX_EMERGENCY_RESULTS * 2)
    return _sort_service_items(merged, emergency=True)[:MAX_EMERGENCY_RESULTS], provider_warning


def _category_counts(items: list[dict]) -> list[dict]:
    counts: dict[str, int] = {item["id"]: 0 for item in SERVICE_CATEGORY_DEFS if item["id"] != "all"}
    for item in items:
        for category_id in item.get("service_categories") or []:
            if category_id in counts:
                counts[category_id] += 1
    return [{"id": item["id"], "label": item["label"], "count": counts.get(item["id"], 0)} for item in SERVICE_CATEGORY_DEFS if item["id"] != "all"]

def build_service_map_snapshot(
    snapshot: dict,
    settings: Settings,
    *,
    mode: str = "service",
    vehicle_id: int | None = None,
    radius_miles: int | None = None,
    category_id: str = "all",
    scenario_id: str = "mechanical",
) -> dict:
    vehicle_options = _vehicle_options(snapshot)
    selected_vehicle = _pick_vehicle(vehicle_options, vehicle_id)
    radius = _radius_miles(radius_miles)
    warnings = list(snapshot.get("warnings") or [])

    if not selected_vehicle:
        return {
            "mode": mode,
            "selected_vehicle_id": None,
            "selected_vehicle": None,
            "vehicles": [],
            "items": [],
            "metrics": {"total": 0, "official": 0, "with_phone": 0, "emergency_ready": 0},
            "filters": _service_filters(),
            "category_counts": [],
            "cache": snapshot.get("cache") or {},
            "warnings": warnings + ["No Motive vehicles with live coordinates were available for service search."],
            "source_note": "Connect at least one truck with GPS to use Service Map.",
        }

    lat = float(selected_vehicle.get("lat"))
    lon = float(selected_vehicle.get("lon"))
    if mode == "emergency":
        items, provider_warning = _emergency_items(lat, lon, radius, scenario_id, settings)
        if provider_warning:
            warnings.append("Live emergency POI search is temporarily unavailable. Showing official nearby truck stops instead.")
            source_note = "Emergency view is currently using nearby official truck stops because the live POI provider is unavailable."
        else:
            source_note = "Emergency view combines nearby official truck stops with live emergency POI search."
    else:
        items = _sort_service_items(_official_items(lat, lon, radius, category_id), emergency=False)
        source_note = "Service Map uses the official Love's / Pilot station catalog and local filtering for speed."

    metrics = {
        "total": len(items),
        "official": sum(1 for item in items if item.get("official_match")),
        "with_phone": sum(1 for item in items if item.get("phone")),
        "emergency_ready": sum(1 for item in items if item.get("emergency_ready")),
    }
    return {
        "mode": mode,
        "selected_vehicle_id": selected_vehicle.get("id"),
        "selected_vehicle": selected_vehicle,
        "vehicles": vehicle_options,
        "items": items,
        "metrics": metrics,
        "filters": _service_filters(),
        "category_counts": _category_counts(items),
        "cache": snapshot.get("cache") or {},
        "radius_miles": radius,
        "category_id": category_id,
        "scenario_id": scenario_id,
        "warnings": warnings,
        "source_note": source_note,
        "center": {
            "lat": lat,
            "lon": lon,
            "label": selected_vehicle.get("address") or selected_vehicle.get("number"),
        },
    }


