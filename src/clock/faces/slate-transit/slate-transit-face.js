(function registerSlateTransitClockFace() {
    if (typeof buildSlateTransitClockFace !== "function") {
        clockWarn("slate transit face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "slate-transit",
        name: "Slate Transit",
        renderConfig: {
            arcs: {
                pointRadiusMultiplier: 0.72,
                pointMinRadius: 3.8,
                labelScale: 0.79,
                labelsVisible: true
            }
        },
        buildFace(target, context) {
            buildSlateTransitClockFace(target, context);
        },
    });
}());
