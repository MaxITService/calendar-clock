// Installs optional provider parsers in MAIN world without relying on page script tags or CSP.
(() => {
  const MESSAGE_TYPE = "CALENDAR_CLOCK_INSTALL_MAIN_PROVIDER";
  const MODULE_PATH_PATTERN = /^src\/content\/[a-z0-9/-]+\.js$/;

  function getTrustedRequest(message, sender) {
    let senderUrl;
    try {
      senderUrl = new URL(sender?.url || sender?.tab?.url || "");
    } catch (_error) {
      return null;
    }
    const registry = globalThis.CalendarClockProviders;
    const provider = registry?.fromStructuredCaptureHostname?.(senderUrl.hostname);
    const requestedProvider = message?.providerId ? registry?.get?.(message.providerId) : provider;
    const modulePath = provider?.mainWorldModulePath;
    const dependencyPaths = Array.isArray(provider?.mainWorldDependencyPaths)
      ? Array.from(provider.mainWorldDependencyPaths)
      : [];
    const modulePaths = [...dependencyPaths, modulePath];
    if (!provider
        || requestedProvider?.id !== provider.id
        || senderUrl.protocol !== "https:"
        || modulePaths.length > 4
        || new Set(modulePaths).size !== modulePaths.length
        || modulePaths.some(path => !MODULE_PATH_PATTERN.test(path || "") || path.includes(".."))
        || !Number.isInteger(sender?.tab?.id)) {
      return null;
    }
    return {
      provider,
      modulePath,
      modulePaths,
      tabId: sender.tab.id,
      frameId: Number.isInteger(sender.frameId) ? sender.frameId : 0
    };
  }

  async function installProviderParser(request) {
    const packagedModules = await Promise.all(request.modulePaths.map(async modulePath => {
      const response = await fetch(chrome.runtime.getURL(modulePath), { cache: "no-store" });
      return response.ok;
    }));
    if (packagedModules.some(ok => !ok)) throw new Error("Optional provider parser is not packaged.");
    return chrome.scripting.executeScript({
      target: { tabId: request.tabId, frameIds: [request.frameId] },
      world: "MAIN",
      files: request.modulePaths,
      injectImmediately: true
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== MESSAGE_TYPE) return false;
    const request = getTrustedRequest(message, sender);
    if (!request) {
      sendResponse({ ok: false, error: "Untrusted provider parser request." });
      return false;
    }
    installProviderParser(request).then(
      results => sendResponse({
        ok: true,
        providerId: request.provider.id,
        structuredSourceId: request.provider.structuredSourceId,
        modulePath: request.modulePath,
        injectedFrames: Array.isArray(results) ? results.length : 0
      }),
      error => sendResponse({
        ok: false,
        error: String(error?.message || error || "Provider parser could not be installed.").slice(0, 200)
      })
    );
    return true;
  });

  globalThis.CalendarClockProviderMainWorldInstaller = Object.freeze({
    getTrustedRequest,
    installProviderParser
  });
})();
