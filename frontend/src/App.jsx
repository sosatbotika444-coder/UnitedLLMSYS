import { useEffect, useMemo, useState } from "react";
import RouteAssistant from "./RouteAssistantUnited";
import TomTomSuite from "./TomTomSuite";
import UnitedLaneChat from "./UnitedLaneChat";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production.up.railway.app/api";
const TOKEN_KEY = "auth_token";
const statusOptions = ["Done", "In Transit", "At Pickup", "Needs Review", "Delayed"];
const workspaceTabs = [
  { id: "command", label: "Command Center", detail: "Commercial overview" },
  { id: "routing", label: "Routing", detail: "Official station map" },
  { id: "loads", label: "Loads", detail: "Dispatch board" },
  { id: "ai", label: "UnitedLane AI", detail: "Company assistant" }
];
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

export default function App() {
  const [mode, setMode] = useState("login");
  const [registerForm, setRegisterForm] = useState(emptyRegister);
  const [loginForm, setLoginForm] = useState(emptyLogin);
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
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
    const lowFuelCount = rows.filter((row) => Number(row.fuel_level) < 40).length;
    const avgFuel = rows.length
      ? Math.round(rows.reduce((sum, row) => sum + Number(row.fuel_level || 0), 0) / rows.length)
      : 0;

    return {
      total: rows.length,
      activeLoads,
      lowFuelCount,
      avgFuel
    };
  }, [rows]);

  const currentDate = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      }).format(new Date()),
    []
  );

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
        <section className="auth-panel">
          <div className="brand-lockup">
            <span className="brand-pill">United Lane System</span>
            <h1>Dispatch Workspace</h1>
          </div>

          {message ? <div className="notice success">{message}</div> : null}
          {error ? <div className="notice error">{error}</div> : null}

          <div className="tabs">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
              Login
            </button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
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
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                  required
                />
              </label>
              <button type="submit" className="primary-button" disabled={loading}>
                {loading ? "Signing In..." : "Login"}
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
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={registerForm.email}
                  onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })}
                  minLength="6"
                  required
                />
              </label>
              <button type="submit" className="primary-button" disabled={loading}>
                {loading ? "Creating..." : "Create Account"}
              </button>
            </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell dashboard-shell-commercial">
      <header className="workspace-header workspace-header-commercial">
        <div className="workspace-title workspace-title-commercial">
          <span className="brand-pill">United Lane System</span>
          <h1>UnitedLane Command Workspace</h1>
          <p>Commercial route intelligence, official station pricing, dispatch loads, and company AI in one system.</p>
        </div>

        <div className="workspace-actions">
          <div className="workspace-meta workspace-meta-hero">
            <span>{currentDate}</span>
            <strong>{savingId ? `Saving row #${savingId}` : "Official station engine online"}</strong>
          </div>
          <div className="user-badge">
            <strong>{user.full_name}</strong>
            <span>{user.email}</span>
          </div>
          <button className="primary-button" onClick={createRow}>
            New Load
          </button>
          <button className="secondary-button" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {message ? <div className="notice success inline-notice">{message}</div> : null}
      {error ? <div className="notice error inline-notice">{error}</div> : null}

      <section className="workspace-commercial-grid">
        <article className="panel summary-panel summary-panel-commercial">
          <div className="panel-head">
            <h2>Fleet Snapshot</h2>
            <span>Live</span>
          </div>
          <div className="stats-grid compact">
            <article className="stat-card stat-card-commercial">
              <span>Total Loads</span>
              <strong>{metrics.total}</strong>
            </article>
            <article className="stat-card stat-card-commercial">
              <span>Open Loads</span>
              <strong>{metrics.activeLoads}</strong>
            </article>
            <article className="stat-card warning stat-card-commercial">
              <span>Low Fuel</span>
              <strong>{metrics.lowFuelCount}</strong>
            </article>
            <article className="stat-card accent stat-card-commercial">
              <span>Average Fuel</span>
              <strong>{metrics.avgFuel}%</strong>
            </article>
          </div>
        </article>

        <article className="panel filter-panel filter-panel-commercial">
          <div className="panel-head">
            <h2>Commercial Filters</h2>
            <span>{filteredRows.length} visible</span>
          </div>
          <section className="toolbar">
            <label className="toolbar-search">
              <span>Search</span>
              <input
                type="text"
                placeholder="Driver, truck, pickup, delivery"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <label className="toolbar-filter">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="All">All Statuses</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>

            <div className="system-state system-state-commercial">
              <span>{gridLoading ? "Loading dispatch data" : "Auto save enabled"}</span>
              <strong>{gridLoading ? "Syncing..." : "Official route and station analysis ready"}</strong>
            </div>
          </section>
        </article>
      </section>

      <section className="workspace-nav-panel panel">
        <div className="workspace-nav-head">
          <div>
            <h2>Workspace Sections</h2>
            <span>Switch between operations, routing, loads, and UnitedLane AI.</span>
          </div>
        </div>
        <div className="workspace-nav-grid">
          {workspaceTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`workspace-nav-button ${activeWorkspace === tab.id ? "active" : ""}`}
              onClick={() => setActiveWorkspace(tab.id)}
            >
              <strong>{tab.label}</strong>
              <span>{tab.detail}</span>
            </button>
          ))}
        </div>
      </section>

      {activeWorkspace === "command" ? (
        <section className="workspace-stack">
          <section className="panel workspace-commercial-callout">
            <div className="panel-head">
              <h2>Command Center</h2>
              <span>UnitedLane</span>
            </div>
            <p>
              This commercial workspace is tuned for fleet analysis: official Love&apos;s and Pilot pricing, route-facing station matching,
              load visibility, and a dedicated company AI assistant.
            </p>
          </section>
          <TomTomSuite token={token} />
        </section>
      ) : null}

      {activeWorkspace === "routing" ? <RouteAssistant token={token} /> : null}

      {activeWorkspace === "loads" ? (
        <section className="panel sheet-panel">
          <div className="sheet-panel-head">
            <div>
              <h2>Load Board</h2>
              <span>Edit cells directly. Changes save to the backend.</span>
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
      ) : null}

      {activeWorkspace === "ai" ? <UnitedLaneChat token={token} user={user} /> : null}
    </main>
  );
}
