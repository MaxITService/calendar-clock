// Renders live hands, the window-start marker, and calendar event arcs onto the clock face.
const ANALOG_CLOCK_CYCLE_MINUTES = 12 * 60;
const RADIAL_24_HOUR_CYCLE_MINUTES = 24 * 60;
const ARC_SEQUENTIAL_TOLERANCE_MINUTES = 1;
const MIN_CLOCK_LAYOUT_SIZE = 120;
const CLOCK_LAYOUT_RETRY_LIMIT = 10;
let clockLayoutRetryFrameId = null;
let clockLayoutRetryCount = 0;
let arcLabelMeasurementContext = null;
let eventLabelPriorityRefreshAt = 0;
const EVENT_LABEL_PRIORITY_REFRESH_MS = 15 * 1000;
const EVENT_LABEL_PRIORITY_NEAR_MS = 3 * 60 * 60 * 1000;
const EVENT_LABEL_PRIORITY_FADE_MS = 12 * 60 * 60 * 1000;
const EVENT_LABEL_PRIORITY_PAST_FADE_MS = 2 * 60 * 60 * 1000;
const EVENT_LABEL_PRIORITY_MIN_SCALE = 0.6;
const ARC_LABEL_FALLBACK_ASCENT_RATIO = 0.75;
const ARC_LABEL_FALLBACK_DESCENT_RATIO = 0.2;
const ARC_LABEL_INNER_REVERSED_NUDGE_RATIO = 0.08;

function clampClockRendererInteger(value, fallback, min, max) {
    const parsed = Number(value);
    const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : min;
    const rounded = Number.isFinite(parsed) ? Math.round(parsed) : Math.round(safeFallback);
    return Math.min(max, Math.max(min, rounded));
}

function getWindowStartMarkerDots() {
    return clampClockRendererInteger(windowStartMarkerDots, 14, 1, 50);
}

function getWindowStartMarkerWidth() {
    return clampClockRendererInteger(windowStartMarkerWidth, 3, 1, 12);
}

function getWindowStartMarkerTransparency() {
    return clampClockRendererInteger(windowStartMarkerTransparency, 8, 0, 100);
}

function getWindowStartMarkerEmoji() {
    const emoji = String(windowStartMarkerEmoji || "").trim();
    return emoji || "⭐";
}

let windowStartMarkerPulseSerial = 0;
let windowStartMarkerAnimatedAngle = null;
let windowStartMarkerLastTargetAngle = null;
let windowStartMarkerPulseTimerId = null;
let windowStartMarkerPulseRequested = false;
const WINDOW_START_MARKER_EASE = 0.22;
const WINDOW_START_MARKER_SETTLE_DEG = 0.08;
const WINDOW_START_MARKER_PULSE_DELAY_MS = 320;
const WINDOW_START_MARKER_PULSE_MIN_TARGET_DELTA_DEG = 2;

function getEventLabelFontSize() {
    const fallback = clockOverlayMode === "mini" ? 18 : 22;
    return clampClockRendererInteger(eventLabelFontSize, fallback, 8, 36);
}

function getClockFaceArcConfig() {
    const config = typeof getActiveClockFaceRenderConfig === "function"
        ? getActiveClockFaceRenderConfig()
        : null;
    return config?.arcs || {};
}

function getArcLabelFontSize() {
    const scale = Number(getClockFaceArcConfig().labelScale);
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return Math.max(7, getEventLabelFontSize() * safeScale);
}

