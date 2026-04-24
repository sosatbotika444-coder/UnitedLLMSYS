const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
const ACTIVITY_SESSION_KEY = "unitedlane_activity_session_id";
const throttleMap = new Map();

let currentContext = {
  page: "site",
  workspace: "",
};

function trimText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function compactDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(details)
      .slice(0, 12)
      .map(([key, value]) => {
        if (value === null || typeof value === "boolean" || typeof value === "number") {
          return [trimText(key, 64), value];
        }
        if (Array.isArray(value)) {
          return [trimText(key, 64), value.slice(0, 8).map((item) => trimText(item, 80))];
        }
        return [trimText(key, 64), trimText(value, 255)];
      })
      .filter(([key]) => key)
  );
}

function createSessionId() {
  if (typeof window === "undefined") {
    return "server-session";
  }
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export function getActivitySessionId() {
  if (typeof window === "undefined") {
    return "server-session";
  }

  try {
    let sessionId = window.sessionStorage.getItem(ACTIVITY_SESSION_KEY);
    if (!sessionId) {
      sessionId = createSessionId();
      window.sessionStorage.setItem(ACTIVITY_SESSION_KEY, sessionId);
    }
    return sessionId;
  } catch {
    return createSessionId();
  }
}

export function setActivityContext(nextContext = {}) {
  currentContext = {
    page: trimText(nextContext.page || "site", 255) || "site",
    workspace: trimText(nextContext.workspace || "", 80),
  };
}

export function readClickActivityTarget(rawTarget) {
  if (!(rawTarget instanceof Element)) {
    return null;
  }

  const target = rawTarget.closest("button, a, [role='button'], input[type='button'], input[type='submit'], summary, [data-activity-label]");
  if (!target) {
    return null;
  }

  const label = trimText(
    target.getAttribute("data-activity-label")
      || target.getAttribute("aria-label")
      || target.getAttribute("title")
      || target.value
      || target.textContent,
    120
  ).replace(/\s+/g, " ");

  if (!label) {
    return null;
  }

  return {
    label,
    details: compactDetails({
      tag: String(target.tagName || "").toLowerCase(),
      id: target.id || "",
      href: target.tagName === "A" ? target.getAttribute("href") || "" : "",
    }),
  };
}

export async function trackActivity({
  token = "",
  eventType,
  eventName = "",
  page = "",
  workspace = "",
  label = "",
  details = {},
  throttleKey = "",
  throttleMs = 0,
} = {}) {
  const safeEventType = trimText(eventType, 64);
  if (!safeEventType) {
    return;
  }

  const safeThrottleKey = trimText(throttleKey, 160);
  if (safeThrottleKey && throttleMs > 0) {
    const lastSentAt = throttleMap.get(safeThrottleKey) || 0;
    const now = Date.now();
    if (now - lastSentAt < throttleMs) {
      return;
    }
    throttleMap.set(safeThrottleKey, now);
  }

  const payload = {
    sessionId: getActivitySessionId(),
    eventType: safeEventType,
    eventName: trimText(eventName, 120),
    page: trimText(page || currentContext.page, 255),
    workspace: trimText(workspace || currentContext.workspace, 80),
    label: trimText(label, 255),
    details: compactDetails(details),
  };

  const headers = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    await fetch(`${API_URL}/activity/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Activity telemetry should never break the UI.
  }
}
