const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const layoutSource = fs.readFileSync(
    path.join(repoRoot, "src/clock/event-label-layouts/side-plates/side-plates-layout.js"),
    "utf8"
);
let registeredLayout = null;
const context = vm.createContext({
    Math,
    Number,
    String,
    registerEventLabelLayout(layout) {
        registeredLayout = layout;
        return true;
    },
});
vm.runInContext(layoutSource, context);
assert.ok(registeredLayout, "Side-plates layout must register");

const centerGeometry = registeredLayout.getPlateGeometry({
    side: -1,
    labelY: 540,
    labelHeight: 32,
    viewportWidth: 1920,
    centerX: 960,
    centerY: 540,
    protectedRadius: 500,
    outerMargin: 20,
    circleGap: 10,
});
const upperGeometry = registeredLayout.getPlateGeometry({
    side: -1,
    labelY: 100,
    labelHeight: 32,
    viewportWidth: 1920,
    centerX: 960,
    centerY: 540,
    protectedRadius: 500,
    outerMargin: 20,
    circleGap: 10,
});
assert.ok(upperGeometry.width > centerGeometry.width, "Upper plates must be wider than middle plates");

const rightCenterGeometry = registeredLayout.getPlateGeometry({
    side: 1,
    labelY: 540,
    labelHeight: 32,
    viewportWidth: 1920,
    centerX: 960,
    centerY: 540,
    protectedRadius: 500,
    outerMargin: 20,
    circleGap: 10,
});
assert.ok(
    Math.abs(centerGeometry.width - rightCenterGeometry.width) < 0.000001,
    "Symmetric gutters must produce symmetric plate widths"
);

const compactLeftGeometry = registeredLayout.getAutosizedPlateGeometry({
    geometry: { width: 400, innerEdge: 460 },
    side: -1,
    measuredTextWidth: 170,
    horizontalPadding: 12,
    minimumWidth: 64,
    maximumWidth: 340,
});
assert.strictEqual(compactLeftGeometry.width, 194);
assert.strictEqual(compactLeftGeometry.x, 266);
assert.strictEqual(compactLeftGeometry.innerEdge, 460);

const cappedRightGeometry = registeredLayout.getAutosizedPlateGeometry({
    geometry: { width: 500, innerEdge: 1460 },
    side: 1,
    measuredTextWidth: 600,
    horizontalPadding: 12,
    minimumWidth: 64,
    maximumWidth: 340,
});
assert.strictEqual(cappedRightGeometry.width, 340);
assert.strictEqual(cappedRightGeometry.x, 1460);

const chordLimitedGeometry = registeredLayout.getAutosizedPlateGeometry({
    geometry: { width: 88, innerEdge: 452 },
    side: -1,
    measuredTextWidth: 200,
    horizontalPadding: 12,
    minimumWidth: 64,
    maximumWidth: 340,
});
assert.strictEqual(chordLimitedGeometry.width, 88);
assert.strictEqual(chordLimitedGeometry.x, 364);

const laidOut = registeredLayout.layoutSide([
    { index: 0, desiredY: 100, labelHeight: 30, priority: 1 },
    { index: 1, desiredY: 105, labelHeight: 30, priority: 1 },
    { index: 2, desiredY: 110, labelHeight: 30, priority: 1 },
], 20, 220, 6);
assert.strictEqual(laidOut.length, 3);
for (let index = 1; index < laidOut.length; index += 1) {
    const previous = laidOut[index - 1];
    const item = laidOut[index];
    assert.ok(
        item.labelY - item.labelHeight / 2 >= previous.labelY + previous.labelHeight / 2 + 6,
        "Side plates must not overlap"
    );
}

// Wide screen: the whole side is usable. Square screen: only the corners past the circle's curve.
const bandsFor = (viewportWidth, viewportHeight, clockSize, options = {}) => registeredLayout.getSideBands({
    clockRect: {
        left: (viewportWidth - clockSize) / 2,
        right: (viewportWidth + clockSize) / 2,
        top: (viewportHeight - clockSize) / 2,
        width: clockSize,
        height: clockSize,
    },
    viewportWidth,
    viewportHeight,
    side: 1,
    fontSize: 22,
    minimumWidth: 120,
    ...options,
});
const wideBands = bandsFor(1920, 1080, 1044);
assert.strictEqual(wideBands.length, 1);
assert.ok(wideBands[0].full, "A wide gutter keeps one full-height band");
const squareBands = bandsFor(900, 900, 864);
assert.strictEqual(squareBands.length, 2, "A square screen still offers the top and bottom corners");
assert.ok(squareBands[0].top && squareBands[0].maxY < 450 && squareBands[1].minY > 450);
assert.strictEqual(bandsFor(900, 900, 864, { column: true }).length, 0, "Column plates cannot follow the curve");
assert.strictEqual(bandsFor(900, 900, 864, { minimumWidth: 900 }).length, 0);
assert.ok(registeredLayout.getMinimumPlateWidth(22, "mono") > registeredLayout.getMinimumPlateWidth(22, "engraved"));

