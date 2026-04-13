import { useCallback, useEffect, useMemo, useState } from "react";
import SafetyServiceMapCanvas from "./SafetyServiceMapCanvas";

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

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function formatDistance(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)} mi`;
}

function detailHref(item) {
  if (item?.lat === null || item?.lat === undefined || item?.lon === null || item?.lon === undefined) return "#";
  return `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lon}`;
}

function metricTone(mode, id) {
  if (id === "total") return mode === "emergency" ? "critical" : "neutral";
  if (id === "official") return "info";
  if (id === "with_phone") return "warning";
  return mode === "emergency" ? "alert" : "dark";
}

function MetricCard({ label, value, detail, tone }) {
  return (
    <article className={`safety-stat-card safety-stat-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ServicePill({ children, tone = "default" }) {
  return <span className={`safety-chip safety-service-pill safety-service-pill-${tone}`}>{children}</span>;
}

export default function SafetyServiceTools({ token, mode = "service", active = false, fixedVehicleId = "", lockedVehicle = false }) {
  const isEmergency = mode === "emergency";
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [vehicleId, setVehicleId] = useState(() => fixedVehicleId ? String(fixedVehicleId) : "");
  const [radius, setRadius] = useState("80");
  const [categoryId, setCategoryId] = useState("all");
  const [scenarioId, setScenarioId] = useState("mechanical");
  const [selectedItemId, setSelectedItemId] = useState("");

  const loadData = useCallback(
    async (forceRefresh = false, overrides = {}) => {
      if (!token) {
        setData(null);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError("");

      const nextVehicleId = fixedVehicleId ? String(fixedVehicleId) : (overrides.vehicleId ?? vehicleId);
      const nextRadius = overrides.radius ?? radius;
      const nextCategoryId = overrides.categoryId ?? categoryId;
      const nextScenarioId = overrides.scenarioId ?? scenarioId;
      const params = new URLSearchParams({
        mode,
        radius_miles: String(nextRadius),
        refresh: forceRefresh ? "true" : "false"
      });
      if (nextVehicleId) {
        params.set("vehicle_id", String(nextVehicleId));
      }
      if (!isEmergency) {
        params.set("category_id", nextCategoryId);
      } else {
        params.set("scenario_id", nextScenarioId);
      }

      try {
        const nextData = await apiRequest(`/safety/services?${params.toString()}`, {}, token);
        setData(nextData);
      } catch (fetchError) {
        setError(fetchError.message);
      } finally {
        if (forceRefresh) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [categoryId, fixedVehicleId, isEmergency, mode, radius, scenarioId, token, vehicleId]
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    loadData(false);
  }, [active, loadData]);

  useEffect(() => {
    if (fixedVehicleId) {
      setVehicleId(String(fixedVehicleId));
      return;
    }
    if (!data?.selected_vehicle_id) {
      return;
    }
    if (!vehicleId) {
      setVehicleId(String(data.selected_vehicle_id));
    }
  }, [data?.selected_vehicle_id, fixedVehicleId, vehicleId]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    const items = data?.items || [];
    if (!term) {
      return items;
    }
    return items.filter((item) => {
      const haystack = [
        item.name,
        item.brand,
        item.address,
        item.location_type,
        item.phone,
        item.highway,
        item.exit_number,
        ...(item.services || []),
        ...(item.service_categories || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [data?.items, search]);

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedItemId("");
      return;
    }
    if (!filteredItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(filteredItems[0].id);
    }
  }, [filteredItems, selectedItemId]);

  const selectedItem = useMemo(
    () => filteredItems.find((item) => item.id === selectedItemId) || filteredItems[0] || null,
    [filteredItems, selectedItemId]
  );

  const metrics = data?.metrics || {};
  const selectedVehicle = data?.selected_vehicle || null;
  const categoryOptions = data?.filters?.categories || [];
  const scenarioOptions = data?.filters?.scenarios || [];
  const radiusOptions = data?.filters?.radius_options || [25, 50, 80, 120, 180];
  const categoryCounts = data?.category_counts || [];

  const pageTitle = isEmergency ? "Emergency" : "Service Map";
  const pageSubtitle = isEmergency
    ? "Live nearby support for breakdowns, towing, flats, parking, and low fuel."
    : "Truck stops and service locations around the selected unit.";

  return (
    <section className="workspace-content-stack safety-service-tools-stack">
      <section className="safety-fleet-metrics">
        <MetricCard label="Results" value={formatCount(metrics.total)} detail={isEmergency ? "Emergency options nearby" : "Nearby service stops"} tone={metricTone(mode, "total")} />
        <MetricCard label="Official" value={formatCount(metrics.official)} detail="Love's / Pilot catalog" tone={metricTone(mode, "official")} />
        <MetricCard label="With Phone" value={formatCount(metrics.with_phone)} detail="Direct contact available" tone={metricTone(mode, "with_phone")} />
        <MetricCard label="Ready" value={formatCount(metrics.emergency_ready)} detail={isEmergency ? "Best immediate options" : "Fast follow-up options"} tone={metricTone(mode, "ready")} />
      </section>

      <section className="panel safety-filter-panel">
        <div className="panel-head">
          <div>
            <h2>{pageTitle}</h2>
            <span>{pageSubtitle}</span>
          </div>
          <button className="primary-button" type="button" onClick={() => loadData(true)} disabled={loading || refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {error ? <div className="notice error inline-notice">{error}</div> : null}
        {data?.warnings?.length ? <div className="notice info inline-notice">{data.warnings[0]}</div> : null}

        <div className="safety-filter-grid safety-service-filter-grid">
          <label>
            Truck
            <select
              value={vehicleId}
              disabled={lockedVehicle}
              onChange={(event) => {
                const nextVehicleId = event.target.value;
                setVehicleId(nextVehicleId);
              }}
            >
              {(data?.vehicles || []).map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>{vehicle.label}</option>
              ))}
            </select>
          </label>

          <label>
            Radius
            <select
              value={radius}
              onChange={(event) => {
                const nextRadius = event.target.value;
                setRadius(nextRadius);
              }}
            >
              {radiusOptions.map((option) => (
                <option key={option} value={option}>{option} mi</option>
              ))}
            </select>
          </label>

          {!isEmergency ? (
            <label>
              Service Type
              <select
                value={categoryId}
                onChange={(event) => {
                  const nextCategoryId = event.target.value;
                  setCategoryId(nextCategoryId);
                }}
              >
                {categoryOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Scenario
              <select
                value={scenarioId}
                onChange={(event) => {
                  const nextScenarioId = event.target.value;
                  setScenarioId(nextScenarioId);
                }}
              >
                {scenarioOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          )}

          <label>
            Search
            <input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, service, address" />
          </label>
        </div>

        <div className="safety-filter-summary">
          <strong>{selectedVehicle?.label || "No truck selected"}</strong>
          <span>{selectedVehicle?.address || "Choose a live truck to center the map."}</span>
        </div>

        {!isEmergency && categoryCounts.length ? (
          <div className="safety-chip-row">
            {categoryCounts.map((item) => (
              <ServicePill key={item.id}>{item.label} {item.count}</ServicePill>
            ))}
          </div>
        ) : null}

        {data?.source_note ? <div className="safety-service-note">{data.source_note}</div> : null}
      </section>

      <div className="safety-service-layout">
        <section className="panel safety-service-map-panel">
          <div className="panel-head compact-panel-head">
            <div>
              <h2>{isEmergency ? "Nearby Response Map" : "Nearby Service Map"}</h2>
              <span>{filteredItems.length} visible point(s)</span>
            </div>
          </div>
          <SafetyServiceMapCanvas
            centerVehicle={selectedVehicle}
            items={filteredItems}
            selectedItemId={selectedItemId}
            onSelect={setSelectedItemId}
            active={active}
          />
        </section>

        <aside className="safety-service-sidebar">
          <section className="panel safety-service-detail-panel">
            {selectedItem ? (
              <>
                <div className="panel-head compact-panel-head">
                  <div>
                    <h2>{selectedItem.name}</h2>
                    <span>{selectedItem.brand}{selectedItem.location_type ? ` - ${selectedItem.location_type}` : ""}</span>
                  </div>
                  <ServicePill tone={selectedItem.kind === "poi" ? "poi" : selectedItem.emergency_ready ? "emergency" : "official"}>
                    {selectedItem.kind === "poi" ? "Live POI" : selectedItem.official_match ? "Official" : "Service"}
                  </ServicePill>
                </div>

                <div className="safety-detail-kicker">
                  <strong>{formatDistance(selectedItem.distance_miles)}</strong>
                  <p>{selectedItem.address}</p>
                </div>

                <div className="safety-detail-list">
                  <div><span>Phone</span><strong>{selectedItem.phone || "Not available"}</strong><small>{selectedItem.match_summary || "Nearby service"}</small></div>
                  <div><span>Highway</span><strong>{selectedItem.highway || "-"}</strong><small>{selectedItem.exit_number ? `Exit ${selectedItem.exit_number}` : "No exit detail"}</small></div>
                  <div><span>Type</span><strong>{selectedItem.location_type || "Service point"}</strong><small>{selectedItem.kind === "poi" ? "TomTom live search" : "Official station catalog"}</small></div>
                  <div><span>Ready</span><strong>{selectedItem.emergency_ready ? "Yes" : "Check before dispatch"}</strong><small>{selectedItem.official_match ? "Official record" : "Live POI"}</small></div>
                </div>

                {selectedItem.services?.length ? (
                  <section className="safety-detail-section">
                    <h3>Services</h3>
                    <div className="safety-chip-row">
                      {selectedItem.services.map((service) => (
                        <ServicePill key={`${selectedItem.id}-${service}`}>{service}</ServicePill>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="safety-detail-section">
                  <h3>Actions</h3>
                  <div className="safety-action-list">
                    <a className="secondary-button safety-link-button" href={detailHref(selectedItem)} target="_blank" rel="noreferrer">Open in Maps</a>
                    {selectedItem.phone ? <a className="secondary-button safety-link-button" href={`tel:${selectedItem.phone}`}>Call</a> : null}
                    {selectedItem.source_url ? <a className="secondary-button safety-link-button" href={selectedItem.source_url} target="_blank" rel="noreferrer">Open Source</a> : null}
                  </div>
                </section>
              </>
            ) : (
              <div className="safety-empty-state">No service point selected.</div>
            )}
          </section>

          <section className="panel safety-service-list-panel">
            <div className="panel-head compact-panel-head">
              <div>
                <h2>{isEmergency ? "Emergency Options" : "Nearby Locations"}</h2>
                <span>{filteredItems.length} match the current filters</span>
              </div>
            </div>
            <div className="safety-service-result-list">
              {loading && !data ? (
                <div className="safety-empty-state">Loading service data...</div>
              ) : filteredItems.length ? (
                filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`safety-service-result-card ${selectedItem?.id === item.id ? "active" : ""}`}
                    onClick={() => setSelectedItemId(item.id)}
                  >
                    <div className="safety-vehicle-head compact">
                      <div>
                        <strong>{item.name}</strong>
                        <span>{item.brand}{item.location_type ? ` - ${item.location_type}` : ""}</span>
                      </div>
                      <strong>{formatDistance(item.distance_miles)}</strong>
                    </div>
                    <p>{item.address}</p>
                    <div className="safety-chip-row">
                      {(item.services || []).slice(0, 3).map((service) => (
                        <ServicePill key={`${item.id}-${service}`}>{service}</ServicePill>
                      ))}
                    </div>
                    <small>{item.phone || item.match_summary}</small>
                  </button>
                ))
              ) : (
                <div className="safety-empty-state">No service locations found for the current filters.</div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}







