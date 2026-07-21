const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const temporalPath = path.join(repoRoot, "src/temporal-projection/temporal-projection.js");
const backgroundPath = path.join(repoRoot, "src/background/background.js");
const temporal = require(temporalPath);
const pageOwnedHook = require(path.join(repoRoot, "src/content/page-owned-info/main-world-hook.js"));

function value(result) {
  assert.equal(result.ok, true, result.diagnostic?.message);
  return result.value;
}

function context(timeZone) {
  return value(temporal.createContext(timeZone));
}

function timed(id, startInstant, endInstant, timeZone, durationKind = "range") {
  return value(temporal.projectInstantEvent({
    id,
    capturedFrom: "google-page-owned",
    title: id,
    durationKind,
    startInstant,
    endInstant
  }, context(timeZone)));
}

function allDay(id, startDateKey, endDateKeyExclusive, timeZone) {
  return value(temporal.projectAllDayEvent({
    id,
    capturedFrom: "google-page-owned",
    title: id,
    startDateKey,
    endDateKeyExclusive
  }, context(timeZone)));
}

function checkProjectionEdges() {
  const helsinkiCrossMidnight = timed(
    "helsinki-cross-midnight",
    "2026-07-20T20:30:00.000Z",
    "2026-07-20T21:30:00.000Z",
    "Europe/Helsinki"
  );
  assert.deepEqual(
    [helsinkiCrossMidnight.temporal.firstDateKey, helsinkiCrossMidnight.temporal.lastDateKey],
    ["2026-07-20", "2026-07-21"]
  );
  assert.equal(temporal.overlapsDateKeys(helsinkiCrossMidnight, ["2026-07-21"]), true);
  assert.equal(temporal.overlapsDateKeys(helsinkiCrossMidnight, ["2026-07-21", "2026-07-22"]), true);

  const losAngelesCrossMidnight = timed(
    "la-cross-midnight",
    "2026-07-21T06:30:00.000Z",
    "2026-07-21T07:30:00.000Z",
    "America/Los_Angeles"
  );
  assert.deepEqual(
    [losAngelesCrossMidnight.temporal.firstDateKey, losAngelesCrossMidnight.temporal.lastDateKey],
    ["2026-07-20", "2026-07-21"]
  );

  const exactMidnightEnd = timed(
    "midnight-end",
    "2026-07-20T20:30:00.000Z",
    "2026-07-20T21:00:00.000Z",
    "Europe/Helsinki"
  );
  assert.equal(exactMidnightEnd.temporal.lastDateKey, "2026-07-20");
  assert.equal(temporal.overlapsDateKeys(exactMidnightEnd, ["2026-07-21"]), false);

  const midnightPoint = timed(
    "midnight-point",
    "2026-07-20T21:00:00.000Z",
    "2026-07-20T21:00:00.000Z",
    "Europe/Helsinki",
    "point"
  );
  assert.equal(midnightPoint.temporal.firstDateKey, "2026-07-21");
  assert.equal(temporal.overlapsInstantRange(
    midnightPoint,
    "2026-07-20T21:00:00.000Z",
    "2026-07-21T21:00:00.000Z",
    ["2026-07-21"]
  ), true);

  const yearBoundary = timed(
    "year-boundary",
    "2026-12-31T21:30:00.000Z",
    "2026-12-31T22:30:00.000Z",
    "Europe/Helsinki"
  );
  assert.deepEqual(
    [yearBoundary.temporal.firstDateKey, yearBoundary.temporal.lastDateKey],
    ["2026-12-31", "2027-01-01"]
  );
  assert.equal(temporal.overlapsDateKeys(yearBoundary, ["2027-01-01"]), true);

  const leapDay = allDay("leap", "2024-02-29", "2024-03-01", "America/Los_Angeles");
  assert.deepEqual(
    [leapDay.temporal.startDateKey, leapDay.temporal.endDateKeyExclusive, leapDay.temporal.lastDateKey],
    ["2024-02-29", "2024-03-01", "2024-02-29"]
  );
  const isoWeekBoundary = allDay("iso-week", "2020-12-28", "2021-01-05", "Europe/Helsinki");
  assert.equal(temporal.overlapsDateKeys(isoWeekBoundary, ["2021-01-04"]), true);

  const multiDay = allDay("all-day", "2026-07-20", "2026-07-23", "America/Los_Angeles");
  assert.deepEqual(
    [multiDay.temporal.firstDateKey, multiDay.temporal.lastDateKey],
    ["2026-07-20", "2026-07-22"]
  );
  assert.equal(multiDay.startDate, "2026-07-20T07:00:00.000Z");
  assert.equal(multiDay.temporal.startInstant, undefined);

  const veryLong = allDay("long", "2000-01-01", "2100-01-01", "UTC");
  assert.equal(Array.isArray(veryLong.temporal.dateKeys), false);
  assert.ok(JSON.stringify(veryLong).length < 1500);

  const apiAllDayRecord = Array(92).fill(null);
  apiAllDayRecord[0] = "api-all-day";
  apiAllDayRecord[4] = Date.UTC(2026, 6, 1);
  apiAllDayRecord[5] = "API all day";
  apiAllDayRecord[35] = [Date.UTC(2026, 6, 20)];
  apiAllDayRecord[36] = [Date.UTC(2026, 6, 22)];
  const extractedAllDay = pageOwnedHook.extractCalendarPositionalRecord(apiAllDayRecord);
  assert.deepEqual(
    [extractedAllDay.allDayStartDateKey, extractedAllDay.allDayEndDateKeyExclusive],
    ["2026-07-20", "2026-07-22"]
  );
  assert.equal(Object.hasOwn(extractedAllDay, "startDate"), false);

  const recurringPayload = [
    apiAllDayRecord,
    (() => {
      const next = apiAllDayRecord.slice();
      next[0] = "api-all-day-instance-2";
      next[35] = [Date.UTC(2026, 6, 27)];
      next[36] = [Date.UTC(2026, 6, 28)];
      return next;
    })()
  ];
  assert.equal(pageOwnedHook.extractCalendarRecords(recurringPayload).length, 2);
}

