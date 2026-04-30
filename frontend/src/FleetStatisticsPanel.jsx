import { useEffect, useMemo, useState } from "react";
import { buildVehicleLocationLabel } from "./locationFormatting";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const quickFocusOptions = [
  { id: "all", label: "All Trucks" },
  { id: "lowFuel", label: "Low Fuel" },
  { id: "lowMpg", label: "Low MPG" },
  { id: "faults", label: "Faults" },
  { id: "moving", label: "Moving" },
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

function metricValue(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function decimalValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(1) : "-";
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

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function boundedPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}

function parseOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function sortRows(rows, sortBy) {
  const sorted = [...rows];
  sorted.sort((left, right) => {
    if (sortBy === "fuel_low") return (left.fuelPercent ?? Number.POSITIVE_INFINITY) - (right.fuelPercent ?? Number.POSITIVE_INFINITY);
    if (sortBy === "fuel_high") return (right.fuelPercent ?? Number.NEGATIVE_INFINITY) - (left.fuelPercent ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "mpg_low") return (left.mpg ?? Number.POSITIVE_INFINITY) - (right.mpg ?? Number.POSITIVE_INFINITY);
    if (sortBy === "mpg_high") return (right.mpg ?? Number.NEGATIVE_INFINITY) - (left.mpg ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "faults") return (right.activeFaults ?? 0) - (left.activeFaults ?? 0);
    if (sortBy === "utilization") return (right.utilizationPct ?? Number.NEGATIVE_INFINITY) - (left.utilizationPct ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "drive_miles") return (right.driveMiles ?? Number.NEGATIVE_INFINITY) - (left.driveMiles ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "idle_hours") return (right.idleHours ?? Number.NEGATIVE_INFINITY) - (left.idleHours ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "age") return (right.ageMinutes ?? Number.NEGATIVE_INFINITY) - (left.ageMinutes ?? Number.NEGATIVE_INFINITY);
    if (sortBy === "driver") return left.driverName.localeCompare(right.driverName, undefined, { sensitivity: "base", numeric: true });
    return left.truckNumber.localeCompare(right.truckNumber, undefined, { sensitivity: "base", numeric: true });
  });
  return sorted;
}

function fleetStatusLabel(row) {
  if (row.isStale) return "Stale";
  if (row.isMoving) return "Moving";
  return "Stopped";
}

function fuelFilterTone(value) {
  if (!Number.isFinite(value)) return "neutral";
  if (value <= 25) return "danger";
  if (value <= 40) return "watch";
  if (value >= 75) return "strong";
  return "good";
}

export default function FleetStatisticsPanel({ token, active = true, loadRows = [] }) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quickFocus, setQuickFocus] = useState("all");
  const [filters, setFilters] = useState({
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
    minIftaMiles: "",
    maxAgeMinutes: "",
    sortBy: "truck",
  });

  useEffect(() => {
    if (!token || !active) {
      return undefined;
    }

    let ignore = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const data = await apiRequest("/motive/fleet", {}, token);
        if (!ignore) {
          setSnapshot(data);
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

    load();
    return () => {
      ignore = true;
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
      const activeFaults = Number(vehicle?.fault_summary?.active_count) || 0;
      const totalFaults = Number(vehicle?.fault_summary?.count) || 0;
      const utilizationPct = Number(vehicle?.utilization_summary?.utilization_percentage);
      const driveMiles = Number(vehicle?.driving_summary?.distance_miles);
      const idleHours = Number(vehicle?.idle_summary?.duration_seconds || 0) / 3600;
      const iftaMiles = Number(vehicle?.ifta_summary?.distance_miles);
      const ageMinutes = Number(vehicle?.location?.age_minutes);
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
        isMoving: Boolean(vehicle?.is_moving),
        isStale: Boolean(vehicle?.is_stale),
        hasDriver: driverName !== "Unassigned",
        hasLocation: Boolean(vehicle?.location),
        locationLabel: vehicleLocationLabel(vehicle),
        locationCityState: [vehicle?.location?.city, vehicle?.location?.state].filter(Boolean).join(", "),
        lastLocatedAt: vehicle?.location?.located_at || "",
        loadStatus: String(matchedLoad?.status || ""),
        loadRoute,
        searchBlob,
      };
    });
  }, [loadRows, snapshot]);

  const filteredRows = useMemo(() => {
    const searchTerm = normalizeText(filters.search);
    const minFuel = parseOptionalNumber(filters.minFuel);
    const maxFuel = parseOptionalNumber(filters.maxFuel);
    const minMpg = parseOptionalNumber(filters.minMpg);
    const maxMpg = parseOptionalNumber(filters.maxMpg);
    const minFaults = parseOptionalNumber(filters.minFaults);
    const minUtilization = parseOptionalNumber(filters.minUtilization);
    const minDriveMiles = parseOptionalNumber(filters.minDriveMiles);
    const minIdleHours = parseOptionalNumber(filters.minIdleHours);
    const minIftaMiles = parseOptionalNumber(filters.minIftaMiles);
    const maxAgeMinutes = parseOptionalNumber(filters.maxAgeMinutes);

    const nextRows = fleetRows.filter((row) => {
      if (quickFocus === "lowFuel" && (row.fuelPercent === null || row.fuelPercent > 25)) return false;
      if (quickFocus === "lowMpg" && (row.mpg === null || row.mpg >= 6)) return false;
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
      if (minIftaMiles !== null && (!Number.isFinite(row.iftaMiles) || row.iftaMiles < minIftaMiles)) return false;
      if (maxAgeMinutes !== null && (!Number.isFinite(row.ageMinutes) || row.ageMinutes > maxAgeMinutes)) return false;

      return true;
    });

    return sortRows(nextRows, filters.sortBy);
  }, [filters, fleetRows, quickFocus]);

  const visibleMetrics = useMemo(() => {
    return {
      total: filteredRows.length,
      avgFuel: average(filteredRows.map((row) => row.fuelPercent)),
      avgMpg: average(filteredRows.map((row) => row.mpg)),
      lowFuel: filteredRows.filter((row) => row.fuelPercent !== null && row.fuelPercent <= 25).length,
      withFaults: filteredRows.filter((row) => row.activeFaults > 0).length,
      moving: filteredRows.filter((row) => row.isMoving).length,
      stale: filteredRows.filter((row) => row.isStale).length,
      withLoad: filteredRows.filter((row) => row.matchedLoad).length,
    };
  }, [filteredRows]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setQuickFocus("all");
    setFilters({
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
      minIftaMiles: "",
      maxAgeMinutes: "",
      sortBy: "truck",
    });
  }

  if (!token) {
    return null;
  }

  return (
    <section className="panel fleet-statistics-panel">
      <div className="panel-head">
        <div>
          <h2>Fleet Statistics</h2>
          <span>
            {snapshot?.company?.name ? `${snapshot.company.name} truck statistics with Fuel Service load matching.` : "Filter every truck by fuel, MPG, faults, utilization, location, and load data."}
          </span>
        </div>
        <div className="fleet-statistics-head-meta">
          {snapshot?.fetched_at ? <small>Updated {compactDate(snapshot.fetched_at)}</small> : null}
          <button className="secondary-button" type="button" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      </div>

      {error ? <div className="notice error inline-notice">{error}</div> : null}

      {loading ? (
        <div className="empty-route-card">Loading fleet statistics...</div>
      ) : (
        <div className="statistics-panel-stack">
          <section className="metric-grid compact">
            <article className="metric-card">
              <span>Visible trucks</span>
              <strong>{metricValue(visibleMetrics.total)}</strong>
              <small>{metricValue(fleetRows.length)} total in fleet</small>
            </article>
            <article className="metric-card">
              <span>Avg fuel</span>
              <strong>{visibleMetrics.avgFuel !== null ? `${decimalValue(visibleMetrics.avgFuel)}%` : "-"}</strong>
              <small>{metricValue(visibleMetrics.lowFuel)} low fuel</small>
            </article>
            <article className="metric-card">
              <span>Avg MPG</span>
              <strong>{visibleMetrics.avgMpg !== null ? decimalValue(visibleMetrics.avgMpg) : "-"}</strong>
              <small>{metricValue(visibleMetrics.withLoad)} matched loads</small>
            </article>
            <article className="metric-card">
              <span>Fault units</span>
              <strong>{metricValue(visibleMetrics.withFaults)}</strong>
              <small>{metricValue(visibleMetrics.moving)} moving now</small>
            </article>
            <article className="metric-card">
              <span>Stale units</span>
              <strong>{metricValue(visibleMetrics.stale)}</strong>
              <small>Telemetry age filter ready</small>
            </article>
          </section>

          <section className="panel-filter-card">
            <div className="inline-filter-grid">
              <label>
                Search everything
                <input
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
                  <option value="truck">Truck number</option>
                  <option value="driver">Driver</option>
                  <option value="fuel_low">Fuel low to high</option>
                  <option value="fuel_high">Fuel high to low</option>
                  <option value="mpg_low">MPG low to high</option>
                  <option value="mpg_high">MPG high to low</option>
                  <option value="faults">Most faults</option>
                  <option value="utilization">Highest utilization</option>
                  <option value="drive_miles">Most drive miles</option>
                  <option value="idle_hours">Most idle hours</option>
                  <option value="age">Oldest update</option>
                </select>
              </label>
            </div>

            <div className="workspace-inline-tabs statistics-quick-tabs">
              {quickFocusOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`workspace-inline-tab ${quickFocus === option.id ? "active" : ""}`}
                  onClick={() => setQuickFocus(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="panel-filter-summary">
              Filter all trucks by text, fuel, MPG, faults, utilization, drive miles, idle time, IFTA, stale age, assignment, fuel type, and load status.
            </div>
          </section>

          <section className="panel-filter-card">
            <div className="inline-filter-grid">
              <label>
                Min fuel %
                <input type="number" min="0" max="100" value={filters.minFuel} onChange={(event) => updateFilter("minFuel", event.target.value)} placeholder="0" />
              </label>
              <label>
                Max fuel %
                <input type="number" min="0" max="100" value={filters.maxFuel} onChange={(event) => updateFilter("maxFuel", event.target.value)} placeholder="100" />
              </label>
              <label>
                Min MPG
                <input type="number" min="0" step="0.1" value={filters.minMpg} onChange={(event) => updateFilter("minMpg", event.target.value)} placeholder="5.0" />
              </label>
              <label>
                Max MPG
                <input type="number" min="0" step="0.1" value={filters.maxMpg} onChange={(event) => updateFilter("maxMpg", event.target.value)} placeholder="9.0" />
              </label>
              <label>
                Min active faults
                <input type="number" min="0" value={filters.minFaults} onChange={(event) => updateFilter("minFaults", event.target.value)} placeholder="1" />
              </label>
              <label>
                Min utilization %
                <input type="number" min="0" step="0.1" value={filters.minUtilization} onChange={(event) => updateFilter("minUtilization", event.target.value)} placeholder="50" />
              </label>
              <label>
                Min drive miles
                <input type="number" min="0" step="0.1" value={filters.minDriveMiles} onChange={(event) => updateFilter("minDriveMiles", event.target.value)} placeholder="500" />
              </label>
              <label>
                Min idle hours
                <input type="number" min="0" step="0.1" value={filters.minIdleHours} onChange={(event) => updateFilter("minIdleHours", event.target.value)} placeholder="5" />
              </label>
              <label>
                Min IFTA miles
                <input type="number" min="0" step="0.1" value={filters.minIftaMiles} onChange={(event) => updateFilter("minIftaMiles", event.target.value)} placeholder="1000" />
              </label>
              <label>
                Max age minutes
                <input type="number" min="0" step="0.1" value={filters.maxAgeMinutes} onChange={(event) => updateFilter("maxAgeMinutes", event.target.value)} placeholder="30" />
              </label>
            </div>
          </section>

          <section className="panel workspace-table-panel">
            <div className="panel-head">
              <div>
                <h2>Truck Table</h2>
                <span>{filteredRows.length} truck row(s) match the current statistics filters.</span>
              </div>
            </div>

            <div className="sheet-frame">
              <div className="sheet-scroll">
                <table className="dispatch-sheet statistics-table">
                  <thead>
                    <tr>
                      <th>Truck</th>
                      <th>Driver</th>
                      <th>Fuel</th>
                      <th>MPG</th>
                      <th>Faults</th>
                      <th>Utilization</th>
                      <th>Drive / Idle</th>
                      <th>IFTA</th>
                      <th>Fleet Status</th>
                      <th>Load</th>
                      <th>Location</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length ? filteredRows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.truckNumber}</strong>
                          <small>{row.unitLabel || row.vin || "Truck"}</small>
                        </td>
                        <td>
                          <strong>{row.driverName}</strong>
                          <small>{row.hasDriver ? "Driver assigned" : "No current driver"}</small>
                        </td>
                        <td>
                          <strong className={`statistics-fuel-${fuelFilterTone(row.fuelPercent)}`}>
                            {row.fuelPercent !== null ? `${decimalValue(row.fuelPercent)}%` : "-"}
                          </strong>
                          <small>{row.fuelType || "Fuel n/a"}</small>
                        </td>
                        <td>
                          <strong>{row.mpg !== null ? decimalValue(row.mpg) : "-"}</strong>
                          <small>{row.mpgSource || "No MPG source"}</small>
                        </td>
                        <td>
                          <strong>{metricValue(row.activeFaults)}</strong>
                          <small>{metricValue(row.totalFaults)} total recent</small>
                        </td>
                        <td>
                          <strong>{row.utilizationPct !== null ? `${decimalValue(row.utilizationPct)}%` : "-"}</strong>
                          <small>7-day utilization</small>
                        </td>
                        <td>
                          <strong>{row.driveMiles !== null ? `${metricValue(row.driveMiles)} mi` : "-"}</strong>
                          <small>{row.idleHours !== null ? `${decimalValue(row.idleHours)} idle h` : "Idle n/a"}</small>
                        </td>
                        <td>
                          <strong>{row.iftaMiles !== null ? `${metricValue(row.iftaMiles)} mi` : "-"}</strong>
                          <small>IFTA distance</small>
                        </td>
                        <td>
                          <strong>{fleetStatusLabel(row)}</strong>
                          <small>{row.ageMinutes !== null ? `${decimalValue(row.ageMinutes)} min age` : "Age unknown"}</small>
                        </td>
                        <td>
                          <strong>{row.loadStatus || "No matched load"}</strong>
                          <small>{row.loadRoute || "No route from Loads"}</small>
                        </td>
                        <td>
                          <strong>{row.locationLabel}</strong>
                          <small>{row.locationCityState || "No city/state"}</small>
                        </td>
                        <td>
                          <strong>{compactDate(row.lastLocatedAt)}</strong>
                          <small>{row.hasLocation ? "Live Motive location" : "No live GPS"}</small>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="12">
                          <div className="empty-route-card compact">No trucks match the current statistics filters.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
