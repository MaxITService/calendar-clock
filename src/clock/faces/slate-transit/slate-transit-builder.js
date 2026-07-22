// Builds the Slate Transit face: a dark, high-contrast transport instrument dial.
function buildSlateTransitClockFace(target) {
    target.innerHTML = "";
    target.classList.remove("is-clock-face-missing");
    target.classList.toggle("is-24-hour", use24HourRadial);

    const size = clockSize || target.offsetWidth;
    const radius = size / 2;

    const dial = document.createElement("div");
    dial.className = "st-dial";

    const rail = document.createElement("div");
    rail.className = "st-rail";

    const innerField = document.createElement("div");
    innerField.className = "st-inner-field";

    const ticks = document.createElement("div");
    ticks.className = "st-ticks";
    const tickCount = use24HourRadial ? 96 : 60;
    const tickStepDeg = 360 / tickCount;

    for (let index = 0; index < tickCount; index++) {
        const isReference = use24HourRadial ? index % 24 === 0 : index % 15 === 0;
        const isMajor = use24HourRadial ? index % 4 === 0 : index % 5 === 0;
        const isMedium = use24HourRadial && index % 2 === 0 && !isMajor;
        const tick = document.createElement("div");
        tick.className = "st-tick";
        tick.classList.toggle("st-tick-reference", isReference);
        tick.classList.toggle("st-tick-major", isMajor);
        tick.classList.toggle("st-tick-medium", isMedium);

        const tickRadius = isReference
            ? radius * 0.842
            : isMajor
                ? radius * 0.865
                : isMedium
                    ? radius * 0.883
                    : radius * 0.897;
        const tickWidth = isReference
            ? Math.max(3, size * 0.012)
            : isMajor
                ? Math.max(1.8, size * 0.0055)
                : Math.max(1, size * 0.0024);
        const tickHeight = isReference
            ? radius * 0.148
            : isMajor
                ? radius * 0.092
                : isMedium
                    ? radius * 0.052
                    : radius * 0.032;

        Object.assign(tick.style, {
            width: tickWidth + "px",
            height: tickHeight + "px",
            transform: `translate(-50%,-50%) rotate(${index * tickStepDeg}deg) translateY(-${tickRadius}px)`,
        });
        ticks.appendChild(tick);
    }

    const arcsSvg = document.createElementNS(SVG_NS, "svg");
    arcsSvg.classList.add("st-time-arcs", "time-arcs");
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
    numbers.className = "st-numbers numbers";
    const numberCount = use24HourRadial ? 24 : 12;
    const numberRadius = use24HourRadial ? radius * 0.700 : radius * 0.650;

    for (let value = 1; value <= numberCount; value++) {
        const angle = use24HourRadial ? value * 15 : value * 30;
        const isReference = use24HourRadial ? value % 6 === 0 : value % 3 === 0;
        const number = document.createElement("div");
        number.className = use24HourRadial
            ? "st-number number st-number-24 number-24"
            : "st-number number";
        number.classList.toggle("st-number-reference", isReference);
        number.classList.toggle("st-number-empty", !use24HourRadial && !isReference);
        number.textContent = use24HourRadial
            ? String(value % 24).padStart(2, "0")
            : isReference
                ? String(value)
                : "";
        Object.assign(number.style, {
            marginLeft: "-1.15em",
            marginTop: "-1.15em",
            transform: `rotate(${angle}deg) translateY(-${numberRadius}px) rotate(${-angle}deg)`,
        });
        numbers.appendChild(number);
    }

    const hands = document.createElement("div");
    hands.className = "st-hands hands";

    function makeHand(classes, widthRatio, heightRatio) {
        const hand = document.createElement("div");
        hand.className = "st-hand hand " + classes;
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

    const hourHand = makeHand("st-hour-hand hour-hand", 0.035, 0.245);
    const minuteHand = makeHand("st-minute-hand minute-hand", 0.022, 0.374);
    const secondHand = makeHand("st-second-hand second-hand", 0.0055, 0.420);

    const center = document.createElement("div");
    center.className = "st-center center";
    const centerSize = size * 0.050;
    Object.assign(center.style, {
        width: centerSize + "px",
        height: centerSize + "px",
    });

    hands.append(hourHand, minuteHand, secondHand, center);
    target.append(dial, rail, innerField, ticks, arcsSvg, numbers, hands);
}