function checkDstAndDomWallTimes() {
  assert.equal(temporal.resolveZonedCivilDateTime("2026-03-29", "03:30", "Europe/Helsinki").diagnostic.code, "nonexistent-civil-time");
  assert.equal(temporal.resolveZonedCivilDateTime("2026-10-25", "03:30", "Europe/Helsinki").diagnostic.code, "ambiguous-civil-time");
  assert.equal(temporal.resolveZonedCivilDateTime("2026-03-08", "02:30", "America/Los_Angeles").diagnostic.code, "nonexistent-civil-time");
  assert.equal(temporal.resolveZonedCivilDateTime("2026-11-01", "01:30", "America/Los_Angeles").diagnostic.code, "ambiguous-civil-time");

  const firstRepeated = timed("repeat", "2026-10-25T00:30:00.000Z", "2026-10-25T00:30:00.000Z", "Europe/Helsinki", "point");
  const secondRepeated = timed("repeat", "2026-10-25T01:30:00.000Z", "2026-10-25T01:30:00.000Z", "Europe/Helsinki", "point");
  assert.notEqual(firstRepeated.temporal.occurrenceKey, secondRepeated.temporal.occurrenceKey);
  assert.equal(firstRepeated.start, secondRepeated.start);

  const spring = timed("spring", "2026-03-29T00:30:00.000Z", "2026-03-29T01:30:00.000Z", "Europe/Helsinki");
  assert.equal(spring.temporal.firstDateKey, "2026-03-29");
  assert.equal(spring.temporal.lastDateKey, "2026-03-29");

  const zonedRange = value(temporal.projectZonedEvent({
    id: "wall-range",
    capturedFrom: "google-calendar-dom",
    durationKind: "range",
    startDateKey: "2026-07-20",
    startTime: "23:30",
    endDateKey: "2026-07-21",
    endTime: "00:30"
  }, context("Europe/Helsinki")));
  assert.deepEqual(
    [zonedRange.temporal.firstDateKey, zonedRange.temporal.lastDateKey],
    ["2026-07-20", "2026-07-21"]
  );
}

