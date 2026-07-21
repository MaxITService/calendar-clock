// Calculates the visible time window and applies fit-now, jump, and follow-now behavior.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseClockMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesBetween(start, end) {
  let duration = end - start;
  if (duration <= 0) duration += 24 * 60;
  return duration;
}

const CALENDAR_CLOCK_FOLLOW_WINDOW_MINUTES = 12 * 60;
const CALENDAR_CLOCK_RADIAL_FOLLOW_WINDOW_MINUTES = 24 * 60;
const CALENDAR_CLOCK_TRUSTED_CAPTURE_DATE_KEY_SOURCES = new Set(["dated-url", "visible-dom"]);

function parseCalendarBaseDateFromUrl() {
  const match = location.pathname.match(/\/r\/(?:day|week|month|customday|customweek)\/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = makeCalendarDate(year, month, day);

  return !date || Number.isNaN(date.getTime()) ? null : date;
}

function parseCalendarBaseDateFromTitle() {
  if (typeof parseCalendarEventDate !== "function") return null;

  const date = parseCalendarEventDate(document.title);
  if (!date || Number.isNaN(date.getTime())) return null;
  return date;
}

function getCalendarViewMode() {
  const match = location.pathname.match(/\/r\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]).toLowerCase() : "";
}

function getCurrentDayDate() {
  const parts = getCalendarClockZonedParts(new Date());
  if (!parts) return new Date(NaN);
  return makeCalendarDate(parts.year, parts.month - 1, parts.day) || new Date(NaN);
}

function addLocalDays(date, days) {
  return date && !Number.isNaN(date.getTime()) ? addCalendarDateDays(date, days) : new Date(NaN);
}

function getCalendarClockVisibleDateKeysForBaseDate(baseDate, viewMode = getCalendarViewMode()) {
  if (!(baseDate instanceof Date) || Number.isNaN(baseDate.getTime())) return [];

  if (/^(day|customday)$/.test(viewMode)) return [formatLocalDateKey(baseDate)].filter(Boolean);
  if (/^(week|customweek)$/.test(viewMode)) {
    return Array.from({ length: 7 }, (_value, index) => formatLocalDateKey(addLocalDays(baseDate, index))).filter(Boolean);
  }

  return [];
}

function parseCalendarClockDomDateKey(value) {
  const rawValue = String(value || "").trim();
  const compactMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(rawValue);
  const date = compactMatch
    ? makeCalendarDate(Number(compactMatch[1]), Number(compactMatch[2]) - 1, Number(compactMatch[3]))
    : typeof findExplicitCalendarEventDate === "function"
      ? findExplicitCalendarEventDate(rawValue)
      : null;
  return formatLocalDateKey(date);
}

function areCalendarClockDateKeysConsecutive(dateKeys) {
  return dateKeys.every((dateKey, index) => {
    if (index === 0) return true;
    const previousDate = typeof findExplicitCalendarEventDate === "function"
      ? findExplicitCalendarEventDate(dateKeys[index - 1])
      : null;
    return formatLocalDateKey(addLocalDays(previousDate, 1)) === dateKey;
  });
}

function getCalendarClockVisibleDomDateKeys(viewMode = getCalendarViewMode()) {
  const expectedCount = viewMode === "day" ? 1 : viewMode === "week" ? 7 : 0;
  if (!expectedCount) return [];

  const dateKeys = new Set();
  Array.from(document.querySelectorAll("[data-date]")).forEach(node => {
    if (typeof isCalendarClockElementInViewport === "function"
        && typeof node?.getBoundingClientRect === "function"
        && !isCalendarClockElementInViewport(node)) return;
    const dateKey = parseCalendarClockDomDateKey(node?.getAttribute?.("data-date"));
    if (dateKey) dateKeys.add(dateKey);
  });
  const normalized = Array.from(dateKeys).sort();
  return normalized.length === expectedCount && areCalendarClockDateKeysConsecutive(normalized)
    ? normalized
    : [];
}

function getCalendarClockCaptureDateContext() {
  const mode = getCalendarViewMode();
  const urlDate = parseCalendarBaseDateFromUrl();
  const urlDateKeys = getCalendarClockVisibleDateKeysForBaseDate(urlDate, mode);
  const visibleDomDateKeys = getCalendarClockVisibleDomDateKeys(mode);

  if (urlDate) {
    const sourcesAgree = !visibleDomDateKeys.length
      || (urlDateKeys.length === visibleDomDateKeys.length
        && urlDateKeys.every((dateKey, index) => dateKey === visibleDomDateKeys[index]));
    return {
      baseDate: urlDate,
      visibleDateKeys: urlDateKeys,
      dateKeySource: sourcesAgree ? "dated-url" : "source-conflict"
    };
  }

  if (visibleDomDateKeys.length) {
    const baseDate = typeof findExplicitCalendarEventDate === "function"
      ? findExplicitCalendarEventDate(visibleDomDateKeys[0])
      : null;
    return { baseDate, visibleDateKeys: visibleDomDateKeys, dateKeySource: "visible-dom" };
  }

  const titleDate = parseCalendarBaseDateFromTitle();
  if (titleDate) {
    return {
      baseDate: titleDate,
      visibleDateKeys: getCalendarClockVisibleDateKeysForBaseDate(titleDate, mode),
      dateKeySource: "title"
    };
  }

  const today = getCurrentDayDate();
  return {
    baseDate: today,
    visibleDateKeys: getCalendarClockVisibleDateKeysForBaseDate(today, mode),
    dateKeySource: "today-fallback"
  };
}

function isCalendarClockCaptureDateScopeTrusted(captureView) {
  if (!CALENDAR_CLOCK_TRUSTED_CAPTURE_DATE_KEY_SOURCES.has(captureView?.dateKeySource)) return false;
  if (captureView.dateKeySource === "dated-url" && !/^(day|week)$/.test(captureView?.mode || "")) return false;
  return Array.isArray(captureView?.visibleDateKeys) && captureView.visibleDateKeys.length > 0;
}

