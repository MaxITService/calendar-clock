const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const temporal = require(path.join(repoRoot, "src/temporal-projection/temporal-projection.js"));
const temporalContext = temporal.createContext("Europe/Helsinki").value;

function project(id, startDate, endDate) {
  return temporal.projectInstantEvent({
    id,
    capturedFrom: "google-page-owned",
    durationKind: "range",
    startInstant: startDate,
    endInstant: endDate
  }, temporalContext).value;
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `Missing function ${name}`);
  const parametersStart = source.indexOf("(", start);
  let parameterDepth = 0;
  let bodyStart = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    if (source[index] === ")") parameterDepth -= 1;
    if (parameterDepth === 0) {
      bodyStart = source.indexOf("{", index + 1);
      break;
    }
  }
  assert.notStrictEqual(bodyStart, -1, `Missing body for function ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated function ${name}`);
}

function loadFunctions(relativePath, names, globals = {}) {
  const source = read(relativePath);
  const context = vm.createContext({ ...globals });
  const declarations = names.map(name => extractFunction(source, name)).join("\n");
  vm.runInContext(`${declarations}\nglobalThis.testApi = { ${names.join(", ")} };`, context);
  return { api: context.testApi, context, source };
}

const background = loadFunctions("src/background/background.js", [
  "getCalendarClockEventDateKey",
  "getCalendarClockEventIdentity",
  "getCalendarClockEventStartTimestamp",
  "compareCalendarClockEventsChronologically",
  "mergeCalendarClockEvents"
], { Date, Number, String, Set, calendarClockTemporalProjection: temporal });

const lateToday = {
  ...project("late", "2026-07-12T20:00:00.000Z", "2026-07-12T20:30:00.000Z"),
  id: "late",
  start: "23:00",
  end: "23:30",
  startDate: "2026-07-12T20:00:00.000Z",
  endDate: "2026-07-12T20:30:00.000Z"
};
const earlyTomorrow = {
  ...project("early", "2026-07-12T22:00:00.000Z", "2026-07-12T22:30:00.000Z"),
  id: "early",
  start: "01:00",
  end: "01:30",
  startDate: "2026-07-12T22:00:00.000Z",
  endDate: "2026-07-12T22:30:00.000Z"
};
assert.deepStrictEqual(
  Array.from(background.api.mergeCalendarClockEvents([lateToday], [earlyTomorrow]), event => event.id),
  ["late", "early"]
);

const clock = loadFunctions("src/clock/scripts/calendar-bridge.js", [
  "normalizeCalendarEvents",
  "getClockCalendarEventStartTimestamp",
  "compareClockCalendarEventsChronologically",
  "getClockCalendarSourceLabel"
], {
  Date,
  Number,
  String,
  EVENT_COLORS: ["#b88d5a"],
  parseTimeToDayMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }
});
assert.ok(clock.api.compareClockCalendarEventsChronologically(lateToday, earlyTomorrow) < 0);
assert.strictEqual(
  clock.api.getClockCalendarSourceLabel({ effectiveSource: { activeSource: "google-page-owned" } }),
  "Google Calendar structured data"
);
assert.strictEqual(clock.api.getClockCalendarSourceLabel(null), "Google Calendar DOM");
const normalizedClockTask = clock.api.normalizeCalendarEvents([{
  id: "dom-task",
  title: "DOM task",
  start: "13:30",
  end: "13:30",
  capturedFrom: "google-tasks-dom"
}])[0];
assert.strictEqual(normalizedClockTask.itemKind, "task");
assert.strictEqual(normalizedClockTask.sourceKind, "calendar-task");

const contentWindowRange = loadFunctions("src/content/time-window-controller.js", [
  "parseClockMinutes",
  "minutesBetween",
  "getDisplayWindow",
  "getWindowDateRange"
], {
  Date,
  Number,
  Math,
  calendarClockState: {
    radial24Hour: false,
    followNow: false,
    windowStart: "08:00",
    windowEnd: "08:00"
  },
  CALENDAR_CLOCK_FOLLOW_WINDOW_MINUTES: 12 * 60,
  CALENDAR_CLOCK_RADIAL_FOLLOW_WINDOW_MINUTES: 24 * 60,
  getWindowAnchorDate: () => new Date(Date.UTC(2026, 6, 21)),
  makeCalendarClockZonedDate: (year, month, day, hour = 0, minute = 0) => new Date(Date.UTC(year, month, day, hour, minute))
});
let normalizedRange = contentWindowRange.api.getWindowDateRange();
assert.strictEqual(normalizedRange.startDate.toISOString(), "2026-07-21T08:00:00.000Z");
assert.strictEqual(normalizedRange.endDate.toISOString(), "2026-07-21T20:00:00.000Z");
contentWindowRange.context.calendarClockState.windowStart = "20:00";
contentWindowRange.context.calendarClockState.windowEnd = "08:00";
normalizedRange = contentWindowRange.api.getWindowDateRange();
assert.strictEqual(normalizedRange.startDate.toISOString(), "2026-07-21T20:00:00.000Z");
assert.strictEqual(normalizedRange.endDate.toISOString(), "2026-07-22T08:00:00.000Z");

