import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createOutlookCalendarClockProvider } from "../src/content/providers/outlook/outlook-provider.mjs";
import { createOutlookPresenceSuppressionPolicy } from "../src/content/providers/outlook/presence-suppression/presence-policy.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryContext = vm.createContext({ URL });
vm.runInContext(
  fs.readFileSync(path.join(repoRoot, "src/providers/provider-registry.js"), "utf8"),
  registryContext
);
const outlookDefinition = registryContext.CalendarClockProviders.get("outlook");
assert.equal(registryContext.CalendarClockProviders.fromUrl(outlookDefinition.openUrl).id, "outlook");
assert.deepEqual(
  Array.from(outlookDefinition.mainWorldDependencyPaths),
  ["src/content/providers/outlook/appearance/outlook-appearance-contract.js"]
);
assert.deepEqual(
  Array.from(outlookDefinition.structuredResponsePaths),
  ["/owa/startupdata.ashx", "/owa/service.svc", "/owa/published/service.svc"]
);
const outlookAppearance = globalThis.CalendarClockOutlookAppearance;
assert.ok(outlookAppearance);
assert.equal(outlookAppearance.categoryPresetToColor("preset8"), "#6656d1");
// Live Outlook Web master categories: Red category Color 0, Purple category Color 8.
assert.equal(outlookAppearance.categoryPresetToColor(0), "#c50f1f");
assert.equal(outlookAppearance.categoryPresetToColor(8), "#6656d1");
assert.equal(outlookAppearance.normalizeFreeBusyStatus("Out of office"), "oof");
assert.deepEqual(
  outlookAppearance.resolveStructuredAppearance({ FreeBusyType: "OOF" }),
  {
    categories: [],
    status: "oof",
    categoryColor: "",
    statusColor: "#b4009e",
    color: "#b4009e"
  }
);
assert.deepEqual(
  outlookAppearance.normalizeCategories(["Purple category", " purple category ", "", "Blue category"]),
  ["Purple category", "Blue category"]
);
assert.equal(
  outlookAppearance.extractCategoryCatalog({
    masterCategories: Array.from({ length: 205 }, (_, index) => ({
      displayName: `Category ${index}`,
      color: `preset${index % 25}`
    }))
  }).size,
  200
);

function makeAppearanceStyle(overrides = {}) {
  return {
    backgroundColor: "rgba(0, 0, 0, 0)",
    borderColor: "rgba(0, 0, 0, 0)",
    borderLeftColor: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
    getPropertyValue: () => "",
    ...overrides
  };
}

function makeAppearanceEvent(document, {
  buttonColor,
  underlayColor,
  underlayImage = "none",
  statusColor = ""
}) {
  const button = {
    ownerDocument: document,
    _style: makeAppearanceStyle({ backgroundColor: buttonColor }),
    matches: selector => selector === "[role='button'][aria-label]"
  };
  const underlay = {
    ownerDocument: document,
    _style: makeAppearanceStyle({
      backgroundColor: underlayColor,
      borderColor: underlayColor,
      borderLeftColor: underlayColor,
      backgroundImage: underlayImage
    }),
    contains: () => false
  };
  const node = {
    ownerDocument: document,
    children: [underlay, button],
    _style: makeAppearanceStyle({
      getPropertyValue: property => property === "--freeBusyAwayColor" ? statusColor : ""
    }),
    matches: () => false,
    querySelector: selector => selector === "[role='button'][aria-label]" ? button : null
  };
  return { node, button };
}

const appearanceDocument = {
  defaultView: {
    getComputedStyle: element => element._style
  }
};
const normalAppearanceEvent = makeAppearanceEvent(appearanceDocument, {
  buttonColor: "rgba(208, 228, 244, 0.9)",
  underlayColor: "rgba(170, 205, 235, 0.9)"
});
assert.deepEqual(
  outlookAppearance.resolveDomAppearance(normalAppearanceEvent.node, normalAppearanceEvent.button),
  {
    categories: [],
    status: "",
    categoryColor: "",
    statusColor: "",
    color: "rgba(170, 205, 235, 0.9)"
  }
);
const oofAppearanceEvent = makeAppearanceEvent(appearanceDocument, {
  buttonColor: "rgba(210, 204, 248, 0.9)",
  underlayColor: "rgba(180, 0, 158, 0.9)",
  underlayImage: "repeating-linear-gradient(45deg, white 0 1px, transparent 0 50%)",
  statusColor: "#B4009E"
});
assert.deepEqual(
  outlookAppearance.resolveDomAppearance(oofAppearanceEvent.node, oofAppearanceEvent.button),
  {
    categories: [],
    status: "oof",
    categoryColor: "",
    statusColor: "#B4009E",
    color: "#B4009E"
  }
);

const provider = createOutlookCalendarClockProvider(outlookDefinition);
const button = {
  getAttribute(name) {
    return {
      "aria-label": "Timer icon, Clock Test Outlook, 3:30 AM to 4:00 AM, Monday, July 20, 2026, Busy",
      title: "Clock Test Outlook\n3:30 AM to 4:00 AM"
    }[name] || "";
  }
};
const eventNode = {
  textContent: "Clock Test Outlook",
  matches(selector) {
    return selector === "[data-calitemid]";
  },
  querySelector(selector) {
    return selector === "[role='button'][aria-label]" ? button : null;
  },
  getAttribute(name) {
    return name === "data-calitemid" ? "outlook-event-1" : "";
  }
};
const helpers = {
  collectDateContext() {
    return "";
  },
  parseTimeRange() {
    return { start: "03:30", end: "04:00" };
  },
  parseSingleTime() {
    return null;
  },
  parseAllDayRange() {
    return null;
  }
};

const parsed = provider.readEventNode(eventNode, helpers);
assert.equal(provider.id, "outlook");
assert.equal(provider.getViewMode("/calendar/view/workweek"), "workweek");
assert.equal(parsed.title, "Clock Test Outlook");
assert.equal(parsed.stableId, "outlook-event-1");
assert.deepEqual(parsed.range, { start: "03:30", end: "04:00" });
assert.equal(parsed.capturedFrom, "outlook-calendar-dom");

