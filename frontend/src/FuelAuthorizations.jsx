import { useEffect, useMemo, useState } from "react";
import { useConfirmDialog } from "./feedback";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const statusOptions = [
  { id: "open", label: "Open" },
  { id: "approved", label: "Approved" },
  { id: "sent", label: "Sent" },
  { id: "violated", label: "Violated" },
  { id: "used", label: "Used" },
  { id: "expired", label: "Expired" },
  { id: "cancelled", label: "Cancelled" },
  { id: "all", label: "All" }
];

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

function compactDate(value) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
}

function formatCurrency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0.00";
  return `$${parsed.toFixed(2)}`;
}

function formatGallons(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0.0 gal";
  return `${parsed.toFixed(1)} gal`;
}

function formatPrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "No price cap";
  return `$${parsed.toFixed(3)}/gal`;
}

function statusClass(status) {
  if (status === "used") return "fuel-auth-used";
  if (status === "violated") return "fuel-auth-violated";
  if (status === "expired" || status === "cancelled") return "fuel-auth-closed";
  if (status === "sent") return "fuel-auth-sent";
  return "fuel-auth-approved";
}

function statusLabel(status) {
  if (!status) return "Approved";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function textList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function AuthorizationCard({ item, busy, onMarkSent, onCancel, onReconcile, onCopy }) {
  const details = item.reconciliation_details || {};
  const issues = textList(details.issues);
  const warnings = textList(details.warnings);
  const terminal = ["used", "expired", "cancelled"].includes(item.status);
  const station = item.station_brand || item.station_name || "Approved station";

  return (
    <article className={`fuel-auth-card ${statusClass(item.status)}`.trim()}>
      <header className="fuel-auth-card-head">
        <div>
          <span>{item.approval_code}</span>
          <strong>{item.vehicle_number || `Vehicle ${item.vehicle_id || ""}`.trim() || "Vehicle"}</strong>
          <small>{item.driver_name || "Unassigned driver"}</small>
        </div>
        <em>{statusLabel(item.status)}</em>
      </header>

      <div className="fuel-auth-station">
        <strong>{station}</strong>
        <span>{item.station_address}</span>
        <small>{[item.station_city, item.station_state].filter(Boolean).join(", ")}</small>
      </div>

      <div className="fuel-auth-metric-row">
        <span><strong>{formatGallons(item.max_gallons)}</strong> gallon cap</span>
        <span><strong>{formatCurrency(item.max_amount)}</strong> amount cap</span>
        <span><strong>{formatPrice(item.max_price_per_gallon)}</strong> price cap</span>
        <span><strong>{compactDate(item.expires_at)}</strong> expires</span>
      </div>

      <div className="fuel-auth-route-line">
        <span>{item.origin_label || "Origin"}</span>
        <strong>to</strong>
        <span>{item.destination_label || "Destination"}</span>
      </div>

      {item.driver_message ? (
        <div className="fuel-auth-message-box">
          <span>Driver message</span>
          <p>{item.driver_message}</p>
        </div>
      ) : null}

      {item.actual_vendor || item.actual_gallons || item.actual_amount ? (
        <div className="fuel-auth-actuals">
          <strong>Motive purchase</strong>
          <span>{item.actual_vendor || "Vendor unknown"}</span>
          <span>{formatGallons(item.actual_gallons)} / {formatCurrency(item.actual_amount)}</span>
          <span>{formatPrice(item.actual_price_per_gallon)}</span>
        </div>
      ) : null}

      {issues.length || warnings.length ? (
        <div className="fuel-auth-checks">
          {issues.map((issue) => <span key={issue} className="issue">{issue}</span>)}
          {warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}

      <footer className="fuel-auth-actions">
        <button className="secondary-button" type="button" onClick={() => onCopy(item)} disabled={!item.driver_message}>Copy message</button>
        <button className="secondary-button" type="button" onClick={() => onReconcile(item)} disabled={busy}>Reconcile</button>
        <button className="secondary-button" type="button" onClick={() => onMarkSent(item)} disabled={busy || terminal || item.status === "sent"}>Mark sent</button>
        <button className="delete-button" type="button" onClick={() => onCancel(item)} disabled={busy || item.status === "used" || item.status === "cancelled"}>Cancel</button>
        {item.station_map_link ? <a className="fuel-source-link" href={item.station_map_link} target="_blank" rel="noreferrer">Route</a> : null}
      </footer>
    </article>
  );
}

export default function FuelAuthorizations({ token, active = true }) {
  const confirmAction = useConfirmDialog();
  const [items, setItems] = useState([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadAuthorizations(nextStatus = statusFilter) {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status: nextStatus });
      const data = await apiRequest(`/fuel-authorizations?${params.toString()}`, {}, token);
      setItems(Array.isArray(data) ? data : []);
    } catch (fetchError) {
      setError(fetchError.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token || !active) return undefined;
    loadAuthorizations(statusFilter);

    function handleCreated() {
      loadAuthorizations(statusFilter);
    }

    window.addEventListener("fuel-authorization-created", handleCreated);
    return () => window.removeEventListener("fuel-authorization-created", handleCreated);
  }, [active, statusFilter, token]);

  const metrics = useMemo(() => {
    const count = (status) => items.filter((item) => item.status === status).length;
    return {
      total: items.length,
      approved: count("approved"),
      sent: count("sent"),
      violated: count("violated"),
      used: count("used")
    };
  }, [items]);

  async function runAction(item, path, options = {}) {
    setBusyId(String(item.id));
    setError("");
    setMessage("");
    try {
      await apiRequest(path, options, token);
      await loadAuthorizations(statusFilter);
      return true;
    } catch (actionError) {
      setError(actionError.message);
      return false;
    } finally {
      setBusyId("");
    }
  }

  async function markSent(item) {
    const success = await runAction(item, `/fuel-authorizations/${item.id}/mark-sent`, { method: "POST", body: JSON.stringify({ note: "Driver instructions sent from Fuel Service." }) });
    if (success) {
      setMessage(`${item.approval_code} marked sent.`);
    }
  }

  async function cancel(item) {
    const accepted = await confirmAction({
      tone: "danger",
      icon: "warning",
      meta: "Cancel fuel authorization",
      title: `Cancel ${item.approval_code}?`,
      description: "The driver-facing fuel authorization will move to cancelled and stop being treated as an active approval.",
      confirmLabel: "Cancel approval",
    });
    if (!accepted) return;

    const success = await runAction(item, `/fuel-authorizations/${item.id}/cancel`, { method: "POST", body: JSON.stringify({ note: "Cancelled from Fuel Service board." }) });
    if (success) {
      setMessage(`${item.approval_code} cancelled.`);
    }
  }

  async function reconcile(item) {
    const success = await runAction(item, `/fuel-authorizations/${item.id}/reconcile`, { method: "POST" });
    if (success) {
      setMessage(`${item.approval_code} reconciled with Motive purchases.`);
    }
  }

  async function reconcileOpen() {
    const accepted = await confirmAction({
      tone: "info",
      icon: "approvals",
      meta: "Bulk reconciliation",
      title: "Reconcile all open authorizations?",
      description: "This checks every open approval against Motive purchases and may update multiple records at once.",
      confirmLabel: "Run reconciliation",
    });
    if (!accepted) return;

    setBusyId("bulk");
    setError("");
    setMessage("");
    try {
      const result = await apiRequest("/fuel-authorizations/reconcile-open", { method: "POST" }, token);
      await loadAuthorizations(statusFilter);
      setMessage(`Checked ${result.checked || 0}, matched ${result.matched || 0}, violations ${result.violated || 0}, expired ${result.expired || 0}.`);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusyId("");
    }
  }

  async function copyMessage(item) {
    if (!item.driver_message) return;
    try {
      await navigator.clipboard.writeText(item.driver_message);
      setMessage(`${item.approval_code} driver message copied.`);
    } catch {
      setMessage(item.driver_message);
    }
  }

  if (!token) return null;

  return (
    <section className="panel fuel-auth-panel">
      <div className="panel-head fuel-auth-head">
        <div>
          <h2>Fuel Authorizations</h2>
          <span>Approved stops, card limits, Motive purchase checks.</span>
        </div>
        <div className="fuel-auth-head-actions">
          <button className="secondary-button" type="button" onClick={() => loadAuthorizations(statusFilter)} disabled={loading}>Refresh</button>
          <button className="primary-button" type="button" onClick={reconcileOpen} disabled={busyId === "bulk"}>{busyId === "bulk" ? "Checking..." : "Reconcile open"}</button>
        </div>
      </div>

      {message ? <div className="notice success inline-notice">{message}</div> : null}
      {error ? <div className="notice error inline-notice">{error}</div> : null}

      <div className="fuel-auth-metrics">
        <article><span>Total</span><strong>{metrics.total}</strong><small>Current filter</small></article>
        <article><span>Approved</span><strong>{metrics.approved}</strong><small>Ready to send</small></article>
        <article><span>Sent</span><strong>{metrics.sent}</strong><small>Driver notified</small></article>
        <article><span>Violations</span><strong>{metrics.violated}</strong><small>Needs review</small></article>
        <article><span>Used</span><strong>{metrics.used}</strong><small>Matched purchases</small></article>
      </div>

      <div className="panel-filter-card fuel-auth-filter-card">
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {statusOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <span>{loading ? "Loading approvals..." : `${items.length} approvals shown`}</span>
      </div>

      <div className="fuel-auth-grid">
        {items.length ? items.map((item) => (
          <AuthorizationCard
            key={item.id}
            item={item}
            busy={busyId === String(item.id)}
            onMarkSent={markSent}
            onCancel={cancel}
            onReconcile={reconcile}
            onCopy={copyMessage}
          />
        )) : <div className="empty-route-card">{loading ? "Loading fuel authorizations..." : "No fuel authorizations match this filter yet."}</div>}
      </div>
    </section>
  );
}

