import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { TomTomMap } from "@tomtom-org/maps-sdk/map";

const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY || "fu7pxv1akLSodE8K53xEsMMx7aPKLmOl";

function markerTone(vehicle) {
  if (vehicle.is_stale) return "stale";
  if (vehicle.is_moving) return "moving";
  return "stopped";
}

function markerLabel(vehicle) {
  const number = vehicle.number || "?";
  return number.length > 6 ? number.slice(0, 6) : number;
}

function markerPopup(vehicle) {
  const location = vehicle.location || {};
  return [
    `<strong>${vehicle.number || "Vehicle"}</strong>`,
    vehicle.driver?.full_name ? `Driver: ${vehicle.driver.full_name}` : null,
    vehicle.make || vehicle.model ? `${vehicle.make || ""} ${vehicle.model || ""}`.trim() : null,
    vehicle.status ? `Status: ${vehicle.status}` : null,
    vehicle.vehicle_state ? `Engine: ${vehicle.vehicle_state}` : null,
    location.speed_mph !== null && location.speed_mph !== undefined ? `Speed: ${Number(location.speed_mph).toFixed(1)} mph` : null,
    location.city || location.state ? `Area: ${[location.city, location.state].filter(Boolean).join(", ")}` : null,
    location.address || null,
    location.located_at ? `Updated: ${location.located_at}` : null,
  ]
    .filter(Boolean)
    .join("<br/>");
}

function createMarkerElement(vehicle, isSelected) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `motive-map-marker motive-map-marker-${markerTone(vehicle)} ${isSelected ? "selected" : ""}`.trim();
  button.textContent = markerLabel(vehicle);
  button.setAttribute("aria-label", vehicle.number || "vehicle marker");
  return button;
}

export default function MotiveFleetMap({ vehicles, selectedVehicleId, onSelect, active = true }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const popupRef = useRef(null);
  const [mapError, setMapError] = useState("");

  const plottedVehicles = useMemo(
    () =>
      vehicles.filter(
        (vehicle) =>
          vehicle.location && vehicle.location.lat !== null && vehicle.location.lat !== undefined && vehicle.location.lon !== null && vehicle.location.lon !== undefined
      ),
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
        mapLibre: {
          container: containerRef.current,
          center: [-96, 39],
          zoom: 3,
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
      const isSelected = vehicle.id === selectedVehicleId;
      const element = createMarkerElement(vehicle, isSelected);
      element.addEventListener("click", () => {
        onSelect?.(vehicle.id);
        if (popupRef.current) {
          popupRef.current.remove();
        }
        popupRef.current = new maplibregl.Popup({ offset: 16 })
          .setLngLat([vehicle.location.lon, vehicle.location.lat])
          .setHTML(markerPopup(vehicle))
          .addTo(mapLibreMap);
      });

      const marker = new maplibregl.Marker({ element })
        .setLngLat([vehicle.location.lon, vehicle.location.lat])
        .addTo(mapLibreMap);
      markersRef.current.push(marker);
      bounds.extend([vehicle.location.lon, vehicle.location.lat]);
    });

    if (!bounds.isEmpty()) {
      mapLibreMap.fitBounds(bounds, { padding: 50, maxZoom: 10, duration: 500 });
    }
  }, [plottedVehicles, selectedVehicleId, onSelect]);

  if (mapError) {
    return <div className="empty-route-card">Fleet map failed: {mapError}</div>;
  }

  if (!plottedVehicles.length) {
    return <div className="empty-route-card">No Motive vehicles with live coordinates yet.</div>;
  }

  return <div ref={containerRef} className="motive-fleet-map" />;
}

