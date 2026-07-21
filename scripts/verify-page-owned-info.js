const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const earlyDeletions = require(path.join(repoRoot, "src/content/main-world-early-deletions.js"));
const hook = require(path.join(repoRoot, "src/content/page-owned-info/main-world-hook.js"));
const bridge = require(path.join(repoRoot, "src/content/optional-module-loader.js"));

function observedCalendarFixture({
  startHour = 21,
  endHour = 22,
  updatedAt = Date.UTC(2026, 5, 23, 20),
  omitEnd = false
} = {}) {
  const record = Array(omitEnd ? 36 : 92).fill(null);
  record[0] = "fixture-task-id";
  record[4] = updatedAt;
  record[5] = "Fixture task";
  record[35] = [null, [Date.UTC(2026, 5, 23, startHour)], "America/Los_Angeles"];
  if (!omitEnd) record[36] = [null, [Date.UTC(2026, 5, 23, endHour)], "America/Los_Angeles"];
  return [["response", 0, ["opaque", [["calendar", [record]]]]]];
}

function observedTasksFixture({
  title = "check tasks",
  updatedAt = Date.UTC(2026, 5, 24, 19),
  relatedEventId = ""
} = {}) {
  const taskId = "fixture-task-api-id";
  const startAt = Date.UTC(2026, 5, 24, 20, 30);
  const schedule = [null, [2026, 6, 24], [13, 30], "America/Los_Angeles", null, [String(startAt / 1000)]];
  const record = Array(relatedEventId ? 24 : 13).fill(null);
  record[0] = taskId;
  record[1] = [null, title, null, [2026, 6, 24]];
  record[2] = [String(Math.floor(updatedAt / 1000)), (updatedAt % 1000) * 1000000];
  record[3] = "~default";
  record[7] = [null, "11"];
  record[8] = [schedule];
  if (relatedEventId) record[23] = [[taskId, [relatedEventId], schedule]];
  return [[null, null, record]];
}

function testExtractorFixture() {
  const records = hook.extractCalendarRecords(observedCalendarFixture());
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].id, "fixture-task-id");
  assert.strictEqual(records[0].title, "Fixture task");
  assert.strictEqual(records[0].start, "14:00");
  assert.strictEqual(records[0].end, "15:00");
  assert.strictEqual(records[0].durationKind, "range");
  assert.strictEqual(records[0].itemKind, "event");
  assert.strictEqual(records[0].updatedAt, Date.UTC(2026, 5, 23, 20));
  assert.strictEqual(hook.parseJsonResponse(")]}'\n" + JSON.stringify(observedCalendarFixture())).length, 1);
}

function testMissingEndBecomesPoint() {
  const records = hook.extractCalendarRecords(observedCalendarFixture({ omitEnd: true }));
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].start, "14:00");
  assert.strictEqual(records[0].end, "14:00");
  assert.strictEqual(records[0].durationKind, "point");
  assert.strictEqual(records[0].startDate, records[0].endDate);
}

function testTasksSyncPointExtractor() {
  const records = hook.extractCalendarRecords(observedTasksFixture());
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].id, "task:fixture-task-api-id");
  assert.strictEqual(records[0].title, "check tasks");
  assert.strictEqual(records[0].date, "2026-06-24");
  assert.strictEqual(records[0].start, "13:30");
  assert.strictEqual(records[0].end, "13:30");
  assert.strictEqual(records[0].durationKind, "point");
  assert.strictEqual(records[0].itemKind, "task");
  assert.strictEqual(records[0].sourceKind, "calendar-task");
  assert.strictEqual(records[0].calendarName, "Google Task");
}

function testBridgeTrustAndSchema() {
  const token = "a".repeat(43);
  const record = hook.extractCalendarRecords(observedCalendarFixture())[0];
  const valid = bridge.sanitizeRecordsMessage({
    type: "records",
    token,
    records: [record],
    deletedIds: ["deleted-event-id"],
    status: { phase: "captured" }
  }, token);
  assert.strictEqual(valid.records.length, 1);
  assert.deepStrictEqual(valid.deletedIds, ["deleted-event-id"]);
  assert.strictEqual(bridge.sanitizeRecordsMessage({ type: "records", token: "wrong", records: [record] }, token), null);
  assert.strictEqual(bridge.sanitizeRecordsMessage({ type: "records", token, records: [{ ...record, endDate: "bad" }] }, token), null);
  assert.strictEqual(bridge.sanitizeRecordsMessage({ type: "records", token, records: [record], deletedIds: [{}] }, token), null);

  const scope = { location: { origin: "https://calendar.google.com" } };
  const port = {};
  const event = { source: scope, origin: scope.location.origin, data: { type: "CALENDAR_CLOCK_PAGE_OWNED_INIT", channelId: token }, ports: [port] };
  assert.strictEqual(hook.isTrustedBridgeInit(event, scope), true);
  assert.strictEqual(hook.isTrustedBridgeInit({ ...event, origin: "https://example.com" }, scope), false);
  assert.strictEqual(hook.isTrustedBridgeInit({ ...event, source: {} }, scope), false);
  assert.strictEqual(hook.isTrustedBridgeInit({ ...event, data: { ...event.data, channelId: "short" } }, scope), false);
  assert.strictEqual(bridge.didEnabledValueChange(true, true), false);
  assert.strictEqual(bridge.didEnabledValueChange(true, false), true);
  assert.strictEqual(bridge.isPageOwnedInfoEnabled(undefined), true);
  assert.strictEqual(bridge.isPageOwnedInfoEnabled({}), true);
  assert.strictEqual(bridge.isPageOwnedInfoEnabled({ pageOwnedInfo: true }), true);
  assert.strictEqual(bridge.isPageOwnedInfoEnabled({ pageOwnedInfo: false }), false);
  assert.strictEqual(hook.didHookEnabledValueChange(true, true), false);
  assert.strictEqual(hook.didHookEnabledValueChange(true, false), true);
}

