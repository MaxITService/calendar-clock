// MAIN-world observer for structured Outlook Web calendar responses.
(() => {
  const outlookAppearance = window.CalendarClockOutlookAppearance;
  const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
  const MAX_RECORDS = 200;
  const MAX_VISITED_NODES = 50000;
  const CONFIRMED_UPDATE_TTL_MS = 30000;
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const marker = Symbol.for("calendarClock.outlookPageOwnedHook.v1");
  if (window[marker]) return;
  Object.defineProperty(window, marker, { value: true, configurable: false });

  function normalizeText(value, maxLength = 500) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
  }

  function parseJsonText(value) {
    if (typeof value !== "string" || value.length > MAX_RESPONSE_CHARS || !value.trim()) return null;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  function isValidTimeZone(value) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
      return true;
    } catch (_error) {
      return false;
    }
  }

  function formatZoned(instant, timeZone) {
    if (!isValidTimeZone(timeZone)) return null;
    const date = new Date(instant);
    if (Number.isNaN(date.getTime())) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`
    };
  }

  function getOutlookTimeZone(payload) {
    const userOptions = payload?.owaUserConfig?.UserOptions;
    const requestedWindowsZone = normalizeText(userOptions?.TimeZone, 100);
    if (isValidTimeZone(requestedWindowsZone)) return requestedWindowsZone;
    if (!requestedWindowsZone) return "";
    const requestedWindowsZoneKey = requestedWindowsZone.toLocaleLowerCase();
    const offsetRecords = Array.isArray(userOptions?.MailboxTimeZoneOffset)
      ? userOptions.MailboxTimeZoneOffset
      : [];
    const matchingRecord = offsetRecords.find(record =>
      normalizeText(record?.TimeZoneId, 100).toLocaleLowerCase() === requestedWindowsZoneKey
    );
    const ianaZones = Array.isArray(matchingRecord?.IanaTimeZones) ? matchingRecord.IanaTimeZones : [];
    return ianaZones.find(isValidTimeZone) || "";
  }

  function extractCalendarFolders(payload) {
    const folders = new Map();
    const stack = [payload?.getCalendarFolders || payload];
    const seen = new WeakSet();
    let visited = 0;
    while (stack.length && visited < MAX_VISITED_NODES) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      const folderId = normalizeText(value?.FolderId?.Id, 256);
      const displayName = normalizeText(value?.DisplayName, 256);
      if (folderId && displayName) folders.set(folderId, displayName);
      Object.values(value).forEach(child => {
        if (child && typeof child === "object") stack.push(child);
      });
    }
    return folders;
  }

  function getSeriesMasterId(value) {
    return normalizeText(
      value?.SeriesMasterItemId?.Id
        || value?.RecurringMasterItemId?.Id
        || value?.SeriesMasterId?.Id
        || value?.RecurringMasterId?.Id,
      256
    );
  }

  function isCalendarItem(value) {
    const calendarItemType = normalizeText(value?.CalendarItemType, 80);
    const itemClass = normalizeText(value?.ItemClass, 120);
    return ["Single", "RecurringMaster", "Occurrence", "Exception"].includes(calendarItemType)
      || itemClass.startsWith("IPM.Appointment");
  }

  function isDisplayCalendarItem(value) {
    const calendarItemType = normalizeText(value?.CalendarItemType, 80);
    if (calendarItemType === "RecurringMaster") return false;
    return ["Single", "Occurrence", "Exception"].includes(calendarItemType)
      || normalizeText(value?.ItemClass, 120).startsWith("IPM.Appointment");
  }

  function makeCalendarRecord(value, timeZone, calendarFolders, categoryCatalog) {
    const id = normalizeText(value?.ItemId?.Id, 256);
    const startInstant = new Date(value?.Start);
    const endInstant = new Date(value?.End);
    if (!id
        || !isDisplayCalendarItem(value)
        || Number.isNaN(startInstant.getTime())
        || Number.isNaN(endInstant.getTime())
        || endInstant < startInstant
        || value?.IsCancelled === true
        || value?.IsSeriesCancelled === true) return null;

    const zonedStart = formatZoned(startInstant, timeZone);
    const zonedEnd = formatZoned(endInstant, timeZone);
    if (!zonedStart || !zonedEnd) return null;
    const isAllDay = value?.IsAllDayEvent === true;
    const durationKind = isAllDay ? "all-day" : endInstant.getTime() === startInstant.getTime() ? "point" : "range";
    if (isAllDay && zonedEnd.date <= zonedStart.date) return null;
    const parentFolderId = normalizeText(value?.ParentFolderId?.Id, 256);
    const seriesMasterId = getSeriesMasterId(value);
    const occurrenceKey = `${id}:${startInstant.toISOString()}`.slice(0, 512);
    const updatedInstant = new Date(value?.LastModifiedTime);
    const appearance = outlookAppearance?.resolveStructuredAppearance?.(value, categoryCatalog) || {
      categories: [],
      status: normalizeText(value?.FreeBusyType, 64),
      color: ""
    };

    return {
      id,
      cacheKey: occurrenceKey,
      domKey: `outlook-page-owned:${occurrenceKey}`.slice(0, 512),
      title: normalizeText(value?.Subject) || "(No title)",
      start: isAllDay ? "00:00" : zonedStart.time,
      end: isAllDay ? "00:00" : zonedEnd.time,
      durationKind,
      isPointEvent: durationKind === "point",
      isAllDay,
      date: zonedStart.date,
      endDateKey: zonedEnd.date,
      ...(isAllDay ? {
        allDayStartDateKey: zonedStart.date,
        allDayEndDateKeyExclusive: zonedEnd.date
      } : {
        startInstant: startInstant.toISOString(),
        endInstant: endInstant.toISOString(),
        startDate: startInstant.toISOString(),
        endDate: endInstant.toISOString()
      }),
      timeZone,
      status: appearance.status,
      categories: appearance.categories,
      color: appearance.color,
      calendar: parentFolderId,
      calendarName: calendarFolders.get(parentFolderId) || "",
      calendarItemType: normalizeText(value?.CalendarItemType, 80),
      itemClass: normalizeText(value?.ItemClass, 120),
      meetingStatus: value?.IsMeeting === false
        ? "appointment"
        : value?.IsMeeting === true
          ? "meeting"
          : "unknown",
      seriesMasterId,
      capturedFrom: "outlook-page-owned",
      sourceKind: "calendar-event",
      itemKind: "event",
      updatedAt: Number.isNaN(updatedInstant.getTime()) ? 0 : updatedInstant.getTime()
    };
  }

  function extractCalendarRecords(payload, timeZone, calendarFolders, categoryCatalog = new Map()) {
    const records = new Map();
    const stack = [payload];
    const seen = new WeakSet();
    let visited = 0;
    while (stack.length && visited < MAX_VISITED_NODES && records.size < MAX_RECORDS) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      const record = makeCalendarRecord(value, timeZone, calendarFolders, categoryCatalog);
      if (record) records.set(record.cacheKey, record);
      Object.values(value).forEach(child => {
        if (child && typeof child === "object") stack.push(child);
      });
    }
    return Array.from(records.values());
  }

  function extractCancelledRecordIds(payload) {
    const ids = new Set();
    const stack = [payload];
    const seen = new WeakSet();
    let visited = 0;
    while (stack.length && visited < MAX_VISITED_NODES && ids.size < MAX_RECORDS) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      if ((value?.IsCancelled === true || value?.IsSeriesCancelled === true)
          && isCalendarItem(value)) {
        const id = normalizeText(value?.ItemId?.Id, 256);
        if (id) ids.add(id);
      }
      Object.values(value).forEach(child => {
        if (child && typeof child === "object") stack.push(child);
      });
    }
    return Array.from(ids);
  }

  function forEachNode(root, visit, maxNodes = MAX_VISITED_NODES) {
    const stack = [[root, ""]];
    const seen = new WeakSet();
    let visited = 0;
    while (stack.length && visited < maxNodes) {
      const [value, key] = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      if (visit(value, key) === false) return;
      Object.entries(value).forEach(([childKey, child]) => {
        if (child && typeof child === "object") stack.push([child, childKey]);
      });
    }
  }

  // Exchange responses report per-message ResponseClass values; every one must succeed.
  function isSuccessfulResponse(payload) {
    const classes = [];
    forEachNode(payload, value => {
      if (typeof value.ResponseClass === "string") classes.push(value.ResponseClass);
    }, 2000);
    return classes.length > 0 && classes.every(value => value === "Success" || value === "Warning");
  }

  function getRequestTypeNames(request) {
    return [request?.Body?.__type, request?.__type].map(value => normalizeText(value, 200)).filter(Boolean);
  }

  function extractRequestItemIds(request) {
    const ids = new Set();
    forEachNode(request?.Body || request, (value, key) => {
      const id = normalizeText(value?.Id, 256);
      if (!id) return;
      if (/^(?:ItemId|OccurrenceItemId|RecurringMasterItemId)\b/.test(normalizeText(value.__type, 80))
          || /^(?:Event|Item)Ids?$/.test(key)) {
        ids.add(id);
      }
    }, 2000);
    return Array.from(ids).slice(0, MAX_RECORDS);
  }

  function extractRequestFolderIds(request) {
    const ids = new Set();
    forEachNode(request?.Body || request, value => {
      const id = normalizeText(value?.Id, 256);
      if (id && /^FolderId\b/.test(normalizeText(value.__type, 80))) ids.add(id);
    }, 2000);
    return ids;
  }

  // Deletions are confirmed by a successful response to a delete-like request; the response carries no item.
  function extractConfirmedRequestDeletion(request, payload) {
    if (!request || !getRequestTypeNames(request).some(name => /^(?:Delete|Cancel|Remove)\w*Request\b/.test(name))) return null;
    if (!isSuccessfulResponse(payload)) return null;
    const ids = extractRequestItemIds(request);
    if (!ids.length) return null;
    return { ids, seriesScope: getDeletionSeriesScope(request?.Body?.EventScope ?? request?.Body?.AffectedTaskOccurrences) };
  }

  // Observed EventScope: 0 single event, 1 this occurrence, 2 this and following, 3 whole series.
  function getDeletionSeriesScope(scope) {
    if (scope === 2 || /following/i.test(String(scope))) return "following";
    if (scope === 3 || /^All/i.test(String(scope))) return "series";
    return "";
  }

  // Update responses carry only ids; the full item arrives seconds later, the rendered event immediately.
  function extractConfirmedRequestUpdateIds(request, payload) {
    if (!request || !getRequestTypeNames(request).some(name => /^Update\w*Request\b/.test(name))) return [];
    return isSuccessfulResponse(payload) ? extractRequestItemIds(request) : [];
  }

  // A successful ranged view lists every item of its folders in that range.
  function extractAuthoritativeView(request, payload) {
    const start = Date.parse(request?.Body?.RangeStart);
    const end = Date.parse(request?.Body?.RangeEnd);
    const items = payload?.Body?.Items;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    if (!Array.isArray(items) || items.length >= MAX_RECORDS || !isSuccessfulResponse(payload)) return null;
    if (payload?.Body?.IncludesLastItemInRange === false) return null;
    const folderIds = extractRequestFolderIds(request);
    if (!folderIds.size) return null;
    const itemIds = new Set(items.map(item => normalizeText(item?.ItemId?.Id, 256)).filter(Boolean));
    return { start, end, folderIds, itemIds };
  }

  function recordOverlapsRange(record, start, end, timeZone) {
    if (record?.durationKind !== "all-day") {
      const recordStart = Date.parse(record?.startDate);
      const recordEnd = Date.parse(record?.endDate);
      if (!Number.isFinite(recordStart) || !Number.isFinite(recordEnd)) return false;
      return recordEnd > recordStart
        ? recordStart < end && recordEnd > start
        : recordStart >= start && recordStart < end;
    }
    const startKey = formatZoned(start, timeZone)?.date;
    const lastKey = formatZoned(end - 1, timeZone)?.date;
    if (!startKey || !lastKey) return false;
    return record.allDayStartDateKey <= lastKey && record.allDayEndDateKeyExclusive > startKey;
  }

  function findStaleViewRecordIds(cache, view, responseSequence, timeZone, folderCount) {
    const ids = new Set();
    cache.forEach(record => {
      if (view.itemIds.has(record.id)) return;
      if ((Number(record._responseSequence) || 0) >= responseSequence) return;
      const folderMatches = view.folderIds.has(record.calendar) || (!record.calendar && folderCount <= 1);
      if (folderMatches && recordOverlapsRange(record, view.start, view.end, timeZone)) ids.add(record.id);
    });
    return Array.from(ids);
  }

  function expandSeriesDeletion(cache, deletion) {
    if (!deletion.seriesScope) return deletion.ids;
    const ids = new Set(deletion.ids);
    deletion.ids.forEach(id => {
      const occurrence = Array.from(cache.values()).find(record => record.id === id);
      const seriesMasterId = occurrence?.seriesMasterId;
      if (!seriesMasterId) return;
      const occurrenceStart = deletion.seriesScope === "following" ? Date.parse(occurrence.startDate || "") || 0 : 0;
      cache.forEach(record => {
        if (record.seriesMasterId !== seriesMasterId) return;
        const recordStart = Date.parse(record.startDate || "") || 0;
        if (!occurrenceStart || !recordStart || recordStart >= occurrenceStart) ids.add(record.id);
      });
    });
    return Array.from(ids).slice(0, MAX_RECORDS);
  }

  function recordMatchesDeletedId(record, id) {
    return record?.id === id || record?.seriesMasterId === id;
  }

  function recordConfirmedOutlookDeletions(cache, tombstones, deletedIds, requestSequence, limit = MAX_RECORDS) {
    let removed = 0;
    deletedIds.forEach(id => {
      tombstones.delete(id);
      tombstones.set(id, Math.max(0, Number(requestSequence) || 0));
      Array.from(cache.entries()).forEach(([cacheKey, record]) => {
        if (!recordMatchesDeletedId(record, id)) return;
        cache.delete(cacheKey);
        removed += 1;
      });
    });
    while (tombstones.size > limit) tombstones.delete(tombstones.keys().next().value);
    return removed;
  }

  function mergeOutlookRecordCache(cache, records, limit = MAX_RECORDS, options = {}) {
    const tombstones = options.tombstones;
    const responseSequence = Math.max(0, Number(options.responseSequence) || 0);
    records.forEach(record => {
      const blockedTombstone = [record?.id, record?.seriesMasterId]
        .map(id => id && tombstones?.get?.(id))
        .find(sequence => Number.isFinite(sequence) && responseSequence <= sequence);
      if (blockedTombstone !== undefined) return;
      [record?.id, record?.seriesMasterId].filter(Boolean).forEach(id => {
        const sequence = tombstones?.get?.(id);
        if (Number.isFinite(sequence) && responseSequence > sequence) tombstones.delete(id);
      });

      const cacheKey = String(record?.cacheKey || "");
      if (!cacheKey || !record?.id) return;
      const matchingEntries = Array.from(cache.entries())
        .filter(([, cached]) => cached?.id === record.id);
      const newestCachedSequence = matchingEntries.reduce(
        (latest, [, cached]) => Math.max(latest, Number(cached?._responseSequence) || 0),
        0
      );
      if (responseSequence > 0 && newestCachedSequence > responseSequence) return;
      // Mutation responses may omit the parent folder; keep the one already known for this item.
      const previous = matchingEntries.find(([, cached]) => cached?.calendar)?.[1];
      const merged = !record.calendar && previous
        ? { ...record, calendar: previous.calendar, calendarName: previous.calendarName }
        : record;
      matchingEntries.forEach(([existingKey]) => cache.delete(existingKey));
      cache.set(cacheKey, { ...merged, _responseSequence: responseSequence });
    });
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return cache;
  }

  function isRelevantResponseUrl(value) {
    try {
      const url = new URL(value, location.href);
      return url.origin === "https://outlook.live.com"
        && (url.pathname === "/owa/startupdata.ashx"
          || url.pathname === "/owa/service.svc"
          || url.pathname === "/owa/published/service.svc");
    } catch (_error) {
      return false;
    }
  }

  function isTrustedBridgeInit(event) {
    const message = event?.data;
    return event?.source === window
      && event?.origin === location.origin
      && message?.type === "CALENDAR_CLOCK_PAGE_OWNED_INIT"
      && message?.providerId === "outlook"
      && TOKEN_PATTERN.test(message.channelId || "")
      && Boolean(event.ports?.[0]);
  }

  let enabled = false;
  let configured = false;
  let token = "";
  let bridgePort = null;
  let calendarTimeZone = "";
  const calendarFolders = new Map();
  const categoryCatalog = new Map();
  const recordCache = new Map();
  const deletionTombstones = new Map();
  const confirmedUpdates = new Map();
  const status = {
    phase: "ready",
    transport: "",
    endpoint: "",
    reason: "waiting for configuration",
    capturedResponses: 0,
    extractedRecords: 0,
    lastCapturedAt: 0,
    timeZone: "",
    calendarFolderCount: 0,
    workerCapture: "",
    recentlyUpdatedIds: []
  };

  function publish(deletedIds = []) {
    if (!enabled || !bridgePort || !TOKEN_PATTERN.test(token)) return;
    status.workerCapture = normalizeText(window.CalendarClockEarlyStructuredCapture?.getWorkerStatus?.()?.state, 20);
    const now = Date.now();
    confirmedUpdates.forEach((confirmedAt, id) => {
      if (now - confirmedAt > CONFIRMED_UPDATE_TTL_MS) confirmedUpdates.delete(id);
    });
    status.recentlyUpdatedIds = Array.from(confirmedUpdates.keys()).slice(-MAX_RECORDS);
    bridgePort.postMessage({
      type: "records",
      token,
      records: Array.from(recordCache.values()),
      deletedIds,
      status: { ...status, timeZone: calendarTimeZone },
      calendarFolders: Array.from(calendarFolders, ([id, name]) => ({ id, name }))
    });
  }

  function mergeCategoryCatalog(payload) {
    const extracted = outlookAppearance?.extractCategoryCatalog?.(payload, {
      maxVisitedNodes: MAX_VISITED_NODES
    });
    if (!(extracted instanceof Map) || !extracted.size) return false;
    let changed = false;
    extracted.forEach((color, name) => {
      if (categoryCatalog.get(name) === color) return;
      categoryCatalog.set(name, color);
      changed = true;
    });
    if (!changed) return false;
    recordCache.forEach((record, cacheKey) => {
      const appearance = outlookAppearance.resolveStructuredAppearance(record, categoryCatalog);
      recordCache.set(cacheKey, { ...record, color: appearance.color });
    });
    return true;
  }

  function inspectText(text, url, transport, request = {}) {
    if ((configured && !enabled) || typeof text !== "string" || text.length > MAX_RESPONSE_CHARS) return;
    if (!isRelevantResponseUrl(url)) return;
    const responseSequence = Math.max(0, Number(request?.requestSequence) || 0);
    const payload = parseJsonText(text);
    if (!payload || request?.ok === false) return;

    const nextTimeZone = getOutlookTimeZone(payload);
    if (nextTimeZone) calendarTimeZone = nextTimeZone;
    extractCalendarFolders(payload).forEach((name, id) => calendarFolders.set(id, name));
    const categoryCatalogChanged = mergeCategoryCatalog(payload);
    const onlyFolderId = calendarFolders.size === 1 ? calendarFolders.keys().next().value : "";
    const records = extractCalendarRecords(payload, calendarTimeZone, calendarFolders, categoryCatalog)
      .map(record => record.calendar || !onlyFolderId
        ? record
        : { ...record, calendar: onlyFolderId, calendarName: calendarFolders.get(onlyFolderId) || "" });
    const requestPayload = parseJsonText(request?.requestText);
    const requestDeletion = extractConfirmedRequestDeletion(requestPayload, payload);
    const updatedIds = extractConfirmedRequestUpdateIds(requestPayload, payload);
    updatedIds.forEach(id => confirmedUpdates.set(id, Date.now()));
    const view = responseSequence > 0 ? extractAuthoritativeView(requestPayload, payload) : null;
    const deletedIdSet = new Set(extractCancelledRecordIds(payload));
    if (requestDeletion) expandSeriesDeletion(recordCache, requestDeletion).forEach(id => deletedIdSet.add(id));
    if (!records.length && !nextTimeZone && !deletedIdSet.size && !categoryCatalogChanged && !view && !updatedIds.length) return;
    let removed = recordConfirmedOutlookDeletions(
      recordCache,
      deletionTombstones,
      Array.from(deletedIdSet).slice(0, MAX_RECORDS),
      responseSequence
    );
    mergeOutlookRecordCache(recordCache, records, MAX_RECORDS, {
      tombstones: deletionTombstones,
      responseSequence
    });
    if (view) {
      const staleIds = findStaleViewRecordIds(recordCache, view, responseSequence, calendarTimeZone, calendarFolders.size);
      staleIds.forEach(id => deletedIdSet.add(id));
      removed += recordConfirmedOutlookDeletions(recordCache, deletionTombstones, staleIds, responseSequence);
    }
    const deletedIds = Array.from(deletedIdSet).slice(0, MAX_RECORDS);
    status.phase = "captured";
    status.transport = transport;
    status.endpoint = new URL(url, location.href).pathname.slice(0, 100);
    status.reason = deletedIds.length
      ? removed
        ? "confirmed Outlook Calendar deletion removed cached records"
        : "confirmed Outlook Calendar deletion recorded"
      : view && !records.length
        ? "Outlook Calendar view confirmed"
        : records.length
        ? "structured Outlook Calendar records extracted"
        : categoryCatalogChanged
          ? "Outlook category colors extracted"
          : "Outlook Calendar timezone extracted";
    status.capturedResponses += 1;
    status.extractedRecords = recordCache.size;
    status.lastCapturedAt = Date.now();
    status.timeZone = calendarTimeZone;
    status.calendarFolderCount = calendarFolders.size;
    publish(deletedIds);
  }

  const earlyCapture = window.CalendarClockEarlyStructuredCapture;
  if (earlyCapture?.subscribe && earlyCapture?.drain) {
    earlyCapture.subscribe("outlook", response => {
      inspectText(response?.text, response?.url, response?.transport || "early", response);
    });
    earlyCapture.drain("outlook").forEach(response => {
      inspectText(response?.text, response?.url, response?.transport || "early", response);
    });
  } else {
    status.phase = "unavailable";
    status.reason = "early structured response capture is unavailable";
  }

  function acceptBridge(event) {
    if (!isTrustedBridgeInit(event) || bridgePort) return;
    const candidatePort = event.ports?.[0];
    if (!candidatePort) return;
    event.stopImmediatePropagation();
    bridgePort = candidatePort;
    bridgePort.onmessage = portEvent => {
      const config = portEvent.data;
      if (!config
          || config.type !== "configure"
          || !TOKEN_PATTERN.test(config.token || "")
          || typeof config.enabled !== "boolean") return;
      token = config.token;
      configured = true;
      enabled = config.enabled;
      if (!enabled) {
        recordCache.clear();
        calendarFolders.clear();
        categoryCatalog.clear();
        deletionTombstones.clear();
        status.phase = "ready";
        status.reason = "disabled; network observer is dormant";
        status.extractedRecords = 0;
        status.calendarFolderCount = 0;
        return;
      }
      status.reason = recordCache.size
        ? "structured Outlook Calendar records extracted"
        : "waiting for a structured Outlook Calendar response";
      publish();
    };
    bridgePort.start();
    bridgePort.postMessage({ type: "ready", channelId: event.data.channelId });
    window.removeEventListener("message", acceptBridge, true);
  }
  window.addEventListener("message", acceptBridge, true);
  window.CalendarClockOutlookPageOwnedHook = Object.freeze({
    getOutlookTimeZone,
    extractCalendarFolders,
    extractCategoryCatalog: outlookAppearance?.extractCategoryCatalog,
    extractCalendarRecords,
    extractCancelledRecordIds,
    recordConfirmedOutlookDeletions,
    mergeOutlookRecordCache,
    extractConfirmedRequestDeletion,
    extractAuthoritativeView,
    findStaleViewRecordIds,
    expandSeriesDeletion,
    isRelevantResponseUrl
  });
})();
