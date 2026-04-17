import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UnitedLaneChat from "./UnitedLaneChat";
import SafetyServiceTools from "./SafetyServiceTools";
import TeamChat from "./TeamChat";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const MAX_DOCUMENT_BYTES = 9 * 1024 * 1024;
const DOCUMENT_ACCEPT = ".pdf,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif";
const safetyMobilePrimaryTabs = [
  { id: "fleet", label: "Fleet" },
  { id: "investigations", label: "Incidents" },
  { id: "brief", label: "Brief" },
  { id: "team-chat", label: "Chat" }
];
const safetyMobileMoreTabs = [
  { id: "automation", label: "Automation" },
  { id: "services", label: "Service Map" },
  { id: "emergency", label: "Emergency" },
  { id: "documents", label: "Documents" },
  { id: "notes", label: "Notes" },
  { id: "ai", label: "AI Chat" }
];
const safetyTabs = [
  { id: "fleet", label: "Fleet Safety" },
  { id: "automation", label: "Automation" },
  { id: "investigations", label: "Incident Queue" },
  { id: "brief", label: "Shift Brief" },
  { id: "services", label: "Service Map" },
  { id: "emergency", label: "Emergency" },
  { id: "documents", label: "Documents" },
  { id: "notes", label: "Notes" },
  { id: "team-chat", label: "Team Chat" },
  { id: "ai", label: "AI Chat" }
];
const documentSections = [
  { id: "approved", label: "Approved", empty: "No approved documents yet." },
  { id: "review", label: "Needs Review", empty: "No documents waiting for review." },
  { id: "bad", label: "Bad Documents", empty: "No bad documents." }
];
const queueLabels = {
  critical: "Immediate Action",
  maintenance: "Maintenance",
  coaching: "Coaching",
  compliance: "Compliance",
  watch: "Watchlist"
};
const investigationTypes = ["Accident", "Near Miss", "Roadside Issue", "Driver Complaint", "Cargo Claim", "Compliance Review"];
const investigationStatuses = ["Intake", "Investigating", "Waiting on Evidence", "Action Plan", "Closed"];
const investigationSeverities = ["Routine", "Elevated", "High", "Critical"];
const investigationPromptOptions = [
  "Build an investigation plan from this incident packet.",
  "Separate confirmed facts from assumptions and gaps.",
  "Draft the driver interview questions and next actions."
];
const shiftBriefChecklist = [
  "Clear Immediate Action items before the next dispatch wave.",
  "Confirm maintenance ownership for active fault units.",
  "Review coaching events with driver-facing language ready.",
  "Check stale telemetry, compliance dates, and document follow-ups.",
  "Leave a concise handoff note for the next safety user."
];
const actionStatusOptions = ["Open", "In Progress", "Blocked", "Done"];
const shiftStatusOptions = ["Open", "Handoff Ready", "Archived"];
const managementOwnerOptions = ["Safety", "Dispatch", "Maintenance", "Driver Manager", "Compliance"];
const EMPTY_SAFETY_LIST = [];

function splitManagementLines(value) {
  return String(value || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function makeManagementId(prefix) {
  const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

function fileNameFromDisposition(headerValue, fallback = "safety_export.xlsx") {
  if (!headerValue) return fallback;
  const encodedMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return encodedMatch[1];
    }
  }
  const basicMatch = headerValue.match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1] || fallback;
}

async function downloadApiFile(path, token = "", fallbackFileName = "safety_export.xlsx") {
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Download failed");
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileNameFromDisposition(response.headers.get("Content-Disposition"), fallbackFileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 0);
}
function createInvestigationDraft(vehicle = null, user = null) {
  const now = new Date().toISOString();
  return {
    id: "",
    createdBy: user?.full_name || "",
    createdByEmail: user?.email || "",
    createdByDepartment: user?.department || "",
    title: "New safety incident",
    type: "Accident",
    status: "Intake",
    severity: "Elevated",
    owner: user?.full_name || "Safety",
    dueDate: "",
    vehicleId: vehicle?.id ? String(vehicle.id) : "",
    facts: "Time, location, people involved, and known sequence of events.",
    evidence: "Photos, dashcam, Motive events, driver statement, dispatch notes.",
    questions: "What happened first?\nWhat evidence is missing?\nWhat action prevents repeat risk?",
    actionPlan: "",
    outcome: "",
    createdAt: now,
    updatedAt: now
  };
}

function createPriorityAction(item, vehicle = null) {
  const queueId = item.queueId || item.queue_id || vehicle?.primary_queue || "watch";
  return {
    id: `live-${queueId}-${item.vehicle_id || vehicle?.id || item.number}`,
    source: "Live Queue",
    title: `${item.number || vehicle?.number || "Unit"}: ${item.summary || vehicle?.headline || "Review safety risk"}`,
    queueId,
    queueLabel: item.queueLabel || queueLabels[queueId] || queueId,
    driverName: vehicle?.driver_name || item.driver_name || "Unassigned",
    contact: vehicle?.driver_contact || item.driver_contact || "",
    truckNumber: item.number || vehicle?.number || "",
    riskLevel: item.risk_level || vehicle?.risk_level || "",
    riskScore: item.risk_score ?? vehicle?.risk_score ?? "",
    status: "Open",
    owner: "Safety",
    dueDate: "Today",
    notes: "",
    summary: item.summary || vehicle?.summary || "",
    recommendedAction: item.actions?.[0] || vehicle?.recommended_actions?.[0] || "Review and assign next owner."
  };
}

function createShiftBriefDraft(user = null, actions = []) {
  const now = new Date().toISOString();
  return {
    id: "",
    createdBy: user?.full_name || "",
    createdByEmail: user?.email || "",
    createdByDepartment: user?.department || "",
    title: `Shift Brief ${formatDate(now)}`,
    shift: "Day Shift",
    status: "Open",
    owner: user?.full_name || "Safety",
    handoffNote: "",
    checklist: shiftBriefChecklist.map((label, index) => ({ id: `check-${index}`, label, done: false })),
    actions,
    createdAt: now,
    updatedAt: now,
    snapshotAt: now
  };
}

function mergeLiveActions(currentActions, liveActions) {
  const currentById = new Map((currentActions || []).map((action) => [action.id, action]));
  const liveIds = new Set((liveActions || []).map((action) => action.id));
  const mergedLive = (liveActions || []).map((action) => {
    const existing = currentById.get(action.id);
    if (!existing) return action;
    return {
      ...action,
      status: existing.status || action.status,
      owner: existing.owner || action.owner,
      dueDate: existing.dueDate || action.dueDate,
      notes: existing.notes || ""
    };
  });
  const manualActions = (currentActions || []).filter((action) => !liveIds.has(action.id) && action.source !== "Live Queue");
  return [...mergedLive, ...manualActions];
}

function buildRiskyPeopleRows(data, source = "Safety") {
  const riskyLevels = new Set(["Critical", "High", "Medium"]);
  const riskyQueues = new Set(["critical", "maintenance", "coaching", "compliance"]);
  return (data?.vehicles || [])
    .filter((vehicle) => {
      const queues = vehicle.queue_ids || [];
      return riskyLevels.has(vehicle.risk_level) || Number(vehicle.risk_score || 0) >= 50 || queues.some((queueId) => riskyQueues.has(queueId));
    })
    .sort((left, right) => Number(right.risk_score || 0) - Number(left.risk_score || 0))
    .map((vehicle) => ({
      Driver: vehicle.driver_name || "Unassigned",
      Contact: vehicle.driver_contact || "",
      Truck: vehicle.number || vehicle.vehicle_label || "",
      Vehicle: vehicle.vehicle_label || "",
      "Risk Level": vehicle.risk_level || "",
      "Risk Score": vehicle.risk_score ?? "",
      Queue: queueLabels[vehicle.primary_queue] || vehicle.primary_queue || "",
      Location: vehicle.location_label || "",
      Faults: vehicle.active_faults ?? 0,
      "Pending Events": vehicle.pending_events ?? 0,
      "Fuel %": vehicle.fuel_level_percent ?? "",
      "Telemetry Age": formatAge(vehicle.age_minutes),
      "Risk Factors": (vehicle.risk_factors || []).map((factor) => `${factor.label}: ${factor.detail}`).join(" | ") || vehicle.headline || vehicle.summary || "",
      "Recommended Actions": (vehicle.recommended_actions || []).join(" | "),
      Snapshot: formatDateTime(data?.fetched_at),
      Source: source
    }));
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("File could not be read."));
    reader.readAsDataURL(file);
  });
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function formatDecimal(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
}

function formatAge(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "No ping";
  if (Number(value) >= 60) {
    return `${formatDecimal(Number(value) / 60)} h`;
  }
  return `${formatDecimal(value)} min`;
}

