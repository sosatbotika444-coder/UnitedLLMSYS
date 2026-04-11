import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UnitedLaneChat from "./UnitedLaneChat";
import SafetyServiceTools from "./SafetyServiceTools";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const MAX_DOCUMENT_BYTES = 9 * 1024 * 1024;
const DOCUMENT_ACCEPT = ".pdf,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif";
const safetyTabs = [
  { id: "fleet", label: "Fleet Safety" },
  { id: "automation", label: "Automation" },
  { id: "investigations", label: "Investigations" },
  { id: "brief", label: "Shift Brief" },
  { id: "services", label: "Service Map" },
  { id: "emergency", label: "Emergency" },
  { id: "documents", label: "Documents" },
  { id: "notes", label: "Notes" },
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
  "Build an investigation plan from this case packet.",
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

  const vehicles = data?.vehicles || [];
  const metrics = data?.metrics || {};
  const riskOptions = data?.filters?.risk_levels || ["All", "Critical", "High", "Medium", "Low"];
  const queueOptions = data?.filters?.queue_ids || ["All", "critical", "maintenance", "coaching", "compliance", "watch"];
  const focusOptions = data?.filters?.focus_options || ["All", "Faults", "Coaching", "Compliance", "Stale", "Low Fuel"];

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
        (focusFilter === "Low Fuel" && vehicle.fuel_level_percent !== null && vehicle.fuel_level_percent !== undefined && vehicle.fuel_level_percent <= 25);
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
                </div>

                <div className="safety-detail-list">
                  <div><span>Driver</span><strong>{selectedVehicle.driver_name}</strong><small>{selectedVehicle.driver_contact || "No mapped contact"}</small></div>
                  <div><span>Location</span><strong>{selectedVehicle.location_label}</strong><small>{selectedVehicle.status}</small></div>
                  <div><span>VIN</span><strong>{selectedVehicle.vin || "Not available"}</strong><small>{selectedVehicle.eld_connected ? "ELD connected" : "No ELD summary"}</small></div>
                  <div><span>Registration</span><strong>{selectedVehicle.registration?.date || "Not tracked"}</strong><small>{selectedVehicle.registration?.label || "No registration status"}</small></div>
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
  const queues = data?.queues || [];

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
  const vehicles = data?.vehicles || [];
  const [caseTitle, setCaseTitle] = useState("New safety investigation");
  const [caseType, setCaseType] = useState("Accident");
  const [caseStatus, setCaseStatus] = useState("Intake");
  const [severity, setSeverity] = useState("Elevated");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [caseFacts, setCaseFacts] = useState("Time, location, people involved, and known sequence of events.");
  const [caseEvidence, setCaseEvidence] = useState("Photos, dashcam, Motive events, driver statement, dispatch notes.");
  const [caseQuestions, setCaseQuestions] = useState("What happened first?\nWhat evidence is missing?\nWhat action prevents repeat risk?");

  useEffect(() => {
    if (!vehicles.length) {
      if (selectedVehicleId) {
        setSelectedVehicleId("");
      }
      return;
    }
    if (!vehicles.some((vehicle) => String(vehicle.id) === String(selectedVehicleId))) {
      setSelectedVehicleId(String(vehicles[0].id));
    }
  }, [selectedVehicleId, vehicles]);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => String(vehicle.id) === String(selectedVehicleId)) || null,
    [selectedVehicleId, vehicles]
  );

  const factCount = caseFacts.split(/\n+/).map((item) => item.trim()).filter(Boolean).length;
  const evidenceCount = caseEvidence.split(/\n+/).map((item) => item.trim()).filter(Boolean).length;
  const questionCount = caseQuestions.split(/\n+/).map((item) => item.trim()).filter(Boolean).length;

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
      "Safety investigation workspace. Treat this as an internal case review.",
      "Separate confirmed facts, assumptions, missing evidence, driver interview questions, and next actions.",
      `Case title: ${caseTitle}`,
      `Case type: ${caseType}`,
      `Severity: ${severity}`,
      `Status: ${caseStatus}`,
      vehicleContext,
      `Known facts:\n${caseFacts}`,
      `Evidence list:\n${caseEvidence}`,
      `Open questions:\n${caseQuestions}`
    ].join("\n\n");
  }, [caseEvidence, caseFacts, caseQuestions, caseStatus, caseTitle, caseType, selectedVehicle, severity]);

  return (
    <section className="workspace-content-stack safety-investigation-stack">
      <section className="panel safety-investigation-hero">
        <div className="panel-head">
          <div>
            <h2>Investigation Desk</h2>
            <span>Build the case packet, then investigate it with Safety Team AI.</span>
          </div>
          <button className="primary-button" type="button" onClick={() => onRefresh(true)} disabled={loading || refreshing}>
            {refreshing ? "Refreshing..." : "Refresh Fleet Context"}
          </button>
        </div>

        {error ? <div className="notice error inline-notice">{error}</div> : null}

        <div className="safety-investigation-metrics">
          <SafetyStatCard label="Case Status" value={caseStatus} detail={caseType} tone={severity === "Critical" ? "critical" : "neutral"} />
          <SafetyStatCard label="Facts" value={formatCount(factCount)} detail="Lines in case packet" tone="info" />
          <SafetyStatCard label="Evidence" value={formatCount(evidenceCount)} detail="Items to verify" tone="warning" />
          <SafetyStatCard label="Questions" value={formatCount(questionCount)} detail="Open investigator prompts" tone="dark" />
        </div>
      </section>

      <div className="safety-investigation-layout">
        <section className="panel safety-investigation-case-panel">
          <div className="panel-head compact-panel-head">
            <div>
              <h2>Case Packet</h2>
              <span>{loading && !data ? "Loading fleet context..." : `${formatCount(vehicles.length)} truck(s) available`}</span>
            </div>
          </div>

          <div className="safety-investigation-form">
            <label>
              Case Title
              <input type="text" value={caseTitle} onChange={(event) => setCaseTitle(event.target.value)} />
            </label>
            <label>
              Type
              <select value={caseType} onChange={(event) => setCaseType(event.target.value)}>
                {investigationTypes.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              Severity
              <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                {investigationSeverities.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              Status
              <select value={caseStatus} onChange={(event) => setCaseStatus(event.target.value)}>
                {investigationStatuses.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label>
              Truck Context
              <select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)}>
                <option value="">No truck selected</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.number} | {vehicle.risk_level} {vehicle.risk_score}</option>
                ))}
              </select>
            </label>
            <label>
              Known Facts
              <textarea value={caseFacts} onChange={(event) => setCaseFacts(event.target.value)} rows={5} />
            </label>
            <label>
              Evidence
              <textarea value={caseEvidence} onChange={(event) => setCaseEvidence(event.target.value)} rows={4} />
            </label>
            <label>
              Open Questions
              <textarea value={caseQuestions} onChange={(event) => setCaseQuestions(event.target.value)} rows={4} />
            </label>
          </div>

          <section className="safety-investigation-context-card">
            <strong>AI case context</strong>
            <pre>{investigationContext}</pre>
          </section>
        </section>

        <UnitedLaneChat
          token={token}
          user={user}
          title="Investigation AI"
          assistantName="Safety Investigator"
          workspace="Safety Investigation"
          extraContext={investigationContext}
          promptOptions={investigationPromptOptions}
          welcomeText="Safety Investigator is ready. Fill the case packet, then ask for a plan, interview questions, or missing evidence."
          placeholder="Ask the investigator to build a timeline, identify gaps, draft interview questions, or write the corrective action plan."
          className="safety-investigation-ai-panel"
        />
      </div>
    </section>
  );
}