function getCalendarClockCaptureView() {
  const context = getCalendarClockCaptureDateContext();
  return {
    mode: getCalendarViewMode(),
    baseDate: formatLocalDateKey(context.baseDate),
    visibleDateKeys: context.visibleDateKeys,
    dateKeySource: context.dateKeySource
  };
}

function getDateKeysForDateRange(startDate, endDate) {
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return [];
  }

  const keys = [];
  const timeZone = getCalendarClockTimeZone();
  let cursor = getCalendarClockZonedDayStart(startDate, timeZone);
  while (cursor < endDate) {
    keys.push(formatCalendarClockDateKey(cursor, timeZone));
    cursor = addCalendarClockZonedDays(cursor, 1, timeZone);
  }
  return keys;
}

function getCalendarClockDisplayDateKeys() {
  const { startDate, endDate } = getWindowDateRange();
  return getDateKeysForDateRange(startDate, endDate);
}

function getCalendarEventDateKey(event) {
  if (event?.capturedFrom === "google-tasks-dom") return "";
  return globalThis.calendarClockTemporalProjection?.validateEvent?.(event)
    ? event.temporal.firstDateKey
    : "";
}

function getWindowAnchorDate() {
  return getCurrentDayDate();
}

function getRadialWindowAnchorDate() {
  return getCurrentDayDate();
}

function getFollowWindowMinutes() {
  return calendarClockState.radial24Hour
    ? CALENDAR_CLOCK_RADIAL_FOLLOW_WINDOW_MINUTES
    : CALENDAR_CLOCK_FOLLOW_WINDOW_MINUTES;
}

function getFollowFutureMinutes(value = calendarClockState.followRadiusHours, windowMinutes = getFollowWindowMinutes()) {
  return windowMinutes - clampFollowRadiusHours(value, windowMinutes) * 60;
}

function isManualWindowPreset(preset) {
  return [
    "08:00-20:00",
    "20:00-08:00",
    "00:00-12:00",
    "12:00-00:00",
    "custom"
  ].includes(preset);
}

function rememberManualWindowState() {
  if (!isManualWindowPreset(calendarClockState.windowPreset)) return;

  calendarClockState.manualWindowPreset = calendarClockState.windowPreset;
  calendarClockState.manualWindowStart = calendarClockState.windowStart;
  calendarClockState.manualWindowEnd = calendarClockState.windowEnd;
  calendarClockState.manualCustomWindowStart = calendarClockState.customWindowStart;
}

function restoreManualWindowState(options = {}) {
  const preset = isManualWindowPreset(calendarClockState.manualWindowPreset)
    ? calendarClockState.manualWindowPreset
    : CALENDAR_CLOCK_PANEL_DEFAULT.manualWindowPreset;

  if (preset === "custom") {
    const customStart = formatClockMinutes(clampDividerStartMinutes(
      calendarClockState.manualCustomWindowStart || calendarClockState.customWindowStart
    ));
    calendarClockState.customWindowStart = customStart;
    return setCustomDividerWindow(customStart, options);
  }

  const [presetStart, presetEnd] = preset.split("-");
  const start = parseClockMinutes(presetStart) === null ? CALENDAR_CLOCK_PANEL_DEFAULT.manualWindowStart : presetStart;
  const end = parseClockMinutes(presetEnd) === null ? CALENDAR_CLOCK_PANEL_DEFAULT.manualWindowEnd : presetEnd;
  return setDisplayWindowRange(parseClockMinutes(start), parseClockMinutes(end), preset, options);
}

function getWindowDateRange() {
  if (calendarClockState.radial24Hour) {
    if (calendarClockState.followNow) {
      const now = new Date();
      const pastHours = clampFollowRadiusHours(calendarClockState.followRadiusHours);
      const pastMs = pastHours * 60 * 60 * 1000;
      const futureMs = getFollowFutureMinutes(pastHours, CALENDAR_CLOCK_RADIAL_FOLLOW_WINDOW_MINUTES) * 60 * 1000;
      const startDate = new Date(now.getTime() - pastMs);
      const endDate = new Date(now.getTime() + futureMs);
      return { startDate, endDate };
    }

    const baseDate = getRadialWindowAnchorDate();
    const startDate = makeCalendarClockZonedDate(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate());
    const endDate = makeCalendarClockZonedDate(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate() + 1);
    return { startDate, endDate };
  }

  if (calendarClockState.followNow) {
    const now = new Date();
    const pastHours = clampFollowRadiusHours(calendarClockState.followRadiusHours);
    const futureHours = getFollowFutureHours(pastHours);
    const pastMs = pastHours * 60 * 60 * 1000;
    const futureMs = futureHours * 60 * 60 * 1000;
    return {
      startDate: new Date(now.getTime() - pastMs),
      endDate: new Date(now.getTime() + futureMs)
    };
  }

  const displayWindow = getDisplayWindow();
  const start = displayWindow.start;
  const absoluteEnd = start + displayWindow.duration;
  const end = ((absoluteEnd % (24 * 60)) + 24 * 60) % (24 * 60);
  const endDayOffset = Math.floor(absoluteEnd / (24 * 60));
  const baseDate = getWindowAnchorDate();
  const startDate = makeCalendarClockZonedDate(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate(),
    Math.floor(start / 60),
    start % 60
  );
  const endDate = makeCalendarClockZonedDate(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate() + endDayOffset,
    Math.floor(end / 60),
    end % 60
  );

  return { startDate, endDate };
}

function getWindowDateRangeKey() {
  const { startDate, endDate } = getWindowDateRange();
  return `${startDate.getTime()}-${endDate.getTime()}`;
}

function refreshDateSensitiveWindow() {
  if (calendarClockState.followNow) return false;

  const nextKey = getWindowDateRangeKey();
  if (calendarClockLastWindowDateRangeKey === null) {
    calendarClockLastWindowDateRangeKey = nextKey;
    return false;
  }
  if (calendarClockLastWindowDateRangeKey === nextKey) return false;

  calendarClockLastWindowDateRangeKey = nextKey;
  updatePanelControls();
  syncClockFrame();
  updatePanelStats();
  renderDebugPanel();
  return true;
}

