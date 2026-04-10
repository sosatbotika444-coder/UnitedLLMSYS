import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import SafetyWorkspace from "./SafetyWorkspace";
import { SiteDialog, SiteHeader, UnitedLaneMark, sitePanels } from "./UnitedLaneSiteChrome";

const RouteAssistant = lazy(() => import("./RouteAssistantUnited"));
const TomTomSuite = lazy(() => import("./TomTomSuite"));
const MotiveDashboardCards = lazy(() => import("./MotiveDashboardCards"));
const MotiveTrackingPanel = lazy(() => import("./MotiveTrackingPanel"));

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const TOKEN_KEY = "auth_token";
const THEME_KEY = "dpsearchfuels_theme";
const PRODUCT_KEY = "unitedlane_active_product";
const statusOptions = ["Done", "In Transit", "At Pickup", "Needs Review", "Delayed"];
const departmentOptions = [
  { id: "fuel", label: "Fuel Service", detail: "Routes, loads, tracking" },
  { id: "safety", label: "Safety", detail: "Notes and AI" }
];
const workspaceTabs = [
  { id: "command", label: "Dashboard", detail: "Main view", icon: "DB" },
  { id: "tracking", label: "Tracking", detail: "Fleet live", icon: "TR" },
  { id: "routing", label: "Routing", detail: "Build route", icon: "RT" },
  { id: "loads", label: "Loads", detail: "Edit loads", icon: "LD" },
  { id: "settings", label: "Settings", detail: "Theme", icon: "ST" }
];
const themeOptions = [
  { id: "light", label: "Luxe Light", detail: "Bright executive workspace", accent: "Ivory, blue, emerald" },
  { id: "dark", label: "Night Ops", detail: "Low-glare premium console", accent: "Graphite, cyan, lime" },
  { id: "blue", label: "Skyline Blue", detail: "Cool logistics dashboard", accent: "Frost, navy, electric blue" }
];
const workspaceCopy = {
  command: {
    eyebrow: "Fuel Service",
    title: "Fuel Service",
    subtitle: "Dispatch, fuel, and live operations."
  },
  tracking: {
    eyebrow: "Fuel Service",
    title: "Tracking",
    subtitle: "Fleet visibility and status."
  },
  routing: {
    eyebrow: "Fuel Service",
    title: "Routing",
    subtitle: "Build routes and fuel plans."
  },
  loads: {
    eyebrow: "Fuel Service",
    title: "Loads",
    subtitle: "Edit and save load rows."
  },
  settings: {
    eyebrow: "Fuel Service",
    title: "Settings",
    subtitle: "Theme and browser preferences."
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

function getDepartmentMeta(departmentId) {
  return departmentOptions.find((option) => option.id === departmentId) || departmentOptions[0];
}

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

function DepartmentCard({ option, active, onSelect }) {
  return (
    <button type="button" className={`area-selector-card${active ? " active" : ""}`} onClick={() => onSelect(option.id)}>
      <strong>{option.label}</strong>
      <small>{option.detail}</small>
    </button>
  );
}

export default function App() {
  const [mode, setMode] = useState("login");
  const [registerForm, setRegisterForm] = useState(emptyRegister);
  const [loginForm, setLoginForm] = useState(emptyLogin);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "light");
  const [selectedDepartment, setSelectedDepartment] = useState(() => {
    const savedDepartment = localStorage.getItem(PRODUCT_KEY);
    return departmentOptions.some((option) => option.id === savedDepartment) ? savedDepartment : "fuel";
  });
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
  const [sitePanel, setSitePanel] = useState("");

  useEffect(() => {
    if (!token) {
      setUser(null);
      setRows([]);
      return;
    }

    let ignore = false;

    async function bootstrapUser() {
      try {
        const me = await apiRequest("/auth/me", {}, token);
        if (!ignore) {
          setUser(me);
          setSelectedDepartment(me.department);
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
      }
    }

    bootstrapUser();

    return () => {
      ignore = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || user?.department !== "fuel") {
      setRows([]);
      setGridLoading(false);
      return;
    }

    let ignore = false;

    async function loadFuelWorkspace() {
      setGridLoading(true);
      try {
        const loads = await apiRequest("/loads", {}, token);
        if (!ignore) {
          setRows(loads.map(normalizeRow));
          setError("");
        }
      } catch (fetchError) {
        if (!ignore) {
          setRows([]);
          setError(fetchError.message);
        }
      } finally {
        if (!ignore) {
          setGridLoading(false);
        }
      }
    }

    loadFuelWorkspace();

    return () => {
      ignore = true;
    };
  }, [token, user?.department]);

  useEffect(() => {
    const body = document.body;
    body.classList.remove("theme-light", "theme-dark", "theme-blue");
    body.classList.add(`theme-${theme}`);
    localStorage.setItem(THEME_KEY, theme);

    return () => {
      body.classList.remove("theme-light", "theme-dark", "theme-blue");
    };
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(PRODUCT_KEY, selectedDepartment);
  }, [selectedDepartment]);

  useEffect(() => {
    const timers = [60, 220].map((delay) => window.setTimeout(() => window.dispatchEvent(new Event("resize")), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeWorkspace]);

  useEffect(() => {
    if (!sitePanel) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setSitePanel("");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sitePanel]);

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
    const delayedLoads = rows.filter((row) => row.status === "Delayed").length;
    const reviewLoads = rows.filter((row) => row.status === "Needs Review").length;
    const lowFuelCount = rows.filter((row) => Number(row.fuel_level) < 40).length;
    const totalMilesToEmpty = rows.reduce((sum, row) => sum + (Number(row.miles_to_empty) || 0), 0);
    const readiness = rows.length ? Math.max(0, 100 - lowFuelCount * 12 - delayedLoads * 14 - reviewLoads * 8) : 100;

    return {
      total: rows.length,
      activeLoads,
      delayedLoads,
      reviewLoads,
      lowFuelCount,
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

  const activeDepartment = user?.department || selectedDepartment;
  const selectedDepartmentMeta = getDepartmentMeta(activeDepartment);
  const isFuelService = activeDepartment === "fuel";
  const activeWorkspaceMeta = workspaceTabs.find((tab) => tab.id === activeWorkspace) || workspaceTabs[0];
  const activeWorkspaceCopy = workspaceCopy[activeWorkspaceMeta.id] || workspaceCopy.command;
  const activeSiteNav = sitePanel || (!user || !isFuelService || activeWorkspace === "command" ? "home" : "");
  const loadStatusTabs = ["All", ...statusOptions];

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
        body: JSON.stringify({ ...payload, department: selectedDepartment })
      });

      localStorage.setItem(TOKEN_KEY, data.access_token);
      setToken(data.access_token);
      setUser(data.user);
      setSelectedDepartment(data.user.department);
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
    if (!token || !isFuelService) return;

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
    if (!token || !isFuelService) return;

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
    setSitePanel("");
    setMode("login");
    setActiveWorkspace("command");
  }

  function openSitePanel(panel) {
    setSitePanel(panel);
  }

  function handleHomeNavigation() {
    setSitePanel("");

    if (!user) {
      setMode("login");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (isFuelService) {
      setActiveWorkspace("command");
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!user) {
    const isRestoringSession = Boolean(token);

    return (
      <div className="site-page-shell">
        <SiteHeader
          onHome={handleHomeNavigation}
          onAbout={() => openSitePanel("about")}
          onPrivacy={() => openSitePanel("privacy")}
          activeItem={activeSiteNav}
        />

        <main className="auth-shell site-auth-shell auth-shell-compact">
          <section className="auth-panel auth-panel-compact">
            <div className="auth-panel-head">
              <span className="brand-pill">United Lane LLC</span>
              <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
              <p>{selectedDepartmentMeta.label}</p>
            </div>

            {message ? <div className="notice success">{message}</div> : null}
            {error ? <div className="notice error">{error}</div> : null}
            {isRestoringSession ? <div className="notice info">Checking access...</div> : null}

            <div className="auth-department-grid">
              {departmentOptions.map((option) => (
                <DepartmentCard key={option.id} option={option} active={selectedDepartment === option.id} onSelect={setSelectedDepartment} />
              ))}
            </div>

            <div className="auth-lock-note">Each account belongs to one department.</div>

            {isRestoringSession ? null : (
              <>
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
                      {loading ? "Signing in..." : "Continue"}
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
                        placeholder="Full name"
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
                      {loading ? "Creating..." : "Create Account"}
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        </main>

        {sitePanel ? <SiteDialog panel={sitePanels[sitePanel]} onClose={() => setSitePanel("")} /> : null}
      </div>
    );
  }

  if (!isFuelService) {
    return (
      <div className="site-page-shell">
        <SiteHeader
          onHome={handleHomeNavigation}
          onAbout={() => openSitePanel("about")}
          onPrivacy={() => openSitePanel("privacy")}
          activeItem={activeSiteNav}
        />

        <main className="workspace-app-shell site-workspace-shell workspace-app-shell-safety">
          <aside className="workspace-sidebar-shell">
            <div className="workspace-sidebar-brand">
              <div className="workspace-sidebar-logo">
                <UnitedLaneMark className="workspace-sidebar-logo-mark" />
              </div>
              <div className="workspace-sidebar-brand-copy">
                <strong>United Lane LLC</strong>
                <span>Safety</span>
                <small>{user.email}</small>
              </div>
            </div>

            <article className="workspace-sidebar-account-card">
              <span>Account</span>
              <strong>{user.full_name}</strong>
              <small>{user.email}</small>
              <em>Safety access</em>
            </article>

            <div className="workspace-sidebar-footer">
              <div className="workspace-sidebar-footer-card">
                <span>{currentDate}</span>
                <strong>Safety ready</strong>
                <small>Documents, notes, AI</small>
              </div>
              <button className="secondary-button workspace-sidebar-logout" type="button" onClick={logout}>
                Logout
              </button>
            </div>
          </aside>

          <section className="workspace-main-shell">
            <header className="workspace-main-header">
              <div className="workspace-main-heading">
                <span className="workspace-main-kicker">Safety</span>
                <h1>Safety</h1>
                <p>Documents, notes, AI.</p>
              </div>

              <div className="workspace-main-meta">
                <div className="workspace-main-usercard">
                  <span>Account</span>
                  <strong>{user.full_name}</strong>
                </div>
              </div>
            </header>

            {message ? <div className="notice success inline-notice">{message}</div> : null}
            {error ? <div className="notice error inline-notice">{error}</div> : null}

            <SafetyWorkspace token={token} user={user} />
          </section>
        </main>

        {sitePanel ? <SiteDialog panel={sitePanels[sitePanel]} onClose={() => setSitePanel("")} /> : null}
      </div>
    );
  }

  return (
    <div className="site-page-shell">
      <SiteHeader
        onHome={handleHomeNavigation}
        onAbout={() => openSitePanel("about")}
        onPrivacy={() => openSitePanel("privacy")}
        activeItem={activeSiteNav}
      />

      <main className="workspace-app-shell site-workspace-shell">
        <aside className="workspace-sidebar-shell">
          <div className="workspace-sidebar-brand">
            <div className="workspace-sidebar-logo">
              <UnitedLaneMark className="workspace-sidebar-logo-mark" />
            </div>
            <div className="workspace-sidebar-brand-copy">
              <strong>United Lane LLC</strong>
              <span>Fuel Service</span>
              <small>{user.email}</small>
            </div>
          </div>

          <article className="workspace-sidebar-account-card">
            <span>Account</span>
            <strong>{user.full_name}</strong>
            <small>{user.email}</small>
            <em>Fuel Service access</em>
          </article>

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
              <strong>{savingId ? `Saving load #${savingId}` : "Fuel Service ready"}</strong>
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
                <span>Account</span>
                <strong>{user.full_name}</strong>
              </div>
              <button className="primary-button header-action-button" type="button" onClick={createRow}>
                Create Load
              </button>
            </div>
          </header>

          {message ? <div className="notice success inline-notice">{message}</div> : null}
          {error ? <div className="notice error inline-notice">{error}</div> : null}

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "command"}>
            <section className="metric-grid">
              <MetricCard label="Total loads" value={metrics.total} detail={`${metrics.activeLoads} active`} tone="green" />
              <MetricCard label="Low fuel" value={metrics.lowFuelCount} detail="Below 40%" tone={metrics.lowFuelCount ? "amber" : "blue"} />
              <MetricCard label="Needs review" value={metrics.reviewLoads} detail={`${metrics.delayedLoads} delayed`} tone="violet" />
              <MetricCard label="Miles left" value={formatNumber(metrics.totalMilesToEmpty)} detail="All loads" tone="dark" />
            </section>

            <Suspense fallback={<ModuleLoader label="Loading Motive operations cards..." />}>
              <MotiveDashboardCards token={token} active={activeWorkspace === "command"} />
            </Suspense>

            <section className="panel workspace-tool-surface">
              <div className="panel-head">
                <div>
                  <h2>Fuel Service Tools</h2>
                  <span>TomTom tools.</span>
                </div>
              </div>
              <Suspense fallback={<ModuleLoader label="Loading service catalog..." />}>
                <TomTomSuite token={token} />
              </Suspense>
            </section>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "tracking"}>
            <Suspense fallback={<ModuleLoader label="Loading Motive fleet tracking..." />}>
              <MotiveTrackingPanel token={token} active={activeWorkspace === "tracking"} />
            </Suspense>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "routing"}>
            <Suspense fallback={<ModuleLoader label="Loading route intelligence..." />}>
              <RouteAssistant token={token} active={activeWorkspace === "routing"} loadRows={rows} />
            </Suspense>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "loads"}>
            <section className="loads-control-card">
              <div>
                <span className="eyebrow">Loads</span>
                <h2>{filteredRows.length} rows shown</h2>
                <p>Search, filter, edit, save.</p>
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

            <section className="panel workspace-table-panel">
              <div className="workspace-table-toolbar">
                <div>
                  <h2>Dispatch Sheet</h2>
                  <span>{gridLoading ? "Syncing..." : savingId ? `Saving row #${savingId}` : "Editable load board"}</span>
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
                            {gridLoading ? "Loading data..." : "No loads yet."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "settings"}>
            <section className="settings-grid">
              <article className="panel settings-panel-card">
                <div className="panel-head">
                  <h2>Theme</h2>
                  <span>Choose the look.</span>
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
                  <span>Current workspace</span>
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
                    <strong>Fuel Service mode applied</strong>
                  </div>
                </div>
              </article>
            </section>
          </section>
        </section>
      </main>

      {sitePanel ? <SiteDialog panel={sitePanels[sitePanel]} onClose={() => setSitePanel("")} /> : null}
    </div>
  );
}

