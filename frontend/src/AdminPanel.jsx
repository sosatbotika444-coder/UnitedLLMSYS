import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { setActivityContext, trackActivity } from "./activityTracker";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const MotiveTrackingPanel = lazy(() => import("./MotiveTrackingPanel"));
const SafetyServiceTools = lazy(() => import("./SafetyServiceTools"));
const departmentOptions = ["admin", "fuel", "safety", "driver"];
const departmentLabels = {
  admin: "Admin",
  fuel: "Fuel Service",
  safety: "Safety",
  driver: "Driver"
};
const adminWorkspaceTabs = [
  { id: "access", label: "Accounts", detail: "Users, roles, bans, and system stats" },
  { id: "live", label: "Live", detail: "Who is online, what they opened, and what they clicked" },
  { id: "fleet", label: "Fleet", detail: "All trucks, tracking, HOS, and live map" },
  { id: "service", label: "Service", detail: "Fuel service map and nearby support" }
];
const emptyCreateForm = {
  full_name: "",
  email: "",
  username: "",
  password: "",
  department: "fuel"
};

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

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatRelativeTime(value) {
  if (!value) return "just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function StatCard({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`admin-stat-card admin-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function DepartmentBadge({ department }) {
  return <span className={`admin-department-badge admin-department-${department || "fuel"}`}>{departmentLabels[department] || department || "Team"}</span>;
}

function AdminLiveSessionCard({ session }) {
  return (
    <article className="admin-live-session-card">
      <div className="admin-live-session-head">
        <div className="admin-live-identity">
          <strong>{session.actorName || "Visitor"}</strong>
          <small>{session.actorEmail || (session.isGuest ? "Guest session" : "No email")}</small>
        </div>
        {session.isGuest ? <span className="admin-department-badge admin-department-guest">Guest</span> : <DepartmentBadge department={session.department} />}
      </div>

      <div className="admin-live-session-meta">
        <span><strong>{session.currentWorkspace || session.currentPage || "Site"}</strong> current view</span>
        <span><strong>{formatRelativeTime(session.lastSeenAt)}</strong> last seen</span>
      </div>

      <p>{session.lastEventLabel || "Active on the site now."}</p>
    </article>
  );
}

function AdminActivityFeedItem({ event }) {
  return (
    <article className="admin-live-feed-item">
      <div className="admin-live-feed-head">
        <div className="admin-live-identity">
          <strong>{event.actorName || "Visitor"}</strong>
          <small>{event.actorEmail || (event.department ? departmentLabels[event.department] || event.department : "Guest session")}</small>
        </div>
        <span>{formatRelativeTime(event.createdAt)}</span>
      </div>

      <p>{event.summary || event.eventName || event.label || event.eventType}</p>

      <div className="admin-live-feed-meta">
        {event.department ? <span className={`admin-department-badge admin-department-${event.department}`}>{departmentLabels[event.department] || event.department}</span> : null}
        {event.workspace ? <span>{event.workspace}</span> : null}
        {event.page ? <span>{event.page}</span> : null}
        <span>{formatDate(event.createdAt)}</span>
      </div>
    </article>
  );
}

