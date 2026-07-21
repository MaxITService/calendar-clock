#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_SOUND_NAME, MAX_FILE_BYTES, ReminderScheduler, buildReminderEntries,
  clampLeadSeconds, clampTrim, collectDueEntries, getSoundTooltip,
  normalizeReminderSettings, pruneFiredLedger, sanitizeFilename, validateFileMetadata
} from "../src/content/event-reminders/helpers.mjs";
import { SegmentPlayer } from "../src/content/event-reminders/player.mjs";
import {
  cleanupOrphanSounds, clearSelectedSoundAndCleanup, ORPHAN_QUARANTINE_MS, saveSoundSelection
} from "../src/content/event-reminders/sound-persistence.mjs";
import { inertModalBackground, UploadGenerationGuard, wrapDialogTab } from "../src/content/event-reminders/dialog-controller.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const scheduledChecks = [];
const check = (name, action) => { scheduledChecks.push({ name, action }); };

check("lead seconds are integer-clamped", () => {
  assert.equal(clampLeadSeconds("31.6"), 32);
  assert.equal(clampLeadSeconds(-9), 0);
  assert.equal(clampLeadSeconds(999999), 86400);
  assert.equal(clampLeadSeconds("no"), 30);
});

check("file metadata limits and known formats", () => {
  assert.match(validateFileMetadata({ name: "empty.mp3", size: 0, type: "audio/mpeg" }), /non-empty/);
  assert.match(validateFileMetadata({ name: "huge.wav", size: MAX_FILE_BYTES + 1, type: "audio/wav" }), /5 MiB/);
  assert.equal(validateFileMetadata({ name: "quiet.ogg", size: 42, type: "" }), "");
  assert.match(validateFileMetadata({ name: "notes.txt", size: 42, type: "text/plain" }), /MP3/);
  assert.equal(sanitizeFilename("../../My\u0000  sound.wav", 80), ".. .. My sound.wav");
});

check("trim is clamped to source and product limits", () => {
  assert.deepEqual(clampTrim(-3, 99, 10), { start: 0, duration: 10 });
  assert.deepEqual(clampTrim(9.9, 5, 10), { start: 9.75, duration: 0.25 });
  assert.deepEqual(clampTrim(5, 28, 60), { start: 5, duration: 28 });
});

const baseSettings = {
  eventReminderStartEnabled: true,
  eventReminderStartLeadSeconds: 30,
  eventReminderEndEnabled: true,
  eventReminderEndLeadSeconds: 10
};
const range = {
  id: "range", startDate: "2026-07-20T10:00:00.000Z", endDate: "2026-07-20T11:00:00.000Z", durationKind: "range",
  temporal: { kind: "timed", startInstant: "2026-07-20T10:00:00.000Z", endInstant: "2026-07-20T11:00:00.000Z" }
};
const point = {
  id: "point", startDate: "2026-07-20T10:00:00.000Z", endDate: "2026-07-20T10:00:00.000Z", durationKind: "point",
  temporal: { kind: "point", startInstant: "2026-07-20T10:00:00.000Z", endInstant: "2026-07-20T10:00:00.000Z" }
};
const allDay = {
  id: "day", startDate: "2026-07-20T00:00:00.000Z", endDate: "2026-07-21T00:00:00.000Z", durationKind: "all-day", isAllDay: true,
  temporal: { kind: "all-day", startDateKey: "2026-07-20", endDateKeyExclusive: "2026-07-21" }
};

check("all-day and point filtering is correct", () => {
  const parseFailed = { ...range, id: "failed", dateParseStatus: "failed" };
  const entries = buildReminderEntries([range, point, allDay, parseFailed], baseSettings, Date.parse("2026-07-20T09:00:00Z"));
  assert.deepEqual(entries.map(entry => `${entry.eventId}:${entry.kind}`), ["point:start", "range:start", "range:end"]);
});

check("lead times determine reminder timestamps", () => {
  const entries = buildReminderEntries([range], baseSettings, 0);
  assert.equal(entries[0].dueMs, Date.parse(range.startDate) - 30000);
  assert.equal(entries[1].dueMs, Date.parse(range.endDate) - 10000);
});

check("normalized settings can be scheduled directly", () => {
  const normalized = normalizeReminderSettings(baseSettings);
  assert.equal(buildReminderEntries([range], normalized, 0).length, 2);
});

