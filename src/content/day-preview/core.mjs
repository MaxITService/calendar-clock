const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MINUTES = 24 * 60;

export function parseDateKey(value) {
  const match = DATE_KEY_PATTERN.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year
      || candidate.getUTCMonth() !== month - 1
      || candidate.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function formatDateKey(parts) {
  if (!parts) return "";
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
}

export function addCivilDays(dateKey, amount) {
  const parts = parseDateKey(dateKey);
  const days = Number(amount);
  if (!parts || !Number.isInteger(days)) return "";
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatDateKey({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  });
}

export function dateKeyForInstant(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const values = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date).forEach(part => {
      if (part.type !== "literal") values[part.type] = part.value;
    });
    return parseDateKey(`${values.year}-${values.month}-${values.day}`)
      ? `${values.year}-${values.month}-${values.day}`
      : "";
  } catch (_error) {
    return "";
  }
}

export function createDayPreviewState({ getTodayDateKey, now = () => new Date() } = {}) {
  if (typeof getTodayDateKey !== "function") {
    throw new TypeError("Day Preview requires a current civil-date provider.");
  }
  let selectedDateKey = null;
  let phase = "idle";
  let reason = "";

  function getToday() {
    const key = getTodayDateKey(now());
    if (!parseDateKey(key)) throw new Error("Day Preview could not resolve Today.");
    return key;
  }

  function select(dateKey) {
    const normalized = parseDateKey(dateKey) ? String(dateKey) : "";
    if (!normalized) return false;
    selectedDateKey = normalized === getToday() ? null : normalized;
    phase = "idle";
    reason = "";
    return true;
  }

  function move(days) {
    const target = addCivilDays(selectedDateKey || getToday(), days);
    return target ? select(target) : false;
  }

  function snapshot() {
    const todayDateKey = getToday();
    const dateKey = selectedDateKey || todayDateKey;
    return Object.freeze({
      selectedDateKey,
      dateKey,
      todayDateKey,
      active: dateKey !== todayDateKey,
      phase,
      reason
    });
  }

  return Object.freeze({
    previous: () => move(-1),
    next: () => move(1),
    today: () => {
      selectedDateKey = null;
      phase = "idle";
      reason = "";
      return true;
    },
    select,
    setStatus(nextPhase, nextReason = "") {
      phase = ["idle", "loading", "ready", "unavailable"].includes(nextPhase)
        ? nextPhase
        : "unavailable";
      reason = String(nextReason || "").slice(0, 240);
    },
    snapshot
  });
}

function splitWindowMinute(value) {
  const totalMinutes = Math.round(Number(value));
  if (!Number.isFinite(totalMinutes)) return null;
  const dayOffset = Math.floor(totalMinutes / DAY_MINUTES);
  const minuteOfDay = ((totalMinutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return {
    dayOffset,
    time: `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`
  };
}

export function buildCivilWindow(dateKey, startMinutes, durationMinutes) {
  if (!parseDateKey(dateKey)) return null;
  const start = splitWindowMinute(startMinutes);
  const duration = Math.round(Number(durationMinutes));
  if (!start || !Number.isFinite(duration) || duration <= 0) return null;
  const end = splitWindowMinute(Number(startMinutes) + duration);
  if (!end) return null;
  return Object.freeze({
    startDateKey: addCivilDays(dateKey, start.dayOffset),
    startTime: start.time,
    endDateKey: addCivilDays(dateKey, end.dayOffset),
    endTime: end.time,
    durationMinutes: duration
  });
}

function civilDayDifference(leftDateKey, rightDateKey) {
  const left = parseDateKey(leftDateKey);
  const right = parseDateKey(rightDateKey);
  if (!left || !right) return null;
  return Math.round((
    Date.UTC(left.year, left.month - 1, left.day)
    - Date.UTC(right.year, right.month - 1, right.day)
  ) / (24 * 60 * 60 * 1000));
}

export function getRelativeDayLabel(dateKey, todayDateKey) {
  const difference = civilDayDifference(dateKey, todayDateKey);
  if (difference === -1) return "Yesterday";
  if (difference === 0) return "Today";
  if (difference === 1) return "Tomorrow";
  return "";
}

function formatCivilDate(dateKey, locale, options) {
  const parts = parseDateKey(dateKey);
  if (!parts) return "";
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      ...options,
      timeZone: "UTC"
    }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
  } catch (_error) {
    return dateKey;
  }
}

export function getDayPreviewPresentation(snapshot, locale) {
  const state = snapshot || {};
  const active = state.active === true;
  const relativeLabel = getRelativeDayLabel(state.dateKey, state.todayDateKey);
  const fullDate = formatCivilDate(state.dateKey, locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const shortDate = formatCivilDate(state.dateKey, locale, {
    day: "numeric",
    month: "short"
  });
  return Object.freeze({
    hidden: !active,
    relativeLabel,
    fullDate,
    shortDate,
    fullTitle: active ? "DAY PREVIEW" : "",
    miniText: active
      ? [relativeLabel && relativeLabel !== "Today" ? relativeLabel : "", shortDate].filter(Boolean).join(" · ")
      : ""
  });
}

export function shouldAcceptPreviewEvents(snapshot, payloadDateKey = "") {
  const state = snapshot || {};
  if (state.phase === "loading" || state.phase === "unavailable") return false;
  if (state.active !== true) return true;
  return state.phase === "ready" && String(payloadDateKey || "") === state.dateKey;
}

export function shouldAllowTimeDrivenEffects(snapshot) {
  return snapshot?.active !== true
    && !["loading", "unavailable"].includes(snapshot?.phase);
}
