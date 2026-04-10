import { useEffect, useMemo, useRef, useState } from "react";
import UnitedLaneChat from "./UnitedLaneChat";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const MAX_DOCUMENT_BYTES = 9 * 1024 * 1024;
const DOCUMENT_ACCEPT = ".pdf,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp,.gif";
const safetyTabs = [
  { id: "documents", label: "Documents" },
  { id: "notes", label: "Notes" },
  { id: "ai", label: "AI Chat" }
];
const documentSections = [
  { id: "approved", label: "Approved", empty: "No approved documents yet." },
  { id: "review", label: "Needs Review", empty: "No documents waiting for review." },
  { id: "bad", label: "Bad Documents", empty: "No bad documents." }
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

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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
          placeholder="Write notes, reminders, inspections, incidents, or follow-up here."
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

export default function SafetyWorkspace({ token, user }) {
  const [activeTab, setActiveTab] = useState("documents");

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