const clockWindowRange = loadFunctions("src/clock/scripts/time-window.js", [
  "parseTimeToDayMinutes",
  "minutesBetween",
  "getDisplayWindow",
  "getWindowDateRange"
], {
  Date,
  Number,
  Math,
  use24HourRadial: false,
  displayWindowDateRangeOverride: null,
  displayWindowDurationOverride: null,
  displayWindowStartEl: { value: "08:00" },
  displayWindowEndEl: { value: "08:00" },
  getCalendarBaseDate: () => new Date(Date.UTC(2026, 6, 21)),
  getClockZonedParts: date => ({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  }),
  makeClockZonedDate: (year, month, day, hour = 0, minute = 0) => new Date(Date.UTC(year, month, day, hour, minute))
});
normalizedRange = clockWindowRange.api.getWindowDateRange();
assert.strictEqual(normalizedRange.startDate.toISOString(), "2026-07-21T08:00:00.000Z");
assert.strictEqual(normalizedRange.endDate.toISOString(), "2026-07-21T20:00:00.000Z");

const readerWindowRange = loadFunctions("src/content/calendar-dom-reader.js", [
  "getCalendarClockReaderWindowDateRange"
], {
  Date,
  Number,
  getWindowDateRange: () => ({ startDate: new Date(NaN), endDate: new Date(NaN) })
});
assert.strictEqual(readerWindowRange.api.getCalendarClockReaderWindowDateRange(), null);
readerWindowRange.context.getWindowDateRange = () => ({
  startDate: new Date("2026-07-21T08:00:00.000Z"),
  endDate: new Date("2026-07-21T20:00:00.000Z")
});
assert.strictEqual(
  readerWindowRange.api.getCalendarClockReaderWindowDateRange().endDate.toISOString(),
  "2026-07-21T20:00:00.000Z"
);

const interval = loadFunctions("src/clock/scripts/magnifier-motion.js", [
  "setMagnifierAutoIntervalSeconds"
], {
  Number,
  Math,
  MAGNIFIER_AUTO_INTERVAL_MIN_SECONDS: 5,
  MAGNIFIER_AUTO_INTERVAL_MAX_SECONDS: 3600,
  magnifierAutoIntervalSeconds: 600,
  autoIntervalInputEl: { value: "" },
  scheduleNextAutoMagnifier() {}
});
interval.api.setMagnifierAutoIntervalSeconds(0.1);
assert.strictEqual(interval.context.magnifierAutoIntervalSeconds, 5);
interval.api.setMagnifierAutoIntervalSeconds(5000);
assert.strictEqual(interval.context.magnifierAutoIntervalSeconds, 3600);
interval.api.setMagnifierAutoIntervalSeconds(12.7);
assert.strictEqual(interval.context.magnifierAutoIntervalSeconds, 13);

let wheelListener = null;
let wheelListenerOptions = null;
const settingsBody = { scrollHeight: 1000, clientHeight: 300, scrollTop: 200 };
const timePanelWheel = loadFunctions("src/content/overlay/overlay-menu.js", [
  "getCalendarClockWheelDelta",
  "bindTimePanelWheelScrolling"
], {
  Math,
  Number,
  calendarClockState: { timePanelCollapsed: false },
  calendarClockRoot: { classList: { contains: () => false } },
  calendarClockTimePanel: {
    addEventListener(type, listener, options) {
      assert.strictEqual(type, "wheel");
      wheelListener = listener;
      wheelListenerOptions = options;
    },
    querySelector: () => settingsBody
  }
});
timePanelWheel.api.bindTimePanelWheelScrolling();
assert.strictEqual(wheelListenerOptions.capture, true);
assert.strictEqual(wheelListenerOptions.passive, false);
let wheelPrevented = false;
let wheelPropagationStopped = false;
wheelListener({
  deltaY: 5,
  deltaMode: 1,
  target: { closest: () => settingsBody },
  preventDefault() { wheelPrevented = true; },
  stopPropagation() { wheelPropagationStopped = true; }
});
assert.strictEqual(settingsBody.scrollTop, 280);
assert.strictEqual(wheelPrevented, true);
assert.strictEqual(wheelPropagationStopped, true);
assert.strictEqual(timePanelWheel.api.getCalendarClockWheelDelta({ deltaY: 1, deltaMode: 2 }, 300), 300);

const arcLabelAnchoring = loadFunctions("src/clock/scripts/clock-renderer.js", [
  "getArcLabelTrimmedText",
  "getArcLabelTextPathAnchor",
  "getArcLabelAnchoredRange",
  "applyArcLabelTextPathAnchor"
]);
assert.strictEqual(arcLabelAnchoring.api.getArcLabelTrimmedText("ABCDEFGHIJ", 6), "ABCDE…");

