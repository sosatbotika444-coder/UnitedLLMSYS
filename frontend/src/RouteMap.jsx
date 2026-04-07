import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { TomTomConfig } from "@tomtom-org/maps-sdk/core";
import { TomTomMap } from "@tomtom-org/maps-sdk/map";

const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY || "fu7pxv1akLSodE8K53xEsMMx7aPKLmOl";
const routeColors = ["#1d4ed8", "#0f766e", "#ea580c"];
const ROUTES_SOURCE_ID = "dispatch-routes";
const ROUTES_LAYER_ID = "dispatch-routes-line";
const STOPS_SOURCE_ID = "clustered-fuel-stops";
const CLUSTERS_LAYER_ID = "fuel-stop-clusters";
const CLUSTER_COUNT_LAYER_ID = "fuel-stop-cluster-count";
const UNCLUSTERED_LAYER_ID = "fuel-stop-points";
const PRICE_LABEL_LAYER_ID = "fuel-stop-price-labels";

function createMarkerElement(className, label) {
  const el = document.createElement("div");
  el.className = `tt-marker ${className}`;
  el.textContent = label;
  return el;
}

function formatMoney(value) {
  return value !== null && value !== undefined ? `$${Number(value).toFixed(3)}` : "N/A";
}

function buildStopPopup(stop) {
  const title = stop.brand || stop.name;
  const subtitle = stop.location_type
    ? `${stop.location_type}${stop.store_number ? ` - Store #${stop.store_number}` : ""}`
    : stop.store_number
      ? `Store #${stop.store_number}`
      : null;

  return [
    `<strong>${title}</strong>`,
    subtitle,
    stop.address,
    stop.phone ? `Phone: ${stop.phone}` : null,
    stop.strategy_stop ? "Smart fuel plan stop" : null,
    stop.official_match ? "Official Love's/Pilot station page matched" : null,
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
    .join("<br/>");
}

function buildPriceLabel(stop) {
  const autoDiesel = stop.auto_diesel_price !== null && stop.auto_diesel_price !== undefined ? `$${Number(stop.auto_diesel_price).toFixed(3)}` : "-";
  return `Auto Diesel
${autoDiesel}`;
}

export default function RouteMap({ plan, isFullscreen = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const popupRef = useRef(null);
  const handlersBoundRef = useRef(false);
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

  const strategyStopIds = useMemo(() => new Set((plan.fuel_strategy?.stops || []).map((item) => item.stop?.id).filter(Boolean)), [plan]);

  useEffect(() => {
    const resizeMap = () => {
      mapRef.current?.mapLibreMap?.resize();
    };

    window.addEventListener("resize", resizeMap);
    return () => window.removeEventListener("resize", resizeMap);
  }, []);

  useEffect(() => {
    if (!mapRef.current?.mapLibreMap) {
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
  }, [isFullscreen, plan]);

  useEffect(() => {
    if (!containerRef.current || !TOMTOM_KEY) {
      return undefined;
    }

    let active = true;
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
          .setHTML(buildStopPopup(stop))
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
      if (!active || !mapInstance) {
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

      const stopFeatures = allStops.map((stop) => ({
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
          price: stop.auto_diesel_price ?? null,
          score: stop.overall_score ?? 0,
          priceLabel: buildPriceLabel(stop),
          stop: JSON.stringify({ ...stop, strategy_stop: strategyStopIds.has(stop.id) })
        }
      }));

      if (mapLibreMap.getLayer(ROUTES_LAYER_ID)) {
        mapLibreMap.removeLayer(ROUTES_LAYER_ID);
      }
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
        id: ROUTES_LAYER_ID,
        type: "line",
        source: ROUTES_SOURCE_ID,
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": 0.9
        }
      });

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
        type: "circle",
        source: STOPS_SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#1d4ed8",
            12,
            "#0f766e",
            32,
            "#ea580c"
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18,
            12,
            24,
            32,
            30
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.9
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
          "text-size": 12
        },
        paint: {
          "text-color": "#ffffff"
        }
      });

      mapLibreMap.addLayer({
        id: UNCLUSTERED_LAYER_ID,
        type: "circle",
        source: STOPS_SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "case",
            ["boolean", ["get", "isStrategyStop"], false],
            "#f59e0b",
            ["boolean", ["get", "isBest"], false],
            "#1d4ed8",
            ["boolean", ["get", "isIndependent"], false],
            "#64748b",
            "#2563eb"
          ],
          "circle-radius": [
            "case",
            ["boolean", ["get", "isStrategyStop"], false],
            10,
            ["boolean", ["get", "isBest"], false],
            8,
            6
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff"
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
          "text-offset": [0, 1.8],
          "text-anchor": "top",
          "text-line-height": 1.1,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "symbol-sort-key": ["-", ["get", "score"]]
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(15, 23, 42, 0.9)",
          "text-halo-width": 4,
          "text-halo-blur": 1
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
      mapLibreMap.fitBounds(bounds, { padding: 50, duration: 0 });

      const startMarker = new maplibregl.Marker({ element: createMarkerElement("marker-start", "A") })
        .setLngLat([plan.origin.lon, plan.origin.lat])
        .addTo(mapLibreMap);
      const endMarker = new maplibregl.Marker({ element: createMarkerElement("marker-end", "B") })
        .setLngLat([plan.destination.lon, plan.destination.lat])
        .addTo(mapLibreMap);

      markersRef.current.push(startMarker, endMarker);
    };

    const initializeMap = () => {
      try {
        setMapError("");
        TomTomConfig.instance.put({ apiKey: TOMTOM_KEY });

        mapInstance = new TomTomMap({
          mapLibre: {
            container: containerRef.current,
            center: [plan.origin.lon, plan.origin.lat],
            zoom: 4
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
      active = false;
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
  }, [allStops, plan, strategyStopIds]);

  if (mapError) {
    return <div className="empty-route-card">Map failed to load: {mapError}</div>;
  }

  return <div ref={containerRef} className="live-route-map" />;
}