function getEventLabelFontFamily() {
    const text = String(eventLabelFontFamily || "")
        .replace(/[^\w\s"',.-]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
    return text || "Inter, Segoe UI, Arial, sans-serif";
}

function getArcLabelMeasurementContext() {
    if (arcLabelMeasurementContext) return arcLabelMeasurementContext;
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    arcLabelMeasurementContext = canvas.getContext("2d");
    return arcLabelMeasurementContext;
}

function getEventLabelMinLength() {
    return clampClockRendererInteger(eventLabelMinLength, 3, 3, 20);
}

function getEventLabelShortenThreshold() {
    return clampClockRendererInteger(eventLabelShortenThreshold, 250, 50, 305);
}

function getEventLabelAnchor() {
    return EVENT_LABEL_ANCHORS.includes(eventLabelAnchor) ? eventLabelAnchor : "center";
}

function getEventLabelProximityPresentation(event, nowMs = Date.now(), enabled = eventLabelProximityPriority === true) {
    const normal = { fontScale: 1, showFullTitle: false };
    if (!enabled) return normal;

    const startMs = Date.parse(event?.temporal?.startInstant || event?.startDate || "");
    const parsedEndMs = Date.parse(event?.temporal?.endInstant || event?.endDate || "");
    if (!Number.isFinite(startMs) || !Number.isFinite(parsedEndMs)) return normal;

    const endMs = Math.max(startMs, parsedEndMs);

    const safeNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    if (safeNowMs < startMs) {
        const futureDistanceMs = startMs - safeNowMs;
        const progress = (futureDistanceMs - EVENT_LABEL_PRIORITY_NEAR_MS)
            / (EVENT_LABEL_PRIORITY_FADE_MS - EVENT_LABEL_PRIORITY_NEAR_MS);
        const clampedProgress = Math.min(1, Math.max(0, progress));
        const easedProgress = clampedProgress * clampedProgress * (3 - 2 * clampedProgress);
        return {
            fontScale: 1 + (EVENT_LABEL_PRIORITY_MIN_SCALE - 1) * easedProgress,
            showFullTitle: futureDistanceMs <= EVENT_LABEL_PRIORITY_NEAR_MS
        };
    }

    if (safeNowMs < endMs) {
        return {
            fontScale: 1,
            showFullTitle: true
        };
    }

    const progress = (safeNowMs - endMs) / EVENT_LABEL_PRIORITY_PAST_FADE_MS;
    const clampedProgress = Math.min(1, Math.max(0, progress));
    const easedProgress = clampedProgress * clampedProgress * (3 - 2 * clampedProgress);
    return {
        fontScale: 1 + (EVENT_LABEL_PRIORITY_MIN_SCALE - 1) * easedProgress,
        showFullTitle: false
    };
}

function getEventLabelScaledFontSize(baseFontSize, fontScale) {
    const parsedBaseFontSize = Number(baseFontSize);
    const safeBaseFontSize = Number.isFinite(parsedBaseFontSize) ? parsedBaseFontSize : 18;
    const parsedScale = Number(fontScale);
    const safeScale = Number.isFinite(parsedScale)
        ? Math.min(1, Math.max(EVENT_LABEL_PRIORITY_MIN_SCALE, parsedScale))
        : 1;
    return Math.round(safeBaseFontSize * safeScale * 100) / 100;
}

function refreshEventLabelPriorityByTime(
    nowMs = Date.now(),
    enabled = eventLabelProximityPriority === true && eventLabelsVisible === true && eventArcsVisible !== false
) {
    if (!enabled) {
        eventLabelPriorityRefreshAt = 0;
        return false;
    }
    const safeNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    if (eventLabelPriorityRefreshAt > 0
        && safeNowMs >= eventLabelPriorityRefreshAt
        && safeNowMs - eventLabelPriorityRefreshAt < EVENT_LABEL_PRIORITY_REFRESH_MS) return false;
    eventLabelPriorityRefreshAt = safeNowMs;
    updateTimeArcs();
    return true;
}

function getEventLabelOpacity() {
    return clampClockRendererInteger(eventLabelOpacity, 100, 10, 100);
}

function getEventLabelArcDistance() {
    return clampClockRendererInteger(eventLabelArcDistance, 12, 0, 24);
}

function getClockCycleMinutes() {
            return use24HourRadial ? RADIAL_24_HOUR_CYCLE_MINUTES : ANALOG_CLOCK_CYCLE_MINUTES;
        }

function getClockLayoutSize() {
            const clockRect = clockEl.getBoundingClientRect();
            const stageRect = stageEl.getBoundingClientRect();
            return Math.round(Math.max(
                Number(clockEl.offsetWidth) || 0,
                Number(clockRect.width) || 0,
                Number(stageEl.offsetWidth) || 0,
                Number(stageRect.width) || 0
            ));
        }

        function scheduleClockLayoutRetry() {
            if (clockLayoutRetryFrameId !== null || clockLayoutRetryCount >= CLOCK_LAYOUT_RETRY_LIMIT) return;
            clockLayoutRetryCount += 1;
            clockLayoutRetryFrameId = requestAnimationFrame(() => {
                clockLayoutRetryFrameId = null;
                buildClock();
            });
        }

function buildClock() {
            const nextClockSize = getClockLayoutSize();
            if (nextClockSize < MIN_CLOCK_LAYOUT_SIZE) {
                scheduleClockLayoutRetry();
                return;
            }

            clockLayoutRetryCount = 0;
            clockSize = nextClockSize;
            lensSize = magnifierEl.offsetWidth;
            buildClockFace(clockEl);
            buildClockFace(magnifiedClockEl);
            setTime();
            updateTimeArcs();
            updateMagnifier();
            scheduleLensLiquidGlassRebuild();
            if (typeof postClockFaceRuntimeAvailabilityIfChanged === "function") {
                postClockFaceRuntimeAvailabilityIfChanged();
            }
        }

        function hideRenderedCalendarEventVisuals() {
            if (typeof hideArcTooltip === "function") hideArcTooltip();
            document.querySelectorAll(".time-arc, .time-point, .time-arc-separator, .time-arc-label, .time-point-callout").forEach(element => {
                element.style.display = "none";
            });
            document.querySelectorAll(".time-arc-label-path").forEach(path => {
                path.setAttribute("d", "");
            });
        }

        function setTime() {
            const now = new Date();
            const parts = getClockZonedParts(now);
            const secs = parts.second + now.getMilliseconds() / 1000;
            const mins = parts.minute + secs / 60;
            const hrs = use24HourRadial
                ? parts.hour + mins / 60
                : (parts.hour % 12) + mins / 60;
            const hourDegrees = use24HourRadial ? hrs * 15 : hrs * 30;

            document.querySelectorAll(".hour-hand").forEach(h => h.style.transform = `rotate(${hourDegrees}deg)`);
            document.querySelectorAll(".minute-hand").forEach(m => m.style.transform = `rotate(${mins * 6}deg)`);
            document.querySelectorAll(".second-hand").forEach(s => s.style.transform = `rotate(${secs * 6}deg)`);
        }

        function pointOnClockArc(cx, cy, radius, angleDeg) {
            const angleRad = angleDeg * Math.PI / 180;
            return {
                x: cx + Math.sin(angleRad) * radius,
                y: cy - Math.cos(angleRad) * radius,
            };
        }

        function describeClockArc(size, radius, startMinutes, endMinutes, options = {}) {
            const durationMinutes = Math.max(0, endMinutes - startMinutes);
            if (!durationMinutes) return "";

            const cycleMinutes = getClockCycleMinutes();
            const startDeg = startMinutes / cycleMinutes * 360;
            const durationDeg = Math.min(durationMinutes / cycleMinutes * 360, 359.99);
            const endDeg = startDeg + durationDeg;
            const cx = size / 2;
            const cy = size / 2;
            const reverse = options.reverse === true;
            const start = pointOnClockArc(cx, cy, radius, reverse ? endDeg : startDeg);
            const end = pointOnClockArc(cx, cy, radius, reverse ? startDeg : endDeg);
            const largeArcFlag = durationDeg > 180 ? 1 : 0;
            const sweepFlag = reverse ? 0 : 1;

            return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
        }

        function normalizeClockAngle(angleDeg) {
            return ((angleDeg % 360) + 360) % 360;
        }

        function getShortestClockAngleDelta(fromDeg, toDeg) {
            const delta = normalizeClockAngle(toDeg - fromDeg);
            return delta > 180 ? delta - 360 : delta;
        }

        function describeClockArcDegrees(size, radius, startDeg, endDeg, options = {}) {
            const clockwise = options.clockwise !== false;
            const durationDeg = clockwise
                ? normalizeClockAngle(endDeg - startDeg)
                : normalizeClockAngle(startDeg - endDeg);
            if (!durationDeg) return "";

            const cx = size / 2;
            const cy = size / 2;
            const start = pointOnClockArc(cx, cy, radius, startDeg);
            const end = pointOnClockArc(cx, cy, radius, endDeg);
            const largeArcFlag = durationDeg > 180 ? 1 : 0;
            const sweepFlag = clockwise ? 1 : 0;
            return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
        }

        function getCurrentClockAngle() {
            const now = new Date();
            const parts = getClockZonedParts(now);
            const secs = parts.second + now.getMilliseconds() / 1000;
            const mins = parts.minute + secs / 60;
            const hours = use24HourRadial
                ? parts.hour + mins / 60
                : (parts.hour % 12) + mins / 60;
            return normalizeClockAngle(hours * (use24HourRadial ? 15 : 30));
        }

        function parseEventDateRange(event) {
            const startInstant = event?.temporal?.kind === "all-day" ? event?.startDate : event?.temporal?.startInstant;
            const endInstant = event?.temporal?.kind === "all-day" ? event?.endDate : event?.temporal?.endInstant;
            const startDate = startInstant ? new Date(startInstant) : null;
            const endDate = endInstant ? new Date(endInstant) : null;
            if (!startDate || !endDate || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
                return null;
            }
            if (!isPointCalendarEvent(event) && endDate <= startDate) return null;
            if (isPointCalendarEvent(event) && endDate < startDate) return null;
            return { startDate, endDate };
        }

        function getDatedVisibleEventSegment(event, displayWindow) {
            const eventRange = parseEventDateRange(event);
            if (!eventRange) return null;

            const { startDate, endDate } = getWindowDateRange();
            if (isPointCalendarEvent(event)) {
                const pointMs = eventRange.startDate.getTime();
                if (pointMs < startDate.getTime() || pointMs >= endDate.getTime()) return false;

                const offset = (pointMs - startDate.getTime()) / (60 * 1000);
                return {
                    startOffset: offset,
                    endOffset: offset,
                    clockStartMinutes: displayWindow.start + offset,
                    clockEndMinutes: displayWindow.start + offset,
                    overlap: 0,
                    isPointEvent: true
                };
            }

            const overlapStartMs = Math.max(eventRange.startDate.getTime(), startDate.getTime());
            const overlapEndMs = Math.min(eventRange.endDate.getTime(), endDate.getTime());
            if (overlapEndMs <= overlapStartMs) return false;

            const startOffset = (overlapStartMs - startDate.getTime()) / (60 * 1000);
            const endOffset = (overlapEndMs - startDate.getTime()) / (60 * 1000);
            return {
                startOffset,
                endOffset,
                clockStartMinutes: displayWindow.start + startOffset,
                clockEndMinutes: displayWindow.start + endOffset,
                overlap: endOffset - startOffset
            };
        }

        function getVisibleEventSegment(event, displayWindow) {
            if (isCalendarClockDateParseFailed(event)) return null;

            const datedSegment = getDatedVisibleEventSegment(event, displayWindow);
            if (datedSegment !== null) return datedSegment || null;
            if (isUndatedGoogleTaskHiddenOutsideToday(event)) return null;

            const eventStart = parseTimeToDayMinutes(event.start);
            const eventEnd = parseTimeToDayMinutes(event.end);
            if (eventStart === null || eventEnd === null) return null;

            if (isPointCalendarEvent(event)) {
                if (use24HourRadial || displayWindow.duration >= RADIAL_24_HOUR_CYCLE_MINUTES) {
                    return {
                        startOffset: eventStart,
                        endOffset: eventStart,
                        clockStartMinutes: eventStart,
                        clockEndMinutes: eventStart,
                        overlap: 0,
                        isPointEvent: true
                    };
                }

                const windowStart = displayWindow.start;
                const windowEnd = windowStart + displayWindow.duration;
                let best = null;

                [-24 * 60, 0, 24 * 60].forEach(shift => {
                    const shiftedStart = eventStart + shift;
                    if (shiftedStart >= windowStart && shiftedStart < windowEnd && !best) {
                        best = {
                            startOffset: shiftedStart - windowStart,
                            endOffset: shiftedStart - windowStart,
                            clockStartMinutes: shiftedStart,
                            clockEndMinutes: shiftedStart,
                            overlap: 0,
                            isPointEvent: true
                        };
                    }
                });

                return best;
            }

            if (use24HourRadial || displayWindow.duration >= RADIAL_24_HOUR_CYCLE_MINUTES) {
                const adjustedEnd = eventEnd <= eventStart ? eventEnd + RADIAL_24_HOUR_CYCLE_MINUTES : eventEnd;
                const endOffset = eventStart === eventEnd ? eventStart + RADIAL_24_HOUR_CYCLE_MINUTES : adjustedEnd;
                return {
                    startOffset: eventStart,
                    endOffset,
                    clockStartMinutes: eventStart,
                    clockEndMinutes: endOffset,
                    overlap: Math.min(RADIAL_24_HOUR_CYCLE_MINUTES, endOffset - eventStart)
                };
            }

            const windowStart = displayWindow.start;
            const windowEnd = windowStart + displayWindow.duration;
            const baseEventEnd = eventEnd <= eventStart ? eventEnd + 24 * 60 : eventEnd;
            let best = null;

            [-24 * 60, 0, 24 * 60].forEach(shift => {
                const shiftedStart = eventStart + shift;
                const shiftedEnd = baseEventEnd + shift;
                const overlapStart = Math.max(shiftedStart, windowStart);
                const overlapEnd = Math.min(shiftedEnd, windowEnd);
                const overlap = overlapEnd - overlapStart;

                if (overlap > 0 && (!best || overlap > best.overlap)) {
                    best = {
                        startOffset: overlapStart - windowStart,
                        endOffset: overlapEnd - windowStart,
                        clockStartMinutes: overlapStart,
                        clockEndMinutes: overlapEnd,
                        overlap
                    };
                }
            });

            return best;
        }

        function shouldRenderCalendarEventArc(event) {
            return longDurationArcsVisible !== false || !isLongDurationCalendarEvent(event);
        }

        function segmentIntervalsForCycle(segment, cycleMinutes) {
            if (segment.isPointEvent) {
                const point = ((segment.clockStartMinutes % cycleMinutes) + cycleMinutes) % cycleMinutes;
                const halfWidth = 1;
                const start = point - halfWidth;
                const end = point + halfWidth;
                if (start >= 0 && end <= cycleMinutes) return [{ start, end }];
                if (start < 0) {
                    return [
                        { start: cycleMinutes + start, end: cycleMinutes },
                        { start: 0, end }
                    ];
                }
                return [
                    { start, end: cycleMinutes },
                    { start: 0, end: end - cycleMinutes }
                ];
            }

            const duration = Math.max(0, segment.clockEndMinutes - segment.clockStartMinutes);
            if (!duration) return [];
            if (duration >= cycleMinutes) return [{ start: 0, end: cycleMinutes }];

            const start = ((segment.clockStartMinutes % cycleMinutes) + cycleMinutes) % cycleMinutes;
            const end = start + duration;
            if (end <= cycleMinutes) return [{ start, end }];
            return [
                { start, end: cycleMinutes },
                { start: 0, end: end - cycleMinutes }
            ];
        }

        function getArcLaneOverlapToleranceMinutes() {
            // Zero overlap is always sequential; the optional tolerance only absorbs capture/rounding noise.
            return arcSameLevelNonOverlapping ? ARC_SEQUENTIAL_TOLERANCE_MINUTES : 0;
        }

        function intervalSetsOverlap(left, right, overlapToleranceMinutes = 0) {
            return left.some(leftInterval => right.some(rightInterval => (
                Math.min(leftInterval.end, rightInterval.end) - Math.max(leftInterval.start, rightInterval.start) > overlapToleranceMinutes
            )));
        }

        function assignCircularArcLanes(segments) {
            const cycleMinutes = getClockCycleMinutes();
            const lanes = [];
            const overlapToleranceMinutes = getArcLaneOverlapToleranceMinutes();

            return segments
                .slice()
                .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset)
                .map(segment => {
                    const intervals = segmentIntervalsForCycle(segment, cycleMinutes);
                    let lane = lanes.findIndex(existingIntervals => !intervalSetsOverlap(intervals, existingIntervals, overlapToleranceMinutes));
                    if (lane === -1) {
                        lane = lanes.length;
                        lanes.push([]);
                    }
                    lanes[lane].push(...intervals);
                    return { ...segment, lane, laneCount: lanes.length };
                });
        }

        function assignArcLanes(segments) {
            if (use24HourRadial) return assignCircularArcLanes(segments);

            const laneEnds = [];
            const overlapToleranceMinutes = getArcLaneOverlapToleranceMinutes();

            return segments
                .slice()
                .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset)
                .map(segment => {
                    let lane = laneEnds.findIndex(end => segment.startOffset >= end - overlapToleranceMinutes);
                    if (lane === -1) lane = laneEnds.length;
                    laneEnds[lane] = segment.endOffset;
                    return { ...segment, lane, laneCount: laneEnds.length };
                });
        }

        function getAlternatingArcLabelSides(laneSegments) {
            const sides = new Map();
            laneSegments
                .filter(segment => !segment.isPointEvent)
                .slice()
                .sort((a, b) => (
                    a.startOffset - b.startOffset
                    || a.endOffset - b.endOffset
                    || a.index - b.index
                ))
                .forEach((segment, position) => {
                    sides.set(segment.index, position % 2 === 0 ? -1 : 1);
                });
            return sides;
        }

        function areArcEventsSameColor(left, right) {
            return String(left?.event?.color || "").trim().toLowerCase() === String(right?.event?.color || "").trim().toLowerCase();
        }

        function shouldSeparateSameColorNeighbor(previous, current, cycleMinutes = null) {
            if (!previous || !current || previous.lane !== current.lane || !areArcEventsSameColor(previous, current)) return false;

            const boundaryGap = cycleMinutes
                ? current.startOffset + cycleMinutes - previous.endOffset
                : current.startOffset - previous.endOffset;
            return boundaryGap >= -ARC_SEQUENTIAL_TOLERANCE_MINUTES && boundaryGap <= ARC_SEQUENTIAL_TOLERANCE_MINUTES;
        }

        function getSameColorSequentialSeparatorIndexes(laneSegments) {
            const indexes = new Set();
            const byLane = new Map();
            laneSegments
                .filter(segment => !segment.isPointEvent)
                .forEach(segment => {
                    if (!byLane.has(segment.lane)) byLane.set(segment.lane, []);
                    byLane.get(segment.lane).push(segment);
                });

            byLane.forEach(segments => {
                const sorted = segments.slice().sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
                sorted.forEach((segment, position) => {
                    if (position > 0 && shouldSeparateSameColorNeighbor(sorted[position - 1], segment)) {
                        indexes.add(segment.index);
                    }
                });

                if (use24HourRadial && sorted.length > 1) {
                    const first = sorted[0];
                    const last = sorted[sorted.length - 1];
                    if (shouldSeparateSameColorNeighbor(last, first, getClockCycleMinutes())) {
                        indexes.add(first.index);
                    }
                }
            });

            return indexes;
        }

        function updateArcSeparator(index, showSeparator, radius, segment, arcStrokeWidth) {
            document.querySelectorAll(`.time-arc-separator-${index + 1}`).forEach(separator => {
                separator.style.display = showSeparator ? "inline" : "none";
                if (!showSeparator) return;

                const angle = segment.clockStartMinutes / getClockCycleMinutes() * 360;
                const halfLength = Math.max(arcStrokeWidth * 1.7, 12);
                const inner = pointOnClockArc(clockSize / 2, clockSize / 2, radius - halfLength, angle);
                const outer = pointOnClockArc(clockSize / 2, clockSize / 2, radius + halfLength, angle);
                const shadow = separator.querySelector(".time-arc-separator-shadow");
                const cut = separator.querySelector(".time-arc-separator-cut");

                [shadow, cut].forEach(line => {
                    if (!line) return;
                    line.setAttribute("x1", String(inner.x));
                    line.setAttribute("y1", String(inner.y));
                    line.setAttribute("x2", String(outer.x));
                    line.setAttribute("y2", String(outer.y));
                });

                if (shadow) shadow.setAttribute("stroke-width", String(Math.max(7, arcStrokeWidth * 0.92)));
                if (cut) cut.setAttribute("stroke-width", String(Math.max(2.4, arcStrokeWidth * 0.34)));
            });
        }

        function updateWindowStartMarkers() {
            if (!clockSize) return;

            const displayWindow = getDisplayWindow();
            const showMarker = windowStartMarkerVisible && Number.isFinite(displayWindow.start);
            const cx = clockSize / 2;
            const cy = clockSize / 2;
            const targetAngle = showMarker ? displayWindow.start / getClockCycleMinutes() * 360 : 0;
            const angle = getWindowStartMarkerRenderAngle(targetAngle, showMarker);
            const inner = pointOnClockArc(cx, cy, clockSize * 0.105, angle);
            const outer = pointOnClockArc(cx, cy, clockSize * 0.425, angle);
            const markerPulse = getWindowStartMarkerPulse(showMarker && windowStartMarkerPulse !== false, angle, getCurrentClockAngle());

            document.querySelectorAll(".window-start-marker").forEach(marker => {
                const svg = marker.closest("svg");
                const pulseGroup = ensureWindowStartMarkerPulseGroup(svg);
                const emojiGroup = ensureWindowStartMarkerEmojiGroup(svg);
                const labelsGroup = ensureWindowStartMarkerLabelsGroup(svg);
                if (!showMarker) {
                    marker.style.display = "none";
                    if (pulseGroup) hideWindowStartMarkerPulseGroup(pulseGroup);
                    if (emojiGroup) emojiGroup.style.display = "none";
                    if (labelsGroup) labelsGroup.style.display = "none";
                    return;
                }

                marker.setAttribute("x1", String(inner.x));
                marker.setAttribute("y1", String(inner.y));
                marker.setAttribute("x2", String(outer.x));
                marker.setAttribute("y2", String(outer.y));

                const color = windowStartMarkerColor || "#3a1860";
                const shape = ["dots", "line", "emoji"].includes(windowStartMarkerShape) ? windowStartMarkerShape : "dots";
                const style = ["subtle", "dots", "line", "strong", "glow", "custom"].includes(windowStartMarkerStyle)
                    ? windowStartMarkerStyle
                    : "dots";
                const width = getWindowStartMarkerWidth();
                const dots = getWindowStartMarkerDots();
                const transparency = getWindowStartMarkerTransparency();
                const opacity = (100 - transparency) / 100;

                if (pulseGroup) {
                    updateWindowStartMarkerPulseGroup(pulseGroup, {
                        angle,
                        color,
                        enabled: markerPulse.enabled,
                        inner,
                        opacity,
                        outer,
                        pulseSerial: markerPulse.serial,
                        spanDeg: markerPulse.spanDeg,
                        trigger: markerPulse.trigger,
                        width
                    });
                }
                marker.style.display = shape === "emoji" ? "none" : "";
                if (emojiGroup) {
                    emojiGroup.style.display = shape === "emoji" ? "" : "none";
                    if (shape === "emoji") {
                        updateWindowStartMarkerEmojiGroup(emojiGroup, {
                            angle,
                            color,
                            count: dots,
                            emoji: getWindowStartMarkerEmoji(),
                            opacity,
                            style,
                            width
                        });
                    }
                }
                if (labelsGroup) {
                    labelsGroup.style.display = windowStartMarkerLabels === true ? "" : "none";
                    if (windowStartMarkerLabels === true) {
                        updateWindowStartMarkerLabelsGroup(labelsGroup, {
                            angle,
                            color,
                            opacity,
                            style
                        });
                    }
                }

                marker.style.setProperty("--window-start-marker-color", color);
                marker.style.setProperty("--window-start-marker-width", `${width}px`);
                marker.style.setProperty("--window-start-marker-opacity", String(opacity));
                marker.style.setProperty("--window-start-marker-glow", style === "glow" ? ".56vmin" : style === "strong" ? ".44vmin" : ".32vmin");

                const lineLength = clockSize * (0.425 - 0.105);
                const gap = dots > 1 ? (lineLength / (dots - 1)) - 0.01 : 99999;
                marker.style.setProperty("--window-start-marker-dasharray", shape === "line" ? "none" : `0.01 ${gap}`);
            });
        }

        function resetWindowStartMarkerMotion() {
            windowStartMarkerAnimatedAngle = null;
            windowStartMarkerLastTargetAngle = null;
            windowStartMarkerPulseRequested = false;
            if (windowStartMarkerPulseTimerId) {
                clearTimeout(windowStartMarkerPulseTimerId);
                windowStartMarkerPulseTimerId = null;
            }
        }

        function queueWindowStartMarkerPulse() {
            if (windowStartMarkerPulseTimerId) clearTimeout(windowStartMarkerPulseTimerId);
            windowStartMarkerPulseTimerId = setTimeout(() => {
                windowStartMarkerPulseTimerId = null;
                windowStartMarkerPulseRequested = true;
            }, WINDOW_START_MARKER_PULSE_DELAY_MS);
        }

        function getWindowStartMarkerRenderAngle(targetAngle, showMarker) {
            if (!showMarker || !Number.isFinite(targetAngle)) {
                resetWindowStartMarkerMotion();
                return 0;
            }

            const normalizedTargetAngle = normalizeClockAngle(targetAngle);
            if (windowStartMarkerAnimatedAngle === null || windowStartMarkerLastTargetAngle === null) {
                windowStartMarkerAnimatedAngle = normalizedTargetAngle;
                windowStartMarkerLastTargetAngle = normalizedTargetAngle;
                return normalizedTargetAngle;
            }

            const targetDelta = getShortestClockAngleDelta(windowStartMarkerLastTargetAngle, normalizedTargetAngle);
            if (Math.abs(targetDelta) >= 0.1) {
                windowStartMarkerLastTargetAngle = normalizedTargetAngle;
                if (Math.abs(targetDelta) >= WINDOW_START_MARKER_PULSE_MIN_TARGET_DELTA_DEG) {
                    queueWindowStartMarkerPulse();
                }
            }

            const animationDelta = getShortestClockAngleDelta(windowStartMarkerAnimatedAngle, normalizedTargetAngle);
            if (Math.abs(animationDelta) <= WINDOW_START_MARKER_SETTLE_DEG) {
                windowStartMarkerAnimatedAngle = normalizedTargetAngle;
                return normalizedTargetAngle;
            }

            windowStartMarkerAnimatedAngle = normalizeClockAngle(
                windowStartMarkerAnimatedAngle + animationDelta * WINDOW_START_MARKER_EASE
            );
            return windowStartMarkerAnimatedAngle;
        }

        function getWindowStartMarkerPulse(enabled, markerAngle, targetAngle) {
            if (!enabled || !Number.isFinite(markerAngle) || !Number.isFinite(targetAngle)) {
                windowStartMarkerPulseRequested = false;
                return { enabled: false, serial: 0, spanDeg: 0, trigger: false };
            }

            const normalizedMarkerAngle = normalizeClockAngle(markerAngle);
            const normalizedTargetAngle = normalizeClockAngle(targetAngle);
            const spanDeg = normalizeClockAngle(normalizedTargetAngle - normalizedMarkerAngle);
            if (!windowStartMarkerPulseRequested) {
                return { enabled: true, serial: windowStartMarkerPulseSerial, spanDeg, trigger: false };
            }

            windowStartMarkerPulseRequested = false;
            return {
                enabled: true,
                serial: ++windowStartMarkerPulseSerial,
                spanDeg,
                trigger: true
            };
        }

        function ensureWindowStartMarkerPulseGroup(svg) {
            if (!svg) return null;
            let group = svg.querySelector(".window-start-marker-pulse-group");
            if (group) return group;

            group = document.createElementNS(SVG_NS, "g");
            group.classList.add("window-start-marker-pulse-group");
            group.setAttribute("aria-hidden", "true");

            const orbit = document.createElementNS(SVG_NS, "path");
            orbit.classList.add("window-start-marker-pulse-orbit");
            orbit.setAttribute("fill", "none");
            orbit.setAttribute("pathLength", "1");
            group.appendChild(orbit);

            const radial = document.createElementNS(SVG_NS, "line");
            radial.classList.add("window-start-marker-pulse-radial");
            group.appendChild(radial);

            const marker = svg.querySelector(".window-start-marker");
            if (marker) {
                svg.insertBefore(group, marker);
            } else {
                svg.prepend(group);
            }
            return group;
        }

        function hideWindowStartMarkerPulseGroup(group) {
            group.style.display = "none";
            group.classList.remove("is-pulsing");
        }

        function updateWindowStartMarkerPulseGroup(group, options) {
            if (!options.enabled) {
                hideWindowStartMarkerPulseGroup(group);
                return;
            }

            const orbit = group.querySelector(".window-start-marker-pulse-orbit");
            const radial = group.querySelector(".window-start-marker-pulse-radial");
            if (!orbit || !radial) return;

            const pulseLineWidth = Math.max(options.width * 1.35, clockSize * 0.007);
            const pulseArcWidth = Math.max(options.width * 1.08, clockSize * 0.0055);
            const spanDeg = Math.min(359.99, Math.max(0, Number(options.spanDeg) || 0));
            const arcStartDeg = options.angle;
            const arcEndDeg = options.angle + spanDeg;

            group.style.display = "";
            group.style.setProperty("--window-start-marker-pulse-color", options.color || "#3a1860");
            group.style.setProperty("--window-start-marker-pulse-opacity", String(Math.max(0.08, Math.min(0.24, options.opacity * 0.28))));
            radial.setAttribute("x1", String(options.inner.x));
            radial.setAttribute("y1", String(options.inner.y));
            radial.setAttribute("x2", String(options.outer.x));
            radial.setAttribute("y2", String(options.outer.y));
            radial.setAttribute("stroke-width", String(pulseLineWidth));
            orbit.setAttribute("stroke-width", String(pulseArcWidth));
            orbit.setAttribute("d", describeClockArcDegrees(
                clockSize,
                clockSize * 0.438,
                arcStartDeg,
                arcEndDeg,
                { clockwise: true }
            ));

            if (!options.trigger) return;

            group.dataset.pulse = String(options.pulseSerial);
            group.classList.remove("is-pulsing");
            void group.getBoundingClientRect().width;
            group.classList.add("is-pulsing");
        }

        function ensureWindowStartMarkerLabelsGroup(svg) {
            if (!svg) return null;
            let group = svg.querySelector(".window-start-marker-labels-group");
            if (group) return group;
            group = document.createElementNS(SVG_NS, "g");
            group.classList.add("window-start-marker-labels-group");
            ["Past", "Future"].forEach(label => {
                const text = document.createElementNS(SVG_NS, "text");
                text.classList.add("window-start-marker-boundary-label");
                text.textContent = label;
                group.appendChild(text);
            });
            svg.appendChild(group);
            return group;
        }

        function ensureWindowStartMarkerEmojiGroup(svg) {
            if (!svg) return null;
            let group = svg.querySelector(".window-start-marker-emoji-group");
            if (group) return group;
            group = document.createElementNS(SVG_NS, "g");
            group.classList.add("window-start-marker-emoji-group");
            svg.appendChild(group);
            return group;
        }

        function updateWindowStartMarkerEmojiGroup(group, options) {
            const count = Math.max(1, Math.min(50, Number(options.count) || 1));
            while (group.childElementCount < count) {
                const text = document.createElementNS(SVG_NS, "text");
                text.classList.add("window-start-marker-emoji");
                group.appendChild(text);
            }
            while (group.childElementCount > count) {
                group.lastElementChild.remove();
            }

            const innerRadius = clockSize * 0.105;
            const outerRadius = clockSize * 0.425;
            const fontSize = Math.max(10, options.width * 5.25);
            const glow = options.style === "glow" ? ".56vmin" : options.style === "strong" ? ".44vmin" : ".32vmin";

            Array.from(group.children).forEach((text, index) => {
                const ratio = count === 1 ? 0.5 : index / (count - 1);
                const radius = innerRadius + (outerRadius - innerRadius) * ratio;
                const point = pointOnClockArc(clockSize / 2, clockSize / 2, radius, options.angle);
                text.textContent = options.emoji;
                text.setAttribute("x", String(point.x));
                text.setAttribute("y", String(point.y));
                text.style.setProperty("--window-start-marker-color", options.color);
                text.style.setProperty("--window-start-marker-opacity", String(options.opacity));
                text.style.setProperty("--window-start-marker-glow", glow);
                text.style.fontSize = `${fontSize}px`;
            });
        }

        function updateWindowStartMarkerLabelsGroup(group, options) {
            const center = clockSize / 2;
            const baseRadius = clockSize * 0.455;
            const sideClearance = Math.max(13, clockSize * 0.026);
            const angleRad = options.angle * Math.PI / 180;
            const dx = Math.sin(angleRad);
            const dy = -Math.cos(angleRad);
            const clockwiseTangent = {
                x: Math.cos(angleRad),
                y: Math.sin(angleRad)
            };
            const readableRotation = getReadableLineTextRotation(Math.atan2(dy, dx) * 180 / Math.PI);
            const base = {
                x: center + dx * baseRadius,
                y: center + dy * baseRadius
            };
            const glow = options.style === "glow" ? ".56vmin" : options.style === "strong" ? ".44vmin" : ".32vmin";
            const labels = [
                { text: "Future", side: -sideClearance },
                { text: "Past", side: sideClearance }
            ];

            labels.forEach((label, index) => {
                const text = group.children[index];
                const point = {
                    x: base.x + clockwiseTangent.x * label.side,
                    y: base.y + clockwiseTangent.y * label.side
                };
                text.textContent = label.text;
                text.setAttribute("x", String(point.x));
                text.setAttribute("y", String(point.y));
                text.setAttribute("transform", `rotate(${readableRotation} ${point.x} ${point.y})`);
                text.style.setProperty("--window-start-marker-color", options.color);
                text.style.setProperty("--window-start-marker-opacity", String(options.opacity));
                text.style.setProperty("--window-start-marker-glow", glow);
            });
        }

        function getReadableLineTextRotation(angleDeg) {
            let normalized = ((angleDeg % 360) + 360) % 360;
            if (normalized > 180) normalized -= 360;
            if (normalized > 90 || normalized < -90) normalized += 180;
            return normalized;
        }

        function getArcPixelLength(radius, startMinutes, endMinutes) {
            const durationMinutes = Math.max(0, endMinutes - startMinutes);
            const durationRatio = Math.min(durationMinutes / getClockCycleMinutes(), 359.99 / 360);
            return Math.PI * 2 * radius * durationRatio;
        }

        function shouldReverseArcLabelPath(startMinutes, endMinutes) {
            const durationMinutes = Math.max(0, endMinutes - startMinutes);
            const cycleMinutes = getClockCycleMinutes();
            const middleMinutes = startMinutes + durationMinutes / 2;
            const middleDeg = ((middleMinutes / cycleMinutes * 360) % 360 + 360) % 360;
            return middleDeg > 90 && middleDeg < 270;
        }

        function getArcLabelPerpendicularMetrics(labelText, fontSize) {
            const safeFontSize = Math.max(0, Number(fontSize) || 0);
            const fallback = {
                ascent: safeFontSize * ARC_LABEL_FALLBACK_ASCENT_RATIO,
                descent: safeFontSize * ARC_LABEL_FALLBACK_DESCENT_RATIO
            };
            const context = getArcLabelMeasurementContext();
            if (!context || !labelText) return fallback;

            context.font = `800 ${safeFontSize}px ${getEventLabelFontFamily()}`;
            const metrics = context.measureText(String(labelText));
            const ascent = Number(metrics.actualBoundingBoxAscent);
            const descent = Number(metrics.actualBoundingBoxDescent);
            return {
                ascent: Number.isFinite(ascent) && ascent >= 0 ? ascent : fallback.ascent,
                descent: Number.isFinite(descent) && descent >= 0 ? descent : fallback.descent
            };
        }

        function getArcLabelRadialClearance(labelText, fontSize, radialSide, reverseLabelPath, arcStrokeWidth) {
            const isOuterLabel = radialSide > 0;
            const ascentFacesArc = isOuterLabel ? !reverseLabelPath : reverseLabelPath;
            const metrics = getArcLabelPerpendicularMetrics(labelText, fontSize);
            const inkExtentTowardArc = ascentFacesArc ? metrics.ascent : metrics.descent;
            const opticalNudge = !isOuterLabel && reverseLabelPath
                ? Math.max(0, Number(fontSize) || 0) * ARC_LABEL_INNER_REVERSED_NUDGE_RATIO
                : 0;
            return Math.max(0, Number(arcStrokeWidth) || 0) / 2
                + Math.max(0, inkExtentTowardArc - opticalNudge);
        }

        function getArcLabelRadius(radius, fontSize, radialSide, reverseLabelPath, labelText, arcStrokeWidth) {
            const isOuterLabel = radialSide > 0;
            const radialClearance = getArcLabelRadialClearance(
                labelText,
                fontSize,
                radialSide,
                reverseLabelPath,
                arcStrokeWidth
            );
            const distance = getEventLabelArcDistance() + radialClearance;
            if (isOuterLabel) {
                return Math.min(
                    Math.max(radius, clockSize / 2 - fontSize * 0.45),
                    radius + distance
                );
            }
            return Math.max(fontSize * 0.75, radius - distance);
        }

        function getArcLabelTrimmedText(title, maxChars) {
            const visibleChars = Math.max(1, maxChars - 1);
            return `${title.slice(0, visibleChars).trimEnd()}…`;
        }

        function getArcLabelFullText(event) {
            return String(event?.title || "").replace(/\s+/g, " ").trim() || "(No title)";
        }

        function getArcLabelText(event, arcPixelLength, fontSize) {
            const title = getArcLabelFullText(event);
            if (!title) return "";
            const shortenThreshold = getEventLabelShortenThreshold();
            if (shortenThreshold >= 305) return title;
            const allowedPixelLength = arcPixelLength * (shortenThreshold / 100);
            const maxChars = Math.floor(allowedPixelLength / Math.max(1, fontSize * 0.56));
            if (maxChars < getEventLabelMinLength()) return "";
            if (title.length <= maxChars) return title;
            return getArcLabelTrimmedText(title, maxChars);
        }

        function getArcLabelEstimatedPixelLength(text, fontSize) {
            const labelText = String(text || "");
            const fallbackLength = labelText.length * Math.max(1, fontSize * 0.56);
            const context = getArcLabelMeasurementContext();
            if (!context || !labelText) return fallbackLength;

            context.font = `800 ${fontSize}px ${getEventLabelFontFamily()}`;
            const measuredLength = context.measureText(labelText).width;
            return Number.isFinite(measuredLength) && measuredLength > 0
                ? measuredLength
                : fallbackLength;
        }

        function getArcLabelPathPadding(labelPixelLength, fontSize) {
            if (!labelPixelLength) return 0;
            return Math.max(fontSize * 3, Math.min(fontSize * 5, labelPixelLength * 0.12));
        }

        function getArcLabelTextPathAnchor(anchor) {
            if (anchor === "start") return { startOffset: "0%", textAnchor: "start" };
            if (anchor === "end") return { startOffset: "100%", textAnchor: "end" };
            return { startOffset: "50%", textAnchor: "middle" };
        }

        function applyArcLabelTextPathAnchor(textPath, textPathAnchor) {
            textPath.setAttribute("startOffset", textPathAnchor.startOffset);
            textPath.setAttribute("text-anchor", textPathAnchor.textAnchor);
            textPath.style.textAnchor = textPathAnchor.textAnchor;
        }

        function getArcLabelAnchoredRange(segment, desiredDuration, anchor, reverse) {
            if (anchor === "start") {
                return reverse
                    ? { startMinutes: segment.clockEndMinutes - desiredDuration, endMinutes: segment.clockEndMinutes }
                    : { startMinutes: segment.clockStartMinutes, endMinutes: segment.clockStartMinutes + desiredDuration };
            }
            if (anchor === "end") {
                return reverse
                    ? { startMinutes: segment.clockStartMinutes, endMinutes: segment.clockStartMinutes + desiredDuration }
                    : { startMinutes: segment.clockEndMinutes - desiredDuration, endMinutes: segment.clockEndMinutes };
            }

            const eventDuration = Math.max(0, segment.clockEndMinutes - segment.clockStartMinutes);
            const middleMinutes = eventDuration
                ? segment.clockStartMinutes + eventDuration / 2
                : segment.clockStartMinutes;
            return {
                startMinutes: middleMinutes - desiredDuration / 2,
                endMinutes: middleMinutes + desiredDuration / 2
            };
        }

        function getArcLabelPathRange(labelText, arcPixelLength, fontSize, radius, segment, options = {}) {
            const eventDuration = Math.max(0, segment.clockEndMinutes - segment.clockStartMinutes);
            if (!labelText || !radius) {
                return {
                    startMinutes: segment.clockStartMinutes,
                    endMinutes: segment.clockEndMinutes
                };
            }

            const cycleMinutes = getClockCycleMinutes();
            const labelPixelLength = getArcLabelEstimatedPixelLength(labelText, fontSize);
            const desiredPixelLength = Math.max(
                arcPixelLength,
                labelPixelLength + getArcLabelPathPadding(labelPixelLength, fontSize)
            );
            const maxDuration = cycleMinutes * (359.99 / 360);
            const desiredDuration = Math.min(
                maxDuration,
                Math.max(eventDuration, desiredPixelLength / (Math.PI * 2 * radius) * cycleMinutes)
            );
            return getArcLabelAnchoredRange(segment, desiredDuration, options.anchor, options.reverse === true);
        }

        function updateArcLabels(index, event, showArc, radius, segment, arcStrokeWidth, radialSide = -1) {
            const canRenderArcLabel = showArc && Boolean(segment);
            const isPointEvent = canRenderArcLabel && segment.isPointEvent === true;
            const proximityPresentation = getEventLabelProximityPresentation(event);
            const fontSize = getEventLabelScaledFontSize(
                getArcLabelFontSize(),
                proximityPresentation.fontScale
            );
            const reverseLabelPath = canRenderArcLabel
                ? shouldReverseArcLabelPath(segment.clockStartMinutes, segment.clockEndMinutes)
                : false;
            const fullLabelText = canRenderArcLabel ? getArcLabelFullText(event) : "";
            const labelRadius = canRenderArcLabel
                ? getArcLabelRadius(
                    radius,
                    fontSize,
                    radialSide,
                    reverseLabelPath,
                    fullLabelText,
                    arcStrokeWidth
                )
                : radius;
            const arcPixelLength = canRenderArcLabel && !isPointEvent
                ? getArcPixelLength(labelRadius, segment.clockStartMinutes, segment.clockEndMinutes)
                : 0;
            const labelPixelLength = isPointEvent ? Math.max(clockSize * 0.18, arcStrokeWidth * 8) : arcPixelLength;
            const faceLabelsVisible = getClockFaceArcConfig().labelsVisible !== false;
            const labelAnchor = getEventLabelAnchor();
            const labelText = faceLabelsVisible && eventLabelsVisible && canRenderArcLabel
                ? proximityPresentation.showFullTitle
                    ? fullLabelText
                    : getArcLabelText(event, labelPixelLength, fontSize)
                : "";
            const textPathAnchor = getArcLabelTextPathAnchor(labelAnchor);
            let labelPath = "";
            if (canRenderArcLabel) {
                const labelPathRange = getArcLabelPathRange(labelText, labelPixelLength, fontSize, labelRadius, segment, {
                    anchor: labelAnchor,
                    reverse: reverseLabelPath
                });
                labelPath = describeClockArc(
                    clockSize,
                    labelRadius,
                    labelPathRange.startMinutes,
                    labelPathRange.endMinutes,
                    { reverse: reverseLabelPath }
                );
            }

            document.querySelectorAll(`.time-arc-label-path-${index + 1}`).forEach(path => {
                path.setAttribute("d", labelPath);
            });

            document.querySelectorAll(`.time-arc-label-${index + 1}`).forEach(label => {
                label.style.display = labelText ? "" : "none";
                label.style.fontSize = `${fontSize}px`;
                label.style.fontFamily = getEventLabelFontFamily();
                label.style.dominantBaseline = "alphabetic";
                label.style.color = event.color;
                label.style.setProperty("--event-color", event.color);
                label.style.setProperty("--custom-label-color", eventLabelCustomColor);
                label.style.opacity = String(getEventLabelOpacity() / 100);
                EVENT_LABEL_STYLES.forEach(style => label.classList.toggle(`time-arc-label--${style}`, style === eventLabelStyle));
                const textPath = label.querySelector("textPath");
                if (textPath) {
                    applyArcLabelTextPathAnchor(textPath, textPathAnchor);
                    textPath.textContent = labelText;
                }
            });
        }

        function getPointLabelText(event, fontSize, showFullTitle = false) {
            return showFullTitle
                ? getArcLabelFullText(event)
                : getArcLabelText(event, clockSize * 0.24, fontSize);
        }

        function layoutPointCalloutSide(items, side, fontSize) {
            const minY = clockSize * 0.105;
            const maxY = clockSize * 0.895;
            const gap = Math.max(15, fontSize * 1.35);
            const sorted = items.slice().sort((a, b) => a.anchor.y - b.anchor.y);
            let previousY = minY - gap;

            sorted.forEach(item => {
                item.labelY = Math.min(maxY, Math.max(minY, Math.max(item.anchor.y, previousY + gap)));
                previousY = item.labelY;
            });

            const overflow = sorted.length ? sorted[sorted.length - 1].labelY - maxY : 0;
            if (overflow > 0) {
                sorted.forEach(item => {
                    item.labelY -= overflow;
                });
            }

            for (let index = sorted.length - 2; index >= 0; index -= 1) {
                sorted[index].labelY = Math.min(sorted[index].labelY, sorted[index + 1].labelY - gap);
            }

            sorted.forEach(item => {
                item.labelY = Math.min(maxY, Math.max(minY, item.labelY));
                item.side = side;
            });

            return sorted;
        }

        function updatePointCalloutLabels(items, arcStrokeWidth) {
            if (getClockFaceArcConfig().labelsVisible === false) {
                document.querySelectorAll(".time-point-callout").forEach(callout => {
                    callout.style.display = "none";
                });
                return;
            }

            const baseFontSize = getArcLabelFontSize();
            const center = clockSize / 2;
            const left = [];
            const right = [];

            items.forEach(item => {
                const proximityPresentation = getEventLabelProximityPresentation(item.event);
                const fontSize = getEventLabelScaledFontSize(baseFontSize, proximityPresentation.fontScale);
                const text = getPointLabelText(item.event, fontSize, proximityPresentation.showFullTitle);
                if (!text) return;
                const angle = item.segment.clockStartMinutes / getClockCycleMinutes() * 360;
                const anchor = pointOnClockArc(center, center, item.radius, angle);
                const side = anchor.x >= center ? 1 : -1;
                (side > 0 ? right : left).push({ ...item, anchor, text, fontSize });
            });

            const leftLayoutFontSize = Math.max(baseFontSize, ...left.map(item => item.fontSize));
            const rightLayoutFontSize = Math.max(baseFontSize, ...right.map(item => item.fontSize));
            const byIndex = new Map([
                ...layoutPointCalloutSide(left, -1, leftLayoutFontSize),
                ...layoutPointCalloutSide(right, 1, rightLayoutFontSize)
            ].map(item => [item.index, item]));

            calendarEvents.forEach((event, index) => {
                const item = byIndex.get(index);
                document.querySelectorAll(`.time-point-callout-${index + 1}`).forEach(callout => {
                    callout.style.display = item ? "" : "none";
                    if (!item) return;

                    const line = callout.querySelector(".time-point-callout-line");
                    const dot = callout.querySelector(".time-point-callout-dot");
                    const label = callout.querySelector(".time-point-callout-label");
                    if (!line || !dot || !label) return;

                    const labelX = item.side > 0 ? clockSize - clockSize * 0.03 : clockSize * 0.03;
                    const lineEndX = labelX - item.side * 4;
                    const elbowX = center + item.side * clockSize * 0.435;
                    const path = `M ${item.anchor.x} ${item.anchor.y} L ${elbowX} ${item.labelY} L ${lineEndX} ${item.labelY}`;
                    callout.style.color = event.color;
                    callout.style.setProperty("--event-color", event.color);
                    line.setAttribute("d", path);
                    dot.setAttribute("cx", String(item.anchor.x));
                    dot.setAttribute("cy", String(item.anchor.y));
                    dot.setAttribute("r", String(Math.max(2.2, arcStrokeWidth * 0.34)));
                    label.textContent = item.text;
                    label.setAttribute("x", String(labelX));
                    label.setAttribute("y", String(item.labelY));
                    label.setAttribute("text-anchor", item.side > 0 ? "end" : "start");
                    label.style.fontSize = `${item.fontSize}px`;
                    label.style.fontFamily = getEventLabelFontFamily();
                    label.style.color = event.color;
                    label.style.setProperty("--event-color", event.color);
                    label.style.setProperty("--custom-label-color", eventLabelCustomColor);
                    label.style.opacity = String(getEventLabelOpacity() / 100);
                    EVENT_LABEL_STYLES.forEach(style => label.classList.toggle(`time-arc-label--${style}`, style === eventLabelStyle));
                });
            });
        }

        function updateTimeArcs() {
            if (!clockSize) return;

            const displayWindow = getDisplayWindow();
            if (eventArcsVisible === false) {
                hideRenderedCalendarEventVisuals();
                updateWindowStartMarkers();
                return;
            }

            const segments = calendarEvents
                .map((event, index) => {
                    const segment = getVisibleEventSegment(event, displayWindow);
                    return segment && shouldRenderCalendarEventArc(event)
                        ? { ...segment, isPointEvent: isPointCalendarEvent(event), event, index }
                        : null;
                })
                .filter(Boolean);
            const laneSegments = assignArcLanes(segments);
            const laneCount = Math.max(1, ...laneSegments.map(segment => segment.lane + 1));
            const arcConfig = getClockFaceArcConfig();
            const densityT = Math.min(1, Math.max(0, Number(arcDensityLevel) / 100));
            const thicknessT = Math.min(1, Math.max(0, Number(arcThicknessLevel) / 100));
            const gapT = Math.min(1, Math.max(0, Number(arcGapLevel) / 100));
            const baseThicknessScale = thicknessT <= 0.5
                ? 0.55 + thicknessT * 0.9
                : 1 + ((thicknessT - 0.5) / 0.5) * 3.35;
            const maxThicknessScale = Number.isFinite(Number(arcConfig.maxThicknessScale))
                ? Number(arcConfig.maxThicknessScale)
                : Infinity;
            const thicknessScale = Math.min(baseThicknessScale, maxThicknessScale);
            const density = {
                outer: (arcConfig.outerBase ?? 0.398) + densityT * (arcConfig.outerRange ?? 0.052),
                inner: (arcConfig.innerBase ?? 0.20) - densityT * (arcConfig.innerRange ?? 0.125),
                stroke: (arcConfig.strokeBase ?? 0.0075) - densityT * (arcConfig.strokeRange ?? 0.003),
                minStroke: (arcConfig.minStrokeBase ?? 3) - densityT * (arcConfig.minStrokeRange ?? 1.9),
                maxStroke: arcConfig.maxStroke ?? Infinity,
                packedSpareRatio: arcConfig.packedSpareRatio ?? 0.55,
                pointRadiusMultiplier: arcConfig.pointRadiusMultiplier ?? 0.82,
                pointMinRadius: arcConfig.pointMinRadius ?? 4.5
            };
            const outerArcRadius = clockSize * density.outer;
            const innerArcRadius = clockSize * density.inner;
            const availableLaneSpan = Math.max(0, outerArcRadius - innerArcRadius);
            const arcStrokeWidth = Math.min(density.maxStroke, Math.max(
                density.minStroke * thicknessScale,
                Math.min(clockSize * density.stroke * thicknessScale, availableLaneSpan / laneCount)
            ));
            const spareLaneSpan = Math.max(0, availableLaneSpan - arcStrokeWidth * laneCount);
            const laneGap = laneCount > 1 ? gapT * (spareLaneSpan / (laneCount - 1)) : 0;
            const laneStep = arcStrokeWidth + laneGap;
            const packedOuterArcRadius = outerArcRadius - spareLaneSpan * density.packedSpareRatio * (1 - gapT);
            const byIndex = new Map(laneSegments.map(segment => [segment.index, segment]));
            const separatorIndexes = getSameColorSequentialSeparatorIndexes(laneSegments);
            const labelSides = getAlternatingArcLabelSides(laneSegments);
            const pointCalloutItems = [];

            calendarEvents.forEach((event, index) => {
                const segment = byIndex.get(index);
                const showArc = Boolean(segment);
                const showPoint = showArc && segment.isPointEvent;
                const showPointCallout = showPoint && eventLabelsVisible && clockOverlayMode === "full";
                const showPointArcLabel = showPoint && eventLabelsVisible && clockOverlayMode !== "full";
                const radius = showArc
                    ? Math.max(innerArcRadius + arcStrokeWidth / 2, packedOuterArcRadius - arcStrokeWidth / 2 - segment.lane * laneStep)
                    : outerArcRadius;

                document.querySelectorAll(`.time-arc-${index + 1}`).forEach(arc => {
                    arc.style.display = showArc && !showPoint ? "" : "none";
                    arc.classList.toggle("time-arc-long-duration", isLongDurationCalendarEvent(event));
                    if (!showArc || showPoint) return;

                    arc.setAttribute("stroke-width", String(arcStrokeWidth));
                    arc.setAttribute("d", describeClockArc(
                        clockSize,
                        radius,
                        segment.clockStartMinutes,
                        segment.clockEndMinutes
                    ));
                });

                document.querySelectorAll(`.time-point-${index + 1}`).forEach(point => {
                    point.style.display = showPoint ? "" : "none";
                    point.classList.toggle("time-point-long-duration", isLongDurationCalendarEvent(event));
                    if (!showPoint) return;

                    const coords = pointOnClockArc(
                        clockSize / 2,
                        clockSize / 2,
                        radius,
                        segment.clockStartMinutes / getClockCycleMinutes() * 360
                    );
                    const pointRadius = Math.max(arcStrokeWidth * density.pointRadiusMultiplier, density.pointMinRadius);
                    point.setAttribute("cx", String(coords.x));
                    point.setAttribute("cy", String(coords.y));
                    point.setAttribute("r", String(pointRadius));
                    point.setAttribute("stroke-width", String(Math.max(1.5, arcStrokeWidth * 0.32)));
                });

                if (showPointCallout) {
                    pointCalloutItems.push({ event, index, radius, segment });
                }

                updateArcSeparator(index, showArc && !showPoint && separatorIndexes.has(index), radius, segment, arcStrokeWidth);
                updateArcLabels(
                    index,
                    event,
                    (showArc && !showPoint) || showPointArcLabel,
                    radius,
                    segment,
                    arcStrokeWidth,
                    labelSides.get(index) ?? -1
                );
            });

            updatePointCalloutLabels(pointCalloutItems, arcStrokeWidth);
            updateWindowStartMarkers();
        }
