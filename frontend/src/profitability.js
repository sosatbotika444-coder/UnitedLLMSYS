const DEFAULT_DETENTION_FREE_MINUTES = 120;
const DEFAULT_DETENTION_RATE_PER_HOUR = 50;

export function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

export function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const sanitized = String(value).replace(/[$,%\s]/g, "").replace(/,/g, "");
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function positiveNumber(value) {
  const parsed = numericValue(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function parseDateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildLaneKey(pickup, delivery) {
  const pickupLabel = String(pickup || "").trim();
  const deliveryLabel = String(delivery || "").trim();
  if (pickupLabel && deliveryLabel) return `${pickupLabel} -> ${deliveryLabel}`;
  return pickupLabel || deliveryLabel || "Unassigned lane";
}

export function getTripStageTimeline(trip) {
  const timeline = trip?.metrics?.stageTimeline;
  return timeline && typeof timeline === "object" ? timeline : {};
}

function withTripStageTimeline(trip, timeline) {
  return {
    ...trip,
    metrics: {
      ...(trip?.metrics || {}),
      stageTimeline: timeline,
    },
  };
}

export function recordTripTimelineEvent(trip, eventKey, eventAt = new Date().toISOString()) {
  const currentTimeline = getTripStageTimeline(trip);
  const nextTimeline = {
    ...currentTimeline,
    [eventKey]: eventAt,
  };

  if (eventKey === "pickupDepartedAt" && !nextTimeline.pickupArrivedAt) {
    nextTimeline.pickupArrivedAt = eventAt;
  }
  if (eventKey === "deliveryDepartedAt" && !nextTimeline.deliveryArrivedAt) {
    nextTimeline.deliveryArrivedAt = eventAt;
  }

  return withTripStageTimeline(trip, nextTimeline);
}

export function applyTripStageLifecycle(trip, nextStage, eventAt = new Date().toISOString(), options = {}) {
  const timeline = { ...getTripStageTimeline(trip) };
  const { setDeliveryArrival = false } = options;

  if (nextStage === "at_pickup" && !timeline.pickupArrivedAt) {
    timeline.pickupArrivedAt = eventAt;
  }

  if (nextStage === "enroute_delivery") {
    if (!timeline.pickupArrivedAt) timeline.pickupArrivedAt = eventAt;
    if (!timeline.pickupDepartedAt) timeline.pickupDepartedAt = eventAt;
  }

  if (setDeliveryArrival && !timeline.deliveryArrivedAt) {
    timeline.deliveryArrivedAt = eventAt;
  }

  if (nextStage === "delivered") {
    if (!timeline.deliveryArrivedAt) timeline.deliveryArrivedAt = eventAt;
    if (!timeline.deliveryDepartedAt) timeline.deliveryDepartedAt = eventAt;
  }

  return withTripStageTimeline(
    {
      ...trip,
      stage: nextStage,
    },
    timeline,
  );
}

function computeDetentionWindow(arrivalAt, departureAt, freeMinutes, ratePerHour, nowTs) {
  const arrivalDate = parseDateValue(arrivalAt);
  if (!arrivalDate) {
    return {
      arrivalAt: null,
      departureAt: departureAt || null,
      dwellMinutes: 0,
      billableMinutes: 0,
      amount: 0,
      isRunning: false,
      hasBillableTime: false,
    };
  }

  const departureDate = parseDateValue(departureAt);
  const effectiveEndTs = departureDate ? departureDate.getTime() : nowTs;
  const dwellMinutes = Math.max(0, Math.round((effectiveEndTs - arrivalDate.getTime()) / 60000));
  const billableMinutes = Math.max(0, dwellMinutes - Math.max(0, freeMinutes));
  const amount = billableMinutes > 0
    ? Number(((billableMinutes / 60) * Math.max(0, ratePerHour)).toFixed(2))
    : 0;

  return {
    arrivalAt: arrivalDate.toISOString(),
    departureAt: departureDate ? departureDate.toISOString() : null,
    dwellMinutes,
    billableMinutes,
    amount,
    isRunning: !departureDate,
    hasBillableTime: billableMinutes > 0,
  };
}

export function resolveLoadForTrip(trip, loadRows = []) {
  if (!trip || !Array.isArray(loadRows) || !loadRows.length) return null;

  if (!trip.loadId) return null;
  return loadRows.find((row) => String(row?.id) === String(trip.loadId)) || null;
}

export function buildTripProfitabilitySnapshot(trip, loadRow = null, nowTs = Date.now()) {
  const safeTrip = trip || {};
  const safeLoad = loadRow || {};
  const timeline = getTripStageTimeline(safeTrip);
  const freeMinutes = numericValue(safeLoad.detention_free_minutes) ?? DEFAULT_DETENTION_FREE_MINUTES;
  const ratePerHour = numericValue(safeLoad.detention_rate_per_hour) ?? DEFAULT_DETENTION_RATE_PER_HOUR;
  const pickupDetention = computeDetentionWindow(timeline.pickupArrivedAt, timeline.pickupDepartedAt, freeMinutes, ratePerHour, nowTs);
  const deliveryDetention = computeDetentionWindow(timeline.deliveryArrivedAt, timeline.deliveryDepartedAt, freeMinutes, ratePerHour, nowTs);
  const detentionAmount = pickupDetention.amount + deliveryDetention.amount;
  const revenueBase = numericValue(safeLoad.rate_total) ?? 0;
  const accessorials = numericValue(safeLoad.other_accessorials) ?? 0;
  const driverCost = numericValue(safeLoad.driver_pay_total) ?? 0;
  const lumperCost = numericValue(safeLoad.lumper_cost) ?? 0;
  const tollCost = numericValue(safeLoad.toll_cost) ?? 0;
  const estimatedFuelCost = numericValue(safeLoad.manual_fuel_cost) ?? 0;
  const baselineFuelCost = numericValue(safeLoad.baseline_fuel_cost) ?? estimatedFuelCost;
  const totalMiles = numericValue(safeLoad.manual_total_miles);
  const deadheadMiles = numericValue(safeLoad.manual_deadhead_miles);
  const loadedMiles = numericValue(safeLoad.manual_loaded_miles);
  const projectedRevenue = revenueBase + accessorials + detentionAmount;
  const projectedCost = driverCost + lumperCost + tollCost + estimatedFuelCost;
  const projectedCostWithoutService = driverCost + lumperCost + tollCost + baselineFuelCost;
  const projectedMargin = projectedRevenue - projectedCost;
  const projectedMarginWithoutService = projectedRevenue - projectedCostWithoutService;
  const projectedMarginPerMile = totalMiles && totalMiles > 0 ? projectedMargin / totalMiles : null;
  const projectedMarginPerMileWithoutService = totalMiles && totalMiles > 0 ? projectedMarginWithoutService / totalMiles : null;
  const smartServiceSavings = numericValue(safeLoad.smart_service_savings) ?? (baselineFuelCost - estimatedFuelCost);
  const detentionStatus = (pickupDetention.isRunning || deliveryDetention.isRunning)
    ? (pickupDetention.hasBillableTime || deliveryDetention.hasBillableTime ? "running_billable" : "running")
    : detentionAmount > 0
      ? "billable"
      : "clear";

  return {
    tripId: safeTrip?.id || null,
    loadId: safeTrip?.loadId || safeLoad?.id || null,
    truckNumber: String(safeTrip?.truckNumber || safeLoad?.truck || ""),
    driverName: String(safeTrip?.driverName || safeLoad?.driver || ""),
    stage: String(safeTrip?.stage || safeLoad?.status || ""),
    laneKey: buildLaneKey(safeLoad?.pickup_city || safeTrip?.pickup, safeLoad?.delivery_city || safeTrip?.delivery),
    pickup: String(safeLoad?.pickup_city || safeTrip?.pickup || ""),
    delivery: String(safeLoad?.delivery_city || safeTrip?.delivery || ""),
    customerName: String(safeLoad?.customer_name || ""),
    brokerName: String(safeLoad?.broker_name || ""),
    loadNumber: String(safeLoad?.load_number || ""),
    pickupAppointmentAt: safeLoad?.pickup_appt_at || null,
    deliveryAppointmentAt: safeLoad?.delivery_appt_at || null,
    revenueBase,
    accessorials,
    driverCost,
    lumperCost,
    tollCost,
    estimatedFuelCost,
    baselineFuelCost,
    smartServiceSavings,
    fuelSource: estimatedFuelCost > 0 ? (baselineFuelCost > 0 ? "smart_route_fill" : "load_entry") : "missing",
    projectedRevenue,
    projectedCost,
    projectedCostWithoutService,
    projectedMargin,
    projectedMarginWithoutService,
    projectedMarginPerMile,
    projectedMarginPerMileWithoutService,
    totalMiles,
    deadheadMiles,
    loadedMiles,
    detentionFreeMinutes: freeMinutes,
    detentionRatePerHour: ratePerHour,
    pickupDetention,
    deliveryDetention,
    detentionAmount,
    detentionStatus,
    hasLiveTrip: Boolean(safeTrip?.id),
    hasLoadRecord: Boolean(safeLoad?.id),
    updatedAt: safeTrip?.updatedAt || safeTrip?.updated_at || null,
  };
}
