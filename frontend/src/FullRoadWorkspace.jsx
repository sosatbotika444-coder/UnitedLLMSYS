import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  applyTripStageLifecycle,
  buildTripProfitabilitySnapshot,
  getTripStageTimeline,
  recordTripTimelineEvent,
} from "./profitability";

const RouteMap = lazy(() => import("./RouteMap"));

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const TOMTOM_ROUTING_KEY = import.meta.env.VITE_TOMTOM_API_KEY || "fu7pxv1akLSodE8K53xEsMMx7aPKLmOl";
const ROUTE_REQUEST_TIMEOUT_MS = 120000;
const FLEET_REFRESH_INTERVAL_MS = 45000;
const TRIPS_REFRESH_INTERVAL_MS = 60000;
const DEFAULT_TANK_CAPACITY_GALLONS = 200;
const DEFAULT_TRUCK_MPG = 6.0;
const DEFAULT_CURRENT_FUEL_GALLONS = 100;
const PICKUP_ARRIVAL_THRESHOLD_MILES = 1;
const DELIVERY_COMPLETE_THRESHOLD_MILES = 1;
const FULL_ROAD_MAP_ORIGIN_DRIFT_THRESHOLD_MILES = 8;
const FULL_ROAD_NOTES_STORAGE_KEY = "unitedlane_fullroad_notes";
const FULL_ROAD_CHECKLIST_STORAGE_KEY = "unitedlane_fullroad_checklists";
const stageLabels = {
  enroute_pickup: "Truck to Pickup",
  at_pickup: "At Pickup",
  enroute_delivery: "Pickup to Delivery",
  delivered: "Delivered"
};
const fullRoadStages = ["enroute_pickup", "at_pickup", "enroute_delivery", "delivered"];
const fullRoadChecklistItems = [
  { id: "driver_contacted", label: "Driver contacted" },
  { id: "pickup_confirmed", label: "Pickup confirmed" },
  { id: "fuel_plan_shared", label: "Fuel plan shared" },
  { id: "delivery_eta_shared", label: "Delivery ETA shared" }
];

async function apiRequest(path, options = {}, token = "") {
  const { timeoutMs = 20000, ...fetchOptions } = options;
  const headers = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const signal = fetchOptions.signal || controller.signal;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      headers,
      signal
    });

    if (response.status === 204) {
      return null;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || "Request failed");
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function fileNameFromDisposition(headerValue, fallback = "full_road_trips.xlsx") {
  if (!headerValue) return fallback;
  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const basicMatch = headerValue.match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1] || fallback;
}

