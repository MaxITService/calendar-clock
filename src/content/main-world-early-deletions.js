// Runs synchronously in Calendar's MAIN world so Google cannot cache unobserved
// fetch/XHR methods before the optional structured-record module is ready.
(function initializeCalendarClockEarlyDeletions(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports && typeof process === "object" && process.versions?.node) {
    module.exports = api;
    return;
  }
  api.install(root);
})(globalThis, () => {
  const OBSERVER_SYMBOL_KEY = "calendarClock.earlyDeletionObserver.v1";
  const MAX_REQUEST_CHARS = 2 * 1024 * 1024;
  const MAX_DELETIONS = 200;

  function normalizeEventId(value) {
    return typeof value === "string" ? value.slice(0, 256).trim() : "";
  }

  function isCalendarSyncMutationRequest(url, method, baseUrl) {
    if (String(method || "GET").toUpperCase() !== "POST") return false;
    try {
      const parsed = new URL(url, baseUrl);
      return parsed.origin === "https://calendar.google.com"
        && /^\/calendar\/u\/\d+\/sync\.sync$/.test(parsed.pathname);
    } catch (_error) {
      return false;
    }
  }

  function extractDeletedEventIds(url, method, body, baseUrl) {
    if (!isCalendarSyncMutationRequest(url, method, baseUrl) || typeof body !== "string") return [];
    const rawRequest = new URLSearchParams(body).get("f.req");
    if (!rawRequest || rawRequest.length > MAX_REQUEST_CHARS) return [];

    let data;
    try {
      data = JSON.parse(rawRequest);
    } catch (_error) {
      return [];
    }

    const operations = data?.[0]?.[4];
    if (!Array.isArray(operations)) return [];
    return Array.from(new Set(operations.map(operation => {
      const eventStub = operation?.[2]?.[0]?.[1];
      const deletionPatch = eventStub?.[3]?.[0];
      const isDeletionPatch = Array.isArray(deletionPatch)
        && deletionPatch.length > 0
        && deletionPatch.every(value => value === null || (Array.isArray(value) && value.length === 0));
      if (!Array.isArray(eventStub)
          || eventStub.length !== 5
          || eventStub[1] !== null
          || eventStub[2] !== null
          || eventStub[4] !== 0
          || !isDeletionPatch) return "";
      return normalizeEventId(eventStub[0]);
    }).filter(Boolean))).slice(0, MAX_DELETIONS);
  }

  function requestBodyText(body) {
    if (typeof body === "string") return body;
    if (body instanceof URLSearchParams) return body.toString();
    const text = body?.toString?.();
    return typeof text === "string" ? text : "";
  }

  function install(scope) {
    if (!scope?.location || scope.location.origin !== "https://calendar.google.com") return null;
    const observerSymbol = Symbol.for(OBSERVER_SYMBOL_KEY);
    if (scope[observerSymbol]) return scope[observerSymbol];

    const subscribers = new Set();
    const pending = [];
    function publish(deletedIds, transport, url) {
      if (!deletedIds.length) return;
      let endpoint = "";
      try {
        endpoint = new URL(url, scope.location.href).pathname;
      } catch (_error) { /* exact request validation already failed closed */ }
      const message = Object.freeze({
        deletedIds: Object.freeze(deletedIds.slice()),
        transport,
        endpoint
      });
      if (!subscribers.size) {
        pending.push(message);
        while (pending.length > MAX_DELETIONS) pending.shift();
        return;
      }
      subscribers.forEach(listener => {
        try { listener(message); } catch (_error) { /* isolate optional consumers */ }
      });
    }

    const observer = Object.freeze({
      subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        subscribers.add(listener);
        pending.splice(0).forEach(message => {
          try { listener(message); } catch (_error) { /* isolate optional consumers */ }
        });
        return () => subscribers.delete(listener);
      }
    });
    Object.defineProperty(scope, observerSymbol, {
      value: observer,
      configurable: false,
      enumerable: false,
      writable: false
    });

    if (typeof scope.fetch === "function") {
      const fetchDescriptor = Object.getOwnPropertyDescriptor(scope, "fetch");
      const nativeFetch = scope.fetch;
      const wrappedFetch = new Proxy(nativeFetch, {
        apply(target, thisArg, argumentsList) {
          const input = argumentsList[0];
          const init = argumentsList[1];
          const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url || "";
          const method = init?.method || input?.method || "GET";
          let deletedIdsPromise = Promise.resolve([]);
          if (isCalendarSyncMutationRequest(url, method, scope.location.href) && init?.body !== undefined) {
            deletedIdsPromise = Promise.resolve(extractDeletedEventIds(
              url,
              method,
              requestBodyText(init.body),
              scope.location.href
            ));
          } else if (isCalendarSyncMutationRequest(url, method, scope.location.href)
              && input?.clone
              && typeof input.clone === "function") {
            try {
              deletedIdsPromise = input.clone().text()
                .then(body => extractDeletedEventIds(url, method, body, scope.location.href), () => []);
            } catch (_error) {
              deletedIdsPromise = Promise.resolve([]);
            }
          }
          const result = Reflect.apply(target, thisArg, argumentsList);
          Promise.resolve(result).then(response => {
            if (response?.ok !== true) return;
            deletedIdsPromise.then(ids => publish(ids, "early-fetch", url), () => {});
          }, () => {});
          return result;
        }
      });
      Object.defineProperty(scope, "fetch", fetchDescriptor ? { ...fetchDescriptor, value: wrappedFetch } : {
        value: wrappedFetch,
        configurable: true,
        writable: true
      });
    }

    const xhrPrototype = scope.XMLHttpRequest?.prototype;
    if (xhrPrototype) {
      const requests = new WeakMap();
      const observed = new WeakSet();
      const openDescriptor = Object.getOwnPropertyDescriptor(xhrPrototype, "open");
      const sendDescriptor = Object.getOwnPropertyDescriptor(xhrPrototype, "send");
      if (typeof openDescriptor?.value === "function") {
        const wrappedOpen = new Proxy(openDescriptor.value, {
          apply(target, thisArg, argumentsList) {
            requests.set(thisArg, {
              method: String(argumentsList[0] || "GET"),
              url: String(argumentsList[1] || ""),
              deletedIds: []
            });
            return Reflect.apply(target, thisArg, argumentsList);
          }
        });
        Object.defineProperty(xhrPrototype, "open", { ...openDescriptor, value: wrappedOpen });
      }
      if (typeof sendDescriptor?.value === "function") {
        const wrappedSend = new Proxy(sendDescriptor.value, {
          apply(target, thisArg, argumentsList) {
            const request = requests.get(thisArg) || { method: "GET", url: "", deletedIds: [] };
            request.deletedIds = extractDeletedEventIds(
              request.url,
              request.method,
              requestBodyText(argumentsList[0]),
              scope.location.href
            );
            requests.set(thisArg, request);
            if (!observed.has(thisArg)) {
              observed.add(thisArg);
              thisArg.addEventListener("loadend", () => {
                const completed = requests.get(thisArg) || request;
                const status = Number(thisArg.status) || 0;
                if (status >= 200 && status < 300) {
                  publish(completed.deletedIds || [], "early-xhr", completed.url);
                }
              });
            }
            return Reflect.apply(target, thisArg, argumentsList);
          }
        });
        Object.defineProperty(xhrPrototype, "send", { ...sendDescriptor, value: wrappedSend });
      }
    }

    return observer;
  }

  return {
    install,
    extractDeletedEventIds,
    isCalendarSyncMutationRequest,
    OBSERVER_SYMBOL_KEY
  };
});
