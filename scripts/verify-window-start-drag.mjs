import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHourDrag, isNearMarker, pointerAngle, installWindowStartDrag } from "../src/clock/window-start-drag/controller.mjs";

const follow = (pastHours = 3, cycleMinutes = 720, angle = 0) => createHourDrag({ followNow: true, pastHours, cycleMinutes }, angle);
let motion = follow();
assert.equal(motion.move(14).pastHours, 3);
assert.equal(motion.move(16).pastHours, 2);
assert.equal(motion.move(60).pastHours, 1);
assert.equal(motion.move(120).pastHours, 0);
assert.equal(motion.move(240).pastHours, 0);
assert.equal(motion.move(224).pastHours, 1); // No accumulated overshoot at the limit.
motion = follow(10);
assert.equal(motion.move(300).pastHours, 11);
assert.equal(motion.move(240).pastHours, 11);
assert.equal(motion.move(256).pastHours, 10);
assert.equal(follow(11.5).value().pastHours, 11);
assert.equal(follow(23.5, 1440).value().pastHours, 23);
assert.equal(follow(3, 1440).move(15).pastHours, 2);
assert.equal(follow(3, 720, 350).move(20).pastHours, 2);
motion = createHourDrag({ followNow: false, startMinutes: 23 * 60, cycleMinutes: 720 }, 330);
assert.equal(motion.move(0).startMinutes, 0);
assert.equal(motion.move(330).startMinutes, 23 * 60);
for (let angle = 0; angle < 1440; angle += 0.37) {
    assert.equal(motion.move(angle % 360).startMinutes % 60, 0);
}

const rect = { left: 10, top: 20, width: 400, height: 400 };
const line = { x1: 200, y1: 158, x2: 200, y2: 30 };
assert.equal(pointerAngle({ clientX: 210, clientY: 20 }, rect), 0);
assert.equal(isNearMarker({ clientX: 222, clientY: 100 }, rect, line, 400), true);
assert.equal(isNearMarker({ clientX: 240, clientY: 100 }, rect, line, 400), false);
assert.equal(isNearMarker({ clientX: 210, clientY: 220 }, rect, line, 400), false);

// Exercise real pointer handlers with transformed geometry and pointer capture.
function harness(lensVisible) {
    const handlers = new Map();
    const listen = (type, listener) => {
        if (!handlers.has(type)) handlers.set(type, []);
        handlers.get(type).push(listener);
    };
    const classes = new Set();
    let capture = null;
    const doc = { addEventListener: listen, defaultView: { addEventListener: listen } };
    const stage = {
        ownerDocument: doc, style: { cursor: "" }, contains: target => target === stage,
        classList: { add: value => classes.add(value), remove: value => classes.delete(value),
            toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value) },
        addEventListener: listen, setPointerCapture: id => { capture = id; },
        hasPointerCapture: id => capture === id, releasePointerCapture: () => { capture = null; }
    };
    const surface = rect => ({
        getBoundingClientRect: () => rect,
        querySelector: () => ({ getAttribute: key => line[key] })
    });
    const mainRect = { left: 0, top: 0, width: 400, height: 400 };
    // Magnified center is translated and scaled, as in the real glass lens.
    const zoomRect = { left: -110, top: -110, width: 620, height: 620 };
    const changes = [];
    const controller = installWindowStartDrag({
        stage, clock: surface(mainRect), magnifiedClock: surface(zoomRect),
        lens: { getBoundingClientRect: () => ({ left: 100, top: -40, width: 200, height: 200 }) },
        getState: () => ({ enabled: true, followNow: true, pastHours: 3, startMinutes: 0, cycleMinutes: 720, size: 400, lensVisible }),
        onChange: value => changes.push(value)
    });
    const point = (type, x, y, pointerId = 1) => {
        const event = { target: stage, button: 0, pointerId, clientX: x, clientY: y,
            preventDefault() {}, stopImmediatePropagation() {} };
        (handlers.get(type) || []).forEach(listener => listener(event));
    };
    point("pointerdown", 210, 60); // Includes dot gaps and the invisible hit margin.
    assert.equal(controller.isDragging(), true);
    assert.equal(capture, 1);
    point("pointerup", 210, 60, 2);
    assert.equal(controller.isDragging(), true);
    // Same angular motion through either surface must produce the same hour.
    point("pointermove", 300, 200 - Math.sqrt(3) * 100);
    assert.equal(changes.at(-1).pastHours, 2);
    point("pointerup", 300, 25);
    assert.equal(controller.isDragging(), false);
    assert.equal(capture, null);
    assert.equal(changes.at(-1).final, true);
    assert.equal(stage.style.cursor, "");
}
harness(false);
harness(true);

// Check the receiving side, including bounds, persistence, and preserved Follow Now.
const state = { followNow: true, followRadiusHours: 3, windowStartMarker: true, mode: "full", radial24Hour: false };
const calls = [];
const context = vm.createContext({ calendarClockState: state, onCalendarClockContextInvalidated() {} });
vm.runInContext(fs.readFileSync(new URL("../src/content/time-window-controller.js", import.meta.url), "utf8"), context);
context.applyFollowNowWindow = options => { calls.push(options); return true; };
context.setCustomDividerWindow = (value, options) => { calls.push({ value, ...options }); return true; };
context.formatClockMinutes = minutes => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
for (const pastHours of [-1, 12, 3.5, NaN, "3"]) {
    assert.equal(context.applyWindowStartDrag({ followNow: true, pastHours }), false);
}
assert.equal(context.applyWindowStartDrag({ followNow: true, pastHours: 11 }), true);
assert.equal(state.followRadiusHours, 11);
assert.equal(state.followNow, true);
assert.equal(calls.at(-1).saveDebounceMs, 350);
assert.equal(calls.at(-1).snapWindowStart, true);
context.applyWindowStartDrag({ followNow: true, pastHours: 11, final: true });
assert.equal(calls.at(-1).saveDebounceMs, 0);
assert.equal(calls.at(-1).recapture, true);
state.radial24Hour = true;
assert.equal(context.applyWindowStartDrag({ followNow: true, pastHours: 23 }), true);
assert.equal(context.applyWindowStartDrag({ followNow: true, pastHours: 24 }), false);
state.followNow = false;
assert.equal(context.applyWindowStartDrag({ followNow: false, startMinutes: 60 }), false);
state.radial24Hour = false;
assert.equal(context.applyWindowStartDrag({ followNow: false, startMinutes: 61 }), false);
assert.equal(context.applyWindowStartDrag({ followNow: false, startMinutes: 1440 }), false);
assert.equal(context.applyWindowStartDrag({ followNow: true, pastHours: 2 }), false);
assert.equal(context.applyWindowStartDrag({ followNow: false, startMinutes: 23 * 60, final: true }), true);
assert.equal(calls.at(-1).value, "23:00");
state.windowStartMarker = false;
assert.equal(context.applyWindowStartDrag({ followNow: false, startMinutes: 0 }), false);
console.log("Window-start drag verifier passed (hour snapping, bounds, normal/lens capture, persistence).");
