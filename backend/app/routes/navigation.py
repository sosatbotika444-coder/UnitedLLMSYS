import json
import ssl
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

import certifi
from fastapi import APIRouter, Depends, HTTPException, status

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
FUEL_CATEGORY_SET = "7311"
FUEL_QUERY = "petrol station"
ALONG_ROUTE_PAGE_SIZE = 100
ALONG_ROUTE_MAX_RESULTS = 500
NEARBY_SCAN_RADIUS_METERS = 12000
NEARBY_SCAN_POINT_COUNT = 18
OILPRICE_BASE_URL = "https://api.oilpriceapi.com/v1"


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


def http_json(url: str, method: str = "GET", body: dict | None = None, headers: dict | None = None):
    data = None
    request_headers = headers.copy() if headers else {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        request_headers["Content-Type"] = "application/json"

    request = Request(url, data=data, headers=request_headers, method=method)

    try:
        with urlopen(request, timeout=20, context=ssl_context) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Navigation provider error: {exc}") from exc


def geocode_address(query: str) -> GeocodedPoint:
    encoded_query = quote(query)
    params = urlencode({"key": settings.tomtom_api_key, "limit": 1})
    url = f"https://api.tomtom.com/search/2/geocode/{encoded_query}.json?{params}"
    data = http_json(url)
    results = data.get("results", [])
    if not results:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Address not found: {query}")

    first = results[0]
    position = first.get("position", {})
    address = first.get("address", {})
    return GeocodedPoint(
        label=address.get("freeformAddress", query),
        lat=position.get("lat"),
        lon=position.get("lon"),
    )


def build_map_link(origin: str, destination: str) -> str:
    return (
        "https://www.google.com/maps/dir/?api=1"
        f"&origin={quote(origin)}&destination={quote(destination)}&travelmode=driving"
    )


def get_routes(origin: GeocodedPoint, destination: GeocodedPoint, vehicle_type: str):
    route_points = f"{origin.lat},{origin.lon}:{destination.lat},{destination.lon}"
    params = urlencode(
        {
            "key": settings.tomtom_api_key,
            "maxAlternatives": 2,
            "routeRepresentation": "polyline",
            "computeTravelTimeFor": "all",
            "travelMode": "truck" if vehicle_type.lower() == "truck" else "car",
        }
    )
    url = f"https://api.tomtom.com/routing/1/calculateRoute/{route_points}/json?{params}"
    data = http_json(url)
    return data.get("routes", [])


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


def to_fuel_stop(item: dict) -> FuelStop:
    poi = item.get("poi", {})
    address = item.get("address", {})
    position = item.get("position", {})
    brands = poi.get("brands", []) or []
    brand_name = brands[0].get("name") if brands else None
    display_brand = brand_name or "Independent"
    return FuelStop(
        id=str(item.get("id", poi.get("name", "station"))),
        name=poi.get("name", display_brand or "Fuel Stop"),
        brand=display_brand,
        address=address.get("freeformAddress", "Address unavailable"),
        state_code=address.get("countrySubdivisionCode"),
        lat=position.get("lat"),
        lon=position.get("lon"),
        detour_distance_meters=item.get("detourDistance"),
        detour_time_seconds=item.get("detourTime"),
        fuel_types=poi.get("fuelTypes", []),
        price=None,
        price_source=None,
    )


def sample_scan_points(route_points: list[RoutePoint]) -> list[RoutePoint]:
    if len(route_points) <= NEARBY_SCAN_POINT_COUNT:
        return route_points

    step = max(1, len(route_points) // NEARBY_SCAN_POINT_COUNT)
    sampled = route_points[::step]
    if sampled[-1] != route_points[-1]:
        sampled.append(route_points[-1])
    return sampled


def merge_stop(stops_by_id: dict[str, FuelStop], stop: FuelStop):
    existing = stops_by_id.get(stop.id)
    if not existing:
        stops_by_id[stop.id] = stop
        return

    current_detour = existing.detour_time_seconds if existing.detour_time_seconds is not None else 999999
    next_detour = stop.detour_time_seconds if stop.detour_time_seconds is not None else 999999
    if next_detour < current_detour:
        stops_by_id[stop.id] = stop


def search_nearby_fuel_stops(route_points: list[RoutePoint], stops_by_id: dict[str, FuelStop]):
    for point in sample_scan_points(route_points):
        params = urlencode(
            {
                "key": settings.tomtom_api_key,
                "lat": point.lat,
                "lon": point.lon,
                "radius": NEARBY_SCAN_RADIUS_METERS,
                "limit": 100,
                "categorySet": FUEL_CATEGORY_SET,
            }
        )
        url = f"https://api.tomtom.com/search/2/nearbySearch/.json?{params}"
        data = http_json(url)
        for item in data.get("results", []):
            merge_stop(stops_by_id, to_fuel_stop(item))


def get_fuel_stops(route_points: list[RoutePoint]) -> list[FuelStop]:
    if len(route_points) < 2:
        return []

    body = {"route": {"points": [point.model_dump() for point in route_points]}}
    stops_by_id: dict[str, FuelStop] = {}
    offset = 0

    while offset < ALONG_ROUTE_MAX_RESULTS:
        params = urlencode(
            {
                "key": settings.tomtom_api_key,
                "limit": ALONG_ROUTE_PAGE_SIZE,
                "offset": offset,
                "maxDetourTime": 1800,
                "categorySet": FUEL_CATEGORY_SET,
                "sortBy": "detourTime",
            }
        )
        encoded_query = quote(FUEL_QUERY)
        url = f"https://api.tomtom.com/search/2/searchAlongRoute/{encoded_query}.json?{params}"
        data = http_json(url, method="POST", body=body)
        batch = data.get("results", [])

        if not batch:
            break

        for item in batch:
            merge_stop(stops_by_id, to_fuel_stop(item))

        if len(batch) < ALONG_ROUTE_PAGE_SIZE:
            break

        offset += ALONG_ROUTE_PAGE_SIZE

    search_nearby_fuel_stops(route_points, stops_by_id)

    return sorted(
        stops_by_id.values(),
        key=lambda stop: (stop.detour_time_seconds or 999999, stop.detour_distance_meters or 999999, stop.name.lower()),
    )[:ALONG_ROUTE_MAX_RESULTS]


def get_state_diesel_average(state_code: str) -> tuple[float | None, str | None]:
    if not settings.oilprice_api_key or not state_code:
        return None, None

    params = urlencode({"state": state_code})
    url = f"{OILPRICE_BASE_URL}/diesel-prices?{params}"
    data = http_json(url, headers={"Authorization": f"Token {settings.oilprice_api_key}"})
    diesel_data = data.get("data", {})
    regional = diesel_data.get("regional_average", {})
    price = regional.get("price")
    if price is None:
        return None, None

    source_name = regional.get("source", "regional average").upper()
    granularity = regional.get("granularity", "state")
    return float(price), f"OilPriceAPI {granularity} diesel avg ({source_name})"


def enrich_stops_with_diesel_prices(stops: list[FuelStop], fuel_type: str):
    if fuel_type.lower() != "diesel":
        return

    states = sorted({stop.state_code for stop in stops if stop.state_code})
    if not states or not settings.oilprice_api_key:
        return

    state_prices: dict[str, tuple[float | None, str | None]] = {}
    for state_code in states:
        state_prices[state_code] = get_state_diesel_average(state_code)

    for stop in stops:
        if not stop.state_code:
            continue
        price, source = state_prices.get(stop.state_code, (None, None))
        if price is not None:
            stop.price = price
            stop.price_source = source


@router.get("/tomtom-capabilities", response_model=TomTomCapabilityCatalog)
def tomtom_capabilities(current_user: User = Depends(get_current_user)):
    live = sum(1 for item in TOMTOM_CAPABILITIES if item.status == "Live")
    ready = sum(1 for item in TOMTOM_CAPABILITIES if item.status == "Ready")
    requires_access = sum(1 for item in TOMTOM_CAPABILITIES if item.status == "Requires Access")
    return TomTomCapabilityCatalog(
        total=len(TOMTOM_CAPABILITIES),
        live=live,
        ready=ready,
        requires_access=requires_access,
        capabilities=TOMTOM_CAPABILITIES,
    )


@router.post("/route-assistant", response_model=RouteAssistantResponse)
def route_assistant(payload: RouteAssistantRequest, current_user: User = Depends(get_current_user)):
    if not settings.tomtom_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="TOMTOM_API_KEY is missing on the backend",
        )

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
        fuel_stops = get_fuel_stops(route_points)
        enrich_stops_with_diesel_prices(fuel_stops, payload.fuel_type)

        for stop in fuel_stops:
            merge_stop(combined_stops, stop)

        routes.append(
            RouteOption(
                id=f"route-{index}",
                label=f"Option {index}",
                distance_meters=int(summary.get("lengthInMeters", 0)),
                travel_time_seconds=int(summary.get("travelTimeInSeconds", 0)),
                traffic_delay_seconds=int(summary.get("trafficDelayInSeconds", 0)),
                points=route_points,
                fuel_stops=fuel_stops,
            )
        )

    top_fuel_stops = sorted(
        combined_stops.values(),
        key=lambda stop: (
            stop.price if stop.price is not None else 999999,
            stop.detour_time_seconds or 999999,
            stop.detour_distance_meters or 999999,
            stop.name.lower(),
        ),
    )[:24]

    price_support = "Live route stations from TomTom."
    if settings.oilprice_api_key and payload.fuel_type.lower() == "diesel":
        price_support = "Diesel prices enriched with OilPriceAPI state averages. These are regional averages, not exact station pump prices."
    elif settings.oilprice_api_key:
        price_support = "OilPriceAPI key detected, but only diesel regional averages are wired right now."
    else:
        price_support = "Live station price feed not configured. Routes and nearby fuel stops are live; station pricing requires an external provider."

    return RouteAssistantResponse(
        origin=origin,
        destination=destination,
        routes=routes,
        top_fuel_stops=top_fuel_stops,
        price_support=price_support,
        map_link=build_map_link(origin.label, destination.label),
    )