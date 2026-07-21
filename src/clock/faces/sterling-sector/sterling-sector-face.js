(function registerSterlingSectorClockFace() {
    if (typeof buildSterlingSectorClockFace !== "function") {
        clockWarn("sterling sector face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "sterling-sector",
        name: "Sterling Sector",
        renderConfig: {
            arcs: {
                pointRadiusMultiplier: 0.72,
                pointMinRadius: 3.8,
                labelScale: 0.80,
                labelsVisible: true
            }
        },
        buildFace(target, context) {
            buildSterlingSectorClockFace(target, context);
        },
    });
}());