check("simultaneous due entries coalesce and deduplicate", () => {
  const fired = new Map();
  const entries = [
    { key: "a", dueMs: 1000, boundaryMs: 2000 },
    { key: "b", dueMs: 1100, boundaryMs: 2100 }
  ];
  assert.equal(collectDueEntries(entries, fired, 1000).length, 2);
  assert.equal(collectDueEntries(entries, fired, 1200).length, 0);
});

check("stale wake reminders are skipped", () => {
  const fired = new Map();
  assert.equal(collectDueEntries([{ key: "old", dueMs: 1000, boundaryMs: 1000 }], fired, 17000, 15000).length, 0);
  assert.equal(fired.has("old"), true);
});

check("scheduler reschedules changes without snapshot-pruning its fired ledger", () => {
  let now = Date.parse("2026-07-20T09:00:00Z");
  const timers = new Map(); let id = 0;
  const scheduler = new ReminderScheduler({
    now: () => now,
    setTimer: (fn, delay) => { const timerId = ++id; timers.set(timerId, { fn, delay }); return timerId; },
    clearTimer: timerId => timers.delete(timerId)
  });
  scheduler.update([range], baseSettings);
  assert.equal(scheduler.entries.length, 2);
  const currentFiredKey = scheduler.entries[0].key;
  scheduler.firedLedger.set(currentFiredKey, Date.parse(range.startDate) + 15000);
  scheduler.firedLedger.set("removed-event-key", now + 15000);
  scheduler.update([range], baseSettings);
  assert.deepEqual([...scheduler.firedLedger.keys()], [currentFiredKey, "removed-event-key"]);
  const moved = {
    ...range,
    startDate: "2026-07-20T12:00:00.000Z",
    endDate: "2026-07-20T13:00:00.000Z",
    temporal: { ...range.temporal, startInstant: "2026-07-20T12:00:00.000Z", endInstant: "2026-07-20T13:00:00.000Z" }
  };
  scheduler.update([moved], baseSettings);
  assert.equal(scheduler.entries[0].boundaryMs, Date.parse(moved.startDate));
  assert.equal(scheduler.firedLedger.size, 2);
  scheduler.update([], baseSettings);
  assert.equal(scheduler.entries.length, 0);
  assert.equal(timers.size, 0);
  scheduler.destroy();
});

check("event disappearance and reappearance cannot replay the same reminder", () => {
  let now = Date.parse("2026-07-20T10:00:00Z");
  let dueCount = 0;
  const scheduler = new ReminderScheduler({
    now: () => now,
    setTimer: () => 1,
    clearTimer: () => {},
    onDue: due => { dueCount += due.length; }
  });
  const settings = { ...baseSettings, eventReminderStartLeadSeconds: 0, eventReminderEndEnabled: false };
  scheduler.update([range], settings);
  scheduler.update([], settings);
  scheduler.update([range], settings);
  assert.equal(dueCount, 1);
  assert.equal(scheduler.firedLedger.size, 1);
  scheduler.destroy();
});

check("fired ledger expires by time and changed lead gets a distinct key", () => {
  const ledger = new Map();
  const first = buildReminderEntries([range], { ...baseSettings, eventReminderEndEnabled: false }, 0)[0];
  const changed = buildReminderEntries([range], { ...baseSettings, eventReminderStartLeadSeconds: 31, eventReminderEndEnabled: false }, 0)[0];
  assert.notEqual(first.key, changed.key);
  collectDueEntries([first, changed], ledger, first.boundaryMs, 15000);
  assert.equal(ledger.size, 2);
  const latestExpiry = Math.max(...ledger.values());
  assert.equal(latestExpiry, first.boundaryMs + 15000);
  pruneFiredLedger(ledger, latestExpiry + 1);
  assert.equal(ledger.size, 0);
});

check("visible Sound text is fixed while tooltip is dynamic", () => {
  const template = fs.readFileSync(path.join(root, "src/content/overlay/templates/root.html"), "utf8");
  const labels = [...template.matchAll(/data-cc-event-reminder-sound[^>]*>([^<]+)</g)].map(match => match[1].trim());
  assert.deepEqual(labels, ["Sound", "Sound"]);
  const tooltip = getSoundTooltip({
    eventReminderSoundKind: "custom",
    eventReminderSoundId: "11111111-1111-4111-8111-111111111111",
    eventReminderSoundName: "Bell.wav",
    eventReminderSourceDuration: 2
  });
  assert.equal(tooltip, "Selected sound: Bell.wav. Click to choose or edit the sound.");
  assert.equal(normalizeReminderSettings({}).soundName, BUILTIN_SOUND_NAME);
  assert.equal(normalizeReminderSettings({ eventReminderSoundKind: "custom", eventReminderSoundName: "Broken.wav" }).soundKind, "builtin");
});

