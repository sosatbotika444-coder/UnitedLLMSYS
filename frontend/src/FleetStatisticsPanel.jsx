import { useEffect, useMemo, useState } from "react";
import { buildVehicleLocationLabel } from "./locationFormatting";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const quickFocusOptions = [
  { id: "all", label: "All Trucks" },
  { id: "moving", label: "Moving Now" },
  { id: "milesToday", label: "Top Today Miles" },
  { id: "lowFuel", label: "Low Fuel" },
  { id: "faults", label: "Faults" },
  { id: "stale", label: "Stale" },
  { id: "withLoad", label: "With Load" },
];

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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function metricValue(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function decimalValue(value, digits = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : "-";
}

function compactDate(value) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function shortDate(value) {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function formatMiles(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${metricValue(parsed)} mi` : "-";
}

function formatSpeed(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${decimalValue(parsed)} mph` : "-";
}

function formatPercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${decimalValue(parsed)}%` : "-";
}

function formatHours(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${decimalValue(parsed)} h` : "-";
}

function formatDurationSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "Unknown";
  const totalMinutes = Math.max(0, Math.floor(parsed / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatKeyLabel(value) {
  if (!value) return "Unknown";
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function boundedPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function vehicleDriver(vehicle) {
  return vehicle?.resolved_driver || vehicle?.driver || vehicle?.permanent_driver || null;
}

function vehicleDriverName(vehicle) {
  return vehicleDriver(vehicle)?.full_name || "Unassigned";
}

function vehicleLabel(vehicle) {
  return vehicle?.number || vehicle?.vin || `Vehicle ${vehicle?.id ?? ""}`.trim();
}

function vehicleLocationLabel(vehicle) {
  return buildVehicleLocationLabel(vehicle);
}

function vehicleFuelPercent(vehicle) {
  const location = vehicle?.location || {};
  return boundedPercent(
    location.fuel_level_percent
    ?? location.fuel_primary_remaining_percentage
    ?? location.fuel_remaining_percentage
    ?? location.fuel_percentage
    ?? null
  );
}

function findMatchingLoadRow(vehicle, loadRows) {
  if (!vehicle || !Array.isArray(loadRows)) return null;
  const vehicleText = normalizeText(vehicleLabel(vehicle));
  const driverText = normalizeText(vehicleDriverName(vehicle));

  return loadRows.find((row) => {
    const rowTruck = normalizeText(row?.truck);
    const rowDriver = normalizeText(row?.driver);
    return (rowTruck && (rowTruck === vehicleText || rowTruck.includes(vehicleText) || vehicleText.includes(rowTruck)))
      || (rowDriver && (rowDriver === driverText || rowDriver.includes(driverText) || driverText.includes(rowDriver)));
  }) || null;
}

function resolveVehicleMpgInfo(vehicle, matchedLoad) {
  const directMpg = positiveNumber(vehicle?.mpg);
  if (directMpg !== null) {
    return {
      value: directMpg,
      source: vehicle?.mpg_source || "Motive truck MPG",
    };
  }

  const totalDistanceMiles = positiveNumber(vehicle?.utilization_summary?.total_distance_miles);
  const totalFuelGallons = positiveNumber(vehicle?.utilization_summary?.total_fuel);
  if (totalDistanceMiles !== null && totalFuelGallons !== null) {
    return {
      value: totalDistanceMiles / totalFuelGallons,
      source: "Motive 7-day total distance vs total fuel",
    };
  }

  const drivingDistanceMiles = positiveNumber(vehicle?.driving_summary?.distance_miles);
  const drivingFuelGallons = positiveNumber(vehicle?.utilization_summary?.driving_fuel);
  if (drivingDistanceMiles !== null && drivingFuelGallons !== null) {
    return {
      value: drivingDistanceMiles / drivingFuelGallons,
      source: "Motive 7-day driving distance vs driving fuel",
    };
  }

  const loadMpg = positiveNumber(matchedLoad?.mpg);
  if (loadMpg !== null) {
    return {
      value: loadMpg,
      source: "Matched from Loads board",
    };
  }

  return {
    value: null,
    source: "",
  };
}

function numericBetween(value, minValue, maxValue) {
  if (minValue === null && maxValue === null) return true;
  if (!Number.isFinite(value)) return false;
  if (minValue !== null && value < minValue) return false;
  if (maxValue !== null && value > maxValue) return false;
  return true;
}

function fuelFilterTone(value) {
  if (!Number.isFinite(value)) return "neutral";
  if (value <= 25) return "danger";
  if (value <= 40) return "watch";
  if (value >= 75) return "strong";
  return "good";
}

function fleetStatusLabel(row) {
  if (row.isStale) return "Stale";
  if (row.isMoving) return "Moving";
  return "Stopped";
}

function statusTone(row) {
  if (row.isStale) return "stale";
  if (row.activeFaults > 0) return "warning";
  if (row.isMoving) return "moving";
  return "steady";
}

function healthScore(row) {
  let score = 100;
  if (row.isStale) score -= 22;
  if (row.fuelPercent !== null && row.fuelPercent <= 25) score -= 18;
  else if (row.fuelPercent !== null && row.fuelPercent <= 40) score -= 10;
  score -= Math.min(row.activeFaults * 7, 28);
  if (row.ageMinutes !== null && row.ageMinutes > 30) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function trendPeak(points) {
  const peak = Math.max(...points.map((point) => Number(point?.miles) || 0), 1);
  return peak || 1;
}

function performanceEventKey(event) {
  if (!event) return "";
  return String(event.id ?? `${event.vehicle_id || "vehicle"}-${event.start_time || event.end_time || "time"}-${event.type || "event"}`);
}

function performanceEventVideoSources(event) {
  return event?.camera_media?.video_sources || [];
}

function performanceEventImageSources(event) {
  return event?.camera_media?.image_sources || [];
}

function performanceEventBehaviors(event) {
  return [
    ...(event?.primary_behaviors || []),
    ...(event?.secondary_behaviors || []),
    ...(event?.coachable_behaviors || []),
    ...(event?.coached_behaviors || []),
    ...(event?.annotation_tags || []),
  ].filter((value, index, list) => value && list.indexOf(value) === index);
}

function defaultPerformanceVideoKey(event) {
  return performanceEventVideoSources(event)[0]?.key || "";
}

function defaultVehicleId(rows) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((left, right) => {
    if ((right.todayMiles || 0) !== (left.todayMiles || 0)) return (right.todayMiles || 0) - (left.todayMiles || 0);
    if ((right.currentSpeedMph || 0) !== (left.currentSpeedMph || 0)) return (right.currentSpeedMph || 0) - (left.currentSpeedMph || 0);
    return (right.weekMiles || 0) - (left.weekMiles || 0);
  });
  return sorted[0]?.id ?? rows[0]?.id ?? null;
}

function sortRows(rows, sortBy) {
  const sorted = [...rows];
  sorted.sort((left, right) => {
    if (sortBy === "today_miles") return (right.todayMiles || 0) - (left.todayMiles || 0);
    if (sortBy === "week_miles") return (right.weekMiles || 0) - (left.weekMiles || 0);
    if (sortBy === "month_miles") return (right.monthMiles || 0) - (left.monthMiles || 0);
    if (sortBy === "speed_now") return (right.currentSpeedMph ?? Number.NEGATIVE_INFINITY) - (left.currentSpeedMph ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "fuel_low") return (left.fuelPercent ?? Number.POSITIVE_INFINITY) - (right.fuelPercent ?? Number.POSITIVE_INFINITY);
    if (sortBy === "fuel_high") return (right.fuelPercent ?? Number.NEGATIVE_INFINITY) - (left.fuelPercent ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "mpg_low") return (left.mpg ?? Number.POSITIVE_INFINITY) - (right.mpg ?? Number.POSITIVE_INFINITY);
    if (sortBy === "mpg_high") return (right.mpg ?? Number.NEGATIVE_INFINITY) - (left.mpg ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "faults") return (right.activeFaults || 0) - (left.activeFaults || 0);
    if (sortBy === "utilization") return (right.utilizationPct ?? Number.NEGATIVE_INFINITY) - (left.utilizationPct ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "drive_miles") return (right.driveMiles ?? Number.NEGATIVE_INFINITY) - (left.driveMiles ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "idle_hours") return (right.idleHours ?? Number.NEGATIVE_INFINITY) - (left.idleHours ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "age") return (right.ageMinutes ?? Number.NEGATIVE_INFINITY) - (left.ageMinutes ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "driver") return left.driverName.localeCompare(right.driverName, undefined, { sensitivity: "base", numeric: true });
    return left.truckNumber.localeCompare(right.truckNumber, undefined, { sensitivity: "base", numeric: true });
  });
  return sorted;
}

function HeroStat({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`statistics-hero-stat tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function LeaderboardColumn({ title, hint, items, formatter, onSelect, selectedVehicleId }) {
  return (
    <article className="statistics-leader-card">
      <div className="statistics-leader-head">
        <strong>{title}</strong>
        <small>{hint}</small>
      </div>
      <div className="statistics-leader-list">
        {items.length ? items.map((item, index) => {
          const active = String(item.vehicle_id || "") === String(selectedVehicleId || "");
          const sharedProps = {
            key: `${title}-${item.vehicle_id}-${index}`,
            className: `statistics-leader-row ${onSelect ? "is-clickable" : ""} ${active ? "active" : ""}`.trim(),
          };
          const content = (
            <>
              <div>
                <span>{index + 1}</span>
                <strong>{item.truck_number}</strong>
                <small>{item.driver_name || "Unassigned"}</small>
              </div>
              <em>{formatter(item.value)}</em>
            </>
          );
          return onSelect ? (
            <div
              {...sharedProps}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              onClick={() => onSelect(item.vehicle_id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(item.vehicle_id);
                }
              }}
            >
              {content}
            </div>
          ) : (
            <div {...sharedProps}>
              {content}
            </div>
          );
        }) : <div className="empty-route-card compact">No data yet.</div>}
      </div>
    </article>
  );
}

function FocusMetric({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`statistics-focus-metric tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function TrendBars({ points }) {
  const peak = trendPeak(points);
  return (
    <div className="statistics-trend-bars">
      {points.map((point, index) => {
        const miles = Number(point?.miles) || 0;
        return (
          <div key={`${point?.date || "trend"}-${index}`} className="statistics-trend-bar">
            <span className="statistics-trend-bar-value">{metricValue(miles)}</span>
            <div className="statistics-trend-bar-track">
              <div className="statistics-trend-bar-fill" style={{ height: `${Math.max(8, (miles / peak) * 100)}%` }} />
            </div>
            <small>{shortDate(point?.date)}</small>
          </div>
        );
      })}
    </div>
  );
}

function IncidentStat({ label, value, detail }) {
  return (
    <article className="motive-incident-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function IncidentViewerDialog({ event, videoKey, onVideoKeyChange, onClose, onRefresh, refreshing }) {
  if (!event) {
    return null;
  }

  const videoSources = performanceEventVideoSources(event);
  const imageSources = performanceEventImageSources(event);
  const activeVideo = videoSources.find((source) => source.key === videoKey) || videoSources[0] || null;
  const behaviors = performanceEventBehaviors(event);
  const contextEntries = Object.entries(event.additional_context || {});
  const cameraPositions = event.camera_media?.camera_positions || [];

  return (
    <div className="motive-incident-backdrop" onClick={onClose}>
      <div className="motive-incident-dialog" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <button type="button" className="motive-incident-close secondary-button" onClick={onClose}>
          Close
        </button>

        <div className="motive-incident-head">
          <span className="motive-incident-eyebrow">{videoSources.length ? "Statistics Clip Ready" : "Statistics Safety Incident"}</span>
          <h3>{formatKeyLabel(event.type || "event")}</h3>
          <p>
            {[event.location || "Location unavailable", event.coaching_status ? `Coaching: ${formatKeyLabel(event.coaching_status)}` : null, event.severity ? `Severity: ${formatKeyLabel(event.severity)}` : null]
              .filter(Boolean)
              .join(" | ")}
          </p>
        </div>

        <div className="motive-incident-media-shell">
          {activeVideo ? (
            <video
              key={activeVideo.url}
              className="motive-incident-video"
              controls
              playsInline
              preload="metadata"
              src={activeVideo.url}
            />
          ) : imageSources.length ? (
            <div className="motive-incident-image-grid">
              {imageSources.map((source) => (
                <a key={source.key} href={source.url} target="_blank" rel="noreferrer" className="motive-incident-image-link">
                  <img src={source.url} alt={source.label} className="motive-incident-image" />
                  <span>{source.label}</span>
                </a>
              ))}
            </div>
          ) : (
            <div className="empty-route-card compact">
              Motive returned the incident, but there is no downloadable clip on this event yet.
            </div>
          )}

          {videoSources.length > 1 ? (
            <div className="motive-incident-video-tabs">
              {videoSources.map((source) => (
                <button
                  key={source.key}
                  type="button"
                  className={`workspace-inline-tab ${activeVideo?.key === source.key ? "active" : ""}`.trim()}
                  onClick={() => onVideoKeyChange(source.key)}
                >
                  {source.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="motive-incident-actions">
            <button type="button" className="secondary-button" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing clip..." : "Refresh clip link"}
            </button>
            {activeVideo ? (
              <a className="secondary-button" href={activeVideo.url} target="_blank" rel="noreferrer">
                Open clip
              </a>
            ) : null}
          </div>

          <small className="motive-incident-note">
            Motive video URLs are temporary signed links. If a clip stops loading, refresh the selected truck detail to request a new link.
          </small>
        </div>

        <div className="motive-incident-stat-grid">
          <IncidentStat label="Start" value={compactDate(event.start_time)} detail={formatSpeed(event.start_speed)} />
          <IncidentStat label="End" value={compactDate(event.end_time)} detail={formatSpeed(event.end_speed)} />
          <IncidentStat label="Max speed" value={formatSpeed(event.max_speed)} detail={event.duration_seconds ? formatDurationSeconds(event.duration_seconds) : "Duration unknown"} />
          <IncidentStat label="Trigger" value={event.trigger ? formatKeyLabel(event.trigger) : "Unknown"} detail={event.intensity ? `Intensity: ${event.intensity}` : "Trigger context"} />
          <IncidentStat label="Camera" value={cameraPositions.length ? cameraPositions.map(formatKeyLabel).join(", ") : "No camera angle"} detail={event.camera_media?.camera_type || event.camera_media?.auto_transcode_status || "Camera meta unavailable"} />
          <IncidentStat label="Uploaded" value={compactDate(event.camera_media?.uploaded_at)} detail={event.driver_name || "Driver unavailable"} />
        </div>

        {behaviors.length ? (
          <section className="motive-incident-section">
            <h4>Behaviors and tags</h4>
            <div className="motive-incident-chip-rail">
              {behaviors.map((behavior) => (
                <span key={behavior} className="motive-incident-chip">
                  {formatKeyLabel(behavior)}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {contextEntries.length ? (
          <section className="motive-incident-section">
            <h4>Violation details</h4>
            <div className="motive-incident-context-grid">
              {contextEntries.map(([key, values]) => (
                <article key={key} className="motive-incident-context-card">
                  <strong>{formatKeyLabel(key)}</strong>
                  <small>{values.map(formatKeyLabel).join(", ")}</small>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function createDefaultFilters() {
  return {
    search: "",
    movement: "all",
    fuelType: "all",
    assignment: "all",
    loadStatus: "all",
    minFuel: "",
    maxFuel: "",
    minMpg: "",
    maxMpg: "",
    minFaults: "",
    minUtilization: "",
    minDriveMiles: "",
    minIdleHours: "",
    minTodayMiles: "",
    minWeekMiles: "",
    minMonthMiles: "",
    maxAgeMinutes: "",
    sortBy: "today_miles",
  };
}

export default function FleetStatisticsPanel({
  token,
  active = true,
  loadRows = [],
  workspaceMode = "embedded",
}) {
  const [snapshot, setSnapshot] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [quickFocus, setQuickFocus] = useState("all");
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [selectedIncidentVideoKey, setSelectedIncidentVideoKey] = useState("");
  const [overlayIncident, setOverlayIncident] = useState(null);
  const [overlayIncidentVideoKey, setOverlayIncidentVideoKey] = useState("");
  const [filters, setFilters] = useState(createDefaultFilters);

  useEffect(() => {
    if (!token || !active) {
      return undefined;
    }

    let ignore = false;

    async function loadSnapshot(forceRefresh = false) {
      if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

      try {
        const data = await apiRequest(`/motive/fleet${forceRefresh ? "?refresh=true" : ""}`, {}, token);
        if (ignore) return;
        setSnapshot(data);
      } catch (fetchError) {
        if (!ignore) {
          setError(fetchError.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    loadSnapshot(false);
    const intervalId = window.setInterval(() => loadSnapshot(true), 60000);
    return () => {
      ignore = true;
      window.clearInterval(intervalId);
    };
  }, [active, token]);

  const fuelTypeOptions = useMemo(() => {
    const types = new Set();
    (snapshot?.vehicles || []).forEach((vehicle) => {
      const type = normalizeText(vehicle?.fuel_type);
      if (type) {
        types.add(type);
      }
    });
    return ["all", ...[...types].sort()];
  }, [snapshot]);

  const loadStatusOptions = useMemo(() => {
    const values = new Set();
    (loadRows || []).forEach((row) => {
      const status = String(row?.status || "").trim();
      if (status) {
        values.add(status);
      }
    });
    return ["all", "No matched load", ...[...values].sort((left, right) => left.localeCompare(right))];
  }, [loadRows]);

  const fleetRows = useMemo(() => {
    return (snapshot?.vehicles || []).map((vehicle) => {
      const matchedLoad = findMatchingLoadRow(vehicle, loadRows);
      const mpgInfo = resolveVehicleMpgInfo(vehicle, matchedLoad);
      const fuelPercent = vehicleFuelPercent(vehicle);
      const archive = vehicle?.statistics_summary || {};
      const activeFaults = Number(vehicle?.fault_summary?.active_count) || 0;
      const totalFaults = Number(vehicle?.fault_summary?.count) || 0;
      const utilizationPct = numberValue(vehicle?.utilization_summary?.utilization_percentage);
      const driveMiles = numberValue(vehicle?.driving_summary?.distance_miles);
      const idleHours = numberValue((vehicle?.idle_summary?.duration_seconds || 0) / 3600);
      const iftaMiles = numberValue(vehicle?.ifta_summary?.distance_miles);
      const ageMinutes = numberValue(vehicle?.location?.age_minutes);
      const currentSpeedMph = numberValue(archive.current_speed_mph ?? vehicle?.location?.speed_mph);
      const averageSpeedMph7d = numberValue(archive.average_speed_mph_7d);
      const truckNumber = vehicleLabel(vehicle);
      const driverName = vehicleDriverName(vehicle);
      const locationLabel = vehicleLocationLabel(vehicle);
      const loadRoute = [matchedLoad?.pickup_city, matchedLoad?.delivery_city].filter(Boolean).join(" to ");
      const searchBlob = [
        truckNumber,
        driverName,
        vehicle?.vin,
        vehicle?.license_plate_number,
        vehicle?.make,
        vehicle?.model,
        vehicle?.year,
        vehicle?.fuel_type,
        locationLabel,
        vehicle?.location?.display_coords,
        matchedLoad?.status,
        matchedLoad?.pickup_city,
        matchedLoad?.delivery_city,
        matchedLoad?.truck,
        matchedLoad?.driver,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return {
        id: vehicle.id,
        vehicle,
        matchedLoad,
        truckNumber,
        driverName,
        unitLabel: [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(" "),
        vin: vehicle?.vin || "",
        fuelType: String(vehicle?.fuel_type || "").trim(),
        fuelPercent: Number.isFinite(fuelPercent) ? fuelPercent : null,
        mpg: mpgInfo.value !== null ? Number(mpgInfo.value) : null,
        mpgSource: mpgInfo.source,
        activeFaults,
        totalFaults,
        utilizationPct: Number.isFinite(utilizationPct) ? utilizationPct : null,
        driveMiles: Number.isFinite(driveMiles) ? driveMiles : null,
        idleHours: Number.isFinite(idleHours) ? idleHours : null,
        iftaMiles: Number.isFinite(iftaMiles) ? iftaMiles : null,
        ageMinutes: Number.isFinite(ageMinutes) ? ageMinutes : null,
        currentSpeedMph: Number.isFinite(currentSpeedMph) ? currentSpeedMph : null,
        averageSpeedMph7d: Number.isFinite(averageSpeedMph7d) ? averageSpeedMph7d : null,
        todayMiles: Number(numberValue(archive.today_miles) || 0),
        weekMiles: Number(numberValue(archive.week_miles) || 0),
        monthMiles: Number(numberValue(archive.month_miles) || 0),
        trackedMiles: Number(numberValue(archive.tracked_miles) || 0),
        trackedDays: Number(numberValue(archive.tracked_days) || 0),
        averageDailyMiles: Number(numberValue(archive.average_daily_miles) || 0),
        maxDailyMiles: Number(numberValue(archive.max_daily_miles) || 0),
        trend14d: Array.isArray(archive.daily_trend_14d) ? archive.daily_trend_14d : [],
        latestOdometerMiles: numberValue(archive.latest_odometer_miles),
        latestEngineHours: numberValue(archive.latest_engine_hours),
        archiveStartedAt: archive.archive_started_at || "",
        archiveLastSeenAt: archive.archive_last_seen_at || "",
        isMoving: Boolean(vehicle?.is_moving),
        isStale: Boolean(vehicle?.is_stale),
        hasDriver: driverName !== "Unassigned",
        hasLocation: Boolean(vehicle?.location),
        locationLabel,
        locationCityState: [vehicle?.location?.city, vehicle?.location?.state].filter(Boolean).join(", "),
        lastLocatedAt: vehicle?.location?.located_at || "",
        loadStatus: String(matchedLoad?.status || ""),
        loadRoute,
        healthScore: healthScore({
          isStale: Boolean(vehicle?.is_stale),
          fuelPercent,
          activeFaults,
          ageMinutes,
        }),
        searchBlob,
      };
    });
  }, [loadRows, snapshot]);

  useEffect(() => {
    if (!fleetRows.length) {
      setSelectedVehicleId(null);
      return;
    }
    if (selectedVehicleId && fleetRows.some((row) => String(row.id) === String(selectedVehicleId))) {
      return;
    }
    setSelectedVehicleId(defaultVehicleId(fleetRows));
  }, [fleetRows, selectedVehicleId]);

  useEffect(() => {
    setSelectedIncidentId("");
    setSelectedIncidentVideoKey("");
  }, [selectedVehicleId]);

  useEffect(() => {
    if (!token) {
      setOverlayIncident(null);
      setOverlayIncidentVideoKey("");
    }
  }, [token]);

  useEffect(() => {
    if (!token || !selectedVehicleId || !active) {
      return undefined;
    }

    let ignore = false;

    async function loadDetail() {
      setDetailLoading(true);
      try {
        const data = await apiRequest(`/motive/vehicles/${selectedVehicleId}`, {}, token);
        if (!ignore) {
          setDetail(data);
        }
      } catch (fetchError) {
        if (!ignore) {
          setError(fetchError.message);
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
  }, [active, selectedVehicleId, token]);

  const filteredRows = useMemo(() => {
    const searchTerm = normalizeText(filters.search);
    const minFuel = numberValue(filters.minFuel);
    const maxFuel = numberValue(filters.maxFuel);
    const minMpg = numberValue(filters.minMpg);
    const maxMpg = numberValue(filters.maxMpg);
    const minFaults = numberValue(filters.minFaults);
    const minUtilization = numberValue(filters.minUtilization);
    const minDriveMiles = numberValue(filters.minDriveMiles);
    const minIdleHours = numberValue(filters.minIdleHours);
    const minTodayMiles = numberValue(filters.minTodayMiles);
    const minWeekMiles = numberValue(filters.minWeekMiles);
    const minMonthMiles = numberValue(filters.minMonthMiles);
    const maxAgeMinutes = numberValue(filters.maxAgeMinutes);

    const nextRows = fleetRows.filter((row) => {
      if (quickFocus === "lowFuel" && (row.fuelPercent === null || row.fuelPercent > 25)) return false;
      if (quickFocus === "faults" && row.activeFaults <= 0) return false;
      if (quickFocus === "moving" && !row.isMoving) return false;
      if (quickFocus === "stale" && !row.isStale) return false;
      if (quickFocus === "withLoad" && !row.matchedLoad) return false;
      if (searchTerm && !row.searchBlob.includes(searchTerm)) return false;

      if (filters.movement === "moving" && !row.isMoving) return false;
      if (filters.movement === "stopped" && (row.isMoving || row.isStale)) return false;
      if (filters.movement === "stale" && !row.isStale) return false;

      if (filters.fuelType !== "all" && normalizeText(row.fuelType) !== normalizeText(filters.fuelType)) return false;
      if (filters.assignment === "assigned" && !row.hasDriver) return false;
      if (filters.assignment === "unassigned" && row.hasDriver) return false;
      if (filters.loadStatus === "No matched load" && row.matchedLoad) return false;
      if (filters.loadStatus !== "all" && filters.loadStatus !== "No matched load" && row.loadStatus !== filters.loadStatus) return false;

      if (!numericBetween(row.fuelPercent, minFuel, maxFuel)) return false;
      if (!numericBetween(row.mpg, minMpg, maxMpg)) return false;
      if (minFaults !== null && row.activeFaults < minFaults) return false;
      if (minUtilization !== null && (!Number.isFinite(row.utilizationPct) || row.utilizationPct < minUtilization)) return false;
      if (minDriveMiles !== null && (!Number.isFinite(row.driveMiles) || row.driveMiles < minDriveMiles)) return false;
      if (minIdleHours !== null && (!Number.isFinite(row.idleHours) || row.idleHours < minIdleHours)) return false;
      if (minTodayMiles !== null && row.todayMiles < minTodayMiles) return false;
      if (minWeekMiles !== null && row.weekMiles < minWeekMiles) return false;
      if (minMonthMiles !== null && row.monthMiles < minMonthMiles) return false;
      if (maxAgeMinutes !== null && (!Number.isFinite(row.ageMinutes) || row.ageMinutes > maxAgeMinutes)) return false;

      return true;
    });

    return sortRows(nextRows, filters.sortBy);
  }, [filters, fleetRows, quickFocus]);

  useEffect(() => {
    if (!filteredRows.length) {
      return;
    }
    if (filteredRows.some((row) => String(row.id) === String(selectedVehicleId))) {
      return;
    }
    setSelectedVehicleId(filteredRows[0].id);
  }, [filteredRows, selectedVehicleId]);

  const selectedRow = useMemo(() => {
    return filteredRows.find((row) => String(row.id) === String(selectedVehicleId))
      || filteredRows[0]
      || fleetRows.find((row) => String(row.id) === String(selectedVehicleId))
      || fleetRows[0]
      || null;
  }, [filteredRows, fleetRows, selectedVehicleId]);

  const selectedVehicle = selectedRow?.vehicle || null;
  const hasCurrentDetail = detail?.vehicle?.id && String(detail.vehicle.id) === String(selectedRow?.id);
  const selectedDetailVehicle = detail?.vehicle?.id && String(detail.vehicle.id) === String(selectedRow?.id) ? detail.vehicle : selectedVehicle;
  const selectedStatistics = detail?.statistics && hasCurrentDetail
    ? detail.statistics
    : selectedRow
      ? {
          today_miles: selectedRow.todayMiles,
          week_miles: selectedRow.weekMiles,
          month_miles: selectedRow.monthMiles,
          tracked_miles: selectedRow.trackedMiles,
          tracked_days: selectedRow.trackedDays,
          average_daily_miles: selectedRow.averageDailyMiles,
          max_daily_miles: selectedRow.maxDailyMiles,
          current_speed_mph: selectedRow.currentSpeedMph,
          average_speed_mph_7d: selectedRow.averageSpeedMph7d,
          latest_odometer_miles: selectedRow.latestOdometerMiles,
          latest_engine_hours: selectedRow.latestEngineHours,
          archive_started_at: selectedRow.archiveStartedAt,
          archive_last_seen_at: selectedRow.archiveLastSeenAt,
          daily_history: selectedRow.trend14d,
          coverage: {
            tracked_days: selectedRow.trackedDays,
            archive_started_at: selectedRow.archiveStartedAt,
            archive_last_seen_at: selectedRow.archiveLastSeenAt,
          },
        }
      : null;
  const detailPerformanceWarning = hasCurrentDetail ? detail?.performance_events?.warning || "" : "";
  const selectedSafetyEvents = hasCurrentDetail && detail?.performance_events?.items?.length
    ? detail.performance_events.items
    : selectedDetailVehicle?.previews?.performance_events || [];
  const selectedCameraIncidentCount = (
    hasCurrentDetail
      ? detail?.performance_events?.video_count
      : undefined
  ) ?? selectedSafetyEvents.filter((item) => performanceEventVideoSources(item).length > 0).length;
  const selectedIncident = selectedSafetyEvents.find((item) => performanceEventKey(item) === selectedIncidentId) || null;
  const selectedIncidentResolvedVideoKey = selectedIncident && performanceEventVideoSources(selectedIncident).some((source) => source.key === selectedIncidentVideoKey)
    ? selectedIncidentVideoKey
    : defaultPerformanceVideoKey(selectedIncident);

  const visibleMetrics = useMemo(() => {
    return {
      total: filteredRows.length,
      avgFuel: average(filteredRows.map((row) => row.fuelPercent)),
      avgMpg: average(filteredRows.map((row) => row.mpg)),
      avgSpeedNow: average(filteredRows.map((row) => row.currentSpeedMph)),
      avgSpeed7d: average(filteredRows.map((row) => row.averageSpeedMph7d)),
      lowFuel: filteredRows.filter((row) => row.fuelPercent !== null && row.fuelPercent <= 25).length,
      withFaults: filteredRows.filter((row) => row.activeFaults > 0).length,
      moving: filteredRows.filter((row) => row.isMoving).length,
      stale: filteredRows.filter((row) => row.isStale).length,
      todayMiles: filteredRows.reduce((sum, row) => sum + (row.todayMiles || 0), 0),
      weekMiles: filteredRows.reduce((sum, row) => sum + (row.weekMiles || 0), 0),
      monthMiles: filteredRows.reduce((sum, row) => sum + (row.monthMiles || 0), 0),
    };
  }, [filteredRows]);

  const snapshotStatistics = snapshot?.statistics || {};
  const statisticsTotals = snapshotStatistics.totals || {};
  const statisticsArchive = snapshotStatistics.archive || {};
  const leaderboards = snapshotStatistics.leaders || {};
  const recentSafetyEvents = (snapshot?.recent_activity?.performance_events || []).slice(0, 8);
  const hasActiveFilters = useMemo(() => {
    const defaults = createDefaultFilters();
    return quickFocus !== "all"
      || Object.entries(filters).some(([key, value]) => value !== defaults[key]);
  }, [filters, quickFocus]);

  const modalIncident = overlayIncident || selectedIncident;
  const modalIncidentVideoKey = overlayIncident
    ? (
      performanceEventVideoSources(overlayIncident).some((source) => source.key === overlayIncidentVideoKey)
        ? overlayIncidentVideoKey
        : defaultPerformanceVideoKey(overlayIncident)
    )
    : selectedIncidentResolvedVideoKey;

  function requestVehicleDetail(vehicleId, forceRefresh = false) {
    return apiRequest(`/motive/vehicles/${vehicleId}${forceRefresh ? "?refresh=true" : ""}`, {}, token);
  }

  function refreshSelectedDetail(forceRefresh = false) {
    if (!token || !selectedVehicleId) {
      return;
    }
    setDetailLoading(true);
    requestVehicleDetail(selectedVehicleId, forceRefresh)
      .then((data) => {
        setDetail(data);
        setError("");
      })
      .catch((refreshError) => setError(refreshError.message))
      .finally(() => setDetailLoading(false));
  }

  function openIncident(event, { selectTruck = true } = {}) {
    if (!event) {
      return;
    }
    if (selectTruck && event.vehicle_id) {
      setSelectedVehicleId(event.vehicle_id);
    }
    setSelectedIncidentId("");
    setSelectedIncidentVideoKey("");
    setOverlayIncident(event);
    setOverlayIncidentVideoKey(defaultPerformanceVideoKey(event));

    if (event.vehicle_id && !performanceEventVideoSources(event).length && !performanceEventImageSources(event).length) {
      setDetailLoading(true);
      requestVehicleDetail(event.vehicle_id, true)
        .then((data) => {
          setDetail(data);
          setError("");
          const refreshedEvent = (data?.performance_events?.items || []).find((item) => performanceEventKey(item) === performanceEventKey(event));
          if (refreshedEvent) {
            setOverlayIncident(refreshedEvent);
            setOverlayIncidentVideoKey(defaultPerformanceVideoKey(refreshedEvent));
          }
        })
        .catch((refreshError) => setError(refreshError.message))
        .finally(() => setDetailLoading(false));
    }
  }

  function closeIncident() {
    setOverlayIncident(null);
    setOverlayIncidentVideoKey("");
    setSelectedIncidentId("");
    setSelectedIncidentVideoKey("");
  }

  function refreshIncidentMedia() {
    const incident = modalIncident;
    const vehicleId = incident?.vehicle_id || selectedVehicleId;
    if (!token || !vehicleId) {
      return;
    }
    setDetailLoading(true);
    requestVehicleDetail(vehicleId, true)
      .then((data) => {
        setDetail(data);
        setError("");
        if (overlayIncident) {
          const refreshedEvent = (data?.performance_events?.items || []).find((item) => performanceEventKey(item) === performanceEventKey(overlayIncident));
          if (refreshedEvent) {
            setOverlayIncident(refreshedEvent);
            setOverlayIncidentVideoKey(defaultPerformanceVideoKey(refreshedEvent));
          }
        }
      })
      .catch((refreshError) => setError(refreshError.message))
      .finally(() => setDetailLoading(false));
  }

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function applyQuickFocus(nextQuickFocus) {
    const preset = createDefaultFilters();
    if (nextQuickFocus === "moving") preset.sortBy = "speed_now";
    if (nextQuickFocus === "lowFuel") preset.sortBy = "fuel_low";
    if (nextQuickFocus === "faults") preset.sortBy = "faults";
    if (nextQuickFocus === "stale") preset.sortBy = "age";
    if (nextQuickFocus === "withLoad") preset.sortBy = "today_miles";
    if (nextQuickFocus === "milesToday") preset.sortBy = "today_miles";
    setQuickFocus(nextQuickFocus);
    setFilters(preset);
  }

  function clearFilters() {
    setQuickFocus("all");
    setFilters(createDefaultFilters());
  }

  if (!token) {
    return null;
  }

  return (
    <section className={`panel fleet-statistics-panel ${workspaceMode === "standalone" ? "statistics-standalone" : ""}`.trim()}>
      <div className="panel-head">
        <div>
          <h2>{workspaceMode === "standalone" ? "Truck Statistics Command" : "Fleet Statistics"}</h2>
          <span>
            {snapshot?.company?.name
              ? `${snapshot.company.name} live analytics with per-truck archive growth, speed, mileage, fuel, fault, and utilization reporting.`
              : "Real-time truck analytics with archive-backed daily, weekly, and monthly reporting."}
          </span>
        </div>
        <div className="fleet-statistics-head-meta">
          {snapshot?.fetched_at ? <small>Updated {compactDate(snapshot.fetched_at)}</small> : null}
          <button className="secondary-button" type="button" onClick={clearFilters}>
            Clear filters
          </button>
          <button className="primary-button" type="button" onClick={() => {
            setRefreshing(true);
            apiRequest("/motive/fleet?refresh=true", {}, token)
              .then((data) => {
                setSnapshot(data);
                setError("");
                if (selectedVehicleId) {
                  refreshSelectedDetail(true);
                }
              })
              .catch((refreshError) => setError(refreshError.message))
              .finally(() => setRefreshing(false));
          }}>
            {refreshing ? "Refreshing..." : "Refresh live"}
          </button>
        </div>
      </div>

      {error ? <div className="notice error inline-notice">{error}</div> : null}
      {detailPerformanceWarning ? <div className="notice info inline-notice">{detailPerformanceWarning}</div> : null}

      {loading ? (
        <div className="empty-route-card">Loading truck analytics...</div>
      ) : (
        <div className="statistics-premium-stack">
          <section className="statistics-premium-hero">
            <div className="statistics-premium-copy">
              <span className="eyebrow">{workspaceMode === "standalone" ? "Statistics Workspace" : "Operations Analytics"}</span>
              <h3>One command surface for live trucks, speed, mileage, archive growth, and every profile detail that matters.</h3>
              <p>
                Compare the whole fleet in real time, open a truck profile instantly, and track how each unit moves today,
                across the week, across the month, and across the archive that keeps building over time.
              </p>
            </div>

            <div className="statistics-premium-coverage">
              <div>
                <span>Archive started</span>
                <strong>{statisticsArchive.first_tracked_at ? shortDate(statisticsArchive.first_tracked_at) : "Starting now"}</strong>
                <small>{metricValue(statisticsArchive.vehicle_days || 0)} archived vehicle-days</small>
              </div>
              <div>
                <span>Tracked units</span>
                <strong>{metricValue(statisticsArchive.vehicles_with_history || 0)}</strong>
                <small>{metricValue(snapshot?.metrics?.total_vehicles || 0)} total live trucks</small>
              </div>
              <div>
                <span>Last archive ping</span>
                <strong>{statisticsArchive.last_tracked_at ? compactDate(statisticsArchive.last_tracked_at) : "Waiting"}</strong>
                <small>Archive grows automatically as Motive snapshots refresh</small>
              </div>
            </div>
          </section>

          <section className="statistics-hero-grid">
            <HeroStat label="Visible trucks" value={metricValue(visibleMetrics.total)} detail={`${metricValue(snapshot?.metrics?.total_vehicles || 0)} total live units`} tone="blue" />
            <HeroStat label="Miles today" value={formatMiles(statisticsTotals.today_miles ?? visibleMetrics.todayMiles)} detail="Archive-based daily movement" tone="emerald" />
            <HeroStat label="Miles 7d" value={formatMiles(statisticsTotals.week_miles ?? visibleMetrics.weekMiles)} detail="Rolling weekly movement" tone="sky" />
            <HeroStat label="Miles 30d" value={formatMiles(statisticsTotals.month_miles ?? visibleMetrics.monthMiles)} detail="Rolling monthly movement" tone="amber" />
            <HeroStat label="Speed now" value={formatSpeed(statisticsTotals.avg_speed_now_mph ?? visibleMetrics.avgSpeedNow)} detail={`${metricValue(visibleMetrics.moving)} trucks moving now`} tone="violet" />
            <HeroStat label="Avg speed 7d" value={formatSpeed(statisticsTotals.avg_speed_7d_mph ?? visibleMetrics.avgSpeed7d)} detail="Rolling driving average" tone="blue" />
            <HeroStat label="Low fuel units" value={metricValue(visibleMetrics.lowFuel)} detail="25% or below" tone={visibleMetrics.lowFuel ? "amber" : "blue"} />
            <HeroStat label="Fault units" value={metricValue(visibleMetrics.withFaults)} detail={`${metricValue(visibleMetrics.stale)} stale telemetry`} tone={visibleMetrics.withFaults ? "rose" : "blue"} />
          </section>

          <section className="statistics-leader-grid">
            <LeaderboardColumn title="Top Today Miles" hint="Who moved most today" items={leaderboards.today_miles || []} formatter={(value) => formatMiles(value)} onSelect={setSelectedVehicleId} selectedVehicleId={selectedVehicleId} />
            <LeaderboardColumn title="Fastest Right Now" hint="Live speed leaderboard" items={leaderboards.speed_now || []} formatter={(value) => formatSpeed(value)} onSelect={setSelectedVehicleId} selectedVehicleId={selectedVehicleId} />
            <LeaderboardColumn title="Most Faults" hint="Units that need review" items={leaderboards.faults || []} formatter={(value) => `${metricValue(value)} fault${Number(value) === 1 ? "" : "s"}`} onSelect={setSelectedVehicleId} selectedVehicleId={selectedVehicleId} />
            <LeaderboardColumn title="Lowest Fuel" hint="Fuel risk first" items={leaderboards.fuel_low || []} formatter={(value) => formatPercent(value)} onSelect={setSelectedVehicleId} selectedVehicleId={selectedVehicleId} />
          </section>

          <section className="statistics-safety-panel statistics-safety-global-panel">
            <div className="panel-head">
              <div>
                <h2>Fleet Violation Center</h2>
                <span>Open Motive safety clips directly from recent fleet incidents, even if the truck matrix is empty.</span>
              </div>
            </div>

            {recentSafetyEvents.length ? (
              <div className="statistics-safety-list statistics-safety-global-list">
                {recentSafetyEvents.map((event) => {
                  const videoCount = performanceEventVideoSources(event).length;
                  const imageCount = performanceEventImageSources(event).length;
                  return (
                    <button
                      key={`global-incident-${performanceEventKey(event)}`}
                      type="button"
                      className="statistics-safety-incident statistics-safety-incident-global"
                      onClick={() => openIncident(event)}
                    >
                      <div className="statistics-safety-incident-head">
                        <div>
                          <strong>{event.vehicle_number || "Truck"} | {formatKeyLabel(event.type || "event")}</strong>
                          <small>{event.driver_name || "Unassigned"} | {event.location || compactDate(event.end_time)}</small>
                        </div>
                        <span className={`statistics-safety-pill ${videoCount ? "live" : event.camera_available ? "pending" : "plain"}`.trim()}>
                          {videoCount ? `Watch ${videoCount} clip${videoCount === 1 ? "" : "s"}` : imageCount ? `${imageCount} frame${imageCount === 1 ? "" : "s"}` : event.camera_available ? "Media pending" : "No clip"}
                        </span>
                      </div>
                      <div className="statistics-safety-incident-meta">
                        <span>{event.coaching_status ? formatKeyLabel(event.coaching_status) : "No coaching status"}</span>
                        <span>{event.max_speed ? `${decimalValue(event.max_speed)} mph max` : "No max speed"}</span>
                        <span>{event.severity ? formatKeyLabel(event.severity) : "Severity n/a"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty-route-card compact">No recent fleet safety incidents with media came back from Motive yet.</div>
            )}
          </section>

          <section className="panel-filter-card">
            <div className="inline-filter-grid">
              <label>
                Search everything
                <input
                  autoComplete="off"
                  type="text"
                  value={filters.search}
                  onChange={(event) => updateFilter("search", event.target.value)}
                  placeholder="Truck, driver, VIN, city, pickup, delivery"
                />
              </label>
              <label>
                Movement
                <select value={filters.movement} onChange={(event) => updateFilter("movement", event.target.value)}>
                  <option value="all">All</option>
                  <option value="moving">Moving</option>
                  <option value="stopped">Stopped</option>
                  <option value="stale">Stale</option>
                </select>
              </label>
              <label>
                Fuel type
                <select value={filters.fuelType} onChange={(event) => updateFilter("fuelType", event.target.value)}>
                  {fuelTypeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "all" ? "All fuel types" : option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Driver assignment
                <select value={filters.assignment} onChange={(event) => updateFilter("assignment", event.target.value)}>
                  <option value="all">All</option>
                  <option value="assigned">Assigned</option>
                  <option value="unassigned">Unassigned</option>
                </select>
              </label>
              <label>
                Load status
                <select value={filters.loadStatus} onChange={(event) => updateFilter("loadStatus", event.target.value)}>
                  {loadStatusOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sort by
                <select value={filters.sortBy} onChange={(event) => updateFilter("sortBy", event.target.value)}>
                  <option value="today_miles">Today miles</option>
                  <option value="week_miles">Week miles</option>
                  <option value="month_miles">Month miles</option>
                  <option value="speed_now">Current speed</option>
                  <option value="faults">Most faults</option>
                  <option value="fuel_low">Fuel low to high</option>
                  <option value="fuel_high">Fuel high to low</option>
                  <option value="utilization">Highest utilization</option>
                  <option value="drive_miles">Most drive miles</option>
                  <option value="idle_hours">Most idle hours</option>
                  <option value="age">Oldest update</option>
                  <option value="driver">Driver</option>
                  <option value="truck">Truck number</option>
                </select>
              </label>
            </div>

            <div className="workspace-inline-tabs statistics-quick-tabs">
              {quickFocusOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`workspace-inline-tab ${quickFocus === option.id ? "active" : ""}`}
                  onClick={() => applyQuickFocus(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="inline-filter-grid statistics-subfilters-grid">
              <label>
                Min fuel %
                <input autoComplete="off" type="number" min="0" max="100" value={filters.minFuel} onChange={(event) => updateFilter("minFuel", event.target.value)} placeholder="0" />
              </label>
              <label>
                Max fuel %
                <input autoComplete="off" type="number" min="0" max="100" value={filters.maxFuel} onChange={(event) => updateFilter("maxFuel", event.target.value)} placeholder="100" />
              </label>
              <label>
                Min active faults
                <input autoComplete="off" type="number" min="0" value={filters.minFaults} onChange={(event) => updateFilter("minFaults", event.target.value)} placeholder="1" />
              </label>
              <label>
                Min today miles
                <input autoComplete="off" type="number" min="0" value={filters.minTodayMiles} onChange={(event) => updateFilter("minTodayMiles", event.target.value)} placeholder="250" />
              </label>
              <label>
                Min week miles
                <input autoComplete="off" type="number" min="0" value={filters.minWeekMiles} onChange={(event) => updateFilter("minWeekMiles", event.target.value)} placeholder="1200" />
              </label>
              <label>
                Min month miles
                <input autoComplete="off" type="number" min="0" value={filters.minMonthMiles} onChange={(event) => updateFilter("minMonthMiles", event.target.value)} placeholder="5000" />
              </label>
              <label>
                Min MPG
                <input autoComplete="off" type="number" min="0" step="0.1" value={filters.minMpg} onChange={(event) => updateFilter("minMpg", event.target.value)} placeholder="5.5" />
              </label>
              <label>
                Max MPG
                <input autoComplete="off" type="number" min="0" step="0.1" value={filters.maxMpg} onChange={(event) => updateFilter("maxMpg", event.target.value)} placeholder="9.0" />
              </label>
              <label>
                Min utilization %
                <input autoComplete="off" type="number" min="0" step="0.1" value={filters.minUtilization} onChange={(event) => updateFilter("minUtilization", event.target.value)} placeholder="50" />
              </label>
              <label>
                Max age minutes
                <input autoComplete="off" type="number" min="0" step="0.1" value={filters.maxAgeMinutes} onChange={(event) => updateFilter("maxAgeMinutes", event.target.value)} placeholder="30" />
              </label>
            </div>

            <div className="panel-filter-summary">
              Compare every truck by live speed, archive miles today, rolling week and month movement, fuel, MPG, faults,
              utilization, assignment, stale age, and matched load context.
            </div>
          </section>

          <section className="statistics-main-grid">
            <div className="statistics-fleet-column">
              <section className="statistics-vehicle-spotlight-grid">
                {filteredRows.slice(0, 6).map((row) => (
                  <button
                    key={`spotlight-${row.id}`}
                    type="button"
                    className={`statistics-vehicle-spotlight ${selectedRow?.id === row.id ? "active" : ""}`.trim()}
                    onClick={() => setSelectedVehicleId(row.id)}
                  >
                    <div className="statistics-vehicle-spotlight-top">
                      <span className={`statistics-status-pill tone-${statusTone(row)}`}>{fleetStatusLabel(row)}</span>
                      <small>{formatPercent(row.fuelPercent)}</small>
                    </div>
                    <strong>{row.truckNumber}</strong>
                    <p>{row.driverName}</p>
                    <div className="statistics-vehicle-spotlight-metrics">
                      <div><span>Today</span><em>{formatMiles(row.todayMiles)}</em></div>
                      <div><span>Speed</span><em>{formatSpeed(row.currentSpeedMph)}</em></div>
                      <div><span>Faults</span><em>{metricValue(row.activeFaults)}</em></div>
                    </div>
                  </button>
                ))}
              </section>

              <section className="panel workspace-table-panel">
                <div className="panel-head">
                  <div>
                    <h2>Truck Matrix</h2>
                    <span>{filteredRows.length} truck row(s) match the current analytics filters.</span>
                  </div>
                </div>

                <div className="sheet-frame">
                  <div className="sheet-scroll">
                    <table className="dispatch-sheet statistics-table">
                      <thead>
                        <tr>
                          <th>Truck</th>
                          <th>Driver</th>
                          <th>Today</th>
                          <th>Week</th>
                          <th>Month</th>
                          <th>Speed</th>
                          <th>Fuel</th>
                          <th>Faults</th>
                          <th>Load</th>
                          <th>Location</th>
                          <th>Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows.length ? filteredRows.map((row) => (
                          <tr
                            key={row.id}
                            className={selectedRow?.id === row.id ? "statistics-table-row-selected" : ""}
                            onClick={() => setSelectedVehicleId(row.id)}
                          >
                            <td>
                              <strong>{row.truckNumber}</strong>
                              <small>{row.unitLabel || row.vin || "Truck"}</small>
                            </td>
                            <td>
                              <strong>{row.driverName}</strong>
                              <small>{row.hasDriver ? "Assigned" : "Unassigned"}</small>
                            </td>
                            <td>
                              <strong>{formatMiles(row.todayMiles)}</strong>
                              <small>{metricValue(row.healthScore)} health score</small>
                            </td>
                            <td>
                              <strong>{formatMiles(row.weekMiles)}</strong>
                              <small>{formatMiles(row.averageDailyMiles)} avg/day</small>
                            </td>
                            <td>
                              <strong>{formatMiles(row.monthMiles)}</strong>
                              <small>{formatMiles(row.trackedMiles)} tracked total</small>
                            </td>
                            <td>
                              <strong>{formatSpeed(row.currentSpeedMph)}</strong>
                              <small>{formatSpeed(row.averageSpeedMph7d)} 7d avg</small>
                            </td>
                            <td>
                              <strong className={`statistics-fuel-${fuelFilterTone(row.fuelPercent)}`}>
                                {formatPercent(row.fuelPercent)}
                              </strong>
                              <small>{row.fuelType || "Fuel n/a"}</small>
                            </td>
                            <td>
                              <strong>{metricValue(row.activeFaults)}</strong>
                              <small>{metricValue(row.totalFaults)} total recent</small>
                            </td>
                            <td>
                              <strong>{row.loadStatus || "No matched load"}</strong>
                              <small>{row.loadRoute || "No active route"}</small>
                            </td>
                            <td>
                              <strong>{row.locationLabel}</strong>
                              <small>{row.locationCityState || "No city/state"}</small>
                            </td>
                            <td>
                              <strong>{compactDate(row.lastLocatedAt)}</strong>
                              <small>{row.hasLocation ? "Live GPS" : "No live GPS"}</small>
                            </td>
                          </tr>
                        )) : (
                      <tr>
                        <td colSpan="11">
                          <div className="empty-route-card compact">
                            <strong>No trucks match the current filters.</strong>
                            <span>{hasActiveFilters ? "Clear or relax the filters to bring the fleet back into the matrix." : "Live fleet data is available, but no rows are ready yet. Use Fleet Violation Center above to open videos directly."}</span>
                            {hasActiveFilters ? <button className="secondary-button" type="button" onClick={clearFilters}>Reset filters</button> : null}
                          </div>
                        </td>
                      </tr>
                    )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </div>

            <aside className="statistics-focus-column">
              {selectedRow ? (
                <>
                  <section className="statistics-focus-hero">
                    <div className="statistics-focus-head">
                      <div>
                        <span className={`statistics-status-pill tone-${statusTone(selectedRow)}`}>{fleetStatusLabel(selectedRow)}</span>
                        <h3>{selectedRow.truckNumber}</h3>
                        <p>{selectedRow.driverName} | {selectedRow.locationLabel}</p>
                      </div>
                      <div className="statistics-focus-health">
                        <span>Truck profile</span>
                        <strong>{metricValue(selectedRow.healthScore)}</strong>
                        <small>Health score</small>
                      </div>
                    </div>

                    <div className="statistics-focus-metric-grid">
                      <FocusMetric label="Speed now" value={formatSpeed(selectedStatistics?.current_speed_mph ?? selectedRow.currentSpeedMph)} detail={selectedRow.isMoving ? "Truck is moving right now" : "Truck is not moving now"} tone="blue" />
                      <FocusMetric label="Avg speed 7d" value={formatSpeed(selectedStatistics?.average_speed_mph_7d ?? selectedRow.averageSpeedMph7d)} detail="Rolling driving average" tone="violet" />
                      <FocusMetric label="Miles today" value={formatMiles(selectedStatistics?.today_miles ?? selectedRow.todayMiles)} detail="Archive-based daily mileage" tone="emerald" />
                      <FocusMetric label="Miles 7d" value={formatMiles(selectedStatistics?.week_miles ?? selectedRow.weekMiles)} detail="Rolling weekly distance" tone="sky" />
                      <FocusMetric label="Miles 30d" value={formatMiles(selectedStatistics?.month_miles ?? selectedRow.monthMiles)} detail="Rolling monthly distance" tone="amber" />
                      <FocusMetric label="Tracked total" value={formatMiles(selectedStatistics?.tracked_miles ?? selectedRow.trackedMiles)} detail={`${metricValue(selectedStatistics?.tracked_days ?? selectedRow.trackedDays)} tracked day(s)`} tone="dark" />
                      <FocusMetric label="Fuel" value={formatPercent(selectedRow.fuelPercent)} detail={selectedRow.fuelType || "Fuel type unavailable"} tone={fuelFilterTone(selectedRow.fuelPercent)} />
                      <FocusMetric label="MPG" value={selectedRow.mpg !== null ? decimalValue(selectedRow.mpg) : "-"} detail={selectedRow.mpgSource || "No MPG source"} tone="blue" />
                      <FocusMetric
                        label="Faults"
                        value={metricValue(selectedRow.activeFaults)}
                        detail={`${metricValue(selectedRow.totalFaults)} recent total${selectedCameraIncidentCount ? ` | ${metricValue(selectedCameraIncidentCount)} camera incident${selectedCameraIncidentCount === 1 ? "" : "s"}` : ""}`}
                        tone={selectedRow.activeFaults ? "rose" : "dark"}
                      />
                      <FocusMetric label="Drive left" value={formatDurationSeconds(selectedDetailVehicle?.eld_hours?.available_time?.drive_seconds)} detail={selectedDetailVehicle?.eld_hours?.duty_status || selectedDetailVehicle?.eld_hours?.status || "HOS clock"} tone="dark" />
                      <FocusMetric label="Idle 7d" value={formatHours(selectedRow.idleHours)} detail={`${metricValue(selectedDetailVehicle?.idle_summary?.count || 0)} idle event(s)`} tone="amber" />
                      <FocusMetric label="IFTA 30d" value={formatMiles(selectedRow.iftaMiles)} detail={`${metricValue(selectedDetailVehicle?.ifta_summary?.count || 0)} trip(s)`} tone="sky" />
                    </div>
                  </section>

                  <section className="statistics-focus-detail-panel">
                    <div className="statistics-focus-detail-grid">
                      <div><span>Vehicle</span><strong>{selectedRow.unitLabel || "Unknown unit"}</strong><small>{selectedRow.vin || "No VIN"}</small></div>
                      <div><span>Archive started</span><strong>{selectedStatistics?.coverage?.archive_started_at ? shortDate(selectedStatistics.coverage.archive_started_at) : "Starting now"}</strong><small>{selectedStatistics?.coverage?.tracked_days || selectedRow.trackedDays} tracked day(s)</small></div>
                      <div><span>Latest odometer</span><strong>{selectedStatistics?.latest_odometer_miles !== null && selectedStatistics?.latest_odometer_miles !== undefined ? formatMiles(selectedStatistics.latest_odometer_miles) : "-"}</strong><small>Latest telemetry reading</small></div>
                      <div><span>Engine hours</span><strong>{selectedStatistics?.latest_engine_hours !== null && selectedStatistics?.latest_engine_hours !== undefined ? decimalValue(selectedStatistics.latest_engine_hours) : "-"}</strong><small>Current engine runtime</small></div>
                      <div><span>Utilization</span><strong>{formatPercent(selectedRow.utilizationPct)}</strong><small>7-day utilization</small></div>
                      <div><span>Load</span><strong>{selectedRow.loadStatus || "No matched load"}</strong><small>{selectedRow.loadRoute || "No active route"}</small></div>
                    </div>
                  </section>

                  <section className="statistics-safety-panel">
                    <div className="panel-head">
                      <div>
                        <h2>Safety Incidents & Video</h2>
                        <span>
                          {detailLoading
                            ? "Refreshing Motive incident media..."
                            : `${selectedSafetyEvents.length} recent incident(s), ${metricValue(selectedCameraIncidentCount)} with downloadable video.`}
                        </span>
                      </div>
                      <button className="secondary-button" type="button" onClick={() => refreshSelectedDetail(true)} disabled={detailLoading}>
                        {detailLoading ? "Refreshing..." : "Refresh incidents"}
                      </button>
                    </div>

                    {selectedSafetyEvents.length ? (
                      <div className="statistics-safety-list">
                        {selectedSafetyEvents.slice(0, 6).map((event) => {
                          const videoCount = performanceEventVideoSources(event).length;
                          const imageCount = performanceEventImageSources(event).length;
                          return (
                            <button
                              key={`statistics-incident-${performanceEventKey(event)}`}
                              type="button"
                              className="statistics-safety-incident"
                              onClick={() => openIncident(event, { selectTruck: false })}
                            >
                              <div className="statistics-safety-incident-head">
                                <div>
                                  <strong>{formatKeyLabel(event.type || "event")}</strong>
                                  <small>{event.location || compactDate(event.end_time)}</small>
                                </div>
                                <span className={`statistics-safety-pill ${videoCount ? "live" : event.camera_available ? "pending" : "plain"}`.trim()}>
                                  {videoCount ? `${videoCount} clip${videoCount === 1 ? "" : "s"}` : imageCount ? `${imageCount} frame${imageCount === 1 ? "" : "s"}` : event.camera_available ? "Media pending" : "No clip"}
                                </span>
                              </div>
                              <div className="statistics-safety-incident-meta">
                                <span>{event.coaching_status ? formatKeyLabel(event.coaching_status) : "No coaching status"}</span>
                                <span>{event.max_speed ? `${decimalValue(event.max_speed)} mph max` : "No max speed"}</span>
                                <span>{event.severity ? formatKeyLabel(event.severity) : "Severity n/a"}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="empty-route-card compact">No recent Motive safety incidents returned for this truck yet.</div>
                    )}
                  </section>

                  <section className="statistics-trend-panel">
                    <div className="panel-head">
                      <div>
                        <h2>Profile Growth</h2>
                        <span>{detailLoading ? "Refreshing truck archive..." : "Recent daily miles from the archive that keeps building over time."}</span>
                      </div>
                    </div>
                    {(selectedStatistics?.daily_history || []).length ? (
                      <TrendBars points={(selectedStatistics?.daily_history || []).slice(-14)} />
                    ) : (
                      <div className="empty-route-card compact">Archive is still warming up for this truck. Daily bars will grow as more snapshots are saved.</div>
                    )}
                  </section>

                  <section className="statistics-history-panel">
                    <div className="panel-head">
                      <div>
                        <h2>Real-Time Trace</h2>
                        <span>{detailLoading ? "Loading live breadcrumbs..." : `${(detail?.history?.points || []).length} breadcrumb point(s) loaded`}</span>
                      </div>
                    </div>
                    {(detail?.history?.points || []).length ? (
                      <div className="statistics-history-list">
                        {(detail?.history?.points || []).slice(0, 8).map((point, index) => (
                          <div key={`${point.located_at}-${index}`} className="statistics-history-row">
                            <strong>{compactDate(point.located_at)}</strong>
                            <span>{point.display_label || point.address || point.description || "Unknown area"}</span>
                            <small>{point.speed_mph !== null && point.speed_mph !== undefined ? formatSpeed(point.speed_mph) : point.event_type || "No speed"}</small>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-route-card compact">No live breadcrumb history returned for this truck yet.</div>
                    )}
                  </section>
                </>
              ) : (
                <div className="empty-route-card">Choose a truck to open its live profile.</div>
              )}
            </aside>
          </section>
        </div>
      )}

      <IncidentViewerDialog
        event={modalIncident}
        videoKey={modalIncidentVideoKey}
        onVideoKeyChange={overlayIncident ? setOverlayIncidentVideoKey : setSelectedIncidentVideoKey}
        onClose={closeIncident}
        onRefresh={refreshIncidentMedia}
        refreshing={detailLoading}
      />
    </section>
  );
}
