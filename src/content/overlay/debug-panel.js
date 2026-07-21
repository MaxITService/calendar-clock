// Builds safe and private debug exports for captured Calendar events.
const CALENDAR_CLOCK_DEBUG_TEMPLATE_PATH = "src/content/overlay/templates/debug.html";
let calendarClockDebugTemplate = null;

const CALENDAR_CLOCK_SAFE_DEBUG_SOURCES = new Set([
  "google-calendar-dom",
  "google-page-owned",
  "google-tasks-dom"
]);
const CALENDAR_CLOCK_SAFE_DEBUG_CAPTURE_PHASES = new Set(["ready", "captured", "unavailable"]);
const CALENDAR_CLOCK_SAFE_DEBUG_TRANSPORTS = new Set(["fetch", "xhr"]);

async function loadCalendarClockDebugTemplates() {
  if (calendarClockDebugTemplate) return calendarClockDebugTemplate;

  calendarClockDebugTemplate = await getCalendarClockTemplate(CALENDAR_CLOCK_DEBUG_TEMPLATE_PATH);
  return calendarClockDebugTemplate;
}

function getDebugWindowPayload(displayWindow) {
  return {
    start: calendarClockState.windowStart,
    end: calendarClockState.windowEnd,
    summary: getWindowSummaryText(),
    durationMinutes: displayWindow.duration,
    followNow: calendarClockState.followNow,
    followRadiusHours: calendarClockState.followRadiusHours,
    radial24Hour: calendarClockState.radial24Hour,
    eventLabels: calendarClockState.eventLabels === true,
    eventLabelStyle: calendarClockState.eventLabelStyle,
    eventLabelFontFamily: calendarClockState.eventLabelFontFamily,
    eventLabelFontSize: getCalendarClockEventLabelFontSizeForMode(),
    eventLabelFontSizeFull: calendarClockState.eventLabelFontSizeFull,
    eventLabelFontSizeMini: calendarClockState.eventLabelFontSizeMini,
    eventLabelProximityPriority: calendarClockState.eventLabelProximityPriority === true,
    eventLabelMinLength: calendarClockState.eventLabelMinLength,
    eventLabelShortenThreshold: calendarClockState.eventLabelShortenThreshold,
    eventLabelAnchor: calendarClockState.eventLabelAnchor,
    eventLabelOpacity: calendarClockState.eventLabelOpacity,
    eventLabelArcDistance: calendarClockState.eventLabelArcDistance,
    windowStartMarkerPulse: calendarClockState.windowStartMarkerPulse !== false,
    magnifierCenterCursor: calendarClockState.magnifierCenterCursor === true,
    magnifierAutoMinuteHandEnabled: calendarClockState.magnifierAutoMinuteHandEnabled === true,
    magnifierAutoEventStartEnabled: calendarClockState.magnifierAutoEventStartEnabled === true,
    magnifierAutoEventStartAttention: calendarClockState.magnifierAutoEventStartAttention === true,
    magnifierAutoEventEndEnabled: calendarClockState.magnifierAutoEventEndEnabled === true,
    magnifierAutoEventEndAttention: calendarClockState.magnifierAutoEventEndAttention === true,
    arcsVisible: calendarClockState.arcsVisible !== false,
    densityLevel: calendarClockState.densityLevel,
    arcThicknessLevel: calendarClockState.arcThicknessLevel,
    arcGapLevel: calendarClockState.arcGapLevel,
    arcSameLevelNonOverlapping: calendarClockState.arcSameLevelNonOverlapping === true,
    longDurationArcsVisible: calendarClockState.longDurationArcsVisible !== false
  };
}