function loadDomReader(language) {
  const visibleDateValues = [];
  const sandbox = vm.createContext({
    console,
    Date,
    Intl,
    Map,
    Set,
    navigator: { language, languages: [language] },
    location: { href: "https://calendar.google.com/calendar/u/0/r/week/2026/7/20", pathname: "/calendar/u/0/r/week/2026/7/20" },
    window: { innerWidth: 1000, innerHeight: 800 },
    document: {
      title: "",
      documentElement: { lang: language, clientWidth: 1000, clientHeight: 800 },
      getElementById: () => ({ value: "Europe/Helsinki" }),
      querySelectorAll: selector => selector === "[data-date]"
        ? visibleDateValues.map(value => ({
          getAttribute: name => name === "data-date" ? value : null,
          getBoundingClientRect: () => ({ left: 0, right: 10, top: 0, bottom: 10 })
        }))
        : []
    },
    calendarClockState: { windowStart: "08:00", windowEnd: "20:00" },
    CALENDAR_CLOCK_SUPPORT_EMAIL: "support@example.com",
    onCalendarClockContextInvalidated() {},
    CalendarClockTemporalProjection: null,
    calendarClockTemporalProjection: null
  });
  vm.runInContext(fs.readFileSync(temporalPath, "utf8"), sandbox);
  sandbox.calendarClockTemporalProjection = sandbox.CalendarClockTemporalProjection;
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/content/calendar-dom-reader.js"), "utf8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/content/time-window-controller.js"), "utf8"), sandbox);
  sandbox.setVisibleDateValues = values => {
    visibleDateValues.splice(0, visibleDateValues.length, ...values);
  };
  return sandbox;
}

