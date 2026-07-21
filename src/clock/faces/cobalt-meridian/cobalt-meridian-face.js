(function registerCobaltMeridianClockFace() {
    if (typeof buildCobaltMeridianClockFace !== "function") {
        clockWarn("cobalt meridian face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "cobalt-meridian",
        name: "Cobalt Meridian",
        renderConfig: {
            arcs: {
                pointRadiusMultiplier: 0.72,
                pointMinRadius: 4,
                labelScale: 0.82,
                labelsVisible: true
            }
        },
        buildFace(target, context) {
            buildCobaltMeridianClockFace(target, context);
        },
    });
}());