function getFullDebugPayload() {
  const displayWindow = getDisplayWindow();
  return {
    capturedAt: new Date().toISOString(),
    url: location.href,
    mode: calendarClockState.mode,
    eventSource: calendarClockEffectiveEventSource,
    pageOwnedInfo: calendarClockState.pageOwnedInfo === true,
    consoleLogs: calendarClockState.consoleLogs === true,
    navigationSettling: calendarClockNavigationPending || Date.now() < calendarClockNavigationSettlingUntilMs
      ? {
          until: new Date(calendarClockNavigationSettlingUntilMs).toISOString(),
          reason: calendarClockNavigationSettlingReason,
          pending: calendarClockNavigationPending,
          pendingSince: calendarClockNavigationPendingSinceMs
            ? new Date(calendarClockNavigationPendingSinceMs).toISOString()
            : null,
          visibleCandidateCount: calendarClockLastCaptureCandidateCount
        }
      : null,
    displayWindow: getDebugWindowPayload(displayWindow),
    captureMeta: calendarClockCaptureMeta,
    storageStatus: calendarClockStorageStatus,
    captureLimitNotice: getCalendarClockCaptureLimitNotice(),
    dateParseFailures: getCalendarClockDateParseFailures().length,
    supportEmail: CALENDAR_CLOCK_SUPPORT_EMAIL,
    events: calendarClockEvents.map((event, index) => ({
      index,
      id: event.id,
      domKey: event.domKey,
      title: event.title,
      calendarName: event.calendarName || "",
      start: event.start,
      end: event.end,
      durationKind: isPointCalendarEvent(event) ? "point" : isAllDayCalendarEvent(event) ? "all-day" : "range",
      date: event.temporal?.firstDateKey || "",
      startDate: event.startDate || "",
      endDate: event.endDate || "",
      dateParseStatus: event.dateParseStatus || "",
      dateParseReason: event.dateParseReason || "",
      dateParseContext: event.dateParseContext || "",
      dateParseSupportEmail: event.dateParseSupportEmail || "",
      undatedTaskStatus: getUndatedGoogleTaskWindowLabel(event),
      color: event.color,
      visible: Boolean(getVisibleEventSegment(event, displayWindow)),
      overlapMinutes: getEventOverlapMinutes(event, displayWindow),
      rawText: event.rawText || ""
    }))
  };
}

// Retained for internal callers that expect the original, comprehensive payload.
function getDebugPayload() {
  return getFullDebugPayload();
}

