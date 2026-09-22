// Drives the real clock frame (src/clock/popup.html) with fake events and the same
// postMessage protocol the Google Calendar content script uses.
(function startCalendarClockDesignMock() {
    "use strict";

    const STORAGE_KEY = "calendarClockDesignMock";
    const MINI_FRAME_SIZE = 520;
    const temporalApi = globalThis.CalendarClockTemporalProjection;
    const scenarios = globalThis.CalendarClockDesignMockScenarios;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const contextResult = temporalApi?.createContext?.(timeZone);
    const context = contextResult?.ok ? contextResult.value : null;

    const $ = id => document.getElementById(id);
    const frame = $("mockFrame");
    const frameBox = $("mockFrameBox");
    const stage = $("mockStage");
    const statusEl = $("mockStatus");
    const controls = {
        viewport: $("mockViewport"),
        mode: $("mockMode"),
        face: $("mockFace"),
        scenario: $("mockScenario"),
        magnifier: $("mockMagnifier"),
        radial24: $("mockRadial24"),
        windowStart: $("mockWindowStart"),
        windowEnd: $("mockWindowEnd"),
        windowMarker: $("mockWindowMarker"),
        labels: $("mockLabels"),
        placement: $("mockPlacement"),
        flyoutVariant: $("mockFlyoutVariant"),
        labelStyle: $("mockLabelStyle"),
        customColor: $("mockCustomColor"),
        fontFamily: $("mockFontFamily"),
        fontSizeFull: $("mockFontSizeFull"),
        fontSizeMini: $("mockFontSizeMini"),
        proximity: $("mockProximity"),
        minLength: $("mockMinLength"),
        shorten: $("mockShorten"),
        anchor: $("mockAnchor"),
        opacity: $("mockOpacity"),
        arcDistance: $("mockArcDistance"),
        arcs: $("mockArcs"),
        density: $("mockDensity"),
        thickness: $("mockThickness"),
        gap: $("mockGap"),
        nonOverlapping: $("mockNonOverlapping"),
    };
    const outputs = {
        fontSizeFull: $("mockFontSizeFullOut"),
        fontSizeMini: $("mockFontSizeMiniOut"),
        minLength: $("mockMinLengthOut"),
        shorten: $("mockShortenOut"),
        opacity: $("mockOpacityOut"),
        arcDistance: $("mockArcDistanceOut"),
        density: $("mockDensityOut"),
        thickness: $("mockThicknessOut"),
        gap: $("mockGapOut"),
    };
    let frameReady = false;

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function readControl(control) {
        if (control.type === "checkbox") return control.checked;
        if (control.type === "range") return Number(control.value);
        return control.value;
    }

    function readSettings() {
        const settings = {};
        Object.entries(controls).forEach(([key, control]) => {
            settings[key] = readControl(control);
        });
        return settings;
    }

    function writeSettings(settings) {
        Object.entries(controls).forEach(([key, control]) => {
            if (!(key in settings)) return;
            if (control.type === "checkbox") control.checked = settings[key] === true;
            else control.value = String(settings[key]);
        });
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(readSettings()));
        } catch (_error) { /* ignore */ }
    }

    function loadSettings() {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
            if (stored && typeof stored === "object") writeSettings(stored);
        } catch (_error) { /* ignore */ }
    }

    function syncOutputs() {
        Object.entries(outputs).forEach(([key, output]) => {
            output.textContent = controls[key].value;
        });
    }

    function pad2(value) {
        return String(value).padStart(2, "0");
    }

    function todayDateKey() {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(new Date());
        const get = type => parts.find(part => part.type === type)?.value;
        return `${get("year")}-${get("month")}-${get("day")}`;
    }

    function zonedIso(dateKey, time) {
        const result = temporalApi.resolveZonedCivilDateTime(dateKey, time, timeZone);
        return result.ok ? result.value : new Date().toISOString();
    }

    function parseTime(value, fallback) {
        const match = /^(\d{2}):(\d{2})$/.exec(value || "");
        if (!match) return fallback;
        return Number(match[1]) * 60 + Number(match[2]);
    }

    function post(message) {
        frame.contentWindow?.postMessage(message, "*");
    }

    function applyViewport() {
        const settings = readSettings();
        const stageRect = stage.getBoundingClientRect();
        let width;
        let height;

        if (settings.mode === "mini") {
            width = MINI_FRAME_SIZE;
            height = MINI_FRAME_SIZE;
        } else if (settings.viewport === "fit") {
            width = Math.max(320, Math.floor(stageRect.width));
            height = Math.max(240, Math.floor(stageRect.height));
        } else {
            [width, height] = settings.viewport.split("x").map(Number);
        }

        const scale = Math.min(1, stageRect.width / width, stageRect.height / height);
        frame.style.width = `${width}px`;
        frame.style.height = `${height}px`;
        frame.style.transform = `scale(${scale})`;
        frameBox.style.width = `${Math.round(width * scale)}px`;
        frameBox.style.height = `${Math.round(height * scale)}px`;
        frameBox.classList.toggle("mock-frame-box--mini", settings.mode === "mini");
    }

    function buildEventSource() {
        return {
            capturedAt: Date.now(),
            timeZone,
            systemTimeZone: timeZone,
            temporalContext: context,
            contextFingerprint: context?.fingerprint || "",
            captureMeta: null,
            effectiveSource: {
                requestedMode: "dom",
                activeSource: "design-mock",
                status: "design mock scenario",
                fallback: false,
                captureStatus: null,
                presenceOverlay: null,
                temporalContext: context,
                projectionDiagnostics: [],
            },
        };
    }

    function syncFrame() {
        if (!frameReady || !context) return;
        const settings = readSettings();
        const dateKey = todayDateKey();
        const startMinutes = parseTime(settings.windowStart, 8 * 60);
        let endMinutes = parseTime(settings.windowEnd, 20 * 60);
        if (endMinutes <= startMinutes) endMinutes = startMinutes + 12 * 60;
        const duration = settings.radial24 ? 24 * 60 : Math.min(24 * 60, endMinutes - startMinutes);
        const startIso = zonedIso(dateKey, `${pad2(Math.floor(startMinutes / 60) % 24)}:${pad2(startMinutes % 60)}`);
        const endIso = new Date(Date.parse(startIso) + duration * 60000).toISOString();

        const frameDocument = frame.contentWindow?.document;
        if (frameDocument) frameDocument.documentElement.dataset.flyoutVariant = settings.flyoutVariant;
        post({
            type: "CALENDAR_CLOCK_SET_DAY_PREVIEW",
            active: false,
            dateKey,
            todayDateKey: dateKey,
            phase: "idle",
            relativeLabel: "",
            reason: "",
        });
        post({
            type: "CALENDAR_CLOCK_SET_WINDOW",
            mode: settings.mode,
            start: settings.windowStart,
            end: settings.radial24 ? settings.windowStart : settings.windowEnd,
            baseDate: zonedIso(dateKey, "00:00"),
            startDate: startIso,
            endDate: endIso,
            durationMinutes: duration,
            radial24Hour: settings.radial24,
            clockFaceId: settings.face,
            timeZone,
            systemTimeZone: timeZone,
            transient: false,
        });
        post({
            type: "CALENDAR_CLOCK_SET_EVENTS",
            events: scenarios.buildScenarioEvents(settings.scenario, temporalApi, context, dateKey),
            source: buildEventSource(),
            previewDateKey: "",
        });
        post({
            type: "CALENDAR_CLOCK_SET_WINDOW_START_MARKER",
            visible: settings.windowMarker,
            style: "dots",
            shape: "dots",
            color: "#3a1860",
            width: 3,
            dots: 14,
            emoji: "⭐",
            labels: false,
            pulse: false,
            transparency: 8,
        });
        post({ type: "CALENDAR_CLOCK_SET_24_HOUR_RADIAL", enabled: settings.radial24 });
        post({
            type: "CALENDAR_CLOCK_SET_EVENT_LABELS",
            enabled: settings.labels,
            style: settings.labelStyle,
            placement: settings.placement,
            customColor: settings.customColor,
            fontFamily: settings.fontFamily,
            fontSize: settings.mode === "mini" ? settings.fontSizeMini : settings.fontSizeFull,
            proximityPriority: settings.proximity,
            minLength: settings.minLength,
            shortenThreshold: settings.shorten,
            anchor: settings.anchor,
            opacity: settings.opacity,
            arcDistance: settings.arcDistance,
        });
        post({
            type: "CALENDAR_CLOCK_SET_DENSITY",
            visible: settings.arcs,
            densityLevel: settings.density,
            arcThicknessLevel: settings.thickness,
            arcGapLevel: settings.gap,
            sameLevelNonOverlapping: settings.nonOverlapping,
            longDurationArcsVisible: true,
        });
        post({
            type: "CALENDAR_CLOCK_SET_MAGNIFIER",
            enabled: settings.magnifier,
            hoverEnabled: settings.magnifier,
            centerCursor: false,
            autoEnabled: false,
            autoMinuteHandEnabled: false,
            autoEventStartEnabled: false,
            autoEventStartAttention: false,
            autoEventEndEnabled: false,
            autoEventEndAttention: false,
            lensSize: 260,
            autoIntervalSeconds: 600,
        });
        setStatus(`${scenarios.SCENARIOS[settings.scenario]?.name || settings.scenario} · ${settings.face} · ${settings.mode}`);
    }

    function populateFaces() {
        const modules = frame.contentWindow?.getClockFaceOptions?.() || [];
        const previous = controls.face.value;
        controls.face.replaceChildren(...modules.map(module => {
            const option = document.createElement("option");
            option.value = module.id;
            option.textContent = module.name || module.id;
            return option;
        }));
        if (modules.some(module => module.id === previous)) controls.face.value = previous;
    }

    function populateScenarios() {
        controls.scenario.replaceChildren(...Object.entries(scenarios.SCENARIOS).map(([id, scenario]) => {
            const option = document.createElement("option");
            option.value = id;
            option.textContent = scenario.name;
            return option;
        }));
    }

    function loadFrame() {
        frameReady = false;
        setStatus("Loading clock frame…");
        frame.src = `../../src/clock/popup.html?embedded=1&designMock=1&provider=google&mock=${Date.now()}`;
    }

    frame.addEventListener("load", () => {
        frameReady = true;
        applyViewport();
        // Faces and label layouts load asynchronously; wait for them before the first sync.
        const frameWindow = frame.contentWindow;
        Promise.allSettled([
            frameWindow?.loadClockFaces?.(),
            frameWindow?.loadEventLabelLayouts?.(),
        ]).then(() => {
            populateFaces();
            loadSettings();
            syncOutputs();
            syncFrame();
            setTimeout(syncFrame, 300);
        });
    });

    Object.values(controls).forEach(control => {
        control.addEventListener("input", () => {
            syncOutputs();
            saveSettings();
            applyViewport();
            syncFrame();
        });
        control.addEventListener("change", () => {
            saveSettings();
            applyViewport();
            syncFrame();
        });
    });

    $("mockReload").addEventListener("click", loadFrame);
    $("mockReset").addEventListener("click", () => {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (_error) { /* ignore */ }
        window.location.reload();
    });
    $("mockCollapse").addEventListener("click", () => {
        document.body.classList.toggle("mock-panel-collapsed");
        applyViewport();
        syncFrame();
    });
    window.addEventListener("resize", () => {
        applyViewport();
        syncFrame();
    });

    // Exposed for browser automation: window.designMock.set({ scenario: "longTitles" }).
    globalThis.designMock = Object.freeze({
        set(partial) {
            writeSettings(partial || {});
            syncOutputs();
            saveSettings();
            applyViewport();
            syncFrame();
            return readSettings();
        },
        get: readSettings,
        reload: loadFrame,
        frame: () => frame.contentWindow,
    });

    if (!context) {
        setStatus(`Temporal projection unavailable: ${contextResult?.diagnostic?.message || "unknown"}`);
        return;
    }
    populateScenarios();
    loadSettings();
    syncOutputs();
    loadFrame();
})();
