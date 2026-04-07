import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import brandAvatar from "../../templates/DPsearchfuel logo with digital globe.png";

const RouteAssistant = lazy(() => import("./RouteAssistantUnited"));
const TomTomSuite = lazy(() => import("./TomTomSuite"));
const UnitedLaneChat = lazy(() => import("./UnitedLaneChat"));

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const TOKEN_KEY = "auth_token";
const THEME_KEY = "dpsearchfuels_theme";
const statusOptions = ["Done", "In Transit", "At Pickup", "Needs Review", "Delayed"];
const workspaceTabs = [
  { id: "command", label: "Command", detail: "Executive pulse", icon: "01" },
  { id: "routing", label: "Routing", detail: "Fuel intelligence", icon: "02" },
  { id: "loads", label: "Loads", detail: "Dispatch board", icon: "03" },
  { id: "ai", label: "Assistant", detail: "AI copilot", icon: "04" },
  { id: "settings", label: "Settings", detail: "Workspace style", icon: "05" }
];
const themeOptions = [
  { id: "light", label: "Luxe Light", detail: "Bright executive workspace", accent: "Ivory, blue, emerald" },
  { id: "dark", label: "Night Ops", detail: "Low-glare premium console", accent: "Graphite, cyan, lime" },
  { id: "blue", label: "Skyline Blue", detail: "Cool logistics dashboard", accent: "Frost, navy, electric blue" }
];
const workspaceCopy = {
  command: {
    eyebrow: "Live Operating System",
    title: "Commercial dispatch command center",
    subtitle: "A premium cockpit for load visibility, fuel readiness, branded station routing, and daily operations.",
    bannerTitle: "Official station intelligence is connected",
    bannerText: "Love's, Pilot Flying J, TomTom routing, editable loads, and the AI assistant remain wired into one polished workspace."
  },
  routing: {
    eyebrow: "Fuel Route Strategy",
    title: "Plan lanes with station-level clarity",
    subtitle: "Build route options, compare official branded fuel stops, and keep price markers visible directly on the map.",
    bannerTitle: "Map-first routing is ready",
    bannerText: "Fuel stops, route options, detour timing, official pages, and fullscreen inspection are available inside the routing suite."
  },
  loads: {
    eyebrow: "Dispatch Board",
    title: "Manage every load from a cleaner board",
    subtitle: "Filter, edit, review, and save load details with a more polished commercial workflow.",
    bannerTitle: "Inline editing stays active",
    bannerText: "Driver, truck, stop, status, fuel level, and capacity fields still save directly against the backend."
  },
  ai: {
    eyebrow: "AI Operations Desk",
    title: "Ask, summarize, compare, and write faster",
    subtitle: "Use the workspace assistant for route notes, station comparisons, dispatch messaging, and business writing.",
    bannerTitle: "Assistant context is connected",
    bannerText: "The assistant keeps the signed-in user and workspace context available while you work."
  },
  settings: {
    eyebrow: "Workspace Preferences",
    title: "Tune the product feel for long sessions",
    subtitle: "Choose a premium theme and keep the interface comfortable for daily dispatch work.",
    bannerTitle: "Theme settings are saved locally",
    bannerText: "Your selected look is stored in this browser and applied automatically on future visits."
  }
};
const emptyRegister = { full_name: "", email: "", password: "" };
const emptyLogin = { email: "", password: "" };
const emptyRow = {
  driver: "",
  truck: "",
  mpg: "6.0",
  status: "In Transit",
  miles_to_empty: "1200",
  tank_capacity: "200",
  fuel_level: 50,
  pickup_city: "",
  stop1: "",
  stop2: "",
  stop3: "",
  delivery_city: ""
};

function getFuelTone(level) {
  if (level >= 80) return "fuel-strong";
  if (level >= 55) return "fuel-good";
  if (level >= 35) return "fuel-watch";
  return "fuel-low";
}

