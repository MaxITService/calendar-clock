// Loads the isolated Calendar sync watcher without making the DOM reader depend on it.
(function initializeCalendarClockOptionalModules(root, factory) {
  const bridge = factory();
  if (typeof module === "object" && module.exports && typeof process === "object" && process.versions?.node) {
    module.exports = bridge;
    return;
  }
  bridge.install(root);
})(globalThis, () => {
  const STATE_KEY = "calendarClockOverlayState";
  const MODULE_PATH = "src/content/page-owned-info/main-world-hook.js";
  const TEMPORAL_MODULE_PATH = "src/temporal-projection/temporal-projection.js";
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
      color: /^#[0-9a-f]{6}$/i.test(value.color || "") ? value.color : "",
      calendar: copyText(value.calendar, 256),
      calendarName: copyText(value.calendarName, 256),
      capturedFrom: "google-page-owned",
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
    const status = isPlainObject(message.status) ? {
      phase: copyText(message.status.phase, 40),
      transport: copyText(message.status.transport, 20),
      endpoint: copyText(message.status.endpoint, 100),
      reason: copyText(message.status.reason, 160),
      capturedResponses: Math.max(0, Math.min(10000, Number(message.status.capturedResponses) || 0)),
      extractedRecords: Math.max(0, Math.min(MAX_RECORDS, Number(message.status.extractedRecords) || 0)),
      lastCapturedAt: Math.max(0, Number(message.status.lastCapturedAt) || 0)
    } : null;
    return { records, deletedIds, status };
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

    let enabled = true;
    let records = [];
    let port = null;
    const token = makeSecret(scope.crypto);
    const channelId = makeSecret(scope.crypto);
    const subscribers = new Set();
    let status = {
      phase: "loading",
      transport: "",
      endpoint: "",
      reason: "optional MAIN-world module is loading",
      capturedResponses: 0,
      extractedRecords: 0,
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

    const api = {
      isEnabled: () => enabled,
      getRecords: () => records.slice(),
      getStatus: () => ({ ...status, enabled }),
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
          reason: enabled ? "waiting for a relevant Calendar sync response" : "disabled; wrappers are dormant",
          extractedRecords: 0
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

    const script = scope.document.createElement("script");
    script.src = scope.chrome.runtime.getURL(MODULE_PATH);
    script.async = false;
    script.addEventListener("error", () => {
      status = { ...status, phase: "unavailable", reason: "optional page-owned module is unavailable" };
      notify();
    }, { once: true });
    script.addEventListener("load", () => {
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = event => {
        const message = event.data;
        if (isPlainObject(message) && message.type === "ready" && message.channelId === channelId) {
          status = { ...status, phase: "ready", reason: enabled ? "waiting for a relevant Calendar sync response" : "disabled; wrappers are dormant" };
          configureMainWorld();
          notify();
          return;
        }
        const sanitized = sanitizeRecordsMessage(message, token);
        if (!sanitized) return;
        records = sanitized.records;
        if (sanitized.status) status = sanitized.status;
        notify(sanitized.deletedIds);
      };
      port.start();
      scope.window.postMessage({ type: "CALENDAR_CLOCK_PAGE_OWNED_INIT", channelId }, scope.location.origin, [channel.port2]);
      script.remove();
    }, { once: true });
    (scope.document.head || scope.document.documentElement).appendChild(script);
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
