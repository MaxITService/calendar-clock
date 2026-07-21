// Reads visible Google Calendar event chips from the DOM and publishes normalized event ranges.
function to24Hour(hour, minute, meridiem) {
  let h = Number(hour);
  const m = Number(minute || 0);
  const marker = meridiem ? meridiem.toLowerCase() : "";

  if (marker.startsWith("p") && h < 12) h += 12;
  if (marker.startsWith("a") && h === 12) h = 0;

  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function inferCompactRangeStartMeridiem(startHour, endHour, endMeridiem) {
  const start = Number(startHour);
  const end = Number(endHour);
  const marker = String(endMeridiem || "").toLowerCase();
  const crossesBoundary = start !== 12 && (start > end || end === 12);

  if (!crossesBoundary) return endMeridiem;
  if (marker.startsWith("p")) return "am";
  if (marker.startsWith("a")) return "pm";
  return endMeridiem;
}

function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isConservativeDotTimeMinute(minute) {
  const value = Number(minute);
  return value === 0 || value > 12;
}

const CALENDAR_CLOCK_MONTHS = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11
};
const CALENDAR_CLOCK_EXTRA_MONTHS = {
  "январь": 0,
  "января": 0,
  "февраль": 1,
  "февраля": 1,
  "март": 2,
  "марта": 2,
  "апрель": 3,
  "апреля": 3,
  "май": 4,
  "мая": 4,
  "июнь": 5,
  "июня": 5,
  "июль": 6,
  "июля": 6,
  "август": 7,
  "августа": 7,
  "сентябрь": 8,
  "сентября": 8,
  "октябрь": 9,
  "октября": 9,
  "ноябрь": 10,
  "ноября": 10,
  "декабрь": 11,
  "декабря": 11,
  "tammikuu": 0,
  "tammikuuta": 0,
  "helmikuu": 1,
  "helmikuuta": 1,
  "maaliskuu": 2,
  "maaliskuuta": 2,
  "huhtikuu": 3,
  "huhtikuuta": 3,
  "toukokuu": 4,
  "toukokuuta": 4,
  "kesäkuu": 5,
  "kesäkuuta": 5,
  "heinäkuu": 6,
  "heinäkuuta": 6,
  "elokuu": 7,
  "elokuuta": 7,
  "syyskuu": 8,
  "syyskuuta": 8,
  "lokakuu": 9,
  "lokakuuta": 9,
  "marraskuu": 10,
  "marraskuuta": 10,
  "joulukuu": 11,
  "joulukuuta": 11
};
let calendarClockMonthAliasesReady = false;

function normalizeCalendarDateToken(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addCalendarMonthAlias(value, monthIndex) {
  const key = normalizeCalendarDateToken(value);
  if (key) CALENDAR_CLOCK_MONTHS[key] = monthIndex;
}

function ensureCalendarMonthAliases() {
  if (calendarClockMonthAliasesReady) return;
  Object.entries(CALENDAR_CLOCK_EXTRA_MONTHS).forEach(([name, monthIndex]) => {
    addCalendarMonthAlias(name, monthIndex);
  });

  const localeCandidates = new Set([
    "en-US",
    "ru-RU",
    "fi-FI",
    navigator.language,
    ...(Array.isArray(navigator.languages) ? navigator.languages : [])
  ].filter(Boolean));

  localeCandidates.forEach(locale => {
    ["long", "short"].forEach(monthStyle => {
      const formatter = new Intl.DateTimeFormat(locale, { month: monthStyle, timeZone: "UTC" });
      const dateFormatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: monthStyle, timeZone: "UTC" });
      for (let month = 0; month < 12; month += 1) {
        const date = new Date(Date.UTC(2026, month, 1));
        addCalendarMonthAlias(formatter.format(date), month);
        const monthPart = dateFormatter.formatToParts(date).find(part => part.type === "month")?.value;
        if (monthPart) addCalendarMonthAlias(monthPart, month);
      }
    });
  });
  calendarClockMonthAliasesReady = true;
}

function getCalendarMonthIndex(value) {
  ensureCalendarMonthAliases();
  return CALENDAR_CLOCK_MONTHS[normalizeCalendarDateToken(value)];
}

function makeCalendarDate(year, month, day) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return date;
}

function rangeFromSingleTime(start) {
  if (timeToMinutes(start) === null) return null;
  return {
    start,
    end: start,
    durationKind: "point",
    isPointEvent: true
  };
}

function rangeFromAllDayDates(startDate, endDate) {
  if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    return null;
  }

  return {
    start: "00:00",
    end: "00:00",
    durationKind: "all-day",
    isAllDay: true,
    allDayStartDate: startDate,
    allDayEndDate: endDate
  };
}

function isTaskLikeNode(node, text) {
  return Boolean(
    node.matches("[data-taskid], [data-task-id]") ||
    /(^|\b)(task|tasks|due|complete|completed|active tasks)(\b|$)/i.test(text)
  );
}

function isCalendarEventChipNode(node) {
  return Boolean(node.matches("[data-eventid], [data-eventchip], [data-eid], [data-taskid], [data-task-id]"));
}

function getCalendarClockDomEventDedupeKey(stableId, fallbackKey) {
  const normalizedId = String(stableId || "").trim();
  return normalizedId ? `id:${normalizedId}` : `fallback:${fallbackKey}`;
}

function isCalendarClockElementInViewport(node) {
  const rect = node.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const visibleWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
  const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
  return visibleWidth > 1 && visibleHeight > 1;
}

