(function initializeCalendarClockTemporalProjection(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports && typeof process === "object" && process.versions?.node) {
    module.exports = api;
    return;
  }
  root.CalendarClockTemporalProjection = api;
})(globalThis, () => {
  "use strict";

  const CONTRACT_VERSION = 1;
  const PROJECTION_POLICY_VERSION = 1;
  const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const ABSOLUTE_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  const KINDS = new Set(["timed", "point", "all-day"]);

  function fail(code, message) {
    return { ok: false, diagnostic: { code, message } };
  }

  function pass(value) {
    return { ok: true, value };
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function parseDateKey(value) {
    if (typeof value !== "string") return null;
    const match = DATE_KEY_PATTERN.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(0);
    probe.setUTCHours(0, 0, 0, 0);
    probe.setUTCFullYear(year, month - 1, day);
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    return { year, month, day };
  }

  function isDateKey(value) {
    return Boolean(parseDateKey(value));
  }

  function addCivilDays(dateKey, days) {
    const parts = parseDateKey(dateKey);
    const amount = Number(days);
    if (!parts || !Number.isInteger(amount)) return "";
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(parts.year, parts.month - 1, parts.day + amount);
    return [
      String(date.getUTCFullYear()).padStart(4, "0"),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0")
    ].join("-");
  }

  function isValidTimeZone(value) {
    const timeZone = String(value || "").trim();
    if (!timeZone) return false;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function createContext(calendarTimeZone) {
    const timeZone = String(calendarTimeZone || "").trim();
    if (!isValidTimeZone(timeZone)) {
      return fail("invalid-calendar-time-zone", "A valid Google Calendar display IANA timezone is required.");
    }
    return pass({
      contractVersion: CONTRACT_VERSION,
      projectionPolicyVersion: PROJECTION_POLICY_VERSION,
      calendarTimeZone: timeZone,
      fingerprint: `calendar-tz=${encodeURIComponent(timeZone)};projection=${PROJECTION_POLICY_VERSION}`
    });
  }

  function isValidContext(value) {
    if (!isPlainObject(value)
        || value.contractVersion !== CONTRACT_VERSION
        || value.projectionPolicyVersion !== PROJECTION_POLICY_VERSION
        || !isValidTimeZone(value.calendarTimeZone)) {
      return false;
    }
    return createContext(value.calendarTimeZone).value?.fingerprint === value.fingerprint;
  }

  function parseAbsoluteInstant(value) {
    if (typeof value !== "string" || value.length > 40 || !ABSOLUTE_ISO_PATTERN.test(value)) return null;
    const datePrefix = value.slice(0, 10);
    if (!isDateKey(datePrefix)) return null;
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? { milliseconds, iso: new Date(milliseconds).toISOString() } : null;
  }

  function getZonedParts(instant, timeZone) {
    const parsed = instant instanceof Date
      ? (Number.isFinite(instant.getTime()) ? instant.getTime() : null)
      : typeof instant === "number"
        ? (Number.isFinite(instant) ? instant : null)
        : parseAbsoluteInstant(instant)?.milliseconds;
    if (parsed === null || !isValidTimeZone(timeZone)) return null;
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch (_error) {
      return null;
    }
    const values = {};
    formatter.formatToParts(new Date(parsed)).forEach(part => {
      if (part.type !== "literal") values[part.type] = Number(part.value);
    });
    if (![values.year, values.month, values.day, values.hour, values.minute, values.second].every(Number.isInteger)) return null;
    return values;
  }

  function dateKeyForInstant(value, timeZone) {
    const parts = getZonedParts(value, timeZone);
    if (!parts) return "";
    return [
      String(parts.year).padStart(4, "0"),
      String(parts.month).padStart(2, "0"),
      String(parts.day).padStart(2, "0")
    ].join("-");
  }

  function timeForInstant(value, timeZone) {
    const parts = getZonedParts(value, timeZone);
    if (!parts) return "";
    return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  }

  function getTimeZoneOffsetMs(timeZone, milliseconds) {
    const parts = getZonedParts(milliseconds, timeZone);
    if (!parts) return null;
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
      - (milliseconds - (milliseconds % 1000));
  }

  function resolveZonedCivilDateTime(dateKey, time, timeZone) {
    const date = parseDateKey(dateKey);
    const timeMatch = TIME_PATTERN.exec(String(time || ""));
    if (!date || !timeMatch || !isValidTimeZone(timeZone)) {
      return fail("invalid-civil-date-time", "A strict civil date, 24-hour time, and Calendar timezone are required.");
    }
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const wallMilliseconds = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0);
    const offsets = new Set();
    for (let deltaHours = -48; deltaHours <= 48; deltaHours += 6) {
      const offset = getTimeZoneOffsetMs(timeZone, wallMilliseconds + deltaHours * 60 * 60 * 1000);
      if (offset !== null) offsets.add(offset);
    }
    const candidates = Array.from(offsets, offset => wallMilliseconds - offset)
      .filter(milliseconds => {
        const parts = getZonedParts(milliseconds, timeZone);
        return parts?.year === date.year
          && parts.month === date.month
          && parts.day === date.day
          && parts.hour === hour
          && parts.minute === minute;
      });
    const unique = Array.from(new Set(candidates)).sort((left, right) => left - right);
    if (unique.length === 0) {
      return fail("nonexistent-civil-time", "The DOM time falls in a Calendar timezone transition gap.");
    }
    if (unique.length > 1) {
      return fail("ambiguous-civil-time", "The DOM time repeats during a Calendar timezone transition and has no offset discriminator.");
    }
    return pass(new Date(unique[0]).toISOString());
  }

  function makeOccurrenceKey(source, stableId, kind, anchor) {
    const occurrenceAnchor = kind === "all-day" ? `civil:${anchor}` : `instant:${anchor}`;
    return [String(source || "calendar"), String(stableId || ""), occurrenceAnchor].map(encodeURIComponent).join("|");
  }

  function baseTemporal(context, kind, occurrenceKey, firstDateKey, lastDateKey) {
    return {
      contractVersion: CONTRACT_VERSION,
      projectionPolicyVersion: PROJECTION_POLICY_VERSION,
      kind,
      calendarTimeZone: context.calendarTimeZone,
      contextFingerprint: context.fingerprint,
      occurrenceKey,
      firstDateKey,
      lastDateKey
    };
  }

  function projectInstantEvent(event, context) {
    if (!isValidContext(context)) return fail("invalid-projection-context", "The projection context is invalid or incompatible.");
    const kind = event?.durationKind === "point" ? "point" : event?.durationKind === "range" || event?.durationKind === "timed" ? "timed" : "";
    if (!kind) return fail("invalid-duration-kind", "Timed input must explicitly be a range/timed interval or point.");
    const start = parseAbsoluteInstant(event.startInstant || event.startDate);
    const end = parseAbsoluteInstant(event.endInstant || event.endDate);
    if (!start || !end) return fail("invalid-instant", "Timed events require absolute ISO start and end instants.");
    if (kind === "point" ? end.milliseconds !== start.milliseconds : end.milliseconds <= start.milliseconds) {
      return fail("invalid-interval", kind === "point" ? "A point event must have equal instants." : "A timed interval must have start before end.");
    }
    const firstDateKey = dateKeyForInstant(start.iso, context.calendarTimeZone);
    const lastDateKey = dateKeyForInstant(kind === "point" ? start.iso : new Date(end.milliseconds - 1).toISOString(), context.calendarTimeZone);
    if (!firstDateKey || !lastDateKey || lastDateKey < firstDateKey) return fail("projection-failed", "The instant interval could not be projected to Calendar civil dates.");
    const stableId = String(event.id || event.domKey || "").trim();
    if (!stableId) return fail("missing-stable-id", "An event ID is required for occurrence identity.");
    const source = String(event.capturedFrom || "calendar");
    const temporal = {
      ...baseTemporal(context, kind, makeOccurrenceKey(source, stableId, kind, start.iso), firstDateKey, lastDateKey),
      startInstant: start.iso,
      endInstant: end.iso
    };
    // Legacy presentation fields are derived here; filtering, identity, and storage must read `temporal`.
    return pass({
      ...event,
      durationKind: kind === "timed" ? "range" : "point",
      isPointEvent: kind === "point",
      isAllDay: false,
      date: firstDateKey,
      start: timeForInstant(start.iso, context.calendarTimeZone),
      end: timeForInstant(end.iso, context.calendarTimeZone),
      startDate: start.iso,
      endDate: end.iso,
      temporal
    });
  }

  function projectZonedEvent(event, context) {
    if (!isValidContext(context)) return fail("invalid-projection-context", "The projection context is invalid or incompatible.");
    const kind = event?.durationKind === "point" ? "point" : event?.durationKind === "range" || event?.durationKind === "timed" ? "range" : "";
    if (!kind) return fail("invalid-duration-kind", "DOM input must explicitly be a range/timed interval or point.");
    const startResult = resolveZonedCivilDateTime(event.startDateKey, event.startTime, context.calendarTimeZone);
    if (!startResult.ok) return startResult;
    const endResult = resolveZonedCivilDateTime(event.endDateKey, event.endTime, context.calendarTimeZone);
    if (!endResult.ok) return endResult;
    return projectInstantEvent({
      ...event,
      durationKind: kind,
      startInstant: startResult.value,
      endInstant: endResult.value
    }, context);
  }

  function projectAllDayEvent(event, context) {
    if (!isValidContext(context)) return fail("invalid-projection-context", "The projection context is invalid or incompatible.");
    const startDateKey = event?.startDateKey || event?.allDayStartDateKey || "";
    const endDateKeyExclusive = event?.endDateKeyExclusive || event?.allDayEndDateKeyExclusive || "";
    if (!isDateKey(startDateKey) || !isDateKey(endDateKeyExclusive) || endDateKeyExclusive <= startDateKey) {
      return fail("invalid-all-day-interval", "All-day events require a valid civil start and exclusive civil end.");
    }
    const stableId = String(event.id || event.domKey || "").trim();
    if (!stableId) return fail("missing-stable-id", "An event ID is required for occurrence identity.");
    const source = String(event.capturedFrom || "calendar");
    const lastDateKey = addCivilDays(endDateKeyExclusive, -1);
    const temporal = {
      ...baseTemporal(context, "all-day", makeOccurrenceKey(source, stableId, "all-day", startDateKey), startDateKey, lastDateKey),
      startDateKey,
      endDateKeyExclusive
    };
    const startBoundary = resolveZonedCivilDateTime(startDateKey, "00:00", context.calendarTimeZone);
    const endBoundary = resolveZonedCivilDateTime(endDateKeyExclusive, "00:00", context.calendarTimeZone);
    const compatibilityBoundaries = startBoundary.ok && endBoundary.ok
      ? { startDate: startBoundary.value, endDate: endBoundary.value }
      : {};
    // Zoned instant boundaries are presentation-only for all-day events; their civil interval is authoritative.
    return pass({
      ...event,
      durationKind: "all-day",
      isPointEvent: false,
      isAllDay: true,
      date: startDateKey,
      start: "00:00",
      end: "00:00",
      ...compatibilityBoundaries,
      temporal
    });
  }

  function validateTemporal(temporal, expectedContext) {
    if (!isPlainObject(temporal)
        || temporal.contractVersion !== CONTRACT_VERSION
        || temporal.projectionPolicyVersion !== PROJECTION_POLICY_VERSION
        || !KINDS.has(temporal.kind)
        || !isValidTimeZone(temporal.calendarTimeZone)
        || !isDateKey(temporal.firstDateKey)
        || !isDateKey(temporal.lastDateKey)
        || temporal.lastDateKey < temporal.firstDateKey
        || typeof temporal.occurrenceKey !== "string"
        || !temporal.occurrenceKey
        || temporal.occurrenceKey.length > 2048) {
      return false;
    }
    const actualContext = createContext(temporal.calendarTimeZone).value;
    if (!actualContext || temporal.contextFingerprint !== actualContext.fingerprint) return false;
    if (expectedContext && (!isValidContext(expectedContext) || temporal.contextFingerprint !== expectedContext.fingerprint)) return false;
    if (temporal.kind === "all-day") {
      return isDateKey(temporal.startDateKey)
        && isDateKey(temporal.endDateKeyExclusive)
        && temporal.startDateKey === temporal.firstDateKey
        && addCivilDays(temporal.endDateKeyExclusive, -1) === temporal.lastDateKey
        && temporal.endDateKeyExclusive > temporal.startDateKey
        && temporal.startInstant === undefined
        && temporal.endInstant === undefined;
    }
    const start = parseAbsoluteInstant(temporal.startInstant);
    const end = parseAbsoluteInstant(temporal.endInstant);
    if (!start || !end) return false;
    if (temporal.kind === "point" ? start.milliseconds !== end.milliseconds : start.milliseconds >= end.milliseconds) return false;
    const firstDateKey = dateKeyForInstant(start.iso, temporal.calendarTimeZone);
    const lastInstant = temporal.kind === "point" ? start.iso : new Date(end.milliseconds - 1).toISOString();
    return temporal.firstDateKey === firstDateKey
      && temporal.lastDateKey === dateKeyForInstant(lastInstant, temporal.calendarTimeZone);
  }

  function validateEvent(event, expectedContext) {
    if (!isPlainObject(event) || !validateTemporal(event.temporal, expectedContext)) return false;
    const stableId = String(event.id || event.domKey || "").trim();
    if (!stableId) return false;
    const source = String(event.capturedFrom || "calendar");
    const anchor = event.temporal.kind === "all-day" ? event.temporal.startDateKey : event.temporal.startInstant;
    if (event.temporal.occurrenceKey !== makeOccurrenceKey(source, stableId, event.temporal.kind, anchor)) return false;
    if (event.temporal.kind === "all-day") return event.durationKind === "all-day";
    if (event.temporal.kind === "point") return event.durationKind === "point";
    return event.durationKind === "range";
  }

  function normalizeDateKeys(values) {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.filter(value => typeof value === "string" && isDateKey(value)))).sort();
  }

  function overlapsDateKeys(event, dateKeys) {
    if (!validateEvent(event)) return false;
    const keys = dateKeys instanceof Set ? normalizeDateKeys(Array.from(dateKeys)) : normalizeDateKeys(dateKeys);
    return keys.some(key => key >= event.temporal.firstDateKey && key <= event.temporal.lastDateKey);
  }

  function spansIntersect(event, firstDateKey, lastDateKey) {
    return validateEvent(event)
      && isDateKey(firstDateKey)
      && isDateKey(lastDateKey)
      && firstDateKey <= lastDateKey
      && event.temporal.firstDateKey <= lastDateKey
      && event.temporal.lastDateKey >= firstDateKey;
  }

  function overlapsInstantRange(event, startInstant, endInstant, dateKeys = []) {
    if (!validateEvent(event)) return false;
    if (event.temporal.kind === "all-day") return overlapsDateKeys(event, dateKeys);
    const start = parseAbsoluteInstant(startInstant);
    const end = parseAbsoluteInstant(endInstant);
    if (!start || !end || end.milliseconds <= start.milliseconds) return false;
    const eventStart = Date.parse(event.temporal.startInstant);
    const eventEnd = Date.parse(event.temporal.endInstant);
    if (event.temporal.kind === "point") return eventStart >= start.milliseconds && eventStart < end.milliseconds;
    return Math.min(eventEnd, end.milliseconds) > Math.max(eventStart, start.milliseconds);
  }

  function compareEvents(left, right) {
    const leftTemporal = validateEvent(left) ? left.temporal : null;
    const rightTemporal = validateEvent(right) ? right.temporal : null;
    const leftAnchor = leftTemporal?.kind === "all-day" ? leftTemporal.startDateKey : leftTemporal?.startInstant || "";
    const rightAnchor = rightTemporal?.kind === "all-day" ? rightTemporal.startDateKey : rightTemporal?.startInstant || "";
    return String(leftAnchor).localeCompare(String(rightAnchor))
      || String(left?.start || "").localeCompare(String(right?.start || ""))
      || String(left?.end || "").localeCompare(String(right?.end || ""))
      || String(left?.title || "").localeCompare(String(right?.title || ""));
  }

  return Object.freeze({
    CONTRACT_VERSION,
    PROJECTION_POLICY_VERSION,
    createContext,
    isValidContext,
    isValidTimeZone,
    isDateKey,
    addCivilDays,
    parseAbsoluteInstant,
    getZonedParts,
    dateKeyForInstant,
    timeForInstant,
    resolveZonedCivilDateTime,
    projectInstantEvent,
    projectZonedEvent,
    projectAllDayEvent,
    validateTemporal,
    validateEvent,
    normalizeDateKeys,
    overlapsDateKeys,
    spansIntersect,
    overlapsInstantRange,
    compareEvents
  });
});
