import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addCivilDays,
  buildCivilWindow,
  createDayPreviewState,
  dateKeyForInstant,
  getDayPreviewPresentation,
  shouldAcceptPreviewEvents,
  shouldAllowTimeDrivenEffects
} from "../src/content/day-preview/core.mjs";
import { navigateWithPeriodControls } from "../src/content/day-preview/providers/navigation-contract.mjs";
import {
  getGoogleNavigableDateKeys,
  getGoogleViewPeriod,
  scoreGoogleNavigationCandidate
} from "../src/content/day-preview/providers/google.mjs";
import {
  OUTLOOK_DAY_TRANSITION_MAX_ATTEMPTS,
  findOutlookDayViewControl,
  getOutlookNavigableDateKeys,
  getOutlookViewMode,
  getOutlookViewPeriod,
  isWeekendDateKey,
  prepareOutlookViewForTarget,
  scoreOutlookNavigationCandidate
} from "../src/content/day-preview/providers/outlook.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
let passed = 0;

async function check(name, action) {
  await action();
  passed += 1;
  console.log(`ok - ${name}`);
}

await check("previous, next, and Today use absolute civil dates", () => {
  const state = createDayPreviewState({ getTodayDateKey: () => "2026-07-27" });
  assert.deepEqual(state.snapshot(), {
    selectedDateKey: null,
    dateKey: "2026-07-27",
    todayDateKey: "2026-07-27",
    active: false,
    phase: "idle",
    reason: ""
  });
  state.next();
  assert.equal(state.snapshot().dateKey, "2026-07-28");
  assert.equal(state.snapshot().active, true);
  state.previous();
  assert.equal(state.snapshot().dateKey, "2026-07-27");
  assert.equal(state.snapshot().active, false);
  state.previous();
  assert.equal(state.snapshot().dateKey, "2026-07-26");
  state.today();
  assert.equal(state.snapshot().selectedDateKey, null);
  assert.equal(state.snapshot().active, false);
});

await check("a reinitialized state always starts on Today", () => {
  const firstPage = createDayPreviewState({ getTodayDateKey: () => "2026-07-27" });
  firstPage.next();
  assert.equal(firstPage.snapshot().active, true);
  const reloadedPage = createDayPreviewState({ getTodayDateKey: () => "2026-07-27" });
  assert.equal(reloadedPage.snapshot().dateKey, "2026-07-27");
  assert.equal(reloadedPage.snapshot().selectedDateKey, null);
});

await check("the selected date stays absolute when midnight changes Today", () => {
  let today = "2026-07-27";
  const state = createDayPreviewState({ getTodayDateKey: () => today });
  state.previous();
  assert.equal(state.snapshot().dateKey, "2026-07-26");
  today = "2026-07-28";
  assert.equal(state.snapshot().dateKey, "2026-07-26");
  assert.equal(state.snapshot().active, true);
});

await check("Follow Now keeps the identical 12-hour wall-clock range", () => {
  const todayWindow = buildCivilWindow("2026-07-27", 11 * 60 + 30, 12 * 60);
  const tomorrowWindow = buildCivilWindow("2026-07-28", 11 * 60 + 30, 12 * 60);
  assert.deepEqual(
    [todayWindow.startTime, todayWindow.endTime],
    ["11:30", "23:30"]
  );
  assert.deepEqual(
    [tomorrowWindow.startTime, tomorrowWindow.endTime],
    ["11:30", "23:30"]
  );
  assert.equal(tomorrowWindow.startDateKey, "2026-07-28");
});

await check("manual fixed windows retain their exact range", () => {
  assert.deepEqual(buildCivilWindow("2026-07-28", 8 * 60, 12 * 60), {
    startDateKey: "2026-07-28",
    startTime: "08:00",
    endDateKey: "2026-07-28",
    endTime: "20:00",
    durationMinutes: 720
  });
});

