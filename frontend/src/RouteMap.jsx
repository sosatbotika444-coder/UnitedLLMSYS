import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { TomTomMap } from "@tomtom-org/maps-sdk/map";
import { getPriceSignalMeta } from "./priceSignals";

import { TOMTOM_KEY } from "./apiConfig";
const routeColors = ["#0f7cff", "#0f9f6e", "#f97316"];
const ROUTES_SOURCE_ID = "dispatch-routes";
const ROUTES_SHADOW_LAYER_ID = "dispatch-routes-shadow";
const ROUTES_CASING_LAYER_ID = "dispatch-routes-casing";
const ROUTES_LAYER_ID = "dispatch-routes-line";
const STOPS_SOURCE_ID = "clustered-fuel-stops";
const CLUSTERS_LAYER_ID = "fuel-stop-clusters";
const CLUSTER_COUNT_LAYER_ID = "fuel-stop-cluster-count";
const UNCLUSTERED_LAYER_ID = "fuel-stop-points";
const PRICE_LABEL_LAYER_ID = "fuel-stop-price-labels";
const MAP_PITCH = 22;
const MAP_BEARING = -7;
const FUEL_ICON_IMAGES = {
  "fuel-pin-default": { fill: "#0f9f6e", accent: "#8bf6ce", glyph: "F" },
  "fuel-pin-best": { fill: "#0f7cff", accent: "#9bd1ff", glyph: "$" },
  "fuel-pin-strategy": { fill: "#f97316", accent: "#fed7aa", glyph: "GO" },
  "fuel-pin-independent": { fill: "#64748b", accent: "#cbd5e1", glyph: "I" },
  "fuel-cluster-hex": { fill: "#111827", accent: "#38bdf8", glyph: "" }
};

