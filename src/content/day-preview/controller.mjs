import {
  buildCivilWindow,
  createDayPreviewState,
  getDayPreviewPresentation,
  parseDateKey
} from "./core.mjs";

const STYLE_PATH = "src/content/day-preview/styles.css";
const ADAPTER_PATHS = Object.freeze({
  google: "src/content/day-preview/providers/google.mjs",
  outlook: "src/content/day-preview/providers/outlook.mjs"
});

async function injectStyles(document, runtime) {
  if (document.getElementById("calendar-clock-day-preview-styles")) return;
  try {
    const response = await fetch(runtime.getURL(STYLE_PATH));
    if (!response.ok) throw new Error(`style request failed (${response.status})`);
    const style = document.createElement("style");
    style.id = "calendar-clock-day-preview-styles";
    style.textContent = await response.text();
    document.documentElement.appendChild(style);
  } catch (error) {
    console.warn("[calen.clock.ext] optional Day Preview styles are unavailable", error);
  }
}

function createButton(document, text, ariaLabel, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = action === "today" ? "cc-day-preview-today" : "cc-day-preview-arrow";
  button.dataset.ccDayPreviewAction = action;
  button.textContent = text;
  button.setAttribute("aria-label", ariaLabel);
  button.title = ariaLabel;
  return button;
}

function createControls(document) {
  const container = document.createElement("div");
  container.className = "cc-day-preview-settings";
  container.setAttribute("aria-label", "Preview calendar day");
  const controls = document.createElement("div");
  controls.className = "cc-day-preview-controls";
  controls.append(
    createButton(document, "←", "Preview previous day", "previous"),
    createButton(document, "Today", "Return Day Preview to Today", "today"),
    createButton(document, "→", "Preview next day", "next")
  );
  const status = document.createElement("div");
  status.className = "cc-day-preview-settings-status";
  status.dataset.ccDayPreviewStatus = "";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  container.append(controls, status);
  return container;
}

function createIndicator(document) {
  const indicator = document.createElement("div");
  indicator.className = "cc-day-preview-indicator";
  indicator.hidden = true;
  indicator.setAttribute("aria-live", "polite");
  indicator.setAttribute("aria-atomic", "true");

  const eyebrow = document.createElement("div");
  eyebrow.className = "cc-day-preview-eyebrow";
  eyebrow.textContent = "DAY PREVIEW";
  const fullDate = document.createElement("div");
  fullDate.className = "cc-day-preview-full-date";
  const detail = document.createElement("div");
  detail.className = "cc-day-preview-detail";
  const miniText = document.createElement("div");
  miniText.className = "cc-day-preview-mini-text";
  indicator.append(eyebrow, fullDate, detail, miniText);
  return indicator;
}

function getStatusText(snapshot, presentation) {
  const dayLabel = presentation.relativeLabel || presentation.fullDate || snapshot.dateKey;
  if (snapshot.phase === "loading") return `Loading events for ${dayLabel}…`;
  if (snapshot.phase === "unavailable") return `Events unavailable for ${dayLabel}.`;
  if (snapshot.active) return `Showing ${dayLabel}.`;
  return snapshot.phase === "ready" ? "Showing Today." : "Today";
}

async function loadAdapter(runtime, providerId) {
  const path = ADAPTER_PATHS[String(providerId || "").toLowerCase()];
  if (!path) return null;
  try {
    const module = await import(runtime.getURL(path));
    const adapter = module.createAdapter?.();
    return adapter && typeof adapter.navigateToDate === "function" ? adapter : null;
  } catch (error) {
    console.warn(`[calen.clock.ext] optional ${providerId} Day Preview adapter is unavailable`, error);
    return null;
  }
}

