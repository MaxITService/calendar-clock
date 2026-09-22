// Renders Full-mode event titles in collision-free flyout plates outside the clock silhouette.
(function registerSidePlatesEventLabelLayout() {
    "use strict";

    const LAYOUT_ID = "side-plates";
    const OVERLAY_CLASS = "calendar-clock-side-plates";
    const XMLNS = "http://www.w3.org/2000/svg";
    const DEFAULT_VARIANT = "mono";
    const MAX_LINES = 2;
    const MAX_CORNER_LINES = 3;
    // Shares of the widest corner row tried, in order, when a wide plate's leader crosses its neighbours.
    const CORNER_SHAPE_WIDTHS = Object.freeze([0.72, 0.55]);
    const LINE_HEIGHT_RATIO = 1.22;
    const STYLE_FONT_WEIGHTS = Object.freeze({
        glass: 500,
        ink: 600,
        glow: 500,
        color: 600,
        custom: 500,
    });

    // Each variant describes its own plate anatomy; CSS carries the matching look.
    //   time:     none | inline | column
    //   column:   plates align to one vertical rule per side instead of hugging the circle
    //   inlineExtra: em of the base font taken by bullets/swatches/gaps beside the title
    //   letterSpacing / timeLetterSpacing: em, mirrored in the CSS so measurement matches
    const VARIANT_SPECS = Object.freeze({
        ledger: { time: "column", column: true, padX: 0.5, padY: 0.16, inlineExtra: 1.3, minPad: 6, timeScale: 0.78, timeLetterSpacing: 0.02 },
        mono: { time: "inline", padX: 0.6, padY: 0.28, inlineExtra: 1.55, minPad: 10, timeScale: 0.72, timeLetterSpacing: 0.02 },
        engraved: { time: "none", padX: 0.3, padY: 0.12, inlineExtra: 0, minPad: 4, fontScale: 0.8, uppercase: true, letterSpacing: 0.14 },
    });
    const VARIANTS = Object.freeze(Object.keys(VARIANT_SPECS));
    // When plates do not fit, the dial may shrink down to this share of its size, in these steps.
    const MIN_CLOCK_FIT_SCALE = 0.72;
    const CLOCK_FIT_STEP = 0.04;
    // Shrinking only to remove leader crossings stops here.
    const MIN_UNTANGLE_FIT_SCALE = 0.72;
    let clockFitCache = { key: "", scale: 1 };

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function normalizeCycleValue(value, cycle) {
        return ((value % cycle) + cycle) % cycle;
    }

    function getLabelFontWeight(style) {
        return STYLE_FONT_WEIGHTS[style] || STYLE_FONT_WEIGHTS.ink;
    }

    function getVariant(context) {
        const requested = String(context?.variant || DEFAULT_VARIANT);
        return VARIANTS.includes(requested) ? requested : DEFAULT_VARIANT;
    }

    function getSpec(variant) {
        return VARIANT_SPECS[variant] || VARIANT_SPECS[DEFAULT_VARIANT];
    }

    function pointAtMinutes(centerX, centerY, radius, minutes, cycleMinutes) {
        const angle = minutes / cycleMinutes * Math.PI * 2;
        return {
            x: centerX + Math.sin(angle) * radius,
            y: centerY - Math.cos(angle) * radius,
        };
    }

    function getPlateMetrics(fontSize, variant) {
        const spec = getSpec(variant);
        const titleFontSize = fontSize * (spec.fontScale || 1);
        const lineHeight = Math.ceil(titleFontSize * LINE_HEIGHT_RATIO);
        const timeFontSize = spec.time === "none" ? 0 : Math.max(9, Math.round(fontSize * (spec.timeScale || 0.7)));
        return {
            titleFontSize,
            lineHeight,
            timeFontSize,
            verticalPadding: Math.max(spec.minPad ? Math.round(spec.minPad / 2) : 2, Math.round(fontSize * spec.padY)),
            horizontalPadding: Math.max(spec.minPad || 4, Math.round(fontSize * spec.padX)),
        };
    }

    function getPlateHeight(fontSize, lines, variant) {
        const metrics = getPlateMetrics(fontSize, variant);
        return metrics.lineHeight * Math.max(1, lines) + metrics.verticalPadding * 2;
    }

    function formatEventTime(event) {
        const start = String(event?.start || "").slice(0, 5);
        const end = String(event?.end || "").slice(0, 5);
        if (!start) return "";
        if (event?.isPointEvent || !end || end === start) return start;
        return `${start}–${end}`;
    }

    // Horizontal band available beside the circle at a given row (chord-aware).
    function getPlateGeometry(options) {
        const {
            side,
            labelY,
            labelHeight,
            viewportWidth,
            centerX,
            centerY,
            protectedRadius,
            outerMargin,
            circleGap,
            columnEdge,
        } = options;
        const nearestYDistance = Math.max(0, Math.abs(labelY - centerY) - labelHeight / 2);
        const halfChord = nearestYDistance < protectedRadius
            ? Math.sqrt(Math.max(0, protectedRadius ** 2 - nearestYDistance ** 2))
            : 0;
        const innerEdge = Number.isFinite(columnEdge)
            ? columnEdge
            : centerX + side * (halfChord + circleGap);

        if (side < 0) {
            return {
                x: outerMargin,
                width: Math.max(0, innerEdge - outerMargin),
                innerEdge,
            };
        }

        return {
            x: innerEdge,
            width: Math.max(0, viewportWidth - outerMargin - innerEdge),
            innerEdge,
        };
    }

    function getAutosizedPlateGeometry(options) {
        const {
            geometry,
            side,
            measuredTextWidth,
            horizontalPadding,
            minimumWidth,
            maximumWidth,
        } = options;
        const availableWidth = Math.max(0, Math.min(
            Number(geometry?.width) || 0,
            Number(maximumWidth) || Infinity
        ));
        if (!availableWidth) {
            return {
                x: Number(geometry?.innerEdge) || 0,
                width: 0,
                innerEdge: Number(geometry?.innerEdge) || 0,
            };
        }

        const desiredWidth = Math.max(0, Number(measuredTextWidth) || 0)
            + Math.max(0, Number(horizontalPadding) || 0) * 2;
        const plateWidth = Math.min(
            availableWidth,
            Math.max(Math.min(availableWidth, Number(minimumWidth) || 0), desiredWidth)
        );
        const innerEdge = Number(geometry?.innerEdge) || 0;
        return {
            x: side < 0 ? innerEdge - plateWidth : innerEdge,
            width: plateWidth,
            innerEdge,
        };
    }

    function getClosestArcMinutes(targetMinutes, startMinutes, endMinutes, cycleMinutes) {
        const start = Number(startMinutes) || 0;
        const end = Math.max(start, Number(endMinutes) || start);
        const normalizedTarget = normalizeCycleValue(Number(targetMinutes) || 0, cycleMinutes);
        let best = start;
        let bestDistance = Infinity;

        for (let turn = -2; turn <= 2; turn += 1) {
            const candidate = normalizedTarget + turn * cycleMinutes;
            const clamped = clamp(candidate, start, end);
            const distance = Math.abs(candidate - clamped);
            if (distance < bestDistance) {
                best = clamped;
                bestDistance = distance;
            }
        }

        return best;
    }

    function selectItemsThatFit(items, minY, maxY, gap) {
        const availableHeight = Math.max(0, maxY - minY);
        const ranked = items.slice().sort((left, right) =>
            (right.showFullTitle ? 1 : 0) - (left.showFullTitle ? 1 : 0)
            || right.priority - left.priority
            || left.index - right.index
        );
        const selected = [];
        let usedHeight = 0;

        ranked.forEach(item => {
            const nextHeight = item.labelHeight + (selected.length ? gap : 0);
            if (usedHeight + nextHeight > availableHeight) return;
            selected.push(item);
            usedHeight += nextHeight;
        });

        return selected;
    }

    function layoutSide(items, minY, maxY, gap) {
        const selected = selectItemsThatFit(items, minY, maxY, gap)
            .sort((left, right) => left.desiredY - right.desiredY || left.index - right.index);
        if (!selected.length) return selected;

        let previous = null;
        selected.forEach(item => {
            const halfHeight = item.labelHeight / 2;
            const earliestY = previous
                ? previous.labelY + previous.labelHeight / 2 + gap + halfHeight
                : minY + halfHeight;
            item.labelY = Math.max(earliestY, item.desiredY);
            previous = item;
        });

        const last = selected[selected.length - 1];
        const overflow = last.labelY + last.labelHeight / 2 - maxY;
        if (overflow > 0) selected.forEach(item => {
            item.labelY -= overflow;
        });

        for (let index = selected.length - 2; index >= 0; index -= 1) {
            const item = selected[index];
            const next = selected[index + 1];
            const latestY = next.labelY - next.labelHeight / 2 - gap - item.labelHeight / 2;
            item.labelY = Math.min(item.labelY, latestY);
        }

        const firstUnderflow = minY - (selected[0].labelY - selected[0].labelHeight / 2);
        if (firstUnderflow > 0) selected.forEach(item => {
            item.labelY += firstUnderflow;
        });

        return selected;
    }

    function getBandDistance(band, y) {
        return y < band.minY ? band.minY - y : y > band.maxY ? y - band.maxY : 0;
    }

    function getNearestBandIndex(bands, y) {
        let best = 0;
        let bestDistance = Infinity;
        bands.forEach((band, index) => {
            const distance = getBandDistance(band, y);
            if (distance < bestDistance) {
                best = index;
                bestDistance = distance;
            }
        });
        return best;
    }

    function forEachPermutation(items, visit) {
        const permute = (prefix, rest) => {
            if (!rest.length) return visit(prefix);
            for (let index = 0; index < rest.length; index += 1) {
                if (permute([...prefix, rest[index]], [...rest.slice(0, index), ...rest.slice(index + 1)]) === false) return false;
            }
            return true;
        };
        permute([], items);
    }

    // Stacks one corner outward from the dial. Each plate aims at the rim point on its event's radius and
    // may only sit on rows where the circle leaves room for its width; the stack order is chosen so leaders
    // do not cross and plates stay as close to their arcs as possible. Plates that did not fit try a shorter
    // shape; a wide plate that can only sit far out crosses its neighbours' leaders, so while leaders cross,
    // the most displaced plates try a narrower one.
    function layoutCornerBand(items, band, gap, frame) {
        const direction = band.top ? -1 : 1;
        const radius = frame.radius;
        const sideRoom = band.side < 0
            ? frame.centerX - frame.outerMargin
            : frame.viewportWidth - frame.outerMargin - frame.centerX;
        const outerLimit = band.top ? frame.centerY - band.minY : band.maxY - frame.centerY;
        const useShape = (item, shapeIndex) => {
            item.shapeIndex = shapeIndex;
            Object.assign(item, item.shapes[shapeIndex]);
            const halfChordLimit = clamp(sideRoom - frame.circleGap - item.requiredWidth, 0, radius);
            const clearance = Math.sqrt(Math.max(0, radius ** 2 - halfChordLimit ** 2));
            const angle = item.angleMinutes / frame.cycleMinutes * Math.PI * 2;
            const outward = -direction * Math.cos(angle);
            item.minOffset = Math.max(clearance, frame.circleGap / 2) + item.labelHeight / 2;
            item.radialOffset = (radius + frame.circleGap) * outward + item.labelHeight / 2 * Math.max(0, outward);
            item.idealOffset = Math.max(item.minOffset, item.radialOffset);
        };
        items.forEach(item => {
            item.corner = true;
            useShape(item, 0);
        });

        const place = order => {
            let outerEdge = -Infinity;
            return order.filter(item => {
                const offset = Math.max(item.idealOffset, outerEdge + gap + item.labelHeight / 2);
                if (offset + item.labelHeight / 2 > outerLimit) return false;
                item.labelY = frame.centerY + direction * offset;
                outerEdge = offset + item.labelHeight / 2;
                return true;
            });
        };
        const score = order => {
            const placed = place(order);
            const leaders = placed.map(item => frame.getLeader(item, item.labelY));
            const crossing = new Set();
            let crossings = 0;
            for (let i = 0; i < leaders.length; i += 1) {
                for (let j = i + 1; j < leaders.length; j += 1) {
                    if (!leadersCross(leaders[i], leaders[j])) continue;
                    crossings += 1;
                    crossing.add(placed[i]).add(placed[j]);
                }
            }
            return {
                order,
                crossing,
                unplaced: items.filter(item => !placed.includes(item)),
                placed: placed.length,
                priority: placed.reduce((sum, item) => sum + item.priority, 0),
                crossings,
                distance: placed.reduce((sum, item) => sum + Math.abs(item.labelY - frame.centerY) - item.radialOffset, 0),
            };
        };
        const better = (left, right) => left.placed - right.placed
            || left.priority - right.priority
            || right.crossings - left.crossings
            || right.distance - left.distance;
        const search = () => {
            let best = score(items.slice().sort((left, right) => left.idealOffset - right.idealOffset || left.index - right.index));
            if (items.length <= 6) {
                forEachPermutation(items, order => {
                    const candidate = score(order);
                    if (better(candidate, best) > 0.01) best = candidate;
                });
                return best;
            }
            for (let pass = 0, improved = true; improved && pass < items.length; pass += 1) {
                improved = false;
                for (let index = 0; index + 1 < items.length; index += 1) {
                    const order = best.order.slice();
                    [order[index], order[index + 1]] = [order[index + 1], order[index]];
                    const candidate = score(order);
                    if (better(candidate, best) > 0.01) {
                        best = candidate;
                        improved = true;
                    }
                }
            }
            return best;
        };

        let best = search();
        for (let round = 0; round < items.length * 2 && (best.crossings > 0 || best.unplaced.length); round += 1) {
            const canChange = item => item.shapeIndex + 1 < item.shapes.length;
            const displaced = best.unplaced.filter(canChange)
                .sort((left, right) => right.priority - left.priority || left.index - right.index)[0]
                || [...best.crossing].filter(canChange)
                    .sort((left, right) => (right.idealOffset - right.radialOffset) - (left.idealOffset - left.radialOffset))[0];
            if (!displaced) break;
            const currentShape = displaced.shapeIndex;
            let bestShape = currentShape;
            for (let shapeIndex = currentShape + 1; shapeIndex < displaced.shapes.length; shapeIndex += 1) {
                useShape(displaced, shapeIndex);
                const candidate = search();
                if (better(candidate, best) > 0.01) {
                    best = candidate;
                    bestShape = shapeIndex;
                    break;
                }
            }
            useShape(displaced, bestShape);
            // A plate that no other shape helps keeps its shape; the next plate gets a turn.
            if (bestShape === currentShape) displaced.shapes = displaced.shapes.slice(0, currentShape + 1);
        }
        return place(best.order);
    }

    function layoutBand(items, band, gap, frame) {
        if (!band.full) return layoutCornerBand(items, band, gap, frame);
        items.forEach(item => {
            item.corner = false;
        });
        return layoutSide(items, band.minY, band.maxY, gap);
    }

    // Stacks each item in its nearest band, then lets what did not fit spill into the other band.
    // A corner band only takes events from its own half of the dial (events near 3 and 9 may go either way),
    // so leaders never cross the whole dial; the rest keep their arc text.
    function layoutSideBands(items, bands, gap, frame, tolerance) {
        const centerY = frame.centerY;
        if (!bands.length) return [];
        const reaches = (band, item) => band.full
            || (band.top ? item.desiredY <= centerY + tolerance : item.desiredY >= centerY - tolerance);
        const groups = bands.map(() => []);
        items.forEach(item => {
            const index = getNearestBandIndex(bands, item.desiredY);
            if (reaches(bands[index], item)) groups[index].push(item);
        });
        const placed = groups.map((group, index) => layoutBand(group, bands[index], gap, frame));
        if (bands.length === 2) {
            groups.forEach((group, index) => {
                const other = 1 - index;
                const leftovers = group.filter(item => !placed[index].includes(item) && reaches(bands[other], item));
                if (!leftovers.length) return;
                placed[other] = layoutBand([...placed[other], ...leftovers], bands[other], gap, frame);
            });
        }
        return placed.flat();
    }

    function getTargetMinutes(targetX, targetY, centerX, centerY, cycleMinutes) {
        const angle = Math.atan2(targetX - centerX, centerY - targetY);
        return normalizeCycleValue(angle / (Math.PI * 2) * cycleMinutes, cycleMinutes);
    }

    function makeSvgElement(name, className = "") {
        const element = document.createElementNS(XMLNS, name);
        if (className) element.setAttribute("class", className);
        return element;
    }

    function ensureOverlay() {
        let overlay = document.querySelector(`.${OVERLAY_CLASS}`);
        if (overlay) return overlay;

        overlay = makeSvgElement("svg", OVERLAY_CLASS);
        overlay.setAttribute("aria-hidden", "true");
        overlay.setAttribute("focusable", "false");
        document.body.appendChild(overlay);
        return overlay;
    }

    function clear() {
        document.querySelector(`.${OVERLAY_CLASS}`)?.remove();
    }

    function getOuterMargin(viewportWidth) {
        return Math.max(12, Math.min(24, viewportWidth * 0.012));
    }

    function getCircleGap(fontSize) {
        return Math.max(9, fontSize * 0.55);
    }

    // Narrowest plate that still shows a few title characters beside the variant's padding, bullets, and times.
    function getMinimumPlateWidth(fontSize, variant) {
        const spec = getSpec(variant);
        const metrics = getPlateMetrics(fontSize, variant);
        const timeWidth = spec.time === "none" ? 0 : "00:00–00:00".length * metrics.timeFontSize * 0.56;
        return metrics.horizontalPadding * 2
            + fontSize * (spec.inlineExtra || 0)
            + timeWidth
            + 4
            + Math.max(48, metrics.titleFontSize * 3);
    }

    // Vertical bands on one side where a plate of `minimumWidth` fits. When the side gutter is too narrow,
    // the circle still curves away near the top and bottom, so the corners stay usable.
    function getSideBands(options) {
        const { clockRect, viewportWidth, viewportHeight, side, minimumWidth, column } = options;
        const radius = clockRect.width / 2;
        const centerY = clockRect.top + clockRect.height / 2;
        const gutter = side < 0 ? clockRect.left : viewportWidth - clockRect.right;
        const outerMargin = getOuterMargin(viewportWidth);
        const circleGap = getCircleGap(options.fontSize) * (column ? 1.4 : 1);
        const minY = outerMargin;
        const maxY = viewportHeight - outerMargin;
        // A plate fits on rows where the circle's half-chord is at most `reach`.
        const reach = radius + gutter - outerMargin - circleGap - minimumWidth;
        if (reach >= radius) return [{ minY, maxY, full: true }];
        // Column plates hang from one straight rule, so they cannot follow the curve into the corners.
        if (column || reach < 0) return [];
        const clearance = Math.sqrt(radius ** 2 - reach ** 2);
        // Where the corner's plates meet the dial; leaders fan out from around this point.
        const innerX = clockRect.left + radius + side * (reach + circleGap);
        return [
            { minY, maxY: centerY - clearance, top: true, side, innerX },
            { minY: centerY + clearance, maxY, top: false, side, innerX },
        ].filter(band => band.maxY > band.minY);
    }

    function getContextSideBands(context, side, fontSize, variant) {
        return getSideBands({
            clockRect: context.clockRect,
            viewportWidth: Math.max(0, Number(context.viewportWidth) || 0),
            viewportHeight: Math.max(0, Number(context.viewportHeight) || 0),
            side,
            fontSize,
            minimumWidth: getMinimumPlateWidth(fontSize, variant),
            column: getSpec(variant).column === true,
        });
    }

    function scaleClockRect(rect, scale) {
        const width = rect.width * scale;
        const height = rect.height * scale;
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        return {
            left: centerX - width / 2,
            top: centerY - height / 2,
            right: centerX + width / 2,
            bottom: centerY + height / 2,
            width,
            height,
        };
    }

    // `fitClock` also accepts a layout that fits only once the dial shrinks to its smallest fit scale.
    function canRender(context) {
        const clockRect = context?.clockRect;
        if (!clockRect || context?.mode !== "full") return false;
        const fontSize = Number(context.fontSize) || 16;
        const variant = getVariant(context);
        const plateHeight = getPlateHeight(fontSize, 1, variant);
        const fits = rect => [-1, 1].some(side => getContextSideBands({ ...context, clockRect: rect }, side, fontSize, variant)
            .some(band => band.maxY - band.minY >= plateHeight));
        return fits(clockRect) || (context.fitClock === true && fits(scaleClockRect(clockRect, MIN_CLOCK_FIT_SCALE)));
    }

    function parseCssColor(value) {
        const match = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/.exec(String(value || ""));
        if (match) return { r: +match[1], g: +match[2], b: +match[3], a: match[4] === undefined ? 1 : +match[4] };
        const hex = /#([0-9a-f]{6})\b/i.exec(String(value || ""));
        if (hex) {
            const number = parseInt(hex[1], 16);
            return { r: number >> 16 & 255, g: number >> 8 & 255, b: number & 255, a: 1 };
        }
        return null;
    }

    // Neutral ink must contrast with the page, which dark faces repaint; sample the body background.
    function detectPageTone() {
        const style = getComputedStyle(document.body);
        let color = parseCssColor(style.backgroundColor);
        if (!color || color.a === 0) {
            const stops = String(style.backgroundImage || "").match(/#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi) || [];
            const opaque = stops.map(parseCssColor).filter(stop => stop && stop.a >= 0.5);
            if (opaque.length) {
                color = opaque.reduce((sum, stop) => ({
                    r: sum.r + stop.r / opaque.length,
                    g: sum.g + stop.g / opaque.length,
                    b: sum.b + stop.b / opaque.length,
                    a: 1,
                }), { r: 0, g: 0, b: 0, a: 1 });
            }
        }
        if (!color) return "light";
        const luminance = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
        return luminance < 0.45 ? "dark" : "light";
    }

    function getMaximumPlateWidth(context, gutterWidth, fontSize) {
        return Math.max(0, Math.min(gutterWidth, Math.max(280, fontSize * 26)));
    }

    function fitWithEllipsis(text, maxWidth, measure) {
        if (measure(text) <= maxWidth) return text;
        let low = 1;
        let high = text.length - 1;
        let best = "";
        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const candidate = `${text.slice(0, middle).trimEnd()}…`;
            if (measure(candidate) <= maxWidth) {
                best = candidate;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return best;
    }

    // Greedy word wrap with a measured ellipsis on the last allowed line.
    function wrapTitle(title, maxWidth, maxLines, measure) {
        const words = String(title).split(" ").filter(Boolean);
        const lines = [];
        let index = 0;

        while (index < words.length && lines.length < maxLines) {
            const lineStart = index;
            let line = words[index];
            index += 1;
            while (index < words.length && measure(`${line} ${words[index]}`) <= maxWidth) {
                line += ` ${words[index]}`;
                index += 1;
            }
            const overflows = measure(line) > maxWidth
                || (lines.length === maxLines - 1 && index < words.length);
            if (!overflows) {
                lines.push(line);
                continue;
            }
            lines.push(fitWithEllipsis(words.slice(lineStart).join(" "), maxWidth, measure));
            break;
        }

        return lines.filter(Boolean);
    }

    // Decides text, line count, and plate height for an item before vertical layout.
    function measureItem(context, item, variant, plateWidthLimit, maxLines = MAX_LINES) {
        const spec = getSpec(variant);
        const metrics = getPlateMetrics(item.fontSize, variant);
        const labelFontWeight = getLabelFontWeight(context.style);
        const maximumPlateWidth = getMaximumPlateWidth(context, plateWidthLimit, item.fontSize);
        const measureAt = (text, size, weight, letterSpacing = 0) => (typeof context.measureText === "function"
            ? context.measureText(text, size, weight)
            : String(text).length * Math.max(1, size * 0.56))
            + String(text).length * size * Math.max(0, letterSpacing);
        const measure = text => measureAt(text, metrics.titleFontSize, labelFontWeight, spec.letterSpacing || 0);
        // Times render with tabular figures, so every digit takes the widest digit's cell.
        const measureTime = text => measureAt(
            String(text).replace(/\d/g, "0"),
            metrics.timeFontSize,
            500,
            spec.timeLetterSpacing || 0
        ) + 2;
        const timeText = spec.time === "none" ? "" : formatEventTime(item.event);
        const timeWidth = timeText ? measureTime(timeText) : 0;
        const timeColumnWidth = spec.time === "column" ? Math.ceil(measureTime("00:00–00:00")) : 0;
        // Bullets, edge bars, and inline/column time text share the row with the title.
        const inlineExtra = Math.round(item.fontSize * (spec.inlineExtra || 0))
            + (spec.time === "inline" && timeText ? Math.ceil(timeWidth) : 0)
            + timeColumnWidth
            + 4;
        const availableTextWidth = Math.max(0, maximumPlateWidth - metrics.horizontalPadding * 2 - inlineExtra);
        const rawTitle = String(item.event?.title || "").replace(/\s+/g, " ").trim() || "(No title)";
        const fullTitle = spec.uppercase ? rawTitle.toUpperCase() : rawTitle;
        const singleLineText = context.fitText(
            { ...item.event, title: fullTitle },
            availableTextWidth,
            metrics.titleFontSize,
            item.showFullTitle,
            labelFontWeight
        );
        // fitText measures without letter-spacing, so confirm the fit locally before trusting it.
        const fitsOnOneLine = singleLineText === fullTitle && measure(fullTitle) <= availableTextWidth;
        const lines = fitsOnOneLine || availableTextWidth <= 0
            ? [singleLineText]
            : wrapTitle(fullTitle, availableTextWidth, maxLines, measure);
        if (!lines.length || !lines[0]) return { labelText: "" };

        return {
            labelText: lines.join("\n"),
            timeText,
            lines: lines.length,
            measuredTextWidth: Math.max(...lines.map(measure)) + inlineExtra,
            timeColumnWidth,
            labelHeight: getPlateHeight(item.fontSize, lines.length, variant),
            labelFontWeight,
            maximumPlateWidth,
            metrics,
        };
    }

    function createItemLayout(context, variant) {
        const {
            clockRect,
            clockSize,
            cycleMinutes,
            viewportWidth,
            viewportHeight,
            fontSize,
            items,
        } = context;
        const centerX = clockRect.left + clockRect.width / 2;
        const centerY = clockRect.top + clockRect.height / 2;
        const scale = clockRect.width / Math.max(1, clockSize);
        const outerMargin = getOuterMargin(viewportWidth);
        const circleGap = getCircleGap(fontSize);
        const radius = clockRect.width / 2;
        const frame = {
            centerX,
            centerY,
            radius,
            circleGap,
            outerMargin,
            viewportWidth,
            cycleMinutes,
            getLeader: (item, labelY) => getItemLeader(item, labelY, frame),
        };
        const bandsBySide = {
            [-1]: getContextSideBands(context, -1, fontSize, variant),
            1: getContextSideBands(context, 1, fontSize, variant),
        };
        const left = [];
        const right = [];

        items.forEach(item => {
            const scaledFontSize = Math.max(7, Number(item.fontSize) || fontSize);
            const middleMinutes = item.segment.clockStartMinutes
                + Math.max(0, item.segment.clockEndMinutes - item.segment.clockStartMinutes) / 2;
            const middlePoint = pointAtMinutes(
                centerX,
                centerY,
                item.radius * scale,
                middleMinutes,
                cycleMinutes
            );
            let side = middlePoint.x < centerX ? -1 : 1;
            if (Math.abs(middlePoint.x - centerX) < clockRect.width * 0.055) {
                side = left.length <= right.length ? -1 : 1;
            }
            const desiredY = clamp(middlePoint.y, 0, viewportHeight);
            const bands = bandsBySide[side];
            if (!bands.length) return;
            const band = bands[getNearestBandIndex(bands, desiredY)];
            // Side plates fit the gutter; corner plates may climb above or below the dial, where half the viewport is free.
            const sideRoom = band.full
                ? (side < 0 ? clockRect.left : viewportWidth - clockRect.right) + radius
                : (side < 0 ? centerX : viewportWidth - centerX);
            const plateWidthLimit = sideRoom - outerMargin
                - (band.full ? circleGap : Math.max(circleGap, getLeaderStub(scaledFontSize) + circleGap / 2));
            // A short band takes one truncated line rather than dropping a two-line plate.
            const plateMetrics = getPlateMetrics(scaledFontSize, variant);
            const bandLines = Math.floor((band.maxY - band.minY - plateMetrics.verticalPadding * 2) / plateMetrics.lineHeight);
            const measured = measureItem(
                context,
                { ...item, fontSize: scaledFontSize },
                variant,
                plateWidthLimit,
                clamp(bandLines, 1, MAX_LINES)
            );
            if (!measured.labelText) return;
            const getShape = shape => ({
                ...shape,
                requiredWidth: Math.max(
                    getMinimumRenderedWidth(scaledFontSize),
                    shape.measuredTextWidth + shape.metrics.horizontalPadding * 2
                ),
            });
            // Narrower, taller shapes a corner plate may take to sit closer to its arc.
            const shapes = [getShape(measured)];
            if (!band.full) CORNER_SHAPE_WIDTHS.forEach(share => {
                const shape = measureItem(
                    context,
                    { ...item, fontSize: scaledFontSize },
                    variant,
                    plateWidthLimit * share,
                    clamp(bandLines, 1, MAX_CORNER_LINES)
                );
                const previous = shapes[shapes.length - 1];
                if (shape.labelText && shape.measuredTextWidth < previous.measuredTextWidth - 1) shapes.push(getShape(shape));
            });
            // Last resort for a crowded corner: one shortened line.
            if (!band.full && measured.lines > 1) {
                const shape = measureItem(context, { ...item, fontSize: scaledFontSize }, variant, plateWidthLimit, 1);
                if (shape.labelText) shapes.push(getShape(shape));
            }

            const layoutItem = {
                ...item,
                ...shapes[0],
                shapes,
                side,
                angleMinutes: middleMinutes,
                desiredY,
                fontSize: scaledFontSize,
                priority: (item.showFullTitle ? 2 : 0) + (Number(item.fontScale) || 1),
                scale,
            };
            (side < 0 ? left : right).push(layoutItem);
        });

        const rowGap = Math.max(6, fontSize * 0.34);
        return {
            items: [
                ...layoutSideBands(left, bandsBySide[-1], rowGap, frame, radius * 0.25),
                ...layoutSideBands(right, bandsBySide[1], rowGap, frame, radius * 0.25),
            ],
            rowGap,
            outerMargin,
            circleGap,
            frame,
        };
    }

    function getMinimumRenderedWidth(fontSize) {
        return Math.max(48, fontSize * 2.4);
    }

    function getLeaderStub(fontSize) {
        return Math.max(10, fontSize * 0.8);
    }

    // Leader: short radial exit from the arc, one straight run, and a stub into the plate.
    // Corner plates sit on their event's ray, so their leader runs straight into the plate without a stub.
    function getLeaderPoints(anchor, center, targetX, targetY, side, fontSize, stub = getLeaderStub(fontSize)) {
        const radialLength = Math.hypot(anchor.x - center.x, anchor.y - center.y) || 1;
        const reach = Math.max(8, fontSize * 0.55);
        return [
            anchor,
            {
                x: anchor.x + (anchor.x - center.x) / radialLength * reach,
                y: anchor.y + (anchor.y - center.y) / radialLength * reach,
            },
            { x: targetX - side * stub, y: targetY },
            { x: targetX, y: targetY },
        ];
    }

    function getLeaderForEdge(item, innerEdge, labelY, frame) {
        // A corner leader arrives from the dial side, so it meets the plate's corner nearest the dial
        // instead of cutting through the plate to the middle of its edge.
        const targetY = item.corner
            ? labelY + Math.sign(frame.centerY - labelY) * item.labelHeight / 2
            : labelY;
        const targetMinutes = getTargetMinutes(innerEdge, targetY, frame.centerX, frame.centerY, frame.cycleMinutes);
        const anchorMinutes = getClosestArcMinutes(
            targetMinutes,
            item.segment.clockStartMinutes,
            item.segment.clockEndMinutes,
            frame.cycleMinutes
        );
        const anchor = pointAtMinutes(frame.centerX, frame.centerY, item.radius * item.scale, anchorMinutes, frame.cycleMinutes);
        return getLeaderPoints(
            anchor,
            { x: frame.centerX, y: frame.centerY },
            innerEdge,
            targetY,
            item.side,
            item.fontSize,
            item.corner ? 0 : undefined
        );
    }

    // A corner plate's inner edge sits where the ray from the dial centre through its event meets the plate's row,
    // so leaders run almost radially and never cross each other. The edge stays clear of the circle, of the
    // centre line (both sides' stubs meet above 12 and 6), and close enough to the viewport edge for the plate.
    function getCornerPlateGeometry(item, labelY, frame) {
        const { innerEdge: circleEdge } = getPlateGeometry({
            side: item.side,
            labelY,
            labelHeight: item.labelHeight,
            viewportWidth: frame.viewportWidth,
            centerX: frame.centerX,
            centerY: frame.centerY,
            protectedRadius: frame.radius,
            outerMargin: frame.outerMargin,
            circleGap: frame.circleGap,
        });
        const side = item.side;
        const nearestEdge = side * Math.max(side * circleEdge, side * frame.centerX + getLeaderStub(item.fontSize) + frame.circleGap / 2);
        const farthestEdge = side < 0
            ? frame.outerMargin + item.requiredWidth
            : frame.viewportWidth - frame.outerMargin - item.requiredWidth;
        const angle = item.angleMinutes / frame.cycleMinutes * Math.PI * 2;
        const rayLength = (frame.centerY - labelY) / Math.cos(angle);
        const rayEdge = rayLength > 0 && Number.isFinite(rayLength)
            ? frame.centerX + Math.sin(angle) * rayLength
            : nearestEdge;
        const innerEdge = side < 0
            ? Math.min(nearestEdge, Math.max(rayEdge, farthestEdge))
            : Math.max(nearestEdge, Math.min(rayEdge, farthestEdge));
        return side < 0
            ? { x: frame.outerMargin, width: Math.max(0, innerEdge - frame.outerMargin), innerEdge }
            : { x: innerEdge, width: Math.max(0, frame.viewportWidth - frame.outerMargin - innerEdge), innerEdge };
    }

    function getItemLeader(item, labelY, frame) {
        return getLeaderForEdge(item, getCornerPlateGeometry(item, labelY, frame).innerEdge, labelY, frame);
    }

    function describeLeader(points) {
        return points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
    }

    function segmentsCross(a, b, c, d) {
        const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
        const d1 = cross(c, d, a);
        const d2 = cross(c, d, b);
        const d3 = cross(a, b, c);
        const d4 = cross(a, b, d);
        return d1 * d2 < 0 && d3 * d4 < 0;
    }

    function leadersCross(left, right) {
        for (let i = 1; i < left.length; i += 1) {
            for (let j = 1; j < right.length; j += 1) {
                if (segmentsCross(left[i - 1], left[i], right[j - 1], right[j])) return true;
            }
        }
        return false;
    }

    function buildCard(item, variant, context) {
        const spec = getSpec(variant);
        const card = document.createElement("div");
        const label = document.createElement("span");
        card.setAttribute("class", "time-side-plate-card");
        card.style.setProperty("--side-plate-padding-x", `${item.metrics.horizontalPadding}px`);
        card.style.setProperty("--side-plate-padding-y", `${item.metrics.verticalPadding}px`);
        card.style.setProperty("--side-plate-line-height", `${item.metrics.lineHeight}px`);
        card.style.setProperty("--side-plate-font-size", `${item.metrics.titleFontSize}px`);
        card.style.setProperty("--side-plate-time-size", `${item.metrics.timeFontSize}px`);
        card.style.setProperty("--side-plate-time-column", `${item.timeColumnWidth || 0}px`);
        label.setAttribute("class", "time-side-plate-label");
        label.textContent = item.labelText;
        label.style.fontSize = `${item.metrics.titleFontSize}px`;
        label.style.fontFamily = context.fontFamily;

        if (spec.time !== "none" && item.timeText) {
            const time = document.createElement("span");
            time.setAttribute("class", "time-side-plate-time");
            time.textContent = item.timeText;
            time.style.fontSize = `${item.metrics.timeFontSize}px`;
            time.style.fontFamily = context.fontFamily;
            if (spec.time === "inline") card.append(label, time);
            else card.append(time, label);
            // Left-side cards are row-reversed, so DOM order mirrors to keep time outermost.
        } else {
            card.appendChild(label);
        }
        return card;
    }

    // Plate text, rows, and widths without touching the DOM, so the dial fit can try several sizes.
    function computePlacement(context) {
        const variant = getVariant(context);
        const spec = getSpec(variant);
        const viewportWidth = Math.max(1, Number(context.viewportWidth) || window.innerWidth);
        const viewportHeight = Math.max(1, Number(context.viewportHeight) || window.innerHeight);
        const layout = createItemLayout({ ...context, viewportWidth, viewportHeight }, variant);
        const { outerMargin, circleGap, frame } = layout;

        const placedItems = layout.items.map(item => {
            const minimumPlateWidth = getMinimumRenderedWidth(item.fontSize);
            const columnEdge = spec.column
                ? (item.side < 0 ? context.clockRect.left : context.clockRect.right) + item.side * circleGap * 1.4
                : undefined;
            const rowGeometry = item.corner ? getCornerPlateGeometry(item, item.labelY, frame) : getPlateGeometry({
                side: item.side,
                labelY: item.labelY,
                labelHeight: item.labelHeight,
                viewportWidth,
                centerX: frame.centerX,
                centerY: frame.centerY,
                protectedRadius: frame.radius,
                outerMargin,
                circleGap,
                columnEdge,
            });
            if (rowGeometry.width < minimumPlateWidth) return null;

            // Corner rows were chosen to fit the measured plate; side rows differ from the band estimate,
            // so re-fit without growing past the slot's lines.
            if (!item.corner) {
                const fitted = measureItem(context, item, variant, rowGeometry.width, item.lines);
                if (!fitted.labelText) return null;
                Object.assign(item, fitted);
            }

            const geometry = getAutosizedPlateGeometry({
                geometry: rowGeometry,
                side: item.side,
                measuredTextWidth: item.measuredTextWidth,
                horizontalPadding: item.metrics.horizontalPadding,
                minimumWidth: minimumPlateWidth,
                maximumWidth: item.maximumPlateWidth,
            });
            return geometry.width < minimumPlateWidth ? null : { item, geometry };
        }).filter(Boolean);

        return { variant, spec, viewportWidth, viewportHeight, placedItems, frame };
    }

    function countLeaderCrossings(placedItems, frame) {
        const leaders = placedItems.map(({ item, geometry }) => getLeaderForEdge(item, geometry.innerEdge, item.labelY, frame));
        let crossings = 0;
        for (let i = 0; i < leaders.length; i += 1) {
            for (let j = i + 1; j < leaders.length; j += 1) {
                if (leadersCross(leaders[i], leaders[j])) crossings += 1;
            }
        }
        return crossings;
    }

    // Dial scale (relative to the full-size `clockRect`) for the flyouts: the largest one that gives plates to
    // the most events, or a smaller one when shrinking the dial also removes every leader crossing.
    function getClockFitScale(context) {
        if (!context?.clockRect || context.mode !== "full" || !Array.isArray(context.items) || !context.items.length) return 1;
        // Clock ticks re-render the same events many times; the fit only changes with its inputs.
        const { left, top, width, height } = context.clockRect;
        const key = JSON.stringify([
            context.viewportWidth, context.viewportHeight, left, top, width, height, context.clockSize,
            context.cycleMinutes, context.fontSize, context.fontFamily, context.style, getVariant(context),
            context.items.map(item => [
                item.index, item.radius, item.fontSize, item.showFullTitle, item.fontScale, item.event?.title,
                item.segment?.clockStartMinutes, item.segment?.clockEndMinutes,
            ]),
        ]);
        if (clockFitCache.key === key) return clockFitCache.scale;
        const scale = findClockFitScale(context);
        clockFitCache = { key, scale };
        return scale;
    }

    function findClockFitScale(context) {
        let best = null;
        for (let step = 0; ; step += 1) {
            const scale = Math.max(MIN_CLOCK_FIT_SCALE, 1 - step * CLOCK_FIT_STEP);
            const scaled = { ...context, fitClock: false, clockRect: scaleClockRect(context.clockRect, scale) };
            const placement = canRender(scaled) ? computePlacement(scaled) : null;
            const count = placement ? placement.placedItems.length : 0;
            const crossings = placement ? countLeaderCrossings(placement.placedItems, placement.frame) : 0;
            const untangles = count === best?.count && crossings < best.crossings && scale >= MIN_UNTANGLE_FIT_SCALE;
            if (!best || count > best.count || untangles) {
                best = { scale, count, crossings };
            }
            const allPlaced = count >= context.items.length;
            if ((allPlaced && (crossings === 0 || scale <= MIN_UNTANGLE_FIT_SCALE)) || scale <= MIN_CLOCK_FIT_SCALE) break;
        }
        return best.scale;
    }

    // Returns the event indexes that got a plate; the caller labels the rest another way.
    function render(context) {
        if (!canRender({ ...context, fitClock: false }) || !Array.isArray(context.items) || !context.items.length) {
            clear();
            return [];
        }

        const { variant, spec, viewportWidth, viewportHeight, placedItems, frame } = computePlacement(context);
        const overlay = ensureOverlay();
        const fragment = document.createDocumentFragment();
        const ruleSegments = [];
        const renderedIndexes = [];

        overlay.setAttribute("viewBox", `0 0 ${viewportWidth} ${viewportHeight}`);
        overlay.setAttribute("width", String(viewportWidth));
        overlay.setAttribute("height", String(viewportHeight));
        overlay.dataset.variant = variant;
        overlay.dataset.tone = detectPageTone();

        placedItems.forEach(({ item, geometry }) => {
            const leaderPoints = getLeaderForEdge(item, geometry.innerEdge, item.labelY, frame);
            const anchor = leaderPoints[0];
            const targetX = geometry.innerEdge;
            const plateY = item.labelY - item.labelHeight / 2;
            const group = makeSvgElement("g", "time-side-plate");
            const leader = makeSvgElement("path", "time-side-plate-line");
            const dot = makeSvgElement("circle", "time-side-plate-dot");
            const plate = makeSvgElement("foreignObject", "time-side-plate-object");

            group.dataset.rangeIndex = String(item.index);
            group.style.color = item.event.color;
            group.style.setProperty("--event-color", item.event.color);
            group.style.setProperty("--custom-label-color", context.customColor);
            group.style.setProperty("--side-plate-font-weight", String(item.labelFontWeight));
            group.style.opacity = String(context.opacity);
            group.classList.add(`time-side-plate--${context.style}`);
            group.classList.add(`time-side-plate--${variant}`);
            group.classList.add(item.side < 0 ? "time-side-plate--left" : "time-side-plate--right");
            group.classList.toggle("time-side-plate--multiline", item.lines > 1);

            leader.setAttribute("d", describeLeader(leaderPoints));
            dot.setAttribute("cx", String(anchor.x));
            dot.setAttribute("cy", String(anchor.y));
            dot.setAttribute("r", String(Math.max(2.6, context.arcStrokeWidth * 0.32)));

            plate.setAttribute("x", String(geometry.x));
            plate.setAttribute("y", String(plateY));
            plate.setAttribute("width", String(geometry.width));
            plate.setAttribute("height", String(item.labelHeight));
            plate.appendChild(buildCard(item, variant, context));

            group.append(leader, dot, plate);
            fragment.appendChild(group);
            renderedIndexes.push(item.index);

            if (spec.column) {
                // Short tick per row, inset so stacked rows keep a visible gap.
                const inset = Math.min(4, item.labelHeight * 0.2);
                ruleSegments.push({ x: targetX, top: plateY + inset, bottom: plateY + item.labelHeight - inset });
            }
        });

        // Ledger variant: a short vertical rule segment beside each row.
        ruleSegments.forEach(segment => {
            const rule = makeSvgElement("line", "time-side-plate-rule");
            rule.setAttribute("x1", String(segment.x));
            rule.setAttribute("x2", String(segment.x));
            rule.setAttribute("y1", String(segment.top));
            rule.setAttribute("y2", String(segment.bottom));
            fragment.appendChild(rule);
        });

        overlay.replaceChildren(fragment);
        return renderedIndexes;
    }

    registerEventLabelLayout({
        id: LAYOUT_ID,
        variants: VARIANTS,
        render,
        clear,
        canRender,
        getClockFitScale,
        getPlateGeometry,
        getAutosizedPlateGeometry,
        getPlateHeight,
        formatEventTime,
        wrapTitle,
        fitWithEllipsis,
        getLabelFontWeight,
        getClosestArcMinutes,
        layoutSide,
        getSideBands,
        getMinimumPlateWidth,
    });
})();