function parseTimeRange(value) {
  const text = String(value || "").replace(/\s+/g, " ");

  const meridiemRange = text.match(/(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)\s*(?:to|until|-|–|—)\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i);
  if (meridiemRange) {
    const start = to24Hour(meridiemRange[1], meridiemRange[2], meridiemRange[3]);
    const end = to24Hour(meridiemRange[4], meridiemRange[5], meridiemRange[6]);
    if (start && end) return { start, end };
  }

  const compactMeridiemRange = text.match(/(\d{1,2})(?::(\d{2}))?\s*(?:to|until|-|–|—)\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i);
  if (compactMeridiemRange) {
    const endMarker = compactMeridiemRange[5];
    const startMarker = inferCompactRangeStartMeridiem(compactMeridiemRange[1], compactMeridiemRange[3], endMarker);
    const start = to24Hour(compactMeridiemRange[1], compactMeridiemRange[2], startMarker);
    const end = to24Hour(compactMeridiemRange[3], compactMeridiemRange[4], endMarker);
    if (start && end) return { start, end };
  }

  const twentyFourHourRange = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:to|until|-|–|—)\s*([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFourHourRange) {
    return {
      start: `${String(twentyFourHourRange[1]).padStart(2, "0")}:${twentyFourHourRange[2]}`,
      end: `${String(twentyFourHourRange[3]).padStart(2, "0")}:${twentyFourHourRange[4]}`
    };
  }

  const dotTimeRange = text.match(/\b([01]?\d|2[0-3])\.([0-5]\d)\s*(?:to|until|-|–|—)\s*([01]?\d|2[0-3])\.([0-5]\d)(?!\.\d)\b/);
  if (dotTimeRange
      && isConservativeDotTimeMinute(dotTimeRange[2])
      && isConservativeDotTimeMinute(dotTimeRange[4])) {
    return {
      start: `${String(dotTimeRange[1]).padStart(2, "0")}:${dotTimeRange[2]}`,
      end: `${String(dotTimeRange[3]).padStart(2, "0")}:${dotTimeRange[4]}`
    };
  }

  return null;
}

function parseSingleTime(value) {
  const text = String(value || "").replace(/\s+/g, " ");

  const meridiemTime = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)\b/i);
  if (meridiemTime) {
    const start = to24Hour(meridiemTime[1], meridiemTime[2], meridiemTime[3]);
    return start ? rangeFromSingleTime(start) : null;
  }

  const twentyFourHourTime = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFourHourTime) {
    return rangeFromSingleTime(`${String(twentyFourHourTime[1]).padStart(2, "0")}:${twentyFourHourTime[2]}`);
  }

  const dotTime = text.match(/(?:^|[^\w.])([01]?\d|2[0-3])\.([0-5]\d)(?!\.\d)\b/);
  if (dotTime && isConservativeDotTimeMinute(dotTime[2])) {
    return rangeFromSingleTime(`${String(dotTime[1]).padStart(2, "0")}:${dotTime[2]}`);
  }

  return null;
}

function addCalendarDateDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return makeCalendarDate(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
}

function formatLocalDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function isValidCalendarClockTimeZone(value) {
  const temporal = globalThis.calendarClockTemporalProjection;
  if (temporal?.isValidTimeZone) return temporal.isValidTimeZone(value);
  const timeZone = String(value || "").trim();
  if (!timeZone) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch (_error) {
    return false;
  }
}

function getCalendarClockSystemTimeZone() {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidCalendarClockTimeZone(timeZone) ? timeZone : "";
  } catch (_error) {
    return "";
  }
}

function getCalendarClockTimeZone() {
  const node = document.getElementById("xTimezone");
  const calendarTimeZone = String(node?.value || node?.textContent || node?.getAttribute?.("data-timezone") || "").trim();
  if (isValidCalendarClockTimeZone(calendarTimeZone)) return calendarTimeZone;
  return "";
}

function getCalendarClockZonedParts(date = new Date(), timeZone = getCalendarClockTimeZone()) {
  return globalThis.calendarClockTemporalProjection?.getZonedParts?.(date, timeZone) || null;
}

function makeCalendarClockZonedDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0, timeZone = getCalendarClockTimeZone()) {
  const temporal = globalThis.calendarClockTemporalProjection;
  if (!temporal || !isValidCalendarClockTimeZone(timeZone)) return new Date(NaN);
  const normalized = new Date(0);
  normalized.setUTCHours(0, 0, 0, 0);
  normalized.setUTCFullYear(Number(year), Number(month), Number(day));
  const dateKey = [
    String(normalized.getUTCFullYear()).padStart(4, "0"),
    String(normalized.getUTCMonth() + 1).padStart(2, "0"),
    String(normalized.getUTCDate()).padStart(2, "0")
  ].join("-");
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const resolved = temporal.resolveZonedCivilDateTime(dateKey, time, timeZone);
  return resolved.ok ? new Date(Date.parse(resolved.value) + Number(second) * 1000 + Number(millisecond)) : new Date(NaN);
}

function formatCalendarClockDateKey(date, timeZone = getCalendarClockTimeZone()) {
  return globalThis.calendarClockTemporalProjection?.dateKeyForInstant?.(date, timeZone) || "";
}

function getCalendarClockZonedDayStart(date = new Date(), timeZone = getCalendarClockTimeZone()) {
  const parts = getCalendarClockZonedParts(date, timeZone);
  if (!parts) return new Date(NaN);
  return makeCalendarClockZonedDate(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0, timeZone);
}

function addCalendarClockZonedDays(date, days, timeZone = getCalendarClockTimeZone()) {
  const parts = getCalendarClockZonedParts(date, timeZone);
  if (!parts) return new Date(NaN);
  return makeCalendarClockZonedDate(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second, date.getMilliseconds(), timeZone);
}

function getCalendarClockNowMinutes(includeSeconds = false) {
  const now = new Date();
  const parts = getCalendarClockZonedParts(now);
  if (!parts) return 0;
  const seconds = includeSeconds ? (parts.second + now.getMilliseconds() / 1000) / 60 : 0;
  return parts.hour * 60 + parts.minute + seconds;
}

function getCalendarClockExplicitDateOrder() {
  const language = String(document.documentElement?.lang || "").trim().toLowerCase();
  if (/^en-us(?:-|$)/.test(language)) return "month-day";
  if (/^(?:en-(?:gb|ie|au|nz)|fi|ru)(?:-|$)/.test(language)) return "day-month";
  return "";
}