function testEndpointMatching() {
  const base = "https://calendar.google.com/calendar/u/0/r/week";
  assert.strictEqual(hook.isRelevantResponseUrl("/calendar/u/0/sync.sync", base), true);
  assert.strictEqual(hook.isRelevantResponseUrl("/calendar/u/1/sync.prefetcheventrange", base), true);
  assert.strictEqual(hook.isRelevantResponseUrl("https://calendar.google.com/calendar/u/42/sync.sync", base), true);
  assert.strictEqual(hook.isRelevantResponseUrl("https://tasks-pa.clients6.google.com/$rpc/google.internal.tasks.v1.TasksApiService/Sync", base), true);
  assert.strictEqual(hook.isRelevantResponseUrl("https://tasks-pa.clients6.google.com/$rpc/google.internal.tasks.v1.TasksApiService/Delete", base), false);
  assert.strictEqual(hook.isRelevantResponseUrl("/calendar/u/-1/sync.sync", base), false);
  assert.strictEqual(hook.isRelevantResponseUrl("/calendar/u/name/sync.sync", base), false);
  assert.strictEqual(hook.isRelevantResponseUrl("https://example.com/calendar/u/1/sync.sync", base), false);
}

function testDeletedCalendarRecordEviction() {
  const base = "https://calendar.google.com/calendar/u/0/r/week";
  const deletedId = "42t6fakpiqcmvuplp7f8st5slg";
  const keptId = "pii8648j4lb3atopf87r6iass0";
  const deletionPatch = [...Array(20).fill(null), []];
  const makeDeleteOperation = (sequence, tail) => [
    sequence,
    null,
    [[null, [deletedId, null, null, [deletionPatch], 0]], "calendar@example.com"],
    null,
    null,
    tail
  ];
  const deleteOperation = makeDeleteOperation(11, 12);
  const quickViewDeleteOperation = makeDeleteOperation(4, 14);
  const editorDeleteOperation = makeDeleteOperation(6, 6);
  const body = new URLSearchParams({
    "f.req": JSON.stringify([[[], "sync-token", null, null, [deleteOperation]]])
  }).toString();
  const currentBody = new URLSearchParams({
    "f.req": JSON.stringify([[[], "sync-token", null, null, [quickViewDeleteOperation, editorDeleteOperation]]])
  }).toString();
  const updateBody = new URLSearchParams({
    "f.req": JSON.stringify([[[], "sync-token", null, null, [[
      11,
      null,
      [[null, [deletedId, null, null, [[null, "updated field"]], 0]], "calendar@example.com"]],
      null,
      null,
      12
    ]]])
  }).toString();

  assert.deepStrictEqual(
    hook.extractDeletedCalendarEventIdsFromRequest("/calendar/u/0/sync.sync", "POST", body, base),
    [deletedId]
  );
  assert.deepStrictEqual(
    hook.extractDeletedCalendarEventIdsFromRequest("/calendar/u/0/sync.sync", "POST", currentBody, base),
    [deletedId]
  );
  assert.deepStrictEqual(
    earlyDeletions.extractDeletedEventIds("/calendar/u/0/sync.sync", "POST", currentBody, base),
    [deletedId]
  );
  assert.deepStrictEqual(
    hook.extractDeletedCalendarEventIdsFromRequest("/calendar/u/0/sync.sync", "POST", updateBody, base),
    []
  );
  assert.deepStrictEqual(
    hook.extractDeletedCalendarEventIdsFromRequest("/calendar/u/0/sync.sync", "GET", body, base),
    []
  );
  assert.deepStrictEqual(
    hook.extractDeletedCalendarEventIdsFromRequest("https://example.com/calendar/u/0/sync.sync", "POST", body, base),
    []
  );

  const cache = new Map([
    [deletedId, { id: deletedId, title: "Deleted Sleep" }],
    [keptId, { id: keptId, title: "Current Sleep" }]
  ]);
  const tombstones = new Map();
  assert.strictEqual(hook.recordConfirmedCalendarDeletions(cache, tombstones, [deletedId], 7, 1000), 1);
  assert.deepStrictEqual(Array.from(cache.keys()), [keptId]);
  assert.deepStrictEqual(tombstones.get(deletedId), { requestSequence: 7, confirmedAt: 1000 });

  const staleRecord = { id: deletedId, title: "Stale Sleep", updatedAt: 900, structuredSource: "calendar-sync" };
  hook.mergeLatestRecordCache(cache, [staleRecord], 200, { tombstones, responseSequence: 6 });
  assert.strictEqual(cache.has(deletedId), false);
  hook.mergeLatestRecordCache(cache, [staleRecord], 200, { tombstones, responseSequence: 8 });
  assert.strictEqual(cache.has(deletedId), false);

  const restoredRecord = { ...staleRecord, title: "Restored Sleep", updatedAt: 1001 };
  hook.mergeLatestRecordCache(cache, [restoredRecord], 200, { tombstones, responseSequence: 8 });
  assert.strictEqual(cache.get(deletedId).title, "Restored Sleep");
  assert.strictEqual(tombstones.has(deletedId), false);
}

