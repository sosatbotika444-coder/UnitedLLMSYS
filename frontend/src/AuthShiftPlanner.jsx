import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "unitedlane_auth_shift_planner_v1";

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

function readStoredItems() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: item.id || createPlannerId(),
        kind: item.kind === "break" ? "break" : "task",
        title: String(item.title || "").trim(),
        notes: String(item.notes || "").trim(),
        startedAt: item.startedAt || new Date().toISOString(),
        dueAt: item.dueAt || "",
        completedAt: item.completedAt || "",
        verifiedAt: item.verifiedAt || "",
        alertedAt: item.alertedAt || "",
      }))
      .filter((item) => item.title);
  } catch {
    return [];
  }
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

export default function AuthShiftPlanner() {
  const [items, setItems] = useState(readStoredItems);
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
  const audioContextRef = useRef(null);
  const alarmIntervalRef = useRef(null);
  const titleIntervalRef = useRef(null);
  const baseTitleRef = useRef(typeof document !== "undefined" ? document.title : "");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

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

    if (notificationPermission === "granted" && typeof Notification !== "undefined") {
      readyToAlert.slice(0, 3).forEach((item) => {
        try {
          new Notification(item.kind === "break" ? "Break finished" : "Work finished", {
            body: `${item.title} reached the planned end time.`,
          });
        } catch {
          // Ignore notification errors and keep the inline notice.
        }
      });
    }
  }, [items, nowMs, notificationPermission]);

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
      playAlarmSound();
      if ("vibrate" in navigator && typeof navigator.vibrate === "function") {
        navigator.vibrate([180, 80, 180]);
      }
    };

    ring();
    alarmIntervalRef.current = window.setInterval(ring, 7000);
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

    if (!audioContextRef.current) {
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

  function playAlarmSound() {
    const audioContext = audioContextRef.current;
    if (!audioContext || audioContext.state !== "running") {
      return;
    }

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

  async function addPlannerItem(event) {
    event.preventDefault();
    await primeAlertSystems({ askNotification: true });

    const title = draft.title.trim();
    const due = readLocalDate(draft.dueAt);
    const startedAt = new Date();

    if (!title) {
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
      title,
      notes: draft.notes.trim(),
      startedAt: startedAt.toISOString(),
      dueAt: due.toISOString(),
      completedAt: "",
      verifiedAt: "",
      alertedAt: "",
    };

    setItems((current) => [nextItem, ...current]);
    setNotice(`${plannerKindLabel(draft.kind)} added. Start time was saved automatically.`);
    resetDraft(draft.kind, draft.kind === "break" ? 15 : 60);
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

    setItems((current) => [nextItem, ...current]);
    setNotice(`Quick break added for ${minutes} minutes.`);
  }

  function patchItem(id, updater) {
    setItems((current) => current.map((item) => (
      item.id === id ? { ...item, ...updater(item) } : item
    )));
  }

  function finishItem(id) {
    const completedAt = new Date().toISOString();
    patchItem(id, () => ({ completedAt }));
    clearAlarmForIds([id]);
    setNotice("Finish time saved. Verify the item to hide it from the live planner.");
  }

  function verifyItem(id) {
    const verifiedAt = new Date().toISOString();
    patchItem(id, (item) => ({
      completedAt: item.completedAt || verifiedAt,
      verifiedAt,
    }));
    clearAlarmForIds([id]);
    setNotice("Item verified and hidden from the live planner.");
  }

  function extendItem(id, minutes) {
    patchItem(id, (item) => {
      const due = readLocalDate(item.dueAt) || new Date();
      const base = Math.max(due.getTime(), Date.now());
      return {
        dueAt: new Date(base + minutes * 60000).toISOString(),
        alertedAt: "",
      };
    });
    clearAlarmForIds([id]);
    setNotice(`Planned finish moved by ${minutes} minutes.`);
  }

  function removeItem(id) {
    setItems((current) => current.filter((item) => item.id !== id));
    clearAlarmForIds([id]);
  }

  async function requestAlerts() {
    await ensureAudioReady();
    if (typeof Notification === "undefined") {
      setNotice("Browser notifications are not available here, but sound and inline planner alarms are active.");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === "granted") {
      setNotice("Browser alerts and sound are enabled. You will be notified when a planned finish time is reached.");
      return;
    }
    setNotice("Browser alerts were not enabled. Sound and inline planner alerts will still work.");
  }

  return (
    <section className="auth-shift-planner">
      <div className="auth-shift-planner-head">
        <strong>Planner</strong>
        <div className="auth-shift-head-actions">
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

      <form className="auth-shift-form" onSubmit={addPlannerItem}>
        <div className="auth-shift-form-grid auth-shift-form-grid-compact">
          <label>
            Type
            <select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value }))}>
              <option value="task">Task</option>
              <option value="break">Break</option>
            </select>
          </label>
          <label className="auth-shift-title-field">
            What needs to be done
            <input
              type="text"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder={draft.kind === "break" ? "Break reason" : "Load follow-up, broker call, check tracking"}
            />
          </label>
          <label>
            Planned finish
            <input
              type="datetime-local"
              value={draft.dueAt}
              onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
            />
          </label>
          <button type="submit" className="primary-button auth-shift-add-button">Add</button>
        </div>

        <div className="auth-shift-quick-actions auth-shift-quick-actions-compact">
          <div className="auth-shift-quick-group compact">
            <span>Time</span>
            <div>
              <button type="button" className="secondary-button" onClick={() => setDraft((current) => ({ ...current, dueAt: offsetMinutes(15) }))}>15m</button>
              <button type="button" className="secondary-button" onClick={() => setDraft((current) => ({ ...current, dueAt: offsetMinutes(30) }))}>30m</button>
              <button type="button" className="secondary-button" onClick={() => setDraft((current) => ({ ...current, dueAt: offsetMinutes(60) }))}>1h</button>
              <button type="button" className="secondary-button" onClick={() => setDraft((current) => ({ ...current, dueAt: offsetMinutes(120) }))}>2h</button>
            </div>
          </div>

          <div className="auth-shift-quick-group compact">
            <span>Breaks</span>
            <div>
              <button type="button" className="secondary-button" onClick={() => quickBreak(15)}>Break 15m</button>
              <button type="button" className="secondary-button" onClick={() => quickBreak(30)}>Break 30m</button>
              <button type="button" className="secondary-button" onClick={() => quickBreak(45)}>Break 45m</button>
            </div>
          </div>
        </div>
      </form>

      <div className="auth-shift-list-head compact">
        <div>
          <strong>Live</strong>
          <small>{liveItems.length ? "Current tasks and breaks" : "Planner is clear"}</small>
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
                    <button type="button" className="primary-button" onClick={() => finishItem(item.id)}>
                      Finish now
                    </button>
                  ) : null}
                  {!item.verifiedAt ? (
                    <button type="button" className="secondary-button" onClick={() => verifyItem(item.id)}>
                      Verify & hide
                    </button>
                  ) : null}
                  {!item.verifiedAt ? (
                    <button type="button" className="secondary-button" onClick={() => extendItem(item.id, 10)}>
                      +10 min
                    </button>
                  ) : null}
                  <button type="button" className="secondary-button" onClick={() => removeItem(item.id)}>
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-route-card compact">Planner is clear. Add work items or breaks, then verify them when the shift step is done.</div>
      )}

      {showVerified && verifiedItems.length ? (
        <div className="auth-shift-archive">
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
        </div>
      ) : null}
    </section>
  );
}