assert.strictEqual(registeredLayout.getClosestArcMinutes(150, 100, 200, 720), 150);
assert.strictEqual(registeredLayout.getClosestArcMinutes(40, 100, 200, 720), 100);
assert.strictEqual(registeredLayout.getClosestArcMinutes(10, 690, 750, 720), 730);
assert.strictEqual(registeredLayout.getLabelFontWeight("glass"), 500);
assert.strictEqual(registeredLayout.getLabelFontWeight("ink"), 600);
assert.strictEqual(registeredLayout.getLabelFontWeight("glow"), 500);
assert.strictEqual(registeredLayout.getLabelFontWeight("color"), 600);
assert.strictEqual(registeredLayout.getLabelFontWeight("custom"), 500);

// Monospace-like measurement: 10px per character, so wrapping math is exact.
const measure = text => String(text).length * 10;
// The layout runs in a vm context, so compare arrays by value.
const wrapped = (title, width) => JSON.stringify([...registeredLayout.wrapTitle(title, width, 2, measure)]);
assert.strictEqual(wrapped("alpha beta gamma delta", 110), JSON.stringify(["alpha beta", "gamma delta"]));
assert.strictEqual(wrapped("alpha beta gamma delta epsilon zeta", 110), JSON.stringify(["alpha beta", "gamma delt…"]));
assert.strictEqual(wrapped("short", 110), JSON.stringify(["short"]));
assert.strictEqual(registeredLayout.fitWithEllipsis("abcdefghijkl", 60, measure), "abcde…");
assert.strictEqual(registeredLayout.fitWithEllipsis("abc", 60, measure), "abc");
assert.ok(registeredLayout.getPlateHeight(22, 2, "mono") > registeredLayout.getPlateHeight(22, 1, "mono"));
assert.ok(registeredLayout.getPlateHeight(22, 1, "engraved") < registeredLayout.getPlateHeight(22, 1, "mono"));
assert.strictEqual(JSON.stringify([...registeredLayout.variants]), JSON.stringify(["ledger", "mono", "engraved"]));
assert.strictEqual(registeredLayout.formatEventTime({ start: "09:30", end: "10:45" }), "09:30–10:45");
assert.strictEqual(registeredLayout.formatEventTime({ start: "11:00", end: "11:00", isPointEvent: true }), "11:00");
assert.ok(registeredLayout.getPlateHeight(22, 1, "ledger") > registeredLayout.getPlateHeight(22, 1, "engraved"));

const popupSource = fs.readFileSync(path.join(repoRoot, "src/clock/popup.html"), "utf8");
const appInitSource = fs.readFileSync(path.join(repoRoot, "src/clock/scripts/app-init.js"), "utf8");
const settingsTemplateSource = fs.readFileSync(
    path.join(repoRoot, "src/content/overlay/templates/root.html"),
    "utf8"
);
const sidePlateStylesSource = fs.readFileSync(
    path.join(repoRoot, "src/clock/event-label-layouts/side-plates/side-plates.css"),
    "utf8"
);
assert.match(popupSource, /scripts\/event-label-layout-registry\.js/);
assert.match(appInitSource, /loadEventLabelLayouts\(\)/);
[
    ["glass", "Frosted Glass"],
    ["ink", "Paper Tag"],
    ["glow", "Night Signal"],
    ["color", "Event Wash"],
    ["custom", "Custom Tint"],
].forEach(([value, label]) => {
    assert.match(
        settingsTemplateSource,
        new RegExp(`<option value="${value}">${label}</option>`),
        `${label} must be selectable in settings`
    );
});
// Flyout designs are neutral (ink/paper) and independent of the arc-label skins.
[
    ["mono", "Mono plate"],
    ["ledger", "Ledger rows"],
    ["engraved", "Engraved capitals"],
].forEach(([value, label]) => {
    assert.match(
        settingsTemplateSource,
        new RegExp(`<option value="${value}">${label}</option>`),
        `${label} must be selectable in settings`
    );
    assert.match(
        sidePlateStylesSource,
        new RegExp(`\\.time-side-plate--${value}`),
        `${label} must have flyout styling`
    );
});
assert.match(sidePlateStylesSource, /\[data-tone="dark"\]/, "dark-face ink must be defined");
assert.match(settingsTemplateSource, /data-cc-event-label-style-description/);
assert.match(settingsTemplateSource, /data-cc-event-label-placement/);
assert.match(settingsTemplateSource, /data-cc-event-label-flyout-variant/);

console.log("Side-plates layout verifier passed.");
