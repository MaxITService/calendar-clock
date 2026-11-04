import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHourDrag, isNearMarker, pointerAngle, installWindowStartDrag } from "../src/clock/window-start-drag/controller.mjs";

const follow = (pastHours = 3, cycleMinutes = 720, angle = 0) => createHourDrag({ followNow: true, pastHours, startMinutes: 0, cycleMinutes }, angle);
let motion = follow();
assert.equal(motion.move(14).pastHours, 3);
assert.ok(Math.abs(motion.preview().angle - 14) < 1e-9);
assert.equal(motion.preview().landingAngle, 0);
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
assert.equal(isNearMarker({ clientX: 238, clientY: 100 }, rect, line, 400), true);
assert.equal(isNearMarker({ clientX: 245, clientY: 100 }, rect, line, 400), false);
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
    const node = () => ({
        isConnected: true, attributes: {}, children: [],
        style: { setProperty() {} },
        setAttribute(key, value) { this.attributes[key] = value; },
        removeAttribute(key) { delete this.attributes[key]; },
        querySelectorAll() { return []; },
        append(child) { this.children.push(child); },
        cloneNode() { return node(); },
        remove() { this.isConnected = false; }
    });
    const doc = { addEventListener: listen, createElementNS: node,
        defaultView: { addEventListener: listen, getComputedStyle: () => ({ getPropertyValue: () => "none" }) } };
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
    const state = { enabled: true, followNow: true, pastHours: 3, startMinutes: 0, cycleMinutes: 720, size: 400, lensVisible };
    const controller = installWindowStartDrag({
        stage, clock: surface(mainRect), magnifiedClock: surface(zoomRect),
        lens: { getBoundingClientRect: () => ({ left: 100, top: -40, width: 200, height: 200 }) },
        getState: () => state,
        onChange: value => changes.push(value)
    });
    const point = (type, x, y, pointerId = 1) => {
        const event = { target: stage, button: 0, pointerId, clientX: x, clientY: y,
            preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
        (handlers.get(type) || []).forEach(listener => listener(event));
        return event;
    };
    point("pointerdown", 210, 60); // Includes dot gaps and the invisible hit margin.
    assert.equal(controller.isDragging(), true);
    assert.equal(capture, 1);
    point("pointerup", 210, 60, 2);
    assert.equal(controller.isDragging(), true);
    // Same angular motion through either surface must produce the same hour.
    point("pointermove", 300, 200 - Math.sqrt(3) * 100);
    assert.equal(changes.length, 0); // Moving only previews; releasing applies the value.
    assert.equal(Math.round(controller.getPreview().landingAngle), 30);
    let ghost = null;
    const svg = { insertBefore: child => { ghost = child; } };
    controller.updateGhost(svg, node(), node(), controller.getPreview(), 400);
    assert.equal(ghost.attributes.opacity, "0.3");
    assert.equal(ghost.attributes["pointer-events"], "none");
    assert.equal(ghost.children.length, 2); // Preserve both line/dots and emoji appearances.
    assert.match(ghost.attributes.transform, /^rotate\(/);
    point("pointerup", 300, 25);
    assert.equal(controller.isDragging(), false);
    assert.equal(capture, null);
    assert.equal(ghost.isConnected, false);
    assert.equal(changes.at(-1).final, true);
    assert.equal(changes.at(-1).pastHours, 2);
    assert.equal(changes.length, 1);
    assert.equal(stage.style.cursor, "");
    point("pointerdown", 225, 60); // Wider hit margin, including gaps between dots.
    assert.equal(controller.isDragging(), true);
    point("pointercancel", 300, 25);
    assert.equal(controller.isDragging(), false);
    assert.equal(changes.length, 1);
    assert.equal(controller.getPreview(), null);
    return { controller, point, handlers, state, changes };
}
for (const test of [harness(false), harness(true)]) {
    const { controller, point, handlers, state, changes } = test;
    // A click or a tiny tremor must not round a preexisting half-hour setting.
    for (const followNow of [true, false]) {
        Object.assign(state, { followNow, pastHours: 2.5, startMinutes: 510 });
        point("pointerdown", 210, 60);
        point("pointermove", 211, 61);
        point("pointerup", 211, 61);
        assert.equal(changes.length, 1);
        assert.equal(point("click", 211, 61).stopped, true);
        assert.equal(point("dblclick", 211, 61).prevented, true);
    }
    // A genuine drag with the same rounded result also avoids a redundant save.
    Object.assign(state, { followNow: true, pastHours: 3, startMinutes: 0 });
    point("pointerdown", 210, 60);
    point("pointermove", 225, 60);
    point("pointerup", 225, 60);
    assert.equal(changes.length, 1);
    // Manual dragging also works when the original grab happened through the loupe.
    Object.assign(state, { followNow: false, startMinutes: 510 });
    point("pointerdown", 210, 60);
    point("pointermove", 300, 25);
    point("pointerup", 300, 25);
    assert.equal(changes.at(-1).startMinutes, 540);
    assert.equal(changes.length, 2);
    assert.equal(controller.getPreview().landingAngle, null, "Hold landing until the parent applies the value");
    state.startMinutes = 540;
    assert.equal(controller.getPreview(), null);
    for (const cancel of ["escape", "blur", "mode-change"]) {
        Object.assign(state, { followNow: true, pastHours: 3, startMinutes: 0 });
        point("pointerdown", 210, 60);
        point("pointermove", 300, 25);
        if (cancel === "escape") handlers.get("keydown").forEach(listener => listener({ key: "Escape", preventDefault() {} }));
        if (cancel === "blur") point("blur", 300, 25);
        if (cancel === "mode-change") { state.followNow = false; point("pointermove", 310, 25); }
        assert.equal(controller.isDragging(), false);
        assert.equal(changes.length, 2);
    }
}

// Settings received while the loupe is suppressed must still update its live configuration.
const magnifierSource = fs.readFileSync(new URL("../src/clock/scripts/magnifier-motion.js", import.meta.url), "utf8");
const applyMagnifier = magnifierSource.slice(magnifierSource.indexOf("function applyMagnifierSettings("));
const appliedSettings = [];
const magnifierContext = { windowStartDragController: { isDragging: () => true } };
for (const setter of ["setMagnifierLensSize", "setMagnifierAutoIntervalSeconds", "setMagnifierHoverEnabled", "setMagnifierCenterCursorVisible", "setMagnifierAutoEnabled", "setMagnifierAutoTriggers", "setMagnifierEnabled"]) {
    magnifierContext[setter] = value => appliedSettings.push([setter, value]);
}
vm.runInNewContext(applyMagnifier, magnifierContext);
magnifierContext.applyMagnifierSettings({ lensSize: 600, enabled: false });
assert.ok(appliedSettings.some(([setter, value]) => setter === "setMagnifierLensSize" && value === 600));
assert.ok(appliedSettings.some(([setter, value]) => setter === "setMagnifierEnabled" && value === false));

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
console.log("Window-start drag verifier passed (continuous preview, hour landing, wide normal/lens capture, cancellation, persistence).");