function checkLocaleAndTimeParsing() {
  const us = loadDomReader("en-US");
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(parseTimeRange('11:30 PM - 12:30 AM'))", us)), { start: "23:30", end: "00:30" });
  assert.deepEqual(JSON.parse(vm.runInContext("JSON.stringify(parseTimeRange('23:30 - 00:30'))", us)), { start: "23:30", end: "00:30" });
  assert.equal(vm.runInContext("parseSingleTime('12 AM').start", us), "00:00");
  assert.equal(vm.runInContext("parseSingleTime('12 PM').start", us), "12:00");
  assert.equal(vm.runInContext("parseSingleTime('9.30').start", us), "09:30");
  assert.equal(vm.runInContext("formatLocalDateKey(findExplicitCalendarEventDate('03/04/2026'))", us), "2026-03-04");
  assert.equal(vm.runInContext("formatLocalDateKey(findExplicitCalendarEventDate('2026-07-20'))", us), "2026-07-20");

  const fi = loadDomReader("fi-FI");
  assert.equal(vm.runInContext("formatLocalDateKey(findExplicitCalendarEventDate('03/04/2026'))", fi), "2026-04-03");
  assert.equal(vm.runInContext("formatLocalDateKey(findExplicitCalendarEventDate('20 heinäkuuta 2026'))", fi), "2026-07-20");
  const ru = loadDomReader("ru-RU");
  assert.equal(vm.runInContext("formatLocalDateKey(findExplicitCalendarEventDate('20 июля 2026'))", ru), "2026-07-20");
  const unknown = loadDomReader("");
  assert.equal(vm.runInContext("findExplicitCalendarEventDate('03/04/2026')", unknown), null);

  us.setVisibleDateValues(["20260720", "20260721", "20260722", "20260723", "20260724", "20260725", "20260726"]);
  assert.equal(vm.runInContext("getCalendarClockCaptureView().dateKeySource", us), "dated-url");
  us.setVisibleDateValues(["20260721", "20260722", "20260723", "20260724", "20260725", "20260726", "20260727"]);
  assert.equal(vm.runInContext("getCalendarClockCaptureView().dateKeySource", us), "source-conflict");
  assert.equal(vm.runInContext("isCalendarClockCaptureDateScopeTrusted(getCalendarClockCaptureView())", us), false);
  us.location.pathname = "/calendar/u/0/r/week";
  us.location.href = "https://calendar.google.com/calendar/u/0/r/week";
  us.setVisibleDateValues(["20260720", "20260721", "20260722", "20260723", "20260724", "20260725", "20260726"]);
  assert.equal(vm.runInContext("getCalendarClockCaptureView().dateKeySource", us), "visible-dom");
  assert.equal(vm.runInContext("isCalendarClockCaptureDateScopeTrusted(getCalendarClockCaptureView())", us), true);
  us.setVisibleDateValues([]);
  us.document.title = "July 20, 2026";
  assert.equal(vm.runInContext("getCalendarClockCaptureView().dateKeySource", us), "title");
  assert.equal(vm.runInContext("isCalendarClockCaptureDateScopeTrusted(getCalendarClockCaptureView())", us), false);
  us.document.title = "Google Calendar";
  assert.equal(vm.runInContext("getCalendarClockCaptureView().dateKeySource", us), "today-fallback");
  us.location.pathname = "/calendar/u/0/r/month/2026/7/1";
  assert.deepEqual(
    JSON.parse(vm.runInContext("JSON.stringify({ source: getCalendarClockCaptureView().dateKeySource, keys: getCalendarClockCaptureView().visibleDateKeys, trusted: isCalendarClockCaptureDateScopeTrusted(getCalendarClockCaptureView()) })", us)),
    { source: "dated-url", keys: [], trusted: false }
  );

  const adapterResult = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const api = CalendarClockTemporalProjection;
    const projectionContext = api.createContext('Europe/Helsinki').value;
    const structured = projectCalendarClockSourceEvents([{
      id: 'structured', capturedFrom: 'google-page-owned', durationKind: 'range',
      startDate: '2026-07-20T20:30:00.000Z', endDate: '2026-07-20T21:30:00.000Z',
      start: '13:30', end: '14:30', timeZone: 'America/Los_Angeles'
    }], 'google-page-owned', api, projectionContext);
    const dom = projectCalendarClockSourceEvents([{
      id: 'dom', capturedFrom: 'google-calendar-dom', durationKind: 'range', start: '23:30', end: '00:30',
      adapterTemporal: { startDateKey: '2026-07-20', startTime: '23:30', endDateKey: '2026-07-21', endTime: '00:30' },
      dateParseStatus: 'ok'
    }], 'google-calendar-dom', api, projectionContext);
    const ambiguous = projectCalendarClockSourceEvents([{
      id: 'ambiguous', capturedFrom: 'google-calendar-dom', durationKind: 'point', start: '03:30', end: '03:30',
      adapterTemporal: { startDateKey: '2026-10-25', startTime: '03:30', endDateKey: '2026-10-25', endTime: '03:30' },
      dateParseStatus: 'ok'
    }], 'google-calendar-dom', api, projectionContext);
    return {
      structuredSpan: [structured.projected[0].temporal.firstDateKey, structured.projected[0].temporal.lastDateKey],
      structuredTime: [structured.projected[0].start, structured.projected[0].end],
      domSpan: [dom.projected[0].temporal.firstDateKey, dom.projected[0].temporal.lastDateKey],
      ambiguousCode: ambiguous.diagnostics[0].code
    };
  })())`, us));
  assert.deepEqual(adapterResult, {
    structuredSpan: ["2026-07-20", "2026-07-21"],
    structuredTime: ["23:30", "00:30"],
    domSpan: ["2026-07-20", "2026-07-21"],
    ambiguousCode: "ambiguous-civil-time"
  });
}

function makeBackgroundContext({ moduleAvailable = true } = {}) {
  const listeners = {};
  const writes = [];
  const chromeApi = {
    action: { setBadgeText() {}, onClicked: { addListener() {} } },
    runtime: {
      getURL: value => `chrome-extension://test/${value}`,
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { listeners.message = listener; } },
      lastError: null
    },
    storage: { local: { get() {}, set(data, callback) { writes.push(data); callback?.(); } } },
    tabs: { sendMessage() {} }
  };
  const sandbox = vm.createContext({
    chrome: chromeApi,
    console,
    Date,
    Intl,
    Map,
    Set,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    importScripts() {
      if (!moduleAvailable) throw new Error("missing module");
    }
  });
  if (moduleAvailable) vm.runInContext(fs.readFileSync(temporalPath, "utf8"), sandbox);
  vm.runInContext(fs.readFileSync(backgroundPath, "utf8"), sandbox);
  return { sandbox, listeners, writes };
}

