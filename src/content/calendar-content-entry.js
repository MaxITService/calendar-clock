// Entry point that connects extension messages, DOM observation, focus/resize hooks, and startup timers.
function getCalendarClockExtensionOrigin() {
  if (!canUseCalendarClockExtensionApi()) return null;

  try {
    return new URL(chrome.runtime.getURL("")).origin;
  } catch (error) {
    markCalendarClockExtensionContextInvalidated(error);
    return null;
  }
}

function isTrustedCalendarClockFrameMessage(event) {
  if (!calendarClockRoot || !calendarClockFrame?.contentWindow) return false;
  const extensionOrigin = getCalendarClockExtensionOrigin();
  return Boolean(extensionOrigin
    && event.source === calendarClockFrame.contentWindow
    && event.origin === extensionOrigin);
}

const CALENDAR_CLOCK_NAVIGATION_REFRESH_DELAYS_MS = [200, 900, 1800, 3200, 5200, 8000, 12000, 15000];
const CALENDAR_CLOCK_NAVIGATION_SETTLE_MS = 12000;
const CALENDAR_CLOCK_EVENT_REMINDERS_MODULE_PATH = "src/content/event-reminders/main.mjs";
let calendarClockLastNavigationKey = "";
let calendarClockNavigationPollIntervalId = null;
let calendarClockNavigationRefreshTimerIds = [];

async function initializeCalendarClockEventReminders() {
  if (globalThis.calendarClockEventReminders || !canUseCalendarClockExtensionApi()) return;
  try {
    const module = await import(chrome.runtime.getURL(CALENDAR_CLOCK_EVENT_REMINDERS_MODULE_PATH));
    if (calendarClockExtensionContextInvalidated) return;
    const api = await module.install({
      window,
      document,
      root: calendarClockRoot,
      getState: () => calendarClockState,
      runtime: chrome.runtime,
      getEvents: () => calendarClockEvents,
      onContextInvalidated: onCalendarClockContextInvalidated,
      setDebugPlaying: setCalendarClockTickSoundActive
    });
    if (calendarClockExtensionContextInvalidated) {
      api?.destroy?.();
      return;
    }
    if (api) globalThis.calendarClockEventReminders = api;
  } catch (error) {
    calendarClockWarn("optional event reminders module is unavailable", error);
  }
}

function getCalendarClockNavigationKey() {
  return [
    location.href,
    document.title
  ].join("|");
}

function clearCalendarClockNavigationRefreshTimers() {
  calendarClockNavigationRefreshTimerIds.forEach(timerId => clearTimeout(timerId));
  calendarClockNavigationRefreshTimerIds = [];
}

function scheduleCalendarClockNavigationRefresh(reason = "calendar navigation") {
  if (calendarClockExtensionContextInvalidated) return;
  calendarClockLog("schedule refresh after", reason);
  if (!calendarClockNavigationPending) calendarClockNavigationPendingSinceMs = Date.now();
  calendarClockNavigationPending = true;
  calendarClockNavigationSettlingUntilMs = Date.now() + CALENDAR_CLOCK_NAVIGATION_SETTLE_MS;
  calendarClockNavigationSettlingReason = reason;
  applyFollowNowWindow({ skipSave: true, force: true });
  refreshDateSensitiveWindow();
  syncClockFrame();
  renderDebugPanel();
  updatePanelStats();
  clearCalendarClockNavigationRefreshTimers();
  calendarClockNavigationRefreshTimerIds = CALENDAR_CLOCK_NAVIGATION_REFRESH_DELAYS_MS.map(delay => setTimeout(() => {
    if (calendarClockExtensionContextInvalidated) return;
    queuePublishCalendarEvents();
  }, delay));
}

function detectCalendarClockNavigationChange(reason = "calendar navigation change") {
  const nextKey = getCalendarClockNavigationKey();
  if (calendarClockLastNavigationKey === nextKey) return false;
  calendarClockLastNavigationKey = nextKey;
  scheduleCalendarClockNavigationRefresh(reason);
  return true;
}

function isLikelyGoogleCalendarNavigationControl(target) {
  const control = target?.closest?.("button, a, [role='button']");
  if (!control || calendarClockRoot?.contains(control)) return false;

  const label = [
    control.getAttribute("aria-label"),
    control.getAttribute("title"),
    control.getAttribute("data-tooltip"),
    control.textContent
  ].filter(Boolean).join(" ");

  return /\b(next|previous|prev|today|day|week|month|schedule|agenda)\b/i.test(label);
}

