import {
  BUILTIN_SOUND_NAME, MAX_SOURCE_SECONDS, MIN_CLIP_SECONDS, ReminderScheduler,
  clampLeadSeconds, clampTrim, getSoundTooltip, normalizeReminderSettings,
  sanitizeFilename, validateFileMetadata
} from "./helpers.mjs";
import { AudioStorageClient } from "./storage-client.mjs";
import { SegmentPlayer } from "./player.mjs";
import { createModalFocusBoundary, UploadGenerationGuard } from "./dialog-controller.mjs";
import {
  cleanupOrphanSounds, clearSelectedSoundAndCleanup, saveSoundSelection
} from "./sound-persistence.mjs";

const STATE_KEY = "calendarClockOverlayState";

function setStateSound(state, settings) {
  state.eventReminderStartEnabled = settings.startEnabled;
  state.eventReminderStartLeadSeconds = settings.startLeadSeconds;
  state.eventReminderEndEnabled = settings.endEnabled;
  state.eventReminderEndLeadSeconds = settings.endLeadSeconds;
  state.eventReminderSoundKind = settings.soundKind;
  state.eventReminderSoundId = settings.soundId;
  state.eventReminderSoundName = settings.soundName;
  state.eventReminderSourceDuration = settings.sourceDuration;
  state.eventReminderClipStart = settings.clipStart;
  state.eventReminderClipDuration = settings.clipDuration;
}

function saveState(runtime, nextState) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set({ [STATE_KEY]: nextState }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message)); else resolve();
      });
    } catch (error) { reject(error); }
  });
}