function findExplicitCalendarEventDate(text) {
  const normalized = String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const isoPattern = /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?=$|[^\d])/g;
  for (const isoMatch of normalized.matchAll(isoPattern)) {
    const date = makeCalendarDate(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    if (date) return date;
  }

  const numericPattern = /\b(\d{1,2})([./-])(\d{1,2})\2(\d{4})(?=$|[^\d])/g;
  for (const numericMatch of normalized.matchAll(numericPattern)) {
    const first = Number(numericMatch[1]);
    const second = Number(numericMatch[3]);
    const year = Number(numericMatch[4]);
    const explicitOrder = first > 12
      ? "day-month"
      : second > 12
        ? "month-day"
        : getCalendarClockExplicitDateOrder();
    if (!explicitOrder) continue;
    const day = explicitOrder === "month-day" ? second : first;
    const month = (explicitOrder === "month-day" ? first : second) - 1;
    const date = makeCalendarDate(year, month, day);
    if (date) return date;
  }

  const dayMonthPattern = /\b(\d{1,2})(?:st|nd|rd|th)?\.?\s+([^\s\d,]+),?\s+(\d{4})(?=$|[^\d])/gi;
  for (const dayMonthMatch of normalized.matchAll(dayMonthPattern)) {
    const month = getCalendarMonthIndex(dayMonthMatch[2]);
    const day = Number(dayMonthMatch[1]);
    const year = Number(dayMonthMatch[3]);
    const date = month !== undefined ? makeCalendarDate(year, month, day) : null;
    if (date) return date;
  }

  const monthDayPattern = /\b([^\s\d,]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?=$|[^\d])/gi;
  for (const monthDayMatch of normalized.matchAll(monthDayPattern)) {
    const month = getCalendarMonthIndex(monthDayMatch[1]);
    const day = Number(monthDayMatch[2]);
    const year = Number(monthDayMatch[3]);
    const date = month !== undefined ? makeCalendarDate(year, month, day) : null;
    if (date) return date;
  }

  return null;
}

