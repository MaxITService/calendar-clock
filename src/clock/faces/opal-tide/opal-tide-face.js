(function registerOpalTideClockFace() {
    if (typeof buildOpalTideClockFace !== "function") {
        clockWarn("opal tide face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "opal-tide",
        name: "Opal Tide",
        renderConfig: {
            arcs: {
                pointRadiusMultiplier: 0.76,
                pointMinRadius: 4,
                labelScale: 0.86,
                labelsVisible: true
            }
        },
        buildFace(target, context) {
            buildOpalTideClockFace(target, context);
        },
    });
}());
