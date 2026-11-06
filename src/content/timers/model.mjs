// Live timers use timestamps; persisted snapshots are paused and exclude offline time.
export function createTimer(id) {
  return { id, mode: "up", phase: "idle", initialMs: 0, valueMs: 0, startedAt: null };
}

export function normalizeTimers(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.slice(0, 100).flatMap(raw => {
    if (!raw || typeof raw.id !== "string" || !/^[\w-]{1,80}$/.test(raw.id) || ids.has(raw.id)) return [];
    ids.add(raw.id);
    const timer = createTimer(raw.id);
    timer.mode = raw.mode === "down" ? "down" : "up";
    timer.phase = ["running", "paused", "stopped"].includes(raw.phase) ? raw.phase : "idle";
    for (const key of ["initialMs", "valueMs"]) {
      timer[key] = Number.isFinite(raw[key]) && raw[key] >= 0 ? raw[key] : 0;
    }
    timer.startedAt = Number.isFinite(raw.startedAt) && raw.startedAt >= 0 ? raw.startedAt : null;
    if (timer.phase === "running" && timer.startedAt === null) timer.phase = "paused";
    return [timer];
  });
}

export function timerValue(timer, now = Date.now()) {
  const elapsed = timer.phase === "running" ? Math.max(0, now - timer.startedAt) : 0;
  return Math.max(0, timer.valueMs + (timer.mode === "down" ? -elapsed : elapsed));
}

export function snapshotTimers(timers, now = Date.now()) {
  return normalizeTimers(timers).map(timer => timer.phase === "running"
    ? changeTimer(timer, timerFinished(timer, now) ? "stop" : "pause", now) : timer);
}

export function restoreTimers(timers) {
  // Never apply a persisted running timestamp to time spent outside the app.
  return normalizeTimers(timers).map(timer => timer.phase === "running"
    ? { ...timer, phase: "paused", startedAt: null } : timer);
}

export function timerFinished(timer, now = Date.now()) {
  return timer.mode === "down" && timer.phase === "running" && timerValue(timer, now) === 0;
}

export function formatTimerTime(ms, mode = "up") {
  const seconds = mode === "down" ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
}

const MAX_TIMER_SECONDS = 1000 * 3600 - 1;

// Lenient entry: "" = 0, "5:00", "1:30:00", "25m", "1h 30m", "90s"; bare digits fill from the right (500 = 5:00).
export function parseTimerTime(text) {
  const value = String(text ?? "").trim().toLowerCase().replace(/,/g, ".");
  if (!value) return 0;
  let seconds;
  if (/[a-z]/.test(value)) {
    const match = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?|s)?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?|s)?)?)?$/.exec(value);
    if (!match) return null;
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  } else if (/^\d+$/.test(value)) {
    const digits = value.replace(/^0+(?=\d)/, "").padStart(6, "0");
    seconds = Number(digits.slice(0, -4)) * 3600 + Number(digits.slice(-4, -2)) * 60 + Number(digits.slice(-2));
  } else {
    const parts = value.split(":");
    if (parts.length > 3 || parts.some(part => !/^\d+$/.test(part))) return null;
    seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  }
  seconds = Math.round(seconds);
  return Number.isFinite(seconds) && seconds <= MAX_TIMER_SECONDS ? seconds * 1000 : null;
}

export function timerAtStart(timer) {
  return timer.phase === "idle" && timer.valueMs === timer.initialMs;
}

export function changeTimer(timer, action, now = Date.now(), settings = {}) {
  const valueMs = timerValue(timer, now);
  if (action === "start") {
    if (timer.phase === "running" && !timerFinished(timer, now)) return timer;
    const start = timer.phase === "stopped" || timerFinished(timer, now) ? timer.initialMs : valueMs;
    if (timer.mode === "down" && start <= 0) return timer;
    return { ...timer, valueMs: start, startedAt: now, phase: "running" };
  }
  if (action === "pause" || action === "stop") {
    return { ...timer, valueMs, startedAt: null, phase: action === "pause" ? "paused" : "stopped" };
  }
  if (action === "reset") {
    // A second Reset at the starting time clears it to zero.
    const target = timerAtStart(timer) ? 0 : timer.initialMs;
    return { ...timer, initialMs: target, valueMs: target, startedAt: null, phase: "idle" };
  }
  if (action === "adjust") {
    const next = Math.min(MAX_TIMER_SECONDS * 1000, Math.max(0, valueMs + (Number(settings.deltaMs) || 0)));
    if (timer.phase === "running") return { ...timer, valueMs: next, startedAt: now };
    if (timer.phase === "paused") return { ...timer, valueMs: next };
    return { ...timer, initialMs: next, valueMs: next, startedAt: null, phase: "idle" };
  }
  if (action === "configure") {
    const mode = settings.mode === "down" ? "down" : "up";
    if (settings.valueMs === undefined) {
      // Direction change keeps the reading but never moves the Reset target.
      return { ...timer, mode, valueMs, startedAt: null,
        phase: valueMs === timer.initialMs ? "idle" : "paused" };
    }
    const initialMs = settings.valueMs;
    if (!Number.isFinite(initialMs) || initialMs < 0) return timer;
    return { ...timer, mode, initialMs,
      valueMs: initialMs, startedAt: null, phase: "idle" };
  }
  return timer;
}
