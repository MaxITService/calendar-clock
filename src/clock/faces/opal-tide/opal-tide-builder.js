// Builds the Opal Tide clock face with sea-glass rings, brass ticks, and ink hands.
function buildOpalTideClockFace(target) {
    target.innerHTML = "";
    target.classList.remove("is-clock-face-missing");
    target.classList.toggle("is-24-hour", use24HourRadial);
    const size = clockSize || target.offsetWidth;
    const r = size / 2;

    const washEl = document.createElement("div");
    washEl.className = "ot-wash";

    const tideLinesEl = document.createElement("div");
    tideLinesEl.className = "ot-tide-lines";
    for (let i = 0; i < 4; i++) {
        const line = document.createElement("div");
        line.className = "ot-tide-line";
        line.style.transform = `translate(-50%, -50%) rotate(${i * 42 + 8}deg)`;
        tideLinesEl.appendChild(line);
    }

    const inlaysEl = document.createElement("div");
    inlaysEl.className = "ot-inlays";
    for (let i = 0; i < 18; i++) {
        const inlay = document.createElement("div");
        const angle = i * 137.508;
        const distance = 14 + (i * 19) % 68;
        const x = 50 + Math.sin(angle * Math.PI / 180) * distance * 0.48;
        const y = 50 - Math.cos(angle * Math.PI / 180) * distance * 0.48;
        const inlaySize = 2 + (i % 5) * 0.55;
        inlay.className = "ot-inlay";
        Object.assign(inlay.style, {
            width: inlaySize + "px",
            height: inlaySize * (i % 3 === 0 ? 1.8 : 1) + "px",
            left: x + "%",
            top: y + "%",
            transform: `translate(-50%, -50%) rotate(${angle + 24}deg)`,
        });
        inlaysEl.appendChild(inlay);
    }

    function makeMinuteDotRing(config) {
        const ring = document.createElement("div");
        const dotRadius = size * config.radiusRatioFromCenter;
        const dotSize = Math.max(DOT_RING_CONFIG.minDotSize, size * DOT_RING_CONFIG.dotSizeRatio)
            * (config.dotSizeMultiplier || 1);
        const dotCount = use24HourRadial ? 96 : DOT_RING_CONFIG.dotsPerRing;
        const dotStepDeg = 360 / dotCount;

        ring.className = `ot-dot-ring ${config.className}`;
        ring.dataset.dotCount = String(dotCount);
        ring.dataset.radiusRatioFromCenter = String(config.radiusRatioFromCenter);
        ring.dataset.dotSizeMultiplier = String(config.dotSizeMultiplier || 1);
        ring.dataset.radius = String(dotRadius);

        for (let i = 0; i < dotCount; i++) {
            const dot = document.createElement("div");
            dot.className = "ot-minute-dot";
            Object.assign(dot.style, {
                width: dotSize + "px",
                height: dotSize + "px",
                transform: `translate(-50%,-50%) rotate(${i * dotStepDeg}deg) translateY(-${dotRadius}px)`,
            });
            ring.appendChild(dot);
        }

        return ring;
    }

    function makeCenterShadowRing() {
        const ring = document.createElement("div");
        const ringRadius = size * DOT_RING_CONFIG.centerShadowRadiusRatioFromCenter;
        ring.className = "ot-center-shadow-ring";
        ring.dataset.radiusRatioFromCenter = String(DOT_RING_CONFIG.centerShadowRadiusRatioFromCenter);
        ring.dataset.radius = String(ringRadius);
        Object.assign(ring.style, {
            width: (ringRadius * 2) + "px",
            height: (ringRadius * 2) + "px",
        });
        return ring;
    }

    const dotRingsEl = document.createElement("div");
    dotRingsEl.className = "ot-dot-rings";
    dotRingsEl.appendChild(makeCenterShadowRing());
    DOT_RING_CONFIG.rings.forEach(config => {
        dotRingsEl.appendChild(makeMinuteDotRing(config));
    });

    const ticksEl = document.createElement("div");
    ticksEl.className = "ot-ticks";
    const tickCount = use24HourRadial ? 96 : 60;
    const tickStepDeg = 360 / tickCount;

    for (let i = 0; i < tickCount; i++) {
        const isMinuteReference = use24HourRadial ? i % 8 === 0 : i % 5 === 0;
        const isMajor = use24HourRadial ? i % 4 === 0 : isMinuteReference;
        const isMedium = use24HourRadial && i % 2 === 0 && !isMajor;
        const tick = document.createElement("div");
        tick.className = "ot-tick";
        const tickR = isMinuteReference ? r * 0.884 : isMajor ? r * 0.897 : isMedium ? r * 0.907 : r * 0.916;
        const w = isMinuteReference ? r * 0.023 : isMajor ? r * 0.018 : isMedium ? r * 0.010 : r * 0.006;
        const h = isMinuteReference ? r * 0.134 : isMajor ? r * 0.096 : isMedium ? r * 0.056 : r * 0.031;
        const hue = isMinuteReference ? 38 : isMajor ? 188 : 202;
        const saturation = isMinuteReference ? 70 : 42;
        const lightness = isMinuteReference ? 48 : isMajor ? 38 : 44;
        const alpha = isMinuteReference ? 0.98 : isMajor ? 0.82 : isMedium ? 0.56 : 0.34;
        Object.assign(tick.style, {
            width: w + "px",
            height: h + "px",
            background: `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`,
            transform: `translate(-50%,-50%) rotate(${i * tickStepDeg}deg) translateY(-${tickR}px)`,
        });
        ticksEl.appendChild(tick);
    }

    const arcsSvg = document.createElementNS(SVG_NS, "svg");
    arcsSvg.classList.add("ot-time-arcs", "time-arcs");
    arcsSvg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    arcsSvg.setAttribute("aria-hidden", "true");
    const faceId = String(target.id || "clock-face").replace(/[^\w-]/g, "-");

    const windowStartMarker = document.createElementNS(SVG_NS, "line");
    windowStartMarker.classList.add("window-start-marker");
    arcsSvg.appendChild(windowStartMarker);

    calendarEvents.forEach((event, index) => {
        const arc = document.createElementNS(SVG_NS, "path");
        arc.id = `calendar-clock-${faceId}-event-arc-${index + 1}`;
        arc.classList.add("time-arc", `time-arc-${index + 1}`, `time-event-${index + 1}`);
        arc.dataset.rangeIndex = String(index);
        arc.setAttribute("stroke", event.color);
        arc.style.color = event.color;
        attachArcTooltipEvents(arc);
        arcsSvg.appendChild(arc);

        const point = document.createElementNS(SVG_NS, "circle");
        point.classList.add("time-point", `time-point-${index + 1}`, `time-event-${index + 1}`);
        point.dataset.rangeIndex = String(index);
        point.setAttribute("fill", event.color);
        point.setAttribute("stroke", event.color);
        point.style.color = event.color;
        attachArcTooltipEvents(point);
        arcsSvg.appendChild(point);

        const separator = document.createElementNS(SVG_NS, "g");
        const separatorShadow = document.createElementNS(SVG_NS, "line");
        const separatorCut = document.createElementNS(SVG_NS, "line");
        separator.classList.add("time-arc-separator", `time-arc-separator-${index + 1}`, `time-event-${index + 1}`);
        separator.setAttribute("aria-hidden", "true");
        separator.style.color = event.color;
        separatorShadow.classList.add("time-arc-separator-shadow");
        separatorCut.classList.add("time-arc-separator-cut");
        separator.append(separatorShadow, separatorCut);
        arcsSvg.appendChild(separator);
    });

    calendarEvents.forEach((event, index) => {
        const labelPath = document.createElementNS(SVG_NS, "path");
        const label = document.createElementNS(SVG_NS, "text");
        const textPath = document.createElementNS(SVG_NS, "textPath");
        const labelPathId = `calendar-clock-${faceId}-event-label-path-${index + 1}`;
        labelPath.id = labelPathId;
        labelPath.classList.add("time-arc-label-path", `time-arc-label-path-${index + 1}`);
        labelPath.setAttribute("fill", "none");
        labelPath.setAttribute("stroke", "none");
        labelPath.setAttribute("pointer-events", "none");
        arcsSvg.appendChild(labelPath);

        label.classList.add("time-arc-label", `time-arc-label-${index + 1}`);
        label.dataset.rangeIndex = String(index);
        label.style.color = event.color;
        label.style.setProperty("--event-color", event.color);
        label.setAttribute("dy", "0.34em");
        textPath.setAttribute("href", `#${labelPathId}`);
        textPath.setAttribute("startOffset", "50%");
        textPath.setAttribute("text-anchor", "middle");
        label.appendChild(textPath);
        arcsSvg.appendChild(label);

        const callout = document.createElementNS(SVG_NS, "g");
        const calloutLine = document.createElementNS(SVG_NS, "path");
        const calloutDot = document.createElementNS(SVG_NS, "circle");
        const calloutLabel = document.createElementNS(SVG_NS, "text");
        callout.classList.add("time-point-callout", `time-point-callout-${index + 1}`, `time-event-${index + 1}`);
        callout.dataset.rangeIndex = String(index);
        callout.style.color = event.color;
        callout.style.setProperty("--event-color", event.color);
        calloutLine.classList.add("time-point-callout-line");
        calloutDot.classList.add("time-point-callout-dot");
        calloutLabel.classList.add("time-arc-label", "time-point-callout-label");
        calloutLabel.dataset.rangeIndex = String(index);
        calloutLabel.style.color = event.color;
        calloutLabel.style.setProperty("--event-color", event.color);
        callout.append(calloutLine, calloutDot, calloutLabel);
        arcsSvg.appendChild(callout);
    });

    const numbersEl = document.createElement("div");
    numbersEl.className = "ot-numbers numbers";
    const numberCount = use24HourRadial ? 24 : 12;
    const numberRadius = use24HourRadial ? r * 0.733 : r * 0.688;

    for (let i = 1; i <= numberCount; i++) {
        const label = use24HourRadial ? String(i % 24) : String(i);
        const angle = use24HourRadial ? i * 15 : i * 30;
        const number = document.createElement("div");
        number.className = use24HourRadial
            ? "ot-number number ot-number-24 number-24"
            : "ot-number number";
        number.textContent = label;
        Object.assign(number.style, {
            marginLeft: "-1.22em",
            marginTop: "-1.22em",
            transform: `rotate(${angle}deg) translateY(-${numberRadius}px) rotate(${-angle}deg)`,
        });
        numbersEl.appendChild(number);
    }

    const handsEl = document.createElement("div");
    handsEl.className = "ot-hands hands";

    function makeHand(classes, wRatio, hRatio) {
        const el = document.createElement("div");
        el.className = "ot-hand hand " + classes;
        const w = size * wRatio;
        const h = size * hRatio;
        Object.assign(el.style, {
            width: w + "px",
            height: h + "px",
            marginLeft: (-w / 2) + "px",
            marginTop: (-h) + "px",
        });
        return el;
    }

    const handWidth = 0.022;
    const hourHand = makeHand("ot-hour-hand hour-hand", handWidth, 0.25);
    const minHand = makeHand("ot-minute-hand minute-hand", handWidth * 0.56, 0.382);
    const secHand = makeHand("ot-second-hand second-hand", handWidth * 0.28, 0.428);

    const dot = document.createElement("div");
    dot.className = "ot-center center";
    const ds = size * 0.054;
    Object.assign(dot.style, {
        width: ds + "px",
        height: ds + "px",
    });

    handsEl.append(hourHand, minHand, secHand, dot);
    target.append(washEl, tideLinesEl, inlaysEl, dotRingsEl, ticksEl, arcsSvg, numbersEl, handsEl);
}
