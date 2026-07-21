(function registerOnyxCeramicClockFace() {
    if (typeof buildOnyxCeramicClockFace !== "function") {
        clockWarn("onyx ceramic face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "onyx-ceramic",
        name: "Onyx Ceramic",
        renderConfig: {
            arcs: {
                pointRadiusMultiplier: 0.70,
                pointMinRadius: 3.8,
                labelScale: 0.80,
                labelsVisible: true
            }
        },
        buildFace(target, context) {
            buildOnyxCeramicClockFace(target, context);
        },
    });
}());