await check("24-hour radial windows preserve start time and duration", () => {
  assert.deepEqual(buildCivilWindow("2026-07-28", 11 * 60 + 30, 24 * 60), {
    startDateKey: "2026-07-28",
    startTime: "11:30",
    endDateKey: "2026-07-29",
    endTime: "11:30",
    durationMinutes: 1440
  });
});

await check("overnight windows cross one civil date without changing clock times", () => {
  assert.deepEqual(buildCivilWindow("2026-07-28", 20 * 60, 12 * 60), {
    startDateKey: "2026-07-28",
    startTime: "20:00",
    endDateKey: "2026-07-29",
    endTime: "08:00",
    durationMinutes: 720
  });
});

await check("civil day arithmetic remains DST-safe", () => {
  assert.equal(addCivilDays("2026-03-07", 1), "2026-03-08");
  assert.equal(addCivilDays("2026-03-08", 1), "2026-03-09");
  assert.equal(
    dateKeyForInstant("2026-03-08T06:30:00.000Z", "America/New_York"),
    "2026-03-08"
  );
  assert.equal(
    dateKeyForInstant("2026-03-09T03:30:00.000Z", "America/New_York"),
    "2026-03-08"
  );
});

await check("badge presentation hides Today and supplies Full and Mini content", () => {
  const hidden = getDayPreviewPresentation({
    active: false,
    dateKey: "2026-07-27",
    todayDateKey: "2026-07-27"
  }, "en-US");
  assert.equal(hidden.hidden, true);
  const visible = getDayPreviewPresentation({
    active: true,
    dateKey: "2026-07-28",
    todayDateKey: "2026-07-27"
  }, "en-US");
  assert.equal(visible.hidden, false);
  assert.equal(visible.fullTitle, "DAY PREVIEW");
  assert.match(visible.fullDate, /Tuesday/);
  assert.match(visible.miniText, /^Tomorrow · Jul 28$/);
});

await check("loading and unavailable states reject stale event payloads", () => {
  const loading = {
    active: true,
    dateKey: "2026-07-28",
    phase: "loading"
  };
  assert.equal(shouldAcceptPreviewEvents(loading, "2026-07-27"), false);
  assert.equal(shouldAcceptPreviewEvents(loading, "2026-07-28"), false);
  assert.equal(shouldAcceptPreviewEvents({
    ...loading,
    phase: "ready"
  }, "2026-07-27"), false);
  assert.equal(shouldAcceptPreviewEvents({
    ...loading,
    phase: "ready"
  }, "2026-07-28"), true);
  assert.equal(shouldAcceptPreviewEvents({
    ...loading,
    phase: "unavailable"
  }, "2026-07-28"), false);
});

await check("provider navigation is bounded and reports capability failure", async () => {
  const missing = await navigateWithPeriodControls({
    targetDateKey: "2026-07-28",
    todayDateKey: "2026-07-27",
    readVisibleDateKeys: () => ["2026-07-27"],
    findControl: () => null
  });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /control is unavailable/);

  let visible = ["2026-07-27"];
  let clicks = 0;
  const success = await navigateWithPeriodControls({
    targetDateKey: "2026-07-28",
    todayDateKey: "2026-07-27",
    readVisibleDateKeys: () => visible,
    findControl: action => action === "next" ? {
      click() {
        clicks += 1;
        visible = ["2026-07-28"];
      }
    } : null,
    waitForVisibleDateKeys: async () => visible,
    maxAttempts: 3
  });
  assert.equal(success.ok, true);
  assert.equal(clicks, 1);
  assert.ok(success.navigationCount <= 3);
});

