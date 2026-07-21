(function registerNeumorphicWhiteClockFace() {
    if (typeof buildNeumorphicWhiteClockFace !== "function") {
        clockWarn("white neumorphic face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "neumorphic-white",
        name: "White Neumorphic",
        renderConfig: {
            arcs: {
                pointRadiusMultiplier: 0.64,
                pointMinRadius: 3.2,
                labelScale: 0.72
            }
        },
        buildFace(target, context) {
            buildNeumorphicWhiteClockFace(target, context);
        },
    });
}());
