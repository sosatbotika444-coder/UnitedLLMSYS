import { useEffect, useMemo, useState } from "react";
import RouteMap from "./RouteMap";

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
          <strong>{stop.price !== null && stop.price !== undefined ? `$${stop.price.toFixed(3)}/gal` : "Diesel price not published"}</strong>
          <span>{stop.price_source || "Official Love's/Pilot network page"}</span>
        </div>
        {stop.source_url ? (
          <a className="fuel-source-link" href={stop.source_url} target="_blank" rel="noreferrer">
            Official page
          </a>
        ) : null}
      </div>

      <div className="fuel-stop-stat-grid">
        <span><strong>Diesel</strong>{stop.diesel_price !== null && stop.diesel_price !== undefined ? `$${stop.diesel_price.toFixed(3)}` : "-"}</span>
        <span><strong>Auto Diesel</strong>{stop.auto_diesel_price !== null && stop.auto_diesel_price !== undefined ? `$${stop.auto_diesel_price.toFixed(3)}` : "-"}</span>
        <span><strong>Unleaded</strong>{stop.unleaded_price !== null && stop.unleaded_price !== undefined ? `$${stop.unleaded_price.toFixed(3)}` : "-"}</span>
        <span><strong>Phone</strong>{stop.phone || "-"}</span>
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
    fuel_type: "Diesel",
    vehicle_type: "Truck"
  });
  const [routePlan, setRoutePlan] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [activeFilters, setActiveFilters] = useState(defaultFilters);
  const [mapFullscreen, setMapFullscreen] = useState(false);

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

  useEffect(() => {
    document.body.classList.toggle("map-fullscreen-active", mapFullscreen);

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMapFullscreen(false);
      }
    }

    if (mapFullscreen) {
      window.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.body.classList.remove("map-fullscreen-active");
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mapFullscreen]);

  async function buildRoutePlan(nextFilters = activeFilters) {
    if (!token) return;
    setRouteLoading(true);
    setRouteError("");
    try {
      const payload = {
        ...routeForm,
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
      <div className="route-brand-hero route-brand-hero-quiet">
        <div className="route-brand-copy">
          <h2>Route review</h2>
          <p>Build a route, inspect official Love&apos;s and Pilot stops, compare diesel pricing on the map, and review the best pull-offs without extra clutter.</p>
        </div>
      </div>

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
          Sort stops
          <select value={draftFilters.sort_by} onChange={(event) => setDraftFilters({ ...draftFilters, sort_by: event.target.value, ui_sort: event.target.value })}>
            <option value="best">Best match</option>
            <option value="distance">Closest to route</option>
            <option value="score">Highest score</option>
          </select>
        </label>
        <button className="primary-button primary-button-brand" onClick={() => buildRoutePlan(draftFilters)} disabled={routeLoading}>
          {routeLoading ? "Preparing route..." : "Build Route"}
        </button>
      </div>

      {routeError ? <div className="notice error inline-notice">{routeError}</div> : null}

      {routePlan ? (
        <div className="route-results">
          <div className="route-main-grid route-main-grid-brand">
            <div className={`route-map-stage route-map-stage-brand ${mapFullscreen ? "route-map-stage-fullscreen" : ""}`}>
              <div className="route-map-toolbar">
                <div className="route-map-toolbar-copy">
                  <strong>Map</strong>
                  <span>Prices remain visible under each station as you zoom in.</span>
                </div>
                <button className="secondary-button route-map-expand-button" type="button" onClick={() => setMapFullscreen((value) => !value)}>
                  {mapFullscreen ? "Exit Full Screen" : "Open Full Screen"}
                </button>
              </div>
              <RouteMap plan={routePlan} isFullscreen={mapFullscreen} />
            </div>

            <aside className="route-side-panel">
              <div className="fuel-board fuel-board-brand-list unitedlane-briefing-card">
                <div className="fuel-board-head unitedlane-head">
                  <div>
                    <h3>{routePlan.assistant_name || "UnitedLane"}</h3>
                    <span>Route notes for the selected stop</span>
                  </div>
                  
                </div>
                {routePlan.selected_stop ? (
                  <div className="unitedlane-stop-summary">
                    <strong>{routePlan.selected_stop.brand || routePlan.selected_stop.name}</strong>
                    <span>{routePlan.selected_stop.address}</span>
                    <span>{routePlan.selected_stop.price !== null && routePlan.selected_stop.price !== undefined ? `$${routePlan.selected_stop.price.toFixed(3)}/gal` : "Price not published"}</span>
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



