import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

const RouteMap = lazy(() => import("./RouteMap"));

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const ROUTE_REQUEST_TIMEOUT_MS = 120000;
const FLEET_REFRESH_INTERVAL_MS = 45000;
const TRIPS_REFRESH_INTERVAL_MS = 60000;
const DEFAULT_TANK_CAPACITY_GALLONS = 200;
const DEFAULT_TRUCK_MPG = 6.0;
const DEFAULT_CURRENT_FUEL_GALLONS = 100;
const PICKUP_ARRIVAL_THRESHOLD_MILES = 1;
const DELIVERY_COMPLETE_THRESHOLD_MILES = 1;
const FULL_ROAD_MAP_ORIGIN_DRIFT_THRESHOLD_MILES = 8;
const stageLabels = {
  enroute_pickup: "Truck to Pickup",
  at_pickup: "At Pickup",
  enroute_delivery: "Pickup to Delivery",
  delivered: "Delivered"
};

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

function metricValue(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
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
  const mpg = Math.max(0.1, Number(row?.mpg) || DEFAULT_TRUCK_MPG);
  const currentFuelGallons = resolvedFuelPercent !== null
    ? (tankCapacityGallons * resolvedFuelPercent) / 100
    : DEFAULT_CURRENT_FUEL_GALLONS;

  return {
    matchedLoadId: row?.id || null,
    tankCapacityGallons,
    mpg,
    fuelPercent: resolvedFuelPercent,
    currentFuelGallons
  };
}

