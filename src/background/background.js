const CALENDAR_CLOCK_EVENT_STORE_VERSION = 2;
const CALENDAR_CLOCK_EVENT_STORE_MAX_EVENTS = 1200;
const CALENDAR_CLOCK_EVENT_STORE_MAX_DELETED_IDS = 200;
const CALENDAR_CLOCK_CAPTURE_LIMIT = 50;
const CALENDAR_CLOCK_CAPTURE_LIMIT_OPTIONS = [50, 100, 200];
const CALENDAR_CLOCK_STORAGE_RETRY_EVENT_LIMITS = [1000, 800, 600, 400, 300, 200, 100, 50, 25, 10, 5, 1, 0];
const CALENDAR_CLOCK_AUDIO_BRIDGE_TOKEN_TTL_MS = 15000;
const CALENDAR_CLOCK_AUDIO_STORAGE_FRAME_PATH = "src/content/event-reminders/storage-frame.html";
const CALENDAR_CLOCK_EVENT_STORAGE_KEYS = [
  "calendarClockCalendarEvents",
  "calendarClockTaskEvents",
  "calendarClockEvents",
  "calendarClockSource",
  "calendarClockCalendarSource",
  "calendarClockTaskSource",
  "calendarClockCaptureMeta",
  "calendarClockStorageStatus",
  "calendarClockCalendarEventStore",
  "calendarClockFeedMode",
  "calendarClockActiveSource"
];
const CALENDAR_CLOCK_CAPTURE_DATE_KEY_SOURCES = new Set([
  "dated-url",
  "visible-dom",
  "title",
  "today-fallback",
  "source-conflict"
]);
const CALENDAR_CLOCK_PURGE_DATE_KEY_SOURCES = new Set(["dated-url", "visible-dom"]);
let calendarClockTemporalProjection = null;
let calendarClockTemporalProjectionDiagnostic = "temporal projection module was not loaded";
try {
  if (typeof importScripts === "function") {
    importScripts(chrome.runtime.getURL("src/temporal-projection/temporal-projection.js"));
  }
  calendarClockTemporalProjection = globalThis.CalendarClockTemporalProjection || null;
  if (calendarClockTemporalProjection) calendarClockTemporalProjectionDiagnostic = "";
} catch (error) {
  calendarClockTemporalProjectionDiagnostic = `temporal projection unavailable: ${String(error?.message || error)}`;
}
const calendarClockAudioBridgeTokens = new Map();

function removeExpiredCalendarClockAudioBridgeTokens(now = Date.now()) {
  calendarClockAudioBridgeTokens.forEach((record, token) => {
    if (record.expiresAt <= now) calendarClockAudioBridgeTokens.delete(token);
  });
}

function makeCalendarClockAudioBridgeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function isTrustedCalendarClockAudioTokenRequester(sender) {
  try {
    const url = new URL(sender?.url || "");
    return url.protocol === "https:"
      && url.hostname === "calendar.google.com"
      && Number.isInteger(sender?.tab?.id);
  } catch (_error) {
    return false;
  }
}

function isTrustedCalendarClockAudioStorageFrame(sender) {
  try {
    return sender?.url === chrome.runtime.getURL(CALENDAR_CLOCK_AUDIO_STORAGE_FRAME_PATH);
  } catch (_error) {
    return false;
  }
}

function createCalendarClockAudioBridgeToken(sender, now = Date.now()) {
  if (!isTrustedCalendarClockAudioTokenRequester(sender)) return null;
  removeExpiredCalendarClockAudioBridgeTokens(now);
  calendarClockAudioBridgeTokens.forEach((record, token) => {
    if (record.tabId === sender.tab.id) calendarClockAudioBridgeTokens.delete(token);
  });
  const token = makeCalendarClockAudioBridgeToken();
  const record = { tabId: sender.tab.id, expiresAt: now + CALENDAR_CLOCK_AUDIO_BRIDGE_TOKEN_TTL_MS };
  calendarClockAudioBridgeTokens.set(token, record);
  setTimeout(() => {
    if (calendarClockAudioBridgeTokens.get(token) === record) calendarClockAudioBridgeTokens.delete(token);
  }, CALENDAR_CLOCK_AUDIO_BRIDGE_TOKEN_TTL_MS + 100);
  return { token, expiresAt: record.expiresAt };
}

function validateCalendarClockAudioBridgeToken(token, sender, now = Date.now()) {
  removeExpiredCalendarClockAudioBridgeTokens(now);
  if (!isTrustedCalendarClockAudioStorageFrame(sender) || typeof token !== "string") return false;
  const record = calendarClockAudioBridgeTokens.get(token);
  if (!record || record.expiresAt <= now) return false;
  if (Number.isInteger(sender?.tab?.id) && sender.tab.id !== record.tabId) return false;
  calendarClockAudioBridgeTokens.delete(token);
  return true;
}