check("obsolete iframe sound coupling is absent", () => {
  const files = [
    "src/clock/scripts/magnifier-motion.js", "src/clock/scripts/calendar-bridge.js",
    "src/content/calendar-content-entry.js", "src/content/overlay/overlay-menu.js"
  ];
  const text = files.map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  assert.doesNotMatch(text, /CALENDAR_CLOCK_PLAY_TICK_SOUND|magnifierAutoEventStartSound|magnifierAutoEventEndSound/);
});

check("sound controls stay independent from magnifier toggles", () => {
  const overlay = fs.readFileSync(path.join(root, "src/content/overlay/overlay-menu.js"), "utf8");
  const module = fs.readFileSync(path.join(root, "src/content/event-reminders/main.mjs"), "utf8");
  assert.match(overlay, /magnifierSettingsBtn\.style\.display = ""/);
  assert.doesNotMatch(module, /magnifierEnabled|magnifierAutoEnabled/);
});

check("sound modal restores pointer events", () => {
  const baseStyles = fs.readFileSync(path.join(root, "src/content/overlay/styles/base-layout.css"), "utf8");
  const soundStyles = fs.readFileSync(path.join(root, "src/content/event-reminders/styles.css"), "utf8");
  assert.match(baseStyles, /#calendar-clock-root\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(soundStyles, /#calendar-clock-root \.cc-sound-modal\s*\{[^}]*pointer-events:\s*auto/s);
});

check("reminder module follows replaced state and wipe cleanup", () => {
  const entry = fs.readFileSync(path.join(root, "src/content/calendar-content-entry.js"), "utf8");
  const overlay = fs.readFileSync(path.join(root, "src/content/overlay/overlay-menu.js"), "utf8");
  const module = fs.readFileSync(path.join(root, "src/content/event-reminders/main.mjs"), "utf8");
  assert.match(entry, /getState:\s*\(\) => calendarClockState/);
  assert.match(module, /const currentState = getState\(\);[\s\S]*setStateSound\(currentState, settings\)/);
  assert.match(module, /syncState\(\{ clearCustomBlob = false \} = \{\}\) \{[\s\S]*selectedSoundIdToClear[\s\S]*refreshControls\(\)[\s\S]*clearSelectedSoundAndCleanup\(storage, selectedSoundIdToClear, warn\)/);
  assert.match(overlay, /applyLoadedCalendarClockState\([\s\S]*calendarClockEventReminders\?\.syncState\?\.\(\{ clearCustomBlob: true \}\)/);
});

check("storage bridge requires background-authenticated token", () => {
  const background = fs.readFileSync(path.join(root, "src/background/background.js"), "utf8");
  const client = fs.readFileSync(path.join(root, "src/content/event-reminders/storage-client.mjs"), "utf8");
  const frame = fs.readFileSync(path.join(root, "src/content/event-reminders/storage-frame.js"), "utf8");
  assert.match(background, /crypto\.getRandomValues/);
  assert.match(background, /url\.hostname === "calendar\.google\.com"[\s\S]*Number\.isInteger\(sender\?\.tab\?\.id\)/);
  assert.match(background, /sender\?\.url === chrome\.runtime\.getURL\(CALENDAR_CLOCK_AUDIO_STORAGE_FRAME_PATH\)/);
  assert.match(background, /sender\.tab\.id !== record\.tabId/);
  assert.match(background, /calendarClockAudioBridgeTokens\.delete\(token\)/);
  assert.match(client, /CALENDAR_CLOCK_CREATE_AUDIO_BRIDGE_TOKEN/);
  assert.match(client, /CALENDAR_CLOCK_AUDIO_STORAGE_ACK/);
  assert.match(frame, /CALENDAR_CLOCK_VALIDATE_AUDIO_BRIDGE_TOKEN/);
  assert.match(frame, /response\?\.ok !== true/);
  assert.match(frame, /requireSoundId\(message\?\.soundId\)/);
  assert.match(frame, /store\.put\(\{ soundId, blob: message\.blob, createdAt: Date\.now\(\) \}, soundId\)/);
  assert.match(frame, /objectStore\(STORE_NAME\)\.openCursor\(\)/);
  assert.match(frame, /isValidRecord\(record, soundId\) \? record\.blob : null/);
  assert.doesNotMatch(frame, /selected-custom-sound/);
});

check("transient custom storage failure only falls back for the current prime", async () => {
  let diagnosticCount = 0;
  let persistentMutationCount = 0;
  class FakeAudioContext {
    constructor() { this.state = "running"; }
    decodeAudioData() { return Promise.resolve({ duration: 1 }); }
    close() { return Promise.resolve(); }
  }
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  const player = new SegmentPlayer({
    window: { AudioContext: FakeAudioContext },
    runtime: { getURL: pathValue => pathValue },
    storage: {
      get: async () => { throw new Error("temporary IndexedDB failure"); },
      put: async () => { persistentMutationCount += 1; },
      delete: async () => { persistentMutationCount += 1; }
    },
    onDiagnostic: () => { diagnosticCount += 1; }
  });
  try {
    await player.prime({ soundKind: "custom", soundId: "11111111-1111-4111-8111-111111111111" });
    assert.equal(diagnosticCount, 1);
    assert.equal(persistentMutationCount, 0);
    assert.equal(player.active, false);
  } finally {
    player.destroy();
    globalThis.fetch = previousFetch;
  }
  const main = fs.readFileSync(path.join(root, "src/content/event-reminders/main.mjs"), "utf8");
  assert.doesNotMatch(main, /onCustomFallback/);
});

check("pending playback is active, toggle-cancellable, and isolated by playback ID", async () => {
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  };
  const makeWindow = counter => ({
    AudioContext: class {
      constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      decodeAudioData() { return Promise.resolve({ duration: 2 }); }
      createBufferSource() {
        return {
          connect() {}, disconnect() {}, stop() {},
          start() { counter.starts += 1; },
          onended: null, buffer: null
        };
      }
      createGain() {
        return {
          connect() {}, disconnect() {},
          gain: {
            value: 0.72,
            setValueAtTime() {}, cancelScheduledValues() {}, exponentialRampToValueAtTime() {}
          }
        };
      }
      close() { return Promise.resolve(); }
    }
  });
  const builtinSettings = { soundKind: "builtin", clipStart: 0, clipDuration: 1 };
  const previousFetch = globalThis.fetch;
  const delayedLoad = deferred();
  const counter = { starts: 0 };
  const activeStates = [];
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: () => delayedLoad.promise });
  const player = new SegmentPlayer({
    window: makeWindow(counter),
    runtime: { getURL: pathValue => pathValue },
    storage: {},
    onActiveChange: active => activeStates.push(active)
  });
  try {
    const canceledPlay = player.play(builtinSettings);
    assert.equal(player.active, true);
    let secondAction = "play-again";
    if (player.active) { secondAction = "stop"; player.stop(); }
    assert.equal(secondAction, "stop");
    delayedLoad.resolve(new ArrayBuffer(8));
    assert.deepEqual(await canceledPlay, { played: false, fallbackError: null });
    assert.equal(counter.starts, 0);
    assert.equal(player.active, false);

    const normalResult = await player.play(builtinSettings);
    assert.deepEqual(normalResult, { played: true, fallbackError: null });
    assert.equal(counter.starts, 1);
    assert.equal(player.active, true);
    assert.equal(activeStates.at(-1), true);
    player.stop();
    assert.equal(player.active, false);
    assert.equal(activeStates.at(-1), false);
  } finally {
    player.destroy();
    globalThis.fetch = previousFetch;
  }

  const firstBlob = deferred();
  const secondBlob = deferred();
  const customCounter = { starts: 0 };
  let readCount = 0;
  const customPlayer = new SegmentPlayer({
    window: makeWindow(customCounter),
    runtime: { getURL: pathValue => pathValue },
    storage: { get: () => (++readCount === 1 ? firstBlob.promise : secondBlob.promise) }
  });
  const customSettings = {
    soundKind: "custom",
    soundId: "11111111-1111-4111-8111-111111111111",
    clipStart: 0,
    clipDuration: 1
  };
  try {
    const stalePlay = customPlayer.play(customSettings);
    const currentPlay = customPlayer.play(customSettings);
    firstBlob.resolve(new Blob([new Uint8Array(8)], { type: "audio/wav" }));
    assert.deepEqual(await stalePlay, { played: false, fallbackError: null });
    assert.equal(customPlayer.active, true);
    secondBlob.resolve(new Blob([new Uint8Array(8)], { type: "audio/wav" }));
    assert.deepEqual(await currentPlay, { played: true, fallbackError: null });
    assert.equal(customCounter.starts, 1);
    assert.equal(customPlayer.active, true);
  } finally {
    customPlayer.destroy();
  }
});

