(function registerAnalogClockFace() {
    if (typeof buildAnalogClockFace !== "function") {
        clockWarn("analog face builder is unavailable");
        return;
    }

    registerClockFace({
        id: "analog",
        name: "Analog",
        buildFace(target, context) {
            buildAnalogClockFace(target, context);
        },
    });
}());