function normalizeCalendarClockCaptureLimit(value) {
  const limit = Math.round(Number(value));
  return CALENDAR_CLOCK_CAPTURE_LIMIT_OPTIONS.includes(limit)
    ? limit
    : CALENDAR_CLOCK_CAPTURE_LIMIT;
}

function hardRefreshCalendarClockEvents(tabId, sendResponse) {
  if (!Number.isInteger(tabId) || tabId < 0) {
    sendResponse({ ok: false, error: "Active Google Calendar tab is unavailable." });
    return;
  }

  chrome.storage.local.remove(CALENDAR_CLOCK_EVENT_STORAGE_KEYS, () => {
    const storageError = chrome.runtime.lastError;
    if (storageError) {
      sendResponse({ ok: false, error: storageError.message || "Calendar event cache could not be cleared." });
      return;
    }

    clearCalendarClockBadge();
    // Reply before navigation destroys an embedded clock frame.
    sendResponse({ ok: true, reloading: true });
    chrome.tabs.reload(tabId, () => {
      // Consume lastError when the tab closed during the reset. Storage is
      // already clean, so a later normal Calendar load remains self-healing.
      void chrome.runtime.lastError;
    });
  });
}

function getCalendarClockEventDateKey(event) {
  if (calendarClockTemporalProjection?.validateEvent?.(event)) return event.temporal.firstDateKey;
  return "";
}

function getCalendarClockEventIdentity(event) {
  if (calendarClockTemporalProjection?.validateEvent?.(event)) return event.temporal.occurrenceKey;
  if (event?.capturedFrom === "google-tasks-dom") return String(event.id || event.domKey || "");
  return "";
}

function getCalendarClockStableEventId(event) {
  return String(event?.id || "").trim();
}

function normalizeCalendarClockDeletedEventIds(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map(id => typeof id === "string" ? id.slice(0, 256).trim() : "")
    .filter(Boolean)))
    .slice(0, CALENDAR_CLOCK_EVENT_STORE_MAX_DELETED_IDS);
}

function removeCalendarClockDeletedEvents(events, deletedEventIds) {
  const deletedIds = deletedEventIds instanceof Set
    ? deletedEventIds
    : new Set(normalizeCalendarClockDeletedEventIds(deletedEventIds));
  if (!deletedIds.size) return Array.isArray(events) ? events : [];
  return (Array.isArray(events) ? events : []).filter(event => !deletedIds.has(String(event?.id || "").trim()));
}

function limitCalendarClockEffectiveEvents(events, limit = CALENDAR_CLOCK_CAPTURE_LIMIT) {
  return sortCalendarClockEvents(events).slice(0, normalizeCalendarClockCaptureLimit(limit));
}

function sortCalendarClockEvents(events) {
  return events.slice().sort((a, b) => {
    const leftCanonical = calendarClockTemporalProjection?.validateEvent?.(a);
    const rightCanonical = calendarClockTemporalProjection?.validateEvent?.(b);
    if (leftCanonical && rightCanonical) return calendarClockTemporalProjection.compareEvents(a, b);
    if (leftCanonical !== rightCanonical) return leftCanonical ? -1 : 1;
    return String(a?.start || "").localeCompare(String(b?.start || ""))
      || String(a?.title || "").localeCompare(String(b?.title || ""));
  });
}