function checkStoreAndBoundary() {
  const { sandbox } = makeBackgroundContext();
  sandbox.eventJson = JSON.stringify(timed(
    "stored-cross-midnight",
    "2026-07-20T20:30:00.000Z",
    "2026-07-20T21:30:00.000Z",
    "Europe/Helsinki"
  ));
  const result = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const event = JSON.parse(eventJson);
    const context = CalendarClockTemporalProjection.createContext('Europe/Helsinki').value;
    const view = { mode: 'day', visibleDateKeys: ['2026-07-20'], dateKeySource: 'dated-url', canClearMissingDates: true };
    const store = updateCalendarClockEventStore(null, [event], view, 1, 'calendar', context);
    return {
      version: store.version,
      entryCount: store.entries.length,
      july21: getCalendarClockStoredEventsForDateKeys(store, ['2026-07-21'], context).map(item => item.id),
      size: JSON.stringify(store).length
    };
  })())`, sandbox));
  assert.deepEqual(result, { version: 2, entryCount: 1, july21: ["stored-cross-midnight"], size: result.size });
  assert.ok(result.size < 3000);
  const boundaryResult = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const event = JSON.parse(eventJson);
    const context = CalendarClockTemporalProjection.createContext('Europe/Helsinki').value;
    const base = {
      calendarEvents: [event],
      calendarDisplayEvents: [event],
      calendarCaptureView: { mode: 'day', visibleDateKeys: ['2026-07-20'], dateKeySource: 'dated-url', canClearMissingDates: true },
      displayDateKeys: ['2026-07-20', '2026-07-21'],
      windowStartDate: '2026-07-20T20:00:00.000Z',
      windowEndDate: '2026-07-20T22:00:00.000Z',
      timeZone: 'Europe/Helsinki',
      temporalContext: context
    };
    const tampered = JSON.parse(JSON.stringify(event));
    tampered.temporal.startInstant = '2026-07-20T20:45:00.000Z';
    return {
      valid: validateCalendarClockTemporalFeed(base).ok,
      wrongZone: validateCalendarClockTemporalFeed({ ...base, timeZone: 'UTC' }).ok,
      invalidKey: validateCalendarClockTemporalFeed({ ...base, displayDateKeys: ['2026-02-30'] }).ok,
      invalidProvenance: validateCalendarClockTemporalFeed({
        ...base,
        calendarCaptureView: { ...base.calendarCaptureView, dateKeySource: 'guessed' }
      }).ok,
      tampered: validateCalendarClockTemporalFeed({ ...base, calendarEvents: [tampered] }).ok
    };
  })())`, sandbox));
  assert.deepEqual(boundaryResult, {
    valid: true,
    wrongZone: false,
    invalidKey: false,
    invalidProvenance: false,
    tampered: false
  });

  sandbox.secondEventJson = JSON.stringify(timed(
    "stored-cross-midnight",
    "2026-07-27T20:30:00.000Z",
    "2026-07-27T21:30:00.000Z",
    "Europe/Helsinki"
  ));
  const occurrenceResult = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const first = JSON.parse(eventJson);
    const second = JSON.parse(secondEventJson);
    const context = CalendarClockTemporalProjection.createContext('Europe/Helsinki').value;
    const view = {
      mode: 'week',
      visibleDateKeys: ['2026-07-20', '2026-07-21', '2026-07-27', '2026-07-28'],
      dateKeySource: 'visible-dom',
      canClearMissingDates: true
    };
    const store = updateCalendarClockEventStore(null, [first, second], view, 1, 'calendar', context);
    const removed = evictCalendarClockDeletedEventsFromStore(store, ['stored-cross-midnight'], context);
    const cleared = updateCalendarClockEventStore(store, [], view, 2, 'calendar', context);
    const limited = limitCalendarClockEventStoreEvents(store, 1, context);
    return {
      occurrenceCount: store.entries.length,
      distinctKeys: new Set(store.entries.map(entry => entry.event.temporal.occurrenceKey)).size,
      deletionCount: removed.entries.length,
      authoritativeClearCount: cleared.entries.length,
      limitedCount: limited.entries.length,
      limitStatus: makeCalendarClockStorageStatus(store, limited),
      retryLimits: getCalendarClockStorageRetryEventLimits(store)
    };
  })())`, sandbox));
  assert.deepEqual(occurrenceResult, {
    occurrenceCount: 2,
    distinctKeys: 2,
    deletionCount: 0,
    authoritativeClearCount: 0,
    limitedCount: 1,
    limitStatus: { kind: "history-trimmed", retainedEventCount: 1, removedEventCount: 1 },
    retryLimits: [1, 0]
  });

  const provenanceResult = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const event = JSON.parse(eventJson);
    const context = CalendarClockTemporalProjection.createContext('Europe/Helsinki').value;
    const stored = updateCalendarClockEventStore(null, [event], {}, 1, 'calendar', context);
    const retainedCount = (dateKeySource, options = {}) => updateCalendarClockEventStore(
      stored,
      [],
      {
        mode: options.mode || 'day',
        visibleDateKeys: ['2026-07-20'],
        ...(dateKeySource === undefined ? {} : { dateKeySource }),
        canClearMissingDates: options.canClearMissingDates !== false
      },
      2,
      'calendar',
      context
    ).entries.length;
    return {
      datedUrl: retainedCount('dated-url'),
      visibleDom: retainedCount('visible-dom'),
      title: retainedCount('title'),
      todayFallback: retainedCount('today-fallback'),
      sourceConflict: retainedCount('source-conflict'),
      missingProvenance: retainedCount(undefined),
      explicitNonAuthoritative: retainedCount('dated-url', { canClearMissingDates: false }),
      monthWithoutKeys: updateCalendarClockEventStore(stored, [], {
        mode: 'month', visibleDateKeys: [], dateKeySource: 'dated-url', canClearMissingDates: true
      }, 2, 'calendar', context).entries.length
    };
  })())`, sandbox));
  assert.deepEqual(provenanceResult, {
    datedUrl: 0,
    visibleDom: 0,
    title: 1,
    todayFallback: 1,
    sourceConflict: 1,
    missingProvenance: 1,
    explicitNonAuthoritative: 1,
    monthWithoutKeys: 1
  });
  assert.equal(vm.runInContext("shouldSuppressCalendarClockDomTaskFeed(undefined)", sandbox), false);
  assert.equal(vm.runInContext("shouldSuppressCalendarClockDomTaskFeed({})", sandbox), false);
  assert.equal(vm.runInContext("shouldSuppressCalendarClockDomTaskFeed({pageOwnedInfo:true})", sandbox), true);

  sandbox.movedOriginalJson = JSON.stringify(timed(
    "moved-occurrence",
    "2026-07-21T06:45:00.000Z",
    "2026-07-21T07:45:00.000Z",
    "UTC"
  ));
  sandbox.movedReplacementJson = JSON.stringify(timed(
    "moved-occurrence",
    "2026-07-21T08:15:00.000Z",
    "2026-07-21T09:15:00.000Z",
    "UTC"
  ));
  const movedOccurrenceResult = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const context = CalendarClockTemporalProjection.createContext('UTC').value;
    const view = {
      mode: 'day',
      visibleDateKeys: ['2026-07-21'],
      dateKeySource: 'title',
      canClearMissingDates: true
    };
    const movedOriginal = JSON.parse(movedOriginalJson);
    const movedReplacement = JSON.parse(movedReplacementJson);
    const oldStore = updateCalendarClockEventStore(null, [movedOriginal], view, 1, 'calendar', context);
    const movedStore = updateCalendarClockEventStore(oldStore, [movedReplacement], view, 2, 'calendar', context);
    const effective = getEffectiveCalendarEvents(
      [movedReplacement],
      movedStore,
      ['2026-07-21'],
      '2026-07-21T06:00:00.000Z',
      '2026-07-21T10:00:00.000Z',
      context
    );
    return {
      storedCount: movedStore.entries.length,
      storedStarts: movedStore.entries.map(entry => entry.event.start),
      effectiveCount: effective.length,
      effectiveStarts: effective.map(event => event.start)
    };
  })())`, sandbox));
  assert.deepEqual(movedOccurrenceResult, {
    storedCount: 1,
    storedStarts: ["08:15"],
    effectiveCount: 1,
    effectiveStarts: ["08:15"]
  });

  const resetResult = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const event = JSON.parse(eventJson);
    const helsinki = CalendarClockTemporalProjection.createContext('Europe/Helsinki').value;
    const losAngeles = CalendarClockTemporalProjection.createContext('America/Los_Angeles').value;
    const store = updateCalendarClockEventStore(null, [event], { visibleDateKeys: ['2026-07-20'] }, 1, 'calendar', helsinki);
    const reset = normalizeCalendarClockEventStore(store, losAngeles);
    const oldSchema = normalizeCalendarClockEventStore({ ...store, version: 1 }, helsinki);
    return {
      zoneResetCount: reset.entries.length,
      zoneFingerprint: reset.contextFingerprint,
      expectedFingerprint: losAngeles.fingerprint,
      oldSchemaCount: oldSchema.entries.length
    };
  })())`, sandbox));
  assert.deepEqual(resetResult, {
    zoneResetCount: 0,
    zoneFingerprint: resetResult.expectedFingerprint,
    expectedFingerprint: resetResult.expectedFingerprint,
    oldSchemaCount: 0
  });

  const sameInstantHelsinki = timed("same", "2026-07-20T20:30:00.000Z", "2026-07-20T21:30:00.000Z", "Europe/Helsinki");
  const sameInstantLosAngeles = timed("same", "2026-07-20T20:30:00.000Z", "2026-07-20T21:30:00.000Z", "America/Los_Angeles");
  assert.equal(sameInstantHelsinki.temporal.occurrenceKey, sameInstantLosAngeles.temporal.occurrenceKey);

  const { listeners } = makeBackgroundContext({ moduleAvailable: false });
  let response = null;
  const keepAlive = listeners.message({ type: "CALENDAR_CLOCK_EVENTS", events: [], timeZone: "UTC" }, {}, value => { response = value; });
  assert.equal(keepAlive, true);
  assert.equal(response.ok, false);
  assert.match(response.error, /temporal projection unavailable/i);
}

