const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");

function makeElement() {
  return {
    addEventListener() {},
    replaceChildren() {},
    style: { setProperty() {} }
  };
}

function loadPopupSort() {
  const elements = new Map();
  const context = vm.createContext({
    Date,
    Intl,
    Number,
    String,
    Array,
    Set,
    console,
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
      },
      createElement: makeElement
    },
    window: { close() {} }
  });
  const source = fs.readFileSync(path.join(repoRoot, "src/action-popup/action-popup.js"), "utf8");
  vm.runInContext(`${source}\nglobalThis.popupSortTestApi = { getSortedSnapshotItems, isSnapshotTask, getSnapshotTypeCounts };`, context);
  return context.popupSortTestApi;
}

function titles(items) {
  return items.map(item => item.title);
}

function canonical(item) {
  if (!item.date || !item.startDate || !item.endDate) return item;
  const kind = item.durationKind === "point" ? "point" : "timed";
  return {
    ...item,
    temporal: {
      kind,
      firstDateKey: item.date,
      lastDateKey: item.date,
      occurrenceKey: item.id,
      startInstant: item.startDate,
      endInstant: item.endDate
    }
  };
}

function testDatedItemsCrossMidnight() {
  const { getSortedSnapshotItems } = loadPopupSort();
  const ordered = getSortedSnapshotItems([
    {
      id: "tomorrow",
      title: "Tomorrow early",
      date: "2026-07-11",
      start: "00:30",
      end: "01:00",
      startDate: "2026-07-10T21:30:00.000Z",
      endDate: "2026-07-10T22:00:00.000Z"
    },
    {
      id: "today",
      title: "Late today",
      date: "2026-07-10",
      start: "23:00",
      end: "23:30",
      startDate: "2026-07-10T20:00:00.000Z",
      endDate: "2026-07-10T20:30:00.000Z"
    }
  ].map(canonical));

  assert.deepStrictEqual(titles(ordered), ["Late today", "Tomorrow early"]);
}

function testSameDayDatedTaskAndEventMix() {
  const { getSortedSnapshotItems } = loadPopupSort();
  const ordered = getSortedSnapshotItems([
    {
      id: "event-late",
      title: "Calendar event",
      date: "2026-07-10",
      start: "15:00",
      end: "16:00",
      startDate: "2026-07-10T12:00:00.000Z",
      endDate: "2026-07-10T13:00:00.000Z"
    },
    {
      id: "task",
      title: "Structured task",
      date: "2026-07-10",
      start: "10:30",
      end: "10:30",
      startDate: "2026-07-10T07:30:00.000Z",
      endDate: "2026-07-10T07:30:00.000Z",
      itemKind: "task"
    },
    {
      id: "event-early",
      title: "Early event",
      date: "2026-07-10",
      start: "09:00",
      end: "09:30",
      startDate: "2026-07-10T06:00:00.000Z",
      endDate: "2026-07-10T06:30:00.000Z"
    }
  ].map(canonical));

  assert.deepStrictEqual(titles(ordered), ["Early event", "Structured task", "Calendar event"]);
}

function testUndatedTasksUseStableClockTimeFallback() {
  const { getSortedSnapshotItems } = loadPopupSort();
  const ordered = getSortedSnapshotItems([
    { id: "task-late", title: "Later undated task", start: "14:00", end: "14:30", capturedFrom: "google-tasks-dom" },
    { id: "task-same-b", title: "Same time B", start: "10:00", end: "10:30", capturedFrom: "google-tasks-dom" },
    { id: "task-same-a", title: "Same time A", start: "10:00", end: "10:30", capturedFrom: "google-tasks-dom" },
    { id: "task-early", title: "Earlier undated task", start: "09:00", end: "09:15", capturedFrom: "google-tasks-dom" },
    {
      id: "dated",
      title: "Dated event",
      date: "2026-07-10",
      start: "16:00",
      end: "16:30",
      startDate: "2026-07-10T13:00:00.000Z",
      endDate: "2026-07-10T13:30:00.000Z"
    }
  ].map(canonical));

  assert.deepStrictEqual(titles(ordered), [
    "Dated event",
    "Earlier undated task",
    "Same time A",
    "Same time B",
    "Later undated task"
  ]);
}

function testSnapshotTypeCountsUseItemMetadata() {
  const { isSnapshotTask, getSnapshotTypeCounts } = loadPopupSort();
  const items = [
    { id: "structured-task", itemKind: "task" },
    { id: "source-task", sourceKind: "calendar-task" },
    { id: "dom-task", capturedFrom: "google-tasks-dom" },
    { id: "calendar-event", itemKind: "event", sourceKind: "calendar-event" }
  ];

  assert.strictEqual(isSnapshotTask(items[0]), true);
  assert.strictEqual(isSnapshotTask(items[1]), true);
  assert.strictEqual(isSnapshotTask(items[2]), true);
  assert.strictEqual(isSnapshotTask(items[3]), false);
  assert.deepStrictEqual({ ...getSnapshotTypeCounts(items) }, { calendarCount: 1, taskCount: 3 });
}

testDatedItemsCrossMidnight();
testSameDayDatedTaskAndEventMix();
testUndatedTasksUseStableClockTimeFallback();
testSnapshotTypeCountsUseItemMetadata();
console.log("Popup snapshot sort verifier passed.");