const staleArc = { style: { display: "" } };
const staleLabelPath = { d: "old", setAttribute(name, value) { this[name] = value; } };
let staleTooltipHidden = false;
const renderedEventReset = loadFunctions("src/clock/scripts/clock-renderer.js", [
  "hideRenderedCalendarEventVisuals"
], {
  document: {
    querySelectorAll(selector) {
      return selector === ".time-arc-label-path" ? [staleLabelPath] : [staleArc];
    }
  },
  hideArcTooltip() { staleTooltipHidden = true; }
});
renderedEventReset.api.hideRenderedCalendarEventVisuals();
assert.strictEqual(staleArc.style.display, "none");
assert.strictEqual(staleLabelPath.d, "");
assert.strictEqual(staleTooltipHidden, true);
assert.strictEqual(arcLabelAnchoring.api.getArcLabelTrimmedText("ABCDEFGHIJ", 6, "end"), "ABCDE…");
const labelSegment = { clockStartMinutes: 100, clockEndMinutes: 160 };
const centeredTextPath = arcLabelAnchoring.api.getArcLabelTextPathAnchor("center");
assert.strictEqual(centeredTextPath.startOffset, "50%");
assert.strictEqual(centeredTextPath.textAnchor, "middle");
const startTextPath = arcLabelAnchoring.api.getArcLabelTextPathAnchor("start");
assert.strictEqual(startTextPath.startOffset, "0%");
assert.strictEqual(startTextPath.textAnchor, "start");
const endTextPath = arcLabelAnchoring.api.getArcLabelTextPathAnchor("end");
assert.strictEqual(endTextPath.startOffset, "100%");
assert.strictEqual(endTextPath.textAnchor, "end");
const anchoredTextPath = {
  attributes: {},
  style: { textAnchor: "" },
  setAttribute(name, value) { this.attributes[name] = value; }
};
arcLabelAnchoring.api.applyArcLabelTextPathAnchor(anchoredTextPath, endTextPath);
assert.strictEqual(anchoredTextPath.attributes.startOffset, "100%");
assert.strictEqual(anchoredTextPath.attributes["text-anchor"], "end");
assert.strictEqual(anchoredTextPath.style.textAnchor, "end");

const centeredRange = arcLabelAnchoring.api.getArcLabelAnchoredRange(labelSegment, 120, "center", false);
assert.strictEqual(centeredRange.startMinutes, 70);
assert.strictEqual(centeredRange.endMinutes, 190);
const startRange = arcLabelAnchoring.api.getArcLabelAnchoredRange(labelSegment, 120, "start", false);
assert.strictEqual(startRange.startMinutes, 100);
assert.strictEqual(startRange.endMinutes, 220);
const reversedStartRange = arcLabelAnchoring.api.getArcLabelAnchoredRange(labelSegment, 120, "start", true);
assert.strictEqual(reversedStartRange.startMinutes, 40);
assert.strictEqual(reversedStartRange.endMinutes, 160);
const endRange = arcLabelAnchoring.api.getArcLabelAnchoredRange(labelSegment, 120, "end", false);
assert.strictEqual(endRange.startMinutes, 40);
assert.strictEqual(endRange.endMinutes, 160);
const reversedEndRange = arcLabelAnchoring.api.getArcLabelAnchoredRange(labelSegment, 120, "end", true);
assert.strictEqual(reversedEndRange.startMinutes, 100);
assert.strictEqual(reversedEndRange.endMinutes, 220);

const proximityLabels = loadFunctions("src/clock/scripts/clock-renderer.js", [
  "getEventLabelProximityPresentation",
  "getEventLabelScaledFontSize"
], {
  Date,
  Number,
  Math,
  eventLabelProximityPriority: false,
  EVENT_LABEL_PRIORITY_NEAR_MS: 3 * 60 * 60 * 1000,
  EVENT_LABEL_PRIORITY_FADE_MS: 12 * 60 * 60 * 1000,
  EVENT_LABEL_PRIORITY_PAST_FADE_MS: 2 * 60 * 60 * 1000,
  EVENT_LABEL_PRIORITY_MIN_SCALE: 0.6
});
const proximityNow = Date.parse("2026-07-17T12:00:00.000Z");
const getProximityPresentation = (startDate, endDate, overrides = {}, enabled = true) => (
  proximityLabels.api.getEventLabelProximityPresentation({ startDate, endDate, ...overrides }, proximityNow, enabled)
);
const disabledProximity = getProximityPresentation(
  "2026-07-17T13:00:00.000Z",
  "2026-07-17T14:00:00.000Z",
  {},
  false
);
assert.strictEqual(disabledProximity.fontScale, 1);
assert.strictEqual(disabledProximity.showFullTitle, false);

const activeProximity = getProximityPresentation(
  "2026-07-17T11:30:00.000Z",
  "2026-07-17T12:30:00.000Z"
);
assert.strictEqual(activeProximity.fontScale, 1);
assert.strictEqual(activeProximity.showFullTitle, true);

const nearbyProximity = getProximityPresentation(
  "2026-07-17T14:00:00.000Z",
  "2026-07-17T15:00:00.000Z"
);
assert.strictEqual(nearbyProximity.fontScale, 1);
assert.strictEqual(nearbyProximity.showFullTitle, true);

const fartherProximity = getProximityPresentation(
  "2026-07-17T18:00:00.000Z",
  "2026-07-17T19:00:00.000Z"
);
assert.ok(fartherProximity.fontScale < 1 && fartherProximity.fontScale > 0.6);
assert.strictEqual(fartherProximity.showFullTitle, false);

