import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import AuthShiftPlanner from "./AuthShiftPlanner";
import DriverAuth from "./DriverAuth";
import DriverWorkspace from "./DriverWorkspace";
import SafetyWorkspace from "./SafetyWorkspace";
import TeamChat from "./TeamChat";
import { readClickActivityTarget, setActivityContext, trackActivity } from "./activityTracker";
import { buildVehicleLocationQuery } from "./locationFormatting";
import { getAutoDieselPrice } from "./priceSignals";
import { useIsMobileViewport } from "./useViewportMode";
import { SiteDialog, SiteHeader, UnitedLaneMark, sitePanels } from "./UnitedLaneSiteChrome";

const AdminPanel = lazy(() => import("./AdminPanel"));
const FullRoadWorkspace = lazy(() => import("./FullRoadWorkspace"));
const RouteAssistant = lazy(() => import("./RouteAssistantUnited"));
const RouteHistoryPanel = lazy(() => import("./RouteHistoryPanel"));
const TomTomSuite = lazy(() => import("./TomTomSuite"));
const MotiveDashboardCards = lazy(() => import("./MotiveDashboardCards"));
const MotiveTrackingPanel = lazy(() => import("./MotiveTrackingPanel"));
const FleetStatisticsPanel = lazy(() => import("./FleetStatisticsPanel"));
const ProfitabilityPanel = lazy(() => import("./ProfitabilityPanel"));
const FuelAuthorizations = lazy(() => import("./FuelAuthorizations"));

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";
const THEME_KEY = "dpsearchfuels_theme";
const PRODUCT_KEY = "unitedlane_active_product";
const SIDEBAR_STATE_KEY = "unitedlane_workspace_sidebar_state_v1";
const ROUTE_REQUEST_TIMEOUT_MS = 120000;
const DEFAULT_TANK_CAPACITY_GALLONS = 200;
const DEFAULT_TRUCK_MPG = 6.0;
const DEFAULT_CURRENT_FUEL_GALLONS = 100;
const WORKSPACE_SIDEBAR_WIDTH_EXPANDED = "278px";
const WORKSPACE_SIDEBAR_WIDTH_COLLAPSED = "92px";
const statusOptions = ["Done", "In Transit", "At Pickup", "Needs Review", "Delayed"];
const departmentOptions = [
  { id: "admin", label: "Admin", detail: "Users, bans, statistics" },
  { id: "fuel", label: "Fuel Service", detail: "Routes, loads, tracking" },
  { id: "safety", label: "Safety", detail: "Fleet, services, AI" },
  { id: "driver", label: "Driver", detail: "My truck, fuel, service" }
];
const workspaceTabs = [
  { id: "command", label: "Dashboard", detail: "Main view", icon: "DB" },
  { id: "tracking", label: "Tracking", detail: "Fleet live", icon: "TR" },
  { id: "statistics", label: "Statistics", detail: "Filter all trucks", icon: "SC" },
  { id: "profitability", label: "Profitability", detail: "Detention and lane margin", icon: "PF" },
  { id: "fullroad", label: "Full Road", detail: "Live trip chain", icon: "FR" },
  { id: "routing", label: "Routing", detail: "Build route", icon: "RT" },
  { id: "history", label: "Route History", detail: "All builds", icon: "RH" },
  { id: "approvals", label: "Approvals", detail: "Fuel limits", icon: "FA" },
  { id: "loads", label: "Loads", detail: "Edit loads", icon: "LD" },
  { id: "chat", label: "Team Chat", detail: "All workspaces", icon: "TC" },
  { id: "settings", label: "Settings", detail: "Theme", icon: "ST" }
];
const workspaceNavSections = [
  { id: "start", label: "Start Here", tabs: ["command", "loads", "tracking", "routing"] },
  { id: "ops", label: "Operations", tabs: ["fullroad", "statistics", "profitability", "history", "approvals"] },
  { id: "team", label: "Team", tabs: ["chat", "settings"] }
];
const workspaceQuickStartCards = [
  {
    id: "loads",
    step: "01",
    title: "Create or update a load",
    detail: "Start here when a new shipment arrives or dispatch details change."
  },
  {
    id: "routing",
    step: "02",
    title: "Build the route and fuel plan",
    detail: "Use routing after the load basics are ready so the trip is practical and fuel-safe."
  },
  {
    id: "tracking",
    step: "03",
    title: "Watch the truck live",
    detail: "Open tracking to verify location, fuel, faults, and HOS without hunting through screens."
  },
  {
    id: "fullroad",
    step: "04",
    title: "Follow the full trip",
    detail: "Use Full Road when you need one commercial view from assigned truck through delivery."
  }
];
const mobileFuelTabs = [
  { id: "command", label: "Home", icon: "HM" },
  { id: "loads", label: "Loads", icon: "LD" },
  { id: "routing", label: "Route", icon: "RT" },
  { id: "chat", label: "Chat", icon: "CH" },
  { id: "more", label: "More", icon: "MR" }
];
const mobileFuelMoreTabs = [
  { id: "tracking", label: "Tracking", detail: "Live fleet board", icon: "TR" },
  { id: "statistics", label: "Statistics", detail: "Filter all trucks", icon: "SC" },
  { id: "profitability", label: "Profitability", detail: "Detention and lane margin", icon: "PF" },
  { id: "fullroad", label: "Full Road", detail: "Truck to pickup to delivery", icon: "FR" },
  { id: "history", label: "Route History", detail: "All routing builds", icon: "RH" },
  { id: "approvals", label: "Approvals", detail: "Pre-approved stops", icon: "FA" },
  { id: "settings", label: "Settings", detail: "Theme and preferences", icon: "ST" }
];
const themeOptions = [
  { id: "light", label: "Luxe Light", detail: "Bright executive workspace", accent: "Ivory, blue, emerald" },
  { id: "dark", label: "Night Ops", detail: "Low-glare premium console", accent: "Graphite, cyan, lime" },
  { id: "blue", label: "Skyline Blue", detail: "Cool logistics dashboard", accent: "Frost, navy, electric blue" }
];
const workspaceCopy = {
  command: {
    eyebrow: "Fuel Service",
    title: "Fuel Service",
    subtitle: "Dispatch, fuel, and live operations.",
    helper: "Start in Loads, then move to Routing or Tracking depending on whether you are planning or monitoring."
  },
  tracking: {
    eyebrow: "Fuel Service",
    title: "Tracking",
    subtitle: "Fleet visibility and status.",
    helper: "Search or filter the fleet first, click one truck, then review the map, fuel, faults, and HOS on the right."
  },
  statistics: {
    eyebrow: "Fuel Service",
    title: "Statistics",
    subtitle: "Filter every truck by fuel, MPG, faults, utilization, and load data.",
    helper: "Use this workspace when you need to compare the whole fleet instead of one truck at a time."
  },
  profitability: {
    eyebrow: "Fuel Service",
    title: "Profitability",
    subtitle: "Track detention, lane margin, deadhead, and estimated trip profit.",
    helper: "Open the highest-risk loads first so margin problems surface before they become service issues."
  },
  fullroad: {
    eyebrow: "Fuel Service",
    title: "Full Road",
    subtitle: "Live truck to pickup to delivery with fuel planning.",
    helper: "Use this when one trip needs a complete operational story, not just one route or one data panel."
  },
  routing: {
    eyebrow: "Fuel Service",
    title: "Routing",
    subtitle: "Build routes and fuel plans.",
    helper: "Choose a truck or origin/destination pair, then build the route and approve the best fuel stop."
  },
  history: {
    eyebrow: "Fuel Service",
    title: "Route History",
    subtitle: "Search every route build by account, driver, truck, origin, destination, or date.",
    helper: "Use history to reopen previous plans quickly instead of rebuilding the same route from scratch."
  },
  approvals: {
    eyebrow: "Fuel Service",
    title: "Fuel Approvals",
    subtitle: "Approve stops, limits, and Motive purchase checks.",
    helper: "Review approvals here after a route is built so driver instructions and spending limits stay aligned."
  },
  loads: {
    eyebrow: "Fuel Service",
    title: "Loads",
    subtitle: "Choose a truck, enter A/B and rate, then auto-fill route economics.",
    helper: "This is the main entry point for dispatch work. Complete the core row here before using the planning tools."
  },
  chat: {
    eyebrow: "All Workspaces",
    title: "Team Chat",
    subtitle: "Shared communication for Fuel Service, Safety, and Driver accounts.",
    helper: "Use chat for quick coordination when a load or truck needs shared attention across teams."
  },
  settings: {
    eyebrow: "Fuel Service",
    title: "Settings",
    subtitle: "Theme and browser preferences.",
    helper: "Change only personal workspace preferences here. It does not affect the operational data."
  }
};
const emptyRegister = { full_name: "", email: "", password: "" };
const emptyLogin = { email: "", password: "" };
const emptyRow = {
  vehicle_id: null,
  driver: "",
  truck: "",
  mpg: "6.0",
  status: "In Transit",
  miles_to_empty: "1200",
  tank_capacity: "200",
  fuel_level: 50,
  pickup_city: "",
  stop1: "",
  stop2: "",
  stop3: "",
  delivery_city: "",
  customer_name: "",
  broker_name: "",
  load_number: "",
  pickup_appt_at: "",
  delivery_appt_at: "",
  rate_total: "0",
  driver_pay_total: "0",
  detention_free_minutes: "120",
  detention_rate_per_hour: "50",
  lumper_cost: "0",
  toll_cost: "0",
  other_accessorials: "0",
  manual_fuel_cost: "0",
  baseline_fuel_cost: "0",
  smart_service_savings: "0",
  manual_total_miles: "0",
  manual_deadhead_miles: "0",
  manual_loaded_miles: "0"
};

function getDepartmentMeta(departmentId) {
  return departmentOptions.find((option) => option.id === departmentId) || departmentOptions[0];
}

function getFuelTone(level) {
  if (level >= 80) return "fuel-strong";
  if (level >= 55) return "fuel-good";
  if (level >= 35) return "fuel-watch";
  return "fuel-low";
}

function getStatusTone(status) {
  if (status === "Done") return "status-done";
  if (status === "Delayed") return "status-delayed";
  if (status === "Needs Review") return "status-review";
  return "status-live";
}

function computeMilesToEmpty(row) {
  const mpg = Number(row.mpg) || 0;
  const tank = Number(row.tank_capacity) || 0;
  const fuel = Number(row.fuel_level) || 0;
  return String(Math.round((tank * mpg * fuel) / 100));
}

function clampPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function vehicleDriver(vehicle) {
  return vehicle?.resolved_driver || vehicle?.driver || vehicle?.permanent_driver || null;
}

function vehicleDriverName(vehicle) {
  return vehicleDriver(vehicle)?.full_name || "Unassigned";
}

function vehicleLabel(vehicle) {
  return vehicle?.number || vehicle?.vin || `Vehicle ${vehicle?.id ?? ""}`.trim();
}

function vehicleFuelPercent(vehicle) {
  const location = vehicle?.location || {};
  return clampPercent(
    location.fuel_level_percent
    ?? location.fuel_primary_remaining_percentage
    ?? location.fuel_remaining_percentage
    ?? location.fuel_percentage
    ?? null
  );
}

function vehicleLocationQuery(vehicle) {
  return buildVehicleLocationQuery(vehicle);
}

