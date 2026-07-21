// Builds the Sterling Sector face: a restrained steel dress-watch dial.
function buildSterlingSectorClockFace(target) {
    target.innerHTML = "";
    target.classList.remove("is-clock-face-missing");
    target.classList.toggle("is-24-hour", use24HourRadial);
    const size = clockSize || target.offsetWidth;
    const r = size / 2;

    const sunburstEl = document.createElement("div");
    sunburstEl.className = "ss-sunburst";

    const sectorEl = document.createElement("div");
    sectorEl.className = "ss-sector";

    const rehautEl = document.createElement("div");
    rehautEl.className = "ss-rehaut";

    const flutingEl = document.createElement("div");
    flutingEl.className = "ss-fluting";

    function makeMinuteDotRing(config) {
        const ring = document.createElement("div");
        const dotRadius = size * config.radiusRatioFromCenter;
        const dotSize = Math.max(DOT_RING_CONFIG.minDotSize, size * DOT_RING_CONFIG.dotSizeRatio)
            * (config.dotSizeMultiplier || 1);
        const dotCount = use24HourRadial ? 96 : DOT_RING_CONFIG.dotsPerRing;
        const dotStepDeg = 360 / dotCount;

        ring.className = `ss-dot-ring ${config.className}`;
        ring.dataset.dotCount = String(dotCount);
        ring.dataset.radiusRatioFromCenter = String(config.radiusRatioFromCenter);
        ring.dataset.dotSizeMultiplier = String(config.dotSizeMultiplier || 1);
        ring.dataset.radius = String(dotRadius);

        for (let i = 0; i < dotCount; i++) {
            const dot = document.createElement("div");
            dot.className = "ss-minute-dot";
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
        ring.className = "ss-center-shadow-ring";
        ring.dataset.radiusRatioFromCenter = String(DOT_RING_CONFIG.centerShadowRadiusRatioFromCenter);
        ring.dataset.radius = String(ringRadius);
        Object.assign(ring.style, {
            width: (ringRadius * 2) + "px",
            height: (ringRadius * 2) + "px",
        });
        return ring;
    }

    const dotRingsEl = document.createElement("div");
    dotRingsEl.className = "ss-dot-rings";
    dotRingsEl.appendChild(makeCenterShadowRing());
    DOT_RING_CONFIG.rings.forEach(config => {
        dotRingsEl.appendChild(makeMinuteDotRing(config));
    });

    const ticksEl = document.createElement("div");
    ticksEl.className = "ss-ticks";
    const tickCount = use24HourRadial ? 96 : 60;
    const tickStepDeg = 360 / tickCount;

    for (let i = 0; i < tickCount; i++) {
        const isReference = use24HourRadial ? i % 8 === 0 : i % 5 === 0;
        const isMajor = use24HourRadial ? i % 4 === 0 : isReference;
        const isMedium = use24HourRadial && i % 2 === 0 && !isMajor;
        const tick = document.createElement("div");
        tick.className = "ss-tick";
        tick.classList.toggle("ss-tick-reference", isReference);
        tick.classList.toggle("ss-tick-major", isMajor);
        tick.classList.toggle("ss-tick-medium", isMedium);
        const tickR = isReference ? r * 0.879 : isMajor ? r * 0.894 : isMedium ? r * 0.905 : r * 0.916;
        const w = isReference ? r * 0.023 : isMajor ? r * 0.015 : isMedium ? r * 0.009 : r * 0.0055;
        const h = isReference ? r * 0.137 : isMajor ? r * 0.082 : isMedium ? r * 0.050 : r * 0.026;
        Object.assign(tick.style, {
            width: w + "px",
            height: h + "px",
            transform: `translate(-50%,-50%) rotate(${i * tickStepDeg}deg) translateY(-${tickR}px)`,
        });
        ticksEl.appendChild(tick);
    }

    const arcsSvg = document.createElementNS(SVG_NS, "svg");
    arcsSvg.classList.add("ss-time-arcs", "time-arcs");
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
    numbersEl.className = "ss-numbers numbers";
    const numberCount = use24HourRadial ? 24 : 12;
    const numberRadius = use24HourRadial ? r * 0.724 : r * 0.674;
    const sectorLabels = new Map([[12, "12"], [3, "3"], [6, "6"], [9, "9"]]);

    for (let i = 1; i <= numberCount; i++) {
        const angle = use24HourRadial ? i * 15 : i * 30;
        const label = use24HourRadial ? String(i % 24).padStart(2, "0") : (sectorLabels.get(i) || "");
        const number = document.createElement("div");
        number.className = use24HourRadial
            ? "ss-number number ss-number-24 number-24"
            : "ss-number number";
        number.textContent = label;
        Object.assign(number.style, {
            marginLeft: "-1.18em",
            marginTop: "-1.18em",
            transform: `rotate(${angle}deg) translateY(-${numberRadius}px) rotate(${-angle}deg)`,
        });
        numbersEl.appendChild(number);
    }

    const handsEl = document.createElement("div");
    handsEl.className = "ss-hands hands";

    function makeHand(classes, wRatio, hRatio) {
        const el = document.createElement("div");
        el.className = "ss-hand hand " + classes;
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
    const hourHand = makeHand("ss-hour-hand hour-hand", handWidth, 0.254);
    const minHand = makeHand("ss-minute-hand minute-hand", handWidth * 0.53, 0.392);
    const secHand = makeHand("ss-second-hand second-hand", handWidth * 0.24, 0.425);

    const dot = document.createElement("div");
    dot.className = "ss-center center";
    const ds = size * 0.054;
    Object.assign(dot.style, {
        width: ds + "px",
        height: ds + "px",
    });

    handsEl.append(hourHand, minHand, secHand, dot);
    target.append(sunburstEl, sectorEl, rehautEl, flutingEl, dotRingsEl, ticksEl, arcsSvg, numbersEl, handsEl);
}
