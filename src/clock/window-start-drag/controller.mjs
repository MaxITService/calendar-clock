// Hour-snapped dragging shared by every face, including its magnified copy.
const wrap = (value, cycle) => ((value % cycle) + cycle) % cycle;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function pointerAngle(point, rect) {
    return wrap(Math.atan2(point.clientX - rect.left - rect.width / 2,
        -(point.clientY - rect.top - rect.height / 2)) * 180 / Math.PI, 360);
}

export function isNearMarker(point, rect, line, size, tolerance = 14) {
    if (!size || !rect.width || !rect.height) return false;
    const ax = rect.left + line.x1 / size * rect.width;
    const ay = rect.top + line.y1 / size * rect.height;
    const bx = rect.left + line.x2 / size * rect.width;
    const by = rect.top + line.y2 / size * rect.height;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    if (!Number.isFinite(lengthSquared) || lengthSquared === 0) return false;
    const t = clamp(((point.clientX - ax) * dx + (point.clientY - ay) * dy) / lengthSquared, 0, 1);
    return Math.hypot(point.clientX - ax - t * dx, point.clientY - ay - t * dy) <= tolerance;
}

export function createHourDrag({ followNow, pastHours, startMinutes, cycleMinutes }, angle) {
    const maxPast = cycleMinutes / 60 - 1;
    let position = followNow ? clamp(Math.round(pastHours), 0, maxPast) : Math.round(startMinutes / 60);
    let previousAngle = angle;
    const value = () => followNow
        ? { followNow: true, pastHours: clamp(Math.round(position), 0, maxPast) }
        : { followNow: false, startMinutes: wrap(Math.round(position), 24) * 60 };
    return {
        value,
        move(nextAngle) {
            const delta = wrap(nextAngle - previousAngle + 180, 360) - 180;
            previousAngle = nextAngle;
            position += delta / (360 / (cycleMinutes / 60)) * (followNow ? -1 : 1);
            // Discard overshoot so reversing at either limit responds immediately.
            if (followNow) position = clamp(position, 0, maxPast);
            return value();
        }
    };
}

export function installWindowStartDrag({ stage, clock, magnifiedClock, lens, getState, onChange, onEnd }) {
    const doc = stage.ownerDocument;
    let drag = null;
    let hovered = false;
    const originalCursor = stage.style.cursor;
    const setCursor = value => {
        stage.style.cursor = value || originalCursor;
        stage.classList.toggle("is-window-start-grabbable", value === "grab");
    };

    function hit(event) {
        const state = getState();
        if (!state.enabled) return null;
        let surface = clock;
        if (state.lensVisible) {
            const rect = lens.getBoundingClientRect();
            const x = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2);
            const y = (event.clientY - rect.top - rect.height / 2) / (rect.height / 2);
            if (x * x + y * y <= 1) surface = magnifiedClock;
        }
        const marker = surface.querySelector(".window-start-marker");
        if (!marker) return null;
        const line = Object.fromEntries(["x1", "y1", "x2", "y2"].map(key => [key, Number(marker.getAttribute(key))]));
        const rect = surface.getBoundingClientRect();
        return isNearMarker(event, rect, line, state.size, event.pointerType === "touch" ? 22 : 14)
            ? { state, surface, rect } : null;
    }

    function publish(value, final = false) {
        const key = JSON.stringify(value);
        if (!final && key === drag.lastKey) return;
        drag.lastKey = key;
        onChange({ ...value, final });
    }

    function finish(event) {
        if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
        const pointerId = drag.pointerId;
        publish(drag.motion.value(), true);
        drag = null;
        hovered = false;
        stage.classList.remove("is-window-start-dragging");
        setCursor("");
        if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
        onEnd?.(event);
    }

    doc.addEventListener("pointerdown", event => {
        if (drag || event.button !== 0 || !stage.contains(event.target)) return;
        const target = hit(event);
        if (!target) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        drag = {
            pointerId: event.pointerId,
            surface: target.surface,
            followNow: target.state.followNow,
            cycleMinutes: target.state.cycleMinutes,
            motion: createHourDrag(target.state, pointerAngle(event, target.rect))
        };
        stage.classList.add("is-window-start-dragging");
        setCursor("grabbing");
        stage.setPointerCapture(event.pointerId);
        publish(drag.motion.value());
    }, true);

    doc.addEventListener("pointermove", event => {
        if (!drag) {
            const near = stage.contains(event.target) && Boolean(hit(event));
            if (near !== hovered) { hovered = near; setCursor(near ? "grab" : ""); }
            return;
        }
        if (event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const state = getState();
        if (!state.enabled || state.followNow !== drag.followNow || state.cycleMinutes !== drag.cycleMinutes) {
            finish(event);
            return;
        }
        const rect = drag.surface.getBoundingClientRect();
        // Near the center a tiny movement can flip the pointer angle.
        if (Math.hypot(event.clientX - rect.left - rect.width / 2,
            event.clientY - rect.top - rect.height / 2) < rect.width * 0.08) return;
        publish(drag.motion.move(pointerAngle(event, rect)));
    }, true);

    doc.addEventListener("pointerup", event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        finish(event);
    }, true);
    doc.addEventListener("pointercancel", finish, true);
    stage.addEventListener("lostpointercapture", finish);
    stage.addEventListener("pointerleave", () => {
        if (!drag) { hovered = false; setCursor(""); }
    });
    doc.defaultView.addEventListener("blur", () => finish());
    return { isDragging: () => drag !== null };
}