function findCalendarEventDateWithoutYear(text, year) {
  const normalized = String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  if (!Number.isInteger(year)) return null;

  const dayMonthPattern = /\b(\d{1,2})(?:st|nd|rd|th)?\.?\s+([^\s\d,]+)/gi;
  for (const dayMonthMatch of normalized.matchAll(dayMonthPattern)) {
    const month = getCalendarMonthIndex(dayMonthMatch[2]);
    const day = Number(dayMonthMatch[1]);
    const date = month !== undefined ? makeCalendarDate(year, month, day) : null;
    if (date) return date;
  }

  const monthDayPattern = /\b([^\s\d,]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi;
  for (const monthDayMatch of normalized.matchAll(monthDayPattern)) {
    const month = getCalendarMonthIndex(monthDayMatch[1]);
    const day = Number(monthDayMatch[2]);
    const date = month !== undefined ? makeCalendarDate(year, month, day) : null;
    if (date) return date;
  }

  return null;
}

function parseCalendarEventDate(text, fallbackYear) {
  const explicitDate = findExplicitCalendarEventDate(text);
  if (explicitDate) return explicitDate;
  return findCalendarEventDateWithoutYear(text, Number(fallbackYear));
}

function parseCalendarDateRangeFromText(text, fallbackYear) {
  const normalized = String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const rangeSeparator = String.raw`(?:-|\u2013|\u2014|to|until)`;
  const ordinal = String.raw`(?:st|nd|rd|th)?\.?`;

  const sameMonthDayFirst = new RegExp(String.raw`\b(\d{1,2})${ordinal}\s*${rangeSeparator}\s*(\d{1,2})${ordinal}\s+([^\s\d,]+),?\s+(19\d{2}|20\d{2}|21\d{2})\b`, "gi");
  for (const match of normalized.matchAll(sameMonthDayFirst)) {
    const month = getCalendarMonthIndex(match[3]);
    const year = Number(match[4]);
    const startDate = month !== undefined ? makeCalendarDate(year, month, Number(match[1])) : null;
    const endDate = month !== undefined ? makeCalendarDate(year, month, Number(match[2])) : null;
    const exclusiveEndDate = endDate ? addCalendarDateDays(endDate, 1) : null;
    if (startDate && exclusiveEndDate && exclusiveEndDate > startDate) return { startDate, endDate: exclusiveEndDate };
  }

  const crossMonthDayFirst = new RegExp(String.raw`\b(\d{1,2})${ordinal}\s+([^\s\d,]+)\s*${rangeSeparator}\s*(\d{1,2})${ordinal}\s+([^\s\d,]+),?\s+(19\d{2}|20\d{2}|21\d{2})\b`, "gi");
  for (const match of normalized.matchAll(crossMonthDayFirst)) {
    const startMonth = getCalendarMonthIndex(match[2]);
    const endMonth = getCalendarMonthIndex(match[4]);
    const year = Number(match[5]);
    let startDate = startMonth !== undefined ? makeCalendarDate(year, startMonth, Number(match[1])) : null;
    const endDate = endMonth !== undefined ? makeCalendarDate(year, endMonth, Number(match[3])) : null;
    const exclusiveEndDate = endDate ? addCalendarDateDays(endDate, 1) : null;
    if (startDate && exclusiveEndDate && exclusiveEndDate <= startDate) {
      startDate = makeCalendarDate(year - 1, startMonth, Number(match[1]));
    }
    if (startDate && exclusiveEndDate && exclusiveEndDate > startDate) return { startDate, endDate: exclusiveEndDate };
  }

  const monthFirst = new RegExp(String.raw`\b([^\s\d,]+)\s+(\d{1,2})${ordinal}\s*${rangeSeparator}\s*(?:([^\s\d,]+)\s+)?(\d{1,2})${ordinal},?\s+(19\d{2}|20\d{2}|21\d{2})\b`, "gi");
  for (const match of normalized.matchAll(monthFirst)) {
    const startMonth = getCalendarMonthIndex(match[1]);
    const endMonth = getCalendarMonthIndex(match[3] || match[1]);
    const year = Number(match[5]);
    let startDate = startMonth !== undefined ? makeCalendarDate(year, startMonth, Number(match[2])) : null;
    const endDate = endMonth !== undefined ? makeCalendarDate(year, endMonth, Number(match[4])) : null;
    const exclusiveEndDate = endDate ? addCalendarDateDays(endDate, 1) : null;
    if (startDate && exclusiveEndDate && exclusiveEndDate <= startDate) {
      startDate = makeCalendarDate(year - 1, startMonth, Number(match[2]));
    }
    if (startDate && exclusiveEndDate && exclusiveEndDate > startDate) return { startDate, endDate: exclusiveEndDate };
  }

  const singleDate = parseCalendarEventDate(normalized, fallbackYear);
  return singleDate ? { startDate: singleDate, endDate: addCalendarDateDays(singleDate, 1) } : null;
}

function parseAllDayRange(rawText, contextText = "") {
  if (!/all\s*day\b/i.test(String(rawText || ""))) return null;

  const fallbackYear = inferCalendarFallbackYear(rawText, contextText);
  const range = parseCalendarDateRangeFromText(rawText, fallbackYear)
    || parseCalendarDateRangeFromText(contextText, fallbackYear);
  return range ? rangeFromAllDayDates(range.startDate, range.endDate) : null;
}

function findCalendarYearToken(text) {
  const match = String(text || "").match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function collectVisibleCalendarYearContext() {
  const parts = [document.title, location.href];
  const nodes = Array.from(document.querySelectorAll("[data-date], [role='heading'], [aria-label*='202'], [title*='202']")).slice(0, 20);
  nodes.forEach(node => {
    parts.push(node.getAttribute("data-date"), node.getAttribute("aria-label"), node.getAttribute("title"), node.textContent);
  });
  return parts.filter(Boolean).join(" ");
}

function inferCalendarFallbackYear(rawText, contextText) {
  const eventDate = findExplicitCalendarEventDate(rawText);
  if (eventDate) return eventDate.getUTCFullYear();

  const contextDate = findExplicitCalendarEventDate(contextText);
  if (contextDate) return contextDate.getUTCFullYear();

  const contextYear = findCalendarYearToken(contextText);
  if (contextYear) return contextYear;

  const visibleContext = collectVisibleCalendarYearContext();
  const visibleDate = findExplicitCalendarEventDate(visibleContext);
  if (visibleDate) return visibleDate.getUTCFullYear();

  return findCalendarYearToken(visibleContext) || getCalendarClockZonedParts(new Date())?.year || null;
}

function buildDatedEventRange(range, rawText, node) {
  const contextText = node ? collectCalendarDateContext(node) : "";
  if (range?.durationKind === "all-day") {
    const startDate = range.allDayStartDate instanceof Date ? range.allDayStartDate : null;
    const endDate = range.allDayEndDate instanceof Date ? range.allDayEndDate : null;
    if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return {
        dateParseStatus: "failed",
        dateParseReason: "Calendar Clock found an all-day event, but could not understand its date range from Google Calendar DOM text.",
        dateParseSupportEmail: CALENDAR_CLOCK_SUPPORT_EMAIL,
        dateParseContext: contextText.slice(0, 800)
      };
    }

    const startDateKey = formatLocalDateKey(startDate);
    const endDateKeyExclusive = formatLocalDateKey(endDate);
    return {
      date: startDateKey,
      adapterTemporal: { startDateKey, endDateKeyExclusive },
      dateParseStatus: "ok"
    };
  }

  const date = parseCalendarEventDate(rawText) || parseCalendarEventDate(contextText, inferCalendarFallbackYear(rawText, contextText));
  const startMinutes = timeToMinutes(range.start);
  const endMinutes = timeToMinutes(range.end);
  if (startMinutes === null || endMinutes === null) return {};
  if (!date) {
    return {
      dateParseStatus: "failed",
      dateParseReason: "Calendar Clock found a time, but could not understand the event date from Google Calendar DOM text.",
      dateParseSupportEmail: CALENDAR_CLOCK_SUPPORT_EMAIL,
      dateParseContext: contextText.slice(0, 800)
    };
  }

  const startDateKey = formatLocalDateKey(date);
  const endCivilDate = range?.isPointEvent !== true && endMinutes <= startMinutes
    ? addCalendarDateDays(date, 1)
    : date;
  if (!endCivilDate) {
    return {
      dateParseStatus: "failed",
      dateParseReason: "Calendar Clock could not normalize the DOM event end date.",
      dateParseSupportEmail: CALENDAR_CLOCK_SUPPORT_EMAIL,
      dateParseContext: contextText.slice(0, 800)
    };
  }

  return {
    date: startDateKey,
    adapterTemporal: {
      startDateKey,
      startTime: range.start,
      endDateKey: formatLocalDateKey(endCivilDate),
      endTime: range.end
    },
    dateParseStatus: "ok"
  };
}

function collectCalendarDateContext(node) {
  const parts = [];
  let current = node;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    parts.push(current.getAttribute("aria-label"), current.getAttribute("title"), current.getAttribute("data-date"));
    if (current.getAttribute("role") === "gridcell") {
      parts.push(String(current.textContent || "").replace(/\s+/g, " ").slice(0, 240));
    }
  }
  return parts.filter(Boolean).join(" ");
}

