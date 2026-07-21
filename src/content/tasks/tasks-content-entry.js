// Publishes timed Google Tasks from the cross-origin Tasks side panel iframe.
const TASK_CLOCK_SELECTOR = [
  "[data-task-id]",
  "[data-taskid]",
  "[data-id][role='listitem']",
  "[role='listitem']"
].join(",");
const TASK_CLOCK_STATE_KEY = "calendarClockOverlayState";
const TASK_CLOCK_LOG_PREFIX = "[calen.clock.ext]";
const TASK_CLOCK_CAPTURE_LIMIT = 50;
const TASK_CLOCK_CAPTURE_LIMIT_OPTIONS = [50, 100, 200];
const TASK_CLOCK_TASK_CONTEXT_PATTERN = /\b(task|subtask|complete task|mark as complete|due|details)\b/i;
const TASK_CLOCK_NON_TASK_CHROME_PATTERN = /\b(main menu|google apps|google account|keyboard shortcuts|side panel|open in new tab|create new list|rename list|delete list|sort by|more options|show completed|hide completed)\b/i;
let taskClockConsoleLogs = false;
let taskClockCaptureLimit = TASK_CLOCK_CAPTURE_LIMIT;
let taskClockExtensionContextInvalidated = false;
let taskPublishTimer = null;
let taskObserver = null;
let taskClockCaptureMeta = null;
let unsubscribeTaskClockPageOwnedInfo = null;

function taskClockLog(...args) {
  if (!taskClockConsoleLogs) return;
  console.log(TASK_CLOCK_LOG_PREFIX, ...args);
}

function taskClockWarn(...args) {
  if (!taskClockConsoleLogs) return;
  console.warn(TASK_CLOCK_LOG_PREFIX, ...args);
}

function isTaskClockExtensionContextError(error) {
  return /Extension context invalidated/i.test(String(error?.message || error || ""));
}

function markTaskClockExtensionContextInvalidated(error) {
  if (error && !isTaskClockExtensionContextError(error)) return false;
  if (taskClockExtensionContextInvalidated) return true;

  taskClockExtensionContextInvalidated = true;
  taskClockLog("extension context invalidated; stopping stale Tasks iframe work");
  clearTimeout(taskPublishTimer);
  try {
    if (taskObserver) taskObserver.disconnect();
  } catch (_error) {
    // Best effort cleanup only.
  }
  try {
    unsubscribeTaskClockPageOwnedInfo?.();
    unsubscribeTaskClockPageOwnedInfo = null;
  } catch (_error) {
    // Best effort cleanup only.
  }
  return true;
}

function canUseTaskClockExtensionApi() {
  if (taskClockExtensionContextInvalidated) return false;

  try {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  } catch (error) {
    markTaskClockExtensionContextInvalidated(error);
    return false;
  }
}

function getTaskClockRuntimeLastError() {
  try {
    return chrome.runtime?.lastError || null;
  } catch (error) {
    markTaskClockExtensionContextInvalidated(error);
    return null;
  }
}

function normalizeTaskClockCaptureLimit(value) {
  const limit = Math.round(Number(value));
  return TASK_CLOCK_CAPTURE_LIMIT_OPTIONS.includes(limit)
    ? limit
    : TASK_CLOCK_CAPTURE_LIMIT;
}

function applyTaskClockSettings(state) {
  const settings = state && typeof state === "object" ? state : {};
  taskClockConsoleLogs = settings.consoleLogs === true;
  const nextCaptureLimit = normalizeTaskClockCaptureLimit(settings.captureLimit);
  const captureLimitChanged = taskClockCaptureLimit !== nextCaptureLimit;
  taskClockCaptureLimit = nextCaptureLimit;
  return captureLimitChanged;
}

function loadTaskClockSettings() {
  if (!canUseTaskClockExtensionApi()) return;

  try {
    chrome.storage.local.get(TASK_CLOCK_STATE_KEY, result => {
      const runtimeError = getTaskClockRuntimeLastError();
      if (runtimeError) {
        markTaskClockExtensionContextInvalidated(runtimeError);
        return;
      }
      if (applyTaskClockSettings(result[TASK_CLOCK_STATE_KEY])) queueTaskPublish();
    });
  } catch (error) {
    if (!markTaskClockExtensionContextInvalidated(error)) {
      taskClockWarn("failed to load Tasks log setting", error);
    }
  }
}

function watchTaskClockSettings() {
  if (!canUseTaskClockExtensionApi() || !chrome.storage?.onChanged) return;

  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[TASK_CLOCK_STATE_KEY]) return;
      if (applyTaskClockSettings(changes[TASK_CLOCK_STATE_KEY].newValue)) queueTaskPublish();
    });
  } catch (error) {
    if (!markTaskClockExtensionContextInvalidated(error)) {
      taskClockWarn("failed to watch Tasks log setting", error);
    }
  }
}