function formatDurationSeconds(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "Unknown";
  const totalMinutes = Math.max(0, Math.floor(Number(value) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
function isMissingHosClock(eld) {
  return eld?.status === "no_hos_clock" || eld?.source === "eld_device_only";
}

function formatHosClock(value, eld) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return isMissingHosClock(eld) ? "No HOS" : "Unknown";
  }
  return formatDurationSeconds(value);
}

function queueTone(queueId) {
  if (queueId === "critical") return "critical";
  if (queueId === "maintenance") return "maintenance";
  if (queueId === "coaching") return "coaching";
  if (queueId === "compliance") return "compliance";
  return "watch";
}

function riskTone(level) {
  if (level === "Critical") return "critical";
  if (level === "High") return "high";
  if (level === "Medium") return "medium";
  return "low";
}

function SafetyStatCard({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`safety-stat-card safety-stat-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function RiskPill({ level, score }) {
  return <span className={`safety-risk-pill safety-risk-pill-${riskTone(level)}`}>{level} {score}</span>;
}

function QueuePill({ queueId }) {
  return <span className={`safety-queue-pill safety-queue-pill-${queueTone(queueId)}`}>{queueLabels[queueId] || "Queue"}</span>;
}

function SafetyNotesPanel({ token, user }) {
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    let ignore = false;

    async function loadNote() {
      setLoading(true);
      setError("");

      try {
        const data = await apiRequest("/safety/notes", {}, token);
        if (!ignore) {
          const content = data?.content || "";
          setNote(content);
          setSavedNote(content);
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

    loadNote();

    return () => {
      ignore = true;
    };
  }, [token]);

  const hasChanges = note !== savedNote;
  const noteStatus = useMemo(() => {
    if (loading) return "Loading...";
    if (saving) return "Saving...";
    if (hasChanges) return "Unsaved";
    return "Saved";
  }, [hasChanges, loading, saving]);

  async function saveNote() {
    if (!token || saving || !hasChanges) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const data = await apiRequest(
        "/safety/notes",
        {
          method: "PUT",
          body: JSON.stringify({ content: note })
        },
        token
      );
      const content = data?.content || "";
      setNote(content);
      setSavedNote(content);
      setMessage("Notes saved.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel safety-notes-panel">
      <div className="panel-head">
        <div>
          <h2>Safety Notes</h2>
          <span>{user?.full_name || "User"}</span>
        </div>
        <button className="primary-button" type="button" onClick={saveNote} disabled={saving || loading || !hasChanges}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {message ? <div className="notice success inline-notice">{message}</div> : null}
      {error ? <div className="notice error inline-notice">{error}</div> : null}

      <label className="safety-notes-field">
        <span>{noteStatus}</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Write notes, incidents, follow-up items, or reminders here."
          rows={11}
          disabled={loading}
        />
      </label>
    </section>
  );
}

function SafetyDocumentsPanel({ token }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    let ignore = false;

    async function loadDocuments() {
      setLoading(true);
      setError("");

      try {
        const data = await apiRequest("/safety/documents", {}, token);
        if (!ignore) {
          setDocuments(Array.isArray(data) ? data : []);
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

    loadDocuments();

    return () => {
      ignore = true;
    };
  }, [token]);

  const documentsByBucket = useMemo(() => {
    return documentSections.reduce((accumulator, section) => {
      accumulator[section.id] = documents.filter((item) => item.bucket === section.id);
      return accumulator;
    }, {});
  }, [documents]);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError("");
    setMessage("");

    if (file.size > MAX_DOCUMENT_BYTES) {
      setError(`File is too large. Keep it under ${formatBytes(MAX_DOCUMENT_BYTES)}.`);
      event.target.value = "";
      return;
    }

    setUploading(true);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const created = await apiRequest(
        "/safety/documents",
        {
          method: "POST",
          body: JSON.stringify({
            file_name: file.name,
            content_type: file.type || "application/octet-stream",
            data_url: dataUrl
          })
        },
        token
      );
      setDocuments((current) => [created, ...current]);
      setMessage(`${file.name} sorted to ${documentSections.find((section) => section.id === created.bucket)?.label || "Documents"}.`);
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <section className="workspace-content-stack">
      <section className="panel safety-upload-panel">
        <div className="panel-head">
          <div>
            <h2>Document Intake</h2>
            <span>Upload and sort with AI.</span>
          </div>
          <button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading..." : "Upload Document"}
          </button>
        </div>

        <div className="safety-upload-row">
          <div className="safety-upload-copy">
            <strong>Supported</strong>
            <span>PDF, DOCX, TXT, MD, CSV, JSON, PNG, JPG, WEBP, GIF</span>
          </div>
          <div className="safety-upload-copy subdued">
            <strong>AI routing</strong>
            <span>Approved, Needs Review, or Bad Documents</span>
          </div>
        </div>

        {message ? <div className="notice success inline-notice">{message}</div> : null}
        {error ? <div className="notice error inline-notice">{error}</div> : null}

        <input
          ref={fileInputRef}
          className="safety-document-input"
          type="file"
          accept={DOCUMENT_ACCEPT}
          onChange={handleFileChange}
          disabled={uploading}
        />
      </section>

      <section className="safety-document-lanes">
        {documentSections.map((section) => {
          const items = documentsByBucket[section.id] || [];

          return (
            <section className={`panel safety-document-lane safety-document-lane-${section.id}`} key={section.id}>
              <div className="panel-head">
                <div>
                  <h2>{section.label}</h2>
                  <span>{items.length}</span>
                </div>
              </div>

              <div className="safety-document-list">
                {loading ? (
                  <div className="safety-document-empty">Loading...</div>
                ) : items.length ? (
                  items.map((document) => (
                    <article className="safety-document-card" key={document.id}>
                      <span className="safety-document-type">{document.document_type}</span>
                      <strong>{document.file_name}</strong>
                      <p>{document.summary}</p>
                      {document.issues?.length ? (
                        <div className="safety-document-issues">
                          {document.issues.map((issue) => (
                            <span key={`${document.id}-${issue}`}>{issue}</span>
                          ))}
                        </div>
                      ) : null}
                      <small>{document.recommended_action}</small>
                      <em>{formatDate(document.created_at)}</em>
                    </article>
                  ))
                ) : (
                  <div className="safety-document-empty">{section.empty}</div>
                )}
              </div>
            </section>
          );
        })}
      </section>
    </section>
  );
}

function SafetyFleetPanel({ data, loading, refreshing, error, onRefresh }) {
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("All");
  const [queueFilter, setQueueFilter] = useState("All");
  const [focusFilter, setFocusFilter] = useState("All");
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);

  const vehicles = data?.vehicles || EMPTY_SAFETY_LIST;
  const metrics = data?.metrics || {};
  const riskOptions = data?.filters?.risk_levels || ["All", "Critical", "High", "Medium", "Low"];
  const queueOptions = data?.filters?.queue_ids || ["All", "critical", "maintenance", "coaching", "compliance", "watch"];
  const focusOptions = data?.filters?.focus_options || ["All", "Faults", "Coaching", "Compliance", "Stale", "Low Fuel", "HOS"];

  const filteredVehicles = useMemo(() => {
    const term = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const matchesSearch = !term || (vehicle.search_terms || "").includes(term);
      const matchesRisk = riskFilter === "All" || vehicle.risk_level === riskFilter;
      const matchesQueue = queueFilter === "All" || (vehicle.queue_ids || []).includes(queueFilter);
      const matchesFocus =
        focusFilter === "All" ||
        (focusFilter === "Faults" && (vehicle.active_faults || 0) > 0) ||
        (focusFilter === "Coaching" && (vehicle.pending_events || 0) > 0) ||
        (focusFilter === "Compliance" && ((vehicle.queue_ids || []).includes("compliance") || (vehicle.unsafe_inspections || 0) > 0)) ||
        (focusFilter === "Stale" && vehicle.is_stale) ||
        (focusFilter === "Low Fuel" && vehicle.fuel_level_percent !== null && vehicle.fuel_level_percent !== undefined && vehicle.fuel_level_percent <= 25) ||
        (focusFilter === "HOS" && ["warning", "violation", "no_hos_clock"].includes(vehicle.eld_status));
      return matchesSearch && matchesRisk && matchesQueue && matchesFocus;
    });
  }, [focusFilter, queueFilter, riskFilter, search, vehicles]);

  useEffect(() => {
    if (!filteredVehicles.length) {
      setSelectedVehicleId(null);
      return;
    }
    if (!filteredVehicles.some((vehicle) => vehicle.id === selectedVehicleId)) {
      setSelectedVehicleId(filteredVehicles[0].id);
    }
  }, [filteredVehicles, selectedVehicleId]);

  const selectedVehicle = useMemo(() => {
    return filteredVehicles.find((vehicle) => vehicle.id === selectedVehicleId) || filteredVehicles[0] || null;
  }, [filteredVehicles, selectedVehicleId]);

  return (
    <section className="workspace-content-stack safety-fleet-stack">
      <section className="safety-fleet-metrics">
        <SafetyStatCard label="Units" value={formatCount(metrics.total_units)} detail="Live Motive safety fleet" tone="neutral" />
        <SafetyStatCard label="Critical" value={formatCount(metrics.critical_units)} detail="Immediate action" tone="critical" />
        <SafetyStatCard label="High Risk" value={formatCount(metrics.high_risk_units)} detail="Critical + high" tone="alert" />
        <SafetyStatCard label="Fault Units" value={formatCount(metrics.active_fault_units)} detail="Active faults" tone="warning" />
        <SafetyStatCard label="Coaching" value={formatCount(metrics.event_review_units)} detail="Pending events" tone="info" />
        <SafetyStatCard label="Avg Risk" value={formatDecimal(metrics.average_risk_score)} detail="0 to 100 score" tone="dark" />
        <SafetyStatCard label="HOS" value={formatCount(metrics.hos_warning_units)} detail="Warnings or violations" tone="critical" />
      </section>

      <section className="panel safety-filter-panel">
        <div className="panel-head">
          <div>
            <h2>Fleet Safety Watch</h2>
            <span>{data?.company?.name ? `${data.company.name} live truck safety view.` : "Truck safety data from Motive."}</span>
          </div>
          <button className="primary-button" type="button" onClick={() => onRefresh(true)} disabled={loading || refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error ? <div className="notice error inline-notice">{error}</div> : null}
        {data?.warnings?.length ? <div className="notice info inline-notice">{data.warnings[0]}</div> : null}

        <div className="safety-filter-grid">
          <label>
            Search trucks
            <input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Truck, VIN, location, issue, action" />
          </label>
          <label>
            Risk
            <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)}>
              {riskOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label>
            Queue
            <select value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)}>
              {queueOptions.map((option) => (
                <option key={option} value={option}>{option === "All" ? "All" : queueLabels[option] || option}</option>
              ))}
            </select>
          </label>
          <label>
            Focus
            <select value={focusFilter} onChange={(event) => setFocusFilter(event.target.value)}>
              {focusOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="safety-filter-summary">
          <strong>{formatCount(filteredVehicles.length)}</strong>
          <span>truck(s) match the current safety filters. Snapshot updated {formatDateTime(data?.fetched_at)}.</span>
        </div>
      </section>

      {loading && !data ? (
        <section className="panel safety-empty-state">Loading fleet safety data...</section>
      ) : (
        <div className="safety-fleet-layout">
          <section className="panel safety-vehicle-list-panel">
            <div className="panel-head compact-panel-head">
              <div>
                <h2>Trucks</h2>
                <span>Sorted by risk score</span>
              </div>
            </div>
            <div className="safety-vehicle-list">
              {filteredVehicles.length ? (
                filteredVehicles.map((vehicle) => (
                  <button
                    key={vehicle.id}
                    type="button"
                    className={`safety-vehicle-card ${selectedVehicle?.id === vehicle.id ? "active" : ""}`}
                    onClick={() => setSelectedVehicleId(vehicle.id)}
                  >
                    <div className="safety-vehicle-head">
                      <div>
                        <strong>{vehicle.number}</strong>
                        <span>{vehicle.vehicle_label}</span>
                      </div>
                      <RiskPill level={vehicle.risk_level} score={vehicle.risk_score} />
                    </div>

                    <div className="safety-vehicle-summary-row">
                      <QueuePill queueId={vehicle.primary_queue} />
                      <small>{vehicle.location_label}</small>
                    </div>

                    <div className="safety-vehicle-stat-row">
                      <div><span>Faults</span><strong>{formatCount(vehicle.active_faults)}</strong></div>
                      <div><span>Events</span><strong>{formatCount(vehicle.pending_events)}</strong></div>
                      <div><span>Fuel</span><strong>{vehicle.fuel_level_percent !== null && vehicle.fuel_level_percent !== undefined ? `${formatDecimal(vehicle.fuel_level_percent)}%` : "-"}</strong></div>
                      <div><span>Ping</span><strong>{formatAge(vehicle.age_minutes)}</strong></div>
                      <div><span>HOS</span><strong>{formatHosClock(vehicle.drive_remaining_seconds, vehicle.eld_hours)}</strong></div>
                    </div>

                    {vehicle.tags?.length ? (
                      <div className="safety-chip-row">
                        {vehicle.tags.slice(0, 4).map((tag) => (
                          <span className="safety-chip" key={`${vehicle.id}-${tag}`}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                ))
              ) : (
                <div className="safety-empty-state">No trucks match the current filters.</div>
              )}
            </div>
          </section>

          <aside className="panel safety-detail-panel">
            {selectedVehicle ? (
              <>
                <div className="panel-head safety-detail-head">
                  <div>
                    <h2>{selectedVehicle.number}</h2>
                    <span>{selectedVehicle.vehicle_label}</span>
                  </div>
                  <div className="safety-detail-head-actions">
                    <QueuePill queueId={selectedVehicle.primary_queue} />
                    <RiskPill level={selectedVehicle.risk_level} score={selectedVehicle.risk_score} />
                  </div>
                </div>

                <div className="safety-detail-kicker">
                  <strong>{selectedVehicle.headline}</strong>
                  <p>{selectedVehicle.summary}</p>
                </div>

                <div className="safety-detail-card-grid">
                  <SafetyStatCard label="Faults" value={formatCount(selectedVehicle.active_faults)} detail="Active fault codes" tone="warning" />
                  <SafetyStatCard label="Pending Events" value={formatCount(selectedVehicle.pending_events)} detail="Need coaching review" tone="info" />
                  <SafetyStatCard label="Fuel" value={selectedVehicle.fuel_level_percent !== null && selectedVehicle.fuel_level_percent !== undefined ? `${formatDecimal(selectedVehicle.fuel_level_percent)}%` : "-"} detail={selectedVehicle.is_moving ? "Truck moving" : selectedVehicle.is_stale ? "Telemetry stale" : "Truck stopped"} tone="neutral" />
                  <SafetyStatCard label="Ping Age" value={formatAge(selectedVehicle.age_minutes)} detail={selectedVehicle.last_location_at ? formatDateTime(selectedVehicle.last_location_at) : "No live timestamp"} tone="dark" />
                  <SafetyStatCard label="Drive Left" value={formatHosClock(selectedVehicle.drive_remaining_seconds, selectedVehicle.eld_hours)} detail={selectedVehicle.eld_hours?.summary || selectedVehicle.eld_status || "HOS clock"} tone={selectedVehicle.eld_status === "violation" ? "critical" : selectedVehicle.eld_status === "warning" || selectedVehicle.eld_status === "no_hos_clock" ? "warning" : "neutral"} />
                </div>

                <div className="safety-detail-list">
                  <div><span>Driver</span><strong>{selectedVehicle.driver_name}</strong><small>{selectedVehicle.driver_contact || "No mapped contact"}</small></div>
                  <div><span>Location</span><strong>{selectedVehicle.location_label}</strong><small>{selectedVehicle.status}</small></div>
                  <div><span>VIN / ELD</span><strong>{selectedVehicle.vin || "Not available"}</strong><small>{selectedVehicle.eld_connected ? `ELD connected | ${selectedVehicle.eld_status || "HOS n/a"}` : selectedVehicle.eld_status || "No ELD summary"}</small></div>
                  <div><span>Registration</span><strong>{selectedVehicle.registration?.date || "Not tracked"}</strong><small>{selectedVehicle.registration?.label || "No registration status"}</small></div>
                  <div><span>Shift / Cycle</span><strong>{formatHosClock(selectedVehicle.shift_remaining_seconds, selectedVehicle.eld_hours)}</strong><small>{formatHosClock(selectedVehicle.cycle_remaining_seconds, selectedVehicle.eld_hours)} cycle left</small></div>
                </div>

                <section className="safety-detail-section">
                  <h3>Risk Factors</h3>
                  {selectedVehicle.risk_factors?.length ? (
                    <div className="safety-detail-bullets">
                      {selectedVehicle.risk_factors.map((factor) => (
                        <div key={`${selectedVehicle.id}-${factor.label}`} className="safety-detail-bullet">
                          <strong>{factor.label}</strong>
                          <span>{factor.detail}</span>
                          <small>+{factor.points}</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="safety-empty-inline">No active risk factors on this truck.</div>
                  )}
                </section>

                <section className="safety-detail-section">
                  <h3>Recommended Actions</h3>
                  <div className="safety-action-list">
                    {(selectedVehicle.recommended_actions || []).map((action) => (
                      <div key={`${selectedVehicle.id}-${action}`} className="safety-action-item">{action}</div>
                    ))}
                  </div>
                </section>

                {selectedVehicle.top_behaviors?.length ? (
                  <section className="safety-detail-section">
                    <h3>Behavior Focus</h3>
                    <div className="safety-chip-row">
                      {selectedVehicle.top_behaviors.map((behavior) => (
                        <span className="safety-chip strong" key={`${selectedVehicle.id}-${behavior}`}>{behavior}</span>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            ) : (
              <div className="safety-empty-state">Select a truck to inspect its safety profile.</div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

function SafetyAutomationPanel({ data, loading, refreshing, error, onRefresh }) {
  const metrics = data?.metrics || {};
  const algorithm = data?.algorithm || {};
  const queues = data?.queues || EMPTY_SAFETY_LIST;

  return (
    <section className="workspace-content-stack safety-automation-stack">
      <section className="panel safety-automation-header">
        <div className="panel-head">
          <div>
            <h2>{algorithm.name || "Safety Automation"}</h2>
            <span>{algorithm.summary || "Automated queueing for safety operations."}</span>
          </div>
          <button className="primary-button" type="button" onClick={() => onRefresh(true)} disabled={loading || refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error ? <div className="notice error inline-notice">{error}</div> : null}

        <div className="safety-automation-metrics">
          <SafetyStatCard label="Immediate" value={formatCount(metrics.critical_units)} detail="Need same-day action" tone="critical" />
          <SafetyStatCard label="Maintenance" value={formatCount(metrics.maintenance_units)} detail="Fault-driven queue" tone="warning" />
          <SafetyStatCard label="Coaching" value={formatCount(metrics.coaching_units)} detail="Behavior follow-up" tone="info" />
          <SafetyStatCard label="Compliance" value={formatCount(metrics.compliance_units)} detail="Docs, telemetry, expiry" tone="neutral" />
        </div>

        <div className="safety-automation-summary-grid">
          <section className="safety-automation-summary-card">
            <h3>Daily Focus</h3>
            <div className="safety-detail-bullets compact">
              {(algorithm.focus || []).map((item) => (
                <div className="safety-detail-bullet" key={item}>
                  <strong>Priority</strong>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="safety-automation-summary-card">
            <h3>Engine Rules</h3>
            <div className="safety-detail-bullets compact">
              {(algorithm.rules || []).map((item) => (
                <div className="safety-detail-bullet" key={item}>
                  <strong>Rule</strong>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="safety-automation-summary-card">
            <h3>Live Signals</h3>
            {algorithm.active_signals?.length ? (
              <div className="safety-chip-row">
                {algorithm.active_signals.map((item) => (
                  <span className="safety-chip" key={item}>{item}</span>
                ))}
              </div>
            ) : (
              <div className="safety-empty-inline">No live Motive signals detected.</div>
            )}
          </section>
        </div>
      </section>

      {loading && !data ? <section className="panel safety-empty-state">Loading automation queues...</section> : null}

      <section className="safety-automation-grid">
        {queues.map((queue) => (
          <section className={`panel safety-automation-queue safety-automation-queue-${queue.id}`} key={queue.id}>
            <div className="panel-head">
              <div>
                <h2>{queue.label}</h2>
                <span>{queue.description}</span>
              </div>
              <strong>{formatCount(queue.count)}</strong>
            </div>

            <div className="safety-automation-list">
              {queue.items?.length ? (
                queue.items.map((item) => (
                  <article className="safety-automation-item" key={`${queue.id}-${item.vehicle_id}`}>
                    <div className="safety-vehicle-head compact">
                      <div>
                        <strong>{item.number}</strong>
                        <span>{item.location_label}</span>
                      </div>
                      <RiskPill level={item.risk_level} score={item.risk_score} />
                    </div>
                    <p>{item.summary}</p>
                    {item.reasons?.length ? (
                      <div className="safety-chip-row">
                        {item.reasons.map((reason) => (
                          <span className="safety-chip" key={`${item.vehicle_id}-${reason}`}>{reason}</span>
                        ))}
                      </div>
                    ) : null}
                    {item.actions?.length ? <small>{item.actions[0]}</small> : null}
                  </article>
                ))
              ) : (
                <div className="safety-empty-state small">No trucks in this queue.</div>
              )}
            </div>
          </section>
        ))}
      </section>
    </section>
  );
}

function SafetyInvestigationPanel({ token, user, data, loading, refreshing, error, onRefresh }) {
  const vehicles = data?.vehicles || EMPTY_SAFETY_LIST;
  const [cases, setCases] = useState([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [caseSaving, setCaseSaving] = useState(false);
  const [caseExporting, setCaseExporting] = useState(false);
  const [caseError, setCaseError] = useState("");
  const [activeCaseId, setActiveCaseId] = useState("");
  const [caseSearch, setCaseSearch] = useState("");
  const [caseStatusFilter, setCaseStatusFilter] = useState("All");
  const [caseMessage, setCaseMessage] = useState("");
  const [draft, setDraft] = useState(() => createInvestigationDraft(null, user));

  const loadCases = useCallback(async () => {
    if (!token) {
      setCases([]);
      setCasesLoading(false);
      return;
    }

    setCasesLoading(true);
    setCaseError("");

    try {
      const items = await apiRequest("/safety/investigations", {}, token);
      setCases(Array.isArray(items) ? items.map((item) => ({ ...item, vehicleId: item.vehicleId ? String(item.vehicleId) : "" })) : []);
    } catch (loadError) {
      setCaseError(loadError.message || "Incidents could not be loaded.");
    } finally {
      setCasesLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  useEffect(() => {
    if (!vehicles.length) {
      if (draft.vehicleId) {
        setDraft((current) => ({ ...current, vehicleId: "" }));
      }
      return;
    }

    if (!draft.vehicleId && !draft.id) {
      setDraft((current) => ({ ...current, vehicleId: String(vehicles[0].id) }));
      return;
    }

    if (draft.vehicleId && !vehicles.some((vehicle) => String(vehicle.id) === String(draft.vehicleId))) {
      setDraft((current) => ({ ...current, vehicleId: "" }));
    }
  }, [draft.id, draft.vehicleId, vehicles]);

  const vehicleById = useMemo(() => {
    return new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle]));
  }, [vehicles]);

  const selectedVehicle = vehicleById.get(String(draft.vehicleId)) || null;
  const riskyPeopleRows = useMemo(() => buildRiskyPeopleRows(data, "Incident Queue"), [data]);
  const openCaseCount = cases.filter((caseItem) => caseItem.status !== "Closed").length;
  const criticalCaseCount = cases.filter((caseItem) => caseItem.severity === "Critical" || caseItem.severity === "High").length;

  const filteredCases = useMemo(() => {
    const term = caseSearch.trim().toLowerCase();
    return cases.filter((caseItem) => {
      const caseVehicle = vehicleById.get(String(caseItem.vehicleId)) || null;
      const haystack = [
        caseItem.title,
        caseItem.type,
        caseItem.status,
        caseItem.severity,
        caseItem.owner,
        caseItem.createdBy,
        caseItem.createdByEmail,
        caseItem.createdByDepartment,
        caseItem.facts,
        caseVehicle?.number,
        caseVehicle?.driver_name
      ].join(" ").toLowerCase();
      const matchesSearch = !term || haystack.includes(term);
      const matchesStatus = caseStatusFilter === "All" || caseItem.status === caseStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [caseSearch, caseStatusFilter, cases, vehicleById]);

  const investigationContext = useMemo(() => {
    const vehicleContext = selectedVehicle
      ? [
          `Truck: ${selectedVehicle.number}`,
          `Driver: ${selectedVehicle.driver_name || "Unknown"}`,
          `Risk: ${selectedVehicle.risk_level} ${selectedVehicle.risk_score}`,
          `Location: ${selectedVehicle.location_label || "Unknown"}`,
          `Current queue: ${queueLabels[selectedVehicle.primary_queue] || selectedVehicle.primary_queue || "None"}`,
          `Headline: ${selectedVehicle.headline || "No headline"}`,
          `Summary: ${selectedVehicle.summary || "No summary"}`,
          `Recommended actions: ${(selectedVehicle.recommended_actions || []).join(" | ") || "None listed"}`,
          `Risk factors: ${(selectedVehicle.risk_factors || []).map((factor) => `${factor.label}: ${factor.detail}`).join(" | ") || "None listed"}`
        ].join("\n")
      : "Truck: Not selected";

    return [
      "Safety incident queue. Treat this as an internal case review.",
      "Separate confirmed facts, assumptions, missing evidence, driver interview questions, and next actions.",
      `Incident title: ${draft.title}`,
      `Incident type: ${draft.type}`,
      `Severity: ${draft.severity}`,
      `Status: ${draft.status}`,
      `Owner: ${draft.owner || "Unassigned"}`,
      `Added by: ${draft.createdBy || "Unknown user"}`,
      `Due date: ${draft.dueDate || "Not set"}`,
      vehicleContext,
      `Known facts:\n${draft.facts}`,
      `Evidence list:\n${draft.evidence}`,
      `Open questions:\n${draft.questions}`,
      `Action plan:\n${draft.actionPlan || "Not written yet."}`,
      `Outcome:\n${draft.outcome || "Not closed yet."}`
    ].join("\n\n");
  }, [draft, selectedVehicle]);

  function updateDraft(field, value) {
    setCaseMessage("");
    setCaseError("");
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function startNewCase() {
    setCaseMessage("");
    setCaseError("");
    setActiveCaseId("");
    setDraft(createInvestigationDraft(vehicles[0] || null, user));
  }

  function casePayload(caseDraft) {
    return {
      title: caseDraft.title.trim() || "Untitled safety incident",
      type: caseDraft.type || "Accident",
      status: caseDraft.status || "Intake",
      severity: caseDraft.severity || "Elevated",
      owner: caseDraft.owner.trim() || user?.full_name || "Safety",
      dueDate: caseDraft.dueDate || "",
      vehicleId: caseDraft.vehicleId ? String(caseDraft.vehicleId) : "",
      facts: caseDraft.facts || "",
      evidence: caseDraft.evidence || "",
      questions: caseDraft.questions || "",
      actionPlan: caseDraft.actionPlan || "",
      outcome: caseDraft.outcome || ""
    };
  }

  async function saveCase(draftOverride = draft) {
    if (!token || caseSaving) return null;

    setCaseSaving(true);
    setCaseError("");
    setCaseMessage("");

    try {
      const hasId = Boolean(draftOverride.id);
      const saved = await apiRequest(
        hasId ? `/safety/investigations/${draftOverride.id}` : "/safety/investigations",
        {
          method: hasId ? "PUT" : "POST",
          body: JSON.stringify(casePayload(draftOverride))
        },
        token
      );
      const normalized = { ...saved, vehicleId: saved.vehicleId ? String(saved.vehicleId) : "" };
      setCases((current) => {
        const exists = current.some((caseItem) => caseItem.id === normalized.id);
        return exists
          ? current.map((caseItem) => (caseItem.id === normalized.id ? normalized : caseItem))
          : [normalized, ...current];
      });
      setDraft({ ...createInvestigationDraft(null, user), ...normalized });
      setActiveCaseId(normalized.id);
      setCaseMessage("Incident saved to database.");
      return normalized;
    } catch (saveError) {
      setCaseError(saveError.message || "Incident could not be saved.");
      return null;
    } finally {
      setCaseSaving(false);
    }
  }

  function loadCase(caseItem) {
    setCaseMessage("");
    setCaseError("");
    setActiveCaseId(caseItem.id);
    setDraft({ ...createInvestigationDraft(null, user), ...caseItem, vehicleId: caseItem.vehicleId ? String(caseItem.vehicleId) : "" });
  }

  async function duplicateCase() {
    const now = new Date().toISOString();
    await saveCase({
      ...draft,
      id: "",
      title: `${draft.title || "Incident"} copy`,
      status: "Intake",
      createdAt: now,
      updatedAt: now
    });
  }

  async function deleteCase(caseId = draft.id) {
    if (!caseId) {
      startNewCase();
      return;
    }

    const shouldDelete = typeof window === "undefined" || window.confirm("Delete this incident from the database?");
    if (!shouldDelete) return;

    setCaseSaving(true);
    setCaseError("");
    setCaseMessage("");

    try {
      await apiRequest(`/safety/investigations/${caseId}`, { method: "DELETE" }, token);
      setCases((current) => current.filter((caseItem) => caseItem.id !== caseId));
      startNewCase();
      setCaseMessage("Incident deleted from database.");
    } catch (deleteError) {
      setCaseError(deleteError.message || "Incident could not be deleted.");
    } finally {
      setCaseSaving(false);
    }
  }

  async function closeCase() {
    await saveCase({ ...draft, status: "Closed" });
  }

  async function exportCasesExcel() {
    if (!token || caseExporting) return;
    setCaseExporting(true);
    setCaseError("");
    try {
      await downloadApiFile("/safety/investigations/export", token, "safety_investigations.xlsx");
    } catch (exportError) {
      setCaseError(exportError.message || "Incidents export failed.");
    } finally {
      setCaseExporting(false);
    }
  }

  async function exportRiskyPeopleExcel() {
    if (!token || caseExporting) return;
    setCaseExporting(true);
    setCaseError("");
    try {
      await downloadApiFile("/safety/risky-people/export", token, "safety_risky_people.xlsx");
    } catch (exportError) {
      setCaseError(exportError.message || "Risky people export failed.");
    } finally {
      setCaseExporting(false);
    }
  }

  return (
    <section className="workspace-content-stack safety-investigation-stack">
      <section className="panel safety-investigation-hero">
        <div className="panel-head safety-management-head">
          <div>
            <h2>Incident Queue</h2>
            <span>Shared incident cases, accident follow-ups, tasks from other workers, archives, and exports.</span>
          </div>
          <div className="safety-management-actions">
            <button className="secondary-button" type="button" onClick={startNewCase} disabled={caseSaving}>New Incident</button>
            <button className="primary-button" type="button" onClick={() => saveCase()} disabled={caseSaving || !token}>{caseSaving ? "Saving..." : "Save Incident"}</button>
            <button className="secondary-button" type="button" onClick={exportCasesExcel} disabled={caseExporting || !token}>{caseExporting ? "Exporting..." : "Export Incidents Excel"}</button>
            <button className="secondary-button" type="button" onClick={exportRiskyPeopleExcel} disabled={caseExporting || !token}>Export Risky People Excel</button>
            <button className="secondary-button" type="button" onClick={() => onRefresh(true)} disabled={loading || refreshing}>
              {refreshing ? "Refreshing..." : "Refresh Fleet"}
            </button>
          </div>
        </div>

        {caseMessage ? <div className="notice success inline-notice">{caseMessage}</div> : null}
        {caseError ? <div className="notice error inline-notice">{caseError}</div> : null}
        {error ? <div className="notice error inline-notice">{error}</div> : null}

        <div className="safety-investigation-metrics">
          <SafetyStatCard label="Team Incidents" value={formatCount(cases.length)} detail={`${formatCount(openCaseCount)} open`} tone="neutral" />
          <SafetyStatCard label="High Severity" value={formatCount(criticalCaseCount)} detail="High or critical incidents" tone="critical" />
          <SafetyStatCard label="Risky People" value={formatCount(riskyPeopleRows.length)} detail="Ready for backend Excel export" tone="warning" />
          <SafetyStatCard label="Current Packet" value={draft.status} detail={`${draft.type} | ${draft.severity}`} tone={draft.severity === "Critical" ? "critical" : "info"} />
        </div>
      </section>

      <div className="safety-investigation-management-layout">
        <section className="panel safety-management-registry-panel">
          <div className="panel-head compact-panel-head">
            <div>
              <h2>Incident Registry</h2>
              <span>{casesLoading ? "Loading incidents..." : `${formatCount(filteredCases.length)} incident(s) visible`}</span>
            </div>
          </div>

          <div className="safety-management-filter-grid compact">
            <label>
              Search
              <input type="text" value={caseSearch} onChange={(event) => setCaseSearch(event.target.value)} placeholder="Title, owner, reporter, driver, truck" />
            </label>
            <label>
              Status
              <select value={caseStatusFilter} onChange={(event) => setCaseStatusFilter(event.target.value)}>
                <option value="All">All</option>
                {investigationStatuses.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>

          <div className="safety-management-list">
            {filteredCases.length ? filteredCases.map((caseItem) => {
              const caseVehicle = vehicleById.get(String(caseItem.vehicleId)) || null;
              return (
                <button
                  className={`safety-management-list-card ${activeCaseId === caseItem.id ? "active" : ""}`}
                  type="button"
                  key={caseItem.id}
                  onClick={() => loadCase(caseItem)}
                >
                  <div className="safety-management-card-top">
                    <strong>{caseItem.title}</strong>
                    <span>{caseItem.status}</span>
                  </div>
                  <small>{caseItem.type} | {caseItem.severity} | {caseVehicle?.number || "No truck"}</small>
                  <small>Added by {caseItem.createdBy || "Unknown user"}{caseItem.createdByDepartment ? ` | ${caseItem.createdByDepartment}` : ""}</small>
                  <p>{splitManagementLines(caseItem.facts)[0] || "No facts added."}</p>
                  <em>Updated {formatDateTime(caseItem.updatedAt)}</em>
                </button>
              );
            }) : <div className="safety-empty-state small">{casesLoading ? "Loading saved incidents..." : "No incidents yet. Save the current packet or wait for worker reports to start the registry."}</div>}
          </div>
        </section>

        <section className="panel safety-investigation-case-panel">
          <div className="panel-head compact-panel-head">
            <div>
              <h2>Incident Packet</h2>
              <span>{draft.id ? `Added by ${draft.createdBy || "Unknown user"}` : `${formatCount(vehicles.length)} truck(s) available`}</span>
            </div>
          </div>

          <div className="safety-investigation-form">
            <label>
              Incident Title
              <input type="text" value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} />
            </label>
            <label>
              Type
              <select value={draft.type} onChange={(event) => updateDraft("type", event.target.value)}>
                {investigationTypes.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              Severity
              <select value={draft.severity} onChange={(event) => updateDraft("severity", event.target.value)}>
                {investigationSeverities.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              Status
              <select value={draft.status} onChange={(event) => updateDraft("status", event.target.value)}>
                {investigationStatuses.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              Owner
              <input type="text" value={draft.owner} onChange={(event) => updateDraft("owner", event.target.value)} list="safety-management-owner-options" />
            </label>
            <label>
              Due Date
              <input type="date" value={draft.dueDate || ""} onChange={(event) => updateDraft("dueDate", event.target.value)} />
            </label>
            <label>
              Truck Context
              <select value={draft.vehicleId} onChange={(event) => updateDraft("vehicleId", event.target.value)}>
                <option value="">No truck selected</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.number} | {vehicle.driver_name || "No driver"} | {vehicle.risk_level} {vehicle.risk_score}</option>
                ))}
              </select>
            </label>
            <label>
              Known Facts
              <textarea value={draft.facts} onChange={(event) => updateDraft("facts", event.target.value)} rows={5} />
            </label>
            <label>
              Evidence
              <textarea value={draft.evidence} onChange={(event) => updateDraft("evidence", event.target.value)} rows={4} />
            </label>
            <label>
              Open Questions
              <textarea value={draft.questions} onChange={(event) => updateDraft("questions", event.target.value)} rows={4} />
            </label>
            <label>
              Action Plan
              <textarea value={draft.actionPlan} onChange={(event) => updateDraft("actionPlan", event.target.value)} rows={4} placeholder="Corrective action, owner, prevention step, deadline." />
            </label>
            <label>
              Outcome
              <textarea value={draft.outcome} onChange={(event) => updateDraft("outcome", event.target.value)} rows={3} placeholder="Closure summary, final decision, coaching or maintenance result." />
            </label>
          </div>

          <datalist id="safety-management-owner-options">
            {managementOwnerOptions.map((option) => <option key={option} value={option} />)}
          </datalist>

          <div className="safety-management-actions case-actions">
            <button className="primary-button" type="button" onClick={() => saveCase()} disabled={caseSaving || !token}>{caseSaving ? "Saving..." : "Save"}</button>
            <button className="secondary-button" type="button" onClick={duplicateCase} disabled={caseSaving || !token}>Duplicate</button>
            <button className="secondary-button" type="button" onClick={closeCase} disabled={caseSaving || !token}>Close Incident</button>
            <button className="delete-button" type="button" onClick={() => deleteCase()} disabled={!draft.id || caseSaving || !token}>Delete</button>
          </div>

          <section className="safety-investigation-context-card">
            <strong>AI incident context</strong>
            <pre>{investigationContext}</pre>
          </section>
        </section>

        <UnitedLaneChat
          token={token}
          user={user}
          title="Incident AI"
          assistantName="Safety Investigator"
          workspace="Safety Incident"
          extraContext={investigationContext}
          promptOptions={investigationPromptOptions}
          welcomeText="Safety Investigator is ready. Fill the incident packet, then ask for a plan, interview questions, or missing evidence."
          placeholder="Ask the investigator to build a timeline, identify gaps, draft interview questions, or write the corrective action plan."
          className="safety-investigation-ai-panel"
        />
      </div>
    </section>
  );
}

function SafetyShiftBriefPanel({ token, data, user, loading, refreshing, error, onRefresh }) {
  const metrics = data?.metrics || {};
  const queues = data?.queues || EMPTY_SAFETY_LIST;
  const vehicles = data?.vehicles || EMPTY_SAFETY_LIST;
  const [briefs, setBriefs] = useState([]);
  const [briefsLoading, setBriefsLoading] = useState(false);
  const [briefSaving, setBriefSaving] = useState(false);
  const [briefExporting, setBriefExporting] = useState(false);
  const [briefError, setBriefError] = useState("");
  const [activeBriefId, setActiveBriefId] = useState("");
  const [briefSearch, setBriefSearch] = useState("");
  const [actionSearch, setActionSearch] = useState("");
  const [actionStatusFilter, setActionStatusFilter] = useState("All");
  const [manualActionTitle, setManualActionTitle] = useState("");
  const [briefMessage, setBriefMessage] = useState("");

  const loadBriefs = useCallback(async () => {
    if (!token) {
      setBriefs([]);
      setBriefsLoading(false);
      return;
    }

    setBriefsLoading(true);
    setBriefError("");

    try {
      const items = await apiRequest("/safety/shift-briefs", {}, token);
      setBriefs(Array.isArray(items) ? items : []);
    } catch (loadError) {
      setBriefError(loadError.message || "Shift briefs could not be loaded.");
    } finally {
      setBriefsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadBriefs();
  }, [loadBriefs]);

  const vehicleById = useMemo(() => {
    return new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle]));
  }, [vehicles]);

  const priorityItems = useMemo(
    () => queues.flatMap((queue) => (queue.items || []).slice(0, 3).map((item) => ({ ...item, queueId: queue.id, queueLabel: queue.label }))).slice(0, 10),
    [queues]
  );

  const liveActions = useMemo(
    () => priorityItems.map((item) => createPriorityAction(item, vehicleById.get(String(item.vehicle_id)) || null)),
    [priorityItems, vehicleById]
  );

  const [draft, setDraft] = useState(() => createShiftBriefDraft(user, []));

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      actions: mergeLiveActions(current.actions || [], liveActions),
      snapshotAt: data?.fetched_at || current.snapshotAt
    }));
  }, [data?.fetched_at, liveActions]);

  const checklist = draft.checklist?.length ? draft.checklist : shiftBriefChecklist.map((label, index) => ({ id: `check-${index}`, label, done: false }));
  const actions = draft.actions || [];
  const doneChecklistCount = checklist.filter((item) => item.done).length;
  const doneActionCount = actions.filter((item) => item.status === "Done").length;
  const openActionCount = actions.filter((item) => item.status !== "Done").length;
  const riskyPeopleRows = useMemo(() => buildRiskyPeopleRows(data, "Shift Brief"), [data]);

  const filteredBriefs = useMemo(() => {
    const term = briefSearch.trim().toLowerCase();
    return briefs.filter((brief) => {
      if (!term) return true;
      return [brief.title, brief.shift, brief.status, brief.owner, brief.createdBy, brief.createdByEmail, brief.createdByDepartment, brief.handoffNote]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [briefSearch, briefs]);

  const filteredActions = useMemo(() => {
    const term = actionSearch.trim().toLowerCase();
    return actions.filter((action) => {
      const matchesStatus = actionStatusFilter === "All" || action.status === actionStatusFilter;
      const haystack = [
        action.title,
        action.driverName,
        action.truckNumber,
        action.queueLabel,
        action.owner,
        action.notes,
        action.recommendedAction,
        action.summary
      ].join(" ").toLowerCase();
      const matchesSearch = !term || haystack.includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [actionSearch, actionStatusFilter, actions]);

  function updateBrief(field, value) {
    setBriefMessage("");
    setBriefError("");
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateChecklistItem(itemId, done) {
    setBriefMessage("");
    setBriefError("");
    setDraft((current) => ({
      ...current,
      checklist: (current.checklist || checklist).map((item) => (item.id === itemId ? { ...item, done } : item))
    }));
  }

  function updateAction(actionId, patch) {
    setBriefMessage("");
    setBriefError("");
    setDraft((current) => ({
      ...current,
      actions: (current.actions || []).map((action) => (action.id === actionId ? { ...action, ...patch } : action))
    }));
  }

  function addManualAction() {
    const title = manualActionTitle.trim();
    if (!title) return;

    const manualAction = {
      id: makeManagementId("action"),
      source: "Manual",
      title,
      queueId: "manual",
      queueLabel: "Manual",
      driverName: "",
      contact: "",
      truckNumber: "",
      riskLevel: "",
      riskScore: "",
      status: "Open",
      owner: draft.owner || "Safety",
      dueDate: "Today",
      notes: "",
      summary: title,
      recommendedAction: "Manual safety follow-up."
    };

    setDraft((current) => ({ ...current, actions: [...(current.actions || []), manualAction] }));
    setManualActionTitle("");
    setBriefMessage("Manual action added.");
  }

  function removeAction(actionId) {
    setDraft((current) => ({
      ...current,
      actions: (current.actions || []).filter((action) => action.id !== actionId)
    }));
  }

  function startNewBrief() {
    setBriefMessage("");
    setBriefError("");
    setActiveBriefId("");
    setDraft(createShiftBriefDraft(user, liveActions));
  }

  function briefPayload(briefDraft) {
    return {
      title: briefDraft.title.trim() || `Shift Brief ${formatDate(new Date().toISOString())}`,
      shift: briefDraft.shift.trim() || "Day Shift",
      status: briefDraft.status || "Open",
      owner: briefDraft.owner.trim() || user?.full_name || "Safety",
      handoffNote: briefDraft.handoffNote || "",
      checklist: briefDraft.checklist?.length ? briefDraft.checklist : checklist,
      actions: briefDraft.actions || actions,
      snapshotAt: data?.fetched_at || briefDraft.snapshotAt || new Date().toISOString()
    };
  }

  async function saveBrief(draftOverride = draft) {
    if (!token || briefSaving) return null;

    setBriefSaving(true);
    setBriefError("");
    setBriefMessage("");

    try {
      const hasId = Boolean(draftOverride.id);
      const saved = await apiRequest(
        hasId ? `/safety/shift-briefs/${draftOverride.id}` : "/safety/shift-briefs",
        {
          method: hasId ? "PUT" : "POST",
          body: JSON.stringify(briefPayload(draftOverride))
        },
        token
      );
      setBriefs((current) => {
        const exists = current.some((brief) => brief.id === saved.id);
        return exists
          ? current.map((brief) => (brief.id === saved.id ? saved : brief))
          : [saved, ...current];
      });
      setDraft({ ...createShiftBriefDraft(user, []), ...saved, actions: saved.actions || [], checklist: saved.checklist || [] });
      setActiveBriefId(saved.id);
      setBriefMessage("Shift brief saved to database.");
      return saved;
    } catch (saveError) {
      setBriefError(saveError.message || "Shift brief could not be saved.");
      return null;
    } finally {
      setBriefSaving(false);
    }
  }

  function loadBrief(brief) {
    setBriefMessage("");
    setBriefError("");
    setActiveBriefId(brief.id);
    setDraft({
      ...createShiftBriefDraft(user, []),
      ...brief,
      checklist: brief.checklist?.length ? brief.checklist : shiftBriefChecklist.map((label, index) => ({ id: `check-${index}`, label, done: false })),
      actions: brief.actions || []
    });
  }

  async function duplicateBrief() {
    const now = new Date().toISOString();
    await saveBrief({
      ...draft,
      id: "",
      title: `${draft.title || "Shift Brief"} copy`,
      status: "Open",
      createdAt: now,
      updatedAt: now
    });
  }

  async function archiveBrief() {
    await saveBrief({ ...draft, status: "Archived" });
  }

  async function deleteBrief(briefId = draft.id) {
    if (!briefId) {
      startNewBrief();
      return;
    }

    const shouldDelete = typeof window === "undefined" || window.confirm("Delete this shift brief from the database?");
    if (!shouldDelete) return;

    setBriefSaving(true);
    setBriefError("");
    setBriefMessage("");

    try {
      await apiRequest(`/safety/shift-briefs/${briefId}`, { method: "DELETE" }, token);
      setBriefs((current) => current.filter((brief) => brief.id !== briefId));
      startNewBrief();
      setBriefMessage("Shift brief deleted from database.");
    } catch (deleteError) {
      setBriefError(deleteError.message || "Shift brief could not be deleted.");
    } finally {
      setBriefSaving(false);
    }
  }

  async function exportBriefExcel() {
    if (!token || briefExporting) return;

    setBriefExporting(true);
    setBriefError("");

    try {
      const saved = await saveBrief();
      if (saved?.id) {
        await downloadApiFile(`/safety/shift-briefs/${saved.id}/export`, token, `safety_shift_brief_${saved.id}.xlsx`);
      }
    } catch (exportError) {
      setBriefError(exportError.message || "Shift brief export failed.");
    } finally {
      setBriefExporting(false);
    }
  }

  async function exportRiskyPeopleExcel() {
    if (!token || briefExporting) return;
    setBriefExporting(true);
    setBriefError("");
    try {
      await downloadApiFile("/safety/risky-people/export", token, "safety_risky_people.xlsx");
    } catch (exportError) {
      setBriefError(exportError.message || "Risky people export failed.");
    } finally {
      setBriefExporting(false);
    }
  }

  return (
    <section className="workspace-content-stack safety-brief-stack">
      <section className="panel safety-brief-hero">
        <div className="panel-head safety-management-head">
          <div>
            <h2>Shift Brief</h2>
            <span>Manage handoff, checklist, live safety actions, shared brief history, and backend Excel exports.</span>
          </div>
          <div className="safety-management-actions">
            <button className="secondary-button" type="button" onClick={startNewBrief} disabled={briefSaving}>New Brief</button>
            <button className="primary-button" type="button" onClick={() => saveBrief()} disabled={briefSaving || !token}>{briefSaving ? "Saving..." : "Save Brief"}</button>
            <button className="secondary-button" type="button" onClick={exportBriefExcel} disabled={briefSaving || briefExporting || !token}>{briefExporting ? "Exporting..." : "Export Brief Excel"}</button>
            <button className="secondary-button" type="button" onClick={exportRiskyPeopleExcel} disabled={briefExporting || !token}>Export Risky People Excel</button>
            <button className="secondary-button" type="button" onClick={() => onRefresh(true)} disabled={loading || refreshing}>
              {refreshing ? "Refreshing..." : "Refresh Brief"}
            </button>
          </div>
        </div>

        {briefMessage ? <div className="notice success inline-notice">{briefMessage}</div> : null}
        {briefError ? <div className="notice error inline-notice">{briefError}</div> : null}
        {error ? <div className="notice error inline-notice">{error}</div> : null}

        <div className="safety-automation-metrics safety-brief-metrics">
          <SafetyStatCard label="Team Briefs" value={formatCount(briefs.length)} detail={`${formatCount(openActionCount)} open actions`} tone="neutral" />
          <SafetyStatCard label="Checklist" value={`${formatCount(doneChecklistCount)}/${formatCount(checklist.length)}`} detail="First actions complete" tone="info" />
          <SafetyStatCard label="Action Board" value={formatCount(actions.length)} detail={`${formatCount(doneActionCount)} done`} tone="warning" />
          <SafetyStatCard label="Risky People" value={formatCount(riskyPeopleRows.length)} detail="Ready for backend Excel export" tone="critical" />
        </div>
      </section>

      {loading && !data ? <section className="panel safety-empty-state">Loading shift brief...</section> : null}

      <div className="safety-brief-management-layout">
        <section className="panel safety-brief-editor-panel">
          <div className="panel-head compact-panel-head">
            <div>
              <h2>Brief Setup</h2>
              <span>{activeBriefId ? "Saved brief selected" : "Current working brief"}</span>
            </div>
          </div>

          <div className="safety-management-filter-grid">
            <label>
              Title
              <input type="text" value={draft.title} onChange={(event) => updateBrief("title", event.target.value)} />
            </label>
            <label>
              Shift
              <input type="text" value={draft.shift} onChange={(event) => updateBrief("shift", event.target.value)} placeholder="Day Shift, Night Shift, Weekend" />
            </label>
            <label>
              Status
              <select value={draft.status} onChange={(event) => updateBrief("status", event.target.value)}>
                {shiftStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              Owner
              <input type="text" value={draft.owner} onChange={(event) => updateBrief("owner", event.target.value)} list="safety-management-owner-options" />
            </label>
            <label className="wide-field">
              Handoff Note
              <textarea rows={4} value={draft.handoffNote} onChange={(event) => updateBrief("handoffNote", event.target.value)} placeholder="What the next safety user needs to know." />
            </label>
          </div>

          <div className="safety-management-actions case-actions">
            <button className="primary-button" type="button" onClick={() => saveBrief()} disabled={briefSaving || !token}>{briefSaving ? "Saving..." : "Save"}</button>
            <button className="secondary-button" type="button" onClick={duplicateBrief} disabled={briefSaving || !token}>Duplicate</button>
            <button className="secondary-button" type="button" onClick={archiveBrief} disabled={briefSaving || !token}>Archive</button>
            <button className="delete-button" type="button" onClick={() => deleteBrief()} disabled={!draft.id || briefSaving || !token}>Delete</button>
          </div>

          <div className="safety-brief-history-block">
            <div className="panel-head compact-panel-head">
              <div>
                <h2>Shared Briefs</h2>
                <span>{briefsLoading ? "Loading history..." : `${formatCount(filteredBriefs.length)} visible`}</span>
              </div>
            </div>
            <label className="safety-management-search-field">
              Search history
              <input type="text" value={briefSearch} onChange={(event) => setBriefSearch(event.target.value)} placeholder="Shift, owner, reporter, note" />
            </label>
            <div className="safety-management-list compact-list">
              {filteredBriefs.length ? filteredBriefs.map((brief) => (
                <button
                  type="button"
                  className={`safety-management-list-card ${activeBriefId === brief.id ? "active" : ""}`}
                  key={brief.id}
                  onClick={() => loadBrief(brief)}
                >
                  <div className="safety-management-card-top">
                    <strong>{brief.title}</strong>
                    <span>{brief.status}</span>
                  </div>
                  <small>{brief.shift} | {brief.owner} | Added by {brief.createdBy || "Unknown user"}</small>
                  <p>{brief.handoffNote || "No handoff note yet."}</p>
                  <em>Updated {formatDateTime(brief.updatedAt)}</em>
                </button>
              )) : <div className="safety-empty-state small">{briefsLoading ? "Loading shared shift briefs..." : "No shared shift briefs yet."}</div>}
            </div>
          </div>
        </section>

        <section className="panel safety-brief-checklist-panel">
          <div className="panel-head compact-panel-head">
            <div>
              <h2>First Actions</h2>
              <span>{formatCount(doneChecklistCount)} of {formatCount(checklist.length)} complete</span>
            </div>
          </div>
          <div className="safety-brief-checklist managed">
            {checklist.map((item, index) => (
              <label className={`safety-brief-check-item ${item.done ? "done" : ""}`} key={item.id}>
                <input type="checkbox" checked={item.done} onChange={(event) => updateChecklistItem(item.id, event.target.checked)} />
                <span>{index + 1}</span>
                <strong>{item.label}</strong>
              </label>
            ))}
          </div>
        </section>

        <section className="panel safety-brief-priority-panel safety-brief-action-board">
          <div className="panel-head compact-panel-head">
            <div>
              <h2>Action Board</h2>
              <span>{formatCount(filteredActions.length)} action(s) visible</span>
            </div>
          </div>

          <div className="safety-management-filter-grid action-filters">
            <label>
              Search actions
              <input type="text" value={actionSearch} onChange={(event) => setActionSearch(event.target.value)} placeholder="Driver, truck, owner, issue" />
            </label>
            <label>
              Status
              <select value={actionStatusFilter} onChange={(event) => setActionStatusFilter(event.target.value)}>
                <option value="All">All</option>
                {actionStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>

          <div className="safety-brief-manual-action">
            <input type="text" value={manualActionTitle} onChange={(event) => setManualActionTitle(event.target.value)} placeholder="Add manual follow-up" />
            <button className="secondary-button" type="button" onClick={addManualAction}>Add Action</button>
          </div>

          <div className="safety-brief-priority-list managed-actions">
            {filteredActions.length ? filteredActions.map((action) => (
              <article className="safety-brief-action-card" key={action.id}>
                <div className="safety-management-card-top">
                  <div>
                    <strong>{action.title}</strong>
                    <small>{action.queueLabel} | {action.source}</small>
                  </div>
                  {action.riskLevel ? <RiskPill level={action.riskLevel} score={action.riskScore} /> : <span className="safety-queue-pill safety-queue-pill-watch">Manual</span>}
                </div>
                <p>{action.recommendedAction || action.summary}</p>
                <div className="safety-brief-action-meta">
                  <span>Driver: {action.driverName || "Unassigned"}</span>
                  <span>Truck: {action.truckNumber || "None"}</span>
                </div>
                <div className="safety-brief-action-controls">
                  <label>
                    Status
                    <select value={action.status} onChange={(event) => updateAction(action.id, { status: event.target.value })}>
                      {actionStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label>
                    Owner
                    <input type="text" value={action.owner} onChange={(event) => updateAction(action.id, { owner: event.target.value })} list="safety-management-owner-options" />
                  </label>
                  <label>
                    Due
                    <input type="text" value={action.dueDate} onChange={(event) => updateAction(action.id, { dueDate: event.target.value })} placeholder="Today" />
                  </label>
                  <label className="wide-field">
                    Notes
                    <textarea rows={2} value={action.notes} onChange={(event) => updateAction(action.id, { notes: event.target.value })} placeholder="Follow-up, call result, handoff detail" />
                  </label>
                </div>
                {action.source === "Manual" ? (
                  <button className="delete-button compact-delete-button" type="button" onClick={() => removeAction(action.id)}>Remove Manual Action</button>
                ) : null}
              </article>
            )) : <div className="safety-empty-state small">No actions match the current filters.</div>}
          </div>
        </section>
      </div>

      <section className="safety-brief-queue-grid">
        {queues.map((queue) => (
          <article className={`panel safety-brief-queue-card safety-automation-queue-${queue.id}`} key={queue.id}>
            <span>{queue.label}</span>
            <strong>{formatCount(queue.count)}</strong>
            <p>{queue.description}</p>
          </article>
        ))}
      </section>
    </section>
  );
}
export default function SafetyWorkspace({ token, user, mobile = false }) {
  const [activeTab, setActiveTab] = useState("fleet");
  const [fleetData, setFleetData] = useState(null);
  const [fleetLoading, setFleetLoading] = useState(true);
  const [fleetRefreshing, setFleetRefreshing] = useState(false);
  const [fleetError, setFleetError] = useState("");

  const loadFleet = useCallback(
    async (forceRefresh = false) => {
      if (!token) {
        setFleetData(null);
        setFleetLoading(false);
        setFleetRefreshing(false);
        return;
      }

      if (forceRefresh) {
        setFleetRefreshing(true);
      } else {
        setFleetLoading(true);
      }
      setFleetError("");

      try {
        const data = await apiRequest(`/safety/fleet${forceRefresh ? "?refresh=true" : ""}`, {}, token);
        setFleetData(data);
      } catch (fetchError) {
        setFleetError(fetchError.message);
      } finally {
        if (forceRefresh) {
          setFleetRefreshing(false);
        } else {
          setFleetLoading(false);
        }
      }
    },
    [token]
  );

  useEffect(() => {
    if (!token) {
      setFleetData(null);
      setFleetLoading(false);
      return;
    }
    loadFleet(false);
  }, [loadFleet, token]);

  const mobilePrimaryIds = new Set(safetyMobilePrimaryTabs.map((tab) => tab.id));
  const mobileActiveNav = mobilePrimaryIds.has(activeTab) ? activeTab : "more";

  function selectMobilePrimaryTab(tabId) {
    if (tabId === "more") {
      setActiveTab(mobilePrimaryIds.has(activeTab) ? "automation" : activeTab);
      return;
    }
    setActiveTab(tabId);
  }

  return (
    <section className={`workspace-content-stack safety-workspace-stack ${mobile ? "safety-workspace-mobile" : ""}`}>
      {mobile ? (
        <>
          <div className="mobile-internal-tabs safety-mobile-tabs">
            {[...safetyMobilePrimaryTabs, { id: "more", label: "More" }].map((tab) => (
              <button key={tab.id} type="button" className={mobileActiveNav === tab.id ? "active" : ""} onClick={() => selectMobilePrimaryTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          {mobileActiveNav === "more" ? (
            <div className="mobile-more-grid">
              {safetyMobileMoreTabs.map((tab) => (
                <button key={tab.id} type="button" className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="workspace-inline-tabs safety-workspace-tabs">
          {safetyTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`workspace-inline-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <section hidden={activeTab !== "fleet"}>
        <SafetyFleetPanel data={fleetData} loading={fleetLoading} refreshing={fleetRefreshing} error={fleetError} onRefresh={loadFleet} />
      </section>

      <section hidden={activeTab !== "automation"}>
        <SafetyAutomationPanel data={fleetData} loading={fleetLoading} refreshing={fleetRefreshing} error={fleetError} onRefresh={loadFleet} />
      </section>

      <section hidden={activeTab !== "investigations"}>
        <SafetyInvestigationPanel token={token} user={user} data={fleetData} loading={fleetLoading} refreshing={fleetRefreshing} error={fleetError} onRefresh={loadFleet} />
      </section>

      <section hidden={activeTab !== "brief"}>
        <SafetyShiftBriefPanel token={token} data={fleetData} user={user} loading={fleetLoading} refreshing={fleetRefreshing} error={fleetError} onRefresh={loadFleet} />
      </section>

      {activeTab === "services" ? (
        <section>
          <SafetyServiceTools token={token} mode="service" active />
        </section>
      ) : null}

      {activeTab === "emergency" ? (
        <section>
          <SafetyServiceTools token={token} mode="emergency" active />
        </section>
      ) : null}

      <section hidden={activeTab !== "documents"}>
        <SafetyDocumentsPanel token={token} />
      </section>

      <section hidden={activeTab !== "notes"}>
        <SafetyNotesPanel token={token} user={user} />
      </section>

      <section hidden={activeTab !== "team-chat"}>
        <TeamChat token={token} user={user} active={activeTab === "team-chat"} mobile={mobile} />
      </section>

      <section hidden={activeTab !== "ai"}>
        <UnitedLaneChat token={token} user={user} />
      </section>
    </section>
  );
}




