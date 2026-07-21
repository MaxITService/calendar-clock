(function registerMidnightAuroraClockFace() {
    if (typeof buildMidnightAuroraClockFace !== "function") {
        clockWarn("midnight aurora face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "midnight-aurora",
        name: "Midnight Aurora",
        renderConfig: {
            arcs: {
                pointRadiusMultiplier: 0.64,
                pointMinRadius: 3.2,
                labelScale: 0.72
            }
        },
        buildFace(target, context) {
            buildMidnightAuroraClockFace(target, context);
        },
    });
}());