function getSafeDebugCount(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function getSafeDebugSource(value, fallback) {
  return CALENDAR_CLOCK_SAFE_DEBUG_SOURCES.has(value) ? value : fallback;
}

function getSafeDebugCaptureMetaEntry(entry, fallbackSource) {
  if (!entry || typeof entry !== "object") return null;

  const shownCount = getSafeDebugCount(entry.shownCount);
  const omittedCount = getSafeDebugCount(entry.omittedCount);
  const parsedCount = Math.max(shownCount, getSafeDebugCount(entry.parsedCount), shownCount + omittedCount);
  return {
    source: getSafeDebugSource(entry.source, fallbackSource),
    limit: Math.max(1, getSafeDebugCount(entry.limit)),
    parsedCount,
    shownCount,
    omittedCount: Math.max(omittedCount, parsedCount - shownCount)
  };
}

function getSafeDebugCaptureMeta() {
  return {
    calendar: getSafeDebugCaptureMetaEntry(calendarClockCaptureMeta?.calendar, "google-calendar-dom"),
    task: getSafeDebugCaptureMetaEntry(calendarClockCaptureMeta?.task, "google-tasks-dom")
  };
}

function getSafeDebugEventSource() {
  const source = calendarClockEffectiveEventSource || {};
  const captureStatus = source.captureStatus || {};
  const phase = CALENDAR_CLOCK_SAFE_DEBUG_CAPTURE_PHASES.has(captureStatus.phase)
    ? captureStatus.phase
    : source.fallback === true ? "fallback" : "active";
  return {
    requestedMode: source.requestedMode === "page-owned" ? "page-owned" : "dom",
    activeSource: getSafeDebugSource(source.activeSource, "google-calendar-dom"),
    fallback: source.fallback === true,
    captureStatus: {
      phase,
      transport: CALENDAR_CLOCK_SAFE_DEBUG_TRANSPORTS.has(captureStatus.transport) ? captureStatus.transport : null,
      capturedResponses: getSafeDebugCount(captureStatus.capturedResponses),
      extractedRecords: getSafeDebugCount(captureStatus.extractedRecords)
    }
  };
}

function getSafeDebugStorageStatus() {
  if (!calendarClockStorageStatus || typeof calendarClockStorageStatus !== "object") return null;

  const kind = calendarClockStorageStatus.kind === "history-trimmed"
    ? "history-trimmed"
    : calendarClockStorageStatus.kind === "write-failed" ? "write-failed" : "unknown";
  return {
    kind,
    retainedEventCount: getSafeDebugCount(calendarClockStorageStatus.retainedEventCount),
    removedEventCount: getSafeDebugCount(calendarClockStorageStatus.removedEventCount)
  };
}

function getSafeDebugEventSummary(displayWindow) {
  const summary = {
    count: calendarClockEvents.length,
    durationKinds: { point: 0, allDay: 0, range: 0 },
    visibility: { visible: 0, notVisible: 0 },
    overlapMinutes: { knownEventCount: 0, positiveEventCount: 0, zeroEventCount: 0, total: 0 }
  };

  calendarClockEvents.forEach(event => {
    const durationKind = isPointCalendarEvent(event)
      ? "point"
      : isAllDayCalendarEvent(event) ? "allDay" : "range";
    summary.durationKinds[durationKind] += 1;

    if (getVisibleEventSegment(event, displayWindow)) summary.visibility.visible += 1;
    else summary.visibility.notVisible += 1;

    const overlapMinutes = Number(getEventOverlapMinutes(event, displayWindow));
    if (!Number.isFinite(overlapMinutes)) return;
    const safeOverlapMinutes = Math.max(0, Math.round(overlapMinutes));
    summary.overlapMinutes.knownEventCount += 1;
    summary.overlapMinutes.total += safeOverlapMinutes;
    if (safeOverlapMinutes > 0) summary.overlapMinutes.positiveEventCount += 1;
    else summary.overlapMinutes.zeroEventCount += 1;
  });

  return summary;
}

function getSafeDebugPayload() {
  const displayWindow = getDisplayWindow();
  const navigationSettling = calendarClockNavigationPending || Date.now() < calendarClockNavigationSettlingUntilMs;
  return {
    format: "calendar-clock-safe-diagnostics-v1",
    capturedAt: new Date().toISOString(),
    ui: {
      mode: calendarClockState.mode,
      clockFaceId: calendarClockState.clockFaceId,
      menuDarkTheme: calendarClockState.menuDarkTheme === true,
      pageOwnedInfo: calendarClockState.pageOwnedInfo === true,
      consoleLogs: calendarClockState.consoleLogs === true,
      captureLimit: getSafeDebugCount(calendarClockState.captureLimit)
    },
    eventSource: getSafeDebugEventSource(),
    navigationSettling: {
      active: navigationSettling,
      pending: calendarClockNavigationPending === true,
      visibleCandidateCount: getSafeDebugCount(calendarClockLastCaptureCandidateCount)
    },
    displayWindow: getDebugWindowPayload(displayWindow),
    captureMeta: getSafeDebugCaptureMeta(),
    storageStatus: getSafeDebugStorageStatus(),
    dateParseFailures: getCalendarClockDateParseFailures().length,
    eventSummary: getSafeDebugEventSummary(displayWindow),
    supportEmail: CALENDAR_CLOCK_SUPPORT_EMAIL
  };
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;left:-9999px;top:0;";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyDebugText(text, copiedLabel) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopyText(text);
    }
    const status = calendarClockDebug.querySelector("[data-cc-debug-copy-status]");
    if (status) status.textContent = copiedLabel;
  } catch (_error) {
    fallbackCopyText(text);
    const status = calendarClockDebug.querySelector("[data-cc-debug-copy-status]");
    if (status) status.textContent = copiedLabel;
  }
}