async function testEarlyDeletionObserverCatchesCapturedXhrMethod() {
  class FakeXHR {
    addEventListener(type, listener) {
      if (type === "loadend") this.loadendListener = listener;
    }
    open() {}
    send() {
      this.status = 200;
      this.loadendListener?.();
    }
  }
  const scope = {
    fetch: () => Promise.resolve({ ok: true }),
    XMLHttpRequest: FakeXHR,
    location: { href: "https://calendar.google.com/calendar/u/0/r/week", origin: "https://calendar.google.com" }
  };
  const observer = earlyDeletions.install(scope);
  const capturedOpen = scope.XMLHttpRequest.prototype.open;
  const capturedSend = scope.XMLHttpRequest.prototype.send;
  const messages = [];
  observer.subscribe(message => messages.push(message));

  const deletionPatch = [...Array(20).fill(null), []];
  const operation = [4, null, [[null, ["early-event-id", null, null, [deletionPatch], 0]], "calendar@example.com"], null, null, 12];
  const body = new URLSearchParams({
    "f.req": JSON.stringify([[[], "sync-token", null, null, [operation]]])
  }).toString();
  const xhr = new scope.XMLHttpRequest();
  capturedOpen.call(xhr, "POST", "/calendar/u/0/sync.sync");
  capturedSend.call(xhr, body);
  assert.deepStrictEqual(messages.map(message => message.deletedIds), [["early-event-id"]]);
  assert.strictEqual(messages[0].transport, "early-xhr");
}

function testEarlyTombstonePublishesWhileStructuredCaptureIsDisabled() {
  let earlyListener = null;
  function nativeFetch() { return Promise.resolve(makeHookResponse("https://example.com", "[]")); }
  class FakeXHR {
    addEventListener() {}
    open() {}
    send() {}
  }
  const listeners = new Map();
  const scope = {
    fetch: nativeFetch,
    XMLHttpRequest: FakeXHR,
    location: { href: "https://calendar.google.com/calendar/u/0/r/week", origin: "https://calendar.google.com" },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type)
  };
  scope[Symbol.for(earlyDeletions.OBSERVER_SYMBOL_KEY)] = {
    subscribe(listener) { earlyListener = listener; }
  };
  hook.install(scope);
  const messages = [];
  const port = {
    postMessage: message => messages.push(message),
    start() {}
  };
  listeners.get("message")({
    source: scope,
    origin: scope.location.origin,
    data: { type: "CALENDAR_CLOCK_PAGE_OWNED_INIT", channelId: "e".repeat(43) },
    ports: [port],
    stopImmediatePropagation() {}
  });
  port.onmessage({ data: { type: "configure", token: "f".repeat(43), enabled: false } });
  earlyListener({ deletedIds: ["disabled-mode-event"], transport: "early-xhr", endpoint: "/calendar/u/0/sync.sync" });
  assert.deepStrictEqual(messages.filter(message => message.deletedIds?.length).at(-1).deletedIds, ["disabled-mode-event"]);
}

function testTasksRecordReconcilesWithCalendarRecord() {
  const cache = new Map();
  const firstTask = hook.extractCalendarRecords(observedTasksFixture())[0];
  const relatedTask = hook.extractCalendarRecords(observedTasksFixture({
    relatedEventId: "fixture-task-id",
    updatedAt: Date.UTC(2026, 5, 24, 21)
  }))[0];
  hook.mergeLatestRecordCache(cache, [firstTask]);
  hook.mergeLatestRecordCache(cache, [relatedTask]);
  assert.strictEqual(cache.size, 1);
  assert.strictEqual(Array.from(cache.values()).some(record => record.id === "task:fixture-task-api-id"), false);
  assert.strictEqual(Array.from(cache.values())[0].durationKind, "point");

  const sameVersionCalendarRange = hook.extractCalendarRecords(observedCalendarFixture({
    updatedAt: relatedTask.updatedAt
  }))[0];
  hook.mergeLatestRecordCache(cache, [sameVersionCalendarRange]);
  assert.strictEqual(Array.from(cache.values()).some(record => record.durationKind === "range"), true);

  const newerTaskPoint = hook.extractCalendarRecords(observedTasksFixture({
    relatedEventId: "fixture-task-id",
    updatedAt: relatedTask.updatedAt + 1000
  }))[0];
  hook.mergeLatestRecordCache(cache, [newerTaskPoint]);
  assert.strictEqual(Array.from(cache.values()).some(record => record.durationKind === "point"), true);
}

function testMovedRecordReplacesSameIdAnchor() {
  const cache = new Map();
  const first = hook.extractCalendarRecords(observedCalendarFixture({ startHour: 21, endHour: 22 }));
  const moved = hook.extractCalendarRecords(observedCalendarFixture({ startHour: 23, endHour: 24 }));
  hook.mergeLatestRecordCache(cache, first);
  hook.mergeLatestRecordCache(cache, moved);
  assert.strictEqual(cache.size, 1);
  assert.strictEqual(Array.from(cache.values())[0].start, "16:00");
}

function testMovedRecordReplacesOlderOccurrenceAnchor() {
  const original = hook.extractCalendarRecords(observedCalendarFixture({
    startHour: 21,
    endHour: 22,
    updatedAt: Date.UTC(2026, 5, 23, 20)
  }))[0];
  const moved = hook.extractCalendarRecords(observedCalendarFixture({
    startHour: 23,
    endHour: 24,
    updatedAt: Date.UTC(2026, 5, 23, 21)
  }))[0];

  const chronologicalCache = new Map();
  hook.mergeLatestRecordCache(chronologicalCache, [original], 200, { responseSequence: 1 });
  hook.mergeLatestRecordCache(chronologicalCache, [moved], 200, { responseSequence: 2 });
  assert.strictEqual(chronologicalCache.size, 1);
  assert.strictEqual(Array.from(chronologicalCache.values())[0].start, "16:00");

  const outOfOrderCache = new Map();
  hook.mergeLatestRecordCache(outOfOrderCache, [moved], 200, { responseSequence: 2 });
  hook.mergeLatestRecordCache(outOfOrderCache, [original], 200, { responseSequence: 1 });
  assert.strictEqual(outOfOrderCache.size, 1);
  assert.strictEqual(Array.from(outOfOrderCache.values())[0].start, "16:00");
}

