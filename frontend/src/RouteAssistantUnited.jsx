import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

const RouteMap = lazy(() => import("./RouteMap"));

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const routeColors = ["#1d4ed8", "#0f766e", "#ea580c"];
const defaultFilters = {
  sort_by: "best",
  search: "",
  max_off_route: "50",
  ui_sort: "best"
};

function formatDistance(meters) {
  if (!meters) return "0 mi";
  return `${(meters * 0.000621371).toFixed(1)} mi`;
}

function formatMiles(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${Number(value).toFixed(1)} mi`;
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function getAutoDieselPrice(stop) {
  if (stop.auto_diesel_price !== null && stop.auto_diesel_price !== undefined) {
    const price = Number(stop.auto_diesel_price);
    return Number.isFinite(price) ? price : null;
  }
  return null;
}

function toOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0.00";
  return `$${parsed.toFixed(2)}`;
}

function formatFuelPrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0.000";
  return `$${parsed.toFixed(3)}`;
}

function formatGallons(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0.0 gal";
  return `${parsed.toFixed(1)} gal`;
}

function getStrategyStatusLabel(status) {
  if (status === "planned") return "Smart route ready";
  if (status === "direct") return "No fuel stop needed";
  if (status === "unreachable") return "Needs more fuel range";
  return "Fuel plan";
}

function uniqueRouteStops(routePlan) {
  if (!routePlan) return [];
  const byId = new Map();
  const stops = [
    ...(routePlan.top_fuel_stops || []),
    ...(routePlan.routes || []).flatMap((route) => route.fuel_stops || [])
  ];

  stops.forEach((stop) => {
    const key = stop.id || `${stop.lat},${stop.lon}`;
    const existing = byId.get(key);
    if (!existing || (getAutoDieselPrice(stop) ?? Number.POSITIVE_INFINITY) < (getAutoDieselPrice(existing) ?? Number.POSITIVE_INFINITY)) {
      byId.set(key, stop);
    }
  });

  return [...byId.values()];
}

function clampStopCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(3, parsed));
}

function routeOrderValue(stop) {
  if (stop.origin_miles !== null && stop.origin_miles !== undefined) return Number(stop.origin_miles);
  return Number(stop.detour_distance_meters ?? Number.POSITIVE_INFINITY);
}

function buildStopsRouteLink(routePlan, stops) {
  if (!routePlan || !stops.length) return "";
  const params = new URLSearchParams({
    api: "1",
    origin: routePlan.origin.label || `${routePlan.origin.lat},${routePlan.origin.lon}`,
    destination: routePlan.destination.label || `${routePlan.destination.lat},${routePlan.destination.lon}`,
    travelmode: "driving"
  });
  params.set("waypoints", stops.map((stop) => `${stop.lat},${stop.lon}`).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

async function apiRequest(path, options = {}, token = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

function sortStops(stops, mode) {
  const sorted = [...stops];
  sorted.sort((left, right) => {
    if (mode === "closest") {
      const leftMiles = left.off_route_miles ?? Number.POSITIVE_INFINITY;
      const rightMiles = right.off_route_miles ?? Number.POSITIVE_INFINITY;
      if (leftMiles !== rightMiles) return leftMiles - rightMiles;
    }

    if (mode === "brand") {
      const leftBrand = left.amenity_score ?? 0;
      const rightBrand = right.amenity_score ?? 0;
      if (leftBrand !== rightBrand) return rightBrand - leftBrand;
    }

    const leftScore = left.overall_score ?? 0;
    const rightScore = right.overall_score ?? 0;
    if (leftScore !== rightScore) return rightScore - leftScore;

    return (left.detour_distance_meters ?? Number.POSITIVE_INFINITY) - (right.detour_distance_meters ?? Number.POSITIVE_INFINITY);
  });
  return sorted;
}

function getNetworkTone(stop) {
  const haystack = `${stop.brand || ""} ${stop.name || ""}`.toLowerCase();
  if (haystack.includes("love")) return "network-loves";
  if (haystack.includes("pilot") || haystack.includes("flying j")) return "network-pilot";
  return "network-travel";
}

function getNetworkLabel(stop) {
  const haystack = `${stop.brand || ""} ${stop.name || ""}`.toLowerCase();
  if (haystack.includes("love")) return "Love's";
  if (haystack.includes("pilot") || haystack.includes("flying j")) return "Pilot Flying J";
  return stop.brand || stop.name || "Fuel Stop";
}

function StopCard({ stop, compact = false }) {
  const tone = getNetworkTone(stop);
  const autoDieselPrice = getAutoDieselPrice(stop);
  return (
    <article className={`fuel-stop-card fuel-stop-card-brand ${tone} ${compact ? "fuel-stop-card-compact" : ""}`}>
      <div className="fuel-stop-top">
        <div>
          <span className="network-chip">{getNetworkLabel(stop)}</span>
          <strong>{stop.brand || stop.name}</strong>
          <span>{stop.city}{stop.state_code ? `, ${stop.state_code}` : ""}</span>
          {stop.location_type ? <span>{stop.location_type}{stop.store_number ? ` - #${stop.store_number}` : ""}</span> : stop.store_number ? <span>Store #{stop.store_number}</span> : null}
        </div>
        <div className="fuel-stop-score">
          <strong>{Math.round(stop.overall_score || 0)}</strong>
          <span>rank</span>
        </div>
      </div>

      <p>{stop.address}</p>

      <div className="fuel-price-row fuel-price-row-brand">
        <div>
          <strong>{autoDieselPrice !== null ? `$${autoDieselPrice.toFixed(3)}/gal` : "Auto diesel price not published"}</strong>
          <span>{stop.price_source || "Official Love's/Pilot network page"}</span>
        </div>
        {stop.source_url ? (
          <a className="fuel-source-link" href={stop.source_url} target="_blank" rel="noreferrer">
            Official page
          </a>
        ) : null}
      </div>

      <div className="fuel-stop-stat-grid">
        <span><strong>Auto Diesel</strong>{autoDieselPrice !== null ? `$${autoDieselPrice.toFixed(3)}` : "-"}</span>
        <span><strong>Unleaded</strong>{stop.unleaded_price !== null && stop.unleaded_price !== undefined ? `$${stop.unleaded_price.toFixed(3)}` : "-"}</span>
        <span><strong>Phone</strong>{stop.phone || "-"}</span>
        <span><strong>Store</strong>{stop.store_number || "-"}</span>
      </div>

      <div className="fuel-stop-coords">
        <strong>{stop.official_match ? "Verified" : "Coords"}</strong>
        <span>{stop.official_match ? `Official Love's/Pilot location (${Number(stop.lat).toFixed(5)}, ${Number(stop.lon).toFixed(5)})` : `${Number(stop.lat).toFixed(5)}, ${Number(stop.lon).toFixed(5)}`}</span>
      </div>

      <div className="fuel-stop-stat-grid">
        <span><strong>Off route</strong>{formatMiles(stop.off_route_miles)}</span>
        <span><strong>Detour</strong>{formatDuration(stop.detour_time_seconds)}</span>
        <span><strong>Route match</strong>{Math.round(stop.amenity_score || 0)}</span>
        <span><strong>Distance</strong>{formatDistance(stop.detour_distance_meters)}</span>
      </div>

      {(stop.highway || stop.exit_number || stop.parking_spaces) ? (
        <div className="fuel-stop-coords">
          <strong>Truck Info</strong>
          <span>{[stop.highway, stop.exit_number, stop.parking_spaces].filter(Boolean).join(" / ")}</span>
        </div>
      ) : null}

      {stop.amenities?.length ? (
        <div className="fuel-stop-coords">
          <strong>Services</strong>
          <span>{stop.amenities.slice(0, 8).join(", ")}</span>
        </div>
      ) : null}
    </article>
  );
}