function getStatusTone(status) {
  if (status === "Done") return "status-done";
  if (status === "Delayed") return "status-delayed";
  if (status === "Needs Review") return "status-review";
  return "status-live";
}

function computeMilesToEmpty(row) {
  const mpg = Number(row.mpg) || 0;
  const tank = Number(row.tank_capacity) || 0;
  const fuel = Number(row.fuel_level) || 0;
  return String(Math.round((tank * mpg * fuel) / 100));
}

function normalizeRow(row) {
  return {
    ...row,
    fuel_level: Number(row.fuel_level ?? 0),
    miles_to_empty: row.miles_to_empty || computeMilesToEmpty(row)
  };
}

function ModuleLoader({ label = "Loading workspace module..." }) {
  return <div className="module-loader">{label}</div>;
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

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function MetricCard({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`metric-card metric-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function LoadPreviewCard({ row }) {
  const fullLoadMiles = Math.round((Number(row.mpg) || 0) * (Number(row.tank_capacity) || 0));

  return (
    <article className="load-preview-card">
      <div className="load-preview-head">
        <div>
          <span className={`status-dot ${getStatusTone(row.status)}`} />
          <strong>{row.driver || "Unassigned driver"}</strong>
          <small>{row.truck ? `Truck #${row.truck}` : "Truck not assigned"}</small>
        </div>
        <span className={`load-preview-status ${getStatusTone(row.status)}`}>{row.status}</span>
      </div>

      <div className="load-preview-route">
        <span>{row.pickup_city || "Pickup TBD"}</span>
        <span>{row.delivery_city || "Delivery TBD"}</span>
      </div>

      <div className="load-preview-meter">
        <span style={{ width: `${Math.max(4, Math.min(100, Number(row.fuel_level) || 0))}%` }} />
      </div>

      <div className="load-preview-stats">
        <span><strong>{row.fuel_level}%</strong>Fuel</span>
        <span><strong>{formatNumber(row.miles_to_empty)}</strong>Miles left</span>
        <span><strong>{formatNumber(fullLoadMiles)}</strong>Full range</span>
      </div>
    </article>
  );
}

export default function App() {
  const [mode, setMode] = useState("login");
  const [registerForm, setRegisterForm] = useState(emptyRegister);
  const [loginForm, setLoginForm] = useState(emptyLogin);
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [theme, setTheme] = useState(localStorage.getItem(THEME_KEY) || "light");
  const [user, setUser] = useState(null);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [loading, setLoading] = useState(false);
  const [gridLoading, setGridLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [activeWorkspace, setActiveWorkspace] = useState("command");

  useEffect(() => {
    if (!token) {
      setUser(null);
      setRows([]);
      return;
    }

    let ignore = false;

    async function bootstrap() {
      setGridLoading(true);
      try {
        const me = await apiRequest("/auth/me", {}, token);
        const loads = await apiRequest("/loads", {}, token);
        if (!ignore) {
          setUser(me);
          setRows(loads.map(normalizeRow));
          setError("");
        }
      } catch (fetchError) {
        if (!ignore) {
          localStorage.removeItem(TOKEN_KEY);
          setToken("");
          setUser(null);
          setRows([]);
          setError(fetchError.message);
        }
      } finally {
        if (!ignore) {
          setGridLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      ignore = true;
    };
  }, [token]);

  useEffect(() => {
    const body = document.body;
    body.classList.remove("theme-light", "theme-dark", "theme-blue");
    body.classList.add(`theme-${theme}`);
    localStorage.setItem(THEME_KEY, theme);

    return () => {
      body.classList.remove("theme-light", "theme-dark", "theme-blue");
    };
  }, [theme]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const haystack = `${row.driver} ${row.truck} ${row.pickup_city} ${row.delivery_city}`.toLowerCase();
      const matchesSearch = haystack.includes(search.toLowerCase());
      const matchesStatus = statusFilter === "All" || row.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, statusFilter]);

  const metrics = useMemo(() => {
    const activeLoads = rows.filter((row) => row.status !== "Done").length;
    const doneLoads = rows.filter((row) => row.status === "Done").length;
    const delayedLoads = rows.filter((row) => row.status === "Delayed").length;
    const reviewLoads = rows.filter((row) => row.status === "Needs Review").length;
    const lowFuelCount = rows.filter((row) => Number(row.fuel_level) < 40).length;
    const avgFuel = rows.length
      ? Math.round(rows.reduce((sum, row) => sum + Number(row.fuel_level || 0), 0) / rows.length)
      : 0;
    const totalMilesToEmpty = rows.reduce((sum, row) => sum + (Number(row.miles_to_empty) || 0), 0);
    const readiness = rows.length ? Math.max(0, 100 - lowFuelCount * 12 - delayedLoads * 14 - reviewLoads * 8) : 100;

    return {
      total: rows.length,
      activeLoads,
      doneLoads,
      delayedLoads,
      reviewLoads,
      lowFuelCount,
      avgFuel,
      totalMilesToEmpty,
      readiness
    };
  }, [rows]);

  const currentDate = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric"
      }).format(new Date()),
    []
  );

  const activeWorkspaceMeta = workspaceTabs.find((tab) => tab.id === activeWorkspace) || workspaceTabs[0];
  const activeWorkspaceCopy = workspaceCopy[activeWorkspaceMeta.id];
  const loadStatusTabs = ["All", ...statusOptions];
  const featuredLoads = filteredRows.slice(0, 4);

  function updateLocalRow(id, field, value) {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.id !== id) return row;
        const nextRow = normalizeRow({ ...row, [field]: value });
        if (field === "mpg" || field === "tank_capacity" || field === "fuel_level") {
          nextRow.miles_to_empty = computeMilesToEmpty(nextRow);
        }
        return nextRow;
      })
    );
  }

  async function submitAuth(path, payload) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const data = await apiRequest(path, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      localStorage.setItem(TOKEN_KEY, data.access_token);
      setToken(data.access_token);
      setUser(data.user);
      setRegisterForm(emptyRegister);
      setLoginForm(emptyLogin);
      setMessage(path === "/auth/register" ? "Account created." : "Signed in.");
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveRow(row) {
    if (!token) return;

    const payload = {
      ...row,
      miles_to_empty: computeMilesToEmpty(row)
    };

    setSavingId(row.id);
    setError("");

    try {
      const saved = await apiRequest(
        `/loads/${row.id}`,
        {
          method: "PUT",
          body: JSON.stringify(payload)
        },
        token
      );

      setRows((currentRows) => currentRows.map((item) => (item.id === row.id ? normalizeRow(saved) : item)));
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingId(null);
    }
  }

  async function createRow() {
    if (!token) return;

    setError("");
    setMessage("");

    try {
      const created = await apiRequest(
        "/loads",
        {
          method: "POST",
          body: JSON.stringify(emptyRow)
        },
        token
      );

      setRows((currentRows) => [normalizeRow(created), ...currentRows]);
      setActiveWorkspace("loads");
    } catch (createError) {
      setError(createError.message);
    }
  }

  async function deleteRow(id) {
    if (!token) return;

    try {
      await apiRequest(`/loads/${id}`, { method: "DELETE" }, token);
      setRows((currentRows) => currentRows.filter((row) => row.id !== id));
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setRows([]);
    setMessage("Signed out.");
    setError("");
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-showcase">
          <div className="auth-showcase-orbit" />
          <div className="brand-mark">
            <img src={brandAvatar} alt="dpsearchfuels" />
            <span>DPsearchfuels OS</span>
          </div>
          <div className="auth-showcase-copy">
            <span className="eyebrow">Commercial logistics frontend</span>
            <h1>Fuel-smart dispatch, routing, and AI in one premium workspace.</h1>
            <p>
              A redesigned command layer for operations teams that need clean load visibility, branded station
              intelligence, and faster daily decisions.
            </p>
          </div>
          <div className="auth-showcase-grid">
            <article>
              <strong>Route AI</strong>
              <span>Station scoring and fuel context</span>
            </article>
            <article>
              <strong>Load Desk</strong>
              <span>Editable dispatch operations</span>
            </article>
            <article>
              <strong>TomTom</strong>
              <span>Map, traffic, search, routing APIs</span>
            </article>
          </div>
        </section>

        <section className="auth-panel">
          <div className="auth-panel-head">
            <span className="brand-pill">Secure Workspace</span>
            <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
            <p>{mode === "login" ? "Sign in to open the operations console." : "Start with a clean commercial workspace."}</p>
          </div>

          {message ? <div className="notice success">{message}</div> : null}
          {error ? <div className="notice error">{error}</div> : null}

          <div className="tabs">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">
              Login
            </button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} type="button">
              Register
            </button>
          </div>

          {mode === "login" ? (
            <form
              className="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitAuth("/auth/login", loginForm);
              }}
            >
              <label>
                Email
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
                  placeholder="name@company.com"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                  placeholder="Enter password"
                  required
                />
              </label>
              <button type="submit" className="primary-button auth-submit" disabled={loading}>
                {loading ? "Signing in..." : "Open Command Center"}
              </button>
            </form>
          ) : (
            <form
              className="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitAuth("/auth/register", registerForm);
              }}
            >
              <label>
                Full Name
                <input
                  type="text"
                  value={registerForm.full_name}
                  onChange={(event) => setRegisterForm({ ...registerForm, full_name: event.target.value })}
                  placeholder="Operations manager"
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={registerForm.email}
                  onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })}
                  placeholder="name@company.com"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })}
                  placeholder="Minimum 6 characters"
                  minLength="6"
                  required
                />
              </label>
              <button type="submit" className="primary-button auth-submit" disabled={loading}>
                {loading ? "Creating..." : "Create Commercial Workspace"}
              </button>
            </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="workspace-app-shell">
      <aside className="workspace-sidebar-shell">
        <div className="workspace-sidebar-brand">
          <div className="workspace-sidebar-logo"><img src={brandAvatar} alt="dpsearchfuels" className="workspace-sidebar-logo-image" /></div>
          <div className="workspace-sidebar-brand-copy">
            <strong>dpsearchfuels</strong>
            <span>{user.full_name}</span>
            <small>{user.email}</small>
          </div>
        </div>

        <button className="workspace-sidebar-create" type="button" onClick={createRow}>
          <span>New Load</span>
          <strong>+</strong>
        </button>

        <nav className="workspace-sidebar-nav">
          {workspaceTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`workspace-sidebar-link ${activeWorkspace === tab.id ? "active" : ""}`}
              onClick={() => setActiveWorkspace(tab.id)}
            >
              <span className="workspace-sidebar-link-icon">{tab.icon}</span>
              <span className="workspace-sidebar-link-copy">
                <strong>{tab.label}</strong>
                <small>{tab.detail}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="workspace-sidebar-footer">
          <div className="workspace-sidebar-footer-card">
            <span>{currentDate}</span>
            <strong>{savingId ? `Saving load #${savingId}` : "System ready"}</strong>
            <small>{metrics.readiness}% readiness score</small>
          </div>
          <button className="secondary-button workspace-sidebar-logout" type="button" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      <section className="workspace-main-shell">
        <header className="workspace-main-header">
          <div className="workspace-main-heading">
            <span className="workspace-main-kicker">{activeWorkspaceCopy.eyebrow}</span>
            <h1>{activeWorkspaceCopy.title}</h1>
            <p>{activeWorkspaceCopy.subtitle}</p>
          </div>

          <div className="workspace-main-meta">
            <div className="workspace-main-usercard">
              <span>Signed in</span>
              <strong>{user.full_name}</strong>
            </div>
            <button className="primary-button header-action-button" type="button" onClick={createRow}>
              Create Load
            </button>
          </div>
        </header>

        {message ? <div className="notice success inline-notice">{message}</div> : null}
        {error ? <div className="notice error inline-notice">{error}</div> : null}

        <section className={`workspace-hero-card workspace-hero-${activeWorkspace}`}>
          <div className="workspace-hero-copy">
            <span className="eyebrow">{activeWorkspaceMeta.detail}</span>
            <h2>{activeWorkspaceCopy.bannerTitle}</h2>
            <p>{activeWorkspaceCopy.bannerText}</p>
          </div>
          <div className="workspace-hero-metrics">
            <span><strong>{metrics.activeLoads}</strong>active loads</span>
            <span><strong>{metrics.avgFuel}%</strong>avg fuel</span>
            <span><strong>{metrics.readiness}%</strong>readiness</span>
          </div>
        </section>

        {activeWorkspace === "command" ? (
          <section className="workspace-content-stack">
            <section className="metric-grid">
              <MetricCard label="Total Loads" value={metrics.total} detail={`${metrics.activeLoads} still moving`} tone="green" />
              <MetricCard label="Low Fuel" value={metrics.lowFuelCount} detail="Loads below 40%" tone={metrics.lowFuelCount ? "amber" : "blue"} />
              <MetricCard label="Needs Review" value={metrics.reviewLoads} detail={`${metrics.delayedLoads} delayed loads`} tone="violet" />
              <MetricCard label="Miles To Empty" value={formatNumber(metrics.totalMilesToEmpty)} detail="Combined active range" tone="dark" />
            </section>

            <section className="command-grid">
              <article className="command-card command-card-main">
                <div>
                  <span className="eyebrow">Executive pulse</span>
                  <h2>{metrics.readiness}% fleet readiness</h2>
                  <p>
                    The redesigned overview gives dispatch a clean first screen: risk, range, branded fuel access, and
                    service status without spreadsheet clutter.
                  </p>
                </div>
                <div className="readiness-ring" style={{ "--score": `${metrics.readiness}%` }}>
                  <strong>{metrics.readiness}</strong>
                  <span>Score</span>
                </div>
              </article>

              <article className="command-card command-card-stack">
                <div className="command-mini-row">
                  <span>Completed</span>
                  <strong>{metrics.doneLoads}</strong>
                </div>
                <div className="command-mini-row">
                  <span>Delayed</span>
                  <strong>{metrics.delayedLoads}</strong>
                </div>
                <div className="command-mini-row">
                  <span>Average fuel</span>
                  <strong>{metrics.avgFuel}%</strong>
                </div>
              </article>
            </section>

            <section className="panel workspace-tool-surface">
              <div className="panel-head">
                <div>
                  <h2>Connected Service Catalog</h2>
                  <span>Operational APIs presented as premium capability cards.</span>
                </div>
              </div>
              <Suspense fallback={<ModuleLoader label="Loading service catalog..." />}><TomTomSuite token={token} /></Suspense>
            </section>
          </section>
        ) : null}

        {activeWorkspace === "routing" ? (
          <section className="workspace-content-stack">
            <section className="metric-grid compact">
              <MetricCard label="Open Loads" value={metrics.activeLoads} detail="Ready for route context" tone="green" />
              <MetricCard label="Low Fuel Watch" value={metrics.lowFuelCount} detail="Prioritize station planning" tone="amber" />
              <MetricCard label="Average Fuel" value={`${metrics.avgFuel}%`} detail="Across visible fleet" tone="blue" />
            </section>
            <Suspense fallback={<ModuleLoader label="Loading route intelligence..." />}><RouteAssistant token={token} /></Suspense>
          </section>
        ) : null}

        {activeWorkspace === "loads" ? (
          <section className="workspace-content-stack">
            <section className="loads-control-card">
              <div>
                <span className="eyebrow">Dispatch visibility</span>
                <h2>{filteredRows.length} loads in this view</h2>
                <p>Search and status tabs reshape the board instantly while inline edits continue saving to the backend.</p>
              </div>
              <div className="loads-control-actions">
                <label className="workspace-table-search">
                  <span>Search loads</span>
                  <input
                    type="text"
                    placeholder="Driver, truck, pickup, delivery"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <button className="primary-button workspace-table-create" type="button" onClick={createRow}>
                  New Load
                </button>
              </div>
            </section>

            <div className="workspace-inline-tabs">
              {loadStatusTabs.map((status) => {
                const total = status === "All" ? rows.length : rows.filter((row) => row.status === status).length;
                return (
                  <button
                    key={status}
                    type="button"
                    className={`workspace-inline-tab ${statusFilter === status ? "active" : ""}`}
                    onClick={() => setStatusFilter(status)}
                  >
                    {status}
                    <span>{total}</span>
                  </button>
                );
              })}
            </div>

            <section className="load-preview-grid">
              {featuredLoads.length ? (
                featuredLoads.map((row) => <LoadPreviewCard key={row.id} row={row} />)
              ) : (
                <div className="empty-route-card">No loads match this view yet. Create a load or clear the filters.</div>
              )}
            </section>

            <section className="panel workspace-table-panel">
              <div className="workspace-table-toolbar">
                <div>
                  <h2>Dispatch Sheet</h2>
                  <span>{gridLoading ? "Syncing with backend..." : savingId ? `Saving row #${savingId}` : "Editable commercial load board"}</span>
                </div>
                <div className="workspace-table-toolbar-actions">
                  <div className="workspace-main-usercard subdued compact">
                    <span>Rows shown</span>
                    <strong>{filteredRows.length}</strong>
                  </div>
                </div>
              </div>

              <div className="sheet-frame">
                <div className="sheet-scroll">
                  <table className="dispatch-sheet">
                    <thead>
                      <tr>
                        <th>Driver</th>
                        <th>Truck #</th>
                        <th>Approx MPG</th>
                        <th>Status</th>
                        <th>Miles to Empty</th>
                        <th>Tank Capacity</th>
                        <th>Fuel %</th>
                        <th>Full Load Miles</th>
                        <th>PU City</th>
                        <th>1st Stop</th>
                        <th>2nd Stop</th>
                        <th>3rd Stop</th>
                        <th>Del City</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.length ? (
                        filteredRows.map((row) => {
                          const fullLoadMiles = Math.round((Number(row.mpg) || 0) * (Number(row.tank_capacity) || 0));

                          return (
                            <tr key={row.id}>
                              <td className="driver-cell">
                                <input
                                  value={row.driver}
                                  onChange={(event) => updateLocalRow(row.id, "driver", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, driver: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.truck}
                                  onChange={(event) => updateLocalRow(row.id, "truck", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, truck: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.mpg}
                                  onChange={(event) => updateLocalRow(row.id, "mpg", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, mpg: event.target.value })}
                                />
                              </td>
                              <td>
                                <select
                                  className={`status-select ${getStatusTone(row.status)}`}
                                  value={row.status}
                                  onChange={async (event) => {
                                    const value = event.target.value;
                                    updateLocalRow(row.id, "status", value);
                                    await saveRow({ ...row, status: value });
                                  }}
                                >
                                  {statusOptions.map((status) => (
                                    <option key={status} value={status}>
                                      {status}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  value={row.miles_to_empty}
                                  onChange={(event) => updateLocalRow(row.id, "miles_to_empty", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, miles_to_empty: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.tank_capacity}
                                  onChange={(event) => updateLocalRow(row.id, "tank_capacity", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, tank_capacity: event.target.value })}
                                />
                              </td>
                              <td className={getFuelTone(Number(row.fuel_level))}>
                                <div className="fuel-cell">
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={row.fuel_level}
                                    onChange={async (event) => {
                                      const value = Number(event.target.value);
                                      updateLocalRow(row.id, "fuel_level", value);
                                      await saveRow({ ...row, fuel_level: value, miles_to_empty: computeMilesToEmpty({ ...row, fuel_level: value }) });
                                    }}
                                  />
                                  <span>{row.fuel_level}%</span>
                                </div>
                              </td>
                              <td className="readonly-cell">{fullLoadMiles}</td>
                              <td>
                                <input
                                  value={row.pickup_city}
                                  onChange={(event) => updateLocalRow(row.id, "pickup_city", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, pickup_city: event.target.value })}
                                />
                              </td>
                              <td>
                                <textarea
                                  value={row.stop1}
                                  onChange={(event) => updateLocalRow(row.id, "stop1", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, stop1: event.target.value })}
                                />
                              </td>
                              <td>
                                <textarea
                                  value={row.stop2}
                                  onChange={(event) => updateLocalRow(row.id, "stop2", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, stop2: event.target.value })}
                                />
                              </td>
                              <td>
                                <textarea
                                  value={row.stop3}
                                  onChange={(event) => updateLocalRow(row.id, "stop3", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, stop3: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.delivery_city}
                                  onChange={(event) => updateLocalRow(row.id, "delivery_city", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, delivery_city: event.target.value })}
                                />
                              </td>
                              <td className="action-cell">
                                <button className="delete-button" onClick={() => deleteRow(row.id)}>
                                  Delete
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan="14" className="empty-state-cell">
                            {gridLoading ? "Loading dispatch data..." : "No loads yet. Create your first row."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </section>
        ) : null}

        {activeWorkspace === "ai" ? (
          <section className="workspace-content-stack">
            <section className="metric-grid compact">
              <MetricCard label="Open Loads" value={metrics.activeLoads} detail="Available for planning" tone="green" />
              <MetricCard label="Fuel Watch" value={metrics.lowFuelCount} detail="Ask for prioritization" tone="amber" />
              <MetricCard label="Readiness" value={`${metrics.readiness}%`} detail="Operational health score" tone="violet" />
            </section>
            <Suspense fallback={<ModuleLoader label="Loading AI assistant..." />}><UnitedLaneChat token={token} user={user} /></Suspense>
          </section>
        ) : null}

        {activeWorkspace === "settings" ? (
          <section className="workspace-content-stack">
            <section className="settings-grid">
              <article className="panel settings-panel-card">
                <div className="panel-head">
                  <h2>Theme Studio</h2>
                  <span>Select the product skin for this browser.</span>
                </div>
                <div className="theme-option-grid">
                  {themeOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`theme-option-card ${theme === option.id ? "active" : ""}`}
                      onClick={() => setTheme(option.id)}
                    >
                      <span className={`theme-option-swatch theme-option-swatch-${option.id}`} />
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                      <em>{option.accent}</em>
                    </button>
                  ))}
                </div>
              </article>

              <article className="panel settings-panel-card">
                <div className="panel-head">
                  <h2>Workspace State</h2>
                  <span>Commercial UI readiness</span>
                </div>
                <div className="settings-summary-list">
                  <div>
                    <span>Selected theme</span>
                    <strong>{themeOptions.find((option) => option.id === theme)?.label || "Luxe Light"}</strong>
                  </div>
                  <div>
                    <span>Saved in browser</span>
                    <strong>Yes</strong>
                  </div>
                  <div>
                    <span>Official station mode</span>
                    <strong>Active</strong>
                  </div>
                  <div>
                    <span>Frontend status</span>
                    <strong>Commercial redesign applied</strong>
                  </div>
                </div>
              </article>
            </section>
          </section>
        ) : null}
      </section>
    </main>
  );
}
