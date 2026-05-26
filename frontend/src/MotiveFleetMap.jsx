import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { TomTomMap } from "@tomtom-org/maps-sdk/map";
import { buildVehicleLocationLabel } from "./locationFormatting";

const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY || "fu7pxv1akLSodE8K53xEsMMx7aPKLmOl";
const STREET_FOCUS_ZOOM = 15;
const STREET_FOCUS_PITCH = 52;
const FLEET_MAP_PITCH = 20;
const FLEET_MAP_BEARING = -6;

function escapePopupHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function markerTone(vehicle) {
  if (vehicle.is_stale) return "stale";
  if (vehicle.is_moving) return "moving";
  return "stopped";
}

function vehicleIdentity(vehicle) {
  return vehicle?.source_vehicle_key || `${vehicle?.source_connection_id || "default"}:${vehicle?.id ?? ""}`;
}

function markerLabel(vehicle) {
  const number = vehicle.number || "?";
  const truckCode = String(number).split("/")[0].trim() || String(number).trim();
  return truckCode.length > 8 ? truckCode.slice(0, 8) : truckCode;
}

function driverName(vehicle) {
  return vehicle.resolved_driver?.full_name || vehicle.driver?.full_name || vehicle.permanent_driver?.full_name || "No driver";
}

function markerTitle(vehicle) {
  const number = String(vehicle.number || "Truck").split("/")[0].trim() || vehicle.number || "Truck";
  return `${number} | ${driverName(vehicle)}${vehicle.source_connection_name ? ` | ${vehicle.source_connection_name}` : ""}`;
}

function markerPopup(vehicle) {
  const location = vehicle.location || {};
  return [
    vehicle.number || "Vehicle",
    vehicle.source_connection_name ? `Source: ${vehicle.source_connection_name}` : null,
    driverName(vehicle) ? `Driver: ${driverName(vehicle)}` : null,
    vehicle.make || vehicle.model ? `${vehicle.make || ""} ${vehicle.model || ""}`.trim() : null,
    vehicle.status ? `Status: ${vehicle.status}` : null,
    vehicle.vehicle_state ? `Engine: ${vehicle.vehicle_state}` : null,
    location.speed_mph !== null && location.speed_mph !== undefined ? `Speed: ${Number(location.speed_mph).toFixed(1)} mph` : null,
    location.city || location.state ? `Area: ${[location.city, location.state].filter(Boolean).join(", ")}` : null,
    buildVehicleLocationLabel(vehicle, "") || null,
    location.located_at ? `Updated: ${location.located_at}` : null,
  ]
    .filter(Boolean)
    .map((line, index) => (index === 0 ? `<strong>${escapePopupHtml(line)}</strong>` : escapePopupHtml(line)))
    .join("<br/>");
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

function createMarkerElement(vehicle, isSelected) {
  const anchor = document.createElement("div");
  anchor.className = "map-marker-anchor map-marker-anchor-labeled";
  anchor.setAttribute("role", "button");
  anchor.tabIndex = 0;
  anchor.setAttribute("aria-label", markerTitle(vehicle));
  anchor.title = markerTitle(vehicle);

  const marker = document.createElement("div");
  marker.className = `motive-map-marker motive-map-driver-marker motive-map-marker-${markerTone(vehicle)} ${isSelected ? "selected" : ""}`.trim();

  const badge = document.createElement("span");
  badge.className = "motive-map-marker-badge";
  badge.textContent = markerLabel(vehicle);

  const label = document.createElement("span");
  label.className = "motive-map-marker-label";
  label.textContent = markerTitle(vehicle);

  marker.append(badge, label);
  anchor.append(marker);
  anchor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      anchor.click();
    }
  });
  return anchor;
}

