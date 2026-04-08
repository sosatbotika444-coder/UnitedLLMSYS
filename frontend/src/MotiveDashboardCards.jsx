import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";

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

export default function MotiveDashboardCards({ token, active = true }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

          <div className="motive-command-watchlists">
            <section className="motive-watch-card">
              <h3>Low Fuel Watchlist</h3>
              {watchlists.lowFuel.length ? watchlists.lowFuel.map((vehicle) => <div key={vehicle.id}><strong>{vehicle.number}</strong><small>{oneDecimal(vehicle.location?.fuel_level_percent)}%</small></div>) : <div className="empty-route-card compact">No low fuel vehicles.</div>}
            </section>
            <section className="motive-watch-card">
              <h3>Fault Watchlist</h3>
              {watchlists.faults.length ? watchlists.faults.map((vehicle) => <div key={vehicle.id}><strong>{vehicle.number}</strong><small>{number(vehicle.fault_summary?.active_count)} active faults</small></div>) : <div className="empty-route-card compact">No active fault stack.</div>}
            </section>
            <section className="motive-watch-card">
              <h3>Stale Units</h3>
              {watchlists.stale.length ? watchlists.stale.map((vehicle) => <div key={vehicle.id}><strong>{vehicle.number}</strong><small>{oneDecimal(vehicle.location?.age_minutes)} min since last ping</small></div>) : <div className="empty-route-card compact">No stale vehicles.</div>}
            </section>
            <section className="motive-watch-card">
              <h3>Safety Review Queue</h3>
              {watchlists.safety.length ? watchlists.safety.map((vehicle) => <div key={vehicle.id}><strong>{vehicle.number}</strong><small>{number(vehicle.performance_summary?.pending_review_count)} pending events</small></div>) : <div className="empty-route-card compact">No pending coaching events.</div>}
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
}
