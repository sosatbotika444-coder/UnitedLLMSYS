import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";
const TOKEN_KEY = "auth_token";

const emptyRegister = { full_name: "", email: "", password: "" };
const emptyLogin = { email: "", password: "" };

export default function App() {
  const [mode, setMode] = useState("login");
  const [registerForm, setRegisterForm] = useState(emptyRegister);
  const [loginForm, setLoginForm] = useState(emptyLogin);
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }

    fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Session expired. Please log in again.");
        }
        return response.json();
      })
      .then((data) => setUser(data))
      .catch((fetchError) => {
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
        setError(fetchError.message);
      });
  }, [token]);

  async function handleSubmit(path, payload) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Request failed");
      }

      localStorage.setItem(TOKEN_KEY, data.access_token);
      setToken(data.access_token);
      setUser(data.user);
      setMessage(path.includes("register") ? "Account created successfully." : "Logged in successfully.");
      setRegisterForm(emptyRegister);
      setLoginForm(emptyLogin);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setMessage("You have been logged out.");
    setError("");
  }

  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">React + FastAPI + PostgreSQL</p>
        <h1>Simple auth starter</h1>
        <p className="subtitle">
          Minimal email/password auth connected to a Railway PostgreSQL database through environment variables.
        </p>

        {message ? <div className="notice success">{message}</div> : null}
        {error ? <div className="notice error">{error}</div> : null}

        {user ? (
          <div className="profile">
            <h2>Welcome, {user.full_name}</h2>
            <p>Email: {user.email}</p>
            <p>Your token is stored locally so the session stays active after refresh.</p>
            <button onClick={logout}>Logout</button>
          </div>
        ) : (
          <>
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
                className="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSubmit("/auth/login", loginForm);
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
                <button type="submit" disabled={loading}>
                  {loading ? "Signing in..." : "Login"}
                </button>
              </form>
            ) : (
              <form
                className="form"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSubmit("/auth/register", registerForm);
                }}
              >
                <label>
                  Full name
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
                <button type="submit" disabled={loading}>
                  {loading ? "Creating..." : "Create account"}
                </button>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}