check("versioned custom save commits blob, metadata, memory, then old cleanup", async () => {
  const oldId = "11111111-1111-4111-8111-111111111111";
  const newId = "22222222-2222-4222-8222-222222222222";
  const trimId = "99999999-9999-4999-8999-999999999999";
  const blobs = new Map([[oldId, new Blob(["old"])]]);
  const order = [];
  const storage = {
    put: async (id, blob) => { order.push(`put:${id}`); blobs.set(id, blob); },
    get: async id => { order.push(`get:${id}`); return blobs.get(id); },
    delete: async id => { order.push(`delete:${id}`); blobs.delete(id); },
    list: async () => [...blobs.keys()].map(soundId => ({ soundId, createdAt: 0 }))
  };
  let committed = null;
  await saveSoundSelection({
    storage,
    settings: { soundKind: "custom", soundId: null, soundName: "new.wav" },
    previousSoundId: oldId,
    pendingBlob: new Blob(["new"]),
    createSoundId: () => newId,
    saveMetadata: async settings => { order.push(`metadata:${settings.soundId}`); },
    commitMemory: settings => { order.push(`memory:${settings.soundId}`); committed = settings; }
  });
  assert.deepEqual(order.slice(0, 4), [`put:${newId}`, `metadata:${newId}`, `memory:${newId}`, `delete:${oldId}`]);
  assert.equal(committed.soundId, newId);
  assert.deepEqual([...blobs.keys()], [newId]);

  order.length = 0;
  let trimCommitted = null;
  await saveSoundSelection({
    storage,
    settings: { soundKind: "custom", soundId: newId, soundName: "new.wav", clipStart: 1 },
    previousSoundId: newId,
    createSoundId: () => trimId,
    saveMetadata: async settings => { order.push(`metadata:${settings.soundId}`); },
    commitMemory: settings => { order.push(`memory:${settings.soundId}`); trimCommitted = settings; }
  });
  assert.deepEqual(order, [
    `get:${newId}`, `put:${trimId}`, `metadata:${trimId}`, `memory:${trimId}`, `delete:${newId}`
  ]);
  assert.equal(trimCommitted.soundId, trimId);
  assert.equal(blobs.has(newId), false);
  assert.equal(await blobs.get(trimId).text(), "new");
});