function testNewestStructuredVersionWins() {
  const cache = new Map();
  const oldRange = hook.extractCalendarRecords(observedCalendarFixture({
    endHour: 22,
    updatedAt: Date.UTC(2026, 5, 23, 20)
  }))[0];
  const newPoint = hook.extractCalendarRecords(observedCalendarFixture({
    endHour: 21,
    updatedAt: Date.UTC(2026, 5, 23, 21)
  }))[0];

  hook.mergeLatestRecordCache(cache, [oldRange]);
  hook.mergeLatestRecordCache(cache, [newPoint]);
  hook.mergeLatestRecordCache(cache, [oldRange]);
  assert.strictEqual(cache.size, 1);
  assert.strictEqual(Array.from(cache.values())[0].durationKind, "point");
  assert.strictEqual(Array.from(cache.values())[0].title, "Fixture task");

  const newestRange = hook.extractCalendarRecords(observedCalendarFixture({
    endHour: 23,
    updatedAt: Date.UTC(2026, 5, 23, 22)
  }))[0];
  hook.mergeLatestRecordCache(cache, [newestRange]);
  assert.strictEqual(Array.from(cache.values())[0].durationKind, "range");
  assert.strictEqual(Array.from(cache.values())[0].end, "16:00");
}

async function testTransportNonInterference() {
  let fetchThis = null;
  let fetchPromise = null;
  function nativeFetch() {
    fetchThis = this;
    fetchPromise = Promise.resolve({ url: "https://example.com", headers: { get: () => null } });
    return fetchPromise;
  }
  class FakeXHR {
    addEventListener(type, listener) { this.listener = { type, listener }; }
    open() { this.openThis = this; return "open-result"; }
    send() { this.sendThis = this; return "send-result"; }
  }
  FakeXHR.DONE = 4;
  const listeners = new Map();
  const scope = {
    fetch: nativeFetch,
    XMLHttpRequest: FakeXHR,
    location: { href: "https://calendar.google.com/calendar/u/0/r/week", origin: "https://calendar.google.com" },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type)
  };
  hook.install(scope);
  const receiver = {};
  const result = scope.fetch.call(receiver, "https://example.com");
  assert.strictEqual(result, fetchPromise);
  assert.strictEqual(fetchThis, receiver);
  assert.strictEqual(Object.getPrototypeOf(scope.fetch), Object.getPrototypeOf(nativeFetch));
  assert.strictEqual(scope.XMLHttpRequest, FakeXHR);
  assert.strictEqual(scope.XMLHttpRequest.DONE, 4);
  const xhr = new scope.XMLHttpRequest();
  assert.strictEqual(xhr.open("GET", "/test"), "open-result");
  assert.strictEqual(xhr.openThis, xhr);
  assert.strictEqual(xhr.send(), "send-result");
  assert.strictEqual(xhr.sendThis, xhr);
  await result;
}

function makeHookResponse(url, text, ok = true) {
  return {
    url,
    ok,
    headers: { get: () => null },
    clone: () => ({ text: () => Promise.resolve(text) })
  };
}

function enableInstalledPageOwnedHook(scope, listeners) {
  const messages = [];
  const port = {
    postMessage: message => messages.push(message),
    start() {}
  };
  listeners.get("message")({
    source: scope,
    origin: scope.location.origin,
    data: { type: "CALENDAR_CLOCK_PAGE_OWNED_INIT", channelId: "c".repeat(43) },
    ports: [port],
    stopImmediatePropagation() {}
  });
  port.onmessage({
    data: { type: "configure", token: "d".repeat(43), enabled: true }
  });
  return messages;
}

async function flushHookPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function testFetchDeletionRequiresSuccessfulResponse() {
  let nextResponse = makeHookResponse("https://example.com", "[]");
  function nativeFetch() { return Promise.resolve(nextResponse); }
  class FakeXHR {
    addEventListener() {}
    open() {}
    send() {}
  }
  const listeners = new Map();
  const scope = {
    fetch: nativeFetch,
    XMLHttpRequest: FakeXHR,
    location: { href: "https://calendar.google.com/calendar/u/0/r/week", origin: "https://calendar.google.com" },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type)
  };
  hook.install(scope);
  const messages = enableInstalledPageOwnedHook(scope, listeners);
  const latestRecords = () => messages.filter(message => message.type === "records").at(-1)?.records || [];

  let unrelatedBodyReads = 0;
  const unrelatedBody = { toString() { unrelatedBodyReads += 1; return "private=body"; } };
  await scope.fetch("https://example.com/unrelated", { method: "POST", body: unrelatedBody });
  await flushHookPromises();
  assert.strictEqual(unrelatedBodyReads, 0);

  nextResponse = makeHookResponse(
    "https://calendar.google.com/calendar/u/0/sync.prefetcheventrange",
    JSON.stringify(observedCalendarFixture())
  );
  await scope.fetch("/calendar/u/0/sync.prefetcheventrange");
  await flushHookPromises();
  assert.deepStrictEqual(latestRecords().map(record => record.id), ["fixture-task-id"]);

  const deleteOperation = [11, null, [[null, ["fixture-task-id", null, null, [[null]], 0]], "calendar@example.com"], null, null, 12];
  const deleteBody = new URLSearchParams({
    "f.req": JSON.stringify([[[], "sync-token", null, null, [deleteOperation]]])
  }).toString();

  nextResponse = makeHookResponse("https://calendar.google.com/calendar/u/0/sync.sync", "[]", false);
  await scope.fetch("/calendar/u/0/sync.sync", { method: "POST", body: deleteBody });
  await flushHookPromises();
  assert.deepStrictEqual(latestRecords().map(record => record.id), ["fixture-task-id"]);

  nextResponse = makeHookResponse("https://calendar.google.com/calendar/u/0/sync.sync", "[]", true);
  await scope.fetch("/calendar/u/0/sync.sync", { method: "POST", body: deleteBody });
  await flushHookPromises();
  assert.deepStrictEqual(latestRecords(), []);
  assert.deepStrictEqual(messages.filter(message => message.deletedIds?.length).at(-1).deletedIds, ["fixture-task-id"]);
}

