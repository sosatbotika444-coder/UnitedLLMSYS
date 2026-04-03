import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";
const categoryOrder = ["Maps", "Search", "Routing", "Traffic", "Operations", "Platform"];

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

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

function getStatusClass(status) {
  if (status === "Live") return "service-status-live";
  if (status === "Ready") return "service-status-ready";
  return "service-status-locked";
}

export default function TomTomSuite({ token }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setCatalog(null);
      setLoading(false);
      return;
    }

    let ignore = false;

    async function loadCatalog() {
      setLoading(true);
      setError("");
      try {
        const data = await apiRequest("/navigation/tomtom-capabilities", {}, token);
        if (!ignore) {
          setCatalog(data);
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

    loadCatalog();

    return () => {
      ignore = true;
    };
  }, [token]);

  const grouped = useMemo(() => {
    const items = catalog?.capabilities || [];
    return categoryOrder
      .map((category) => ({
        category,
        items: items.filter((item) => item.category === category)
      }))
      .filter((group) => group.items.length);
  }, [catalog]);

  return (
    <section className="panel services-panel">
      <div className="panel-head services-head">
        <div>
          <h2>TomTom Services</h2>
          <span>Full API suite catalog attached to the operations workspace.</span>
        </div>
      </div>

      {error ? <div className="notice error inline-notice">{error}</div> : null}

      {loading ? (
        <div className="empty-route-card">Loading TomTom service catalog...</div>
      ) : (
        <>
          <div className="services-summary-grid">
            <article className="service-summary-card live">
              <span>Live Now</span>
              <strong>{catalog?.live || 0}</strong>
            </article>
            <article className="service-summary-card ready">
              <span>Ready Next</span>
              <strong>{catalog?.ready || 0}</strong>
            </article>
            <article className="service-summary-card locked">
              <span>Requires Access</span>
              <strong>{catalog?.requires_access || 0}</strong>
            </article>
            <article className="service-summary-card total">
              <span>Total APIs</span>
              <strong>{catalog?.total || 0}</strong>
            </article>
          </div>

          <div className="service-groups">
            {grouped.map((group) => (
              <section key={group.category} className="service-group">
                <div className="service-group-head">
                  <h3>{group.category}</h3>
                  <span>{group.items.length} services</span>
                </div>
                <div className="service-card-grid">
                  {group.items.map((item) => (
                    <article key={item.id} className="service-card">
                      <div className="service-card-top">
                        <strong>{item.name}</strong>
                        <span className={`service-status ${getStatusClass(item.status)}`}>{item.status}</span>
                      </div>
                      <p>{item.description}</p>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </section>
  );
}