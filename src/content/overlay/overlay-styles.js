// Injects CSS for the Calendar Clock overlay, menu panel, debug/help panels, and draggable mini clock.
const CALENDAR_CLOCK_OVERLAY_STYLE_PATHS = Object.freeze([
  "src/content/overlay/styles/base-layout.css",
  "src/content/overlay/styles/controls-forms.css",
  "src/content/overlay/styles/visual-settings.css",
  "src/content/overlay/styles/surface-debug-help.css",
  "src/content/overlay/styles/dark-theme.css",
]);

function readCalendarClockOverlayStyle(path) {
  if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.getURL !== "function") {
    return "";
  }

  const request = new XMLHttpRequest();
  try {
    request.open("GET", chrome.runtime.getURL(path), false);
    request.send();
  } catch (error) {
    console.warn("Calendar Clock: failed to load overlay style module", path, error);
    return "";
  }

  if ((request.status >= 200 && request.status < 300) || (request.status === 0 && request.responseText)) {
    return request.responseText;
  }

  console.warn("Calendar Clock: overlay style module unavailable", path, request.status);
  return "";
}

function getCalendarClockOverlayStyles() {
  return CALENDAR_CLOCK_OVERLAY_STYLE_PATHS
    .map(readCalendarClockOverlayStyle)
    .filter(Boolean)
    .join("\n");
}

function ensureCalendarClockStyles() {
  if (document.getElementById("calendar-clock-overlay-styles")) return;

  const style = document.createElement("style");
  style.id = "calendar-clock-overlay-styles";
  style.textContent = getCalendarClockOverlayStyles();
  document.documentElement.appendChild(style);
}