export async function install(options = {}) {
  const {
    window,
    document,
    runtime,
    root,
    providerId,
    getTodayDateKey,
    readNavigationDateKeys,
    getTimeZone,
    getLanguage,
    makeZonedDate,
    clearEvents,
    captureEvents,
    onStateChange,
    onContextInvalidated
  } = options;
  if (!window || !document || !runtime?.id || !root
      || typeof getTodayDateKey !== "function"
      || typeof readNavigationDateKeys !== "function"
      || typeof makeZonedDate !== "function") return null;

  await injectStyles(document, runtime);
  const settingsSection = root.querySelector(".cc-panel-section-clock-range");
  const clockSurface = root.querySelector(".cc-clock-surface");
  if (!settingsSection || !clockSurface) return null;

  const settings = createControls(document);
  const indicator = createIndicator(document);
  settingsSection.appendChild(settings);
  clockSurface.appendChild(indicator);

  const store = createDayPreviewState({ getTodayDateKey });
  const listeners = new Set();
  const listenerController = new AbortController();
  let adapterPromise = null;
  let operationId = 0;
  let navigationController = null;
  let transitionTimer = null;
  let lastTodayDateKey = store.snapshot().todayDateKey;

  function snapshot() {
    const state = store.snapshot();
    return Object.freeze({
      ...state,
      timeZone: String(getTimeZone?.() || ""),
      presentation: getDayPreviewPresentation(state, getLanguage?.())
    });
  }

  function render(animate = false) {
    const current = snapshot();
    const presentation = current.presentation;
    const statusText = getStatusText(current, presentation);
    settings.dataset.phase = current.phase;
    settings.setAttribute("aria-busy", String(current.phase === "loading"));
    settings.querySelector("[data-cc-day-preview-status]").textContent = statusText;
    settings.querySelector("[data-cc-day-preview-action='today']")
      ?.setAttribute("aria-current", current.active ? "false" : "date");

    indicator.hidden = presentation.hidden;
    indicator.dataset.phase = current.phase;
    indicator.title = current.reason || statusText;
    indicator.querySelector(".cc-day-preview-full-date").textContent = presentation.fullDate;
    indicator.querySelector(".cc-day-preview-detail").textContent = [
      presentation.relativeLabel && presentation.relativeLabel !== "Today"
        ? presentation.relativeLabel
        : "",
      current.phase === "loading"
        ? "Loading events…"
        : current.phase === "unavailable"
          ? "Events unavailable"
          : ""
    ].filter(Boolean).join(" · ");
    indicator.querySelector(".cc-day-preview-mini-text").textContent = [
      presentation.miniText,
      current.phase === "loading"
        ? "Loading…"
        : current.phase === "unavailable"
          ? "Unavailable"
          : ""
    ].filter(Boolean).join(" · ");

    if (animate && current.active) {
      indicator.classList.remove("is-changing");
      void indicator.offsetWidth;
      indicator.classList.add("is-changing");
      clearTimeout(transitionTimer);
      transitionTimer = setTimeout(() => indicator.classList.remove("is-changing"), 420);
    }
    onStateChange?.(current);
    listeners.forEach(listener => {
      try {
        listener(current);
      } catch (_error) {
        // Isolate optional listeners.
      }
    });
    return current;
  }

  async function navigateToSelection(animate = true) {
    const id = ++operationId;
    navigationController?.abort();
    navigationController = new AbortController();
    store.setStatus("loading");
    const loadingSnapshot = render(animate);
    clearEvents?.(loadingSnapshot);

    if (!adapterPromise) adapterPromise = loadAdapter(runtime, providerId);
    const adapter = await adapterPromise;
    if (id !== operationId || navigationController.signal.aborted) return;
    if (!adapter) {
      store.setStatus("unavailable", `${providerId || "Calendar"} does not expose Day Preview navigation.`);
      render();
      return;
    }

    let result;
    try {
      result = await adapter.navigateToDate({
        window,
        document,
        root,
        targetDateKey: loadingSnapshot.dateKey,
        todayDateKey: loadingSnapshot.todayDateKey,
        readHostDateKeys: readNavigationDateKeys,
        signal: navigationController.signal,
        maxAttempts: 3
      });
    } catch (error) {
      result = { ok: false, reason: String(error?.message || error) };
    }
    if (id !== operationId || navigationController.signal.aborted) return;
    if (!result?.ok) {
      store.setStatus("unavailable", result?.reason || "Calendar navigation is unavailable.");
      render();
      return;
    }

    try {
      await captureEvents?.();
    } catch (error) {
      if (id !== operationId) return;
      store.setStatus("unavailable", `Events could not be captured: ${String(error?.message || error)}`);
      render();
      return;
    }
    if (id !== operationId || navigationController.signal.aborted) return;
    const visibleDateKeys = result.visibleDateKeys;
    if (!Array.isArray(visibleDateKeys) || !visibleDateKeys.includes(loadingSnapshot.dateKey)) {
      store.setStatus("unavailable", "The provider did not expose a settled event range for the selected date.");
      render();
      return;
    }
    store.setStatus("ready");
    render();
  }

  settings.addEventListener("click", event => {
    const button = event.target.closest?.("[data-cc-day-preview-action]");
    if (!button) return;
    const action = button.dataset.ccDayPreviewAction;
    if (action === "previous") store.previous();
    else if (action === "next") store.next();
    else store.today();
    navigateToSelection().catch(error => {
      store.setStatus("unavailable", String(error?.message || error));
      render();
    });
  }, { signal: listenerController.signal });

  const midnightTimer = window.setInterval(() => {
    const current = store.snapshot();
    if (current.todayDateKey === lastTodayDateKey) return;
    lastTodayDateKey = current.todayDateKey;
    render(true);
  }, 30 * 1000);

  const api = Object.freeze({
    getSnapshot: snapshot,
    getSelectedDateKey: () => store.snapshot().dateKey,
    getAnchorDate() {
      const parts = parseDateKey(store.snapshot().dateKey);
      return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) : new Date(NaN);
    },
    getWindowDateRange(displayWindow) {
      const current = store.snapshot();
      const civilWindow = buildCivilWindow(
        current.dateKey,
        displayWindow?.start,
        displayWindow?.duration
      );
      if (!civilWindow) return null;
      const startDate = makeZonedDate(civilWindow.startDateKey, civilWindow.startTime);
      const endDate = makeZonedDate(civilWindow.endDateKey, civilWindow.endTime);
      return startDate instanceof Date && endDate instanceof Date
        && Number.isFinite(startDate.getTime()) && endDate > startDate
        ? { startDate, endDate }
        : null;
    },
    isPreviewActive: () => store.snapshot().active,
    previous: () => {
      store.previous();
      return navigateToSelection();
    },
    next: () => {
      store.next();
      return navigateToSelection();
    },
    today: () => {
      store.today();
      return navigateToSelection();
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      operationId += 1;
      navigationController?.abort();
      listenerController.abort();
      window.clearInterval(midnightTimer);
      clearTimeout(transitionTimer);
      settings.remove();
      indicator.remove();
      if (globalThis.calendarClockDayPreview === api) {
        globalThis.calendarClockDayPreview = null;
      }
    }
  });

  render();
  onContextInvalidated?.(() => api.destroy());
  window.addEventListener("pagehide", () => api.destroy(), {
    once: true,
    signal: listenerController.signal
  });
  return api;
}