function createElement(document, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function injectStyles(document, runtime) {
  if (document.getElementById("calendar-clock-event-reminder-styles")) return;
  try {
    const response = await fetch(runtime.getURL("src/content/event-reminders/styles.css"));
    if (!response.ok) return;
    const style = createElement(document, "style");
    style.id = "calendar-clock-event-reminder-styles";
    style.textContent = await response.text();
    document.documentElement.appendChild(style);
  } catch (_error) { /* optional presentation */ }
}

function installSoundDialog({ document, root, getState, runtime, storage, player, onSaved }) {
  let modal = null;
  let returnFocus = null;
  let unsubscribePreview = null;
  let focusBoundary = null;
  let modalSession = 0;
  const uploadGuard = new UploadGenerationGuard();

  function close() {
    if (!modal) return;
    uploadGuard.closeSession(modalSession);
    player.stop();
    unsubscribePreview?.();
    unsubscribePreview = null;
    focusBoundary?.destroy({ restoreFocus: false });
    focusBoundary = null;
    modal.remove();
    modal = null;
    returnFocus?.focus?.();
    returnFocus = null;
  }

  async function open(trigger) {
    close();
    returnFocus = trigger;
    modalSession = uploadGuard.openSession();
    const session = modalSession;
    let draft = { ...normalizeReminderSettings(getState()) };
    let pendingBlob = null;
    let pendingBuffer = null;
    let savingInFlight = false;

    modal = createElement(document, "div", "cc-sound-modal");
    const sessionModal = modal;
    const isSessionOpen = () => modal === sessionModal && uploadGuard.session === session;
    const dialog = createElement(document, "div", "cc-sound-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "cc-sound-dialog-title");
    const heading = createElement(document, "h2", "", "Sound settings");
    heading.id = "cc-sound-dialog-title";
    const current = createElement(document, "div", "cc-sound-current");
    const sourceActions = createElement(document, "div", "cc-sound-source-actions");
    const builtin = createElement(document, "button", "", "Use built-in sound");
    builtin.type = "button";
    const upload = createElement(document, "button", "", "Upload your sound...");
    upload.type = "button";
    const file = createElement(document, "input");
    file.type = "file";
    file.accept = ".mp3,.wav,.ogg,.m4a,.aac,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac";
    file.hidden = true;
    sourceActions.append(builtin, upload, file);

    const trimBox = createElement(document, "div", "cc-sound-trim");
    trimBox.appendChild(createElement(document, "strong", "", "Trim playback"));
    const visual = createElement(document, "div", "cc-sound-trim-visual");
    const selected = createElement(document, "span");
    visual.appendChild(selected);
    const fields = createElement(document, "div", "cc-sound-fields");
    const startLabel = createElement(document, "label", "", "Start (seconds)");
    const start = createElement(document, "input");
    start.type = "number"; start.min = "0"; start.step = "0.05";
    startLabel.appendChild(start);
    const durationLabel = createElement(document, "label", "", "Duration (seconds)");
    const duration = createElement(document, "input");
    duration.type = "number"; duration.min = String(MIN_CLIP_SECONDS); duration.max = "30"; duration.step = "0.05";
    durationLabel.appendChild(duration);
    fields.append(startLabel, durationLabel);
    trimBox.append(visual, fields);

    const previewActions = createElement(document, "div", "cc-sound-preview-actions");
    const preview = createElement(document, "button", "", "Preview");
    preview.type = "button";
    const stop = createElement(document, "button", "", "Stop");
    stop.type = "button";
    previewActions.append(preview, stop);
    const status = createElement(document, "div", "cc-sound-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const footer = createElement(document, "div", "cc-sound-dialog-footer");
    const reset = createElement(document, "button", "", "Reset to default");
    reset.type = "button";
    const cancel = createElement(document, "button", "", "Cancel");
    cancel.type = "button";
    const save = createElement(document, "button", "cc-sound-primary", "Save");
    save.type = "button";
    footer.append(reset, cancel, save);
    dialog.append(heading, current, sourceActions, trimBox, previewActions, status, footer);
    modal.appendChild(dialog);
    root.appendChild(modal);

    const setStatus = (text = "", error = false) => {
      status.textContent = text;
      status.classList.toggle("is-error", error);
    };
    const renderControlState = () => {
      const uploadInFlight = uploadGuard.uploadInFlight;
      builtin.disabled = uploadInFlight || savingInFlight;
      upload.disabled = uploadInFlight || savingInFlight;
      file.disabled = uploadInFlight || savingInFlight;
      preview.disabled = uploadInFlight || savingInFlight;
      reset.disabled = uploadInFlight || savingInFlight;
      save.disabled = uploadInFlight || savingInFlight;
    };
    const render = () => {
      const trim = clampTrim(draft.clipStart, draft.clipDuration, draft.sourceDuration);
      draft.clipStart = trim.start; draft.clipDuration = trim.duration;
      current.textContent = `Selected sound: ${draft.soundName}`;
      start.value = String(trim.start);
      duration.value = String(trim.duration);
      start.max = String(Math.max(0, draft.sourceDuration - MIN_CLIP_SECONDS));
      const total = Math.max(MIN_CLIP_SECONDS, draft.sourceDuration);
      selected.style.left = `${trim.start / total * 100}%`;
      selected.style.width = `${trim.duration / total * 100}%`;
    };
    const applyFields = () => {
      const trim = clampTrim(start.value, duration.value, draft.sourceDuration);
      draft.clipStart = trim.start; draft.clipDuration = trim.duration;
      render();
    };
    start.addEventListener("change", applyFields);
    duration.addEventListener("change", applyFields);
    builtin.addEventListener("click", () => {
      uploadGuard.invalidate(session);
      player.stop(); pendingBlob = null; pendingBuffer = null;
      draft = { ...draft, soundKind: "builtin", soundId: null, soundName: BUILTIN_SOUND_NAME, sourceDuration: 19.84, clipStart: 0, clipDuration: 5 };
      setStatus("Built-in sound selected. Save to apply it."); render(); renderControlState();
    });
    upload.addEventListener("click", () => { if (!uploadGuard.uploadInFlight) file.click(); });
    file.addEventListener("change", async () => {
      const chosen = file.files?.[0];
      if (!chosen) { file.value = ""; return; }
      const ticket = uploadGuard.begin(session);
      if (!ticket) return;
      renderControlState();
      const metadataError = validateFileMetadata(chosen);
      if (metadataError) {
        if (isSessionOpen() && uploadGuard.finish(ticket)) {
          setStatus(metadataError, true);
          file.value = "";
          renderControlState();
        }
        return;
      }
      setStatus("Checking audio file...");
      try {
        const decoded = await player.validateBlob(chosen);
        if (!isSessionOpen() || !uploadGuard.isCurrent(ticket)) return;
        if (!Number.isFinite(decoded.duration)) throw new Error("The decoded audio duration is invalid.");
        if (decoded.duration < MIN_CLIP_SECONDS) throw new Error("The decoded audio must be at least 0.25 seconds long.");
        if (decoded.duration > MAX_SOURCE_SECONDS) throw new Error("The decoded audio must be 60 seconds or shorter.");
        pendingBlob = chosen;
        pendingBuffer = decoded.buffer;
        const trim = clampTrim(0, 5, decoded.duration);
        draft = {
          ...draft, soundKind: "custom", soundId: null, soundName: sanitizeFilename(chosen.name),
          sourceDuration: decoded.duration, clipStart: trim.start, clipDuration: trim.duration
        };
        setStatus("Custom sound is ready. Save to apply it."); render();
      } catch (error) {
        if (!isSessionOpen() || !uploadGuard.isCurrent(ticket)) return;
        setStatus(`This file could not be decoded: ${String(error?.message || error)}`, true);
      } finally {
        if (isSessionOpen() && uploadGuard.finish(ticket)) {
          file.value = "";
          renderControlState();
        }
      }
    });
    preview.addEventListener("click", async () => {
      if (uploadGuard.uploadInFlight || savingInFlight) return;
      applyFields();
      if (player.active) { player.stop(); return; }
      setStatus("Playing preview...");
      try {
        await player.play(draft, pendingBuffer, { onFallback: error => {
          if (isSessionOpen()) setStatus(`Custom sound unavailable; playing the built-in preview: ${String(error?.message || error)}`, true);
        } });
      } catch (error) {
        if (isSessionOpen()) setStatus(`Preview failed: ${String(error?.message || error)}`, true);
      }
    });
    stop.addEventListener("click", () => { player.stop(); setStatus("Preview stopped."); });
    reset.addEventListener("click", () => {
      uploadGuard.invalidate(session);
      player.stop(); pendingBlob = null; pendingBuffer = null;
      draft = { ...draft, soundKind: "builtin", soundId: null, soundName: BUILTIN_SOUND_NAME, sourceDuration: 19.84, clipStart: 0, clipDuration: 5 };
      setStatus("Default sound and trim restored. Save to apply them."); render(); renderControlState();
    });
    cancel.addEventListener("click", close);
    save.addEventListener("click", async () => {
      if (uploadGuard.uploadInFlight || savingInFlight) return;
      applyFields();
      savingInFlight = true; renderControlState(); setStatus("Saving sound settings...");
      const targetState = getState();
      const previousSoundId = normalizeReminderSettings(targetState).soundId;
      let nextState = null;
      try {
        await saveSoundSelection({
          storage,
          settings: draft,
          previousSoundId,
          pendingBlob,
          saveMetadata: committedSettings => {
            nextState = { ...targetState };
            setStateSound(nextState, committedSettings);
            return saveState(runtime, nextState);
          },
          commitMemory: committedSettings => {
            draft = { ...committedSettings };
            Object.assign(targetState, nextState);
          },
          warn: error => window.console.warn("Calendar Clock custom sound cleanup failed", error)
        });
        onSaved();
        close();
      } catch (error) {
        if (isSessionOpen()) {
          savingInFlight = false;
          renderControlState();
          setStatus(`Sound settings were not saved: ${String(error?.message || error)}`, true);
        }
      }
    });
    modal.addEventListener("mousedown", event => { if (event.target === modal) close(); });
    modal.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      focusBoundary?.handleTab(event);
    });
    unsubscribePreview = player.onActive(active => {
      preview.textContent = active ? "Stop" : "Preview";
      preview.setAttribute("aria-pressed", String(active));
    });
    render(); renderControlState();
    focusBoundary = createModalFocusBoundary({ document, modal, dialog, initialFocus: builtin, returnFocus });
  }

  return { open, close };
}

export async function install(options = {}) {
  const { window, document, root, getState, runtime, getEvents, onContextInvalidated, setDebugPlaying } = options;
  if (!window || !document || !root || typeof getState !== "function" || !getState() || !runtime?.id) return null;
  await injectStyles(document, runtime);
  const storage = new AudioStorageClient({ document, window, runtime });
  const listenerController = new AbortController();
  const player = new SegmentPlayer({
    window, runtime, storage,
    onActiveChange: active => setDebugPlaying?.(active),
    onDiagnostic: error => window.console.warn("Calendar Clock custom sound playback fell back to built-in", error)
  });
  let settings = normalizeReminderSettings(getState());
  const scheduler = new ReminderScheduler({ onDue: () => player.play(settings).catch(() => {}) });
  const startToggle = root.querySelector("[data-cc-event-reminder-start]");
  const startLead = root.querySelector("[data-cc-event-reminder-start-lead]");
  const endToggle = root.querySelector("[data-cc-event-reminder-end]");
  const endLead = root.querySelector("[data-cc-event-reminder-end-lead]");
  const soundButtons = Array.from(root.querySelectorAll("[data-cc-event-reminder-sound]"));
  if (!startToggle || !startLead || !endToggle || !endLead || !soundButtons.length) {
    scheduler.destroy(); player.destroy(); storage.destroy(); return null;
  }

  let audioUnlockArmed = false;
  let audioUnlockAttempted = false;
  const handleAudioUnlockGesture = event => {
    if (!event.isTrusted || audioUnlockAttempted) return;
    audioUnlockAttempted = true;
    removeAudioUnlockListeners();
    player.prime(settings).catch(() => {});
  };
  function removeAudioUnlockListeners() {
    if (!audioUnlockArmed) return;
    audioUnlockArmed = false;
    document.removeEventListener("pointerdown", handleAudioUnlockGesture, true);
    document.removeEventListener("keydown", handleAudioUnlockGesture, true);
  }
  function armAudioUnlockListeners() {
    if (audioUnlockArmed || audioUnlockAttempted || (!settings.startEnabled && !settings.endEnabled)) return;
    audioUnlockArmed = true;
    const options = { capture: true, signal: listenerController.signal };
    document.addEventListener("pointerdown", handleAudioUnlockGesture, options);
    document.addEventListener("keydown", handleAudioUnlockGesture, options);
  }

  const persistControls = () => {
    settings = {
      ...settings,
      startEnabled: startToggle.checked,
      startLeadSeconds: clampLeadSeconds(startLead.value),
      endEnabled: endToggle.checked,
      endLeadSeconds: clampLeadSeconds(endLead.value)
    };
    const currentState = getState();
    setStateSound(currentState, settings);
    startLead.value = String(settings.startLeadSeconds);
    endLead.value = String(settings.endLeadSeconds);
    saveState(runtime, { ...currentState }).catch(() => {});
    scheduler.update(getEvents(), settings);
    if (settings.startEnabled || settings.endEnabled) player.prime(settings).catch(() => {});
    if (settings.startEnabled || settings.endEnabled) armAudioUnlockListeners();
    else removeAudioUnlockListeners();
  };
  function refreshControls() {
    const currentState = getState();
    settings = normalizeReminderSettings(currentState);
    setStateSound(currentState, settings);
    startToggle.checked = settings.startEnabled; startToggle.disabled = false;
    startLead.value = String(settings.startLeadSeconds); startLead.disabled = false;
    endToggle.checked = settings.endEnabled; endToggle.disabled = false;
    endLead.value = String(settings.endLeadSeconds); endLead.disabled = false;
    const tooltip = getSoundTooltip(settings);
    soundButtons.forEach(button => { button.disabled = false; button.title = tooltip; button.setAttribute("aria-label", tooltip); });
    scheduler.update(getEvents(), settings);
  }
  const dialog = installSoundDialog({ document, root, getState, runtime, storage, player, onSaved: refreshControls });
  const listenerOptions = { signal: listenerController.signal };
  [startToggle, endToggle].forEach(input => input.addEventListener("change", persistControls, listenerOptions));
  [startLead, endLead].forEach(input => input.addEventListener("change", persistControls, listenerOptions));
  soundButtons.forEach(button => button.addEventListener("click", () => dialog.open(button).catch(error => window.console.warn("Calendar Clock sound dialog failed", error)), listenerOptions));
  refreshControls();
  armAudioUnlockListeners();
  cleanupOrphanSounds(
    storage,
    settings.soundKind === "custom" ? settings.soundId : null,
    error => window.console.warn("Calendar Clock stale custom sound cleanup failed", error)
  );

  const api = {
    updateEvents(events = getEvents()) { scheduler.update(events, settings); },
    updateSettings() { refreshControls(); },
    syncState({ clearCustomBlob = false } = {}) {
      const selectedSoundIdToClear = clearCustomBlob && settings.soundKind === "custom"
        ? settings.soundId
        : null;
      dialog.close();
      player.stop();
      removeAudioUnlockListeners();
      refreshControls();
      armAudioUnlockListeners();
      const warn = error => {
        window.console.warn("Calendar Clock custom sound cleanup failed", error);
      };
      if (clearCustomBlob) {
        return clearSelectedSoundAndCleanup(storage, selectedSoundIdToClear, warn);
      }
      const activeSoundId = settings.soundKind === "custom" ? settings.soundId : null;
      return cleanupOrphanSounds(storage, activeSoundId, warn);
    },
    togglePlayback() { if (player.active) player.stop(); else player.play(settings).catch(() => {}); },
    destroy() {
      removeAudioUnlockListeners();
      listenerController.abort();
      dialog.close(); scheduler.destroy(); player.destroy(); storage.destroy();
      startToggle.disabled = true; startLead.disabled = true; endToggle.disabled = true; endLead.disabled = true;
      soundButtons.forEach(button => { button.disabled = true; });
      if (globalThis.calendarClockEventReminders === api) globalThis.calendarClockEventReminders = null;
    }
  };
  onContextInvalidated?.(() => api.destroy());
  window.addEventListener("pagehide", () => api.destroy(), { once: true, signal: listenerController.signal });
  return api;
}
