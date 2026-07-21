// Builds the static analog clock DOM for the Crimson Dusk design.
// Warm amber-to-crimson sunset aesthetic with Roman numerals and ember particles.
function buildCrimsonDuskClockFace(target) {
    target.innerHTML = "";
    target.classList.remove("is-clock-face-missing");
    target.classList.toggle("is-24-hour", use24HourRadial);
    const size = clockSize || target.offsetWidth;
    const r = size / 2;

    // ── Ember particles (decorative fire-like specks) ──
    const embersEl = document.createElement("div");
    embersEl.className = "cd-embers";
    const EMBER_COUNT = 28;
    // Reset per build so the clock and magnifier render the same ember field.
    let randomState = 0xc41d5eed;
    const random = () => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return randomState / 0x100000000;
    };
    const rng = (min, max) => min + random() * (max - min);

    for (let i = 0; i < EMBER_COUNT; i++) {
        const ember = document.createElement("div");
        ember.className = "cd-ember";
        // Scatter embers in the lower two-thirds of the face
        const angle = random() * Math.PI * 2;
        const dist = 0.08 + random() * 0.74;
        const ex = 50 + Math.cos(angle) * dist * 44;
        const ey = 50 + Math.sin(angle) * dist * 44;
        const emberSize = rng(1.2, 3.6);
        Object.assign(ember.style, {
            width: emberSize + "px",
            height: emberSize + "px",
            left: ex + "%",
            top: ey + "%",
            // Stagger animation offset per ember
            animationDelay: rng(0, 6) + "s",
            animationDuration: rng(2.8, 6.5) + "s",
        });
        embersEl.appendChild(ember);
    }

    // ── Radial sunset gradient halo ──
    const haloEl = document.createElement("div");
    haloEl.className = "cd-halo";

    // ── Dot rings ──
    function makeMinuteDotRing(config) {
        const ring = document.createElement("div");
        const dotRadius = size * config.radiusRatioFromCenter;
        const dotSize = Math.max(DOT_RING_CONFIG.minDotSize, size * DOT_RING_CONFIG.dotSizeRatio)
            * (config.dotSizeMultiplier || 1);
        const dotCount = use24HourRadial ? 96 : DOT_RING_CONFIG.dotsPerRing;
        const dotStepDeg = 360 / dotCount;

        ring.className = `cd-dot-ring ${config.className}`;
        ring.dataset.dotCount = String(dotCount);

        for (let i = 0; i < dotCount; i++) {
            const dot = document.createElement("div");
            dot.className = "cd-minute-dot";
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
    dotRingsEl.className = "cd-dot-rings";
    DOT_RING_CONFIG.rings.forEach(config => {
        dotRingsEl.appendChild(makeMinuteDotRing(config));
    });

    // ── Tick marks – ember-glowing warm gradient ──
    const ticksEl = document.createElement("div");
    ticksEl.className = "cd-ticks";
    const tickCount = use24HourRadial ? 96 : 60;
    const tickStepDeg = 360 / tickCount;

    for (let i = 0; i < tickCount; i++) {
        const isHourRef = use24HourRadial ? i % 4 === 0 : i % 5 === 0;
        const isMedium = !isHourRef && (use24HourRadial ? i % 2 === 0 : false);
        const tick = document.createElement("div");
        tick.className = "cd-tick";
        const tickR = isHourRef ? r * 0.882 : isMedium ? r * 0.902 : r * 0.913;
        const w = isHourRef ? r * 0.026 : isMedium ? r * 0.012 : r * 0.007;
        const h = isHourRef ? r * 0.145 : isMedium ? r * 0.065 : r * 0.034;
        // Warm amber→crimson hue sweep around the dial
        const hue = 15 + (i / tickCount) * 25; // 15–40 range (orange-amber)
        const sat = isHourRef ? 92 : 80;
        const lum = isHourRef ? 72 : isMedium ? 64 : 55;
        const alpha = isHourRef ? 1 : isMedium ? 0.75 : 0.48;
        Object.assign(tick.style, {
            width: w + "px",
            height: h + "px",
            background: `hsla(${hue}, ${sat}%, ${lum}%, ${alpha})`,
            transform: `translate(-50%,-50%) rotate(${i * tickStepDeg}deg) translateY(-${tickR}px)`,
        });
        ticksEl.appendChild(tick);
    }

    // ── Event arcs SVG ──
    const arcsSvg = document.createElementNS(SVG_NS, "svg");
    arcsSvg.classList.add("cd-time-arcs", "time-arcs");
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
    numbersEl.className = "cd-numbers numbers";
    const numberCount = use24HourRadial ? 24 : 12;
    const numberRadius = use24HourRadial ? r * 0.735 : r * 0.70;

    for (let i = 1; i <= numberCount; i++) {
        const label = use24HourRadial
            ? String(i % 24)
            : ROMAN[(i % 12)];
        const angle = use24HourRadial ? i * 15 : i * 30;
        const number = document.createElement("div");
        number.className = use24HourRadial
            ? "cd-number number cd-number-24 number-24"
            : "cd-number number";
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
    handsEl.className = "cd-hands hands";

    function makeHand(cls, wRatio, hRatio) {
        const el = document.createElement("div");
        el.className = "cd-hand hand " + cls;
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

    const handWidth = 0.023;
    const hourHand = makeHand("cd-hour-hand hour-hand", handWidth, 0.250);
    const minHand  = makeHand("cd-minute-hand minute-hand", handWidth * 0.55, 0.382);
    const secHand  = makeHand("cd-second-hand second-hand", handWidth * 0.28, 0.424);

    const dot = document.createElement("div");
    dot.className = "cd-center center";
    const ds = size * 0.054;
    Object.assign(dot.style, {
        width: ds + "px",
        height: ds + "px",
    });

    handsEl.append(hourHand, minHand, secHand, dot);
    target.append(haloEl, embersEl, dotRingsEl, ticksEl, arcsSvg, numbersEl, handsEl);
}