const distantProximity = getProximityPresentation(
  "2026-07-18T03:00:00.000Z",
  "2026-07-18T04:00:00.000Z"
);
assert.strictEqual(distantProximity.fontScale, 0.6);
assert.strictEqual(distantProximity.showFullTitle, false);
assert.ok(nearbyProximity.fontScale > fartherProximity.fontScale);
assert.ok(fartherProximity.fontScale > distantProximity.fontScale);
assert.strictEqual(proximityLabels.api.getEventLabelScaledFontSize(26, nearbyProximity.fontScale), 26);
assert.ok(proximityLabels.api.getEventLabelScaledFontSize(26, fartherProximity.fontScale) < 26);
assert.strictEqual(proximityLabels.api.getEventLabelScaledFontSize(26, distantProximity.fontScale), 15.6);
assert.strictEqual(proximityLabels.api.getEventLabelScaledFontSize(26, 1.35), 26);

const pastProximity = getProximityPresentation(
  "2026-07-17T08:30:00.000Z",
  "2026-07-17T09:30:00.000Z"
);
assert.strictEqual(pastProximity.fontScale, 0.6);
assert.strictEqual(pastProximity.showFullTitle, false);

const recentlyPastProximity = getProximityPresentation(
  "2026-07-17T10:00:00.000Z",
  "2026-07-17T11:00:00.000Z"
);
assert.ok(recentlyPastProximity.fontScale < 1 && recentlyPastProximity.fontScale > 0.6);
assert.strictEqual(recentlyPastProximity.showFullTitle, false);

const allDayProximity = getProximityPresentation(
  "2026-07-17T00:00:00.000Z",
  "2026-07-18T00:00:00.000Z",
  { isAllDay: true }
);
assert.strictEqual(allDayProximity.fontScale, 1);
assert.strictEqual(allDayProximity.showFullTitle, true);

const longEventProximity = getProximityPresentation(
  "2026-07-17T10:00:00.000Z",
  "2026-07-17T22:00:00.000Z"
);
assert.strictEqual(longEventProximity.fontScale, 1);
assert.strictEqual(longEventProximity.showFullTitle, true);

const distantLongEventProximity = getProximityPresentation(
  "2026-07-18T03:00:00.000Z",
  "2026-07-19T04:00:00.000Z"
);
assert.strictEqual(distantLongEventProximity.fontScale, 0.6);
assert.strictEqual(distantLongEventProximity.showFullTitle, false);

let priorityRefreshCount = 0;
const proximityRefresh = loadFunctions("src/clock/scripts/clock-renderer.js", [
  "refreshEventLabelPriorityByTime"
], {
  Date,
  Number,
  eventLabelPriorityRefreshAt: 0,
  EVENT_LABEL_PRIORITY_REFRESH_MS: 15 * 1000,
  eventLabelProximityPriority: false,
  eventLabelsVisible: true,
  eventArcsVisible: true,
  updateTimeArcs() { priorityRefreshCount += 1; }
});
assert.strictEqual(proximityRefresh.api.refreshEventLabelPriorityByTime(100000, true), true);
assert.strictEqual(priorityRefreshCount, 1);
assert.strictEqual(proximityRefresh.api.refreshEventLabelPriorityByTime(114999, true), false);
assert.strictEqual(priorityRefreshCount, 1);
assert.strictEqual(proximityRefresh.api.refreshEventLabelPriorityByTime(115000, true), true);
assert.strictEqual(priorityRefreshCount, 2);
assert.strictEqual(proximityRefresh.api.refreshEventLabelPriorityByTime(120000, false), false);
assert.strictEqual(proximityRefresh.api.refreshEventLabelPriorityByTime(120001, true), true);
assert.strictEqual(priorityRefreshCount, 3);

let missingSegmentReverseChecks = 0;
const missingSegmentLabel = loadFunctions("src/clock/scripts/clock-renderer.js", [
  "updateArcLabels"
], {
  document: { querySelectorAll: () => [] },
  eventLabelsVisible: true,
  getClockFaceArcConfig: () => ({ labelsVisible: true }),
  getArcLabelFontSize: () => 18,
  getEventLabelProximityPresentation: () => ({ fontScale: 1, showFullTitle: false }),
  getEventLabelScaledFontSize: baseFontSize => baseFontSize,
  getEventLabelAnchor: () => "center",
  getArcLabelTextPathAnchor: () => ({ startOffset: "50%", textAnchor: "middle" }),
  shouldReverseArcLabelPath() { missingSegmentReverseChecks += 1; }
});
assert.doesNotThrow(() => missingSegmentLabel.api.updateArcLabels(0, { title: "Hidden" }, false, 100, undefined, 8));
assert.strictEqual(missingSegmentReverseChecks, 0);

