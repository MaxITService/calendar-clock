// MAIN-world Calendar sync observer. It never exposes extension APIs or unsanitized payloads.
(function initializeCalendarClockPageOwnedHook(root, factory) {
  const moduleApi = factory();
  if (typeof module === "object" && module.exports && typeof process === "object" && process.versions?.node) {
    module.exports = moduleApi;
    return;
  }
  moduleApi.install(root);
})(typeof window === "undefined" ? globalThis : window, () => {
  const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
  const MAX_RECORDS = 200;
  const MAX_VISITED_NODES = 50000;
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const RELEVANT_PATHS = new Set([
    "sync.sync",
    "sync.prefetcheventrange"
  ]);
  const TASKS_SYNC_ORIGIN = "https://tasks-pa.clients6.google.com";
  const TASKS_SYNC_PATH = "/$rpc/google.internal.tasks.v1.TasksApiService/Sync";

  function parseEndpoint(value) {
    if (!Array.isArray(value)) return null;
    if (Number.isFinite(value[0])) {
      return {
        milliseconds: value[0],
        allDay: true,
        civilDateKey: isSaneMilliseconds(value[0]) ? new Date(value[0]).toISOString().slice(0, 10) : ""
      };
    }
    if (Array.isArray(value[1]) && Number.isFinite(value[1][0])) {
      return { milliseconds: value[1][0], allDay: false, timeZone: typeof value[2] === "string" ? value[2] : "UTC" };
    }
    return null;
  }

  function normalizeCalendarEventId(value) {
    return typeof value === "string" ? value.slice(0, 256).trim() : "";
  }

  function isSaneMilliseconds(value) {
    return Number.isFinite(value) && value >= 946684800000 && value <= 4133980800000;
  }

  function parseSecondsTimestamp(value) {
    if (!Array.isArray(value) || !/^\d{9,12}$/.test(String(value[0] || ""))) return 0;
    const milliseconds = Number(value[0]) * 1000 + Math.floor((Number(value[1]) || 0) / 1000000);
    return isSaneMilliseconds(milliseconds) ? milliseconds : 0;
  }

  function parseTaskSchedule(value) {
    const schedule = Array.isArray(value?.[0]) ? value[0] : null;
    const date = schedule?.[1];
    const time = schedule?.[2];
    const timeZone = typeof schedule?.[3] === "string" ? schedule[3] : "UTC";
    const milliseconds = parseSecondsTimestamp(schedule?.[5]);
    if (!Array.isArray(date) || date.length < 3 || !date.slice(0, 3).every(Number.isInteger)) return null;
    if (!Array.isArray(time) || time.length < 1 || time.length > 2 || !time.every(Number.isInteger)) return null;
    if (!milliseconds) return null;
    return { milliseconds, timeZone };
  }

  function formatZoned(milliseconds, timeZone) {
    let formatter;
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (_error) {
      timeZone = "UTC";
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    }
    const parts = Object.fromEntries(formatter.formatToParts(new Date(milliseconds))
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
      timeZone
    };
  }

  function extractCalendarPositionalRecord(record) {
    if (!Array.isArray(record) || record.length < 36) return null;
    const id = normalizeCalendarEventId(record[0]);
    const title = typeof record[5] === "string" ? record[5].slice(0, 500) : "";
    const updatedAt = isSaneMilliseconds(record[4]) ? record[4] : 0;
    const startPoint = parseEndpoint(record[35]);
    const endPoint = parseEndpoint(record[36]);
    if (!id || !startPoint || !isSaneMilliseconds(startPoint.milliseconds)) return null;
    if (endPoint && !isSaneMilliseconds(endPoint.milliseconds)) return null;
    if (endPoint && endPoint.milliseconds < startPoint.milliseconds) return null;
    if (endPoint && startPoint.allDay !== endPoint.allDay) return null;

    if (startPoint.allDay && (!endPoint || endPoint.milliseconds <= startPoint.milliseconds)) return null;
    const endMilliseconds = endPoint?.milliseconds ?? startPoint.milliseconds;
    const durationKind = startPoint.allDay
      ? "all-day"
      : endMilliseconds === startPoint.milliseconds ? "point" : "range";
    if (durationKind === "range" && endMilliseconds <= startPoint.milliseconds) return null;
    const zonedStart = startPoint.allDay ? null : formatZoned(startPoint.milliseconds, startPoint.timeZone || endPoint?.timeZone || "UTC");
    const zonedEnd = startPoint.allDay ? null : formatZoned(endMilliseconds, endPoint?.timeZone || zonedStart.timeZone);
    const occurrenceAnchor = startPoint.allDay ? startPoint.civilDateKey : new Date(startPoint.milliseconds).toISOString();

    return {
      id,
      cacheKey: id,
      domKey: `page-owned:${id}:${occurrenceAnchor}`.slice(0, 512),
      title,
      start: durationKind === "all-day" ? "00:00" : zonedStart.time,
      end: durationKind === "all-day" ? "00:00" : zonedEnd.time,
      durationKind,
      date: durationKind === "all-day" ? startPoint.civilDateKey : zonedStart.date,
      ...(durationKind === "all-day" ? {
        allDayStartDateKey: startPoint.civilDateKey,
        allDayEndDateKeyExclusive: endPoint.civilDateKey
      } : {
        startInstant: new Date(startPoint.milliseconds).toISOString(),
        endInstant: new Date(endMilliseconds).toISOString(),
        startDate: new Date(startPoint.milliseconds).toISOString(),
        endDate: new Date(endMilliseconds).toISOString()
      }),
      timeZone: durationKind === "all-day" ? "" : zonedStart.timeZone,
      status: "",
      color: "",
      calendar: "",
      calendarName: "",
      sourceKind: "calendar-event",
      itemKind: "event",
      updatedAt,
      structuredSource: "calendar-sync"
    };
  }

  function extractTasksSyncRecord(record) {
    if (!Array.isArray(record) || record.length < 9) return null;
    const taskId = typeof record[0] === "string" ? record[0].slice(0, 256).trim() : "";
    const title = typeof record[1]?.[1] === "string" ? record[1][1].slice(0, 500) : "";
    const updatedAt = parseSecondsTimestamp(record[2]);
    const startPoint = parseTaskSchedule(record[8]);
    if (!taskId || !title || !updatedAt || !startPoint) return null;

    const relation = Array.isArray(record[23]?.[0]) ? record[23][0] : null;
    const relatedEventId = typeof relation?.[1]?.[0] === "string"
      ? relation[1][0].slice(0, 256).trim()
      : "";
    const standaloneId = `task:${taskId}`;
    const id = relatedEventId || standaloneId;
    const zonedStart = formatZoned(startPoint.milliseconds, startPoint.timeZone);

    return {
      id,
      cacheKey: id,
      domKey: `page-owned:${id}:${startPoint.milliseconds}`.slice(0, 512),
      title,
      start: zonedStart.time,
      end: zonedStart.time,
      durationKind: "point",
      date: zonedStart.date,
      startInstant: new Date(startPoint.milliseconds).toISOString(),
      endInstant: new Date(startPoint.milliseconds).toISOString(),
      startDate: new Date(startPoint.milliseconds).toISOString(),
      endDate: new Date(startPoint.milliseconds).toISOString(),
      timeZone: zonedStart.timeZone,
      status: "",
      color: "",
      calendar: "",
      calendarName: "Google Task",
      sourceKind: "calendar-task",
      itemKind: "task",
      updatedAt,
      structuredSource: "tasks-sync",
      cacheAliases: relatedEventId ? [standaloneId] : []
    };
  }

  function parseJsonResponse(text) {
    if (typeof text !== "string" || text.length > MAX_RESPONSE_CHARS) return null;
    const firstArray = text.indexOf("[");
    const firstObject = text.indexOf("{");
    const candidates = [firstArray, firstObject].filter(index => index >= 0).sort((a, b) => a - b);
    for (const index of candidates) {
      try { return JSON.parse(text.slice(index)); } catch (_error) { /* try the next JSON opening */ }
    }
    return null;
  }

  function extractCalendarRecords(payload) {
    const records = new Map();
    const stack = [{ value: payload, depth: 0 }];
    const seen = new WeakSet();
    let visited = 0;
    while (stack.length && visited < MAX_VISITED_NODES && records.size < MAX_RECORDS) {
      const { value, depth } = stack.pop();
      visited += 1;
      if (Array.isArray(value)) {
        if (seen.has(value)) continue;
        seen.add(value);
        const record = extractCalendarPositionalRecord(value) || extractTasksSyncRecord(value);
        if (record) records.set(record.cacheKey || record.id, record);
        if (depth < 12) value.forEach(child => {
          if (Array.isArray(child) || (child && typeof child === "object")) stack.push({ value: child, depth: depth + 1 });
        });
      } else if (value && typeof value === "object") {
        if (seen.has(value)) continue;
        seen.add(value);
        if (depth < 12) Object.values(value).forEach(child => {
          if (Array.isArray(child) || (child && typeof child === "object")) stack.push({ value: child, depth: depth + 1 });
        });
      }
    }
    return Array.from(records.values());
  }

  function isRelevantResponseUrl(url, baseUrl) {
    try {
      const parsed = new URL(url, baseUrl);
      const match = /^\/calendar\/u\/\d+\/(sync\.sync|sync\.prefetcheventrange)$/.exec(parsed.pathname);
      const isCalendarSync = parsed.origin === "https://calendar.google.com"
        && Boolean(match && RELEVANT_PATHS.has(match[1]));
      const isTasksSync = parsed.origin === TASKS_SYNC_ORIGIN && parsed.pathname === TASKS_SYNC_PATH;
      return isCalendarSync || isTasksSync;
    } catch (_error) {
      return false;
    }
  }

  function isCalendarSyncMutationRequest(url, method, baseUrl) {
    if (String(method || "GET").toUpperCase() !== "POST") return false;
    try {
      const parsed = new URL(url, baseUrl);
      return parsed.origin === "https://calendar.google.com"
        && /^\/calendar\/u\/\d+\/sync\.sync$/.test(parsed.pathname);
    } catch (_error) {
      return false;
    }
  }

  function extractDeletedCalendarEventIdsFromRequest(url, method, body, baseUrl) {
    if (!isCalendarSyncMutationRequest(url, method, baseUrl) || typeof body !== "string") return [];

    const rawRequest = new URLSearchParams(body).get("f.req");
    if (!rawRequest || rawRequest.length > MAX_RESPONSE_CHARS) return [];
    let data;
    try {
      data = JSON.parse(rawRequest);
    } catch (_error) {
      return [];
    }

    const operations = data?.[0]?.[4];
    if (!Array.isArray(operations)) return [];
    return Array.from(new Set(operations
      .map(operation => {
        const eventStub = operation?.[2]?.[0]?.[1];
        const deletionPatch = eventStub?.[3]?.[0];
        const isDeletionPatch = Array.isArray(deletionPatch)
          && deletionPatch.length > 0
          && deletionPatch.every(value => value === null || (Array.isArray(value) && value.length === 0));
        if (!Array.isArray(eventStub)
            || eventStub.length !== 5
            || eventStub[1] !== null
            || eventStub[2] !== null
            || eventStub[4] !== 0
            || !isDeletionPatch) return "";
        return normalizeCalendarEventId(eventStub[0]);
      })
      .filter(Boolean)));
  }

  function recordConfirmedCalendarDeletions(cache, tombstones, deletedIds, requestSequence, confirmedAt, limit = MAX_RECORDS) {
    let removed = 0;
    deletedIds.forEach(id => {
      tombstones.delete(id);
      tombstones.set(id, {
        requestSequence: Math.max(0, Number(requestSequence) || 0),
        confirmedAt: Math.max(0, Number(confirmedAt) || 0)
      });
      Array.from(cache.entries()).forEach(([cacheKey, record]) => {
        if (record?.id === id || cacheKey === id) {
          cache.delete(cacheKey);
          removed += 1;
        }
      });
    });
    while (tombstones.size > limit) tombstones.delete(tombstones.keys().next().value);
    return removed;
  }

  function mergeLatestRecordCache(cache, records, limit = MAX_RECORDS, options = {}) {
    const tombstones = options.tombstones;
    const responseSequence = Math.max(0, Number(options.responseSequence) || 0);
    records.forEach(record => {
      const tombstone = tombstones?.get?.(record?.id);
      if (tombstone) {
        const updatedAt = Math.max(0, Number(record?.updatedAt) || 0);
        const isConfirmedNewerVersion = responseSequence > tombstone.requestSequence
          && updatedAt > tombstone.confirmedAt;
        if (!isConfirmedNewerVersion) return;
        tombstones.delete(record.id);
      }
      if (Array.isArray(record?.cacheAliases)) {
        record.cacheAliases.forEach(alias => {
          if (typeof alias !== "string" || alias === record.id) return;
          Array.from(cache.entries()).forEach(([cacheKey, cached]) => {
            if (cached?.id === alias || cacheKey === alias) cache.delete(cacheKey);
          });
        });
      }
      const cacheKey = String(record?.cacheKey || record?.id || "");
      if (!cacheKey) return;
      const previous = cache.get(cacheKey);
      const previousUpdatedAt = Number(previous?.updatedAt) || 0;
      const nextUpdatedAt = Number(record?.updatedAt) || 0;
      const previousResponseSequence = Math.max(0, Number(previous?._responseSequence) || 0);
      if (responseSequence > 0 && previousResponseSequence > 0 && responseSequence < previousResponseSequence) return;
      const isNewerResponse = responseSequence > 0
        && (previousResponseSequence === 0 || responseSequence > previousResponseSequence);
      const previousPriority = previous?.structuredSource === "calendar-sync" ? 2 : 1;
      const nextPriority = record?.structuredSource === "calendar-sync" ? 2 : 1;
      const shouldReplace = !previous
        || isNewerResponse
        || (nextUpdatedAt > 0 && previousUpdatedAt > 0 && nextUpdatedAt > previousUpdatedAt)
        || (nextUpdatedAt > 0 && nextUpdatedAt === previousUpdatedAt && nextPriority >= previousPriority)
        || (nextUpdatedAt > 0 && previousUpdatedAt === 0)
        || (nextUpdatedAt === 0 && previousUpdatedAt === 0);
      if (!shouldReplace) return;

      cache.set(cacheKey, previous ? {
        ...previous,
        ...record,
        title: record.title || previous.title || "",
        calendar: record.calendar || previous.calendar || "",
        calendarName: record.calendarName || previous.calendarName || "",
        _responseSequence: Math.max(previousResponseSequence, responseSequence)
      } : { ...record, _responseSequence: responseSequence });
    });
    while (cache.size > limit) cache.delete(cache.keys().next().value);
    return cache;
  }

  function didHookEnabledValueChange(currentEnabled, nextEnabled) {
    return currentEnabled !== (nextEnabled === true);
  }

  function isTrustedBridgeInit(event, scope) {
    const message = event?.data;
    return event?.source === scope
      && event?.origin === scope?.location?.origin
      && message?.type === "CALENDAR_CLOCK_PAGE_OWNED_INIT"
      && TOKEN_PATTERN.test(message.channelId || "")
      && Boolean(event.ports?.[0]);
  }

  function install(scope) {
    const marker = Symbol.for("calendarClock.pageOwnedHook.v1");
    if (!scope || scope[marker]) return;
    Object.defineProperty(scope, marker, { value: true, configurable: false });

    let enabled = false;
    let token = "";
    let bridgePort = null;
    let requestSequence = 0;
    const recordCache = new Map();
    const deletionTombstones = new Map();
    const xhrRequests = new WeakMap();
    const observedXhrs = new WeakSet();
    const status = {
      phase: "ready",
      transport: "",
      endpoint: "",
      reason: "disabled; wrappers are dormant",
      capturedResponses: 0,
      extractedRecords: 0,
      lastCapturedAt: 0
    };

    function getNextRelevantRequestSequence(url) {
      if (!enabled || !isRelevantResponseUrl(url, scope.location.href)) return 0;
      requestSequence += 1;
      return requestSequence;
    }

    function publish(records, transport, endpoint, responseSequence = 0) {
      mergeLatestRecordCache(recordCache, records, MAX_RECORDS, {
        tombstones: deletionTombstones,
        responseSequence
      });
      status.phase = "captured";
      status.transport = transport;
      status.endpoint = endpoint;
      status.reason = records.length ? "structured Calendar records extracted" : "relevant response contained no schema-valid records";
      status.capturedResponses += 1;
      status.extractedRecords = recordCache.size;
      status.lastCapturedAt = Date.now();
      if (bridgePort && TOKEN_PATTERN.test(token)) {
        bridgePort.postMessage({ type: "records", token, records: Array.from(recordCache.values()), status: { ...status } });
      }
    }

    function publishDeletedRecords(deletedIds, transport, endpoint, deletionSequence) {
      const removed = recordConfirmedCalendarDeletions(
        recordCache,
        deletionTombstones,
        deletedIds,
        deletionSequence,
        Date.now()
      );
      status.phase = "captured";
      status.transport = transport;
      status.endpoint = endpoint;
      status.reason = removed
        ? removed === 1
          ? "confirmed Calendar deletion removed cached record"
          : `confirmed Calendar deletion removed ${removed} cached records`
        : "confirmed Calendar deletion recorded";
      status.extractedRecords = recordCache.size;
      status.lastCapturedAt = Date.now();
      if (bridgePort && TOKEN_PATTERN.test(token)) {
        bridgePort.postMessage({
          type: "records",
          token,
          records: Array.from(recordCache.values()),
          deletedIds,
          status: { ...status }
        });
      }
    }

    const earlyDeletionObserver = scope[Symbol.for("calendarClock.earlyDeletionObserver.v1")];
    earlyDeletionObserver?.subscribe?.(message => {
      // Confirmed tombstones are authoritative even when structured capture is disabled.
      const deletedIds = Array.isArray(message?.deletedIds)
        ? Array.from(new Set(message.deletedIds.map(normalizeCalendarEventId).filter(Boolean)))
        : [];
      if (!deletedIds.length) return;
      publishDeletedRecords(
        deletedIds,
        String(message.transport || "early").slice(0, 20),
        String(message.endpoint || "").slice(0, 100),
        requestSequence
      );
    });

    function inspectRequest(body, url, method) {
      if (!enabled || !isCalendarSyncMutationRequest(url, method, scope.location.href)) return [];
      const text = typeof body === "string" ? body : body?.toString?.();
      if (typeof text !== "string" || text.length > MAX_RESPONSE_CHARS) return [];
      return extractDeletedCalendarEventIdsFromRequest(url, method, text, scope.location.href);
    }

    function inspectText(text, url, transport, responseSequence = 0) {
      if (!enabled || typeof text !== "string" || text.length > MAX_RESPONSE_CHARS) return;
      if (!isRelevantResponseUrl(url, scope.location.href)) return;
      const endpoint = new URL(url, scope.location.href).pathname;
      const payload = parseJsonResponse(text);
      if (!payload) {
        publish([], transport, endpoint, responseSequence);
        return;
      }
      publish(extractCalendarRecords(payload), transport, endpoint, responseSequence);
    }

    const fetchDescriptor = Object.getOwnPropertyDescriptor(scope, "fetch");
    if (typeof scope.fetch === "function") {
      const nativeFetch = scope.fetch;
      const wrappedFetch = new Proxy(nativeFetch, {
        apply(target, thisArg, argumentsList) {
          const input = argumentsList[0];
          const init = argumentsList[1];
          const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url || "";
          const method = init?.method || input?.method || "GET";
          const responseSequence = getNextRelevantRequestSequence(url);
          let deletedIdsPromise = Promise.resolve([]);
          if (enabled && isCalendarSyncMutationRequest(url, method, scope.location.href) && init?.body !== undefined) {
            deletedIdsPromise = Promise.resolve(inspectRequest(init.body, url, method));
          } else if (enabled
              && isCalendarSyncMutationRequest(url, method, scope.location.href)
              && input?.clone
              && typeof input.clone === "function") {
            try {
              deletedIdsPromise = input.clone().text()
                .then(body => inspectRequest(body, url, method), () => []);
            } catch (_error) {
              deletedIdsPromise = Promise.resolve([]);
            }
          }
          const result = Reflect.apply(target, thisArg, argumentsList);
          if (enabled) {
            Promise.resolve(result).then(response => {
              if (!response || !isRelevantResponseUrl(response.url, scope.location.href)) return;
              deletedIdsPromise.then(deletedIds => {
                if (response.ok === true && deletedIds.length) {
                  const endpoint = new URL(url, scope.location.href).pathname;
                  publishDeletedRecords(deletedIds, "fetch", endpoint, responseSequence);
                }
                const length = Number(response.headers?.get?.("content-length"));
                if (Number.isFinite(length) && length > MAX_RESPONSE_CHARS) return;
                response.clone().text()
                  .then(text => inspectText(text, response.url, "fetch", responseSequence), () => {});
              }, () => {});
            }, () => {});
          }
          return result;
        }
      });
      Object.defineProperty(scope, "fetch", fetchDescriptor ? { ...fetchDescriptor, value: wrappedFetch } : {
        value: wrappedFetch, configurable: true, writable: true
      });
    }

    const xhrPrototype = scope.XMLHttpRequest?.prototype;
    if (xhrPrototype) {
      const openDescriptor = Object.getOwnPropertyDescriptor(xhrPrototype, "open");
      const sendDescriptor = Object.getOwnPropertyDescriptor(xhrPrototype, "send");
      if (typeof openDescriptor?.value === "function") {
        const wrappedOpen = new Proxy(openDescriptor.value, {
          apply(target, thisArg, argumentsList) {
            const url = String(argumentsList[1] || "");
            xhrRequests.set(thisArg, {
              method: String(argumentsList[0] || "GET"),
              url,
              responseSequence: 0,
              deletedIds: []
            });
            return Reflect.apply(target, thisArg, argumentsList);
          }
        });
        Object.defineProperty(xhrPrototype, "open", { ...openDescriptor, value: wrappedOpen });
      }
      if (typeof sendDescriptor?.value === "function") {
        const wrappedSend = new Proxy(sendDescriptor.value, {
          apply(target, thisArg, argumentsList) {
            const request = xhrRequests.get(thisArg) || { method: "GET", url: "" };
            request.responseSequence = getNextRelevantRequestSequence(request.url);
            request.deletedIds = inspectRequest(argumentsList[0], request.url, request.method);
            xhrRequests.set(thisArg, request);
            if (!observedXhrs.has(thisArg)) {
              observedXhrs.add(thisArg);
              thisArg.addEventListener("loadend", () => {
                if (!enabled) return;
                const completedRequest = xhrRequests.get(thisArg) || request;
                const url = thisArg.responseURL || completedRequest.url || "";
                if (!isRelevantResponseUrl(url, scope.location.href)) return;
                const statusCode = Number(thisArg.status) || 0;
                if (statusCode >= 200 && statusCode < 300 && completedRequest.deletedIds?.length) {
                  const endpoint = new URL(completedRequest.url, scope.location.href).pathname;
                  publishDeletedRecords(
                    completedRequest.deletedIds,
                    "xhr",
                    endpoint,
                    completedRequest.responseSequence
                  );
                }
                try {
                  if (thisArg.responseType === "" || thisArg.responseType === "text") {
                    inspectText(thisArg.responseText, url, "xhr", completedRequest.responseSequence);
                  } else if (thisArg.responseType === "json") {
                    const text = JSON.stringify(thisArg.response);
                    inspectText(text, url, "xhr", completedRequest.responseSequence);
                  }
                } catch (_error) {
                  // Cross-origin or unsupported response types fail closed.
                }
              });
            }
            return Reflect.apply(target, thisArg, argumentsList);
          }
        });
        Object.defineProperty(xhrPrototype, "send", { ...sendDescriptor, value: wrappedSend });
      }
    }

    function acceptBridge(event) {
      const message = event.data;
      if (!isTrustedBridgeInit(event, scope)) return;
      const candidatePort = event.ports?.[0];
      if (!candidatePort || bridgePort) return;
      event.stopImmediatePropagation();
      bridgePort = candidatePort;
      bridgePort.onmessage = portEvent => {
        const config = portEvent.data;
        if (!config || config.type !== "configure" || !TOKEN_PATTERN.test(config.token || "") || typeof config.enabled !== "boolean") return;
        token = config.token;
        if (!didHookEnabledValueChange(enabled, config.enabled)) return;
        enabled = config.enabled;
        recordCache.clear();
        deletionTombstones.clear();
        requestSequence = 0;
        status.phase = "ready";
        status.reason = enabled ? "waiting for a relevant Calendar sync response" : "disabled; wrappers are dormant";
        status.extractedRecords = 0;
      };
      bridgePort.start();
      bridgePort.postMessage({ type: "ready", channelId: message.channelId });
      scope.removeEventListener("message", acceptBridge, true);
    }
    scope.addEventListener("message", acceptBridge, true);
  }

  return {
    install,
    parseEndpoint,
    parseTaskSchedule,
    extractCalendarPositionalRecord,
    extractTasksSyncRecord,
    extractCalendarRecords,
    parseJsonResponse,
    isRelevantResponseUrl,
    isCalendarSyncMutationRequest,
    extractDeletedCalendarEventIdsFromRequest,
    recordConfirmedCalendarDeletions,
    isTrustedBridgeInit,
    mergeLatestRecordCache,
    didHookEnabledValueChange
  };
});