function toMilesFromMeters(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed / 1609.344;
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

  const bestRoute = plan?.routes?.[0];
  const routeMiles = plan?.fuel_strategy?.total_route_miles || toMilesFromMeters(bestRoute?.distance_meters);
  const purchasedGallons = (plan?.fuel_strategy?.stops || []).reduce((sum, item) => sum + (Number(item.gallons_to_buy) || 0), 0);
  const consumedGallons = routeMiles / economy;
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

function buildCombinedMapPlan(trip, vehicle = null) {
  if (!trip?.toPickupPlan || !trip?.toDeliveryPlan) return null;
  const pickupBestRoute = trip.toPickupPlan.routes?.[0];
  const deliveryBestRoute = trip.toDeliveryPlan.routes?.[0];
  if (!pickupBestRoute || !deliveryBestRoute) return null;
  const livePoint = locationPoint(vehicle);
  const fallbackOrigin = trip.toPickupPlan.origin;
  const routeStartPoint = pickupBestRoute.points?.[0];
  const resolvedOrigin = livePoint
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
  const pickupPoint = trip.toPickupPlan.destination;
  const driftFromPickupRouteStart = livePoint && routeStartPoint
    ? haversineMiles(
      { lat: Number(routeStartPoint.lat), lon: Number(routeStartPoint.lon) },
      { lat: livePoint.lat, lon: livePoint.lon }
    )
    : null;
  const shouldPatchPickupLeg =
    driftFromPickupRouteStart !== null
    && Number.isFinite(driftFromPickupRouteStart)
    && driftFromPickupRouteStart > FULL_ROAD_MAP_ORIGIN_DRIFT_THRESHOLD_MILES
    && pickupPoint?.lat !== undefined
    && pickupPoint?.lon !== undefined;
  const pickupRouteForMap = shouldPatchPickupLeg
    ? {
      ...pickupBestRoute,
      id: `${trip.id}-pickup-leg`,
      label: "Truck to Pickup (live)",
      points: [
        { lat: livePoint.lat, lon: livePoint.lon },
        { lat: Number(pickupPoint.lat), lon: Number(pickupPoint.lon) }
      ],
      fuel_stops: []
    }
    : {
      ...pickupBestRoute,
      id: `${trip.id}-pickup-leg`,
      label: "Truck to Pickup"
    };

  const stopMap = new Map();
  [...(trip.toPickupPlan.top_fuel_stops || []), ...(trip.toDeliveryPlan.top_fuel_stops || [])].forEach((stop) => {
    if (!stopMap.has(stop.id)) {
      stopMap.set(stop.id, stop);
    }
  });

  return {
    origin: resolvedOrigin,
    destination: trip.toDeliveryPlan.destination,
    routes: [
      pickupRouteForMap,
      { ...deliveryBestRoute, id: `${trip.id}-delivery-leg`, label: "Pickup to Delivery" }
    ],
    top_fuel_stops: [...stopMap.values()],
    fuel_strategy: null
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

  if (nextStage !== "delivered" && distanceToDeliveryMiles !== null && distanceToDeliveryMiles <= DELIVERY_COMPLETE_THRESHOLD_MILES) {
    nextStage = "delivered";
  } else if (nextStage === "enroute_pickup" && distanceToPickupMiles !== null && distanceToPickupMiles <= PICKUP_ARRIVAL_THRESHOLD_MILES) {
    nextStage = "at_pickup";
  } else if (nextStage === "at_pickup" && distanceToPickupMiles !== null && distanceToPickupMiles > 2) {
    nextStage = "enroute_delivery";
  }

  return {
    ...trip,
    updatedAt: new Date().toISOString(),
    stage: nextStage,
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
  const selectedStop = plan?.selected_stop;

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
  const [selectedLoadId, setSelectedLoadId] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [pickup, setPickup] = useState("");
  const [delivery, setDelivery] = useState("");
  const [activeTrips, setActiveTrips] = useState([]);
  const [selectedTripId, setSelectedTripId] = useState("");
  const activeTripsRef = useRef([]);
  const fleetSnapshotRef = useRef(null);

  useEffect(() => {
    activeTripsRef.current = activeTrips;
  }, [activeTrips]);

  useEffect(() => {
    fleetSnapshotRef.current = fleetSnapshot;
  }, [fleetSnapshot]);

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
    const stageChangedTrips = [];
    const nextTrips = currentTrips.map((trip) => {
      const vehicle = vehiclesById.get(String(trip.vehicleId));
      if (!vehicle) return trip;
      const nextTrip = updateTripLiveState(trip, vehicle);
      if (nextTrip.stage !== trip.stage) {
        stageChangedTrips.push(nextTrip);
      }
      return nextTrip;
    });

    setActiveTrips(nextTrips);

    if (!token || !stageChangedTrips.length) return;

    Promise.all(
      stageChangedTrips.map((trip) =>
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
  const selectedTripVehicle = useMemo(
    () => vehicles.find((vehicle) => String(vehicle.id) === String(selectedTrip?.vehicleId)) || null,
    [selectedTrip?.vehicleId, vehicles]
  );
  const openTrips = useMemo(() => activeTrips.filter((trip) => trip.stage !== "delivered"), [activeTrips]);
  const combinedMapPlan = useMemo(
    () => buildCombinedMapPlan(selectedTrip, selectedTripVehicle),
    [selectedTrip, selectedTripVehicle]
  );
  const mapMarkers = useMemo(() => tripExtraMarkers(selectedTrip, selectedTripVehicle), [selectedTrip, selectedTripVehicle]);
  const selectedPreset = useMemo(() => (selectedVehicle ? deriveTruckPreset(selectedVehicle, loadRows) : null), [loadRows, selectedVehicle]);

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
            sort_by: "best"
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
            sort_by: "best"
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
      const stagedTrip = {
        ...selectedTrip,
        stage: nextStage,
        updatedAt: new Date().toISOString()
      };
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
          </div>
        </div>

        <div className="full-road-builder-grid">
          <label className="full-road-field-load">
            Use saved load
            <select value={selectedLoadId} onChange={(event) => setSelectedLoadId(event.target.value)}>
              <option value="">Manual trip</option>
              {loadRows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.driver || "Driver"} | {row.truck || "Truck"} | {row.pickup_city || "Pickup"} to {row.delivery_city || "Delivery"}
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
                  {vehicleLabel(vehicle)} | {vehicleDriverName(vehicle)} | {formatFuelPercent(vehicleFuelPercent(vehicle))} | {vehicleLocationLabel(vehicle)}
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
            <span>Trips stay here until the truck reaches Delivery.</span>
          </div>
        </div>
        <div className="full-road-trip-strip">
          {openTrips.length ? openTrips.map((trip) => (
            <button
              key={trip.id}
              type="button"
              className={`full-road-trip-tab ${String(selectedTripId) === String(trip.id) ? "active" : ""}`.trim()}
              onClick={() => loadTripIntoForm(trip)}
            >
              <span className={`full-road-trip-stage tone-${stageTone(trip.stage)}`}>{stageLabels[trip.stage] || "Trip"}</span>
              <strong>{trip.truckNumber}</strong>
              <small>{trip.pickup} to {trip.delivery}</small>
              <em>{trip.live?.distanceToDeliveryMiles !== null && trip.live?.distanceToDeliveryMiles !== undefined ? `${trip.live.distanceToDeliveryMiles.toFixed(1)} mi to delivery` : "Waiting on live GPS"}</em>
            </button>
          )) : <div className="full-road-empty">No active Full Road trips yet.</div>}
        </div>
      </section>

      {selectedTrip ? (
        <>
          <section className="full-road-summary-grid">
            <SummaryCard label="Truck" value={selectedTrip.truckNumber} detail={selectedTrip.driverName} tone="blue" />
            <SummaryCard label="Total Miles" value={formatDistanceMiles(selectedTrip.metrics.totalMiles)} detail={`${formatDistanceMiles(selectedTrip.metrics.toPickupMiles)} to PU + ${formatDistanceMiles(selectedTrip.metrics.toDeliveryMiles)} to DEL`} tone="green" />
            <SummaryCard label="ETA Pickup" value={formatDateTime(selectedTrip.metrics.etaToPickup)} detail={formatDuration(selectedTrip.metrics.toPickupDurationSeconds)} tone="amber" />
            <SummaryCard label="ETA Delivery" value={formatDateTime(selectedTrip.metrics.etaToDelivery)} detail={formatDuration(selectedTrip.metrics.totalDurationSeconds)} tone="violet" />
            <SummaryCard label="Fuel Stops" value={metricValue(selectedTrip.metrics.fuelStopCount)} detail={formatCurrency(selectedTrip.metrics.estimatedFuelCost)} tone="dark" />
            <SummaryCard label="Live Next" value={nextDistance !== null && nextDistance !== undefined ? formatDistanceMiles(nextDistance) : "No GPS"} detail={nextEta ? `Last ETA ${formatDateTime(nextEta)}` : "Waiting on route"} tone="green" />
          </section>

          <section className="panel full-road-control-panel">
            <div className="panel-head compact-panel-head">
              <div>
                <h2>{selectedTrip.pickup} to {selectedTrip.delivery}</h2>
                <span>{stageLabels[selectedTrip.stage] || "Trip"} | Last route refresh {formatDateTime(selectedTrip.metrics.lastRouteRefreshAt)}</span>
              </div>
              <div className="full-road-stage-actions">
                {selectedTrip.stage === "enroute_pickup" ? <button className="secondary-button" type="button" onClick={() => updateTripStage("at_pickup")} disabled={tripBusy}>Mark At Pickup</button> : null}
                {selectedTrip.stage === "at_pickup" ? <button className="secondary-button" type="button" onClick={() => updateTripStage("enroute_delivery")} disabled={tripBusy}>Depart Pickup</button> : null}
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
                <span>Smart fuel plan across both legs with the best available official stops.</span>
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
