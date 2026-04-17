import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";

async function apiRequest(path, options = {}, token = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }
  return data;
}

function formatDateTime(value) {
  if (!value) return "Unknown date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function formatDateOnly(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function formatMilesFromMeters(value) {
  const meters = Number(value);
  if (!Number.isFinite(meters) || meters <= 0) return "0 mi";
  return `${(meters / 1609.344).toFixed(meters > 160934 ? 0 : 1)} mi`;
}

function formatDuration(seconds) {
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0 min";
  const hours = Math.floor(parsed / 3600);
  const minutes = Math.round((parsed % 3600) / 60);
  if (!hours) return `${minutes} min`;
  return `${hours}h ${minutes}m`;
}

function formatGallons(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "Not set";
  return `${parsed.toFixed(1)} gal`;
}

function formatPrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "No price";
  return `$${parsed.toFixed(3)}/gal`;
}

function accountName(user) {
  if (!user) return "Unknown account";
  return user.full_name || user.username || user.email || "Unknown account";
}

function stationName(stop) {
  if (!stop) return "No selected stop";
  return stop.brand || stop.name || "Fuel stop";
}

function routeTitle(item) {
  if (!item) return "Route";
  return [item.origin_label || item.origin_query, item.destination_label || item.destination_query].filter(Boolean).join(" to ") || "Route";
}

