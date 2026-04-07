import { useMemo, useState } from "react";
import RouteMap from "./RouteMap";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const routeColors = ["#1d4ed8", "#0f766e", "#ea580c"];
const brandSignals = [
  "pilot",
  "pilot travel center",
  "flying j",
  "flying j travel center",
  "pilot flying j",
  "love's",
  "loves",
  "love's travel stop",
  "loves travel stop"
];

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
          <span>{stop.price_source || "TomTom + official network pages"}</span>
        </div>
        {stop.source_url ? (
          <a className="fuel-source-link" href={stop.source_url} target="_blank" rel="noreferrer">
            Official page
          </a>
        ) : null}
      </div>

      <div className="fuel-stop-coords">
        <strong>Coords</strong>
        <span>{Number(stop.lat).toFixed(5)}, {Number(stop.lon).toFixed(5)}</span>
      </div>

      <div className="fuel-stop-stat-grid">
        <span><strong>Off route</strong>{formatMiles(stop.off_route_miles)}</span>
        <span><strong>Detour</strong>{formatDuration(stop.detour_time_seconds)}</span>
        <span><strong>Route match</strong>{Math.round(stop.amenity_score || 0)}</span>
        <span><strong>Distance</strong>{formatDistance(stop.detour_distance_meters)}</span>
      </div>
    </article>
  );
}

export default function RouteAssistant({ token }) {
  const [routeForm, setRouteForm] = useState({
    origin: "Chicago, IL",
    destination: "Dallas, TX",
    fuel_type: "Auto Diesel",
    vehicle_type: "Truck"
  });
  const [routePlan, setRoutePlan] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [activeFilters, setActiveFilters] = useState(defaultFilters);

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
      <div className="route-brand-hero">
        <div className="route-brand-copy">
          <span className="brand-signal-pill">Brand-Only Network Scan</span>
          <h2>Strict Love's and Pilot Flying J route finder</h2>
          <p>We search with TomTom only, keep only strict Love&apos;s and Pilot/Flying J matches, show official auto diesel price when published, and otherwise mark the stop as no-price with exact coordinates.</p>
        </div>
        <div className="brand-keyword-cloud">
          {brandSignals.map((signal) => (
            <span key={signal}>{signal}</span>
          ))}
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
          Network sort
          <select value={draftFilters.sort_by} onChange={(event) => setDraftFilters({ ...draftFilters, sort_by: event.target.value, ui_sort: event.target.value })}>
            <option value="best">Best network match</option>
            <option value="distance">Closest to route</option>
            <option value="score">Highest route score</option>
          </select>
        </label>
        <button className="primary-button primary-button-brand" onClick={() => buildRoutePlan(draftFilters)} disabled={routeLoading}>
          {routeLoading ? "Scanning networks..." : "Scan Networks"}
        </button>
      </div>

      {routeError ? <div className="notice error inline-notice">{routeError}</div> : null}

      {routePlan ? (
        <div className="route-results">
          <div className="route-main-grid route-main-grid-brand">
            <div className="route-map-stage route-map-stage-brand">
              <RouteMap plan={routePlan} />
            </div>

            <aside className="route-side-panel">
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
                  <span className="source-pill">{routePlan.data_source}</span>
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
                <span>Strongest keyword and route score</span>
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
              <span>Only strict Pilot Flying J and Love's matches.</span>
            </div>
            <div className="fuel-stop-grid fuel-stop-grid-expanded">
              {visibleStops.length ? visibleStops.map((stop) => <StopCard key={stop.id} stop={stop} />) : <div className="empty-route-card">No network stops matched this view.</div>}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-route-card empty-route-card-brand">Enter origin and destination to scan only strict Pilot Flying J and Love's stops along the route.</div>
      )}
    </section>
  );
}