let renderedLabelRadius = null;
let reverseArcLabelPath = false;
const arcLabelMeasurementContext = {
  font: "",
  measureText: () => ({ actualBoundingBoxAscent: 13, actualBoundingBoxDescent: 2 })
};
const offsetArcLabel = loadFunctions("src/clock/scripts/clock-renderer.js", [
  "getArcLabelPerpendicularMetrics",
  "getArcLabelRadialClearance",
  "getArcLabelRadius",
  "updateArcLabels"
], {
  ARC_LABEL_FALLBACK_ASCENT_RATIO: 0.75,
  ARC_LABEL_FALLBACK_DESCENT_RATIO: 0.2,
  ARC_LABEL_INNER_REVERSED_NUDGE_RATIO: 0.08,
  document: { querySelectorAll: () => [] },
  clockSize: 400,
  eventLabelsVisible: true,
  getClockFaceArcConfig: () => ({ labelsVisible: false }),
  getArcLabelFontSize: () => 20,
  getEventLabelProximityPresentation: () => ({ fontScale: 1, showFullTitle: false }),
  getEventLabelScaledFontSize: baseFontSize => baseFontSize,
  getEventLabelArcDistance: () => 6,
  getArcLabelMeasurementContext: () => arcLabelMeasurementContext,
  getEventLabelFontFamily: () => "Inter, sans-serif",
  getArcLabelFullText: event => event.title,
  getArcPixelLength: () => 100,
  getEventLabelAnchor: () => "center",
  shouldReverseArcLabelPath: () => reverseArcLabelPath,
  getArcLabelTextPathAnchor: () => ({ startOffset: "50%", textAnchor: "middle" }),
  getArcLabelPathRange: (_text, _length, _fontSize, _radius, segment) => ({
    startMinutes: segment.clockStartMinutes,
    endMinutes: segment.clockEndMinutes
  }),
  describeClockArc: (_size, radius) => {
    renderedLabelRadius = radius;
    return "M 0 0";
  }
});
offsetArcLabel.api.updateArcLabels(0, { title: "Offset" }, true, 100, {
  clockStartMinutes: 60,
  clockEndMinutes: 120,
  isPointEvent: false
}, 8);
assert.strictEqual(renderedLabelRadius, 88);
reverseArcLabelPath = true;
offsetArcLabel.api.updateArcLabels(0, { title: "Offset" }, true, 100, {
  clockStartMinutes: 60,
  clockEndMinutes: 120,
  isPointEvent: false
}, 8, 1);
assert.strictEqual(renderedLabelRadius, 112);
offsetArcLabel.api.updateArcLabels(0, { title: "Offset" }, true, 100, {
  clockStartMinutes: 60,
  clockEndMinutes: 120,
  isPointEvent: false
}, 8, -1);
assert.ok(Math.abs(renderedLabelRadius - 78.6) < 1e-9);
reverseArcLabelPath = false;
offsetArcLabel.api.updateArcLabels(0, { title: "Offset" }, true, 100, {
  clockStartMinutes: 60,
  clockEndMinutes: 120,
  isPointEvent: false
}, 8, 1);
assert.strictEqual(renderedLabelRadius, 123);

const alternatingLabelSides = loadFunctions("src/clock/scripts/clock-renderer.js", [
  "getAlternatingArcLabelSides"
], { Map });
const labelSideMap = alternatingLabelSides.api.getAlternatingArcLabelSides([
  { index: 2, startOffset: 120, endOffset: 180, isPointEvent: false },
  { index: 0, startOffset: 0, endOffset: 60, isPointEvent: false },
  { index: 3, startOffset: 60, endOffset: 60, isPointEvent: true },
  { index: 1, startOffset: 60, endOffset: 120, isPointEvent: false }
]);
assert.strictEqual(labelSideMap.get(0), -1);
assert.strictEqual(labelSideMap.get(1), 1);
assert.strictEqual(labelSideMap.get(2), -1);
assert.strictEqual(labelSideMap.has(3), false);

const linearArcLanes = loadFunctions("src/clock/scripts/clock-renderer.js", [
  "getArcLaneOverlapToleranceMinutes",
  "assignArcLanes"
], {
  arcSameLevelNonOverlapping: false,
  ARC_SEQUENTIAL_TOLERANCE_MINUTES: 1,
  use24HourRadial: false
});
const laneIndexes = segments => Array.from(linearArcLanes.api.assignArcLanes(segments), segment => segment.lane);
assert.deepStrictEqual(laneIndexes([
  { startOffset: 0, endOffset: 60 },
  { startOffset: 60, endOffset: 120 }
]), [0, 0]);
assert.deepStrictEqual(laneIndexes([
  { startOffset: 0, endOffset: 60 },
  { startOffset: 59, endOffset: 120 }
]), [0, 1]);
linearArcLanes.context.arcSameLevelNonOverlapping = true;
assert.deepStrictEqual(laneIndexes([
  { startOffset: 0, endOffset: 60 },
  { startOffset: 59, endOffset: 120 }
]), [0, 0]);