await check("provider navigation permits a bounded seven-day view transition", async () => {
  let visible = ["2026-07-28"];
  let clicks = 0;
  const result = await navigateWithPeriodControls({
    targetDateKey: "2026-08-01",
    todayDateKey: "2026-07-28",
    readVisibleDateKeys: () => visible,
    findControl: action => action === "next" ? {
      click() {
        clicks += 1;
        visible = [addCivilDays(visible[0], 1)];
      }
    } : null,
    waitForVisibleDateKeys: async () => visible,
    maxAttempts: OUTLOOK_DAY_TRANSITION_MAX_ATTEMPTS
  });
  assert.equal(result.ok, true);
  assert.equal(clicks, 4);
  assert.equal(result.navigationCount, 4);
  assert.ok(result.navigationCount <= OUTLOOK_DAY_TRANSITION_MAX_ATTEMPTS);
});

await check("Google and Outlook expose provider-owned month ranges", () => {
  const googleDates = getGoogleNavigableDateKeys({
    readHostDateKeys: () => [],
    window: { location: { pathname: "/calendar/u/0/r/month/2026/7/27" } }
  });
  assert.equal(googleDates[0], "2026-07-01");
  assert.equal(googleDates.at(-1), "2026-07-31");

  const outlookDates = getOutlookNavigableDateKeys({
    readHostDateKeys: () => [],
    document: {
      querySelectorAll: () => [
        { closest: () => null, getAttribute: () => "2026-07-31" },
        { closest: () => null, getAttribute: () => "2026-08-01" }
      ]
    }
  });
  assert.deepEqual(outlookDates, ["2026-07-31", "2026-08-01"]);
});

await check("provider navigation prefers the active view over mini-calendar controls", () => {
  const makeControl = (text, iconNames = []) => ({
    textContent: text,
    getAttribute(name) {
      return name === "aria-label" ? text : null;
    },
    querySelectorAll() {
      return iconNames.map(iconName => ({
        textContent: "",
        getAttribute: name => name === "data-icon-name" ? iconName : null
      }));
    }
  });

  const googleNextWeek = makeControl("Next week");
  const googleNextMonth = makeControl("Next month");
  assert.equal(getGoogleViewPeriod("/calendar/u/0/r/week"), "week");
  assert.ok(
    scoreGoogleNavigationCandidate(googleNextWeek, "next", "week")
      > scoreGoogleNavigationCandidate(googleNextMonth, "next", "week")
  );

  const outlookNextDay = makeControl("Go to next day July 29, 2026");
  const outlookNextMonth = makeControl("Go to next month August");
  assert.equal(getOutlookViewPeriod("/calendar/0/view/day"), "day");
  assert.ok(
    scoreOutlookNavigationCandidate(outlookNextDay, "next", "day")
      > scoreOutlookNavigationCandidate(outlookNextMonth, "next", "day")
  );
});

await check("Outlook exposes a locale-independent Day view capability", () => {
  const commandControl = {
    disabled: false,
    closest: () => null
  };
  const iconControl = {
    disabled: false,
    closest: selector => selector === "button, [role='button']" ? commandControl : null
  };
  assert.equal(getOutlookViewMode("/calendar/0/view/workweek"), "workweek");
  assert.equal(getOutlookViewPeriod("/calendar/0/view/workweek"), "week");
  assert.equal(isWeekendDateKey("2026-08-01"), true);
  assert.equal(isWeekendDateKey("2026-08-02"), true);
  assert.equal(isWeekendDateKey("2026-08-03"), false);
  assert.equal(findOutlookDayViewControl({
    querySelector(selector) {
      if (selector === 'button[data-unique-id="Ribbon-2504"]') return commandControl;
      if (selector === '[data-icon-name="CalendarDayRegular"]') return iconControl;
      return null;
    }
  }), commandControl);
});

