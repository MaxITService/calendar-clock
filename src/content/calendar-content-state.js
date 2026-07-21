// Defines shared state and constants used by the Google Calendar content-script modules.
const CALENDAR_CLOCK_SELECTOR = [
  "[data-eventid]",
  "[data-eventchip]",
  "[data-eid]",
  "[data-taskid]",
  "[data-task-id]",
  "[role='button'][aria-label*='Task']",
  "[role='button'][aria-label*='task']"
].join(",");

const CALENDAR_CLOCK_COLORS = [
  "#d5312f",
  "#7f3fbf",
  "#f28c28",
  "#228b8d",
  "#2d62c8",
  "#859900",
  "#c23b7a",
  "#6e553d"
];

const CALENDAR_CLOCK_STATE_KEY = "calendarClockOverlayState";
const CALENDAR_CLOCK_LOG_PREFIX = "[calen.clock.ext]";
const CALENDAR_CLOCK_SUPPORT_EMAIL = "forpphotos@gmail.com";
const CALENDAR_CLOCK_MINI_SIZE = 520;
const CALENDAR_CLOCK_MINI_MARGIN = 24;
const CALENDAR_CLOCK_CAPTURE_LIMIT = 50;
const CALENDAR_CLOCK_CAPTURE_LIMIT_OPTIONS = [50, 100, 200];
const CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS = 200;
const CALENDAR_CLOCK_TIME_PANEL_INITIAL_SIZE_VERSION = 5;
const CALENDAR_CLOCK_TIME_PANEL_INITIAL_WIDTH = 560;
const CALENDAR_CLOCK_TIME_PANEL_INITIAL_MIN_HEIGHT = 680;
const CALENDAR_CLOCK_PANEL_DEFAULT = {
  mode: "hidden",
  panelX: null,
  panelY: null,
  timePanelX: null,
  timePanelY: null,
  timePanelWidth: null,
  timePanelHeight: null,
  panelX_full: null,
  panelY_full: null,
  timePanelX_full: null,
  timePanelY_full: null,
  timePanelWidth_full: null,
  timePanelHeight_full: null,
  timePanelSizeVersion: 2,
  timePanelInitialSizeVersion: CALENDAR_CLOCK_TIME_PANEL_INITIAL_SIZE_VERSION,
  timePanelOpen: false,
  timePanelCollapsed: false,
  miniX: null,
  miniY: null,
  windowStart: "08:00",
  windowEnd: "20:00",
  windowPreset: "08:00-20:00",
  customWindowStart: "08:00",
  manualWindowPreset: "08:00-20:00",
  manualWindowStart: "08:00",
  manualWindowEnd: "20:00",
  manualCustomWindowStart: "08:00",
  followNow: true,
  followRadiusHours: 3,
  radial24Hour: false,
  clockFaceId: "analog",
  windowStartMarker: true,
  windowStartMarkerStyle: "dots",
  windowStartMarkerShape: "dots",
  windowStartMarkerColor: "#3a1860",
  windowStartMarkerWidth: 3,
  windowStartMarkerDots: 14,
  windowStartMarkerEmoji: "⭐",
  windowStartMarkerLabels: false,
  windowStartMarkerPulse: true,
  windowStartMarkerTransparency: 8,
  windowStartMarkerSettingsExpanded: false,
  arcsVisible: true,
  arcSettingsExpanded: false,
  eventLabelDefaultVersion: 3,
  eventLabels: true,
  eventLabelsSettingsExpanded: false,
  eventLabelStyle: "ink",
  eventLabelCustomColor: "#ffffff",
  eventLabelFontFamily: "Inter, Segoe UI, Arial, sans-serif",
  eventLabelFontSizeFull: 22,
  eventLabelFontSizeMini: 18,
  eventLabelProximityPriority: false,
  eventLabelMinLength: 5,
  eventLabelShortenThreshold: 250,
  eventLabelAnchor: "center",
  eventLabelOpacity: 100,
  eventLabelArcDistance: 12,
  magnifierEnabled: true,
  magnifierHoverEnabled: true,
  magnifierCenterCursor: false,
  magnifierAutoEnabled: true,
  magnifierAutoMinuteHandEnabled: false,
  magnifierAutoEventStartEnabled: false,
  magnifierAutoEventStartAttention: false,
  magnifierAutoEventEndEnabled: false,
  magnifierAutoEventEndAttention: false,
  eventReminderStartEnabled: false,
  eventReminderStartLeadSeconds: 30,
  eventReminderEndEnabled: false,
  eventReminderEndLeadSeconds: 30,
  eventReminderSoundKind: "builtin",
  eventReminderSoundId: null,
  eventReminderSoundName: "Mechanical clock ticking",
  eventReminderSourceDuration: 19.84,
  eventReminderClipStart: 0,
  eventReminderClipDuration: 5,
  magnifierLensSize: 550,
  magnifierAutoIntervalSeconds: 600,
  magnifierSettingsExpanded: false,
  debugOpen: false,
  debugCollapsed: false,
  debugPanelX: null,
  debugPanelY: null,
  debugPanelX_full: null,
  debugPanelY_full: null,
  helpOpen: false,
  helpCollapsed: false,
  helpPanelX: null,
  helpPanelY: null,
  helpPanelX_full: null,
  helpPanelY_full: null,
  menuDarkTheme: false,
  menuThemeEdited: false,
  consoleLogs: false,
  pageOwnedInfo: true,
  captureLimit: CALENDAR_CLOCK_CAPTURE_LIMIT,
  densityLevel: 50,
  arcThicknessLevel: 50,
  arcGapLevel: 0,
  arcSameLevelNonOverlapping: false,
  longDurationArcsVisible: true,
  arcGapDefaultVersion: 4
};

