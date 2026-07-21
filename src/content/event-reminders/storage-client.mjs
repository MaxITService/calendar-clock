import { isValidSoundId } from "./helpers.mjs";

export class AudioStorageClient {
  constructor({ document, window, runtime }) {
    this.document = document;
    this.window = window;
    this.runtime = runtime;
    this.origin = new URL(runtime.getURL("")).origin;
    this.pending = new Map();
    this.nextId = 1;
    this.port = null;
    this.iframe = null;
    this.readyPromise = null;
  }

  connect() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = this.#requestBridgeToken().then(token => new Promise((resolve, reject) => {
      const iframe = this.document.createElement("iframe");
      this.iframe = iframe;
      iframe.hidden = true;
      iframe.setAttribute("aria-hidden", "true");
      iframe.src = this.runtime.getURL("src/content/event-reminders/storage-frame.html");
      const timeout = this.window.setTimeout(() => finish(new Error("Audio storage did not become ready.")), 5000);
      const onMessage = event => {
        if (event.source !== iframe.contentWindow || event.origin !== this.origin || event.data?.type !== "CALENDAR_CLOCK_AUDIO_STORAGE_READY") return;
        const channel = new MessageChannel();
        this.port = channel.port1;
        this.port.onmessage = portEvent => {
          if (portEvent.data?.type === "CALENDAR_CLOCK_AUDIO_STORAGE_ACK") {
            finish(portEvent.data.ok === true ? null : new Error(portEvent.data.error || "Audio storage authentication failed."));
            return;
          }
          this.#receive(portEvent.data);
        };
        this.port.start();
        iframe.contentWindow.postMessage({ type: "CALENDAR_CLOCK_AUDIO_STORAGE_CONNECT", token }, this.origin, [channel.port2]);
      };
      const finish = error => {
        this.window.clearTimeout(timeout);
        this.window.removeEventListener("message", onMessage);
        if (error) {
          this.port?.close();
          this.port = null;
          iframe.remove();
          reject(error);
        } else resolve(this);
      };
      this.window.addEventListener("message", onMessage);
      iframe.addEventListener("error", () => finish(new Error("Audio storage frame could not be loaded.")), { once: true });
      this.document.documentElement.appendChild(iframe);
    })).catch(error => {
      this.readyPromise = null;
      this.iframe?.remove();
      this.iframe = null;
      throw error;
    });
    return this.readyPromise;
  }

  #requestBridgeToken() {
    return new Promise((resolve, reject) => {
      try {
        this.runtime.sendMessage({ type: "CALENDAR_CLOCK_CREATE_AUDIO_BRIDGE_TOKEN" }, response => {
          const runtimeError = this.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          if (response?.ok === true && /^[a-f0-9]{64}$/.test(response.token || "")) {
            resolve(response.token);
            return;
          }
          reject(new Error(response?.error || "Audio storage authentication token was rejected."));
        });
      } catch (error) { reject(error); }
    });
  }

  async request(action, soundId = null, blob = null) {
    if (action !== "list" && !isValidSoundId(soundId)) throw new Error("Invalid custom sound ID.");
    if (!new Set(["get", "put", "delete", "list"]).has(action)) throw new Error("Invalid audio storage action.");
    await this.connect();
    return new Promise((resolve, reject) => {
      const requestId = this.nextId++;
      const timeout = this.window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Audio storage request timed out."));
      }, 5000);
      this.pending.set(requestId, { resolve, reject, timeout });
      try { this.port.postMessage({ requestId, action, soundId, blob }); }
      catch (error) { this.pending.delete(requestId); this.window.clearTimeout(timeout); reject(error); }
    });
  }

  #receive(message) {
    const pending = this.pending.get(message?.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    this.window.clearTimeout(pending.timeout);
    if (message.ok) pending.resolve(message.value); else pending.reject(new Error(message.error || "Audio storage failed."));
  }

  get(soundId) { return this.request("get", soundId); }
  put(soundId, blob) { return this.request("put", soundId, blob); }
  delete(soundId) { return this.request("delete", soundId); }
  async list() {
    const descriptors = await this.request("list");
    if (!Array.isArray(descriptors)) throw new Error("Audio storage returned an invalid sound list.");
    const soundIds = new Set();
    return descriptors.map(descriptor => {
      if (!isValidSoundId(descriptor?.soundId)
        || typeof descriptor.createdAt !== "number"
        || !Number.isFinite(descriptor.createdAt)
        || descriptor.createdAt < 0) {
        throw new Error("Audio storage returned an invalid sound descriptor.");
      }
      const soundId = descriptor.soundId.toLowerCase();
      if (soundIds.has(soundId)) throw new Error("Audio storage returned duplicate sound descriptors.");
      soundIds.add(soundId);
      return { soundId, createdAt: descriptor.createdAt };
    });
  }

  destroy() {
    this.pending.forEach(({ reject, timeout }) => {
      this.window.clearTimeout(timeout);
      reject(new Error("Audio storage closed."));
    });
    this.pending.clear();
    this.port?.close();
    this.port = null;
    this.iframe?.remove();
    this.iframe = null;
    this.readyPromise = null;
  }
}
