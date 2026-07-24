(() => {
  const CALENDAR_CLOCK_OVERLAY_STATE_KEY = "calendarClockOverlayState";
  const CALENDAR_CLOCK_TAB_STATE_KEY_PREFIX = "calendarClockOverlayTabState:";

  function isTrustedCalendarClockTabStateSender(sender) {
    try {
      const url = new URL(sender?.url || "");
      return url.protocol === "https:"
        && url.hostname === "calendar.google.com"
        && Number.isInteger(sender?.tab?.id);
    } catch (_error) {
      return false;
    }
  }

  function getCalendarClockTabStateKey(tabId) {
    return `${CALENDAR_CLOCK_TAB_STATE_KEY_PREFIX}${tabId}`;
  }

  function isCalendarClockStateRecord(state) {
    return Boolean(state && typeof state === "object" && !Array.isArray(state));
  }

  function getCalendarClockSessionStorage() {
    return chrome.storage?.session || null;
  }

  function loadCalendarClockTabState(sender, sendResponse) {
    if (!isTrustedCalendarClockTabStateSender(sender)) {
      sendResponse({ ok: false, error: "Untrusted tab state requester." });
      return;
    }

    const sessionStorage = getCalendarClockSessionStorage();
    if (!sessionStorage) {
      sendResponse({ ok: false, error: "Tab session storage is unavailable." });
      return;
    }

    const key = getCalendarClockTabStateKey(sender.tab.id);
    sessionStorage.get(key, result => {
      const storageError = chrome.runtime.lastError;
      if (storageError) {
        sendResponse({ ok: false, error: storageError.message || "Tab state could not be loaded." });
        return;
      }
      const state = result?.[key];
      sendResponse({ ok: true, state: isCalendarClockStateRecord(state) ? state : null });
    });
  }

  function saveCalendarClockTabState(state, sender, sendResponse) {
    if (!isTrustedCalendarClockTabStateSender(sender) || !isCalendarClockStateRecord(state)) {
      sendResponse({ ok: false, error: "Invalid tab state request." });
      return;
    }

    const sessionStorage = getCalendarClockSessionStorage();
    if (!sessionStorage) {
      sendResponse({ ok: false, error: "Tab session storage is unavailable." });
      return;
    }

    const key = getCalendarClockTabStateKey(sender.tab.id);
    sessionStorage.set({ [key]: { ...state, perTabState: true } }, () => {
      const storageError = chrome.runtime.lastError;
      sendResponse(storageError
        ? { ok: false, error: storageError.message || "Tab state could not be saved." }
        : { ok: true });
    });
  }

  function clearCalendarClockTabStates(callback = () => {}) {
    const sessionStorage = getCalendarClockSessionStorage();
    if (!sessionStorage) {
      callback();
      return;
    }

    sessionStorage.get(null, result => {
      const readError = chrome.runtime.lastError;
      if (readError) {
        callback(readError);
        return;
      }

      const keys = Object.keys(result || {}).filter(key => key.startsWith(CALENDAR_CLOCK_TAB_STATE_KEY_PREFIX));
      if (!keys.length) {
        callback();
        return;
      }

      sessionStorage.remove(keys, () => callback(chrome.runtime.lastError || null));
    });
  }

  function setCalendarClockPerTabState(message, sender, sendResponse) {
    if (!isTrustedCalendarClockTabStateSender(sender) || !isCalendarClockStateRecord(message?.state)) {
      sendResponse({ ok: false, error: "Invalid per-tab state request." });
      return;
    }

    const enabled = message.enabled === true;
    const state = { ...message.state, perTabState: enabled };
    if (!enabled) {
      chrome.storage.local.set({ [CALENDAR_CLOCK_OVERLAY_STATE_KEY]: state }, () => {
        const storageError = chrome.runtime.lastError;
        if (storageError) {
          sendResponse({ ok: false, error: storageError.message || "Shared clock state could not be saved." });
          return;
        }
        clearCalendarClockTabStates(cleanupError => {
          sendResponse({
            ok: true,
            cleanupWarning: cleanupError?.message || ""
          });
        });
      });
      return;
    }

    const sessionStorage = getCalendarClockSessionStorage();
    if (!sessionStorage) {
      sendResponse({ ok: false, error: "Tab session storage is unavailable." });
      return;
    }

    const tabStateKey = getCalendarClockTabStateKey(sender.tab.id);
    sessionStorage.set({ [tabStateKey]: state }, () => {
      const sessionError = chrome.runtime.lastError;
      if (sessionError) {
        sendResponse({ ok: false, error: sessionError.message || "Tab state could not be saved." });
        return;
      }

      chrome.storage.local.set({ [CALENDAR_CLOCK_OVERLAY_STATE_KEY]: state }, () => {
        const storageError = chrome.runtime.lastError;
        if (!storageError) {
          sendResponse({ ok: true });
          return;
        }

        const errorMessage = storageError.message || "Per-tab state could not be enabled.";
        sessionStorage.remove(tabStateKey, () => {
          void chrome.runtime.lastError;
          sendResponse({ ok: false, error: errorMessage });
        });
      });
    });
  }

  function handleCalendarClockTabStateMessage(message, sender, sendResponse) {
    if (message?.type === "CALENDAR_CLOCK_LOAD_TAB_STATE") {
      loadCalendarClockTabState(sender, sendResponse);
      return true;
    }
    if (message?.type === "CALENDAR_CLOCK_SAVE_TAB_STATE") {
      saveCalendarClockTabState(message.state, sender, sendResponse);
      return true;
    }
    if (message?.type === "CALENDAR_CLOCK_SET_PER_TAB_STATE") {
      setCalendarClockPerTabState(message, sender, sendResponse);
      return true;
    }
    return false;
  }

  chrome.runtime.onMessage.addListener(handleCalendarClockTabStateMessage);

  if (chrome.tabs?.onRemoved) {
    chrome.tabs.onRemoved.addListener(tabId => {
      const sessionStorage = getCalendarClockSessionStorage();
      if (!sessionStorage || !Number.isInteger(tabId)) return;
      sessionStorage.remove(getCalendarClockTabStateKey(tabId), () => {
        void chrome.runtime.lastError;
      });
    });
  }

  if (chrome.tabs?.onReplaced) {
    chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
      const sessionStorage = getCalendarClockSessionStorage();
      if (!sessionStorage || !Number.isInteger(addedTabId) || !Number.isInteger(removedTabId)) return;

      const previousKey = getCalendarClockTabStateKey(removedTabId);
      const nextKey = getCalendarClockTabStateKey(addedTabId);
      sessionStorage.get(previousKey, result => {
        if (chrome.runtime.lastError) return;
        const state = result?.[previousKey];
        if (!isCalendarClockStateRecord(state)) return;
        sessionStorage.set({ [nextKey]: state }, () => {
          if (chrome.runtime.lastError) return;
          sessionStorage.remove(previousKey, () => {
            void chrome.runtime.lastError;
          });
        });
      });
    });
  }

  globalThis.CalendarClockTabState = Object.freeze({
    loadCalendarClockTabState,
    saveCalendarClockTabState,
    clearCalendarClockTabStates,
    setCalendarClockPerTabState
  });
})();