function SafetyShiftBriefPanel({ data, loading, refreshing, error, onRefresh }) {
  const metrics = data?.metrics || {};
  const queues = data?.queues || [];
  const priorityItems = useMemo(
    () => queues.flatMap((queue) => (queue.items || []).slice(0, 2).map((item) => ({ ...item, queueId: queue.id, queueLabel: queue.label }))).slice(0, 6),
    [queues]
  );

  return (
    <section className="workspace-content-stack safety-brief-stack">
      <section className="panel safety-brief-hero">
        <div className="panel-head">
          <div>
            <h2>Shift Brief</h2>
            <span>Daily safety handoff: urgent items, queue coverage, and first actions.</span>
          </div>
          <button className="primary-button" type="button" onClick={() => onRefresh(true)} disabled={loading || refreshing}>
            {refreshing ? "Refreshing..." : "Refresh Brief"}
          </button>
        </div>

        {error ? <div className="notice error inline-notice">{error}</div> : null}

        <div className="safety-automation-metrics safety-brief-metrics">
          <SafetyStatCard label="Immediate" value={formatCount(metrics.critical_units)} detail="Clear first" tone="critical" />
          <SafetyStatCard label="Maintenance" value={formatCount(metrics.maintenance_units)} detail="Fault ownership" tone="warning" />
          <SafetyStatCard label="Coaching" value={formatCount(metrics.coaching_units)} detail="Driver follow-up" tone="info" />
          <SafetyStatCard label="Compliance" value={formatCount(metrics.compliance_units)} detail="Docs and expiry" tone="neutral" />
        </div>
      </section>

      {loading && !data ? <section className="panel safety-empty-state">Loading shift brief...</section> : null}

      <div className="safety-brief-layout">
        <section className="panel safety-brief-checklist-panel">
          <div className="panel-head compact-panel-head">
            <div>
              <h2>First Actions</h2>
              <span>Use this before handoff or dispatch rush.</span>
            </div>
          </div>
          <div className="safety-brief-checklist">
            {shiftBriefChecklist.map((item, index) => (
              <article className="safety-brief-check-item" key={item}>
                <span>{index + 1}</span>
                <strong>{item}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="panel safety-brief-priority-panel">
          <div className="panel-head compact-panel-head">
            <div>
              <h2>Priority Queue</h2>
              <span>{formatCount(priorityItems.length)} item(s) ready for review</span>
            </div>
          </div>
          <div className="safety-brief-priority-list">
            {priorityItems.length ? priorityItems.map((item) => (
              <article className="safety-brief-priority-card" key={`${item.queueId}-${item.vehicle_id}`}>
                <div className="safety-vehicle-head compact">
                  <div>
                    <strong>{item.number}</strong>
                    <span>{item.queueLabel}</span>
                  </div>
                  <RiskPill level={item.risk_level} score={item.risk_score} />
                </div>
                <p>{item.summary}</p>
                {item.actions?.length ? <small>{item.actions[0]}</small> : null}
              </article>
            )) : <div className="safety-empty-state small">No queue items in the current safety snapshot.</div>}
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
export default function SafetyWorkspace({ token, user }) {
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

  return (
    <section className="workspace-content-stack safety-workspace-stack">
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
        <SafetyShiftBriefPanel data={fleetData} loading={fleetLoading} refreshing={fleetRefreshing} error={fleetError} onRefresh={loadFleet} />
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

      <section hidden={activeTab !== "ai"}>
        <UnitedLaneChat token={token} user={user} />
      </section>
    </section>
  );
}