async function testXhrDeletionRequiresSuccessfulResponse() {
  let nextFetchResponse = makeHookResponse(
    "https://calendar.google.com/calendar/u/0/sync.prefetcheventrange",
    JSON.stringify(observedCalendarFixture())
  );
  function nativeFetch() { return Promise.resolve(nextFetchResponse); }
  class FakeXHR {
    static nextStatus = 0;
    addEventListener(type, listener) {
      if (type === "loadend") this.loadendListener = listener;
    }
    open(_method, url) { this.requestUrl = url; }
    send() {
      this.status = FakeXHR.nextStatus;
      this.responseURL = "https://calendar.google.com/calendar/u/0/sync.sync";
      this.responseType = "";
      this.responseText = "[]";
      this.loadendListener?.();
    }
  }
  const listeners = new Map();
  const scope = {
    fetch: nativeFetch,
    XMLHttpRequest: FakeXHR,
    location: { href: "https://calendar.google.com/calendar/u/0/r/week", origin: "https://calendar.google.com" },
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type)
  };
  hook.install(scope);
  const messages = enableInstalledPageOwnedHook(scope, listeners);
  const latestRecords = () => messages.filter(message => message.type === "records").at(-1)?.records || [];

  await scope.fetch("/calendar/u/0/sync.prefetcheventrange");
  await flushHookPromises();
  assert.deepStrictEqual(latestRecords().map(record => record.id), ["fixture-task-id"]);

  const deleteOperation = [4, null, [[null, ["fixture-task-id", null, null, [[null]], 0]], "calendar@example.com"], null, null, 14];
  const deleteBody = new URLSearchParams({
    "f.req": JSON.stringify([[[], "sync-token", null, null, [deleteOperation]]])
  }).toString();

  const failedXhr = new scope.XMLHttpRequest();
  failedXhr.open("POST", "/calendar/u/0/sync.sync");
  failedXhr.send(deleteBody);
  assert.deepStrictEqual(latestRecords().map(record => record.id), ["fixture-task-id"]);

  FakeXHR.nextStatus = 200;
  const successfulXhr = new scope.XMLHttpRequest();
  successfulXhr.open("POST", "/calendar/u/0/sync.sync");
  successfulXhr.send(deleteBody);
  assert.deepStrictEqual(latestRecords(), []);
  assert.deepStrictEqual(messages.filter(message => message.deletedIds?.length).at(-1).deletedIds, ["fixture-task-id"]);
}

function makeVmContext() {
  const context = vm.createContext({
    console,
    navigator: { language: "en-US", languages: ["en-US"] },
    window: {},
    document: { querySelectorAll: () => [] },
    chrome: {},
    atob: value => Buffer.from(value, "base64").toString("binary"),
    getComputedStyle: () => ({}),
    onCalendarClockContextInvalidated: () => {},
    clearTimeout,
    setTimeout,
    Intl,
    Date,
    Map,
    Set,
    WeakMap,
    WeakSet
  });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/content/calendar-content-state.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/content/time-window-controller.js"), "utf8"), context);
  return context;
}

function testToggleDefaultAndPersistence() {
  const context = makeVmContext();
  assert.strictEqual(vm.runInContext("CALENDAR_CLOCK_PANEL_DEFAULT.pageOwnedInfo", context), true);
  assert.strictEqual(vm.runInContext("getKnownCalendarClockState({ pageOwnedInfo: true }).pageOwnedInfo", context), true);
  assert.strictEqual(vm.runInContext("getKnownCalendarClockState({}).pageOwnedInfo", context), true);
  assert.strictEqual(vm.runInContext("CALENDAR_CLOCK_PANEL_DEFAULT.captureLimit", context), 50);
  assert.strictEqual(vm.runInContext("normalizeCalendarClockCaptureLimit(100)", context), 100);
  assert.strictEqual(vm.runInContext("normalizeCalendarClockCaptureLimit(75)", context), 50);
  vm.runInContext("function normalizeMiniClockPosition() {}", context);
  assert.strictEqual(vm.runInContext("(() => { applyLoadedCalendarClockState({ captureLimit: 200 }); return calendarClockState.captureLimit; })()", context), 200);
}

function testOptionalModuleIsolation() {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
  const requiredContentScripts = manifest.content_scripts.flatMap(entry => entry.js || []);
  assert.strictEqual(requiredContentScripts.some(file => file.startsWith("src/content/page-owned-info/")), false);
  const earlyMainWorldScript = manifest.content_scripts.find(entry => entry.js?.includes("src/content/main-world-early-deletions.js"));
  assert.strictEqual(earlyMainWorldScript?.world, "MAIN");
  assert.strictEqual(earlyMainWorldScript?.run_at, "document_start");
  const exposedResources = manifest.web_accessible_resources.flatMap(entry => entry.resources || []);
  assert.strictEqual(exposedResources.includes("src/content/page-owned-info/*.js"), true);
  const tasksSource = fs.readFileSync(path.join(repoRoot, "src/content/tasks/tasks-content-entry.js"), "utf8");
  assert.match(tasksSource, /calendarClockPageOwnedInfo\?\.subscribe/);
  assert.match(tasksSource, /taskClockPageOwnedWasEnabled\s*&&\s*!isEnabled\)\s*queueTaskPublish/);
  assert.match(tasksSource, /TASK_CLOCK_CAPTURE_LIMIT_OPTIONS\s*=\s*\[50, 100, 200\]/);
  const loaderSource = fs.readFileSync(path.join(repoRoot, "src/content/optional-module-loader.js"), "utf8");
  const backgroundSource = fs.readFileSync(path.join(repoRoot, "src/background/background.js"), "utf8");
  assert.match(loaderSource, /let enabled = true/);
  assert.match(backgroundSource, /function shouldSuppressCalendarClockDomTaskFeed/);
}