function stripCalendarTimesFromTitle(value) {
  return String(value || "")
    .replace(/all\s*day\b/gi, "")
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:to|until|-|–|—)\s*([01]?\d|2[0-3]):([0-5]\d)\b/gi, "")
    .replace(/\b([01]?\d|2[0-3])\.(00|1[3-9]|[2-5]\d)\s*(?:to|until|-|–|—)\s*([01]?\d|2[0-3])\.(00|1[3-9]|[2-5]\d)\b/gi, "")
    .replace(/\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?\s*(?:to|until|-|–|—)\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi, "")
    .replace(/\d{1,2}(?::\d{2})?\s*(?:to|until|-|–|—)\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi, "")
    .replace(/\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?\b/gi, "")
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/gi, "")
    .replace(/\b([01]?\d|2[0-3])\.(00|1[3-9]|[2-5]\d)\b/gi, "")
    .replace(/^[,;:\s-]+/, "")
    .trim();
}

function isCalendarTitleMetadata(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/^all\s*day$/i.test(text)) return true;
  if (/^(calendar|no location|location|colour|color)(:|$)/i.test(text)) return true;
  if (/^(event|task|appointment)$/i.test(text)) return true;
  if (findExplicitCalendarEventDate(text)) return true;
  if (parseTimeRange(text) || parseSingleTime(text)) return true;
  return false;
}

function extractPrimaryCalendarTitle(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const withoutLeadingTime = stripCalendarTimesFromTitle(normalized);
  const parts = withoutLeadingTime.split(/\s*,\s*/).map(part => stripCalendarTimesFromTitle(part));
  return parts.find(part => part && part.length <= 90 && !isCalendarTitleMetadata(part)) || "";
}

function cleanTitle(text, range) {
  let title = extractPrimaryCalendarTitle(text) || stripCalendarTimesFromTitle(text)
    .replace(/^(event|task|appointment),?\s*/i, "")
    .replace(/^[,;:\s-]+/, "")
    .trim();

  if (!title) {
    title = "(No title)";
  } else if (title.length > 90) {
    title = range?.isPointEvent ? `Event ${range.start}` : range ? `${range.start} - ${range.end}` : "Calendar event";
  }

  return title;
}

