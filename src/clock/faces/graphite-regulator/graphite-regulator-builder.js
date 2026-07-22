// Builds the Graphite Regulator face: a flat architectural instrument dial.
function buildGraphiteRegulatorClockFace(target) {
    target.innerHTML = "";
    target.classList.remove("is-clock-face-missing");
    target.classList.toggle("is-24-hour", use24HourRadial);

    const size = clockSize || target.offsetWidth;
    const radius = size / 2;

    const dial = document.createElement("div");
    dial.className = "gr-dial";

    const axes = document.createElement("div");
    axes.className = "gr-axes";

    const chapterRing = document.createElement("div");
    chapterRing.className = "gr-chapter-ring";

    const innerRegister = document.createElement("div");
    innerRegister.className = "gr-inner-register";

    const ticks = document.createElement("div");
    ticks.className = "gr-ticks";
    const tickCount = use24HourRadial ? 96 : 60;
    const tickStepDeg = 360 / tickCount;

    for (let index = 0; index < tickCount; index++) {
        const isReference = use24HourRadial ? index % 8 === 0 : index % 5 === 0;
        const isMajor = use24HourRadial ? index % 4 === 0 : isReference;
        const isMedium = use24HourRadial && index % 2 === 0 && !isMajor;
        const tick = document.createElement("div");
        tick.className = "gr-tick";
        tick.classList.toggle("gr-tick-reference", isReference);
        tick.classList.toggle("gr-tick-major", isMajor);
        tick.classList.toggle("gr-tick-medium", isMedium);

        const tickRadius = isReference
            ? radius * 0.858
            : isMajor
                ? radius * 0.874
                : isMedium
                    ? radius * 0.888
                    : radius * 0.902;
        const tickWidth = isReference
            ? Math.max(2.4, size * 0.008)
            : isMajor
                ? Math.max(1.6, size * 0.005)
                : Math.max(1, size * 0.0024);
        const tickHeight = isReference
            ? radius * 0.118
            : isMajor
                ? radius * 0.078
                : isMedium
                    ? radius * 0.048
                    : radius * 0.030;

        Object.assign(tick.style, {
            width: tickWidth + "px",
            height: tickHeight + "px",
            transform: `translate(-50%,-50%) rotate(${index * tickStepDeg}deg) translateY(-${tickRadius}px)`,
        });
        ticks.appendChild(tick);
    }

    const arcsSvg = document.createElementNS(SVG_NS, "svg");
    arcsSvg.classList.add("gr-time-arcs", "time-arcs");
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

    const numbers = document.createElement("div");
    numbers.className = "gr-numbers numbers";
    const numberCount = use24HourRadial ? 24 : 12;
    const numberRadius = use24HourRadial ? radius * 0.704 : radius * 0.668;

    for (let value = 1; value <= numberCount; value++) {
        const angle = use24HourRadial ? value * 15 : value * 30;
        const number = document.createElement("div");
        number.className = use24HourRadial
            ? "gr-number number gr-number-24 number-24"
            : "gr-number number";
        number.classList.toggle("gr-number-reference", use24HourRadial ? value % 6 === 0 : value % 3 === 0);
        number.textContent = use24HourRadial
            ? String(value % 24).padStart(2, "0")
            : String(value);
        Object.assign(number.style, {
            marginLeft: "-1.15em",
            marginTop: "-1.15em",
            transform: `rotate(${angle}deg) translateY(-${numberRadius}px) rotate(${-angle}deg)`,
        });
        numbers.appendChild(number);
    }

    const hands = document.createElement("div");
    hands.className = "gr-hands hands";

    function makeHand(classes, widthRatio, heightRatio) {
        const hand = document.createElement("div");
        hand.className = "gr-hand hand " + classes;
        const width = size * widthRatio;
        const height = size * heightRatio;
        Object.assign(hand.style, {
            width: width + "px",
            height: height + "px",
            marginLeft: (-width / 2) + "px",
            marginTop: (-height) + "px",
        });
        return hand;
    }

    const hourHand = makeHand("gr-hour-hand hour-hand", 0.026, 0.252);
    const minuteHand = makeHand("gr-minute-hand minute-hand", 0.014, 0.382);
    const secondHand = makeHand("gr-second-hand second-hand", 0.005, 0.422);

    const center = document.createElement("div");
    center.className = "gr-center center";
    const centerSize = size * 0.047;
    Object.assign(center.style, {
        width: centerSize + "px",
        height: centerSize + "px",
    });

    hands.append(hourHand, minuteHand, secondHand, center);
    target.append(dial, axes, chapterRing, innerRegister, ticks, arcsSvg, numbers, hands);
}