function getSafeDebugTextPayload() {
  const payload = getSafeDebugPayload();
  const captureMeta = [
    ["calendar", payload.captureMeta.calendar],
    ["tasks", payload.captureMeta.task]
  ].filter(([_kind, entry]) => entry);
  const lines = [
    "Calendar Clock Safe Diagnostics",
    "Privacy: event and task titles, calendar names, event dates and times, identifiers, raw text, and page URLs are excluded.",
    `capturedAt: ${payload.capturedAt}`,
    `mode: ${payload.ui.mode}`,
    `clockFace: ${payload.ui.clockFaceId}`,
    `pageOwnedInfo: ${payload.ui.pageOwnedInfo}`,
    `consoleLogs: ${payload.ui.consoleLogs}`,
    `eventSource: ${payload.eventSource.activeSource} (${payload.eventSource.requestedMode})`,
    `fallback: ${payload.eventSource.fallback}`,
    `captureStatus: ${payload.eventSource.captureStatus.phase}`,
    `captureTransport: ${payload.eventSource.captureStatus.transport || "none"}`,
    `capturedResponses: ${payload.eventSource.captureStatus.capturedResponses}`,
    `extractedRecords: ${payload.eventSource.captureStatus.extractedRecords}`,
    `navigationSettling: ${payload.navigationSettling.active}; candidates: ${payload.navigationSettling.visibleCandidateCount}`,
    `window: ${payload.displayWindow.summary} (${payload.displayWindow.durationMinutes}m)`,
    `followNow: ${payload.displayWindow.followNow}`,
    `followRadiusHours: ${payload.displayWindow.followRadiusHours}`,
    `radial24Hour: ${payload.displayWindow.radial24Hour}`,
    `arcsVisible: ${payload.displayWindow.arcsVisible}`,
    `eventLabels: ${payload.displayWindow.eventLabels ? `${payload.displayWindow.eventLabelStyle} (font: ${payload.displayWindow.eventLabelFontFamily}, active size: ${payload.displayWindow.eventLabelFontSize}px, Full: ${payload.displayWindow.eventLabelFontSizeFull}px, Mini: ${payload.displayWindow.eventLabelFontSizeMini}px, proximity priority: ${payload.displayWindow.eventLabelProximityPriority ? "on" : "off"}, minLength: ${payload.displayWindow.eventLabelMinLength}, shorten: ${payload.displayWindow.eventLabelShortenThreshold}, anchor: ${payload.displayWindow.eventLabelAnchor}, opacity: ${payload.displayWindow.eventLabelOpacity}%, arc distance: ${payload.displayWindow.eventLabelArcDistance}px)` : "off"}`,
    `density: ${payload.displayWindow.densityLevel}`,
    `arcThickness: ${payload.displayWindow.arcThicknessLevel}`,
    `arcGap: ${payload.displayWindow.arcGapLevel}`,
    `arcOneMinuteOverlapTolerance: ${payload.displayWindow.arcSameLevelNonOverlapping}`,
    `longDurationArcsVisible: ${payload.displayWindow.longDurationArcsVisible}`,
    `events: ${payload.eventSummary.count}`,
    `durationKinds: point ${payload.eventSummary.durationKinds.point}; all-day ${payload.eventSummary.durationKinds.allDay}; range ${payload.eventSummary.durationKinds.range}`,
    `visibility: visible ${payload.eventSummary.visibility.visible}; not visible ${payload.eventSummary.visibility.notVisible}`,
    `overlapMinutes: total ${payload.eventSummary.overlapMinutes.total}; positive ${payload.eventSummary.overlapMinutes.positiveEventCount}; zero ${payload.eventSummary.overlapMinutes.zeroEventCount}; known ${payload.eventSummary.overlapMinutes.knownEventCount}`,
    `dateParseFailures: ${payload.dateParseFailures}`,
    `storageStatus: ${payload.storageStatus ? JSON.stringify(payload.storageStatus) : "none"}`,
    `supportEmail: ${payload.supportEmail}`,
    ""
  ];

  captureMeta.forEach(([kind, entry]) => {
    lines.push(`capture.${kind}: source ${entry.source}; parsed ${entry.parsedCount}; shown ${entry.shownCount}; omitted ${entry.omittedCount}; limit ${entry.limit}`);
  });

  return lines.join("\n");
}