const circularArcLanes = loadFunctions("src/clock/scripts/clock-renderer.js", [
  "segmentIntervalsForCycle",
  "getArcLaneOverlapToleranceMinutes",
  "intervalSetsOverlap",
  "assignCircularArcLanes"
], {
  arcSameLevelNonOverlapping: false,
  ARC_SEQUENTIAL_TOLERANCE_MINUTES: 1,
  getClockCycleMinutes: () => 720
});
const circularLaneIndexes = segments => Array.from(
  circularArcLanes.api.assignCircularArcLanes(segments),
  segment => segment.lane
);
assert.deepStrictEqual(circularLaneIndexes([
  { startOffset: 0, endOffset: 60, clockStartMinutes: 690, clockEndMinutes: 750, isPointEvent: false },
  { startOffset: 60, endOffset: 90, clockStartMinutes: 750, clockEndMinutes: 780, isPointEvent: false }
]), [0, 0]);
assert.deepStrictEqual(circularLaneIndexes([
  { startOffset: 0, endOffset: 60, clockStartMinutes: 690, clockEndMinutes: 750, isPointEvent: false },
  { startOffset: 60, endOffset: 90, clockStartMinutes: 740, clockEndMinutes: 780, isPointEvent: false }
]), [0, 1]);

assert.match(clock.source, /if \(activeArcTooltipIndex !== null\) hideArcTooltip\(\);/);
assert.match(read("src/clock/scripts/magnifier-motion.js"), /clockOverlayMode !== "hidden"/);
assert.match(read("src/clock/scripts/app-init.js"), /stopAutoMagnifier\(\);/);
assert.match(read("src/clock/scripts/app-init.js"), /refreshEventLabelPriorityByTime\(nowMs\);/);
assert.match(read("src/content/time-window-controller.js"), /calendarClockStorageStatus = result\.calendarClockStorageStatus \|\| null/);

const tooltipPayload = loadFunctions("src/content/calendar-content-entry.js", [
  "normalizeCalendarClockTooltipText",
  "normalizeCalendarClockTooltipColor",
  "normalizeCalendarClockArcTooltipPayload"
], { String, Number, Math });
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(tooltipPayload.api.normalizeCalendarClockArcTooltipPayload({
    title: "<img src=x onerror=alert(1)>",
    calendarName: "Work",
    timeLabel: "09:00 – 10:00",
    color: "rgb(20, 30, 40)",
    state: "active",
    used: "30m",
    remaining: "30m",
    completion: 50
  }))),
  {
    title: "<img src=x onerror=alert(1)>",
    calendarName: "Work",
    timeLabel: "09:00 – 10:00",
    color: "rgb(20, 30, 40)",
    state: "active",
    used: "30m",
    remaining: "30m",
    completion: 50
  }
);
assert.strictEqual(tooltipPayload.api.normalizeCalendarClockTooltipColor("url(javascript:alert(1))"), "#b88d5a");
assert.doesNotMatch(extractFunction(tooltipPayload.source, "renderCalendarClockArcTooltip"), /innerHTML/);
assert.match(read("src/content/overlay/templates/root.html"), /data-cc-arc-tooltip/);
assert.match(read("src/content/overlay/styles/surface-debug-help.css"), /\.cc-arc-tooltip\s*\{[^}]*z-index:\s*2147483647/s);
assert.match(read("src/clock/scripts/event-tooltip.js"), /CALENDAR_CLOCK_SHOW_EVENT_TOOLTIP/);
assert.match(read("src/content/calendar-content-entry.js"), /CALENDAR_CLOCK_SHOW_EVENT_TOOLTIP[\s\S]*isTrustedCalendarClockFrameMessage/);

let recaptureCount = 0;
const windowSync = loadFunctions("src/content/overlay/overlay-menu.js", [
  "persistWindowAndSync"
], {
  saveCalendarClockState() {},
  updatePanelControls() {},
  syncClockFrame() {},
  renderDebugPanel() {},
  queuePublishCalendarEvents() { recaptureCount += 1; }
});
windowSync.api.persistWindowAndSync();
assert.strictEqual(recaptureCount, 0);
windowSync.api.persistWindowAndSync({ recapture: true });
assert.strictEqual(recaptureCount, 1);

