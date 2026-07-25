// Discovers the calendar-site adapter without making optional providers fatal.
(() => {
  const registry = globalThis.CalendarClockProviders;
  const hostname = String(location.hostname || "").toLowerCase();
  const definition = registry?.fromHostname?.(hostname);
  const loadingProvider = Object.freeze({
    ...(definition || {
      id: "unsupported",
      displayName: "Unsupported calendar",
      sourceId: "unavailable",
      supportsPageOwned: false
    }),
    enabled: definition?.id === "google"
  });

  globalThis.calendarClockProvider = loadingProvider;
  globalThis.getCalendarClockProvider = () => globalThis.calendarClockProvider || loadingProvider;

  const modulePath = String(definition?.contentAdapterModulePath || "");
  if (!modulePath) {
    globalThis.calendarClockProviderReady = Promise.resolve(loadingProvider);
    return;
  }

  globalThis.calendarClockProviderReady = import(chrome.runtime.getURL(
    modulePath
  )).then(module => {
    const provider = module.createCalendarClockProvider?.(definition);
    if (!provider || provider.id !== definition.id || typeof provider.readEventNode !== "function") {
      throw new Error(`${definition.displayName || definition.id} did not expose the provider contract.`);
    }
    globalThis.calendarClockProvider = Object.freeze({ ...provider, enabled: true });
    return globalThis.calendarClockProvider;
  }).catch(error => {
    console.warn(
      `[calen.clock.ext] ${definition.displayName || definition.id} provider is unavailable; skipping integration.`,
      error
    );
    return loadingProvider;
  });
})();
