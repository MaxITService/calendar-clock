// Loads optional event-label layout folders without making the clock depend on them.
const EVENT_LABEL_LAYOUT_MODULES = [
    {
        id: "side-plates",
        styles: ["event-label-layouts/side-plates/side-plates.css"],
        scripts: ["event-label-layouts/side-plates/side-plates-layout.js"],
    },
];

const eventLabelLayoutRegistry = new Map();
const eventLabelLayoutStyleLinks = new Map();
let eventLabelLayoutsLoadedPromise = null;

function registerEventLabelLayout(layout) {
    if (!layout || typeof layout.id !== "string" || typeof layout.render !== "function") {
        clockWarn("ignored invalid event-label layout registration", layout);
        return false;
    }

    eventLabelLayoutRegistry.set(layout.id, layout);
    return true;
}

function getEventLabelLayout(layoutId) {
    return eventLabelLayoutRegistry.get(String(layoutId || "").trim()) || null;
}

function clearEventLabelLayouts() {
    eventLabelLayoutRegistry.forEach(layout => {
        try {
            layout.clear?.();
        } catch (error) {
            clockWarn("failed to clear event-label layout", { id: layout.id, error });
        }
    });
}

function unloadEventLabelLayoutModule(module) {
    const layout = eventLabelLayoutRegistry.get(module.id);
    try {
        layout?.clear?.();
    } catch (error) {
        clockWarn("failed to clear unavailable event-label layout", { id: module.id, error });
    }
    eventLabelLayoutRegistry.delete(module.id);

    const links = eventLabelLayoutStyleLinks.get(module.id) || [];
    links.forEach(link => link.remove());
    eventLabelLayoutStyleLinks.delete(module.id);
}

function loadEventLabelLayoutScript(module, src) {
    return new Promise(resolve => {
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = () => resolve(true);
        script.onerror = () => {
            clockWarn("failed to load event-label layout script", { id: module.id, src });
            resolve(false);
        };
        document.head.appendChild(script);
    });
}

function loadEventLabelLayoutStyle(module, href) {
    return new Promise(resolve => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.eventLabelLayoutId = module.id;
        const links = eventLabelLayoutStyleLinks.get(module.id) || [];
        links.push(link);
        eventLabelLayoutStyleLinks.set(module.id, links);
        link.onload = () => resolve(true);
        link.onerror = () => {
            clockWarn("failed to load event-label layout stylesheet", { id: module.id, href });
            resolve(false);
        };
        document.head.appendChild(link);
    });
}

async function loadEventLabelLayoutModule(module) {
    const styleResults = await Promise.all(
        (module.styles || []).map(href => loadEventLabelLayoutStyle(module, href))
    );
    if (!styleResults.every(Boolean)) {
        unloadEventLabelLayoutModule(module);
        return false;
    }

    for (const src of module.scripts || []) {
        if (!await loadEventLabelLayoutScript(module, src)) {
            unloadEventLabelLayoutModule(module);
            return false;
        }
    }

    if (!eventLabelLayoutRegistry.has(module.id)) {
        clockWarn("event-label layout did not register", { id: module.id });
        unloadEventLabelLayoutModule(module);
        return false;
    }

    return true;
}

function loadEventLabelLayouts() {
    if (eventLabelLayoutsLoadedPromise) return eventLabelLayoutsLoadedPromise;
    eventLabelLayoutsLoadedPromise = Promise.all(
        EVENT_LABEL_LAYOUT_MODULES.map(loadEventLabelLayoutModule)
    );
    return eventLabelLayoutsLoadedPromise;
}
