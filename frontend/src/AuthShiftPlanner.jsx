import { useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://unitedllmsys-production-f470.up.railway.app/api";
export const DEFAULT_SHIFT_PLANNER_STORAGE_KEY = "unitedlane_auth_shift_planner_v1";
const PLANNER_CLOCK_TICK_MS = 1000;
const PLANNER_ALARM_REPEAT_MS = 7000;
const PLANNER_NOTIFICATION_TAG = "unitedlane-planner-alarm";
const PLANNER_NOTIFICATION_ICON = "/pwa-icon-192.png";

async function apiRequest(path, options = {}, token = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Planner request failed");
  }

  return data;
}

function createPlannerId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toLocalInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function readLocalDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function offsetMinutes(minutes) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  return toLocalInputValue(date);
}

function normalizePlannerItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  return {
    id: item.id || createPlannerId(),
    kind: item.kind === "break" ? "break" : "task",
    title: String(item.title || "").trim(),
    notes: String(item.notes || "").trim(),
    startedAt: item.startedAt || new Date().toISOString(),
    dueAt: item.dueAt || "",
    completedAt: item.completedAt || "",
    verifiedAt: item.verifiedAt || "",
    alertedAt: item.alertedAt || "",
  };
}

function readStoredItems(storageKey = DEFAULT_SHIFT_PLANNER_STORAGE_KEY) {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizePlannerItem)
      .filter((item) => item && item.title);
  } catch {
    return [];
  }
}

function toPlannerPayload(item) {
  return {
    kind: item.kind === "break" ? "break" : "task",
    title: String(item.title || "").trim(),
    notes: String(item.notes || "").trim(),
    startedAt: item.startedAt || new Date().toISOString(),
    dueAt: item.dueAt || null,
    completedAt: item.completedAt || null,
    verifiedAt: item.verifiedAt || null,
    alertedAt: item.alertedAt || null,
  };
}