export default function RouteHistoryPanel({ token, active = true }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!active || !token) return undefined;
    const controller = new AbortController();
    const delay = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ limit: "500" });
        if (search.trim()) params.set("search", search.trim());
        if (dateFrom) params.set("date_from", dateFrom);
        if (dateTo) params.set("date_to", dateTo);
        const data = await apiRequest(`/navigation/route-history?${params.toString()}`, { signal: controller.signal }, token);
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(Number(data.total) || 0);
      } catch (historyError) {
        if (historyError.name !== "AbortError") {
          setError(historyError.message || "Could not load route history.");
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, search.trim() ? 300 : 0);

    return () => {
      window.clearTimeout(delay);
      controller.abort();
    };
  }, [active, token, search, dateFrom, dateTo, refreshTick]);

  useEffect(() => {
    if (!items.length) {
      setSelectedId(null);
      return;
    }
    if (!items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) || items[0] || null, [items, selectedId]);
  const metrics = useMemo(() => {
    const accountIds = new Set(items.map((item) => item.user?.id).filter(Boolean));
    const drivers = new Set(items.map((item) => item.driver_name).filter(Boolean));
    const trucks = new Set(items.map((item) => item.vehicle_number).filter(Boolean));
    const withFuelPlan = items.filter((item) => item.selected_stop || item.fuel_strategy).length;
    return { accounts: accountIds.size, drivers: drivers.size, trucks: trucks.size, withFuelPlan };
  }, [items]);

  return (
    <section className="route-history-panel">
      <header className="route-history-head">
        <div>
          <span className="eyebrow">Route History</span>
          <h2>All route builds</h2>
          <p>Search every saved routing run by account, driver, truck, origin, destination, or date.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setRefreshTick((current) => current + 1)} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <div className="route-history-metrics">
        <article><span>Total shown</span><strong>{total}</strong><small>{items.length} loaded</small></article>
        <article><span>Accounts</span><strong>{metrics.accounts}</strong><small>route builders</small></article>
        <article><span>Drivers</span><strong>{metrics.drivers}</strong><small>matched to routes</small></article>
        <article><span>Trucks</span><strong>{metrics.trucks}</strong><small>matched units</small></article>
        <article><span>Fuel plans</span><strong>{metrics.withFuelPlan}</strong><small>with stops</small></article>
      </div>

      <div className="route-history-filters">
        <label>
          <span>Search</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Driver, truck, account, origin, destination" />
        </label>
        <label>
          <span>From date</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          <span>To date</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <button className="ghost-button" type="button" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); }}>
          Clear
        </button>
      </div>

      {error ? <div className="notice error inline-notice">{error}</div> : null}

      <div className="route-history-layout">
        <div className="route-history-list" aria-label="Saved route builds">
          {items.length ? items.map((item) => (
            <button key={item.id} type="button" className={`route-history-card ${selectedItem?.id === item.id ? "active" : ""}`.trim()} onClick={() => setSelectedId(item.id)}>
              <span className="route-history-card-top">
                <strong>{accountName(item.user)}</strong>
                <em>{formatDateTime(item.created_at)}</em>
              </span>
              <span className="route-history-route-line">
                <span>{item.origin_label || item.origin_query || "Origin"}</span>
                <b>to</b>
                <span>{item.destination_label || item.destination_query || "Destination"}</span>
              </span>
              <span className="route-history-chip-row">
                <small>{item.driver_name || "No driver"}</small>
                <small>{item.vehicle_number || "No truck"}</small>
                <small>{item.fuel_type || "Fuel"}</small>
              </span>
              <span className="route-history-card-foot">
                <small>{item.route_count} routes</small>
                <small>{item.top_fuel_stop_count} stops</small>
                <small>{formatDateOnly(item.created_at)}</small>
              </span>
            </button>
          )) : (
            <div className="route-history-empty">{loading ? "Loading route history..." : "No route builds found for these filters."}</div>
          )}
        </div>

        <aside className="route-history-detail">
          {selectedItem ? (
            <>
              <div className="route-history-detail-head">
                <span className="eyebrow">Selected Build</span>
                <h3>{routeTitle(selectedItem)}</h3>
                <p>{formatDateTime(selectedItem.created_at)} by {accountName(selectedItem.user)}</p>
              </div>

              <div className="route-history-detail-grid">
                <span><strong>Account</strong>{selectedItem.user?.email || "Unknown email"}</span>
                <span><strong>Department</strong>{selectedItem.user?.department || "Unknown"}</span>
                <span><strong>Driver</strong>{selectedItem.driver_name || "Not captured"}</span>
                <span><strong>Truck</strong>{selectedItem.vehicle_number || "Not captured"}</span>
                <span><strong>Fuel</strong>{selectedItem.fuel_type || "Not set"}</span>
                <span><strong>Current fuel</strong>{formatGallons(selectedItem.current_fuel_gallons)}</span>
                <span><strong>Tank</strong>{formatGallons(selectedItem.tank_capacity_gallons)}</span>
                <span><strong>MPG</strong>{selectedItem.mpg ? selectedItem.mpg.toFixed(1) : "Not set"}</span>
              </div>

              <div className="route-history-links">
                {selectedItem.map_link ? <a href={selectedItem.map_link} target="_blank" rel="noreferrer">Open route map</a> : null}
                {selectedItem.station_map_link ? <a href={selectedItem.station_map_link} target="_blank" rel="noreferrer">Open selected stop map</a> : null}
              </div>

              <section className="route-history-selected-stop">
                <span className="eyebrow">Selected Stop</span>
                {selectedItem.selected_stop ? (
                  <div>
                    <strong>{stationName(selectedItem.selected_stop)}</strong>
                    <p>{selectedItem.selected_stop.address || "Address not saved"}</p>
                    <small>{[selectedItem.selected_stop.city, selectedItem.selected_stop.state_code].filter(Boolean).join(", ") || "Location saved"}</small>
                    <em>{formatPrice(selectedItem.selected_stop.auto_diesel_price ?? selectedItem.selected_stop.diesel_price ?? selectedItem.selected_stop.price)}</em>
                  </div>
                ) : <p>No selected stop was saved for this route.</p>}
              </section>

              <section className="route-history-routes">
                <span className="eyebrow">Route Options</span>
                {selectedItem.routes.length ? selectedItem.routes.map((route) => (
                  <div key={route.id} className="route-history-route-option">
                    <strong>{route.label}</strong>
                    <span>{formatMilesFromMeters(route.distance_meters)} / {formatDuration(route.travel_time_seconds)}</span>
                    <small>{route.fuel_stop_count} saved fuel stops</small>
                  </div>
                )) : <p>No route options saved.</p>}
              </section>

              <section className="route-history-stops">
                <span className="eyebrow">Top Stops</span>
                {selectedItem.top_fuel_stops.length ? selectedItem.top_fuel_stops.map((stop) => (
                  <div key={`${stop.id}-${stop.stop_id}`} className={stop.is_selected ? "selected" : ""}>
                    <strong>{stationName(stop)}</strong>
                    <span>{stop.address || [stop.city, stop.state_code].filter(Boolean).join(", ")}</span>
                    <small>{formatPrice(stop.auto_diesel_price ?? stop.diesel_price ?? stop.price)}{stop.off_route_miles ? ` / ${stop.off_route_miles.toFixed(1)} mi off route` : ""}</small>
                  </div>
                )) : <p>No top stops saved.</p>}
              </section>

              {selectedItem.assistant_message ? (
                <section className="route-history-message">
                  <span className="eyebrow">AI Message</span>
                  <p>{selectedItem.assistant_message}</p>
                </section>
              ) : null}
            </>
          ) : (
            <div className="route-history-empty detail-empty">Select a route build to see account and routing details.</div>
          )}
        </aside>
      </div>
    </section>
  );
}