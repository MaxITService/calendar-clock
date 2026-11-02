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

export function parseTimerTime(text) {
  const match = /^(\d{1,6}):([0-5]\d):([0-5]\d)$/.exec(String(text).trim());
  return match ? (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 : null;
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
  if (action === "reset") return { ...timer, valueMs: timer.initialMs, startedAt: null, phase: "idle" };
  if (action === "configure") {
    const initialMs = settings.valueMs ?? valueMs;
    if (!Number.isFinite(initialMs) || initialMs < 0) return timer;
    return { ...timer, mode: settings.mode === "down" ? "down" : "up", initialMs,
      valueMs: initialMs, startedAt: null, phase: "idle" };
  }
  return timer;
}
