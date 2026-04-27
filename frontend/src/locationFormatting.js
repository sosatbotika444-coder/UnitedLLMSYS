const APPROXIMATE_DISTANCE_RE = /\b\d+(?:\.\d+)?\s*(?:mi|mile|miles|km|kilometer|kilometers)\s+(?:n|s|e|w|ne|nw|se|sw|north|south|east|west|northeast|northwest|southeast|southwest)\s+of\b/i;

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatCoordinatePair(lat, lon, precision = 5) {
  const parsedLat = finiteNumber(lat);
  const parsedLon = finiteNumber(lon);
  if (parsedLat === null || parsedLon === null) return "";
  return `${parsedLat.toFixed(precision)}, ${parsedLon.toFixed(precision)}`;
}

export function isApproximateLocationLabel(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return APPROXIMATE_DISTANCE_RE.test(text);
}

export function buildLocationLabel(location, fallback = "Location unavailable") {
  if (!location) return fallback;

  const displayLabel = String(location.display_label || "").trim();
  if (displayLabel) return displayLabel;

  const address = String(location.address || "").trim();
  const cityState = [location.city, location.state].filter(Boolean).join(", ");
  const coordinates = formatCoordinatePair(location.lat, location.lon);

  if (address && isApproximateLocationLabel(address) && coordinates) {
    return cityState ? `${cityState} (${coordinates})` : `${address} (${coordinates})`;
  }

  return address || cityState || coordinates || fallback;
}

export function buildVehicleLocationLabel(vehicle, fallback = "Location unavailable") {
  return buildLocationLabel(vehicle?.location, fallback);
}

export function buildVehicleLocationQuery(vehicle) {
  const location = vehicle?.location || {};
  const coordinates = formatCoordinatePair(location.lat, location.lon);
  if (coordinates) return coordinates;

  const address = String(location.address || "").trim();
  if (address && !isApproximateLocationLabel(address)) return address;

  const cityState = [location.city, location.state].filter(Boolean).join(", ");
  return cityState || address || String(location.display_label || "").trim() || "";
}

export function vehicleLocationPoint(vehicle) {
  const location = vehicle?.location || {};
  const lat = finiteNumber(location.lat);
  const lon = finiteNumber(location.lon);
  if (lat === null || lon === null) return null;
  return { lat, lon };
}
