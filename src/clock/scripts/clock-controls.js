// Wires local controls for lens size, display-window fields, overlay mode buttons, and lens dragging.
function setupLensSizeSlider() {
            lensSizeSliderEl.min = String(LENS_MIN_SIZE);
            lensSizeSliderEl.max = String(LENS_MAX_SIZE);
            lensSizeSliderEl.value = String(LENS_DEFAULT_SIZE);
            autoIntervalInputEl.value = String(magnifierAutoIntervalSeconds);

            document.documentElement.style.setProperty("--lens-size", LENS_DEFAULT_SIZE + "px");
        }

        lensSizeSliderEl.addEventListener("input", () => {
            setMagnifierLensSize(lensSizeSliderEl.value);
        });

        autoIntervalInputEl.addEventListener("input", () => {
            setMagnifierAutoIntervalSeconds(autoIntervalInputEl.value);
        });
        manualAutoButtonEl.addEventListener("click", () => startAutoMagnifier());
        displayWindowStartEl.addEventListener("input", () => {
            displayWindowDurationOverride = null;
            displayWindowDateRangeOverride = null;
            saveDisplayWindowSettings();
            updateDisplayWindowSummary();
            updateTimeArcs();
            renderCalendarEventList();
        });
        displayWindowEndEl.addEventListener("input", () => {
            displayWindowDurationOverride = null;
            displayWindowDateRangeOverride = null;
            saveDisplayWindowSettings();
            updateDisplayWindowSummary();
            updateTimeArcs();
            renderCalendarEventList();
        });
        radial24HourToggleEl.addEventListener("change", () => {
            displayWindowDateRangeOverride = null;
            set24HourRadial(radial24HourToggleEl.checked);
        });
        clockFullButtonEl.addEventListener("click", () => postToCalendarPage("CALENDAR_CLOCK_SET_MODE", { mode: "full" }));
        clockMiniButtonEl.addEventListener("click", () => postToCalendarPage("CALENDAR_CLOCK_SET_MODE", { mode: "mini" }));
        clockHideButtonEl.addEventListener("click", () => postToCalendarPage("CALENDAR_CLOCK_SET_MODE", { mode: "hidden" }));

        magnifierEl.addEventListener("pointerdown", event => {
            if (!autoMagnifierActive) return;

            event.preventDefault();
            event.stopPropagation();

            startAutoMagnifierExit();
        });