function cleanCalendarName(value) {
  const name = String(value || "")
    .replace(/^calendar\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return name && name.length <= 120 ? name : "";
}

function extractCalendarName(rawText, title) {
  const normalized = String(rawText || "").replace(/\s+/g, " ").trim();
  const explicit = normalized.match(/(?:^|,\s*)Calendar:\s*([^,]+)/i);
  if (explicit) return cleanCalendarName(explicit[1]);

  const parts = normalized.split(/\s*,\s*/).map(part => part.trim()).filter(Boolean);
  const titleIndex = parts.findIndex(part => stripCalendarTimesFromTitle(part) === title);
  const candidates = titleIndex >= 0 ? parts.slice(titleIndex + 1) : parts;
  return cleanCalendarName(candidates.find(part => {
    const withoutTimes = stripCalendarTimesFromTitle(part);
    return withoutTimes !== title && !isCalendarTitleMetadata(part);
  }) || "");
}

function colorFromElement(element, index) {
  const style = getComputedStyle(element);
  const candidates = [style.borderLeftColor, style.borderColor, style.backgroundColor, style.color];
  const color = candidates.find(value => {
    if (!value || value === "rgba(0, 0, 0, 0)" || value === "transparent") return false;
    if (value === "rgb(0, 0, 0)" || value === "rgb(255, 255, 255)") return false;
    return true;
  });
  return color || null;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function stableEventColor(eventKey, fallbackIndex) {
  const key = String(eventKey || "");
  if (!key) return CALENDAR_CLOCK_COLORS[fallbackIndex % CALENDAR_CLOCK_COLORS.length];
  return CALENDAR_CLOCK_COLORS[hashString(key) % CALENDAR_CLOCK_COLORS.length];
}

function getCalendarClockDomEventIdAliases(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return [];

  const aliases = new Set([rawValue]);
  const encodedValue = rawValue.startsWith("ttb_") ? rawValue.slice(4) : rawValue;
  if (rawValue.startsWith("task:")) aliases.add(rawValue.slice(5));

  try {
    const normalized = encodedValue.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const decodedId = atob(padded).trim().split(/\s+/)[0];
    if (/^[A-Za-z0-9_-]{3,256}$/.test(decodedId)) {
      aliases.add(decodedId);
      aliases.add(`task:${decodedId}`);
    }
  } catch (_error) {
    // Plain DOM IDs are already included above.
  }

  return Array.from(aliases);
}

function buildCalendarClockDomEventIndex() {
  const eventsById = new Map();
  const nodes = document.querySelectorAll("[data-eventid], [data-eid], [data-taskid], [data-task-id]");

  nodes.forEach(node => {
    const hasEventText = [node.getAttribute("aria-label"), node.getAttribute("title"), node.textContent]
      .some(value => String(value || "").trim());
    if (!hasEventText) return;
    const color = colorFromElement(node);

    ["data-eventid", "data-eid", "data-taskid", "data-task-id"].forEach(attribute => {
      getCalendarClockDomEventIdAliases(node.getAttribute(attribute)).forEach(alias => {
        if (!eventsById.has(alias)) eventsById.set(alias, { node, color });
      });
    });
  });

  return eventsById;
}

function getCalendarClockCurrentNavigationKey() {
  return typeof getCalendarClockNavigationKey === "function"
    ? getCalendarClockNavigationKey()
    : [location.href, document.title].join("|");
}

function markCalendarClockSuccessfulCapture() {
  calendarClockNavigationPending = false;
  calendarClockNavigationPendingSinceMs = 0;
  calendarClockNavigationSettlingUntilMs = 0;
  calendarClockNavigationSettlingReason = "";
  calendarClockLastSuccessfulNavigationKey = getCalendarClockCurrentNavigationKey();
}

function commitCalendarClockEventNodes() {
  calendarClockEventNodes.clear();
  calendarClockPendingEventNodes.forEach((node, key) => {
    calendarClockEventNodes.set(key, node);
  });
}

function shouldSkipEmptyCalendarCapture() {
  if (!calendarClockEvents.length) return false;

  const now = Date.now();
  const isNavigationSettling = now < calendarClockNavigationSettlingUntilMs;
  const currentNavigationKey = getCalendarClockCurrentNavigationKey();
  const changedSinceSuccessfulCapture = calendarClockLastSuccessfulNavigationKey
    && currentNavigationKey !== calendarClockLastSuccessfulNavigationKey;

  if (!calendarClockNavigationPending && !isNavigationSettling && !changedSinceSuccessfulCapture) return false;

  const pendingSince = calendarClockNavigationPendingSinceMs || now;
  const pendingMs = now - pendingSince;
  return pendingMs < CALENDAR_CLOCK_NAVIGATION_SETTLE_MS;
}

function extractCalendarEvents() {
  const nodes = Array.from(document.querySelectorAll(CALENDAR_CLOCK_SELECTOR));
  const seen = new Set();
  const events = [];
  let visibleCandidateCount = 0;
  calendarClockPendingEventNodes = new Map();

  nodes.forEach((node, index) => {
    const rawText = [
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.textContent
    ].filter(Boolean).join(" ");

    const canParseNode = isCalendarEventChipNode(node) || isTaskLikeNode(node, rawText);
    if (!canParseNode) return;

    const contextText = collectCalendarDateContext(node);
    const range = parseTimeRange(rawText) || parseSingleTime(rawText) || parseAllDayRange(rawText, contextText);
    if (!range) return;
    if (!isCalendarClockElementInViewport(node)) return;
    visibleCandidateCount += 1;

    const datedRange = buildDatedEventRange(range, rawText, node);
    const dateKey = datedRange.date
      || (datedRange.dateParseStatus === "failed" ? `unparsed:${hashString(datedRange.dateParseContext || rawText)}` : "floating");
    const title = cleanTitle(rawText, range);
    const fallbackKey = `${dateKey}|${range.start}|${range.end}|${title}`;
    const stableId = node.getAttribute("data-eventid")
      || node.getAttribute("data-eid")
      || node.getAttribute("data-taskid")
      || node.getAttribute("data-task-id");
    const dedupeKey = getCalendarClockDomEventDedupeKey(stableId, fallbackKey);
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const id = stableId || fallbackKey;
    calendarClockPendingEventNodes.set(id, node);
    calendarClockPendingEventNodes.set(fallbackKey, node);
    bindCalendarEventHover(node, id);

    events.push({
      id,
      domKey: fallbackKey,
      title,
      calendarName: extractCalendarName(rawText, title),
      start: range.start,
      end: range.end,
      durationKind: range.durationKind || "range",
      isPointEvent: range.isPointEvent === true,
      isAllDay: range.isAllDay === true,
      ...datedRange,
      color: colorFromElement(node, events.length) || stableEventColor(fallbackKey, events.length),
      capturedFrom: "google-calendar-dom",
      rawText: rawText.slice(0, 800)
    });
  });

  const sortedEvents = events.sort((a, b) =>
    String(a.date || "").localeCompare(String(b.date || ""))
    || a.start.localeCompare(b.start)
    || a.end.localeCompare(b.end)
    || a.title.localeCompare(b.title)
  );
  calendarClockLastCaptureCandidateCount = visibleCandidateCount;
  return sortedEvents;
}

function getCalendarClockCurrentCaptureView(events) {
  const view = typeof getCalendarClockCaptureView === "function"
    ? getCalendarClockCaptureView()
    : {};
  const visibleDateCount = Array.isArray(view.visibleDateKeys) ? view.visibleDateKeys.length : 0;
  const hasTrustedDateScope = typeof isCalendarClockCaptureDateScopeTrusted === "function"
    && isCalendarClockCaptureDateScopeTrusted(view);
  return {
    ...view,
    canClearMissingDates: hasTrustedDateScope
      && (visibleDateCount <= 1 || (events.length === 0 && calendarClockLastCaptureCandidateCount === 0))
  };
}

function filterCalendarEventsToCaptureView(events, captureView) {
  const temporal = globalThis.calendarClockTemporalProjection;
  const visibleDateKeys = temporal?.normalizeDateKeys?.(captureView?.visibleDateKeys) || [];
  if (!visibleDateKeys.length) return events.filter(event => temporal?.validateEvent?.(event));
  return events.filter(event => temporal?.overlapsDateKeys?.(event, visibleDateKeys));
}

function getCalendarClockReaderWindowDateRange() {
  if (typeof getWindowDateRange === "function") {
    try {
      const range = getWindowDateRange();
      if (range?.startDate instanceof Date
          && range?.endDate instanceof Date
          && Number.isFinite(range.startDate.getTime())
          && Number.isFinite(range.endDate.getTime())
          && range.endDate > range.startDate) return range;
    } catch (_error) {
      // Report an unavailable range below.
    }
  }

  return null;
}

function getCalendarEventWindowOverlapMinutes(event) {
  const temporalApi = globalThis.calendarClockTemporalProjection;
  if (!temporalApi?.validateEvent?.(event)) return null;
  const displayDateRange = getCalendarClockReaderWindowDateRange();
  if (!displayDateRange) return null;
  const { startDate, endDate } = displayDateRange;
  const displayDateKeys = typeof getDateKeysForDateRange === "function" ? getDateKeysForDateRange(startDate, endDate) : [];
  if (!temporalApi.overlapsInstantRange(event, startDate.toISOString(), endDate.toISOString(), displayDateKeys)) return 0;
  if (event.temporal.kind === "all-day" || event.temporal.kind === "point") return 1;
  const eventStartDate = new Date(event.temporal.startInstant);
  const eventEndDate = new Date(event.temporal.endInstant);
  const overlapStart = Math.max(eventStartDate.getTime(), startDate.getTime());
  const overlapEnd = Math.min(eventEndDate.getTime(), endDate.getTime());
  return Math.max(0, (overlapEnd - overlapStart) / (60 * 1000));
}

function filterCalendarEventsToDisplayWindow(events, displayWindow) {
  return events.filter(event => {
    const dateOverlapMinutes = getCalendarEventWindowOverlapMinutes(event);
    if (dateOverlapMinutes !== null) return dateOverlapMinutes > 0;
    if (typeof getVisibleEventSegment === "function") return getVisibleEventSegment(event, displayWindow);
    return true;
  });
}

function getCalendarClockCaptureLimit() {
  return normalizeCalendarClockCaptureLimit(calendarClockState.captureLimit);
}

function limitCalendarClockEvents(events, limit = getCalendarClockCaptureLimit()) {
  return events.slice(0, normalizeCalendarClockCaptureLimit(limit));
}

function renderCalendarClockEventSnapshot() {
  globalThis.calendarClockEventReminders?.updateEvents?.(calendarClockEvents);
  if (calendarClockState.followNow) {
    applyFollowNowWindow({ skipSave: true, force: true });
  } else {
    syncClockFrame();
  }
  renderDebugPanel();
  updatePanelStats();
}

let calendarClockPublishSequence = 0;

function getCalendarClockPageOwnedSnapshot() {
  const requested = calendarClockState.pageOwnedInfo === true;
  const api = globalThis.calendarClockPageOwnedInfo;
  if (!requested) return { requested, records: [], status: null, available: Boolean(api) };
  if (!api || typeof api.getRecords !== "function") {
    return { requested, records: [], status: { phase: "unavailable", reason: "optional module is unavailable" }, available: false };
  }
  return {
    requested,
    records: api.getRecords(),
    status: typeof api.getStatus === "function" ? api.getStatus() : null,
    available: true
  };
}

function preparePageOwnedCalendarEvents(records) {
  calendarClockPendingEventNodes = new Map();
  calendarClockLastCaptureCandidateCount = records.length;
  const domEventsById = buildCalendarClockDomEventIndex();
  return records.map((event, index) => {
    const key = event.domKey || `page-owned:${event.id}:${event.startDate}`;
    const domEvent = domEventsById.get(event.id) || domEventsById.get(key);
    if (domEvent?.node) {
      calendarClockPendingEventNodes.set(event.id, domEvent.node);
      calendarClockPendingEventNodes.set(key, domEvent.node);
      if (typeof bindCalendarEventHover === "function") bindCalendarEventHover(domEvent.node, event.id);
    }
    return {
      ...event,
      domKey: key,
      title: String(event.title || "").trim() || "(No title)",
      color: event.color || domEvent?.color || stableEventColor(key, index),
      capturedFrom: "google-page-owned",
      rawText: ""
    };
  }).sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))
    || String(a.start || "").localeCompare(String(b.start || ""))
    || String(a.end || "").localeCompare(String(b.end || ""))
    || String(a.title || "").localeCompare(String(b.title || "")));
}