export default function RouteAssistant({ token }) {
  const [routeForm, setRouteForm] = useState({
    origin: "Chicago, IL",
    destination: "Dallas, TX",
    fuel_type: "Auto Diesel",
    vehicle_type: "Truck",
    current_fuel_gallons: "100",
    tank_capacity_gallons: "200",
    mpg: "6.0"
  });
  const [routePlan, setRoutePlan] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [activeFilters, setActiveFilters] = useState(defaultFilters);
  const [cheapStopCount, setCheapStopCount] = useState("3");
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const mapStageRef = useRef(null);
  const fuelStrategy = routePlan?.fuel_strategy || null;
  const fullTankRangePreview = useMemo(() => {
    const capacity = Number(routeForm.tank_capacity_gallons);
    const mpg = Number(routeForm.mpg);
    if (!Number.isFinite(capacity) || !Number.isFinite(mpg) || capacity <= 0 || mpg <= 0) return "-";
    return `${(capacity * mpg).toFixed(0)} mi`;
  }, [routeForm.mpg, routeForm.tank_capacity_gallons]);

  const visibleStops = useMemo(() => {
    if (!routePlan) return [];
    const normalizedSearch = activeFilters.search.trim().toLowerCase();
    const maxOffRoute = Number(activeFilters.max_off_route || 0);
    const sourceStops = routePlan.routes?.[0]?.fuel_stops?.length ? routePlan.routes[0].fuel_stops : routePlan.top_fuel_stops;
    const filtered = sourceStops.filter((stop) => {
      const haystack = `${stop.brand || ""} ${stop.name || ""} ${stop.address || ""} ${stop.city || ""}`.toLowerCase();
      const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
      const matchesOffRoute = !maxOffRoute || (stop.off_route_miles || 0) <= maxOffRoute;
      return matchesSearch && matchesOffRoute;
    });
    return sortStops(filtered, activeFilters.ui_sort);
  }, [activeFilters, routePlan]);

  const bestStops = useMemo(() => sortStops(visibleStops, "best").slice(0, 4), [visibleStops]);
  const closestStops = useMemo(() => sortStops(visibleStops, "closest").slice(0, 4), [visibleStops]);
  const brandPowerStops = useMemo(() => sortStops(visibleStops, "brand").slice(0, 4), [visibleStops]);
  const cheapestAutoDieselStops = useMemo(() => {
    const count = clampStopCount(cheapStopCount);
    return uniqueRouteStops(routePlan)
      .map((stop) => ({ ...stop, autoDieselPlanPrice: getAutoDieselPrice(stop) }))
      .filter((stop) => stop.autoDieselPlanPrice !== null && Number.isFinite(stop.autoDieselPlanPrice))
      .sort((left, right) => {
        if (left.autoDieselPlanPrice !== right.autoDieselPlanPrice) return left.autoDieselPlanPrice - right.autoDieselPlanPrice;
        const leftOffRoute = left.off_route_miles ?? Number.POSITIVE_INFINITY;
        const rightOffRoute = right.off_route_miles ?? Number.POSITIVE_INFINITY;
        if (leftOffRoute !== rightOffRoute) return leftOffRoute - rightOffRoute;
        return routeOrderValue(left) - routeOrderValue(right);
      })
      .slice(0, count);
  }, [cheapStopCount, routePlan]);
  const cheapestStopsRouteOrder = useMemo(
    () => [...cheapestAutoDieselStops].sort((left, right) => routeOrderValue(left) - routeOrderValue(right)),
    [cheapestAutoDieselStops]
  );
  const cheapestStopsRouteLink = useMemo(
    () => buildStopsRouteLink(routePlan, cheapestStopsRouteOrder),
    [cheapestStopsRouteOrder, routePlan]
  );

  useEffect(() => {
    document.body.classList.toggle("map-fullscreen-active", mapFullscreen);

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMapFullscreen(false);
      }
    }

    function handleFullscreenChange() {
      if (!document.fullscreenElement) {
        setMapFullscreen(false);
      }
    }

    const resizeTimers = mapFullscreen
      ? [40, 180, 420].map((delay) => window.setTimeout(() => window.dispatchEvent(new Event("resize")), delay))
      : [];

    if (mapFullscreen) {
      window.addEventListener("keydown", handleEscape);
      document.addEventListener("fullscreenchange", handleFullscreenChange);
    }

    return () => {
      document.body.classList.remove("map-fullscreen-active");
      window.removeEventListener("keydown", handleEscape);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      resizeTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [mapFullscreen]);

  async function toggleMapFullscreen() {
    if (!mapFullscreen) {
      setMapFullscreen(true);
      try {
        await mapStageRef.current?.requestFullscreen?.();
      } catch {
        // CSS fullscreen still works when the browser blocks native fullscreen.
      }
      return;
    }

    setMapFullscreen(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen?.();
      } catch {
        // Ignore browser fullscreen exit errors; CSS state is already reset.
      }
    }
  }

  async function buildRoutePlan(nextFilters = activeFilters) {
    if (!token) return;
    setRouteLoading(true);
    setRouteError("");
    try {
      const payload = {
        ...routeForm,
        current_fuel_gallons: toOptionalNumber(routeForm.current_fuel_gallons),
        tank_capacity_gallons: toOptionalNumber(routeForm.tank_capacity_gallons),
        mpg: toOptionalNumber(routeForm.mpg),
        sort_by: nextFilters.sort_by,
        start_range: "",
        full_range: "",
        amenities: [],
        affiliations: []
      };
      const data = await apiRequest("/navigation/route-assistant", { method: "POST", body: JSON.stringify(payload) }, token);
      setRoutePlan(data);
      setActiveFilters(nextFilters);
    } catch (plannerError) {
      setRoutePlan(null);
      setRouteError(plannerError.message);
    } finally {
      setRouteLoading(false);
    }
  }

  return (
    <section className="panel route-panel route-panel-brand-mode">
      <div className="route-builder route-builder-expanded route-builder-brand-mode">
        <label>
          Origin
          <input type="text" value={routeForm.origin} onChange={(event) => setRouteForm({ ...routeForm, origin: event.target.value })} placeholder="Chicago, IL" />
        </label>
        <label>
          Destination
          <input type="text" value={routeForm.destination} onChange={(event) => setRouteForm({ ...routeForm, destination: event.target.value })} placeholder="Dallas, TX" />
        </label>
        <label>
          Vehicle
          <select value={routeForm.vehicle_type} onChange={(event) => setRouteForm({ ...routeForm, vehicle_type: event.target.value })}>
            <option value="Truck">Truck</option>
            <option value="Car">Car</option>
          </select>
        </label>
        <label>
          Fuel now, gal
          <input type="number" min="0" step="1" value={routeForm.current_fuel_gallons} onChange={(event) => setRouteForm({ ...routeForm, current_fuel_gallons: event.target.value })} placeholder="100" />
        </label>
        <label>
          Tank capacity, gal
          <input type="number" min="1" step="1" value={routeForm.tank_capacity_gallons} onChange={(event) => setRouteForm({ ...routeForm, tank_capacity_gallons: event.target.value })} placeholder="200" />
        </label>
        <label>
          MPG
          <input type="number" min="1" step="0.1" value={routeForm.mpg} onChange={(event) => setRouteForm({ ...routeForm, mpg: event.target.value })} placeholder="6.0" />
        </label>
        <div className="fuel-range-preview">
          <strong>{fullTankRangePreview}</strong>
          <span>full tank range</span>
        </div>
        <label>
          Sort stops
          <select value={draftFilters.sort_by} onChange={(event) => setDraftFilters({ ...draftFilters, sort_by: event.target.value, ui_sort: event.target.value })}>
            <option value="best">Best match</option>
            <option value="distance">Closest to route</option>
            <option value="score">Highest score</option>
          </select>
        </label>
        <button className="primary-button primary-button-brand" onClick={() => buildRoutePlan(draftFilters)} disabled={routeLoading}>
          {routeLoading ? "Building route..." : "Build route"}
        </button>
      </div>

      {routeError ? <div className="notice error inline-notice">{routeError}</div> : null}

      {routePlan ? (
        <div className="route-results">
          <div className="route-main-grid route-main-grid-brand">
            <div ref={mapStageRef} className={`route-map-stage route-map-stage-brand ${mapFullscreen ? "route-map-stage-fullscreen" : ""}`}>
              <div className="route-map-toolbar">
                <div className="route-map-toolbar-copy">
                  <strong>Map</strong>
                  <span>Prices remain visible under each station as you zoom in.</span>
                </div>
                <button className="secondary-button route-map-expand-button" type="button" onClick={toggleMapFullscreen}>
                  {mapFullscreen ? "Close full screen" : "Full screen"}
                </button>
              </div>
              <Suspense fallback={<div className="module-loader">Loading interactive map...</div>}><RouteMap plan={routePlan} isFullscreen={mapFullscreen} /></Suspense>
            </div>

            <aside className="route-side-panel">
              <div className="fuel-board fuel-board-brand-list unitedlane-briefing-card">
                <div className="fuel-board-head unitedlane-head">
                  <div>
                    <h3>{routePlan.assistant_name || "UnitedLane"}</h3>
                    <span>AI notes for the selected station</span>
                  </div>
                  
                </div>
                {routePlan.selected_stop ? (
                  <div className="unitedlane-stop-summary">
                    <strong>{routePlan.selected_stop.brand || routePlan.selected_stop.name}</strong>
                    <span>{routePlan.selected_stop.address}</span>
                    <span>{getAutoDieselPrice(routePlan.selected_stop) !== null ? `$${getAutoDieselPrice(routePlan.selected_stop).toFixed(3)}/gal auto diesel` : "Auto diesel price not published"}</span>
                  </div>
                ) : null}
                <p className="unitedlane-message">{routePlan.assistant_message}</p>
                <div className="unitedlane-actions">
                  {routePlan.station_map_link ? (
                    <a className="primary-button primary-button-brand unitedlane-map-button" href={routePlan.station_map_link} target="_blank" rel="noreferrer">
                      Open stop route
                    </a>
                  ) : null}
                  {routePlan.map_link ? (
                    <a className="fuel-source-link" href={routePlan.map_link} target="_blank" rel="noreferrer">
                      Open route
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="route-options-grid route-options-grid-compact route-options-grid-brand">
                {routePlan.routes.map((route, index) => (
                  <article key={route.id} className="route-option-card route-option-card-brand">
                    <div className="route-option-top">
                      <div className="route-option-id">
                        <span className="legend-swatch" style={{ background: routeColors[index % routeColors.length] }} />
                        <strong>{route.label}</strong>
                      </div>
                      <span>{formatDistance(route.distance_meters)}</span>
                    </div>
                    <div className="route-option-metrics">
                      <span>{formatDuration(route.travel_time_seconds)}</span>
                      <span>Delay {formatDuration(route.traffic_delay_seconds)}</span>
                      <span>{route.fuel_stops.length} branded stops</span>
                    </div>
                  </article>
                ))}
              </div>

              <div className="fuel-filters-card fuel-filters-modern fuel-filters-brand-mode">
                <div className="fuel-board-head">
                  <div>
                    <h3>Route Tuning</h3>
                    <span>{visibleStops.length} branded stops visible</span>
                  </div>
                  
                </div>

                <div className="fuel-filter-grid fuel-filter-grid-two-up">
                  <label>
                    Search brand or city
                    <input type="text" placeholder="pilot, flying j, love's, city" value={draftFilters.search} onChange={(event) => setDraftFilters({ ...draftFilters, search: event.target.value })} />
                  </label>
                  <label>
                    Max off route
                    <select value={draftFilters.max_off_route} onChange={(event) => setDraftFilters({ ...draftFilters, max_off_route: event.target.value })}>
                      <option value="15">15 mi</option>
                      <option value="30">30 mi</option>
                      <option value="50">50 mi</option>
                      <option value="0">Any</option>
                    </select>
                  </label>
                </div>

                <button className="primary-button filter-apply-button primary-button-brand" onClick={() => setActiveFilters(draftFilters)}>
                  Apply View Filter
                </button>

                <p className="fuel-filter-note">{routePlan.price_support}</p>
              </div>
            </aside>
          </div>

          {fuelStrategy ? (
            <section className={`fuel-board smart-fuel-card smart-fuel-${fuelStrategy.status}`}>
              <div className="fuel-board-head smart-fuel-head">
                <div>
                  <h3>Smart fuel plan</h3>
                  <span>The system uses tank gallons, MPG, Auto Diesel prices, detour time, route reachability, and a small safety reserve. Max 3 stops.</span>
                </div>
                <strong className="smart-fuel-status">{getStrategyStatusLabel(fuelStrategy.status)}</strong>
              </div>

              <div className="smart-fuel-metrics">
                <span><strong>{fuelStrategy.stop_count}/{fuelStrategy.max_stop_count || 3}</strong> stops</span>
                <span><strong>{formatCurrency(fuelStrategy.estimated_fuel_cost)}</strong> fuel to buy</span>
                <span><strong>{formatGallons(fuelStrategy.required_purchase_gallons)}</strong> planned purchase</span>
                <span><strong>{formatMiles(fuelStrategy.starting_range_miles)}</strong> start range</span>
                <span><strong>{formatMiles(fuelStrategy.full_tank_range_miles)}</strong> full tank</span>
                <span><strong>{formatDuration(fuelStrategy.estimated_total_time_seconds)}</strong> total time</span>
              </div>

              {fuelStrategy.safety_buffer_policy ? <p className="smart-fuel-policy">{fuelStrategy.safety_buffer_policy}</p> : null}

              {fuelStrategy.warnings?.length ? (
                <div className="smart-fuel-warnings">
                  {fuelStrategy.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                </div>
              ) : null}

              {fuelStrategy.stops?.length ? (
                <>
                  <div className="smart-fuel-path">
                    <span className="cheap-route-point">A. {routePlan.origin.label}</span>
                    {fuelStrategy.stops.map((item) => (
                      <span key={`smart-path-${item.sequence}-${item.stop.id}`} className="cheap-route-point">
                        {item.sequence}. Buy {formatGallons(item.gallons_to_buy)} at {item.stop.brand || item.stop.name} - {formatCurrency(item.estimated_cost)}
                      </span>
                    ))}
                    <span className="cheap-route-point">B. {routePlan.destination.label}</span>
                  </div>

                  <div className="smart-fuel-stop-grid">
                    {fuelStrategy.stops.map((item) => (
                      <article key={`smart-stop-${item.sequence}-${item.stop.id}`} className="smart-fuel-stop-card">
                        <span>Stop #{item.sequence} at mile {item.route_miles}</span>
                        <strong>{formatGallons(item.gallons_to_buy)} / {formatCurrency(item.estimated_cost)}</strong>
                        <p>{item.stop.brand || item.stop.name}</p>
                        <small>{item.stop.address}</small>
                        <div className="smart-fuel-card-stats">
                          <span>Auto Diesel {formatFuelPrice(item.auto_diesel_price)}/gal</span>
                          <span>Before {formatGallons(item.fuel_before_gallons)}</span>
                          <span>After {formatGallons(item.fuel_after_gallons)}</span>
                          <span>Reserve {formatMiles(item.safety_buffer_miles)}</span>
                          <span>Next {formatMiles(item.miles_to_next)} to {item.next_target_label}</span>
                        </div>
                        <em>{item.reason}</em>
                      </article>
                    ))}
                  </div>

                  {fuelStrategy.map_link ? (
                    <a className="primary-button primary-button-brand smart-fuel-map-link" href={fuelStrategy.map_link} target="_blank" rel="noreferrer">
                      Open smart route with stops
                    </a>
                  ) : null}
                </>
              ) : (
                <div className="empty-route-card">
                  {fuelStrategy.status === "direct" ? "Current fuel is enough to reach the destination without buying Auto Diesel." : "The system could not build a safe Auto Diesel stop plan with the current tank inputs."}
                </div>
              )}
            </section>
          ) : null}

          <section className="fuel-board cheapest-route-card">
            <div className="fuel-board-head cheapest-route-head">
              <div>
                <h3>Cheapest auto diesel route</h3>
                <span>Pick up to 3 fuel stops. We choose the lowest Auto Diesel prices across the route.</span>
              </div>
              <label className="cheap-route-count">
                Stops
                <input
                  type="number"
                  min="1"
                  max="3"
                  value={cheapStopCount}
                  onChange={(event) => setCheapStopCount(event.target.value)}
                />
              </label>
            </div>

            {cheapestAutoDieselStops.length ? (
              <>
                <div className="cheap-route-summary">
                  <strong>{cheapestAutoDieselStops.length} cheapest auto diesel stops selected</strong>
                  <span>Selected stops are ordered from A to B for the route link.</span>
                  {cheapestStopsRouteLink ? (
                    <a className="primary-button primary-button-brand" href={cheapestStopsRouteLink} target="_blank" rel="noreferrer">
                      Open route with stops
                    </a>
                  ) : null}
                </div>

                <div className="cheap-route-path">
                  <span className="cheap-route-point">A. {routePlan.origin.label}</span>
                  {cheapestStopsRouteOrder.map((stop, index) => (
                    <span key={`cheap-path-${stop.id}`} className="cheap-route-point">
                      {index + 1}. {stop.brand || stop.name} - ${stop.autoDieselPlanPrice.toFixed(3)}/gal
                    </span>
                  ))}
                  <span className="cheap-route-point">B. {routePlan.destination.label}</span>
                </div>

                <div className="cheap-route-stop-grid">
                  {cheapestAutoDieselStops.map((stop, index) => (
                    <article key={`cheap-${stop.id}`} className="cheap-route-stop-card">
                      <span>Price rank #{index + 1}</span>
                      <strong>${stop.autoDieselPlanPrice.toFixed(3)}/gal</strong>
                      <p>{stop.brand || stop.name}</p>
                      <small>{stop.address}</small>
                      <em>{formatMiles(stop.off_route_miles)} off route</em>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-route-card">No published auto diesel prices found on this route yet.</div>
            )}
          </section>

          <div className="fuel-showcase-grid fuel-showcase-grid-brand">
            <section className="fuel-board feature-board feature-board-brand">
              <div className="fuel-board-head">
                <h3>Best Network Hits</h3>
                <span>Best overall matches</span>
              </div>
              <div className="fuel-stop-grid">
                {bestStops.length ? bestStops.map((stop) => <StopCard key={`best-${stop.id}`} stop={stop} compact />) : <div className="empty-route-card">No brand hits on this route.</div>}
              </div>
            </section>

            <section className="fuel-board feature-board feature-board-brand">
              <div className="fuel-board-head">
                <h3>Closest Pull-offs</h3>
                <span>Lowest detour distance first</span>
              </div>
              <div className="fuel-stop-grid">
                {closestStops.length ? closestStops.map((stop) => <StopCard key={`close-${stop.id}`} stop={stop} compact />) : <div className="empty-route-card">No close branded stops found.</div>}
              </div>
            </section>

            <section className="fuel-board feature-board feature-board-brand">
              <div className="fuel-board-head">
                <h3>Brand Power</h3>
                <span>Most explicit Pilot and Love's matches</span>
              </div>
              <div className="fuel-stop-grid">
                {brandPowerStops.length ? brandPowerStops.map((stop) => <StopCard key={`brand-${stop.id}`} stop={stop} compact />) : <div className="empty-route-card">No exact brand-family matches found.</div>}
              </div>
            </section>
          </div>

          <div className="fuel-board fuel-board-brand-list">
            <div className="fuel-board-head">
              <h3>All Network Stops</h3>
              <span>Official Love's and Pilot locations on this route.</span>
            </div>
            <div className="fuel-stop-grid fuel-stop-grid-expanded">
              {visibleStops.length ? visibleStops.map((stop) => <StopCard key={stop.id} stop={stop} />) : <div className="empty-route-card">No network stops matched this view.</div>}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-route-card empty-route-card-brand">Enter an origin and destination to review official stops, pricing, and route details.</div>
      )}
    </section>
  );
}