function handleGoogleCalendarNavigationClick(event) {
  if (!isLikelyGoogleCalendarNavigationControl(event.target)) return;
  scheduleCalendarClockNavigationRefresh("calendar navigation click");
}

function getCalendarClockArcTooltip() {
  return calendarClockRoot?.querySelector?.("[data-cc-arc-tooltip]") || null;
}

function normalizeCalendarClockTooltipText(value, maxLength = 500) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function normalizeCalendarClockTooltipColor(value) {
  const color = String(value || "").trim();
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color) ? color : "#b88d5a";
}

function normalizeCalendarClockArcTooltipPayload(value) {
  if (!value || typeof value !== "object") return null;
  const state = ["point", "invalid", "inactive", "active"].includes(value.state) ? value.state : "inactive";
  const completion = Math.min(100, Math.max(0, Number(value.completion) || 0));
  return {
    title: normalizeCalendarClockTooltipText(value.title).trim() || "(No title)",
    calendarName: normalizeCalendarClockTooltipText(value.calendarName, 256),
    timeLabel: normalizeCalendarClockTooltipText(value.timeLabel, 120),
    color: normalizeCalendarClockTooltipColor(value.color),
    state,
    used: normalizeCalendarClockTooltipText(value.used, 80),
    remaining: normalizeCalendarClockTooltipText(value.remaining, 80),
    completion
  };
}