function taskTo24Hour(hour, minute, meridiem) {
  let h = Number(hour);
  const m = Number(minute || 0);
  const marker = meridiem ? meridiem.toLowerCase() : "";

  if (marker.startsWith("p") && h < 12) h += 12;
  if (marker.startsWith("a") && h === 12) h = 0;

  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function inferTaskCompactRangeStartMeridiem(startHour, endHour, endMeridiem) {
  const start = Number(startHour);
  const end = Number(endHour);
  const marker = String(endMeridiem || "").toLowerCase();
  const crossesBoundary = start !== 12 && (start > end || end === 12);

  if (!crossesBoundary) return endMeridiem;
  if (marker.startsWith("p")) return "am";
  if (marker.startsWith("a")) return "pm";
  return endMeridiem;
}

function isConservativeTaskDotTimeMinute(minute) {
  const value = Number(minute);
  return value === 0 || value > 12;
}

function parseTaskTimeRange(value) {
  const text = String(value || "").replace(/\s+/g, " ");

  const meridiemRange = text.match(/(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)\s*(?:to|until|-|–|—)\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i);
  if (meridiemRange) {
    const start = taskTo24Hour(meridiemRange[1], meridiemRange[2], meridiemRange[3]);
    const end = taskTo24Hour(meridiemRange[4], meridiemRange[5], meridiemRange[6]);
    if (start && end) return { start, end };
  }

  const compactMeridiemRange = text.match(/(\d{1,2})(?::(\d{2}))?\s*(?:to|until|-|–|—)\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i);
  if (compactMeridiemRange) {
    const endMarker = compactMeridiemRange[5];
    const startMarker = inferTaskCompactRangeStartMeridiem(compactMeridiemRange[1], compactMeridiemRange[3], endMarker);
    const start = taskTo24Hour(compactMeridiemRange[1], compactMeridiemRange[2], startMarker);
    const end = taskTo24Hour(compactMeridiemRange[3], compactMeridiemRange[4], endMarker);
    if (start && end) return { start, end };
  }

  const twentyFourHourRange = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:to|until|-|–|—)\s*([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFourHourRange) {
    return {
      start: `${String(twentyFourHourRange[1]).padStart(2, "0")}:${twentyFourHourRange[2]}`,
      end: `${String(twentyFourHourRange[3]).padStart(2, "0")}:${twentyFourHourRange[4]}`
    };
  }

  const dotTimeRange = text.match(/\b([01]?\d|2[0-3])\.([0-5]\d)\s*(?:to|until|-|–|—)\s*([01]?\d|2[0-3])\.([0-5]\d)(?!\.\d)\b/);
  if (dotTimeRange
      && isConservativeTaskDotTimeMinute(dotTimeRange[2])
      && isConservativeTaskDotTimeMinute(dotTimeRange[4])) {
    return {
      start: `${String(dotTimeRange[1]).padStart(2, "0")}:${dotTimeRange[2]}`,
      end: `${String(dotTimeRange[3]).padStart(2, "0")}:${dotTimeRange[4]}`
    };
  }

  const meridiemTime = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)\b/i);
  if (meridiemTime) {
    const start = taskTo24Hour(meridiemTime[1], meridiemTime[2], meridiemTime[3]);
    if (start) {
      return {
        start,
        end: start,
        durationKind: "point",
        isPointEvent: true
      };
    }
  }

  const twentyFourHourTime = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFourHourTime) {
    const start = `${String(twentyFourHourTime[1]).padStart(2, "0")}:${twentyFourHourTime[2]}`;
    return {
      start,
      end: start,
      durationKind: "point",
      isPointEvent: true
    };
  }

  const dotTime = text.match(/(?:^|[^\w.])([01]?\d|2[0-3])\.([0-5]\d)(?!\.\d)\b/);
  if (dotTime && isConservativeTaskDotTimeMinute(dotTime[2])) {
    const start = `${String(dotTime[1]).padStart(2, "0")}:${dotTime[2]}`;
    return {
      start,
      end: start,
      durationKind: "point",
      isPointEvent: true
    };
  }

  return null;
}

function hasTaskClockTaskDataAttr(node) {
  return node.hasAttribute("data-task-id")
    || node.hasAttribute("data-taskid")
    || node.hasAttribute("data-id");
}

function isBroadTaskClockListitem(node) {
  return node.getAttribute("role") === "listitem" && !hasTaskClockTaskDataAttr(node);
}

function isTaskClockTasksAppContext() {
  return /(^|\.)tasks\.google\.com$/i.test(window.location.hostname);
}

function isTaskClockObviousNonTaskChrome(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (/^(tasks|calendar|keep|contacts|maps)$/i.test(normalized)) return true;
  return TASK_CLOCK_NON_TASK_CHROME_PATTERN.test(normalized);
}

function isTaskClockCandidateNode(node, rawText, range) {
  if (!isBroadTaskClockListitem(node)) return true;
  if (TASK_CLOCK_TASK_CONTEXT_PATTERN.test(rawText)) return true;
  if (isTaskClockTasksAppContext() && node.querySelector("[role='checkbox'], input[type='checkbox']")) return true;
  return Boolean(range && !isTaskClockObviousNonTaskChrome(rawText));
}