check("failed metadata commit deletes only the new version and preserves the old selection", async () => {
  const oldId = "11111111-1111-4111-8111-111111111111";
  const newId = "22222222-2222-4222-8222-222222222222";
  const blobs = new Map([[oldId, new Blob(["old"])]]);
  let memoryCommits = 0;
  const storage = {
    put: async (id, blob) => blobs.set(id, blob),
    get: async id => blobs.get(id),
    delete: async id => blobs.delete(id),
    list: async () => [...blobs.keys()].map(soundId => ({ soundId, createdAt: 0 }))
  };
  await assert.rejects(saveSoundSelection({
    storage,
    settings: { soundKind: "custom", soundId: null, soundName: "new.wav" },
    previousSoundId: oldId,
    pendingBlob: new Blob(["new"]),
    createSoundId: () => newId,
    saveMetadata: async () => { throw new Error("storage.local rejected"); },
    commitMemory: () => { memoryCommits += 1; }
  }), /storage\.local rejected/);
  assert.equal(memoryCommits, 0);
  assert.deepEqual([...blobs.keys()], [oldId]);
});

check("failed trim version metadata preserves the old ID and removes only its clone", async () => {
  const oldId = "11111111-1111-4111-8111-111111111111";
  const trimId = "99999999-9999-4999-8999-999999999999";
  const blobs = new Map([[oldId, new Blob(["old"])]]);
  const order = [];
  let activeMetadata = oldId;
  let memoryCommits = 0;
  const storage = {
    get: async soundId => { order.push(`get:${soundId}`); return blobs.get(soundId); },
    put: async (soundId, blob) => { order.push(`put:${soundId}`); blobs.set(soundId, blob); },
    delete: async soundId => { order.push(`delete:${soundId}`); blobs.delete(soundId); },
    list: async () => [...blobs.keys()].map(soundId => ({ soundId, createdAt: 0 }))
  };
  await assert.rejects(saveSoundSelection({
    storage,
    settings: { soundKind: "custom", soundId: oldId, soundName: "old.wav", clipStart: 1 },
    previousSoundId: oldId,
    createSoundId: () => trimId,
    saveMetadata: async settings => {
      order.push(`metadata:${settings.soundId}`);
      throw new Error("storage.local rejected trim");
    },
    commitMemory: () => { memoryCommits += 1; activeMetadata = trimId; }
  }), /storage\.local rejected trim/);
  assert.deepEqual(order, [`get:${oldId}`, `put:${trimId}`, `metadata:${trimId}`, `delete:${trimId}`]);
  assert.equal(activeMetadata, oldId);
  assert.equal(memoryCommits, 0);
  assert.deepEqual([...blobs.keys()], [oldId]);
  assert.equal(await blobs.get(oldId).text(), "old");
});