function createCalendarClockArcTooltipText(className, text, tagName = "div") {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createCalendarClockArcTooltipRow(label, value) {
  const row = document.createElement("div");
  row.className = "cc-arc-tooltip-row";
  row.append(
    createCalendarClockArcTooltipText("", label, "span"),
    createCalendarClockArcTooltipText("", value, "strong")
  );
  return row;
}

function renderCalendarClockArcTooltip(payload) {
  const tooltip = getCalendarClockArcTooltip();
  const details = normalizeCalendarClockArcTooltipPayload(payload);
  if (!tooltip || !details) return false;

  const title = document.createElement("div");
  title.className = "cc-arc-tooltip-title";
  title.append(
    createCalendarClockArcTooltipText("cc-arc-tooltip-dot", "", "span"),
    createCalendarClockArcTooltipText("", details.title, "span")
  );

  const content = [title];
  if (details.calendarName) {
    content.push(createCalendarClockArcTooltipText("cc-arc-tooltip-calendar", details.calendarName));
  }
  content.push(createCalendarClockArcTooltipText("cc-arc-tooltip-range", details.timeLabel));

  if (details.state === "point") {
    content.push(createCalendarClockArcTooltipText("cc-arc-tooltip-muted", "Time point"));
  } else if (details.state === "invalid") {
    content.push(createCalendarClockArcTooltipText("cc-arc-tooltip-muted", "Invalid time range"));
  } else if (details.state === "inactive") {
    content.push(createCalendarClockArcTooltipText("cc-arc-tooltip-muted", "Not active now"));
  } else {
    content.push(
      createCalendarClockArcTooltipRow("Time used", details.used),
      createCalendarClockArcTooltipRow("Time to end", details.remaining),
      createCalendarClockArcTooltipRow("Completion", `${details.completion.toFixed(1)}%`)
    );
    const progress = document.createElement("div");
    progress.className = "cc-arc-tooltip-progress";
    const progressValue = document.createElement("span");
    progressValue.style.width = `${details.completion}%`;
    progress.appendChild(progressValue);
    content.push(progress);
  }

  tooltip.style.setProperty("--cc-arc-tooltip-color", details.color);
  tooltip.replaceChildren(...content);
  return true;
}

function postCalendarClockArcTooltipControl(type) {
  const targetOrigin = getCalendarClockFrameTargetOrigin();
  if (!targetOrigin || !calendarClockFrame?.contentWindow) return;
  postCalendarClockFrameMessage({ type }, targetOrigin);
}

function bindCalendarClockArcTooltipHover(tooltip) {
  if (!tooltip || tooltip.dataset.ccHoverBound === "true") return;
  tooltip.dataset.ccHoverBound = "true";
  tooltip.addEventListener("pointerenter", () => {
    postCalendarClockArcTooltipControl("CALENDAR_CLOCK_EVENT_TOOLTIP_ENTER");
  });
  tooltip.addEventListener("pointerleave", () => {
    postCalendarClockArcTooltipControl("CALENDAR_CLOCK_EVENT_TOOLTIP_LEAVE");
  });
}

function positionCalendarClockArcTooltip(clientX, clientY) {
  const tooltip = getCalendarClockArcTooltip();
  if (!tooltip || !calendarClockFrame) return;

  const frameRect = calendarClockFrame.getBoundingClientRect();
  const localX = Math.min(frameRect.width, Math.max(0, Number(clientX) || 0));
  const localY = Math.min(frameRect.height, Math.max(0, Number(clientY) || 0));
  const anchorX = frameRect.left + localX;
  const anchorY = frameRect.top + localY;
  const gap = 14;
  const tooltipRect = tooltip.getBoundingClientRect();
  const maxX = Math.max(gap, window.innerWidth - tooltipRect.width - gap);
  const maxY = Math.max(gap, window.innerHeight - tooltipRect.height - gap);
  let x = anchorX + gap;
  let y = anchorY + gap;

  if (x > maxX) x = anchorX - tooltipRect.width - gap;
  if (y > maxY) y = anchorY - tooltipRect.height - gap;
  tooltip.style.left = `${Math.min(maxX, Math.max(gap, x))}px`;
  tooltip.style.top = `${Math.min(maxY, Math.max(gap, y))}px`;
  tooltip.dataset.ccPointerX = String(localX);
  tooltip.dataset.ccPointerY = String(localY);
}

function showCalendarClockArcTooltip(data) {
  const tooltip = getCalendarClockArcTooltip();
  if (!tooltip || !renderCalendarClockArcTooltip(data.tooltip)) return;
  bindCalendarClockArcTooltipHover(tooltip);
  tooltip.classList.add("is-visible");
  tooltip.setAttribute("aria-hidden", "false");
  positionCalendarClockArcTooltip(data.clientX, data.clientY);
}

function updateCalendarClockArcTooltip(data) {
  const tooltip = getCalendarClockArcTooltip();
  if (!tooltip?.classList.contains("is-visible") || !renderCalendarClockArcTooltip(data.tooltip)) return;
  positionCalendarClockArcTooltip(tooltip.dataset.ccPointerX, tooltip.dataset.ccPointerY);
}

function hideCalendarClockArcTooltip() {
  const tooltip = getCalendarClockArcTooltip();
  if (!tooltip) return;
  tooltip.classList.remove("is-visible");
  tooltip.setAttribute("aria-hidden", "true");
}

window.addEventListener("message", event => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "CALENDAR_CLOCK_SET_MODE") {
    if (!isTrustedCalendarClockFrameMessage(event)) return;
    setClockMode(data.mode);
  } else if (data.type === "CALENDAR_CLOCK_FACE_AVAILABILITY") {
    if (!isTrustedCalendarClockFrameMessage(event)) return;
    applyCalendarClockFaceAvailability(data);
  } else if (data.type === "CALENDAR_CLOCK_HIGHLIGHT_EVENT") {
    if (!isTrustedCalendarClockFrameMessage(event)) return;
    highlightCalendarEvent(data.eventId, data.index, data.scroll);
  } else if (data.type === "CALENDAR_CLOCK_CLEAR_EVENT_HIGHLIGHT") {
    if (!isTrustedCalendarClockFrameMessage(event)) return;
    clearCalendarEventHighlight();
  } else if (data.type === "CALENDAR_CLOCK_SHOW_EVENT_TOOLTIP") {
    if (!isTrustedCalendarClockFrameMessage(event)) return;
    showCalendarClockArcTooltip(data);
  } else if (data.type === "CALENDAR_CLOCK_MOVE_EVENT_TOOLTIP") {
    if (!isTrustedCalendarClockFrameMessage(event)) return;
    positionCalendarClockArcTooltip(data.clientX, data.clientY);
  } else if (data.type === "CALENDAR_CLOCK_UPDATE_EVENT_TOOLTIP") {
    if (!isTrustedCalendarClockFrameMessage(event)) return;
    updateCalendarClockArcTooltip(data);
  } else if (data.type === "CALENDAR_CLOCK_HIDE_EVENT_TOOLTIP") {
    if (!isTrustedCalendarClockFrameMessage(event)) return;
    hideCalendarClockArcTooltip();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "CALENDAR_CLOCK_COLLECT_EVENTS") return false;

  publishCalendarEvents().then(events => {
    sendResponse({
      events,
      capturedAt: Date.now(),
      captureMeta: calendarClockCaptureMeta,
      effectiveSource: calendarClockEffectiveEventSource,
      temporalContext: calendarClockEffectiveEventSource.temporalContext || null,
      timeZone: typeof getCalendarClockTimeZone === "function" ? getCalendarClockTimeZone() : "",
      systemTimeZone: typeof getCalendarClockSystemTimeZone === "function" ? getCalendarClockSystemTimeZone() : ""
    });
  }).catch(error => {
    sendResponse({ events: [], error: String(error?.message || error), capturedAt: Date.now() });
  });
  return true;
});