let calendarClockState = { ...CALENDAR_CLOCK_PANEL_DEFAULT };
let calendarClockRoot = null;
let calendarClockFrame = null;
let calendarClockFrameReady = false;
let calendarClockPendingFrameRebuild = false;
let calendarClockFaceOptions = null;
let calendarClockActualFaceId = null;
let calendarClockPanel = null;
let calendarClockTimePanel = null;
let calendarClockDebug = null;
let calendarClockHelp = null;
let calendarClockWhatsNewOpen = false;
let calendarClockEvents = [];
let calendarClockCaptureMeta = { calendar: null, task: null };
let calendarClockStorageStatus = null;
let calendarClockEffectiveEventSource = {
  requestedMode: "dom",
  activeSource: "google-calendar-dom",
  status: "DOM text parser active",
  fallback: false
};
let highlightedCalendarNode = null;
const calendarClockEventNodes = new Map();
const calendarClockBoundNodes = new WeakSet();
const calendarClockBoundNodeEventIds = new WeakMap();
let calendarClockPendingEventNodes = new Map();
let calendarClockExtensionContextInvalidated = false;
let calendarClockObserver = null;
let calendarClockTickIntervalId = null;
let calendarClockLastWindowDateRangeKey = null;
let calendarClockNavigationSettlingUntilMs = 0;
let calendarClockNavigationSettlingReason = "";
let calendarClockNavigationPending = false;
let calendarClockNavigationPendingSinceMs = 0;
let calendarClockLastSuccessfulNavigationKey = "";
let calendarClockLastCaptureCandidateCount = 0;
const calendarClockPendingDeletedEventIds = new Set();
let calendarClockTimePanelNeedsInitialSize = false;
let calendarClockTickAudioContext = null;
let calendarClockTickAudioBuffer = null;
let calendarClockTickAudioBufferPromise = null;
let calendarClockTickSoundPlayback = null;
let calendarClockTickSoundStopTimerId = null;
let calendarClockTickSoundPlaybackId = 0;
let calendarClockTickSoundActive = false;
let calendarClockStateSaveTimer = null;
const calendarClockContextCleanupCallbacks = [];
const CALENDAR_CLOCK_MAGNIFIER_MIN_SIZE = 140;
const CALENDAR_CLOCK_MAGNIFIER_MAX_SIZE = 1100;
const CALENDAR_CLOCK_MAGNIFIER_MIN_INTERVAL_SECONDS = 5;
const CALENDAR_CLOCK_MAGNIFIER_MAX_INTERVAL_SECONDS = 3600;

function normalizeCalendarClockFaceId(value) {
  const requestedId = String(value || "").trim();
  if (!Array.isArray(calendarClockFaceOptions)) return requestedId || CALENDAR_CLOCK_PANEL_DEFAULT.clockFaceId;

  const availableIds = calendarClockFaceOptions.map(option => option.id);
  if (availableIds.includes(requestedId)) return requestedId;
  if (calendarClockActualFaceId && (availableIds.includes(calendarClockActualFaceId) || !availableIds.length)) {
    return calendarClockActualFaceId;
  }
  if (availableIds.includes(CALENDAR_CLOCK_PANEL_DEFAULT.clockFaceId)) return CALENDAR_CLOCK_PANEL_DEFAULT.clockFaceId;
  return availableIds[0] || CALENDAR_CLOCK_PANEL_DEFAULT.clockFaceId;
}

function areCalendarClockConsoleLogsEnabled() {
  return calendarClockState.consoleLogs === true;
}

function calendarClockLog(...args) {
  if (!areCalendarClockConsoleLogsEnabled()) return;
  console.log(CALENDAR_CLOCK_LOG_PREFIX, ...args);
}

function calendarClockWarn(...args) {
  if (!areCalendarClockConsoleLogsEnabled()) return;
  console.warn(CALENDAR_CLOCK_LOG_PREFIX, ...args);
}

function isCalendarClockExtensionContextError(error) {
  return /Extension context invalidated/i.test(String(error?.message || error || ""));
}