function resolveVehicleMpgInfo(vehicle) {
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

function findVehicleForRow(row, vehicles) {
  if (!row || !Array.isArray(vehicles) || !vehicles.length) return null;
  const explicitId = Number(row.vehicle_id);
  if (Number.isFinite(explicitId) && explicitId > 0) {
    return vehicles.find((vehicle) => Number(vehicle?.id) === explicitId) || null;
  }

  const truckText = String(row.truck || "").trim().toLowerCase();
  const driverText = String(row.driver || "").trim().toLowerCase();

  return vehicles.find((vehicle) => {
    const identifiers = [
      vehicleLabel(vehicle),
      vehicle?.vin,
      vehicle?.license_plate_number,
      vehicle?.number,
    ].filter(Boolean).join(" ").toLowerCase();
    const driverName = vehicleDriverName(vehicle).toLowerCase();
    const truckMatch = truckText && (
      truckText === identifiers
      || truckText.includes(identifiers)
      || identifiers.includes(truckText)
    );
    const driverMatch = driverText && (driverText === driverName || driverText.includes(driverName) || driverName.includes(driverText));
    return truckMatch || driverMatch;
  }) || null;
}

function deriveRowTruckPreset(vehicle, row) {
  const fuelPercent = vehicleFuelPercent(vehicle);
  const rowFuelPercent = clampPercent(row?.fuel_level);
  const resolvedFuelPercent = fuelPercent ?? rowFuelPercent;
  const tankCapacityGallons = Math.max(1, Number(row?.tank_capacity) || DEFAULT_TANK_CAPACITY_GALLONS);
  const motiveMpg = resolveVehicleMpgInfo(vehicle);
  const rowMpg = positiveNumber(row?.mpg);
  const mpg = motiveMpg.value ?? rowMpg ?? DEFAULT_TRUCK_MPG;
  const currentFuelGallons = resolvedFuelPercent !== null
    ? (tankCapacityGallons * resolvedFuelPercent) / 100
    : DEFAULT_CURRENT_FUEL_GALLONS;

  return {
    fuelPercent: resolvedFuelPercent,
    tankCapacityGallons,
    mpg,
    mpgSource: motiveMpg.value !== null
      ? motiveMpg.source
      : rowMpg !== null
        ? "MPG from load row"
        : `Default truck MPG ${DEFAULT_TRUCK_MPG.toFixed(1)}`,
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

function planFuelCost(plan) {
  const strategyCost = Number(plan?.fuel_strategy?.estimated_fuel_cost);
  return Number.isFinite(strategyCost) ? strategyCost : 0;
}

function uniquePlanStops(plan) {
  if (!plan) return [];
  const sourceStops = plan?.routes?.[0]?.fuel_stops?.length ? plan.routes[0].fuel_stops : (plan?.top_fuel_stops || []);
  const byId = new Map();
  sourceStops.forEach((stop) => {
    const key = stop?.id || `${stop?.lat},${stop?.lon}`;
    if (!key) return;
    byId.set(key, stop);
  });
  return [...byId.values()];
}

function inferBaselineFuelCost(plan) {
  const serviceCost = planFuelCost(plan);
  const requiredGallons = Number(plan?.fuel_strategy?.required_purchase_gallons);
  if (!Number.isFinite(requiredGallons) || requiredGallons <= 0) {
    return serviceCost;
  }

  const stopPrices = uniquePlanStops(plan)
    .map((stop) => getAutoDieselPrice(stop))
    .filter((value) => Number.isFinite(value));
  const fallbackPrices = (plan?.fuel_strategy?.stops || [])
    .map((item) => Number(item?.auto_diesel_price))
    .filter((value) => Number.isFinite(value));
  const prices = stopPrices.length ? stopPrices : fallbackPrices;
  if (!prices.length) {
    return serviceCost;
  }

  const averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  return Number((requiredGallons * averagePrice).toFixed(2));
}

function plannedDriveMiles(plan) {
  const routeMiles = planRouteMiles(plan);
  const detourMiles = (plan?.fuel_strategy?.stops || []).reduce((sum, item) => sum + stopDetourMiles(item?.stop), 0);
  return routeMiles + detourMiles;
}

function estimateRemainingFuelGallons(plan, startingGallons, mpg) {
  const start = Number(startingGallons);
  const economy = Number(mpg);
  if (!Number.isFinite(start) || !Number.isFinite(economy) || economy <= 0) {
    return DEFAULT_CURRENT_FUEL_GALLONS;
  }

  const purchasedGallons = (plan?.fuel_strategy?.stops || []).reduce((sum, item) => sum + (Number(item?.gallons_to_buy) || 0), 0);
  const consumedGallons = plannedDriveMiles(plan) / economy;
  return Math.max(0, start + purchasedGallons - consumedGallons);
}

function formatPlannedStop(item, legLabel) {
  const stop = item?.stop || {};
  const brand = stop.brand || stop.name || "Fuel Stop";
  const cityState = [stop.city, stop.state_code].filter(Boolean).join(", ");
  const price = getAutoDieselPrice(stop) ?? Number(item?.auto_diesel_price);
  const gallons = Number(item?.gallons_to_buy);
  return [
    `${legLabel} ${Number(item?.sequence) || 0}. ${brand}`,
    cityState,
    Number.isFinite(gallons) && gallons > 0 ? `${gallons.toFixed(1)} gal` : "",
    Number.isFinite(price) ? `$${price.toFixed(3)}/gal` : "",
    String(item?.reason || "").trim(),
  ].filter(Boolean).join(" | ");
}

function buildSmartStopsFromPlans(toPickupPlan, toDeliveryPlan) {
  const combined = [
    ...(toPickupPlan?.fuel_strategy?.stops || []).map((item) => formatPlannedStop(item, "To PU")),
    ...(toDeliveryPlan?.fuel_strategy?.stops || []).map((item) => formatPlannedStop(item, "To DEL")),
  ].filter(Boolean);

  if (!combined.length) {
    return ["", "", ""];
  }

  const visible = combined.slice(0, 3);
  if (combined.length > 3) {
    visible[2] = `${visible[2]} | +${combined.length - 3} more in Full Road`;
  }
  while (visible.length < 3) {
    visible.push("");
  }
  return visible;
}

function vehicleOptionLabel(vehicle) {
  const fuelPercent = vehicleFuelPercent(vehicle);
  const mpgInfo = resolveVehicleMpgInfo(vehicle);
  return [
    vehicleLabel(vehicle),
    vehicleDriverName(vehicle),
    fuelPercent !== null ? `${fuelPercent.toFixed(0)}% fuel` : "Fuel n/a",
    mpgInfo.value !== null ? `${mpgInfo.value.toFixed(1)} MPG` : "MPG n/a",
  ].join(" | ");
}

function normalizeRow(row) {
  const mergedRow = { ...emptyRow, ...(row || {}) };
  return {
    ...mergedRow,
    vehicle_id: mergedRow.vehicle_id ? Number(mergedRow.vehicle_id) : null,
    fuel_level: Number(mergedRow.fuel_level ?? 0),
    miles_to_empty: mergedRow.miles_to_empty || computeMilesToEmpty(mergedRow)
  };
}

function ModuleLoader({ label = "Loading workspace module..." }) {
  return <div className="module-loader">{label}</div>;
}

function readStoredUser() {
  try {
    const rawValue = localStorage.getItem(USER_KEY);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readStoredSidebarState() {
  try {
    const rawValue = localStorage.getItem(SIDEBAR_STATE_KEY);
    if (!rawValue) return {};
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function apiRequest(path, options = {}, token = "") {
  const { timeoutMs, ...fetchOptions } = options;
  const headers = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = timeoutMs && controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...fetchOptions,
      headers,
      signal: fetchOptions.signal || controller?.signal
    });
  } catch (requestError) {
    if (requestError?.name === "AbortError" && timeoutMs) {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw requestError;
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }

  return data;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function MetricCard({ label, value, detail, tone = "neutral" }) {
  return (
    <article className={`metric-card metric-card-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function DepartmentCard({ option, active, onSelect }) {
  return (
    <button type="button" className={`area-selector-card${active ? " active" : ""}`} onClick={() => onSelect(option.id)}>
      <strong>{option.label}</strong>
      <small>{option.detail}</small>
    </button>
  );
}

function WorkspaceStartCard({ item, active, onSelect }) {
  const tabMeta = workspaceTabs.find((tab) => tab.id === item.id);
  if (!tabMeta) {
    return null;
  }

  return (
    <button
      type="button"
      className={`workspace-start-card${active ? " active" : ""}`}
      onClick={() => onSelect(item.id)}
    >
      <span>{item.step}</span>
      <strong>{item.title}</strong>
      <small>{item.detail}</small>
      <em>{active ? "Current workspace" : `${tabMeta.label} workspace`}</em>
    </button>
  );
}

function WorkspaceShortcutButton({ tab, active, onSelect }) {
  return (
    <button
      type="button"
      className={`workspace-shortcut-button${active ? " active" : ""}`}
      onClick={() => onSelect(tab.id)}
    >
      <span>{tab.label}</span>
      <strong>{tab.detail}</strong>
    </button>
  );
}

function WorkspaceSidebarShell({
  expanded,
  onToggle,
  modeLabel,
  brandMeta = "",
  accountLabel = "Account",
  accountTitle = "",
  accountSubtitle = "",
  accountBadge = "",
  noteLabel = "",
  noteTitle = "",
  noteSubtitle = "",
  action = null,
  navSections = [],
  activeTab = "",
  onSelectTab = null,
  footerDate = "",
  footerTitle = "",
  footerSubtitle = "",
  onLogout,
}) {
  const hasNav = Array.isArray(navSections) && navSections.length > 0 && typeof onSelectTab === "function";

  return (
    <aside className={`workspace-sidebar-shell ${expanded ? "is-expanded" : "is-collapsed"}`.trim()}>
      <div className="workspace-sidebar-stack">
        <button
          type="button"
          className="workspace-sidebar-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${modeLabel} sidebar`}
          title={`${expanded ? "Collapse" : "Expand"} ${modeLabel} sidebar`}
        >
          <span className="workspace-sidebar-toggle-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {expanded ? (
            <span className="workspace-sidebar-toggle-copy">
              <strong>Workspace Menu</strong>
              <small>{modeLabel}</small>
            </span>
          ) : null}
        </button>

        <div className="workspace-sidebar-body">
          <div className="workspace-sidebar-brand" title={`United Lane LLC | ${modeLabel}`}>
            <div className="workspace-sidebar-logo">
              <UnitedLaneMark className="workspace-sidebar-logo-mark" />
            </div>
            {expanded ? (
              <div className="workspace-sidebar-brand-copy">
                <strong>United Lane LLC</strong>
                <span>{modeLabel}</span>
                <small>{brandMeta}</small>
              </div>
            ) : null}
          </div>

          {expanded && accountTitle ? (
            <article className="workspace-sidebar-account-card">
              <span>{accountLabel}</span>
              <strong>{accountTitle}</strong>
              <small>{accountSubtitle}</small>
              {accountBadge ? <em>{accountBadge}</em> : null}
            </article>
          ) : null}

          {action ? (
            <button className="workspace-sidebar-create" type="button" onClick={action.onClick} title={action.label}>
              {expanded ? (
                <>
                  <span>{action.label}</span>
                  <strong>{action.icon || "+"}</strong>
                </>
              ) : (
                <strong>{action.icon || "+"}</strong>
              )}
            </button>
          ) : null}

          {hasNav ? (
            <nav className={`workspace-sidebar-nav${expanded ? "" : " workspace-sidebar-nav-collapsed"}`}>
              {navSections.map((section) => (
                <section key={section.id} className="workspace-sidebar-section">
                  {expanded ? <div className="workspace-sidebar-section-title">{section.label}</div> : null}
                  <div className="workspace-sidebar-section-links">
                    {section.tabs.map((tabId) => {
                      const tab = workspaceTabs.find((item) => item.id === tabId);
                      if (!tab) {
                        return null;
                      }

                      return (
                        <button
                          key={tab.id}
                          type="button"
                          className={`workspace-sidebar-link ${activeTab === tab.id ? "active" : ""}`}
                          onClick={() => onSelectTab(tab.id)}
                          title={`${tab.label} - ${tab.detail}`}
                        >
                          <span className="workspace-sidebar-link-icon">{tab.icon}</span>
                          {expanded ? (
                            <span className="workspace-sidebar-link-copy">
                              <strong>{tab.label}</strong>
                              <small>{tab.detail}</small>
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </nav>
          ) : expanded && noteTitle ? (
            <article className="workspace-sidebar-note">
              {noteLabel ? <span>{noteLabel}</span> : null}
              <strong>{noteTitle}</strong>
              <small>{noteSubtitle}</small>
            </article>
          ) : null}

          <div className="workspace-sidebar-footer">
            {expanded && footerTitle ? (
              <div className="workspace-sidebar-footer-card">
                <span>{footerDate}</span>
                <strong>{footerTitle}</strong>
                <small>{footerSubtitle}</small>
              </div>
            ) : null}
            <button className="secondary-button workspace-sidebar-logout" type="button" onClick={onLogout} title="Logout">
              {expanded ? "Logout" : "Out"}
            </button>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="workspace-sidebar-handle"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${modeLabel} sidebar`}
        title={`${expanded ? "Collapse" : "Expand"} ${modeLabel} sidebar`}
      >
        <span className="workspace-sidebar-handle-arrow" aria-hidden="true">{expanded ? "‹" : "›"}</span>
        <span className="workspace-sidebar-handle-text">{expanded ? "Hide" : "Menu"}</span>
      </button>
    </aside>
  );
}


function InstallAppButton({ mobile = false }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
    setInstalled(Boolean(isStandalone));

    function handleBeforeInstallPrompt(event) {
      event.preventDefault();
      setDeferredPrompt(event);
      setInstalled(false);
    }

    function handleAppInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
      setHelpOpen(false);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function installApp() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      setDeferredPrompt(null);
      if (choice?.outcome === "accepted") {
        setInstalled(true);
      }
      return;
    }
    setHelpOpen((open) => !open);
  }

  if (installed) {
    return null;
  }

  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent || "");

  return (
    <div className={`install-app-widget ${mobile ? "mobile" : ""}`}>
      {helpOpen ? (
        <section className="install-app-help">
          <div>
            <span>Install App</span>
            <strong>United Lane on your phone</strong>
          </div>
          {isIos ? (
            <p>Open this site in Safari, tap Share, then tap Add to Home Screen.</p>
          ) : (
            <p>Use the browser Install option or Add to Home Screen. Chrome and Edge may show the install prompt automatically.</p>
          )}
          <button type="button" onClick={() => setHelpOpen(false)}>Close</button>
        </section>
      ) : null}
      <button className="install-app-button" type="button" onClick={installApp}>
        <span>Install</span>
        <strong>App</strong>
      </button>
    </div>
  );
}
function MobileBottomNav({ items, activeId, onSelect }) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Mobile workspace navigation">
      {items.map((item) => (
        <button key={item.id} type="button" className={activeId === item.id ? "active" : ""} onClick={() => onSelect(item.id)}>
          <span>{item.icon || item.label.slice(0, 2).toUpperCase()}</span>
          <strong>{item.mobileLabel || item.label}</strong>
        </button>
      ))}
    </nav>
  );
}

function MobileWorkspaceShell({ kicker, title, subtitle, user, currentDate, message, error, onLogout, action, navItems = [], activeId = "", onSelect, morePanel = null, children }) {
  return (
    <div className="mobile-workspace-shell">
      <header className="mobile-workspace-topbar">
        <div className="mobile-workspace-brandline">
          <UnitedLaneMark className="mobile-workspace-mark" />
          <div>
            <span>{kicker}</span>
            <strong>{title}</strong>
          </div>
        </div>
        <div className="mobile-workspace-top-actions">
          <InstallAppButton mobile />
          <button className="mobile-logout-button" type="button" onClick={onLogout}>Logout</button>
        </div>
      </header>

      <main className="mobile-workspace-main">
        <section className="mobile-workspace-hero mobile-workspace-hero-compact">
          <div>
            <span>{currentDate}</span>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <article>
            <span>{user?.department || "team"}</span>
            <strong>{user?.full_name || "Account"}</strong>
          </article>
        </section>

        {action ? <div className="mobile-primary-action">{action}</div> : null}
        {message ? <div className="notice success inline-notice">{message}</div> : null}
        {error ? <div className="notice error inline-notice">{error}</div> : null}

        {children}
      </main>

      {morePanel}
      {navItems.length ? <MobileBottomNav items={navItems} activeId={activeId} onSelect={onSelect} /> : null}
    </div>
  );
}
function MobileLoadCard({ row, savingId, smartFillId, fleetLoading, vehicles, onUpdate, onSave, onDelete, onVehicleSelect, onSmartFill }) {
  const fullLoadMiles = Math.round((Number(row.mpg) || 0) * (Number(row.tank_capacity) || 0));
  const routeLabel = [row.pickup_city, row.delivery_city].filter(Boolean).join(" to ");
  const selectedVehicle = findVehicleForRow(row, vehicles);
  const serviceSavings = Number(row.smart_service_savings) || 0;

  return (
    <article className="mobile-load-card">
      <header>
        <div>
          <span>{row.load_number ? `Load ${row.load_number}` : `Truck ${row.truck || "-"}`}</span>
          <strong>{row.driver || "Unassigned driver"}</strong>
          <small>{routeLabel || row.customer_name || "Dispatch row"}</small>
        </div>
        <select
          className={`status-select ${getStatusTone(row.status)}`}
          value={row.status}
          onChange={async (event) => {
            const value = event.target.value;
            onUpdate(row.id, "status", value);
            await onSave({ ...row, status: value });
          }}
        >
          {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </header>

      <div className="mobile-load-fields">
        <label>Load #<input value={row.load_number} onChange={(event) => onUpdate(row.id, "load_number", event.target.value)} onBlur={(event) => onSave({ ...row, load_number: event.target.value })} /></label>
        <label>Customer<input value={row.customer_name} onChange={(event) => onUpdate(row.id, "customer_name", event.target.value)} onBlur={(event) => onSave({ ...row, customer_name: event.target.value })} /></label>
        <label>Broker<input value={row.broker_name} onChange={(event) => onUpdate(row.id, "broker_name", event.target.value)} onBlur={(event) => onSave({ ...row, broker_name: event.target.value })} /></label>
        <label>
          Truck Preset
          <select
            value={selectedVehicle?.id ? String(selectedVehicle.id) : ""}
            onChange={(event) => onVehicleSelect(row, event.target.value)}
            disabled={fleetLoading || !vehicles.length}
          >
            <option value="">{fleetLoading ? "Syncing Motive fleet..." : "Select truck"}</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>{vehicleOptionLabel(vehicle)}</option>
            ))}
          </select>
        </label>
        <label>Driver<input value={row.driver} onChange={(event) => onUpdate(row.id, "driver", event.target.value)} onBlur={(event) => onSave({ ...row, driver: event.target.value })} /></label>
        <label>Truck<input value={row.truck} onChange={(event) => onUpdate(row.id, "truck", event.target.value)} onBlur={(event) => onSave({ ...row, truck: event.target.value })} /></label>
        <label>Pickup<input value={row.pickup_city} onChange={(event) => onUpdate(row.id, "pickup_city", event.target.value)} onBlur={(event) => onSave({ ...row, pickup_city: event.target.value })} /></label>
        <label>Delivery<input value={row.delivery_city} onChange={(event) => onUpdate(row.id, "delivery_city", event.target.value)} onBlur={(event) => onSave({ ...row, delivery_city: event.target.value })} /></label>
      </div>

      <div className="mobile-load-fuel-row">
        <div className={getFuelTone(Number(row.fuel_level))}>
          <span>Fuel</span>
          <strong>{row.fuel_level}%</strong>
        </div>
        <label>
          Fuel level
          <input
            type="range"
            min="0"
            max="100"
            value={row.fuel_level}
            onChange={async (event) => {
              const value = Number(event.target.value);
              const nextRow = { ...row, fuel_level: value };
              onUpdate(row.id, "fuel_level", value);
              await onSave({ ...nextRow, miles_to_empty: computeMilesToEmpty(nextRow) });
            }}
          />
        </label>
      </div>

      <div className="mobile-load-stats">
        <div><span>Miles Empty</span><strong>{row.miles_to_empty || "0"}</strong></div>
        <div><span>Full Load</span><strong>{fullLoadMiles}</strong></div>
        <div><span>Tank</span><strong>{row.tank_capacity || "-"}</strong></div>
        <div><span>MPG</span><strong>{row.mpg || "-"}</strong></div>
      </div>

      <details className="mobile-load-stops">
        <summary>Stops, appointments, and profit</summary>
        <div className="mobile-load-controls">
          <button className="secondary-button" type="button" onClick={() => onSmartFill(row)} disabled={smartFillId === row.id || savingId === row.id || fleetLoading || !vehicles.length}>
            {smartFillId === row.id ? "Planning..." : "Smart Fill from Truck + A/B"}
          </button>
          <small>{selectedVehicle ? `${vehicleLabel(selectedVehicle)} ready` : "Pick a truck, enter pickup/delivery, then Smart Fill."}</small>
        </div>
        <label>Pickup Appt<input value={row.pickup_appt_at} onChange={(event) => onUpdate(row.id, "pickup_appt_at", event.target.value)} onBlur={(event) => onSave({ ...row, pickup_appt_at: event.target.value })} placeholder="2026-04-22 08:00" /></label>
        <label>Delivery Appt<input value={row.delivery_appt_at} onChange={(event) => onUpdate(row.id, "delivery_appt_at", event.target.value)} onBlur={(event) => onSave({ ...row, delivery_appt_at: event.target.value })} placeholder="2026-04-23 14:00" /></label>
        <label>Rate Total<input value={row.rate_total} onChange={(event) => onUpdate(row.id, "rate_total", event.target.value)} onBlur={(event) => onSave({ ...row, rate_total: event.target.value })} /></label>
        <label>Driver Pay<input value={row.driver_pay_total} onChange={(event) => onUpdate(row.id, "driver_pay_total", event.target.value)} onBlur={(event) => onSave({ ...row, driver_pay_total: event.target.value })} /></label>
        <label>Free Min<input value={row.detention_free_minutes} onChange={(event) => onUpdate(row.id, "detention_free_minutes", event.target.value)} onBlur={(event) => onSave({ ...row, detention_free_minutes: event.target.value })} /></label>
        <label>Detention $/Hr<input value={row.detention_rate_per_hour} onChange={(event) => onUpdate(row.id, "detention_rate_per_hour", event.target.value)} onBlur={(event) => onSave({ ...row, detention_rate_per_hour: event.target.value })} /></label>
        <label>Lumper<input value={row.lumper_cost} onChange={(event) => onUpdate(row.id, "lumper_cost", event.target.value)} onBlur={(event) => onSave({ ...row, lumper_cost: event.target.value })} /></label>
        <label>Tolls<input value={row.toll_cost} onChange={(event) => onUpdate(row.id, "toll_cost", event.target.value)} onBlur={(event) => onSave({ ...row, toll_cost: event.target.value })} /></label>
        <label>Accessorials<input value={row.other_accessorials} onChange={(event) => onUpdate(row.id, "other_accessorials", event.target.value)} onBlur={(event) => onSave({ ...row, other_accessorials: event.target.value })} /></label>
        <label>Route Fuel<input value={row.manual_fuel_cost} onChange={(event) => onUpdate(row.id, "manual_fuel_cost", event.target.value)} onBlur={(event) => onSave({ ...row, manual_fuel_cost: event.target.value })} /></label>
        <label>No Service Fuel<input value={row.baseline_fuel_cost} readOnly /></label>
        <label>Service Savings<input value={row.smart_service_savings} readOnly /></label>
        <label>Total Miles<input value={row.manual_total_miles} onChange={(event) => onUpdate(row.id, "manual_total_miles", event.target.value)} onBlur={(event) => onSave({ ...row, manual_total_miles: event.target.value })} /></label>
        <label>Deadhead<input value={row.manual_deadhead_miles} onChange={(event) => onUpdate(row.id, "manual_deadhead_miles", event.target.value)} onBlur={(event) => onSave({ ...row, manual_deadhead_miles: event.target.value })} /></label>
        <label>Loaded Miles<input value={row.manual_loaded_miles} onChange={(event) => onUpdate(row.id, "manual_loaded_miles", event.target.value)} onBlur={(event) => onSave({ ...row, manual_loaded_miles: event.target.value })} /></label>
        <label>1st Stop<textarea value={row.stop1} onChange={(event) => onUpdate(row.id, "stop1", event.target.value)} onBlur={(event) => onSave({ ...row, stop1: event.target.value })} /></label>
        <label>2nd Stop<textarea value={row.stop2} onChange={(event) => onUpdate(row.id, "stop2", event.target.value)} onBlur={(event) => onSave({ ...row, stop2: event.target.value })} /></label>
        <label>3rd Stop<textarea value={row.stop3} onChange={(event) => onUpdate(row.id, "stop3", event.target.value)} onBlur={(event) => onSave({ ...row, stop3: event.target.value })} /></label>
        <div className="mobile-load-stats">
          <div><span>With service</span><strong>{row.manual_fuel_cost || "0.00"}</strong></div>
          <div><span>Without service</span><strong>{row.baseline_fuel_cost || "0.00"}</strong></div>
          <div><span>Delta</span><strong>{serviceSavings >= 0 ? "+" : ""}{serviceSavings.toFixed(2)}</strong></div>
          <div><span>Route source</span><strong>{row.stop1 || row.stop2 || row.stop3 ? "Smart Route" : "Manual"}</strong></div>
        </div>
      </details>

      <footer>
        <span>{savingId === row.id ? "Saving..." : "Auto-saves on field exit"}</span>
        <button className="delete-button" type="button" onClick={() => onDelete(row.id)}>Delete</button>
      </footer>
    </article>
  );
}


function MobileQuickActions({ onSelect, onCreateLoad }) {
  const actions = [
    { id: "loads", label: "Loads", detail: "Edit dispatch cards", tone: "green" },
    { id: "routing", label: "Route", detail: "Build fuel plan", tone: "blue" },
    { id: "chat", label: "Chat", detail: "Message the team", tone: "dark" },
    { id: "tracking", label: "Tracking", detail: "Live fleet view", tone: "amber" }
  ];

  return (
    <section className="mobile-quick-actions">
      <button type="button" className="mobile-quick-create" onClick={onCreateLoad}>
        <span>New</span>
        <strong>Create Load</strong>
        <small>Start dispatch work</small>
      </button>
      {actions.map((action) => (
        <button key={action.id} type="button" className={`mobile-quick-card mobile-quick-${action.tone}`} onClick={() => onSelect(action.id)}>
          <span>{action.label}</span>
          <strong>{action.detail}</strong>
        </button>
      ))}
    </section>
  );
}
function MobileFuelWorkspaceContent({ activeWorkspace, token, user, rows, filteredRows, metrics, search, setSearch, statusFilter, setStatusFilter, loadStatusTabs, gridLoading, savingId, smartFillId, fleetLoading, fleetVehicles, createRow, deleteRow, saveRow, updateLocalRow, syncRowVehicle, smartFillRow, theme, setTheme, onSelectWorkspace }) {
  if (activeWorkspace === "tracking") {
    return <section className="mobile-workspace-section"><Suspense fallback={<ModuleLoader label="Loading Motive fleet tracking..." />}><MotiveTrackingPanel token={token} active /></Suspense></section>;
  }

  if (activeWorkspace === "statistics") {
    return <section className="mobile-workspace-section"><Suspense fallback={<ModuleLoader label="Loading truck statistics..." />}><FleetStatisticsPanel token={token} active loadRows={rows} /></Suspense></section>;
  }

  if (activeWorkspace === "profitability") {
    return <section className="mobile-workspace-section"><Suspense fallback={<ModuleLoader label="Loading profitability..." />}><ProfitabilityPanel token={token} active loadRows={rows} /></Suspense></section>;
  }

  if (activeWorkspace === "routing") {
    return <section className="mobile-workspace-section"><Suspense fallback={<ModuleLoader label="Loading route intelligence..." />}><RouteAssistant token={token} active loadRows={rows} /></Suspense></section>;
  }

  if (activeWorkspace === "fullroad") {
    return <section className="mobile-workspace-section"><Suspense fallback={<ModuleLoader label="Loading Full Road..." />}><FullRoadWorkspace token={token} active loadRows={rows} /></Suspense></section>;
  }

  if (activeWorkspace === "history") {
    return <section className="mobile-workspace-section"><Suspense fallback={<ModuleLoader label="Loading route history..." />}><RouteHistoryPanel token={token} active /></Suspense></section>;
  }

  if (activeWorkspace === "approvals") {
    return <section className="mobile-workspace-section"><Suspense fallback={<ModuleLoader label="Loading fuel authorizations..." />}><FuelAuthorizations token={token} active /></Suspense></section>;
  }

  if (activeWorkspace === "loads") {
    return (
      <section className="mobile-workspace-section mobile-loads-workspace">
        <div className="mobile-load-controls">
          <label>Search loads<input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Driver, truck, city" /></label>
          <button className="primary-button" type="button" onClick={createRow}>New Load</button>
        </div>
        <div className="mobile-chip-strip">
          {loadStatusTabs.map((status) => {
            const total = status === "All" ? rows.length : rows.filter((row) => row.status === status).length;
            return <button key={status} type="button" className={statusFilter === status ? "active" : ""} onClick={() => setStatusFilter(status)}>{status}<span>{total}</span></button>;
          })}
        </div>
        <div className="mobile-load-list">
          {filteredRows.length ? filteredRows.map((row) => (
            <MobileLoadCard
              key={row.id}
              row={row}
              savingId={savingId}
              smartFillId={smartFillId}
              fleetLoading={fleetLoading}
              vehicles={fleetVehicles}
              onUpdate={updateLocalRow}
              onSave={saveRow}
              onDelete={deleteRow}
              onVehicleSelect={syncRowVehicle}
              onSmartFill={smartFillRow}
            />
          )) : <div className="mobile-empty-card">{gridLoading ? "Loading loads..." : "No loads yet."}</div>}
        </div>
      </section>
    );
  }

  if (activeWorkspace === "chat") {
    return <TeamChat token={token} user={user} active mobile />;
  }

  if (activeWorkspace === "settings") {
    return (
      <section className="mobile-workspace-section mobile-settings-stack">
        <article className="panel settings-panel-card">
          <div className="panel-head"><h2>Theme</h2><span>Choose the look.</span></div>
          <div className="theme-option-grid">
            {themeOptions.map((option) => (
              <button key={option.id} type="button" className={`theme-option-card ${theme === option.id ? "active" : ""}`} onClick={() => setTheme(option.id)}>
                <span className={`theme-option-swatch theme-option-swatch-${option.id}`} />
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
                <em>{option.accent}</em>
              </button>
            ))}
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className="mobile-workspace-section mobile-command-workspace">
      <section className="mobile-metric-grid">
        <MetricCard label="Loads" value={metrics.total} detail={`${metrics.activeLoads} active`} tone="green" />
        <MetricCard label="Low fuel" value={metrics.lowFuelCount} detail="Below 40%" tone={metrics.lowFuelCount ? "amber" : "blue"} />
        <MetricCard label="Review" value={metrics.reviewLoads} detail={`${metrics.delayedLoads} delayed`} tone="violet" />
        <MetricCard label="Miles" value={formatNumber(metrics.totalMilesToEmpty)} detail="All loads" tone="dark" />
      </section>
      <MobileQuickActions onSelect={onSelectWorkspace} onCreateLoad={createRow} />
      <Suspense fallback={<ModuleLoader label="Loading Motive operations cards..." />}><MotiveDashboardCards token={token} active /></Suspense>
      <section className="panel workspace-tool-surface mobile-tool-panel">
        <div className="panel-head"><div><h2>Fuel Tools</h2><span>Route and station tools.</span></div></div>
        <Suspense fallback={<ModuleLoader label="Loading service catalog..." />}><TomTomSuite token={token} /></Suspense>
      </section>
    </section>
  );
}
export default function App() {
  const isMobileViewport = useIsMobileViewport();
  const [mode, setMode] = useState("login");
  const [registerForm, setRegisterForm] = useState(emptyRegister);
  const [loginForm, setLoginForm] = useState(emptyLogin);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(() => readStoredUser());
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "light");
  const [selectedDepartment, setSelectedDepartment] = useState(() => {
    const savedDepartment = localStorage.getItem(PRODUCT_KEY);
    return departmentOptions.some((option) => option.id === savedDepartment) ? savedDepartment : "fuel";
  });
  const [rows, setRows] = useState([]);
  const [fleetVehicles, setFleetVehicles] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [loading, setLoading] = useState(false);
  const [gridLoading, setGridLoading] = useState(false);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [smartFillId, setSmartFillId] = useState(null);
  const [activeWorkspace, setActiveWorkspace] = useState("command");
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [sitePanel, setSitePanel] = useState("");
  const [sidebarExpandedByDepartment, setSidebarExpandedByDepartment] = useState(() => readStoredSidebarState());

  useEffect(() => {
    if (!token) {
      localStorage.removeItem(USER_KEY);
      setUser(null);
      setRows([]);
      setFleetVehicles([]);
      return;
    }

    let ignore = false;

    async function bootstrapUser() {
      try {
        const me = await apiRequest("/auth/me", {}, token);
        if (!ignore) {
          localStorage.setItem(USER_KEY, JSON.stringify(me));
          setUser(me);
          setSelectedDepartment(me.department);
          setError("");
        }
      } catch (fetchError) {
        if (!ignore) {
          if (user) {
            setError("Session check failed, but your workspace stayed on screen.");
          } else {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
            setToken("");
            setUser(null);
            setRows([]);
            setFleetVehicles([]);
            setError("Session check failed. Please sign in again.");
          }
        }
      }
    }

    bootstrapUser();

    return () => {
      ignore = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || user?.department !== "fuel") {
      setRows([]);
      setGridLoading(false);
      return;
    }

    let ignore = false;

    async function loadFuelWorkspace() {
      setGridLoading(true);
      try {
        const loads = await apiRequest("/loads", {}, token);
        if (!ignore) {
          setRows(loads.map(normalizeRow));
          setError("");
        }
      } catch (fetchError) {
        if (!ignore) {
          setRows([]);
          setError(fetchError.message);
        }
      } finally {
        if (!ignore) {
          setGridLoading(false);
        }
      }
    }

    loadFuelWorkspace();

    return () => {
      ignore = true;
    };
  }, [token, user?.department]);

  useEffect(() => {
    if (!token || user?.department !== "fuel") {
      setFleetVehicles([]);
      setFleetLoading(false);
      return;
    }

    let ignore = false;

    async function loadFleetPresets() {
      setFleetLoading(true);
      try {
        const data = await apiRequest("/motive/fleet", {}, token);
        if (!ignore) {
          setFleetVehicles(Array.isArray(data?.vehicles) ? data.vehicles : []);
        }
      } catch {
        if (!ignore) {
          setFleetVehicles([]);
        }
      } finally {
        if (!ignore) {
          setFleetLoading(false);
        }
      }
    }

    loadFleetPresets();
    return () => {
      ignore = true;
    };
  }, [token, user?.department]);

  useEffect(() => {
    const body = document.body;
    body.classList.remove("theme-light", "theme-dark", "theme-blue");
    body.classList.add(`theme-${theme}`);
    localStorage.setItem(THEME_KEY, theme);

    return () => {
      body.classList.remove("theme-light", "theme-dark", "theme-blue");
    };
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(PRODUCT_KEY, selectedDepartment);
  }, [selectedDepartment]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify(sidebarExpandedByDepartment));
  }, [sidebarExpandedByDepartment]);

  useEffect(() => {
    if (selectedDepartment !== "driver" && mode === "register") {
      setMode("login");
    }
  }, [mode, selectedDepartment]);

  useEffect(() => {
    const timers = [60, 220].map((delay) => window.setTimeout(() => window.dispatchEvent(new Event("resize")), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeWorkspace]);

  useEffect(() => {
    if (!sitePanel) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setSitePanel("");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sitePanel]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const haystack = [
        row.driver,
        row.truck,
        row.pickup_city,
        row.delivery_city,
        row.customer_name,
        row.broker_name,
        row.load_number
      ].join(" ").toLowerCase();
      const matchesSearch = haystack.includes(search.toLowerCase());
      const matchesStatus = statusFilter === "All" || row.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rows, search, statusFilter]);

  const metrics = useMemo(() => {
    const activeLoads = rows.filter((row) => row.status !== "Done").length;
    const delayedLoads = rows.filter((row) => row.status === "Delayed").length;
    const reviewLoads = rows.filter((row) => row.status === "Needs Review").length;
    const lowFuelCount = rows.filter((row) => Number(row.fuel_level) < 40).length;
    const totalMilesToEmpty = rows.reduce((sum, row) => sum + (Number(row.miles_to_empty) || 0), 0);
    const readiness = rows.length ? Math.max(0, 100 - lowFuelCount * 12 - delayedLoads * 14 - reviewLoads * 8) : 100;

    return {
      total: rows.length,
      activeLoads,
      delayedLoads,
      reviewLoads,
      lowFuelCount,
      totalMilesToEmpty,
      readiness
    };
  }, [rows]);

  const currentDate = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric"
      }).format(new Date()),
    []
  );

  const activeDepartment = user?.department || selectedDepartment;
  const selectedDepartmentMeta = getDepartmentMeta(activeDepartment);
  const isAdminWorkspace = activeDepartment === "admin";
  const isFuelService = activeDepartment === "fuel";
  const isDriverWorkspace = activeDepartment === "driver";
  const sidebarExpanded = sidebarExpandedByDepartment[activeDepartment] !== false;
  const activeWorkspaceMeta = workspaceTabs.find((tab) => tab.id === activeWorkspace) || workspaceTabs[0];
  const activeWorkspaceCopy = workspaceCopy[activeWorkspaceMeta.id] || workspaceCopy.command;
  const workspaceShortcutTabs = workspaceQuickStartCards
    .map((item) => workspaceTabs.find((tab) => tab.id === item.id))
    .filter(Boolean);
  const activeSiteNav = sitePanel || (!user || !isFuelService || activeWorkspace === "command" ? "home" : "");
  const loadStatusTabs = ["All", ...statusOptions];
  const workspaceShellStyle = {
    "--workspace-sidebar-width": sidebarExpanded ? WORKSPACE_SIDEBAR_WIDTH_EXPANDED : WORKSPACE_SIDEBAR_WIDTH_COLLAPSED
  };
  const activityView = useMemo(() => {
    if (!user) {
      return {
        page: mode === "register" ? "auth-register" : "auth-login",
        workspace: selectedDepartment,
        label: `${getDepartmentMeta(selectedDepartment).label} ${mode === "register" ? "Register" : "Login"}`,
      };
    }

    if (isAdminWorkspace) {
      return {
        page: "admin",
        workspace: "access",
        label: "Admin Panel",
      };
    }

    if (isFuelService) {
      return {
        page: "fuel",
        workspace: activeWorkspace,
        label: activeWorkspaceMeta.label,
      };
    }

    if (isDriverWorkspace) {
      return {
        page: "driver",
        workspace: "workspace",
        label: "Driver Workspace",
      };
    }

    return {
      page: activeDepartment || "workspace",
      workspace: "workspace",
      label: `${selectedDepartmentMeta.label} Workspace`,
    };
  }, [
    activeDepartment,
    activeWorkspace,
    activeWorkspaceMeta.label,
    isAdminWorkspace,
    isDriverWorkspace,
    isFuelService,
    mode,
    selectedDepartment,
    selectedDepartmentMeta.label,
    user,
  ]);

  useEffect(() => {
    setActivityContext(activityView);
  }, [activityView]);

  useEffect(() => {
    trackActivity({
      token,
      eventType: user ? "workspace_view" : "page_enter",
      eventName: user ? "Opened workspace" : "Opened auth screen",
      page: activityView.page,
      workspace: activityView.workspace,
      label: activityView.label,
      throttleKey: `view:${user?.id || "guest"}:${activityView.page}:${activityView.workspace}:${mode}:${selectedDepartment}`,
      throttleMs: 2500,
    });
  }, [activityView.label, activityView.page, activityView.workspace, mode, selectedDepartment, token, user]);

  useEffect(() => {
    function handleDocumentClick(event) {
      const targetInfo = readClickActivityTarget(event.target);
      if (!targetInfo) {
        return;
      }

      trackActivity({
        token,
        eventType: "click",
        eventName: "Clicked control",
        label: targetInfo.label,
        details: targetInfo.details,
        throttleKey: `click:${user?.id || "guest"}:${activityView.page}:${activityView.workspace}:${targetInfo.label}`,
        throttleMs: 700,
      });
    }

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [activityView.page, activityView.workspace, token, user?.id]);

  useEffect(() => {
    if (!token || !user) {
      return undefined;
    }

    function sendHeartbeat() {
      if (document.hidden) {
        return;
      }
      trackActivity({
        token,
        eventType: "heartbeat",
        eventName: "Still active",
        page: activityView.page,
        workspace: activityView.workspace,
        label: user.full_name || user.email || "User",
        throttleKey: `heartbeat:${user.id}:${activityView.page}:${activityView.workspace}`,
        throttleMs: 30000,
      });
    }

    sendHeartbeat();
    const intervalId = window.setInterval(sendHeartbeat, 60000);
    document.addEventListener("visibilitychange", sendHeartbeat);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", sendHeartbeat);
    };
  }, [activityView.page, activityView.workspace, token, user]);

  function updateLocalRow(id, field, value) {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.id !== id) return row;
        const nextRow = normalizeRow({ ...row, [field]: value });
        if (field === "mpg" || field === "tank_capacity" || field === "fuel_level") {
          nextRow.miles_to_empty = computeMilesToEmpty(nextRow);
        }
        return nextRow;
      })
    );
  }

  function handleAuthenticated(data, successMessage = "Signed in.") {
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setToken(data.access_token);
    setUser(data.user);
    setSelectedDepartment(data.user.department);
    setRegisterForm(emptyRegister);
    setLoginForm(emptyLogin);
    setMessage(successMessage);
    setError("");
  }

  async function submitAuth(path, payload) {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const data = await apiRequest(path, {
        method: "POST",
        body: JSON.stringify({ ...payload, department: selectedDepartment })
      });

      handleAuthenticated(data, path === "/auth/register" ? "Account created." : "Signed in.");
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveRow(row) {
    if (!token) return;

    const payload = {
      ...row,
      miles_to_empty: computeMilesToEmpty(row)
    };

    setSavingId(row.id);
    setError("");

    try {
      const saved = await apiRequest(
        `/loads/${row.id}`,
        {
          method: "PUT",
          body: JSON.stringify(payload)
        },
        token
      );

      setRows((currentRows) => currentRows.map((item) => (item.id === row.id ? normalizeRow(saved) : item)));
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingId(null);
    }
  }

  async function syncRowVehicle(row, nextVehicleId) {
    if (!token) return;

    const vehicleId = Number(nextVehicleId);
    if (!Number.isFinite(vehicleId) || vehicleId <= 0) {
      const clearedRow = normalizeRow({ ...row, vehicle_id: null });
      setRows((currentRows) => currentRows.map((item) => (item.id === row.id ? clearedRow : item)));
      await saveRow(clearedRow);
      return;
    }

    const vehicle = fleetVehicles.find((item) => Number(item?.id) === vehicleId);
    if (!vehicle) {
      setError("Selected truck is not available in the current Motive snapshot.");
      return;
    }

    const preset = deriveRowTruckPreset(vehicle, row);
    const nextRow = normalizeRow({
      ...row,
      vehicle_id: vehicleId,
      driver: vehicleDriverName(vehicle),
      truck: vehicleLabel(vehicle),
      mpg: Number(preset.mpg).toFixed(1),
      tank_capacity: String(Math.round(preset.tankCapacityGallons)),
      fuel_level: preset.fuelPercent !== null ? Math.round(preset.fuelPercent) : row.fuel_level,
    });
    nextRow.miles_to_empty = computeMilesToEmpty(nextRow);
    setRows((currentRows) => currentRows.map((item) => (item.id === row.id ? nextRow : item)));
    await saveRow(nextRow);
  }

  async function smartFillRow(row) {
    if (!token) return;

    const vehicle = findVehicleForRow(row, fleetVehicles);
    if (!vehicle) {
      setError("Pick a Motive truck first, then run Smart Fill.");
      return;
    }
    if (!String(row.pickup_city || "").trim() || !String(row.delivery_city || "").trim()) {
      setError("Enter pickup and delivery before Smart Fill.");
      return;
    }

    const originQuery = vehicleLocationQuery(vehicle);
    if (!originQuery) {
      setError("Selected truck does not have a usable Motive location.");
      return;
    }

    const preset = deriveRowTruckPreset(vehicle, row);
    const commonPayload = {
      vehicle_id: Number(vehicle.id) || null,
      vehicle_number: vehicleLabel(vehicle),
      driver_name: vehicleDriverName(vehicle),
      vehicle_type: "Truck",
      fuel_type: "Auto Diesel",
      tank_capacity_gallons: preset.tankCapacityGallons,
      mpg: preset.mpg,
      sort_by: "cheapest",
    };

    setSmartFillId(row.id);
    setMessage("");
    setError("");

    try {
      const toPickupPlan = await apiRequest(
        "/navigation/route-assistant",
        {
          method: "POST",
          timeoutMs: ROUTE_REQUEST_TIMEOUT_MS,
          body: JSON.stringify({
            ...commonPayload,
            origin: originQuery,
            destination: String(row.pickup_city || "").trim(),
            current_fuel_gallons: preset.currentFuelGallons,
          }),
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
            ...commonPayload,
            origin: String(row.pickup_city || "").trim(),
            destination: String(row.delivery_city || "").trim(),
            current_fuel_gallons: remainingAtPickup,
          }),
        },
        token
      );

      const deadheadMiles = planRouteMiles(toPickupPlan);
      const loadedMiles = planRouteMiles(toDeliveryPlan);
      const totalMiles = deadheadMiles + loadedMiles;
      const serviceFuelCost = planFuelCost(toPickupPlan) + planFuelCost(toDeliveryPlan);
      const baselineFuelCost = inferBaselineFuelCost(toPickupPlan) + inferBaselineFuelCost(toDeliveryPlan);
      const serviceSavings = baselineFuelCost - serviceFuelCost;
      const [stop1, stop2, stop3] = buildSmartStopsFromPlans(toPickupPlan, toDeliveryPlan);

      const nextRow = normalizeRow({
        ...row,
        vehicle_id: Number(vehicle.id) || null,
        driver: vehicleDriverName(vehicle),
        truck: vehicleLabel(vehicle),
        mpg: Number(preset.mpg).toFixed(1),
        tank_capacity: String(Math.round(preset.tankCapacityGallons)),
        fuel_level: preset.fuelPercent !== null ? Math.round(preset.fuelPercent) : row.fuel_level,
        manual_fuel_cost: serviceFuelCost.toFixed(2),
        baseline_fuel_cost: baselineFuelCost.toFixed(2),
        smart_service_savings: serviceSavings.toFixed(2),
        manual_total_miles: totalMiles.toFixed(1),
        manual_deadhead_miles: deadheadMiles.toFixed(1),
        manual_loaded_miles: loadedMiles.toFixed(1),
        stop1,
        stop2,
        stop3,
      });
      nextRow.miles_to_empty = computeMilesToEmpty(nextRow);

      setRows((currentRows) => currentRows.map((item) => (item.id === row.id ? nextRow : item)));
      await saveRow(nextRow);
      setMessage(`Smart Fill updated load ${row.load_number || `#${row.id}`} from the selected truck and route.`);
    } catch (smartFillError) {
      setError(smartFillError.message || "Smart Fill failed.");
    } finally {
      setSmartFillId(null);
    }
  }

  async function createRow() {
    if (!token || !isFuelService) return;

    setError("");
    setMessage("");

    try {
      const created = await apiRequest(
        "/loads",
        {
          method: "POST",
          body: JSON.stringify(emptyRow)
        },
        token
      );

      setRows((currentRows) => [normalizeRow(created), ...currentRows]);
      setActiveWorkspace("loads");
    } catch (createError) {
      setError(createError.message);
    }
  }

  async function deleteRow(id) {
    if (!token || !isFuelService) return;

    try {
      await apiRequest(`/loads/${id}`, { method: "DELETE" }, token);
      setRows((currentRows) => currentRows.filter((row) => row.id !== id));
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  function logout() {
    trackActivity({
      token,
      eventType: "session_end",
      eventName: "Signed out",
      page: activityView.page,
      workspace: activityView.workspace,
      label: user?.full_name || user?.email || "User",
      throttleKey: `logout:${user?.id || "guest"}`,
      throttleMs: 1000,
    });
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken("");
    setUser(null);
    setRows([]);
    setFleetVehicles([]);
    setMessage("Signed out.");
    setError("");
    setSitePanel("");
    setMode("login");
    setActiveWorkspace("command");
  }


  function handleMobileFuelNav(tabId) {
    if (tabId === "more") {
      setMobileMoreOpen((open) => !open);
      return;
    }
    setMobileMoreOpen(false);
    setActiveWorkspace(tabId);
  }

  function openMobileWorkspace(tabId) {
    setMobileMoreOpen(false);
    setActiveWorkspace(tabId);
  }
  function openSitePanel(panel) {
    setSitePanel(panel);
  }

  function toggleWorkspaceSidebar() {
    setSidebarExpandedByDepartment((current) => ({
      ...current,
      [activeDepartment]: !sidebarExpanded
    }));
  }

  function handleHomeNavigation() {
    setSitePanel("");

    if (!user) {
      setMode("login");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (isFuelService) {
      setActiveWorkspace("command");
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!user) {
    const isRestoringSession = Boolean(token);

    return (
      <div className="site-page-shell">
        <SiteHeader
          onHome={handleHomeNavigation}
          onAbout={() => openSitePanel("about")}
          onDocs={() => openSitePanel("docs")}
          onPrivacy={() => openSitePanel("privacy")}
          activeItem={activeSiteNav}
        />

        <main className={`auth-shell site-auth-shell ${isMobileViewport ? "mobile-auth-shell" : ""}`}>
          <section className="auth-showcase auth-showcase-planner">
            <AuthShiftPlanner />
          </section>

          <section className="auth-panel auth-panel-compact">
            <div className="auth-panel-head">
              <span className="brand-pill">United Lane LLC</span>
              <h2>{mode === "login" ? "Sign in" : "Create account"}</h2>
              <p>{selectedDepartmentMeta.label}</p>
            </div>

            {message ? <div className="notice success">{message}</div> : null}
            {error ? <div className="notice error">{error}</div> : null}
            {isRestoringSession ? <div className="notice info">Checking access...</div> : null}

            <div className="auth-department-grid">
              {departmentOptions.map((option) => (
                <DepartmentCard key={option.id} option={option} active={selectedDepartment === option.id} onSelect={setSelectedDepartment} />
              ))}
            </div>

            <div className="auth-lock-note">{selectedDepartment === "admin" ? "Admin login accepts username or email." : selectedDepartment === "driver" ? "Driver registration requires a matched Motive truck." : "Accounts are created by Admin only."}</div>
            <button className="secondary-button auth-docs-button" type="button" onClick={() => openSitePanel("docs")}>
              Docs
            </button>

            {isRestoringSession ? null : (
              <>
                <div className="tabs">
                  <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">
                    Login
                  </button>
                  {selectedDepartment === "driver" ? (
                    <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} type="button">
                      Register
                    </button>
                  ) : null}
                </div>

                {selectedDepartment === "driver" ? (
                  <DriverAuth
                    mode={mode}
                    loading={loading}
                    onBusyChange={setLoading}
                    onAuthenticated={handleAuthenticated}
                    onError={setError}
                    onMessage={setMessage}
                  />
                ) : mode === "login" ? (
                  <form
                    className="auth-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitAuth("/auth/login", loginForm);
                    }}
                  >
                    <label>
                      {selectedDepartment === "admin" ? "Username or Email" : "Email"}
                      <input
                        type={selectedDepartment === "admin" ? "text" : "email"}
                        value={loginForm.email}
                        onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
                        placeholder={selectedDepartment === "admin" ? "redevil" : "name@company.com"}
                        required
                      />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        value={loginForm.password}
                        onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                        placeholder="Enter password"
                        required
                      />
                    </label>
                    <button type="submit" className="primary-button auth-submit" disabled={loading}>
                      {loading ? "Signing in..." : "Continue"}
                    </button>
                  </form>
                ) : (
                  <form
                    className="auth-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitAuth("/auth/register", registerForm);
                    }}
                  >
                    <label>
                      Full Name
                      <input
                        type="text"
                        value={registerForm.full_name}
                        onChange={(event) => setRegisterForm({ ...registerForm, full_name: event.target.value })}
                        placeholder="Full name"
                        required
                      />
                    </label>
                    <label>
                      {selectedDepartment === "admin" ? "Username or Email" : "Email"}
                      <input
                        type={selectedDepartment === "admin" ? "text" : "email"}
                        value={registerForm.email}
                        onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })}
                        placeholder={selectedDepartment === "admin" ? "redevil" : "name@company.com"}
                        required
                      />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        value={registerForm.password}
                        onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })}
                        placeholder="Minimum 6 characters"
                        minLength="6"
                        required
                      />
                    </label>
                    <button type="submit" className="primary-button auth-submit" disabled={loading}>
                      {loading ? "Creating..." : "Create Account"}
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        </main>

        <InstallAppButton />
        {sitePanel ? <SiteDialog panel={sitePanels[sitePanel]} onClose={() => setSitePanel("")} /> : null}
      </div>
    );
  }

  if (isAdminWorkspace && isMobileViewport) {
    return (
      <MobileWorkspaceShell
        kicker="Admin"
        title="Admin Panel"
        subtitle="Accounts, bans, roles, passwords, and system statistics."
        user={user}
        currentDate={currentDate}
        message={message}
        error={error}
        onLogout={logout}
      >
        <Suspense fallback={<ModuleLoader label="Loading admin panel..." />}>
          <AdminPanel token={token} user={user} />
        </Suspense>
      </MobileWorkspaceShell>
    );
  }
  if (isAdminWorkspace) {
    return (
      <div className="site-page-shell">
        <SiteHeader
          onHome={handleHomeNavigation}
          onAbout={() => openSitePanel("about")}
          onDocs={() => openSitePanel("docs")}
          onPrivacy={() => openSitePanel("privacy")}
          activeItem={activeSiteNav}
        />

        <main className={`workspace-app-shell site-workspace-shell workspace-app-shell-admin${sidebarExpanded ? "" : " workspace-app-shell-collapsed"}`} style={workspaceShellStyle}>
          <WorkspaceSidebarShell
            expanded={sidebarExpanded}
            onToggle={toggleWorkspaceSidebar}
            modeLabel="Admin"
            brandMeta={user.username ? `@${user.username}` : user.email}
            accountLabel="Admin"
            accountTitle={user.full_name}
            accountSubtitle={user.email}
            accountBadge="Full access"
            noteLabel="Quick Access"
            noteTitle="Access center"
            noteSubtitle="Users, bans, passwords, and platform statistics stay together in one control surface."
            footerDate={currentDate}
            footerTitle="Admin ready"
            footerSubtitle="Users, bans, statistics"
            onLogout={logout}
          />

          <section className="workspace-main-shell">
            <header className="workspace-main-header">
              <div className="workspace-main-heading">
                <span className="workspace-main-kicker">Admin</span>
                <h1>Admin Panel</h1>
                <p>Manage accounts, access, bans, passwords, and platform statistics.</p>
              </div>

              <div className="workspace-main-meta">
                <div className="workspace-main-usercard">
                  <span>Admin</span>
                  <strong>{user.full_name}</strong>
                </div>
              </div>
            </header>

            {message ? <div className="notice success inline-notice">{message}</div> : null}
            {error ? <div className="notice error inline-notice">{error}</div> : null}

            <Suspense fallback={<ModuleLoader label="Loading admin panel..." />}>
              <AdminPanel token={token} user={user} />
            </Suspense>
          </section>
        </main>

        <InstallAppButton />
        {sitePanel ? <SiteDialog panel={sitePanels[sitePanel]} onClose={() => setSitePanel("")} /> : null}
      </div>
    );
  }
  if (isDriverWorkspace && isMobileViewport) {
    return (
      <MobileWorkspaceShell
        kicker="Driver"
        title="Driver Workspace"
        subtitle="Truck, route, service, emergency, and team chat."
        user={user}
        currentDate={currentDate}
        message={message}
        error={error}
        onLogout={logout}
      >
        <DriverWorkspace token={token} user={user} mobile />
      </MobileWorkspaceShell>
    );
  }
  if (isDriverWorkspace) {
    return (
      <div className="site-page-shell">
        <SiteHeader
          onHome={handleHomeNavigation}
          onAbout={() => openSitePanel("about")}
          onDocs={() => openSitePanel("docs")}
          onPrivacy={() => openSitePanel("privacy")}
          activeItem={activeSiteNav}
        />

        <main className={`workspace-app-shell site-workspace-shell workspace-app-shell-driver${sidebarExpanded ? "" : " workspace-app-shell-collapsed"}`} style={workspaceShellStyle}>
          <WorkspaceSidebarShell
            expanded={sidebarExpanded}
            onToggle={toggleWorkspaceSidebar}
            modeLabel="Driver"
            brandMeta="Motive truck workspace"
            accountLabel="Driver"
            accountTitle={user.full_name}
            accountSubtitle="Fuel, service, emergency"
            accountBadge="Driver access"
            noteLabel="Quick Flow"
            noteTitle="Truck support"
            noteSubtitle="Open fuel route, service tools, and SOS from one sliding workspace shell."
            footerDate={currentDate}
            footerTitle="Driver ready"
            footerSubtitle="Truck route and safety support"
            onLogout={logout}
          />

          <section className="workspace-main-shell">
            <header className="workspace-main-header">
              <div className="workspace-main-heading">
                <span className="workspace-main-kicker">Driver</span>
                <h1>Driver Workspace</h1>
                <p>Your truck, fuel route, service centers, and emergency support.</p>
              </div>

              <div className="workspace-main-meta">
                <div className="workspace-main-usercard">
                  <span>Driver</span>
                  <strong>{user.full_name}</strong>
                </div>
              </div>
            </header>

            {message ? <div className="notice success inline-notice">{message}</div> : null}
            {error ? <div className="notice error inline-notice">{error}</div> : null}

            <DriverWorkspace token={token} user={user} />
          </section>
        </main>

        <InstallAppButton />
        {sitePanel ? <SiteDialog panel={sitePanels[sitePanel]} onClose={() => setSitePanel("")} /> : null}
      </div>
    );
  }
  if (!isFuelService && isMobileViewport) {
    return (
      <MobileWorkspaceShell
        kicker="Safety"
        title="Safety"
        subtitle="Fleet alerts, incidents, emergency tools, documents, and team chat."
        user={user}
        currentDate={currentDate}
        message={message}
        error={error}
        onLogout={logout}
      >
        <SafetyWorkspace token={token} user={user} mobile />
      </MobileWorkspaceShell>
    );
  }
  if (!isFuelService) {
    return (
      <div className="site-page-shell">
        <SiteHeader
          onHome={handleHomeNavigation}
          onAbout={() => openSitePanel("about")}
          onDocs={() => openSitePanel("docs")}
          onPrivacy={() => openSitePanel("privacy")}
          activeItem={activeSiteNav}
        />

        <main className={`workspace-app-shell site-workspace-shell workspace-app-shell-safety${sidebarExpanded ? "" : " workspace-app-shell-collapsed"}`} style={workspaceShellStyle}>
          <WorkspaceSidebarShell
            expanded={sidebarExpanded}
            onToggle={toggleWorkspaceSidebar}
            modeLabel="Safety"
            brandMeta={user.email}
            accountLabel="Account"
            accountTitle={user.full_name}
            accountSubtitle={user.email}
            accountBadge="Safety access"
            noteLabel="Safety Flow"
            noteTitle="Fleet oversight"
            noteSubtitle="Fleet, service map, documents, notes, and AI stay grouped in this sliding panel layout."
            footerDate={currentDate}
            footerTitle="Safety ready"
            footerSubtitle="Fleet, services, docs"
            onLogout={logout}
          />

          <section className="workspace-main-shell">
            <header className="workspace-main-header">
              <div className="workspace-main-heading">
                <span className="workspace-main-kicker">Safety</span>
                <h1>Safety</h1>
                <p>Fleet safety, automation, service map, emergency, documents, notes, AI.</p>
              </div>

              <div className="workspace-main-meta">
                <div className="workspace-main-usercard">
                  <span>Account</span>
                  <strong>{user.full_name}</strong>
                </div>
              </div>
            </header>

            {message ? <div className="notice success inline-notice">{message}</div> : null}
            {error ? <div className="notice error inline-notice">{error}</div> : null}

            <SafetyWorkspace token={token} user={user} />
          </section>
        </main>

        <InstallAppButton />
        {sitePanel ? <SiteDialog panel={sitePanels[sitePanel]} onClose={() => setSitePanel("")} /> : null}
      </div>
    );
  }


  if (isMobileViewport) {
    return (
      <MobileWorkspaceShell
        kicker="Fuel Service"
        title={activeWorkspaceCopy.title}
        subtitle={activeWorkspaceCopy.subtitle}
        user={user}
        currentDate={currentDate}
        message={message}
        error={error}
        onLogout={logout}
        navItems={mobileFuelTabs}
        activeId={mobileMoreOpen || mobileFuelMoreTabs.some((tab) => tab.id === activeWorkspace) ? "more" : activeWorkspace}
        onSelect={handleMobileFuelNav}
        morePanel={mobileMoreOpen ? (
          <section className="mobile-more-sheet">
            <div><span>More Tools</span><strong>Fuel Service</strong></div>
            {mobileFuelMoreTabs.map((tab) => (
              <button key={tab.id} type="button" className={activeWorkspace === tab.id ? "active" : ""} onClick={() => openMobileWorkspace(tab.id)}>
                <span>{tab.icon}</span><div><strong>{tab.label}</strong><small>{tab.detail}</small></div>
              </button>
            ))}
          </section>
        ) : null}
        action={activeWorkspace === "loads" ? <button className="primary-button" type="button" onClick={createRow}>New Load</button> : null}
      >
        <MobileFuelWorkspaceContent
          activeWorkspace={activeWorkspace}
          token={token}
          user={user}
          rows={rows}
          filteredRows={filteredRows}
          metrics={metrics}
          search={search}
          setSearch={setSearch}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          loadStatusTabs={loadStatusTabs}
          gridLoading={gridLoading}
          savingId={savingId}
          smartFillId={smartFillId}
          fleetLoading={fleetLoading}
          fleetVehicles={fleetVehicles}
          createRow={createRow}
          deleteRow={deleteRow}
          saveRow={saveRow}
          updateLocalRow={updateLocalRow}
          syncRowVehicle={syncRowVehicle}
          smartFillRow={smartFillRow}
          theme={theme}
          setTheme={setTheme}
          onSelectWorkspace={openMobileWorkspace}
        />
      </MobileWorkspaceShell>
    );
  }
  return (
    <div className="site-page-shell">
      <SiteHeader
        onHome={handleHomeNavigation}
        onAbout={() => openSitePanel("about")}
        onDocs={() => openSitePanel("docs")}
        onPrivacy={() => openSitePanel("privacy")}
        activeItem={activeSiteNav}
      />

      <main className={`workspace-app-shell site-workspace-shell workspace-app-shell-fuel${sidebarExpanded ? "" : " workspace-app-shell-collapsed"}`} style={workspaceShellStyle}>
        <WorkspaceSidebarShell
          expanded={sidebarExpanded}
          onToggle={toggleWorkspaceSidebar}
          modeLabel="Fuel Service"
          brandMeta={user.email}
          accountLabel="Account"
          accountTitle={user.full_name}
          accountSubtitle={user.email}
          accountBadge="Fuel Service access"
          action={{ label: "New Load", icon: "+", onClick: createRow }}
          navSections={workspaceNavSections}
          activeTab={activeWorkspace}
          onSelectTab={setActiveWorkspace}
          footerDate={currentDate}
          footerTitle={savingId ? `Saving load #${savingId}` : "Fuel Service ready"}
          footerSubtitle={`${metrics.readiness}% readiness score`}
          onLogout={logout}
        />

        <section className="workspace-main-shell">
          <header className="workspace-main-header">
            <div className="workspace-main-heading">
              <span className="workspace-main-kicker">{activeWorkspaceCopy.eyebrow}</span>
              <h1>{activeWorkspaceCopy.title}</h1>
              <p>{activeWorkspaceCopy.subtitle}</p>
              <div className="workspace-main-guidance">
                <strong>What to do here</strong>
                <span>{activeWorkspaceCopy.helper}</span>
              </div>
            </div>

            <div className="workspace-main-meta">
              <div className="workspace-main-usercard">
                <span>Account</span>
                <strong>{user.full_name}</strong>
                <small>{user.email}</small>
              </div>
              <div className="workspace-main-usercard subdued">
                <span>Workspace</span>
                <strong>{activeWorkspaceMeta.label}</strong>
                <small>{activeWorkspaceMeta.detail}</small>
              </div>
              <button className="primary-button header-action-button" type="button" onClick={() => { createRow(); setActiveWorkspace("loads"); }}>
                Create Load
              </button>
            </div>
          </header>

          {message ? <div className="notice success inline-notice">{message}</div> : null}
          {error ? <div className="notice error inline-notice">{error}</div> : null}

          <section className="panel workspace-orientation-strip">
            <div className="workspace-orientation-copy">
              <span>Recommended flow</span>
              <strong>{"Loads -> Routing -> Tracking"}</strong>
              <small>New users can safely follow this order without needing to learn the whole platform first.</small>
            </div>
            <div className="workspace-shortcut-row">
              {workspaceShortcutTabs.map((tab) => (
                <WorkspaceShortcutButton key={tab.id} tab={tab} active={activeWorkspace === tab.id} onSelect={setActiveWorkspace} />
              ))}
            </div>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "command"}>
            <section className="panel workspace-command-hero-card">
              <div className="workspace-command-hero-copy">
                <span className="eyebrow">Start Here</span>
                <h2>Clear workflow for dispatch and fuel service</h2>
                <p>Keep the first experience simple: create the load, plan the route, then watch the truck live.</p>
              </div>

              <div className="workspace-start-grid">
                {workspaceQuickStartCards.map((item) => (
                  <WorkspaceStartCard key={item.id} item={item} active={activeWorkspace === item.id} onSelect={setActiveWorkspace} />
                ))}
              </div>
            </section>

            <section className="metric-grid">
              <MetricCard label="Total loads" value={metrics.total} detail={`${metrics.activeLoads} active`} tone="green" />
              <MetricCard label="Low fuel" value={metrics.lowFuelCount} detail="Below 40%" tone={metrics.lowFuelCount ? "amber" : "blue"} />
              <MetricCard label="Needs review" value={metrics.reviewLoads} detail={`${metrics.delayedLoads} delayed`} tone="violet" />
              <MetricCard label="Miles left" value={formatNumber(metrics.totalMilesToEmpty)} detail="All loads" tone="dark" />
            </section>

            <Suspense fallback={<ModuleLoader label="Loading Motive operations cards..." />}>
              <MotiveDashboardCards token={token} active={activeWorkspace === "command"} />
            </Suspense>

            <section className="panel workspace-tool-surface">
              <div className="panel-head">
                <div>
                  <h2>Fuel Service Tools</h2>
                  <span>TomTom tools.</span>
                </div>
              </div>
              <Suspense fallback={<ModuleLoader label="Loading service catalog..." />}>
                <TomTomSuite token={token} />
              </Suspense>
            </section>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "tracking"}>
            <Suspense fallback={<ModuleLoader label="Loading Motive fleet tracking..." />}>
              <MotiveTrackingPanel token={token} active={activeWorkspace === "tracking"} />
            </Suspense>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "statistics"}>
            <Suspense fallback={<ModuleLoader label="Loading truck statistics..." />}>
              <FleetStatisticsPanel token={token} active={activeWorkspace === "statistics"} loadRows={rows} />
            </Suspense>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "profitability"}>
            <Suspense fallback={<ModuleLoader label="Loading profitability..." />}>
              <ProfitabilityPanel token={token} active={activeWorkspace === "profitability"} loadRows={rows} />
            </Suspense>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "fullroad"}>
            <Suspense fallback={<ModuleLoader label="Loading Full Road..." />}>
              <FullRoadWorkspace token={token} active={activeWorkspace === "fullroad"} loadRows={rows} />
            </Suspense>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "routing"}>
            <Suspense fallback={<ModuleLoader label="Loading route intelligence..." />}>
              <RouteAssistant token={token} active={activeWorkspace === "routing"} loadRows={rows} />
            </Suspense>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "history"}>
            <Suspense fallback={<ModuleLoader label="Loading route history..." />}>
              <RouteHistoryPanel token={token} active={activeWorkspace === "history"} />
            </Suspense>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "approvals"}>
            <Suspense fallback={<ModuleLoader label="Loading fuel authorizations..." />}>
              <FuelAuthorizations token={token} active={activeWorkspace === "approvals"} />
            </Suspense>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "loads"}>
            <section className="loads-control-card">
              <div>
                <span className="eyebrow">Loads</span>
                <h2>{filteredRows.length} rows shown</h2>
                <p>Search, edit, and save dispatch plus profitability inputs.</p>
              </div>
              <div className="loads-control-actions">
                <label className="workspace-table-search">
                  <span>Search loads</span>
                  <input
                    type="text"
                    placeholder="Load, customer, broker, driver, truck"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <button className="primary-button workspace-table-create" type="button" onClick={createRow}>
                  New Load
                </button>
              </div>
            </section>

            <div className="workspace-inline-tabs">
              {loadStatusTabs.map((status) => {
                const total = status === "All" ? rows.length : rows.filter((row) => row.status === status).length;
                return (
                  <button
                    key={status}
                    type="button"
                    className={`workspace-inline-tab ${statusFilter === status ? "active" : ""}`}
                    onClick={() => setStatusFilter(status)}
                  >
                    {status}
                    <span>{total}</span>
                  </button>
                );
              })}
            </div>

            <section className="panel workspace-table-panel">
              <div className="workspace-table-toolbar">
                <div>
                  <h2>Dispatch Sheet</h2>
                  <span>{gridLoading ? "Syncing..." : savingId ? `Saving row #${savingId}` : smartFillId ? `Smart Fill on row #${smartFillId}` : "Pick truck, enter pickup + delivery + rate, then let Smart Fill build the economics."}</span>
                </div>
                <div className="workspace-table-toolbar-actions">
                  <div className="workspace-main-usercard subdued compact">
                    <span>Rows shown</span>
                    <strong>{filteredRows.length}</strong>
                  </div>
                  <div className="workspace-main-usercard subdued compact">
                    <span>Motive trucks</span>
                    <strong>{fleetLoading ? "..." : fleetVehicles.length}</strong>
                  </div>
                </div>
              </div>

              <div className="sheet-frame">
                <div className="sheet-scroll">
                  <table className="dispatch-sheet">
                    <thead>
                      <tr>
                        <th>Load #</th>
                        <th>Customer</th>
                        <th>Broker</th>
                        <th>Truck Preset</th>
                        <th>Driver</th>
                        <th>Truck #</th>
                        <th>Approx MPG</th>
                        <th>Status</th>
                        <th>Miles to Empty</th>
                        <th>Tank Capacity</th>
                        <th>Fuel %</th>
                        <th>Full Load Miles</th>
                        <th>PU City</th>
                        <th>PU Appt</th>
                        <th>1st Stop</th>
                        <th>2nd Stop</th>
                        <th>3rd Stop</th>
                        <th>Del City</th>
                        <th>Del Appt</th>
                        <th>Rate</th>
                        <th>Driver Pay</th>
                        <th>Free Min</th>
                        <th>Det / Hr</th>
                        <th>Lumper</th>
                        <th>Tolls</th>
                        <th>Accessorials</th>
                        <th>Fuel Cost</th>
                        <th>No Service</th>
                        <th>Svc +/-</th>
                        <th>Total Mi</th>
                        <th>Deadhead Mi</th>
                        <th>Loaded Mi</th>
                        <th>Smart Fill</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.length ? (
                        filteredRows.map((row) => {
                          const fullLoadMiles = Math.round((Number(row.mpg) || 0) * (Number(row.tank_capacity) || 0));
                          const selectedVehicle = findVehicleForRow(row, fleetVehicles);
                          const serviceSavings = Number(row.smart_service_savings) || 0;

                          return (
                            <tr key={row.id}>
                              <td>
                                <input
                                  value={row.load_number}
                                  onChange={(event) => updateLocalRow(row.id, "load_number", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, load_number: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.customer_name}
                                  onChange={(event) => updateLocalRow(row.id, "customer_name", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, customer_name: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.broker_name}
                                  onChange={(event) => updateLocalRow(row.id, "broker_name", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, broker_name: event.target.value })}
                                />
                              </td>
                              <td>
                                <select
                                  value={selectedVehicle?.id ? String(selectedVehicle.id) : ""}
                                  onChange={(event) => syncRowVehicle(row, event.target.value)}
                                  disabled={fleetLoading || !fleetVehicles.length}
                                >
                                  <option value="">{fleetLoading ? "Syncing trucks..." : "Select truck"}</option>
                                  {fleetVehicles.map((vehicle) => (
                                    <option key={vehicle.id} value={vehicle.id}>
                                      {vehicleOptionLabel(vehicle)}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="driver-cell">
                                <input
                                  value={row.driver}
                                  onChange={(event) => updateLocalRow(row.id, "driver", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, driver: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.truck}
                                  onChange={(event) => updateLocalRow(row.id, "truck", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, truck: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.mpg}
                                  onChange={(event) => updateLocalRow(row.id, "mpg", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, mpg: event.target.value })}
                                />
                              </td>
                              <td>
                                <select
                                  className={`status-select ${getStatusTone(row.status)}`}
                                  value={row.status}
                                  onChange={async (event) => {
                                    const value = event.target.value;
                                    updateLocalRow(row.id, "status", value);
                                    await saveRow({ ...row, status: value });
                                  }}
                                >
                                  {statusOptions.map((status) => (
                                    <option key={status} value={status}>
                                      {status}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  value={row.miles_to_empty}
                                  onChange={(event) => updateLocalRow(row.id, "miles_to_empty", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, miles_to_empty: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.tank_capacity}
                                  onChange={(event) => updateLocalRow(row.id, "tank_capacity", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, tank_capacity: event.target.value })}
                                />
                              </td>
                              <td className={getFuelTone(Number(row.fuel_level))}>
                                <div className="fuel-cell">
                                  <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={row.fuel_level}
                                    onChange={async (event) => {
                                      const value = Number(event.target.value);
                                      updateLocalRow(row.id, "fuel_level", value);
                                      await saveRow({ ...row, fuel_level: value, miles_to_empty: computeMilesToEmpty({ ...row, fuel_level: value }) });
                                    }}
                                  />
                                  <span>{row.fuel_level}%</span>
                                </div>
                              </td>
                              <td className="readonly-cell">{fullLoadMiles}</td>
                              <td>
                                <input
                                  value={row.pickup_city}
                                  onChange={(event) => updateLocalRow(row.id, "pickup_city", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, pickup_city: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.pickup_appt_at}
                                  onChange={(event) => updateLocalRow(row.id, "pickup_appt_at", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, pickup_appt_at: event.target.value })}
                                  placeholder="2026-04-22 08:00"
                                />
                              </td>
                              <td>
                                <textarea
                                  value={row.stop1}
                                  onChange={(event) => updateLocalRow(row.id, "stop1", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, stop1: event.target.value })}
                                />
                              </td>
                              <td>
                                <textarea
                                  value={row.stop2}
                                  onChange={(event) => updateLocalRow(row.id, "stop2", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, stop2: event.target.value })}
                                />
                              </td>
                              <td>
                                <textarea
                                  value={row.stop3}
                                  onChange={(event) => updateLocalRow(row.id, "stop3", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, stop3: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.delivery_city}
                                  onChange={(event) => updateLocalRow(row.id, "delivery_city", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, delivery_city: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.delivery_appt_at}
                                  onChange={(event) => updateLocalRow(row.id, "delivery_appt_at", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, delivery_appt_at: event.target.value })}
                                  placeholder="2026-04-23 14:00"
                                />
                              </td>
                              <td>
                                <input
                                  value={row.rate_total}
                                  onChange={(event) => updateLocalRow(row.id, "rate_total", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, rate_total: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.driver_pay_total}
                                  onChange={(event) => updateLocalRow(row.id, "driver_pay_total", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, driver_pay_total: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.detention_free_minutes}
                                  onChange={(event) => updateLocalRow(row.id, "detention_free_minutes", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, detention_free_minutes: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.detention_rate_per_hour}
                                  onChange={(event) => updateLocalRow(row.id, "detention_rate_per_hour", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, detention_rate_per_hour: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.lumper_cost}
                                  onChange={(event) => updateLocalRow(row.id, "lumper_cost", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, lumper_cost: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.toll_cost}
                                  onChange={(event) => updateLocalRow(row.id, "toll_cost", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, toll_cost: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.other_accessorials}
                                  onChange={(event) => updateLocalRow(row.id, "other_accessorials", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, other_accessorials: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.manual_fuel_cost}
                                  onChange={(event) => updateLocalRow(row.id, "manual_fuel_cost", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, manual_fuel_cost: event.target.value })}
                                />
                              </td>
                              <td className="readonly-cell">{row.baseline_fuel_cost || "0.00"}</td>
                              <td className="readonly-cell">{serviceSavings >= 0 ? "+" : ""}{serviceSavings.toFixed(2)}</td>
                              <td>
                                <input
                                  value={row.manual_total_miles}
                                  onChange={(event) => updateLocalRow(row.id, "manual_total_miles", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, manual_total_miles: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.manual_deadhead_miles}
                                  onChange={(event) => updateLocalRow(row.id, "manual_deadhead_miles", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, manual_deadhead_miles: event.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  value={row.manual_loaded_miles}
                                  onChange={(event) => updateLocalRow(row.id, "manual_loaded_miles", event.target.value)}
                                  onBlur={(event) => saveRow({ ...row, manual_loaded_miles: event.target.value })}
                                />
                              </td>
                              <td className="action-cell">
                                <button className="secondary-button" type="button" onClick={() => smartFillRow(row)} disabled={smartFillId === row.id || savingId === row.id || fleetLoading || !fleetVehicles.length}>
                                  {smartFillId === row.id ? "Planning..." : "Smart Fill"}
                                </button>
                              </td>
                              <td className="action-cell">
                                <button className="delete-button" onClick={() => deleteRow(row.id)}>
                                  Delete
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan="34" className="empty-state-cell">
                            {gridLoading ? "Loading data..." : "No loads yet."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "chat"}>
            <TeamChat token={token} user={user} active={activeWorkspace === "chat"} />
          </section>

          <section className="workspace-content-stack workspace-tab-panel" hidden={activeWorkspace !== "settings"}>
            <section className="settings-grid">
              <article className="panel settings-panel-card">
                <div className="panel-head">
                  <h2>Theme</h2>
                  <span>Choose the look.</span>
                </div>
                <div className="theme-option-grid">
                  {themeOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`theme-option-card ${theme === option.id ? "active" : ""}`}
                      onClick={() => setTheme(option.id)}
                    >
                      <span className={`theme-option-swatch theme-option-swatch-${option.id}`} />
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                      <em>{option.accent}</em>
                    </button>
                  ))}
                </div>
              </article>

              <article className="panel settings-panel-card">
                <div className="panel-head">
                  <h2>Workspace State</h2>
                  <span>Current workspace</span>
                </div>
                <div className="settings-summary-list">
                  <div>
                    <span>Selected theme</span>
                    <strong>{themeOptions.find((option) => option.id === theme)?.label || "Luxe Light"}</strong>
                  </div>
                  <div>
                    <span>Saved in browser</span>
                    <strong>Yes</strong>
                  </div>
                  <div>
                    <span>Official station mode</span>
                    <strong>Active</strong>
                  </div>
                  <div>
                    <span>Frontend status</span>
                    <strong>Fuel Service mode applied</strong>
                  </div>
                </div>
              </article>
            </section>
          </section>
        </section>
      </main>

      <InstallAppButton />
      {sitePanel ? <SiteDialog panel={sitePanels[sitePanel]} onClose={() => setSitePanel("")} /> : null}
    </div>
  );
}