const timeWindowSource = read("src/content/time-window-controller.js");
const overlaySource = read("src/content/overlay/overlay-menu.js");
const calendarContentStateSource = read("src/content/calendar-content-state.js");
const calendarContentEntrySource = read("src/content/calendar-content-entry.js");
const backgroundSource = read("src/background/background.js");
const clockAppStateSource = read("src/clock/scripts/app-state.js");
const clockAppInitSource = read("src/clock/scripts/app-init.js");
const clockBridgeSource = read("src/clock/scripts/calendar-bridge.js");
const calendarDomReaderSource = read("src/content/calendar-dom-reader.js");
const rootTemplateSource = read("src/content/overlay/templates/root.html");
assert.doesNotMatch(backgroundSource, /chrome\.action\.onClicked/);
assert.doesNotMatch(calendarContentEntrySource, /CALENDAR_CLOCK_TOGGLE_OVERLAY/);
assert.doesNotMatch(clockAppInitSource, /IS_ACTION_POPUP\)\s*use24HourRadial\s*=\s*true/);
assert.doesNotMatch(clockBridgeSource, /IS_ACTION_POPUP\s*\?\s*true/);
assert.match(clockBridgeSource, /displayWindowStartEl\.value\s*=\s*state\.windowStart/);
assert.match(clockBridgeSource, /displayWindowEndEl\.value\s*=\s*state\.windowEnd/);
assert.match(clockBridgeSource, /if \(chromeApi\?\.storage\?\.onChanged\)/);
assert.match(clockBridgeSource, /data\.type === "CALENDAR_CLOCK_CLEAR_EVENTS"[\s\S]*applyCalendarEvents\(\[\], null\)/);
assert.match(clockBridgeSource, /data\.type === "CALENDAR_CLOCK_RELOAD_EVENTS"[\s\S]*loadStoredCalendarEvents\(\)/);
assert.match(clockBridgeSource, /function applyCalendarEvents[\s\S]*hideRenderedCalendarEventVisuals\(\)[\s\S]*buildClock\(\)/);
assert.match(clockBridgeSource, /chromeApi\.runtime\.sendMessage\(\{[\s\S]*type: "CALENDAR_CLOCK_HARD_REFRESH_EVENTS"[\s\S]*tabId: tab\.id/);
assert.match(clockBridgeSource, /chromeApi\.tabs\.sendMessage\(tab\.id, \{[\s\S]*type: "CALENDAR_CLOCK_COLLECT_EVENTS"/);
assert.match(clockBridgeSource, /refreshCalendarButtonEl\.addEventListener\("click", \(\) => \{[\s\S]*hardReset: true/);
assert.doesNotMatch(clockBridgeSource, /applyCalendarEvents\(response\.events/);
assert.match(backgroundSource, /CALENDAR_CLOCK_EVENT_STORAGE_KEYS[\s\S]*function hardRefreshCalendarClockEvents[\s\S]*storage\.local\.remove[\s\S]*sendResponse\(\{ ok: true, reloading: true \}\)[\s\S]*tabs\.reload/);
assert.match(backgroundSource, /message\?\.type === "CALENDAR_CLOCK_HARD_REFRESH_EVENTS"[\s\S]*hardRefreshCalendarClockEvents/);
assert.match(calendarDomReaderSource, /if \(!displayDateRange\)[\s\S]*?return calendarClockEvents;/);
assert.match(calendarDomReaderSource, /response\.events\.length === 0[\s\S]*clearCalendarClockFrameEvents\(\)[\s\S]*reloadCalendarClockFrameEvents\(\)/);
assert.doesNotMatch(calendarDomReaderSource, /return \{ startDate: new Date\(NaN\), endDate: new Date\(NaN\) \}/);
assert.match(calendarContentStateSource, /timePanelOpen:\s*false/);
assert.match(calendarContentStateSource, /eventLabelDefaultVersion:\s*3/);
assert.match(calendarContentStateSource, /eventLabelFontSizeFull:\s*22/);
assert.match(calendarContentStateSource, /eventLabelFontSizeMini:\s*18/);
assert.match(calendarContentStateSource, /eventLabelShortenThreshold:\s*250/);
assert.match(calendarContentStateSource, /eventLabelArcDistance:\s*12/);
assert.match(clockAppStateSource, /eventLabelFontSize\s*=\s*clockOverlayMode === "mini" \? 18 : 22/);
assert.match(clockAppStateSource, /eventLabelShortenThreshold\s*=\s*250/);
assert.match(clockAppStateSource, /eventLabelArcDistance\s*=\s*12/);
assert.match(rootTemplateSource, /data-cc-event-label-font-size-full[^>]*value="22"/);
assert.match(rootTemplateSource, /data-cc-event-label-font-size-mini[^>]*value="18"/);
assert.match(rootTemplateSource, /data-cc-event-label-shorten-threshold[^>]*value="250"/);
assert.match(rootTemplateSource, /data-cc-event-label-arc-distance[^>]*value="12"/);
assert.match(rootTemplateSource, /Full is the large Calendar Clock opened with the Full button/);
assert.match(rootTemplateSource, /Mini is the small floating Calendar Clock opened with the Mini button/);
assert.match(rootTemplateSource, /Full<\/strong> is the large clock; <strong>Mini<\/strong> is the small floating clock/);
assert.match(rootTemplateSource, /250% means up to 2\.5 times the arc length/);
assert.match(rootTemplateSource, /Shortening always keeps the beginning and adds an ellipsis at the end/);
const visualSettingsSource = read("src/content/overlay/styles/visual-settings.css");
const surfaceStylesSource = read("src/content/overlay/styles/surface-debug-help.css");
assert.match(
  visualSettingsSource,
  /\.cc-arc-settings-panel\.expanded,\s*#calendar-clock-root \.cc-nested-event-labels-settings-panel\.expanded\s*\{[^}]*max-height:\s*none/s
);
assert.doesNotMatch(
  visualSettingsSource,
  /\.cc-(?:arc-settings-panel|nested-event-labels-settings-panel)\.expanded\s*\{[^}]*max-height:\s*\d+px/s
);
assert.match(
  surfaceStylesSource,
  /#calendar-clock-root\.cc-mode-hidden \.cc-clock-surface\s*\{[^}]*display:\s*none/s
);
assert.match(overlaySource, /fontSize:\s*getCalendarClockEventLabelFontSizeForMode\(\)/);
assert.match(overlaySource, /function wipeCalendarClockStoredEvents[\s\S]*clearCalendarClockFrameEvents\(\)[\s\S]*chrome\.storage\.local\.remove[\s\S]*reloadCalendarClockFrameEvents\(\)/);
assert.match(overlaySource, /function wipeCalendarClockAppSettingsToDefault[\s\S]*wipeCalendarClockStoredEvents[\s\S]*location\.reload\(\)/);
assert.match(overlaySource, /data-cc-action='refresh'[\s\S]*hardRefreshCalendarClockEventsFromToolbar/);
assert.match(overlaySource, /function hardRefreshCalendarClockEventsFromToolbar[\s\S]*CALENDAR_CLOCK_HARD_REFRESH_EVENTS/);
assert.match(rootTemplateSource, /data-cc-action="refresh"[^>]*title="Clear cached events, reload this Google Calendar tab/);

const mechanicalClockSoundPath = path.join(repoRoot, "src/content/sound/mechanical-clock/mechanical-clock.ogg");
assert.ok(fs.existsSync(mechanicalClockSoundPath), "Mechanical clock sound asset is missing");
assert.strictEqual(
  crypto.createHash("sha256").update(fs.readFileSync(mechanicalClockSoundPath)).digest("hex"),
  "89f4a3ff01728bd4af408e7b855974a572ecf2680571108fbb2e03225c27066a"
);
assert.match(overlaySource, /mechanical-clock\/mechanical-clock\.ogg/);
assert.doesNotMatch(overlaySource, /createOscillator\(/);
assert.match(read("src/content/event-reminders/player.mjs"), /mechanical-clock\/mechanical-clock\.ogg/);
assert.doesNotMatch(read("src/clock/scripts/magnifier-motion.js"), /CALENDAR_CLOCK_PLAY_TICK_SOUND|mechanical-clock\.ogg/);
assert.match(read("src/content/overlay/templates/debug.html"), /data-cc-action="play-debug-sound"[^>]*aria-pressed="false"/);

let stoppedMechanicalSoundAt = null;
const mechanicalSoundStop = loadFunctions("src/content/overlay/overlay-menu.js", [
  "updateCalendarClockDebugSoundButton",
  "setCalendarClockTickSoundActive",
  "stopCalendarClockTickSound"
], {
  Math,
  calendarClockDebug: null,
  calendarClockTickSoundPlaybackId: 4,
  calendarClockTickSoundStopTimerId: 99,
  calendarClockTickSoundActive: true,
  calendarClockTickSoundPlayback: {
    context: { currentTime: 8 },
    gain: { gain: {
      value: 0.72,
      cancelScheduledValues() {},
      setValueAtTime() {},
      exponentialRampToValueAtTime() {}
    } },
    source: { stop(time) { stoppedMechanicalSoundAt = time; } }
  },
  CALENDAR_CLOCK_TICK_SOUND_FADE_SECONDS: 0.04,
  clearTimeout() {}
});
mechanicalSoundStop.api.stopCalendarClockTickSound();
assert.strictEqual(mechanicalSoundStop.context.calendarClockTickSoundPlaybackId, 5);
assert.strictEqual(mechanicalSoundStop.context.calendarClockTickSoundActive, false);
assert.strictEqual(mechanicalSoundStop.context.calendarClockTickSoundPlayback, null);
assert.ok(Math.abs(stoppedMechanicalSoundAt - 8.05) < 0.000001);

const modeFontSizes = loadFunctions("src/content/time-window-controller.js", [
  "clampIntegerRange",
  "clampEventLabelFontSize",
  "getCalendarClockEventLabelFontSizeForMode"
], {
  Number,
  Math,
  CALENDAR_CLOCK_PANEL_DEFAULT: { eventLabelFontSizeFull: 22, eventLabelFontSizeMini: 18 },
  calendarClockState: { mode: "full", eventLabelFontSizeFull: 27, eventLabelFontSizeMini: 15 }
});
assert.strictEqual(modeFontSizes.api.getCalendarClockEventLabelFontSizeForMode("full"), 27);
assert.strictEqual(modeFontSizes.api.getCalendarClockEventLabelFontSizeForMode("mini"), 15);
modeFontSizes.context.calendarClockState.eventLabelFontSizeFull = "invalid";
modeFontSizes.context.calendarClockState.eventLabelFontSizeMini = "invalid";
assert.strictEqual(modeFontSizes.api.getCalendarClockEventLabelFontSizeForMode("full"), 22);
assert.strictEqual(modeFontSizes.api.getCalendarClockEventLabelFontSizeForMode("mini"), 18);
assert.match(timeWindowSource, /recapture:\s*options\.recapture === true/);
assert.match(overlaySource, /persistWindowAndSync\(\{ recapture: true \}\)/);

const cftRestartSource = read("scripts/Restart-BrowserHarnessCft.ps1");
assert.match(cftRestartSource, /function Resolve-CftChromePath/);
assert.match(cftRestartSource, /Sort-Object Version -Descending/);
assert.doesNotMatch(cftRestartSource, /chrome-for-testing\\\d+\.\d+\.\d+\.\d+\\chrome-win64/);

console.log("Safe clock bug-fix verifier passed.");