const numericTitleButton = {
  getAttribute(name) {
    return {
      "aria-label": "10:00, 10:00 to 11:00, Monday, July 20, 2026, Busy",
      title: "10:00\n10:00 to 11:00"
    }[name] || "";
  }
};
const numericTitleEvent = {
  ...eventNode,
  textContent: "10:00",
  querySelector(selector) {
    return selector === "[role='button'][aria-label]" ? numericTitleButton : null;
  },
  getAttribute(name) {
    return name === "data-calitemid" ? "outlook-numeric-title" : "";
  }
};
assert.equal(provider.readEventNode(numericTitleEvent, helpers).title, "10:00");

const dateNodes = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"]
  .map(dateKey => ({ getAttribute: () => dateKey }));
const visibleDateKeys = provider.getVisibleDateKeys({
  document: {
    location: { pathname: "/calendar/view/workweek" },
    querySelectorAll: () => dateNodes
  },
  isElementInViewport: () => true
});
assert.deepEqual(visibleDateKeys, ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24"]);
function makePresenceObservation(now, overrides = {}) {
  const lanes = {
    timed: {
      trusted: true,
      identityComplete: true,
      surfaceKey: "timed-surface",
      geometryKey: "1000:500:1000:500:1000:1900",
      coverageProfileKey: "timed-profile",
      overflow: false,
      expectedIds: new Set(["present", "missing"]),
      presentIds: new Set(["present"])
    },
    allDay: {
      trusted: true,
      identityComplete: true,
      surfaceKey: "all-day-surface",
      geometryKey: "1000:23:1000:23:1000:23",
      coverageProfileKey: "all-day-profile",
      overflow: false,
      expectedIds: new Set(),
      presentIds: new Set()
    },
    ...(overrides.lanes || {})
  };
  return {
    now,
    sourceInstanceId: "outlook-document-1",
    observationSequence: Math.max(1, Math.round(now)),
    viewMode: "workweek",
    visibleDateKeys,
    captureTrusted: true,
    routeDateConsistent: true,
    documentVisible: true,
    trackingReady: true,
    calendarVisibilityTrusted: true,
    calendarVisibilityKey: "calendar-selection-1",
    apiRevision: "4:100",
    recordsRevision: "records-1",
    displayTimeZoneKey: "Europe/Helsinki",
    scopeKey: "workweek-2026-07-20",
    animationsKnown: true,
    animationCount: 0,
    busyState: "idle",
    activityRevision: 1,
    lastActivityAt: 0,
    ...overrides,
    lanes
  };
}

const presencePolicy = createOutlookPresenceSuppressionPolicy();
assert.deepEqual(presencePolicy.observe(makePresenceObservation(1000)).suppressedIds, []);
assert.deepEqual(presencePolicy.observe(makePresenceObservation(2000)).suppressedIds, []);
assert.deepEqual(presencePolicy.observe(makePresenceObservation(2750)).suppressedIds, []);
assert.deepEqual(presencePolicy.observe(makePresenceObservation(3500)).suppressedIds, ["missing"]);
assert.deepEqual(presencePolicy.observe(makePresenceObservation(3600, {
  scopeKey: "different-scope"
})).suppressedIds, []);
assert.equal(presencePolicy.observe(makePresenceObservation(4700, {
  scopeKey: "different-scope",
  lanes: {
    timed: {
      trusted: true,
      identityComplete: true,
      surfaceKey: "timed-surface",
      geometryKey: "1000:500:1000:500:1000:1900",
      coverageProfileKey: "timed-profile",
      overflow: false,
      expectedIds: new Set(["present", "missing"]),
      presentIds: new Set(["present", "missing"])
    }
  }
})).status, "inactive");
assert.equal(presencePolicy.observe(makePresenceObservation(4800, {
  activityRevision: 2,
  lastActivityAt: 4700
})).status, "observing");
assert.equal(presencePolicy.observe(makePresenceObservation(6000, {
  documentVisible: false
})).status, "inactive");
assert.equal(presencePolicy.observe(makePresenceObservation(7000, {
  animationCount: 2
})).nextObservationDelayMs, 200);
assert.equal(presencePolicy.observe(makePresenceObservation(8000, {
  viewMode: "month",
  visibleDateKeys: []
})).status, "inactive");
assert.equal(presencePolicy.observe(makePresenceObservation(8000)).status, "inactive");
assert.equal(presencePolicy.observe(makePresenceObservation(9000, {
  displayTimeZoneKey: ""
})).status, "inactive");

const longGapPolicy = createOutlookPresenceSuppressionPolicy();
longGapPolicy.observe(makePresenceObservation(1000));
longGapPolicy.observe(makePresenceObservation(2000));
assert.deepEqual(longGapPolicy.observe(makePresenceObservation(8000)).suppressedIds, []);
assert.deepEqual(longGapPolicy.observe(makePresenceObservation(8750)).suppressedIds, []);
assert.deepEqual(longGapPolicy.observe(makePresenceObservation(9500)).suppressedIds, ["missing"]);

const allDayPolicy = createOutlookPresenceSuppressionPolicy();
const allDayLane = {
  trusted: true,
  identityComplete: true,
  surfaceKey: "all-day-surface",
  geometryKey: "1000:23:1000:23:1000:44",
  coverageProfileKey: "all-day-profile",
  overflow: true,
  expectedIds: new Set(["missing-all-day"]),
  presentIds: new Set()
};
assert.equal(allDayPolicy.observe(makePresenceObservation(1000, {
  lanes: {
    timed: {
      trusted: true,
      identityComplete: true,
      surfaceKey: "timed-surface",
      geometryKey: "timed-geometry",
      coverageProfileKey: "timed-profile",
      overflow: false,
      expectedIds: new Set(),
      presentIds: new Set()
    },
    allDay: allDayLane
  }
})).status, "observing");
for (const now of [2000, 3000, 3750]) {
  allDayPolicy.observe(makePresenceObservation(now, {
    lanes: {
      timed: {
        trusted: true,
        identityComplete: true,
        surfaceKey: "timed-surface",
        geometryKey: "timed-geometry",
        coverageProfileKey: "timed-profile",
        overflow: false,
        expectedIds: new Set(),
        presentIds: new Set()
      },
      allDay: { ...allDayLane, overflow: false }
    }
  }));
}
assert.deepEqual(
  allDayPolicy.observe(makePresenceObservation(4500, {
    lanes: {
      timed: {
        trusted: true,
        identityComplete: true,
        surfaceKey: "timed-surface",
        geometryKey: "timed-geometry",
        coverageProfileKey: "timed-profile",
        overflow: false,
        expectedIds: new Set(),
        presentIds: new Set()
      },
      allDay: { ...allDayLane, overflow: false }
    }
  })).suppressedIds,
  ["missing-all-day"]
);

const boundedPolicy = createOutlookPresenceSuppressionPolicy({
  minimumObservations: 2,
  minimumObservationGapMs: 100,
  minimumObservationSpanMs: 100
});
const manyIds = new Set(Array.from({ length: 205 }, (_value, index) => `missing-${index}`));
const manyLane = {
  trusted: true,
  identityComplete: true,
  surfaceKey: "timed-surface",
  geometryKey: "timed-geometry",
  coverageProfileKey: "timed-profile",
  overflow: false,
  expectedIds: manyIds,
  presentIds: new Set()
};
boundedPolicy.observe(makePresenceObservation(1000, { lanes: { timed: manyLane } }));
boundedPolicy.observe(makePresenceObservation(2000, { lanes: { timed: manyLane } }));
assert.equal(
  boundedPolicy.observe(makePresenceObservation(2100, { lanes: { timed: manyLane } })).suppressedIds.length,
  0
);

class FakeXmlHttpRequest {
  open() {}
  send() {}
  addEventListener() {}
}
const location = {
  href: "https://outlook.live.com/calendar/view/workweek",
  origin: "https://outlook.live.com",
  hostname: "outlook.live.com"
};
const fakeWindow = {
  location,
  addEventListener() {},
  removeEventListener() {}
};
const context = vm.createContext({
  window: fakeWindow,
  location,
  XMLHttpRequest: FakeXmlHttpRequest,
  URL,
  Intl,
  Date,
  Symbol,
  Object,
  Array,
  Map,
  Set,
  WeakSet,
  Number,
  String,
  Boolean,
  JSON,
  Reflect,
  console
});
const hookSource = fs.readFileSync(
  path.join(repoRoot, "src/content/providers/outlook/outlook-main-world-hook.js"),
  "utf8"
);
vm.runInContext(
  fs.readFileSync(
    path.join(repoRoot, "src/content/providers/outlook/appearance/outlook-appearance-contract.js"),
    "utf8"
  ),
  context
);
fakeWindow.CalendarClockOutlookAppearance = context.CalendarClockOutlookAppearance;
vm.runInContext(hookSource, context);
const structuredApi = fakeWindow.CalendarClockOutlookPageOwnedHook;
const payload = {
  owaUserConfig: {
    UserOptions: {
      TimeZone: "FLE Standard Time",
      MailboxTimeZoneOffset: [{
        TimeZoneId: "FLE Standard Time",
        IanaTimeZones: ["Invalid/Zone", "Europe/Helsinki"]
      }]
    }
  },
  getCalendarFolders: {
    CalendarFolders: [
      {
        FolderId: { Id: "calendar-1" },
        DisplayName: "Calendar"
      },
      {
        FolderId: { Id: "calendar-2" },
        DisplayName: "Shared QA"
      }
    ]
  },
  masterCategories: {
    value: [
      { displayName: "Purple category", color: "preset8" },
      { DisplayName: "Red category", Color: 0 }
    ]
  },
  getCalendarView: {
    Body: { Items: [
      {
        ItemId: { Id: "structured-event-1" },
        ParentFolderId: { Id: "calendar-1" },
        ItemClass: "IPM.Appointment",
        Start: "2026-07-20T06:15:00Z",
        End: "2026-07-20T07:00:00Z",
        LastModifiedTime: "2026-07-19T20:00:00Z",
        Subject: "CC QA Timed",
        IsMeeting: false,
        IsAllDayEvent: false,
        IsCancelled: false,
        FreeBusyType: "OOF",
        Categories: ["Purple category"]
      },
      {
        ItemId: { Id: "point-event-1" },
        ParentFolderId: { Id: "calendar-1" },
        ItemClass: "IPM.Appointment",
        Start: "2026-07-20T08:00:00Z",
        End: "2026-07-20T08:00:00Z",
        Subject: "CC QA Point",
        IsAllDayEvent: false,
        IsCancelled: false,
        FreeBusyType: "Free"
      },
      {
        ItemId: { Id: "all-day-event-1" },
        ParentFolderId: { Id: "calendar-1" },
        ItemClass: "IPM.Appointment",
        Start: "2026-07-20T21:00:00Z",
        End: "2026-07-21T21:00:00Z",
        Subject: "CC QA All Day",
        IsAllDayEvent: true,
        IsCancelled: false,
        FreeBusyType: "Free"
      },
      {
        ItemId: { Id: "multi-day-event-1" },
        ParentFolderId: { Id: "calendar-2" },
        ItemClass: "IPM.Appointment",
        Start: "2026-07-21T21:00:00Z",
        End: "2026-07-24T21:00:00Z",
        Subject: "CC QA Multi Day",
        IsAllDayEvent: true,
        IsCancelled: false,
        FreeBusyType: "Free"
      },
      {
        ItemId: { Id: "occurrence-event-1" },
        SeriesMasterItemId: { Id: "series-master-1" },
        ParentFolderId: { Id: "calendar-2" },
        ItemClass: "IPM.Appointment.Occurrence",
        CalendarItemType: "Occurrence",
        Start: "2026-07-23T08:00:00Z",
        End: "2026-07-23T08:30:00Z",
        Subject: "CC QA Recurring",
        IsAllDayEvent: false,
        IsCancelled: false,
        FreeBusyType: "Busy"
      },
      {
        ItemId: { Id: "series-master-1" },
        ParentFolderId: { Id: "calendar-2" },
        ItemClass: "IPM.Appointment",
        CalendarItemType: "RecurringMaster",
        Start: "2026-07-23T08:00:00Z",
        End: "2026-07-23T08:30:00Z",
        Subject: "CC QA Recurring",
        Recurrence: { Pattern: "Weekly" },
        IsAllDayEvent: false,
        IsCancelled: false,
        FreeBusyType: "Busy"
      },
      {
        ItemId: { Id: "exception-event-1" },
        SeriesMasterItemId: { Id: "series-master-1" },
        ParentFolderId: { Id: "calendar-2" },
        ItemClass: "IPM.OLE.CLASS.{00061055-0000-0000-C000-000000000046}",
        CalendarItemType: "Exception",
        Start: "2026-07-24T08:00:00Z",
        End: "2026-07-24T08:30:00Z",
        Subject: "CC QA Recurring Exception",
        IsAllDayEvent: false,
        IsCancelled: false,
        FreeBusyType: "Busy"
      },
      {
        ItemId: { Id: "private-event-1" },
        ParentFolderId: { Id: "calendar-1" },
        ItemClass: "IPM.Appointment",
        Start: "2026-07-24T10:00:00Z",
        End: "2026-07-24T10:30:00Z",
        Subject: "  Private   appointment  ",
        Sensitivity: "Private",
        IsAllDayEvent: false,
        IsCancelled: false,
        FreeBusyType: "Busy"
      },
      {
        ItemId: { Id: "cancelled-event-1" },
        ParentFolderId: { Id: "calendar-1" },
        ItemClass: "IPM.Appointment",
        Start: "2026-07-24T11:00:00Z",
        End: "2026-07-24T11:30:00Z",
        Subject: "Cancelled",
        IsAllDayEvent: false,
        IsCancelled: true
      },
      {
        ItemId: { Id: "reversed-event-1" },
        ParentFolderId: { Id: "calendar-1" },
        ItemClass: "IPM.Appointment",
        Start: "2026-07-24T12:30:00Z",
        End: "2026-07-24T12:00:00Z",
        Subject: "Invalid reversed"
      },
      {
        ItemId: { Id: "mail-item-1" },
        ParentFolderId: { Id: "calendar-1" },
        ItemClass: "IPM.Note",
        Start: "2026-07-24T12:00:00Z",
        End: "2026-07-24T12:30:00Z",
        Subject: "Not an appointment"
      },
      {
        ItemId: { Id: "invalid-all-day-1" },
        ParentFolderId: { Id: "calendar-1" },
        ItemClass: "IPM.Appointment",
        Start: "2026-07-24T21:00:00Z",
        End: "2026-07-24T21:00:00Z",
        Subject: "Invalid all-day",
        IsAllDayEvent: true
      }
    ] }
  }
};
const timeZone = structuredApi.getOutlookTimeZone(payload);
assert.equal(structuredApi.extractCalendarFolders(payload).size, 2);
const categoryCatalog = structuredApi.extractCategoryCatalog(payload);
assert.equal(categoryCatalog.get("purple category"), "#6656d1");
assert.equal(categoryCatalog.get("red category"), "#c50f1f");
const structuredRecords = structuredApi.extractCalendarRecords(
  payload,
  timeZone,
  structuredApi.extractCalendarFolders(payload),
  categoryCatalog
);
const recordsById = new Map(structuredRecords.map(record => [record.id, record]));
assert.equal(timeZone, "Europe/Helsinki");
assert.equal(structuredRecords.length, 7);
assert.equal(recordsById.get("structured-event-1").capturedFrom, "outlook-page-owned");
assert.equal(recordsById.get("structured-event-1").calendarName, "Calendar");
assert.equal(recordsById.get("structured-event-1").start, "09:15");
assert.equal(recordsById.get("structured-event-1").end, "10:00");
assert.equal(recordsById.get("structured-event-1").endDateKey, "2026-07-20");
assert.equal(recordsById.get("structured-event-1").itemClass, "IPM.Appointment");
assert.equal(recordsById.get("structured-event-1").meetingStatus, "appointment");
assert.equal(recordsById.get("structured-event-1").status, "oof");
assert.deepEqual(
  Array.from(recordsById.get("structured-event-1").categories),
  ["Purple category"]
);
assert.equal(recordsById.get("structured-event-1").color, "#6656d1");
assert.equal(recordsById.get("point-event-1").meetingStatus, "unknown");
assert.equal(recordsById.get("structured-event-1").updatedAt, Date.parse("2026-07-19T20:00:00Z"));
assert.equal(recordsById.get("point-event-1").durationKind, "point");
assert.equal(recordsById.get("point-event-1").isPointEvent, true);
assert.equal(recordsById.get("all-day-event-1").durationKind, "all-day");
assert.equal(recordsById.get("all-day-event-1").allDayStartDateKey, "2026-07-21");
assert.equal(recordsById.get("all-day-event-1").allDayEndDateKeyExclusive, "2026-07-22");
assert.equal(recordsById.get("multi-day-event-1").allDayStartDateKey, "2026-07-22");
assert.equal(recordsById.get("multi-day-event-1").allDayEndDateKeyExclusive, "2026-07-25");
assert.equal(recordsById.get("multi-day-event-1").calendarName, "Shared QA");
assert.equal(recordsById.get("occurrence-event-1").seriesMasterId, "series-master-1");
assert.equal(recordsById.has("series-master-1"), false);
assert.equal(recordsById.get("exception-event-1").seriesMasterId, "series-master-1");
assert.equal(recordsById.get("exception-event-1").title, "CC QA Recurring Exception");
assert.equal(recordsById.get("private-event-1").title, "Private appointment");
assert.equal(recordsById.has("cancelled-event-1"), false);
assert.equal(recordsById.has("reversed-event-1"), false);
assert.equal(recordsById.has("mail-item-1"), false);
assert.equal(recordsById.has("invalid-all-day-1"), false);
assert.equal(
  structuredApi.getOutlookTimeZone({
    owaUserConfig: {
      UserOptions: {
        TimeZone: "Unknown Windows Zone",
        MailboxTimeZoneOffset: [{
          TimeZoneId: "FLE Standard Time",
          IanaTimeZones: ["Europe/Helsinki"]
        }]
      }
    }
  }),
  ""
);
assert.equal(
  structuredApi.getOutlookTimeZone({
    owaUserConfig: { UserOptions: { TimeZone: "America/New_York" } }
  }),
  "America/New_York"
);

const dstPayload = {
  Items: [
    ["spring-before", "2026-03-29T00:30:00Z"],
    ["spring-after", "2026-03-29T01:30:00Z"],
    ["fall-before", "2026-10-25T00:30:00Z"],
    ["fall-after", "2026-10-25T01:30:00Z"]
  ].map(([id, start]) => ({
    ItemId: { Id: id },
    ItemClass: "IPM.Appointment",
    Start: start,
    End: new Date(Date.parse(start) + 30 * 60 * 1000).toISOString(),
    Subject: id,
    IsAllDayEvent: false,
    IsCancelled: false
  }))
};
const dstRecords = new Map(structuredApi.extractCalendarRecords(
  dstPayload,
  "Europe/Helsinki",
  new Map()
).map(record => [record.id, record]));
assert.equal(dstRecords.get("spring-before").start, "02:30");
assert.equal(dstRecords.get("spring-after").start, "04:30");
assert.equal(dstRecords.get("fall-before").start, "03:30");
assert.equal(dstRecords.get("fall-after").start, "03:30");
assert.notEqual(
  dstRecords.get("fall-before").startInstant,
  dstRecords.get("fall-after").startInstant
);

const oversizedPayload = {
  Items: Array.from({ length: 205 }, (_, index) => ({
    ItemId: { Id: `bounded-${index}` },
    ItemClass: "IPM.Appointment",
    Start: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
    End: new Date(Date.UTC(2026, 6, 1, 0, index + 1)).toISOString(),
    Subject: `Bounded ${index}`,
    IsAllDayEvent: false,
    IsCancelled: false
  }))
};
assert.equal(
  structuredApi.extractCalendarRecords(oversizedPayload, "Europe/Helsinki", new Map()).length,
  200
);

assert.deepEqual(
  Array.from(structuredApi.extractCancelledRecordIds(payload)),
  ["cancelled-event-1"]
);

const cache = new Map();
const tombstones = new Map();
const originalTimed = recordsById.get("structured-event-1");
structuredApi.mergeOutlookRecordCache(cache, [originalTimed], 200, {
  tombstones,
  responseSequence: 1
});
const movedTimed = {
  ...originalTimed,
  cacheKey: "structured-event-1:2026-07-20T07:15:00.000Z",
  domKey: "outlook-page-owned:structured-event-1:2026-07-20T07:15:00.000Z",
  start: "10:15",
  end: "11:00",
  startInstant: "2026-07-20T07:15:00.000Z",
  endInstant: "2026-07-20T08:00:00.000Z",
  startDate: "2026-07-20T07:15:00.000Z",
  endDate: "2026-07-20T08:00:00.000Z"
};
structuredApi.mergeOutlookRecordCache(cache, [movedTimed], 200, {
  tombstones,
  responseSequence: 2
});
assert.equal(cache.size, 1);
assert.equal(Array.from(cache.values())[0].start, "10:15");
structuredApi.mergeOutlookRecordCache(cache, [originalTimed], 200, {
  tombstones,
  responseSequence: 1
});
assert.equal(Array.from(cache.values())[0].start, "10:15");
assert.equal(
  structuredApi.recordConfirmedOutlookDeletions(cache, tombstones, ["structured-event-1"], 3),
  1
);
assert.equal(cache.size, 0);
structuredApi.mergeOutlookRecordCache(cache, [movedTimed], 200, {
  tombstones,
  responseSequence: 3
});
assert.equal(cache.size, 0);
structuredApi.mergeOutlookRecordCache(cache, [movedTimed], 200, {
  tombstones,
  responseSequence: 4
});
assert.equal(cache.size, 1);
assert.equal(tombstones.has("structured-event-1"), false);

const occurrenceOne = {
  ...recordsById.get("occurrence-event-1"),
  id: "occurrence-event-1",
  cacheKey: "occurrence-event-1:2026-07-23T08:00:00.000Z"
};
const occurrenceTwo = {
  ...occurrenceOne,
  id: "occurrence-event-2",
  cacheKey: "occurrence-event-2:2026-07-24T08:00:00.000Z",
  startInstant: "2026-07-24T08:00:00.000Z",
  endInstant: "2026-07-24T08:30:00.000Z",
  startDate: "2026-07-24T08:00:00.000Z",
  endDate: "2026-07-24T08:30:00.000Z"
};
structuredApi.mergeOutlookRecordCache(cache, [occurrenceOne, occurrenceTwo], 200, {
  tombstones,
  responseSequence: 5
});
assert.equal(cache.size, 3);
assert.equal(
  structuredApi.recordConfirmedOutlookDeletions(cache, tombstones, ["series-master-1"], 6),
  2
);
assert.equal(cache.size, 1);

// Delete requests carry the item id only in the request; the success response confirms it.
const deleteRequest = {
  __type: "DeleteCalendarEventJsonRequest:#Exchange",
  Body: {
    __type: "DeleteCalendarEventRequest:#Exchange",
    EventId: { __type: "ItemId:#Exchange", Id: "item-1" },
    EventScope: 0
  }
};
const deleteSuccess = { Body: { ResponseCode: "NoError", ResponseClass: "Success" } };
assert.deepEqual(
  JSON.parse(JSON.stringify(structuredApi.extractConfirmedRequestDeletion(deleteRequest, deleteSuccess))),
  { ids: ["item-1"], seriesScope: "" }
);
// Observed live: 1 this occurrence, 2 this and following, 3 whole series.
[[1, ""], [2, "following"], [3, "series"]].forEach(([EventScope, seriesScope]) => {
  assert.equal(
    structuredApi.extractConfirmedRequestDeletion({ Body: { ...deleteRequest.Body, EventScope } }, deleteSuccess).seriesScope,
    seriesScope
  );
});
assert.equal(structuredApi.extractConfirmedRequestDeletion(deleteRequest, { Body: { ResponseClass: "Error" } }), null);
assert.equal(structuredApi.extractConfirmedRequestDeletion({
  Body: { __type: "GetCalendarEventRequest:#Exchange", EventIds: [{ __type: "ItemId:#Exchange", Id: "item-1" }] }
}, deleteSuccess), null);

const seriesCache = new Map([
  ["a", { id: "occ-1", seriesMasterId: "master", startDate: "2026-07-20T08:00:00.000Z" }],
  ["b", { id: "occ-2", seriesMasterId: "master", startDate: "2026-07-21T08:00:00.000Z" }],
  ["c", { id: "occ-3", seriesMasterId: "master", startDate: "2026-07-22T08:00:00.000Z" }]
]);
assert.deepEqual(
  Array.from(structuredApi.expandSeriesDeletion(seriesCache, { ids: ["occ-2"], seriesScope: "following" })).sort(),
  ["occ-2", "occ-3"]
);
assert.deepEqual(
  Array.from(structuredApi.expandSeriesDeletion(seriesCache, { ids: ["occ-2"], seriesScope: "series" })).sort(),
  ["occ-1", "occ-2", "occ-3"]
);
assert.deepEqual(
  Array.from(structuredApi.expandSeriesDeletion(seriesCache, { ids: ["occ-2"], seriesScope: "" })),
  ["occ-2"]
);

// A ranged view is authoritative for its folder, but never removes items learned after the view request started.
const viewRequest = {
  Body: {
    __type: "GetCalendarViewRequest:#Exchange",
    CalendarId: {
      __type: "TargetFolderId:#Exchange",
      BaseFolderId: { __type: "FolderId:#Exchange", Id: "folder-1" }
    },
    RangeStart: "2026-07-20T00:00:00+03:00",
    RangeEnd: "2026-07-27T00:00:00+03:00"
  }
};
const authoritativeView = structuredApi.extractAuthoritativeView(viewRequest, {
  Body: { Items: [{ ItemId: { Id: "kept" } }], ResponseCode: "NoError", ResponseClass: "Success" }
});
assert.ok(authoritativeView);
assert.equal(structuredApi.extractAuthoritativeView(viewRequest, {
  Body: { Items: [], ResponseClass: "Error" }
}), null);
const viewRecord = (id, calendar, startDate, sequence) => ({
  id,
  calendar,
  durationKind: "range",
  startDate,
  endDate: new Date(Date.parse(startDate) + 3600000).toISOString(),
  _responseSequence: sequence
});
const viewCache = new Map([
  ["kept", viewRecord("kept", "folder-1", "2026-07-22T08:00:00.000Z", 5)],
  ["stale", viewRecord("stale", "folder-1", "2026-07-22T10:00:00.000Z", 5)],
  ["newer", viewRecord("newer", "folder-1", "2026-07-22T12:00:00.000Z", 20)],
  ["other-folder", viewRecord("other-folder", "folder-2", "2026-07-22T12:00:00.000Z", 5)],
  ["outside", viewRecord("outside", "folder-1", "2026-08-01T12:00:00.000Z", 5)],
  ["all-day", {
    id: "all-day",
    calendar: "folder-1",
    durationKind: "all-day",
    allDayStartDateKey: "2026-07-26",
    allDayEndDateKeyExclusive: "2026-07-27",
    _responseSequence: 5
  }]
]);
assert.deepEqual(
  Array.from(structuredApi.findStaleViewRecordIds(viewCache, authoritativeView, 10, "Europe/Kyiv", 2)).sort(),
  ["all-day", "stale"]
);

const earlyCaptureSource = fs.readFileSync(
  path.join(repoRoot, "src/content/structured-capture/main-world-early-capture.js"),
  "utf8"
);
class CaptureXmlHttpRequest {
  constructor(status = 200) {
    this.status = status;
    this.responseType = "";
    this.responseText = "{}";
    this.responseURL = "";
    this.listeners = new Map();
  }

  open(method, url) {
    this.method = method;
    this.responseURL = url;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setRequestHeader() {}

  send() {
    this.listeners.get("load")?.();
  }
}
const earlyWindow = {
  location,
  CalendarClockProviders: {
    fromHostname: () => ({
      id: "outlook",
      origin: "https://outlook.live.com",
      supportsPageOwned: true,
      structuredResponsePaths: ["/owa/startupdata.ashx", "/owa/service.svc", "/owa/published/service.svc"]
    })
  },
  XMLHttpRequest: CaptureXmlHttpRequest,
  URL,
  URLSearchParams,
  Symbol,
  Object,
  Array,
  Set,
  Number,
  String,
  Boolean,
  JSON,
  Reflect
};
earlyWindow.window = earlyWindow;
const earlyContext = vm.createContext(earlyWindow);
vm.runInContext(earlyCaptureSource, earlyContext);
const capturedResponses = [];
earlyWindow.CalendarClockEarlyStructuredCapture.subscribe(
  "outlook",
  response => capturedResponses.push(response)
);
const successfulCaptureXhr = new CaptureXmlHttpRequest(200);
successfulCaptureXhr.open("POST", "https://outlook.live.com/owa/service.svc?action=ExpandCalendarEvent");
successfulCaptureXhr.setRequestHeader("x-owa-urlpostdata", encodeURIComponent('{"Body":{"__type":"GetCalendarViewRequest:#Exchange"}}'));
successfulCaptureXhr.send();
assert.equal(capturedResponses.length, 1);
assert.ok(capturedResponses[0].requestSequence > 0);
assert.equal(capturedResponses[0].requestText, '{"Body":{"__type":"GetCalendarViewRequest:#Exchange"}}');
assert.equal(capturedResponses[0].ok, true);
const failedCaptureXhr = new CaptureXmlHttpRequest(500);
failedCaptureXhr.open("POST", "https://outlook.live.com/owa/service.svc?action=ExpandCalendarEvent");
failedCaptureXhr.send("{}");
assert.equal(capturedResponses.length, 2);
assert.ok(capturedResponses[1].requestSequence > capturedResponses[0].requestSequence);
assert.equal(capturedResponses[1].ok, false);

assert.match(earlyCaptureSource, /CalendarClockEarlyStructuredCapture/);
assert.match(earlyCaptureSource, /MAX_BUFFERED_RESPONSES = 16/);
assert.match(earlyCaptureSource, /structuredWorkerCapture === true/);
assert.match(earlyCaptureSource, /requestSequence/);
assert.doesNotMatch(hookSource, /window\.fetch\s*=/);
const optionalLoaderSource = fs.readFileSync(
  path.join(repoRoot, "src/content/optional-module-loader.js"),
  "utf8"
);
assert.match(optionalLoaderSource, /CALENDAR_CLOCK_INSTALL_MAIN_PROVIDER/);
const providerLoaderSource = fs.readFileSync(
  path.join(repoRoot, "src/content/providers/provider-loader.js"),
  "utf8"
);
assert.match(providerLoaderSource, /contentAdapterModulePath/);
assert.match(providerLoaderSource, /createCalendarClockProvider/);
assert.doesNotMatch(providerLoaderSource, /createOutlookCalendarClockProvider/);
const providerInstallerSource = fs.readFileSync(
  path.join(repoRoot, "src/background/provider-main-world-installer.js"),
  "utf8"
);
assert.match(providerInstallerSource, /files:\s*request\.modulePaths/);
const installerFetches = [];
const installerInjections = [];
const installerContext = vm.createContext({
  URL,
  fetch: async url => {
    installerFetches.push(String(url));
    return { ok: true };
  },
  chrome: {
    runtime: {
      getURL: modulePath => `chrome-extension://calendar-clock/${modulePath}`,
      onMessage: { addListener() {} }
    },
    scripting: {
      executeScript: async details => {
        installerInjections.push(details);
        return [{ frameId: details.target.frameIds[0] }];
      }
    }
  }
});
vm.runInContext(
  fs.readFileSync(path.join(repoRoot, "src/providers/provider-registry.js"), "utf8"),
  installerContext
);
vm.runInContext(providerInstallerSource, installerContext);
const trustedInstallerRequest = installerContext.CalendarClockProviderMainWorldInstaller.getTrustedRequest(
  { providerId: "outlook" },
  {
    url: "https://outlook.live.com/calendar/view/workweek",
    tab: { id: 42 },
    frameId: 0
  }
);
assert.deepEqual(
  Array.from(trustedInstallerRequest.modulePaths),
  [
    "src/content/providers/outlook/appearance/outlook-appearance-contract.js",
    "src/content/providers/outlook/outlook-main-world-hook.js"
  ]
);
await installerContext.CalendarClockProviderMainWorldInstaller.installProviderParser(
  trustedInstallerRequest
);
assert.deepEqual(
  installerFetches,
  [
    "chrome-extension://calendar-clock/src/content/providers/outlook/appearance/outlook-appearance-contract.js",
    "chrome-extension://calendar-clock/src/content/providers/outlook/outlook-main-world-hook.js"
  ]
);
assert.deepEqual(
  Array.from(installerInjections[0].files),
  Array.from(trustedInstallerRequest.modulePaths)
);
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
assert.equal(
  manifest.web_accessible_resources
    .flatMap(entry => entry.resources || [])
    .includes("src/content/providers/*/*/*.js"),
  true
);
const outlookSnapshotSource = fs.readFileSync(
  path.join(repoRoot, "src/background/providers/outlook/outlook-snapshot.js"),
  "utf8"
);
assert.match(outlookSnapshotSource, /FEED_MODES\.has\(message\.feedMode\)/);
assert.match(outlookSnapshotSource, /sender\.documentId/);
assert.match(outlookSnapshotSource, /sender\?\.documentLifecycle === "active"/);
assert.match(outlookSnapshotSource, /pageLocalEffective: true/);
assert.doesNotMatch(outlookSnapshotSource, /feedMode:\s*"dom"/);
assert.doesNotMatch(
  fs.readFileSync(path.join(repoRoot, "src/content/providers/outlook/outlook-provider.mjs"), "utf8"),
  /function stableHash/
);
assert.match(
  fs.readFileSync(path.join(repoRoot, "src/content/overlay/overlay-menu.js"), "utf8"),
  /CALENDAR_CLOCK_SET_EVENTS/
);
assert.match(
  fs.readFileSync(path.join(repoRoot, "src/clock/scripts/calendar-bridge.js"), "utf8"),
  /CALENDAR_CLOCK_SET_EVENTS/
);

const outlookStorageWrites = [];
const outlookStorageState = {};
const outlookTabListeners = { created: null, removed: null, updated: null };
let outlookOpenTabCount = 1;
const snapshotContext = vm.createContext({
  URL,
  Date,
  Map,
  Set,
  Promise,
  globalThis: null,
  chrome: {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys, callback) {
          callback(Object.fromEntries((keys || []).map(key => [key, outlookStorageState[key]])));
        },
        set(values, callback) {
          Object.assign(outlookStorageState, values);
          outlookStorageWrites.push(values);
          callback();
        },
        remove(_keys, callback) {
          callback();
        }
      }
    },
    action: { setBadgeText() {} },
    tabs: {
      reload(_tabId, callback) { callback(); },
      get(tabId, callback) {
        callback({ id: tabId, url: "https://outlook.live.com/calendar/view/workweek" });
      },
      query(_queryInfo, callback) {
        callback(Array.from({ length: outlookOpenTabCount }, (_value, index) => ({
          id: 42 + index,
          url: "https://outlook.live.com/calendar/view/workweek"
        })));
      },
      onCreated: { addListener(listener) { outlookTabListeners.created = listener; } },
      onRemoved: { addListener(listener) { outlookTabListeners.removed = listener; } },
      onUpdated: { addListener(listener) { outlookTabListeners.updated = listener; } }
    }
  },
  CalendarClockTemporalProjection: {
    isValidContext: contextValue => contextValue?.fingerprint === "context-1",
    validateEvent: event => Boolean(event?.id && event?.temporal?.firstDateKey),
    compareEvents: (left, right) => String(left.id).localeCompare(String(right.id)),
    normalizeDateKeys: values => Array.from(new Set(values || [])).sort(),
    overlapsInstantRange: () => true
  }
});
snapshotContext.globalThis = snapshotContext;
vm.runInContext(
  fs.readFileSync(path.join(repoRoot, "src/providers/provider-registry.js"), "utf8"),
  snapshotContext
);
vm.runInContext(outlookSnapshotSource, snapshotContext);
const snapshotHandler = snapshotContext.CalendarClockProviderSnapshotHandlers.get("outlook");
const canonicalA = {
  id: "event-a",
  temporal: {
    firstDateKey: "2026-07-20",
    occurrenceKey: "event-a",
    startInstant: "2026-07-20T06:00:00.000Z",
    endInstant: "2026-07-20T07:00:00.000Z"
  }
};
const canonicalB = {
  id: "event-b",
  temporal: {
    firstDateKey: "2026-07-20",
    occurrenceKey: "event-b",
    startInstant: "2026-07-20T08:00:00.000Z",
    endInstant: "2026-07-20T09:00:00.000Z"
  }
};
const savedSnapshotResponse = await new Promise(resolve => {
  snapshotHandler.save({
    provider: "outlook",
    type: "CALENDAR_CLOCK_EVENTS",
    url: "https://outlook.live.com/calendar/view/workweek",
    events: [canonicalA, canonicalB],
    displayEvents: [canonicalA],
    temporalContext: { fingerprint: "context-1", calendarTimeZone: "Europe/Helsinki" },
    timeZone: "Europe/Helsinki",
    feedMode: "page-owned",
    captureLimit: 50,
    effectiveSource: { activeSource: "outlook-page-owned" },
    presenceOverlay: {
      status: "active",
      reason: "confirmed absent",
      scope: "scope-1",
      suppressedIds: ["event-b"],
      sourceInstanceId: "outlook-document-1",
      observationSequence: 9
    },
    sourceInstanceId: "outlook-document-1",
    commitSequence: 10,
    observationSequence: 9,
    displayDateKeys: ["2026-07-20"],
    windowStartDate: "2026-07-20T00:00:00.000Z",
    windowEndDate: "2026-07-21T00:00:00.000Z"
  }, {
    url: "https://outlook.live.com/calendar/view/workweek",
    tab: { id: 42, url: "https://outlook.live.com/calendar/view/workweek" },
    frameId: 0,
    documentId: "document-42-a",
    documentLifecycle: "active"
  }, resolve);
});
assert.equal(savedSnapshotResponse.ok, true);
assert.deepEqual(savedSnapshotResponse.events.map(event => event.id), ["event-a"]);
assert.deepEqual(outlookStorageWrites[0].calendarClockOutlookEvents.map(event => event.id), ["event-a", "event-b"]);
assert.deepEqual(
  outlookStorageWrites[0].calendarClockOutlookCanonicalEvents.map(event => event.id),
  ["event-a", "event-b"]
);
assert.deepEqual(
  Array.from(outlookStorageWrites[0].calendarClockOutlookPresenceOverlay.suppressedIds),
  ["event-b"]
);
assert.equal(outlookStorageWrites[0].calendarClockOutlookSource.canonicalCount, 2);
assert.equal(outlookStorageWrites[0].calendarClockOutlookSource.tabId, 42);
assert.equal(outlookStorageWrites[0].calendarClockOutlookSource.documentId, "document-42-a");
assert.equal(typeof outlookTabListeners.created, "function");
assert.equal(typeof outlookTabListeners.removed, "function");
assert.equal(typeof outlookTabListeners.updated, "function");

