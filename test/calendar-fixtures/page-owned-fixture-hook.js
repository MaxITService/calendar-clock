// Test-only MAIN-world hook for creating and deleting deterministic Calendar fixtures.
(function initializeCalendarClockFixtureHook(root, factory) {
  const library = factory();
  if (typeof module === "object" && module.exports && typeof process === "object" && process.versions?.node) {
    module.exports = library;
    return;
  }
  library.install(root);
})(globalThis, () => {
  const API_KEY = "__calendarClockFixtureHook";
  const FIXTURE_PREFIX = "[CC FIXTURE v1";
  const EVENT_ID_PATTERN = /^[0-9a-v]{20,64}$/;
  const SYNC_PATH_PATTERN = /^\/calendar\/u\/\d+\/sync\.sync$/;
  const MAX_BATCH_SIZE = 12;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function visit(value, callback, path = []) {
    callback(value, path);
    if (!Array.isArray(value)) return;
    value.forEach((item, index) => visit(item, callback, path.concat(index)));
  }

  function collectStrings(value) {
    const strings = [];
    visit(value, item => {
      if (typeof item === "string") strings.push(item);
    });
    return strings;
  }

  function collectEpochMilliseconds(value) {
    const timestamps = [];
    visit(value, item => {
      if (Number.isInteger(item) && item >= 946684800000 && item <= 4102444800000) timestamps.push(item);
    });
    return Array.from(new Set(timestamps)).sort((a, b) => a - b);
  }

  function replaceExact(value, replacements) {
    if (Array.isArray(value)) return value.map(item => replaceExact(item, replacements));
    return replacements.has(value) ? replacements.get(value) : value;
  }

  function getCreateOperation(data, fixtureOnly = false) {
    const operations = data?.[0]?.[4];
    if (!Array.isArray(operations)) return null;
    return operations.find(operation => {
      if (operation?.[0] !== 7) return false;
      if (!fixtureOnly) return true;
      return collectStrings(operation?.[2]?.[0]?.[2]).some(value => value.startsWith(FIXTURE_PREFIX));
    }) || null;
  }

  function getDeleteOperation(data) {
    const operations = data?.[0]?.[4];
    return Array.isArray(operations) ? operations.find(operation => operation?.[0] === 11) || null : null;
  }

  function getCreateEventResource(operation) {
    const event = operation?.[2]?.[0]?.[2];
    const strings = collectStrings(event);
    const timestamps = collectEpochMilliseconds(event);
    if (!Array.isArray(event)
        || !EVENT_ID_PATTERN.test(String(event[0] || ""))
        || !strings.some(value => value.startsWith(FIXTURE_PREFIX))
        || timestamps.length !== 2) {
      throw new Error("Calendar create mutation schema changed; fixture operation aborted.");
    }
    return event;
  }

  function getDeleteEventId(operation) {
    const eventId = operation?.[2]?.[0]?.[1]?.[0];
    if (!EVENT_ID_PATTERN.test(String(eventId || ""))) {
      throw new Error("Calendar delete mutation schema changed; fixture operation aborted.");
    }
    return eventId;
  }

  function parseSyncMutationRequest(url, method, body, baseUrl = "https://calendar.google.com/") {
    if (String(method || "GET").toUpperCase() !== "POST" || typeof body !== "string") return null;
    let parsedUrl;
    try {
      parsedUrl = new URL(url, baseUrl);
    } catch (_error) {
      return null;
    }
    if (parsedUrl.origin !== new URL(baseUrl).origin || !SYNC_PATH_PATTERN.test(parsedUrl.pathname)) return null;

    const form = new URLSearchParams(body);
    const rawRequest = form.get("f.req");
    if (!rawRequest) return null;

    let data;
    try {
      data = JSON.parse(rawRequest);
    } catch (_error) {
      return null;
    }

    const createOperation = getCreateOperation(data, true);
    const deleteOperation = getDeleteOperation(data);
    if (!createOperation && !deleteOperation) return null;

    if (createOperation) getCreateEventResource(createOperation);
    if (deleteOperation) getDeleteEventId(deleteOperation);
    return {
      url: parsedUrl.href,
      formEntries: Array.from(form.entries()),
      data,
      kind: createOperation ? "create" : "delete"
    };
  }

  function validateFixture(fixture) {
    if (!fixture || typeof fixture !== "object") throw new Error("Invalid fixture record.");
    if (!String(fixture.title || "").startsWith(FIXTURE_PREFIX)) throw new Error("Fixture title marker is missing.");
    if (!Number.isInteger(fixture.startMs) || !Number.isInteger(fixture.endMs) || fixture.endMs <= fixture.startMs) {
      throw new Error(`Invalid fixture time range: ${fixture.title || "unknown"}`);
    }
  }

  function makeEventId(randomValues) {
    const alphabet = "0123456789abcdefghijklmnopqrstuv";
    const bytes = new Uint8Array(26);
    randomValues(bytes);
    return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
  }

  function buildCreateBatch(template, fixtures, randomValues) {
    if (!template || template.kind !== "create") throw new Error("Fresh Calendar create template is unavailable.");
    if (!Array.isArray(fixtures) || fixtures.length < 1 || fixtures.length > MAX_BATCH_SIZE) {
      throw new Error(`Create batch must contain 1-${MAX_BATCH_SIZE} fixtures.`);
    }
    fixtures.forEach(validateFixture);

    const data = clone(template.data);
    const baseOperation = getCreateOperation(data);
    const baseEvent = getCreateEventResource(baseOperation);
    const baseTitle = collectStrings(baseEvent).find(value => value.startsWith(FIXTURE_PREFIX));
    const [baseStartMs, baseEndMs] = collectEpochMilliseconds(baseEvent);
    const baseEventId = baseEvent[0];
    const baseSequence = Number(baseOperation[5]);
    const baseMetadata = Array.isArray(data?.[0]?.[9]) && data[0][9].length ? data[0][9][0] : null;
    if (!baseTitle || !Number.isInteger(baseSequence) || !Array.isArray(baseMetadata)) {
      throw new Error("Calendar create mutation metadata changed; fixture operation aborted.");
    }

    data[0][4] = fixtures.map((fixture, index) => {
      const sequence = baseSequence + index + 1;
      const replacements = new Map([
        [baseEventId, makeEventId(randomValues)],
        [baseTitle, fixture.title],
        [baseStartMs, fixture.startMs],
        [baseEndMs, fixture.endMs]
      ]);
      const operation = replaceExact(baseOperation, replacements);
      operation[5] = sequence;
      return operation;
    });
    data[0][9] = fixtures.map((_fixture, index) => {
      const metadata = clone(baseMetadata);
      metadata[1] = baseSequence + index + 1;
      return metadata;
    });
    return data;
  }

  function buildDeleteBatch(template, eventIds) {
    if (!template || template.kind !== "delete") throw new Error("Fresh Calendar delete template is unavailable.");
    if (!Array.isArray(eventIds) || eventIds.length < 1 || eventIds.length > MAX_BATCH_SIZE) {
      throw new Error(`Delete batch must contain 1-${MAX_BATCH_SIZE} fixture IDs.`);
    }
    eventIds.forEach(eventId => {
      if (!EVENT_ID_PATTERN.test(String(eventId || ""))) throw new Error("Unsafe Calendar event ID; delete aborted.");
    });

    const data = clone(template.data);
    const baseOperation = getDeleteOperation(data);
    const baseEventId = getDeleteEventId(baseOperation);
    const baseSequence = Number(baseOperation[5]);
    const baseMetadata = Array.isArray(data?.[0]?.[9]) && data[0][9].length ? data[0][9][0] : null;
    if (!Number.isInteger(baseSequence) || !Array.isArray(baseMetadata)) {
      throw new Error("Calendar delete mutation metadata changed; fixture operation aborted.");
    }

    data[0][4] = eventIds.map((eventId, index) => {
      const sequence = baseSequence + index + 1;
      const operation = replaceExact(baseOperation, new Map([[baseEventId, eventId]]));
      operation[5] = sequence;
      return operation;
    });
    data[0][9] = eventIds.map((_eventId, index) => {
      const metadata = clone(baseMetadata);
      metadata[1] = baseSequence + index + 1;
      return metadata;
    });
    return data;
  }

  function encodeTemplateRequest(template, data) {
    const form = new URLSearchParams(template.formEntries);
    form.set("f.req", JSON.stringify(data));
    return form.toString();
  }

  function decodeDomEventId(value) {
    const raw = String(value || "").trim().replace(/^ttb_/, "");
    if (!raw) return "";
    try {
      const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
      const decoded = atob(padded).trim().split(/\s+/)[0];
      return EVENT_ID_PATTERN.test(decoded) ? decoded : "";
    } catch (_error) {
      return EVENT_ID_PATTERN.test(raw) ? raw : "";
    }
  }

  function install(scope) {
    if (!scope?.document || typeof scope.fetch !== "function" || !scope.XMLHttpRequest) return null;
    if (scope[API_KEY]) return scope[API_KEY];

    const nativeFetch = scope.fetch;
    const xhrPrototype = scope.XMLHttpRequest.prototype;
    const nativeOpen = xhrPrototype.open;
    const nativeSend = xhrPrototype.send;
    const xhrRequests = new WeakMap();
    const state = { createTemplate: null, deleteTemplate: null, captures: 0 };

    function capture(url, method, body) {
      let parsed;
      try {
        parsed = parseSyncMutationRequest(url, method, typeof body === "string" ? body : body?.toString?.(), scope.location.href);
      } catch (error) {
        state.lastError = String(error?.message || error);
        return;
      }
      if (!parsed) return;
      if (parsed.kind === "create") state.createTemplate = parsed;
      if (parsed.kind === "delete") state.deleteTemplate = parsed;
      state.captures += 1;
    }

    function wrappedFetch(input, init) {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      const method = init?.method || input?.method || "GET";
      if (init?.body !== undefined) {
        capture(url, method, init.body);
      } else if (input?.clone && typeof input.clone === "function") {
        try {
          input.clone().text().then(body => capture(url, method, body), () => {});
        } catch (_error) {
          // A consumed Request cannot be cloned; the mutation will fail closed as uncaptured.
        }
      }
      return Reflect.apply(nativeFetch, this, arguments);
    }
    Object.setPrototypeOf(wrappedFetch, Object.getPrototypeOf(nativeFetch));
    Object.defineProperty(scope, "fetch", { configurable: true, writable: true, value: wrappedFetch });

    xhrPrototype.open = function wrappedOpen(method, url) {
      xhrRequests.set(this, { method, url });
      return Reflect.apply(nativeOpen, this, arguments);
    };
    xhrPrototype.send = function wrappedSend(body) {
      const request = xhrRequests.get(this);
      if (request) capture(request.url, request.method, body);
      return Reflect.apply(nativeSend, this, arguments);
    };

    async function send(template, data) {
      const response = await Reflect.apply(nativeFetch, scope, [template.url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: encodeTemplateRequest(template, data)
      }]);
      const text = await response.text();
      if (!response.ok) throw new Error(`Calendar sync mutation failed with HTTP ${response.status}.`);
      return { status: response.status, responseLength: text.length };
    }

    const api = {
      version: 1,
      status() {
        return {
          captures: state.captures,
          hasCreateTemplate: Boolean(state.createTemplate),
          hasDeleteTemplate: Boolean(state.deleteTemplate),
          lastError: state.lastError || ""
        };
      },
      clearTemplates() {
        state.createTemplate = null;
        state.deleteTemplate = null;
        state.lastError = "";
      },
      async createFromCapturedTemplate(fixtures) {
        const data = buildCreateBatch(state.createTemplate, fixtures, bytes => scope.crypto.getRandomValues(bytes));
        return send(state.createTemplate, data);
      },
      async deleteFromCapturedTemplate(eventIds) {
        const data = buildDeleteBatch(state.deleteTemplate, eventIds);
        return send(state.deleteTemplate, data);
      },
      async deleteFromTemplateRequest(template, eventIds) {
        const data = buildDeleteBatch(template, eventIds);
        return send(template, data);
      },
      listDomFixtures(prefix) {
        const results = new Map();
        scope.document.querySelectorAll("[data-eventid], [data-eid]").forEach(node => {
          const text = `${node.getAttribute("aria-label") || ""} ${node.textContent || ""}`.trim();
          if (!text.includes(prefix)) return;
          const rawId = node.getAttribute("data-eventid") || node.getAttribute("data-eid") || "";
          const eventId = decodeDomEventId(rawId);
          const rect = node.getBoundingClientRect();
          if (eventId && rect.width > 0 && rect.height > 0 && !results.has(eventId)) {
            results.set(eventId, {
              eventId,
              rawId,
              text: text.slice(0, 300)
            });
          }
        });
        return Array.from(results.values());
      }
    };
    scope[API_KEY] = api;
    return api;
  }

  return {
    install,
    parseSyncMutationRequest,
    buildCreateBatch,
    buildDeleteBatch,
    decodeDomEventId,
    FIXTURE_PREFIX,
    MAX_BATCH_SIZE
  };
});
