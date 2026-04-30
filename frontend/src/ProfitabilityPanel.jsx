import { useEffect, useMemo, useState } from "react";
import {
  buildTripProfitabilitySnapshot,
  normalizeText,
} from "./profitability";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-3998.up.railway.app/api";
const viewOptions = [
  { id: "loads", label: "Loads" },
  { id: "lanes", label: "Lanes" },
  { id: "detention", label: "Detention Queue" },
];

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

function formatCurrency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0.00";
  return `$${parsed.toFixed(2)}`;
}

function formatMiles(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0.0 mi";
  return `${parsed.toFixed(parsed >= 100 ? 0 : 1)} mi`;
}

function formatDateTime(value) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0m";
  const hours = Math.floor(parsed / 60);
  const minutes = Math.round(parsed % 60);
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function metricValue(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function stageLabel(stage) {
  if (stage === "enroute_pickup") return "Truck to Pickup";
  if (stage === "at_pickup") return "At Pickup";
  if (stage === "enroute_delivery") return "Pickup to Delivery";
  if (stage === "delivered") return "Delivered";
  return stage || "Load";
}

function marginTone(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "neutral";
  if (parsed < 0) return "danger";
  if (parsed < 250) return "watch";
  return "good";
}

function marginMetricTone(value) {
  const tone = marginTone(value);
  if (tone === "danger" || tone === "watch") return "amber";
  if (tone === "good") return "green";
  return "dark";
}

function detentionTone(record) {
  if (record.detentionStatus === "running_billable") return "danger";
  if (record.detentionStatus === "running") return "watch";
  if (record.detentionAmount > 0) return "good";
  return "neutral";
}

function sumBy(items, selector) {
  return items.reduce((sum, item) => sum + (Number(selector(item)) || 0), 0);
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

export default function ProfitabilityPanel({ token, active = true, loadRows = [] }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("loads");
  const [sourceFilter, setSourceFilter] = useState("all");

  useEffect(() => {
    if (!token || !active) {
      return undefined;
    }

    let ignore = false;
    async function loadTrips() {
      setLoading(true);
      setError("");
      try {
        const data = await apiRequest("/full-road-trips?include_archived=true&limit=400", {}, token);
        if (!ignore) {
          setTrips(Array.isArray(data) ? data : []);
        }
      } catch (fetchError) {
        if (!ignore) {
          setError(fetchError.message || "Profitability trips failed to load.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadTrips();
    return () => {
      ignore = true;
    };
  }, [active, token]);

  const records = useMemo(() => {
    return (loadRows || []).map((row) => {
      const linkedTrip = trips.find((trip) => String(trip?.loadId || "") === String(row?.id || "")) || null;
      return buildTripProfitabilitySnapshot(linkedTrip, row);
    });
  }, [loadRows, trips]);

  const filteredRecords = useMemo(() => {
    const term = normalizeText(search);
    return records
      .filter((record) => {
        if (sourceFilter === "linked" && !record.hasLiveTrip) return false;
        if (sourceFilter === "unlinked" && record.hasLiveTrip) return false;
        if (!term) return true;
        const haystack = [
          record.loadNumber,
          record.customerName,
          record.brokerName,
          record.truckNumber,
          record.driverName,
          record.pickup,
          record.delivery,
          record.laneKey,
          stageLabel(record.stage),
        ].join(" ").toLowerCase();
        return haystack.includes(term);
      })
      .sort((left, right) => {
        const leftRunning = left.detentionStatus === "running_billable" ? 2 : left.detentionStatus === "running" ? 1 : 0;
        const rightRunning = right.detentionStatus === "running_billable" ? 2 : right.detentionStatus === "running" ? 1 : 0;
        if (view === "detention" && rightRunning !== leftRunning) return rightRunning - leftRunning;
        return (Number(right.projectedMargin) || 0) - (Number(left.projectedMargin) || 0);
      });
  }, [records, search, sourceFilter, view]);

  const monitoredRecords = useMemo(() => filteredRecords.filter((record) => record.hasLiveTrip), [filteredRecords]);
  const detentionQueue = useMemo(
    () => filteredRecords.filter((record) => record.detentionStatus !== "clear"),
    [filteredRecords],
  );

  const laneRows = useMemo(() => {
    const laneMap = new Map();

    filteredRecords.forEach((record) => {
      const existing = laneMap.get(record.laneKey) || {
        laneKey: record.laneKey,
        loadCount: 0,
        totalRevenue: 0,
        totalMargin: 0,
        totalMarginWithoutService: 0,
        totalDetention: 0,
        totalServiceSavings: 0,
        totalMiles: 0,
        customers: new Set(),
      };

      existing.loadCount += 1;
      existing.totalRevenue += Number(record.projectedRevenue) || 0;
      existing.totalMargin += Number(record.projectedMargin) || 0;
      existing.totalMarginWithoutService += Number(record.projectedMarginWithoutService) || 0;
      existing.totalDetention += Number(record.detentionAmount) || 0;
      existing.totalServiceSavings += Number(record.smartServiceSavings) || 0;
      existing.totalMiles += Number(record.totalMiles) || 0;
      if (record.customerName) {
        existing.customers.add(record.customerName);
      }
      laneMap.set(record.laneKey, existing);
    });

    return [...laneMap.values()]
      .map((lane) => ({
        ...lane,
        avgMarginPerLoad: lane.loadCount ? lane.totalMargin / lane.loadCount : 0,
        avgMarginWithoutServicePerLoad: lane.loadCount ? lane.totalMarginWithoutService / lane.loadCount : 0,
        avgDetentionPerLoad: lane.loadCount ? lane.totalDetention / lane.loadCount : 0,
        marginPerMile: lane.totalMiles > 0 ? lane.totalMargin / lane.totalMiles : null,
        customersLabel: [...lane.customers].slice(0, 3).join(", "),
      }))
      .sort((left, right) => right.totalMargin - left.totalMargin);
  }, [filteredRecords]);

  const summary = useMemo(() => {
    const margins = filteredRecords.map((record) => record.projectedMargin);
    return {
      totalRecords: filteredRecords.length,
      monitoredCount: monitoredRecords.length,
      totalMargin: sumBy(filteredRecords, (record) => record.projectedMargin),
      totalMarginWithoutService: sumBy(filteredRecords, (record) => record.projectedMarginWithoutService),
      totalDetention: sumBy(filteredRecords, (record) => record.detentionAmount),
      totalServiceSavings: sumBy(filteredRecords, (record) => record.smartServiceSavings),
      runningDetention: detentionQueue.filter((record) => record.detentionStatus.startsWith("running")).length,
      avgMarginPerMile: average(filteredRecords.map((record) => record.projectedMarginPerMile)),
      lossLoads: margins.filter((value) => Number(value) < 0).length,
    };
  }, [detentionQueue, filteredRecords, monitoredRecords]);

  return (
    <section className="profitability-panel">
      <section className="panel">
        <div className="panel-head compact-panel-head">
          <div>
            <h2>Detention + Lane Profitability</h2>
            <span>Truck-selected Smart Route economics with optional Full Road monitoring for stage and detention.</span>
          </div>
          <div className="fleet-statistics-head-meta">
            <small>{summary.totalRecords} record(s)</small>
            <small>{summary.monitoredCount} linked to Full Road</small>
          </div>
        </div>

        <div className="full-road-queue-toolbar profitability-toolbar">
          <label>
            Search
            <input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Load, lane, truck, customer, broker" />
          </label>
          <label>
            Source
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">All records</option>
              <option value="linked">Only monitored loads</option>
              <option value="unlinked">Only load-sheet rows</option>
            </select>
          </label>
          <div className="statistics-quick-tabs workspace-inline-tabs">
            {viewOptions.map((option) => (
              <button key={option.id} type="button" className={`workspace-inline-tab ${view === option.id ? "active" : ""}`} onClick={() => setView(option.id)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <section className="full-road-summary-grid profitability-summary-grid">
          <article className={`metric-card metric-card-${marginMetricTone(summary.totalMargin)}`}>
            <span>Margin With Service</span>
            <strong>{formatCurrency(summary.totalMargin)}</strong>
            <small>Across smart-filled loads in the current view</small>
          </article>
          <article className={`metric-card metric-card-${marginMetricTone(summary.totalMarginWithoutService)}`}>
            <span>Margin Without Service</span>
            <strong>{formatCurrency(summary.totalMarginWithoutService)}</strong>
            <small>Baseline from average corridor fuel price</small>
          </article>
          <article className={`metric-card metric-card-${summary.totalServiceSavings >= 0 ? "green" : "amber"}`}>
            <span>Fuel Service Delta</span>
            <strong>{formatCurrency(summary.totalServiceSavings)}</strong>
            <small>Smart fuel plan vs average corridor fueling</small>
          </article>
          <article className={`metric-card metric-card-${summary.runningDetention ? "amber" : "green"}`}>
            <span>Detention Recoverable</span>
            <strong>{formatCurrency(summary.totalDetention)}</strong>
            <small>{summary.runningDetention} trip(s) actively running detention</small>
          </article>
          <article className="metric-card metric-card-blue">
            <span>Avg Margin / Mile</span>
            <strong>{summary.avgMarginPerMile !== null ? formatCurrency(summary.avgMarginPerMile) : "$0.00"}</strong>
            <small>Based on manual miles you entered</small>
          </article>
          <article className={`metric-card metric-card-${summary.lossLoads ? "amber" : "green"}`}>
            <span>Loss Loads</span>
            <strong>{metricValue(summary.lossLoads)}</strong>
            <small>Projected negative-margin routed trips</small>
          </article>
        </section>
      </section>

      {error ? <div className="notice error inline-notice">{error}</div> : null}
      {loading ? <div className="notice info inline-notice">Loading profitability data...</div> : null}

      {view === "loads" ? (
        <section className="panel workspace-table-panel">
          <div className="workspace-table-toolbar">
            <div>
              <h2>Load Profitability</h2>
              <span>Each load from truck selection plus Smart Route auto-fill, with optional Full Road monitoring.</span>
            </div>
          </div>
          <div className="sheet-frame">
            <div className="sheet-scroll">
              <table className="dispatch-sheet profitability-table">
                <thead>
                  <tr>
                    <th>Load</th>
                    <th>Lane</th>
                    <th>Stage</th>
                    <th>Revenue</th>
                    <th>Fuel With Service</th>
                    <th>Fuel Without Service</th>
                    <th>Service Delta</th>
                    <th>Other Cost</th>
                    <th>Detention</th>
                    <th>Margin With Service</th>
                    <th>Margin Without Service</th>
                    <th>Margin / Mi</th>
                    <th>Trip</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.length ? filteredRecords.map((record) => (
                    <tr key={`${record.tripId || "load"}-${record.loadId || record.loadNumber || record.truckNumber}`}>
                      <td>
                        <strong>{record.loadNumber || record.truckNumber || "Load"}</strong>
                        <small>{[record.customerName || "Customer n/a", record.driverName || "Driver n/a"].join(" | ")}</small>
                      </td>
                      <td>
                        <strong>{record.laneKey}</strong>
                        <small>{record.brokerName || "Broker n/a"}</small>
                      </td>
                      <td>
                        <strong>{stageLabel(record.stage)}</strong>
                        <small>{record.hasLiveTrip ? "Full Road linked" : "Waiting for monitoring link"}</small>
                      </td>
                      <td>
                        <strong>{formatCurrency(record.projectedRevenue)}</strong>
                        <small>Rate {formatCurrency(record.revenueBase)} + acc {formatCurrency(record.accessorials)}</small>
                      </td>
                      <td>
                        <strong>{formatCurrency(record.estimatedFuelCost)}</strong>
                        <small>{record.estimatedFuelCost > 0 ? "Smart Route fuel plan" : "Run Smart Fill from Loads"}</small>
                      </td>
                      <td>
                        <strong>{formatCurrency(record.baselineFuelCost)}</strong>
                        <small>Average corridor fuel baseline</small>
                      </td>
                      <td className={`profitability-tone-${marginTone(record.smartServiceSavings)}`}>
                        <strong>{formatCurrency(record.smartServiceSavings)}</strong>
                        <small>Margin lift from Smart Route fuel choices</small>
                      </td>
                      <td>
                        <strong>{formatCurrency((record.driverCost || 0) + (record.lumperCost || 0) + (record.tollCost || 0))}</strong>
                        <small>Driver {formatCurrency(record.driverCost)} | Lumper {formatCurrency(record.lumperCost)} | Tolls {formatCurrency(record.tollCost)}</small>
                      </td>
                      <td className={`profitability-tone-${detentionTone(record)}`}>
                        <strong>{formatCurrency(record.detentionAmount)}</strong>
                        <small>PU {formatMinutes(record.pickupDetention.billableMinutes)} | DEL {formatMinutes(record.deliveryDetention.billableMinutes)}</small>
                      </td>
                      <td className={`profitability-tone-${marginTone(record.projectedMargin)}`}>
                        <strong>{formatCurrency(record.projectedMargin)}</strong>
                        <small>{record.totalMiles ? `${formatMiles(record.totalMiles)} total` : "Run Smart Fill or enter miles"}</small>
                      </td>
                      <td className={`profitability-tone-${marginTone(record.projectedMarginWithoutService)}`}>
                        <strong>{formatCurrency(record.projectedMarginWithoutService)}</strong>
                        <small>Same load without smart fuel savings</small>
                      </td>
                      <td>
                        <strong>{record.projectedMarginPerMile !== null ? formatCurrency(record.projectedMarginPerMile) : "$0.00"}</strong>
                        <small>{record.projectedMarginPerMile !== null ? "Projected" : "Need route miles"}</small>
                      </td>
                      <td>
                        <strong>{record.deadheadMiles ? formatMiles(record.deadheadMiles) : "n/a"}</strong>
                        <small>{record.loadedMiles ? `${formatMiles(record.loadedMiles)} loaded` : "Smart Fill populates loaded miles"}</small>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="12" className="empty-state-cell">No profitability records match the current filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {view === "lanes" ? (
        <section className="panel workspace-table-panel">
          <div className="workspace-table-toolbar">
            <div>
              <h2>Lane Profitability</h2>
              <span>Grouped from smart-filled load rows, with Full Road only used for monitoring when linked.</span>
            </div>
          </div>
          <div className="sheet-frame">
            <div className="sheet-scroll">
              <table className="dispatch-sheet profitability-table">
                <thead>
                  <tr>
                    <th>Lane</th>
                    <th>Loads</th>
                    <th>Total Revenue</th>
                    <th>Margin With Service</th>
                    <th>Margin Without Service</th>
                    <th>Fuel Service Delta</th>
                    <th>Avg Margin / Load</th>
                    <th>Margin / Mi</th>
                    <th>Avg Detention</th>
                    <th>Customers</th>
                  </tr>
                </thead>
                <tbody>
                  {laneRows.length ? laneRows.map((lane) => (
                    <tr key={lane.laneKey}>
                      <td><strong>{lane.laneKey}</strong></td>
                      <td><strong>{metricValue(lane.loadCount)}</strong></td>
                      <td><strong>{formatCurrency(lane.totalRevenue)}</strong></td>
                      <td className={`profitability-tone-${marginTone(lane.totalMargin)}`}><strong>{formatCurrency(lane.totalMargin)}</strong></td>
                      <td className={`profitability-tone-${marginTone(lane.totalMarginWithoutService)}`}><strong>{formatCurrency(lane.totalMarginWithoutService)}</strong></td>
                      <td className={`profitability-tone-${marginTone(lane.totalServiceSavings)}`}><strong>{formatCurrency(lane.totalServiceSavings)}</strong></td>
                      <td><strong>{formatCurrency(lane.avgMarginPerLoad)}</strong></td>
                      <td><strong>{lane.marginPerMile !== null ? formatCurrency(lane.marginPerMile) : "$0.00"}</strong></td>
                      <td><strong>{formatCurrency(lane.avgDetentionPerLoad)}</strong></td>
                      <td><small>{lane.customersLabel || "Customer mix pending"}</small></td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="9" className="empty-state-cell">No smart-filled lane profitability rows yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {view === "detention" ? (
        <section className="panel workspace-table-panel">
          <div className="workspace-table-toolbar">
            <div>
              <h2>Detention Queue</h2>
              <span>See loads that are currently running or have already earned billable detention.</span>
            </div>
          </div>
          <div className="sheet-frame">
            <div className="sheet-scroll">
              <table className="dispatch-sheet profitability-table">
                <thead>
                  <tr>
                    <th>Load</th>
                    <th>Pickup Detention</th>
                    <th>Delivery Detention</th>
                    <th>Total</th>
                    <th>Appointments</th>
                    <th>Timeline</th>
                  </tr>
                </thead>
                <tbody>
                  {detentionQueue.length ? detentionQueue.map((record) => (
                    <tr key={`det-${record.tripId || "load"}-${record.loadId || record.loadNumber || record.truckNumber}`}>
                      <td>
                        <strong>{record.loadNumber || record.truckNumber || "Load"}</strong>
                        <small>{record.laneKey}</small>
                      </td>
                      <td className={`profitability-tone-${detentionTone(record)}`}>
                        <strong>{formatCurrency(record.pickupDetention.amount)}</strong>
                        <small>{formatMinutes(record.pickupDetention.dwellMinutes)} dwell | arrived {formatDateTime(record.pickupDetention.arrivalAt)}</small>
                      </td>
                      <td className={`profitability-tone-${detentionTone(record)}`}>
                        <strong>{formatCurrency(record.deliveryDetention.amount)}</strong>
                        <small>{formatMinutes(record.deliveryDetention.dwellMinutes)} dwell | arrived {formatDateTime(record.deliveryDetention.arrivalAt)}</small>
                      </td>
                      <td className={`profitability-tone-${detentionTone(record)}`}>
                        <strong>{formatCurrency(record.detentionAmount)}</strong>
                        <small>{record.detentionStatus.replace(/_/g, " ")}</small>
                      </td>
                      <td>
                        <strong>PU {formatDateTime(record.pickupAppointmentAt)}</strong>
                        <small>DEL {formatDateTime(record.deliveryAppointmentAt)}</small>
                      </td>
                      <td>
                        <strong>PU dep {formatDateTime(record.pickupDetention.departureAt)}</strong>
                        <small>DEL dep {formatDateTime(record.deliveryDetention.departureAt)}</small>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="6" className="empty-state-cell">No billable detention is currently visible.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </section>
  );
}
