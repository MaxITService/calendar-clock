(function registerEmeraldGoldClockFace() {
    if (typeof buildEmeraldGoldClockFace !== "function") {
        clockWarn("emerald gold face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "emerald-gold",
        name: "Emerald Gold",
        renderConfig: {
            arcs: {
                pointRadiusMultiplier: 0.64,
                pointMinRadius: 3.2,
                labelScale: 0.72
            }
        },
        buildFace(target, context) {
            buildEmeraldGoldClockFace(target, context);
        },
    });
}());
