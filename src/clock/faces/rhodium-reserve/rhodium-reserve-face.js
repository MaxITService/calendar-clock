(function registerRhodiumReserveClockFace() {
    if (typeof buildRhodiumReserveClockFace !== "function") {
        clockWarn("rhodium reserve face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "rhodium-reserve",
        name: "Rhodium Reserve",
        renderConfig: {
            arcs: {
                pointRadiusMultiplier: 0.7,
                pointMinRadius: 3.8,
                labelScale: 0.78,
                maxThicknessScale: 2.25
            }
        },
        buildFace(target, context) {
            buildRhodiumReserveClockFace(target, context);
        },
    });
}());
