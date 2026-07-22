// Builds Abyss Diver: an unbranded professional dive-watch face.
function buildAbyssDiverClockFace(target) {
    target.innerHTML = "";
    target.classList.remove("is-clock-face-missing");
    target.classList.toggle("is-24-hour", use24HourRadial);

    const size = clockSize || target.offsetWidth;
    const radius = size / 2;

    const dial = document.createElement("div");
    dial.className = "ad-dial";

    const bezel = document.createElement("div");
    bezel.className = "ad-bezel";

    const rehaut = document.createElement("div");
    rehaut.className = "ad-rehaut";

    const bezelTicks = document.createElement("div");
    bezelTicks.className = "ad-bezel-ticks";

    const bezelTickCount = use24HourRadial ? 96 : 60;
    for (let index = 0; index < bezelTickCount; index++) {
        const tick = document.createElement("div");
        const isMajor = use24HourRadial ? index % 4 === 0 : index % 5 === 0;
        const isMedium = use24HourRadial && !isMajor && index % 2 === 0;
        tick.className = "ad-bezel-tick";
        tick.classList.toggle("ad-bezel-tick-major", isMajor);
        tick.classList.toggle("ad-bezel-tick-medium", isMedium);
        const width = isMajor ? Math.max(1.6, size * 0.0042) : Math.max(1, size * 0.0018);
        const height = isMajor ? radius * 0.050 : radius * (isMedium ? 0.034 : 0.020);
        const angle = index * (360 / bezelTickCount);
        Object.assign(tick.style, {
            width: width + "px",
            height: height + "px",
            transform: `translate(-50%,-50%) rotate(${angle}deg) translateY(-${radius * 0.908}px)`,
        });
        bezelTicks.appendChild(tick);
    }

    const bezelNumbers = document.createElement("div");
    bezelNumbers.className = "ad-bezel-numbers";

    const numberCount = use24HourRadial ? 24 : 12;
    for (let value = 0; value < numberCount; value++) {
        if (!use24HourRadial && value === 0) continue;
        const angle = use24HourRadial ? value * 15 : value * 30;
        const number = document.createElement("div");
        number.className = use24HourRadial
            ? "ad-bezel-number ad-bezel-hour number number-24"
            : "ad-bezel-number";
        number.textContent = use24HourRadial
            ? String(value).padStart(2, "0")
            : String(value * 5);
        Object.assign(number.style, {
            marginLeft: "-1.05em",
            marginTop: "-1.05em",
            transform: `rotate(${angle}deg) translateY(-${radius * 0.828}px) rotate(${-angle}deg)`,
        });
        bezelNumbers.appendChild(number);
    }

    const bezelZero = document.createElement("div");
    bezelZero.className = "ad-bezel-zero";
    const bezelPip = document.createElement("span");
    bezelPip.className = "ad-bezel-pip";
    bezelZero.appendChild(bezelPip);

    const indices = document.createElement("div");
    indices.className = "ad-indices";
    const indexCount = use24HourRadial ? 24 : 12;
    const indexStepDeg = 360 / indexCount;
    const indexRadius = use24HourRadial ? radius * 0.720 : radius * 0.700;

    for (let index = 0; index < indexCount; index++) {
        const isTop = index === 0;
        const isQuarter = index % (indexCount / 4) === 0;
        const isSideQuarter = index === indexCount / 4 || index === indexCount * 3 / 4;
        const isMinor24 = use24HourRadial && index % 2 !== 0;
        const marker = document.createElement("div");
        const lume = document.createElement("span");
        marker.className = "ad-index";
        marker.classList.toggle("ad-index-triangle", isTop);
        marker.classList.toggle("ad-index-baton", isQuarter && !isTop);
        marker.classList.toggle("ad-index-side", isSideQuarter);
        marker.classList.toggle("ad-index-round", !isQuarter && !isMinor24);
        marker.classList.toggle("ad-index-minor", isMinor24);
        lume.className = "ad-index-lume";

        const markerWidth = isTop
            ? size * (use24HourRadial ? 0.040 : 0.055)
            : isQuarter
                ? size * (use24HourRadial ? 0.023 : 0.032)
                : isMinor24
                    ? size * 0.013
                    : size * (use24HourRadial ? 0.021 : 0.038);
        const markerHeight = isTop
            ? size * (use24HourRadial ? 0.050 : 0.068)
            : isQuarter
                ? size * (use24HourRadial ? 0.050 : 0.062)
                : markerWidth;

        Object.assign(marker.style, {
            width: markerWidth + "px",
            height: markerHeight + "px",
            transform: `translate(-50%,-50%) rotate(${index * indexStepDeg}deg) translateY(-${indexRadius}px) rotate(${-index * indexStepDeg + (isSideQuarter ? 90 : 0)}deg)`,
        });
        marker.appendChild(lume);
        indices.appendChild(marker);
    }

    const arcsSvg = document.createElementNS(SVG_NS, "svg");
    arcsSvg.classList.add("ad-time-arcs", "time-arcs");
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

    const hands = document.createElement("div");
    hands.className = "ad-hands hands";

    function makeHand(classes, widthRatio, heightRatio) {
        const hand = document.createElement("div");
        hand.className = "ad-hand hand " + classes;
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

    const hourHand = makeHand("ad-hour-hand hour-hand", 0.026, 0.246);
    const hourMedallion = document.createElementNS(SVG_NS, "svg");
    const hourMedallionFace = document.createElementNS(SVG_NS, "circle");
    const hourMedallionSpokes = document.createElementNS(SVG_NS, "path");
    hourMedallion.classList.add("ad-hour-medallion");
    hourMedallion.setAttribute("viewBox", "0 0 100 100");
    hourMedallion.setAttribute("aria-hidden", "true");
    hourMedallionFace.classList.add("ad-hour-medallion-face");
    hourMedallionFace.setAttribute("cx", "50");
    hourMedallionFace.setAttribute("cy", "50");
    hourMedallionFace.setAttribute("r", "46");
    hourMedallionSpokes.classList.add("ad-hour-medallion-spokes");
    hourMedallionSpokes.setAttribute("d", "M50 50 L50 5 M50 50 L10 73 M50 50 L90 73");
    hourMedallion.append(hourMedallionFace, hourMedallionSpokes);
    hourHand.appendChild(hourMedallion);

    const minuteHand = makeHand("ad-minute-hand minute-hand", 0.020, 0.375);
    const secondHand = makeHand("ad-second-hand second-hand", 0.0048, 0.418);

    const center = document.createElement("div");
    center.className = "ad-center center";
    const centerSize = size * 0.050;
    Object.assign(center.style, {
        width: centerSize + "px",
        height: centerSize + "px",
    });

    hands.append(hourHand, minuteHand, secondHand, center);
    target.append(dial, bezel, rehaut, bezelTicks, bezelNumbers, bezelZero, indices, arcsSvg, hands);
}
