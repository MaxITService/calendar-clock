// Loads the isolated Calendar sync watcher without making the DOM reader depend on it.
(function initializeCalendarClockOptionalModules(root, factory) {
  const bridge = factory();
  root.CalendarClockOptionalModuleLoader = bridge;
  bridge.install(root);
})(globalThis, () => {
  // Isolated-world only: the MAIN-world hook cannot access chrome.storage.
  const STATE_KEY = "calendarClockOverlayState";
  let activeProvider = null;
  const TEMPORAL_MODULE_PATH = "src/temporal-projection/temporal-projection.js";
  // Cross-world protocol invariant: keep these byte-for-byte in sync with
  // page-owned-info/main-world-hook.js. Separate JS worlds cannot share a binding.
  const MAX_RECORDS = 200;
  const MAX_TEXT = 500;
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const ABSOLUTE_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function isIsoDateTime(value) {
    return typeof value === "string"
      && value.length <= 40
      && ABSOLUTE_ISO_PATTERN.test(value)
      && Number.isFinite(Date.parse(value));
  }

  function copyText(value, maxLength = MAX_TEXT) {
    return typeof value === "string" ? value.slice(0, maxLength) : "";
  }

  function getStructuredSourceId() {
    return activeProvider?.structuredSourceId || "google-page-owned";
  }

  function sanitizeRecord(value) {
    if (!isPlainObject(value)) return null;
    const id = copyText(value.id, 256).trim();
    const startDate = copyText(value.startDate, 40);
    const endDate = copyText(value.endDate, 40);
    const start = copyText(value.start, 5);
    const end = copyText(value.end, 5);
    const durationKind = ["range", "point", "all-day"].includes(value.durationKind)
      ? value.durationKind
      : "range";
    if (!id || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
    const allDayStartDateKey = copyText(value.allDayStartDateKey, 10);
    const allDayEndDateKeyExclusive = copyText(value.allDayEndDateKeyExclusive, 10);
    if (durationKind === "all-day") {
      if (!DATE_KEY_PATTERN.test(allDayStartDateKey)
          || !DATE_KEY_PATTERN.test(allDayEndDateKeyExclusive)
          || allDayEndDateKeyExclusive <= allDayStartDateKey) return null;
    } else {
      if (!isIsoDateTime(startDate) || !isIsoDateTime(endDate)) return null;
      if (durationKind === "range" && Date.parse(endDate) <= Date.parse(startDate)) return null;
      if (durationKind === "point" && Date.parse(endDate) !== Date.parse(startDate)) return null;
    }

    return {
      id,
      cacheKey: copyText(value.cacheKey, 512),
      domKey: copyText(value.domKey, 512),
      title: copyText(value.title),
      start,
      end,
      durationKind,
      isPointEvent: durationKind === "point",
      isAllDay: durationKind === "all-day",
      date: DATE_KEY_PATTERN.test(value.date || "") ? value.date : "",
      endDateKey: DATE_KEY_PATTERN.test(value.endDateKey || "") ? value.endDateKey : "",
      ...(durationKind === "all-day" ? {
        allDayStartDateKey,
        allDayEndDateKeyExclusive
      } : {
        startInstant: new Date(startDate).toISOString(),
        endInstant: new Date(endDate).toISOString(),
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString()
      }),
      timeZone: copyText(value.timeZone, 100),
      status: copyText(value.status, 64),
      categories: Array.isArray(value.categories)
        ? Array.from(new Set(value.categories
          .map(category => copyText(category, 256).trim())
          .filter(Boolean)))
          .slice(0, 25)
        : [],
      color: /^#[0-9a-f]{6}$/i.test(value.color || "") ? value.color : "",
      calendar: copyText(value.calendar, 256),
      calendarName: copyText(value.calendarName, 256),
      calendarItemType: copyText(value.calendarItemType, 80),
      itemClass: copyText(value.itemClass, 120),
      meetingStatus: ["appointment", "meeting", "unknown"].includes(value.meetingStatus)
        ? value.meetingStatus
        : "unknown",
      seriesMasterId: copyText(value.seriesMasterId, 256),
      capturedFrom: getStructuredSourceId(),
      sourceKind: value.sourceKind === "calendar-task" ? "calendar-task" : "calendar-event",
      itemKind: value.itemKind === "task" ? "task" : "event",
      dateParseStatus: "structured",
      rawText: ""
    };
  }

  function sanitizeRecordsMessage(message, expectedToken) {
    if (!isPlainObject(message)
        || message.type !== "records"
        || message.token !== expectedToken
        || !Array.isArray(message.records)
        || message.records.length > MAX_RECORDS) {
      return null;
    }
    const records = message.records.map(sanitizeRecord).filter(Boolean);
    if (records.length !== message.records.length) return null;
    const deletedIds = Array.isArray(message.deletedIds)
      ? Array.from(new Set(message.deletedIds.map(value => copyText(value, 256).trim()).filter(Boolean)))
      : [];
    if (deletedIds.length > MAX_RECORDS || (Array.isArray(message.deletedIds) && deletedIds.length !== message.deletedIds.length)) {
      return null;
    }
    const rawCalendarFolders = message.calendarFolders === undefined ? [] : message.calendarFolders;
    if (!Array.isArray(rawCalendarFolders) || rawCalendarFolders.length > MAX_RECORDS) return null;
    const calendarFolders = rawCalendarFolders.map(value => isPlainObject(value) ? {
      id: copyText(value.id, 256).trim(),
      name: copyText(value.name, 256).trim()
    } : null);
    if (calendarFolders.some(value => !value?.id || !value?.name)
        || new Set(calendarFolders.map(value => value.id)).size !== calendarFolders.length) return null;
    const status = isPlainObject(message.status) ? {
      phase: copyText(message.status.phase, 40),
      transport: copyText(message.status.transport, 20),
      endpoint: copyText(message.status.endpoint, 100),
      reason: copyText(message.status.reason, 160),
      capturedResponses: Math.max(0, Math.min(10000, Number(message.status.capturedResponses) || 0)),
      extractedRecords: Math.max(0, Math.min(MAX_RECORDS, Number(message.status.extractedRecords) || 0)),
      lastCapturedAt: Math.max(0, Number(message.status.lastCapturedAt) || 0),
      timeZone: copyText(message.status.timeZone, 100),
      calendarFolderCount: Math.max(0, Math.min(MAX_RECORDS, Math.round(Number(message.status.calendarFolderCount) || 0))),
      workerCapture: copyText(message.status.workerCapture, 20),
      recentlyUpdatedIds: Array.isArray(message.status.recentlyUpdatedIds)
        ? message.status.recentlyUpdatedIds.slice(0, MAX_RECORDS).map(value => copyText(value, 256).trim()).filter(Boolean)
        : []
    } : null;
    if (status?.calendarFolderCount > 0 && status.calendarFolderCount !== calendarFolders.length) return null;
    return { records, deletedIds, status, calendarFolders };
  }

  function makeSecret(cryptoObject) {
    const bytes = new Uint8Array(32);
    cryptoObject.getRandomValues(bytes);
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function didEnabledValueChange(currentEnabled, nextEnabled) {
    return currentEnabled !== (nextEnabled === true);
  }

  function isPageOwnedInfoEnabled(savedState) {
    return savedState?.pageOwnedInfo !== false;
  }

  function loadTemporalProjection(scope) {
    if (scope.calendarClockTemporalProjectionReady) return scope.calendarClockTemporalProjectionReady;
    scope.calendarClockTemporalProjectionStatus = {
      phase: "loading",
      reason: "temporal projection module is loading"
    };
    scope.calendarClockTemporalProjectionReady = import(scope.chrome.runtime.getURL(TEMPORAL_MODULE_PATH))
      .then(() => {
        const api = scope.CalendarClockTemporalProjection;
        if (!api || typeof api.createContext !== "function" || typeof api.validateEvent !== "function") {
          throw new Error("temporal projection module did not expose its contract");
        }
        scope.calendarClockTemporalProjection = api;
        scope.calendarClockTemporalProjectionStatus = { phase: "ready", reason: "canonical temporal projection is available" };
        return api;
      })
      .catch(error => {
        scope.calendarClockTemporalProjection = null;
        scope.calendarClockTemporalProjectionStatus = {
          phase: "unavailable",
          reason: `temporal projection unavailable: ${String(error?.message || error)}`.slice(0, 300)
        };
        return null;
      });
    return scope.calendarClockTemporalProjectionReady;
  }

  function install(scope) {
    if (!scope?.window || !scope?.document || !scope?.chrome?.runtime?.id) return;
    loadTemporalProjection(scope);
    if (scope.calendarClockPageOwnedInfo) return;
    const registry = scope.CalendarClockProviders;
    activeProvider = registry?.fromStructuredCaptureHostname?.(scope.location?.hostname) || null;

    let enabled = true;
    let records = [];
    let port = null;
    const token = makeSecret(scope.crypto);
    const channelId = makeSecret(scope.crypto);
    const subscribers = new Set();
    let status = {
      providerId: activeProvider?.id || "pending",
      phase: "loading",
      transport: "",
      endpoint: "",
      reason: "optional MAIN-world module is loading",
      capturedResponses: 0,
      extractedRecords: 0,
      calendarFolderCount: 0,
      lastCapturedAt: 0
    };

    function notify(deletedIds = []) {
      subscribers.forEach(listener => {
        try {
          listener({ records: records.slice(), deletedIds: deletedIds.slice(), status: { ...status } });
        } catch (_error) { /* isolated listener */ }
      });
    }

    function configureMainWorld() {
      if (!port) return;
      port.postMessage({ type: "configure", token, enabled });
    }

    function markMainWorldUnavailable(reason) {
      status = {
        ...status,
        phase: "unavailable",
        reason: copyText(reason || "optional page-owned module is unavailable", 160)
      };
      notify();
    }

    function connectToMainWorld() {
      if (port) return;
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = event => {
        const message = event.data;
        if (isPlainObject(message) && message.type === "ready" && message.channelId === channelId) {
          status = { ...status, phase: "ready", reason: enabled ? "waiting for relevant structured Calendar data" : "disabled; network observer is dormant" };
          configureMainWorld();
          notify();
          return;
        }
        const sanitized = sanitizeRecordsMessage(message, token);
        if (!sanitized) return;
        records = sanitized.records;
        if (sanitized.status) {
          status = {
            ...sanitized.status,
            providerId: activeProvider?.id || "unavailable",
            calendarFolders: sanitized.calendarFolders
          };
        }
        notify(sanitized.deletedIds);
      };
      port.start();
      scope.window.postMessage({
        type: "CALENDAR_CLOCK_PAGE_OWNED_INIT",
        channelId,
        providerId: activeProvider?.id || ""
      }, scope.location.origin, [channel.port2]);
    }

    const api = {
      isEnabled: () => enabled,
      getRecords: () => records.slice(),
      getStatus: () => ({
        ...status,
        calendarFolders: Array.isArray(status.calendarFolders)
          ? status.calendarFolders.map(folder => ({ ...folder }))
          : [],
        enabled
      }),
      getProviderId: () => activeProvider?.id || "",
      getTimeZone: () => copyText(status.timeZone || records.find(record => record.timeZone)?.timeZone, 100),
      setEnabled(nextEnabled) {
        const normalizedEnabled = nextEnabled === true;
        if (!didEnabledValueChange(enabled, normalizedEnabled)) {
          configureMainWorld();
          return;
        }
        enabled = normalizedEnabled;
        records = [];
        status = {
          ...status,
          phase: port ? "ready" : status.phase,
          reason: enabled ? "waiting for relevant structured Calendar data" : "disabled; network observer is dormant",
          extractedRecords: 0,
          calendarFolderCount: 0,
          calendarFolders: []
        };
        configureMainWorld();
        notify();
      },
      subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      }
    };
    scope.calendarClockPageOwnedInfo = api;

    scope.chrome.storage.local.get([STATE_KEY], result => {
      api.setEnabled(isPageOwnedInfoEnabled(result?.[STATE_KEY]));
    });
    scope.chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STATE_KEY]) return;
      api.setEnabled(isPageOwnedInfoEnabled(changes[STATE_KEY].newValue));
    });

    scope.chrome.runtime.sendMessage({
      type: "CALENDAR_CLOCK_INSTALL_MAIN_PROVIDER",
      providerId: activeProvider?.id || ""
    }, response => {
      const runtimeError = scope.chrome.runtime.lastError;
      if (runtimeError || response?.ok !== true) {
        markMainWorldUnavailable(runtimeError?.message || response?.error);
        return;
      }
      const providerId = copyText(response.providerId, 40);
      const structuredSourceId = copyText(response.structuredSourceId, 80);
      if (!providerId || !structuredSourceId) {
        markMainWorldUnavailable("provider metadata is unavailable");
        return;
      }
      activeProvider = Object.freeze({ id: providerId, structuredSourceId });
      status = {
        ...status,
        providerId: activeProvider.id,
        installerModulePath: copyText(response.modulePath, 160)
      };
      connectToMainWorld();
    });
  }

  return {
    install,
    sanitizeRecord,
    sanitizeRecordsMessage,
    didEnabledValueChange,
    isPageOwnedInfoEnabled,
    loadTemporalProjection,
    TOKEN_PATTERN
  };
});
