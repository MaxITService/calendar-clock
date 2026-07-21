#!/usr/bin/env node
// Verifies that safe debug exports omit private Calendar data while the private export keeps it.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const privateEvent = {
  id: "event-private-id",
  domKey: "private-dom-key",
  title: "Dentist appointment",
  calendarName: "Personal Calendar",
  rawText: "Dentist appointment with raw DOM details",
  date: "2026-07-10",
  start: "10:30",
  end: "11:15",
  startDate: "2026-07-10T07:30:00.000Z",
  endDate: "2026-07-10T08:15:00.000Z",
  color: "#123456",
  durationKind: "range"
};
const privateValues = [
  privateEvent.id,
  privateEvent.domKey,
  privateEvent.title,
  privateEvent.calendarName,
  privateEvent.rawText,
  "https://calendar.google.com/calendar/u/0/r/day?private-calendar=true"
];

function makeContext() {
  return vm.createContext({
    console,
    Date,
    location: { href: privateValues.at(-1) },
    calendarClockState: {
      mode: "mini",
      clockFaceId: "analog",
      menuDarkTheme: false,
      pageOwnedInfo: true,
      consoleLogs: false,
      captureLimit: 50,
      windowStart: "08:00",
      windowEnd: "20:00",
      followNow: true,
      followRadiusHours: 3,
      radial24Hour: false,
      eventLabels: true,
      eventLabelStyle: "ink",
      eventLabelFontFamily: "Inter, Segoe UI, Arial, sans-serif",
      eventLabelFontSizeFull: 22,
      eventLabelFontSizeMini: 18,
      eventLabelMinLength: 5,
      eventLabelShortenThreshold: 100,
      eventLabelOpacity: 100,
      windowStartMarkerPulse: true,
      magnifierCenterCursor: false,
      magnifierAutoMinuteHandEnabled: false,
      magnifierAutoEventStartEnabled: false,
      magnifierAutoEventStartAttention: false,
      magnifierAutoEventEndEnabled: false,
      magnifierAutoEventEndAttention: false,
      arcsVisible: true,
      densityLevel: 50,
      arcThicknessLevel: 50,
      arcGapLevel: 10,
      arcSameLevelNonOverlapping: false,
      longDurationArcsVisible: true
    },
    calendarClockEffectiveEventSource: {
      requestedMode: "page-owned",
      activeSource: "google-page-owned",
      status: "captured: structured Calendar records extracted",
      fallback: false,
      captureStatus: {
        phase: "captured",
        transport: "fetch",
        endpoint: "/calendar/sync",
        reason: "private status text must not be copied",
        capturedResponses: 2,
        extractedRecords: 1
      }
    },
    calendarClockNavigationPending: false,
    calendarClockNavigationSettlingUntilMs: 0,
    calendarClockLastCaptureCandidateCount: 1,
    calendarClockCaptureMeta: {
      calendar: { source: "google-page-owned", limit: 50, parsedCount: 1, shownCount: 1, omittedCount: 0 },
      task: null
    },
    calendarClockStorageStatus: { kind: "history-trimmed", retainedEventCount: 1, removedEventCount: 2 },
    calendarClockEvents: [privateEvent],
    CALENDAR_CLOCK_SUPPORT_EMAIL: "support@example.com",
    getDisplayWindow: () => ({ start: 480, duration: 720 }),
    getCalendarClockEventLabelFontSizeForMode: () => 18,
    getWindowSummaryText: () => "08:00-20:00",
    getCalendarClockCaptureLimitNotice: () => "Calendar: 1 shown of 1",
    getCalendarClockDateParseFailures: () => [],
    isPointCalendarEvent: event => event.durationKind === "point",
    isAllDayCalendarEvent: event => event.durationKind === "all-day",
    getUndatedGoogleTaskWindowLabel: () => "",
    getVisibleEventSegment: () => true,
    getEventOverlapMinutes: () => 45
  });
}

function assertDoesNotContainPrivateValues(serialized, label) {
  privateValues.forEach(value => {
    assert.strictEqual(serialized.includes(value), false, `${label} must not contain ${value}`);
  });
}

function main() {
  const context = makeContext();
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/content/overlay/debug-panel.js"), "utf8"), context);

  const safePayload = JSON.parse(vm.runInContext("JSON.stringify(getSafeDebugPayload())", context));
  const safeJson = JSON.stringify(safePayload);
  const safeText = vm.runInContext("getSafeDebugTextPayload()", context);
  const fullPayload = JSON.parse(vm.runInContext("JSON.stringify(getFullDebugPayload())", context));
  const fullJson = JSON.stringify(fullPayload);

  assertDoesNotContainPrivateValues(safeJson, "Safe JSON");
  assertDoesNotContainPrivateValues(safeText, "Safe text");
  assert.strictEqual(Object.hasOwn(safePayload, "url"), false);
  assert.strictEqual(Object.hasOwn(safePayload, "events"), false);
  assert.deepStrictEqual(safePayload.eventSummary, {
    count: 1,
    durationKinds: { point: 0, allDay: 0, range: 1 },
    visibility: { visible: 1, notVisible: 0 },
    overlapMinutes: { knownEventCount: 1, positiveEventCount: 1, zeroEventCount: 0, total: 45 }
  });
  assert.deepStrictEqual(safePayload.captureMeta.calendar, {
    source: "google-page-owned",
    limit: 50,
    parsedCount: 1,
    shownCount: 1,
    omittedCount: 0
  });
  assert.deepStrictEqual(safePayload.storageStatus, {
    kind: "history-trimmed",
    retainedEventCount: 1,
    removedEventCount: 2
  });

  privateValues.forEach(value => {
    assert.strictEqual(fullJson.includes(value), true, `Full diagnostics must retain ${value}`);
  });
  console.log("Debug payload privacy verification passed.");
}

main();
