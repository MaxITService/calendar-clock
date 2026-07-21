// Owns shared DOM references, constants, and mutable state for the clock page scripts.
const CLOCK_SEARCH_PARAMS = new URLSearchParams(window.location.search);
const IS_ACTION_POPUP = CLOCK_SEARCH_PARAMS.get("actionPopup") === "1";
const IS_EMBEDDED = CLOCK_SEARCH_PARAMS.get("embedded") === "1" || IS_ACTION_POPUP;
        document.body.classList.add(IS_EMBEDDED ? "embedded-clock" : "extension-popup");
        document.body.classList.toggle("action-popup-clock", IS_ACTION_POPUP);

const CALENDAR_CLOCK_LOG_PREFIX = "[calen.clock.ext]";
const stageEl = document.getElementById("stage");
        const clockEl = document.getElementById("clock");
        const magnifierEl = document.getElementById("magnifier");
        const lensWindowEl = document.getElementById("lensWindow");
        const lensGlassRefractionEl = document.getElementById("lensGlassRefraction");
        const lensGlassTintEl = document.getElementById("lensGlassTint");
        const magnifiedContentEl = document.getElementById("magnifiedContent");
        const magnifiedClockEl = document.getElementById("magnifiedClock");
        const lensSizeSliderEl = document.getElementById("lensSizeSlider");
        const autoIntervalInputEl = document.getElementById("autoIntervalInput");
        const manualAutoButtonEl = document.getElementById("manualAutoButton");
        const arcTooltipEl = document.getElementById("arcTooltip");
        const calendarStatusEl = document.getElementById("calendarStatus");
        const refreshCalendarButtonEl = document.getElementById("refreshCalendarButton");
        const calendarEventListEl = document.getElementById("calendarEventList");
        const displayWindowStartEl = document.getElementById("displayWindowStart");
        const displayWindowEndEl = document.getElementById("displayWindowEnd");
        const displayWindowSummaryEl = document.getElementById("displayWindowSummary");
        const clockTimezoneIndicatorEl = document.getElementById("clockTimezoneIndicator");
        const radial24HourToggleEl = document.getElementById("radial24HourToggle");
        const clockFullButtonEl = document.getElementById("clockFullButton");
        const clockMiniButtonEl = document.getElementById("clockMiniButton");
        const clockHideButtonEl = document.getElementById("clockHideButton");
        const MAGNIFY = 1.55;
        const AUTO_PRE_MS = 10000;
        const AUTO_POST_MS = 10000;
        const AUTO_SLIDE_MS = 1600;
        const SVG_NS = "http://www.w3.org/2000/svg";

        const LENS_MIN_SIZE = 140;
        const LENS_DEFAULT_SIZE = 550;
        const LENS_MAX_SIZE = LENS_DEFAULT_SIZE * 2;
        const MAGNIFIER_AUTO_INTERVAL_MIN_SECONDS = 5;
        const MAGNIFIER_AUTO_INTERVAL_MAX_SECONDS = 3600;

        const LIQUID_GLASS_CONFIG = {
            glassThickness: 92,
            bezelWidth: 42,
            ior: 1.42,
            scaleRatio: 1.08,
            blur: 0.85,
            sharpCenterArea: 0.8,
            blurTransitionRatio: 0.065,
            specularOpacity: 0.78,
            specularSat: 0.08,
            tintColor: "255,255,255",
            tintOpacity: 0.055,
            innerShadow: "rgba(255,255,255,.34)",
            innerShadowBlur: 38,
            innerShadowSpread: -10,
            balancedSpecular: false
        };

        const EVENT_COLORS = [
            "#d5312f",
            "#7f3fbf",
            "#f28c28",
            "#228b8d",
            "#2d62c8",
            "#859900",
            "#c23b7a",
            "#6e553d"
        ];
        const EVENT_LABEL_STYLES = ["glass", "ink", "glow", "color", "custom"];
        const EVENT_LABEL_ANCHORS = ["center", "start", "end"];

        let calendarEvents = [];
        let calendarSource = null;
        let windowStartMarkerVisible = true;
        let windowStartMarkerStyle = "dots";
        let windowStartMarkerShape = "dots";
        let windowStartMarkerColor = "#3a1860";
        let windowStartMarkerWidth = 3;
        let windowStartMarkerDots = 14;
        let windowStartMarkerEmoji = "⭐";
        let windowStartMarkerLabels = false;
        let windowStartMarkerPulse = true;
        let windowStartMarkerTransparency = 8;
        let use24HourRadial = false;
        let clockOverlayMode = IS_ACTION_POPUP ? "mini" : "full";
        let calendarBaseDate = null;
        let clockCalendarTimeZone = "";
        let clockSystemTimeZone = "";
        let consoleLogsEnabled = false;
        let eventArcsVisible = true;
        let eventLabelsVisible = true;
        let eventLabelStyle = "ink";
        let eventLabelCustomColor = "#ffffff";
        let eventLabelFontFamily = "Inter, Segoe UI, Arial, sans-serif";
        let eventLabelFontSize = clockOverlayMode === "mini" ? 18 : 22;
        let eventLabelProximityPriority = false;
        let eventLabelMinLength = 5;
        let eventLabelShortenThreshold = 250;
        let eventLabelAnchor = "center";
        let eventLabelOpacity = 100;
        let eventLabelArcDistance = 12;
        let magnifierEnabled = true;
        let magnifierHoverEnabled = true;
        let magnifierCenterCursor = false;
        let magnifierAutoEnabled = true;
        let magnifierAutoMinuteHandEnabled = false;
        let magnifierAutoEventStartEnabled = false;
        let magnifierAutoEventStartAttention = false;
        let magnifierAutoEventEndEnabled = false;
        let magnifierAutoEventEndAttention = false;
        let magnifierAutoIntervalSeconds = 600;
        let arcDensityLevel = 50;
        let arcThicknessLevel = 50;
        let arcGapLevel = 0;
        let arcSameLevelNonOverlapping = false;
        let longDurationArcsVisible = true;
        let displayWindowDurationOverride = null;
        let displayWindowDateRangeOverride = null;

        let clockSize = 0;
        let lensSize = 0;
        let pointerX = 0;
        let pointerY = 0;
        let autoTimerId = null;
        let autoEventTimerId = null;
        let autoMagnifierActive = false;
        let autoMagnifierAttention = false;
        let autoPhase = "idle";
        let autoPhaseStart = 0;
        let autoTargetProvider = null;
        let autoFromX = 0;
        let autoFromY = 0;
        let autoToX = 0;
        let autoToY = 0;
        let autoExitStartMs = 0;
        let activeArcTooltipIndex = null;
        let arcTooltipHovered = false;
        let arcTooltipHideTimer = null;
        let mouseMagnifierHidden = false;
        let liquidGlassDefsEl = null;
        let lensLiquidGlassFilterEl = null;
        let lensGlassRebuildTimer = null;

        const DOT_RING_CONFIG = {
            dotsPerRing: 60,
            dotSizeRatio: 0.0024,
            minDotSize: 1.35,
            centerShadowRadiusRatioFromCenter: 0.1755,
            rings: [
                { className: "dot-ring-inner", radiusRatioFromCenter: 0.189 },
                { className: "dot-ring-outer", radiusRatioFromCenter: 0.416, dotSizeMultiplier: 2 },
            ],
        };

        function clockLog(...args) {
            if (!consoleLogsEnabled) return;
            console.log(CALENDAR_CLOCK_LOG_PREFIX, ...args);
        }

        function clockWarn(...args) {
            if (!consoleLogsEnabled) return;
            console.warn(CALENDAR_CLOCK_LOG_PREFIX, ...args);
        }

        function setClockConsoleLogs(enabled) {
            consoleLogsEnabled = enabled === true;
        }

        function updateClockOverlayModeClass() {
            document.body.classList.toggle("clock-mode-full", clockOverlayMode === "full");
            document.body.classList.toggle("clock-mode-mini", clockOverlayMode === "mini");
            document.body.classList.toggle("clock-mode-hidden", clockOverlayMode === "hidden");
        }

        updateClockOverlayModeClass();