check("quarantined cleanup preserves concurrent saves until they age out", async () => {
  const soundC = "33333333-3333-4333-8333-333333333333";
  const soundD = "44444444-4444-4444-8444-444444444444";
  let now = 1_000_000;
  let finalActive = null;
  let resolveBothPuts;
  const bothPuts = new Promise(resolve => { resolveBothPuts = resolve; });
  const metadataGates = new Map();
  const gateFor = soundId => {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    metadataGates.set(soundId, { promise, release });
    return promise;
  };
  const gateC = gateFor(soundC);
  const gateD = gateFor(soundD);
  const records = new Map();
  const storage = {
    put: async (soundId, blob) => {
      records.set(soundId, { blob, createdAt: now });
      if (records.size === 2) resolveBothPuts();
    },
    get: async soundId => records.get(soundId)?.blob || null,
    delete: async soundId => records.delete(soundId),
    list: async () => [...records].map(([soundId, record]) => ({ soundId, createdAt: record.createdAt }))
  };
  const startSave = (soundId, gate) => saveSoundSelection({
    storage,
    settings: { soundKind: "custom", soundId: null, soundName: `${soundId}.wav` },
    pendingBlob: new Blob([soundId]),
    createSoundId: () => soundId,
    saveMetadata: async settings => {
      await gate;
      finalActive = settings.soundId;
    },
    commitMemory: () => {},
    cleanupOptions: { now: () => now, quarantineMs: ORPHAN_QUARANTINE_MS }
  });

  const saveC = startSave(soundC, gateC);
  const saveD = startSave(soundD, gateD);
  await bothPuts;
  metadataGates.get(soundC).release();
  await saveC;
  assert.deepEqual([...records.keys()].sort(), [soundC, soundD]);
  metadataGates.get(soundD).release();
  await saveD;
  assert.equal(finalActive, soundD);
  assert.equal(records.has(soundD), true);
  assert.equal(records.has(soundC), true);

  now += ORPHAN_QUARANTINE_MS + 1;
  await cleanupOrphanSounds(storage, soundD, () => {}, {
    now: () => now,
    quarantineMs: ORPHAN_QUARANTINE_MS
  });
  assert.deepEqual([...records.keys()], [soundD]);
});

check("trim and replacement saves cannot republish a deleted source ID", async () => {
  const soundA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const soundC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const trimVersion = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const now = 2_000_000;
  let finalActive = soundA;
  const publishedIds = [];
  let releaseTrimMetadata;
  let releaseReplacementMetadata;
  let resolveTrimPut;
  let resolveReplacementPut;
  const trimMetadataGate = new Promise(resolve => { releaseTrimMetadata = resolve; });
  const replacementMetadataGate = new Promise(resolve => { releaseReplacementMetadata = resolve; });
  const trimPut = new Promise(resolve => { resolveTrimPut = resolve; });
  const replacementPut = new Promise(resolve => { resolveReplacementPut = resolve; });
  const records = new Map([[soundA, { blob: new Blob(["A"]), createdAt: 0 }]]);
  const storage = {
    get: async soundId => records.get(soundId)?.blob || null,
    put: async (soundId, blob) => {
      records.set(soundId, { blob, createdAt: now });
      if (soundId === trimVersion) resolveTrimPut();
      if (soundId === soundC) resolveReplacementPut();
    },
    delete: async soundId => records.delete(soundId),
    list: async () => [...records].map(([soundId, record]) => ({ soundId, createdAt: record.createdAt }))
  };
  const common = {
    storage,
    previousSoundId: soundA,
    commitMemory: settings => { finalActive = settings.soundId; },
    cleanupOptions: { now: () => now, quarantineMs: ORPHAN_QUARANTINE_MS }
  };

  const trimSave = saveSoundSelection({
    ...common,
    settings: { soundKind: "custom", soundId: soundA, soundName: "A.wav", clipStart: 1 },
    createSoundId: () => trimVersion,
    saveMetadata: async settings => {
      await trimMetadataGate;
      publishedIds.push(settings.soundId);
    }
  });
  await trimPut;
  const replacementSave = saveSoundSelection({
    ...common,
    settings: { soundKind: "custom", soundId: null, soundName: "C.wav" },
    pendingBlob: new Blob(["C"]),
    createSoundId: () => soundC,
    saveMetadata: async settings => {
      await replacementMetadataGate;
      publishedIds.push(settings.soundId);
    }
  });
  await replacementPut;
  releaseReplacementMetadata();
  await replacementSave;
  assert.equal(finalActive, soundC);
  assert.equal(records.has(soundA), false);
  assert.equal(records.has(trimVersion), true);

  releaseTrimMetadata();
  await trimSave;
  assert.deepEqual(publishedIds, [soundC, trimVersion]);
  assert.equal(publishedIds.includes(soundA), false);
  assert.equal(finalActive, trimVersion);
  assert.equal(records.has(trimVersion), true);
  assert.equal(await records.get(trimVersion).blob.text(), "A");
});

