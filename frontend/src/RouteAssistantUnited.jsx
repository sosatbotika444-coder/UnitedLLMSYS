import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  formatPriceTarget,
  getAutoDieselPrice,
  getPriceSignalClass,
  getPriceSignalMeta,
  parsePriceTarget
} from "./priceSignals";

const RouteMap = lazy(() => import("./RouteMap"));

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const routeColors = ["#1d4ed8", "#0f766e", "#ea580c"];
const defaultFilters = {
  sort_by: "best",
  search: "",
  max_off_route: "50",
  price_target: "",
  ui_sort: "best"
};
const DEFAULT_TANK_CAPACITY_GALLONS = 200;
const DEFAULT_CURRENT_FUEL_GALLONS = 100;
const DEFAULT_TRUCK_MPG = 6.0;
const LOCATION_SUGGESTION_LIMIT = 6;
const DEFAULT_API_TIMEOUT_MS = 20000;
const ROUTE_REQUEST_TIMEOUT_MS = 120000;
const ROUTE_PROGRESS_STEPS = [
  { afterSeconds: 0, label: "Tracing the route corridor and matching Love's / Pilot locations..." },
  { afterSeconds: 12, label: "Refreshing live network prices from official sources..." },
  { afterSeconds: 28, label: "Finishing detour checks and ranking the best stops..." }
];

function formatDistance(meters) {
  if (!meters) return "0 mi";
  return `${(meters * 0.000621371).toFixed(1)} mi`;
}

