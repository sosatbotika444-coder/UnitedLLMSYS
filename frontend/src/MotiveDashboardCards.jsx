import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const watchlistFocusOptions = ["All", "Low Fuel", "Faults", "Stale", "Safety"];

async function apiRequest(path, options = {}, token = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

function number(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function oneDecimal(value) {
  return value === null || value === undefined ? "-" : Number(value).toFixed(1);
}

function compactDate(value) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function dashboardVehicleMatches(vehicle, term) {
  if (!term) return true;
  const haystack = [
    vehicle.number,
    vehicle.make,
    vehicle.model,
    vehicle.vin,
    vehicle.license_plate_number,
    vehicle.driver?.full_name,
    vehicle.permanent_driver?.full_name,
    vehicle.location?.city,
    vehicle.location?.state,
    vehicle.location?.address,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

function watchlistDetail(kind, vehicle) {
  if (kind === "Low Fuel") return `${oneDecimal(vehicle.location?.fuel_level_percent)}%`;
  if (kind === "Faults") return `${number(vehicle.fault_summary?.active_count)} active faults`;
  if (kind === "Stale") return `${oneDecimal(vehicle.location?.age_minutes)} min since last ping`;
  return `${number(vehicle.performance_summary?.pending_review_count)} pending events`;
}

export default function MotiveDashboardCards({ token, active = true }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [focusFilter, setFocusFilter] = useState("All");

  useEffect(() => {
    if (!token || !active) {
      return undefined;
    }

    let ignore = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const data = await apiRequest("/motive/fleet", {}, token);
        if (!ignore) {
          setSnapshot(data);
        }
      } catch (fetchError) {
        if (!ignore) {
          setError(fetchError.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [active, token]);

  const watchlists = useMemo(() => {
    const vehicles = snapshot?.vehicles || [];
    return {
      lowFuel: vehicles
        .filter((vehicle) => vehicle.location?.fuel_level_percent !== null && vehicle.location?.fuel_level_percent !== undefined)
        .sort((left, right) => (left.location?.fuel_level_percent || 0) - (right.location?.fuel_level_percent || 0))
        .slice(0, 5),
      faults: [...vehicles]
        .sort((left, right) => (right.fault_summary?.active_count || 0) - (left.fault_summary?.active_count || 0))
        .filter((vehicle) => (vehicle.fault_summary?.active_count || 0) > 0)
        .slice(0, 5),
      stale: vehicles
        .filter((vehicle) => vehicle.is_stale)
        .sort((left, right) => (right.location?.age_minutes || 0) - (left.location?.age_minutes || 0))
        .slice(0, 5),
      safety: [...vehicles]
        .sort((left, right) => (right.performance_summary?.pending_review_count || 0) - (left.performance_summary?.pending_review_count || 0))
        .filter((vehicle) => (vehicle.performance_summary?.pending_review_count || 0) > 0)
        .slice(0, 5),
    };
  }, [snapshot]);

  const filteredWatchlists = useMemo(() => {
    const term = normalizeText(search);
    const filterItems = (items) => items.filter((vehicle) => dashboardVehicleMatches(vehicle, term));
    return {
      lowFuel: filterItems(watchlists.lowFuel),
      faults: filterItems(watchlists.faults),
      stale: filterItems(watchlists.stale),
      safety: filterItems(watchlists.safety),
    };
  }, [search, watchlists]);

  const watchSections = useMemo(() => {
    const sections = [
      { id: "Low Fuel", title: "Low Fuel Watchlist", emptyText: "No low fuel vehicles.", items: filteredWatchlists.lowFuel },
      { id: "Faults", title: "Fault Watchlist", emptyText: "No active fault stack.", items: filteredWatchlists.faults },
      { id: "Stale", title: "Stale Units", emptyText: "No stale vehicles.", items: filteredWatchlists.stale },
      { id: "Safety", title: "Safety Review Queue", emptyText: "No pending coaching events.", items: filteredWatchlists.safety },
    ];
    return focusFilter === "All" ? sections : sections.filter((section) => section.id === focusFilter);
  }, [filteredWatchlists, focusFilter]);

  const visibleWatchItems = useMemo(
    () => watchSections.reduce((sum, section) => sum + section.items.length, 0),
    [watchSections]
  );

  if (!token) {
    return null;
  }

  return (
    <section className="panel motive-command-panel">
      <div className="panel-head motive-command-head">
        <div>
          <h2>Motive Operations Dashboard</h2>
          <span>
            {snapshot?.company?.name ? `${snapshot.company.name} live fleet cards` : "Live fleet cards from Motive."}
          </span>
        </div>
        {snapshot?.fetched_at ? <small>Updated {compactDate(snapshot.fetched_at)}</small> : null}
      </div>

      {error ? <div className="notice error inline-notice">{error}</div> : null}

      {loading ? (
        <div className="empty-route-card">Loading Motive dashboard cards...</div>
      ) : snapshot ? (
        <>
          <div className="motive-command-metrics">
            <article className="motive-command-card"><span>Total Vehicles</span><strong>{number(snapshot.metrics.total_vehicles)}</strong><small>{number(snapshot.metrics.located_vehicles)} reporting GPS</small></article>
            <article className="motive-command-card"><span>Moving Now</span><strong>{number(snapshot.metrics.moving_vehicles)}</strong><small>{number(snapshot.metrics.stopped_vehicles)} stopped</small></article>
            <article className="motive-command-card"><span>Low Fuel</span><strong>{number(snapshot.metrics.low_fuel_vehicles)}</strong><small>25% fuel or lower</small></article>
            <article className="motive-command-card"><span>Active Faults</span><strong>{number(snapshot.metrics.active_fault_codes)}</strong><small>{number(snapshot.metrics.vehicles_with_faults)} vehicles affected</small></article>
            <article className="motive-command-card"><span>Safety Events</span><strong>{number(snapshot.metrics.performance_events_7d)}</strong><small>{number(snapshot.metrics.pending_review_events)} pending review</small></article>
            <article className="motive-command-card"><span>Idle Hours</span><strong>{oneDecimal(snapshot.metrics.idle_hours_7d)}</strong><small>Last 7 days</small></article>
            <article className="motive-command-card"><span>Drive Miles</span><strong>{number(snapshot.metrics.driving_miles_7d)}</strong><small>Last 7 days</small></article>
            <article className="motive-command-card"><span>IFTA Miles</span><strong>{number(snapshot.metrics.ifta_miles_30d)}</strong><small>Last 30 days</small></article>
          </div>

          <div className="panel-filter-card">
            <div className="inline-filter-grid inline-filter-grid-compact">
              <label>
                Search watchlists
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Truck, VIN, driver, city"
                />
              </label>
              <label>
                Focus
                <select value={focusFilter} onChange={(event) => setFocusFilter(event.target.value)}>
                  {watchlistFocusOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="panel-filter-summary">{visibleWatchItems} watchlist rows visible. Fleet metrics above stay global.</div>
          </div>

          <div className="motive-command-watchlists">
            {watchSections.map((section) => (
              <section key={section.id} className="motive-watch-card">
                <h3>{section.title}</h3>
                {section.items.length ? section.items.map((vehicle) => (
                  <div key={`${section.id}-${vehicle.id}`}>
                    <strong>{vehicle.number}</strong>
                    <small>{watchlistDetail(section.id, vehicle)}</small>
                  </div>
                )) : <div className="empty-route-card compact">{section.emptyText}</div>}
              </section>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