function UserRow({ user, currentUserId, busyId, onPatch, onDelete, onResetPassword }) {
  const [draft, setDraft] = useState(() => ({
    full_name: user.full_name || "",
    email: user.email || "",
    username: user.username || "",
    department: user.department || "fuel",
    ban_reason: user.ban_reason || ""
  }));

  useEffect(() => {
    setDraft({
      full_name: user.full_name || "",
      email: user.email || "",
      username: user.username || "",
      department: user.department || "fuel",
      ban_reason: user.ban_reason || ""
    });
  }, [user]);

  const isSelf = user.id === currentUserId;
  const busy = busyId === user.id;

  async function saveUser() {
    await onPatch(user.id, {
      full_name: draft.full_name,
      email: draft.email,
      username: draft.username || null,
      department: draft.department,
      ban_reason: draft.ban_reason
    });
  }

  async function toggleBan() {
    if (user.is_banned) {
      await onPatch(user.id, { is_banned: false, ban_reason: "" });
      return;
    }
    const reason = window.prompt("Ban reason", draft.ban_reason || "Manual admin ban");
    if (reason === null) return;
    await onPatch(user.id, { is_banned: true, ban_reason: reason.trim() || "Manual admin ban" });
  }

  return (
    <article className={`admin-user-row ${user.is_banned ? "is-banned" : ""}`}>
      <div className="admin-user-row-main">
        <div className="admin-user-identity">
          <span>#{user.id}</span>
          <strong>{user.full_name || "Unnamed account"}</strong>
          <small>{user.username ? `@${user.username}` : user.email}</small>
        </div>
        <div className="admin-user-status-line">
          <DepartmentBadge department={user.department} />
          <span className={user.is_banned ? "admin-status-banned" : "admin-status-active"}>{user.is_banned ? "Banned" : "Active"}</span>
          {isSelf ? <span className="admin-status-self">You</span> : null}
        </div>
      </div>

      <div className="admin-user-edit-grid">
        <label>Full name<input value={draft.full_name} onChange={(event) => setDraft({ ...draft, full_name: event.target.value })} /></label>
        <label>Email<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
        <label>Username<input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} placeholder="optional" /></label>
        <label>Role<select value={draft.department} onChange={(event) => setDraft({ ...draft, department: event.target.value })}>{departmentOptions.map((item) => <option key={item} value={item}>{departmentLabels[item]}</option>)}</select></label>
        <label className="admin-ban-reason-field">Ban reason<textarea value={draft.ban_reason} onChange={(event) => setDraft({ ...draft, ban_reason: event.target.value })} placeholder="Visible in admin only" /></label>
      </div>

      <div className="admin-user-activity-grid">
        <span><strong>{formatNumber(user.load_count)}</strong> loads</span>
        <span><strong>{formatNumber(user.routing_request_count)}</strong> routes</span>
        <span><strong>{formatNumber(user.fuel_authorization_count)}</strong> approvals</span>
        <span><strong>{formatNumber(user.chat_message_count)}</strong> messages</span>
        <span><strong>{formatDate(user.last_login_at)}</strong> last login</span>
      </div>

      <footer className="admin-user-actions">
        <button className="primary-button" type="button" onClick={saveUser} disabled={busy}>Save</button>
        <button className={user.is_banned ? "secondary-button" : "delete-button"} type="button" onClick={toggleBan} disabled={busy || isSelf}>{user.is_banned ? "Unban" : "Ban"}</button>
        <button className="secondary-button" type="button" onClick={() => onResetPassword(user)} disabled={busy}>Reset password</button>
        <button className="delete-button" type="button" onClick={() => onDelete(user)} disabled={busy || isSelf}>Delete</button>
      </footer>
    </article>
  );
}