outlookOpenTabCount = 2;
const multiTabResponse = await new Promise(resolve => {
  snapshotHandler.save({
    provider: "outlook",
    type: "CALENDAR_CLOCK_EVENTS",
    url: "https://outlook.live.com/calendar/view/workweek",
    events: [canonicalA, canonicalB],
    displayEvents: [canonicalA],
    temporalContext: { fingerprint: "context-1", calendarTimeZone: "Europe/Helsinki" },
    timeZone: "Europe/Helsinki",
    feedMode: "page-owned",
    captureLimit: 50,
    effectiveSource: { activeSource: "outlook-page-owned" },
    presenceOverlay: {
      status: "active",
      reason: "confirmed absent",
      scope: "scope-1",
      suppressedIds: ["event-b"],
      sourceInstanceId: "outlook-document-1",
      observationSequence: 10
    },
    sourceInstanceId: "outlook-document-1",
    commitSequence: 11,
    observationSequence: 10,
    displayDateKeys: ["2026-07-20"],
    windowStartDate: "2026-07-20T00:00:00.000Z",
    windowEndDate: "2026-07-21T00:00:00.000Z"
  }, {
    url: "https://outlook.live.com/calendar/view/workweek",
    tab: { id: 42, url: "https://outlook.live.com/calendar/view/workweek" },
    frameId: 0,
    documentId: "document-42-a",
    documentLifecycle: "active"
  }, resolve);
});
assert.deepEqual(multiTabResponse.events.map(event => event.id), ["event-a", "event-b"]);
assert.equal(multiTabResponse.presenceOverlay.status, "inactive");
assert.match(multiTabResponse.presenceOverlay.reason, /exactly one open Outlook/);

