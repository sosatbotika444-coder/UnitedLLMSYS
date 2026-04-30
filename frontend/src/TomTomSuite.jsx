import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const categoryOrder = ["Maps", "Search", "Routing", "Traffic", "Operations", "Platform"];
const serviceStatusOptions = ["All", "Live", "Ready", "Requires Access"];

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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export default function TomTomSuite({ token }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");

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

  const categories = useMemo(() => {
    const catalogCategories = [...new Set((catalog?.capabilities || []).map((item) => item.category).filter(Boolean))];
    return [
      ...categoryOrder.filter((category) => catalogCategories.includes(category)),
      ...catalogCategories.filter((category) => !categoryOrder.includes(category)).sort()
    ];
  }, [catalog]);

  const filteredItems = useMemo(() => {
    const term = normalizeText(search);
    return (catalog?.capabilities || []).filter((item) => {
      const haystack = normalizeText(`${item.name} ${item.description} ${item.category} ${item.status}`);
      const matchesSearch = !term || haystack.includes(term);
      const matchesStatus = statusFilter === "All" || item.status === statusFilter;
      const matchesCategory = categoryFilter === "All" || item.category === categoryFilter;
      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [catalog, categoryFilter, search, statusFilter]);

  const grouped = useMemo(() => {
    const filteredCategories = [...new Set(filteredItems.map((item) => item.category).filter(Boolean))];
    const orderedCategories = [
      ...categoryOrder.filter((category) => filteredCategories.includes(category)),
      ...filteredCategories.filter((category) => !categoryOrder.includes(category)).sort()
    ];

    return orderedCategories
      .map((category) => ({
        category,
        items: filteredItems.filter((item) => item.category === category)
      }))
      .filter((group) => group.items.length);
  }, [filteredItems]);

  const visibleSummary = useMemo(() => ({
    total: filteredItems.length,
    live: filteredItems.filter((item) => item.status === "Live").length,
    ready: filteredItems.filter((item) => item.status === "Ready").length,
    requiresAccess: filteredItems.filter((item) => item.status === "Requires Access").length
  }), [filteredItems]);

  return (
    <section className="panel services-panel">
      <div className="panel-head services-head">
        <div>
          <h2>TomTom Services</h2>
          <span>Available map and routing tools.</span>
        </div>
      </div>

      {error ? <div className="notice error inline-notice">{error}</div> : null}

      {loading ? (
        <div className="empty-route-card">Loading services...</div>
      ) : (
        <>
          <div className="panel-filter-card">
            <div className="inline-filter-grid">
              <label>
                Search services
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Routing, traffic, maps, batch"
                />
              </label>
              <label>
                Status
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  {serviceStatusOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option value="All">All</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="panel-filter-summary">{visibleSummary.total} services match the current filters.</div>
          </div>

          <div className="services-summary-grid">
            <article className="service-summary-card live">
              <span>Visible Live</span>
              <strong>{visibleSummary.live}</strong>
            </article>
            <article className="service-summary-card ready">
              <span>Visible Ready</span>
              <strong>{visibleSummary.ready}</strong>
            </article>
            <article className="service-summary-card locked">
              <span>Visible Access</span>
              <strong>{visibleSummary.requiresAccess}</strong>
            </article>
            <article className="service-summary-card total">
              <span>Visible APIs</span>
              <strong>{visibleSummary.total}</strong>
            </article>
          </div>

          {grouped.length ? (
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
          ) : (
            <div className="empty-route-card">No TomTom services match the current filters.</div>
          )}
        </>
      )}
    </section>
  );
}
