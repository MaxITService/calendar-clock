(function registerAbyssDiverClockFace() {
    if (typeof buildAbyssDiverClockFace !== "function") {
        clockWarn("abyss diver face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "abyss-diver",
        name: "Abyss Diver",
        renderConfig: {
            arcs: {
                outerBase: 0.370,
                outerRange: 0.035,
                innerBase: 0.205,
                innerRange: 0.105,
                pointRadiusMultiplier: 0.72,
                pointMinRadius: 3.8,
                labelScale: 0.78,
                labelsVisible: true
            }
        },
        buildFace(target, context) {
            buildAbyssDiverClockFace(target, context);
        },
    });
}());
