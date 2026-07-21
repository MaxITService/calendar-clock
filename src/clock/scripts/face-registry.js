// Loads clock face folders while keeping the app resilient when a face is missing.
const CLOCK_FACE_MODULES = [
    {
        id: "analog",
        name: "Analog",
        styles: ["faces/analog/analog-face.css"],
        scripts: [
            "faces/analog/analog-builder.js",
            "faces/analog/analog-face.js",
        ],
    },
    {
        id: "neumorphic-white",
        name: "White Neumorphic",
        styles: ["faces/neumorphic-white/neumorphic-white-face.css"],
        scripts: [
            "faces/neumorphic-white/neumorphic-white-builder.js",
            "faces/neumorphic-white/neumorphic-white-face.js",
        ],
    },
    {
        id: "emerald-gold",
        name: "Emerald Gold",
        styles: ["faces/emerald-gold/emerald-gold-face.css"],
        scripts: [
            "faces/emerald-gold/emerald-gold-builder.js",
            "faces/emerald-gold/emerald-gold-face.js",
        ],
    },
    {
        id: "crimson-dusk",
        name: "Crimson Dusk",
        styles: ["faces/crimson-dusk/crimson-dusk-face.css"],
        scripts: [
            "faces/crimson-dusk/crimson-dusk-builder.js",
            "faces/crimson-dusk/crimson-dusk-face.js",
        ],
    },
    {
        id: "cobalt-meridian",
        name: "Cobalt Meridian",
        styles: ["faces/cobalt-meridian/cobalt-meridian-face.css"],
        scripts: [
            "faces/cobalt-meridian/cobalt-meridian-builder.js",
            "faces/cobalt-meridian/cobalt-meridian-face.js",
        ],
    },
    {
        id: "sterling-sector",
        name: "Sterling Sector",
        styles: ["faces/sterling-sector/sterling-sector-face.css"],
        scripts: [
            "faces/sterling-sector/sterling-sector-builder.js",
            "faces/sterling-sector/sterling-sector-face.js",
        ],
    },
    {
        id: "rhodium-reserve",
        name: "Rhodium Reserve",
        styles: ["faces/rhodium-reserve/rhodium-reserve-face.css"],
        scripts: [
            "faces/rhodium-reserve/rhodium-reserve-builder.js",
            "faces/rhodium-reserve/rhodium-reserve-face.js",
        ],
    },
    {
        id: "onyx-ceramic",
        name: "Onyx Ceramic",
        styles: ["faces/onyx-ceramic/onyx-ceramic-face.css"],
        scripts: [
            "faces/onyx-ceramic/onyx-ceramic-builder.js",
            "faces/onyx-ceramic/onyx-ceramic-face.js",
        ],
    },
    {
        id: "midnight-aurora",
        name: "Midnight Aurora",
        styles: ["faces/midnight-aurora/midnight-aurora-face.css"],
        scripts: [
            "faces/midnight-aurora/midnight-aurora-builder.js",
            "faces/midnight-aurora/midnight-aurora-face.js",
        ],
    },
    {
        id: "opal-tide",
        name: "Opal Tide",
        styles: ["faces/opal-tide/opal-tide-face.css"],
        scripts: [
            "faces/opal-tide/opal-tide-builder.js",
            "faces/opal-tide/opal-tide-face.js",
        ],
    },
];

const clockFaceRegistry = new Map();
const clockFaceStyleLinks = new Map();
const currentClockFaceBuildTargets = new Set();
let activeClockFaceId = "analog";
let clockFacesLoadedPromise = null;

const BUILT_IN_ANALOG_FACE = {
    id: "analog",
    name: "Analog",
    buildFace(target, context) {
        target.innerHTML = "";
        target.classList.add("is-clock-face-missing");
        clockWarn("analog clock face is unavailable", context);
    },
};

function registerClockFace(face) {
    if (!face || typeof face.id !== "string" || typeof face.buildFace !== "function") {
        clockWarn("ignored invalid clock face registration", face);
        return false;
    }

    clockFaceRegistry.set(face.id, {
        name: face.name || face.id,
        ...face,
    });
    return true;
}

function unloadClockFaceModule(module) {
    clockFaceRegistry.delete(module.id);
    const links = clockFaceStyleLinks.get(module.id) || [];
    links.forEach(link => {
        link.disabled = true;
        link.media = "not all";
        link.remove();
    });
    clockFaceStyleLinks.delete(module.id);
}

function orderLoadedClockFaces() {
    const registeredFaces = new Map(clockFaceRegistry);
    clockFaceRegistry.clear();
    CLOCK_FACE_MODULES.forEach(module => {
        const face = registeredFaces.get(module.id);
        if (face) clockFaceRegistry.set(module.id, face);
        registeredFaces.delete(module.id);
    });
    registeredFaces.forEach((face, id) => clockFaceRegistry.set(id, face));
}

function loadClockFaceScript(module, src) {
    return new Promise(resolve => {
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = () => resolve(true);
        script.onerror = () => {
            clockWarn("failed to load clock face script", { src });
            resolve(false);
        };
        document.head.appendChild(script);
    });
}

