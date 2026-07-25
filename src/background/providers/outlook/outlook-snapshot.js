// Stores Outlook independently from the Google Calendar + Tasks feed.
(() => {
  const provider = globalThis.CalendarClockProviders?.get?.("outlook");
  if (!provider) return;
  const STORAGE_KEYS = Object.freeze([
    provider.eventsStorageKey,
    provider.canonicalEventsStorageKey,
    provider.presenceOverlayStorageKey,
    provider.sourceStorageKey,
    "calendarClockOutlookCaptureMeta",
    "calendarClockOutlookStorageStatus"
  ]);
  const CAPTURE_LIMITS = new Set([50, 100, 200]);
  const FEED_MODES = new Set(["dom", "page-owned"]);
  const SOURCE_IDS = new Set([provider.sourceId, provider.structuredSourceId]);
  const PRESENCE_STATUSES = new Set(["inactive", "observing", "active"]);
  const MAX_CANONICAL_EVENTS = 200;
  const latestCommitBySource = new Map();
  const currentOwnerByTab = new Map();
  let mutationQueue = Promise.resolve();

  function isTrustedSender(sender) {
    try {
      const url = new URL(sender?.url || sender?.tab?.url || "");
      return url.protocol === "https:"
        && url.hostname === "outlook.live.com"
        && Number.isInteger(sender?.tab?.id)
        && sender?.frameId === 0
        && typeof sender?.documentId === "string"
        && sender.documentId.length > 0
        && sender?.documentLifecycle === "active";
    } catch (_error) {
      return false;
    }
  }

  function makeSourceOwner(value) {
    const tabId = Number(value?.tabId);
    const documentId = String(value?.documentId || "").slice(0, 100);
    const sourceInstanceId = String(value?.sourceInstanceId || "").slice(0, 100);
    return Number.isInteger(tabId) && documentId && sourceInstanceId
      ? Object.freeze({ tabId, documentId, sourceInstanceId })
      : null;
  }

  function isSameSourceOwner(left, right) {
    return Boolean(left
      && right
      && left.tabId === right.tabId
      && left.documentId === right.documentId
      && left.sourceInstanceId === right.sourceInstanceId);
  }

  function isSameUrl(left, right) {
    try {
      return new URL(String(left || "")).href === new URL(String(right || "")).href;
    } catch (_error) {
      return false;
    }
  }

  function normalizeLimit(value) {
    const limit = Math.round(Number(value));
    return CAPTURE_LIMITS.has(limit) ? limit : 50;
  }

  function normalizeCaptureMeta(entry, events, limit, fallbackSource) {
    const shownCount = events.length;
    const parsedCount = Math.max(shownCount, Math.round(Number(entry?.parsedCount) || shownCount));
    return {
      source: SOURCE_IDS.has(entry?.source) ? entry.source : fallbackSource,
      limit,
      parsedCount,
      shownCount,
      omittedCount: Math.max(0, parsedCount - shownCount)
    };
  }

  function makeEventIdentity(event) {
    return [
      String(event?.id || ""),
      String(event?.temporal?.occurrenceKey || ""),
      String(event?.temporal?.startInstant || event?.startDate || ""),
      String(event?.temporal?.endInstant || event?.endDate || ""),
      String(event?.temporal?.firstDateKey || event?.date || "")
    ].join("|");
  }

  function normalizePresenceOverlay(value, canonicalEvents, feedMode, envelope, allowSuppression = true) {
    const canonicalIds = new Set(canonicalEvents.map(event => String(event?.id || "")).filter(Boolean));
    const canonicalIdCounts = canonicalEvents.reduce((counts, event) => {
      const id = String(event?.id || "");
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
      return counts;
    }, new Map());
    const status = PRESENCE_STATUSES.has(value?.status) ? value.status : "inactive";
    const rawSuppressedIds = Array.isArray(value?.suppressedIds)
      ? value.suppressedIds.map(id => String(id || "").slice(0, 256).trim()).filter(Boolean)
      : [];
    const suppressedIds = rawSuppressedIds.length <= MAX_CANONICAL_EVENTS
      ? Array.from(new Set(rawSuppressedIds
        .map(id => String(id || "").slice(0, 256).trim())
        .filter(id => id && canonicalIds.has(id))))
        .slice(0, MAX_CANONICAL_EVENTS)
        .sort()
      : [];
    const provenanceMatches = String(value?.sourceInstanceId || "") === envelope.sourceInstanceId
      && Math.round(Number(value?.observationSequence)) === envelope.observationSequence;
    const active = feedMode === "page-owned"
      && status === "active"
      && allowSuppression
      && Boolean(envelope.sourceInstanceId)
      && envelope.observationSequence > 0
      && provenanceMatches
      && rawSuppressedIds.length === suppressedIds.length
      && new Set(rawSuppressedIds).size === rawSuppressedIds.length
      && suppressedIds.every(id => canonicalIdCounts.get(id) === 1)
      && suppressedIds.length > 0;
    return {
      status: active ? "active" : status === "observing" && feedMode === "page-owned" ? "observing" : "inactive",
      reason: String(
        status === "active" && !allowSuppression
          ? "suppression requires exactly one open Outlook Calendar tab"
          : value?.reason || ""
      ).slice(0, 240),
      scope: String(value?.scope || "").slice(0, 500),
      suppressedIds: active ? suppressedIds : [],
      sourceInstanceId: envelope.sourceInstanceId,
      observationSequence: envelope.observationSequence,
      commitSequence: envelope.commitSequence
    };
  }

  function normalizeDisplayWindow(message, temporal) {
    const displayDateKeys = temporal.normalizeDateKeys?.(message?.displayDateKeys) || [];
    const windowStartDate = String(message?.windowStartDate || "");
    const windowEndDate = String(message?.windowEndDate || "");
    const startMilliseconds = Date.parse(windowStartDate);
    const endMilliseconds = Date.parse(windowEndDate);
    if (!displayDateKeys.length
        || !Number.isFinite(startMilliseconds)
        || !Number.isFinite(endMilliseconds)
        || endMilliseconds <= startMilliseconds) return null;
    return { displayDateKeys, windowStartDate, windowEndDate };
  }

  function deriveDisplayEvents(canonicalEvents, presenceOverlay, displayWindow) {
    const temporal = globalThis.CalendarClockTemporalProjection;
    const suppressedIds = presenceOverlay.status === "active"
      ? new Set(presenceOverlay.suppressedIds)
      : new Set();
    return canonicalEvents.filter(event =>
      !suppressedIds.has(String(event?.id || ""))
      && temporal.overlapsInstantRange(
        event,
        displayWindow.windowStartDate,
        displayWindow.windowEndDate,
        displayWindow.displayDateKeys
      )
    );
  }

  function haveSameEventIdentities(left, right) {
    if (left.length !== right.length) return false;
    const leftIdentities = left.map(makeEventIdentity).sort();
    const rightIdentities = right.map(makeEventIdentity).sort();
    return leftIdentities.every((identity, index) => identity === rightIdentities[index]);
  }

  function validateMessage(message, sender) {
    if (!isTrustedSender(sender)) return { ok: false, error: "Untrusted Outlook Calendar snapshot." };
    // sender.url stays at the document's load URL after Outlook pushState routes; tab.url follows them.
    // A route commit can still reach the browser after the snapshot; the sender retries.
    if (!isSameUrl(message?.url, sender.tab?.url)) {
      return { ok: false, retryable: true, error: "Outlook snapshot URL does not match its source document." };
    }
    const temporal = globalThis.CalendarClockTemporalProjection;
    const context = message?.temporalContext;
    if (!temporal?.isValidContext?.(context)) {
      return { ok: false, error: "Missing or invalid Outlook temporal projection context." };
    }
    if (String(message?.timeZone || "").trim() !== context.calendarTimeZone) {
      return { ok: false, error: "Outlook timezone does not match its projection context." };
    }

    const canonicalEvents = message?.events;
    const suppliedDisplayEvents = message?.displayEvents;
    if (!Array.isArray(canonicalEvents)
        || canonicalEvents.length > MAX_CANONICAL_EVENTS
        || !canonicalEvents.every(event => temporal.validateEvent(event, context))
        || !Array.isArray(suppliedDisplayEvents)
        || suppliedDisplayEvents.length > MAX_CANONICAL_EVENTS
        || !suppliedDisplayEvents.every(event => temporal.validateEvent(event, context))) {
      return { ok: false, error: "Outlook snapshot failed temporal contract validation." };
    }
    const displayWindow = normalizeDisplayWindow(message, temporal);
    if (!displayWindow) return { ok: false, error: "Outlook display window is invalid." };
    const sourceInstanceId = String(message?.sourceInstanceId || "").slice(0, 100).trim();
    const commitSequence = Math.round(Number(message?.commitSequence));
    const observationSequence = Math.max(0, Math.round(Number(message?.observationSequence) || 0));
    if (!Number.isInteger(commitSequence) || commitSequence <= 0) {
      return { ok: false, error: "Outlook snapshot commit sequence is invalid." };
    }
    return {
      ok: true,
      canonicalEvents,
      suppliedDisplayEvents,
      context,
      displayWindow,
      sourceInstanceId,
      commitSequence,
      observationSequence
    };
  }

  function getCurrentTab(tabId) {
    if (typeof chrome.tabs?.get !== "function") return Promise.resolve(null);
    return new Promise(resolve => {
      chrome.tabs.get(tabId, tab => {
        const tabError = chrome.runtime.lastError;
        resolve(tabError ? null : tab || null);
      });
    });
  }

  function countOpenOutlookTabs() {
    if (typeof chrome.tabs?.query !== "function") return Promise.resolve(null);
    return new Promise(resolve => {
      chrome.tabs.query({ url: "https://outlook.live.com/*" }, tabs => {
        const queryError = chrome.runtime.lastError;
        resolve(queryError || !Array.isArray(tabs) ? null : tabs.length);
      });
    });
  }

  function sortEvents(events) {
    const temporal = globalThis.CalendarClockTemporalProjection;
    return events.slice().sort((left, right) => temporal.compareEvents(left, right));
  }

  function save(message, sender, sendResponse) {
    const validation = validateMessage(message, sender);
    if (!validation.ok) {
      sendResponse(validation);
      return;
    }

    mutationQueue = mutationQueue.catch(() => undefined).then(async () => {
      const [currentTab, outlookTabCount] = await Promise.all([
        getCurrentTab(sender.tab.id),
        countOpenOutlookTabs()
      ]);
      return new Promise(resolve => {
      if (!currentTab || !isSameUrl(currentTab.url, message.url)) {
        sendResponse({ ok: false, retryable: true, error: "Outlook source document is no longer current." });
        resolve();
        return;
      }
      const limit = normalizeLimit(message.captureLimit);
      const canonicalEvents = sortEvents(validation.canonicalEvents).slice(0, MAX_CANONICAL_EVENTS);
      const capturedAt = Date.now();
      const feedMode = FEED_MODES.has(message.feedMode) ? message.feedMode : "dom";
      const envelope = {
        sourceInstanceId: validation.sourceInstanceId,
        commitSequence: validation.commitSequence,
        observationSequence: validation.observationSequence
      };
      const requestedPresenceOverlay = normalizePresenceOverlay(
        message.presenceOverlay,
        canonicalEvents,
        feedMode,
        envelope
      );
      const suppliedDerivation = sortEvents(
        deriveDisplayEvents(canonicalEvents, requestedPresenceOverlay, validation.displayWindow)
      );
      if (!haveSameEventIdentities(suppliedDerivation, validation.suppliedDisplayEvents)) {
        sendResponse({ ok: false, error: "Outlook effective display does not match the canonical derivation." });
        resolve();
        return;
      }
      const presenceOverlay = outlookTabCount === 1
        ? requestedPresenceOverlay
        : normalizePresenceOverlay(message.presenceOverlay, canonicalEvents, feedMode, envelope, false);
      const derivedDisplayEvents = sortEvents(
        deriveDisplayEvents(canonicalEvents, presenceOverlay, validation.displayWindow)
      );
      const failOpenPresence = normalizePresenceOverlay(
        { status: "inactive", reason: "persisted Outlook feed is always fail-open" },
        canonicalEvents,
        feedMode,
        envelope,
        false
      );
      const persistedEvents = sortEvents(
        deriveDisplayEvents(canonicalEvents, failOpenPresence, validation.displayWindow)
      ).slice(0, limit);
      const sequenceKey = [
        sender.tab.id,
        sender.documentId,
        validation.sourceInstanceId || "dom"
      ].join(":");
      const previousCommitSequence = latestCommitBySource.get(sequenceKey) || 0;
      if (validation.commitSequence <= previousCommitSequence) {
        sendResponse({ ok: false, error: "Stale Outlook snapshot commit was rejected." });
        resolve();
        return;
      }
      latestCommitBySource.set(sequenceKey, validation.commitSequence);
      const events = derivedDisplayEvents.slice(0, limit);
      const activeSource = SOURCE_IDS.has(message.effectiveSource?.activeSource)
        ? message.effectiveSource.activeSource
        : feedMode === "page-owned" ? provider.structuredSourceId : provider.sourceId;
      const calendarMeta = normalizeCaptureMeta(
        message.captureMeta?.calendar || message.captureMeta,
        persistedEvents,
        limit,
        activeSource
      );
      const captureMeta = { calendar: calendarMeta, task: null };
      const source = {
        provider: "outlook",
        url: String(message.url || sender.url || sender.tab?.url || ""),
        capturedAt,
        tabId: sender.tab.id,
        documentId: sender.documentId,
        count: persistedEvents.length,
        effectiveCount: events.length,
        canonicalCount: canonicalEvents.length,
        calendarCount: persistedEvents.length,
        taskCount: 0,
        timeZone: String(message.timeZone || "").trim(),
        systemTimeZone: String(message.systemTimeZone || "").trim(),
        temporalContext: validation.context,
        contextFingerprint: validation.context.fingerprint,
        sourceInstanceId: validation.sourceInstanceId,
        commitSequence: validation.commitSequence,
        observationSequence: validation.observationSequence,
        feedMode,
        effectiveSource: message.effectiveSource || null,
        presenceOverlay,
        displayDateKeys: validation.displayWindow.displayDateKeys,
        windowStartDate: validation.displayWindow.windowStartDate,
        windowEndDate: validation.displayWindow.windowEndDate,
        captureMeta,
        omittedCount: calendarMeta.omittedCount,
        calendarOmittedCount: calendarMeta.omittedCount,
        taskOmittedCount: 0
      };
      const values = {
        [provider.eventsStorageKey]: persistedEvents,
        [provider.canonicalEventsStorageKey]: canonicalEvents,
        [provider.presenceOverlayStorageKey]: presenceOverlay,
        [provider.sourceStorageKey]: source,
        calendarClockOutlookCaptureMeta: captureMeta,
        calendarClockOutlookStorageStatus: {
          kind: "ok",
          capturedAt,
          count: persistedEvents.length,
          effectiveCount: events.length,
          canonicalCount: canonicalEvents.length
        }
      };

      chrome.storage.local.set(values, () => {
        const storageError = chrome.runtime.lastError;
        if (storageError) {
          sendResponse({ ok: false, error: storageError.message || "Outlook snapshot could not be saved." });
          resolve();
          return;
        }
        const owner = makeSourceOwner(source);
        if (owner) currentOwnerByTab.set(owner.tabId, owner);
        chrome.action.setBadgeText({ text: "" });
        sendResponse({
          ok: true,
          count: events.length,
          events,
          canonicalEvents,
          calendarEvents: events,
          calendarCount: events.length,
          pageLocalEffective: true,
          presenceOverlay,
          taskCount: 0,
          captureMeta,
          storageStatus: values.calendarClockOutlookStorageStatus
        });
        resolve();
      });
      });
    });
  }

  function removeStoredSnapshot(reloadTabId, sendResponse) {
    mutationQueue = mutationQueue.catch(() => undefined).then(() => new Promise(resolve => {
      chrome.storage.local.remove(STORAGE_KEYS, () => {
        const storageError = chrome.runtime.lastError;
        if (storageError) {
          sendResponse({ ok: false, error: storageError.message || "Outlook snapshot could not be cleared." });
          resolve();
          return;
        }
        chrome.action.setBadgeText({ text: "" });
        sendResponse({ ok: true, reloading: reloadTabId !== null });
        if (reloadTabId === null) {
          resolve();
          return;
        }
        chrome.tabs.reload(reloadTabId, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      });
    }));
  }

  function clearSourceCommitHistory(tabId) {
    const prefix = `${tabId}:`;
    for (const key of latestCommitBySource.keys()) {
      if (key.startsWith(prefix)) latestCommitBySource.delete(key);
    }
  }

  function restoreFailOpenCompatibilityFeed({
    reason = "stored suppression expired when the background restarted",
    expectedOwner = null,
    releaseAnyOwner = false
  } = {}) {
    if (typeof chrome.storage?.local?.get !== "function") return Promise.resolve();
    return new Promise(resolve => {
      chrome.storage.local.get([
        provider.eventsStorageKey,
        provider.canonicalEventsStorageKey,
        provider.presenceOverlayStorageKey,
        provider.sourceStorageKey
      ], result => {
        const storageError = chrome.runtime.lastError;
        const storedPresence = result?.[provider.presenceOverlayStorageKey];
        const source = result?.[provider.sourceStorageKey] || {};
        const sourceOwner = makeSourceOwner(source);
        const commitSequence = Math.round(Number(source.commitSequence) || 0);
        if (sourceOwner && commitSequence > 0) {
          currentOwnerByTab.set(sourceOwner.tabId, sourceOwner);
          latestCommitBySource.set([
            sourceOwner.tabId,
            sourceOwner.documentId,
            sourceOwner.sourceInstanceId
          ].join(":"), commitSequence);
        }
        if (storageError
            || storedPresence?.status !== "active"
            || (!releaseAnyOwner && !isSameSourceOwner(sourceOwner, expectedOwner))) {
          resolve();
          return;
        }
        const context = source.temporalContext;
        const temporal = globalThis.CalendarClockTemporalProjection;
        const canonicalEvents = Array.isArray(result?.[provider.canonicalEventsStorageKey])
          ? result[provider.canonicalEventsStorageKey].filter(event => temporal?.validateEvent?.(event, context))
          : [];
        const displayWindow = normalizeDisplayWindow(source, temporal);
        const failOpenPresence = {
          status: "inactive",
          reason,
          scope: "",
          suppressedIds: [],
          sourceInstanceId: "",
          observationSequence: 0,
          commitSequence: 0
        };
        const limit = normalizeLimit(source?.captureMeta?.calendar?.limit);
        const events = sortEvents(displayWindow
          ? deriveDisplayEvents(canonicalEvents, failOpenPresence, displayWindow)
          : canonicalEvents).slice(0, limit);
        const activeSource = SOURCE_IDS.has(source?.effectiveSource?.activeSource)
          ? source.effectiveSource.activeSource
          : provider.structuredSourceId;
        const calendarMeta = normalizeCaptureMeta(
          source?.captureMeta?.calendar,
          events,
          limit,
          activeSource
        );
        const captureMeta = { calendar: calendarMeta, task: null };
        const releasedAt = Date.now();
        const nextSource = {
          ...source,
          count: events.length,
          effectiveCount: events.length,
          calendarCount: events.length,
          presenceOverlay: failOpenPresence,
          captureMeta,
          omittedCount: calendarMeta.omittedCount,
          calendarOmittedCount: calendarMeta.omittedCount
        };
        chrome.storage.local.set({
          [provider.eventsStorageKey]: events,
          [provider.presenceOverlayStorageKey]: failOpenPresence,
          [provider.sourceStorageKey]: nextSource,
          calendarClockOutlookCaptureMeta: captureMeta,
          calendarClockOutlookStorageStatus: {
            kind: "ok",
            capturedAt: releasedAt,
            count: events.length,
            effectiveCount: events.length,
            canonicalCount: canonicalEvents.length
          }
        }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      });
    });
  }

  function enqueueFailOpenRestore(options) {
    mutationQueue = mutationQueue
      .catch(() => undefined)
      .then(() => restoreFailOpenCompatibilityFeed(options));
  }

  function clear(tabId, sendResponse) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ ok: false, error: "Active Outlook Calendar tab is unavailable." });
      return;
    }
    removeStoredSnapshot(tabId, sendResponse);
  }

  function clearStored(sendResponse) {
    removeStoredSnapshot(null, sendResponse);
  }

  function handleMessage(message, sender, sendResponse) {
    if (message?.provider !== provider.id) return false;
    if (message.type === "CALENDAR_CLOCK_EVENTS") {
      save(message, sender, sendResponse);
      return true;
    }
    if (message.type === "CALENDAR_CLOCK_HARD_REFRESH_EVENTS") {
      const requestedTabId = Number(message.tabId);
      clear(Number.isInteger(requestedTabId) ? requestedTabId : sender?.tab?.id, sendResponse);
      return true;
    }
    if (message.type === "CALENDAR_CLOCK_CLEAR_STORED_EVENTS") {
      clearStored(sendResponse);
      return true;
    }
    return false;
  }

  const api = Object.freeze({
    save,
    clear,
    clearStored,
    handleMessage,
    storageKeys: STORAGE_KEYS
  });
  const handlers = globalThis.CalendarClockProviderSnapshotHandlers instanceof Map
    ? globalThis.CalendarClockProviderSnapshotHandlers
    : new Map();
  globalThis.CalendarClockProviderSnapshotHandlers = handlers;
  handlers.set(provider.id, api);
  enqueueFailOpenRestore({ releaseAnyOwner: true });

  if (chrome.tabs?.onRemoved?.addListener) {
    chrome.tabs.onRemoved.addListener(tabId => {
      if (!Number.isInteger(tabId)) return;
      const expectedOwner = currentOwnerByTab.get(tabId) || null;
      currentOwnerByTab.delete(tabId);
      clearSourceCommitHistory(tabId);
      enqueueFailOpenRestore({
        reason: "Outlook source tab closed; stored suppression was released",
        expectedOwner
      });
    });
  }

  if (chrome.tabs?.onUpdated?.addListener) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (!Number.isInteger(tabId)
          || (changeInfo?.status !== "loading" && typeof changeInfo?.url !== "string")) return;
      const expectedOwner = currentOwnerByTab.get(tabId) || null;
      clearSourceCommitHistory(tabId);
      enqueueFailOpenRestore({
        reason: "Outlook source navigation invalidated stored suppression",
        expectedOwner,
        releaseAnyOwner: !expectedOwner
          && globalThis.CalendarClockProviders?.matchesCalendarUrl?.(provider.id, changeInfo?.url)
      });
    });
  }

  if (chrome.tabs?.onCreated?.addListener) {
    chrome.tabs.onCreated.addListener(tab => {
      if (!globalThis.CalendarClockProviders?.matchesCalendarUrl?.(provider.id, tab?.url)) return;
      enqueueFailOpenRestore({
        reason: "multiple Outlook tabs invalidate stored suppression",
        releaseAnyOwner: true
      });
    });
  }
})();
