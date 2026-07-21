// Starts the clock page after all feature scripts and discoverable face modules have registered.
let clockAnimationFrameId = null;

function animateClock(nowMs) {
        clockAnimationFrameId = null;
        if (clockOverlayMode === "hidden") return;

        setTime();
        refreshEventLabelPriorityByTime(nowMs);
        updateWindowStartMarkers();
        updateAutoMagnifier(nowMs);
        updateVisibleArcTooltip();
        clockAnimationFrameId = requestAnimationFrame(animateClock);
}

function syncClockAnimationForOverlayMode() {
        if (clockOverlayMode === "hidden") {
                if (clockAnimationFrameId !== null) cancelAnimationFrame(clockAnimationFrameId);
                clockAnimationFrameId = null;
                stopAutoMagnifier();
                return;
        }

        if (clockAnimationFrameId === null) clockAnimationFrameId = requestAnimationFrame(animateClock);
        scheduleNextAutoMagnifier();
}

function startClockApp() {
        load24HourRadialSetting();
        loadDisplayWindowSettings();
        update24HourRadialControls();
        updateDisplayWindowSummary();
        updateClockTimeZoneIndicator();
        setupLensSizeSlider();
        buildClock();
        if (typeof postClockFaceAvailability === "function") postClockFaceAvailability();
        loadStoredCalendarEvents();
        if (!IS_EMBEDDED) requestCalendarEventsFromActiveTab();
        syncClockAnimationForOverlayMode();

        let resizeTimer;
        window.addEventListener("resize", () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(buildClock, 80);
        });

        window.addEventListener("load", () => {
            buildClock();
            rebuildLensLiquidGlass();
        });
}

const clockFacesReady = typeof loadClockFaces === "function" ? loadClockFaces() : Promise.resolve();
clockFacesReady
    .catch(error => clockWarn("failed to load clock faces; using built-in analog face", error))
    .then(startClockApp);
