(() => {
  "use strict";
  const DB_NAME = "calendar-clock-audio";
  const STORE_NAME = "sounds";
  const SOUND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function requireSoundId(value) {
    if (typeof value !== "string" || !SOUND_ID_PATTERN.test(value)) throw new Error("Invalid custom sound ID.");
    return value.toLowerCase();
  }

  function isValidRecord(record, key) {
    return Boolean(record)
      && record.soundId === key
      && typeof record.soundId === "string"
      && SOUND_ID_PATTERN.test(record.soundId)
      && record.blob instanceof Blob
      && typeof record.createdAt === "number"
      && Number.isFinite(record.createdAt)
      && record.createdAt >= 0;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Audio storage could not be opened."));
      request.onblocked = () => reject(new Error("Audio storage is blocked by another Calendar Clock page."));
    });
  }

  async function transact(mode, action) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = action(transaction.objectStore(STORE_NAME));
        let result = null;
        request.onsuccess = () => { result = request.result ?? null; };
        request.onerror = () => reject(request.error || transaction.error || new Error("Audio storage request failed."));
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(transaction.error || new Error("Audio storage request was cancelled."));
      });
    } finally {
      database.close();
    }
  }

  async function listDescriptors() {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const descriptors = [];
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          if (isValidRecord(cursor.value, cursor.key)) {
            descriptors.push({ soundId: cursor.value.soundId, createdAt: cursor.value.createdAt });
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error || transaction.error || new Error("Audio storage listing failed."));
        transaction.oncomplete = () => resolve(descriptors);
        transaction.onabort = () => reject(transaction.error || new Error("Audio storage listing was cancelled."));
      });
    } finally {
      database.close();
    }
  }

  async function handle(message) {
    if (message?.action === "list") return listDescriptors();
    const soundId = requireSoundId(message?.soundId);
    if (message?.action === "get") {
      const record = await transact("readonly", store => store.get(soundId));
      return isValidRecord(record, soundId) ? record.blob : null;
    }
    if (message?.action === "put" && message.blob instanceof Blob) {
      await transact("readwrite", store => store.put({ soundId, blob: message.blob, createdAt: Date.now() }, soundId));
      return true;
    }
    if (message?.action === "delete") {
      await transact("readwrite", store => store.delete(soundId));
      return true;
    }
    throw new Error("Unknown audio storage request.");
  }

  let connected = false;
  window.addEventListener("message", event => {
    if (connected) return;
    if (event.source !== parent || event.data?.type !== "CALENDAR_CLOCK_AUDIO_STORAGE_CONNECT" || !event.ports?.[0]) return;
    const port = event.ports[0];
    chrome.runtime.sendMessage({
      type: "CALENDAR_CLOCK_VALIDATE_AUDIO_BRIDGE_TOKEN",
      token: event.data.token
    }, response => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError || response?.ok !== true) {
        port.postMessage({
          type: "CALENDAR_CLOCK_AUDIO_STORAGE_ACK",
          ok: false,
          error: runtimeError?.message || "Audio storage authentication failed."
        });
        port.close();
        return;
      }
      connected = true;
      port.onmessage = async portEvent => {
        const { requestId } = portEvent.data || {};
        try {
          const value = await handle(portEvent.data);
          port.postMessage({ requestId, ok: true, value });
        } catch (error) {
          port.postMessage({ requestId, ok: false, error: String(error?.message || error) });
        }
      };
      port.start();
      port.postMessage({ type: "CALENDAR_CLOCK_AUDIO_STORAGE_ACK", ok: true });
    });
  });
  parent.postMessage({ type: "CALENDAR_CLOCK_AUDIO_STORAGE_READY" }, "*");
})();