function testSourceSelection() {
  const context = makeVmContext();
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/content/calendar-dom-reader.js"), "utf8"), context);
  context.pageRecord = {
    id: "structured", domKey: "structured", title: "Structured", start: "14:00", end: "15:00",
    startDate: "2026-06-23T21:00:00.000Z", endDate: "2026-06-23T22:00:00.000Z", date: "2026-06-23", durationKind: "range"
  };
  assert.strictEqual(vm.runInContext("chooseCalendarClockEventSource({requested:true,records:[pageRecord]},()=>{throw new Error('DOM should not run')}).source", context), "google-page-owned");
  assert.strictEqual(vm.runInContext("chooseCalendarClockEventSource({requested:false,records:[]},()=>[{id:'dom'}]).events[0].id", context), "dom");
  assert.notStrictEqual(
    vm.runInContext("getCalendarClockDomEventDedupeKey('event-a','2026-06-23|14:00|15:00|Same title')", context),
    vm.runInContext("getCalendarClockDomEventDedupeKey('event-b','2026-06-23|14:00|15:00|Same title')", context)
  );
  assert.strictEqual(
    vm.runInContext("getCalendarClockDomEventDedupeKey('', '2026-06-23|14:00|15:00|Same title')", context),
    vm.runInContext("getCalendarClockDomEventDedupeKey(null, '2026-06-23|14:00|15:00|Same title')", context)
  );
  assert.strictEqual(vm.runInContext("makeCalendarClockCaptureViewAuthoritative({mode:'day',visibleDateKeys:['2026-06-23'],dateKeySource:'dated-url',canClearMissingDates:false},'google-page-owned').canClearMissingDates", context), true);
  assert.strictEqual(vm.runInContext("makeCalendarClockCaptureViewAuthoritative({mode:'day',visibleDateKeys:['2026-06-23'],dateKeySource:'title',canClearMissingDates:true},'google-page-owned').canClearMissingDates", context), false);
  assert.strictEqual(vm.runInContext("makeCalendarClockCaptureViewAuthoritative({mode:'day',visibleDateKeys:['2026-06-23'],canClearMissingDates:true},'google-page-owned').canClearMissingDates", context), false);
  assert.strictEqual(vm.runInContext("makeCalendarClockCaptureViewAuthoritative({mode:'day',visibleDateKeys:['2026-06-23'],dateKeySource:'dated-url',canClearMissingDates:false},'google-calendar-dom').canClearMissingDates", context), false);
}

function testPageOwnedColorUsesMatchingDomChip() {
  const context = makeVmContext();
  const structuredId = "58idu4vi8cg2npo3s3cuc2e4ot";
  const encodedDomId = Buffer.from(`${structuredId} calendar@example.com`).toString("base64").replace(/=+$/, "");
  const node = {
    getAttribute(name) {
      if (name === "data-eventid") return encodedDomId;
      if (name === "aria-label") return "10:30 to 11:30, Structured";
      return null;
    },
    textContent: "Structured"
  };
  context.document.querySelectorAll = () => [node];
  context.getComputedStyle = () => ({
    borderLeftColor: "rgb(75, 153, 210)",
    borderColor: "rgb(75, 153, 210)",
    backgroundColor: "rgb(75, 153, 210)",
    color: "rgb(227, 227, 227)"
  });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/content/calendar-dom-reader.js"), "utf8"), context);
  context.boundNode = null;
  context.boundEventId = "";
  context.bindCalendarEventHover = (boundNode, eventId) => {
    context.boundNode = boundNode;
    context.boundEventId = eventId;
  };
  context.pageRecord = {
    id: structuredId,
    domKey: `page-owned:${structuredId}:1`,
    title: "Structured",
    start: "10:30",
    end: "11:30",
    startDate: "2026-07-12T07:30:00.000Z",
    endDate: "2026-07-12T08:30:00.000Z",
    date: "2026-07-12",
    durationKind: "range",
    color: ""
  };
  assert.deepStrictEqual(
    Array.from(vm.runInContext(`getCalendarClockDomEventIdAliases(${JSON.stringify(encodedDomId)})`, context)),
    [encodedDomId, structuredId, `task:${structuredId}`]
  );
  assert.strictEqual(vm.runInContext("preparePageOwnedCalendarEvents([pageRecord])[0].color", context), "rgb(75, 153, 210)");
  assert.strictEqual(vm.runInContext("calendarClockPendingEventNodes.get(pageRecord.id) === boundNode", context), true);
  assert.strictEqual(context.boundNode, node);
  assert.strictEqual(context.boundEventId, structuredId);
  assert.strictEqual(vm.runInContext("cleanTitle('10:30 to 11:30', { start: '10:30', end: '11:30' })", context), "(No title)");
  assert.strictEqual(vm.runInContext("preparePageOwnedCalendarEvents([{...pageRecord,title:''}])[0].title", context), "(No title)");

  const stateSource = fs.readFileSync(path.join(repoRoot, "src/content/calendar-content-state.js"), "utf8");
  const overlaySource = fs.readFileSync(path.join(repoRoot, "src/content/overlay/overlay-menu.js"), "utf8");
  assert.match(stateSource, /calendarClockBoundNodeEventIds\s*=\s*new WeakMap/);
  assert.match(overlaySource, /calendarClockBoundNodeEventIds\.get\(node\)/);
}

