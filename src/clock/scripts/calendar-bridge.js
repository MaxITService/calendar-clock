// Bridges the clock page with the extension/content script and renders the small Calendar event list.
function parseWindowMessageDate(value) {
            if (!value) return null;
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? null : date;
        }

function normalizeClockCaptureMetaEntry(entry, fallbackSource) {
            if (!entry || typeof entry !== "object") return null;
            const shownCount = Math.max(0, Math.round(Number(entry.shownCount) || 0));
            const omittedCount = Math.max(0, Math.round(Number(entry.omittedCount) || 0));
            const parsedCount = Math.max(shownCount, Math.round(Number(entry.parsedCount) || shownCount + omittedCount));
            return {
                source: String(entry.source || fallbackSource),
                limit: Math.max(1, Math.round(Number(entry.limit) || shownCount || 1)),
                parsedCount,
                shownCount,
                omittedCount: Math.max(omittedCount, parsedCount - shownCount)
            };
        }

        function getClockCaptureMetaEntries(source) {
            const captureMeta = source?.captureMeta || null;
            return [
                normalizeClockCaptureMetaEntry(captureMeta?.calendar, "google-calendar-dom"),
                normalizeClockCaptureMetaEntry(captureMeta?.task, "google-tasks-dom")
            ].filter(Boolean);
        }

        function getClockCaptureSourceLabel(entry) {
            return /task/i.test(entry?.source || "") ? "Tasks" : "Calendar";
        }

        function getClockCaptureOmittedCount(source) {
            return getClockCaptureMetaEntries(source).reduce((total, entry) => total + entry.omittedCount, 0);
        }

        function getClockCaptureLimitNotice(source) {
            return getClockCaptureMetaEntries(source)
                .filter(entry => entry.omittedCount > 0)
                .map(entry => {
                    const label = getClockCaptureSourceLabel(entry);
                    return `${label}: ${entry.shownCount} shown of ${entry.parsedCount}; ${entry.omittedCount} omitted by the ${entry.limit}-item cap`;
                })
                .join(" · ");
        }

