import assert from "node:assert/strict";
import fs from "node:fs";
import { createTimer, normalizeTimers, timerValue, timerFinished, formatTimerTime, parseTimerTime, changeTimer } from "../src/content/timers/model.mjs";
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
const restored = normalizeTimers(JSON.parse(JSON.stringify([timer])))[0];
assert.equal(timerValue(restored, 45000), 35000, "Reload/background time must be included");
assert.equal(parseTimerTime("02:03:04"), 7384000);
assert.equal(formatTimerTime(7384999), "02:03:04");
for (const value of ["abc", "00:60:00", "-1:00:00", "00:00:99", "1.5"]) assert.equal(parseTimerTime(value), null);
assert.deepEqual(normalizeTimers([null, {}, { id: "bad id" }]), []);
assert.equal(normalizeTimers([timer, timer]).length, 1);
assert.equal(changeTimer(createTimer("zero"), "configure", 0, { valueMs: NaN }).valueMs, 0);

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
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  after(node) { node.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, listener) { this.handlers[type] = listener; }
  click() { if (!this.disabled) this.handlers.click?.(); }
  focus() {}
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
const window = {
  crypto: { randomUUID: () => `timer-${++sequence}` },
  setInterval: callback => { const id = ++sequence; intervals.set(id, callback); return id; },
  clearInterval: id => intervals.delete(id)
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
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, text: async () => "/* styles */" });
try {
  const api = await install({ root, getState: () => state, saveState: () => saves++, onContextInvalidated: callback => { cleanup = callback; } });
  const panel = root.querySelector(".cc-timers");
  assert.equal(panel.hidden, true, "Timers default to off");
  const enabled = visuals.querySelector("input");
  enabled.checked = true;
  enabled.handlers.change();
  assert.equal(panel.hidden, false);
  assert.equal(state.timers.length, 1);
  root.querySelector(".cc-timer-add").click();
  assert.equal(state.timers.length, 2);
  const first = state.timers[0].id;
  root.querySelector(".cc-timer-controls button").click();
  assert.equal(state.timers[0].phase, "running");
  assert.equal(state.timers[1].phase, "idle", "Timers run independently");
  assert.equal(intervals.size, 1);
  const gear = root.querySelector(".cc-divider-settings-btn");
  gear.click();
  const details = root.querySelector(".cc-timer-settings");
  assert.equal(details.hidden, false);
  details.querySelector("select").value = "down";
  details.querySelector("input").value = "00:05:00";
  details.querySelector("button").click();
  assert.equal(state.timers[0].mode, "down");
  assert.equal(state.timers[0].initialMs, 300000);
  assert.equal(state.timers[0].phase, "idle");
  root.querySelector(".cc-timer-controls button").click();
  state.mode = "mini";
  api.update();
  assert.equal(panel.hidden, true);
  assert.equal(intervals.size, 0, "Hidden panels need no repaint timer");
  state = JSON.parse(JSON.stringify({ ...state, mode: "full", timersSide: "left" }));
  api.update();
  assert.equal(panel.dataset.side, "left");
  assert.equal(state.timers[0].id, first);
  assert.equal(state.timers[0].phase, "running", "Hiding does not stop a timer");
  assert.equal(intervals.size, 1);
  assert.ok(saves > 0);
  cleanup();
  assert.equal(root.querySelector(".cc-timers"), null);
  assert.equal(intervals.size, 0);
} finally {
  globalThis.fetch = originalFetch;
}
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
assert.ok(manifest.web_accessible_resources.some(entry => entry.resources.includes("src/content/timers/*")));
const menu = fs.readFileSync(new URL("../src/content/overlay/overlay-menu.js", import.meta.url), "utf8");
assert.match(menu, /try \{\s*const timers = await import/);
assert.match(menu, /optional timers module is unavailable/);
console.log("Timer verification passed (timing, controls, persistence, Full-only panel and cleanup).");
