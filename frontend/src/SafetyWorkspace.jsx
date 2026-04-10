import { useEffect, useMemo, useState } from "react";
import UnitedLaneChat from "./UnitedLaneChat";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";

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

export default function SafetyWorkspace({ token, user }) {
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
    if (loading) return "Loading notes...";
    if (saving) return "Saving...";
    if (hasChanges) return "Unsaved changes";
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
    <section className="workspace-content-stack safety-workspace-stack">
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
            placeholder="Write notes, reminders, inspections, incidents, follow-up, or tasks here."
            rows={10}
            disabled={loading}
          />
        </label>
      </section>

      <UnitedLaneChat token={token} user={user} />
    </section>
  );
}