function copySafeDebugJson() {
  return copyDebugText(JSON.stringify(getSafeDebugPayload(), null, 2), "Safe diagnostics copied");
}

function copySafeDebugText() {
  return copyDebugText(getSafeDebugTextPayload(), "Safe text copied");
}

function copyFullDebugJson() {
  return copyDebugText(JSON.stringify(getFullDebugPayload(), null, 2), "Full private diagnostics copied");
}

function getDebugFollowText(displayWindow) {
  const followPastText = formatFollowRadiusHours(calendarClockState.followRadiusHours);
  if (!calendarClockState.followNow) return "off";
  if (calendarClockState.radial24Hour) {
    return `back ${followPastText}h + forward ${formatFollowRadiusHours(getFollowFutureHours(calendarClockState.followRadiusHours))}h in 24h`;
  }
  return `window start ${followPastText === "0" ? "at now" : `-${followPastText}h`} in 12h`;
}

function getDebugEventStatus(event, displayWindow) {
  const visible = Boolean(getVisibleEventSegment(event, displayWindow));
  const undatedTaskStatus = getUndatedGoogleTaskWindowLabel(event);
  return isCalendarClockDateParseFailed(event)
    ? "hidden: date parse failed"
    : undatedTaskStatus || (visible ? "visible" : "outside window");
}

function renderDebugEventRow(template, event, index, displayWindow) {
  const row = template.content.cloneNode(true);
  const undatedTaskStatus = getUndatedGoogleTaskWindowLabel(event);
  const dateLabel = event.temporal?.firstDateKey || (undatedTaskStatus ? "Google Task/no date" : "floating date");
  const status = getDebugEventStatus(event, displayWindow);

  row.querySelector("[data-cc-debug-event-title]").textContent = `#${index + 1} ${event.title}`;
  row.querySelector("[data-cc-debug-event-meta]").textContent = [
    dateLabel,
    getCalendarEventTimeLabel(event),
    event.calendarName || "",
    status
  ].filter(Boolean).join(" · ");
  row.querySelector("[data-cc-debug-event-id]").textContent = `id: ${event.id}`;
  row.querySelector("[data-cc-debug-event-color]").textContent = `color: ${event.color}`;
  row.querySelector("[data-cc-debug-event-raw]").textContent = `raw: ${event.rawText || ""}`;

  const parseStatus = row.querySelector("[data-cc-debug-event-date-parse-status]");
  if (event.dateParseStatus) {
    parseStatus.hidden = false;
    parseStatus.textContent = `dateParseStatus: ${event.dateParseStatus}${event.dateParseReason ? ` · ${event.dateParseReason}` : ""}`;
  }

  const parseContext = row.querySelector("[data-cc-debug-event-date-parse-context]");
  if (event.dateParseContext) {
    parseContext.hidden = false;
    parseContext.textContent = `dateParseContext: ${event.dateParseContext}`;
  }

  return row;
}