function setDisplayWindow(start, end, options = {}) {
            if (parseTimeToDayMinutes(start) !== null) displayWindowStartEl.value = start;
            if (parseTimeToDayMinutes(end) !== null) displayWindowEndEl.value = end;
            if (!options.skipSave) saveDisplayWindowSettings();
            updateDisplayWindowSummary();
            updateWindowStartMarkers();
            updateTimeArcs();
            renderCalendarEventList();
            scheduleNextAutoMagnifier();
        }

        function setWindowStartMarkerVisible(visible, options = {}) {
            windowStartMarkerVisible = Boolean(visible);
            if (options.style !== undefined) windowStartMarkerStyle = options.style;
            if (options.shape !== undefined) windowStartMarkerShape = options.shape;
            if (options.color !== undefined) windowStartMarkerColor = options.color;
            if (options.width !== undefined) windowStartMarkerWidth = Number(options.width);
            if (options.dots !== undefined) windowStartMarkerDots = Number(options.dots);
            if (options.emoji !== undefined) windowStartMarkerEmoji = String(options.emoji || "⭐").trim() || "⭐";
            if (options.labels !== undefined) windowStartMarkerLabels = options.labels === true;
            if (options.pulse !== undefined) windowStartMarkerPulse = options.pulse !== false;
            if (options.transparency !== undefined) windowStartMarkerTransparency = Number(options.transparency);
            updateWindowStartMarkers();
        }

        function save24HourRadialSetting() {
            localStorage.setItem("calendarClock24HourRadial", use24HourRadial ? "1" : "0");
        }

        function load24HourRadialSetting() {
            use24HourRadial = localStorage.getItem("calendarClock24HourRadial") === "1";
        }

        function update24HourRadialControls() {
            radial24HourToggleEl.checked = use24HourRadial;
            displayWindowStartEl.disabled = use24HourRadial;
            displayWindowEndEl.disabled = use24HourRadial;
        }

        function set24HourRadial(enabled, options = {}) {
            const nextEnabled = Boolean(enabled);
            const changed = use24HourRadial !== nextEnabled;
            use24HourRadial = nextEnabled;
            if (!use24HourRadial && displayWindowDurationOverride >= 24 * 60) {
                displayWindowDurationOverride = null;
            }
            update24HourRadialControls();
            updateDisplayWindowSummary();
            if (changed) {
                buildClock();
            } else {
                updateTimeArcs();
            }
            renderCalendarEventList();
            if (!options.skipSave) save24HourRadialSetting();
        }

        function clampClockPercentLevel(value, fallback) {
            const parsed = Number(value);
            const safeFallback = Number.isFinite(fallback) ? fallback : 50;
            if (!Number.isFinite(parsed)) return Math.min(100, Math.max(0, Math.round(safeFallback)));
            return Math.min(100, Math.max(0, Math.round(parsed)));
        }

        function isTrustedCalendarPageMessage(event) {
            if (!IS_EMBEDDED || IS_ACTION_POPUP || window.parent === window) return true;
            return event.source === window.parent && event.origin === "https://calendar.google.com";
        }

        let clockFaceAvailabilityAnnounced = false;
        let lastPublishedClockFaceId = null;

        function postClockFaceAvailability(requestedFaceId, options = {}) {
            if (!IS_EMBEDDED || IS_ACTION_POPUP || window.parent === window) return;
            if (typeof postToCalendarPage !== "function"
                || typeof getClockFaceOptions !== "function"
                || typeof getActiveClockFace !== "function") return;

            const activeFaceId = getActiveClockFace().id;
            if (options.onlyIfActiveChanged === true && activeFaceId === lastPublishedClockFaceId) return;
            const payload = {
                options: getClockFaceOptions(),
                activeFaceId,
                activeFaceAuthoritative: options.activeFaceAuthoritative === true
            };
            if (typeof requestedFaceId === "string") payload.requestedFaceId = requestedFaceId;
            postToCalendarPage("CALENDAR_CLOCK_FACE_AVAILABILITY", payload);
            clockFaceAvailabilityAnnounced = true;
            lastPublishedClockFaceId = activeFaceId;
        }

        function postClockFaceRuntimeAvailabilityIfChanged() {
            if (!clockFaceAvailabilityAnnounced) return;
            postClockFaceAvailability(undefined, {
                activeFaceAuthoritative: true,
                onlyIfActiveChanged: true
            });
        }

        window.addEventListener("message", event => {
            const data = event.data;
            if (!data || typeof data !== "object") return;
            if (!isTrustedCalendarPageMessage(event)) return;

            if (data.type === "CALENDAR_CLOCK_SET_WINDOW") {
                if (["full", "mini", "hidden"].includes(data.mode)) {
                    const modeChanged = clockOverlayMode !== data.mode;
                    clockOverlayMode = data.mode;
                    updateClockOverlayModeClass();
                    if (modeChanged && typeof syncClockAnimationForOverlayMode === "function") {
                        syncClockAnimationForOverlayMode();
                    }
                }
                const clockFaceChanged = typeof setActiveClockFaceId === "function"
                    ? setActiveClockFaceId(data.clockFaceId)
                    : false;
                setClockTimeZone(data.timeZone, data.systemTimeZone);
                const nextRadial24Hour = typeof data.radial24Hour === "boolean" ? data.radial24Hour : use24HourRadial;
                const radial24HourChanged = use24HourRadial !== nextRadial24Hour;
                use24HourRadial = nextRadial24Hour;
                if (!use24HourRadial && displayWindowDurationOverride >= 24 * 60) {
                    displayWindowDurationOverride = null;
                }
                update24HourRadialControls();

                if (data.baseDate) {
                    const nextBaseDate = new Date(data.baseDate);
                    calendarBaseDate = Number.isNaN(nextBaseDate.getTime()) ? null : nextBaseDate;
                }
                displayWindowDurationOverride = Number.isFinite(data.durationMinutes) && data.durationMinutes > 0
                    ? data.durationMinutes
                    : null;
                const windowStartDate = parseWindowMessageDate(data.startDate);
                const windowEndDate = parseWindowMessageDate(data.endDate);
                displayWindowDateRangeOverride = windowStartDate && windowEndDate && windowEndDate > windowStartDate
                    ? { startDate: windowStartDate, endDate: windowEndDate }
                    : null;
                if (radial24HourChanged || clockFaceChanged) buildClock();
                setDisplayWindow(data.start, data.end, { skipSave: data.transient });
                postClockFaceAvailability(String(data.clockFaceId || "").trim());
            } else if (data.type === "CALENDAR_CLOCK_SET_WINDOW_START_MARKER") {
                setWindowStartMarkerVisible(data.visible, {
                    style: data.style,
                    shape: data.shape,
                    color: data.color,
                    width: data.width,
                    dots: data.dots,
                    emoji: data.emoji,
                    labels: data.labels,
                    pulse: data.pulse,
                    transparency: data.transparency
                });
            } else if (data.type === "CALENDAR_CLOCK_SET_24_HOUR_RADIAL") {
                set24HourRadial(data.enabled, { skipSave: true });
            } else if (data.type === "CALENDAR_CLOCK_SET_EVENT_LABELS") {
                eventLabelsVisible = data.enabled === true;
                eventLabelStyle = EVENT_LABEL_STYLES.includes(data.style) ? data.style : "ink";
                eventLabelCustomColor = data.customColor || "#ffffff";
                eventLabelFontFamily = data.fontFamily || "Inter, Segoe UI, Arial, sans-serif";
                eventLabelFontSize = data.fontSize !== undefined
                    ? Number(data.fontSize)
                    : clockOverlayMode === "mini" ? 18 : 22;
                eventLabelProximityPriority = data.proximityPriority === true;
                eventLabelMinLength = data.minLength !== undefined ? Number(data.minLength) : 5;
                eventLabelShortenThreshold = data.shortenThreshold !== undefined ? Number(data.shortenThreshold) : 250;
                eventLabelAnchor = EVENT_LABEL_ANCHORS.includes(data.anchor) ? data.anchor : "center";
                eventLabelOpacity = data.opacity !== undefined ? Number(data.opacity) : 100;
                eventLabelArcDistance = data.arcDistance !== undefined ? Number(data.arcDistance) : 12;
                updateTimeArcs();
            } else if (data.type === "CALENDAR_CLOCK_SET_DENSITY") {
                eventArcsVisible = data.visible !== false;
                arcDensityLevel = clampClockPercentLevel(data.densityLevel, arcDensityLevel);
                arcThicknessLevel = clampClockPercentLevel(data.arcThicknessLevel, arcThicknessLevel);
                arcGapLevel = clampClockPercentLevel(data.arcGapLevel, arcGapLevel);
                arcSameLevelNonOverlapping = data.sameLevelNonOverlapping === true;
                longDurationArcsVisible = data.longDurationArcsVisible !== false;
                updateTimeArcs();
            } else if (data.type === "CALENDAR_CLOCK_SET_MAGNIFIER") {
                applyMagnifierSettings(data);
            } else if (data.type === "CALENDAR_CLOCK_LAUNCH_AUTO_MAGNIFIER") {
                startAutoMagnifier();
            } else if (data.type === "CALENDAR_CLOCK_SET_CONSOLE_LOGS") {
                setClockConsoleLogs(data.enabled);
            } else if (data.type === "CALENDAR_CLOCK_CLEAR_EVENTS") {
                applyCalendarEvents([], null);
            } else if (data.type === "CALENDAR_CLOCK_RELOAD_EVENTS") {
                loadStoredCalendarEvents();
            } else if (data.type === "CALENDAR_CLOCK_EVENT_HOVER") {
                const index = findCalendarEventIndex(data.eventId);
                if (index >= 0) setArcHoverState(index, true);
            } else if (data.type === "CALENDAR_CLOCK_EVENT_LEAVE") {
                const index = findCalendarEventIndex(data.eventId);
                if (index >= 0) setArcHoverState(index, false);
            } else if (data.type === "CALENDAR_CLOCK_EVENT_TOOLTIP_ENTER") {
                arcTooltipHovered = true;
                clearTimeout(arcTooltipHideTimer);
            } else if (data.type === "CALENDAR_CLOCK_EVENT_TOOLTIP_LEAVE") {
                arcTooltipHovered = false;
                hideArcTooltip();
            } else if (data.type === "CALENDAR_CLOCK_REBUILD") {
                buildClock();
            }
        });

        function normalizeCalendarEvents(events, source = {}) {
            if (!Array.isArray(events)) return [];

            return events
                .map((event, index) => {
                    const start = typeof event.start === "string" ? event.start.slice(0, 5) : "";
                    const end = typeof event.end === "string" ? event.end.slice(0, 5) : "";
                    if (parseTimeToDayMinutes(start) === null || parseTimeToDayMinutes(end) === null) return null;
                    let durationKind = event.durationKind === "point" || event.isPointEvent === true
                        ? "point"
                        : event.durationKind === "all-day" || event.isAllDay === true
                            ? "all-day"
                            : "range";
                    const temporalKind = event.temporal?.kind;
                    const temporal = ["timed", "point", "all-day"].includes(temporalKind)
                        && typeof event.temporal?.occurrenceKey === "string"
                        && /^\d{4}-\d{2}-\d{2}$/.test(event.temporal?.firstDateKey || "")
                        && /^\d{4}-\d{2}-\d{2}$/.test(event.temporal?.lastDateKey || "")
                        ? { ...event.temporal }
                        : null;
                    if (event.capturedFrom !== "google-tasks-dom" && (!temporal
                        || temporal.contractVersion !== source?.temporalContext?.contractVersion
                        || temporal.projectionPolicyVersion !== source?.temporalContext?.projectionPolicyVersion
                        || temporal.contextFingerprint !== source?.temporalContext?.fingerprint
                        || temporal.contextFingerprint !== source?.contextFingerprint)) return null;
                    if (temporal) durationKind = temporal.kind === "timed" ? "range" : temporal.kind;
                    const itemKind = event.itemKind === "task"
                        || event.sourceKind === "calendar-task"
                        || event.capturedFrom === "google-tasks-dom"
                        ? "task"
                        : "event";

                    return {
                        id: String(event.id || `${start}-${end}-${index}`),
                        title: String(event.title || "").trim() || "(No title)",
                        calendarName: String(event.calendarName || ""),
                        start,
                        end,
                        durationKind,
                        isPointEvent: durationKind === "point",
                        isAllDay: durationKind === "all-day",
                        temporal,
                        date: temporal?.firstDateKey || "",
                        startDate: typeof event.startDate === "string" ? event.startDate : "",
                        endDate: typeof event.endDate === "string" ? event.endDate : "",
                        dateParseStatus: typeof event.dateParseStatus === "string" ? event.dateParseStatus : "",
                        dateParseReason: typeof event.dateParseReason === "string" ? event.dateParseReason : "",
                        dateParseContext: typeof event.dateParseContext === "string" ? event.dateParseContext : "",
                        dateParseSupportEmail: typeof event.dateParseSupportEmail === "string" ? event.dateParseSupportEmail : "",
                        color: event.color || EVENT_COLORS[index % EVENT_COLORS.length],
                        capturedFrom: event.capturedFrom || "google-calendar",
                        sourceKind: itemKind === "task" ? "calendar-task" : "calendar-event",
                        itemKind,
                        domKey: String(event.domKey || event.id || `${start}-${end}-${index}`),
                        rawText: String(event.rawText || "")
                    };
                })
                .filter(Boolean)
                .sort(compareClockCalendarEventsChronologically);
        }

        function getClockCalendarEventStartTimestamp(event) {
            const timestamp = Date.parse(String(event?.temporal?.startInstant || event?.startDate || ""));
            return Number.isFinite(timestamp) ? timestamp : null;
        }

        function compareClockCalendarEventsChronologically(a, b) {
            const leftTimestamp = getClockCalendarEventStartTimestamp(a);
            const rightTimestamp = getClockCalendarEventStartTimestamp(b);
            if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
                return leftTimestamp - rightTimestamp;
            }

            const dateDelta = a.date && b.date ? a.date.localeCompare(b.date) : 0;
            return dateDelta
                || a.start.localeCompare(b.start)
                || a.end.localeCompare(b.end)
                || a.title.localeCompare(b.title);
        }

        function getClockCalendarSourceLabel(source) {
            const activeSource = String(source?.effectiveSource?.activeSource || "");
            return activeSource === "google-page-owned"
                ? "Google Calendar structured data"
                : "Google Calendar DOM";
        }

        function saveDisplayWindowSettings() {
            localStorage.setItem("calendarClockDisplayWindow", JSON.stringify({
                start: displayWindowStartEl.value,
                end: displayWindowEndEl.value
            }));
        }

        function loadDisplayWindowSettings() {
            try {
                const saved = JSON.parse(localStorage.getItem("calendarClockDisplayWindow") || "null");
                if (saved?.start && parseTimeToDayMinutes(saved.start) !== null) {
                    displayWindowStartEl.value = saved.start;
                }
                if (saved?.end && parseTimeToDayMinutes(saved.end) !== null) {
                    displayWindowEndEl.value = saved.end;
                }
            } catch (_error) {
                localStorage.removeItem("calendarClockDisplayWindow");
            }
        }

        function createCalendarEventRow(event) {
            const undatedTaskLabel = getUndatedGoogleTaskWindowLabel(event);
            const eventTimeLabel = getCalendarEventTimeLabel(event);
            const timeText = isCalendarClockDateParseFailed(event)
                ? `${eventTimeLabel} · hidden: date format issue`
                : undatedTaskLabel
                    ? `${eventTimeLabel} · ${undatedTaskLabel}`
                    : eventTimeLabel;

            const rowEl = document.createElement("div");
            rowEl.className = "calendar-event-row";

            const dotEl = document.createElement("span");
            dotEl.className = "calendar-event-dot";
            dotEl.style.setProperty("--event-color", event.color);

            const mainEl = document.createElement("span");
            mainEl.className = "calendar-event-main";

            const titleEl = document.createElement("span");
            titleEl.className = "calendar-event-title";
            titleEl.textContent = event.title;

            const timeEl = document.createElement("span");
            timeEl.className = "calendar-event-time";
            timeEl.textContent = event.calendarName ? `${timeText} · ${event.calendarName}` : timeText;

            mainEl.append(titleEl, timeEl);
            rowEl.append(dotEl, mainEl);
            return rowEl;
        }

        function createCalendarEventStatusRow(text) {
            const rowEl = document.createElement("div");
            rowEl.className = "calendar-event-time";
            rowEl.textContent = text;
            return rowEl;
        }

        function renderCalendarEventList() {
            const displayWindow = getDisplayWindow();
            const failedDateCount = calendarEvents.filter(isCalendarClockDateParseFailed).length;
            const parsedEvents = calendarEvents.filter(event => !isCalendarClockDateParseFailed(event));
            const visibleCount = parsedEvents.filter(event => getVisibleEventSegment(event, displayWindow)).length;
            const outsideCount = Math.max(0, parsedEvents.length - visibleCount);
            const hiddenLongArcCount = longDurationArcsVisible === false
                ? parsedEvents.filter(event => getVisibleEventSegment(event, displayWindow) && isLongDurationCalendarEvent(event)).length
                : 0;
            const hiddenUndatedTaskCount = parsedEvents.filter(isUndatedGoogleTaskHiddenOutsideToday).length;
            const omittedCaptureCount = getClockCaptureOmittedCount(calendarSource);
            const captureLimitNotice = getClockCaptureLimitNotice(calendarSource);
            const sourceAge = calendarSource?.capturedAt
                ? Math.max(0, Math.round((Date.now() - calendarSource.capturedAt) / 1000))
                : null;

            const baseStatus = calendarEvents.length
                ? failedDateCount
                    ? `${visibleCount} visible · ${outsideCount} outside · ${failedDateCount} date issue`
                    : hiddenUndatedTaskCount
                        ? `${visibleCount} visible · ${outsideCount} outside · ${hiddenUndatedTaskCount} undated task hidden`
                    : hiddenLongArcCount
                        ? `${visibleCount} visible · ${hiddenLongArcCount} long arc hidden · ${outsideCount} outside`
                        : `${visibleCount} visible · ${outsideCount} outside`
                : "Open Google Calendar";
            calendarStatusEl.textContent = omittedCaptureCount ? `${baseStatus} · ${omittedCaptureCount} omitted` : baseStatus;

            const rows = calendarEvents.slice(0, 18).map(createCalendarEventRow);

            if (!rows.length) {
                rows.push(createCalendarEventStatusRow("No visible Calendar events found yet."));
            } else if (failedDateCount) {
                rows.push(createCalendarEventStatusRow(`${failedDateCount} event(s) hidden: Calendar Clock could not understand their date. Send safe diagnostics and your date/time format to the developer.`));
            } else if (hiddenUndatedTaskCount) {
                rows.push(createCalendarEventStatusRow(`${hiddenUndatedTaskCount} undated Google Task(s) hidden because this window does not overlap today.`));
            } else if (hiddenLongArcCount) {
                rows.push(createCalendarEventStatusRow(`${hiddenLongArcCount} long/all-day event arc(s) hidden by Arc settings.`));
            } else if (outsideCount) {
                const outsideWindowLabel = use24HourRadial
                    ? "the selected 24-hour day"
                    : `${displayWindowStartEl.value} - ${displayWindowEndEl.value}`;
                rows.push(createCalendarEventStatusRow(`${outsideCount} event(s) outside ${outsideWindowLabel}.`));
            }

            if (captureLimitNotice) {
                rows.push(createCalendarEventStatusRow(`Capture limit: ${captureLimitNotice}.`));
            }

            if (sourceAge !== null) {
                rows.push(createCalendarEventStatusRow(`Captured ${sourceAge}s ago from ${getClockCalendarSourceLabel(calendarSource)}.`));
            }

            calendarEventListEl.replaceChildren(...rows);
            updateDisplayWindowSummary();
        }

        function applyCalendarEvents(events, source = null) {
            if (activeArcTooltipIndex !== null) hideArcTooltip();
            calendarEvents = normalizeCalendarEvents(events, source);
            calendarSource = source;
            setClockTimeZone(source?.timeZone, source?.systemTimeZone);
            if (typeof hideRenderedCalendarEventVisuals === "function") hideRenderedCalendarEventVisuals();
            buildClock();
            renderCalendarEventList();
            scheduleNextAutoMagnifier();
        }

        let clockExtensionContextInvalidated = false;

        function isClockExtensionContextError(error) {
            return /Extension context invalidated/i.test(String(error?.message || error || ""));
        }

        function markClockExtensionContextInvalidated(error) {
            if (error && !isClockExtensionContextError(error)) return false;
            if (!clockExtensionContextInvalidated) {
                clockLog("extension context invalidated in clock frame");
            }
            clockExtensionContextInvalidated = true;
            return true;
        }

        function applyClockOverlayState(state) {
            if (!state || typeof state !== "object") return;
            const nextRadial24Hour = typeof state.radial24Hour === "boolean"
                ? state.radial24Hour
                : use24HourRadial;
            const radial24HourChanged = use24HourRadial !== nextRadial24Hour;

            if (IS_ACTION_POPUP
                && parseTimeToDayMinutes(state.windowStart) !== null
                && parseTimeToDayMinutes(state.windowEnd) !== null
                && state.windowStart !== state.windowEnd) {
                displayWindowStartEl.value = state.windowStart;
                displayWindowEndEl.value = state.windowEnd;
                displayWindowDurationOverride = null;
                displayWindowDateRangeOverride = null;
            }

            setClockConsoleLogs(state.consoleLogs === true);
            const clockFaceChanged = typeof setActiveClockFaceId === "function"
                ? setActiveClockFaceId(state.clockFaceId)
                : false;
            if (typeof state.windowStartMarker === "boolean") windowStartMarkerVisible = state.windowStartMarker;
            if (state.windowStartMarkerStyle !== undefined) windowStartMarkerStyle = state.windowStartMarkerStyle;
            if (state.windowStartMarkerShape !== undefined) windowStartMarkerShape = state.windowStartMarkerShape;
            if (state.windowStartMarkerColor !== undefined) windowStartMarkerColor = state.windowStartMarkerColor;
            if (state.windowStartMarkerWidth !== undefined) windowStartMarkerWidth = Number(state.windowStartMarkerWidth);
            if (state.windowStartMarkerDots !== undefined) windowStartMarkerDots = Number(state.windowStartMarkerDots);
            if (state.windowStartMarkerEmoji !== undefined) windowStartMarkerEmoji = String(state.windowStartMarkerEmoji || "⭐").trim() || "⭐";
            if (state.windowStartMarkerLabels !== undefined) windowStartMarkerLabels = state.windowStartMarkerLabels === true;
            if (state.windowStartMarkerPulse !== undefined) windowStartMarkerPulse = state.windowStartMarkerPulse !== false;
            if (state.windowStartMarkerTransparency !== undefined) windowStartMarkerTransparency = Number(state.windowStartMarkerTransparency);
            if (typeof state.arcsVisible === "boolean") eventArcsVisible = state.arcsVisible;
            if (typeof state.eventLabels === "boolean") eventLabelsVisible = state.eventLabels;
            if (state.eventLabelStyle !== undefined) {
                eventLabelStyle = EVENT_LABEL_STYLES.includes(state.eventLabelStyle) ? state.eventLabelStyle : "ink";
            }
            if (state.eventLabelCustomColor !== undefined) eventLabelCustomColor = state.eventLabelCustomColor || "#ffffff";
            if (state.eventLabelFontFamily !== undefined) eventLabelFontFamily = state.eventLabelFontFamily || "Inter, Segoe UI, Arial, sans-serif";
            const storedEventLabelFontSize = clockOverlayMode === "mini"
                ? state.eventLabelFontSizeMini
                : state.eventLabelFontSizeFull;
            if (storedEventLabelFontSize !== undefined) eventLabelFontSize = Number(storedEventLabelFontSize);
            if (state.eventLabelProximityPriority !== undefined) eventLabelProximityPriority = state.eventLabelProximityPriority === true;
            if (state.eventLabelMinLength !== undefined) eventLabelMinLength = Number(state.eventLabelMinLength);
            if (state.eventLabelShortenThreshold !== undefined) eventLabelShortenThreshold = Number(state.eventLabelShortenThreshold);
            if (state.eventLabelAnchor !== undefined) {
                eventLabelAnchor = EVENT_LABEL_ANCHORS.includes(state.eventLabelAnchor) ? state.eventLabelAnchor : "center";
            }
            if (state.eventLabelOpacity !== undefined) eventLabelOpacity = Number(state.eventLabelOpacity);
            if (state.eventLabelArcDistance !== undefined) eventLabelArcDistance = Number(state.eventLabelArcDistance);
            if (state.densityLevel !== undefined) arcDensityLevel = clampClockPercentLevel(state.densityLevel, arcDensityLevel);
            if (state.arcThicknessLevel !== undefined) arcThicknessLevel = clampClockPercentLevel(state.arcThicknessLevel, arcThicknessLevel);
            if (state.arcGapLevel !== undefined) arcGapLevel = clampClockPercentLevel(state.arcGapLevel, arcGapLevel);
            if (state.arcSameLevelNonOverlapping !== undefined) {
                arcSameLevelNonOverlapping = state.arcSameLevelNonOverlapping === true;
            }
            if (state.longDurationArcsVisible !== undefined) {
                longDurationArcsVisible = state.longDurationArcsVisible !== false;
            }
            applyMagnifierSettings({
                enabled: state.magnifierEnabled,
                hoverEnabled: state.magnifierHoverEnabled,
                centerCursor: state.magnifierCenterCursor,
                autoEnabled: state.magnifierAutoEnabled,
                autoMinuteHandEnabled: state.magnifierAutoMinuteHandEnabled,
                autoEventStartEnabled: state.magnifierAutoEventStartEnabled,
                autoEventStartAttention: state.magnifierAutoEventStartAttention,
                autoEventEndEnabled: state.magnifierAutoEventEndEnabled,
                autoEventEndAttention: state.magnifierAutoEventEndAttention,
                lensSize: state.magnifierLensSize,
                autoIntervalSeconds: state.magnifierAutoIntervalSeconds
            });
            if (typeof state.radial24Hour === "boolean") {
                use24HourRadial = nextRadial24Hour;
                if (!use24HourRadial && displayWindowDurationOverride >= 24 * 60) {
                    displayWindowDurationOverride = null;
                }
                update24HourRadialControls();
                updateDisplayWindowSummary();
            }
            updateWindowStartMarkers();
            if (radial24HourChanged || clockFaceChanged) {
                buildClock();
            } else {
                updateTimeArcs();
            }
            renderCalendarEventList();
        }

        function getChromeApi() {
            if (clockExtensionContextInvalidated) return null;

            try {
                if (typeof chrome === "undefined" || !chrome.runtime?.id) return null;
                return chrome;
            } catch (error) {
                markClockExtensionContextInvalidated(error);
                return null;
            }
        }

        function getClockRuntimeLastError(chromeApi) {
            try {
                return chromeApi?.runtime?.lastError || null;
            } catch (error) {
                markClockExtensionContextInvalidated(error);
                return null;
            }
        }

        function loadStoredCalendarEvents() {
            const chromeApi = getChromeApi();
            if (!chromeApi?.storage?.local) {
                renderCalendarEventList();
                return;
            }

            try {
                chromeApi.storage.local.get(["calendarClockEvents", "calendarClockSource", "calendarClockOverlayState"], result => {
                    const runtimeError = getClockRuntimeLastError(chromeApi);
                    if (runtimeError) {
                        markClockExtensionContextInvalidated(runtimeError);
                        renderCalendarEventList();
                        return;
                    }

                    applyClockOverlayState(result.calendarClockOverlayState);
                    applyCalendarEvents(result.calendarClockEvents || [], result.calendarClockSource || null);
                });
            } catch (error) {
                if (!markClockExtensionContextInvalidated(error)) {
                    clockWarn("failed to load stored events", error);
                }
                renderCalendarEventList();
            }
        }

        function requestCalendarEventsFromActiveTab(options = {}) {
            const chromeApi = getChromeApi();
            if (!chromeApi?.tabs) return;

            const hardReset = options?.hardReset === true;
            calendarStatusEl.textContent = hardReset ? "Resetting Calendar cache" : "Refreshing Calendar";
            try {
                chromeApi.tabs.query({ active: true, currentWindow: true }, tabs => {
                    const queryError = getClockRuntimeLastError(chromeApi);
                    if (queryError) {
                        markClockExtensionContextInvalidated(queryError);
                        loadStoredCalendarEvents();
                        return;
                    }

                    const tab = tabs[0];
                    if (!tab?.id || !/^https:\/\/calendar\.google\.com\//.test(tab.url || "")) {
                        loadStoredCalendarEvents();
                        return;
                    }

                    const handleResponse = response => {
                        const sendError = getClockRuntimeLastError(chromeApi);
                        if (sendError || !response) {
                            if (sendError) markClockExtensionContextInvalidated(sendError);
                            loadStoredCalendarEvents();
                            return;
                        }

                        if (hardReset && response.ok === true) {
                            applyCalendarEvents([], null);
                            calendarStatusEl.textContent = "Reloading Google Calendar";
                            return;
                        }

                        // The content response is fresh-only; storage is the canonical
                        // merged projection and will also notify us when its write lands.
                        loadStoredCalendarEvents();
                    };
                    if (hardReset) {
                        chromeApi.runtime.sendMessage({
                            type: "CALENDAR_CLOCK_HARD_REFRESH_EVENTS",
                            tabId: tab.id
                        }, handleResponse);
                    } else {
                        chromeApi.tabs.sendMessage(tab.id, {
                            type: "CALENDAR_CLOCK_COLLECT_EVENTS"
                        }, handleResponse);
                    }
                });
            } catch (error) {
                if (!markClockExtensionContextInvalidated(error)) {
                    clockWarn("failed to request Calendar events", error);
                }
                loadStoredCalendarEvents();
            }
        }

        refreshCalendarButtonEl.addEventListener("click", () => {
            requestCalendarEventsFromActiveTab({ hardReset: true });
        });

        const chromeApi = getChromeApi();
        if (chromeApi?.storage?.onChanged) {
            try {
                chromeApi.storage.onChanged.addListener((changes, areaName) => {
                    if (areaName !== "local") return;
                    if (changes.calendarClockOverlayState) {
                        applyClockOverlayState(changes.calendarClockOverlayState.newValue);
                    }
                    if (changes.calendarClockEvents) {
                        applyCalendarEvents(
                            changes.calendarClockEvents.newValue || [],
                            changes.calendarClockSource?.newValue || calendarSource
                        );
                    }
                });
            } catch (error) {
                if (!markClockExtensionContextInvalidated(error)) {
                    clockWarn("failed to watch stored events", error);
                }
            }
        }
