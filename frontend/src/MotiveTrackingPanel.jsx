import { useCallback, useEffect, useMemo, useState } from "react";
import MotiveFleetMap from "./MotiveFleetMap";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const filterOptions = ["All", "Moving", "Stopped", "Stale", "Low Fuel", "Faults"];

async function apiRequest(path, options = {}, token = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

function fileNameFromDisposition(headerValue) {
  if (!headerValue) return "motive_tracking_export.xlsx";
  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const basicMatch = headerValue.match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1] || "motive_tracking_export.xlsx";
}

async function downloadFile(path, token = "") {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, { headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Download failed");
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileNameFromDisposition(response.headers.get("Content-Disposition"));
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 0);
}

function metricValue(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function decimalValue(value) {
  return value === null || value === undefined ? "-" : Number(value).toFixed(1);
}
function formatDurationSeconds(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "Unknown";
  const totalMinutes = Math.max(0, Math.floor(Number(value) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function isMissingHosClock(eld) {
  return eld?.status === "no_hos_clock" || eld?.source === "eld_device_only";
}

function formatHosClock(eld, key) {
  const value = eld?.available_time?.[key];
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return isMissingHosClock(eld) ? "No HOS" : "Unknown";
  }
  return formatDurationSeconds(value);
}

function eldTone(vehicle) {
  const status = vehicle?.eld_hours?.status;
  if (status === "violation") return "stale";
  if (status === "warning" || status === "no_hos_clock" || vehicle?.eld_hours?.source === "eld_device_only") return "warning";
  if (status === "ok") return "stopped";
  return "stale";
}

function eldStatusLabel(eld) {
  if (isMissingHosClock(eld)) return "No HOS clock";
  return eld?.status || "n/a";
}

function formatTimestamp(value) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatCoordinates(location) {
  if (!location || location.lat === null || location.lon === null || location.lat === undefined || location.lon === undefined) {
    return "No coordinates";
  }
  return `${Number(location.lat).toFixed(4)}, ${Number(location.lon).toFixed(4)}`;
}

function hasCoordinates(vehicle) {
  return (
    vehicle?.location &&
    vehicle.location.lat !== null &&
    vehicle.location.lat !== undefined &&
    vehicle.location.lon !== null &&
    vehicle.location.lon !== undefined
  );
}

function vehicleLocationTitle(vehicle) {
  if (!vehicle?.location) return "Location unavailable";
  return vehicle.location.address || [vehicle.location.city, vehicle.location.state].filter(Boolean).join(", ") || "Location unavailable";
}

function vehicleTone(vehicle) {
  if (vehicle.is_stale) return "stale";
  if (vehicle.is_moving) return "moving";
  return "stopped";
}

function defaultVehicleId(vehicles) {
  const located = vehicles.find((vehicle) => vehicle.location?.lat !== null && vehicle.location?.lat !== undefined);
  return located?.id ?? vehicles[0]?.id ?? null;
}

function DetailCard({ label, value, detail }) {
  return (
    <article className="motive-detail-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function PreviewBlock({ title, items, emptyText, renderItem }) {
  return (
    <section className="motive-preview-block">
      <div className="motive-subhead compact">
        <div>
          <h3>{title}</h3>
          <span>{items.length ? `${items.length} recent records` : emptyText}</span>
        </div>
      </div>
      {items.length ? <div className="motive-preview-list">{items.map(renderItem)}</div> : <div className="empty-route-card compact">{emptyText}</div>}
    </section>
  );
}

export default function MotiveTrackingPanel({ token, active = true }) {
  const [integration, setIntegration] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [mapView, setMapView] = useState("fleet");

  useEffect(() => {
    setIntegration(null);
    setSnapshot(null);
    setDetail(null);
    setLoading(Boolean(token));
    setRefreshing(false);
    setDetailLoading(false);
    setError("");
    setDetailError("");
    setSelectedVehicleId(null);
    setMapView("fleet");
  }, [token]);

  const loadSnapshot = useCallback(
    async (forceRefresh = false, quiet = false) => {
      if (!token) return;
      if (forceRefresh) {
        setRefreshing(true);
      } else if (!quiet) {
        setLoading(true);
      }
      setError("");
      try {
        const data = await apiRequest(`/motive/fleet${forceRefresh ? "?refresh=true" : ""}`, {}, token);
        setSnapshot(data);
        setDetail((current) => {
          if (!current?.vehicle?.id) {
            return current;
          }
          return data.vehicles.some((vehicle) => String(vehicle.id) === String(current.vehicle.id)) ? current : null;
        });
        setSelectedVehicleId((current) => {
          if (current && data.vehicles.some((vehicle) => vehicle.id === current)) {
            return current;
          }
          return defaultVehicleId(data.vehicles || []);
        });
      } catch (fetchError) {
        setError(fetchError.message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token]
  );


  const exportSnapshot = useCallback(async () => {
    if (!token || !integration?.configured) return;
    setExporting(true);
    setError("");
    try {
      await downloadFile("/motive/export", token);
    } catch (downloadError) {
      setError(downloadError.message);
    } finally {
      setExporting(false);
    }
  }, [integration?.configured, token]);

  useEffect(() => {
    if (!token || !active || integration !== null) {
      return undefined;
    }

    let ignore = false;
    async function bootstrap() {
      try {
        const status = await apiRequest("/motive/status", {}, token);
        if (ignore) return;
        setIntegration(status);
        if (status.configured) {
          if (!snapshot) {
            await loadSnapshot(false);
          } else {
            setLoading(false);
          }
        } else {
          setSnapshot(null);
          setLoading(false);
        }
      } catch (fetchError) {
        if (!ignore) {
          setError(fetchError.message);
          setLoading(false);
        }
      }
    }

    bootstrap();
    return () => {
      ignore = true;
    };
  }, [active, integration, loadSnapshot, snapshot, token]);

  useEffect(() => {
    if (!token || !integration?.configured || !autoRefresh || !active) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      loadSnapshot(true);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [active, autoRefresh, integration?.configured, loadSnapshot, token]);

  useEffect(() => {
    if (!token || !integration?.configured || !active || !snapshot?.cache?.refreshing) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      loadSnapshot(false, true);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [active, integration?.configured, loadSnapshot, snapshot?.cache?.refreshing, snapshot?.cache?.served_at, token]);

  const filteredVehicles = useMemo(() => {
    const vehicles = snapshot?.vehicles || [];
    const term = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      const locationText = [vehicle.location?.city, vehicle.location?.state, vehicle.location?.address].filter(Boolean).join(" ").toLowerCase();
      const haystack = [vehicle.number, vehicle.make, vehicle.model, vehicle.vin, vehicle.license_plate_number, locationText].filter(Boolean).join(" ").toLowerCase();
      const matchesSearch = !term || haystack.includes(term);
      const fuelPercent = vehicle.location?.fuel_level_percent ?? 100;
      const matchesFilter =
        filter === "All" ||
        (filter === "Moving" && vehicle.is_moving) ||
        (filter === "Stopped" && !vehicle.is_moving && !vehicle.is_stale) ||
        (filter === "Stale" && vehicle.is_stale) ||
        (filter === "Low Fuel" && fuelPercent <= 25) ||
        (filter === "Faults" && (vehicle.fault_summary?.active_count || 0) > 0);
      return matchesSearch && matchesFilter;
    });
  }, [filter, search, snapshot]);

  const selectedVehicle = useMemo(() => {
    if (!snapshot?.vehicles?.length) return null;
    return snapshot.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) || filteredVehicles[0] || snapshot.vehicles[0] || null;
  }, [filteredVehicles, selectedVehicleId, snapshot]);

  useEffect(() => {
    if (selectedVehicle?.id !== selectedVehicleId) {
      setSelectedVehicleId(selectedVehicle?.id ?? null);
    }
  }, [selectedVehicle, selectedVehicleId]);

  const handleVehicleSelect = useCallback((vehicleId) => {
    setSelectedVehicleId(vehicleId);
    setMapView("street");
  }, []);

  useEffect(() => {
    if (!token || !selectedVehicleId || !integration?.configured) {
      return undefined;
    }

    if (detail?.vehicle?.id && String(detail.vehicle.id) === String(selectedVehicleId)) {
      return undefined;
    }

    let ignore = false;
    async function loadDetail() {
      setDetailLoading(true);
      setDetailError("");
      try {
        const data = await apiRequest(`/motive/vehicles/${selectedVehicleId}`, {}, token);
        if (!ignore) {
          setDetail(data);
        }
      } catch (fetchError) {
        if (!ignore) {
          setDetailError(fetchError.message);
        }
      } finally {
        if (!ignore) {
          setDetailLoading(false);
        }
      }
    }

    loadDetail();
    return () => {
      ignore = true;
    };
  }, [detail?.vehicle?.id, integration?.configured, selectedVehicleId, token]);

  if (!token) {
    return <section className="panel motive-panel"><div className="empty-route-card">Sign in to view Motive fleet tracking.</div></section>;
  }

  const historyPoints = detail?.history?.points || [];
  const currentVehicle = selectedVehicle || detail?.vehicle || null;
  const currentEldHours = currentVehicle?.eld_hours || {};
  const canFocusStreet = hasCoordinates(currentVehicle);
  const selectedLocationLabel = vehicleLocationTitle(currentVehicle);
  const snapshotWarning = snapshot?.warnings?.[0] || "";
  const cacheStatusText = snapshot?.cache?.refreshing
    ? "Fresh Motive data is loading in the background."
    : snapshot?.cache?.status === "stale"
      ? "Showing cached Motive data."
      : snapshot?.cache?.status === "warming"
        ? "Fresh Motive data is loading."
        : "";

  return (
    <section className="panel motive-panel">
      <div className="panel-head motive-panel-head">
        <div>
          <h2>Motive Fleet Tracking</h2>
          <span>
            {integration?.configured
              ? `Live vehicle intelligence${snapshot?.company?.name ? ` for ${snapshot.company.name}` : ""}.`
              : "Backend connection is ready for a Motive key."}
          </span>
        </div>
        <div className="motive-panel-actions">
          <button type="button" className="secondary-button" onClick={() => setAutoRefresh((current) => !current)}>
            {autoRefresh ? "Auto refresh on" : "Auto refresh off"}
          </button>
          <button type="button" className="secondary-button" onClick={exportSnapshot} disabled={!integration?.configured || loading || exporting}>
            {exporting ? "Exporting..." : "Export Excel"}
          </button>
          <button type="button" className="primary-button" onClick={() => loadSnapshot(true)} disabled={!integration?.configured || refreshing}>
            {refreshing ? "Refreshing..." : "Refresh now"}
          </button>
        </div>
      </div>

      {error ? <div className="notice error inline-notice">{error}</div> : null}
      {detailError ? <div className="notice error inline-notice">{detailError}</div> : null}
      {snapshotWarning ? <div className="notice info inline-notice">{snapshotWarning}</div> : null}

      {!integration?.configured && !loading ? (
        <div className="motive-setup-card">
          <strong>Motive key is not configured on the backend.</strong>
          <p>Add `MOTIVE_API_KEY` or OAuth credentials in the backend env to unlock full fleet tracking.</p>
        </div>
      ) : null}

      {loading ? (
        <div className="empty-route-card">Loading fleet snapshot...</div>
      ) : integration?.configured && snapshot ? (
        <>
          <div className="motive-summary-grid motive-summary-grid-wide">
            <article className="motive-summary-card total"><span>Total vehicles</span><strong>{metricValue(snapshot.metrics.total_vehicles)}</strong><small>{metricValue(snapshot.metrics.located_vehicles)} with GPS</small></article>
            <article className="motive-summary-card moving"><span>Moving now</span><strong>{metricValue(snapshot.metrics.moving_vehicles)}</strong><small>{metricValue(snapshot.metrics.stopped_vehicles)} stopped</small></article>
            <article className="motive-summary-card live"><span>Low fuel</span><strong>{metricValue(snapshot.metrics.low_fuel_vehicles)}</strong><small>25% or lower</small></article>
            <article className="motive-summary-card drivers"><span>Fault codes</span><strong>{metricValue(snapshot.metrics.active_fault_codes)}</strong><small>{metricValue(snapshot.metrics.vehicles_with_faults)} units affected</small></article>
            <article className="motive-summary-card total"><span>Safety events</span><strong>{metricValue(snapshot.metrics.performance_events_7d)}</strong><small>{metricValue(snapshot.metrics.pending_review_events)} pending review</small></article>
            <article className="motive-summary-card moving"><span>Idle hours</span><strong>{decimalValue(snapshot.metrics.idle_hours_7d)}</strong><small>Last 7 days</small></article>
            <article className="motive-summary-card live"><span>Drive miles</span><strong>{metricValue(snapshot.metrics.driving_miles_7d)}</strong><small>Last 7 days</small></article>
            <article className="motive-summary-card drivers"><span>IFTA miles</span><strong>{metricValue(snapshot.metrics.ifta_miles_30d)}</strong><small>Last 30 days</small></article>
            <article className="motive-summary-card moving"><span>HOS clocks</span><strong>{metricValue(snapshot.metrics.hos_driver_clocks)}</strong><small>Drivers with live HOS</small></article>
            <article className="motive-summary-card drivers"><span>HOS warnings</span><strong>{metricValue(snapshot.metrics.hos_warning_units)}</strong><small>Warnings or violations</small></article>
          </div>

          <div className="motive-layout-grid">
            <section className="motive-map-panel">
              <div className="motive-subhead">
                <div>
                  <h3>Fleet map</h3>
                  <span>
                    {snapshot.metrics.located_vehicles} vehicles with coordinates. Updated {formatTimestamp(snapshot.fetched_at)}.
                    {cacheStatusText ? ` ${cacheStatusText}` : ""}
                    {mapView === "street" ? " Street focus keeps the selected truck at road level so street names stay readable." : " Select a truck to jump into street focus."}
                  </span>
                </div>
                <small>{snapshot.auth_mode === "x-api-key" ? "x-api-key" : "oauth"}</small>
              </div>
              <div className="workspace-inline-tabs motive-map-tabs">
                <button type="button" className={`workspace-inline-tab ${mapView === "fleet" ? "active" : ""}`.trim()} onClick={() => setMapView("fleet")}>
                  Fleet overview
                </button>
                <button
                  type="button"
                  className={`workspace-inline-tab ${mapView === "street" ? "active" : ""}`.trim()}
                  onClick={() => setMapView("street")}
                  disabled={!canFocusStreet}
                >
                  Street focus
                </button>
              </div>
              <div className="motive-map-location-card">
                <strong>{currentVehicle?.number || "No truck selected"}</strong>
                <span>{selectedLocationLabel}</span>
                <small>{canFocusStreet ? formatCoordinates(currentVehicle.location) : "Select a vehicle with live GPS coordinates to zoom in to street level."}</small>
              </div>
              <MotiveFleetMap
                active={active}
                vehicles={filteredVehicles}
                selectedVehicleId={currentVehicle?.id ?? null}
                onSelect={handleVehicleSelect}
                viewMode={mapView}
              />
            </section>

            <aside className="motive-detail-panel">
              <div className="motive-subhead">
                <div>
                  <h3>{currentVehicle?.number || "No vehicle selected"}</h3>
                  <span>{currentVehicle?.vin || "Select a vehicle to inspect VIN, fuel, faults, and history."}</span>
                </div>
                {currentVehicle ? <span className={`motive-status-pill ${vehicleTone(currentVehicle)}`}>{vehicleTone(currentVehicle)}</span> : null}
                {currentVehicle ? <span className={`motive-status-pill ${eldTone(currentVehicle)}`}>HOS {eldStatusLabel(currentEldHours)}</span> : null}
              </div>

              {currentVehicle ? (
                <>
                  <div className="motive-detail-card-grid">
                    <DetailCard label="Fuel" value={currentVehicle.location?.fuel_level_percent !== null && currentVehicle.location?.fuel_level_percent !== undefined ? `${decimalValue(currentVehicle.location.fuel_level_percent)}%` : "Unknown"} detail={currentVehicle.fuel_type || "Fuel type unknown"} />
                    <DetailCard label="Odometer" value={currentVehicle.location?.true_odometer ? `${metricValue(currentVehicle.location.true_odometer)} mi` : currentVehicle.location?.odometer ? `${metricValue(currentVehicle.location.odometer)} mi` : "Unknown"} detail="Latest telematics reading" />
                    <DetailCard label="Engine Hours" value={currentVehicle.location?.true_engine_hours ? decimalValue(currentVehicle.location.true_engine_hours) : currentVehicle.location?.engine_hours ? decimalValue(currentVehicle.location.engine_hours) : "Unknown"} detail="Engine runtime" />
                    <DetailCard label="Faults" value={metricValue(currentVehicle.fault_summary?.active_count)} detail={`${metricValue(currentVehicle.fault_summary?.count)} total recent`} />
                    <DetailCard label="Utilization" value={currentVehicle.utilization_summary?.utilization_percentage !== null && currentVehicle.utilization_summary?.utilization_percentage !== undefined ? `${decimalValue(currentVehicle.utilization_summary.utilization_percentage)}%` : "Unknown"} detail="7-day utilization" />
                    <DetailCard label="Idle Time" value={`${decimalValue((currentVehicle.idle_summary?.duration_seconds || 0) / 3600)} h`} detail={`${metricValue(currentVehicle.idle_summary?.count)} idle events`} />
                    <DetailCard label="Drive Time" value={`${decimalValue((currentVehicle.driving_summary?.duration_seconds || 0) / 3600)} h`} detail={`${metricValue(currentVehicle.driving_summary?.distance_miles)} miles`} />
                    <DetailCard label="IFTA" value={`${metricValue(currentVehicle.ifta_summary?.distance_miles)} mi`} detail={`${metricValue(currentVehicle.ifta_summary?.count)} trips`} />
                    <DetailCard label="Drive Left" value={formatHosClock(currentEldHours, "drive_seconds")} detail={currentEldHours.duty_status || currentEldHours.missing_reason || "HOS drive clock"} />
                    <DetailCard label="Shift Left" value={formatHosClock(currentEldHours, "shift_seconds")} detail={currentEldHours.missing_reason || "HOS shift clock"} />
                    <DetailCard label="Cycle Left" value={formatHosClock(currentEldHours, "cycle_seconds")} detail={eldStatusLabel(currentEldHours)} />
                  </div>

                  <div className="motive-detail-list">
                    <div><span>Driver</span><strong>{currentVehicle.driver?.full_name || currentVehicle.permanent_driver?.full_name || "Unassigned"}</strong><small>{currentVehicle.driver?.email || currentVehicle.driver?.phone || currentVehicle.permanent_driver?.email || "No driver contact"}</small></div>
                    <div><span>Vehicle</span><strong>{[currentVehicle.year, currentVehicle.make, currentVehicle.model].filter(Boolean).join(" ") || "Unknown unit"}</strong><small>{currentVehicle.license_plate_number ? `${currentVehicle.license_plate_state || ""} ${currentVehicle.license_plate_number}`.trim() : "No plate"}</small></div>
                    <div><span>ELD / HOS</span><strong>{currentVehicle.eld_device?.identifier || currentEldHours.source || "Unavailable"}</strong><small>{currentEldHours.summary || currentVehicle.eld_device?.model || "No gateway model"}</small></div>
                    <div><span>Location</span><strong>{currentVehicle.location?.address || [currentVehicle.location?.city, currentVehicle.location?.state].filter(Boolean).join(", ") || "Unknown"}</strong><small>{formatCoordinates(currentVehicle.location)}</small></div>
                    <div><span>Last update</span><strong>{formatTimestamp(currentVehicle.location?.located_at)}</strong><small>{currentVehicle.location?.age_minutes !== null && currentVehicle.location?.age_minutes !== undefined ? `${currentVehicle.location.age_minutes} minutes ago` : "Age unavailable"}</small></div>
                    <div><span>Registration</span><strong>{currentVehicle.registration_expiry_date || "No expiry date"}</strong><small>{currentVehicle.status || currentVehicle.availability_status || "Status unavailable"}</small></div>
                  </div>
                </>
              ) : (
                <div className="empty-route-card">No vehicles match the current filters.</div>
              )}
            </aside>
          </div>

          <div className="motive-preview-grid">
            <PreviewBlock title="Fault Codes" items={currentVehicle?.previews?.fault_codes || []} emptyText="No recent fault records." renderItem={(item) => <div key={`fault-${item.id}`}><strong>{item.code || item.label || "Fault"}</strong><small>{item.description || item.status || "No description"}</small></div>} />
            <PreviewBlock title="Safety Events" items={currentVehicle?.previews?.performance_events || []} emptyText="No recent coaching events." renderItem={(item) => <div key={`event-${item.id}`}><strong>{item.type || "Event"}</strong><small>{item.location || item.coaching_status || formatTimestamp(item.end_time)}</small></div>} />
            <PreviewBlock title="Driving Periods" items={currentVehicle?.previews?.driving_periods || []} emptyText="No recent drive periods." renderItem={(item) => <div key={`drive-${item.id}`}><strong>{item.origin || "Trip"}</strong><small>{item.destination || `${metricValue(item.distance_miles)} miles`}</small></div>} />
            <PreviewBlock title="IFTA Trips" items={currentVehicle?.previews?.ifta_trips || []} emptyText="No recent IFTA trips." renderItem={(item) => <div key={`ifta-${item.id}`}><strong>{item.jurisdiction || "Trip"}</strong><small>{metricValue(item.distance_miles)} miles on {item.date || "unknown date"}</small></div>} />
            <PreviewBlock title="HOS Logs" items={currentVehicle?.previews?.hos_logs || []} emptyText="No recent HOS logs." renderItem={(item) => <div key={`hos-${item.id || item.date}`}><strong>{item.date || "HOS log"}</strong><small>{item.is_signed ? "Signed" : "Unsigned"} | {metricValue(item.violation_count)} violation(s)</small></div>} />
          </div>

          <section className="motive-history-panel">
            <div className="motive-subhead">
              <div>
                <h3>Location History</h3>
                <span>{detailLoading ? "Loading route breadcrumbs..." : `${historyPoints.length} recent breadcrumbs loaded`}</span>
              </div>
            </div>
            {historyPoints.length ? (
              <div className="motive-history-list">
                {historyPoints.slice(0, 10).map((point, index) => (
                  <div key={`${point.located_at}-${index}`} className="motive-history-row">
                    <strong>{formatTimestamp(point.located_at)}</strong>
                    <span>{point.address || point.description || "Unknown area"}</span>
                    <small>{point.speed_mph !== null && point.speed_mph !== undefined ? `${decimalValue(point.speed_mph)} mph` : point.event_type || "No speed"}</small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-route-card compact">No recent history returned for this vehicle.</div>
            )}
          </section>

          <section className="motive-list-panel">
            <div className="motive-list-toolbar">
              <label className="workspace-table-search motive-search-box">
                <span>Search fleet</span>
                <input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Truck, VIN, plate, city" />
              </label>
              <div className="motive-filter-tabs">
                {filterOptions.map((option) => (
                  <button key={option} type="button" className={`workspace-inline-tab ${filter === option ? "active" : ""}`} onClick={() => setFilter(option)}>
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="motive-vehicle-list">
              <div className="motive-vehicle-list-head motive-vehicle-list-head-wide">
                <span>Vehicle</span>
                <span>Fuel</span>
                <span>Faults</span>
                <span>Utilization</span>
                <span>Drive / HOS</span>
                <span>Updated</span>
              </div>
              {filteredVehicles.length ? (
                filteredVehicles.map((vehicle) => (
                  <button key={`${vehicle.id}-${vehicle.number}`} type="button" className={`motive-vehicle-row motive-vehicle-row-wide ${currentVehicle?.id === vehicle.id ? "selected" : ""}`} onClick={() => handleVehicleSelect(vehicle.id)}>
                    <span><strong>{vehicle.number}</strong><small>{vehicle.vin || [vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle"}</small></span>
                    <span><strong>{vehicle.location?.fuel_level_percent !== null && vehicle.location?.fuel_level_percent !== undefined ? `${decimalValue(vehicle.location.fuel_level_percent)}%` : "-"}</strong><small>{vehicle.fuel_type || "Fuel n/a"}</small></span>
                    <span><strong>{metricValue(vehicle.fault_summary?.active_count)}</strong><small>{metricValue(vehicle.fault_summary?.count)} total</small></span>
                    <span><strong>{vehicle.utilization_summary?.utilization_percentage !== null && vehicle.utilization_summary?.utilization_percentage !== undefined ? `${decimalValue(vehicle.utilization_summary.utilization_percentage)}%` : "-"}</strong><small>{decimalValue((vehicle.idle_summary?.duration_seconds || 0) / 3600)} idle h</small></span>
                    <span><strong>{metricValue(vehicle.driving_summary?.distance_miles)} mi</strong><small>{formatHosClock(vehicle.eld_hours, "drive_seconds")} drive left</small></span>
                    <span><strong>{formatTimestamp(vehicle.location?.located_at)}</strong><small>{vehicle.is_stale ? "stale" : vehicle.is_moving ? "moving" : "stopped"}</small></span>
                  </button>
                ))
              ) : (
                <div className="empty-route-card">No vehicles match your search or filters.</div>
              )}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}

