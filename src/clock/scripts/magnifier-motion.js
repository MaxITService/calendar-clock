// Drives the cursor-following and automatic liquid-glass magnifier movement.
function updateMagnifier() {
            if (!magnifierEnabled || !clockSize || !lensSize) return;

            magnifierEl.style.left = pointerX + "px";
            magnifierEl.style.top = pointerY + "px";

            const lensCenter = lensSize / 2;
            magnifiedClockEl.style.width = clockSize + "px";
            magnifiedClockEl.style.height = clockSize + "px";
            magnifiedClockEl.style.transform = `translate(${lensCenter - pointerX * MAGNIFY}px, ${lensCenter - pointerY * MAGNIFY}px) scale(${MAGNIFY})`;
        }

        function getMinuteHandTip() {
            const now = new Date();
            const parts = getClockZonedParts(now);
            const secs = parts.second + now.getMilliseconds() / 1000;
            const mins = parts.minute + secs / 60;
            const angle = mins * 6 * Math.PI / 180;
            const clockRect = clockEl.getBoundingClientRect();
            const stageRect = stageEl.getBoundingClientRect();
            const centerX = clockRect.left - stageRect.left + clockRect.width / 2;
            const centerY = clockRect.top - stageRect.top + clockRect.height / 2;
            const minuteHandLength = clockSize * 0.386;

            return {
                x: centerX + Math.sin(angle) * minuteHandLength,
                y: centerY - Math.cos(angle) * minuteHandLength,
            };
        }

        function getClockTimePoint(clockMinutes, radiusRatio) {
            const cycleMinutes = getClockCycleMinutes();
            const angle = clockMinutes / cycleMinutes * 360;
            const clockRect = clockEl.getBoundingClientRect();
            const stageRect = stageEl.getBoundingClientRect();
            const centerX = clockRect.left - stageRect.left + clockRect.width / 2;
            const centerY = clockRect.top - stageRect.top + clockRect.height / 2;
            const handLength = clockSize * radiusRatio;
            return pointOnClockArc(centerX, centerY, handLength, angle);
        }

        function getOutsideRightPosition(y) {
            const stageRect = stageEl.getBoundingClientRect();

            return {
                x: window.innerWidth - stageRect.left + lensSize / 2 + 16,
                y,
            };
        }

        function easeInOutCubic(t) {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }

        function lerp(a, b, t) {
            return a + (b - a) * t;
        }

        function getAutoIntervalSeconds() {
            const parsed = Number(autoIntervalInputEl.value.trim());
            const value = Number.isFinite(parsed) ? parsed : magnifierAutoIntervalSeconds;
            return Math.min(
                MAGNIFIER_AUTO_INTERVAL_MAX_SECONDS,
                Math.max(MAGNIFIER_AUTO_INTERVAL_MIN_SECONDS, Math.round(Number(value) || 600))
            );
        }

        function shouldRunAutoMagnifier() {
            return magnifierEnabled && magnifierAutoEnabled && clockOverlayMode !== "hidden";
        }

        function scheduleNextMinuteHandAutoMagnifier(nowMs = Date.now()) {
            if (!magnifierAutoMinuteHandEnabled) return;

            const effectiveNow = nowMs + AUTO_PRE_MS + 250;
            const intervalMs = getAutoIntervalSeconds() * 1000;
            const now = new Date(effectiveNow);
            const parts = getClockZonedParts(now);
            const hourStart = makeClockZonedDate(parts.year, parts.month - 1, parts.day, parts.hour);
            const nextHourStart = makeClockZonedDate(parts.year, parts.month - 1, parts.day, parts.hour + 1);
            const hourDurationMs = nextHourStart.getTime() - hourStart.getTime();
            const elapsedMs = now.getTime() - hourStart.getTime();
            const nextElapsedMs = Math.floor(elapsedMs / intervalMs + 1) * intervalMs;

            const targetRunTime = nextElapsedMs < hourDurationMs
                ? hourStart.getTime() + nextElapsedMs
                : nextHourStart.getTime();

            const lensStartTime = targetRunTime - AUTO_PRE_MS;

            autoTimerId = setTimeout(() => {
                startAutoMagnifier(targetRunTime, { targetProvider: getMinuteHandTip });
                scheduleNextAutoMagnifier();
            }, Math.max(0, lensStartTime - Date.now()));
        }

        function getEventBoundaryDate(event, kind) {
            const dateRange = getEventDateRange(event);
            if (dateRange) return kind === "end" ? dateRange.endDate : dateRange.startDate;

            const minutes = parseTimeToDayMinutes(kind === "end" ? event?.end : event?.start);
            if (minutes === null) return null;

            const now = new Date();
            const parts = getClockZonedParts(now);
            let boundary = makeClockZonedDate(
                parts.year,
                parts.month - 1,
                parts.day,
                Math.floor(minutes / 60),
                minutes % 60
            );
            if (boundary.getTime() <= now.getTime() + AUTO_PRE_MS) {
                boundary = makeClockZonedDate(
                    parts.year,
                    parts.month - 1,
                    parts.day + 1,
                    Math.floor(minutes / 60),
                    minutes % 60
                );
            }
            return boundary;
        }

        function getClockMinutesForEventBoundary(event, kind, boundaryDate) {
            const displayWindow = getDisplayWindow();
            const eventRange = getEventDateRange(event);
            if (eventRange) {
                const { startDate, endDate } = getWindowDateRange();
                const boundaryMs = boundaryDate.getTime();
                if (boundaryMs < startDate.getTime() || boundaryMs >= endDate.getTime()) return null;
                return displayWindow.start + (boundaryMs - startDate.getTime()) / (60 * 1000);
            }

            const minutes = parseTimeToDayMinutes(kind === "end" ? event?.end : event?.start);
            if (minutes === null) return null;
            if (use24HourRadial || displayWindow.duration >= RADIAL_24_HOUR_CYCLE_MINUTES) return minutes;

            const windowStart = displayWindow.start;
            const windowEnd = windowStart + displayWindow.duration;
            for (const shift of [-24 * 60, 0, 24 * 60]) {
                const shifted = minutes + shift;
                if (shifted >= windowStart && shifted < windowEnd) return shifted;
            }
            return null;
        }

        function getNextEventAutoBoundary(nowMs = Date.now()) {
            if (!magnifierAutoEventStartEnabled && !magnifierAutoEventEndEnabled) return null;

            const earliestBoundaryMs = nowMs + AUTO_PRE_MS + 250;
            const candidates = [];
            calendarEvents.forEach(event => {
                [
                    {
                        kind: "start",
                        enabled: magnifierAutoEventStartEnabled,
                        attention: magnifierAutoEventStartAttention
                    },
                    {
                        kind: "end",
                        enabled: magnifierAutoEventEndEnabled && !isPointCalendarEvent(event),
                        attention: magnifierAutoEventEndAttention
                    }
                ].forEach(trigger => {
                    if (!trigger.enabled || isCalendarClockDateParseFailed(event)) return;
                    const boundaryDate = getEventBoundaryDate(event, trigger.kind);
                    if (!boundaryDate || boundaryDate.getTime() <= earliestBoundaryMs) return;
                    const clockMinutes = getClockMinutesForEventBoundary(event, trigger.kind, boundaryDate);
                    if (clockMinutes === null) return;
                    candidates.push({
                        boundaryMs: boundaryDate.getTime(),
                        clockMinutes,
                        kind: trigger.kind,
                        attention: trigger.attention === true
                    });
                });
            });

            candidates.sort((a, b) => a.boundaryMs - b.boundaryMs);
            return candidates[0] || null;
        }

        function scheduleNextEventAutoMagnifier(nowMs = Date.now()) {
            const boundary = getNextEventAutoBoundary(nowMs);
            if (!boundary) return;

            autoEventTimerId = setTimeout(() => {
                startAutoMagnifier(boundary.boundaryMs, {
                    targetProvider: () => getClockTimePoint(boundary.clockMinutes, 0.252),
                    attention: boundary.attention,
                    attentionKind: boundary.kind
                });
                scheduleNextAutoMagnifier();
            }, Math.max(0, boundary.boundaryMs - AUTO_PRE_MS - Date.now()));
        }

        function scheduleNextAutoMagnifier() {
            clearTimeout(autoTimerId);
            clearTimeout(autoEventTimerId);
            autoTimerId = null;
            autoEventTimerId = null;
            if (!shouldRunAutoMagnifier()) return;

            const nowMs = Date.now();
            scheduleNextMinuteHandAutoMagnifier(nowMs);
            scheduleNextEventAutoMagnifier(nowMs);
        }

        function startAutoMagnifier(targetRunTime = Date.now() + AUTO_PRE_MS, options = {}) {
            if (!shouldRunAutoMagnifier() || autoMagnifierActive) return;

            lensSize = magnifierEl.offsetWidth;
            autoTargetProvider = typeof options.targetProvider === "function" ? options.targetProvider : getMinuteHandTip;
            autoMagnifierAttention = options.attention === true;
            const target = autoTargetProvider();
            const outside = getOutsideRightPosition(target.y);

            pointerX = outside.x;
            pointerY = outside.y;
            updateMagnifier();

            autoExitStartMs =
                performance.now() +
                Math.max(0, targetRunTime + AUTO_POST_MS - Date.now() - AUTO_SLIDE_MS);

            stageEl.classList.remove("is-hovering");
            stageEl.classList.remove("is-auto-attention", "is-auto-attention-start", "is-auto-attention-end");
            stageEl.classList.add("is-auto-magnifying");
            if (autoMagnifierAttention) {
                stageEl.classList.add("is-auto-attention", `is-auto-attention-${options.attentionKind === "end" ? "end" : "start"}`);
            }
            autoMagnifierActive = true;
            autoPhase = "enter";
            autoPhaseStart = performance.now();
            autoFromX = outside.x;
            autoFromY = outside.y;
        }

        function startAutoMagnifierExit() {
            if (!autoMagnifierActive || autoPhase === "exit") return;

            lensSize = magnifierEl.offsetWidth;

            const outside = getOutsideRightPosition(pointerY);

            autoPhase = "exit";
            autoPhaseStart = performance.now();

            autoFromX = pointerX;
            autoFromY = pointerY;
            autoToX = outside.x;
            autoToY = outside.y;
        }

        function updateAutoMagnifier(nowMs) {
            if (!autoMagnifierActive) return;

            lensSize = magnifierEl.offsetWidth;

            if (autoPhase === "enter") {
                const t = Math.min(1, (nowMs - autoPhaseStart) / AUTO_SLIDE_MS);
                const eased = easeInOutCubic(t);
                const target = (autoTargetProvider || getMinuteHandTip)();
                pointerX = lerp(autoFromX, target.x, eased);
                pointerY = lerp(autoFromY, target.y, eased);
                updateMagnifier();

                if (t >= 1) {
                    autoPhase = "hold";
                    autoPhaseStart = nowMs;
                }
            } else if (autoPhase === "hold") {
                const target = (autoTargetProvider || getMinuteHandTip)();
                pointerX = target.x;
                pointerY = target.y;
                updateMagnifier();

                if (nowMs >= autoExitStartMs) {
                    const outside = getOutsideRightPosition(pointerY);
                    autoPhase = "exit";
                    autoPhaseStart = nowMs;
                    autoFromX = pointerX;
                    autoFromY = pointerY;
                    autoToX = outside.x;
                    autoToY = outside.y;
                }
            } else if (autoPhase === "exit") {
                const t = Math.min(1, (nowMs - autoPhaseStart) / AUTO_SLIDE_MS);
                const eased = easeInOutCubic(t);
                pointerX = lerp(autoFromX, autoToX, eased);
                pointerY = lerp(autoFromY, autoToY, eased);
                updateMagnifier();

                if (t >= 1) {
                    autoMagnifierActive = false;
                    autoMagnifierAttention = false;
                    autoPhase = "idle";
                    autoTargetProvider = null;
                    stageEl.classList.remove("is-auto-magnifying", "is-auto-attention", "is-auto-attention-start", "is-auto-attention-end");
                }
            }
        }

        function moveFromEvent(event) {
            if (!magnifierEnabled || !magnifierHoverEnabled || autoMagnifierActive || mouseMagnifierHidden) return;

            const rect = stageEl.getBoundingClientRect();
            pointerX = event.clientX - rect.left;
            pointerY = event.clientY - rect.top;
            stageEl.classList.add("is-hovering");
            updateMagnifier();
        }

        stageEl.addEventListener("pointerenter", event => {
            moveFromEvent(event);
        });

        stageEl.addEventListener("pointermove", moveFromEvent);

        stageEl.addEventListener("pointerleave", () => {
            stageEl.classList.remove("is-hovering");
            mouseMagnifierHidden = false;
        });

        document.addEventListener("dblclick", event => {
            if (!magnifierEnabled || !magnifierHoverEnabled || autoMagnifierActive) return;

            mouseMagnifierHidden = !mouseMagnifierHidden;

            if (mouseMagnifierHidden) {
                stageEl.classList.remove("is-hovering");
                return;
            }

            if (stageEl.contains(event.target)) {
                moveFromEvent(event);
            }
        });

        function stopAutoMagnifier() {
            autoMagnifierActive = false;
            autoPhase = "idle";
            clearTimeout(autoTimerId);
            clearTimeout(autoEventTimerId);
            autoTimerId = null;
            autoEventTimerId = null;
            autoTargetProvider = null;
            autoMagnifierAttention = false;
            stageEl.classList.remove("is-hovering", "is-auto-magnifying", "is-auto-attention", "is-auto-attention-start", "is-auto-attention-end");
            mouseMagnifierHidden = false;
        }

        function setMagnifierEnabled(enabled) {
            magnifierEnabled = enabled !== false;
            stageEl.classList.toggle("is-magnifier-disabled", !magnifierEnabled);
            if (!magnifierEnabled) {
                stopAutoMagnifier();
                return;
            }
            scheduleNextAutoMagnifier();
        }

        function setMagnifierHoverEnabled(enabled) {
            magnifierHoverEnabled = enabled !== false;
            if (!magnifierHoverEnabled) {
                stageEl.classList.remove("is-hovering");
                mouseMagnifierHidden = false;
            }
        }

        function setMagnifierCenterCursorVisible(visible) {
            magnifierCenterCursor = visible === true;
            stageEl.classList.toggle("is-magnifier-center-cursor-visible", magnifierCenterCursor);
        }

        function setMagnifierAutoEnabled(enabled) {
            magnifierAutoEnabled = enabled !== false;
            if (!magnifierAutoEnabled) {
                stopAutoMagnifier();
                return;
            }
            scheduleNextAutoMagnifier();
        }

        function setMagnifierAutoTriggers(settings = {}) {
            if (settings.autoMinuteHandEnabled !== undefined) magnifierAutoMinuteHandEnabled = settings.autoMinuteHandEnabled === true;
            if (settings.autoEventStartEnabled !== undefined) magnifierAutoEventStartEnabled = settings.autoEventStartEnabled === true;
            if (settings.autoEventStartAttention !== undefined) magnifierAutoEventStartAttention = settings.autoEventStartAttention === true;
            if (settings.autoEventEndEnabled !== undefined) magnifierAutoEventEndEnabled = settings.autoEventEndEnabled === true;
            if (settings.autoEventEndAttention !== undefined) magnifierAutoEventEndAttention = settings.autoEventEndAttention === true;
            scheduleNextAutoMagnifier();
        }

        function setMagnifierLensSize(value) {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return;
            const safeSize = Math.min(LENS_MAX_SIZE, Math.max(LENS_MIN_SIZE, Math.round(parsed)));
            lensSizeSliderEl.value = String(safeSize);
            document.documentElement.style.setProperty("--lens-size", safeSize + "px");
            lensSize = magnifierEl.offsetWidth;
            updateMagnifier();
            scheduleLensLiquidGlassRebuild();
        }

        function setMagnifierAutoIntervalSeconds(value) {
            const parsed = Number(value);
            magnifierAutoIntervalSeconds = Math.min(
                MAGNIFIER_AUTO_INTERVAL_MAX_SECONDS,
                Math.max(MAGNIFIER_AUTO_INTERVAL_MIN_SECONDS, Math.round(Number.isFinite(parsed) ? parsed : 600))
            );
            autoIntervalInputEl.value = String(magnifierAutoIntervalSeconds);
            scheduleNextAutoMagnifier();
        }

        function applyMagnifierSettings(settings = {}) {
            if (settings.lensSize !== undefined) setMagnifierLensSize(settings.lensSize);
            if (settings.autoIntervalSeconds !== undefined) setMagnifierAutoIntervalSeconds(settings.autoIntervalSeconds);
            if (settings.hoverEnabled !== undefined) setMagnifierHoverEnabled(settings.hoverEnabled);
            if (settings.centerCursor !== undefined) setMagnifierCenterCursorVisible(settings.centerCursor);
            if (settings.autoEnabled !== undefined) setMagnifierAutoEnabled(settings.autoEnabled);
            setMagnifierAutoTriggers(settings);
            if (settings.enabled !== undefined) setMagnifierEnabled(settings.enabled);
        }