await check("Outlook Work week switches to Day before a weekend preview", async () => {
  let mode = "workweek";
  let hostDates = ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31"];
  let clicks = 0;
  const group = {
    parentElement: null,
    querySelectorAll: () => [todayControl, previousControl, nextControl, dateMenu]
  };
  const controlAttributes = values => ({
    disabled: false,
    parentElement: group,
    closest: () => null,
    getAttribute: name => values[name] || null
  });
  const todayControl = controlAttributes({});
  const previousControl = controlAttributes({ toolbaritemtype: "10" });
  const nextControl = controlAttributes({ toolbaritemtype: "10" });
  const dateMenu = controlAttributes({ "aria-haspopup": "menu" });
  const dayControl = {
    disabled: false,
    closest: () => null,
    click() {
      clicks += 1;
      mode = "day";
      hostDates = ["2026-07-31"];
    }
  };
  const prepared = await prepareOutlookViewForTarget({
    targetDateKey: "2026-08-01",
    document: {
      location: {
        get pathname() {
          return `/calendar/0/view/${mode}`;
        }
      },
      querySelector: selector =>
        selector === 'button[data-unique-id="Ribbon-2504"]' ? dayControl : null,
      querySelectorAll: selector =>
        selector === "button, [role='button']"
          ? [todayControl, previousControl, nextControl, dateMenu]
          : []
    },
    readHostDateKeys: () => hostDates,
    pollMs: 1,
    settleTimeoutMs: 250
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.navigationCount, 1);
  assert.equal(clicks, 1);
  assert.deepEqual(prepared.visibleDateKeys, ["2026-07-31"]);
});

await check("host navigation ranges are independent from capture trust", () => {
  const hostWeek = [
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
    "2026-08-02"
  ];
  assert.deepEqual(getGoogleNavigableDateKeys({
    readHostDateKeys: () => hostWeek,
    window: { location: { pathname: "/calendar/u/0/r/week" } }
  }), hostWeek);
  assert.deepEqual(getOutlookNavigableDateKeys({
    readHostDateKeys: () => ["2026-07-28"],
    document: { querySelectorAll: () => [] }
  }), ["2026-07-28"]);
});

await check("Outlook rendered columns outrank stale host capture dates", () => {
  assert.deepEqual(getOutlookNavigableDateKeys({
    readHostDateKeys: () => [
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31"
    ],
    document: {
      querySelectorAll: () => [
        { closest: () => null, getAttribute: () => "2026-08-01" }
      ]
    }
  }), ["2026-08-01"]);
});

await check("preview suppresses reminders and automatic time-driven actions", () => {
  assert.equal(shouldAllowTimeDrivenEffects({ active: true }), false);
  assert.equal(shouldAllowTimeDrivenEffects({ active: false, phase: "loading" }), false);
  assert.equal(shouldAllowTimeDrivenEffects({ active: false, phase: "ready" }), true);
  const reminders = read("src/content/event-reminders/main.mjs");
  const magnifier = read("src/clock/scripts/magnifier-motion.js");
  assert.match(reminders, /setPreviewActive\(active\)[\s\S]*player\.stop\(\)[\s\S]*scheduler\.update/);
  assert.match(reminders, /getSchedulableEvents[\s\S]*previewActive \? \[\] : events/);
  assert.match(magnifier, /clockDayPreviewState\.active !== true[\s\S]*\["loading", "unavailable"\]/);
});

await check("optional loading and provider separation stay deletion-resilient", () => {
  const entry = read("src/content/calendar-content-entry.js");
  const controller = read("src/content/day-preview/controller.mjs");
  assert.match(entry, /import\(chrome\.runtime\.getURL\(CALENDAR_CLOCK_DAY_PREVIEW_MODULE_PATH\)\)/);
  assert.match(entry, /optional Day Preview module is unavailable/);
  assert.doesNotMatch(controller, /calendar\.google\.com|outlook\.live\.com/);
  assert.match(controller, /ADAPTER_PATHS/);
  assert.match(read("src/content/day-preview/providers/google.mjs"), /findGoogleCalendarNavigationControl/);
  assert.match(read("src/content/day-preview/providers/outlook.mjs"), /findOutlookCalendarNavigationControl/);
});

console.log(`Day Preview verification passed (${passed} checks).`);
