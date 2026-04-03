import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { TomTomMap } from "@tomtom-org/maps-sdk/map";

const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY || "";
const routeColors = ["#1d4ed8", "#0f766e", "#ea580c"];

function createMarkerElement(className, label) {
  const el = document.createElement("div");
  el.className = `tt-marker ${className}`;
  el.textContent = label;
  return el;
}

export default function RouteMap({ plan }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const [mapError, setMapError] = useState("");

  const allStops = useMemo(() => {
    const byId = new Map();
    plan.routes.flatMap((route) => route.fuel_stops).forEach((stop) => {
      if (!byId.has(stop.id)) {
        byId.set(stop.id, stop);
      }
    });
    return [...byId.values()];
  }, [plan]);

  useEffect(() => {
    if (!containerRef.current || !TOMTOM_KEY) {
      return undefined;
    }

    let active = true;
    let map = null;

    const renderMap = () => {
      if (!active || !map) {
        return;
      }

      const mapLibreMap = map.mapLibreMap;
      const routeFeatures = plan.routes.map((route, index) => ({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: route.points.map((point) => [point.lon, point.lat])
        },
        properties: {
          routeId: route.id,
          color: routeColors[index % routeColors.length],
          width: index === 0 ? 6 : 4
        }
      }));

      const routesGeoJson = {
        type: "FeatureCollection",
        features: routeFeatures
      };

      if (mapLibreMap.getLayer("dispatch-routes-line")) {
        mapLibreMap.removeLayer("dispatch-routes-line");
      }
      if (mapLibreMap.getSource("dispatch-routes")) {
        mapLibreMap.removeSource("dispatch-routes");
      }

      mapLibreMap.addSource("dispatch-routes", {
        type: "geojson",
        data: routesGeoJson
      });

      mapLibreMap.addLayer({
        id: "dispatch-routes-line",
        type: "line",
        source: "dispatch-routes",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": 0.9
        }
      });

      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];

      const bounds = new maplibregl.LngLatBounds();
      plan.routes.forEach((route) => route.points.forEach((point) => bounds.extend([point.lon, point.lat])));
      allStops.forEach((stop) => bounds.extend([stop.lon, stop.lat]));
      bounds.extend([plan.origin.lon, plan.origin.lat]);
      bounds.extend([plan.destination.lon, plan.destination.lat]);
      mapLibreMap.fitBounds(bounds, { padding: 50, duration: 0 });

      const bestIds = new Set(plan.top_fuel_stops.map((stop) => stop.id));

      const startMarker = new maplibregl.Marker({ element: createMarkerElement("marker-start", "A") })
        .setLngLat([plan.origin.lon, plan.origin.lat])
        .addTo(mapLibreMap);
      const endMarker = new maplibregl.Marker({ element: createMarkerElement("marker-end", "B") })
        .setLngLat([plan.destination.lon, plan.destination.lat])
        .addTo(mapLibreMap);

      markersRef.current.push(startMarker, endMarker);

      allStops.forEach((stop) => {
        const markerClass = bestIds.has(stop.id)
          ? "marker-fuel-best"
          : stop.brand === "Independent"
            ? "marker-fuel-independent"
            : "marker-fuel";
        const markerLabel = bestIds.has(stop.id) ? "Top" : stop.brand === "Independent" ? "Ind" : "Fuel";

        const popup = new maplibregl.Popup({ offset: 18 }).setHTML(
          `<strong>${stop.brand || stop.name}</strong><br/>${stop.address}<br/>${stop.price ? `Avg diesel: $${stop.price.toFixed(3)}/gal<br/>` : ""}Detour: ${Math.round((stop.detour_distance_meters || 0) * 0.000621371 * 10) / 10} mi`
        );

        const marker = new maplibregl.Marker({ element: createMarkerElement(markerClass, markerLabel) })
          .setLngLat([stop.lon, stop.lat])
          .setPopup(popup)
          .addTo(mapLibreMap);

        markersRef.current.push(marker);
      });
    };

    const initializeMap = () => {
      try {
        setMapError("");
        TomTomConfig.instance.put({ apiKey: TOMTOM_KEY });

        map = new TomTomMap({
          mapLibre: {
            container: containerRef.current,
            center: [plan.origin.lon, plan.origin.lat],
            zoom: 4
          }
        });

        mapRef.current = map;

        if (map.mapLibreMap.isStyleLoaded()) {
          renderMap();
        } else {
          map.mapLibreMap.once("styledata", renderMap);
        }
      } catch (error) {
        setMapError(error instanceof Error ? error.message : "Map failed to initialize.");
      }
    };

    initializeMap();

    return () => {
      active = false;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      if (mapRef.current?.mapLibreMap) {
        mapRef.current.mapLibreMap.remove();
      }
      mapRef.current = null;
    };
  }, [allStops, plan]);

  if (!TOMTOM_KEY) {
    return <div className="empty-route-card">Map is disabled because VITE_TOMTOM_API_KEY is missing.</div>;
  }

  if (mapError) {
    return <div className="empty-route-card">Map failed to load: {mapError}</div>;
  }

  return <div ref={containerRef} className="live-route-map" />;
}