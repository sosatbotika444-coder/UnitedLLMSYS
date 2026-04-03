import { useMemo, useState } from "react";
import RouteMap from "./RouteMap";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";
const routeColors = ["#1d4ed8", "#0f766e", "#ea580c"];

function formatDistance(meters) {
  if (!meters) return "0 mi";
  return `${(meters * 0.000621371).toFixed(1)} mi`;
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
  const [stopSearch, setStopSearch] = useState("");
  const [stopSort, setStopSort] = useState("best");
  const [maxDetourMinutes, setMaxDetourMinutes] = useState("30");
  const [pricedOnly, setPricedOnly] = useState(false);

  const visibleStops = useMemo(() => {
    if (!routePlan) return [];

    const maxMinutes = Number(maxDetourMinutes);
    const normalizedSearch = stopSearch.trim().toLowerCase();

    const filtered = routePlan.top_fuel_stops.filter((stop) => {
      const haystack = `${stop.brand || ""} ${stop.name || ""} ${stop.address || ""}`.toLowerCase();
      const detourMinutes = (stop.detour_time_seconds || 0) / 60;
      const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
      const matchesDetour = !maxMinutes || detourMinutes <= maxMinutes;
      const matchesPrice = !pricedOnly || stop.price;
      return matchesSearch && matchesDetour && matchesPrice;
    });

    return [...filtered].sort((left, right) => {
      if (stopSort === "cheapest") {
        const leftPrice = left.price ?? Number.POSITIVE_INFINITY;
        const rightPrice = right.price ?? Number.POSITIVE_INFINITY;
        if (leftPrice !== rightPrice) {
          return leftPrice - rightPrice;
        }
      }

      if (stopSort === "nearest") {
        const leftDetour = left.detour_time_seconds ?? Number.POSITIVE_INFINITY;
        const rightDetour = right.detour_time_seconds ?? Number.POSITIVE_INFINITY;
        if (leftDetour !== rightDetour) {
          return leftDetour - rightDetour;
        }
      }

      const leftScore = left.price ?? Number.POSITIVE_INFINITY;
      const rightScore = right.price ?? Number.POSITIVE_INFINITY;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }

      return (left.detour_time_seconds ?? Number.POSITIVE_INFINITY) - (right.detour_time_seconds ?? Number.POSITIVE_INFINITY);
    });
  }, [maxDetourMinutes, pricedOnly, routePlan, stopSearch, stopSort]);

  async function buildRoutePlan() {
    if (!token) return;

    setRouteLoading(true);
    setRouteError("");

    try {
      const data = await apiRequest(
        "/navigation/route-assistant",
        {
          method: "POST",
          body: JSON.stringify(routeForm)
        },
        token
      );
      setRoutePlan(data);
    } catch (plannerError) {
      setRoutePlan(null);
      setRouteError(plannerError.message);
    } finally {
      setRouteLoading(false);
    }
  }

  return (
    <section className="panel route-panel">
      <div className="panel-head route-panel-head">
        <div>
          <h2>Fuel Route Assistant</h2>
          <span>Large live map with nearby stops and quick price search.</span>
        </div>
        {routePlan?.map_link ? (
          <a className="map-link" href={routePlan.map_link} target="_blank" rel="noreferrer">
            Open in Google Maps
          </a>
        ) : null}
      </div>

      <div className="route-builder">
        <label>
          Point A
          <input
            type="text"
            value={routeForm.origin}
            onChange={(event) => setRouteForm({ ...routeForm, origin: event.target.value })}
            placeholder="Origin address or city"
          />
        </label>
        <label>
          Point B
          <input
            type="text"
            value={routeForm.destination}
            onChange={(event) => setRouteForm({ ...routeForm, destination: event.target.value })}
            placeholder="Destination address or city"
          />
        </label>
        <label>
          Vehicle
          <select value={routeForm.vehicle_type} onChange={(event) => setRouteForm({ ...routeForm, vehicle_type: event.target.value })}>
            <option value="Truck">Truck</option>
            <option value="Car">Car</option>
          </select>
        </label>
        <label>
          Fuel
          <select value={routeForm.fuel_type} onChange={(event) => setRouteForm({ ...routeForm, fuel_type: event.target.value })}>
            <option value="Diesel">Diesel</option>
            <option value="Petrol">Petrol</option>
            <option value="LPG">LPG</option>
          </select>
        </label>
        <button className="primary-button" onClick={buildRoutePlan} disabled={routeLoading}>
          {routeLoading ? "Calculating..." : "Build Routes"}
        </button>
      </div>

      {routeError ? <div className="notice error inline-notice">{routeError}</div> : null}

      {routePlan ? (
        <div className="route-results">
          <div className="route-main-grid">
            <div className="route-map-stage">
              <RouteMap plan={routePlan} />
            </div>

            <aside className="route-side-panel">
              <div className="route-options-grid route-options-grid-compact">
                {routePlan.routes.map((route, index) => (
                  <article key={route.id} className="route-option-card">
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
                      <span>{route.fuel_stops.length} stops</span>
                    </div>
                  </article>
                ))}
              </div>

              <div className="fuel-filters-card">
                <div className="fuel-board-head">
                  <h3>Find Nearby Fuel</h3>
                  <span>{visibleStops.length} shown</span>
                </div>

                <div className="fuel-filter-grid">
                  <label>
                    Search stop
                    <input
                      type="text"
                      placeholder="Brand, address, city"
                      value={stopSearch}
                      onChange={(event) => setStopSearch(event.target.value)}
                    />
                  </label>

                  <label>
                    Sort by
                    <select value={stopSort} onChange={(event) => setStopSort(event.target.value)}>
                      <option value="best">Best match</option>
                      <option value="cheapest">Lowest price</option>
                      <option value="nearest">Nearest detour</option>
                    </select>
                  </label>

                  <label>
                    Max detour
                    <select value={maxDetourMinutes} onChange={(event) => setMaxDetourMinutes(event.target.value)}>
                      <option value="15">15 min</option>
                      <option value="30">30 min</option>
                      <option value="45">45 min</option>
                      <option value="0">Any</option>
                    </select>
                  </label>
                </div>

                <label className="price-toggle">
                  <input type="checkbox" checked={pricedOnly} onChange={(event) => setPricedOnly(event.target.checked)} />
                  <span>Only show stations with price data</span>
                </label>

                <p className="fuel-filter-note">{routePlan.price_support}</p>
              </div>
            </aside>
          </div>

          <div className="fuel-board">
            <div className="fuel-board-head">
              <h3>Nearby Fuel Stops</h3>
              <span>Search by price or choose the closest detour.</span>
            </div>
            <div className="fuel-stop-grid fuel-stop-grid-expanded">
              {visibleStops.length ? (
                visibleStops.map((stop) => (
                  <article key={stop.id} className="fuel-stop-card">
                    <div className="fuel-stop-top">
                      <strong>{stop.brand || stop.name}</strong>
                      <span>{formatDuration(stop.detour_time_seconds)}</span>
                    </div>
                    <p>{stop.address}</p>
                    {stop.price ? (
                      <div className="fuel-price-row">
                        <strong>${stop.price.toFixed(3)}/gal</strong>
                        <span>{stop.price_source || "Price attached"}</span>
                      </div>
                    ) : (
                      <div className="fuel-price-row fuel-price-row-muted">
                        <strong>No live price</strong>
                        <span>Try a wider search or disable price-only mode</span>
                      </div>
                    )}
                    <div className="fuel-stop-meta">
                      <span>{formatDistance(stop.detour_distance_meters)}</span>
                      <span>{stop.fuel_types?.length ? stop.fuel_types.join(", ") : routeForm.fuel_type}</span>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-route-card">No nearby stations matched the current price and distance filters.</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-route-card">Enter Point A and Point B to build route options and search nearby fuel stops.</div>
      )}
    </section>
  );
}
