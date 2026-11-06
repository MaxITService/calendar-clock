import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createTimer, normalizeTimers, timerValue, timerAtStart, timerFinished, formatTimerTime, parseTimerTime, changeTimer, snapshotTimers, restoreTimers } from "../src/content/timers/model.mjs";
import { install } from "../src/content/timers/controller.mjs";

let timer = createTimer("first");
timer = changeTimer(timer, "start", 1000);
assert.equal(timerValue(timer, 2500), 1500);
assert.equal(formatTimerTime(timerValue(timer, 2500)), "00:00:01");
timer = changeTimer(timer, "pause", 2500);
assert.equal(timerValue(timer, 10000), 1500);
timer = changeTimer(timer, "start", 10000);
assert.equal(timerValue(timer, 11500), 3000);
timer = changeTimer(timer, "stop", 11500);
assert.equal(timerValue(timer, 20000), 3000);
assert.equal(timerValue(changeTimer(timer, "start", 20000), 21000), 1000, "Stop starts a fresh run");
timer = changeTimer(timer, "configure", 20000, { mode: "up", valueMs: 60000 });
assert.equal(timerValue(changeTimer(timer, "start", 20000), 22000), 62000);
timer = changeTimer(timer, "configure", 20000, { mode: "down" });
assert.equal(timer.valueMs, 60000, "Direction can reverse from the current reading");
timer = changeTimer(timer, "start", 20000);
assert.equal(formatTimerTime(timerValue(timer, 20500), "down"), "00:01:00");
assert.equal(timerValue(timer, 90000), 0, "Countdown must never go negative");
assert.equal(timerFinished(timer, 90000), true);
assert.equal(timerValue(changeTimer(timer, "reset", 90000)), 60000);
assert.equal(timerValue(changeTimer(timer, "start", 90000), 91000), 59000, "Finished countdown can restart");
const checkpoint = snapshotTimers([timer], 45000);
const restored = restoreTimers(JSON.parse(JSON.stringify(checkpoint)))[0];
assert.equal(restored.phase, "paused");
assert.equal(timerValue(restored, 99999999), 35000, "Offline time must not be included");
assert.equal(timerValue(changeTimer(restored, "start", 100000000), 100001000), 34000);
const restoredUp = restoreTimers(snapshotTimers([changeTimer(createTimer("up"), "start", 1000)], 9000))[0];
assert.equal(timerValue(restoredUp, 99999999), 8000);
assert.equal(restoreTimers([timer])[0].valueMs, timer.valueMs, "Stored timestamps must never add offline time");
assert.equal(snapshotTimers([timer], 90000)[0].phase, "stopped", "Finished countdown saves at zero");
assert.equal(parseTimerTime("02:03:04"), 7384000);
assert.equal(formatTimerTime(7384999), "02:03:04");
for (const value of ["abc", "-1:00:00", "1.5", "1:2:3:4", "1000:00:00", "5x"]) assert.equal(parseTimerTime(value), null);
for (const [text, seconds] of [["", 0], ["  ", 0], ["5:00", 300], ["500", 300], ["90", 90], ["00:99:00", 5940],
  ["25m", 1500], ["1h 30m", 5400], ["1,5h", 5400], ["45s", 45], ["999:59:59", 3599999]]) {
  assert.equal(parseTimerTime(text), seconds * 1000, `Lenient entry: ${JSON.stringify(text)}`);
}
let resettable = changeTimer(createTimer("reset"), "configure", 0, { mode: "down", valueMs: 60000 });
assert.equal(timerAtStart(resettable), true);
resettable = changeTimer(changeTimer(resettable, "start", 0), "pause", 10000);
resettable = changeTimer(resettable, "reset", 10000);
assert.equal(resettable.valueMs, 60000, "First Reset returns to the starting time");
resettable = changeTimer(resettable, "reset", 10000);
assert.equal(resettable.valueMs + resettable.initialMs, 0, "Reset at the starting time clears to zero");
resettable = changeTimer(resettable, "adjust", 0, { deltaMs: 300000 });
assert.equal(resettable.initialMs, 300000, "Adding to an idle countdown sets its starting time");
resettable = changeTimer(resettable, "start", 0);
resettable = changeTimer(resettable, "adjust", 400000, { deltaMs: 60000 });
assert.equal(resettable.phase, "running", "Adding time to a finished countdown keeps it running");
assert.equal(timerValue(resettable, 430000), 30000);
assert.equal(resettable.initialMs, 300000, "Adding while running keeps the starting time");
assert.deepEqual(normalizeTimers([null, {}, { id: "bad id" }]), []);
assert.equal(normalizeTimers([timer, timer]).length, 1);
assert.equal(changeTimer(createTimer("zero"), "configure", 0, { valueMs: NaN }).valueMs, 0);
// Regression: switching direction used to turn the current reading into the Reset target (e.g. 3 seconds).
let flipped = changeTimer(changeTimer(createTimer("flip"), "start", 0), "configure", 3000, { mode: "down" });
assert.equal(flipped.valueMs, 3000, "Direction change keeps the reading");
assert.equal(flipped.initialMs, 0, "Direction change must not move the Reset target");
assert.equal(flipped.phase, "paused");
let countdown = changeTimer(createTimer("flip-down"), "configure", 0, { mode: "down", valueMs: 300000 });
countdown = changeTimer(changeTimer(countdown, "start", 0), "configure", 3000, { mode: "up" });
countdown = changeTimer(countdown, "configure", 3000, { mode: "down" });
assert.equal(changeTimer(countdown, "reset", 3000).valueMs, 300000, "Reset returns to the time the user set");