function createShieldImage({ fill, accent, glyph }) {
  const width = 58;
  const height = 66;
  const pixelRatio = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * pixelRatio;
  canvas.height = height * pixelRatio;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.scale(pixelRatio, pixelRatio);
  context.clearRect(0, 0, width, height);
  context.shadowColor = "rgba(15, 23, 42, 0.32)";
  context.shadowBlur = 8;
  context.shadowOffsetY = 5;

  context.beginPath();
  context.moveTo(29, 4);
  context.lineTo(50, 14);
  context.lineTo(50, 36);
  context.bezierCurveTo(50, 48, 38, 59, 29, 65);
  context.bezierCurveTo(20, 59, 8, 48, 8, 36);
  context.lineTo(8, 14);
  context.closePath();
  context.fillStyle = fill;
  context.fill();

  context.shadowColor = "transparent";
  context.lineWidth = 3;
  context.strokeStyle = "rgba(255, 255, 255, 0.95)";
  context.stroke();

  context.beginPath();
  context.moveTo(16, 16);
  context.lineTo(29, 10);
  context.lineTo(42, 16);
  context.lineWidth = 3;
  context.strokeStyle = accent;
  context.lineCap = "round";
  context.stroke();

  context.fillStyle = "#ffffff";
  context.font = glyph.length > 1 ? "900 15px Manrope, Arial, sans-serif" : "900 20px Manrope, Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(glyph, 29, 33);

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function ensureFuelStopImages(mapLibreMap) {
  Object.entries(FUEL_ICON_IMAGES).forEach(([id, options]) => {
    if (mapLibreMap.hasImage(id)) {
      return;
    }

    const image = createShieldImage(options);
    if (image) {
      mapLibreMap.addImage(id, image, { pixelRatio: 2 });
    }
  });
}

function escapePopupHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function createMarkerElement(className, label, title = "") {
  const anchor = document.createElement("div");
  anchor.className = `map-marker-anchor${title ? " map-marker-anchor-labeled" : ""}`;
  anchor.setAttribute("aria-label", title || label);
  anchor.title = title || label;

  const el = document.createElement("div");
  el.className = `tt-marker ${className}${title ? " tt-marker-labeled" : ""}`;

  const badge = document.createElement("span");
  badge.className = "tt-marker-badge";
  badge.textContent = label;
  el.append(badge);

  if (title) {
    const text = document.createElement("span");
    text.className = "tt-marker-label";
    text.textContent = title;
    el.append(text);
  }

  anchor.append(el);
  return anchor;
}
function formatMoney(value) {
  return value !== null && value !== undefined ? `$${Number(value).toFixed(3)}` : "N/A";
}

function buildStopPopup(stop, priceTarget) {
  const priceSignalMeta = getPriceSignalMeta(stop, priceTarget);
  const title = stop.brand || stop.name;
  const subtitle = stop.location_type
    ? `${stop.location_type}${stop.store_number ? ` - Store #${stop.store_number}` : ""}`
    : stop.store_number
      ? `Store #${stop.store_number}`
      : null;

  return [
    `<strong>${escapePopupHtml(title)}</strong>`,
    subtitle,
    stop.address,
    stop.phone ? `Phone: ${stop.phone}` : null,
    stop.strategy_stop ? "Smart fuel plan stop" : null,
    stop.official_match ? "Official Love's/Pilot station page matched" : null,
    priceSignalMeta.target !== null ? `Target signal: ${priceSignalMeta.summary}` : null,
    stop.auto_diesel_price !== null && stop.auto_diesel_price !== undefined ? `Auto Diesel: ${formatMoney(stop.auto_diesel_price)}` : null,
    stop.unleaded_price !== null && stop.unleaded_price !== undefined ? `Unleaded: ${formatMoney(stop.unleaded_price)}` : null,
    stop.price_date ? `As of: ${stop.price_date}` : null,
    stop.parking_spaces ? `Parking: ${stop.parking_spaces}` : null,
    `Off route: ${Math.round(((stop.off_route_miles || 0) + Number.EPSILON) * 10) / 10} mi`,
    `Score: ${Math.round(stop.overall_score || 0)}`,
    stop.amenities?.length ? `Services: ${stop.amenities.slice(0, 8).join(", ")}` : null,
    `Coords: ${Number(stop.lat).toFixed(5)}, ${Number(stop.lon).toFixed(5)}`
  ]
    .filter(Boolean)
    .map((line, index) => (index === 0 ? line : escapePopupHtml(line)))
    .join("<br/>");
}

function buildPriceLabel(stop, priceTarget) {
  const priceSignalMeta = getPriceSignalMeta(stop, priceTarget);
  const autoDiesel = stop.auto_diesel_price !== null && stop.auto_diesel_price !== undefined ? `$${Number(stop.auto_diesel_price).toFixed(3)}` : "-";
  if (priceSignalMeta.signal === "below") return `Below target\n${autoDiesel}`;
  if (priceSignalMeta.signal === "above") return `Above target\n${autoDiesel}`;
  if (priceSignalMeta.signal === "unknown") return `No price\n${autoDiesel}`;
  return `Auto Diesel\n${autoDiesel}`;
}

export default function RouteMap({ plan, isFullscreen = false, active = true, priceTarget = null, startMarkerTitle = "", endMarkerTitle = "", markers }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const popupRef = useRef(null);
  const handlersBoundRef = useRef(false);
  const [mapError, setMapError] = useState("");
  const extraMarkers = useMemo(() => (Array.isArray(markers) ? markers : []), [markers]);

  const allStops = useMemo(() => {
    const byId = new Map();
    plan.routes.flatMap((route) => route.fuel_stops).forEach((stop) => {
      if (!byId.has(stop.id)) {
        byId.set(stop.id, stop);
      }
    });
    return [...byId.values()];
  }, [plan]);

  const strategyStopIds = useMemo(() => new Set((plan.fuel_strategy?.stops || []).map((item) => item.stop?.id).filter(Boolean)), [plan]);

  useEffect(() => {
    const resizeMap = () => {
      mapRef.current?.mapLibreMap?.resize();
    };

    window.addEventListener("resize", resizeMap);
    return () => window.removeEventListener("resize", resizeMap);
  }, []);

  useEffect(() => {
    if (!active || !mapRef.current?.mapLibreMap) {
      return undefined;
    }

    const resizeMap = () => {
      mapRef.current?.mapLibreMap.resize();
    };

    const frame = window.requestAnimationFrame(resizeMap);
    const timeout = window.setTimeout(resizeMap, 180);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [active, isFullscreen, plan]);

  useEffect(() => {
    if (!containerRef.current || !TOMTOM_KEY) {
      return undefined;
    }

    let isMounted = true;
    let mapInstance = null;

    const bindMapHandlers = (mapLibreMap) => {
      if (handlersBoundRef.current) {
        return;
      }

      mapLibreMap.on("click", CLUSTERS_LAYER_ID, (event) => {
        const features = mapLibreMap.queryRenderedFeatures(event.point, { layers: [CLUSTERS_LAYER_ID] });
        const clusterFeature = features[0];
        if (!clusterFeature) {
          return;
        }

        const clusterId = clusterFeature.properties?.cluster_id;
        const source = mapLibreMap.getSource(STOPS_SOURCE_ID);
        if (!source || clusterId === undefined) {
          return;
        }

        source.getClusterExpansionZoom(clusterId, (error, zoom) => {
          if (error) {
            return;
          }
          mapLibreMap.easeTo({
            center: clusterFeature.geometry.coordinates,
            zoom,
            duration: 500
          });
        });
      });

      mapLibreMap.on("click", UNCLUSTERED_LAYER_ID, (event) => {
        const feature = event.features?.[0];
        if (!feature) {
          return;
        }

        const coordinates = [...feature.geometry.coordinates];
        const stop = JSON.parse(feature.properties.stop);

        if (popupRef.current) {
          popupRef.current.remove();
        }

        popupRef.current = new maplibregl.Popup({ offset: 18 })
          .setLngLat(coordinates)
          .setHTML(buildStopPopup(stop, priceTarget))
          .addTo(mapLibreMap);
      });

      mapLibreMap.on("mouseenter", CLUSTERS_LAYER_ID, () => {
        mapLibreMap.getCanvas().style.cursor = "pointer";
      });
      mapLibreMap.on("mouseleave", CLUSTERS_LAYER_ID, () => {
        mapLibreMap.getCanvas().style.cursor = "";
      });
      mapLibreMap.on("mouseenter", UNCLUSTERED_LAYER_ID, () => {
        mapLibreMap.getCanvas().style.cursor = "pointer";
      });
      mapLibreMap.on("mouseleave", UNCLUSTERED_LAYER_ID, () => {
        mapLibreMap.getCanvas().style.cursor = "";
      });

      handlersBoundRef.current = true;
    };

    const renderMap = () => {
      if (!isMounted || !mapInstance) {
        return;
      }

      const mapLibreMap = mapInstance.mapLibreMap;
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

      const stopFeatures = allStops.map((stop) => {
        const priceSignalMeta = getPriceSignalMeta(stop, priceTarget);
        return ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [stop.lon, stop.lat]
          },
          properties: {
            id: stop.id,
            isBest: plan.top_fuel_stops.some((item) => item.id === stop.id),
            isStrategyStop: strategyStopIds.has(stop.id),
            isIndependent: stop.brand === "Independent",
            hasPriceTarget: priceSignalMeta.target !== null,
            priceSignal: priceSignalMeta.signal,
            price: stop.auto_diesel_price ?? null,
            score: stop.overall_score ?? 0,
            priceLabel: buildPriceLabel(stop, priceTarget),
            stop: JSON.stringify({ ...stop, strategy_stop: strategyStopIds.has(stop.id) })
          }
        });
      });

      [ROUTES_LAYER_ID, ROUTES_CASING_LAYER_ID, ROUTES_SHADOW_LAYER_ID].forEach((layerId) => {
        if (mapLibreMap.getLayer(layerId)) {
          mapLibreMap.removeLayer(layerId);
        }
      });
      if (mapLibreMap.getSource(ROUTES_SOURCE_ID)) {
        mapLibreMap.removeSource(ROUTES_SOURCE_ID);
      }

      [CLUSTERS_LAYER_ID, CLUSTER_COUNT_LAYER_ID, UNCLUSTERED_LAYER_ID, PRICE_LABEL_LAYER_ID].forEach((layerId) => {
        if (mapLibreMap.getLayer(layerId)) {
          mapLibreMap.removeLayer(layerId);
        }
      });
      if (mapLibreMap.getSource(STOPS_SOURCE_ID)) {
        mapLibreMap.removeSource(STOPS_SOURCE_ID);
      }

      mapLibreMap.addSource(ROUTES_SOURCE_ID, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: routeFeatures
        }
      });

      mapLibreMap.addLayer({
        id: ROUTES_SHADOW_LAYER_ID,
        type: "line",
        source: ROUTES_SOURCE_ID,
        layout: {
          "line-cap": "round",
          "line-join": "round"
        },
        paint: {
          "line-color": "rgba(15, 23, 42, 0.22)",
          "line-width": ["+", ["get", "width"], 12],
          "line-blur": 5,
          "line-opacity": 0.7
        }
      });

      mapLibreMap.addLayer({
        id: ROUTES_CASING_LAYER_ID,
        type: "line",
        source: ROUTES_SOURCE_ID,
        layout: {
          "line-cap": "round",
          "line-join": "round"
        },
        paint: {
          "line-color": "rgba(255, 255, 255, 0.92)",
          "line-width": ["+", ["get", "width"], 5],
          "line-opacity": 0.92
        }
      });

      mapLibreMap.addLayer({
        id: ROUTES_LAYER_ID,
        type: "line",
        source: ROUTES_SOURCE_ID,
        layout: {
          "line-cap": "round",
          "line-join": "round"
        },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": 0.95
        }
      });

      ensureFuelStopImages(mapLibreMap);

      mapLibreMap.addSource(STOPS_SOURCE_ID, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: stopFeatures
        },
        cluster: true,
        clusterMaxZoom: 9,
        clusterRadius: 42
      });

      mapLibreMap.addLayer({
        id: CLUSTERS_LAYER_ID,
        type: "symbol",
        source: STOPS_SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "icon-image": "fuel-cluster-hex",
          "icon-size": [
            "step",
            ["get", "point_count"],
            0.84,
            12,
            1,
            32,
            1.18
          ],
          "icon-anchor": "center",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true
        }
      });

      mapLibreMap.addLayer({
        id: CLUSTER_COUNT_LAYER_ID,
        type: "symbol",
        source: STOPS_SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Open Sans Bold"],
          "text-size": 12,
          "text-allow-overlap": true,
          "text-ignore-placement": true
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(15, 23, 42, 0.72)",
          "text-halo-width": 1
        }
      });

      mapLibreMap.addLayer({
        id: UNCLUSTERED_LAYER_ID,
        type: "symbol",
        source: STOPS_SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": [
            "case",
            ["boolean", ["get", "isStrategyStop"], false],
            "fuel-pin-strategy",
            ["boolean", ["get", "isBest"], false],
            "fuel-pin-best",
            ["boolean", ["get", "isIndependent"], false],
            "fuel-pin-independent",
            "fuel-pin-default"
          ],
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            3, 0.66,
            7, 0.84,
            11, 1
          ],
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "symbol-sort-key": ["-", ["get", "score"]]
        }
      });

      mapLibreMap.addLayer({
        id: PRICE_LABEL_LAYER_ID,
        type: "symbol",
        source: STOPS_SOURCE_ID,
        minzoom: 6,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "priceLabel"],
          "text-font": ["Open Sans Bold"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6, 10,
            8, 11,
            10, 12
          ],
          "text-offset": [1.25, -1.65],
          "text-anchor": "left",
          "text-line-height": 1.1,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "symbol-sort-key": ["-", ["get", "score"]]
        },
        paint: {
          "text-color": [
            "case",
            ["all", ["boolean", ["get", "hasPriceTarget"], false], ["==", ["get", "priceSignal"], "below"]],
            "#047857",
            ["all", ["boolean", ["get", "hasPriceTarget"], false], ["==", ["get", "priceSignal"], "above"]],
            "#b91c1c",
            ["all", ["boolean", ["get", "hasPriceTarget"], false], ["==", ["get", "priceSignal"], "unknown"]],
            "#475569",
            "#0f172a"
          ],
          "text-halo-color": "rgba(255, 255, 255, 0.96)",
          "text-halo-width": 3,
          "text-halo-blur": 0.5
        }
      });

      bindMapHandlers(mapLibreMap);

      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];

      const bounds = new maplibregl.LngLatBounds();
      plan.routes.forEach((route) => route.points.forEach((point) => bounds.extend([point.lon, point.lat])));
      allStops.forEach((stop) => bounds.extend([stop.lon, stop.lat]));
      bounds.extend([plan.origin.lon, plan.origin.lat]);
      bounds.extend([plan.destination.lon, plan.destination.lat]);
      extraMarkers.forEach((marker) => {
        if (marker?.lat !== undefined && marker?.lon !== undefined) {
          bounds.extend([marker.lon, marker.lat]);
        }
      });
      const mapWidth = mapLibreMap.getContainer().clientWidth;
      const horizontalPadding = mapWidth < 640 ? 68 : isFullscreen ? 156 : 132;
      const verticalPadding = mapWidth < 640 ? 56 : isFullscreen ? 86 : 70;
      mapLibreMap.fitBounds(bounds, {
        padding: {
          top: verticalPadding,
          right: horizontalPadding,
          bottom: verticalPadding,
          left: horizontalPadding
        },
        duration: 450,
        bearing: MAP_BEARING,
        pitch: isFullscreen ? 28 : MAP_PITCH,
        maxZoom: isFullscreen ? 13 : 12
      });

      const startMarker = new maplibregl.Marker({ element: createMarkerElement("marker-start", "A", startMarkerTitle), anchor: "bottom" })
        .setLngLat([plan.origin.lon, plan.origin.lat])
        .addTo(mapLibreMap);
      const endMarker = new maplibregl.Marker({ element: createMarkerElement("marker-end", "B", endMarkerTitle), anchor: "bottom" })
        .setLngLat([plan.destination.lon, plan.destination.lat])
        .addTo(mapLibreMap);

      markersRef.current.push(startMarker, endMarker);

      extraMarkers.forEach((marker) => {
        if (marker?.lat === undefined || marker?.lon === undefined) {
          return;
        }
        const extraMarker = new maplibregl.Marker({
          anchor: "bottom",
          element: createMarkerElement(marker.className || "marker-mid", marker.label || "PT", marker.title || "")
        })
          .setLngLat([marker.lon, marker.lat])
          .addTo(mapLibreMap);
        markersRef.current.push(extraMarker);
      });
    };

    const initializeMap = () => {
      try {
        setMapError("");
        TomTomConfig.instance.put({ apiKey: TOMTOM_KEY });

        mapInstance = new TomTomMap({
          style: "standardLight",
          language: "en-US",
          mapLibre: {
            container: containerRef.current,
            center: [plan.origin.lon, plan.origin.lat],
            zoom: 4,
            pitch: MAP_PITCH,
            bearing: MAP_BEARING,
            antialias: true
          }
        });

        mapRef.current = mapInstance;

        if (mapInstance.mapLibreMap.isStyleLoaded()) {
          renderMap();
        } else {
          mapInstance.mapLibreMap.once("styledata", renderMap);
        }
      } catch (error) {
        setMapError(error instanceof Error ? error.message : "Map failed to initialize.");
      }
    };

    initializeMap();

    return () => {
      isMounted = false;
      handlersBoundRef.current = false;
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      if (mapRef.current?.mapLibreMap) {
        mapRef.current.mapLibreMap.remove();
      }
      mapRef.current = null;
    };
  }, [allStops, endMarkerTitle, extraMarkers, isFullscreen, plan, priceTarget, startMarkerTitle, strategyStopIds]);

  if (mapError) {
    return <div className="empty-route-card">Map failed to load: {mapError}</div>;
  }

  return <div ref={containerRef} className="live-route-map" />;
}