function formatWindowDateTime(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "unavailable";
  try {
    return new Intl.DateTimeFormat(navigator.language || undefined, {
      timeZone: getCalendarClockTimeZone(),
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  } catch (_error) {
    return "unavailable";
  }
}

function getWindowSummaryText() {
  if (calendarClockState.radial24Hour) {
    const { startDate, endDate } = getWindowDateRange();
    const startText = formatWindowDateTime(startDate);
    const endText = formatWindowDateTime(endDate);
    if (calendarClockState.followNow) {
      const futureHours = formatFollowRadiusHours(getFollowFutureHours(calendarClockState.followRadiusHours));
      return `following 24h radial: back ${formatFollowRadiusHours(calendarClockState.followRadiusHours)}h, forward ${futureHours}h until ${endText}, from ${startText}`;
    }
    return `full 24-hour radial day, from ${startText} to ${endText}`;
  }

  const { startDate, endDate } = getWindowDateRange();
  const range = `from ${formatWindowDateTime(startDate)} to ${formatWindowDateTime(endDate)}`;
  if (!calendarClockState.followNow) return range;
  const pastText = formatFollowRadiusHours(calendarClockState.followRadiusHours);
  const startOffsetText = pastText === "0" ? "at now" : `-${pastText}h`;
  return `following window start ${startOffsetText} inside a 12h window, ${range}`;
}

function getDisplayWindow() {
  if (calendarClockState.radial24Hour) {
    if (calendarClockState.followNow) {
      const pastMinutes = clampFollowRadiusHours(calendarClockState.followRadiusHours) * 60;
      const start = getNowMinutes() - pastMinutes;
      return {
        start,
        end: start + CALENDAR_CLOCK_RADIAL_FOLLOW_WINDOW_MINUTES,
        duration: CALENDAR_CLOCK_RADIAL_FOLLOW_WINDOW_MINUTES
      };
    }

    return { start: 0, end: CALENDAR_CLOCK_RADIAL_FOLLOW_WINDOW_MINUTES, duration: CALENDAR_CLOCK_RADIAL_FOLLOW_WINDOW_MINUTES };
  }

  const start = parseClockMinutes(calendarClockState.windowStart);
  const end = parseClockMinutes(calendarClockState.windowEnd);
  if (start === null || end === null || start === end) {
    return { start: 8 * 60, end: 20 * 60, duration: 12 * 60 };
  }
  return { start, end, duration: minutesBetween(start, end) };
}

function parseEventDateRange(event) {
  const temporal = globalThis.calendarClockTemporalProjection;
  if (!temporal?.validateEvent?.(event) || event.temporal.kind === "all-day") return null;
  const startDate = new Date(event.temporal.startInstant);
  const endDate = new Date(event.temporal.endInstant);
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  if (!isPointCalendarEvent(event) && endDate <= startDate) return null;
  if (isPointCalendarEvent(event) && endDate < startDate) return null;
  return { startDate, endDate };
}

function getTodayDateRange() {
  const today = getCurrentDayDate();
  const startDate = makeCalendarClockZonedDate(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const endDate = makeCalendarClockZonedDate(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1);
  return { startDate, endDate };
}

function doesWindowOverlapToday() {
  const { startDate, endDate } = getWindowDateRange();
  const today = getTodayDateRange();
  return endDate > today.startDate && startDate < today.endDate;
}

function isUndatedGoogleTask(event) {
  return event?.capturedFrom === "google-tasks-dom"
    && !event.date
    && !parseEventDateRange(event);
}

function isUndatedGoogleTaskHiddenOutsideToday(event) {
  return isUndatedGoogleTask(event) && !doesWindowOverlapToday();
}

function getUndatedGoogleTaskWindowLabel(event) {
  if (!isUndatedGoogleTask(event)) return "";
  return isUndatedGoogleTaskHiddenOutsideToday(event)
    ? "hidden outside today"
    : "floating task/no date";
}

function isCalendarClockDateParseFailed(event) {
  if (event?.capturedFrom === "google-tasks-dom") return event?.dateParseStatus === "failed";
  return event?.dateParseStatus === "failed"
    || globalThis.calendarClockTemporalProjection?.validateEvent?.(event) !== true;
}

function isPointCalendarEvent(event) {
  return event?.temporal?.kind === "point"
    || (event?.capturedFrom === "google-tasks-dom" && (event?.durationKind === "point" || event?.isPointEvent === true));
}

function isAllDayCalendarEvent(event) {
  return event?.temporal?.kind === "all-day";
}

function getCalendarEventTimeLabel(event) {
  if (isAllDayCalendarEvent(event)) return "All day";
  return isPointCalendarEvent(event)
    ? `${event.start} · time point`
    : `${event.start} - ${event.end}`;
}

function getCalendarClockDateParseFailures(events = calendarClockEvents) {
  return events.filter(isCalendarClockDateParseFailed);
}

function getDateAwareOverlapMinutes(event) {
  if (isCalendarClockDateParseFailed(event)) return 0;
  const { startDate, endDate } = getWindowDateRange();
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  const temporal = globalThis.calendarClockTemporalProjection;
  if (!temporal?.validateEvent?.(event)) return null;
  const dateKeys = getDateKeysForDateRange(startDate, endDate);
  if (!temporal.overlapsInstantRange(event, startDate.toISOString(), endDate.toISOString(), dateKeys)) return 0;
  if (isAllDayCalendarEvent(event)) return Math.max(1, (endDate.getTime() - startDate.getTime()) / (60 * 1000));
  if (isPointCalendarEvent(event)) return 1;
  const eventRange = parseEventDateRange(event);
  const overlapStart = Math.max(eventRange.startDate.getTime(), startDate.getTime());
  const overlapEnd = Math.min(eventRange.endDate.getTime(), endDate.getTime());
  return Math.max(0, (overlapEnd - overlapStart) / (60 * 1000));
}

function getVisibleEventSegment(event, displayWindow = getDisplayWindow()) {
  if (isCalendarClockDateParseFailed(event)) return null;

  const dateAwareOverlap = getDateAwareOverlapMinutes(event);
  if (dateAwareOverlap !== null) return dateAwareOverlap > 0 ? true : null;
  if (isUndatedGoogleTaskHiddenOutsideToday(event)) return null;

  const eventStart = parseClockMinutes(event.start);
  const eventEnd = parseClockMinutes(event.end);
  if (eventStart === null || eventEnd === null) return null;

  if (isPointCalendarEvent(event)) {
    if (displayWindow.duration >= 24 * 60) return true;

    const windowStart = displayWindow.start;
    const windowEnd = windowStart + displayWindow.duration;
    for (const shift of [-24 * 60, 0, 24 * 60]) {
      const shiftedStart = eventStart + shift;
      if (shiftedStart >= windowStart && shiftedStart < windowEnd) return true;
    }

    return null;
  }

  if (displayWindow.duration >= 24 * 60) return true;

  const windowStart = displayWindow.start;
  const windowEnd = windowStart + displayWindow.duration;
  const baseEventEnd = eventEnd <= eventStart ? eventEnd + 24 * 60 : eventEnd;

  for (const shift of [-24 * 60, 0, 24 * 60]) {
    const shiftedStart = eventStart + shift;
    const shiftedEnd = baseEventEnd + shift;
    const overlapStart = Math.max(shiftedStart, windowStart);
    const overlapEnd = Math.min(shiftedEnd, windowEnd);
    if (overlapEnd - overlapStart > 0) return true;
  }

  return null;
}

function getEventOverlapMinutes(event, displayWindow = getDisplayWindow(), options = {}) {
  if (isCalendarClockDateParseFailed(event)) return 0;
  if (isUndatedGoogleTaskHiddenOutsideToday(event)) return 0;

  if (options.useDates !== false) {
    const dateAwareOverlap = getDateAwareOverlapMinutes(event);
    if (dateAwareOverlap !== null) return dateAwareOverlap;
  }

  const eventStart = parseClockMinutes(event.start);
  const eventEnd = parseClockMinutes(event.end);
  if (eventStart === null || eventEnd === null) return 0;

  if (isPointCalendarEvent(event)) {
    if (displayWindow.duration >= 24 * 60) return 1;

    const windowStart = displayWindow.start;
    const windowEnd = windowStart + displayWindow.duration;
    for (const shift of [-24 * 60, 0, 24 * 60]) {
      const shiftedStart = eventStart + shift;
      if (shiftedStart >= windowStart && shiftedStart < windowEnd) return 1;
    }

    return 0;
  }

  if (displayWindow.duration >= 24 * 60) {
    if (eventStart === eventEnd) return 24 * 60;
    return minutesBetween(eventStart, eventEnd);
  }

  const windowStart = displayWindow.start;
  const windowEnd = windowStart + displayWindow.duration;
  const baseEventEnd = eventEnd <= eventStart ? eventEnd + 24 * 60 : eventEnd;
  let bestOverlap = 0;

  for (const shift of [-24 * 60, 0, 24 * 60]) {
    const shiftedStart = eventStart + shift;
    const shiftedEnd = baseEventEnd + shift;
    const overlapStart = Math.max(shiftedStart, windowStart);
    const overlapEnd = Math.min(shiftedEnd, windowEnd);
    bestOverlap = Math.max(bestOverlap, overlapEnd - overlapStart);
  }

  return Math.max(0, bestOverlap);
}

function formatClockMinutes(minutes) {
  const normalized = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function normalizeDividerStartMinutes(minutes) {
  return Math.min(23.5 * 60, Math.max(0, Math.round(minutes / 30) * 30));
}

function clampDividerStartMinutes(value) {
  if (typeof value === "string" && value.includes(":")) {
    const parsedMinutes = parseClockMinutes(value);
    if (parsedMinutes !== null) return normalizeDividerStartMinutes(parsedMinutes);
  }

  const parsedHours = Number(value);
  if (Number.isFinite(parsedHours)) {
    return normalizeDividerStartMinutes(parsedHours * 60);
  }

  return parseClockMinutes(CALENDAR_CLOCK_PANEL_DEFAULT.customWindowStart) ?? 8 * 60;
}

function getCustomWindowStartMinutes() {
  const parsed = parseClockMinutes(calendarClockState.customWindowStart);
  if (parsed !== null) return parsed;

  const windowStart = parseClockMinutes(calendarClockState.windowStart);
  if (windowStart !== null) return windowStart;

  return parseClockMinutes(CALENDAR_CLOCK_PANEL_DEFAULT.customWindowStart) ?? 8 * 60;
}

function setCustomDividerWindow(value, options = {}) {
  const startMinutes = clampDividerStartMinutes(value);
  calendarClockState.customWindowStart = formatClockMinutes(startMinutes);
  return setDisplayWindowRange(
    startMinutes,
    startMinutes + CALENDAR_CLOCK_FOLLOW_WINDOW_MINUTES,
    "custom",
    options
  );
}

function clampFollowRadiusHours(value, windowMinutes = getFollowWindowMinutes()) {
  const parsed = Math.abs(Number(value));
  const maxPastHours = Math.max(0, windowMinutes / 60 - 0.5);
  const fallback = Math.min(maxPastHours, Math.max(0, CALENDAR_CLOCK_PANEL_DEFAULT.followRadiusHours));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maxPastHours, Math.max(0, parsed));
}

function formatFollowRadiusHours(value) {
  const rounded = Math.round(clampFollowRadiusHours(value) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function getFollowFutureHours(value = calendarClockState.followRadiusHours) {
  return Math.max(0.5, getFollowFutureMinutes(value) / 60);
}

function clampPercentLevel(value, fallback = 50) {
  const parsed = Number(value);
  const safeFallback = Number.isFinite(fallback) ? fallback : 50;
  if (!Number.isFinite(parsed)) return Math.min(100, Math.max(0, Math.round(safeFallback)));
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function normalizeCalendarClockCaptureLimit(value) {
  const limit = Math.round(Number(value));
  return CALENDAR_CLOCK_CAPTURE_LIMIT_OPTIONS.includes(limit)
    ? limit
    : CALENDAR_CLOCK_CAPTURE_LIMIT;
}

function clampIntegerRange(value, fallback, min, max) {
  const parsed = Number(value);
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : min;
  const rounded = Number.isFinite(parsed) ? Math.round(parsed) : Math.round(safeFallback);
  return Math.min(max, Math.max(min, rounded));
}

function clampWindowStartMarkerDots(value) {
  return clampIntegerRange(value, CALENDAR_CLOCK_PANEL_DEFAULT.windowStartMarkerDots, 1, 50);
}

function clampWindowStartMarkerWidth(value) {
  return clampIntegerRange(value, CALENDAR_CLOCK_PANEL_DEFAULT.windowStartMarkerWidth, 1, 12);
}

function clampWindowStartMarkerTransparency(value) {
  return clampIntegerRange(value, CALENDAR_CLOCK_PANEL_DEFAULT.windowStartMarkerTransparency, 0, 100);
}

function normalizeWindowStartMarkerStyle(value) {
  return ["subtle", "dots", "line", "strong", "glow", "custom"].includes(value)
    ? value
    : CALENDAR_CLOCK_PANEL_DEFAULT.windowStartMarkerStyle;
}

function normalizeWindowStartMarkerShape(value) {
  return ["dots", "line", "emoji"].includes(value)
    ? value
    : CALENDAR_CLOCK_PANEL_DEFAULT.windowStartMarkerShape;
}

function normalizeWindowStartMarkerEmoji(value) {
  const emoji = String(value || "").trim();
  return emoji || CALENDAR_CLOCK_PANEL_DEFAULT.windowStartMarkerEmoji;
}

function clampEventLabelMinLength(value) {
  return clampIntegerRange(value, CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelMinLength, 3, 20);
}

function clampEventLabelShortenThreshold(value) {
  return clampIntegerRange(value, CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelShortenThreshold, 50, 305);
}

function normalizeEventLabelAnchor(value) {
  return ["center", "start", "end"].includes(value)
    ? value
    : CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelAnchor;
}

function clampEventLabelOpacity(value) {
  return clampIntegerRange(value, CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelOpacity, 10, 100);
}

function clampEventLabelArcDistance(value) {
  return clampIntegerRange(value, CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelArcDistance, 0, 24);
}

function clampEventLabelFontSize(value, fallback = CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeFull) {
  return clampIntegerRange(value, fallback, 8, 36);
}

function getCalendarClockEventLabelFontSizeForMode(mode = calendarClockState.mode) {
  const isMini = mode === "mini";
  const fallback = isMini
    ? CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeMini
    : CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeFull;
  const value = isMini
    ? calendarClockState.eventLabelFontSizeMini
    : calendarClockState.eventLabelFontSizeFull;
  return clampEventLabelFontSize(value, fallback);
}

function normalizeEventLabelFontFamily(value) {
  const text = String(value || "")
    .replace(/[^\w\s"',.-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return text || CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontFamily;
}

function clampMagnifierLensSize(value) {
  return clampIntegerRange(
    value,
    CALENDAR_CLOCK_PANEL_DEFAULT.magnifierLensSize,
    CALENDAR_CLOCK_MAGNIFIER_MIN_SIZE,
    CALENDAR_CLOCK_MAGNIFIER_MAX_SIZE
  );
}

function clampMagnifierAutoIntervalSeconds(value) {
  return clampIntegerRange(
    value,
    CALENDAR_CLOCK_PANEL_DEFAULT.magnifierAutoIntervalSeconds,
    CALENDAR_CLOCK_MAGNIFIER_MIN_INTERVAL_SECONDS,
    CALENDAR_CLOCK_MAGNIFIER_MAX_INTERVAL_SECONDS
  );
}

function getWindowForStart(startMinutes) {
  return {
    start: startMinutes,
    end: startMinutes + 12 * 60,
    duration: 12 * 60
  };
}

function scoreWindow(startMinutes) {
  const displayWindow = getWindowForStart(startMinutes);
  let visibleCount = 0;
  let totalOverlap = 0;

  calendarClockEvents.forEach(event => {
    if (isCalendarClockDateParseFailed(event)) return;

    const overlap = getEventOverlapMinutes(event, displayWindow, { useDates: false });
    if (overlap > 0) visibleCount += 1;
    totalOverlap += overlap;
  });

  return visibleCount * 10000 + totalOverlap;
}

function findBestFitWindowStart() {
  if (!calendarClockEvents.length) return null;

  const candidates = new Set([
    0,
    8 * 60,
    12 * 60,
    20 * 60,
    getNowMinutes() - 2 * 60
  ]);

  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    candidates.add(minutes);
  }

  calendarClockEvents.forEach(event => {
    if (isCalendarClockDateParseFailed(event)) return;

    const start = parseClockMinutes(event.start);
    const end = parseClockMinutes(event.end);
    if (start !== null) {
      candidates.add(start);
      candidates.add(start - 2 * 60);
      candidates.add(start - 4 * 60);
    }
    if (end !== null) candidates.add(end - 12 * 60);
  });

  let bestStart = null;
  let bestScore = -1;
  [...candidates].forEach(candidate => {
    const normalized = ((candidate % (24 * 60)) + 24 * 60) % (24 * 60);
    const score = scoreWindow(normalized);
    if (score > bestScore) {
      bestScore = score;
      bestStart = normalized;
    }
  });

  return bestStart;
}

function firstOutsideEvent() {
  const displayWindow = getDisplayWindow();
  return calendarClockEvents.find(event => !isCalendarClockDateParseFailed(event) && !getVisibleEventSegment(event, displayWindow)) || null;
}

function preferredWindowStartForEvent(event) {
  const eventStart = parseClockMinutes(event?.start);
  if (eventStart === null) return null;

  const presets = [
    { start: 0, end: 12 * 60 },
    { start: 8 * 60, end: 20 * 60 },
    { start: 12 * 60, end: 24 * 60 },
    { start: 20 * 60, end: 8 * 60 }
  ];

  const matchingPreset = presets.find(preset => {
    const window = { start: preset.start, duration: minutesBetween(preset.start, preset.end) };
    return getEventOverlapMinutes(event, window, { useDates: false }) > 0;
  });

  if (matchingPreset) return matchingPreset.start;
  return Math.floor(Math.max(0, eventStart - 2 * 60) / 60) * 60;
}

function setDisplayWindowRange(startMinutes, endMinutes, preset = "generated", options = {}) {
  const start = formatClockMinutes(startMinutes);
  const end = formatClockMinutes(endMinutes);
  const followNow = options.keepFollowNow ? calendarClockState.followNow : false;
  const changed = calendarClockState.windowStart !== start
    || calendarClockState.windowEnd !== end
    || calendarClockState.windowPreset !== preset
    || calendarClockState.followNow !== followNow;

  if (!changed && !options.force) return false;

  calendarClockState.windowStart = start;
  calendarClockState.windowEnd = end;
  calendarClockState.windowPreset = preset;
  calendarClockState.followNow = followNow;
  if (!followNow) rememberManualWindowState();
  persistWindowAndSync({
    skipSave: options.skipSave,
    rebuild: options.rebuild,
    saveDebounceMs: options.saveDebounceMs,
    recapture: options.recapture === true
  });
  return true;
}

function setDisplayWindowFromStart(startMinutes, preset = "generated", options = {}) {
  const durationMinutes = options.durationMinutes || 12 * 60;
  return setDisplayWindowRange(startMinutes, startMinutes + durationMinutes, preset, options);
}

function fitWindowOnce() {
  if (calendarClockState.radial24Hour) return false;

  const bestStart = findBestFitWindowStart();
  if (bestStart === null) return false;
  return setDisplayWindowFromStart(bestStart, "generated", { recapture: true });
}

function applyFollowNowWindow(options = {}) {
  if (!calendarClockState.followNow) return false;

  const durationMinutes = getFollowWindowMinutes();
  const radiusHours = clampFollowRadiusHours(calendarClockState.followRadiusHours, durationMinutes);
  calendarClockState.followRadiusHours = radiusHours;
  const pastMinutes = radiusHours * 60;
  const nowMinutes = getNowMinutes();

  setDisplayWindowRange(
    nowMinutes - pastMinutes,
    nowMinutes - pastMinutes + durationMinutes,
    "generated",
    {
      keepFollowNow: true,
      skipSave: options.skipSave,
      force: options.force,
      saveDebounceMs: options.saveDebounceMs,
      recapture: options.recapture === true
    }
  );
  return true;
}

function jumpToOutsideEventWindow() {
  if (calendarClockState.radial24Hour) return false;

  const event = firstOutsideEvent();
  const start = event ? preferredWindowStartForEvent(event) : findBestFitWindowStart();
  if (start === null) return false;
  setDisplayWindowFromStart(start, "generated", { recapture: true });
  if (event) highlightCalendarEvent(event.id, calendarClockEvents.indexOf(event), true);
  return true;
}

function getNowMinutes() {
  return getCalendarClockNowMinutes();
}

function getCalendarClockDefaultMenuDarkTheme() {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches === true;
  } catch (_error) {
    return false;
  }
}

function getKnownCalendarClockState(savedState = {}) {
  const nextState = { ...CALENDAR_CLOCK_PANEL_DEFAULT };
  Object.keys(CALENDAR_CLOCK_PANEL_DEFAULT).forEach(key => {
    if (Object.prototype.hasOwnProperty.call(savedState, key)) {
      nextState[key] = savedState[key];
    }
  });
  return nextState;
}

function applyLoadedCalendarClockState(savedState = {}) {
  calendarClockState = getKnownCalendarClockState(savedState);
  calendarClockState.followRadiusHours = clampFollowRadiusHours(calendarClockState.followRadiusHours);
  calendarClockState.timePanelOpen = calendarClockState.timePanelOpen !== false;
  calendarClockState.timePanelCollapsed = calendarClockState.timePanelCollapsed === true;
  calendarClockState.debugCollapsed = calendarClockState.debugCollapsed === true;
  calendarClockState.helpCollapsed = calendarClockState.helpCollapsed === true;
  calendarClockTimePanelNeedsInitialSize = (Number(savedState.timePanelInitialSizeVersion) || 0)
    < CALENDAR_CLOCK_TIME_PANEL_INITIAL_SIZE_VERSION;
  calendarClockState.timePanelInitialSizeVersion = calendarClockTimePanelNeedsInitialSize
    ? 0
    : CALENDAR_CLOCK_TIME_PANEL_INITIAL_SIZE_VERSION;
  calendarClockState.menuThemeEdited = calendarClockState.menuThemeEdited === true;
  calendarClockState.menuDarkTheme = calendarClockState.menuThemeEdited
    ? calendarClockState.menuDarkTheme === true
    : getCalendarClockDefaultMenuDarkTheme();
  calendarClockState.clockFaceId = normalizeCalendarClockFaceId(calendarClockState.clockFaceId);
  calendarClockState.consoleLogs = calendarClockState.consoleLogs === true;
  calendarClockState.pageOwnedInfo = calendarClockState.pageOwnedInfo === true;
  calendarClockState.captureLimit = normalizeCalendarClockCaptureLimit(calendarClockState.captureLimit);
  calendarClockState.debugOpen = calendarClockState.debugOpen === true;
  calendarClockState.helpOpen = calendarClockState.helpOpen === true && !calendarClockState.debugOpen;
  if (savedState.eventLabelDefaultVersion !== CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelDefaultVersion) {
    calendarClockState.eventLabelFontSizeFull = CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeFull;
    calendarClockState.eventLabelFontSizeMini = CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeMini;
    calendarClockState.eventLabelShortenThreshold = CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelShortenThreshold;
  }
  calendarClockState.eventLabelDefaultVersion = CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelDefaultVersion;
  calendarClockState.eventLabels = calendarClockState.eventLabels !== false;
  calendarClockState.arcsVisible = calendarClockState.arcsVisible !== false;
  calendarClockState.arcSettingsExpanded = calendarClockState.arcSettingsExpanded === true;
  calendarClockState.windowStartMarker = calendarClockState.windowStartMarker !== false;
  calendarClockState.windowStartMarkerStyle = normalizeWindowStartMarkerStyle(calendarClockState.windowStartMarkerStyle);
  calendarClockState.windowStartMarkerShape = normalizeWindowStartMarkerShape(calendarClockState.windowStartMarkerShape);
  calendarClockState.windowStartMarkerColor = savedState.windowStartMarkerColor || CALENDAR_CLOCK_PANEL_DEFAULT.windowStartMarkerColor;
  calendarClockState.windowStartMarkerWidth = clampWindowStartMarkerWidth(calendarClockState.windowStartMarkerWidth);
  calendarClockState.windowStartMarkerDots = clampWindowStartMarkerDots(calendarClockState.windowStartMarkerDots);
  calendarClockState.windowStartMarkerEmoji = normalizeWindowStartMarkerEmoji(calendarClockState.windowStartMarkerEmoji);
  calendarClockState.windowStartMarkerLabels = calendarClockState.windowStartMarkerLabels === true;
  calendarClockState.windowStartMarkerPulse = calendarClockState.windowStartMarkerPulse !== false;
  calendarClockState.windowStartMarkerTransparency = clampWindowStartMarkerTransparency(calendarClockState.windowStartMarkerTransparency);
  calendarClockState.windowStartMarkerSettingsExpanded = calendarClockState.windowStartMarkerSettingsExpanded === true;
  calendarClockState.eventLabelStyle = ["glass", "ink", "glow", "color", "custom"].includes(calendarClockState.eventLabelStyle)
    ? calendarClockState.eventLabelStyle
    : CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelStyle;
  calendarClockState.eventLabelsSettingsExpanded = calendarClockState.eventLabelsSettingsExpanded === true;
  calendarClockState.eventLabelCustomColor = savedState.eventLabelCustomColor || CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelCustomColor;
  calendarClockState.eventLabelFontFamily = normalizeEventLabelFontFamily(calendarClockState.eventLabelFontFamily);
  calendarClockState.eventLabelFontSizeFull = clampEventLabelFontSize(
    calendarClockState.eventLabelFontSizeFull,
    CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeFull
  );
  calendarClockState.eventLabelFontSizeMini = clampEventLabelFontSize(
    calendarClockState.eventLabelFontSizeMini,
    CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeMini
  );
  calendarClockState.eventLabelProximityPriority = calendarClockState.eventLabelProximityPriority === true;
  calendarClockState.eventLabelMinLength = clampEventLabelMinLength(calendarClockState.eventLabelMinLength);
  calendarClockState.eventLabelShortenThreshold = clampEventLabelShortenThreshold(calendarClockState.eventLabelShortenThreshold);
  calendarClockState.eventLabelAnchor = normalizeEventLabelAnchor(calendarClockState.eventLabelAnchor);
  calendarClockState.eventLabelOpacity = clampEventLabelOpacity(calendarClockState.eventLabelOpacity);
  calendarClockState.eventLabelArcDistance = clampEventLabelArcDistance(calendarClockState.eventLabelArcDistance);
  calendarClockState.magnifierEnabled = calendarClockState.magnifierEnabled !== false;
  calendarClockState.magnifierHoverEnabled = calendarClockState.magnifierHoverEnabled !== false;
  calendarClockState.magnifierCenterCursor = calendarClockState.magnifierCenterCursor === true;
  calendarClockState.magnifierAutoEnabled = calendarClockState.magnifierAutoEnabled !== false;
  calendarClockState.magnifierAutoMinuteHandEnabled = calendarClockState.magnifierAutoMinuteHandEnabled === true;
  calendarClockState.magnifierAutoEventStartEnabled = calendarClockState.magnifierAutoEventStartEnabled === true;
  calendarClockState.magnifierAutoEventStartAttention = calendarClockState.magnifierAutoEventStartAttention === true;
  calendarClockState.magnifierAutoEventEndEnabled = calendarClockState.magnifierAutoEventEndEnabled === true;
  calendarClockState.magnifierAutoEventEndAttention = calendarClockState.magnifierAutoEventEndAttention === true;
  calendarClockState.magnifierLensSize = clampMagnifierLensSize(calendarClockState.magnifierLensSize);
  calendarClockState.magnifierAutoIntervalSeconds = clampMagnifierAutoIntervalSeconds(calendarClockState.magnifierAutoIntervalSeconds);
  calendarClockState.magnifierSettingsExpanded = calendarClockState.magnifierSettingsExpanded === true;
  calendarClockState.customWindowStart = formatClockMinutes(clampDividerStartMinutes(
    calendarClockState.customWindowStart || calendarClockState.windowStart
  ));
  calendarClockState.manualWindowPreset = isManualWindowPreset(calendarClockState.manualWindowPreset)
    ? calendarClockState.manualWindowPreset
    : (isManualWindowPreset(calendarClockState.windowPreset) ? calendarClockState.windowPreset : CALENDAR_CLOCK_PANEL_DEFAULT.manualWindowPreset);
  calendarClockState.manualWindowStart = formatClockMinutes(
    parseClockMinutes(calendarClockState.manualWindowStart) ?? parseClockMinutes(CALENDAR_CLOCK_PANEL_DEFAULT.manualWindowStart)
  );
  calendarClockState.manualWindowEnd = formatClockMinutes(
    parseClockMinutes(calendarClockState.manualWindowEnd) ?? parseClockMinutes(CALENDAR_CLOCK_PANEL_DEFAULT.manualWindowEnd)
  );
  calendarClockState.manualCustomWindowStart = formatClockMinutes(clampDividerStartMinutes(
    calendarClockState.manualCustomWindowStart || calendarClockState.customWindowStart
  ));
  calendarClockState.densityLevel = clampPercentLevel(calendarClockState.densityLevel, CALENDAR_CLOCK_PANEL_DEFAULT.densityLevel);
  calendarClockState.arcThicknessLevel = clampPercentLevel(calendarClockState.arcThicknessLevel, CALENDAR_CLOCK_PANEL_DEFAULT.arcThicknessLevel);
  calendarClockState.arcGapLevel = clampPercentLevel(calendarClockState.arcGapLevel, CALENDAR_CLOCK_PANEL_DEFAULT.arcGapLevel);
  calendarClockState.arcSameLevelNonOverlapping = calendarClockState.arcSameLevelNonOverlapping === true;
  calendarClockState.longDurationArcsVisible = calendarClockState.longDurationArcsVisible !== false;
  const savedArcGapDefaultVersion = Number(savedState.arcGapDefaultVersion) || 0;
  if (savedArcGapDefaultVersion < 3 && [0, 35].includes(calendarClockState.arcGapLevel)) {
    calendarClockState.arcGapLevel = CALENDAR_CLOCK_PANEL_DEFAULT.arcGapLevel;
  }
  if (savedArcGapDefaultVersion < 4 && calendarClockState.arcGapLevel === 10) {
    calendarClockState.arcGapLevel = CALENDAR_CLOCK_PANEL_DEFAULT.arcGapLevel;
  }
  if (Number(calendarClockState.timePanelX) === 24 && Number(calendarClockState.timePanelY) === 170) {
    calendarClockState.timePanelX = null;
    calendarClockState.timePanelY = null;
  }
  if (Number(calendarClockState.timePanelX_full) === 24 && Number(calendarClockState.timePanelY_full) === 170) {
    calendarClockState.timePanelX_full = null;
    calendarClockState.timePanelY_full = null;
  }
  if ((Number(savedState.timePanelSizeVersion) || 0) < CALENDAR_CLOCK_PANEL_DEFAULT.timePanelSizeVersion) {
    calendarClockState.timePanelWidth = null;
    calendarClockState.timePanelHeight = null;
    calendarClockState.timePanelWidth_full = null;
    calendarClockState.timePanelHeight_full = null;
  }
  ["timePanelWidth", "timePanelHeight", "timePanelWidth_full", "timePanelHeight_full"].forEach(key => {
    const dimension = calendarClockState[key];
    calendarClockState[key] = dimension === null || dimension === undefined || dimension === ""
      ? null
      : (Number.isFinite(Number(dimension)) ? Number(dimension) : null);
  });
  calendarClockState.timePanelSizeVersion = CALENDAR_CLOCK_PANEL_DEFAULT.timePanelSizeVersion;
  calendarClockState.arcGapDefaultVersion = CALENDAR_CLOCK_PANEL_DEFAULT.arcGapDefaultVersion;
  delete calendarClockState.densityMode;
  delete calendarClockState.autoFit;
  delete calendarClockState.autoSwitch;
  delete calendarClockState.dayStart;
  delete calendarClockState.nightStart;
  delete calendarClockState.timePanelInitialMaximizeVersion;
  normalizeMiniClockPosition();
}

function persistCalendarClockState() {
  if (!canUseCalendarClockExtensionApi()) return;

  try {
    chrome.storage.local.set({ [CALENDAR_CLOCK_STATE_KEY]: calendarClockState }, () => {
      const runtimeError = getCalendarClockRuntimeLastError();
      if (runtimeError) markCalendarClockExtensionContextInvalidated(runtimeError);
    });
  } catch (error) {
    if (!markCalendarClockExtensionContextInvalidated(error)) {
      calendarClockWarn("failed to save overlay state", error);
    }
  }
}

function saveCalendarClockState(options = {}) {
  const debounceMs = Math.max(0, Math.round(Number(options.debounceMs) || 0));
  if (calendarClockStateSaveTimer) {
    clearTimeout(calendarClockStateSaveTimer);
    calendarClockStateSaveTimer = null;
  }

  if (!debounceMs) {
    persistCalendarClockState();
    return;
  }

  calendarClockStateSaveTimer = setTimeout(() => {
    calendarClockStateSaveTimer = null;
    persistCalendarClockState();
  }, debounceMs);
}

onCalendarClockContextInvalidated(() => {
  if (calendarClockStateSaveTimer) clearTimeout(calendarClockStateSaveTimer);
  calendarClockStateSaveTimer = null;
});

function loadCalendarClockState() {
  return new Promise(resolve => {
    if (!canUseCalendarClockExtensionApi()) {
      applyLoadedCalendarClockState();
      resolve();
      return;
    }

    try {
      chrome.storage.local.get([CALENDAR_CLOCK_STATE_KEY, "calendarClockStorageStatus"], result => {
        const runtimeError = getCalendarClockRuntimeLastError();
        if (runtimeError) {
          markCalendarClockExtensionContextInvalidated(runtimeError);
          applyLoadedCalendarClockState();
          resolve();
          return;
        }

        applyLoadedCalendarClockState(result[CALENDAR_CLOCK_STATE_KEY] || {});
        calendarClockStorageStatus = result.calendarClockStorageStatus || null;
        resolve();
      });
    } catch (error) {
      if (!markCalendarClockExtensionContextInvalidated(error)) {
        calendarClockWarn("failed to load overlay state", error);
      }
      applyLoadedCalendarClockState();
      resolve();
    }
  });
}