function loadClockFaceStyle(module, href) {
    return new Promise(resolve => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.clockFaceId = module.id;
        const links = clockFaceStyleLinks.get(module.id) || [];
        links.push(link);
        clockFaceStyleLinks.set(module.id, links);
        link.onload = () => resolve(true);
        link.onerror = () => {
            clockWarn("failed to load clock face stylesheet", { href });
            resolve(false);
        };
        document.head.appendChild(link);
    });
}

async function loadClockFaceModule(module) {
    const styleResults = await Promise.all((module.styles || []).map(href => loadClockFaceStyle(module, href)));
    const stylesLoaded = styleResults.every(Boolean);
    if (!stylesLoaded) {
        unloadClockFaceModule(module);
        return false;
    }

    for (const src of module.scripts || []) {
        const loaded = await loadClockFaceScript(module, src);
        if (!loaded) {
            unloadClockFaceModule(module);
            return false;
        }
    }

    return true;
}

function loadClockFaces() {
    if (clockFacesLoadedPromise) return clockFacesLoadedPromise;

    clockFacesLoadedPromise = Promise.all(CLOCK_FACE_MODULES.map(async module => {
        const loaded = await loadClockFaceModule(module);
        if (!loaded) return;

        if (!clockFaceRegistry.has(module.id)) {
            clockWarn("clock face did not register", { id: module.id });
            unloadClockFaceModule(module);
            return;
        }
    })).then(result => {
        orderLoadedClockFaces();
        applyActiveClockFaceStyles();
        return result;
    });

    return clockFacesLoadedPromise;
}

function getActiveClockFace() {
    return clockFaceRegistry.get(activeClockFaceId)
        || clockFaceRegistry.get("analog")
        || clockFaceRegistry.values().next().value
        || BUILT_IN_ANALOG_FACE;
}

function getClockFaceOptions() {
    return Array.from(clockFaceRegistry.values(), face => ({
        id: face.id,
        name: face.name || face.id,
    }));
}

function getActiveClockFaceRenderConfig() {
    const face = getActiveClockFace();
    return face && typeof face.renderConfig === "object" ? face.renderConfig : {};
}

function applyActiveClockFaceStyles(faceId = getActiveClockFace().id) {
    clockFaceStyleLinks.forEach((links, id) => {
        links.forEach(link => {
            const active = id === faceId;
            link.disabled = !active;
            link.media = active ? "all" : "not all";
        });
    });
}

function setActiveClockFaceId(faceId) {
    const requestedId = String(faceId || "").trim();
    const nextFace = clockFaceRegistry.get(requestedId)
        || clockFaceRegistry.get("analog")
        || clockFaceRegistry.values().next().value
        || BUILT_IN_ANALOG_FACE;
    const changed = activeClockFaceId !== nextFace.id;
    activeClockFaceId = nextFace.id;
    applyActiveClockFaceStyles(activeClockFaceId);
    return changed;
}

function getActiveClockFaceId() {
    return activeClockFaceId;
}

function createClockFaceContext() {
    return {
        activeFaceId: activeClockFaceId,
        fallbackFace: BUILT_IN_ANALOG_FACE,
    };
}

function rememberClockFaceBuildTarget(target) {
    // buildClock renders the same targets in the same order on every pass. Seeing
    // a target twice starts a new pass and keeps fallback rebuilding bounded.
    if (currentClockFaceBuildTargets.has(target)) {
        currentClockFaceBuildTargets.clear();
    }
    currentClockFaceBuildTargets.add(target);
}

function showClockFaceUnavailable(targets, faceId) {
    targets.forEach(target => {
        target.dataset.clockFaceId = faceId;
        BUILT_IN_ANALOG_FACE.buildFace(target, createClockFaceContext());
    });
}

function buildRegisteredAnalogFallback(failedFace, targets, originalError) {
    const analogFace = clockFaceRegistry.get("analog");

    if (failedFace.id === "analog" || !analogFace) {
        const message = failedFace.id === "analog"
            ? "analog clock face failed; showing unavailable placeholder"
            : "clock face failed; analog fallback is unavailable";
        clockWarn(message, { id: failedFace.id, error: originalError });
        showClockFaceUnavailable(targets, failedFace.id);
        return;
    }

    clockWarn("clock face failed; using registered analog face", {
        id: failedFace.id,
        error: originalError,
    });
    setActiveClockFaceId(analogFace.id);

    try {
        targets.forEach(target => {
            target.dataset.clockFaceId = analogFace.id;
            analogFace.buildFace(target, createClockFaceContext());
        });
    } catch (error) {
        clockWarn("analog fallback failed; showing unavailable placeholder", {
            id: analogFace.id,
            failedFaceId: failedFace.id,
            error,
        });
        showClockFaceUnavailable(targets, analogFace.id);
    }
}

function buildActiveClockFace(target) {
    rememberClockFaceBuildTarget(target);
    const face = getActiveClockFace();

    try {
        setActiveClockFaceId(face.id);
        target.dataset.clockFaceId = face.id;
        face.buildFace(target, createClockFaceContext());
    } catch (error) {
        buildRegisteredAnalogFallback(face, Array.from(currentClockFaceBuildTargets), error);
    }
}

function buildClockFace(target) {
    buildActiveClockFace(target);
}