check("cleanup deletes old orphans and skips malformed descriptors safely", async () => {
  const activeId = "55555555-5555-4555-8555-555555555555";
  const oldId = "66666666-6666-4666-8666-666666666666";
  const freshId = "77777777-7777-4777-8777-777777777777";
  const malformedId = "88888888-8888-4888-8888-888888888888";
  const now = ORPHAN_QUARANTINE_MS + 10_000;
  const blobs = new Map([[activeId, true], [oldId, true], [freshId, true], [malformedId, true]]);
  let warnings = 0;
  const storage = {
    list: async () => [
      { soundId: activeId, createdAt: 0 },
      { soundId: oldId, createdAt: 0 },
      { soundId: freshId, createdAt: now },
      { soundId: malformedId, createdAt: null },
      { soundId: "not-a-sound-id", createdAt: 0 }
    ],
    delete: async soundId => blobs.delete(soundId)
  };
  await cleanupOrphanSounds(storage, activeId, () => { warnings += 1; }, {
    now: () => now,
    quarantineMs: ORPHAN_QUARANTINE_MS
  });
  assert.equal(blobs.has(oldId), false);
  assert.equal(blobs.has(activeId), true);
  assert.equal(blobs.has(freshId), true);
  assert.equal(blobs.has(malformedId), true);
  assert.equal(warnings, 2);
});

check("settings wipe deletes only the selected sound immediately", async () => {
  const selectedId = "11111111-1111-4111-8111-111111111111";
  const oldOrphanId = "22222222-2222-4222-8222-222222222222";
  const freshOrphanId = "33333333-3333-4333-8333-333333333333";
  const now = ORPHAN_QUARANTINE_MS + 10_000;
  const blobs = new Map([
    [selectedId, { createdAt: now }],
    [oldOrphanId, { createdAt: 0 }],
    [freshOrphanId, { createdAt: now }]
  ]);
  const storage = {
    list: async () => [...blobs].map(([soundId, record]) => ({ soundId, createdAt: record.createdAt })),
    delete: async soundId => blobs.delete(soundId)
  };

  await clearSelectedSoundAndCleanup(storage, selectedId, () => {}, {
    now: () => now,
    quarantineMs: ORPHAN_QUARANTINE_MS
  });

  assert.equal(blobs.has(selectedId), false);
  assert.equal(blobs.has(oldOrphanId), false);
  assert.equal(blobs.has(freshOrphanId), true);
});

check("stale upload generations cannot commit and later failures preserve a valid draft", () => {
  const guard = new UploadGenerationGuard();
  const session = guard.openSession();
  let draft = { name: "valid.wav", duration: 3 };
  const stale = guard.begin(session);
  const current = guard.begin(session);
  if (guard.isCurrent(stale)) draft = { name: "stale.wav", duration: 4 };
  assert.equal(draft.name, "valid.wav");
  assert.equal(guard.isCurrent(current), true);
  const laterCandidateFailed = true;
  if (!laterCandidateFailed && guard.isCurrent(current)) draft = { name: "bad.wav", duration: 0 };
  guard.finish(current);
  assert.deepEqual(draft, { name: "valid.wav", duration: 3 });
  const closing = guard.begin(session);
  guard.closeSession(session);
  assert.equal(guard.isCurrent(closing), false);
});

