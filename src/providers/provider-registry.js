// Shared immutable metadata contract for supported calendar providers.
(() => {
  if (globalThis.CalendarClockProviders) return;

  const definitions = Object.freeze({
    google: Object.freeze({
      id: "google",
      displayName: "Google Calendar",
      hostname: "calendar.google.com",
      origin: "https://calendar.google.com",
      openUrl: "https://calendar.google.com/",
      sourceId: "google-calendar-dom",
      structuredSourceId: "google-page-owned",
      supportsPageOwned: true,
      usesPageLocalEffectiveFeed: false,
      contentAdapterModulePath: "",
      backgroundSnapshotModulePath: "",
      mainWorldDependencyPaths: Object.freeze([]),
      mainWorldModulePath: "src/content/page-owned-info/main-world-hook.js",
      structuredCaptureHostnames: Object.freeze([
        "calendar.google.com",
        "tasks.google.com"
      ]),
      eventsStorageKey: "calendarClockEvents",
      sourceStorageKey: "calendarClockSource"
    }),
    outlook: Object.freeze({
      id: "outlook",
      displayName: "Outlook Calendar",
      hostname: "outlook.live.com",
      origin: "https://outlook.live.com",
      openUrl: "https://outlook.live.com/calendar/view/workweek",
      sourceId: "outlook-calendar-dom",
      structuredSourceId: "outlook-page-owned",
      supportsPageOwned: true,
      usesPageLocalEffectiveFeed: true,
      contentAdapterModulePath: "src/content/providers/outlook/outlook-provider.mjs",
      backgroundSnapshotModulePath: "src/background/providers/outlook/outlook-snapshot.js",
      mainWorldDependencyPaths: Object.freeze([
        "src/content/providers/outlook/appearance/outlook-appearance-contract.js"
      ]),
      mainWorldModulePath: "src/content/providers/outlook/outlook-main-world-hook.js",
      structuredCaptureHostnames: Object.freeze([
        "outlook.live.com"
      ]),
      structuredResponsePaths: Object.freeze([
        "/owa/startupdata.ashx",
        "/owa/service.svc",
        "/owa/published/service.svc"
      ]),
      // Outlook sends calendar mutations and later views from a page worker.
      structuredWorkerCapture: true,
      // Adds rendered events that structured capture missed.
      structuredDomReconciliation: true,
      eventsStorageKey: "calendarClockOutlookEvents",
      canonicalEventsStorageKey: "calendarClockOutlookCanonicalEvents",
      presenceOverlayStorageKey: "calendarClockOutlookPresenceOverlay",
      sourceStorageKey: "calendarClockOutlookSource"
    })
  });

  function get(providerId) {
    return definitions[String(providerId || "").toLowerCase()] || null;
  }

  function fromHostname(hostname) {
    const normalizedHostname = String(hostname || "").toLowerCase();
    return Object.values(definitions).find(provider => provider.hostname === normalizedHostname) || null;
  }

  function fromStructuredCaptureHostname(hostname) {
    const normalizedHostname = String(hostname || "").toLowerCase();
    return Object.values(definitions).find(provider =>
      provider.structuredCaptureHostnames?.includes?.(normalizedHostname)
    ) || null;
  }

  function fromUrl(value) {
    try {
      return fromHostname(new URL(String(value || "")).hostname);
    } catch (_error) {
      return null;
    }
  }

  function matchesCalendarUrl(providerId, value) {
    return fromUrl(value)?.id === get(providerId)?.id;
  }

  globalThis.CalendarClockProviders = Object.freeze({
    get,
    fromHostname,
    fromStructuredCaptureHostname,
    fromUrl,
    matchesCalendarUrl,
    list: () => Object.values(definitions)
  });
})();