function renderDebugPanel() {
  if (!calendarClockDebug) return;
  if (!calendarClockDebugTemplate) {
    calendarClockWarn("debug template unavailable");
    return;
  }

  const displayWindow = getDisplayWindow();
  const failedDateEvents = getCalendarClockDateParseFailures();
  const captureLimitNotice = getCalendarClockCaptureLimitNotice();
  calendarClockDebug.replaceChildren(calendarClockDebugTemplate.content.cloneNode(true));
  updateCalendarClockDebugSoundButton();

  const collapseButton = calendarClockDebug.querySelector("[data-cc-action='debug-panel-collapse']");
  if (collapseButton) {
    collapseButton.textContent = calendarClockState.debugCollapsed ? "+" : "_";
    collapseButton.setAttribute("aria-label", calendarClockState.debugCollapsed ? "Expand debug panel" : "Collapse debug panel");
  }

  calendarClockDebug.querySelector("[data-cc-console-logs]").checked = calendarClockState.consoleLogs === true;
  calendarClockDebug.querySelector("[data-cc-page-owned-info]").checked = calendarClockState.pageOwnedInfo === true;
  calendarClockDebug.querySelector("[data-cc-debug-mode]").textContent = `mode: ${calendarClockState.mode}`;
  calendarClockDebug.querySelector("[data-cc-debug-source]").textContent = [
    `event source: ${calendarClockEffectiveEventSource.activeSource}`,
    `requested mode: ${calendarClockEffectiveEventSource.requestedMode}`,
    calendarClockEffectiveEventSource.fallback ? "fallback: active" : "fallback: no",
    `capture: ${calendarClockEffectiveEventSource.status}`
  ].join(" · ");
  calendarClockDebug.querySelector("[data-cc-debug-window]").textContent = `window: ${getWindowSummaryText()} (${displayWindow.duration}m)`;
  calendarClockDebug.querySelector("[data-cc-debug-follow]").textContent = [
    `follow: ${getDebugFollowText(displayWindow)}`,
    `24h radial: ${calendarClockState.radial24Hour ? "on" : "off"}`,
    `arcs: ${calendarClockState.arcsVisible !== false ? "on" : "off"}`,
    `long arcs: ${calendarClockState.longDurationArcsVisible !== false ? "on" : "off"}`,
    `labels: ${calendarClockState.eventLabels === true ? `${calendarClockState.eventLabelStyle} (font: ${calendarClockState.eventLabelFontFamily}, active size: ${getCalendarClockEventLabelFontSizeForMode()}px, Full: ${calendarClockState.eventLabelFontSizeFull}px, Mini: ${calendarClockState.eventLabelFontSizeMini}px, proximity priority: ${calendarClockState.eventLabelProximityPriority === true ? "on" : "off"}, minLength: ${calendarClockState.eventLabelMinLength}, shorten: ${calendarClockState.eventLabelShortenThreshold}, anchor: ${calendarClockState.eventLabelAnchor}, opacity: ${calendarClockState.eventLabelOpacity}%, arc distance: ${calendarClockState.eventLabelArcDistance}px)` : "off"}`,
    `density: ${calendarClockState.densityLevel}`,
    `thickness: ${calendarClockState.arcThicknessLevel}`,
    `arc gap: ${calendarClockState.arcGapLevel}`,
    `1-minute overlap tolerance: ${calendarClockState.arcSameLevelNonOverlapping === true ? "on" : "off"}`,
    `magnifier cursor: ${calendarClockState.magnifierCenterCursor === true ? "on" : "off"}`,
    `logs: ${calendarClockState.consoleLogs === true ? "on" : "off"}`,
    `window start marker: ${calendarClockState.windowStartMarker ? "on" : "off"}`,
    `start pulse: ${calendarClockState.windowStartMarkerPulse !== false ? "on" : "off"}`
  ].join(" · ");
  calendarClockDebug.querySelector("[data-cc-debug-events-summary]").textContent = `events: ${calendarClockEvents.length} · date parse failures: ${failedDateEvents.length} · support: ${CALENDAR_CLOCK_SUPPORT_EMAIL}`;

  const captureLimit = calendarClockDebug.querySelector("[data-cc-debug-capture-limit]");
  captureLimit.hidden = !captureLimitNotice;
  captureLimit.textContent = captureLimitNotice ? `capture limit: ${captureLimitNotice}` : "";

  const eventList = calendarClockDebug.querySelector("[data-cc-debug-events]");
  const eventTemplate = calendarClockDebug.querySelector("[data-cc-debug-event-template]");
  const emptyTemplate = calendarClockDebug.querySelector("[data-cc-debug-empty-template]");
  if (calendarClockEvents.length) {
    calendarClockEvents.forEach((event, index) => {
      eventList.appendChild(renderDebugEventRow(eventTemplate, event, index, displayWindow));
    });
  } else {
    eventList.appendChild(emptyTemplate.content.cloneNode(true));
  }
}
