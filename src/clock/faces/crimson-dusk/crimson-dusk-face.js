(function registerCrimsonDuskClockFace() {
    if (typeof buildCrimsonDuskClockFace !== "function") {
        clockWarn("crimson dusk face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "crimson-dusk",
        name: "Crimson Dusk",
        renderConfig: {
            arcs: {
                pointRadiusMultiplier: 0.64,
                pointMinRadius: 3.2,
                labelScale: 0.72
            }
        },
        buildFace(target, context) {
            buildCrimsonDuskClockFace(target, context);
        },
    });
}());
