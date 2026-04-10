import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { SiteDialog, SiteHeader, UnitedLaneMark, sitePanels } from "./UnitedLaneSiteChrome";

const RouteAssistant = lazy(() => import("./RouteAssistantUnited"));
const TomTomSuite = lazy(() => import("./TomTomSuite"));
const MotiveDashboardCards = lazy(() => import("./MotiveDashboardCards"));
const MotiveTrackingPanel = lazy(() => import("./MotiveTrackingPanel"));
const UnitedLaneChat = lazy(() => import("./UnitedLaneChat"));

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const TOKEN_KEY = "auth_token";
const THEME_KEY = "dpsearchfuels_theme";
const PRODUCT_KEY = "unitedlane_active_product";
const statusOptions = ["Done", "In Transit", "At Pickup", "Needs Review", "Delayed"];
const productOptions = [
  {
    id: "fuel",
    label: "Fuel Service",
    eyebrow: "Live workspace",
    detail: "Dispatch, routes, live tracking, loads, and fuel decisions.",
    status: "Current system",
    workspaceEyebrow: "Fuel Service",
    workspaceTitle: "Fuel Service Command",
    workspaceSubtitle: "All routing, dispatch, live tracking, and fuel operations stay inside this area.",
    authDescription: "Choose the active Fuel Service workspace for the tools your team already uses every day.",
    authPanelDescription: "Use the current routing, loads, tracking, and fuel stack under Fuel Service."
  },
  {
    id: "safety",
    label: "Safety",
    eyebrow: "New workspace",
    detail: "Incidents, inspections, coaching, and compliance workflows.",
    status: "Build today",
    workspaceEyebrow: "Safety",
    workspaceTitle: "Safety Workspace",
    workspaceSubtitle: "This section is separated from Fuel Service so we can build safety tools cleanly.",
    authDescription: "Choose Safety to enter the new dedicated area for inspections, incidents, coaching, and compliance work.",
    authPanelDescription: "Start a separate Safety workspace while Fuel Service keeps the full live operations system."
  }
];
const authShowcaseHighlights = [
  {
    title: "Fuel Service",
    detail: "The full live system stays here: loads, route planning, tracking, and station work."
  },
  {
    title: "Safety",
    detail: "A clean section for the next build: incidents, inspections, coaching, and compliance."
  },
  {
    title: "One Account",
    detail: "The same company login can move between Fuel Service and Safety."
  }
];
const safetyBuildCards = [
  {
    title: "Incident Desk",
    tag: "Start here",
    detail: "Capture accidents, near misses, escalations, and manager follow-up in one place."
  },
  {
    title: "Inspections",
    tag: "Checklist flows",
    detail: "Build pre-trip, post-trip, and DOT inspection actions with clean status tracking."
  },
  {
    title: "Driver Coaching",
    tag: "Performance",
    detail: "Review events, coaching notes, and corrective actions without mixing them into fuel operations."
  },
  {
    title: "Compliance Docs",
    tag: "Records",
    detail: "Keep policies, reminders, acknowledgements, and expiration workflows in one safety lane."
  }
];
const workspaceTabs = [
  { id: "command", label: "Dashboard", detail: "Main view", icon: "DB" },
  { id: "tracking", label: "Tracking", detail: "Fleet live", icon: "TR" },
  { id: "routing", label: "Routing", detail: "Build route", icon: "RT" },
  { id: "loads", label: "Loads", detail: "Edit loads", icon: "LD" },
  { id: "ai", label: "Assistant", detail: "Ask AI", icon: "AI" },
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
    title: "Fuel Service Command",
    subtitle: "See loads, open routing, check services, and run fuel decisions from one clean screen."
  },
  tracking: {
    eyebrow: "Fuel Service",
    title: "Fuel Service Tracking",
    subtitle: "Watch trucks on the map, inspect vehicle status, and review driver and location updates in one place."
  },
  routing: {
    eyebrow: "Fuel Service",
    title: "Fuel Service Routing",
    subtitle: "Pick a truck or driver, enter A and B, and let the system fill live fuel and route planning inputs automatically."
  },
  loads: {
    eyebrow: "Fuel Service",
    title: "Fuel Service Loads",
    subtitle: "Create, search, edit, and save load rows inside the fuel operations workspace."
  },
  ai: {
    eyebrow: "Fuel Service",
    title: "Fuel Service Assistant",
    subtitle: "Ask for route notes, station comparisons, dispatch messages, or writing help."
  },
  settings: {
    eyebrow: "Fuel Service",
    title: "Fuel Service Settings",
    subtitle: "Choose a comfortable theme for this browser."
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

function getProductMeta(productId) {
  return productOptions.find((option) => option.id === productId) || productOptions[0];
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
function AreaSelectorCard({ option, active, onSelect, compact = false }) {
  return (
    <button
      type="button"
      className={`area-selector-card${active ? " active" : ""}${compact ? " compact" : ""}`}
      onClick={() => onSelect(option.id)}
    >
      <span>{option.eyebrow}</span>
      <strong>{option.label}</strong>
      <small>{option.detail}</small>
      <em>{option.status}</em>
    </button>
  );
}

function SafetyWorkspace({ currentDate, onSelectProduct }) {
  return (
    <section className="workspace-content-stack">
      <section className="workspace-hero-card safety-hero-card">
        <div className="workspace-hero-copy">
          <span className="eyebrow">Safety</span>
          <h2>Safety is now its own workspace.</h2>
          <p>
            Fuel Service keeps the full live system we already built. This area is now separated and ready for incidents,
            inspections, coaching, and compliance tools.
          </p>
        </div>

        <div className="workspace-hero-metrics">
          <span>
            <strong>Clean</strong>
            Separate lane for safety builds
          </span>
          <span>
            <strong>04</strong>
            Core safety workflows outlined
          </span>
          <span>
            <strong>Fuel</strong>
            Live operations stay there
          </span>
        </div>
      </section>

      <section className="metric-grid compact">
        <MetricCard label="Today focus" value="Safety" detail="New company section" tone="violet" />
        <MetricCard label="Live system" value="Fuel" detail="Current tools stay there" tone="green" />
        <MetricCard label="Status" value="Ready" detail={currentDate} tone="blue" />
      </section>

      <section className="panel safety-module-panel">
        <div className="panel-head">
          <div>
            <h2>Safety build board</h2>
            <span>These blocks are ready to expand next.</span>
          </div>

          <button className="secondary-button" type="button" onClick={() => onSelectProduct("fuel")}>
            Open Fuel Service
          </button>
        </div>

        <div className="safety-roadmap-grid">
          {safetyBuildCards.map((card) => (
            <article className="safety-roadmap-card" key={card.title}>
              <span>{card.tag}</span>
              <strong>{card.title}</strong>
              <p>{card.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

export default function App() {
  const [mode, setMode] = useState("login");
  const [registerForm, setRegisterForm] = useState(emptyRegister);
  const [loginForm, setLoginForm] = useState(emptyLogin);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "light");
  const [selectedProduct, setSelectedProduct] = useState(() => {
    const savedProduct = localStorage.getItem(PRODUCT_KEY);
    return productOptions.some((option) => option.id === savedProduct) ? savedProduct : "fuel";
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
    if (!token || selectedProduct !== "fuel") {
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
  }, [token, selectedProduct]);

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
    localStorage.setItem(PRODUCT_KEY, selectedProduct);
  }, [selectedProduct]);

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

  const selectedProductMeta = getProductMeta(selectedProduct);
  const isFuelService = selectedProduct === "fuel";
  const activeWorkspaceMeta = workspaceTabs.find((tab) => tab.id === activeWorkspace) || workspaceTabs[0];
  const activeWorkspaceCopy = workspaceCopy[activeWorkspaceMeta.id];
  const activeSiteNav = sitePanel || (!user || selectedProduct === "safety" || activeWorkspace === "command" ? "home" : "");
  const loadStatusTabs = ["All", ...statusOptions];
  const workspaceEyebrow = isFuelService ? activeWorkspaceCopy.eyebrow : selectedProductMeta.workspaceEyebrow;
  const workspaceHeading = isFuelService ? activeWorkspaceCopy.title : selectedProductMeta.workspaceTitle;
  const workspaceSubtitle = isFuelService ? activeWorkspaceCopy.subtitle : selectedProductMeta.workspaceSubtitle;

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
    const currentProduct = getProductMeta(selectedProduct);

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
      setMessage(path === "/auth/register" ? `Account created. ${currentProduct.label} is ready.` : `Signed in. Opening ${currentProduct.label}.`);
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
      setSelectedProduct("fuel");
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

    if (selectedProduct === "fuel") {
      setActiveWorkspace("command");
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSelectProduct(productId) {
    setSelectedProduct(productId);
    setMessage("");
    setError("");
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

        <main className="auth-shell site-auth-shell">
          <section className="auth-showcase">
            <div className="auth-showcase-orbit" />

            <div className="brand-mark">
              <UnitedLaneMark className="auth-brand-mark-svg" />
              <span>United Lane Internal Access</span>
            </div>

            <div className="auth-showcase-copy">
              <span className="eyebrow">{selectedProductMeta.workspaceEyebrow}</span>
              <h1>{selectedProductMeta.workspaceTitle}</h1>
              <p>{selectedProductMeta.authDescription}</p>
            </div>

            <div className="auth-showcase-grid">
              {authShowcaseHighlights.map((highlight) => (
                <article key={highlight.title}>
                  <strong>{highlight.title}</strong>
                  <span>{highlight.detail}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="auth-panel">
            <div className="auth-panel-head">
              <span className="brand-pill">United Lane LLC</span>
              <h2>{mode === "login" ? `Sign in to ${selectedProductMeta.label}` : `Create ${selectedProductMeta.label} access`}</h2>
              <p>{selectedProductMeta.authPanelDescription}</p>
            </div>

            {message ? <div className="notice success">{message}</div> : null}
            {error ? <div className="notice error">{error}</div> : null}
            {isRestoringSession ? <div className="notice info">Restoring saved access to {selectedProductMeta.label}.</div> : null}

            <div className="auth-product-grid">
              {productOptions.map((option) => (
                <AreaSelectorCard key={option.id} option={option} active={selectedProduct === option.id} onSelect={handleSelectProduct} />
              ))}

              <article className="auth-account-card">
                <span>Account</span>
                <strong>{mode === "login" ? "One company login for both sections" : "Create one shared company login"}</strong>
                <small>Fuel Service keeps the current live system, and Safety now has a separate area for the next build.</small>
              </article>
            </div>

            {isRestoringSession ? (
              <div className="auth-restoring-card">
                <span className="eyebrow">Session</span>
                <strong>Checking your saved account</strong>
                <p>Please wait a moment while the workspace restores.</p>
              </div>
            ) : (
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
                      {loading ? "Signing in..." : `Continue to ${selectedProductMeta.label}`}
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
                      {loading ? "Creating..." : `Create ${selectedProductMeta.label} Account`}
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
              <span>{selectedProductMeta.label}</span>
              <small>Company systems</small>
            </div>
          </div>

          <div className="workspace-sidebar-stack">
            <section className="workspace-section-switcher">
              <span className="workspace-section-switcher-label">Company areas</span>
              <div className="workspace-section-switcher-grid">
                {productOptions.map((option) => (
                  <AreaSelectorCard
                    key={option.id}
                    option={option}
                    active={selectedProduct === option.id}
                    onSelect={handleSelectProduct}
                    compact
                  />
                ))}
              </div>
            </section>

            <article className="workspace-sidebar-account-card">
              <span>Account</span>
              <strong>{user.full_name}</strong>
              <small>{user.email}</small>
              <em>{selectedProductMeta.label} access enabled</em>
            </article>
          </div>

          <div className="workspace-sidebar-body">
            {isFuelService ? (
              <>
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
              </>
            ) : (
              <div className="workspace-sidebar-note">
                <span>Safety</span>
                <strong>Fresh section for today's work</strong>
                <small>Fuel Service keeps the live routing, loads, tracking, and fuel stack while we build Safety here.</small>
              </div>
            )}
          </div>

          <div className="workspace-sidebar-footer">
            <div className="workspace-sidebar-footer-card">
              <span>{currentDate}</span>
              <strong>{isFuelService ? (savingId ? `Saving load #${savingId}` : "Fuel Service ready") : "Safety workspace ready"}</strong>
              <small>{isFuelService ? `${metrics.readiness}% readiness score` : "Dedicated lane for new safety tools"}</small>
            </div>
            <button className="secondary-button workspace-sidebar-logout" type="button" onClick={logout}>
              Logout
            </button>
          </div>
        </aside>

        <section className="workspace-main-shell">
          <header className="workspace-main-header">
            <div className="workspace-main-heading">
              <span className="workspace-main-kicker">{workspaceEyebrow}</span>
              <h1>{workspaceHeading}</h1>
              <p>{workspaceSubtitle}</p>
            </div>

            <div className="workspace-main-meta">
              <div className="workspace-main-usercard">
                <span>Account</span>
                <strong>{user.full_name}</strong>
              </div>
              <div className="workspace-main-usercard subdued">
                <span>Active area</span>
                <strong>{selectedProductMeta.label}</strong>
              </div>
              {isFuelService ? (
                <button className="primary-button header-action-button" type="button" onClick={createRow}>
                  Create Load
                </button>
              ) : (
                <button className="secondary-button header-action-button" type="button" onClick={() => handleSelectProduct("fuel")}>
                  Open Fuel Service
                </button>
              )}
            </div>
          </header>

          {message ? <div className="notice success inline-notice">{message}</div> : null}
          {error ? <div className="notice error inline-notice">{error}</div> : null}

          {isFuelService ? (
            <>
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
                      <span>TomTom tools available in the Fuel Service workspace.</span>
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
                    <p>Search, filter by status, edit cells, and changes save to the backend.</p>
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
                      <span>{gridLoading ? "Syncing with backend..." : savingId ? `Saving row #${savingId}` : "Editable load board"}</span>
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

              <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "ai"}>
                <Suspense fallback={<ModuleLoader label="Loading AI assistant..." />}>
                  <UnitedLaneChat token={token} user={user} />
                </Suspense>
              </section>

              <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "settings"}>
                <section className="settings-grid">
                  <article className="panel settings-panel-card">
                    <div className="panel-head">
                      <h2>Theme</h2>
                      <span>Choose the look for this browser.</span>
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
            </>
          ) : (
            <SafetyWorkspace currentDate={currentDate} onSelectProduct={handleSelectProduct} />
          )}
        </section>
      </main>

      {sitePanel ? <SiteDialog panel={sitePanels[sitePanel]} onClose={() => setSitePanel("")} /> : null}
    </div>
  );
}
