import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { TomTomMap } from "@tomtom-org/maps-sdk/map";

const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY || "fu7pxv1akLSodE8K53xEsMMx7aPKLmOl";

function hasCoordinates(item) {
  return item && item.lat !== null && item.lat !== undefined && item.lon !== null && item.lon !== undefined;
}

function markerLabel(item) {
  if (!item?.name) return "S";
  const compact = String(item.name).trim();
  return compact.length > 2 ? compact.slice(0, 2).toUpperCase() : compact.toUpperCase();
}

function servicePopup(item) {
  return [
    `<strong>${item.name || "Service"}</strong>`,
    item.brand ? `${item.brand}${item.location_type ? ` - ${item.location_type}` : ""}` : item.location_type || null,
    item.address || null,
    item.phone ? `Phone: ${item.phone}` : null,
    item.highway ? `Highway: ${item.highway}` : null,
    item.exit_number ? `Exit: ${item.exit_number}` : null,
    item.distance_miles !== null && item.distance_miles !== undefined ? `Distance: ${Number(item.distance_miles).toFixed(1)} mi` : null,
    item.services?.length ? `Services: ${item.services.slice(0, 8).join(", ")}` : null,
    item.official_match ? "Official station data" : "Live POI result",
  ]
    .filter(Boolean)
    .join("<br/>");
}

function vehiclePopup(vehicle) {
  return [
    `<strong>${vehicle?.label || vehicle?.number || "Truck"}</strong>`,
    vehicle?.driver_name ? `Driver: ${vehicle.driver_name}` : null,
    vehicle?.address || null,
    vehicle?.is_stale ? "Telemetry stale" : "Live coordinates",
  ]
    .filter(Boolean)
    .join("<br/>");
}

function vehicleMarkerTitle(vehicle) {
  return [vehicle?.label || vehicle?.number || "Truck", vehicle?.driver_name || "No driver"].filter(Boolean).join(" | ");
}

function createMarkerElement(type, label, selected = false, title = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `safety-service-map-marker safety-service-map-marker-${type}${selected ? " selected" : ""}${title ? " labeled" : ""}`;

  const badge = document.createElement("span");
  badge.className = "safety-service-map-marker-badge";
  badge.textContent = label;
  button.append(badge);

  if (title) {
    const text = document.createElement("span");
    text.className = "safety-service-map-marker-label";
    text.textContent = title;
    button.append(text);
  }

  button.setAttribute("aria-label", title || label);
  return button;
}
export default function SafetyServiceMapCanvas({ centerVehicle, items, selectedItemId, onSelect, active = true }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const popupRef = useRef(null);
  const [mapError, setMapError] = useState("");

  const hasCenterVehicle = hasCoordinates(centerVehicle);
  const plottedItems = useMemo(() => (items || []).filter((item) => hasCoordinates(item)), [items]);

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
        style: "drivingLight",
        language: "en-US",
        mapLibre: {
          container: containerRef.current,
          center: [-96, 39],
          zoom: 3,
        },
      });
      setMapError("");
    } catch (error) {
      setMapError(error instanceof Error ? error.message : "Service map failed to load.");
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

    const selectedItem = plottedItems.find((item) => item.id === selectedItemId) || plottedItems[0] || null;

    const showPopup = (lng, lat, html) => {
      if (popupRef.current) {
        popupRef.current.remove();
      }
      popupRef.current = new maplibregl.Popup({ offset: 16 }).setLngLat([lng, lat]).setHTML(html).addTo(mapLibreMap);
    };

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }

    const bounds = new maplibregl.LngLatBounds();

    if (centerVehicle && hasCoordinates(centerVehicle)) {
      const vehicleElement = createMarkerElement("vehicle", "DR", false, vehicleMarkerTitle(centerVehicle));
      vehicleElement.addEventListener("click", () => showPopup(centerVehicle.lon, centerVehicle.lat, vehiclePopup(centerVehicle)));
      markersRef.current.push(new maplibregl.Marker({ element: vehicleElement }).setLngLat([centerVehicle.lon, centerVehicle.lat]).addTo(mapLibreMap));
      bounds.extend([centerVehicle.lon, centerVehicle.lat]);
    }

    plottedItems.forEach((item) => {
      const markerType = item.kind === "poi" ? "poi" : item.emergency_ready ? "emergency" : "official";
      const element = createMarkerElement(markerType, markerLabel(item), item.id === selectedItemId);
      element.addEventListener("click", () => {
        onSelect?.(item.id);
        showPopup(item.lon, item.lat, servicePopup(item));
      });
      markersRef.current.push(new maplibregl.Marker({ element }).setLngLat([item.lon, item.lat]).addTo(mapLibreMap));
      bounds.extend([item.lon, item.lat]);
    });

    if (selectedItem && hasCoordinates(selectedItem)) {
      showPopup(selectedItem.lon, selectedItem.lat, servicePopup(selectedItem));
    }

    if (!bounds.isEmpty()) {
      mapLibreMap.fitBounds(bounds, { padding: 52, maxZoom: 11, duration: 450, bearing: 0, pitch: 0 });
    }
  }, [centerVehicle, onSelect, plottedItems, selectedItemId]);

  if (mapError) {
    return <div className="empty-route-card">Service map failed: {mapError}</div>;
  }

  return (
    <div className="safety-service-map-shell">
      <div ref={containerRef} className="safety-service-map-canvas" />
      {!hasCenterVehicle ? (
        <div className="safety-map-overlay">Select a truck with live coordinates to center the service map.</div>
      ) : !plottedItems.length ? (
        <div className="safety-map-overlay">No visible service points matched the current filters.</div>
      ) : null}
    </div>
  );
}