function formatClock(value) {
  const parsed = readLocalDate(value);
  if (!parsed) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatDateTime(value) {
  const parsed = readLocalDate(value);
  if (!parsed) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function minutesAway(targetMs, nowMs) {
  return Math.round((targetMs - nowMs) / 60000);
}

function plannerTone(item, nowMs) {
  const due = readLocalDate(item.dueAt);
  if (item.verifiedAt) return "verified";
  if (item.completedAt) return "review";
  if (due && due.getTime() <= nowMs) return "overdue";
  if (due && due.getTime() - nowMs <= 15 * 60 * 1000) return "soon";
  if (item.kind === "break") return "break";
  return "live";
}

function plannerStatusLabel(item, nowMs) {
  if (item.verifiedAt) {
    return `Verified ${formatClock(item.verifiedAt)}`;
  }
  if (item.completedAt) {
    return `Finished ${formatClock(item.completedAt)} and waiting for verification`;
  }

  const due = readLocalDate(item.dueAt);
  if (!due) {
    return "No planned finish time";
  }

  const diffMinutes = minutesAway(due.getTime(), nowMs);
  if (diffMinutes <= 0) {
    return item.kind === "break" ? "Break time is over" : "Planned work time is over";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} min left`;
  }

  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m left`;
}

function plannerKindLabel(kind) {
  return kind === "break" ? "Break" : "Task";
}

function plannerNoticeLabel(item) {
  if (item.kind === "break") {
    return `Break finished: ${item.title}`;
  }
  return `Scheduled work completed: ${item.title}`;
}

export default function AuthShiftPlanner({
  token = "",
  title = "Planner",
  storageKey = DEFAULT_SHIFT_PLANNER_STORAGE_KEY,
  migrationKeys = [],
}) {
  const [items, setItems] = useState(() => readStoredItems(storageKey));
  const [nowMs, setNowMs] = useState(Date.now());
  const [notice, setNotice] = useState("");
  const [showVerified, setShowVerified] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [activeAlarm, setActiveAlarm] = useState({ ids: [], message: "" });
  const [notificationPermission, setNotificationPermission] = useState(() => (
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported"
  ));
  const [draft, setDraft] = useState(() => ({
    kind: "task",
    title: "",
    dueAt: offsetMinutes(60),
    notes: "",
  }));
  const [remoteSyncing, setRemoteSyncing] = useState(false);
  const [plannerSaving, setPlannerSaving] = useState(false);
  const audioContextRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const titleIntervalRef = useRef(null);
  const baseTitleRef = useRef(typeof document !== "undefined" ? document.title : "");

  useEffect(() => {
    setItems(readStoredItems(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const syncNow = () => setNowMs(Date.now());
    const timer = window.setInterval(syncNow, PLANNER_CLOCK_TICK_MS);
    window.addEventListener("focus", syncNow);
    window.addEventListener("pageshow", syncNow);
    document.addEventListener("visibilitychange", syncNow);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncNow);
      window.removeEventListener("pageshow", syncNow);
      document.removeEventListener("visibilitychange", syncNow);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return undefined;
    }

    const syncPermission = () => setNotificationPermission(Notification.permission);
    syncPermission();
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);
    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(storageKey, JSON.stringify(items));
  }, [items, storageKey]);

  useEffect(() => () => {
    if (alarmIntervalRef.current) {
      window.clearInterval(alarmIntervalRef.current);
    }
    if (titleIntervalRef.current) {
      window.clearInterval(titleIntervalRef.current);
    }
    if (typeof document !== "undefined") {
      document.title = baseTitleRef.current;
    }
  }, []);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    let ignore = false;

    async function loadSavedPlanner() {
      setRemoteSyncing(true);

      const primaryItems = readStoredItems(storageKey);
      const backupItems = primaryItems.length
        ? []
        : migrationKeys.flatMap((key) => readStoredItems(key));

      try {
        let remoteItems = await apiRequest("/planner/items", {}, token);
        remoteItems = Array.isArray(remoteItems)
          ? remoteItems.map(normalizePlannerItem).filter((item) => item && item.title)
          : [];

        if (!remoteItems.length && (primaryItems.length || backupItems.length)) {
          const importSource = primaryItems.length ? primaryItems : backupItems;
          const importedItems = [];
          for (const item of importSource) {
            const saved = await apiRequest(
              "/planner/items",
              {
                method: "POST",
                body: JSON.stringify(toPlannerPayload(item)),
              },
              token
            );
            const normalized = normalizePlannerItem(saved);
            if (normalized?.title) {
              importedItems.push(normalized);
            }
          }
          remoteItems = importedItems;
          if (!ignore && importedItems.length) {
            setNotice("Browser planner was imported into your account.");
          }
        }

        if (!ignore) {
          setItems(remoteItems);
        }
      } catch (loadError) {
        if (!ignore) {
          setNotice(loadError.message || "Saved planner could not load. Using this browser copy.");
        }
      } finally {
        if (!ignore) {
          setRemoteSyncing(false);
        }
      }
    }

    loadSavedPlanner();
    return () => {
      ignore = true;
    };
  }, [migrationKeys, storageKey, token]);

  useEffect(() => {
    const readyToAlert = items.filter((item) => {
      if (item.completedAt || item.verifiedAt || item.alertedAt || !item.dueAt) {
        return false;
      }
      const due = readLocalDate(item.dueAt);
      return due && due.getTime() <= nowMs;
    });

    if (!readyToAlert.length) {
      return;
    }

    const alertedAt = new Date(nowMs).toISOString();
    const readyIds = new Set(readyToAlert.map((item) => item.id));

    setItems((current) => current.map((item) => (
      readyIds.has(item.id) ? { ...item, alertedAt } : item
    )));

    if (token) {
      Promise.all(
        readyToAlert.map((item) => savePlannerItem({ ...item, alertedAt }))
      )
        .then((savedItems) => {
          const savedByPreviousId = new Map(
            savedItems
              .filter((item) => item?.title)
              .map((item, index) => [String(readyToAlert[index]?.id), item])
          );
          if (!savedByPreviousId.size) {
            return;
          }
          setItems((current) => current.map((item) => savedByPreviousId.get(String(item.id)) || item));
        })
        .catch(() => {
          // Keep the inline alarm state even if the background alert sync fails.
        });
    }

    setNotice(readyToAlert.length === 1 ? plannerNoticeLabel(readyToAlert[0]) : `${plannerNoticeLabel(readyToAlert[0])} + ${readyToAlert.length - 1} more`);
    setActiveAlarm({
      ids: readyToAlert.map((item) => item.id),
      message: readyToAlert.length === 1
        ? `${plannerNoticeLabel(readyToAlert[0])}.`
        : `${plannerNoticeLabel(readyToAlert[0])}. Plus ${readyToAlert.length - 1} more overdue item${readyToAlert.length - 1 === 1 ? "" : "s"}.`,
    });

    if ("vibrate" in navigator && typeof navigator.vibrate === "function") {
      navigator.vibrate([220, 120, 220, 120, 420]);
    }

    void ensureAudioReady();
    const firstAlert = readyToAlert[0];
    const notificationTitle = readyToAlert.length === 1
      ? (firstAlert.kind === "break" ? "Break finished" : "Work finished")
      : `Planner alert: ${readyToAlert.length} items due`;
    const notificationBody = readyToAlert.length === 1
      ? `${firstAlert.title} reached the planned end time.`
      : `${firstAlert.title} reached the planned end time. Plus ${readyToAlert.length - 1} more overdue item${readyToAlert.length - 1 === 1 ? "" : "s"}.`;
    void showPlannerNotification(notificationTitle, notificationBody);
  }, [items, nowMs, notificationPermission, token]);

  useEffect(() => {
    if (!activeAlarm.ids.length) {
      if (alarmIntervalRef.current) {
        window.clearInterval(alarmIntervalRef.current);
        alarmIntervalRef.current = null;
      }
      if (titleIntervalRef.current) {
        window.clearInterval(titleIntervalRef.current);
        titleIntervalRef.current = null;
      }
      if (typeof document !== "undefined") {
        document.title = baseTitleRef.current;
      }
      return undefined;
    }

    let flip = false;
    const ring = () => {
      void playAlarmSound({ allowResume: true });
      if ("vibrate" in navigator && typeof navigator.vibrate === "function") {
        navigator.vibrate([180, 80, 180]);
      }
    };

    ring();
    alarmIntervalRef.current = window.setInterval(ring, PLANNER_ALARM_REPEAT_MS);
    titleIntervalRef.current = window.setInterval(() => {
      if (typeof document === "undefined") return;
      flip = !flip;
      document.title = flip ? "Planner alarm" : baseTitleRef.current;
    }, 1200);

    return () => {
      if (alarmIntervalRef.current) {
        window.clearInterval(alarmIntervalRef.current);
        alarmIntervalRef.current = null;
      }
      if (titleIntervalRef.current) {
        window.clearInterval(titleIntervalRef.current);
        titleIntervalRef.current = null;
      }
      if (typeof document !== "undefined") {
        document.title = baseTitleRef.current;
      }
    };
  }, [activeAlarm]);

  const liveItems = useMemo(
    () => [...items]
      .filter((item) => !item.verifiedAt)
      .sort((left, right) => {
        const leftDue = readLocalDate(left.dueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
        const rightDue = readLocalDate(right.dueAt)?.getTime() || Number.MAX_SAFE_INTEGER;
        return leftDue - rightDue;
      }),
    [items]
  );

  const verifiedItems = useMemo(
    () => [...items]
      .filter((item) => item.verifiedAt)
      .sort((left, right) => {
        const leftVerified = readLocalDate(left.verifiedAt)?.getTime() || 0;
        const rightVerified = readLocalDate(right.verifiedAt)?.getTime() || 0;
        return rightVerified - leftVerified;
      }),
    [items]
  );

  const plannerSummary = useMemo(() => {
    const activeItems = liveItems.filter((item) => !item.completedAt);
    const verificationQueue = liveItems.filter((item) => item.completedAt && !item.verifiedAt);
    const plannedBreaks = liveItems.filter((item) => item.kind === "break").length;
    const overdueItems = activeItems.filter((item) => {
      const due = readLocalDate(item.dueAt);
      return due && due.getTime() <= nowMs;
    });
    const nextDueItem = activeItems
      .filter((item) => readLocalDate(item.dueAt))
      .sort((left, right) => readLocalDate(left.dueAt).getTime() - readLocalDate(right.dueAt).getTime())[0] || null;

    return {
      activeCount: activeItems.length,
      verificationCount: verificationQueue.length,
      plannedBreaks,
      overdueCount: overdueItems.length,
      nextDueItem,
    };
  }, [liveItems, nowMs]);

  const notificationAvailable = notificationPermission !== "unsupported";

  async function ensureAudioReady() {
    if (typeof window === "undefined") return false;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return false;

    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContextCtor();
    }

    try {
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }
      const ready = audioContextRef.current.state === "running";
      setSoundReady(ready);
      return ready;
    } catch {
      setSoundReady(false);
      return false;
    }
  }

  function playAlarmPattern(audioContext) {
    const pattern = [0, 0.35, 0.7];
    pattern.forEach((offset, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = index === 2 ? "square" : "sine";
      oscillator.frequency.setValueAtTime(index === 2 ? 980 : 760, audioContext.currentTime + offset);
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, audioContext.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + offset + 0.26);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(audioContext.currentTime + offset);
      oscillator.stop(audioContext.currentTime + offset + 0.28);
    });
  }

  async function playAlarmSound({ allowResume = true } = {}) {
    let audioContext = audioContextRef.current;
    if (!audioContext || audioContext.state === "closed") {
      if (!allowResume) {
        return false;
      }
      const ready = await ensureAudioReady();
      if (!ready) {
        return false;
      }
      audioContext = audioContextRef.current;
    }

    try {
      if (allowResume && audioContext?.state === "suspended") {
        await audioContext.resume();
      }
      if (!audioContext || audioContext.state !== "running") {
        setSoundReady(false);
        return false;
      }
      setSoundReady(true);
      playAlarmPattern(audioContext);
      return true;
    } catch {
      setSoundReady(false);
      return false;
    }
  }

  async function showPlannerNotification(titleText, bodyText) {
    if (typeof window === "undefined" || typeof Notification === "undefined" || notificationPermission !== "granted") {
      return false;
    }

    const options = {
      body: bodyText,
      tag: PLANNER_NOTIFICATION_TAG,
      renotify: true,
      requireInteraction: true,
      icon: PLANNER_NOTIFICATION_ICON,
      badge: PLANNER_NOTIFICATION_ICON,
      data: {
        url: window.location.href,
      },
    };

    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        if (registration?.showNotification) {
          await registration.showNotification(titleText, options);
          return true;
        }
      }
    } catch {
      // Fall through to the regular Notification constructor.
    }

    try {
      const notification = new Notification(titleText, options);
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      return true;
    } catch {
      return false;
    }
  }

  async function primeAlertSystems({ askNotification = false } = {}) {
    await ensureAudioReady();

    if (
      askNotification &&
      notificationAvailable &&
      notificationPermission === "default" &&
      typeof Notification !== "undefined"
    ) {
      try {
        const permission = await Notification.requestPermission();
        setNotificationPermission(permission);
      } catch {
        // Ignore permission errors and keep inline alerts active.
      }
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const unlockSound = () => {
      void ensureAudioReady();
    };

    window.addEventListener("pointerdown", unlockSound, { passive: true });
    window.addEventListener("keydown", unlockSound);
    window.addEventListener("touchstart", unlockSound, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", unlockSound);
      window.removeEventListener("keydown", unlockSound);
      window.removeEventListener("touchstart", unlockSound);
    };
  }, []);

  async function savePlannerItem(item) {
    const payload = toPlannerPayload(item);
    if (!token) {
      return normalizePlannerItem(item);
    }

    const numericId = Number(item.id);
    if (Number.isInteger(numericId) && numericId > 0) {
      const saved = await apiRequest(
        `/planner/items/${numericId}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
        token
      );
      return normalizePlannerItem(saved);
    }

    const saved = await apiRequest(
      "/planner/items",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token
    );
    return normalizePlannerItem(saved);
  }

  async function deletePlannerItem(id) {
    if (!token) {
      return;
    }

    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return;
    }

    await apiRequest(`/planner/items/${numericId}`, { method: "DELETE" }, token);
  }

  function clearAlarmForIds(idsToClear) {
    if (!idsToClear.length) return;
    setActiveAlarm((current) => {
      const remainingIds = current.ids.filter((id) => !idsToClear.includes(id));
      return remainingIds.length ? { ...current, ids: remainingIds } : { ids: [], message: "" };
    });
  }

  function resetDraft(kind = "task", minutes = 60) {
    setDraft({
      kind,
      title: "",
      dueAt: offsetMinutes(minutes),
      notes: "",
    });
  }

  async function addItemToPlanner(nextItem, successMessage) {
    setPlannerSaving(true);
    try {
      const savedItem = await savePlannerItem(nextItem);
      if (!savedItem?.title) {
        throw new Error("Planner item could not be saved.");
      }
      setItems((current) => [savedItem, ...current]);
      setNotice(successMessage);
      return savedItem;
    } catch (saveError) {
      setNotice(saveError.message || "Planner item could not be saved.");
      return null;
    } finally {
      setPlannerSaving(false);
    }
  }

  async function updatePlannerEntry(id, updater, successMessage) {
    const currentItem = items.find((item) => String(item.id) === String(id));
    if (!currentItem) {
      return null;
    }

    const nextItem = normalizePlannerItem({ ...currentItem, ...updater(currentItem) });
    if (!nextItem) {
      return null;
    }

    setPlannerSaving(true);
    try {
      const savedItem = await savePlannerItem(nextItem);
      if (!savedItem?.title) {
        throw new Error("Planner item could not be saved.");
      }
      setItems((current) => current.map((item) => (String(item.id) === String(id) ? savedItem : item)));
      if (successMessage) {
        setNotice(successMessage);
      }
      return savedItem;
    } catch (saveError) {
      setNotice(saveError.message || "Planner item could not be updated.");
      return null;
    } finally {
      setPlannerSaving(false);
    }
  }

  async function addPlannerItem(event) {
    event.preventDefault();
    await primeAlertSystems({ askNotification: true });

    const titleValue = draft.title.trim();
    const due = readLocalDate(draft.dueAt);
    const startedAt = new Date();

    if (!titleValue) {
      setNotice("Write what needs to be done before adding it to the planner.");
      return;
    }

    if (!due || due.getTime() <= startedAt.getTime()) {
      setNotice("Planned finish time must be later than the auto-filled start time.");
      return;
    }

    const nextItem = {
      id: createPlannerId(),
      kind: draft.kind,
      title: titleValue,
      notes: draft.notes.trim(),
      startedAt: startedAt.toISOString(),
      dueAt: due.toISOString(),
      completedAt: "",
      verifiedAt: "",
      alertedAt: "",
    };

    const saved = await addItemToPlanner(nextItem, `${plannerKindLabel(draft.kind)} added. Start time was saved automatically.`);
    if (saved) {
      resetDraft(draft.kind, draft.kind === "break" ? 15 : 60);
    }
  }

  async function quickBreak(minutes) {
    await primeAlertSystems({ askNotification: true });
    const startedAt = new Date();
    const dueAt = new Date(startedAt.getTime() + minutes * 60000);
    const nextItem = {
      id: createPlannerId(),
      kind: "break",
      title: `${minutes} minute break`,
      notes: "Quick break slot",
      startedAt: startedAt.toISOString(),
      dueAt: dueAt.toISOString(),
      completedAt: "",
      verifiedAt: "",
      alertedAt: "",
    };

    await addItemToPlanner(nextItem, `Quick break added for ${minutes} minutes.`);
  }

  async function finishItem(id) {
    const saved = await updatePlannerEntry(
      id,
      () => ({ completedAt: new Date().toISOString() }),
      "Finish time saved. Verify the item to hide it from the live planner."
    );
    if (saved) {
      clearAlarmForIds([id]);
    }
  }

  async function verifyItem(id) {
    const verifiedAt = new Date().toISOString();
    const saved = await updatePlannerEntry(
      id,
      (item) => ({
        completedAt: item.completedAt || verifiedAt,
        verifiedAt,
      }),
      "Item verified and hidden from the live planner."
    );
    if (saved) {
      clearAlarmForIds([id]);
    }
  }

  async function extendItem(id, minutes) {
    const saved = await updatePlannerEntry(
      id,
      (item) => {
        const due = readLocalDate(item.dueAt) || new Date();
        const base = Math.max(due.getTime(), Date.now());
        return {
          dueAt: new Date(base + minutes * 60000).toISOString(),
          alertedAt: "",
        };
      },
      `Planned finish moved by ${minutes} minutes.`
    );
    if (saved) {
      clearAlarmForIds([id]);
    }
  }

  async function removeItem(id) {
    setPlannerSaving(true);
    try {
      await deletePlannerItem(id);
      setItems((current) => current.filter((item) => String(item.id) !== String(id)));
      clearAlarmForIds([id]);
      setNotice("Planner item deleted.");
    } catch (deleteError) {
      setNotice(deleteError.message || "Planner item could not be deleted.");
    } finally {
      setPlannerSaving(false);
    }
  }

  async function requestAlerts() {
    const soundEnabled = await ensureAudioReady();
    if (typeof Notification === "undefined") {
      setNotice("Browser notifications are not available here, but sound and inline planner alarms are active.");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") {
      await showPlannerNotification("Planner alerts enabled", "Planner notifications and alarm sound are ready.");
      if (soundEnabled) {
        await playAlarmSound({ allowResume: true });
      }
      setNotice("Browser alerts and sound are enabled. You will be notified when a planned finish time is reached.");
      return;
    }
    setNotice("Browser alerts were not enabled. Sound and inline planner alerts will still work.");
  }

  const persistenceLabel = token
    ? (remoteSyncing ? "Syncing account planner" : "Saved to account")
    : "Saved in this browser";

  return (
    <section className="auth-shift-planner">
      <div className="auth-shift-planner-head">
        <div className="auth-shift-heading-copy">
          <span className="auth-shift-kicker">{token ? "Account planner" : "Browser planner"}</span>
          <strong>{title}</strong>
          <small>Plan tasks, breaks, and callbacks without losing the page.</small>
        </div>
        <div className="auth-shift-head-actions">
          <small className="auth-shift-alert-state">{persistenceLabel}</small>
          {notificationAvailable ? (
            notificationPermission === "granted" ? (
              <small className="auth-shift-alert-state">Alerts on</small>
            ) : (
              <button type="button" className="secondary-button auth-shift-alert-button" onClick={requestAlerts}>
                Enable alerts + sound
              </button>
            )
          ) : (
            <small className="auth-shift-alert-state">Inline + sound only</small>
          )}
          {soundReady ? <small className="auth-shift-alert-state">Sound ready</small> : null}
          <button type="button" className="secondary-button" onClick={() => void playAlarmSound({ allowResume: true })}>
            Test sound
          </button>
          <button type="button" className="secondary-button" onClick={() => setShowVerified((current) => !current)}>
            {showVerified ? "Hide archive" : `Archive (${verifiedItems.length})`}
          </button>
        </div>
      </div>

      <div className="auth-shift-topline">
        <span className="auth-shift-chip">{plannerSummary.activeCount} active</span>
        <span className="auth-shift-chip">{plannerSummary.verificationCount} to verify</span>
        <span className="auth-shift-chip">{plannerSummary.plannedBreaks} breaks</span>
        <span className="auth-shift-chip">
          {plannerSummary.nextDueItem ? `Next ${formatClock(plannerSummary.nextDueItem.dueAt)}` : "No deadline"}
        </span>
      </div>

      {notice ? <div className="notice info auth-shift-notice">{notice}</div> : null}
      {plannerSummary.overdueCount ? (
        <div className="notice error auth-shift-notice">There {plannerSummary.overdueCount === 1 ? "is" : "are"} {plannerSummary.overdueCount} overdue planner item{plannerSummary.overdueCount === 1 ? "" : "s"}.</div>
      ) : null}
      {activeAlarm.ids.length ? (
        <div className="auth-shift-alarm-banner" role="alert" aria-live="assertive">
          <div>
            <strong>Alarm is active</strong>
            <span>{activeAlarm.message}</span>
          </div>
          <button type="button" className="primary-button" onClick={() => setActiveAlarm({ ids: [], message: "" })}>
            Stop alarm
          </button>
        </div>
      ) : null}

      <section className="auth-shift-surface-card auth-shift-composer-card">
        <div className="auth-shift-section-head">
          <div>
            <strong>Add a task or break</strong>
            <small>Start time is saved automatically. Use presets when you need a quick reminder.</small>
          </div>
        </div>

        <form className="auth-shift-form" onSubmit={addPlannerItem}>
          <div className="auth-shift-form-grid auth-shift-form-grid-compact">
            <label className="auth-shift-field auth-shift-field-type">
              <span>Type</span>
              <select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value }))}>
                <option value="task">Task</option>
                <option value="break">Break</option>
              </select>
            </label>
            <label className="auth-shift-field auth-shift-title-field">
              <span>What needs to be done</span>
              <input
                type="text"
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder={draft.kind === "break" ? "Break reason" : "Load follow-up, broker call, check tracking"}
              />
            </label>
            <label className="auth-shift-field auth-shift-field-due">
              <span>Planned finish</span>
              <input
                type="datetime-local"
                value={draft.dueAt}
                onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
              />
            </label>
            <button type="submit" className="primary-button auth-shift-add-button" disabled={plannerSaving}>
              {plannerSaving ? "Saving..." : "Add item"}
            </button>
          </div>

          <div className="auth-shift-quick-actions auth-shift-quick-actions-compact">
            <div className="auth-shift-quick-group compact">
              <span>Time presets</span>
              <div>
                <button type="button" className="secondary-button auth-shift-quick-button" onClick={() => setDraft((current) => ({ ...current, dueAt: offsetMinutes(15) }))}>15m</button>
                <button type="button" className="secondary-button auth-shift-quick-button" onClick={() => setDraft((current) => ({ ...current, dueAt: offsetMinutes(30) }))}>30m</button>
                <button type="button" className="secondary-button auth-shift-quick-button" onClick={() => setDraft((current) => ({ ...current, dueAt: offsetMinutes(60) }))}>1h</button>
                <button type="button" className="secondary-button auth-shift-quick-button" onClick={() => setDraft((current) => ({ ...current, dueAt: offsetMinutes(120) }))}>2h</button>
              </div>
            </div>

            <div className="auth-shift-quick-group compact">
              <span>Quick breaks</span>
              <div>
                <button type="button" className="secondary-button auth-shift-quick-button" onClick={() => quickBreak(15)} disabled={plannerSaving}>Break 15m</button>
                <button type="button" className="secondary-button auth-shift-quick-button" onClick={() => quickBreak(30)} disabled={plannerSaving}>Break 30m</button>
                <button type="button" className="secondary-button auth-shift-quick-button" onClick={() => quickBreak(45)} disabled={plannerSaving}>Break 45m</button>
              </div>
            </div>
          </div>
        </form>
      </section>

      <section className="auth-shift-surface-card auth-shift-live-card">
        <div className="auth-shift-list-head compact">
          <div>
            <strong>Live queue</strong>
            <small>{remoteSyncing && !items.length ? "Loading saved planner" : liveItems.length ? "Current tasks and breaks" : "Planner is clear"}</small>
          </div>
        </div>

        {liveItems.length ? (
          <div className="auth-shift-list">
            {liveItems.map((item) => {
              const tone = plannerTone(item, nowMs);
              return (
                <article key={item.id} className={`auth-shift-item auth-shift-item-${tone}`.trim()}>
                  <div className="auth-shift-item-head">
                    <div>
                      <span className={`auth-shift-kind auth-shift-kind-${item.kind}`}>{plannerKindLabel(item.kind)}</span>
                      <strong>{item.title}</strong>
                      <small>{plannerStatusLabel(item, nowMs)}</small>
                    </div>
                  </div>

                  <div className="auth-shift-item-meta">
                    <span>Start {formatClock(item.startedAt)}</span>
                    <span>Due {formatClock(item.dueAt)}</span>
                    {item.completedAt ? <span>Finished {formatClock(item.completedAt)}</span> : null}
                  </div>

                  <div className="auth-shift-item-actions">
                    {!item.completedAt ? (
                      <button type="button" className="primary-button" onClick={() => finishItem(item.id)} disabled={plannerSaving}>
                        Finish now
                      </button>
                    ) : null}
                    {!item.verifiedAt ? (
                      <button type="button" className="secondary-button" onClick={() => verifyItem(item.id)} disabled={plannerSaving}>
                        Verify & hide
                      </button>
                    ) : null}
                    {!item.verifiedAt ? (
                      <button type="button" className="secondary-button" onClick={() => extendItem(item.id, 10)} disabled={plannerSaving}>
                        +10 min
                      </button>
                    ) : null}
                    <button type="button" className="secondary-button" onClick={() => removeItem(item.id)} disabled={plannerSaving}>
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-route-card compact">
            {remoteSyncing ? "Loading your saved planner..." : "Planner is clear. Add work items or breaks, then verify them when the shift step is done."}
          </div>
        )}
      </section>

      {showVerified && verifiedItems.length ? (
        <section className="auth-shift-surface-card auth-shift-archive">
          <div className="auth-shift-list-head compact">
            <div>
              <strong>Verified archive</strong>
              <small>Hidden from the live planner after verification.</small>
            </div>
          </div>

          <div className="auth-shift-list">
            {verifiedItems.map((item) => (
              <article key={`verified-${item.id}`} className="auth-shift-item auth-shift-item-verified">
                <div className="auth-shift-item-head">
                  <div>
                    <span className={`auth-shift-kind auth-shift-kind-${item.kind}`}>{plannerKindLabel(item.kind)}</span>
                    <strong>{item.title}</strong>
                    <small>Verified {formatDateTime(item.verifiedAt)}</small>
                  </div>
                  <div className="auth-shift-item-meta">
                    <span>Started {formatClock(item.startedAt)}</span>
                    <span>Finished {formatClock(item.completedAt)}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
