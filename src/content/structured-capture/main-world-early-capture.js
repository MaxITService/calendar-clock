// Captures bounded structured responses before a dynamically loaded provider parser is ready.
(() => {
  const registry = globalThis.CalendarClockProviders;
  const provider = registry?.fromHostname?.(location.hostname);
  const responsePaths = new Set(provider?.structuredResponsePaths || []);
  if (!provider?.supportsPageOwned || !responsePaths.size) return;

  const marker = Symbol.for(`calendarClock.earlyStructuredCapture.${provider.id}.v1`);
  if (window[marker]) return;
  Object.defineProperty(window, marker, { value: true, configurable: false });

  const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
  const MAX_BUFFERED_RESPONSES = 16;
  const MAX_WORKER_BLOB_BYTES = 1024 * 1024;
  const MAX_TRACKED_BLOBS = 64;
  const bufferedResponses = [];
  const listeners = new Set();
  const captureConfig = Object.freeze({
    origin: provider.origin,
    paths: Array.from(responsePaths),
    maxChars: MAX_RESPONSE_CHARS
  });

  // Serialized into page workers, so it must stay self-contained.
  function installStructuredNetworkCapture(scope, config, emit) {
    const XHR_REQUEST = Symbol("calendarClock.structuredCaptureRequest");
    const MAX_REQUEST_CHARS = 256 * 1024;
    const paths = new Set(config.paths);
    // Blob workers have an opaque base URL, so resolve relative requests against the provider origin.
    const baseUrl = /^https?:/.test(String(scope.location?.href)) ? scope.location.href : `${config.origin}/`;
    let lastSequence = 0;

    function nextSequence() {
      const origin = Number(scope.performance?.timeOrigin) || 0;
      const now = origin + (Number(scope.performance?.now?.()) || 0) || Date.now();
      lastSequence = Math.max(now, lastSequence + 0.001);
      return lastSequence;
    }

    function isRelevantUrl(value) {
      try {
        const url = new URL(value, baseUrl);
        return url.origin === config.origin && paths.has(url.pathname);
      } catch (_error) {
        return false;
      }
    }

    // Some endpoints send their JSON request body URL-encoded in a header.
    function readJsonHeader(value) {
      const text = String(value || "");
      if (text.length < 2 || text.length > MAX_REQUEST_CHARS) return "";
      try {
        const decoded = /^%7B/i.test(text) ? decodeURIComponent(text) : text;
        if (!decoded.startsWith("{")) return "";
        JSON.parse(decoded);
        return decoded;
      } catch (_error) {
        return "";
      }
    }

    function readRequestHeaders(headers) {
      if (!headers) return "";
      let found = "";
      try {
        const entries = typeof headers.forEach === "function" && !Array.isArray(headers)
          ? (() => { const list = []; headers.forEach((value, key) => list.push([key, value])); return list; })()
          : Array.isArray(headers) ? headers : Object.entries(headers);
        entries.some(([, value]) => {
          found = readJsonHeader(value);
          return Boolean(found);
        });
      } catch (_error) {
        return "";
      }
      return found;
    }

    function readBodyText(body) {
      return typeof body === "string" && body.length <= MAX_REQUEST_CHARS ? body : "";
    }

    function capture(text, url, transport, request) {
      if (typeof text !== "string" || text.length > config.maxChars || !isRelevantUrl(url)) return;
      emit({
        text,
        url: new URL(url, baseUrl).href,
        transport,
        requestSequence: request.sequence,
        requestText: request.requestText || "",
        ok: request.ok !== false
      });
    }

    const nativeFetch = scope.fetch;
    if (typeof nativeFetch === "function") {
      scope.fetch = async function calendarClockStructuredFetch(...args) {
        const input = args[0];
        const init = args[1] || {};
        const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url || "";
        const sequence = nextSequence();
        let requestText = "";
        let requestClone = null;
        if (isRelevantUrl(requestUrl)) {
          requestText = readBodyText(init.body)
            || readRequestHeaders(init.headers)
            || readRequestHeaders(input?.headers);
          if (!requestText && init.body === undefined && typeof input?.clone === "function") {
            try { requestClone = input.clone(); } catch (_error) { requestClone = null; }
          }
        }
        const response = await Reflect.apply(nativeFetch, this, args);
        const url = response?.url || requestUrl;
        if (response && isRelevantUrl(url)) {
          const length = Number(response.headers?.get?.("content-length"));
          if (!Number.isFinite(length) || length <= config.maxChars) {
            try {
              Promise.all([
                response.clone().text(),
                requestClone ? requestClone.text().then(readBodyText, () => "") : requestText
              ]).then(
                ([text, bodyText]) => capture(text, url, "fetch", {
                  sequence,
                  requestText: bodyText || requestText,
                  ok: response.ok
                }),
                () => {}
              );
            } catch (_error) {
              // An unreadable response clone fails closed.
            }
          }
        }
        return response;
      };
    }

    const xhrPrototype = scope.XMLHttpRequest?.prototype;
    if (xhrPrototype) {
      const nativeOpen = xhrPrototype.open;
      const nativeSend = xhrPrototype.send;
      const nativeSetRequestHeader = xhrPrototype.setRequestHeader;
      xhrPrototype.open = function calendarClockStructuredOpen(method, url, ...rest) {
        this[XHR_REQUEST] = { url: String(url || ""), sequence: nextSequence(), requestText: "" };
        return Reflect.apply(nativeOpen, this, [method, url, ...rest]);
      };
      xhrPrototype.setRequestHeader = function calendarClockStructuredSetRequestHeader(name, value) {
        const request = this[XHR_REQUEST];
        if (request && !request.requestText && isRelevantUrl(request.url)) request.requestText = readJsonHeader(value);
        return Reflect.apply(nativeSetRequestHeader, this, [name, value]);
      };
      xhrPrototype.send = function calendarClockStructuredSend(...args) {
        const request = this[XHR_REQUEST] || { url: "", sequence: nextSequence(), requestText: "" };
        this[XHR_REQUEST] = request;
        if (!request.requestText) request.requestText = readBodyText(args[0]);
        this.addEventListener("load", () => {
          const url = this.responseURL || request.url || "";
          if (!isRelevantUrl(url)) return;
          const status = Number(this.status) || 0;
          const metadata = { ...request, ok: status >= 200 && status < 300 };
          try {
            if (this.responseType === "" || this.responseType === "text") {
              capture(this.responseText, url, "xhr", metadata);
            } else if (this.responseType === "json") {
              capture(JSON.stringify(this.response), url, "xhr", metadata);
            }
          } catch (_error) {
            // Cross-origin or unsupported response types fail closed.
          }
        }, { once: true });
        return Reflect.apply(nativeSend, this, args);
      };
    }

    return isRelevantUrl;
  }

  // Serialized into page workers: relays captures over a private port.
  function createWorkerCaptureEmitter(scope, token) {
    let port = null;
    const queue = [];
    scope.addEventListener("message", event => {
      if (port || event?.data?.calendarClockWorkerCapture !== token || !event.ports?.[0]) return;
      event.stopImmediatePropagation();
      port = event.ports[0];
      queue.splice(0).forEach(item => port.postMessage(item));
    });
    const emit = item => {
      if (port) port.postMessage(item);
      else if (queue.length < 32) queue.push(item);
    };
    emit({ kind: "hello" });
    return response => emit({ kind: "response", response });
  }

  function deliver(response) {
    if (!listeners.size) {
      bufferedResponses.push(response);
      while (bufferedResponses.length > MAX_BUFFERED_RESPONSES) bufferedResponses.shift();
      return;
    }
    listeners.forEach(listener => {
      try {
        listener(response);
      } catch (_error) {
        // Provider parsers are isolated from the network interception path.
      }
    });
  }

  function deliverCapture(response) {
    deliver(Object.freeze({
      providerId: provider.id,
      text: response.text,
      url: response.url,
      transport: response.transport,
      requestSequence: Math.max(0, Number(response.requestSequence) || 0),
      requestText: typeof response.requestText === "string" ? response.requestText : "",
      ok: response.ok !== false
    }));
  }

  const isRelevantUrl = installStructuredNetworkCapture(window, captureConfig, deliverCapture);

  const workerStatus = {
    state: provider.structuredWorkerCapture === true ? "waiting" : "disabled",
    wrapped: 0,
    active: 0,
    skipped: 0,
    responses: 0,
    reason: ""
  };

  // Page workers may own the calendar data layer; wrap them so their responses are observed too.
  function installWorkerCapture() {
    const NativeWorker = window.Worker;
    if (typeof NativeWorker !== "function") {
      workerStatus.state = "unavailable";
      workerStatus.reason = "Worker is unavailable";
      return;
    }
    const nativeCreateObjectURL = URL.createObjectURL;
    const nativeRevokeObjectURL = URL.revokeObjectURL;
    const blobsByUrl = new Map();
    const pageScriptUrlPolicies = [];
    let ownScriptUrlPolicy = null;

    URL.createObjectURL = function calendarClockCreateObjectURL(object) {
      const url = Reflect.apply(nativeCreateObjectURL, URL, [object]);
      if (object instanceof Blob && object.size <= MAX_WORKER_BLOB_BYTES) {
        blobsByUrl.set(url, object);
        while (blobsByUrl.size > MAX_TRACKED_BLOBS) blobsByUrl.delete(blobsByUrl.keys().next().value);
      }
      return url;
    };
    URL.revokeObjectURL = function calendarClockRevokeObjectURL(url) {
      blobsByUrl.delete(String(url));
      return Reflect.apply(nativeRevokeObjectURL, URL, [url]);
    };

    const trustedTypes = window.trustedTypes;
    if (typeof trustedTypes?.createPolicy === "function") {
      const nativeCreatePolicy = trustedTypes.createPolicy;
      trustedTypes.createPolicy = function calendarClockCreatePolicy(name, rules, ...rest) {
        const policy = Reflect.apply(nativeCreatePolicy, this, [name, rules, ...rest]);
        if (typeof rules?.createScriptURL === "function" && pageScriptUrlPolicies.length < 32) {
          pageScriptUrlPolicies.push({ name: String(name), policy });
        }
        return policy;
      };
    }

    function prioritizedPolicies() {
      return pageScriptUrlPolicies.slice().sort((left, right) =>
        Number(/worker/i.test(right.name)) - Number(/worker/i.test(left.name))
      );
    }

    // Reuse a page policy that passes our blob URL through unchanged; otherwise try a duplicate of an allowed name.
    function toTrustedScriptUrl(url) {
      if (ownScriptUrlPolicy) return ownScriptUrlPolicy.createScriptURL(url);
      for (const { policy } of prioritizedPolicies()) {
        try {
          const trusted = policy.createScriptURL(url);
          if (String(trusted) === url) return trusted;
        } catch (_error) {
          // Try the next policy.
        }
      }
      for (const { name } of prioritizedPolicies()) {
        try {
          ownScriptUrlPolicy = trustedTypes.createPolicy(name, { createScriptURL: value => value });
          return ownScriptUrlPolicy.createScriptURL(url);
        } catch (_error) {
          ownScriptUrlPolicy = null;
        }
      }
      return null;
    }

    function makeWorkerSource(scriptUrl, options, token) {
      const isTrusted = typeof window.TrustedScriptURL === "function" && scriptUrl instanceof window.TrustedScriptURL;
      const isModule = options?.type === "module";
      const url = new URL(String(scriptUrl), location.href);
      const prelude = `(${installStructuredNetworkCapture})(self, ${JSON.stringify(captureConfig)}, `
        + `(${createWorkerCaptureEmitter})(self, ${JSON.stringify(token)}));\n`;
      if (url.protocol === "blob:") {
        const blob = blobsByUrl.get(url.href);
        return blob ? { parts: [prelude, blob], isTrusted } : null;
      }
      // Loading another script from inside the worker would need a worker-side Trusted Types policy.
      if (isTrusted || !/^https?:$/.test(url.protocol)) return null;
      return {
        parts: [prelude, isModule ? `await import(${JSON.stringify(url.href)});\n` : `importScripts(${JSON.stringify(url.href)});\n`],
        isTrusted
      };
    }

    function connectWorker(worker, token, blobUrl) {
      const channel = new MessageChannel();
      let revoked = false;
      const revoke = () => {
        if (revoked) return;
        revoked = true;
        Reflect.apply(nativeRevokeObjectURL, URL, [blobUrl]);
      };
      setTimeout(revoke, 30000);
      channel.port1.onmessage = event => {
        const message = event.data;
        if (message?.kind === "hello") {
          revoke();
          workerStatus.active += 1;
          workerStatus.state = "active";
          return;
        }
        const response = message?.kind === "response" ? message.response : null;
        if (!response
            || typeof response.text !== "string"
            || response.text.length > MAX_RESPONSE_CHARS
            || !isRelevantUrl(response.url)) return;
        workerStatus.responses += 1;
        deliverCapture({ ...response, transport: `worker-${String(response.transport || "").slice(0, 10)}` });
      };
      worker.postMessage({ calendarClockWorkerCapture: token }, [channel.port2]);
    }

    function markSkipped(reason) {
      workerStatus.skipped += 1;
      workerStatus.reason = reason;
      if (!workerStatus.wrapped) workerStatus.state = "unavailable";
    }

    window.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        const [scriptUrl, options] = args;
        let blobUrl = "";
        try {
          const token = crypto.randomUUID();
          const source = makeWorkerSource(scriptUrl, options, token);
          if (!source) {
            markSkipped("worker script source is not observable");
            return Reflect.construct(target, args, newTarget);
          }
          blobUrl = Reflect.apply(nativeCreateObjectURL, URL, [new Blob(source.parts, { type: "text/javascript" })]);
          const workerUrl = source.isTrusted ? toTrustedScriptUrl(blobUrl) : blobUrl;
          if (!workerUrl) throw new Error("no Trusted Types policy accepts the capture worker URL");
          const worker = Reflect.construct(target, [workerUrl, options], newTarget);
          workerStatus.wrapped += 1;
          if (workerStatus.state !== "active") workerStatus.state = "starting";
          connectWorker(worker, token, blobUrl);
          return worker;
        } catch (error) {
          if (blobUrl) Reflect.apply(nativeRevokeObjectURL, URL, [blobUrl]);
          markSkipped(String(error?.message || error).slice(0, 160));
          return Reflect.construct(target, args, newTarget);
        }
      }
    });
  }

  if (provider.structuredWorkerCapture === true) {
    try {
      installWorkerCapture();
    } catch (error) {
      workerStatus.state = "unavailable";
      workerStatus.reason = String(error?.message || error).slice(0, 160);
    }
  }

  const api = Object.freeze({
    drain(providerId) {
      if (providerId !== provider.id) return [];
      return bufferedResponses.splice(0, bufferedResponses.length);
    },
    subscribe(providerId, listener) {
      if (providerId !== provider.id || typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getWorkerStatus: () => ({ ...workerStatus }),
    isRelevantUrl
  });
  Object.defineProperty(window, "CalendarClockEarlyStructuredCapture", {
    value: api,
    configurable: false,
    writable: false
  });
})();