async function downloadFile(path, token = "", fallbackFileName = "full_road_trips.xlsx") {
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
  link.download = fileNameFromDisposition(response.headers.get("Content-Disposition"), fallbackFileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 0);
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function formatDistanceMiles(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0.0 mi";
  return `${parsed.toFixed(parsed >= 100 ? 0 : 1)} mi`;
}

function formatDistanceFromMeters(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0.0 mi";
  return formatDistanceMiles(parsed / 1609.344);
}

function formatDuration(seconds) {
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0m";
  const hours = Math.floor(parsed / 3600);
  const minutes = Math.round((parsed % 3600) / 60);
  if (!hours) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function formatMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0m";
  const hours = Math.floor(parsed / 60);
  const minutes = Math.round(parsed % 60);
  if (!hours) return `${minutes}m`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatDateTime(value) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function formatFuelPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "Fuel unknown";
  return `${parsed.toFixed(1)}% fuel`;
}

function formatGallons(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0.0 gal";
  return `${parsed.toFixed(1)} gal`;
}

function formatCurrency(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0.00";
  return `$${parsed.toFixed(2)}`;
}

function formatFuelPrice(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "No price";
  return `$${parsed.toFixed(3)}/gal`;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatMpgValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "MPG unknown";
  return `${parsed.toFixed(1)} MPG`;
}

function vehicleMpgInfo(vehicle) {
  const directMpg = positiveNumber(vehicle?.mpg);
  if (directMpg !== null) {
    return {
      value: directMpg,
      source: vehicle?.mpg_source || "Motive truck MPG"
    };
  }

  const totalDistanceMiles = positiveNumber(vehicle?.utilization_summary?.total_distance_miles);
  const totalFuelGallons = positiveNumber(vehicle?.utilization_summary?.total_fuel);
  if (totalDistanceMiles !== null && totalFuelGallons !== null) {
    return {
      value: totalDistanceMiles / totalFuelGallons,
      source: "Motive 7-day total distance vs total fuel"
    };
  }

  const drivingDistanceMiles = positiveNumber(vehicle?.driving_summary?.distance_miles);
  const drivingFuelGallons = positiveNumber(vehicle?.utilization_summary?.driving_fuel);
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

function metricValue(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readStoredObject(key) {
  if (typeof window === "undefined") return {};
  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) return {};
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredObject(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function defaultChecklistState() {
  return Object.fromEntries(fullRoadChecklistItems.map((item) => [item.id, false]));
}

function normalizeChecklistState(value) {
  return {
    ...defaultChecklistState(),
    ...(value && typeof value === "object" ? value : {})
  };
}

function vehicleDriver(vehicle) {
  return vehicle?.driver || vehicle?.permanent_driver || null;
}

function vehicleDriverName(vehicle) {
  return vehicleDriver(vehicle)?.full_name || "Unassigned";
}

function vehicleLabel(vehicle) {
  return vehicle?.number || vehicle?.vin || `Vehicle ${vehicle?.id ?? ""}`.trim();
}

function vehicleLocationLabel(vehicle) {
  if (!vehicle?.location) return "Location unavailable";
  return vehicle.location.address || [vehicle.location.city, vehicle.location.state].filter(Boolean).join(", ") || "Location unavailable";
}

function vehicleFuelPercent(vehicle) {
  const location = vehicle?.location || {};
  const value = location.fuel_level_percent
    ?? location.fuel_primary_remaining_percentage
    ?? location.fuel_remaining_percentage
    ?? location.fuel_percentage
    ?? null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
}

function vehicleLocationQuery(vehicle) {
  const location = vehicle?.location || {};
  const lat = Number(location.lat);
  const lon = Number(location.lon);

  // Prefer live GPS coordinates over address text to avoid stale origin points.
  if (Number.isFinite(lat) && Number.isFinite(lon)) return `${lat}, ${lon}`;
  if (location.address) return location.address;
  const cityState = [location.city, location.state].filter(Boolean).join(", ");
  if (cityState) return cityState;
  return "";
}

function locationPoint(vehicle) {
  if (!vehicle?.location) return null;
  const lat = Number(vehicle.location.lat);
  const lon = Number(vehicle.location.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function findVehicleForLoad(loadRow, vehicles) {
  if (!loadRow || !Array.isArray(vehicles)) return null;
  const truckTerm = normalizeText(loadRow.truck);
  const driverTerm = normalizeText(loadRow.driver);

  return vehicles.find((vehicle) => {
    const label = normalizeText(vehicleLabel(vehicle));
    const driverName = normalizeText(vehicleDriverName(vehicle));
    const truckMatch = truckTerm && (label === truckTerm || label.includes(truckTerm) || truckTerm.includes(label));
    const driverMatch = driverTerm && (driverName === driverTerm || driverName.includes(driverTerm) || driverTerm.includes(driverName));
    return truckMatch || driverMatch;
  }) || null;
}

function matchedLoadRow(vehicle, loadRows) {
  if (!vehicle || !Array.isArray(loadRows)) return null;
  return loadRows.find((row) => {
    const truckText = normalizeText(row.truck);
    const driverText = normalizeText(row.driver);
    const vehicleText = normalizeText(vehicleLabel(vehicle));
    const driverName = normalizeText(vehicleDriverName(vehicle));
    return (truckText && (truckText === vehicleText || truckText.includes(vehicleText) || vehicleText.includes(truckText)))
      || (driverText && (driverText === driverName || driverText.includes(driverName) || driverName.includes(driverText)));
  }) || null;
}

function deriveTruckPreset(vehicle, loadRows) {
  const row = matchedLoadRow(vehicle, loadRows);
  const fuelPercent = vehicleFuelPercent(vehicle);
  const loadFuelPercent = Number(row?.fuel_level);
  const resolvedFuelPercent = Number.isFinite(fuelPercent) ? fuelPercent : (Number.isFinite(loadFuelPercent) ? loadFuelPercent : null);
  const tankCapacityGallons = Math.max(1, Number(row?.tank_capacity) || DEFAULT_TANK_CAPACITY_GALLONS);
  const motiveMpg = vehicleMpgInfo(vehicle);
  const loadMpg = positiveNumber(row?.mpg);
  const mpg = Math.max(0.1, motiveMpg.value ?? loadMpg ?? DEFAULT_TRUCK_MPG);
  const currentFuelGallons = resolvedFuelPercent !== null
    ? (tankCapacityGallons * resolvedFuelPercent) / 100
    : DEFAULT_CURRENT_FUEL_GALLONS;

  return {
    matchedLoadId: row?.id || null,
    tankCapacityGallons,
    mpg,
    mpgSource: motiveMpg.value !== null
      ? motiveMpg.source
      : loadMpg !== null
        ? "MPG matched from Loads board"
        : `Default truck MPG ${DEFAULT_TRUCK_MPG.toFixed(1)}`,
    fuelPercent: resolvedFuelPercent,
    currentFuelGallons
  };
}

function toMilesFromMeters(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed / 1609.344;
}

function stopDetourMiles(stop) {
  const detourMeters = Number(stop?.detour_distance_meters);
  if (Number.isFinite(detourMeters) && detourMeters > 0) {
    return toMilesFromMeters(detourMeters);
  }
  const offRouteMiles = Number(stop?.off_route_miles);
  if (Number.isFinite(offRouteMiles) && offRouteMiles > 0) {
    return offRouteMiles * 2;
  }
  return 0;
}

function planRouteMiles(plan) {
  const strategyMiles = Number(plan?.fuel_strategy?.total_route_miles);
  if (Number.isFinite(strategyMiles) && strategyMiles > 0) {
    return strategyMiles;
  }
  return toMilesFromMeters(plan?.routes?.[0]?.distance_meters);
}

function clampRouteProgressMiles(totalMiles, remainingMiles) {
  const total = Number(totalMiles);
  const remaining = Number(remainingMiles);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(remaining)) {
    return 0;
  }
  return clamp(total - remaining, 0, total);
}

function remainingStrategyStops(plan, progressMiles = 0) {
  const strategyStops = plan?.fuel_strategy?.stops || [];
  const progress = Math.max(0, Number(progressMiles) || 0);
  return strategyStops.filter((item) => {
    const routeMiles = Number(item?.route_miles);
    if (!Number.isFinite(routeMiles)) return true;
    return routeMiles + 0.5 >= progress;
  });
}

function remainingPlannedGallons(plan, progressMiles = 0) {
  return remainingStrategyStops(plan, progressMiles).reduce((sum, item) => sum + (Number(item?.gallons_to_buy) || 0), 0);
}

function remainingPlannedDriveMiles(plan, progressMiles = 0) {
  const totalRouteMiles = planRouteMiles(plan);
  const progress = Math.max(0, Number(progressMiles) || 0);
  const remainingRouteMiles = Math.max(0, totalRouteMiles - progress);
  const remainingDetourMiles = remainingStrategyStops(plan, progress).reduce((sum, item) => sum + stopDetourMiles(item?.stop), 0);
  return remainingRouteMiles + remainingDetourMiles;
}

function haversineMiles(left, right) {
  if (!left || !right) return null;
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const deltaLat = toRadians(right.lat - left.lat);
  const deltaLon = toRadians(right.lon - left.lon);
  const lat1 = toRadians(left.lat);
  const lat2 = toRadians(right.lat);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadiusMiles * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function estimateRemainingFuelGallons(plan, startingGallons, mpg) {
  const start = Number(startingGallons);
  const economy = Number(mpg);
  if (!Number.isFinite(start) || !Number.isFinite(economy) || economy <= 0) {
    return DEFAULT_CURRENT_FUEL_GALLONS;
  }

  const purchasedGallons = remainingPlannedGallons(plan, 0);
  const consumedGallons = remainingPlannedDriveMiles(plan, 0) / economy;
  return Math.max(0, start + purchasedGallons - consumedGallons);
}

function bestRouteMetrics(plan) {
  const route = plan?.routes?.[0];
  return {
    miles: toMilesFromMeters(route?.distance_meters),
    durationSeconds: Number(route?.travel_time_seconds) || 0,
    delaySeconds: Number(route?.traffic_delay_seconds) || 0,
    label: route?.label || "Best route",
    stopCount: Number(route?.fuel_stops?.length) || 0
  };
}

function stopLine(stop) {
  if (!stop) return "";
  return `${stop.brand || stop.name} - ${formatFuelPrice(stop.auto_diesel_price ?? stop.diesel_price ?? stop.price)}`;
}

function formatRelativePing(value) {
  if (!value) return "No live ping";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Live ping unavailable";
  const minutesAgo = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 60000));
  if (minutesAgo < 1) return "Live now";
  if (minutesAgo < 60) return `${minutesAgo}m ago`;
  const hoursAgo = Math.floor(minutesAgo / 60);
  const remainingMinutes = minutesAgo % 60;
  if (!remainingMinutes) return `${hoursAgo}h ago`;
  return `${hoursAgo}h ${remainingMinutes}m ago`;
}

function nextFuelStopForTrip(trip) {
  if (!trip) return null;
  const pickupStops = trip.toPickupPlan?.fuel_strategy?.stops || [];
  const deliveryStops = trip.toDeliveryPlan?.fuel_strategy?.stops || [];
  if (trip.stage === "enroute_delivery") {
    return deliveryStops[0]?.stop || null;
  }
  if (trip.stage === "delivered") {
    return null;
  }
  return pickupStops[0]?.stop || deliveryStops[0]?.stop || null;
}

function projectedFuelState(trip, vehicle = null) {
  if (!trip) {
    return {
      currentGallons: 0,
      projectedReserveGallons: 0,
      projectedReservePercent: 0
    };
  }

  const tankCapacity = Math.max(1, Number(trip.tankCapacityGallons) || DEFAULT_TANK_CAPACITY_GALLONS);
  const mpg = Math.max(0.1, Number(trip.mpg) || DEFAULT_TRUCK_MPG);
  const liveFuelPercent = vehicleFuelPercent(vehicle);
  const storedFuelPercent = Number(trip.live?.fuelPercent);
  const resolvedFuelPercent = Number.isFinite(liveFuelPercent) ? liveFuelPercent : (Number.isFinite(storedFuelPercent) ? storedFuelPercent : null);
  const currentGallons = resolvedFuelPercent !== null
    ? (tankCapacity * resolvedFuelPercent) / 100
    : Math.max(0, Number(trip.currentFuelGallons) || 0);
  const pickupRouteMiles = planRouteMiles(trip.toPickupPlan);
  const deliveryRouteMiles = planRouteMiles(trip.toDeliveryPlan);
  const pickupProgressMiles = clampRouteProgressMiles(pickupRouteMiles, trip.live?.distanceToPickupMiles);
  const deliveryProgressMiles = clampRouteProgressMiles(deliveryRouteMiles, trip.live?.distanceToDeliveryMiles);
  let remainingDriveMiles = 0;
  let plannedGallons = 0;

  if (trip.stage === "delivered") {
    remainingDriveMiles = 0;
    plannedGallons = 0;
  } else if (trip.stage === "enroute_delivery" || trip.stage === "at_pickup") {
    const deliveryProgress = trip.stage === "enroute_delivery" ? deliveryProgressMiles : 0;
    remainingDriveMiles = remainingPlannedDriveMiles(trip.toDeliveryPlan, deliveryProgress);
    plannedGallons = remainingPlannedGallons(trip.toDeliveryPlan, deliveryProgress);
  } else {
    remainingDriveMiles =
      remainingPlannedDriveMiles(trip.toPickupPlan, pickupProgressMiles)
      + remainingPlannedDriveMiles(trip.toDeliveryPlan, 0);
    plannedGallons =
      remainingPlannedGallons(trip.toPickupPlan, pickupProgressMiles)
      + remainingPlannedGallons(trip.toDeliveryPlan, 0);
  }

  const projectedReserveGallons = Math.max(0, currentGallons + plannedGallons - (remainingDriveMiles / mpg));
  return {
    currentGallons,
    projectedReserveGallons,
    projectedReservePercent: clamp((projectedReserveGallons / tankCapacity) * 100, 0, 100)
  };
}

function tripProgressPercent(trip) {
  if (!trip) return 0;
  if (trip.stage === "delivered") return 100;
  if (trip.stage === "enroute_delivery") {
    const totalMiles = Math.max(1, Number(trip.metrics?.toDeliveryMiles) || 1);
    const remainingMiles = Math.max(0, Number(trip.live?.distanceToDeliveryMiles ?? trip.metrics?.toDeliveryMiles) || 0);
    const legProgress = clamp(((totalMiles - remainingMiles) / totalMiles) * 45, 0, 45);
    return clamp(55 + legProgress, 55, 98);
  }
  if (trip.stage === "at_pickup") return 50;
  const pickupMiles = Math.max(1, Number(trip.metrics?.toPickupMiles) || 1);
  const remainingToPickup = Math.max(0, Number(trip.live?.distanceToPickupMiles ?? trip.metrics?.toPickupMiles) || 0);
  const pickupProgress = clamp(((pickupMiles - remainingToPickup) / pickupMiles) * 45, 0, 45);
  return clamp(5 + pickupProgress, 5, 48);
}

function buildTripInsights(trip, vehicle = null, livePickupPlan = null) {
  if (!trip) return null;

  const nextDistanceMiles = trip.stage === "enroute_pickup"
    ? trip.live?.distanceToPickupMiles
    : trip.live?.distanceToDeliveryMiles;
  const nextEta = trip.stage === "enroute_pickup" ? trip.metrics?.etaToPickup : trip.metrics?.etaToDelivery;
  const liveFuelPercent = vehicleFuelPercent(vehicle);
  const resolvedFuelPercent = Number.isFinite(liveFuelPercent) ? liveFuelPercent : Number(trip.live?.fuelPercent);
  const driveSeconds = Number(trip.live?.driveSeconds);
  const pingTime = trip.live?.locatedAt ? new Date(trip.live.locatedAt) : null;
  const pingAgeMinutes = pingTime && !Number.isNaN(pingTime.getTime())
    ? Math.max(0, Math.round((Date.now() - pingTime.getTime()) / 60000))
    : null;
  const isGpsStale = Boolean(trip.live?.isStale) || (pingAgeMinutes !== null && pingAgeMinutes >= 20);
  const fuelProjection = projectedFuelState(trip, vehicle);
  const alertItems = [];
  let healthScore = 100;

  if (!Number.isFinite(Number(nextDistanceMiles))) {
    healthScore -= 16;
    alertItems.push({ tone: "blue", label: "Waiting on live GPS distance" });
  }

  if (isGpsStale) {
    healthScore -= 18;
    alertItems.push({ tone: "amber", label: `GPS stale (${formatRelativePing(trip.live?.locatedAt)})` });
  }

  if (Number.isFinite(resolvedFuelPercent) && resolvedFuelPercent < 20) {
    healthScore -= 22;
    alertItems.push({ tone: "red", label: `Fuel low at ${resolvedFuelPercent.toFixed(0)}%` });
  } else if (Number.isFinite(resolvedFuelPercent) && resolvedFuelPercent < 35) {
    healthScore -= 10;
    alertItems.push({ tone: "amber", label: `Fuel watch at ${resolvedFuelPercent.toFixed(0)}%` });
  }

  if (fuelProjection.projectedReserveGallons < 20) {
    healthScore -= 14;
    alertItems.push({ tone: "red", label: `Projected reserve ${formatGallons(fuelProjection.projectedReserveGallons)}` });
  }

  if (Number.isFinite(driveSeconds) && driveSeconds <= 7200) {
    healthScore -= 16;
    alertItems.push({ tone: "amber", label: `Drive time low (${formatDuration(driveSeconds)})` });
  } else if (Number.isFinite(driveSeconds) && driveSeconds <= 14400) {
    healthScore -= 8;
    alertItems.push({ tone: "blue", label: `Drive time watch (${formatDuration(driveSeconds)})` });
  }

  if (trip.stage === "enroute_pickup" && Number(trip.metrics?.toPickupMiles) >= 180) {
    healthScore -= 8;
    alertItems.push({ tone: "blue", label: `Long deadhead (${formatDistanceMiles(trip.metrics.toPickupMiles)})` });
  }

  if (livePickupPlan) {
    healthScore -= 8;
    alertItems.push({ tone: "amber", label: "Truck moved off original pickup route" });
  }

  healthScore = clamp(Math.round(healthScore), 12, 100);
  const healthTone = healthScore >= 80 ? "green" : (healthScore >= 60 ? "amber" : "dark");
  let nextAction = "Monitor live trip and update ops notes.";

  if (isGpsStale) {
    nextAction = "Refresh Motive or call the driver for a live position check.";
  } else if (fuelProjection.projectedReserveGallons < 20 || (Number.isFinite(resolvedFuelPercent) && resolvedFuelPercent < 20)) {
    nextAction = "Share updated fuel instructions before the truck reaches the next leg.";
  } else if (Number.isFinite(driveSeconds) && driveSeconds <= 7200) {
    nextAction = "Review HOS and confirm the next stop plan with dispatch.";
  } else if (trip.stage === "enroute_pickup" && Number.isFinite(Number(nextDistanceMiles)) && Number(nextDistanceMiles) <= 15) {
    nextAction = "Confirm pickup appointment, reference numbers, and dock details.";
  } else if (trip.stage === "at_pickup") {
    nextAction = "Send departure guidance and verify the delivery ETA.";
  } else if (trip.stage === "enroute_delivery" && Number.isFinite(Number(nextDistanceMiles)) && Number(nextDistanceMiles) <= 40) {
    nextAction = "Prepare the delivery handoff and final arrival update.";
  }

  return {
    healthScore,
    healthTone,
    nextDistanceMiles,
    nextEta,
    nextAction,
    pingLabel: formatRelativePing(trip.live?.locatedAt),
    isGpsStale,
    projectedReserveGallons: fuelProjection.projectedReserveGallons,
    projectedReservePercent: fuelProjection.projectedReservePercent,
    progressPercent: tripProgressPercent(trip),
    alertItems
  };
}

function buildDispatchSummary(trip, vehicle = null, insights = null, profitability = null) {
  if (!trip) return "";
  const nextStop = nextFuelStopForTrip(trip);
  const liveLocation = vehicle ? vehicleLocationLabel(vehicle) : (trip.live?.locationLabel || "Location unavailable");
  const nextDistance = insights?.nextDistanceMiles;
  const lines = [
    `Full Road Dispatch Summary`,
    `Truck: ${trip.truckNumber}`,
    `Driver: ${trip.driverName}`,
    `Stage: ${stageLabels[trip.stage] || "Trip"}`,
    `Pickup: ${trip.pickup}`,
    `Delivery: ${trip.delivery}`,
    `Live location: ${liveLocation}`,
    `Last ping: ${formatDateTime(trip.live?.locatedAt)} (${insights?.pingLabel || formatRelativePing(trip.live?.locatedAt)})`,
    `Next distance: ${Number.isFinite(Number(nextDistance)) ? formatDistanceMiles(nextDistance) : "Waiting on live GPS"}`,
    `ETA pickup: ${formatDateTime(trip.metrics?.etaToPickup)}`,
    `ETA delivery: ${formatDateTime(trip.metrics?.etaToDelivery)}`,
    `Projected fuel reserve: ${insights ? `${formatGallons(insights.projectedReserveGallons)} (${insights.projectedReservePercent.toFixed(0)}%)` : "Unknown"}`,
    `Projected margin: ${profitability ? formatCurrency(profitability.projectedMargin) : "Pending load economics"}`,
    `Detention running: ${profitability ? formatCurrency(profitability.detentionAmount) : "$0.00"}`,
    `Next action: ${insights?.nextAction || "Monitor trip"}`
  ];

  if (nextStop) {
    lines.push(`Next fuel stop: ${nextStop.brand || nextStop.name} | ${formatFuelPrice(nextStop.auto_diesel_price ?? nextStop.diesel_price ?? nextStop.price)} | ${nextStop.address}`);
  }

  return lines.join("\n");
}

async function copyTextToClipboard(value) {
  if (!value) return false;
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {}
  }

  try {
    const element = document.createElement("textarea");
    element.value = value;
    element.setAttribute("readonly", "true");
    element.style.position = "absolute";
    element.style.left = "-9999px";
    document.body.appendChild(element);
    element.select();
    const copied = document.execCommand("copy");
    element.remove();
    return copied;
  } catch {
    return false;
  }
}

async function fetchTruckToPickupRoadPlan(originPoint, destinationPoint) {
  if (!originPoint || !destinationPoint || !TOMTOM_ROUTING_KEY) return null;
  const originLat = Number(originPoint.lat);
  const originLon = Number(originPoint.lon);
  const destinationLat = Number(destinationPoint.lat);
  const destinationLon = Number(destinationPoint.lon);
  if (!Number.isFinite(originLat) || !Number.isFinite(originLon) || !Number.isFinite(destinationLat) || !Number.isFinite(destinationLon)) {
    return null;
  }

  const routePoints = `${originLat},${originLon}:${destinationLat},${destinationLon}`;
  const params = new URLSearchParams({
    key: TOMTOM_ROUTING_KEY,
    travelMode: "truck",
    routeRepresentation: "polyline",
    computeTravelTimeFor: "all",
    maxAlternatives: "0"
  });

  const response = await fetch(`https://api.tomtom.com/routing/1/calculateRoute/${routePoints}/json?${params.toString()}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.detailedError?.message || payload?.error?.description || "Could not build live truck road route.");
  }

  const route = payload?.routes?.[0];
  if (!route) return null;
  const points = [];
  (route.legs || []).forEach((leg) => {
    (leg.points || []).forEach((point) => {
      const lat = Number(point?.latitude);
      const lon = Number(point?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        points.push({ lat, lon });
      }
    });
  });
  if (points.length < 2) return null;

  const summary = route.summary || {};
  return {
    origin: {
      label: originPoint.label || `${originLat}, ${originLon}`,
      lat: originLat,
      lon: originLon
    },
    destination: {
      label: destinationPoint.label || `${destinationLat}, ${destinationLon}`,
      lat: destinationLat,
      lon: destinationLon
    },
    routes: [{
      id: "live-pickup-route",
      label: "Truck to Pickup (live route)",
      distance_meters: Number(summary.lengthInMeters) || 0,
      travel_time_seconds: Number(summary.travelTimeInSeconds) || 0,
      traffic_delay_seconds: Number(summary.trafficDelayInSeconds) || 0,
      points,
      fuel_stops: []
    }],
    top_fuel_stops: [],
    selected_stop: null,
    fuel_strategy: null
  };
}

function buildCombinedMapPlan(trip, vehicle = null, livePickupPlan = null) {
  if (!trip?.toPickupPlan || !trip?.toDeliveryPlan) return null;
  const pickupReferencePlan = trip.toPickupPlan;
  const pickupPlan = livePickupPlan || pickupReferencePlan;
  const pickupBestRoute = pickupPlan.routes?.[0];
  const pickupReferenceRoute = pickupReferencePlan.routes?.[0];
  const deliveryBestRoute = trip.toDeliveryPlan.routes?.[0];
  if (!pickupBestRoute || !deliveryBestRoute) return null;
  const livePoint = locationPoint(vehicle);
  const fallbackOrigin = pickupPlan.origin || trip.toPickupPlan.origin;
  const routeStartPoint = pickupBestRoute.points?.[0];
  const routeStart = routeStartPoint ? { lat: Number(routeStartPoint.lat), lon: Number(routeStartPoint.lon) } : null;
  const driftFromRouteStart = livePoint && routeStart && Number.isFinite(routeStart.lat) && Number.isFinite(routeStart.lon)
    ? haversineMiles(routeStart, { lat: livePoint.lat, lon: livePoint.lon })
    : null;
  const shouldUseLiveOrigin =
    Boolean(livePoint)
    && (Boolean(livePickupPlan) || driftFromRouteStart === null || driftFromRouteStart <= FULL_ROAD_MAP_ORIGIN_DRIFT_THRESHOLD_MILES);
  const resolvedOrigin = shouldUseLiveOrigin
    ? {
      lat: livePoint.lat,
      lon: livePoint.lon,
      label: vehicleLocationLabel(vehicle) || fallbackOrigin?.label || trip.pickup
    }
    : (fallbackOrigin || (routeStartPoint ? {
      lat: routeStartPoint.lat,
      lon: routeStartPoint.lon,
      label: trip.pickup
    } : null));
  if (!resolvedOrigin || resolvedOrigin.lat === undefined || resolvedOrigin.lon === undefined) return null;
  const pickupRouteForMap = {
    ...pickupBestRoute,
    id: `${trip.id}-pickup-leg`,
    label: livePickupPlan ? "Truck to Pickup (live route)" : "Truck to Pickup",
    fuel_stops: pickupBestRoute.fuel_stops?.length ? pickupBestRoute.fuel_stops : (pickupReferenceRoute?.fuel_stops || [])
  };

  const stopMap = new Map();
  [...(pickupReferencePlan.top_fuel_stops || []), ...(trip.toDeliveryPlan.top_fuel_stops || [])].forEach((stop) => {
    if (!stopMap.has(stop.id)) {
      stopMap.set(stop.id, stop);
    }
  });

  const combinedStrategyStops = [
    ...(pickupReferencePlan.fuel_strategy?.stops || []),
    ...(trip.toDeliveryPlan.fuel_strategy?.stops || [])
  ];

  return {
    origin: resolvedOrigin,
    destination: trip.toDeliveryPlan.destination,
    routes: [
      pickupRouteForMap,
      { ...deliveryBestRoute, id: `${trip.id}-delivery-leg`, label: "Pickup to Delivery" }
    ],
    top_fuel_stops: [...stopMap.values()],
    fuel_strategy: combinedStrategyStops.length ? { stops: combinedStrategyStops } : null
  };
}

function tripExtraMarkers(trip, vehicle) {
  const markers = [];
  const pickupPoint = trip?.toPickupPlan?.destination;
  const livePoint = locationPoint(vehicle);

  if (pickupPoint?.lat !== undefined && pickupPoint?.lon !== undefined) {
    markers.push({
      lat: pickupPoint.lat,
      lon: pickupPoint.lon,
      label: "PU",
      title: pickupPoint.label || trip.pickup,
      className: "marker-pickup"
    });
  }

  if (livePoint) {
    markers.push({
      lat: livePoint.lat,
      lon: livePoint.lon,
      label: "TR",
      title: `${trip.truckNumber} | ${trip.driverName}`,
      className: "marker-live"
    });
  }

  return markers;
}

function geocodedPointToPlain(point) {
  if (!point) return null;
  return {
    label: point.label,
    lat: point.lat,
    lon: point.lon
  };
}

function buildTripFromPlans({ tripId, vehicle, pickup, delivery, toPickupPlan, toDeliveryPlan, loadId, preset, existingStage = "enroute_pickup" }) {
  const toPickupMetrics = bestRouteMetrics(toPickupPlan);
  const toDeliveryMetrics = bestRouteMetrics(toDeliveryPlan);
  const fuelCost = Number(toPickupPlan?.fuel_strategy?.estimated_fuel_cost || 0) + Number(toDeliveryPlan?.fuel_strategy?.estimated_fuel_cost || 0);
  const now = Date.now();

  return {
    id: tripId,
    loadId: loadId || null,
    vehicleId: Number(vehicle.id) || null,
    truckNumber: vehicleLabel(vehicle),
    driverName: vehicleDriverName(vehicle),
    pickup,
    delivery,
    stage: existingStage,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tankCapacityGallons: preset.tankCapacityGallons,
    mpg: preset.mpg,
    currentFuelGallons: preset.currentFuelGallons,
    fuelPercent: preset.fuelPercent,
    toPickupPlan: {
      ...toPickupPlan,
      origin: geocodedPointToPlain(toPickupPlan.origin),
      destination: geocodedPointToPlain(toPickupPlan.destination)
    },
    toDeliveryPlan: {
      ...toDeliveryPlan,
      origin: geocodedPointToPlain(toDeliveryPlan.origin),
      destination: geocodedPointToPlain(toDeliveryPlan.destination)
    },
    metrics: {
      toPickupMiles: toPickupMetrics.miles,
      toPickupDurationSeconds: toPickupMetrics.durationSeconds,
      toPickupDelaySeconds: toPickupMetrics.delaySeconds,
      toDeliveryMiles: toDeliveryMetrics.miles,
      toDeliveryDurationSeconds: toDeliveryMetrics.durationSeconds,
      toDeliveryDelaySeconds: toDeliveryMetrics.delaySeconds,
      totalMiles: toPickupMetrics.miles + toDeliveryMetrics.miles,
      totalDurationSeconds: toPickupMetrics.durationSeconds + toDeliveryMetrics.durationSeconds,
      fuelStopCount: Number(toPickupPlan?.fuel_strategy?.stop_count || 0) + Number(toDeliveryPlan?.fuel_strategy?.stop_count || 0),
      estimatedFuelCost: fuelCost,
      etaToPickup: new Date(now + toPickupMetrics.durationSeconds * 1000).toISOString(),
      etaToDelivery: new Date(now + (toPickupMetrics.durationSeconds + toDeliveryMetrics.durationSeconds) * 1000).toISOString(),
      lastRouteRefreshAt: new Date().toISOString()
    }
  };
}

function tripPayload(trip) {
  const fuelPercent = Number(trip?.fuelPercent);
  return {
    loadId: trip?.loadId || null,
    vehicleId: Number(trip?.vehicleId) || null,
    truckNumber: String(trip?.truckNumber || ""),
    driverName: String(trip?.driverName || ""),
    pickup: String(trip?.pickup || ""),
    delivery: String(trip?.delivery || ""),
    stage: String(trip?.stage || "enroute_pickup"),
    tankCapacityGallons: Math.max(0, Number(trip?.tankCapacityGallons) || 0),
    mpg: Math.max(0, Number(trip?.mpg) || 0),
    currentFuelGallons: Math.max(0, Number(trip?.currentFuelGallons) || 0),
    fuelPercent: Number.isFinite(fuelPercent) ? fuelPercent : null,
    toPickupPlan: trip?.toPickupPlan || {},
    toDeliveryPlan: trip?.toDeliveryPlan || {},
    metrics: trip?.metrics || {},
    live: trip?.live || {}
  };
}

function stageTone(stage) {
  if (stage === "delivered") return "delivered";
  if (stage === "at_pickup") return "pickup";
  if (stage === "enroute_delivery") return "delivery";
  return "active";
}

function updateTripLiveState(trip, vehicle) {
  if (!trip) return trip;
  const pickupPoint = trip?.toPickupPlan?.destination;
  const deliveryPoint = trip?.toDeliveryPlan?.destination;
  const livePoint = locationPoint(vehicle);
  const distanceToPickupMiles = haversineMiles(livePoint, pickupPoint);
  const distanceToDeliveryMiles = haversineMiles(livePoint, deliveryPoint);
  let nextStage = trip.stage || "enroute_pickup";
  const eventAt = vehicle?.location?.located_at || new Date().toISOString();
  const shouldStampDeliveryArrival =
    nextStage === "enroute_delivery"
    && distanceToDeliveryMiles !== null
    && distanceToDeliveryMiles <= DELIVERY_COMPLETE_THRESHOLD_MILES;

  if (nextStage === "enroute_pickup" && distanceToPickupMiles !== null && distanceToPickupMiles <= PICKUP_ARRIVAL_THRESHOLD_MILES) {
    nextStage = "at_pickup";
  } else if (nextStage === "at_pickup" && distanceToPickupMiles !== null && distanceToPickupMiles > 2) {
    nextStage = "enroute_delivery";
  }

  const liveUpdatedTrip = {
    ...trip,
    updatedAt: new Date().toISOString(),
    live: {
      locationLabel: vehicleLocationLabel(vehicle),
      locatedAt: vehicle?.location?.located_at || "",
      lat: livePoint?.lat ?? null,
      lon: livePoint?.lon ?? null,
      fuelPercent: vehicleFuelPercent(vehicle),
      isMoving: Boolean(vehicle?.is_moving),
      isStale: Boolean(vehicle?.is_stale),
      driveSeconds: Number(vehicle?.eld_hours?.available_time?.drive_seconds) || null,
      shiftSeconds: Number(vehicle?.eld_hours?.available_time?.shift_seconds) || null,
      dutyStatus: vehicle?.eld_hours?.duty_status || vehicle?.eld_hours?.status || "",
      distanceToPickupMiles,
      distanceToDeliveryMiles
    }
  };

  return applyTripStageLifecycle(liveUpdatedTrip, nextStage, eventAt, {
    setDeliveryArrival: shouldStampDeliveryArrival,
  });
}

function SummaryCard({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`metric-card metric-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function LegSummary({ title, plan, nextLabel }) {
  const route = plan?.routes?.[0];
  const strategy = plan?.fuel_strategy;
  const selectedStop = strategy?.status === "direct" ? null : plan?.selected_stop;

  return (
    <article className="full-road-leg-card">
      <div className="full-road-leg-head">
        <div>
          <span>{title}</span>
          <strong>{route?.label || "Route ready"}</strong>
        </div>
        <em>{formatDistanceFromMeters(route?.distance_meters)} / {formatDuration(route?.travel_time_seconds)}</em>
      </div>
      <div className="full-road-leg-grid">
        <span><strong>Fuel plan</strong>{strategy ? `${strategy.stop_count} stop(s)` : "No smart plan"}</span>
        <span><strong>Fuel cost</strong>{strategy ? formatCurrency(strategy.estimated_fuel_cost) : "$0.00"}</span>
        <span><strong>Traffic</strong>{formatDuration(route?.traffic_delay_seconds)}</span>
        <span><strong>Next</strong>{nextLabel}</span>
      </div>
      {selectedStop ? (
        <div className="full-road-leg-stop">
          <strong>{selectedStop.brand || selectedStop.name}</strong>
          <span>{selectedStop.address}</span>
          <small>{stopLine(selectedStop)}</small>
        </div>
      ) : null}
      {strategy?.stops?.length ? (
        <div className="full-road-leg-stop-list">
          {strategy.stops.map((item) => (
            <div key={`${title}-${item.sequence}-${item.stop.id}`}>
              <strong>{item.sequence}. {item.stop.brand || item.stop.name}</strong>
              <span>{formatGallons(item.gallons_to_buy)} / {formatCurrency(item.estimated_cost)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="full-road-leg-empty">Fuel stop not required on this leg.</div>
      )}
    </article>
  );
}

export default function FullRoadWorkspace({ token, active = true, loadRows = [] }) {
  const [fleetSnapshot, setFleetSnapshot] = useState(null);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [fleetError, setFleetError] = useState("");
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripBusy, setTripBusy] = useState(false);
  const [tripError, setTripError] = useState("");
  const [message, setMessage] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [tripSearch, setTripSearch] = useState("");
  const [tripStageFilter, setTripStageFilter] = useState("all");
  const [tripSort, setTripSort] = useState("attention");
  const [selectedLoadId, setSelectedLoadId] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [pickup, setPickup] = useState("");
  const [delivery, setDelivery] = useState("");
  const [activeTrips, setActiveTrips] = useState([]);
  const [selectedTripId, setSelectedTripId] = useState("");
  const [livePickupPlan, setLivePickupPlan] = useState(null);
  const [livePickupPlanLoading, setLivePickupPlanLoading] = useState(false);
  const [tripExporting, setTripExporting] = useState(false);
  const [tripNotesById, setTripNotesById] = useState(() => readStoredObject(FULL_ROAD_NOTES_STORAGE_KEY));
  const [tripChecklistsById, setTripChecklistsById] = useState(() => readStoredObject(FULL_ROAD_CHECKLIST_STORAGE_KEY));
  const activeTripsRef = useRef([]);
  const fleetSnapshotRef = useRef(null);

  useEffect(() => {
    activeTripsRef.current = activeTrips;
  }, [activeTrips]);

  useEffect(() => {
    fleetSnapshotRef.current = fleetSnapshot;
  }, [fleetSnapshot]);

  useEffect(() => {
    writeStoredObject(FULL_ROAD_NOTES_STORAGE_KEY, tripNotesById);
  }, [tripNotesById]);

  useEffect(() => {
    writeStoredObject(FULL_ROAD_CHECKLIST_STORAGE_KEY, tripChecklistsById);
  }, [tripChecklistsById]);

  useEffect(() => {
    if (!activeTrips.length) {
      setSelectedTripId("");
      return;
    }
    if (!activeTrips.some((trip) => String(trip.id) === String(selectedTripId) && trip.stage !== "delivered")) {
      const firstOpenTrip = activeTrips.find((trip) => trip.stage !== "delivered") || activeTrips[0];
      setSelectedTripId(firstOpenTrip?.id || "");
    }
  }, [activeTrips, selectedTripId]);

  useEffect(() => {
    if (!token) {
      setTripsLoading(false);
      setActiveTrips([]);
      setSelectedTripId("");
      return undefined;
    }
    if (!active) return undefined;

    let ignore = false;
    let inFlight = false;
    async function loadTrips() {
      if (inFlight) return;
      inFlight = true;
      setTripsLoading(true);
      try {
        const data = await apiRequest("/full-road-trips", {}, token);
        if (!ignore) {
          const liveVehicles = fleetSnapshotRef.current?.vehicles || [];
          const hydratedTrips = (Array.isArray(data) ? data : []).map((trip) => {
            const vehicle = liveVehicles.find((item) => String(item.id) === String(trip.vehicleId));
            return vehicle ? updateTripLiveState(trip, vehicle) : trip;
          });
          setActiveTrips(hydratedTrips);
          setTripError("");
        }
      } catch (error) {
        if (!ignore) {
          setTripError(error.message || "Full Road trips failed to load.");
        }
      } finally {
        if (!ignore) {
          setTripsLoading(false);
        }
        inFlight = false;
      }
    }

    loadTrips();
    const timer = window.setInterval(() => {
      loadTrips();
    }, TRIPS_REFRESH_INTERVAL_MS);
    return () => {
      ignore = true;
      inFlight = false;
      window.clearInterval(timer);
    };
  }, [active, token]);

  useEffect(() => {
    if (!token || !active) return undefined;

    let ignore = false;
    async function loadFleet(forceRefresh = false) {
      setFleetLoading(true);
      try {
        const data = await apiRequest(`/motive/fleet${forceRefresh ? "?refresh=true" : ""}`, {}, token);
        if (!ignore) {
          setFleetSnapshot(data);
          setFleetError("");
        }
      } catch (error) {
        if (!ignore) {
          setFleetError(error.message || "Fleet snapshot failed.");
        }
      } finally {
        if (!ignore) {
          setFleetLoading(false);
        }
      }
    }

    loadFleet(false);
    const timer = window.setInterval(() => loadFleet(true), FLEET_REFRESH_INTERVAL_MS);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [active, token]);

  useEffect(() => {
    if (!fleetSnapshot?.vehicles?.length || !activeTripsRef.current.length) return;

    const vehiclesById = new Map(fleetSnapshot.vehicles.map((vehicle) => [String(vehicle.id), vehicle]));
    const currentTrips = activeTripsRef.current;
    const lifecycleChangedTrips = [];
    const nextTrips = currentTrips.map((trip) => {
      const vehicle = vehiclesById.get(String(trip.vehicleId));
      if (!vehicle) return trip;
      const nextTrip = updateTripLiveState(trip, vehicle);
      const previousTimeline = JSON.stringify(getTripStageTimeline(trip));
      const nextTimeline = JSON.stringify(getTripStageTimeline(nextTrip));
      if (nextTrip.stage !== trip.stage || previousTimeline !== nextTimeline) {
        lifecycleChangedTrips.push(nextTrip);
      }
      return nextTrip;
    });

    setActiveTrips(nextTrips);

    if (!token || !lifecycleChangedTrips.length) return;

    Promise.all(
      lifecycleChangedTrips.map((trip) =>
        apiRequest(
          `/full-road-trips/${trip.id}`,
          {
            method: "PUT",
            body: JSON.stringify(tripPayload(trip))
          },
          token
        )
      )
    )
      .then((savedTrips) => {
        setActiveTrips((current) =>
          current.map((trip) => savedTrips.find((savedTrip) => String(savedTrip.id) === String(trip.id)) || trip)
        );
      })
      .catch(() => {});
  }, [fleetSnapshot, token]);

  const vehicles = useMemo(() => fleetSnapshot?.vehicles || [], [fleetSnapshot]);
  const selectedLoadRow = useMemo(
    () => loadRows.find((row) => String(row.id) === String(selectedLoadId)) || null,
    [loadRows, selectedLoadId]
  );

  useEffect(() => {
    if (!selectedLoadRow) return;
    setPickup(selectedLoadRow.pickup_city || "");
    setDelivery(selectedLoadRow.delivery_city || "");
  }, [selectedLoadRow]);

  useEffect(() => {
    if (!selectedLoadRow || !vehicles.length) return;
    const match = findVehicleForLoad(selectedLoadRow, vehicles);
    if (match?.id) {
      setSelectedVehicleId(String(match.id));
    }
  }, [selectedLoadRow, vehicles]);

  const filteredVehicles = useMemo(() => {
    const term = normalizeText(vehicleSearch);
    const source = [...vehicles];
    source.sort((left, right) => String(vehicleLabel(left)).localeCompare(String(vehicleLabel(right))));
    return source.filter((vehicle) => {
      if (!term) return true;
      const haystack = [
        vehicleLabel(vehicle),
        vehicleDriverName(vehicle),
        vehicleLocationLabel(vehicle),
        vehicle?.vin,
        vehicle?.license_plate_number
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [vehicleSearch, vehicles]);

  const selectedVehicle = useMemo(
    () => vehicles.find((vehicle) => String(vehicle.id) === String(selectedVehicleId)) || null,
    [selectedVehicleId, vehicles]
  );
  const selectedTrip = useMemo(
    () => activeTrips.find((trip) => String(trip.id) === String(selectedTripId)) || null,
    [activeTrips, selectedTripId]
  );
  const selectedTripLoadRow = useMemo(
    () => (
      selectedTrip?.loadId
        ? loadRows.find((row) => String(row.id) === String(selectedTrip.loadId)) || null
        : null
    ),
    [loadRows, selectedTrip]
  );
  const selectedTripTimeline = useMemo(
    () => getTripStageTimeline(selectedTrip),
    [selectedTrip]
  );
  const selectedTripProfitability = useMemo(
    () => (selectedTrip ? buildTripProfitabilitySnapshot(selectedTrip, selectedTripLoadRow) : null),
    [selectedTrip, selectedTripLoadRow]
  );
  const selectedTripVehicle = useMemo(
    () => vehicles.find((vehicle) => String(vehicle.id) === String(selectedTrip?.vehicleId)) || null,
    [selectedTrip?.vehicleId, vehicles]
  );
  const selectedTripLivePoint = useMemo(
    () => locationPoint(selectedTripVehicle),
    [selectedTripVehicle?.location?.lat, selectedTripVehicle?.location?.lon]
  );

  useEffect(() => {
    if (!active || !token || !selectedTrip || !selectedTripVehicle || !selectedTripLivePoint) {
      setLivePickupPlan(null);
      setLivePickupPlanLoading(false);
      return undefined;
    }

    const pickupRouteStart = selectedTrip.toPickupPlan?.routes?.[0]?.points?.[0];
    if (!pickupRouteStart) {
      setLivePickupPlan(null);
      setLivePickupPlanLoading(false);
      return undefined;
    }

    const driftMiles = haversineMiles(
      { lat: Number(pickupRouteStart.lat), lon: Number(pickupRouteStart.lon) },
      { lat: selectedTripLivePoint.lat, lon: selectedTripLivePoint.lon }
    );
    if (!Number.isFinite(driftMiles) || driftMiles <= FULL_ROAD_MAP_ORIGIN_DRIFT_THRESHOLD_MILES) {
      setLivePickupPlan(null);
      setLivePickupPlanLoading(false);
      return undefined;
    }

    const pickupDestinationPoint = selectedTrip.toPickupPlan?.destination;
    const pickupDestinationLat = Number(pickupDestinationPoint?.lat);
    const pickupDestinationLon = Number(pickupDestinationPoint?.lon);
    if (!Number.isFinite(pickupDestinationLat) || !Number.isFinite(pickupDestinationLon)) {
      setLivePickupPlan(null);
      setLivePickupPlanLoading(false);
      return undefined;
    }

    let ignore = false;
    setLivePickupPlanLoading(true);
    fetchTruckToPickupRoadPlan(
      {
        lat: selectedTripLivePoint.lat,
        lon: selectedTripLivePoint.lon,
        label: vehicleLocationLabel(selectedTripVehicle) || selectedTrip.truckNumber
      },
      {
        lat: pickupDestinationLat,
        lon: pickupDestinationLon,
        label: pickupDestinationPoint?.label || selectedTrip.pickup
      }
    )
      .then((plan) => {
        if (ignore) return;
        setLivePickupPlan(plan);
      })
      .catch(() => {
        if (!ignore) {
          setLivePickupPlan(null);
        }
      })
      .finally(() => {
        if (!ignore) {
          setLivePickupPlanLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [
    active,
    token,
    selectedTrip?.id,
    selectedTrip?.pickup,
    selectedTrip?.vehicleId,
    selectedTrip?.truckNumber,
    selectedTrip?.driverName,
    selectedTrip?.currentFuelGallons,
    selectedTrip?.tankCapacityGallons,
    selectedTrip?.mpg,
    selectedTripVehicle?.id,
    selectedTripVehicle?.location?.address,
    selectedTripLivePoint?.lat,
    selectedTripLivePoint?.lon
  ]);

  const openTrips = useMemo(() => activeTrips.filter((trip) => trip.stage !== "delivered"), [activeTrips]);
  const combinedMapPlan = useMemo(
    () => buildCombinedMapPlan(selectedTrip, selectedTripVehicle, livePickupPlan),
    [selectedTrip, selectedTripVehicle, livePickupPlan]
  );
  const mapMarkers = useMemo(() => tripExtraMarkers(selectedTrip, selectedTripVehicle), [selectedTrip, selectedTripVehicle]);
  const selectedPreset = useMemo(() => (selectedVehicle ? deriveTruckPreset(selectedVehicle, loadRows) : null), [loadRows, selectedVehicle]);
  const vehiclesById = useMemo(
    () => new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle])),
    [vehicles]
  );
  const tripInsightsById = useMemo(() => {
    const nextMap = {};
    openTrips.forEach((trip) => {
      const tripVehicle = vehiclesById.get(String(trip.vehicleId)) || null;
      nextMap[String(trip.id)] = buildTripInsights(
        trip,
        tripVehicle,
        String(selectedTripId) === String(trip.id) ? livePickupPlan : null
      );
    });
    return nextMap;
  }, [livePickupPlan, openTrips, selectedTripId, vehiclesById]);
  const visibleTrips = useMemo(() => {
    const term = normalizeText(tripSearch);
    const stageFilter = tripStageFilter;
    const nextTrips = openTrips.filter((trip) => {
      if (stageFilter !== "all" && trip.stage !== stageFilter) return false;
      if (!term) return true;
      const vehicle = vehiclesById.get(String(trip.vehicleId));
      const haystack = [
        trip.truckNumber,
        trip.driverName,
        trip.pickup,
        trip.delivery,
        stageLabels[trip.stage],
        vehicle ? vehicleLocationLabel(vehicle) : "",
        vehicle ? vehicleDriverName(vehicle) : ""
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(term);
    });

    nextTrips.sort((left, right) => {
      const leftInsights = tripInsightsById[String(left.id)];
      const rightInsights = tripInsightsById[String(right.id)];
      if (tripSort === "eta") {
        return new Date(left.metrics?.etaToDelivery || 0).getTime() - new Date(right.metrics?.etaToDelivery || 0).getTime();
      }
      if (tripSort === "distance") {
        return (Number(leftInsights?.nextDistanceMiles) || Number.POSITIVE_INFINITY) - (Number(rightInsights?.nextDistanceMiles) || Number.POSITIVE_INFINITY);
      }
      if (tripSort === "truck") {
        return String(left.truckNumber || "").localeCompare(String(right.truckNumber || ""));
      }
      const healthDelta = (leftInsights?.healthScore ?? 0) - (rightInsights?.healthScore ?? 0);
      if (healthDelta !== 0) return healthDelta;
      return new Date(left.updatedAt || 0).getTime() - new Date(right.updatedAt || 0).getTime();
    });

    return nextTrips;
  }, [openTrips, tripInsightsById, tripSearch, tripSort, tripStageFilter, vehiclesById]);
  const selectedTripInsights = useMemo(
    () => (selectedTrip ? tripInsightsById[String(selectedTrip.id)] || buildTripInsights(selectedTrip, selectedTripVehicle, livePickupPlan) : null),
    [livePickupPlan, selectedTrip, selectedTripVehicle, tripInsightsById]
  );
  const selectedTripChecklist = useMemo(
    () => normalizeChecklistState(selectedTrip ? tripChecklistsById[String(selectedTrip.id)] : null),
    [selectedTrip, tripChecklistsById]
  );
  const completedChecklistCount = useMemo(
    () => fullRoadChecklistItems.filter((item) => selectedTripChecklist[item.id]).length,
    [selectedTripChecklist]
  );
  const selectedTripNote = selectedTrip ? String(tripNotesById[String(selectedTrip.id)] || "") : "";
  const dispatchSummary = useMemo(
    () => buildDispatchSummary(selectedTrip, selectedTripVehicle, selectedTripInsights, selectedTripProfitability),
    [selectedTrip, selectedTripInsights, selectedTripProfitability, selectedTripVehicle]
  );

  function upsertTripState(savedTrip) {
    setActiveTrips((current) => {
      const withoutCurrent = current.filter((item) => String(item.id) !== String(savedTrip.id));
      return [savedTrip, ...withoutCurrent];
    });
    setSelectedTripId(savedTrip.id);
  }

  async function saveTripRecord(trip) {
    const tripId = Number(trip?.id);
    const hasTripId = Number.isFinite(tripId) && tripId > 0;
    return apiRequest(
      hasTripId ? `/full-road-trips/${tripId}` : "/full-road-trips",
      {
        method: hasTripId ? "PUT" : "POST",
        body: JSON.stringify(tripPayload(trip))
      },
      token
    );
  }

  async function buildTrip(existingTrip = null) {
    if (!token || !selectedVehicle) {
      setTripError("Select a truck or driver first.");
      return;
    }
    if (!pickup.trim() || !delivery.trim()) {
      setTripError("Pickup and Delivery are required.");
      return;
    }

    const originQuery = vehicleLocationQuery(selectedVehicle);
    if (!originQuery) {
      setTripError("Selected truck does not have a usable location from Motive.");
      return;
    }

    const preset = deriveTruckPreset(selectedVehicle, loadRows);
    setTripBusy(true);
    setTripError("");
    setMessage("");

    try {
      const toPickupPlan = await apiRequest(
        "/navigation/route-assistant",
        {
          method: "POST",
          timeoutMs: ROUTE_REQUEST_TIMEOUT_MS,
          body: JSON.stringify({
            origin: originQuery,
            destination: pickup.trim(),
            vehicle_id: Number(selectedVehicle.id) || null,
            vehicle_number: vehicleLabel(selectedVehicle),
            driver_name: vehicleDriverName(selectedVehicle),
            vehicle_type: "Truck",
            fuel_type: "Auto Diesel",
            current_fuel_gallons: preset.currentFuelGallons,
            tank_capacity_gallons: preset.tankCapacityGallons,
            mpg: preset.mpg,
            sort_by: "cheapest"
          })
        },
        token
      );

      const remainingAtPickup = estimateRemainingFuelGallons(toPickupPlan, preset.currentFuelGallons, preset.mpg);
      const toDeliveryPlan = await apiRequest(
        "/navigation/route-assistant",
        {
          method: "POST",
          timeoutMs: ROUTE_REQUEST_TIMEOUT_MS,
          body: JSON.stringify({
            origin: pickup.trim(),
            destination: delivery.trim(),
            vehicle_id: Number(selectedVehicle.id) || null,
            vehicle_number: vehicleLabel(selectedVehicle),
            driver_name: vehicleDriverName(selectedVehicle),
            vehicle_type: "Truck",
            fuel_type: "Auto Diesel",
            current_fuel_gallons: remainingAtPickup,
            tank_capacity_gallons: preset.tankCapacityGallons,
            mpg: preset.mpg,
            sort_by: "cheapest"
          })
        },
        token
      );

      const trip = buildTripFromPlans({
        tripId: existingTrip?.id || null,
        vehicle: selectedVehicle,
        pickup: pickup.trim(),
        delivery: delivery.trim(),
        toPickupPlan,
        toDeliveryPlan,
        loadId: selectedLoadRow?.id || existingTrip?.loadId,
        preset,
        existingStage: existingTrip?.stage || "enroute_pickup"
      });
      if (existingTrip?.metrics?.stageTimeline) {
        trip.metrics = {
          ...trip.metrics,
          stageTimeline: existingTrip.metrics.stageTimeline
        };
      }
      const liveReadyTrip = updateTripLiveState(trip, selectedVehicle);
      const savedTrip = await saveTripRecord(liveReadyTrip);
      const hydratedTrip = updateTripLiveState(savedTrip, selectedVehicle);

      upsertTripState(hydratedTrip);
      setMessage(existingTrip ? "Full Road trip refreshed." : "Full Road trip created.");
    } catch (error) {
      setTripError(error.message || "Trip could not be built.");
    } finally {
      setTripBusy(false);
    }
  }

  function loadTripIntoForm(trip) {
    setSelectedTripId(trip.id);
    setSelectedVehicleId(String(trip.vehicleId || ""));
    setPickup(trip.pickup || "");
    setDelivery(trip.delivery || "");
    setSelectedLoadId(trip.loadId ? String(trip.loadId) : "");
    setMessage("");
    setTripError("");
  }

  async function updateTripStage(nextStage) {
    if (!selectedTrip || !token) return;
    setTripBusy(true);
    setTripError("");
    setMessage("");

    try {
      const eventAt = new Date().toISOString();
      const stagedTrip = applyTripStageLifecycle(
        {
          ...selectedTrip,
          updatedAt: eventAt
        },
        nextStage,
        eventAt
      );
      const liveReadyTrip = selectedTripVehicle ? updateTripLiveState(stagedTrip, selectedTripVehicle) : stagedTrip;
      const savedTrip = await saveTripRecord(liveReadyTrip);
      const hydratedTrip = selectedTripVehicle ? updateTripLiveState(savedTrip, selectedTripVehicle) : savedTrip;

      upsertTripState(hydratedTrip);
      setMessage(`Trip stage updated to ${stageLabels[hydratedTrip.stage] || "Trip"}.`);
    } catch (error) {
      setTripError(error.message || "Trip stage could not be updated.");
    } finally {
      setTripBusy(false);
    }
  }

  async function stampTimelineEvent(eventKey, successMessage) {
    if (!selectedTrip || !token) return;
    setTripBusy(true);
    setTripError("");
    setMessage("");

    try {
      const eventAt = new Date().toISOString();
      const stampedTrip = recordTripTimelineEvent(
        {
          ...selectedTrip,
          updatedAt: eventAt
        },
        eventKey,
        eventAt
      );
      const liveReadyTrip = selectedTripVehicle ? updateTripLiveState(stampedTrip, selectedTripVehicle) : stampedTrip;
      const savedTrip = await saveTripRecord(liveReadyTrip);
      const hydratedTrip = selectedTripVehicle ? updateTripLiveState(savedTrip, selectedTripVehicle) : savedTrip;
      upsertTripState(hydratedTrip);
      setMessage(successMessage);
    } catch (error) {
      setTripError(error.message || "Timeline event could not be saved.");
    } finally {
      setTripBusy(false);
    }
  }

  async function archiveTrip(tripId) {
    if (!token || !tripId) return;
    setTripBusy(true);
    setTripError("");
    setMessage("");

    try {
      await apiRequest(
        `/full-road-trips/${tripId}/archive`,
        {
          method: "POST"
        },
        token
      );
      setActiveTrips((current) => current.filter((trip) => String(trip.id) !== String(tripId)));
      if (String(selectedTripId) === String(tripId)) {
        setSelectedTripId("");
      }
      setMessage("Full Road trip archived.");
    } catch (error) {
      setTripError(error.message || "Trip could not be archived.");
    } finally {
      setTripBusy(false);
    }
  }

  async function exportTripsExcel() {
    if (!token) return;
    setTripExporting(true);
    setTripError("");
    setMessage("");
    try {
      await downloadFile("/full-road-trips/export?include_archived=true", token, "full_road_trips.xlsx");
      setMessage("Full Road trips exported to Excel.");
    } catch (error) {
      setTripError(error.message || "Full Road trips export failed.");
    } finally {
      setTripExporting(false);
    }
  }

  async function copyDispatchSummary() {
    if (!selectedTrip) return;
    setTripError("");
    const copied = await copyTextToClipboard(dispatchSummary);
    if (copied) {
      setMessage("Dispatch summary copied.");
    } else {
      setTripError("Clipboard copy failed.");
    }
  }

  function updateSelectedTripNote(value) {
    if (!selectedTrip) return;
    const tripKey = String(selectedTrip.id);
    setTripNotesById((current) => ({
      ...current,
      [tripKey]: value
    }));
  }

  function appendQuickNote(template) {
    if (!selectedTrip) return;
    const timestamp = formatDateTime(new Date().toISOString());
    const snippet = `[${timestamp}] ${template}`;
    const currentValue = selectedTripNote.trim();
    updateSelectedTripNote(currentValue ? `${currentValue}\n${snippet}` : snippet);
  }

  function toggleChecklistItem(itemId) {
    if (!selectedTrip) return;
    const tripKey = String(selectedTrip.id);
    setTripChecklistsById((current) => {
      const currentChecklist = normalizeChecklistState(current[tripKey]);
      return {
        ...current,
        [tripKey]: {
          ...currentChecklist,
          [itemId]: !currentChecklist[itemId]
        }
      };
    });
  }

  const livePickupDistance = selectedTrip?.live?.distanceToPickupMiles;
  const liveDeliveryDistance = selectedTrip?.live?.distanceToDeliveryMiles;
  const nextDistance = selectedTrip?.stage === "enroute_pickup" ? livePickupDistance : liveDeliveryDistance;
  const nextEta = selectedTrip?.stage === "enroute_pickup" ? selectedTrip?.metrics?.etaToPickup : selectedTrip?.metrics?.etaToDelivery;

  return (
    <section className="full-road-workspace">
      <section className="panel full-road-builder-panel">
        <div className="panel-head full-road-head">
          <div>
            <h2>Full Road</h2>
            <span>Live truck to Pickup to Delivery with fuel planning and active trip tracking.</span>
          </div>
          <div className="full-road-head-actions">
            <span className="full-road-head-chip">{metricValue(openTrips.length)} active trips</span>
            <span className="full-road-head-chip">{metricValue(vehicles.length)} fleet units</span>
            <button
              className="secondary-button"
              type="button"
              onClick={exportTripsExcel}
              disabled={!token || tripExporting || tripsLoading}
            >
              {tripExporting ? "Exporting..." : "Export Trips Excel"}
            </button>
          </div>
        </div>

        <div className="full-road-builder-grid">
          <label className="full-road-field-load">
            Use saved load
            <select value={selectedLoadId} onChange={(event) => setSelectedLoadId(event.target.value)}>
              <option value="">Manual trip</option>
              {loadRows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.load_number ? `#${row.load_number} | ` : ""}{row.driver || "Driver"} | {row.truck || "Truck"} | {row.pickup_city || "Pickup"} to {row.delivery_city || "Delivery"}
                </option>
              ))}
            </select>
          </label>
          <label className="full-road-field-pickup">
            Pickup
            <input type="text" value={pickup} onChange={(event) => setPickup(event.target.value)} placeholder="Pickup address or city" />
          </label>
          <label className="full-road-field-delivery">
            Delivery
            <input type="text" value={delivery} onChange={(event) => setDelivery(event.target.value)} placeholder="Delivery address or city" />
          </label>
          <label className="full-road-wide-field full-road-field-search">
            Search truck or driver
            <input type="text" value={vehicleSearch} onChange={(event) => setVehicleSearch(event.target.value)} placeholder="Truck, driver, city" />
          </label>
          <label className="full-road-wide-field full-road-field-vehicle">
            Assign truck / driver
            <select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)}>
              <option value="">Select live unit</option>
              {filteredVehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicleLabel(vehicle)} | {vehicleDriverName(vehicle)} | {formatFuelPercent(vehicleFuelPercent(vehicle))} | {formatMpgValue(vehicleMpgInfo(vehicle).value)} | {vehicleLocationLabel(vehicle)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedVehicle ? (
          <div className="full-road-selected-vehicle">
            <article>
              <span>Truck</span>
              <strong>{vehicleLabel(selectedVehicle)}</strong>
              <small>{vehicleDriverName(selectedVehicle)}</small>
            </article>
            <article>
              <span>Live fuel</span>
              <strong>{formatFuelPercent(vehicleFuelPercent(selectedVehicle))}</strong>
              <small>{selectedPreset ? `${formatGallons(selectedPreset.currentFuelGallons)} available` : "Fuel preset ready"}</small>
            </article>
            <article>
              <span>MPG</span>
              <strong>{selectedPreset ? formatMpgValue(selectedPreset.mpg) : formatMpgValue(null)}</strong>
              <small>{selectedPreset?.mpgSource || "Routing preset"}</small>
            </article>
            <article>
              <span>HOS drive</span>
              <strong>{formatDuration(selectedVehicle?.eld_hours?.available_time?.drive_seconds)}</strong>
              <small>{selectedVehicle?.eld_hours?.duty_status || selectedVehicle?.eld_hours?.status || "HOS"}</small>
            </article>
            <article>
              <span>Location</span>
              <strong>{vehicleLocationLabel(selectedVehicle)}</strong>
              <small>{formatDateTime(selectedVehicle?.location?.located_at)}</small>
            </article>
          </div>
        ) : null}

        <div className="full-road-builder-actions">
          <button className="primary-button" type="button" onClick={() => buildTrip()} disabled={tripBusy || fleetLoading || tripsLoading}>
            {tripBusy ? "Building Full Road..." : "Create Full Road Trip"}
          </button>
          {selectedTrip ? (
            <button className="secondary-button" type="button" onClick={() => buildTrip(selectedTrip)} disabled={tripBusy || tripsLoading}>
              {tripBusy ? "Refreshing..." : "Refresh Selected Trip"}
            </button>
          ) : null}
        </div>

        {message ? <div className="notice success inline-notice">{message}</div> : null}
        {tripError ? <div className="notice error inline-notice">{tripError}</div> : null}
        {fleetError ? <div className="notice error inline-notice">{fleetError}</div> : null}
        {tripsLoading ? <div className="notice info inline-notice">Loading saved Full Road trips...</div> : null}
        {fleetLoading ? <div className="notice info inline-notice">Refreshing live Motive fleet...</div> : null}
      </section>

      <section className="panel full-road-trip-strip-panel">
        <div className="panel-head compact-panel-head">
          <div>
            <h2>Active Trips</h2>
            <span>{visibleTrips.length} of {openTrips.length} trip(s) match the queue filters.</span>
          </div>
        </div>
        <div className="full-road-queue-toolbar">
          <label>
            Search queue
            <input type="text" value={tripSearch} onChange={(event) => setTripSearch(event.target.value)} placeholder="Truck, driver, pickup, delivery" />
          </label>
          <label>
            Stage
            <select value={tripStageFilter} onChange={(event) => setTripStageFilter(event.target.value)}>
              <option value="all">All open stages</option>
              {fullRoadStages.filter((stage) => stage !== "delivered").map((stage) => (
                <option key={stage} value={stage}>{stageLabels[stage]}</option>
              ))}
            </select>
          </label>
          <label>
            Sort
            <select value={tripSort} onChange={(event) => setTripSort(event.target.value)}>
              <option value="attention">Needs attention</option>
              <option value="eta">Earliest ETA</option>
              <option value="distance">Closest next stop</option>
              <option value="truck">Truck number</option>
            </select>
          </label>
        </div>
        <div className="full-road-trip-strip">
          {visibleTrips.length ? visibleTrips.map((trip) => {
            const insights = tripInsightsById[String(trip.id)];
            return (
            <button
              key={trip.id}
              type="button"
              className={`full-road-trip-tab ${String(selectedTripId) === String(trip.id) ? "active" : ""}`.trim()}
              onClick={() => loadTripIntoForm(trip)}
            >
              <span className={`full-road-trip-stage tone-${stageTone(trip.stage)}`}>{stageLabels[trip.stage] || "Trip"}</span>
              <div className="full-road-trip-tab-topline">
                <strong>{trip.truckNumber}</strong>
                <span className={`full-road-health-badge tone-${insights?.healthTone || "blue"}`}>Health {insights?.healthScore ?? "--"}</span>
              </div>
              <small>{trip.pickup} to {trip.delivery}</small>
              <em>{trip.live?.distanceToDeliveryMiles !== null && trip.live?.distanceToDeliveryMiles !== undefined ? `${trip.live.distanceToDeliveryMiles.toFixed(1)} mi to delivery` : "Waiting on live GPS"}</em>
              <div className="full-road-trip-tab-foot">
                <small>{insights?.alertItems?.[0]?.label || insights?.nextAction || "Live tracking active"}</small>
              </div>
            </button>
            );
          }) : <div className="full-road-empty">{openTrips.length ? "No trips match the current queue filters." : "No active Full Road trips yet."}</div>}
        </div>
      </section>

      {selectedTrip ? (
        <>
          <section className="full-road-summary-grid">
            <SummaryCard label="Truck" value={selectedTrip.truckNumber} detail={selectedTrip.driverName} tone="blue" />
            <SummaryCard label="Trip Health" value={metricValue(selectedTripInsights?.healthScore)} detail={selectedTripInsights?.nextAction || "Live monitoring"} tone={selectedTripInsights?.healthTone || "dark"} />
            <SummaryCard label="Total Miles" value={formatDistanceMiles(selectedTrip.metrics.totalMiles)} detail={`${formatDistanceMiles(selectedTrip.metrics.toPickupMiles)} to PU + ${formatDistanceMiles(selectedTrip.metrics.toDeliveryMiles)} to DEL`} tone="green" />
            <SummaryCard label="ETA Pickup" value={formatDateTime(selectedTrip.metrics.etaToPickup)} detail={formatDuration(selectedTrip.metrics.toPickupDurationSeconds)} tone="amber" />
            <SummaryCard label="ETA Delivery" value={formatDateTime(selectedTrip.metrics.etaToDelivery)} detail={formatDuration(selectedTrip.metrics.totalDurationSeconds)} tone="violet" />
            <SummaryCard label="Fuel Stops" value={metricValue(selectedTrip.metrics.fuelStopCount)} detail={formatCurrency(selectedTrip.metrics.estimatedFuelCost)} tone="dark" />
            <SummaryCard
              label="Projected Margin"
              value={selectedTripProfitability ? formatCurrency(selectedTripProfitability.projectedMargin) : "$0.00"}
              detail={selectedTripProfitability?.projectedMarginPerMile !== null && selectedTripProfitability?.projectedMarginPerMile !== undefined
                ? `${formatCurrency(selectedTripProfitability.projectedMarginPerMile)} per mile`
                : "Need Full Road miles"}
              tone={selectedTripProfitability && selectedTripProfitability.projectedMargin < 0 ? "amber" : "green"}
            />
            <SummaryCard
              label="Detention"
              value={selectedTripProfitability ? formatCurrency(selectedTripProfitability.detentionAmount) : "$0.00"}
              detail={`PU ${selectedTripProfitability ? formatMinutes(selectedTripProfitability.pickupDetention.billableMinutes) : "0m"} | DEL ${selectedTripProfitability ? formatMinutes(selectedTripProfitability.deliveryDetention.billableMinutes) : "0m"}`}
              tone={selectedTripProfitability?.detentionStatus === "running_billable" ? "amber" : "blue"}
            />
            <SummaryCard label="Fuel Reserve" value={formatGallons(selectedTripInsights?.projectedReserveGallons)} detail={`${selectedTripInsights?.projectedReservePercent?.toFixed(0) || "0"}% projected on arrival`} tone="blue" />
            <SummaryCard label="Live Next" value={nextDistance !== null && nextDistance !== undefined ? formatDistanceMiles(nextDistance) : "No GPS"} detail={nextEta ? `Last ETA ${formatDateTime(nextEta)}` : "Waiting on route"} tone="green" />
          </section>
          {livePickupPlanLoading ? <div className="notice info inline-notice">Updating live truck-to-pickup road path...</div> : null}

          <section className="panel full-road-control-panel">
            <div className="panel-head compact-panel-head">
              <div>
                <h2>{selectedTrip.pickup} to {selectedTrip.delivery}</h2>
                <span>{stageLabels[selectedTrip.stage] || "Trip"} | Last route refresh {formatDateTime(selectedTrip.metrics.lastRouteRefreshAt)}</span>
              </div>
              <div className="full-road-stage-actions">
                {selectedTrip.stage === "enroute_pickup" ? <button className="secondary-button" type="button" onClick={() => updateTripStage("at_pickup")} disabled={tripBusy}>Mark At Pickup</button> : null}
                {selectedTrip.stage === "at_pickup" ? <button className="secondary-button" type="button" onClick={() => updateTripStage("enroute_delivery")} disabled={tripBusy}>Depart Pickup</button> : null}
                {selectedTrip.stage === "enroute_delivery" && !selectedTripTimeline.deliveryArrivedAt ? <button className="secondary-button" type="button" onClick={() => stampTimelineEvent("deliveryArrivedAt", "Delivery arrival recorded.")} disabled={tripBusy}>Mark At Delivery</button> : null}
                {selectedTrip.stage !== "delivered" ? <button className="primary-button" type="button" onClick={() => updateTripStage("delivered")} disabled={tripBusy}>Mark Delivered</button> : null}
                <button className="delete-button" type="button" onClick={() => archiveTrip(selectedTrip.id)} disabled={tripBusy}>Archive</button>
              </div>
            </div>

            <div className="full-road-live-grid">
              <article>
                <span>Live truck</span>
                <strong>{selectedTrip.truckNumber}</strong>
                <small>{selectedTripVehicle ? vehicleLocationLabel(selectedTripVehicle) : selectedTrip.live?.locationLabel || "Location unavailable"}</small>
              </article>
              <article>
                <span>Live fuel</span>
                <strong>{formatFuelPercent(selectedTripVehicle ? vehicleFuelPercent(selectedTripVehicle) : selectedTrip.live?.fuelPercent)}</strong>
                <small>{selectedTripVehicle?.is_stale ? "GPS stale" : "Motive snapshot"}</small>
              </article>
              <article>
                <span>Drive left</span>
                <strong>{formatDuration(selectedTrip.live?.driveSeconds)}</strong>
                <small>{selectedTrip.live?.dutyStatus || "HOS"}</small>
              </article>
              <article>
                <span>Last ping</span>
                <strong>{formatDateTime(selectedTrip.live?.locatedAt)}</strong>
                <small>{selectedTrip.live?.isMoving ? "Moving" : "Stopped"}</small>
              </article>
            </div>
          </section>

          <section className="full-road-economics-grid">
            <section className="panel full-road-detention-panel">
              <div className="panel-head compact-panel-head">
                <div>
                  <h2>Detention</h2>
                  <span>Arrival, departure, dwell time, and current billable detention for pickup and delivery.</span>
                </div>
              </div>
              <div className="full-road-timeline-grid">
                <article>
                  <span>Pickup Arrival</span>
                  <strong>{formatDateTime(selectedTripTimeline.pickupArrivedAt)}</strong>
                  <small>{selectedTripProfitability ? `${formatMinutes(selectedTripProfitability.pickupDetention.dwellMinutes)} dwell` : "No dwell yet"}</small>
                </article>
                <article>
                  <span>Pickup Departure</span>
                  <strong>{formatDateTime(selectedTripTimeline.pickupDepartedAt)}</strong>
                  <small>{selectedTripProfitability ? `${formatCurrency(selectedTripProfitability.pickupDetention.amount)} billable` : "$0.00 billable"}</small>
                </article>
                <article>
                  <span>Delivery Arrival</span>
                  <strong>{formatDateTime(selectedTripTimeline.deliveryArrivedAt)}</strong>
                  <small>{selectedTripProfitability ? `${formatMinutes(selectedTripProfitability.deliveryDetention.dwellMinutes)} dwell` : "No dwell yet"}</small>
                </article>
                <article>
                  <span>Delivery Departure</span>
                  <strong>{formatDateTime(selectedTripTimeline.deliveryDepartedAt)}</strong>
                  <small>{selectedTripProfitability ? `${formatCurrency(selectedTripProfitability.deliveryDetention.amount)} billable` : "$0.00 billable"}</small>
                </article>
              </div>
              <div className="full-road-detention-actions">
                {selectedTrip.stage === "at_pickup" && !selectedTripTimeline.pickupArrivedAt ? <button className="secondary-button" type="button" onClick={() => stampTimelineEvent("pickupArrivedAt", "Pickup arrival recorded.")} disabled={tripBusy}>Stamp Pickup Arrival</button> : null}
                {selectedTrip.stage === "enroute_delivery" && !selectedTripTimeline.deliveryArrivedAt ? <button className="secondary-button" type="button" onClick={() => stampTimelineEvent("deliveryArrivedAt", "Delivery arrival recorded.")} disabled={tripBusy}>Stamp Delivery Arrival</button> : null}
              </div>
            </section>

            <section className="panel full-road-profit-panel">
              <div className="panel-head compact-panel-head">
                <div>
                  <h2>Trip Profitability</h2>
                  <span>Manual load economics for this exact load, with Full Road only used for monitoring.</span>
                </div>
              </div>
              <div className="full-road-financial-grid">
                <article>
                  <span>Load</span>
                  <strong>{selectedTripLoadRow?.load_number || selectedTrip.truckNumber}</strong>
                  <small>{selectedTripLoadRow?.customer_name || "Link a saved load to monitor manual profitability"}</small>
                </article>
                <article>
                  <span>Lane</span>
                  <strong>{selectedTripProfitability?.laneKey || `${selectedTrip.pickup} -> ${selectedTrip.delivery}`}</strong>
                  <small>{selectedTripLoadRow?.broker_name || "Broker not set"}</small>
                </article>
                <article>
                  <span>Revenue</span>
                  <strong>{formatCurrency(selectedTripProfitability?.projectedRevenue)}</strong>
                  <small>Rate {formatCurrency(selectedTripProfitability?.revenueBase)} + accessorials {formatCurrency(selectedTripProfitability?.accessorials)}</small>
                </article>
                <article>
                  <span>Total Cost</span>
                  <strong>{formatCurrency(selectedTripProfitability?.projectedCost)}</strong>
                  <small>Manual fuel {formatCurrency(selectedTripProfitability?.estimatedFuelCost)} + driver/tolls/lumper</small>
                </article>
                <article>
                  <span>Projected Margin</span>
                  <strong>{formatCurrency(selectedTripProfitability?.projectedMargin)}</strong>
                  <small>{selectedTripProfitability?.projectedMarginPerMile !== null && selectedTripProfitability?.projectedMarginPerMile !== undefined ? `${formatCurrency(selectedTripProfitability.projectedMarginPerMile)} per mile` : "Enter manual miles in Loads"}</small>
                </article>
                <article>
                  <span>Detention Recoverable</span>
                  <strong>{formatCurrency(selectedTripProfitability?.detentionAmount)}</strong>
                  <small>{selectedTripLoadRow ? `${selectedTripLoadRow.detention_free_minutes || "120"} min free | ${formatCurrency(selectedTripProfitability?.detentionRatePerHour)}/hr` : "Default detention settings"}</small>
                </article>
              </div>
              <div className="full-road-financial-callout">
                <strong>{selectedTripProfitability && selectedTripProfitability.projectedMargin < 0 ? "Margin risk" : "Profitability outlook"}</strong>
                <p>
                  {selectedTripProfitability && selectedTripProfitability.projectedMargin < 0
                    ? "This trip is currently underwater on projected numbers. Check rate, deadhead, fuel plan, and detention recovery before closing it."
                    : "This trip is carrying a positive projected margin. Keep detention timestamps accurate so billed revenue does not leak out at pickup or delivery."}
                </p>
              </div>
            </section>
          </section>

          <section className="full-road-ops-grid">
            <section className="panel full-road-intel-panel">
              <div className="panel-head compact-panel-head">
                <div>
                  <h2>Trip Intelligence</h2>
                  <span>Health score, live risk checks, and the next recommended dispatcher action.</span>
                </div>
              </div>
              <div className="full-road-health-hero">
                <strong>{selectedTripInsights?.healthScore ?? "--"}</strong>
                <div>
                  <span>Health score</span>
                  <p>{selectedTripInsights?.nextAction || "Live monitoring active."}</p>
                </div>
              </div>
              <div className="full-road-progress">
                <div className="full-road-progress-bar" aria-hidden="true">
                  <span style={{ width: `${selectedTripInsights?.progressPercent ?? 0}%` }} />
                </div>
                <small>{metricValue(selectedTripInsights?.progressPercent)}% route progress</small>
              </div>
              <div className="full-road-stage-track">
                {fullRoadStages.map((stage, index) => {
                  const currentIndex = fullRoadStages.indexOf(selectedTrip.stage);
                  const completed = index < currentIndex || selectedTrip.stage === "delivered";
                  const current = stage === selectedTrip.stage;
                  return (
                    <div key={stage} className={`full-road-stage-node ${completed ? "is-complete" : ""} ${current ? "is-current" : ""}`.trim()}>
                      <strong>{index + 1}</strong>
                      <span>{stageLabels[stage]}</span>
                    </div>
                  );
                })}
              </div>
              <div className="full-road-alert-list">
                {selectedTripInsights?.alertItems?.length ? selectedTripInsights.alertItems.map((item) => (
                  <span key={item.label} className={`full-road-insight-pill tone-${item.tone}`}>{item.label}</span>
                )) : <div className="full-road-empty">No active risk alerts on this trip.</div>}
              </div>
            </section>

            <section className="panel full-road-dispatch-panel">
              <div className="panel-head compact-panel-head">
                <div>
                  <h2>Dispatch Summary</h2>
                  <span>One-click shareable summary for dispatch, driver, or after-hours support.</span>
                </div>
                <button className="secondary-button" type="button" onClick={copyDispatchSummary}>
                  Copy Summary
                </button>
              </div>
              <div className="full-road-dispatch-meta">
                <article>
                  <span>Next action</span>
                  <strong>{selectedTripInsights?.nextAction || "Monitor trip"}</strong>
                </article>
                <article>
                  <span>Last ping</span>
                  <strong>{selectedTripInsights?.pingLabel || "Live ping unavailable"}</strong>
                </article>
              </div>
              <pre className="full-road-dispatch-preview">{dispatchSummary}</pre>
            </section>

            <section className="panel full-road-notes-panel">
              <div className="panel-head compact-panel-head">
                <div>
                  <h2>Ops Notes & Checklist</h2>
                  <span>{completedChecklistCount}/{fullRoadChecklistItems.length} dispatcher checks done for this trip.</span>
                </div>
              </div>
              <div className="full-road-checklist">
                {fullRoadChecklistItems.map((item) => (
                  <label key={item.id} className={`full-road-checklist-item ${selectedTripChecklist[item.id] ? "is-done" : ""}`.trim()}>
                    <input type="checkbox" checked={Boolean(selectedTripChecklist[item.id])} onChange={() => toggleChecklistItem(item.id)} />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
              <div className="full-road-quick-notes">
                <button className="secondary-button" type="button" onClick={() => appendQuickNote("Driver called and live ETA confirmed.")}>Driver Called</button>
                <button className="secondary-button" type="button" onClick={() => appendQuickNote("Pickup appointment and reference number verified.")}>Pickup Ready</button>
                <button className="secondary-button" type="button" onClick={() => appendQuickNote("Fuel instructions sent to the driver.")}>Fuel Shared</button>
                <button className="secondary-button" type="button" onClick={() => appendQuickNote("Delivery receiver updated with the latest ETA.")}>ETA Shared</button>
              </div>
              <label className="full-road-notes-field">
                Operations notes
                <textarea
                  value={selectedTripNote}
                  onChange={(event) => updateSelectedTripNote(event.target.value)}
                  placeholder="Gate codes, pickup numbers, delay reasons, driver callback notes, special handling..."
                />
              </label>
            </section>
          </section>

          <section className="full-road-main-grid">
            <section className="panel full-road-map-panel">
              <div className="panel-head compact-panel-head">
                <div>
                  <h2>Live Route</h2>
                  <span>Truck location to Pickup to Delivery with live truck marker and fuel stops.</span>
                </div>
              </div>
              {combinedMapPlan ? (
                <div className="route-map-stage route-map-stage-brand full-road-map-stage">
                  <Suspense fallback={<div className="module-loader">Loading Full Road map...</div>}>
                    <RouteMap
                      plan={combinedMapPlan}
                      active={active}
                      startMarkerTitle={combinedMapPlan.origin?.label || selectedTrip.toPickupPlan.origin.label || "Truck route start"}
                      endMarkerTitle={selectedTrip.toDeliveryPlan.destination.label || selectedTrip.delivery}
                      markers={mapMarkers}
                    />
                  </Suspense>
                </div>
              ) : (
                <div className="full-road-empty">Build a trip to see the live route map.</div>
              )}
            </section>

            <aside className="full-road-side-stack">
              <LegSummary title="Leg 1" plan={selectedTrip.toPickupPlan} nextLabel="Pickup" />
              <LegSummary title="Leg 2" plan={selectedTrip.toDeliveryPlan} nextLabel="Delivery" />
            </aside>
          </section>

          <section className="panel full-road-fuel-panel">
            <div className="panel-head compact-panel-head">
              <div>
                <h2>Fuel Management</h2>
                <span>Smart fuel plan across both legs using the lowest official Auto Diesel prices that still keep the trip reachable.</span>
              </div>
            </div>
            <div className="full-road-fuel-grid">
              {[selectedTrip.toPickupPlan, selectedTrip.toDeliveryPlan].map((plan, index) => {
                const strategy = plan?.fuel_strategy;
                const topStops = plan?.top_fuel_stops || [];
                return (
                  <article key={`fuel-${index + 1}`} className="full-road-fuel-card">
                    <div className="full-road-fuel-head">
                      <div>
                        <span>{index === 0 ? "Truck to Pickup" : "Pickup to Delivery"}</span>
                        <strong>{strategy?.status === "direct" ? "Direct leg" : "Smart fuel plan"}</strong>
                      </div>
                      <em>{strategy ? formatCurrency(strategy.estimated_fuel_cost) : "$0.00"}</em>
                    </div>
                    {strategy?.stops?.length ? (
                      <div className="full-road-fuel-stop-list">
                        {strategy.stops.map((item) => (
                          <div key={`${index}-${item.sequence}-${item.stop.id}`} className="full-road-fuel-stop-item">
                            <strong>{item.sequence}. {item.stop.brand || item.stop.name}</strong>
                            <span>{formatGallons(item.gallons_to_buy)} | {formatFuelPrice(item.auto_diesel_price)} | {formatCurrency(item.estimated_cost)}</span>
                            <small>{item.stop.address}</small>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="full-road-fuel-empty">No required fuel stop on this leg.</div>
                    )}
                    {topStops.length ? (
                      <div className="full-road-top-stop-grid">
                        {topStops.slice(0, 4).map((stop) => (
                          <div key={`${index}-${stop.id}`} className="full-road-top-stop-card">
                            <strong>{stop.brand || stop.name}</strong>
                            <span>{formatFuelPrice(stop.auto_diesel_price ?? stop.diesel_price ?? stop.price)}</span>
                            <small>{stop.address}</small>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
