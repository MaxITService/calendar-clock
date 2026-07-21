// Builds the Cobalt Meridian face: a cold-luxury cartographic instrument dial.
function buildCobaltMeridianClockFace(target) {
    target.innerHTML = "";
    target.classList.remove("is-clock-face-missing");
    target.classList.toggle("is-24-hour", use24HourRadial);
    const size = clockSize || target.offsetWidth;
    const r = size / 2;

    const plateEl = document.createElement("div");
    plateEl.className = "cm-plate";

    const mapEl = document.createElement("div");
    mapEl.className = "cm-map";

    const gridEl = document.createElement("div");
    gridEl.className = "cm-grid";

    const meridiansEl = document.createElement("div");
    meridiansEl.className = "cm-meridians";
    for (let i = 0; i < 12; i++) {
        const line = document.createElement("div");
        line.className = "cm-meridian";
        line.style.transform = `translate(-50%, -50%) rotate(${i * 15}deg)`;
        meridiansEl.appendChild(line);
    }

    const contourEl = document.createElement("div");
    contourEl.className = "cm-contours";
    for (let i = 0; i < 5; i++) {
        const contour = document.createElement("div");
        contour.className = "cm-contour";
        const inset = 16 + i * 9;
        Object.assign(contour.style, {
            inset: inset + "%",
            transform: `rotate(${i * 18 - 7}deg)`,
        });
        contourEl.appendChild(contour);
    }

    const surveyEl = document.createElement("div");
    surveyEl.className = "cm-survey-points";
    for (let i = 0; i < 20; i++) {
        const point = document.createElement("div");
        point.className = "cm-survey-point";
        const angle = i * 137.508 + 11;
        const distance = 12 + (i * 23) % 73;
        const x = 50 + Math.sin(angle * Math.PI / 180) * distance * 0.48;
        const y = 50 - Math.cos(angle * Math.PI / 180) * distance * 0.48;
        const pointSize = 1.7 + (i % 4) * 0.45;
        Object.assign(point.style, {
            width: pointSize + "px",
            height: pointSize + "px",
            left: x + "%",
            top: y + "%",
            opacity: String(0.18 + (i % 5) * 0.055),
        });
        surveyEl.appendChild(point);
    }

    function makeMinuteDotRing(config) {
        const ring = document.createElement("div");
        const dotRadius = size * config.radiusRatioFromCenter;
        const dotSize = Math.max(DOT_RING_CONFIG.minDotSize, size * DOT_RING_CONFIG.dotSizeRatio)
            * (config.dotSizeMultiplier || 1);
        const dotCount = use24HourRadial ? 96 : DOT_RING_CONFIG.dotsPerRing;
        const dotStepDeg = 360 / dotCount;

        ring.className = `cm-dot-ring ${config.className}`;
        ring.dataset.dotCount = String(dotCount);
        ring.dataset.radiusRatioFromCenter = String(config.radiusRatioFromCenter);
        ring.dataset.dotSizeMultiplier = String(config.dotSizeMultiplier || 1);
        ring.dataset.radius = String(dotRadius);

        for (let i = 0; i < dotCount; i++) {
            const dot = document.createElement("div");
            dot.className = "cm-minute-dot";
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
        ring.className = "cm-center-shadow-ring";
        ring.dataset.radiusRatioFromCenter = String(DOT_RING_CONFIG.centerShadowRadiusRatioFromCenter);
        ring.dataset.radius = String(ringRadius);
        Object.assign(ring.style, {
            width: (ringRadius * 2) + "px",
            height: (ringRadius * 2) + "px",
        });
        return ring;
    }

    const dotRingsEl = document.createElement("div");
    dotRingsEl.className = "cm-dot-rings";
    dotRingsEl.appendChild(makeCenterShadowRing());
    DOT_RING_CONFIG.rings.forEach(config => {
        dotRingsEl.appendChild(makeMinuteDotRing(config));
    });

    const ticksEl = document.createElement("div");
    ticksEl.className = "cm-ticks";
    const tickCount = use24HourRadial ? 96 : 60;
    const tickStepDeg = 360 / tickCount;

    for (let i = 0; i < tickCount; i++) {
        const isReference = use24HourRadial ? i % 8 === 0 : i % 5 === 0;
        const isMajor = use24HourRadial ? i % 4 === 0 : isReference;
        const isMedium = use24HourRadial && i % 2 === 0 && !isMajor;
        const tick = document.createElement("div");
        tick.className = "cm-tick";
        const tickR = isReference ? r * 0.884 : isMajor ? r * 0.896 : isMedium ? r * 0.907 : r * 0.917;
        const w = isReference ? r * 0.026 : isMajor ? r * 0.018 : isMedium ? r * 0.010 : r * 0.006;
        const h = isReference ? r * 0.132 : isMajor ? r * 0.088 : isMedium ? r * 0.052 : r * 0.030;
        tick.classList.toggle("cm-tick-reference", isReference);
        tick.classList.toggle("cm-tick-major", isMajor);
        tick.classList.toggle("cm-tick-medium", isMedium);
        Object.assign(tick.style, {
            width: w + "px",
            height: h + "px",
            transform: `translate(-50%,-50%) rotate(${i * tickStepDeg}deg) translateY(-${tickR}px)`,
        });
        ticksEl.appendChild(tick);
    }

    const arcsSvg = document.createElementNS(SVG_NS, "svg");
    arcsSvg.classList.add("cm-time-arcs", "time-arcs");
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
    numbersEl.className = "cm-numbers numbers";
    const numberCount = use24HourRadial ? 24 : 12;
    const numberRadius = use24HourRadial ? r * 0.724 : r * 0.684;

    for (let i = 1; i <= numberCount; i++) {
        const label = use24HourRadial ? String(i % 24).padStart(2, "0") : String(i);
        const angle = use24HourRadial ? i * 15 : i * 30;
        const number = document.createElement("div");
        number.className = use24HourRadial
            ? "cm-number number cm-number-24 number-24"
            : "cm-number number";
        number.textContent = label;
        Object.assign(number.style, {
            marginLeft: "-1.18em",
            marginTop: "-1.18em",
            transform: `rotate(${angle}deg) translateY(-${numberRadius}px) rotate(${-angle}deg)`,
        });
        numbersEl.appendChild(number);
    }

    const handsEl = document.createElement("div");
    handsEl.className = "cm-hands hands";

    function makeHand(classes, wRatio, hRatio) {
        const el = document.createElement("div");
        el.className = "cm-hand hand " + classes;
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
    const hourHand = makeHand("cm-hour-hand hour-hand", handWidth, 0.252);
    const minHand = makeHand("cm-minute-hand minute-hand", handWidth * 0.54, 0.388);
    const secHand = makeHand("cm-second-hand second-hand", handWidth * 0.26, 0.431);

    const dot = document.createElement("div");
    dot.className = "cm-center center";
    const ds = size * 0.055;
    Object.assign(dot.style, {
        width: ds + "px",
        height: ds + "px",
    });

    handsEl.append(hourHand, minHand, secHand, dot);
    target.append(plateEl, mapEl, gridEl, meridiansEl, contourEl, surveyEl, dotRingsEl, ticksEl, arcsSvg, numbersEl, handsEl);
}