outlookOpenTabCount = 1;
const restoredActiveResponse = await new Promise(resolve => {
  snapshotHandler.save({
    provider: "outlook",
    type: "CALENDAR_CLOCK_EVENTS",
    url: "https://outlook.live.com/calendar/view/workweek",
    events: [canonicalA, canonicalB],
    displayEvents: [canonicalA],
    temporalContext: { fingerprint: "context-1", calendarTimeZone: "Europe/Helsinki" },
    timeZone: "Europe/Helsinki",
    feedMode: "page-owned",
    captureLimit: 50,
    effectiveSource: { activeSource: "outlook-page-owned" },
    presenceOverlay: {
      status: "active",
      reason: "confirmed absent",
      scope: "scope-1",
      suppressedIds: ["event-b"],
      sourceInstanceId: "outlook-document-1",
      observationSequence: 11
    },
    sourceInstanceId: "outlook-document-1",
    commitSequence: 12,
    observationSequence: 11,
    displayDateKeys: ["2026-07-20"],
    windowStartDate: "2026-07-20T00:00:00.000Z",
    windowEndDate: "2026-07-21T00:00:00.000Z"
  }, {
    url: "https://outlook.live.com/calendar/view/workweek",
    tab: { id: 42, url: "https://outlook.live.com/calendar/view/workweek" },
    frameId: 0,
    documentId: "document-42-a",
    documentLifecycle: "active"
  }, resolve);
});
assert.deepEqual(restoredActiveResponse.events.map(event => event.id), ["event-a"]);