function getCalendarClockEventStartTimestamp(event) {
  const timestamp = Date.parse(String(event?.temporal?.startInstant || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareCalendarClockEventsChronologically(a, b) {
  const leftTimestamp = getCalendarClockEventStartTimestamp(a);
  const rightTimestamp = getCalendarClockEventStartTimestamp(b);
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }

  const leftDateKey = getCalendarClockEventDateKey(a);
  const rightDateKey = getCalendarClockEventDateKey(b);
  const dateDelta = leftDateKey && rightDateKey ? leftDateKey.localeCompare(rightDateKey) : 0;
  return dateDelta
    || String(a.start || "").localeCompare(String(b.start || ""))
    || String(a.end || "").localeCompare(String(b.end || ""))
    || String(a.title || "").localeCompare(String(b.title || ""));
}

function mergeCalendarClockEvents(calendarEvents, taskEvents) {
  const seen = new Set();
  return [...calendarEvents, ...taskEvents]
    .filter(event => {
      const key = getCalendarClockEventIdentity(event);
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareCalendarClockEventsChronologically);
}

function clearCalendarClockBadge() {
  chrome.action.setBadgeText({ text: "" });
}

function getFeedSource(previousSource, fallbackSource) {
  if (previousSource && typeof previousSource === "object") return previousSource;
  if (fallbackSource && typeof fallbackSource === "object") return fallbackSource;
  return null;
}

function getSourceCapturedAt(source) {
  const capturedAt = Number(source?.capturedAt);
  return Number.isFinite(capturedAt) && capturedAt > 0 ? capturedAt : 0;
}

function normalizeCaptureMetaEntry(entry, fallbackSource, fallbackShownCount) {
  if (!entry || typeof entry !== "object") {
    return {
      source: fallbackSource,
      limit: Math.max(1, fallbackShownCount || 1),
      parsedCount: fallbackShownCount,
      shownCount: fallbackShownCount,
      omittedCount: 0
    };
  }

  const shownCount = Math.max(0, Math.round(Number(entry.shownCount) || fallbackShownCount || 0));
  const omittedCount = Math.max(0, Math.round(Number(entry.omittedCount) || 0));
  const parsedCount = Math.max(shownCount, Math.round(Number(entry.parsedCount) || shownCount + omittedCount));
  return {
    source: String(entry.source || fallbackSource),
    limit: Math.max(1, Math.round(Number(entry.limit) || shownCount || 1)),
    parsedCount,
    shownCount,
    omittedCount: Math.max(omittedCount, parsedCount - shownCount)
  };
}

function getCaptureOmittedCount(captureMeta) {
  return [captureMeta?.calendar, captureMeta?.task]
    .filter(Boolean)
    .reduce((total, entry) => total + (Math.max(0, Math.round(Number(entry.omittedCount) || 0))), 0);
}

function getCalendarClockStoreContext(value, expectedContext) {
  if (calendarClockTemporalProjection?.isValidContext?.(expectedContext)) return expectedContext;
  const candidate = calendarClockTemporalProjection?.createContext?.(value?.calendarTimeZone);
  return candidate?.ok && candidate.value.fingerprint === value?.contextFingerprint ? candidate.value : null;
}

function makeEmptyCalendarClockEventStore(context) {
  return {
    version: CALENDAR_CLOCK_EVENT_STORE_VERSION,
    projectionPolicyVersion: context?.projectionPolicyVersion || calendarClockTemporalProjection?.PROJECTION_POLICY_VERSION || 0,
    calendarTimeZone: context?.calendarTimeZone || "",
    contextFingerprint: context?.fingerprint || "",
    updatedAt: 0,
    entries: []
  };
}

function normalizeCalendarClockEventStore(value, expectedContext) {
  const context = getCalendarClockStoreContext(value, expectedContext);
  if (!context || value?.version !== CALENDAR_CLOCK_EVENT_STORE_VERSION || value?.contextFingerprint !== context.fingerprint) {
    return makeEmptyCalendarClockEventStore(context || expectedContext);
  }
  const seen = new Set();
  const entries = (Array.isArray(value.entries) ? value.entries : [])
    .filter(entry => entry && calendarClockTemporalProjection.validateEvent(entry.event, context))
    .sort((left, right) => Number(right.lastSeenAt) - Number(left.lastSeenAt))
    .filter(entry => {
      const key = entry.event.temporal.occurrenceKey;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, CALENDAR_CLOCK_EVENT_STORE_MAX_EVENTS)
    .map(entry => ({
      event: entry.event,
      lastSeenAt: Math.max(0, Number(entry.lastSeenAt) || 0),
      sourceUrl: String(entry.sourceUrl || "").slice(0, 2048)
    }));
  return { ...makeEmptyCalendarClockEventStore(context), updatedAt: Math.max(0, Number(value.updatedAt) || 0), entries };
}

function evictCalendarClockDeletedEventsFromStore(value, deletedEventIds, expectedContext) {
  // Explicit tombstones are authoritative independently of capture-view dates.
  const store = normalizeCalendarClockEventStore(value, expectedContext);
  const deletedIds = new Set(normalizeCalendarClockDeletedEventIds(deletedEventIds));
  if (deletedIds.size) store.entries = store.entries.filter(entry => !deletedIds.has(String(entry.event?.id || "").trim()));
  return store;
}

function normalizeCalendarClockDateKeys(dateKeys) {
  return calendarClockTemporalProjection?.normalizeDateKeys?.(dateKeys) || [];
}

function getCaptureViewDateKeys(captureView) {
  return normalizeCalendarClockDateKeys(captureView?.visibleDateKeys);
}

function canCalendarClockCaptureViewPurgeMissingDates(captureView) {
  if (captureView?.canClearMissingDates !== true
      || !CALENDAR_CLOCK_PURGE_DATE_KEY_SOURCES.has(captureView?.dateKeySource)
      || !getCaptureViewDateKeys(captureView).length) return false;
  return captureView.dateKeySource !== "dated-url" || /^(day|week)$/.test(String(captureView?.mode || ""));
}

function filterCalendarEventsToCaptureView(events, captureView, expectedContext) {
  const canonical = (Array.isArray(events) ? events : []).filter(event => calendarClockTemporalProjection?.validateEvent?.(event, expectedContext));
  const visibleDateKeys = getCaptureViewDateKeys(captureView);
  if (!visibleDateKeys.length) return canonical;
  return canonical.filter(event => calendarClockTemporalProjection.overlapsDateKeys(event, visibleDateKeys));
}

function pruneCalendarClockEventStore(store, maxEvents = CALENDAR_CLOCK_EVENT_STORE_MAX_EVENTS) {
  const limit = Math.max(0, Math.round(Number(maxEvents) || 0));
  store.entries = store.entries
    .slice()
    .sort((left, right) => Number(right.lastSeenAt) - Number(left.lastSeenAt)
      || calendarClockTemporalProjection.compareEvents(left.event, right.event))
    .slice(0, limit);
  return store;
}

function limitCalendarClockEventStoreEvents(store, maxEvents, expectedContext) {
  return pruneCalendarClockEventStore(normalizeCalendarClockEventStore(store, expectedContext), maxEvents);
}

function getCalendarClockStorageRetryEventLimits(store) {
  const eventCount = Array.isArray(store?.entries) ? store.entries.length : 0;
  return CALENDAR_CLOCK_STORAGE_RETRY_EVENT_LIMITS.filter(limit => limit < eventCount);
}

function makeCalendarClockStorageStatus(originalStore, storedStore) {
  const originalEventCount = Array.isArray(originalStore?.entries) ? originalStore.entries.length : 0;
  const retainedEventCount = Array.isArray(storedStore?.entries) ? storedStore.entries.length : 0;
  const removedEventCount = Math.max(0, originalEventCount - retainedEventCount);
  return removedEventCount
    ? { kind: "history-trimmed", retainedEventCount, removedEventCount }
    : null;
}

function isCalendarClockStorageQuotaError(error) {
  return /quota|storage.*full|exceed/i.test(String(error?.message || error || ""));
}

function updateCalendarClockEventStore(previousStore, freshEvents, captureView, capturedAt, sourceUrl, context) {
  const store = normalizeCalendarClockEventStore(previousStore, context);
  const canonicalFreshEvents = (Array.isArray(freshEvents) ? freshEvents : [])
    .filter(event => calendarClockTemporalProjection?.validateEvent?.(event, context));
  const viewDateKeys = getCaptureViewDateKeys(captureView);
  const freshKeys = new Set(canonicalFreshEvents.map(event => event.temporal.occurrenceKey));
  const freshKeysByStableId = new Map();
  canonicalFreshEvents.forEach(event => {
    const stableId = getCalendarClockStableEventId(event);
    if (!stableId) return;
    if (!freshKeysByStableId.has(stableId)) freshKeysByStableId.set(stableId, new Set());
    freshKeysByStableId.get(stableId).add(event.temporal.occurrenceKey);
  });
  // A Calendar drag keeps the event ID but changes its occurrence key. This
  // replacement is authoritative from the fresh record and does not depend on
  // how the visible date scope was discovered.
  store.entries = store.entries.filter(entry => {
    const occurrenceKey = entry.event.temporal.occurrenceKey;
    const freshKeysForStableId = freshKeysByStableId.get(getCalendarClockStableEventId(entry.event));
    return !freshKeysForStableId || freshKeysForStableId.has(occurrenceKey);
  });
  if (canCalendarClockCaptureViewPurgeMissingDates(captureView)) {
    store.entries = store.entries.filter(entry => (
      !calendarClockTemporalProjection.overlapsDateKeys(entry.event, viewDateKeys)
      || freshKeys.has(entry.event.temporal.occurrenceKey)
    ));
  }
  const entriesByKey = new Map(store.entries.map(entry => [entry.event.temporal.occurrenceKey, entry]));
  canonicalFreshEvents.forEach(event => {
    entriesByKey.set(event.temporal.occurrenceKey, { event, lastSeenAt: capturedAt, sourceUrl });
  });
  store.entries = Array.from(entriesByKey.values());

  store.updatedAt = capturedAt;
  return pruneCalendarClockEventStore(store);
}

function getCalendarClockStoredEventsForDateKeys(store, dateKeys, expectedContext) {
  const normalizedDateKeys = normalizeCalendarClockDateKeys(dateKeys);
  if (!normalizedDateKeys.length) return [];
  return normalizeCalendarClockEventStore(store, expectedContext).entries
    .map(entry => entry.event)
    .filter(event => calendarClockTemporalProjection.overlapsDateKeys(event, normalizedDateKeys));
}

function getCalendarClockAllStoredEvents(store, expectedContext) {
  return normalizeCalendarClockEventStore(store, expectedContext).entries.map(entry => entry.event);
}

function getCalendarClockEventsForDateKeys(events, dateKeys, expectedContext) {
  const normalizedDateKeys = normalizeCalendarClockDateKeys(dateKeys);
  const canonical = (Array.isArray(events) ? events : []).filter(event => calendarClockTemporalProjection?.validateEvent?.(event, expectedContext));
  if (!normalizedDateKeys.length) return canonical;
  return canonical.filter(event => calendarClockTemporalProjection.overlapsDateKeys(event, normalizedDateKeys));
}

function parseCalendarClockWindowRange(windowStartDate, windowEndDate) {
  const start = calendarClockTemporalProjection?.parseAbsoluteInstant?.(windowStartDate);
  const end = calendarClockTemporalProjection?.parseAbsoluteInstant?.(windowEndDate);
  return start && end && end.milliseconds > start.milliseconds
    ? { startDate: new Date(start.milliseconds), endDate: new Date(end.milliseconds) }
    : null;
}

function filterCalendarClockEventsToWindowRange(events, windowStartDate, windowEndDate, displayDateKeys = [], expectedContext) {
  const range = parseCalendarClockWindowRange(windowStartDate, windowEndDate);
  const canonical = (Array.isArray(events) ? events : []).filter(event => calendarClockTemporalProjection?.validateEvent?.(event, expectedContext));
  if (!range) return [];
  return canonical.filter(event => calendarClockTemporalProjection.overlapsInstantRange(
    event,
    range.startDate.toISOString(),
    range.endDate.toISOString(),
    displayDateKeys
  ));
}

function getCalendarClockStoredEventsForWindow(store, displayDateKeys, windowStartDate, windowEndDate, expectedContext) {
  if (parseCalendarClockWindowRange(windowStartDate, windowEndDate)) {
    return filterCalendarClockEventsToWindowRange(
      getCalendarClockAllStoredEvents(store, expectedContext),
      windowStartDate,
      windowEndDate,
      displayDateKeys,
      expectedContext
    );
  }
  return getCalendarClockStoredEventsForDateKeys(store, displayDateKeys, expectedContext);
}

function getEffectiveCalendarEvents(freshDisplayEvents, store, displayDateKeys, windowStartDate, windowEndDate, expectedContext) {
  const storedEvents = getCalendarClockStoredEventsForWindow(store, displayDateKeys, windowStartDate, windowEndDate, expectedContext);
  if (!storedEvents.length) return sortCalendarClockEvents(freshDisplayEvents);
  const freshStableIds = new Set((Array.isArray(freshDisplayEvents) ? freshDisplayEvents : [])
    .map(getCalendarClockStableEventId)
    .filter(Boolean));
  // Do not merge a stored occurrence back in after the fresh snapshot replaced it.
  const reconciledStoredEvents = storedEvents.filter(event => {
    const stableId = getCalendarClockStableEventId(event);
    return !stableId || !freshStableIds.has(stableId);
  });
  return sortCalendarClockEvents(mergeCalendarClockEvents(freshDisplayEvents, reconciledStoredEvents));
}

function getCalendarClockEffectiveEventsForSource(_activeSource, freshDisplayEvents, store, displayDateKeys, windowStartDate, windowEndDate, expectedContext) {
  // The fresh page-owned snapshot is authoritative only for Google Calendar's
  // visible dates. The clock window can cross into an adjacent, hidden week,
  // so keep relevant occurrences from the bounded canonical store as well.
  return getEffectiveCalendarEvents(freshDisplayEvents, store, displayDateKeys, windowStartDate, windowEndDate, expectedContext);
}

function shouldResetCalendarClockEventStore(previousFeedMode, nextFeedMode, previousActiveSource, nextActiveSource, hasCalendarEvents = true) {
  if (!hasCalendarEvents) return false;
  return previousFeedMode !== nextFeedMode || previousActiveSource !== nextActiveSource;
}

function shouldSuppressCalendarClockDomTaskFeed(overlayState) {
  return overlayState?.pageOwnedInfo === true;
}

clearCalendarClockBadge();
chrome.runtime.onInstalled.addListener(clearCalendarClockBadge);
chrome.runtime.onStartup.addListener(clearCalendarClockBadge);

function writeCalendarClockFeedToStorage(storageData, calendarEventStore, onSuccess, onFailure) {
  const retryEventLimits = [null, ...getCalendarClockStorageRetryEventLimits(calendarEventStore)];

  function attemptWrite(attemptIndex) {
    const eventLimit = retryEventLimits[attemptIndex];
    const storedEventStore = eventLimit === null
      ? calendarEventStore
      : limitCalendarClockEventStoreEvents(calendarEventStore, eventLimit);
    const storageStatus = makeCalendarClockStorageStatus(calendarEventStore, storedEventStore);

    try {
      chrome.storage.local.set({
        ...storageData,
        calendarClockCalendarEventStore: storedEventStore,
        calendarClockStorageStatus: storageStatus
      }, () => {
        const storageError = chrome.runtime.lastError;
        if (!storageError) {
          onSuccess(storageStatus);
          return;
        }

        if (isCalendarClockStorageQuotaError(storageError) && attemptIndex + 1 < retryEventLimits.length) {
          attemptWrite(attemptIndex + 1);
          return;
        }

        onFailure({
          kind: "write-failed",
          message: String(storageError.message || storageError)
        });
      });
    } catch (error) {
      onFailure({
        kind: "write-failed",
        message: String(error?.message || error)
      });
    }
  }

  attemptWrite(0);
}

function validateCalendarClockTemporalFeed(partial) {
  if (!calendarClockTemporalProjection) {
    return { ok: false, message: calendarClockTemporalProjectionDiagnostic };
  }
  const context = partial?.temporalContext;
  if (!calendarClockTemporalProjection.isValidContext(context)) {
    return { ok: false, message: "Missing or invalid Calendar temporal projection context." };
  }
  if (String(partial.timeZone || "").trim() !== context.calendarTimeZone) {
    return { ok: false, message: "Calendar timezone does not match the canonical projection context." };
  }
  const calendarEvents = Array.isArray(partial.calendarEvents) ? partial.calendarEvents : [];
  if (!calendarEvents.every(event => calendarClockTemporalProjection.validateEvent(event, context))) {
    return { ok: false, message: "Calendar event snapshot failed canonical temporal contract validation." };
  }
  if (partial.calendarDisplayEvents !== null
      && partial.calendarDisplayEvents !== undefined
      && (!Array.isArray(partial.calendarDisplayEvents)
        || !partial.calendarDisplayEvents.every(event => calendarClockTemporalProjection.validateEvent(event, context)))) {
    return { ok: false, message: "Calendar display snapshot failed canonical temporal contract validation." };
  }
  const dateLists = [partial.calendarCaptureView?.visibleDateKeys, partial.displayDateKeys]
    .filter(value => value !== undefined);
  if (dateLists.some(value => !Array.isArray(value)
      || value.some(dateKey => !calendarClockTemporalProjection.isDateKey(dateKey)))) {
    return { ok: false, message: "Capture view contains an invalid civil date key." };
  }
  const dateKeySource = partial.calendarCaptureView?.dateKeySource;
  if (dateKeySource !== undefined && !CALENDAR_CLOCK_CAPTURE_DATE_KEY_SOURCES.has(dateKeySource)) {
    return { ok: false, message: "Capture view contains an invalid date-key provenance." };
  }
  if (partial.calendarCaptureView?.canClearMissingDates !== undefined
      && typeof partial.calendarCaptureView.canClearMissingDates !== "boolean") {
    return { ok: false, message: "Capture view contains an invalid missing-date purge flag." };
  }
  if (!parseCalendarClockWindowRange(partial.windowStartDate, partial.windowEndDate)) {
    return { ok: false, message: "Capture view contains an invalid absolute window interval." };
  }
  return { ok: true, context };
}

function saveCalendarClockFeed(partial, sender, sendResponse) {
  const hasCalendarEvents = Object.prototype.hasOwnProperty.call(partial, "calendarEvents");
  const temporalFeed = hasCalendarEvents ? validateCalendarClockTemporalFeed(partial) : null;
  if (hasCalendarEvents && !temporalFeed.ok) {
    sendResponse({
      ok: false,
      error: temporalFeed.message,
      temporalDiagnostic: { phase: "rejected", reason: temporalFeed.message }
    });
    return;
  }
  chrome.storage.local.get(
    [
      "calendarClockCalendarEvents",
      "calendarClockTaskEvents",
      "calendarClockEvents",
      "calendarClockSource",
      "calendarClockCalendarSource",
      "calendarClockTaskSource",
      "calendarClockCaptureMeta",
      "calendarClockCalendarEventStore",
      "calendarClockFeedMode",
      "calendarClockActiveSource",
      "calendarClockOverlayState"
    ],
    result => {
      const hasTaskEvents = Object.prototype.hasOwnProperty.call(partial, "taskEvents");
      const temporalContext = temporalFeed?.context || null;
      const feedMode = hasCalendarEvents
        ? (partial.feedMode === "page-owned" ? "page-owned" : "dom")
        : (result.calendarClockFeedMode || "dom");
      const previousActiveSource = String(result.calendarClockActiveSource
        || result.calendarClockSource?.effectiveSource?.activeSource
        || "google-calendar-dom");
      const activeSource = hasCalendarEvents
        ? String(partial.effectiveSource?.activeSource || partial.calendarCaptureMeta?.source || "google-calendar-dom").slice(0, 100)
        : previousActiveSource;
      // Suppress the Tasks iframe only when page-owned mode is explicitly on.
      // A missing setting is non-authoritative and must fail open for Tasks.
      if (hasTaskEvents && shouldSuppressCalendarClockDomTaskFeed(result.calendarClockOverlayState)) {
        sendResponse({ ok: true, ignored: true, reason: "page-owned mode suppresses DOM Tasks feed" });
        return;
      }
      const resetCalendarEventStore = shouldResetCalendarClockEventStore(
        result.calendarClockFeedMode || "dom",
        feedMode,
        previousActiveSource,
        activeSource,
        hasCalendarEvents
      );
      const previousEvents = Array.isArray(result.calendarClockEvents) ? result.calendarClockEvents : [];
      const previousSource = result.calendarClockSource;
      const capturedAt = Date.now();
      const sourceUrl = partial.sourceUrl || sender.url || sender.tab?.url || "https://calendar.google.com/";
      const captureLimit = normalizeCalendarClockCaptureLimit(
        partial.captureLimit ?? result.calendarClockOverlayState?.captureLimit
      );
      const previousCaptureMeta = result.calendarClockCaptureMeta && typeof result.calendarClockCaptureMeta === "object"
        ? result.calendarClockCaptureMeta
        : previousSource?.captureMeta || {};
      const deletedEventIds = normalizeCalendarClockDeletedEventIds(partial.deletedEventIds);
      const deletedEventIdSet = new Set(deletedEventIds);
      const freshCalendarEvents = hasCalendarEvents
        ? filterCalendarEventsToCaptureView(
          removeCalendarClockDeletedEvents(partial.calendarEvents, deletedEventIdSet),
          partial.calendarCaptureView,
          temporalContext
        )
        : null;
      const freshCalendarDisplayEvents = hasCalendarEvents
        ? Array.isArray(partial.calendarDisplayEvents)
          ? filterCalendarEventsToCaptureView(
            removeCalendarClockDeletedEvents(partial.calendarDisplayEvents, deletedEventIdSet),
            partial.calendarCaptureView,
            temporalContext
          )
          : getCalendarClockEventsForDateKeys(freshCalendarEvents, partial.displayDateKeys, temporalContext)
        : null;
      const freshWindowCalendarEvents = hasCalendarEvents
        ? filterCalendarClockEventsToWindowRange(
          freshCalendarDisplayEvents,
          partial.windowStartDate,
          partial.windowEndDate,
          partial.displayDateKeys,
          temporalContext
        )
        : null;
      const calendarEventStore = hasCalendarEvents
        ? updateCalendarClockEventStore(
          evictCalendarClockDeletedEventsFromStore(
            resetCalendarEventStore ? null : result.calendarClockCalendarEventStore,
            deletedEventIds,
            temporalContext
          ),
          freshCalendarEvents,
          partial.calendarCaptureView,
          capturedAt,
          sourceUrl,
          temporalContext
        )
        : normalizeCalendarClockEventStore(result.calendarClockCalendarEventStore);
      const effectiveCalendarEvents = hasCalendarEvents
        ? getCalendarClockEffectiveEventsForSource(
          activeSource,
          freshWindowCalendarEvents,
          calendarEventStore,
          partial.displayDateKeys,
          partial.windowStartDate,
          partial.windowEndDate,
          temporalContext
        )
        : (Array.isArray(result.calendarClockCalendarEvents)
          ? result.calendarClockCalendarEvents
          : previousEvents.filter(event => event.capturedFrom !== "google-tasks-dom"))
          .filter(event => calendarClockTemporalProjection?.validateEvent?.(
            event,
            getCalendarClockStoreContext(calendarEventStore)
          ));
      const calendarEvents = hasCalendarEvents
        ? limitCalendarClockEffectiveEvents(effectiveCalendarEvents, captureLimit)
        : effectiveCalendarEvents;
      const taskEvents = feedMode === "page-owned"
        ? []
        : partial.taskEvents ?? (resetCalendarEventStore ? [] : (Array.isArray(result.calendarClockTaskEvents) ? result.calendarClockTaskEvents : []));
      const events = mergeCalendarClockEvents(calendarEvents, taskEvents);
      const previousCalendarSource = getFeedSource(result.calendarClockCalendarSource, previousSource?.calendarCapturedAt
        ? { url: previousSource.calendarUrl || previousSource.url, capturedAt: previousSource.calendarCapturedAt, count: previousSource.calendarCount, captureMeta: previousCaptureMeta.calendar }
        : null);
      const previousTaskSource = feedMode === "page-owned" ? null : getFeedSource(result.calendarClockTaskSource, previousSource?.taskCapturedAt
        ? { url: previousSource.taskUrl || previousSource.url, capturedAt: previousSource.taskCapturedAt, count: previousSource.taskCount, captureMeta: previousCaptureMeta.task }
        : null);
      const calendarMeta = hasCalendarEvents
        ? normalizeCaptureMetaEntry({
          ...(partial.calendarCaptureMeta || {}),
          limit: captureLimit,
          parsedCount: effectiveCalendarEvents.length,
          shownCount: calendarEvents.length,
          omittedCount: Math.max(0, effectiveCalendarEvents.length - calendarEvents.length)
        }, partial.calendarCaptureMeta?.source || "google-calendar-dom", calendarEvents.length)
        : (previousCalendarSource?.captureMeta || previousCaptureMeta.calendar || null);
      const taskMeta = feedMode === "page-owned"
        ? null
        : hasTaskEvents
        ? normalizeCaptureMetaEntry(partial.taskCaptureMeta, "google-tasks-dom", taskEvents.length)
        : (previousTaskSource?.captureMeta || previousCaptureMeta.task || null);
      const captureMeta = {
        calendar: calendarMeta,
        task: taskMeta
      };
      const calendarSource = hasCalendarEvents
        ? {
          url: sourceUrl,
          capturedAt,
          count: calendarEvents.length,
          timeZone: String(partial.timeZone || "").trim(),
          temporalContext,
          contextFingerprint: temporalContext?.fingerprint || "",
          systemTimeZone: String(partial.systemTimeZone || "").trim(),
          feedMode,
          effectiveSource: partial.effectiveSource || null,
          captureMeta: calendarMeta
        }
        : previousCalendarSource;
      const taskSource = feedMode === "page-owned"
        ? null
        : hasTaskEvents
        ? { url: sourceUrl, capturedAt, count: taskEvents.length, captureMeta: taskMeta }
        : previousTaskSource;
      const combinedCapturedAt = Math.max(
        getSourceCapturedAt(calendarSource),
        getSourceCapturedAt(taskSource),
        getSourceCapturedAt(previousSource)
      );
      const timeZone = String(partial.timeZone || calendarSource?.timeZone || previousSource?.timeZone || "").trim();
      const systemTimeZone = String(partial.systemTimeZone || calendarSource?.systemTimeZone || previousSource?.systemTimeZone || "").trim();
      const source = {
        url: sourceUrl,
        capturedAt: combinedCapturedAt || capturedAt,
        count: events.length,
        calendarCount: calendarEvents.length,
        taskCount: taskEvents.length,
        calendarCapturedAt: getSourceCapturedAt(calendarSource) || null,
        taskCapturedAt: getSourceCapturedAt(taskSource) || null,
        calendarUrl: calendarSource?.url || "",
        taskUrl: taskSource?.url || "",
        timeZone,
        systemTimeZone,
        temporalContext: temporalContext || calendarSource?.temporalContext || previousSource?.temporalContext || null,
        contextFingerprint: temporalContext?.fingerprint || calendarSource?.contextFingerprint || previousSource?.contextFingerprint || "",
        feedMode,
        effectiveSource: partial.effectiveSource || calendarSource?.effectiveSource || null,
        captureMeta,
        omittedCount: getCaptureOmittedCount(captureMeta),
        calendarOmittedCount: calendarMeta?.omittedCount || 0,
        taskOmittedCount: taskMeta?.omittedCount || 0
      };

      writeCalendarClockFeedToStorage({
        calendarClockCalendarEvents: calendarEvents,
        calendarClockTaskEvents: taskEvents,
        calendarClockEvents: events,
        calendarClockSource: source,
        calendarClockCalendarSource: calendarSource,
        calendarClockTaskSource: taskSource,
        calendarClockCaptureMeta: captureMeta,
        calendarClockFeedMode: feedMode,
        calendarClockActiveSource: activeSource
      }, calendarEventStore, storageStatus => {
        clearCalendarClockBadge();
        sendResponse({
          ok: true,
          count: events.length,
          events,
          calendarEvents,
          calendarCount: calendarEvents.length,
          taskCount: taskEvents.length,
          captureMeta,
          storageStatus
        });
      }, storageStatus => {
        sendResponse({
          ok: false,
          error: storageStatus.message || "Calendar Clock could not save this snapshot.",
          storageStatus
        });
      });
    }
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const events = Array.isArray(message?.events) ? message.events : [];

  if (message?.type === "CALENDAR_CLOCK_CREATE_AUDIO_BRIDGE_TOKEN") {
    const bridge = createCalendarClockAudioBridgeToken(sender);
    sendResponse(bridge ? { ok: true, ...bridge } : { ok: false, error: "Untrusted audio storage requester." });
    return false;
  }

  if (message?.type === "CALENDAR_CLOCK_VALIDATE_AUDIO_BRIDGE_TOKEN") {
    sendResponse({ ok: validateCalendarClockAudioBridgeToken(message.token, sender) });
    return false;
  }

  if (message?.type === "CALENDAR_CLOCK_HARD_REFRESH_EVENTS") {
    const requestedTabId = Number(message.tabId);
    const tabId = Number.isInteger(requestedTabId) ? requestedTabId : sender?.tab?.id;
    hardRefreshCalendarClockEvents(tabId, sendResponse);
    return true;
  }

  if (message?.type === "CALENDAR_CLOCK_EVENTS") {
    saveCalendarClockFeed({
      calendarEvents: events,
      calendarDisplayEvents: Array.isArray(message.displayEvents) ? message.displayEvents : null,
      sourceUrl: message.url,
      calendarCaptureView: message.captureView,
      displayDateKeys: message.displayDateKeys,
      windowStartDate: message.windowStartDate,
      windowEndDate: message.windowEndDate,
      timeZone: message.timeZone,
      systemTimeZone: message.systemTimeZone,
      temporalContext: message.temporalContext,
      calendarCaptureMeta: message.captureMeta?.calendar || message.captureMeta,
      captureLimit: message.captureLimit,
      feedMode: message.feedMode,
      effectiveSource: message.effectiveSource,
      deletedEventIds: message.deletedEventIds
    }, sender, sendResponse);
    return true;
  }

  if (message?.type === "CALENDAR_CLOCK_TASKS") {
    const tasks = Array.isArray(message.tasks) ? message.tasks : [];
    saveCalendarClockFeed({
      taskEvents: tasks,
      taskCaptureMeta: message.captureMeta?.task || message.captureMeta
    }, sender, sendResponse);
    return true;
  }

  return false;
});
