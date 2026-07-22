(function registerGraphiteRegulatorClockFace() {
    if (typeof buildGraphiteRegulatorClockFace !== "function") {
        clockWarn("graphite regulator face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "graphite-regulator",
        name: "Graphite Regulator",
        renderConfig: {
            arcs: {
                pointRadiusMultiplier: 0.70,
                pointMinRadius: 3.6,
                labelScale: 0.78,
                labelsVisible: true
            }
        },
        buildFace(target, context) {
            buildGraphiteRegulatorClockFace(target, context);
        },
    });
}());
