// Hour-snapped dragging shared by every face, including its magnified copy.
const wrap = (value, cycle) => ((value % cycle) + cycle) % cycle;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function pointerAngle(point, rect) {
    return wrap(Math.atan2(point.clientX - rect.left - rect.width / 2,
        -(point.clientY - rect.top - rect.height / 2)) * 180 / Math.PI, 360);
}

export function isNearMarker(point, rect, line, size, tolerance = 30) {
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
    const initialPosition = followNow ? pastHours : startMinutes / 60;
    let position = followNow ? clamp(initialPosition, 0, maxPast) : initialPosition;
    const degreesPerHour = 360 / (cycleMinutes / 60);
    const direction = followNow ? -1 : 1;
    const angleFor = hours => startMinutes / cycleMinutes * 360 + (hours - initialPosition) * degreesPerHour * direction;
    let previousAngle = angle;
    const value = () => followNow
        ? { followNow: true, pastHours: clamp(Math.round(position), 0, maxPast) }
        : { followNow: false, startMinutes: wrap(Math.round(position), 24) * 60 };
    return {
        value,
        preview: () => ({ angle: angleFor(position), landingAngle: angleFor(Math.round(position)) }),
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
    let pendingLanding = null;
    let suppressClickUntil = 0;
    const ghosts = new Map();
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
        const tolerance = event.pointerType === "touch" ? Math.min(40, rect.width * 0.09) : Math.min(30, rect.width * 0.07);
        return isNearMarker(event, rect, line, state.size, tolerance)
            ? { state, surface, rect } : null;
    }

    function clearGhosts() {
        ghosts.forEach(ghost => ghost.node.remove());
        ghosts.clear();
    }

    function finish(event, cancelled = false) {
        if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
        const pointerId = drag.pointerId;
        const value = drag.motion.value();
        const state = getState();
        const unchanged = value.followNow ? state.pastHours === value.pastHours : state.startMinutes === value.startMinutes;
        if (!cancelled && drag.moved && !unchanged && state.enabled
            && state.followNow === drag.followNow && state.cycleMinutes === drag.cycleMinutes) {
            pendingLanding = { value, angle: drag.motion.preview().landingAngle, until: Date.now() + 800 };
            onChange({ ...value, final: true });
        }
        drag = null;
        suppressClickUntil = Date.now() + 400;
        clearGhosts();
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
            downX: event.clientX, downY: event.clientY,
            threshold: event.pointerType === "touch" ? 6 : 4,
            moved: false,
            surface: clock,
            followNow: target.state.followNow,
            cycleMinutes: target.state.cycleMinutes,
            // Switch to the unzoomed coordinate system before hiding the lens.
            motion: createHourDrag(target.state, pointerAngle(event, clock.getBoundingClientRect()))
        };
        stage.classList.add("is-window-start-dragging");
        setCursor("grabbing");
        stage.setPointerCapture(event.pointerId);
        pendingLanding = null;
        suppressClickUntil = Date.now() + 400;
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
            finish(event, true);
            return;
        }
        const rect = drag.surface.getBoundingClientRect();
        drag.moved ||= Math.hypot(event.clientX - drag.downX, event.clientY - drag.downY) > drag.threshold;
        if (!drag.moved) return;
        // Near the center a tiny movement can flip the pointer angle.
        if (Math.hypot(event.clientX - rect.left - rect.width / 2,
            event.clientY - rect.top - rect.height / 2) < rect.width * 0.08) return;
        drag.motion.move(pointerAngle(event, rect));
    }, true);

    doc.addEventListener("pointerup", event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const rect = clock.getBoundingClientRect();
        drag.moved ||= Math.hypot(event.clientX - drag.downX, event.clientY - drag.downY) > drag.threshold;
        if (drag.moved && Math.hypot(event.clientX - rect.left - rect.width / 2,
            event.clientY - rect.top - rect.height / 2) >= rect.width * 0.08) {
            drag.motion.move(pointerAngle(event, rect));
        }
        finish(event);
    }, true);
    for (const type of ["click", "dblclick"]) {
        doc.addEventListener(type, event => {
            if (event.detail !== 0 && stage.contains(event.target) && (drag || Date.now() < suppressClickUntil)) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);
    }
    doc.addEventListener("pointercancel", event => finish(event, true), true);
    stage.addEventListener("lostpointercapture", event => finish(event, true));
    doc.addEventListener("keydown", event => {
        if (event.key === "Escape" && drag) { event.preventDefault(); finish(undefined, true); }
    }, true);
    stage.addEventListener("pointerleave", () => {
        if (!drag) { hovered = false; setCursor(""); }
    });
    doc.defaultView.addEventListener("blur", () => finish(undefined, true));
    return {
        isDragging: () => drag !== null,
        getPreview() {
            if (drag) return drag.motion.preview();
            if (!pendingLanding) return null;
            const state = getState();
            const applied = pendingLanding.value.followNow
                ? state.pastHours === pendingLanding.value.pastHours
                : state.startMinutes === pendingLanding.value.startMinutes;
            if (applied || Date.now() > pendingLanding.until || !state.enabled) {
                pendingLanding = null;
                return null;
            }
            return { angle: pendingLanding.angle, landingAngle: null };
        },
        updateGhost(svg, marker, emojiGroup, preview, size) {
            if (!drag || preview?.landingAngle == null) { clearGhosts(); return; }
            let ghost = ghosts.get(svg);
            if (!ghost || !ghost.node.isConnected) {
                const node = doc.createElementNS("http://www.w3.org/2000/svg", "g");
                node.setAttribute("opacity", "0.3");
                node.setAttribute("pointer-events", "none");
                node.setAttribute("aria-hidden", "true");
                // Keep the face's exact dot/line/emoji styling without duplicating IDs or marker selectors.
                for (const source of [marker, emojiGroup].filter(Boolean)) {
                    const copy = source.cloneNode(true);
                    copy.removeAttribute("id");
                    copy.removeAttribute("class");
                    copy.querySelectorAll("[id]").forEach(child => child.removeAttribute("id"));
                    if (source === marker) {
                        for (const name of ["stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "opacity", "filter"]) {
                            copy.style.setProperty(name, doc.defaultView.getComputedStyle(source).getPropertyValue(name));
                        }
                    }
                    node.append(copy);
                }
                svg.insertBefore(node, marker);
                ghost = { node, angle: preview.angle };
                ghosts.set(svg, ghost);
            }
            ghost.node.setAttribute("transform", `rotate(${preview.landingAngle - ghost.angle} ${size / 2} ${size / 2})`);
        }
    };
}
