// Builds Rhodium Reserve: a restrained lacquer-and-rhodium mechanical watch face.
function buildRhodiumReserveClockFace(target) {
    target.innerHTML = "";
    target.classList.remove("is-clock-face-missing");
    target.classList.toggle("is-24-hour", use24HourRadial);
    const size = clockSize || target.offsetWidth;
    const r = size / 2;

    const dialEl = document.createElement("div");
    dialEl.className = "rr-dial";

    const rehautEl = document.createElement("div");
    rehautEl.className = "rr-rehaut";

    const trackEl = document.createElement("div");
    trackEl.className = "rr-inner-track";

    const crystalEl = document.createElement("div");
    crystalEl.className = "rr-crystal";

    function makeMinuteDotRing(config) {
        const ring = document.createElement("div");
        const dotRadius = size * config.radiusRatioFromCenter;
        const dotSize = Math.max(DOT_RING_CONFIG.minDotSize, size * DOT_RING_CONFIG.dotSizeRatio)
            * (config.dotSizeMultiplier || 1);
        const dotCount = use24HourRadial ? 96 : DOT_RING_CONFIG.dotsPerRing;
        const dotStepDeg = 360 / dotCount;

        ring.className = `rr-dot-ring ${config.className}`;
        ring.dataset.dotCount = String(dotCount);
        ring.dataset.radiusRatioFromCenter = String(config.radiusRatioFromCenter);
        ring.dataset.dotSizeMultiplier = String(config.dotSizeMultiplier || 1);
        ring.dataset.radius = String(dotRadius);

        for (let i = 0; i < dotCount; i++) {
            const dot = document.createElement("div");
            dot.className = "rr-minute-dot";
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
        ring.className = "rr-center-shadow-ring";
        ring.dataset.radiusRatioFromCenter = String(DOT_RING_CONFIG.centerShadowRadiusRatioFromCenter);
        ring.dataset.radius = String(ringRadius);
        Object.assign(ring.style, {
            width: (ringRadius * 2) + "px",
            height: (ringRadius * 2) + "px",
        });
        return ring;
    }

    const dotRingsEl = document.createElement("div");
    dotRingsEl.className = "rr-dot-rings";
    dotRingsEl.appendChild(makeCenterShadowRing());
    DOT_RING_CONFIG.rings.forEach(config => {
        dotRingsEl.appendChild(makeMinuteDotRing(config));
    });

    const ticksEl = document.createElement("div");
    ticksEl.className = "rr-ticks";
    const tickCount = use24HourRadial ? 48 : 24;
    const tickStepDeg = 360 / tickCount;

    for (let i = 0; i < tickCount; i++) {
        const isReference = i % 2 === 0;
        const tick = document.createElement("div");
        tick.className = "rr-tick";
        tick.classList.toggle("rr-tick-reference", isReference);
        tick.classList.toggle("rr-tick-twelve", i === 0);
        const tickR = isReference ? r * 0.872 : r * 0.91;
        const w = i === 0 ? r * 0.038 : isReference ? r * 0.022 : r * 0.005;
        const h = isReference ? r * 0.128 : r * 0.022;
        Object.assign(tick.style, {
            width: w + "px",
            height: h + "px",
            transform: `translate(-50%,-50%) rotate(${i * tickStepDeg}deg) translateY(-${tickR}px)`,
        });
        ticksEl.appendChild(tick);
    }

    const arcsSvg = document.createElementNS(SVG_NS, "svg");
    arcsSvg.classList.add("rr-time-arcs", "time-arcs");
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
    numbersEl.className = "rr-numbers numbers";
    const numberCount = use24HourRadial ? 24 : 12;
    const numberRadius = use24HourRadial ? r * 0.716 : r * 0.672;
    const quarterLabels = new Map([[12, "12"], [3, "3"], [6, "6"], [9, "9"]]);

    for (let i = 1; i <= numberCount; i++) {
        const angle = use24HourRadial ? i * 15 : i * 30;
        const label = use24HourRadial ? String(i % 24).padStart(2, "0") : (quarterLabels.get(i) || "");
        const number = document.createElement("div");
        number.className = use24HourRadial
            ? "rr-number number rr-number-24 number-24"
            : "rr-number number";
        number.textContent = label;
        Object.assign(number.style, {
            marginLeft: "-1.15em",
            marginTop: "-1.15em",
            transform: `rotate(${angle}deg) translateY(-${numberRadius}px) rotate(${-angle}deg)`,
        });
        numbersEl.appendChild(number);
    }

    const handsEl = document.createElement("div");
    handsEl.className = "rr-hands hands";

    function makeHand(classes, wRatio, hRatio) {
        const el = document.createElement("div");
        el.className = "rr-hand hand " + classes;
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
    const hourHand = makeHand("rr-hour-hand hour-hand", handWidth, 0.248);
    const minuteHand = makeHand("rr-minute-hand minute-hand", handWidth * 0.55, 0.386);
    const secondHand = makeHand("rr-second-hand second-hand", handWidth * 0.19, 0.426);

    const center = document.createElement("div");
    center.className = "rr-center center";
    const centerSize = size * 0.052;
    Object.assign(center.style, {
        width: centerSize + "px",
        height: centerSize + "px",
    });

    handsEl.append(hourHand, minuteHand, secondHand, center);
    target.append(dialEl, rehautEl, trackEl, dotRingsEl, ticksEl, arcsSvg, numbersEl, handsEl, crystalEl);
}