function chooseCalendarClockEventSource(pageOwned, readDomEvents) {
  if (pageOwned.requested && pageOwned.records.length > 0) {
    return { events: preparePageOwnedCalendarEvents(pageOwned.records), source: "google-page-owned", fallback: false };
  }
  return {
    events: readDomEvents(),
    source: "google-calendar-dom",
    fallback: pageOwned.requested === true
  };
}

function projectCalendarClockSourceEvents(events, activeSource, temporalApi, context) {
  const projected = [];
  const diagnostics = [];
  (Array.isArray(events) ? events : []).forEach(event => {
    if (event?.dateParseStatus === "failed") {
      diagnostics.push({ id: String(event?.id || ""), code: "dom-date-parse-failed", message: event.dateParseReason || "DOM date parsing failed." });
      return;
    }
    const { adapterTemporal, ...baseEvent } = event || {};
    let result;
    if (event?.durationKind === "all-day") {
      result = temporalApi.projectAllDayEvent({
        ...baseEvent,
        startDateKey: event.allDayStartDateKey || adapterTemporal?.startDateKey,
        endDateKeyExclusive: event.allDayEndDateKeyExclusive || adapterTemporal?.endDateKeyExclusive
      }, context);
    } else if (activeSource === "google-page-owned") {
      result = temporalApi.projectInstantEvent({
        ...baseEvent,
        startInstant: event.startInstant || event.startDate,
        endInstant: event.endInstant || event.endDate
      }, context);
    } else {
      result = temporalApi.projectZonedEvent({
        ...baseEvent,
        startDateKey: adapterTemporal?.startDateKey,
        startTime: adapterTemporal?.startTime,
        endDateKey: adapterTemporal?.endDateKey,
        endTime: adapterTemporal?.endTime
      }, context);
    }
    if (result.ok) projected.push(result.value);
    else diagnostics.push({ id: String(event?.id || ""), ...result.diagnostic });
  });
  return { projected, diagnostics };
}

function makeCalendarClockCaptureViewAuthoritative(captureView, activeSource) {
  const hasTrustedDateScope = typeof isCalendarClockCaptureDateScopeTrusted === "function"
    && isCalendarClockCaptureDateScopeTrusted(captureView);
  const sourceCoversTrustedScope = activeSource === "google-page-owned"
    || captureView?.canClearMissingDates === true;
  return {
    ...captureView,
    canClearMissingDates: hasTrustedDateScope && sourceCoversTrustedScope
  };
}

