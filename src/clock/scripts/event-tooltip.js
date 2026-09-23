// Manages hover/click tooltips for event arcs and tells the Google Calendar overlay which event to highlight.
function getArcTooltipMeta(event) {
            if (isAllDayCalendarEvent(event) || isPointCalendarEvent(event)) return getCalendarEventTimeLabel(event);
            return `${event.start}–${event.end} · ${formatDuration(getCalendarEventDurationMinutes(event))}`;
        }

        function getArcTooltipStatus(info) {
            if (info.isPoint) return "";
            if (!info.valid) return "Invalid time range";
            if (info.isActive) return `Now · ${formatDuration(info.remaining)} left`;
            if (info.startsIn !== null && info.startsIn !== undefined) return `In ${formatDuration(info.startsIn)}`;
            if (info.endedAgo !== null && info.endedAgo !== undefined) return `Ended ${formatDuration(info.endedAgo)} ago`;
            return "";
        }

        function updateArcTooltipContent(index) {
            const details = getArcTooltipDetails(index);
            if (!details) return;

            arcTooltipEl.style.setProperty("--arc-tooltip-color", details.color);
            arcTooltipEl.innerHTML = `
                <div class="arc-tooltip-title">
                    <span class="arc-tooltip-dot"></span>
                    <span>${escapeHtml(details.title)}</span>
                </div>
                <div class="arc-tooltip-meta">${escapeHtml(details.meta)}</div>
                ${details.calendarName ? `<div class="arc-tooltip-meta">${escapeHtml(details.calendarName)}</div>` : ""}
                ${details.status ? `<div class="arc-tooltip-status">${escapeHtml(details.status)}</div>` : ""}
                ${details.state === "active" ? `<div class="arc-tooltip-progress"><span style="width: ${details.completion}%"></span></div>` : ""}
            `;
        }

        function getArcTooltipDetails(index) {
            const event = calendarEvents[index];
            if (!event) return null;

            const info = getRangeProgressInfo(event);
            return {
                title: String(event.title || "").trim() || "(No title)",
                calendarName: String(event.calendarName || ""),
                meta: getArcTooltipMeta(event),
                status: getArcTooltipStatus(info),
                color: String(event.color || ""),
                state: info.isPoint ? "point" : !info.valid ? "invalid" : !info.isActive ? "inactive" : "active",
                completion: info.isActive ? Math.min(100, Math.max(0, Number(info.completion) || 0)) : 0
            };
        }

        function usesParentArcTooltip() {
            return !IS_ACTION_POPUP && window.parent !== window;
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