function onCalendarClockContextInvalidated(callback) {
  calendarClockContextCleanupCallbacks.push(callback);
  if (calendarClockExtensionContextInvalidated) {
    try {
      callback();
    } catch (_error) {
      // Best effort cleanup only.
    }
  }
}

function markCalendarClockExtensionContextInvalidated(error) {
  if (error && !isCalendarClockExtensionContextError(error)) return false;
  if (calendarClockExtensionContextInvalidated) return true;

  calendarClockExtensionContextInvalidated = true;
  calendarClockLog("extension context invalidated; stopping stale content script work");
  calendarClockContextCleanupCallbacks.forEach(callback => {
    try {
      callback();
    } catch (_error) {
      // Best effort cleanup only.
    }
  });
  return true;
}

function canUseCalendarClockExtensionApi() {
  if (calendarClockExtensionContextInvalidated) return false;

  try {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  } catch (error) {
    markCalendarClockExtensionContextInvalidated(error);
    return false;
  }
}

function getCalendarClockRuntimeLastError() {
  try {
    return chrome.runtime?.lastError || null;
  } catch (error) {
    markCalendarClockExtensionContextInvalidated(error);
    return null;
  }
}

function sendCalendarClockRuntimeMessage(message, callback) {
  if (!canUseCalendarClockExtensionApi()) return false;

  try {
    chrome.runtime.sendMessage(message, response => {
      const runtimeError = getCalendarClockRuntimeLastError();
      if (runtimeError) {
        markCalendarClockExtensionContextInvalidated(runtimeError);
        return;
      }
      if (callback) callback(response);
    });
    return true;
  } catch (error) {
    if (!markCalendarClockExtensionContextInvalidated(error)) {
      calendarClockWarn("runtime message failed", error);
    }
    return false;
  }
}

function makeCalendarClockCaptureMeta(source, parsedCount, shownCount, limit) {
  const safeParsed = Math.max(0, Math.round(Number(parsedCount) || 0));
  const safeShown = Math.max(0, Math.min(safeParsed, Math.round(Number(shownCount) || 0)));
  const safeLimit = Math.max(1, Math.round(Number(limit) || CALENDAR_CLOCK_CAPTURE_LIMIT));
  return {
    source,
    limit: safeLimit,
    parsedCount: safeParsed,
    shownCount: safeShown,
    omittedCount: Math.max(0, safeParsed - safeShown)
  };
}

function normalizeCalendarClockCaptureMetaEntry(entry, fallbackSource) {
  if (!entry || typeof entry !== "object") return null;
  const shownCount = Math.max(0, Math.round(Number(entry.shownCount) || 0));
  const omittedCount = Math.max(0, Math.round(Number(entry.omittedCount) || 0));
  const parsedCount = Math.max(shownCount, Math.round(Number(entry.parsedCount) || shownCount + omittedCount));
  const limit = Math.max(1, Math.round(Number(entry.limit) || CALENDAR_CLOCK_CAPTURE_LIMIT));
  return {
    source: String(entry.source || fallbackSource),
    limit,
    parsedCount,
    shownCount,
    omittedCount: Math.max(omittedCount, parsedCount - shownCount)
  };
}

function setCalendarClockCaptureMeta(kind, entry) {
  calendarClockCaptureMeta = {
    ...calendarClockCaptureMeta,
    [kind]: normalizeCalendarClockCaptureMetaEntry(entry, kind)
  };
}

function applyCalendarClockCaptureMeta(meta) {
  if (!meta || typeof meta !== "object") return;
  const next = { ...calendarClockCaptureMeta };
  if (meta.calendar) next.calendar = normalizeCalendarClockCaptureMetaEntry(meta.calendar, "google-calendar-dom");
  if (meta.task) next.task = normalizeCalendarClockCaptureMetaEntry(meta.task, "google-tasks-dom");
  calendarClockCaptureMeta = next;
}

function getCalendarClockCaptureMetaEntries(meta = calendarClockCaptureMeta) {
  return [meta?.calendar, meta?.task]
    .map((entry, index) => normalizeCalendarClockCaptureMetaEntry(entry, index === 0 ? "google-calendar-dom" : "google-tasks-dom"))
    .filter(Boolean);
}

function getCalendarClockCaptureSourceLabel(entry) {
  return /task/i.test(entry?.source || "") ? "Tasks" : "Calendar";
}

function getCalendarClockCaptureOmittedCount(meta = calendarClockCaptureMeta) {
  return getCalendarClockCaptureMetaEntries(meta).reduce((total, entry) => total + entry.omittedCount, 0);
}

function getCalendarClockCaptureLimitNotice(meta = calendarClockCaptureMeta) {
  return getCalendarClockCaptureMetaEntries(meta)
    .filter(entry => entry.omittedCount > 0)
    .map(entry => {
      const label = getCalendarClockCaptureSourceLabel(entry);
      return `${label}: ${entry.shownCount} shown of ${entry.parsedCount}; ${entry.omittedCount} omitted by the ${entry.limit}-item cap`;
    })
    .join(" · ");
}