function checkInvalidInputs() {
  assert.equal(temporal.createContext("Mars/Olympus").ok, false);
  assert.equal(temporal.projectInstantEvent({
    id: "bad",
    capturedFrom: "google-page-owned",
    durationKind: "range",
    startInstant: "not-iso",
    endInstant: "2026-07-20T10:00:00.000Z"
  }, context("UTC")).ok, false);
  assert.equal(temporal.projectInstantEvent({
    id: "reversed",
    capturedFrom: "google-page-owned",
    durationKind: "range",
    startInstant: "2026-07-20T11:00:00.000Z",
    endInstant: "2026-07-20T10:00:00.000Z"
  }, context("UTC")).ok, false);
  assert.equal(temporal.projectAllDayEvent({
    id: "bad-day",
    capturedFrom: "google-page-owned",
    startDateKey: "2026-02-30",
    endDateKeyExclusive: "2026-03-01"
  }, context("UTC")).ok, false);
}

function checkSystemTimezoneInvariance() {
  const outputs = ["UTC", "America/Los_Angeles", "Europe/Helsinki"].map(TZ => {
    const child = spawnSync(process.execPath, [__filename, "--probe"], {
      cwd: repoRoot,
      env: { ...process.env, TZ },
      encoding: "utf8"
    });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout.trim();
  });
  assert.equal(new Set(outputs).size, 1);
}

if (process.argv[2] === "--probe") {
  const event = timed(
    "probe",
    "2026-07-20T20:30:00.000Z",
    "2026-07-20T21:30:00.000Z",
    "Europe/Helsinki"
  );
  const reader = loadDomReader("fi-FI");
  const parsedCivil = vm.runInContext("formatLocalDateKey(findExplicitCalendarEventDate('03/04/2026'))", reader);
  process.stdout.write(JSON.stringify({ temporal: event.temporal, parsedCivil }));
} else {
  checkProjectionEdges();
  checkDstAndDomWallTimes();
  checkLocaleAndTimeParsing();
  checkStoreAndBoundary();
  checkInvalidInputs();
  checkSystemTimezoneInvariance();
  console.log("Temporal projection verification passed.");
}
