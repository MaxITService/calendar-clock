export const BUILTIN_SOUND_NAME = "Mechanical clock ticking";
export const DEFAULT_LEAD_SECONDS = 30;
export const MAX_LEAD_SECONDS = 86400;
export const MIN_CLIP_SECONDS = 0.25;
export const MAX_CLIP_SECONDS = 30;
export const MAX_SOURCE_SECONDS = 60;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const STALE_GRACE_MS = 15000;
export const COALESCE_WINDOW_MS = 250;
const SOUND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

export function clampLeadSeconds(value) {
  return clampInteger(value, DEFAULT_LEAD_SECONDS, 0, MAX_LEAD_SECONDS);
}

export function sanitizeFilename(value, maxLength = 80) {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Custom sound";
  if (cleaned.length <= maxLength) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 && cleaned.length - dot <= 8 ? cleaned.slice(dot) : "";
  return `${cleaned.slice(0, Math.max(1, maxLength - extension.length - 3)).trimEnd()}...${extension}`;
}

export function isValidSoundId(value) {
  return typeof value === "string" && SOUND_ID_PATTERN.test(value);
}

export function generateSoundId(cryptoObject = globalThis.crypto) {
  let nativeId = null;
  try { nativeId = cryptoObject?.randomUUID?.(); } catch (_error) { /* use getRandomValues fallback */ }
  if (isValidSoundId(nativeId)) return nativeId.toLowerCase();
  const bytes = new Uint8Array(16);
  if (typeof cryptoObject?.getRandomValues !== "function") {
    throw new Error("Secure custom sound IDs are unavailable.");
  }
  cryptoObject.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getKnownAudioType(file = {}) {
  const mime = String(file.type || "").toLowerCase().split(";")[0].trim();
  const extension = String(file.name || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  const acceptedMimes = new Set([
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave",
    "audio/ogg", "application/ogg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/x-aac"
  ]);
  const acceptedExtensions = new Set(["mp3", "wav", "ogg", "m4a", "aac"]);
  return acceptedMimes.has(mime) || (!mime && acceptedExtensions.has(extension)) || acceptedExtensions.has(extension);
}

export function validateFileMetadata(file = {}) {
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) return "Choose a non-empty audio file.";
  if (size > MAX_FILE_BYTES) return "The audio file must be 5 MiB or smaller.";
  if (!getKnownAudioType(file)) return "Choose an MP3, WAV, OGG, M4A, or AAC audio file.";
  return "";
}

export function clampTrim(start, duration, sourceDuration) {
  const source = Math.max(0, Number(sourceDuration) || 0);
  if (source < MIN_CLIP_SECONDS) return { start: 0, duration: 0 };
  const safeStart = Math.min(Math.max(0, Number(start) || 0), Math.max(0, source - MIN_CLIP_SECONDS));
  const available = source - safeStart;
  const safeDuration = Math.min(
    Math.max(MIN_CLIP_SECONDS, Number(duration) || Math.min(5, available)),
    MAX_CLIP_SECONDS,
    available
  );
  return { start: roundSeconds(safeStart), duration: roundSeconds(safeDuration) };
}

function roundSeconds(value) {
  return Math.round(value * 1000) / 1000;
}

export function normalizeReminderSettings(state = {}) {
  const isNormalized = Object.prototype.hasOwnProperty.call(state, "startEnabled");
  const sourceDuration = Math.min(MAX_SOURCE_SECONDS, Math.max(
    MIN_CLIP_SECONDS,
    Number(isNormalized ? state.sourceDuration : state.eventReminderSourceDuration) || 19.84
  ));
  const trim = clampTrim(
    isNormalized ? state.clipStart : state.eventReminderClipStart,
    isNormalized ? state.clipDuration : state.eventReminderClipDuration,
    sourceDuration
  );
  const requestedKind = (isNormalized ? state.soundKind : state.eventReminderSoundKind) === "custom" ? "custom" : "builtin";
  const requestedSoundId = isNormalized ? state.soundId : state.eventReminderSoundId;
  const kind = requestedKind === "custom" && isValidSoundId(requestedSoundId) ? "custom" : "builtin";
  return {
    startEnabled: (isNormalized ? state.startEnabled : state.eventReminderStartEnabled) === true,
    startLeadSeconds: clampLeadSeconds(isNormalized ? state.startLeadSeconds : state.eventReminderStartLeadSeconds),
    endEnabled: (isNormalized ? state.endEnabled : state.eventReminderEndEnabled) === true,
    endLeadSeconds: clampLeadSeconds(isNormalized ? state.endLeadSeconds : state.eventReminderEndLeadSeconds),
    soundKind: kind,
    soundId: kind === "custom" ? requestedSoundId.toLowerCase() : null,
    soundName: kind === "custom" ? sanitizeFilename(isNormalized ? state.soundName : state.eventReminderSoundName) : BUILTIN_SOUND_NAME,
    sourceDuration,
    clipStart: trim.start,
    clipDuration: trim.duration || 5
  };
}

export function isAllDayEvent(event) {
  return event?.temporal?.kind === "all-day";
}

export function isPointEvent(event) {
  return event?.temporal?.kind === "point";
}

export function buildReminderEntries(events, settings, nowMs = Date.now()) {
  const normalized = normalizeReminderSettings(settings);
  const entries = [];
  (Array.isArray(events) ? events : []).forEach((event, index) => {
    if (!event || event.dateParseStatus === "failed" || isAllDayEvent(event)) return;
    const id = String(event.id || event.domKey || `event-${index}`).slice(0, 512);
    const boundaries = [
      ["start", normalized.startEnabled, normalized.startLeadSeconds, event.temporal?.startInstant],
      ["end", normalized.endEnabled && !isPointEvent(event), normalized.endLeadSeconds, event.temporal?.endInstant]
    ];
    boundaries.forEach(([kind, enabled, leadSeconds, rawDate]) => {
      if (!enabled) return;
      const boundaryMs = Date.parse(rawDate);
      if (!Number.isFinite(boundaryMs)) return;
      const startMs = Date.parse(event.temporal?.startInstant);
      if (!Number.isFinite(startMs)) return;
      if (kind === "end" && boundaryMs <= startMs) return;
      const dueMs = boundaryMs - leadSeconds * 1000;
      const key = `${id}|${kind}|${boundaryMs}|${leadSeconds}`;
      entries.push({ key, eventId: id, kind, boundaryMs, dueMs, stale: nowMs - dueMs > STALE_GRACE_MS });
    });
  });
  return entries.sort((a, b) => a.dueMs - b.dueMs || a.key.localeCompare(b.key));
}

export function pruneFiredLedger(firedLedger, nowMs) {
  firedLedger.forEach((expiresAt, key) => {
    if (!Number.isFinite(expiresAt) || expiresAt < nowMs) firedLedger.delete(key);
  });
}

export function collectDueEntries(entries, firedLedger, nowMs, graceMs = STALE_GRACE_MS, coalesceMs = COALESCE_WINDOW_MS) {
  const due = entries.filter(entry => !firedLedger.has(entry.key) && entry.dueMs <= nowMs + coalesceMs);
  const playable = due.filter(entry => nowMs - entry.dueMs <= graceMs);
  due.forEach(entry => {
    const expiryBase = Number.isFinite(entry.boundaryMs) ? entry.boundaryMs : entry.dueMs;
    firedLedger.set(entry.key, Math.max(nowMs, expiryBase + graceMs));
  });
  return playable;
}

export function getSoundTooltip(settings) {
  const sound = normalizeReminderSettings(settings);
  return `Selected sound: ${sound.soundName}. Click to choose or edit the sound.`;
}

export class ReminderScheduler {
  constructor({ now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, onDue, graceMs = STALE_GRACE_MS } = {}) {
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onDue = typeof onDue === "function" ? onDue : () => {};
    this.graceMs = graceMs;
    this.entries = [];
    this.firedLedger = new Map();
    this.timer = null;
    this.destroyed = false;
  }

  update(events, settings) {
    if (this.destroyed) return;
    pruneFiredLedger(this.firedLedger, this.now());
    this.entries = buildReminderEntries(events, settings, this.now());
    this.#arm();
  }

  #arm() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    if (this.destroyed) return;
    const nowMs = this.now();
    pruneFiredLedger(this.firedLedger, nowMs);
    const due = collectDueEntries(this.entries, this.firedLedger, nowMs, this.graceMs);
    if (due.length) {
      try { this.onDue(due); } catch (_error) { /* isolate consumer */ }
    }
    const next = this.entries.find(entry => !this.firedLedger.has(entry.key));
    if (!next) return;
    const delay = Math.min(2147480000, Math.max(0, next.dueMs - this.now()));
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.#arm();
    }, delay);
  }

  destroy() {
    this.destroyed = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.entries = [];
    this.firedLedger.clear();
  }
}
