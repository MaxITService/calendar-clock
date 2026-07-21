// Manages hover/click tooltips for event arcs and tells the Google Calendar overlay which event to highlight.
function updateArcTooltipContent(index) {
            const event = calendarEvents[index];
            if (!event) return;

            const info = getRangeProgressInfo(event);
            const rangeName = String(event.title || "").trim() || "(No title)";

            arcTooltipEl.style.setProperty("--arc-tooltip-color", event.color);

            let content = `
                <div class="arc-tooltip-title">
                    <span class="arc-tooltip-dot"></span>
                    <span>${escapeHtml(rangeName)}</span>
                </div>
                ${event.calendarName ? `<div class="arc-tooltip-calendar">${escapeHtml(event.calendarName)}</div>` : ""}
                <div class="arc-tooltip-range">${escapeHtml(getCalendarEventTimeLabel(event))}</div>
            `;

            if (info.isPoint) {
                content += `<div class="arc-tooltip-muted">Time point</div>`;
            } else if (!info.valid) {
                content += `<div class="arc-tooltip-muted">Invalid time range</div>`;
            } else if (!info.isActive) {
                content += `<div class="arc-tooltip-muted">Not active now</div>`;
            } else {
                content += `
                    <div class="arc-tooltip-row">
                        <span>Time used</span>
                        <strong>${formatDuration(info.used)}</strong>
                    </div>
                    <div class="arc-tooltip-row">
                        <span>Time to end</span>
                        <strong>${formatDuration(info.remaining)}</strong>
                    </div>
                    <div class="arc-tooltip-row">
                        <span>Completion</span>
                        <strong>${info.completion.toFixed(1)}%</strong>
                    </div>
                    <div class="arc-tooltip-progress">
                        <span style="width: ${info.completion}%"></span>
                    </div>
                `;
            }

            arcTooltipEl.innerHTML = content;
        }

        function getArcTooltipDetails(index) {
            const event = calendarEvents[index];
            if (!event) return null;

            const info = getRangeProgressInfo(event);
            const details = {
                title: String(event.title || "").trim() || "(No title)",
                calendarName: String(event.calendarName || ""),
                timeLabel: getCalendarEventTimeLabel(event),
                color: String(event.color || ""),
                state: info.isPoint ? "point" : !info.valid ? "invalid" : !info.isActive ? "inactive" : "active"
            };
            if (details.state === "active") {
                details.used = formatDuration(info.used);
                details.remaining = formatDuration(info.remaining);
                details.completion = Math.min(100, Math.max(0, Number(info.completion) || 0));
            }
            return details;
        }

        function usesParentArcTooltip() {
            return IS_EMBEDDED && !IS_ACTION_POPUP && window.parent !== window;
        }

        function postParentArcTooltip(type, event, includeDetails = false) {
            if (!usesParentArcTooltip()) return false;
            const payload = {
                clientX: Number(event?.clientX) || 0,
                clientY: Number(event?.clientY) || 0
            };
            if (includeDetails) payload.tooltip = getArcTooltipDetails(activeArcTooltipIndex);
            postToCalendarPage(type, payload);
            return true;
        }

        function positionArcTooltip(event) {
            const gap = 14;
            let x = event.clientX + gap;
            let y = event.clientY + gap;

            const tooltipRect = arcTooltipEl.getBoundingClientRect();
            const maxX = Math.max(gap, window.innerWidth - tooltipRect.width - gap);
            const maxY = Math.max(gap, window.innerHeight - tooltipRect.height - gap);

            if (x > maxX) {
                x = event.clientX - tooltipRect.width - gap;
            }

            if (y > maxY) {
                y = event.clientY - tooltipRect.height - gap;
            }

            x = Math.min(maxX, Math.max(gap, x));
            y = Math.min(maxY, Math.max(gap, y));

            arcTooltipEl.style.left = x + "px";
            arcTooltipEl.style.top = y + "px";
        }

        function showArcTooltip(event) {
            clearTimeout(arcTooltipHideTimer);

            const nextIndex = Number(event.currentTarget.dataset.rangeIndex);

            if (activeArcTooltipIndex !== null && activeArcTooltipIndex !== nextIndex) {
                setArcHoverState(activeArcTooltipIndex, false);
            }

            activeArcTooltipIndex = nextIndex;
            setArcHoverState(activeArcTooltipIndex, true);
            updateArcTooltipContent(activeArcTooltipIndex);
            postToCalendarPage("CALENDAR_CLOCK_HIGHLIGHT_EVENT", {
                eventId: calendarEvents[activeArcTooltipIndex]?.id,
                index: activeArcTooltipIndex,
                scroll: false
            });

            if (postParentArcTooltip("CALENDAR_CLOCK_SHOW_EVENT_TOOLTIP", event, true)) {
                arcTooltipEl.classList.remove("is-visible");
                arcTooltipEl.setAttribute("aria-hidden", "true");
            } else {
                arcTooltipEl.classList.add("is-visible");
                arcTooltipEl.setAttribute("aria-hidden", "false");
                positionArcTooltip(event);
            }
        }

        function moveArcTooltip(event) {
            if (activeArcTooltipIndex === null) return;

            updateArcTooltipContent(activeArcTooltipIndex);
            if (!postParentArcTooltip("CALENDAR_CLOCK_MOVE_EVENT_TOOLTIP", event)) {
                positionArcTooltip(event);
            }
        }

        function setArcHoverState(index, isHovered) {
            document.querySelectorAll(`.time-event-${index + 1}`).forEach(arc => {
                arc.classList.toggle("is-arc-hovered", isHovered);
            });
        }

        function hideArcTooltip(index = activeArcTooltipIndex) {
            if (index !== null) {
                setArcHoverState(index, false);
            }

            if (index === activeArcTooltipIndex) {
                postToCalendarPage("CALENDAR_CLOCK_CLEAR_EVENT_HIGHLIGHT");
                activeArcTooltipIndex = null;
                arcTooltipEl.classList.remove("is-visible");
                arcTooltipEl.setAttribute("aria-hidden", "true");
                if (usesParentArcTooltip()) postToCalendarPage("CALENDAR_CLOCK_HIDE_EVENT_TOOLTIP");
            }
        }

        function queueHideArcTooltip(event) {
            clearTimeout(arcTooltipHideTimer);
            const leavingIndex = Number(event.currentTarget.dataset.rangeIndex);

            arcTooltipHideTimer = setTimeout(() => {
                if (!arcTooltipHovered) {
                    hideArcTooltip(leavingIndex);
                }
            }, 120);
        }

        function attachArcTooltipEvents(arc) {
            arc.addEventListener("pointerenter", showArcTooltip);
            arc.addEventListener("pointermove", moveArcTooltip);
            arc.addEventListener("pointerleave", queueHideArcTooltip);
            arc.addEventListener("click", event => {
                const index = Number(event.currentTarget.dataset.rangeIndex);
                postToCalendarPage("CALENDAR_CLOCK_HIGHLIGHT_EVENT", {
                    eventId: calendarEvents[index]?.id,
                    index,
                    scroll: true
                });
            });
        }

        arcTooltipEl.addEventListener("pointerenter", () => {
            arcTooltipHovered = true;
            clearTimeout(arcTooltipHideTimer);
        });

        arcTooltipEl.addEventListener("pointerleave", () => {
            arcTooltipHovered = false;
            hideArcTooltip();
        });

        function updateVisibleArcTooltip() {
            if (activeArcTooltipIndex === null) return;
            updateArcTooltipContent(activeArcTooltipIndex);
            if (usesParentArcTooltip()) {
                postToCalendarPage("CALENDAR_CLOCK_UPDATE_EVENT_TOOLTIP", {
                    tooltip: getArcTooltipDetails(activeArcTooltipIndex)
                });
            }
        }