export default function MotiveFleetMap({ vehicles, selectedVehicleId, onSelect, active = true, viewMode = "fleet" }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const popupRef = useRef(null);
  const [mapError, setMapError] = useState("");

  const plottedVehicles = useMemo(
    () => vehicles.filter((vehicle) => hasCoordinates(vehicle)),
    [vehicles]
  );

  useEffect(() => {
    if (!active || !mapRef.current?.mapLibreMap) {
      return undefined;
    }

    const resizeMap = () => mapRef.current?.mapLibreMap?.resize();
    const frame = window.requestAnimationFrame(resizeMap);
    const timeout = window.setTimeout(resizeMap, 180);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [active]);

  useEffect(() => {
    if (!containerRef.current || !TOMTOM_KEY) {
      return undefined;
    }

    try {
      TomTomConfig.instance.put({ apiKey: TOMTOM_KEY });
      mapRef.current = new TomTomMap({
        style: "standardLight",
        language: "en-US",
        mapLibre: {
          container: containerRef.current,
          center: [-96, 39],
          zoom: 3,
          pitch: FLEET_MAP_PITCH,
          bearing: FLEET_MAP_BEARING,
          antialias: true,
        },
      });
      setMapError("");
    } catch (error) {
      setMapError(error instanceof Error ? error.message : "Fleet map failed to load.");
    }

    const resizeMap = () => mapRef.current?.mapLibreMap?.resize();
    window.addEventListener("resize", resizeMap);

    return () => {
      window.removeEventListener("resize", resizeMap);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      if (mapRef.current?.mapLibreMap) {
        mapRef.current.mapLibreMap.remove();
      }
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const mapLibreMap = mapRef.current?.mapLibreMap;
    if (!mapLibreMap) {
      return;
    }

    const selectedVehicle = plottedVehicles.find((vehicle) => vehicleIdentity(vehicle) === selectedVehicleId) || null;

    const showVehiclePopup = (vehicle) => {
      if (!hasCoordinates(vehicle)) {
        return;
      }
      if (popupRef.current) {
        popupRef.current.remove();
      }
      popupRef.current = new maplibregl.Popup({ offset: 16 })
        .setLngLat([vehicle.location.lon, vehicle.location.lat])
        .setHTML(markerPopup(vehicle))
        .addTo(mapLibreMap);
    };

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }

    if (!plottedVehicles.length) {
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    plottedVehicles.forEach((vehicle) => {
      const identity = vehicleIdentity(vehicle);
      const isSelected = identity === selectedVehicleId;
      const element = createMarkerElement(vehicle, isSelected);
      element.addEventListener("click", () => {
        onSelect?.(identity);
        showVehiclePopup(vehicle);
      });

      const marker = new maplibregl.Marker({ element, anchor: "bottom" })
        .setLngLat([vehicle.location.lon, vehicle.location.lat])
        .addTo(mapLibreMap);
      markersRef.current.push(marker);
      bounds.extend([vehicle.location.lon, vehicle.location.lat]);
    });

    if (viewMode === "street" && selectedVehicle) {
      showVehiclePopup(selectedVehicle);
      mapLibreMap.easeTo({
        center: [selectedVehicle.location.lon, selectedVehicle.location.lat],
        zoom: STREET_FOCUS_ZOOM,
        pitch: STREET_FOCUS_PITCH,
        bearing: selectedVehicle.location?.bearing ?? 0,
        duration: 700,
      });
      return;
    }

    if (!bounds.isEmpty()) {
      const mapWidth = mapLibreMap.getContainer().clientWidth;
      const horizontalPadding = mapWidth < 640 ? 70 : 126;
      const verticalPadding = mapWidth < 640 ? 58 : 72;
      mapLibreMap.fitBounds(bounds, {
        padding: {
          top: verticalPadding,
          right: horizontalPadding,
          bottom: verticalPadding,
          left: horizontalPadding
        },
        maxZoom: 10.5,
        duration: 600,
        bearing: FLEET_MAP_BEARING,
        pitch: FLEET_MAP_PITCH
      });
    }
  }, [onSelect, plottedVehicles, selectedVehicleId, viewMode]);

  if (mapError) {
    return <div className="empty-route-card">Fleet map failed: {mapError}</div>;
  }

  return (
    <div className="motive-fleet-map-shell">
      <div ref={containerRef} className="motive-fleet-map" />
      {!plottedVehicles.length ? (
        <div className="motive-map-overlay">No Motive vehicles with live coordinates yet.</div>
      ) : null}
    </div>
  );
}