outlookTabListeners.removed(42);
await new Promise(resolve => setTimeout(resolve, 0));
const sourceLossWrite = outlookStorageWrites.at(-1);
assert.deepEqual(sourceLossWrite.calendarClockOutlookEvents.map(event => event.id), ["event-a", "event-b"]);
assert.equal(sourceLossWrite.calendarClockOutlookPresenceOverlay.status, "inactive");
assert.match(sourceLossWrite.calendarClockOutlookPresenceOverlay.reason, /source tab closed/);
assert.equal(sourceLossWrite.calendarClockOutlookCaptureMeta.calendar.shownCount, 2);
assert.equal(sourceLossWrite.calendarClockOutlookStorageStatus.count, 2);

const rejectedSubsetResponse = await new Promise(resolve => {
  snapshotHandler.save({
    url: "https://outlook.live.com/calendar/view/workweek",
    events: [canonicalA],
    displayEvents: [canonicalB],
    temporalContext: { fingerprint: "context-1", calendarTimeZone: "Europe/Helsinki" },
    timeZone: "Europe/Helsinki",
    sourceInstanceId: "outlook-document-1",
    commitSequence: 13,
    observationSequence: 12,
    displayDateKeys: ["2026-07-20"],
    windowStartDate: "2026-07-20T00:00:00.000Z",
    windowEndDate: "2026-07-21T00:00:00.000Z"
  }, {
    url: "https://outlook.live.com/calendar/view/workweek",
    tab: { id: 42, url: "https://outlook.live.com/calendar/view/workweek" },
    frameId: 0,
    documentId: "document-42-a",
    documentLifecycle: "active"
  }, resolve);
});
assert.equal(rejectedSubsetResponse.ok, false);
assert.match(rejectedSubsetResponse.error, /does not match/);

console.log("Outlook provider verification passed.");