function cleanTaskTitle(text, range) {
  let title = String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(?:to|until|-|–|—)\s*([01]?\d|2[0-3]):([0-5]\d)\b/gi, "")
    .replace(/\b([01]?\d|2[0-3])\.(00|1[3-9]|[2-5]\d)\s*(?:to|until|-|–|—)\s*([01]?\d|2[0-3])\.(00|1[3-9]|[2-5]\d)\b/gi, "")
    .replace(/\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?\s*(?:to|until|-|–|—)\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi, "")
    .replace(/\d{1,2}(?::\d{2})?\s*(?:to|until|-|–|—)\s*\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi, "")
    .replace(/\b(today|tomorrow|yesterday|due|date|time|details|complete|completed|active tasks)\b/gi, "")
    .replace(/\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?\b/gi, "")
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/gi, "")
    .replace(/\b([01]?\d|2[0-3])\.(00|1[3-9]|[2-5]\d)\b/gi, "")
    .trim();

  if (!title || title.length > 90 || /^no tasks yet/i.test(title)) {
    title = range?.isPointEvent ? `Task ${range.start}` : range ? `Task ${range.start} - ${range.end}` : "Google Task";
  }

  return title;
}

function taskColor(index) {
  const colors = ["#4285f4", "#1a73e8", "#00a3a3", "#7c4dff"];
  return colors[index % colors.length];
}

function makeTaskClockCaptureMeta(parsedCount, shownCount) {
  const safeParsed = Math.max(0, Math.round(Number(parsedCount) || 0));
  const safeShown = Math.max(0, Math.min(safeParsed, Math.round(Number(shownCount) || 0)));
  return {
    source: "google-tasks-dom",
    limit: taskClockCaptureLimit,
    parsedCount: safeParsed,
    shownCount: safeShown,
    omittedCount: Math.max(0, safeParsed - safeShown)
  };
}

function extractTaskEvents() {
  const nodes = Array.from(document.querySelectorAll(TASK_CLOCK_SELECTOR));
  const seen = new Set();
  const tasks = [];

  nodes.forEach((node, index) => {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const rawText = [
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.textContent
    ].filter(Boolean).join(" ");

    if (/no tasks yet/i.test(rawText) || node.dataset.type === "2") return;

    const range = parseTaskTimeRange(rawText);
    if (!range) return;
    if (!isTaskClockCandidateNode(node, rawText, range)) return;

    const title = cleanTaskTitle(rawText, range);
    const id = node.getAttribute("data-task-id")
      || node.getAttribute("data-taskid")
      || node.getAttribute("data-id")
      || `${range.start}|${range.end}|${title}`;
    const eventId = `task:${id}`;
    if (seen.has(eventId)) return;
    seen.add(eventId);

    tasks.push({
      id: eventId,
      domKey: eventId,
      title,
      start: range.start,
      end: range.end,
      durationKind: range.durationKind || "range",
      isPointEvent: range.isPointEvent === true,
      color: taskColor(tasks.length),
      capturedFrom: "google-tasks-dom",
      rawText: rawText.slice(0, 800)
    });
  });

  const limitedTasks = tasks.slice(0, taskClockCaptureLimit);
  taskClockCaptureMeta = makeTaskClockCaptureMeta(tasks.length, limitedTasks.length);
  return limitedTasks;
}

function publishTaskEvents() {
  if (!canUseTaskClockExtensionApi()) return;
  // Page-owned mode deliberately treats the top-level Calendar publication as
  // the authoritative event/task feed. This iframe DOM feed runs only when
  // page-owned mode is disabled; publishing both paths would duplicate timed Tasks.
  if (globalThis.calendarClockPageOwnedInfo?.isEnabled?.() === true) return;

  const tasks = extractTaskEvents();
  try {
    chrome.runtime.sendMessage({
      type: "CALENDAR_CLOCK_TASKS",
      tasks,
      captureMeta: { task: taskClockCaptureMeta }
    }, () => {
      const runtimeError = getTaskClockRuntimeLastError();
      if (runtimeError) markTaskClockExtensionContextInvalidated(runtimeError);
    });
  } catch (error) {
    if (!markTaskClockExtensionContextInvalidated(error)) {
      taskClockWarn("failed to publish Tasks events", error);
    }
  }
}

function queueTaskPublish() {
  if (taskClockExtensionContextInvalidated) return;
  clearTimeout(taskPublishTimer);
  taskPublishTimer = setTimeout(publishTaskEvents, 300);
}

taskObserver = new MutationObserver(queueTaskPublish);
taskObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
window.addEventListener("focus", queueTaskPublish);
loadTaskClockSettings();
watchTaskClockSettings();
let taskClockPageOwnedWasEnabled = globalThis.calendarClockPageOwnedInfo?.isEnabled?.() === true;
unsubscribeTaskClockPageOwnedInfo = globalThis.calendarClockPageOwnedInfo?.subscribe?.(() => {
  const isEnabled = globalThis.calendarClockPageOwnedInfo?.isEnabled?.() === true;
  if (taskClockPageOwnedWasEnabled && !isEnabled) queueTaskPublish();
  taskClockPageOwnedWasEnabled = isEnabled;
}) || null;
queueTaskPublish();
