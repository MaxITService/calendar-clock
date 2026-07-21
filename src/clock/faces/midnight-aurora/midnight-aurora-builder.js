// Builds the static analog clock DOM for the Midnight Aurora design.
function buildMidnightAuroraClockFace(target) {
    target.innerHTML = "";
    target.classList.remove("is-clock-face-missing");
    target.classList.toggle("is-24-hour", use24HourRadial);
    const size = clockSize || target.offsetWidth;
    const r = size / 2;

    // ── Aurora glow ring (decorative background halo) ──
    const auroraGlow = document.createElement("div");
    auroraGlow.className = "aurora-glow";

    // ── Star particles (decorative background) ──
    const starsEl = document.createElement("div");
    starsEl.className = "aurora-stars";
    const STAR_COUNT = 42;
    // Reset per build so the clock and magnifier render the same star field.
    let randomState = 0xa87012a5;
    const random = () => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return randomState / 0x100000000;
    };
    const rng = (min, max) => min + random() * (max - min);

    for (let i = 0; i < STAR_COUNT; i++) {
        const star = document.createElement("div");
        star.className = "aurora-star";
        // Distribute stars within the circular dial using polar coordinates
        const angle = random() * Math.PI * 2;
        const dist = 0.12 + random() * 0.82; // keep inside dial
        const sx = 50 + Math.cos(angle) * dist * 46;
        const sy = 50 + Math.sin(angle) * dist * 46;
        const starSize = rng(1.2, 3.2);
        Object.assign(star.style, {
            width: starSize + "px",
            height: starSize + "px",
            left: sx + "%",
            top: sy + "%",
        });
        starsEl.appendChild(star);
    }

    // ── Dot rings ──
    function makeMinuteDotRing(config) {
        const ring = document.createElement("div");
        const dotRadius = size * config.radiusRatioFromCenter;
        const dotSize = Math.max(DOT_RING_CONFIG.minDotSize, size * DOT_RING_CONFIG.dotSizeRatio)
            * (config.dotSizeMultiplier || 1);
        const dotCount = use24HourRadial ? 96 : DOT_RING_CONFIG.dotsPerRing;
        const dotStepDeg = 360 / dotCount;

        ring.className = `dot-ring ${config.className}`;
        ring.dataset.dotCount = String(dotCount);
        ring.dataset.radiusRatioFromCenter = String(config.radiusRatioFromCenter);
        ring.dataset.dotSizeMultiplier = String(config.dotSizeMultiplier || 1);
        ring.dataset.radius = String(dotRadius);

        for (let i = 0; i < dotCount; i++) {
            const dot = document.createElement("div");
            dot.className = "minute-dot";
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
        ring.className = "center-shadow-ring";
        ring.dataset.radiusRatioFromCenter = String(DOT_RING_CONFIG.centerShadowRadiusRatioFromCenter);
        ring.dataset.radius = String(ringRadius);
        Object.assign(ring.style, {
            width: (ringRadius * 2) + "px",
            height: (ringRadius * 2) + "px",
        });
        return ring;
    }

    const dotRingsEl = document.createElement("div");
    dotRingsEl.className = "dot-rings";
    dotRingsEl.appendChild(makeCenterShadowRing());
    DOT_RING_CONFIG.rings.forEach(config => {
        dotRingsEl.appendChild(makeMinuteDotRing(config));
    });

    // ── Tick marks ──
    const ticksEl = document.createElement("div");
    ticksEl.className = "ticks";
    const tickCount = use24HourRadial ? 96 : 60;
    const tickStepDeg = 360 / tickCount;

    for (let i = 0; i < tickCount; i++) {
        const isMinuteReference = use24HourRadial ? i % 8 === 0 : i % 5 === 0;
        const isMajor = use24HourRadial ? i % 4 === 0 : isMinuteReference;
        const isMedium = use24HourRadial && i % 2 === 0 && !isMajor;
        const tick = document.createElement("div");
        tick.className = "tick";
        const tickR = isMinuteReference ? r * 0.884 : isMajor ? r * 0.895 : isMedium ? r * 0.905 : r * 0.914;
        const w = isMinuteReference ? r * 0.024 : isMajor ? r * 0.020 : isMedium ? r * 0.011 : r * 0.007;
        const h = isMinuteReference ? r * 0.14553 : isMajor ? r * 0.104 : isMedium ? r * 0.060 : r * 0.034;
        // Color gradient: teal → indigo → purple depending on position
        const hue = 220 + (i / tickCount) * 80; // 220–300 range
        const lum = isMinuteReference ? 82 : isMajor ? 74 : isMedium ? 66 : 58;
        const alpha = isMinuteReference ? 1 : isMajor ? 1 : isMedium ? 0.78 : 0.52;
        Object.assign(tick.style, {
            width: w + "px",
            height: h + "px",
            background: `hsla(${hue}, 76%, ${lum}%, ${alpha})`,
            transform: `translate(-50%,-50%) rotate(${i * tickStepDeg}deg) translateY(-${tickR}px)`,
        });
        ticksEl.appendChild(tick);
    }

    // ── Event arcs SVG (same structure as Emerald Gold for compatibility) ──
    const arcsSvg = document.createElementNS(SVG_NS, "svg");
    arcsSvg.classList.add("time-arcs");
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

    // ── Numbers ──
    const numbersEl = document.createElement("div");
    numbersEl.className = "numbers";
    const numberCount = use24HourRadial ? 24 : 12;
    const numberRadius = use24HourRadial ? r * 0.735 : r * 0.69;

    for (let i = 1; i <= numberCount; i++) {
        const label = use24HourRadial ? String(i % 24) : String(i);
        const angle = use24HourRadial ? i * 15 : i * 30;
        const number = document.createElement("div");
        number.className = use24HourRadial ? "number number-24" : "number";
        number.textContent = label;
        Object.assign(number.style, {
            marginLeft: "-1.224em",
            marginTop: "-1.224em",
            transform: `rotate(${angle}deg) translateY(-${numberRadius}px) rotate(${-angle}deg)`,
        });
        numbersEl.appendChild(number);
    }

    // ── Hands ──
    const handsEl = document.createElement("div");
    handsEl.className = "hands";

    function makeHand(cls, wRatio, hRatio) {
        const el = document.createElement("div");
        el.className = "hand " + cls;
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

    const handWidth = 0.021;
    const hourHand = makeHand("hour-hand", handWidth, 0.252);
    const minHand = makeHand("minute-hand", handWidth * 0.6, 0.386);
    const secHand = makeHand("second-hand", handWidth * 0.3, 0.427);

    const dot = document.createElement("div");
    dot.className = "center";
    const ds = size * 0.052;
    Object.assign(dot.style, {
        width: ds + "px",
        height: ds + "px",
    });

    handsEl.append(hourHand, minHand, secHand, dot);
    target.append(auroraGlow, starsEl, dotRingsEl, ticksEl, arcsSvg, numbersEl, handsEl);
}