export default function AdminPanel({ token, user }) {
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [liveSnapshot, setLiveSnapshot] = useState(null);
  const [activeTab, setActiveTab] = useState("access");
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [filters, setFilters] = useState({ search: "", department: "all", status: "all" });
  const [loading, setLoading] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadOverview = useCallback(async () => {
    if (!token) return;
    const data = await apiRequest("/admin/overview", {}, token);
    setOverview(data);
  }, [token]);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    const params = new URLSearchParams();
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.department !== "all") params.set("department", filters.department);
    if (filters.status !== "all") params.set("status", filters.status);
    const data = await apiRequest(`/admin/users?${params.toString()}`, {}, token);
    setUsers(Array.isArray(data) ? data : []);
  }, [filters, token]);

  const loadLive = useCallback(async () => {
    if (!token) return;
    const data = await apiRequest("/admin/activity/live", {}, token);
    setLiveSnapshot(data);
  }, [token]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadOverview(), loadUsers()]);
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      setLoading(false);
    }
  }, [loadOverview, loadUsers]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const activeTabMeta = adminWorkspaceTabs.find((tab) => tab.id === activeTab) || adminWorkspaceTabs[0];
    setActivityContext({ page: "admin", workspace: activeTabMeta.id });
    trackActivity({
      token,
      eventType: "workspace_view",
      eventName: "Opened admin tab",
      page: "admin",
      workspace: activeTabMeta.id,
      label: activeTabMeta.label,
      throttleKey: `admin-tab:${user?.id || "guest"}:${activeTabMeta.id}`,
      throttleMs: 1200,
    });
  }, [activeTab, token, user?.id]);

  useEffect(() => {
    if (activeTab !== "live" || !token) {
      return undefined;
    }

    let cancelled = false;

    async function pollLive() {
      try {
        const data = await apiRequest("/admin/activity/live", {}, token);
        if (!cancelled) {
          setLiveSnapshot(data);
          setError("");
        }
      } catch (liveError) {
        if (!cancelled) {
          setError(liveError.message);
        }
      }
    }

    pollLive();
    const intervalId = window.setInterval(pollLive, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeTab, token]);

  const quickStats = useMemo(() => {
    const usersStats = overview?.users || {};
    const operations = overview?.operations || {};
    return [
      { label: "Accounts", value: usersStats.total || 0, detail: `${usersStats.active || 0} active`, tone: "blue" },
      { label: "Banned", value: usersStats.banned || 0, detail: "Blocked logins", tone: usersStats.banned ? "red" : "green" },
      { label: "Routes", value: operations.routingRequests || 0, detail: "Routing requests", tone: "green" },
      { label: "Fuel approvals", value: operations.fuelAuthorizations || 0, detail: "Cards and limits", tone: "amber" },
      { label: "Messages", value: operations.teamMessages || 0, detail: "Team chat", tone: "dark" },
      { label: "Safety docs", value: operations.safetyDocuments || 0, detail: "Uploaded files", tone: "blue" }
    ];
  }, [overview]);

  const liveStats = useMemo(() => {
    return [
      { label: "Online now", value: liveSnapshot?.onlineSessions || 0, detail: "Active sessions in the last 5 minutes", tone: "green" },
      { label: "Actions (1h)", value: liveSnapshot?.actionsLastHour || 0, detail: "Clicks, views, and sign-ins", tone: "blue" },
      { label: "Guest sessions", value: liveSnapshot?.guestSessions || 0, detail: "Anonymous visitors on the site", tone: "amber" },
      { label: "Logins (24h)", value: liveSnapshot?.loginsLast24Hours || 0, detail: "Successful sign-ins across departments", tone: "dark" },
    ];
  }, [liveSnapshot]);

  async function refreshLivePanel() {
    setLiveLoading(true);
    setError("");
    try {
      await loadLive();
    } catch (liveError) {
      setError(liveError.message);
    } finally {
      setLiveLoading(false);
    }
  }

  async function createUser(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await apiRequest("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          ...createForm,
          username: createForm.username || null
        })
      }, token);
      setCreateForm(emptyCreateForm);
      setMessage("Account created.");
      await refreshAll();
    } catch (createError) {
      setError(createError.message);
    } finally {
      setLoading(false);
    }
  }

  async function patchUser(userId, payload) {
    setBusyId(userId);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      }, token);
      setMessage("Account updated.");
      await refreshAll();
    } catch (patchError) {
      setError(patchError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteUser(targetUser) {
    if (!window.confirm(`Delete ${targetUser.full_name || targetUser.email}? This removes their saved workspace data too.`)) return;
    setBusyId(targetUser.id);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/admin/users/${targetUser.id}`, { method: "DELETE" }, token);
      setMessage("Account deleted.");
      await refreshAll();
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(targetUser) {
    const password = window.prompt(`New password for ${targetUser.full_name || targetUser.email}`);
    if (!password) return;
    setBusyId(targetUser.id);
    setError("");
    setMessage("");
    try {
      await apiRequest(`/admin/users/${targetUser.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password })
      }, token);
      setMessage("Password reset.");
      await refreshAll();
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setBusyId(null);
    }
  }

  const usersByDepartment = overview?.usersByDepartment || {};
  const fuelStatuses = overview?.fuelAuthorizationsByStatus || {};

  return (
    <section className="admin-panel-shell">
      <div className="admin-panel-head">
        <div>
          <span>Admin Control</span>
          <h2>Admin Panel</h2>
          <p>Accounts, bans, roles, passwords, and live system statistics.</p>
        </div>
        <button className="primary-button" type="button" onClick={activeTab === "live" ? refreshLivePanel : refreshAll} disabled={activeTab === "live" ? liveLoading : loading}>
          {(activeTab === "live" ? liveLoading : loading) ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {message ? <div className="notice success inline-notice">{message}</div> : null}
      {error ? <div className="notice error inline-notice">{error}</div> : null}

      <div className="admin-tab-strip">
        {adminWorkspaceTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`workspace-inline-tab ${activeTab === tab.id ? "active" : ""}`.trim()}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="admin-tab-summary">
        {adminWorkspaceTabs.find((tab) => tab.id === activeTab)?.detail || ""}
      </div>

      {activeTab === "access" ? (
        <div className="admin-tab-panel">
          <section className="admin-stat-grid">
            {quickStats.map((stat) => <StatCard key={stat.label} {...stat} value={formatNumber(stat.value)} />)}
          </section>

          <section className="admin-insight-grid">
            <article className="admin-insight-panel">
              <div className="panel-head"><h3>Departments</h3><span>Accounts by role</span></div>
              <div className="admin-pill-list">
                {departmentOptions.map((department) => <span key={department}><b>{departmentLabels[department]}</b>{formatNumber(usersByDepartment[department] || 0)}</span>)}
              </div>
            </article>
            <article className="admin-insight-panel">
              <div className="panel-head"><h3>Fuel Approval Status</h3><span>Current authorization mix</span></div>
              <div className="admin-pill-list">
                {Object.keys(fuelStatuses).length ? Object.entries(fuelStatuses).map(([status, total]) => <span key={status}><b>{status}</b>{formatNumber(total)}</span>) : <span><b>No approvals</b>0</span>}
              </div>
            </article>
          </section>

          <section className="admin-management-grid">
            <form className="admin-create-panel" onSubmit={createUser}>
              <div className="panel-head"><h3>Create Account</h3><span>Add staff, drivers, or another admin.</span></div>
              <label>Full name<input value={createForm.full_name} onChange={(event) => setCreateForm({ ...createForm, full_name: event.target.value })} required /></label>
              <label>Email<input type="email" value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} required /></label>
              <label>Username<input value={createForm.username} onChange={(event) => setCreateForm({ ...createForm, username: event.target.value })} placeholder="optional" /></label>
              <label>Password<input type="password" value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} minLength="6" required /></label>
              <label>Role<select value={createForm.department} onChange={(event) => setCreateForm({ ...createForm, department: event.target.value })}>{departmentOptions.map((department) => <option key={department} value={department}>{departmentLabels[department]}</option>)}</select></label>
              <button className="primary-button" type="submit" disabled={loading}>Create</button>
            </form>

            <section className="admin-users-panel">
              <div className="admin-users-toolbar">
                <div>
                  <span>Users</span>
                  <h3>{formatNumber(users.length)} accounts shown</h3>
                </div>
                <div className="admin-filter-row">
                  <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search name, email, username" />
                  <select value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })}>
                    <option value="all">All roles</option>
                    {departmentOptions.map((department) => <option key={department} value={department}>{departmentLabels[department]}</option>)}
                  </select>
                  <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
                    <option value="all">All statuses</option>
                    <option value="active">Active</option>
                    <option value="banned">Banned</option>
                  </select>
                </div>
              </div>

              <div className="admin-user-list">
                {users.length ? users.map((item) => (
                  <UserRow
                    key={item.id}
                    user={item}
                    currentUserId={user?.id}
                    busyId={busyId}
                    onPatch={patchUser}
                    onDelete={deleteUser}
                    onResetPassword={resetPassword}
                  />
                )) : <div className="empty-route-card">{loading ? "Loading users..." : "No accounts match this filter."}</div>}
              </div>
            </section>
          </section>
        </div>
      ) : null}

      {activeTab === "live" ? (
        <div className="admin-tab-panel">
          <section className="admin-stat-grid admin-live-stat-grid">
            {liveStats.map((stat) => <StatCard key={stat.label} {...stat} value={formatNumber(stat.value)} />)}
          </section>

          <section className="admin-live-grid">
            <article className="admin-live-panel">
              <div className="panel-head">
                <h3>Who is online</h3>
                <span>Auto refresh every 8 seconds</span>
              </div>

              <div className="admin-live-session-list">
                {liveSnapshot?.onlineUsers?.length ? liveSnapshot.onlineUsers.map((session) => (
                  <AdminLiveSessionCard key={session.sessionId || `${session.actorEmail}-${session.lastSeenAt}`} session={session} />
                )) : <div className="empty-route-card">No active sessions right now.</div>}
              </div>
            </article>

            <article className="admin-live-panel">
              <div className="panel-head">
                <h3>Recent activity</h3>
                <span>Latest actions across the site</span>
              </div>

              <div className="admin-live-feed">
                {liveSnapshot?.recentEvents?.length ? liveSnapshot.recentEvents.map((event) => (
                  <AdminActivityFeedItem key={event.id} event={event} />
                )) : <div className="empty-route-card">No recent activity yet.</div>}
              </div>
            </article>
          </section>
        </div>
      ) : null}

      {activeTab === "fleet" ? (
        <section className="admin-workspace-panel">
          <Suspense fallback={<div className="empty-route-card">Loading fleet control...</div>}>
            <MotiveTrackingPanel token={token} active={activeTab === "fleet"} />
          </Suspense>
        </section>
      ) : null}

      {activeTab === "service" ? (
        <section className="admin-workspace-panel">
          <Suspense fallback={<div className="empty-route-card">Loading service map...</div>}>
            <SafetyServiceTools token={token} mode="service" active={activeTab === "service"} />
          </Suspense>
        </section>
      ) : null}
    </section>
  );
}
