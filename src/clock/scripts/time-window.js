// Contains time-window math and shared formatting helpers used by event arcs and calendar status UI.
function parseTimeToDayMinutes(value) {
            const match = /^(\d{2}):(\d{2})$/.exec(value);
            if (!match) return null;

            const hours = Number(match[1]);
            const minutes = Number(match[2]);
            if (hours > 23 || minutes > 59) return null;

            return hours * 60 + minutes;
        }

        function formatDuration(totalMinutes) {
            const wholeMinutes = Math.max(0, Math.floor(totalMinutes));
            const hours = Math.floor(wholeMinutes / 60);
            const minutes = wholeMinutes % 60;

            if (hours && minutes) return `${hours}h ${minutes}m`;
            if (hours) return `${hours}h`;
            return `${minutes}m`;
        }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function postToCalendarPage(type, payload = {}) {
            if (!IS_EMBEDDED || window.parent === window) return;
            window.parent.postMessage({ type, ...payload }, "https://calendar.google.com");
        }

        function isValidClockTimeZone(value) {
            const timeZone = String(value || "").trim();
            if (!timeZone) return false;

            try {
                new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
                return true;
            } catch (_error) {
                return false;
            }
        }

        function getDetectedClockSystemTimeZone() {
            try {
                const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                return isValidClockTimeZone(timeZone) ? timeZone : "";
            } catch (_error) {
                return "";
            }
        }

        function getClockSystemTimeZone() {
            if (isValidClockTimeZone(clockSystemTimeZone)) return clockSystemTimeZone;

            const detected = getDetectedClockSystemTimeZone();
            clockSystemTimeZone = detected;
            return detected || "UTC";
        }

        function getActiveClockTimeZone() {
            return isValidClockTimeZone(clockCalendarTimeZone)
                ? clockCalendarTimeZone
                : getClockSystemTimeZone();
        }

        function getClockZonedParts(date = new Date(), timeZone = getActiveClockTimeZone()) {
            const formatter = new Intl.DateTimeFormat("en-US", {
                timeZone,
                hourCycle: "h23",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit"
            });
            const values = {};
            formatter.formatToParts(date).forEach(part => {
                if (part.type !== "literal") values[part.type] = Number(part.value);
            });

            return {
                year: values.year,
                month: values.month,
                day: values.day,
                hour: values.hour,
                minute: values.minute,
                second: values.second
            };
        }

        function getClockTimeZoneOffsetMs(timeZone, date) {
            const parts = getClockZonedParts(date, timeZone);
            const zonedUtcMs = Date.UTC(
                parts.year,
                parts.month - 1,
                parts.day,
                parts.hour,
                parts.minute,
                parts.second
            );
            const dateUtcMs = date.getTime() - date.getMilliseconds();
            return zonedUtcMs - dateUtcMs;
        }

        function makeClockZonedDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0, timeZone = getActiveClockTimeZone()) {
            const localUtcMs = Date.UTC(year, month, day, hour, minute, second, millisecond);
            let offsetMs = getClockTimeZoneOffsetMs(timeZone, new Date(localUtcMs));
            let date = new Date(localUtcMs - offsetMs);
            const adjustedOffsetMs = getClockTimeZoneOffsetMs(timeZone, date);

            if (adjustedOffsetMs !== offsetMs) {
                offsetMs = adjustedOffsetMs;
                date = new Date(localUtcMs - offsetMs);
            }

            return date;
        }

        function addClockZonedDays(date, days, timeZone = getActiveClockTimeZone()) {
            const parts = getClockZonedParts(date, timeZone);
            return makeClockZonedDate(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second, date.getMilliseconds(), timeZone);
        }

        function getClockNowMinutes(includeSeconds = false) {
            const now = new Date();
            const parts = getClockZonedParts(now);
            const seconds = includeSeconds ? (parts.second + now.getMilliseconds() / 1000) / 60 : 0;
            return parts.hour * 60 + parts.minute + seconds;
        }

        function formatClockTimeZoneLabel(timeZone) {
            return String(timeZone || "").replace(/_/g, " ");
        }

        function updateClockTimeZoneIndicator() {
            if (!clockTimezoneIndicatorEl) return;

            const activeTimeZone = getActiveClockTimeZone();
            const systemTimeZone = getClockSystemTimeZone();
            const showIndicator = IS_EMBEDDED
                && !IS_ACTION_POPUP
                && isValidClockTimeZone(clockCalendarTimeZone)
                && activeTimeZone !== systemTimeZone;

            clockTimezoneIndicatorEl.hidden = !showIndicator;
            clockTimezoneIndicatorEl.textContent = showIndicator
                ? `Calendar time zone: ${formatClockTimeZoneLabel(activeTimeZone)} (system: ${formatClockTimeZoneLabel(systemTimeZone)})`
                : "";
        }

        function setClockTimeZone(timeZone, systemTimeZone) {
            const nextCalendarTimeZone = isValidClockTimeZone(timeZone) ? String(timeZone).trim() : "";
            const nextSystemTimeZone = isValidClockTimeZone(systemTimeZone)
                ? String(systemTimeZone).trim()
                : getDetectedClockSystemTimeZone();
            const changed = clockCalendarTimeZone !== nextCalendarTimeZone
                || clockSystemTimeZone !== nextSystemTimeZone;

            clockCalendarTimeZone = nextCalendarTimeZone;
            clockSystemTimeZone = nextSystemTimeZone;
            updateClockTimeZoneIndicator();

            if (changed) {
                updateDisplayWindowSummary();
                if (typeof setTime === "function") setTime();
                if (typeof updateTimeArcs === "function") updateTimeArcs();
                if (typeof scheduleNextAutoMagnifier === "function") scheduleNextAutoMagnifier();
            }

            return changed;
        }

        function findCalendarEventIndex(id) {
            return calendarEvents.findIndex(event => event.id === id || event.domKey === id);
        }

        function isCalendarClockDateParseFailed(event) {
            return event?.dateParseStatus === "failed"
                || (event?.capturedFrom !== "google-tasks-dom" && !event?.temporal);
        }

        function isPointCalendarEvent(event) {
            return event?.temporal?.kind === "point"
                || (event?.capturedFrom === "google-tasks-dom" && (event?.durationKind === "point" || event?.isPointEvent === true));
        }

        function isAllDayCalendarEvent(event) {
            return event?.temporal?.kind === "all-day";
        }

        function getCalendarEventTimeLabel(event) {
            if (isAllDayCalendarEvent(event)) return "All day";
            return isPointCalendarEvent(event)
                ? `${event.start} · time point`
                : `${event.start} - ${event.end}`;
        }

        function getCalendarEventDurationMinutes(event) {
            if (isPointCalendarEvent(event)) return 0;

            const dateRange = getEventDateRange(event);
            if (dateRange) {
                return Math.max(0, (dateRange.endDate.getTime() - dateRange.startDate.getTime()) / (60 * 1000));
            }

            const fromMinutes = parseTimeToDayMinutes(event.start);
            const toMinutes = parseTimeToDayMinutes(event.end);
            if (fromMinutes === null || toMinutes === null) return 0;
            return fromMinutes === toMinutes ? 24 * 60 : minutesBetween(fromMinutes, toMinutes);
        }

        function isLongDurationCalendarEvent(event) {
            return isAllDayCalendarEvent(event) || getCalendarEventDurationMinutes(event) >= 12 * 60;
        }

        function minutesBetween(fromMinutes, toMinutes) {
            let duration = toMinutes - fromMinutes;
            if (duration <= 0) duration += 24 * 60;
            return duration;
        }

        function getCalendarBaseDate() {
            const source = calendarBaseDate || new Date();
            const parts = getClockZonedParts(source);
            return makeClockZonedDate(parts.year, parts.month - 1, parts.day);
        }

        function getWindowDateRange() {
            if (use24HourRadial) {
                if (displayWindowDateRangeOverride?.startDate && displayWindowDateRangeOverride?.endDate) {
                    const startDate = new Date(displayWindowDateRangeOverride.startDate);
                    const endDate = new Date(displayWindowDateRangeOverride.endDate);

                    if (!Number.isNaN(startDate.getTime())
                        && !Number.isNaN(endDate.getTime())
                        && endDate > startDate) {
                        return { startDate, endDate };
                    }
                }

                const baseDate = getCalendarBaseDate();
                const startDate = new Date(baseDate);
                const endDate = addClockZonedDays(baseDate, 1);
                return { startDate, endDate };
            }

            if (displayWindowDateRangeOverride?.startDate && displayWindowDateRangeOverride?.endDate) {
                const startDate = new Date(displayWindowDateRangeOverride.startDate);
                const endDate = new Date(displayWindowDateRangeOverride.endDate);

                if (!Number.isNaN(startDate.getTime())
                    && !Number.isNaN(endDate.getTime())
                    && endDate > startDate) {
                    return { startDate, endDate };
                }
            }

            const displayWindow = getDisplayWindow();
            const start = displayWindow.start;
            const baseDate = getCalendarBaseDate();
            const baseParts = getClockZonedParts(baseDate);
            const startDate = makeClockZonedDate(
                baseParts.year,
                baseParts.month - 1,
                baseParts.day,
                Math.floor(start / 60),
                start % 60
            );
            let endDate;
            if (displayWindowDurationOverride > 0) {
                endDate = new Date(startDate.getTime() + displayWindowDurationOverride * 60 * 1000);
            } else {
                const absoluteEnd = start + displayWindow.duration;
                const end = ((absoluteEnd % (24 * 60)) + 24 * 60) % (24 * 60);
                const endDayOffset = Math.floor(absoluteEnd / (24 * 60));
                endDate = makeClockZonedDate(
                    baseParts.year,
                    baseParts.month - 1,
                    baseParts.day + endDayOffset,
                    Math.floor(end / 60),
                    end % 60
                );
            }

            return { startDate, endDate };
        }

        function formatWindowDateTime(date) {
            if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "unavailable";
            try {
                return new Intl.DateTimeFormat(navigator.language || undefined, {
                    timeZone: getActiveClockTimeZone(),
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                }).format(date);
            } catch (_error) {
                return "unavailable";
            }
        }

        function updateDisplayWindowSummary() {
            if (use24HourRadial) {
                const { startDate, endDate } = getWindowDateRange();
                displayWindowSummaryEl.textContent = `Showing: 24h radial range, from ${formatWindowDateTime(startDate)} to ${formatWindowDateTime(endDate)}`;
                return;
            }

            const { startDate, endDate } = getWindowDateRange();
            displayWindowSummaryEl.textContent = `Showing: from ${formatWindowDateTime(startDate)} to ${formatWindowDateTime(endDate)}`;
        }

        function getDisplayWindow() {
            if (use24HourRadial) {
                const duration = 24 * 60;
                const start = displayWindowDateRangeOverride
                    ? parseTimeToDayMinutes(displayWindowStartEl.value) ?? 0
                    : 0;
                return { start, end: start + duration, duration };
            }

            const start = parseTimeToDayMinutes(displayWindowStartEl.value);
            const end = parseTimeToDayMinutes(displayWindowEndEl.value);

            if (start !== null && displayWindowDurationOverride > 0) {
                return {
                    start,
                    end: start + displayWindowDurationOverride,
                    duration: displayWindowDurationOverride
                };
            }

            if (start === null || end === null || start === end) {
                return { start: 8 * 60, end: 20 * 60, duration: 12 * 60 };
            }

            return { start, end, duration: minutesBetween(start, end) };
        }

        function getEventDateRange(event) {
            const startInstant = event?.temporal?.kind === "all-day" ? event?.startDate : event?.temporal?.startInstant;
            const endInstant = event?.temporal?.kind === "all-day" ? event?.endDate : event?.temporal?.endInstant;
            const startDate = startInstant ? new Date(startInstant) : null;
            const endDate = endInstant ? new Date(endInstant) : null;

            if (!startDate || !endDate
                || Number.isNaN(startDate.getTime())
                || Number.isNaN(endDate.getTime())
                || (!isPointCalendarEvent(event) && endDate <= startDate)
                || (isPointCalendarEvent(event) && endDate < startDate)) {
                return null;
            }

            return { startDate, endDate };
        }

        function getTodayDateRange() {
            const startDate = getCalendarBaseDate();
            const endDate = addClockZonedDays(startDate, 1);
            return { startDate, endDate };
        }

        function doesWindowOverlapToday() {
            const { startDate, endDate } = getWindowDateRange();
            const today = getTodayDateRange();
            return endDate > today.startDate && startDate < today.endDate;
        }

        function isUndatedGoogleTask(event) {
            return event?.capturedFrom === "google-tasks-dom"
                && !event.date
                && !getEventDateRange(event);
        }

        function isUndatedGoogleTaskHiddenOutsideToday(event) {
            return isUndatedGoogleTask(event) && !doesWindowOverlapToday();
        }

        function getUndatedGoogleTaskWindowLabel(event) {
            if (!isUndatedGoogleTask(event)) return "";
            return isUndatedGoogleTaskHiddenOutsideToday(event)
                ? "hidden outside today"
                : "floating task/no date";
        }

        function getRangeProgressInfo(event) {
            if (isPointCalendarEvent(event)) {
                return { valid: true, isPoint: true, isActive: false };
            }

            const dateRange = getEventDateRange(event);
            if (dateRange) {
                const nowMs = Date.now();
                const startMs = dateRange.startDate.getTime();
                const endMs = dateRange.endDate.getTime();
                const duration = (endMs - startMs) / (60 * 1000);
                const used = (nowMs - startMs) / (60 * 1000);
                const remaining = Math.max(0, (endMs - nowMs) / (60 * 1000));
                const completion = Math.min(100, Math.max(0, used / duration * 100));

                return {
                    valid: true,
                    isActive: nowMs >= startMs && nowMs <= endMs,
                    used: Math.max(0, used),
                    remaining,
                    completion,
                };
            }

            const fromMinutes = parseTimeToDayMinutes(event.start);
            const toMinutes = parseTimeToDayMinutes(event.end);

            if (fromMinutes === null || toMinutes === null) {
                return { valid: false };
            }

            const nowMinutes = getClockNowMinutes(true);

            let duration = minutesBetween(fromMinutes, toMinutes);
            if (fromMinutes === toMinutes) duration = 24 * 60;

            let used = nowMinutes - fromMinutes;
            if (used < 0) used += 24 * 60;

            const isActive = used <= duration;
            const remaining = Math.max(0, duration - used);
            const completion = Math.min(100, Math.max(0, used / duration * 100));

            return {
                valid: true,
                isActive,
                used,
                remaining,
                completion,
            };
        }