async function publishCalendarEvents() {
  if (calendarClockExtensionContextInvalidated) return calendarClockEvents;

  const publishSequence = ++calendarClockPublishSequence;
  const temporalApi = globalThis.calendarClockTemporalProjection
    || await globalThis.calendarClockTemporalProjectionReady;
  if (publishSequence !== calendarClockPublishSequence) return calendarClockEvents;
  const contextResult = temporalApi?.createContext?.(getCalendarClockTimeZone());
  if (!temporalApi || !contextResult?.ok) {
    const diagnostic = globalThis.calendarClockTemporalProjectionStatus?.reason
      || contextResult?.diagnostic?.message
      || "canonical temporal projection is unavailable";
    calendarClockEffectiveEventSource = {
      requestedMode: calendarClockState.pageOwnedInfo === true ? "page-owned" : "dom",
      activeSource: "unavailable",
      status: `safe degraded state: ${diagnostic}`,
      fallback: false,
      captureStatus: { phase: "unavailable", reason: diagnostic }
    };
    calendarClockEvents = [];
    renderCalendarClockEventSnapshot();
    return [];
  }

  const pageOwned = getCalendarClockPageOwnedSnapshot();
  const selection = chooseCalendarClockEventSource(pageOwned, extractCalendarEvents);
  const activeSource = selection.source;
  const fallback = selection.fallback;
  const projection = projectCalendarClockSourceEvents(selection.events, activeSource, temporalApi, contextResult.value);
  const freshEvents = projection.projected;
  const hasStructuredRecords = activeSource === "google-page-owned";
  calendarClockEffectiveEventSource = {
    requestedMode: pageOwned.requested ? "page-owned" : "dom",
    activeSource,
    status: hasStructuredRecords
      ? `${pageOwned.status?.phase || "captured"}: ${pageOwned.status?.reason || "structured Calendar records extracted"}`
      : fallback
        ? `safe DOM fallback: ${pageOwned.status?.reason || "waiting for structured Calendar data"}`
        : "DOM text parser active",
    fallback,
    captureStatus: pageOwned.status || null,
    temporalContext: contextResult.value,
    projectionDiagnostics: projection.diagnostics.slice(0, 20)
  };
  if (projection.diagnostics.length) {
    calendarClockEffectiveEventSource.status += `; ${projection.diagnostics.length} event(s) rejected by temporal projection`;
  }
  const captureView = makeCalendarClockCaptureViewAuthoritative(
    getCalendarClockCurrentCaptureView(freshEvents),
    activeSource
  );
  const events = filterCalendarEventsToCaptureView(freshEvents, captureView);
  const displayDateKeys = typeof getCalendarClockDisplayDateKeys === "function" ? getCalendarClockDisplayDateKeys() : [];
  const displayWindow = typeof getDisplayWindow === "function" ? getDisplayWindow() : null;
  const displayDateRange = getCalendarClockReaderWindowDateRange();
  if (!displayDateRange) {
    const diagnostic = "Calendar display window has no valid absolute interval";
    calendarClockEffectiveEventSource = {
      ...calendarClockEffectiveEventSource,
      status: `publication deferred: ${diagnostic}`,
      captureStatus: { phase: "unavailable", reason: diagnostic }
    };
    calendarClockLog("temporal event publication deferred", diagnostic);
    renderDebugPanel();
    updatePanelStats();
    return calendarClockEvents;
  }
  const displayEvents = filterCalendarEventsToDisplayWindow(events, displayWindow);
  const captureLimit = getCalendarClockCaptureLimit();
  const deletedEventIds = Array.from(calendarClockPendingDeletedEventIds);
  const limitedDisplayEvents = limitCalendarClockEvents(displayEvents, captureLimit);
  setCalendarClockCaptureMeta(
    "calendar",
    makeCalendarClockCaptureMeta(activeSource, displayEvents.length, limitedDisplayEvents.length, captureLimit)
  );
  if (events.length === 0 && shouldSkipEmptyCalendarCapture()) {
    calendarClockLog("skip empty capture while Calendar navigation is settling", calendarClockNavigationSettlingReason);
    applyFollowNowWindow({ skipSave: true, force: true });
    syncClockFrame();
    renderDebugPanel();
    updatePanelStats();
    return calendarClockEvents;
  }

  markCalendarClockSuccessfulCapture();
  commitCalendarClockEventNodes();

  calendarClockEvents = limitedDisplayEvents;
  sendCalendarClockRuntimeMessage({
    type: "CALENDAR_CLOCK_EVENTS",
    events,
    displayEvents,
    url: location.href,
    captureView,
    displayDateKeys,
    windowStartDate: displayDateRange.startDate.toISOString(),
    windowEndDate: displayDateRange.endDate.toISOString(),
    timeZone: getCalendarClockTimeZone(),
    systemTimeZone: getCalendarClockSystemTimeZone(),
    temporalContext: contextResult.value,
    feedMode: pageOwned.requested ? "page-owned" : "dom",
    effectiveSource: calendarClockEffectiveEventSource,
    deletedEventIds,
    captureLimit,
    captureMeta: { calendar: calendarClockCaptureMeta.calendar }
  }, response => {
    if (publishSequence !== calendarClockPublishSequence) return;
    if (response?.ok === true) {
      deletedEventIds.forEach(id => calendarClockPendingDeletedEventIds.delete(id));
    }
    if (Object.prototype.hasOwnProperty.call(response || {}, "storageStatus")) {
      calendarClockStorageStatus = response.storageStatus;
    }
    if (response?.captureMeta) applyCalendarClockCaptureMeta(response.captureMeta);
    if (Array.isArray(response?.calendarEvents)) {
      calendarClockEvents = response.calendarEvents;
      renderCalendarClockEventSnapshot();
      if (Array.isArray(response.events) && response.events.length === 0) {
        clearCalendarClockFrameEvents();
      }
      reloadCalendarClockFrameEvents();
      return;
    }
    renderDebugPanel();
    updatePanelStats();
  });
  renderCalendarClockEventSnapshot();
  return events;
}

let publishTimer = null;
function queuePublishCalendarEvents() {
  if (calendarClockExtensionContextInvalidated) return;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishCalendarEvents().catch(error => {
      calendarClockWarn("temporal event publication failed closed", error);
      calendarClockEffectiveEventSource = {
        requestedMode: calendarClockState.pageOwnedInfo === true ? "page-owned" : "dom",
        activeSource: "unavailable",
        status: `safe degraded state: ${String(error?.message || error)}`,
        fallback: false,
        captureStatus: { phase: "unavailable", reason: String(error?.message || error) }
      };
      calendarClockEvents = [];
      renderCalendarClockEventSnapshot();
    });
  }, 300);
}

onCalendarClockContextInvalidated(() => clearTimeout(publishTimer));