function formatMiles(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${Number(value).toFixed(1)} mi`;
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function toOptionalNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0.00";
  return `$${parsed.toFixed(2)}`;
}

function formatFuelPrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0.000";
  return `$${parsed.toFixed(3)}`;
}

function formatGallons(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0.0 gal";
  return `${parsed.toFixed(1)} gal`;
}

function getStrategyStatusLabel(status) {
  if (status === "planned") return "Smart route ready";
  if (status === "direct") return "No fuel stop needed";
  if (status === "unreachable") return "Needs more fuel range";
  return "Fuel plan";
}

function uniqueRouteStops(routePlan) {
  if (!routePlan) return [];
  const byId = new Map();
  const stops = [
    ...(routePlan.top_fuel_stops || []),
    ...(routePlan.routes || []).flatMap((route) => route.fuel_stops || [])
  ];

  stops.forEach((stop) => {
    const key = stop.id || `${stop.lat},${stop.lon}`;
    const existing = byId.get(key);
    if (!existing || (getAutoDieselPrice(stop) ?? Number.POSITIVE_INFINITY) < (getAutoDieselPrice(existing) ?? Number.POSITIVE_INFINITY)) {
      byId.set(key, stop);
    }
  });

  return [...byId.values()];
}

function clampStopCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(3, parsed));
}

function routeOrderValue(stop) {
  if (stop.origin_miles !== null && stop.origin_miles !== undefined) return Number(stop.origin_miles);
  return Number(stop.detour_distance_meters ?? Number.POSITIVE_INFINITY);
}

function buildStopsRouteLink(routePlan, stops) {
  if (!routePlan || !stops.length) return "";
  const params = new URLSearchParams({
    api: "1",
    origin: routePlan.origin.label || `${routePlan.origin.lat},${routePlan.origin.lon}`,
    destination: routePlan.destination.label || `${routePlan.destination.lat},${routePlan.destination.lon}`,
    travelmode: "driving"
  });
  params.set("waypoints", stops.map((stop) => `${stop.lat},${stop.lon}`).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}


function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function formatPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "Unknown";
  return `${parsed.toFixed(1)}%`;
}

function clampPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatMpg(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "MPG unknown";
  return `${parsed.toFixed(1)} MPG`;
}

function resolveVehicleMpgInfo(vehicle) {
  const directMpg = toPositiveNumber(vehicle?.mpg);
  if (directMpg !== null) {
    return {
      value: directMpg,
      source: vehicle?.mpg_source || "Motive truck MPG"
    };
  }

  const totalDistanceMiles = toPositiveNumber(vehicle?.utilization_summary?.total_distance_miles);
  const totalFuelGallons = toPositiveNumber(vehicle?.utilization_summary?.total_fuel);
  if (totalDistanceMiles !== null && totalFuelGallons !== null) {
    return {
      value: totalDistanceMiles / totalFuelGallons,
      source: "Motive 7-day total distance vs total fuel"
    };
  }

  const drivingDistanceMiles = toPositiveNumber(vehicle?.driving_summary?.distance_miles);
  const drivingFuelGallons = toPositiveNumber(vehicle?.utilization_summary?.driving_fuel);
  if (drivingDistanceMiles !== null && drivingFuelGallons !== null) {
    return {
      value: drivingDistanceMiles / drivingFuelGallons,
      source: "Motive 7-day driving distance vs driving fuel"
    };
  }

  return {
    value: null,
    source: ""
  };
}

function resolveFuelPercent(vehicle) {
  const location = vehicle?.location || {};
  return clampPercent(
    location.fuel_level_percent
    ?? location.fuel_primary_remaining_percentage
    ?? location.fuel_remaining_percentage
    ?? location.fuel_percentage
    ?? null
  );
}

function hasFuelSensor(vehicle) {
  return Number.isFinite(Number(vehicle?.location?.fuel_sensor_reading));
}

function fuelOptionText(vehicle) {
  const fuelPercent = resolveFuelPercent(vehicle);
  if (fuelPercent !== null) {
    return `${formatPercent(fuelPercent)} fuel`;
  }
  if (hasFuelSensor(vehicle)) {
    return "Fuel sensor only";
  }
  return "Fuel unknown";
}

function locationSuggestionMeta(suggestion) {
  if (!suggestion) return "";
  if (suggestion.secondary_text) return suggestion.secondary_text;
  if (suggestion.type) return suggestion.type;
  return "TomTom location";
}

function vehicleMatchesSearch(vehicle, term) {
  if (!term) return true;
  const haystack = [
    vehicleLabel(vehicle),
    vehicleDriverName(vehicle),
    vehicle?.vin,
    vehicle?.license_plate_number,
    vehicle?.make,
    vehicle?.model,
    vehicleLocationLabel(vehicle),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

function includeSelectedVehicle(vehicles, selectedVehicle) {
  if (!selectedVehicle?.id) return vehicles;
  return vehicles.some((vehicle) => String(vehicle.id) === String(selectedVehicle.id))
    ? vehicles
    : [selectedVehicle, ...vehicles];
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
  if (!vehicle?.location) return "";
  return vehicle.location.address || [vehicle.location.city, vehicle.location.state].filter(Boolean).join(", ") || "";
}

function truckOptionLabel(vehicle) {
  const parts = [vehicleLabel(vehicle)];
  const driverName = vehicleDriverName(vehicle);
  if (driverName && driverName !== "Unassigned") {
    parts.push(driverName);
  }
  parts.push(fuelOptionText(vehicle));
  parts.push(formatMpg(resolveVehicleMpgInfo(vehicle).value));
  return parts.join(" - ");
}

function driverOptionLabel(vehicle) {
  const driverName = vehicleDriverName(vehicle);
  const parts = [driverName === "Unassigned" ? "Unassigned" : driverName, vehicleLabel(vehicle), fuelOptionText(vehicle), formatMpg(resolveVehicleMpgInfo(vehicle).value)];
  return parts.join(" - ");
}

function findMatchingLoadRow(vehicle, loadRows) {
  if (!vehicle || !Array.isArray(loadRows) || !loadRows.length) return null;
  const vehicleId = Number(vehicle?.id);
  if (Number.isFinite(vehicleId) && vehicleId > 0) {
    const directMatch = loadRows.find((row) => Number(row?.vehicle_id) === vehicleId);
    if (directMatch) return directMatch;
  }
  const truckCandidates = [vehicle.number, vehicle.vin, vehicle.license_plate_number].map(normalizeText).filter(Boolean);
  const driverCandidates = [vehicle?.resolved_driver?.full_name, vehicle?.driver?.full_name, vehicle?.permanent_driver?.full_name].map(normalizeText).filter(Boolean);

  return loadRows.find((row) => {
    const rowTruck = normalizeText(row?.truck);
    const rowDriver = normalizeText(row?.driver);

    const truckMatch = truckCandidates.some((candidate) =>
      candidate && rowTruck && (candidate === rowTruck || candidate.includes(rowTruck) || rowTruck.includes(candidate))
    );
    const driverMatch = driverCandidates.some((candidate) =>
      candidate && rowDriver && (candidate === rowDriver || candidate.includes(rowDriver) || rowDriver.includes(candidate))
    );

    return truckMatch || driverMatch;
  }) || null;
}

function deriveTruckPreset(vehicle, loadRows) {
  const matchedLoad = findMatchingLoadRow(vehicle, loadRows);
  const fuelPercent = resolveFuelPercent(vehicle);
  const matchedLoadFuelPercent = clampPercent(matchedLoad?.fuel_level);
  const hasSensorOnlyFuel = fuelPercent === null && hasFuelSensor(vehicle);
  const effectiveFuelPercent = fuelPercent ?? matchedLoadFuelPercent;
  const currentFuelGallons = effectiveFuelPercent !== null
    ? (DEFAULT_TANK_CAPACITY_GALLONS * effectiveFuelPercent) / 100
    : DEFAULT_CURRENT_FUEL_GALLONS;
  const motiveMpg = resolveVehicleMpgInfo(vehicle);
  const matchedMpg = toPositiveNumber(matchedLoad?.mpg);
  const mpg = motiveMpg.value ?? matchedMpg ?? DEFAULT_TRUCK_MPG;

  let fuelSource = `Fallback ${DEFAULT_CURRENT_FUEL_GALLONS} gal preset`;
  if (fuelPercent !== null) {
    fuelSource = `${formatPercent(fuelPercent)} from Motive`;
  } else if (matchedLoadFuelPercent !== null) {
    fuelSource = `${formatPercent(matchedLoadFuelPercent)} from Loads board (Motive fuel % unavailable)`;
  } else if (hasSensorOnlyFuel) {
    fuelSource = `Motive sent fuel sensor only, so Routing kept the safe ${DEFAULT_CURRENT_FUEL_GALLONS} gal fallback`;
  }

  return {
    currentFuelGallons,
    tankCapacityGallons: DEFAULT_TANK_CAPACITY_GALLONS,
    fuelPercent,
    hasSensorOnlyFuel,
    fuelSource,
    mpg,
    mpgSource: motiveMpg.value !== null
      ? motiveMpg.source
      : matchedMpg !== null
        ? "MPG matched from Loads board"
        : `Default truck MPG ${DEFAULT_TRUCK_MPG.toFixed(1)}`,
    matchedLoad,
  };
}


async function apiRequest(path, options = {}, token = "") {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, ...fetchOptions } = options;
  const headers = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      headers,
      signal: fetchOptions.signal || controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutSeconds = Math.round(timeoutMs / 1000);
      if (path === "/navigation/route-assistant") {
        throw new Error(`Route build timed out after ${timeoutSeconds}s. The backend did not finish checking live prices in time.`);
      }
      throw new Error(`Request timed out after ${timeoutSeconds}s.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

function sortStops(stops, mode) {
  const sorted = [...stops];
  sorted.sort((left, right) => {
    if (mode === "closest") {
      const leftMiles = left.off_route_miles ?? Number.POSITIVE_INFINITY;
      const rightMiles = right.off_route_miles ?? Number.POSITIVE_INFINITY;
      if (leftMiles !== rightMiles) return leftMiles - rightMiles;
    }

    if (mode === "brand") {
      const leftBrand = left.amenity_score ?? 0;
      const rightBrand = right.amenity_score ?? 0;
      if (leftBrand !== rightBrand) return rightBrand - leftBrand;
    }

    const leftScore = left.overall_score ?? 0;
    const rightScore = right.overall_score ?? 0;
    if (leftScore !== rightScore) return rightScore - leftScore;

    return (left.detour_distance_meters ?? Number.POSITIVE_INFINITY) - (right.detour_distance_meters ?? Number.POSITIVE_INFINITY);
  });
  return sorted;
}

function getNetworkTone(stop) {
  const haystack = `${stop.brand || ""} ${stop.name || ""}`.toLowerCase();
  if (haystack.includes("love")) return "network-loves";
  if (haystack.includes("pilot") || haystack.includes("flying j")) return "network-pilot";
  return "network-travel";
}

function getNetworkLabel(stop) {
  const haystack = `${stop.brand || ""} ${stop.name || ""}`.toLowerCase();
  if (haystack.includes("love")) return "Love's";
  if (haystack.includes("pilot") || haystack.includes("flying j")) return "Pilot Flying J";
  return stop.brand || stop.name || "Fuel Stop";
}

function priceStatusLabel(status) {
  if (status === "live") return "Live official price";
  if (status === "live_cache") return "Recently refreshed price";
  if (status === "recent_cache") return "Recent official cache";
  if (status === "catalog_cache") return "Catalog official price";
  if (status === "unavailable") return "Official price unavailable";
  return "Official network price";
}

function formatPriceUpdatedAt(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
}

function priceSourceLine(stop, priceSignalMeta) {
  const parts = [priceStatusLabel(stop.price_status), stop.price_source || "Official Love's/Pilot network page"];
  const updatedAt = formatPriceUpdatedAt(stop.price_updated_at || stop.price_date);
  if (updatedAt) parts.push(updatedAt);
  if (priceSignalMeta.target !== null) parts.push(priceSignalMeta.summary);
  return parts.filter(Boolean).join(" | ");
}
function StopCard({ stop, compact = false, priceTarget = null }) {
  const tone = getNetworkTone(stop);
  const autoDieselPrice = getAutoDieselPrice(stop);
  const priceSignalMeta = getPriceSignalMeta(stop, priceTarget);
  const priceSignalClass = getPriceSignalClass(priceSignalMeta.signal);
  return (
    <article className={`fuel-stop-card fuel-stop-card-brand ${tone} ${priceSignalClass} ${compact ? "fuel-stop-card-compact" : ""}`.trim()}>
      <div className="fuel-stop-top">
        <div>
          <div className="fuel-stop-chip-row">
            <span className="network-chip">{getNetworkLabel(stop)}</span>
            {priceSignalMeta.target !== null ? <span className={`price-target-chip ${priceSignalClass}`.trim()}>{priceSignalMeta.label}</span> : null}
          </div>
          <strong>{stop.brand || stop.name}</strong>
          <span>{stop.city}{stop.state_code ? `, ${stop.state_code}` : ""}</span>
          {stop.location_type ? <span>{stop.location_type}{stop.store_number ? ` - #${stop.store_number}` : ""}</span> : stop.store_number ? <span>Store #{stop.store_number}</span> : null}
        </div>
        <div className="fuel-stop-score">
          <strong>{Math.round(stop.overall_score || 0)}</strong>
          <span>rank</span>
        </div>
      </div>

      <p>{stop.address}</p>

      <div className={`fuel-price-row fuel-price-row-brand ${priceSignalClass}`.trim()}>
        <div>
          <strong>{autoDieselPrice !== null ? `$${autoDieselPrice.toFixed(3)}/gal` : "Auto diesel price not published"}</strong>
          <span>{priceSourceLine(stop, priceSignalMeta)}</span>

        </div>
        {stop.source_url ? (
          <a className="fuel-source-link" href={stop.source_url} target="_blank" rel="noreferrer">
            Official page
          </a>
        ) : null}
      </div>

      <div className="fuel-stop-stat-grid">
        <span><strong>Auto Diesel</strong>{autoDieselPrice !== null ? `$${autoDieselPrice.toFixed(3)}` : "-"}</span>
        <span><strong>Unleaded</strong>{stop.unleaded_price !== null && stop.unleaded_price !== undefined ? `$${stop.unleaded_price.toFixed(3)}` : "-"}</span>
        <span><strong>Phone</strong>{stop.phone || "-"}</span>
        <span><strong>Store</strong>{stop.store_number || "-"}</span>
      </div>

      <div className="fuel-stop-coords">
        <strong>{stop.official_match ? "Verified" : "Coords"}</strong>
        <span>{stop.official_match ? `Official Love's/Pilot location (${Number(stop.lat).toFixed(5)}, ${Number(stop.lon).toFixed(5)})` : `${Number(stop.lat).toFixed(5)}, ${Number(stop.lon).toFixed(5)}`}</span>
      </div>

      <div className="fuel-stop-stat-grid">
        <span><strong>Off route</strong>{formatMiles(stop.off_route_miles)}</span>
        <span><strong>Detour</strong>{formatDuration(stop.detour_time_seconds)}</span>
        <span><strong>Route match</strong>{Math.round(stop.amenity_score || 0)}</span>
        <span><strong>Distance</strong>{formatDistance(stop.detour_distance_meters)}</span>
      </div>

      {(stop.highway || stop.exit_number || stop.parking_spaces) ? (
        <div className="fuel-stop-coords">
          <strong>Truck Info</strong>
          <span>{[stop.highway, stop.exit_number, stop.parking_spaces].filter(Boolean).join(" / ")}</span>
        </div>
      ) : null}

      {stop.amenities?.length ? (
        <div className="fuel-stop-coords">
          <strong>Services</strong>
          <span>{stop.amenities.slice(0, 8).join(", ")}</span>
        </div>
      ) : null}
    </article>
  );
}

export default function RouteAssistant({ token, active = true, loadRows = [], fleetSnapshotOverride = null, fixedVehicleId = "", lockedVehicle = false, driverMode = false }) {
  const [routeForm, setRouteForm] = useState({
    origin: "Chicago, IL",
    destination: "Dallas, TX",
    fuel_type: "Auto Diesel",
    vehicle_type: "Truck",
    current_fuel_gallons: String(DEFAULT_CURRENT_FUEL_GALLONS),
    tank_capacity_gallons: String(DEFAULT_TANK_CAPACITY_GALLONS),
    mpg: DEFAULT_TRUCK_MPG.toFixed(1)
  });
  const [routePlan, setRoutePlan] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");
  const [approvalMessage, setApprovalMessage] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [approvalBusyKey, setApprovalBusyKey] = useState("");
  const [routeLoadingSeconds, setRouteLoadingSeconds] = useState(0);
  const [fleetSnapshot, setFleetSnapshot] = useState(null);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [fleetError, setFleetError] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState(() => fixedVehicleId ? String(fixedVehicleId) : "");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [activeFilters, setActiveFilters] = useState(defaultFilters);
  const [cheapStopCount, setCheapStopCount] = useState("3");
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const mapStageRef = useRef(null);
  const blurTimerRef = useRef(null);
  const locationSuggestionCacheRef = useRef(new Map());
  const [locationFieldFocus, setLocationFieldFocus] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState({ origin: [], destination: [] });
  const [locationSuggestionLoading, setLocationSuggestionLoading] = useState({ origin: false, destination: false });
  const fuelStrategy = routePlan?.fuel_strategy || null;
  const fullTankRangePreview = useMemo(() => {
    const capacity = Number(routeForm.tank_capacity_gallons);
    const mpg = Number(routeForm.mpg);
    if (!Number.isFinite(capacity) || !Number.isFinite(mpg) || capacity <= 0 || mpg <= 0) return "-";
    return `${(capacity * mpg).toFixed(0)} mi`;
  }, [routeForm.mpg, routeForm.tank_capacity_gallons]);
  const originSuggestionPanelOpen = locationFieldFocus === "origin" && routeForm.origin.trim().length >= 2;
  const destinationSuggestionPanelOpen = locationFieldFocus === "destination" && routeForm.destination.trim().length >= 2;
  const activeLocationQuery = useMemo(() => {
    if (locationFieldFocus === "origin") return routeForm.origin.trim();
    if (locationFieldFocus === "destination") return routeForm.destination.trim();
    return "";
  }, [locationFieldFocus, routeForm.destination, routeForm.origin]);

  useEffect(() => {
    if (!routeLoading) {
      setRouteLoadingSeconds(0);
      return undefined;
    }

    setRouteLoadingSeconds(0);
    const timerId = window.setInterval(() => {
      setRouteLoadingSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [routeLoading]);

  const routeLoadingMessage = ROUTE_PROGRESS_STEPS.reduce((message, step) => (
    routeLoadingSeconds >= step.afterSeconds ? step.label : message
  ), ROUTE_PROGRESS_STEPS[0].label);
  const activePriceTarget = useMemo(() => parsePriceTarget(activeFilters.price_target), [activeFilters.price_target]);
  const smartFuelPriceTarget = useMemo(() => parsePriceTarget(fuelStrategy?.price_target), [fuelStrategy?.price_target]);
  const plannerNeedsRefresh = useMemo(() => {
    if (!routePlan) return false;
    const draftPriceTarget = parsePriceTarget(draftFilters.price_target);
    const appliedPriceTarget = parsePriceTarget(activeFilters.price_target);
    return draftFilters.sort_by !== activeFilters.sort_by || draftPriceTarget !== appliedPriceTarget;
  }, [activeFilters.price_target, activeFilters.sort_by, draftFilters.price_target, draftFilters.sort_by, routePlan]);

  function setSuggestionsForField(field, suggestions) {
    setLocationSuggestions((current) => ({ ...current, [field]: suggestions }));
  }

  function setSuggestionLoading(field, isLoading) {
    setLocationSuggestionLoading((current) => ({ ...current, [field]: isLoading }));
  }

  function focusLocationField(field) {
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setLocationFieldFocus(field);
  }

  function hideLocationField(field) {
    setLocationFieldFocus((current) => (current === field ? "" : current));
    setSuggestionLoading(field, false);
  }

  function handleLocationInputChange(field, value) {
    setRouteForm((current) => ({ ...current, [field]: value }));
    focusLocationField(field);
    if (value.trim().length < 2) {
      setSuggestionsForField(field, []);
      setSuggestionLoading(field, false);
    }
  }

  function handleLocationBlur(field) {
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
    }
    blurTimerRef.current = window.setTimeout(() => {
      hideLocationField(field);
      blurTimerRef.current = null;
    }, 120);
  }

  function selectLocationSuggestion(field, suggestion) {
    setRouteForm((current) => ({ ...current, [field]: suggestion.label }));
    setSuggestionsForField(field, []);
    setSuggestionLoading(field, false);
    setLocationFieldFocus("");
  }

  function renderLocationSuggestions(field) {
    const suggestions = locationSuggestions[field] || [];
    const isLoading = Boolean(locationSuggestionLoading[field]);
    const isOpen = field === "origin" ? originSuggestionPanelOpen : destinationSuggestionPanelOpen;
    if (!isOpen) return null;

    return (
      <div className="route-location-suggestions">
        {isLoading ? <div className="route-location-suggestions-empty">Searching real locations...</div> : null}
        {!isLoading && suggestions.length ? suggestions.map((suggestion) => (
          <button
            key={`${field}-${suggestion.id}-${suggestion.lat}-${suggestion.lon}`}
            type="button"
            className="route-location-suggestion"
            onMouseDown={(event) => {
              event.preventDefault();
              selectLocationSuggestion(field, suggestion);
            }}
          >
            <strong>{suggestion.label}</strong>
            <span>{locationSuggestionMeta(suggestion)}</span>
          </button>
        )) : null}
        {!isLoading && !suggestions.length ? <div className="route-location-suggestions-empty">No matching locations found.</div> : null}
      </div>
    );
  }

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!token || !active || !locationFieldFocus) {
      return undefined;
    }

    const field = locationFieldFocus;
    const query = activeLocationQuery;
    if (query.length < 2) {
      setSuggestionsForField(field, []);
      setSuggestionLoading(field, false);
      return undefined;
    }

    const cacheKey = `${field}:${query.toLowerCase()}`;
    const cachedSuggestions = locationSuggestionCacheRef.current.get(cacheKey);
    if (cachedSuggestions) {
      setSuggestionsForField(field, cachedSuggestions);
      setSuggestionLoading(field, false);
      return undefined;
    }

    let ignore = false;
    setSuggestionsForField(field, []);
    setSuggestionLoading(field, true);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query, limit: String(LOCATION_SUGGESTION_LIMIT) });
        const data = await apiRequest(`/navigation/location-suggestions?${params.toString()}`, {}, token);
        const nextSuggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
        locationSuggestionCacheRef.current.set(cacheKey, nextSuggestions);
        if (!ignore) {
          setSuggestionsForField(field, nextSuggestions);
        }
      } catch {
        if (!ignore) {
          setSuggestionsForField(field, []);
        }
      } finally {
        if (!ignore) {
          setSuggestionLoading(field, false);
        }
      }
    }, 260);

    return () => {
      ignore = true;
      window.clearTimeout(timer);
    };
  }, [active, activeLocationQuery, locationFieldFocus, token]);

  useEffect(() => {
    if (fleetSnapshotOverride) {
      setFleetError("");
      setFleetLoading(false);
      return undefined;
    }

    if (!token || !active || fleetSnapshot) {
      return undefined;
    }

    let ignore = false;

    async function loadFleet() {
      setFleetLoading(true);
      setFleetError("");
      try {
        const data = await apiRequest("/motive/fleet", {}, token);
        if (!ignore) {
          setFleetSnapshot(data);
        }
      } catch (fetchError) {
        if (!ignore) {
          setFleetError(fetchError.message);
        }
      } finally {
        if (!ignore) {
          setFleetLoading(false);
        }
      }
    }

    loadFleet();
    return () => {
      ignore = true;
    };
  }, [active, fleetSnapshot, fleetSnapshotOverride, token]);

  const effectiveFleetSnapshot = fleetSnapshotOverride || fleetSnapshot;

  useEffect(() => {
    if (fixedVehicleId) {
      setSelectedVehicleId(String(fixedVehicleId));
    }
  }, [fixedVehicleId]);

  const fleetVehicles = useMemo(() => {
    const vehicles = [...(effectiveFleetSnapshot?.vehicles || [])];
    return vehicles.sort((left, right) => vehicleLabel(left).localeCompare(vehicleLabel(right), undefined, { numeric: true, sensitivity: "base" }));
  }, [effectiveFleetSnapshot]);

  useEffect(() => {
    if (!fleetVehicles.length) {
      if (selectedVehicleId) {
        setSelectedVehicleId("");
      }
      return;
    }

    if (selectedVehicleId && fleetVehicles.some((vehicle) => String(vehicle.id) === String(selectedVehicleId))) {
      return;
    }

    const fixedVehicle = fixedVehicleId ? fleetVehicles.find((vehicle) => String(vehicle.id) === String(fixedVehicleId)) : null;
    const defaultVehicle = fixedVehicle || fleetVehicles.find((vehicle) => vehicleDriver(vehicle)) || fleetVehicles[0];
    setSelectedVehicleId(String(defaultVehicle.id));
  }, [fixedVehicleId, fleetVehicles, selectedVehicleId]);

  const selectedVehicle = useMemo(() => {
    if (!fleetVehicles.length) return null;
    return fleetVehicles.find((vehicle) => String(vehicle.id) === String(selectedVehicleId)) || fleetVehicles[0] || null;
  }, [fleetVehicles, selectedVehicleId]);

  const normalizedVehicleSearch = useMemo(() => normalizeText(vehicleSearch), [vehicleSearch]);
  const filteredFleetVehicles = useMemo(() => {
    if (!normalizedVehicleSearch) return fleetVehicles;
    return fleetVehicles.filter((vehicle) => vehicleMatchesSearch(vehicle, normalizedVehicleSearch));
  }, [fleetVehicles, normalizedVehicleSearch]);
  const visibleTruckVehicles = useMemo(
    () => includeSelectedVehicle(filteredFleetVehicles, selectedVehicle),
    [filteredFleetVehicles, selectedVehicle]
  );
  const visibleDriverVehicles = useMemo(
    () => includeSelectedVehicle(filteredFleetVehicles.filter((vehicle) => vehicleDriver(vehicle)), selectedVehicle && vehicleDriver(selectedVehicle) ? selectedVehicle : null),
    [filteredFleetVehicles, selectedVehicle]
  );

  const selectedVehiclePreset = useMemo(() => deriveTruckPreset(selectedVehicle, loadRows), [loadRows, selectedVehicle]);
  const selectedVehicleDriver = useMemo(() => vehicleDriver(selectedVehicle), [selectedVehicle]);
  const selectedVehicleLocation = useMemo(() => vehicleLocationLabel(selectedVehicle), [selectedVehicle]);
  const driverVehicleOptions = useMemo(
    () => visibleDriverVehicles.map((vehicle) => ({
      id: String(vehicle.id),
      label: driverOptionLabel(vehicle),
      meta: vehicleDriver(vehicle)?.email || vehicleDriver(vehicle)?.phone || vehicleLocationLabel(vehicle) || fuelOptionText(vehicle)
    })),
    [visibleDriverVehicles]
  );

  useEffect(() => {
    if (!driverMode || !selectedVehicleLocation) {
      return;
    }

    setRouteForm((current) => {
      if (current.origin && current.origin !== "Chicago, IL") {
        return current;
      }
      return { ...current, origin: selectedVehicleLocation };
    });
  }, [driverMode, selectedVehicleLocation]);

  useEffect(() => {
    const nextCurrentFuelGallons = selectedVehiclePreset.currentFuelGallons.toFixed(1);
    const nextTankCapacity = String(selectedVehiclePreset.tankCapacityGallons);
    const nextMpg = selectedVehiclePreset.mpg.toFixed(1);

    setRouteForm((current) => {
      if (
        current.fuel_type === "Auto Diesel" &&
        current.vehicle_type === "Truck" &&
        current.current_fuel_gallons === nextCurrentFuelGallons &&
        current.tank_capacity_gallons === nextTankCapacity &&
        current.mpg === nextMpg
      ) {
        return current;
      }

      return {
        ...current,
        fuel_type: "Auto Diesel",
        vehicle_type: "Truck",
        current_fuel_gallons: nextCurrentFuelGallons,
        tank_capacity_gallons: nextTankCapacity,
        mpg: nextMpg
      };
    });
  }, [selectedVehiclePreset.currentFuelGallons, selectedVehiclePreset.mpg, selectedVehiclePreset.tankCapacityGallons]);

  const visibleStops = useMemo(() => {
    if (!routePlan) return [];
    const normalizedSearch = activeFilters.search.trim().toLowerCase();
    const maxOffRoute = Number(activeFilters.max_off_route || 0);
    const sourceStops = routePlan.routes?.[0]?.fuel_stops?.length ? routePlan.routes[0].fuel_stops : routePlan.top_fuel_stops;
    const filtered = sourceStops.filter((stop) => {
      const haystack = `${stop.brand || ""} ${stop.name || ""} ${stop.address || ""} ${stop.city || ""}`.toLowerCase();
      const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
      const matchesOffRoute = !maxOffRoute || (stop.off_route_miles || 0) <= maxOffRoute;
      return matchesSearch && matchesOffRoute;
    });
    return sortStops(filtered, activeFilters.ui_sort);
  }, [activeFilters, routePlan]);

  const bestStops = useMemo(() => sortStops(visibleStops, "best").slice(0, 4), [visibleStops]);
  const closestStops = useMemo(() => sortStops(visibleStops, "closest").slice(0, 4), [visibleStops]);
  const brandPowerStops = useMemo(() => sortStops(visibleStops, "brand").slice(0, 4), [visibleStops]);
  const cheapestAutoDieselStops = useMemo(() => {
    const count = clampStopCount(cheapStopCount);
    return uniqueRouteStops(routePlan)
      .map((stop) => ({ ...stop, autoDieselPlanPrice: getAutoDieselPrice(stop) }))
      .filter((stop) => stop.autoDieselPlanPrice !== null && Number.isFinite(stop.autoDieselPlanPrice))
      .sort((left, right) => {
        if (left.autoDieselPlanPrice !== right.autoDieselPlanPrice) return left.autoDieselPlanPrice - right.autoDieselPlanPrice;
        const leftOffRoute = left.off_route_miles ?? Number.POSITIVE_INFINITY;
        const rightOffRoute = right.off_route_miles ?? Number.POSITIVE_INFINITY;
        if (leftOffRoute !== rightOffRoute) return leftOffRoute - rightOffRoute;
        return routeOrderValue(left) - routeOrderValue(right);
      })
      .slice(0, count);
  }, [cheapStopCount, routePlan]);
  const cheapestStopsRouteOrder = useMemo(
    () => [...cheapestAutoDieselStops].sort((left, right) => routeOrderValue(left) - routeOrderValue(right)),
    [cheapestAutoDieselStops]
  );
  const cheapestStopsRouteLink = useMemo(
    () => buildStopsRouteLink(routePlan, cheapestStopsRouteOrder),
    [cheapestStopsRouteOrder, routePlan]
  );
  const priceTargetStats = useMemo(() => {
    if (activePriceTarget === null) return null;

    return visibleStops.reduce((stats, stop) => {
      const signal = getPriceSignalMeta(stop, activePriceTarget).signal;
      if (signal === "below") stats.below += 1;
      else if (signal === "above") stats.above += 1;
      else if (signal === "unknown") stats.unknown += 1;
      return stats;
    }, { below: 0, above: 0, unknown: 0 });
  }, [activePriceTarget, visibleStops]);

  useEffect(() => {
    document.body.classList.toggle("map-fullscreen-active", mapFullscreen);

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMapFullscreen(false);
      }
    }

    function handleFullscreenChange() {
      if (!document.fullscreenElement) {
        setMapFullscreen(false);
      }
    }

    const resizeTimers = mapFullscreen
      ? [40, 180, 420].map((delay) => window.setTimeout(() => window.dispatchEvent(new Event("resize")), delay))
      : [];

    if (mapFullscreen) {
      window.addEventListener("keydown", handleEscape);
      document.addEventListener("fullscreenchange", handleFullscreenChange);
    }

    return () => {
      document.body.classList.remove("map-fullscreen-active");
      window.removeEventListener("keydown", handleEscape);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      resizeTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [mapFullscreen]);

  async function toggleMapFullscreen() {
    if (!mapFullscreen) {
      setMapFullscreen(true);
      try {
        await mapStageRef.current?.requestFullscreen?.();
      } catch {
        // CSS fullscreen still works when the browser blocks native fullscreen.
      }
      return;
    }

    setMapFullscreen(false);
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen?.();
      } catch {
        // Ignore browser fullscreen exit errors; CSS state is already reset.
      }
    }
  }

  function useLiveTruckLocationForOrigin() {
    if (!selectedVehicleLocation) return;
    setRouteForm((current) => ({ ...current, origin: selectedVehicleLocation }));
    setSuggestionsForField("origin", []);
    setSuggestionLoading("origin", false);
    setLocationFieldFocus("");
  }

  async function buildRoutePlan(nextFilters = activeFilters) {
    if (!token) return;
    setRouteLoading(true);
    setRouteError("");
    setApprovalMessage("");
    setApprovalError("");
    try {
      const payload = {
        ...routeForm,
        vehicle_id: selectedVehicle?.id ? Number(selectedVehicle.id) : null,
        vehicle_number: selectedVehicle ? vehicleLabel(selectedVehicle) : "",
        driver_name: selectedVehicle ? vehicleDriverName(selectedVehicle) : "",
        current_fuel_gallons: toOptionalNumber(routeForm.current_fuel_gallons),
        tank_capacity_gallons: toOptionalNumber(routeForm.tank_capacity_gallons),
        mpg: toOptionalNumber(routeForm.mpg),
        sort_by: nextFilters.sort_by,
        price_target: parsePriceTarget(nextFilters.price_target),
        start_range: "",
        full_range: "",
        amenities: [],
        affiliations: []
      };
      const data = await apiRequest("/navigation/route-assistant", { method: "POST", body: JSON.stringify(payload), timeoutMs: ROUTE_REQUEST_TIMEOUT_MS }, token);
      setRoutePlan(data);
      setActiveFilters(nextFilters);
    } catch (plannerError) {
      setRoutePlan(null);
      setRouteError(plannerError.message);
    } finally {
      setRouteLoading(false);
    }
  }

  function buildFuelAuthorizationPayload(item) {
    const stop = item?.stop || {};
    const plannedGallons = Number(item?.gallons_to_buy) || 0;
    const plannedPrice = Number(item?.auto_diesel_price ?? getAutoDieselPrice(stop));
    const plannedAmount = Number(item?.estimated_cost) || (Number.isFinite(plannedPrice) ? plannedGallons * plannedPrice : 0);
    const maxGallons = Math.ceil((plannedGallons * 1.05 + 5) * 10) / 10;
    const maxPrice = Number.isFinite(plannedPrice) ? Number((plannedPrice + 0.05).toFixed(3)) : null;
    const maxAmount = Math.ceil(Math.max(plannedAmount * 1.08, (maxPrice || plannedPrice || 0) * maxGallons) * 100) / 100;
    const stationRouteLink = buildStopsRouteLink(routePlan, [stop]) || routePlan?.station_map_link || "";
    const vehicleId = selectedVehicle?.id ? Number(selectedVehicle.id) : null;

    return {
      routing_request_id: routePlan?.routing_request_id || null,
      vehicle_id: Number.isFinite(vehicleId) ? vehicleId : null,
      vehicle_number: vehicleLabel(selectedVehicle),
      driver_name: vehicleDriverName(selectedVehicle),
      origin_label: routePlan?.origin?.label || routeForm.origin,
      destination_label: routePlan?.destination?.label || routeForm.destination,
      route_id: fuelStrategy?.route_id || "",
      route_label: fuelStrategy?.route_label || "",
      station_id: stop.id || `${stop.lat},${stop.lon}`,
      station_name: stop.name || stop.brand || "Fuel Stop",
      station_brand: stop.brand || "",
      station_address: stop.address || "",
      station_city: stop.city || "",
      station_state: stop.state_code || "",
      station_postal_code: stop.postal_code || "",
      station_lat: stop.lat ?? null,
      station_lon: stop.lon ?? null,
      station_source_url: stop.source_url || "",
      station_map_link: stationRouteLink,
      fuel_type: routeForm.fuel_type || "Auto Diesel",
      planned_gallons: plannedGallons,
      max_gallons: maxGallons,
      planned_amount: plannedAmount,
      max_amount: maxAmount,
      planned_price_per_gallon: Number.isFinite(plannedPrice) ? plannedPrice : null,
      max_price_per_gallon: maxPrice,
      price_target: smartFuelPriceTarget,
      fuel_before_gallons: item?.fuel_before_gallons ?? null,
      fuel_after_gallons: item?.fuel_after_gallons ?? null,
      route_miles: item?.route_miles ?? null,
      miles_to_next: item?.miles_to_next ?? null,
      safety_buffer_miles: item?.safety_buffer_miles ?? null,
      dispatcher_note: `Approved from Smart Fuel Plan. ${item?.reason || ""}`.trim(),
      source: "route_assistant",
      status: "approved",
      station_snapshot: stop,
      strategy_snapshot: { ...item, stop },
      policy_snapshot: {
        created_from: "RouteAssistantUnited",
        current_fuel_gallons: Number(routeForm.current_fuel_gallons) || null,
        tank_capacity_gallons: Number(routeForm.tank_capacity_gallons) || null,
        mpg: Number(routeForm.mpg) || null
      }
    };
  }

  async function createFuelAuthorization(item) {
    if (!token || !selectedVehicle || !item?.stop) return;
    const busyKey = `${item.sequence}-${item.stop.id}`;
    setApprovalBusyKey(busyKey);
    setApprovalMessage("");
    setApprovalError("");
    try {
      const payload = buildFuelAuthorizationPayload(item);
      const created = await apiRequest("/fuel-authorizations", { method: "POST", body: JSON.stringify(payload) }, token);
      setApprovalMessage(`Fuel approval ${created.approval_code} created for ${created.vehicle_number || "truck"}.`);
      window.dispatchEvent(new CustomEvent("fuel-authorization-created", { detail: created }));
    } catch (authorizationError) {
      setApprovalError(authorizationError.message);
    } finally {
      setApprovalBusyKey("");
    }
  }
  function applyDraftFilters() {
    if (plannerNeedsRefresh) {
      buildRoutePlan(draftFilters);
      return;
    }
    setActiveFilters(draftFilters);
  }

  return (
    <section className="panel route-panel route-panel-brand-mode">
      <div className="route-vehicle-bridge">
        <div className="route-vehicle-bridge-copy">
          <strong>{driverMode ? "Driver fuel routing" : "Truck preset routing"}</strong>
          <span>{driverMode ? "Your truck is locked from Motive. Enter point B and the system uses live fuel plus a fixed 200 gallon tank capacity." : "Select a truck or driver, enter only A and B, and the system fills live fuel plus a fixed 200 gallon tank capacity automatically."}</span>
        </div>
        <div className="route-vehicle-bridge-status">
          <strong>{fleetLoading ? "Syncing Motive fleet..." : driverMode ? "Driver truck ready" : `${fleetVehicles.length} trucks ready`}</strong>
          <span>{selectedVehicle ? `${vehicleLabel(selectedVehicle)} | ${vehicleDriverName(selectedVehicle)}` : "Choose a Motive truck to auto-fill route fuel inputs."}</span>
        </div>
      </div>

      <div className="route-builder route-builder-expanded route-builder-brand-mode route-builder-smart">
        {!lockedVehicle ? (
          <label className="route-builder-search">
            Search truck or driver
            <input
              type="text"
              value={vehicleSearch}
              onChange={(event) => setVehicleSearch(event.target.value)}
              placeholder="Truck, driver, VIN, plate, city"
            />
            <small>{filteredFleetVehicles.length} match{filteredFleetVehicles.length === 1 ? "" : "es"}</small>
          </label>
        ) : null}
        <label>
          Truck
          <select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)} disabled={lockedVehicle || fleetLoading || !visibleTruckVehicles.length}>
            {visibleTruckVehicles.length ? (
              visibleTruckVehicles.map((vehicle) => (
                <option key={`truck-${vehicle.id}`} value={vehicle.id}>
                  {truckOptionLabel(vehicle)}
                </option>
              ))
            ) : (
              <option value="">No Motive trucks found</option>
            )}
          </select>
        </label>
        {!lockedVehicle ? (
          <label>
            Driver
            <select value={selectedVehicleDriver ? String(selectedVehicle?.id || "") : ""} onChange={(event) => setSelectedVehicleId(event.target.value)} disabled={fleetLoading || !driverVehicleOptions.length}>
              {driverVehicleOptions.length ? (
                <>
                  {!selectedVehicleDriver ? <option value="">Unassigned</option> : null}
                  {driverVehicleOptions.map((option) => (
                    <option key={`driver-${option.id}`} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </>
              ) : (
                <option value="">No assigned drivers match search</option>
              )}
            </select>
          </label>
        ) : null}
        <label className="route-location-field">
          Origin (A)
          <div className="route-location-input-wrap">
            <input
              type="text"
              value={routeForm.origin}
              onChange={(event) => handleLocationInputChange("origin", event.target.value)}
              onFocus={() => focusLocationField("origin")}
              onBlur={() => handleLocationBlur("origin")}
              placeholder="Chicago, IL"
              autoComplete="off"
            />
            {renderLocationSuggestions("origin")}
          </div>
        </label>
        <label className="route-location-field">
          Destination (B)
          <div className="route-location-input-wrap">
            <input
              type="text"
              value={routeForm.destination}
              onChange={(event) => handleLocationInputChange("destination", event.target.value)}
              onFocus={() => focusLocationField("destination")}
              onBlur={() => handleLocationBlur("destination")}
              placeholder="Dallas, TX"
              autoComplete="off"
            />
            {renderLocationSuggestions("destination")}
          </div>
        </label>
        <label>
          Sort stops
          <select value={draftFilters.sort_by} onChange={(event) => setDraftFilters({ ...draftFilters, sort_by: event.target.value, ui_sort: event.target.value })}>
            <option value="best">Best match</option>
            <option value="distance">Closest to route</option>
            <option value="score">Highest score</option>
          </select>
        </label>
        <label>
          Smart route target
          <input type="number" min="0" step="0.001" placeholder="4.250" value={draftFilters.price_target} onChange={(event) => setDraftFilters({ ...draftFilters, price_target: event.target.value })} />
          <small className="route-builder-hint">Planner aims for this auto diesel price and only goes above it when safety or reachability requires.</small>
        </label>
        <button className="primary-button primary-button-brand" onClick={() => buildRoutePlan(draftFilters)} disabled={routeLoading || !routeForm.origin.trim() || !routeForm.destination.trim()}>
          {routeLoading ? `Building route... ${routeLoadingSeconds}s` : "Build route"}
        </button>
      </div>

      <div className="route-vehicle-summary">
        <div className="route-vehicle-summary-head">
          <div>
            <h3>{selectedVehicle ? vehicleLabel(selectedVehicle) : "Truck preset"}</h3>
            <span>{selectedVehicle ? `${vehicleDriverName(selectedVehicle)} | ${selectedVehicle.vin || selectedVehicle.fuel_type || "Motive live data"}` : "Select a truck to populate live fuel and routing presets."}</span>
          </div>
          <button className="secondary-button" type="button" onClick={useLiveTruckLocationForOrigin} disabled={!selectedVehicleLocation}>
            Use live truck location for A
          </button>
        </div>

        <div className="route-vehicle-summary-grid">
          <article className="route-vehicle-stat">
            <span>Fuel now</span>
            <strong>{formatGallons(selectedVehiclePreset.currentFuelGallons)}</strong>
            <small>{selectedVehiclePreset.fuelSource}</small>
          </article>
          <article className="route-vehicle-stat">
            <span>Tank capacity</span>
            <strong>{formatGallons(selectedVehiclePreset.tankCapacityGallons)}</strong>
            <small>Fixed max for every truck in Routing</small>
          </article>
          <article className="route-vehicle-stat">
            <span>MPG</span>
            <strong>{selectedVehiclePreset.mpg.toFixed(1)}</strong>
            <small>{selectedVehiclePreset.mpgSource}</small>
          </article>
          <article className="route-vehicle-stat">
            <span>Range now</span>
            <strong>{formatMiles(selectedVehiclePreset.currentFuelGallons * selectedVehiclePreset.mpg)}</strong>
            <small>Full tank {fullTankRangePreview}</small>
          </article>
          <article className="route-vehicle-stat">
            <span>Driver</span>
            <strong>{vehicleDriverName(selectedVehicle)}</strong>
            <small>{selectedVehicleDriver?.email || selectedVehicleDriver?.phone || "No driver contact"}</small>
          </article>
        </div>

        <div className="route-vehicle-summary-foot">
          <span>{selectedVehicleLocation ? `Live location: ${selectedVehicleLocation}` : "Live truck location is not available for this unit."}</span>
          <span>{selectedVehiclePreset.hasSensorOnlyFuel ? "Motive sent a fuel sensor reading for this truck, but not a usable fuel percentage." : selectedVehiclePreset.matchedLoad ? "Matched to your Loads board" : "Routing is using Motive live telemetry only"}</span>
        </div>
      </div>

      {fleetError ? <div className="notice error inline-notice">{fleetError}</div> : null}
      {routeLoading ? <div className="notice info inline-notice" aria-live="polite">{routeLoadingMessage}</div> : null}
      {routeError ? <div className="notice error inline-notice">{routeError}</div> : null}
      {approvalMessage ? <div className="notice success inline-notice">{approvalMessage}</div> : null}
      {approvalError ? <div className="notice error inline-notice">{approvalError}</div> : null}

      {routePlan ? (
        <div className="route-results">
          <div className="route-main-grid route-main-grid-brand">
            <div ref={mapStageRef} className={`route-map-stage route-map-stage-brand ${mapFullscreen ? "route-map-stage-fullscreen" : ""}`}>
              <div className="route-map-toolbar">
                <div className="route-map-toolbar-copy">
                  <strong>Map</strong>
                  <span>Prices remain visible under each station as you zoom in.</span>
                </div>
                <button className="secondary-button route-map-expand-button" type="button" onClick={toggleMapFullscreen}>
                  {mapFullscreen ? "Close full screen" : "Full screen"}
                </button>
              </div>
              <Suspense fallback={<div className="module-loader">Loading interactive map...</div>}><RouteMap plan={routePlan} isFullscreen={mapFullscreen} active={active} priceTarget={activePriceTarget} startMarkerTitle={selectedVehicle ? `${vehicleLabel(selectedVehicle)} | ${vehicleDriverName(selectedVehicle)}` : routePlan.origin.label} endMarkerTitle={routePlan.destination.label || "Destination"} /></Suspense>
            </div>

            <aside className="route-side-panel">
              <div className="fuel-board fuel-board-brand-list unitedlane-briefing-card">
                <div className="fuel-board-head unitedlane-head">
                  <div>
                    <h3>{routePlan.assistant_name || "UnitedLane"}</h3>
                    <span>AI notes for the selected station</span>
                  </div>
                  
                </div>
                {fuelStrategy?.status !== "direct" && routePlan.selected_stop ? (
                  <div className="unitedlane-stop-summary">
                    <strong>{routePlan.selected_stop.brand || routePlan.selected_stop.name}</strong>
                    <span>{routePlan.selected_stop.address}</span>
                    <span>{getAutoDieselPrice(routePlan.selected_stop) !== null ? `$${getAutoDieselPrice(routePlan.selected_stop).toFixed(3)}/gal auto diesel` : "Auto diesel price not published"}</span>
                  </div>
                ) : null}
                <p className="unitedlane-message">{routePlan.assistant_message}</p>
                <div className="unitedlane-actions">
                  {routePlan.station_map_link ? (
                    <a className="primary-button primary-button-brand unitedlane-map-button" href={routePlan.station_map_link} target="_blank" rel="noreferrer">
                      Open stop route
                    </a>
                  ) : null}
                  {routePlan.map_link ? (
                    <a className="fuel-source-link" href={routePlan.map_link} target="_blank" rel="noreferrer">
                      Open route
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="route-options-grid route-options-grid-compact route-options-grid-brand">
                {routePlan.routes.map((route, index) => (
                  <article key={route.id} className="route-option-card route-option-card-brand">
                    <div className="route-option-top">
                      <div className="route-option-id">
                        <span className="legend-swatch" style={{ background: routeColors[index % routeColors.length] }} />
                        <strong>{route.label}</strong>
                      </div>
                      <span>{formatDistance(route.distance_meters)}</span>
                    </div>
                    <div className="route-option-metrics">
                      <span>{formatDuration(route.travel_time_seconds)}</span>
                      <span>Delay {formatDuration(route.traffic_delay_seconds)}</span>
                      <span>{route.fuel_stops.length} branded stops</span>
                    </div>
                  </article>
                ))}
              </div>

              <div className="fuel-filters-card fuel-filters-modern fuel-filters-brand-mode">
                <div className="fuel-board-head">
                  <div>
                    <h3>Route Tuning</h3>
                    <span>{visibleStops.length} branded stops visible</span>
                  </div>
                  
                </div>

                <div className="fuel-filter-grid fuel-filter-grid-two-up">
                  <label>
                    Search brand or city
                    <input type="text" placeholder="pilot, flying j, love's, city" value={draftFilters.search} onChange={(event) => setDraftFilters({ ...draftFilters, search: event.target.value })} />
                  </label>
                  <label>
                    Max off route
                    <select value={draftFilters.max_off_route} onChange={(event) => setDraftFilters({ ...draftFilters, max_off_route: event.target.value })}>
                      <option value="15">15 mi</option>
                      <option value="30">30 mi</option>
                      <option value="50">50 mi</option>
                      <option value="0">Any</option>
                    </select>
                  </label>
                  <label>
                    Auto diesel target
                    <input type="number" min="0" step="0.001" placeholder="4.250" value={draftFilters.price_target} onChange={(event) => setDraftFilters({ ...draftFilters, price_target: event.target.value })} />
                  </label>
                </div>

                <button className="primary-button filter-apply-button primary-button-brand" onClick={applyDraftFilters} disabled={routeLoading}>
                  {plannerNeedsRefresh ? (routeLoading ? "Refreshing plan..." : "Apply filters + rebuild smart route") : "Apply View Filter"}
                </button>

                {priceTargetStats ? (
                  <div className="price-target-summary">
                    <div className="price-target-summary-head">
                      <strong>Auto diesel target {formatPriceTarget(activePriceTarget)}/gal</strong>
                      <span>{visibleStops.length} stops checked</span>
                    </div>
                    <div className="price-target-stat-row">
                      <span className="price-target-stat price-below-target">Green {priceTargetStats.below}</span>
                      <span className="price-target-stat price-above-target">Red {priceTargetStats.above}</span>
                      <span className="price-target-stat price-unknown-target">No price {priceTargetStats.unknown}</span>
                    </div>
                  </div>
                ) : null}

                <p className="fuel-filter-note">{routePlan.price_support}</p>
              </div>
            </aside>
          </div>

          {fuelStrategy ? (
            <section className={`fuel-board smart-fuel-card smart-fuel-${fuelStrategy.status}`}>
              <div className="fuel-board-head smart-fuel-head">
                <div>
                  <h3>Smart fuel plan</h3>
                  <span>The system uses tank gallons, MPG, Auto Diesel prices, detour time, route reachability, and a small safety reserve. Max 3 stops.</span>
                </div>
                <strong className="smart-fuel-status">{getStrategyStatusLabel(fuelStrategy.status)}</strong>
              </div>

              <div className="smart-fuel-metrics">
                <span><strong>{fuelStrategy.stop_count}/{fuelStrategy.max_stop_count || 3}</strong> stops</span>
                <span><strong>{formatCurrency(fuelStrategy.estimated_fuel_cost)}</strong> fuel to buy</span>
                <span><strong>{formatGallons(fuelStrategy.required_purchase_gallons)}</strong> planned purchase</span>
                <span><strong>{formatMiles(fuelStrategy.starting_range_miles)}</strong> start range</span>
                <span><strong>{formatMiles(fuelStrategy.full_tank_range_miles)}</strong> full tank</span>
                <span><strong>{formatDuration(fuelStrategy.estimated_total_time_seconds)}</strong> total time</span>
                {smartFuelPriceTarget !== null ? <span><strong>{formatPriceTarget(smartFuelPriceTarget)}</strong> target</span> : null}
              </div>

              {smartFuelPriceTarget !== null ? (
                <div className="price-target-summary smart-price-target-summary">
                  <div className="price-target-summary-head">
                    <strong>Smart target {formatPriceTarget(smartFuelPriceTarget)}/gal</strong>
                    <span>{fuelStrategy.price_target_breach_count ? `${fuelStrategy.price_target_breach_count} planned stop${fuelStrategy.price_target_breach_count === 1 ? "" : "s"} above target` : "All planned fuel stops are at or below target"}</span>
                  </div>
                  <div className="price-target-stat-row">
                    <span className={`price-target-stat ${fuelStrategy.price_target_breach_count ? "price-above-target" : "price-below-target"}`.trim()}>
                      {fuelStrategy.price_target_breach_count ? "Target exceeded where needed" : "Target held on every stop"}
                    </span>
                    <span className={`price-target-stat ${fuelStrategy.price_target_breach_count ? "price-above-target" : "price-below-target"}`.trim()}>
                      Above target {fuelStrategy.price_target_breach_count || 0}
                    </span>
                    {fuelStrategy.price_target_breach_count ? (
                      <span className="price-target-stat price-above-target">Max +${Number(fuelStrategy.price_target_max_overage || 0).toFixed(3)}/gal</span>
                    ) : (
                      <span className="price-target-stat price-below-target">Max +$0.000/gal</span>
                    )}
                  </div>
                </div>
              ) : null}

              {fuelStrategy.safety_buffer_policy ? <p className="smart-fuel-policy">{fuelStrategy.safety_buffer_policy}</p> : null}

              {fuelStrategy.warnings?.length ? (
                <div className="smart-fuel-warnings">
                  {fuelStrategy.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                </div>
              ) : null}

              {fuelStrategy.stops?.length ? (
                <>
                  <div className="smart-fuel-path">
                    <span className="cheap-route-point">A. {routePlan.origin.label}</span>
                    {fuelStrategy.stops.map((item) => (
                      <span key={`smart-path-${item.sequence}-${item.stop.id}`} className="cheap-route-point">
                        {item.sequence}. Buy {formatGallons(item.gallons_to_buy)} at {item.stop.brand || item.stop.name} - {formatCurrency(item.estimated_cost)}
                      </span>
                    ))}
                    <span className="cheap-route-point">B. {routePlan.destination.label}</span>
                  </div>

                  <div className="smart-fuel-stop-grid">
                    {fuelStrategy.stops.map((item) => (
                      <article key={`smart-stop-${item.sequence}-${item.stop.id}`} className="smart-fuel-stop-card">
                        <span>Stop #{item.sequence} at mile {item.route_miles}</span>
                        <strong>{formatGallons(item.gallons_to_buy)} / {formatCurrency(item.estimated_cost)}</strong>
                        <p>{item.stop.brand || item.stop.name}</p>
                        <small>{item.stop.address}</small>
                        <div className="smart-fuel-card-stats">
                          <span>Auto Diesel {formatFuelPrice(item.auto_diesel_price)}/gal</span>
                          <span>Before {formatGallons(item.fuel_before_gallons)}</span>
                          <span>After {formatGallons(item.fuel_after_gallons)}</span>
                          <span>Reserve {formatMiles(item.safety_buffer_miles)}</span>
                          <span>Next {formatMiles(item.miles_to_next)} to {item.next_target_label}</span>
                        </div>
                        <em>{item.reason}</em>
                        {!driverMode ? (
                          <button
                            className="primary-button primary-button-brand fuel-approval-button"
                            type="button"
                            onClick={() => createFuelAuthorization(item)}
                            disabled={!selectedVehicle || approvalBusyKey === `${item.sequence}-${item.stop.id}`}
                          >
                            {approvalBusyKey === `${item.sequence}-${item.stop.id}` ? "Approving..." : "Approve fuel stop"}
                          </button>
                        ) : null}
                      </article>
                    ))}
                  </div>

                  {fuelStrategy.map_link ? (
                    <a className="primary-button primary-button-brand smart-fuel-map-link" href={fuelStrategy.map_link} target="_blank" rel="noreferrer">
                      Open smart route with stops
                    </a>
                  ) : null}
                </>
              ) : (
                <div className="empty-route-card">
                  {fuelStrategy.status === "direct" ? "Current fuel is enough to reach the destination without buying Auto Diesel." : "The system could not build a safe Auto Diesel stop plan with the current tank inputs."}
                </div>
              )}
            </section>
          ) : null}

          <section className="fuel-board cheapest-route-card">
            <div className="fuel-board-head cheapest-route-head">
              <div>
                <h3>Cheapest auto diesel route</h3>
                <span>Pick up to 3 fuel stops. We choose the lowest Auto Diesel prices across the route.</span>
              </div>
              <label className="cheap-route-count">
                Stops
                <input
                  type="number"
                  min="1"
                  max="3"
                  value={cheapStopCount}
                  onChange={(event) => setCheapStopCount(event.target.value)}
                />
              </label>
            </div>

            {cheapestAutoDieselStops.length ? (
              <>
                <div className="cheap-route-summary">
                  <strong>{cheapestAutoDieselStops.length} cheapest auto diesel stops selected</strong>
                  <span>Selected stops are ordered from A to B for the route link.</span>
                  {cheapestStopsRouteLink ? (
                    <a className="primary-button primary-button-brand" href={cheapestStopsRouteLink} target="_blank" rel="noreferrer">
                      Open route with stops
                    </a>
                  ) : null}
                </div>

                <div className="cheap-route-path">
                  <span className="cheap-route-point">A. {routePlan.origin.label}</span>
                  {cheapestStopsRouteOrder.map((stop, index) => (
                    <span key={`cheap-path-${stop.id}`} className="cheap-route-point">
                      {index + 1}. {stop.brand || stop.name} - ${stop.autoDieselPlanPrice.toFixed(3)}/gal
                    </span>
                  ))}
                  <span className="cheap-route-point">B. {routePlan.destination.label}</span>
                </div>

                <div className="cheap-route-stop-grid">
                  {cheapestAutoDieselStops.map((stop, index) => (
                    <article key={`cheap-${stop.id}`} className="cheap-route-stop-card">
                      <span>Price rank #{index + 1}</span>
                      <strong>${stop.autoDieselPlanPrice.toFixed(3)}/gal</strong>
                      <p>{stop.brand || stop.name}</p>
                      <small>{stop.address}</small>
                      <em>{formatMiles(stop.off_route_miles)} off route</em>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-route-card">No published auto diesel prices found on this route yet.</div>
            )}
          </section>

          <div className="fuel-showcase-grid fuel-showcase-grid-brand">
            <section className="fuel-board feature-board feature-board-brand">
              <div className="fuel-board-head">
                <h3>Best Network Hits</h3>
                <span>Best overall matches</span>
              </div>
              <div className="fuel-stop-grid">
                {bestStops.length ? bestStops.map((stop) => <StopCard key={`best-${stop.id}`} stop={stop} compact priceTarget={activePriceTarget} />) : <div className="empty-route-card">No brand hits on this route.</div>}
              </div>
            </section>

            <section className="fuel-board feature-board feature-board-brand">
              <div className="fuel-board-head">
                <h3>Closest Pull-offs</h3>
                <span>Lowest detour distance first</span>
              </div>
              <div className="fuel-stop-grid">
                {closestStops.length ? closestStops.map((stop) => <StopCard key={`close-${stop.id}`} stop={stop} compact priceTarget={activePriceTarget} />) : <div className="empty-route-card">No close branded stops found.</div>}
              </div>
            </section>

            <section className="fuel-board feature-board feature-board-brand">
              <div className="fuel-board-head">
                <h3>Brand Power</h3>
                <span>Most explicit Pilot and Love's matches</span>
              </div>
              <div className="fuel-stop-grid">
                {brandPowerStops.length ? brandPowerStops.map((stop) => <StopCard key={`brand-${stop.id}`} stop={stop} compact priceTarget={activePriceTarget} />) : <div className="empty-route-card">No exact brand-family matches found.</div>}
              </div>
            </section>
          </div>

          <div className="fuel-board fuel-board-brand-list">
            <div className="fuel-board-head">
              <h3>All Network Stops</h3>
              <span>Official Love's and Pilot locations on this route.</span>
            </div>
            <div className="fuel-stop-grid fuel-stop-grid-expanded">
              {visibleStops.length ? visibleStops.map((stop) => <StopCard key={stop.id} stop={stop} priceTarget={activePriceTarget} />) : <div className="empty-route-card">No network stops matched this view.</div>}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-route-card empty-route-card-brand">Select a truck or driver, enter point A and point B, and Routing will use live Motive fuel plus a fixed 200 gallon tank capacity automatically.</div>
      )}
    </section>
  );
}