function testReboundDomNodeUsesLatestEventId() {
  const context = makeVmContext();
  const listeners = {};
  context.node = {
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  context.sentMessages = [];
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/content/overlay/overlay-menu.js"), "utf8"), context);
  vm.runInContext("sendToClockFrame = message => sentMessages.push(message)", context);
  vm.runInContext("bindCalendarEventHover(node, 'old-id'); bindCalendarEventHover(node, 'structured-id')", context);
  listeners.pointerenter();
  listeners.pointerleave();
  assert.deepStrictEqual(JSON.parse(vm.runInContext("JSON.stringify(sentMessages)", context)), [
    { type: "CALENDAR_CLOCK_EVENT_HOVER", eventId: "structured-id" },
    { type: "CALENDAR_CLOCK_EVENT_LEAVE", eventId: "structured-id" }
  ]);
}

function testPointToRangeRegression() {
  const listeners = { addListener: () => {} };
  const context = vm.createContext({
    chrome: {
      action: { setBadgeText: () => {}, onClicked: listeners },
      runtime: { onInstalled: listeners, onStartup: listeners, onMessage: listeners },
      storage: { local: { get: () => {}, set: () => {} } },
      tabs: { sendMessage: () => {} }
    },
    console,
    Date,
    Map,
    Set
  });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/background/background.js"), "utf8"), context);
  context.point = { id: "task", capturedFrom: "google-page-owned", date: "2026-06-23", start: "14:00", end: "14:00", durationKind: "point" };
  context.range = { ...context.point, end: "15:00", endDate: "2026-06-23T22:00:00.000Z", durationKind: "range" };
  assert.strictEqual(vm.runInContext("mergeCalendarClockEvents([range],[point]).length", context), 1);
  assert.strictEqual(vm.runInContext("mergeCalendarClockEvents([range],[point])[0].end", context), "15:00");
  assert.strictEqual(vm.runInContext("normalizeCalendarClockCaptureLimit(200)", context), 200);
  assert.strictEqual(vm.runInContext("normalizeCalendarClockCaptureLimit(75)", context), 50);
  assert.strictEqual(vm.runInContext("limitCalendarClockEffectiveEvents([{ date: '2026-06-23', start: '08:00' }, { date: '2026-06-23', start: '09:00' }], 100).length", context), 2);
  context.storeEvents = Array.from({ length: 205 }, (_value, index) => ({
    id: `event-${index}`,
    date: "2026-06-23",
    start: "08:00",
    end: "09:00"
  }));
  assert.strictEqual(vm.runInContext("normalizeCalendarClockEventStore({ dates: { '2026-06-23': { capturedAt: 1, events: storeEvents } } }).dates['2026-06-23'].events.length", context), 200);
  context.retentionStore = {
    dates: {
      "2026-06-20": { capturedAt: 1, events: [] },
      "2026-06-21": { capturedAt: 2, events: [] },
      "2026-06-22": { capturedAt: 3, events: [] }
    }
  };
  const trimmedStore = vm.runInContext("limitCalendarClockEventStoreDates(retentionStore, 2)", context);
  assert.deepStrictEqual(Object.keys(trimmedStore.dates), ["2026-06-22", "2026-06-21"]);
  assert.deepStrictEqual(Array.from(vm.runInContext("getCalendarClockStorageRetryDateLimits(retentionStore)", context)), [1, 0]);
  const storageStatus = JSON.parse(vm.runInContext("JSON.stringify(makeCalendarClockStorageStatus(retentionStore, limitCalendarClockEventStoreDates(retentionStore, 1)))", context));
  assert.deepStrictEqual(storageStatus, {
    kind: "history-trimmed",
    retainedDateCount: 1,
    removedDateCount: 2
  });
  assert.strictEqual(vm.runInContext("shouldResetCalendarClockEventStore('page-owned','page-owned','google-calendar-dom','google-page-owned',true)", context), true);
  assert.strictEqual(vm.runInContext("shouldResetCalendarClockEventStore('page-owned','page-owned','google-page-owned','google-page-owned',true)", context), false);

  context.domFallback = { id: "dom", capturedFrom: "google-calendar-dom", date: "2026-06-23", start: "14:00", end: "14:00", durationKind: "point" };
  context.structured = { id: "structured", capturedFrom: "google-page-owned", date: "2026-06-23", start: "14:00", end: "15:00", durationKind: "range" };
  const storedSources = vm.runInContext(`(() => {
    const view = { visibleDateKeys: ['2026-06-23'], canClearMissingDates: true };
    const fallbackStore = updateCalendarClockEventStore(null, [domFallback], view, 1, 'calendar');
    const reset = shouldResetCalendarClockEventStore('page-owned', 'page-owned', 'google-calendar-dom', 'google-page-owned', true);
    const structuredStore = updateCalendarClockEventStore(reset ? null : fallbackStore, [structured], view, 2, 'calendar');
    return structuredStore.dates['2026-06-23'].events.map(event => event.capturedFrom);
  })()`, context);
  assert.deepStrictEqual(Array.from(storedSources), ["google-page-owned"]);

  context.movedDateEvent = { id: "moved", capturedFrom: "google-page-owned", date: "2026-06-24", start: "16:00", end: "17:00", durationKind: "range" };
  const movedStoreResult = vm.runInContext(`(() => {
    const authoritativeView = { visibleDateKeys: ['2026-06-23', '2026-06-24'], canClearMissingDates: true };
    const oldEvent = { id: 'moved', capturedFrom: 'google-page-owned', date: '2026-06-23', start: '14:00', end: '15:00', durationKind: 'range' };
    const oldStore = updateCalendarClockEventStore(null, [oldEvent], authoritativeView, 1, 'calendar');
    const movedStore = updateCalendarClockEventStore(oldStore, [movedDateEvent], authoritativeView, 2, 'calendar');
    return {
      oldDateCount: movedStore.dates['2026-06-23'].events.length,
      newDateIds: movedStore.dates['2026-06-24'].events.map(event => event.id)
    };
  })()`, context);
  assert.strictEqual(movedStoreResult.oldDateCount, 0);
  assert.deepStrictEqual(Array.from(movedStoreResult.newDateIds), ["moved"]);

  const staleEffectiveCount = vm.runInContext(`(() => {
    const view = { visibleDateKeys: ['2026-06-22'], canClearMissingDates: true };
    const stale = { id: 'stale', capturedFrom: 'google-page-owned', date: '2026-06-22', start: '10:00', end: '11:00', durationKind: 'range' };
    const staleStore = updateCalendarClockEventStore(null, [stale], view, 1, 'calendar');
    const clearedStore = updateCalendarClockEventStore(staleStore, [], view, 2, 'calendar');
    return getCalendarClockEffectiveEventsForSource('google-page-owned', [], clearedStore, ['2026-06-22']).length;
  })()`, context);
  assert.strictEqual(staleEffectiveCount, 0);

  const crossWeekResult = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const sundayView = {
      visibleDateKeys: ['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'],
      canClearMissingDates: true
    };
    const mondayView = {
      visibleDateKeys: ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'],
      canClearMissingDates: true
    };
    const sunday = {
      id: 'sunday', capturedFrom: 'google-page-owned', date: '2026-07-19',
      start: '23:00', end: '00:00', startDate: '2026-07-19T23:00:00.000Z', endDate: '2026-07-20T00:00:00.000Z', durationKind: 'range'
    };
    const deletedMonday = {
      id: 'deleted-monday', capturedFrom: 'google-page-owned', date: '2026-07-20',
      start: '00:00', end: '00:15', startDate: '2026-07-20T00:00:00.000Z', endDate: '2026-07-20T00:15:00.000Z', durationKind: 'range'
    };
    const monday = {
      id: 'monday', capturedFrom: 'google-page-owned', date: '2026-07-20',
      start: '00:30', end: '07:45', startDate: '2026-07-20T00:30:00.000Z', endDate: '2026-07-20T07:45:00.000Z', durationKind: 'range'
    };
    const oldStore = updateCalendarClockEventStore(null, [sunday, deletedMonday], sundayView, 1, 'calendar');
    const nextWeekStore = updateCalendarClockEventStore(oldStore, [monday], mondayView, 2, 'calendar');
    const effectiveBeforeDeletion = getCalendarClockEffectiveEventsForSource(
      'google-page-owned',
      [monday],
      nextWeekStore,
      ['2026-07-19', '2026-07-20'],
      '2026-07-19T22:00:00.000Z',
      '2026-07-20T09:00:00.000Z'
    ).map(event => event.id);
    const storeAfterDeletion = evictCalendarClockDeletedEventsFromStore(nextWeekStore, ['sunday']);
    const effectiveAfterDeletion = getCalendarClockEffectiveEventsForSource(
      'google-page-owned',
      [monday],
      storeAfterDeletion,
      ['2026-07-19', '2026-07-20'],
      '2026-07-19T22:00:00.000Z',
      '2026-07-20T09:00:00.000Z'
    ).map(event => event.id);
    return { effectiveBeforeDeletion, effectiveAfterDeletion };
  })())`, context));
  assert.deepStrictEqual(crossWeekResult, {
    effectiveBeforeDeletion: ['sunday', 'monday'],
    effectiveAfterDeletion: ['monday']
  });
}

function testStorageQuotaRetry() {
  const listeners = { addListener: () => {} };
  const writes = [];
  const chromeApi = {
    action: { setBadgeText: () => {}, onClicked: listeners },
    runtime: { onInstalled: listeners, onStartup: listeners, onMessage: listeners, lastError: null },
    storage: {
      local: {
        get: () => {},
        set: (data, callback) => {
          writes.push(data);
          chromeApi.runtime.lastError = writes.length === 1 ? { message: "QUOTA_BYTES quota exceeded" } : null;
          callback();
          chromeApi.runtime.lastError = null;
        }
      }
    },
    tabs: { sendMessage: () => {} }
  };
  const context = vm.createContext({ chrome: chromeApi, console, Date, Map, Set });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "src/background/background.js"), "utf8"), context);
  context.retryStore = {
    dates: {
      "2026-06-20": { capturedAt: 1, events: [] },
      "2026-06-21": { capturedAt: 2, events: [] },
      "2026-06-22": { capturedAt: 3, events: [] }
    }
  };
  vm.runInContext(`writeCalendarClockFeedToStorage(
    { snapshot: true },
    retryStore,
    status => { retrySuccess = status; },
    status => { retryFailure = status; }
  )`, context);
  assert.strictEqual(writes.length, 2);
  assert.deepStrictEqual(Object.keys(writes[1].calendarClockCalendarEventStore.dates), ["2026-06-22"]);
  assert.deepStrictEqual(JSON.parse(vm.runInContext("JSON.stringify(retrySuccess)", context)), {
    kind: "history-trimmed",
    retainedDateCount: 1,
    removedDateCount: 2
  });
  assert.strictEqual(vm.runInContext("typeof retryFailure", context), "undefined");
}

(async () => {
  testExtractorFixture();
  testMissingEndBecomesPoint();
  testTasksSyncPointExtractor();
  testBridgeTrustAndSchema();
  testEndpointMatching();
  testDeletedCalendarRecordEviction();
  await testEarlyDeletionObserverCatchesCapturedXhrMethod();
  testEarlyTombstonePublishesWhileStructuredCaptureIsDisabled();
  testMovedRecordReplacesSameIdAnchor();
  testMovedRecordReplacesOlderOccurrenceAnchor();
  testNewestStructuredVersionWins();
  testTasksRecordReconcilesWithCalendarRecord();
  await testTransportNonInterference();
  await testFetchDeletionRequiresSuccessfulResponse();
  await testXhrDeletionRequiresSuccessfulResponse();
  testToggleDefaultAndPersistence();
  testOptionalModuleIsolation();
  testSourceSelection();
  testPageOwnedColorUsesMatchingDomChip();
  testReboundDomNodeUsesLatestEventId();
  console.log("Page-owned info verification passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