function isCalendarClockOwnMutation(record) {
  return Boolean(calendarClockRoot && calendarClockRoot.contains(record.target));
}

function doesCalendarClockMutationAffectCapturedItems(record) {
  if (isCalendarClockOwnMutation(record)) return false;

  const target = record.target;
  if (record.type === "attributes") {
    return Boolean(target?.closest?.(CALENDAR_CLOCK_SELECTOR));
  }

  if (target?.closest?.(CALENDAR_CLOCK_SELECTOR)) return true;
  return [...Array.from(record.addedNodes || []), ...Array.from(record.removedNodes || [])].some(node => node.nodeType === 1
    && (node.matches?.(CALENDAR_CLOCK_SELECTOR) || node.querySelector?.(CALENDAR_CLOCK_SELECTOR)));
}

function handleCalendarClockMutations(records) {
  if (!records.some(doesCalendarClockMutationAffectCapturedItems)) return;
  queuePublishCalendarEvents();
}

calendarClockObserver = new MutationObserver(handleCalendarClockMutations);
calendarClockObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["aria-label", "title", "data-eventid", "data-eventchip", "data-eid", "data-taskid", "data-task-id"]
});
onCalendarClockContextInvalidated(() => {
  if (calendarClockObserver) calendarClockObserver.disconnect();
});

window.addEventListener("focus", queuePublishCalendarEvents);
window.addEventListener("popstate", () => detectCalendarClockNavigationChange("calendar popstate"));
window.addEventListener("hashchange", () => detectCalendarClockNavigationChange("calendar hashchange"));
document.addEventListener("click", handleGoogleCalendarNavigationClick, true);
window.addEventListener("resize", () => {
  if (!calendarClockRoot) return;
  const previousX = calendarClockState.miniX;
  const previousY = calendarClockState.miniY;
  updateMiniClockPosition();
  const panelPositionChanged = updatePanelPosition();
  if (calendarClockState.miniX !== previousX || calendarClockState.miniY !== previousY || panelPositionChanged) {
    saveCalendarClockState();
  }
});

loadCalendarClockState().then(async () => {
  if (calendarClockExtensionContextInvalidated) return;
  calendarClockLastNavigationKey = getCalendarClockNavigationKey();
  await ensureCalendarClockUi();
  await initializeCalendarClockEventReminders();
  applyFollowNowWindow({ skipSave: true });
  queuePublishCalendarEvents();
}).catch(error => {
  calendarClockWarn("failed to initialize content script", error);
});

calendarClockNavigationPollIntervalId = setInterval(() => {
  if (calendarClockExtensionContextInvalidated) return;
  detectCalendarClockNavigationChange("calendar route poll");
}, 500);
onCalendarClockContextInvalidated(() => {
  if (calendarClockNavigationPollIntervalId) clearInterval(calendarClockNavigationPollIntervalId);
  clearCalendarClockNavigationRefreshTimers();
  document.removeEventListener("click", handleGoogleCalendarNavigationClick, true);
});

const unsubscribeCalendarClockPageOwnedInfo = globalThis.calendarClockPageOwnedInfo?.subscribe?.(snapshot => {
  if (calendarClockExtensionContextInvalidated) return;
  if (Array.isArray(snapshot?.deletedIds)) {
    snapshot.deletedIds.forEach(id => {
      const normalizedId = String(id || "").slice(0, 256).trim();
      if (normalizedId) calendarClockPendingDeletedEventIds.add(normalizedId);
    });
  }
  queuePublishCalendarEvents();
});
if (typeof unsubscribeCalendarClockPageOwnedInfo === "function") {
  onCalendarClockContextInvalidated(unsubscribeCalendarClockPageOwnedInfo);
}

calendarClockTickIntervalId = setInterval(() => {
  if (calendarClockExtensionContextInvalidated) return;
  applyFollowNowWindow({ skipSave: true });
  refreshDateSensitiveWindow();
  updatePanelStats();
}, 30 * 1000);
onCalendarClockContextInvalidated(() => {
  if (calendarClockTickIntervalId) clearInterval(calendarClockTickIntervalId);
});
