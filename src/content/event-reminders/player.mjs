const BUILTIN_PATH = "src/content/sound/mechanical-clock/mechanical-clock.ogg";
const FADE_SECONDS = 0.04;

export class SegmentPlayer {
  constructor({ window, runtime, storage, onActiveChange = () => {}, onDiagnostic = () => {} }) {
    this.window = window;
    this.runtime = runtime;
    this.storage = storage;
    this.onActiveChange = onActiveChange;
    this.onDiagnostic = onDiagnostic;
    this.activeListeners = new Set();
    this.context = null;
    this.playback = null;
    this.playbackId = 0;
    this.startingPlaybackId = null;
    this.buffers = new Map();
    this.objectUrls = new Set();
  }

  get active() { return Boolean(this.playback) || this.startingPlaybackId !== null; }

  onActive(listener) {
    if (typeof listener !== "function") return () => {};
    this.activeListeners.add(listener);
    listener(this.active);
    return () => this.activeListeners.delete(listener);
  }

  #setActive(active) {
    this.onActiveChange(active);
    this.activeListeners.forEach(listener => {
      try { listener(active); } catch (_error) { /* isolate UI listener */ }
    });
  }

  async decode(arrayBuffer) {
    const context = this.#context();
    return context.decodeAudioData(arrayBuffer.slice(0));
  }

  async validateBlob(blob) {
    const buffer = await this.decode(await blob.arrayBuffer());
    return { duration: buffer.duration, buffer };
  }

  #reportFallback(error, onFallback) {
    try { this.onDiagnostic(error); } catch (_error) { /* diagnostics are isolated */ }
    try { onFallback?.(error); } catch (_error) { /* UI diagnostics are isolated */ }
  }

  async prime(settings, { onFallback } = {}) {
    const context = this.#context();
    const resume = context.state === "suspended" ? context.resume() : Promise.resolve();
    const buffer = this.#getBuffer(settings).catch(async error => {
      if (settings?.soundKind !== "custom") throw error;
      this.#reportFallback(error, onFallback);
      return this.#getBuffer({ soundKind: "builtin" });
    });
    await Promise.all([resume, buffer]);
  }

  async #getBuffer(settings) {
    const kind = settings?.soundKind;
    if (kind === "custom") {
      const blob = await this.storage.get(settings.soundId);
      if (!(blob instanceof Blob) || !blob.size) throw new Error("The custom sound is missing.");
      const url = URL.createObjectURL(blob);
      this.objectUrls.add(url);
      try { return await this.decode(await blob.arrayBuffer()); }
      finally { URL.revokeObjectURL(url); this.objectUrls.delete(url); }
    }
    if (!this.buffers.has("builtin")) {
      this.buffers.set("builtin", fetch(this.runtime.getURL(BUILTIN_PATH))
        .then(response => {
          if (!response.ok) throw new Error(`Built-in sound failed to load (${response.status}).`);
          return response.arrayBuffer();
        })
        .then(data => this.decode(data))
        .catch(error => { this.buffers.delete("builtin"); throw error; }));
    }
    return this.buffers.get("builtin");
  }

  #context() {
    const AudioContextClass = this.window.AudioContext || this.window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is unavailable.");
    if (!this.context) this.context = new AudioContextClass();
    return this.context;
  }

  async play(settings, bufferOverride = null, { onFallback } = {}) {
    this.stop();
    const playbackId = this.playbackId;
    this.startingPlaybackId = playbackId;
    this.#setActive(true);
    let fallbackError = null;
    try {
      const context = this.#context();
      if (context.state === "suspended") await context.resume();
      if (playbackId !== this.playbackId) return { played: false, fallbackError };
      let kind = settings.soundKind;
      let buffer = bufferOverride;
      try {
        if (!buffer) buffer = await this.#getBuffer(settings);
      } catch (error) {
        if (playbackId !== this.playbackId) return { played: false, fallbackError };
        if (kind !== "custom") throw error;
        kind = "builtin";
        fallbackError = error;
        this.#reportFallback(error, onFallback);
        buffer = await this.#getBuffer({ soundKind: "builtin" });
      }
      if (playbackId !== this.playbackId) return { played: false, fallbackError };
      const start = Math.min(Math.max(0, Number(settings.clipStart) || 0), Math.max(0, buffer.duration - 0.25));
      const duration = Math.min(Math.max(0.25, Number(settings.clipDuration) || 5), 30, buffer.duration - start);
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.setValueAtTime(0.72, context.currentTime);
      source.connect(gain);
      gain.connect(context.destination);
      this.startingPlaybackId = null;
      this.playback = { source, gain, context, playbackId };
      source.onended = () => {
        try { source.disconnect(); gain.disconnect(); } catch (_error) { /* already disconnected */ }
        if (this.playback?.source !== source) return;
        this.playback = null;
        this.#setActive(false);
      };
      source.start(0, start, duration);
      return { played: true, fallbackError };
    } catch (error) {
      if (playbackId === this.playbackId) {
        if (this.startingPlaybackId === playbackId) this.startingPlaybackId = null;
        const failedPlayback = this.playback?.playbackId === playbackId ? this.playback : null;
        if (failedPlayback) {
          this.playback = null;
          try { failedPlayback.source.disconnect(); failedPlayback.gain.disconnect(); } catch (_disconnectError) { /* startup failed */ }
        }
        this.#setActive(false);
      }
      throw error;
    }
  }

  stop() {
    this.playbackId += 1;
    this.startingPlaybackId = null;
    const playback = this.playback;
    this.playback = null;
    this.#setActive(false);
    if (!playback) return;
    const now = playback.context.currentTime;
    try {
      playback.gain.gain.cancelScheduledValues(now);
      playback.gain.gain.setValueAtTime(Math.max(0.0001, playback.gain.gain.value), now);
      playback.gain.gain.exponentialRampToValueAtTime(0.0001, now + FADE_SECONDS);
      playback.source.stop(now + FADE_SECONDS + 0.01);
    } catch (_error) {
      try { playback.source.stop(); } catch (_stopError) { /* already stopped */ }
    }
  }

  destroy() {
    this.stop();
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls.clear();
    this.context?.close?.().catch(() => {});
    this.context = null;
    this.buffers.clear();
    this.activeListeners.clear();
  }
}