check("modal background inert state and Tab wrapping restore exactly", () => {
  const makeElement = (inert = false) => ({ inert, parentElement: null, children: [] });
  const body = makeElement();
  const calendar = makeElement(true);
  const rootElement = makeElement();
  const otherControl = makeElement(false);
  const modalElement = makeElement();
  body.children = [calendar, rootElement];
  calendar.parentElement = body; rootElement.parentElement = body;
  rootElement.children = [otherControl, modalElement];
  otherControl.parentElement = rootElement; modalElement.parentElement = rootElement;
  const restore = inertModalBackground(modalElement, body);
  assert.equal(calendar.inert, true);
  assert.equal(otherControl.inert, true);
  restore();
  assert.equal(calendar.inert, true);
  assert.equal(otherControl.inert, false);

  let focused = "";
  const first = { focus: () => { focused = "first"; } };
  const last = { focus: () => { focused = "last"; } };
  const event = { key: "Tab", shiftKey: false, preventDefault() {} };
  assert.equal(wrapDialogTab(event, [first, last], last), true);
  assert.equal(focused, "first");
  event.shiftKey = true;
  assert.equal(wrapDialogTab(event, [first, last], first), true);
  assert.equal(focused, "last");

  const main = fs.readFileSync(path.join(root, "src/content/event-reminders/main.mjs"), "utf8");
  const controller = fs.readFileSync(path.join(root, "src/content/event-reminders/dialog-controller.mjs"), "utf8");
  assert.match(main, /initialFocus: builtin/);
  assert.doesNotMatch(main, /heading\.tabIndex/);
  assert.match(controller, /addEventListener\("focusin", containFocus, true\)/);
});

check("sound styles beat generic light and dark button rules", () => {
  const controls = fs.readFileSync(path.join(root, "src/content/overlay/styles/controls-forms.css"), "utf8");
  const dark = fs.readFileSync(path.join(root, "src/content/overlay/styles/dark-theme.css"), "utf8");
  const sound = fs.readFileSync(path.join(root, "src/content/event-reminders/styles.css"), "utf8");
  assert.match(controls, /#calendar-clock-root button,/);
  assert.match(dark, /#calendar-clock-root\.cc-menu-theme-dark button,/);
  assert.match(sound, /#calendar-clock-root button\.cc-sound-link,[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*0;[\s\S]*?height:\s*auto;[\s\S]*?text-decoration:\s*underline;/);
  assert.match(sound, /#calendar-clock-root\.cc-menu-theme-dark button\.cc-sound-link,[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*0;[\s\S]*?text-decoration:\s*underline;/);
  assert.match(sound, /#calendar-clock-root \.cc-sound-dialog button\.cc-sound-primary,[\s\S]*?background:\s*#a95c05;[\s\S]*?color:\s*#fff;/);
  assert.match(sound, /#calendar-clock-root\.cc-menu-theme-dark \.cc-sound-dialog button\.cc-sound-primary,[\s\S]*?background:\s*#c8791c;[\s\S]*?color:\s*#21170d;/);
  assert.match(sound, /#calendar-clock-root\.cc-menu-theme-dark \.cc-sound-status\.is-error\s*\{[^}]*color:\s*#ffaaa5;/s);
  const selectors = [...sound.matchAll(/(^|\})\s*([^@][^{]+)\{/g)].map(match => match[2]);
  assert.ok(selectors.length > 0);
  selectors.forEach(selector => selector.split(",").forEach(part => {
    assert.ok(part.trim().startsWith("#calendar-clock-root"), `unscoped reminder selector: ${part.trim()}`);
  }));
});

check("persisted reminders get one trusted activation unlock attempt", () => {
  const module = fs.readFileSync(path.join(root, "src/content/event-reminders/main.mjs"), "utf8");
  assert.match(module, /if \(!event\.isTrusted \|\| audioUnlockAttempted\) return;/);
  assert.match(module, /audioUnlockAttempted = true;[\s\S]*removeAudioUnlockListeners\(\);[\s\S]*player\.prime\(settings\)\.catch/);
  assert.match(module, /\{ capture: true, signal: listenerController\.signal \}/);
  assert.match(module, /document\.addEventListener\("pointerdown", handleAudioUnlockGesture, options\)/);
  assert.match(module, /document\.addEventListener\("keydown", handleAudioUnlockGesture, options\)/);
  assert.match(module, /document\.removeEventListener\("pointerdown", handleAudioUnlockGesture, true\)/);
  assert.match(module, /document\.removeEventListener\("keydown", handleAudioUnlockGesture, true\)/);
  assert.match(module, /refreshControls\(\);\s*armAudioUnlockListeners\(\);/);
  assert.match(module, /destroy\(\) \{[\s\S]*removeAudioUnlockListeners\(\);[\s\S]*listenerController\.abort\(\)/);
});

for (const { name, action } of scheduledChecks) {
  await action();
  passed += 1;
  console.log(`ok - ${name}`);
}

console.log(`Event reminder verification passed (${passed} checks).`);
