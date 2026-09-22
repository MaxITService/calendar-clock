// Builds the static analog clock DOM for the Crimson Dusk design.
// Restrained bordeaux-and-copper take on Crimson Dusk: Roman numerals, no embers, no animated halo.
function buildCrimsonDuskClockFace(target) {
    target.innerHTML = "";
    target.classList.remove("is-clock-face-missing");
    target.classList.toggle("is-24-hour", use24HourRadial);
    const size = clockSize || target.offsetWidth;
    const r = size / 2;

    // ── Dot rings ──
    function makeMinuteDotRing(config) {
        const ring = document.createElement("div");
        const dotRadius = size * config.radiusRatioFromCenter;
        const dotSize = Math.max(DOT_RING_CONFIG.minDotSize, size * DOT_RING_CONFIG.dotSizeRatio)
            * (config.dotSizeMultiplier || 1);
        const dotCount = use24HourRadial ? 96 : DOT_RING_CONFIG.dotsPerRing;
        const dotStepDeg = 360 / dotCount;

        ring.className = `cds-dot-ring ${config.className}`;
        ring.dataset.dotCount = String(dotCount);

        for (let i = 0; i < dotCount; i++) {
            const dot = document.createElement("div");
            dot.className = "cds-minute-dot";
            Object.assign(dot.style, {
                width: dotSize + "px",
                height: dotSize + "px",
                transform: `translate(-50%,-50%) rotate(${i * dotStepDeg}deg) translateY(-${dotRadius}px)`,
            });
            ring.appendChild(dot);
        }
        return ring;
    }

    const dotRingsEl = document.createElement("div");
    dotRingsEl.className = "cds-dot-rings";
    DOT_RING_CONFIG.rings.forEach(config => {
        dotRingsEl.appendChild(makeMinuteDotRing(config));
    });

    // ── Tick marks – thin matte copper ──
    const ticksEl = document.createElement("div");
    ticksEl.className = "cds-ticks";
    const tickCount = use24HourRadial ? 96 : 60;
    const tickStepDeg = 360 / tickCount;

    for (let i = 0; i < tickCount; i++) {
        const isHourRef = use24HourRadial ? i % 4 === 0 : i % 5 === 0;
        const isMedium = !isHourRef && (use24HourRadial ? i % 2 === 0 : false);
        const tick = document.createElement("div");
        tick.className = isHourRef ? "cds-tick cds-tick-hour" : isMedium ? "cds-tick cds-tick-medium" : "cds-tick";
        const tickR = isHourRef ? r * 0.878 : isMedium ? r * 0.902 : r * 0.912;
        const w = isHourRef ? r * 0.012 : isMedium ? r * 0.006 : r * 0.004;
        const h = isHourRef ? r * 0.125 : isMedium ? r * 0.055 : r * 0.030;
        Object.assign(tick.style, {
            width: w + "px",
            height: h + "px",
            transform: `translate(-50%,-50%) rotate(${i * tickStepDeg}deg) translateY(-${tickR}px)`,
        });
        ticksEl.appendChild(tick);
    }

    // ── Event arcs SVG ──
    const arcsSvg = document.createElementNS(SVG_NS, "svg");
    arcsSvg.classList.add("cds-time-arcs", "time-arcs");
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

    // ── Roman numerals (or Arabic for 24h) ──
    const ROMAN = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
    const numbersEl = document.createElement("div");
    numbersEl.className = "cds-numbers numbers";
    const numberCount = use24HourRadial ? 24 : 12;
    const numberRadius = use24HourRadial ? r * 0.735 : r * 0.70;

    for (let i = 1; i <= numberCount; i++) {
        const label = use24HourRadial
            ? String(i % 24)
            : ROMAN[(i % 12)];
        const angle = use24HourRadial ? i * 15 : i * 30;
        const number = document.createElement("div");
        number.className = use24HourRadial
            ? "cds-number number cds-number-24 number-24"
            : "cds-number number";
        number.textContent = label;
        Object.assign(number.style, {
            marginLeft: "-1.5em",
            marginTop: "-1.5em",
            transform: `rotate(${angle}deg) translateY(-${numberRadius}px) rotate(${-angle}deg)`,
        });
        numbersEl.appendChild(number);
    }

    // ── Hands ──
    const handsEl = document.createElement("div");
    handsEl.className = "cds-hands hands";

    function makeHand(cls, wRatio, hRatio) {
        const el = document.createElement("div");
        el.className = "cds-hand hand " + cls;
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

    const handWidth = 0.017;
    const hourHand = makeHand("cds-hour-hand hour-hand", handWidth, 0.246);
    const minHand  = makeHand("cds-minute-hand minute-hand", handWidth * 0.7, 0.372);
    const secHand  = makeHand("cds-second-hand second-hand", handWidth * 0.18, 0.418);

    const dot = document.createElement("div");
    dot.className = "cds-center center";
    const ds = size * 0.036;
    Object.assign(dot.style, {
        width: ds + "px",
        height: ds + "px",
    });

    handsEl.append(hourHand, minHand, secHand, dot);
    target.append(dotRingsEl, ticksEl, arcsSvg, numbersEl, handsEl);
}