// Exercise the panel without browser globals or a running extension.
class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.handlers = {};
    this.dataset = {};
    this.attributes = {};
    this.value = "";
    this.hidden = false;
    this.validityMessage = "";
    this.style = { removeProperty(name) { delete this[name]; } };
    this.capturedPointer = null;
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  after(node) { node.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, listener) { this.handlers[type] = listener; }
  removeEventListener(type) { delete this.handlers[type]; }
  closest(selector) {
    if (this.tagName === selector) return this;
    return this.parent?.closest(selector) ?? null;
  }
  getBoundingClientRect() {
    return { left: parseFloat(this.style.left) || 100, top: parseFloat(this.style.top) || 100, width: 248, height: 200 };
  }
  setPointerCapture(id) { this.capturedPointer = id; }
  hasPointerCapture(id) { return this.capturedPointer === id; }
  releasePointerCapture() { this.capturedPointer = null; }
  click() { if (!this.disabled) this.handlers.click?.(); }
  focus() {}
  select() {}
  setCustomValidity(message) { this.validityMessage = message; }
  reportValidity() { return !this.validityMessage; }
  get lastElementChild() { return this.children.at(-1); }
  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const match = child.find(predicate);
      if (match) return match;
    }
    return null;
  }
  querySelector(selector) {
    if (selector.includes(" ")) {
      const [ancestor, descendant] = selector.split(" ");
      return this.querySelector(ancestor)?.querySelector(descendant);
    }
    return this.find(node => selector.startsWith(".")
      ? node.className?.split(" ").includes(selector.slice(1)) : node.tagName === selector);
  }
}
let sequence = 0;
let intervals = new Map();
const listeners = new Map();
const window = {
  innerWidth: 1200,
  innerHeight: 800,
  crypto: { randomUUID: () => `timer-${++sequence}` },
  setInterval: callback => { const id = ++sequence; intervals.set(id, callback); return id; },
  clearInterval: id => intervals.delete(id),
  addEventListener: (name, callback) => listeners.set(name, callback),
  removeEventListener: name => listeners.delete(name)
};
const document = { createElement: tag => new Node(tag), defaultView: window };
const root = new Node("div");
root.ownerDocument = document;
const surface = new Node("div");
surface.className = "cc-clock-surface";
const visuals = new Node("div");
visuals.className = "cc-visuals-grid";
root.append(surface, visuals);
let state = { mode: "full", timersEnabled: false, timersSide: "right", timers: [] };
let saves = 0;
let cleanup;
let persisted;
let now = 100000;
const originalNow = Date.now;
Date.now = () => now;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, text: async () => "/* styles */" });
try {
  let api;
  api = await install({ root, getState: () => state, saveState: () => {
    saves++;
    persisted = { ...state, timers: api?.snapshot() ?? state.timers };
  }, onContextInvalidated: callback => { cleanup = callback; } });
  const panel = root.querySelector(".cc-timers");
  assert.equal(panel.hidden, true, "Timers default to off");
  const enabled = visuals.querySelector("input");
  enabled.checked = true;
  enabled.handlers.change();
  assert.equal(panel.hidden, false);
  assert.equal(state.timers.length, 1);
  const handle = root.querySelector(".cc-timers-heading");
  const pointer = { button: 0, pointerId: 1, clientX: 110, clientY: 110, target: handle, preventDefault() {} };
  handle.handlers.pointerdown({ ...pointer, target: root.querySelector(".cc-timer-add") });
  assert.equal(handle.capturedPointer, null, "Header buttons must not start dragging");
  handle.handlers.pointerdown({ ...pointer, target: root.querySelector(".cc-timers-close") });
  assert.equal(handle.capturedPointer, null, "Close must not start dragging");
  const grip = root.querySelector(".cc-timers-grip");
  assert.ok(grip, "Header shows a visible drag grip");
  handle.handlers.pointerdown({ ...pointer, target: grip });
  assert.equal(handle.capturedPointer, 1, "The grip starts dragging");
  handle.handlers.pointerup(pointer);
  handle.handlers.pointerdown(pointer);
  handle.handlers.pointermove({ ...pointer, clientX: 400, clientY: 300 });
  handle.handlers.pointerup(pointer);
  assert.equal(persisted.timersX, 390);
  assert.equal(persisted.timersY, 290);
  assert.equal(handle.capturedPointer, null);
  state = JSON.parse(JSON.stringify(persisted));
  api.update();
  assert.equal(panel.style.left, "390px", "Saved position must survive state restore");
  window.innerWidth = 320;
  window.innerHeight = 240;
  listeners.get("resize")();
  assert.equal(state.timersX, 64, "Panel must remain inside a narrower viewport");
  assert.equal(state.timersY, 32);
  window.innerWidth = 1200;
  window.innerHeight = 800;
  handle.handlers.keydown({ target: handle, key: "ArrowRight", preventDefault() {} });
  assert.equal(state.timersX, 74, "Arrow keys move the focused header");
  const side = visuals.querySelector("select");
  side.value = "left";
  side.handlers.change();
  assert.equal(state.timersX, null, "Side selection resets manual positioning");
  assert.equal(panel.style.left, undefined);
  root.querySelector(".cc-timer-add").click();
  assert.equal(state.timers.length, 2);
  assert.equal(root.querySelector(".cc-timer-section"), null, "All timers share a single list");
  const first = state.timers[0].id;
  root.querySelector(".cc-timer-controls button").click();
  assert.equal(state.timers[0].phase, "running");
  assert.equal(state.timers[1].phase, "idle", "Timers run independently");
  assert.equal(intervals.size, 1);
  now += 5000;
  [...intervals.values()][0]();
  assert.equal(persisted.timers[0].phase, "paused");
  assert.equal(persisted.timers[0].valueMs, 5000, "Active timers save regular paused checkpoints");
  assert.equal(state.timers[0].phase, "running", "Checkpoint does not pause the live timer");
  const direction = root.querySelector(".cc-timer-direction select");
  assert.equal(root.querySelector(".cc-timer-settings"), null, "Time is edited directly, not in a settings panel");
  direction.value = "down";
  direction.handlers.change();
  assert.equal(state.timers[0].mode, "down", "Direction can be changed without opening settings");
  assert.equal(state.timers[0].valueMs, 5000, "Switching direction preserves the current reading");
  assert.equal(state.timers[0].phase, "paused", "Changing direction waits for Resume");
  assert.equal(state.timers[0].initialMs, 0, "Changing direction keeps the Reset target");
  assert.equal(state.timers[1].mode, "up", "Each timer has its own direction");
  const reverse = root.querySelector(".cc-timer-direction select");
  reverse.value = "up";
  reverse.handlers.change();
  assert.equal(state.timers[0].valueMs, 5000);
  root.querySelector(".cc-timer-direction select").value = "down";
  root.querySelector(".cc-timer-direction select").handlers.change();
  let display = root.querySelector(".cc-timer-display");
  assert.equal(display.tagName, "button", "Countdown numbers must be keyboard-accessible");
  display.click();
  let editor = root.querySelector(".cc-timer-time-editor");
  assert.equal(editor.hidden, false);
  assert.equal(editor.value, "00:00:05");
  editor.value = "00:12:30";
  editor.handlers.keydown({ key: "Enter", preventDefault() {} });
  assert.equal(state.timers[0].valueMs, 750000, "Enter saves the directly edited countdown");
  assert.equal(persisted.timers[0].initialMs, 750000);
  assert.equal(state.timers[0].phase, "running", "Enter starts a valid countdown");
  display = root.querySelector(".cc-timer-display");
  display.click();
  editor = root.querySelector(".cc-timer-time-editor");
  editor.value = "abc";
  editor.handlers.keydown({ key: "Enter", preventDefault() {} });
  assert.ok(editor.validityMessage, "Invalid time must be rejected");
  assert.equal(state.timers[0].valueMs, 750000);
  editor.handlers.keydown({ key: "Escape", preventDefault() {} });
  editor.handlers.blur();
  assert.equal(editor.hidden, true);
  assert.equal(state.timers[0].valueMs, 750000, "Escape followed by blur must not save");
  display.click();
  editor.value = "00:02:00";
  editor.handlers.blur();
  assert.equal(state.timers[0].initialMs, 120000, "Clicking away saves a valid edited time");
  root.querySelector(".cc-timer-controls button").click();
  now += 1000;
  root.querySelector(".cc-timer-display").click();
  root.querySelector(".cc-timer-time-editor").handlers.blur();
  assert.equal(state.timers[0].phase, "running", "Opening without changing the time must preserve a running timer");
  display = root.querySelector(".cc-timer-display");
  display.click();
  editor = root.querySelector(".cc-timer-time-editor");
  editor.value = "";
  editor.handlers.keydown({ key: "Enter", preventDefault() {} });
  assert.equal(state.timers[0].valueMs, 0, "Deleting everything means 00:00:00");
  assert.equal(state.timers[0].phase, "idle", "Enter cannot start an empty countdown");
  root.querySelector(".cc-timer-display").click();
  editor = root.querySelector(".cc-timer-time-editor");
  editor.value = "zzz";
  editor.handlers.blur();
  assert.equal(editor.hidden, true, "Clicking away from an invalid entry cancels instead of trapping");
  root.querySelector(".cc-timer-adjust button").click();
  assert.equal(state.timers[0].initialMs, 60000, "+1m sets a countdown time");
  const resetButton = root.querySelector(".cc-timer-reset");
  assert.equal(resetButton.textContent, "Clear");
  resetButton.click();
  assert.equal(state.timers[0].initialMs, 0, "Clear empties the starting time");
  assert.equal(root.querySelector(".cc-timer-reset").disabled, true);
  root.querySelector(".cc-timer-display").click();
  editor = root.querySelector(".cc-timer-time-editor");
  editor.value = "5m";
  editor.handlers.keydown({ key: "Enter", preventDefault() {} });
  assert.equal(state.timers[0].mode, "down");
  assert.equal(state.timers[0].initialMs, 300000);
  assert.equal(state.timers[0].phase, "running", "Enter saves and starts");
  root.querySelector(".cc-timer-display").click();
  root.querySelector(".cc-timer-time-editor").handlers.keydown({ key: "Enter", preventDefault() {} });
  assert.equal(state.timers[0].phase, "running", "Enter on an unchanged running timer keeps it running");
  root.querySelector(".cc-timer-play").click();
  assert.equal(state.timers[0].phase, "paused");
  const upDisplay = root.querySelector(".cc-timer-list").children[1].querySelector(".cc-timer-display");
  assert.equal(upDisplay.tagName, "button", "Count-up time is editable too");
  assert.equal(root.querySelector(".cc-timer-list").children[1].querySelector(".cc-timer-adjust").hidden, true);
  assert.equal(root.querySelector(".cc-timer-list").children.length, 2, "Direction changes retain the timer's list position");
  state.timers = state.timers.filter(item => item.id === first);
  api.update();
  root.querySelector(".cc-timer-controls button").click();
  state.mode = "mini";
  api.update();
  assert.equal(panel.hidden, true);
  assert.equal(intervals.size, 0, "Hidden panels need no repaint timer");
  state = JSON.parse(JSON.stringify({ ...state, mode: "full", timersSide: "left" }));
  api.update();
  assert.equal(panel.dataset.side, "left");
  assert.equal(state.timers[0].id, first);
  assert.equal(state.timers[0].phase, "paused", "Hiding pauses the timer");
  assert.equal(intervals.size, 0);
  root.querySelector(".cc-timer-controls button").click();
  now += 3000;
  listeners.get("pagehide")();
  assert.equal(state.timers[0].phase, "paused");
  assert.equal(persisted.timers[0].valueMs, 297000, "Page exit saves the current countdown reading");
  now += 86400000;
  state = JSON.parse(JSON.stringify(persisted));
  api.update();
  assert.equal(timerValue(state.timers[0]), 297000, "Returning after a day preserves the paused reading");
  root.querySelector(".cc-timer-controls button").click();
  enabled.checked = false;
  enabled.handlers.change();
  assert.equal(state.timers[0].phase, "paused", "Switching timers off pauses them");
  assert.equal(panel.hidden, true);
  assert.ok(saves > 0);
  enabled.checked = true;
  enabled.handlers.change();
  const timerIdsBeforeClose = state.timers.map(timer => timer.id);
  root.querySelector(".cc-timer-controls button").click();
  now += 2000;
  const valueBeforeClose = timerValue(state.timers[0]);
  root.querySelector(".cc-timers-close").click();
  assert.equal(panel.hidden, true);
  assert.equal(persisted.timersEnabled, false, "Closing persists the existing visibility setting");
  assert.deepEqual(state.timers.map(timer => timer.id), timerIdsBeforeClose, "Closing keeps the timers");
  assert.equal(timerValue(state.timers[0]), valueBeforeClose, "Closing preserves the current reading");
  assert.equal(state.timers[0].phase, "paused", "Close follows the existing hide-and-pause behavior");
  assert.equal(intervals.size, 0);
  enabled.checked = true;
  enabled.handlers.change();
  assert.equal(panel.hidden, false, "Timers can be reopened through Settings");
  cleanup();
  assert.equal(root.querySelector(".cc-timers"), null);
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
}
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const stateSource = fs.readFileSync(new URL("../src/content/time-window-controller.js", import.meta.url), "utf8");
const persistedHelper = stateSource.slice(stateSource.indexOf("function getCalendarClockPersistedState()"), stateSource.indexOf("function persistCalendarClockState("));
const stateContext = vm.createContext({ calendarClockState: { timersEnabled: true, timersSide: "left", timers: [timer] },
  calendarClockTimers: { snapshot: () => checkpoint } });
vm.runInContext(persistedHelper, stateContext);
const savedState = stateContext.getCalendarClockPersistedState();
assert.equal(savedState.timersSide, "left");
assert.equal(savedState.timersEnabled, true);
assert.equal(savedState.timers[0].phase, "paused");
assert.equal(stateContext.calendarClockState.timers[0].phase, "running", "Saving must not mutate the live state");
delete stateContext.calendarClockTimers;
assert.equal(stateContext.getCalendarClockPersistedState().timers[0], timer, "Missing optional module must not break saving");
assert.ok(manifest.web_accessible_resources.some(entry => entry.resources.includes("src/content/timers/*")));
const menu = fs.readFileSync(new URL("../src/content/overlay/overlay-menu.js", import.meta.url), "utf8");
assert.match(menu, /try \{\s*const timers = await import/);
assert.match(menu, /optional timers module is unavailable/);
console.log("Timer verification passed (timing, controls, persistence, Full-only panel and cleanup).");
