// Creates and controls the Calendar Clock overlay menu, mini/full modes, dragging, and iframe sync.
const CALENDAR_CLOCK_WINDOW_START_MARKER_STYLE_PRESETS = {
  subtle: { shape: "line", width: 2, dots: 14, transparency: 55 },
  dots: { shape: "dots", width: 3, dots: 14, transparency: 8 },
  line: { shape: "line", width: 3, dots: 14, transparency: 8 },
  strong: { shape: "line", width: 5, dots: 10, transparency: 0 },
  glow: { shape: "dots", width: 5, dots: 9, transparency: 0 }
};
const CALENDAR_CLOCK_LABEL_SHORTEN_NEVER = 305;
const CALENDAR_CLOCK_EVENT_LABEL_ANCHORS = ["center", "start", "end"];
const CALENDAR_CLOCK_ROOT_TEMPLATE_PATH = "src/content/overlay/templates/root.html";
const CALENDAR_CLOCK_HELP_TEMPLATE_PATH = "src/content/overlay/templates/help.html";
const CALENDAR_CLOCK_WARNING_ROWS_TEMPLATE_PATH = "src/content/overlay/templates/warning-rows.html";
const CALENDAR_CLOCK_TICK_SOUND_PATH = "src/content/sound/mechanical-clock/mechanical-clock.ogg";
const CALENDAR_CLOCK_TICK_SOUND_DEFAULT_DURATION_MS = 5000;
const CALENDAR_CLOCK_TICK_SOUND_MAX_DURATION_MS = 60000;
const CALENDAR_CLOCK_TICK_SOUND_FADE_SECONDS = 0.04;
const CALENDAR_CLOCK_TICK_SOUND_GAIN = 0.72;
let calendarClockUiPromise = null;
let calendarClockWarningRowTemplates = null;

function applyWindowStartMarkerStylePreset(style) {
  const preset = CALENDAR_CLOCK_WINDOW_START_MARKER_STYLE_PRESETS[style];
  if (!preset) {
    calendarClockState.windowStartMarkerStyle = "custom";
    return;
  }

  calendarClockState.windowStartMarkerStyle = style;
  calendarClockState.windowStartMarkerShape = preset.shape;
  calendarClockState.windowStartMarkerWidth = preset.width;
  calendarClockState.windowStartMarkerDots = preset.dots;
  calendarClockState.windowStartMarkerTransparency = preset.transparency;
}

function markWindowStartMarkerPresetCustom() {
  calendarClockState.windowStartMarkerStyle = "custom";
}

function blurFocusedElementInside(container) {
  const activeElement = document.activeElement;
  if (activeElement && container?.contains(activeElement) && typeof activeElement.blur === "function") {
    activeElement.blur();
  }
}

function requireCalendarClockElement(container, selector, name) {
  const element = container?.querySelector(selector);
  if (!element) throw new Error(`Calendar Clock template missing ${name}: ${selector}`);
  return element;
}

function getCalendarClockTickAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!calendarClockTickAudioContext) calendarClockTickAudioContext = new AudioContextClass();
  return calendarClockTickAudioContext;
}

function updateCalendarClockDebugSoundButton() {
  const button = calendarClockDebug?.querySelector("[data-cc-action='play-debug-sound']");
  if (!button) return;

  button.textContent = calendarClockTickSoundActive ? "Stop sound" : "Play sound";
  button.setAttribute("aria-pressed", String(calendarClockTickSoundActive));
  button.title = calendarClockTickSoundActive
    ? "Stop the reminder sound."
    : "Play the selected reminder sound and trim. Press again to stop.";
}

function setCalendarClockTickSoundActive(active) {
  calendarClockTickSoundActive = active === true;
  updateCalendarClockDebugSoundButton();
}

function loadCalendarClockTickAudioBuffer(context) {
  if (calendarClockTickAudioBuffer) return Promise.resolve(calendarClockTickAudioBuffer);
  if (calendarClockTickAudioBufferPromise) return calendarClockTickAudioBufferPromise;

  calendarClockTickAudioBufferPromise = fetch(chrome.runtime.getURL(CALENDAR_CLOCK_TICK_SOUND_PATH))
    .then(response => {
      if (!response.ok) throw new Error(`Mechanical clock sound failed to load (${response.status})`);
      return response.arrayBuffer();
    })
    .then(data => context.decodeAudioData(data))
    .then(buffer => {
      calendarClockTickAudioBuffer = buffer;
      return buffer;
    })
    .catch(error => {
      calendarClockTickAudioBufferPromise = null;
      throw error;
    });
  return calendarClockTickAudioBufferPromise;
}

function stopCalendarClockTickSound() {
  calendarClockTickSoundPlaybackId += 1;
  clearTimeout(calendarClockTickSoundStopTimerId);
  calendarClockTickSoundStopTimerId = null;

  const playback = calendarClockTickSoundPlayback;
  calendarClockTickSoundPlayback = null;
  setCalendarClockTickSoundActive(false);
  if (!playback) return;

  const now = playback.context.currentTime;
  try {
    playback.gain.gain.cancelScheduledValues(now);
    playback.gain.gain.setValueAtTime(Math.max(0.0001, playback.gain.gain.value), now);
    playback.gain.gain.exponentialRampToValueAtTime(0.0001, now + CALENDAR_CLOCK_TICK_SOUND_FADE_SECONDS);
    playback.source.stop(now + CALENDAR_CLOCK_TICK_SOUND_FADE_SECONDS + 0.01);
  } catch (_error) {
    try {
      playback.source.stop();
    } catch (_stopError) { /* already stopped */ }
  }
}

function primeCalendarClockTickSound() {
  try {
    const context = getCalendarClockTickAudioContext();
    if (!context) return;
    const resumePromise = context.state === "suspended" ? context.resume() : Promise.resolve();
    Promise.all([resumePromise, loadCalendarClockTickAudioBuffer(context)])
      .catch(error => calendarClockWarn("tick sound prime skipped", error));
  } catch (error) {
    calendarClockWarn("tick sound prime skipped", error);
  }
}

async function playCalendarClockTickSound(durationMs = CALENDAR_CLOCK_TICK_SOUND_DEFAULT_DURATION_MS) {
  stopCalendarClockTickSound();
  const playbackId = calendarClockTickSoundPlaybackId;
  setCalendarClockTickSoundActive(true);

  try {
    const context = getCalendarClockTickAudioContext();
    if (!context) throw new Error("Web Audio is unavailable");

    const parsedDuration = Number(durationMs);
    const safeDurationMs = Number.isFinite(parsedDuration)
      ? Math.min(CALENDAR_CLOCK_TICK_SOUND_MAX_DURATION_MS, Math.max(250, Math.round(parsedDuration)))
      : CALENDAR_CLOCK_TICK_SOUND_DEFAULT_DURATION_MS;
    const resumePromise = context.state === "suspended" ? context.resume() : Promise.resolve();
    const [, buffer] = await Promise.all([resumePromise, loadCalendarClockTickAudioBuffer(context)]);
    if (playbackId !== calendarClockTickSoundPlaybackId) return false;

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.setValueAtTime(CALENDAR_CLOCK_TICK_SOUND_GAIN, context.currentTime);
    source.connect(gain);
    gain.connect(context.destination);
    calendarClockTickSoundPlayback = { context, source, gain, playbackId };
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (calendarClockTickSoundPlayback?.source !== source) return;
      calendarClockTickSoundPlayback = null;
      clearTimeout(calendarClockTickSoundStopTimerId);
      calendarClockTickSoundStopTimerId = null;
      setCalendarClockTickSoundActive(false);
    };
    source.start();
    calendarClockTickSoundStopTimerId = setTimeout(() => {
      if (calendarClockTickSoundPlayback?.playbackId === playbackId) stopCalendarClockTickSound();
    }, safeDurationMs);
    return true;
  } catch (error) {
    if (playbackId === calendarClockTickSoundPlaybackId) stopCalendarClockTickSound();
    calendarClockWarn("tick sound skipped", error);
    return false;
  }
}

function disposeCalendarClockTickSound() {
  stopCalendarClockTickSound();
  calendarClockTickAudioContext?.close?.().catch(() => {});
  calendarClockTickAudioContext = null;
  calendarClockTickAudioBuffer = null;
  calendarClockTickAudioBufferPromise = null;
}

onCalendarClockContextInvalidated(disposeCalendarClockTickSound);
window.addEventListener?.("pagehide", disposeCalendarClockTickSound, { once: true });

function formatEventLabelShortenThreshold(value) {
  const safeValue = clampIntegerRange(value, CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelShortenThreshold, 50, CALENDAR_CLOCK_LABEL_SHORTEN_NEVER);
  return safeValue >= CALENDAR_CLOCK_LABEL_SHORTEN_NEVER ? "Never" : `${safeValue}%`;
}

function getEventLabelAnchorSliderValue(value) {
  const index = CALENDAR_CLOCK_EVENT_LABEL_ANCHORS.indexOf(normalizeEventLabelAnchor(value));
  return index < 0 ? 0 : index;
}

function getEventLabelAnchorFromSlider(value) {
  const index = clampIntegerRange(value, 0, 0, CALENDAR_CLOCK_EVENT_LABEL_ANCHORS.length - 1);
  return CALENDAR_CLOCK_EVENT_LABEL_ANCHORS[index];
}

function formatEventLabelAnchor(value) {
  return {
    center: "Center",
    start: "Start",
    end: "End"
  }[normalizeEventLabelAnchor(value)];
}

function getWindowStartMarkerHelpText() {
  const { startDate, endDate } = getWindowDateRange();
  const startText = formatWindowDateTime(startDate);
  const endText = formatWindowDateTime(endDate);

  if (calendarClockState.followNow) {
    const pastText = formatFollowRadiusHours(calendarClockState.followRadiusHours);
    const futureText = formatFollowRadiusHours(getFollowFutureHours(calendarClockState.followRadiusHours));
    return calendarClockState.radial24Hour
      ? `Marks ${startText}, the moving 24h window start. The clock shows ${pastText}h back and ${futureText}h forward, until ${endText}.`
      : `Marks ${startText}, ${pastText === "0" ? "at now" : `${pastText}h before now`}. Events before this are outside the current window; the clock shows through ${endText}.`;
  }

  return `Marks ${startText}, the start of the clock window. Events before this are outside the clock view; the window ends at ${endText}.`;
}

async function ensureCalendarClockUi() {
  if (calendarClockRoot) return calendarClockRoot;
  if (calendarClockUiPromise) return calendarClockUiPromise;
  if (!canUseCalendarClockExtensionApi()) {
    throw new Error("Calendar Clock extension API is unavailable.");
  }

  calendarClockUiPromise = buildCalendarClockUi().catch(error => {
    calendarClockRoot?.remove();
    calendarClockRoot = null;
    calendarClockFrame = null;
    calendarClockPanel = null;
    calendarClockTimePanel = null;
    calendarClockDebug = null;
    calendarClockHelp = null;
    calendarClockUiPromise = null;
    calendarClockWarn("failed to create overlay UI", error);
    throw error;
  });
  return calendarClockUiPromise;
}

async function buildCalendarClockUi() {
  ensureCalendarClockStyles();

  calendarClockRoot = document.createElement("div");
  calendarClockRoot.id = "calendar-clock-root";
  const manifest = chrome.runtime.getManifest();
  const buildName = "calendar-clock-features";
  const versionText = `Calendar Clock v${manifest.version} · build: ${buildName}`;
  calendarClockRoot.appendChild(await cloneCalendarClockTemplate(CALENDAR_CLOCK_ROOT_TEMPLATE_PATH));

  const versionNote = calendarClockRoot.querySelector("[data-cc-version-note]");
  if (versionNote) versionNote.textContent = versionText;
  const extensionVersion = calendarClockRoot.querySelector("[data-cc-extension-version]");
  if (extensionVersion) extensionVersion.textContent = `v${manifest.version}`;

  document.documentElement.appendChild(calendarClockRoot);
  calendarClockFrame = requireCalendarClockElement(calendarClockRoot, "[data-cc-clock-frame]", "clock iframe");
  calendarClockFrame.src = chrome.runtime.getURL("src/clock/popup.html?embedded=1");
  calendarClockPanel = calendarClockRoot.querySelector(".cc-panel-view");
  calendarClockTimePanel = calendarClockRoot.querySelector(".cc-panel-time");
  calendarClockDebug = calendarClockRoot.querySelector(".cc-debug");
  calendarClockHelp = calendarClockRoot.querySelector(".cc-help");

  calendarClockFrameReady = false;
  calendarClockFrame.addEventListener("load", () => {
    calendarClockFrameReady = true;
    const shouldRebuild = calendarClockPendingFrameRebuild;
    calendarClockPendingFrameRebuild = false;
    syncClockFrame({ rebuild: shouldRebuild });
  });
  await loadCalendarClockWarningTemplates();
  await loadCalendarClockDebugTemplates();
  bindPanelControls();
  updatePanelControls();
  const initialTimePanelSizeChanged = calendarClockState.timePanelOpen && applyInitialTimePanelSize();
  setClockMode(calendarClockState.mode, { skipSave: true });
  if (initialTimePanelSizeChanged) saveCalendarClockState();
  renderDebugPanel();
  await renderHelpPanel();
  persistPanelPositionIfChanged();
  return calendarClockRoot;
}

async function renderHelpPanel() {
  if (!calendarClockHelp) return;

  calendarClockHelp.replaceChildren(await cloneCalendarClockTemplate(CALENDAR_CLOCK_HELP_TEMPLATE_PATH));
  const captureLimit = calendarClockHelp.querySelector("[data-cc-capture-limit]");
  if (captureLimit) captureLimit.textContent = String(normalizeCalendarClockCaptureLimit(calendarClockState.captureLimit));

  const collapseButton = calendarClockHelp.querySelector("[data-cc-action='help-panel-collapse']");
  if (collapseButton) {
    collapseButton.textContent = calendarClockState.helpCollapsed ? "+" : "_";
    collapseButton.setAttribute("aria-label", calendarClockState.helpCollapsed ? "Expand help panel" : "Collapse help panel");
  }
}

async function loadCalendarClockWarningTemplates() {
  if (calendarClockWarningRowTemplates) return calendarClockWarningRowTemplates;

  const fragment = await cloneCalendarClockTemplate(CALENDAR_CLOCK_WARNING_ROWS_TEMPLATE_PATH);
  calendarClockWarningRowTemplates = new Map(
    Array.from(fragment.querySelectorAll("template[data-cc-warning-row]"), template => [
      template.dataset.ccWarningRow,
      template
    ])
  );
  return calendarClockWarningRowTemplates;
}

function cloneCalendarClockWarningRow(type) {
  const template = calendarClockWarningRowTemplates?.get(type);
  return template ? template.content.cloneNode(true) : document.createDocumentFragment();
}

function renderCalendarClockWarningRows(container, rows) {
  container.replaceChildren();

  if (rows.storageStatus?.kind === "history-trimmed") {
    const row = cloneCalendarClockWarningRow("storage-limit");
    const message = row.querySelector("[data-cc-storage-limit-message]");
    if (message) {
      message.textContent = `Local storage was full, so Calendar Clock removed ${rows.storageStatus.removedEventCount} oldest saved event(s). The newest ${rows.storageStatus.retainedEventCount} event(s) remain.`;
    }
    container.appendChild(row);
  } else if (rows.storageStatus?.kind === "write-failed") {
    const row = cloneCalendarClockWarningRow("storage-limit");
    const message = row.querySelector("[data-cc-storage-limit-message]");
    if (message) message.textContent = "Calendar Clock could not save this snapshot. Existing saved data was left unchanged.";
    container.appendChild(row);
  }

  if (rows.omittedCaptureCount) {
    const row = cloneCalendarClockWarningRow("capture-limit");
    const message = row.querySelector("[data-cc-capture-limit-message]");
    if (message) message.textContent = `${rows.captureLimitNotice}.`;
    container.appendChild(row);
  }

  if (rows.failedDateCount) {
    const row = cloneCalendarClockWarningRow("date-format");
    const count = row.querySelector("[data-cc-failed-date-count]");
    const email = row.querySelector("[data-cc-support-email]");
    if (count) count.textContent = String(rows.failedDateCount);
    if (email) {
      email.href = `mailto:${CALENDAR_CLOCK_SUPPORT_EMAIL}`;
      email.textContent = CALENDAR_CLOCK_SUPPORT_EMAIL;
    }
    container.appendChild(row);
  }

  if (rows.hiddenUndatedTaskCount) {
    const row = cloneCalendarClockWarningRow("undated-task");
    const count = row.querySelector("[data-cc-hidden-undated-task-count]");
    if (count) count.textContent = String(rows.hiddenUndatedTaskCount);
    container.appendChild(row);
  }
}

function bindPanelControls() {
  calendarClockRoot.querySelectorAll("[data-cc-mode]").forEach(button => {
    button.addEventListener("click", () => setClockMode(button.dataset.ccMode));
  });

  calendarClockRoot.querySelector("[data-cc-action='refresh']").addEventListener("click", event => {
    hardRefreshCalendarClockEventsFromToolbar(event.currentTarget);
  });
  calendarClockRoot.querySelector("[data-cc-action='time-panel-toggle']").addEventListener("click", () => {
    setTimePanelOpen(!calendarClockState.timePanelOpen);
  });
  calendarClockRoot.querySelector("[data-cc-action='time-panel-collapse']").addEventListener("click", () => {
    calendarClockState.timePanelOpen = true;
    calendarClockState.timePanelCollapsed = !calendarClockState.timePanelCollapsed;
    saveCalendarClockState();
    updateRootClasses();
    updatePanelControls();
  });
  calendarClockRoot.querySelector("[data-cc-action='time-panel-close']").addEventListener("click", () => {
    setTimePanelOpen(false);
  });
  calendarClockRoot.querySelector("[data-cc-action='fit']").addEventListener("click", fitWindowOnce);
  calendarClockRoot.querySelector("[data-cc-action='jump']").addEventListener("click", jumpToOutsideEventWindow);
  calendarClockRoot.querySelector("[data-cc-action='whats-new']").addEventListener("click", () => {
    const wasHelpOpen = calendarClockState.helpOpen;
    calendarClockWhatsNewOpen = true;
    calendarClockState.helpOpen = false;
    if (wasHelpOpen) saveCalendarClockState();
    updateRootClasses();
  });
  calendarClockRoot.querySelector("[data-cc-action='whats-new-back']").addEventListener("click", () => {
    calendarClockWhatsNewOpen = false;
    updateRootClasses();
  });
  calendarClockRoot.querySelector("[data-cc-action='help']").addEventListener("click", () => {
    calendarClockState.helpOpen = !calendarClockState.helpOpen;
    if (calendarClockState.helpOpen) {
      calendarClockState.debugOpen = false;
      calendarClockWhatsNewOpen = false;
    }
    saveCalendarClockState();
    updateRootClasses();
    renderHelpPanel()
      .then(persistPanelPositionIfChanged)
      .catch(error => calendarClockWarn("failed to render help panel", error));
  });
  calendarClockRoot.querySelector("[data-cc-action='debug']").addEventListener("click", () => {
    calendarClockState.debugOpen = !calendarClockState.debugOpen;
    if (calendarClockState.debugOpen) calendarClockState.helpOpen = false;
    saveCalendarClockState();
    updateRootClasses();
    renderDebugPanel();
    persistPanelPositionIfChanged();
  });
  calendarClockRoot.addEventListener("click", event => {
    if (!event.target.closest("[data-cc-action='open-debug']")) return;
    calendarClockState.debugOpen = true;
    calendarClockState.helpOpen = false;
    saveCalendarClockState();
    updateRootClasses();
    renderDebugPanel();
    persistPanelPositionIfChanged();
  });
  calendarClockDebug.addEventListener("click", event => {
    if (event.target.closest("[data-cc-action='play-debug-sound']")) {
      if (globalThis.calendarClockEventReminders?.togglePlayback) {
        globalThis.calendarClockEventReminders.togglePlayback();
      } else if (calendarClockTickSoundActive) stopCalendarClockTickSound();
      else playCalendarClockTickSound();
      return;
    }
    if (event.target.closest("[data-cc-action='copy-debug']")) {
      copySafeDebugJson();
      return;
    }
    if (event.target.closest("[data-cc-action='copy-debug-summary']")) {
      copySafeDebugText();
      return;
    }
    if (event.target.closest("[data-cc-action='copy-full-debug']")) {
      copyFullDebugJson();
      return;
    }
    if (event.target.closest("[data-cc-action='wipe-settings']")) {
      wipeCalendarClockAppSettingsToDefault();
      return;
    }
    if (event.target.closest("[data-cc-action='close-debug']")) {
      calendarClockState.debugOpen = false;
      saveCalendarClockState();
      updateRootClasses();
      return;
    }
    if (event.target.closest("[data-cc-action='debug-panel-collapse']")) {
      calendarClockState.debugCollapsed = !calendarClockState.debugCollapsed;
      saveCalendarClockState();
      updateRootClasses();
      renderDebugPanel();
      persistPanelPositionIfChanged();
      return;
    }
  });
  calendarClockDebug.addEventListener("change", event => {
    const pageOwnedInfoEl = event.target.closest("[data-cc-page-owned-info]");
    if (pageOwnedInfoEl) {
      setCalendarClockPageOwnedMode(pageOwnedInfoEl.checked);
      return;
    }
    const consoleLogsEl = event.target.closest("[data-cc-console-logs]");
    if (!consoleLogsEl) return;
    calendarClockState.consoleLogs = consoleLogsEl.checked;
    saveCalendarClockState();
    syncClockFrame();
    renderDebugPanel();
  });
  calendarClockHelp.addEventListener("click", event => {
    if (event.target.closest("[data-cc-action='close-help']")) {
      calendarClockState.helpOpen = false;
      saveCalendarClockState();
      updateRootClasses();
      return;
    }
    if (event.target.closest("[data-cc-action='help-panel-collapse']")) {
      calendarClockState.helpCollapsed = !calendarClockState.helpCollapsed;
      saveCalendarClockState();
      updateRootClasses();
      renderHelpPanel()
        .then(persistPanelPositionIfChanged)
        .catch(error => calendarClockWarn("failed to render help panel", error));
      return;
    }
  });

  const presetEl = calendarClockRoot.querySelector("[data-cc-window-preset]");
  const followNowEl = calendarClockRoot.querySelector("[data-cc-follow-now]");
  const followRadiusEl = calendarClockRoot.querySelector("[data-cc-follow-radius]");
  const customDividerTimeEl = calendarClockRoot.querySelector("[data-cc-custom-divider-time]");
  const customDividerSliderEl = calendarClockRoot.querySelector("[data-cc-custom-divider-slider]");
  const windowStartMarkerEl = calendarClockRoot.querySelector("[data-cc-window-start-marker]");
  const dividerSettingsToggleEl = calendarClockRoot.querySelector("[data-cc-action='divider-settings-toggle']");
  const dividerSettingsPanelEl = calendarClockRoot.querySelector("[data-cc-divider-settings-panel]");
  const dividerStyleEl = calendarClockRoot.querySelector("[data-cc-divider-style]");
  const dividerShapeEl = calendarClockRoot.querySelector("[data-cc-divider-shape]");
  const dividerColorEl = calendarClockRoot.querySelector("[data-cc-divider-color]");
  const dividerWidthEl = calendarClockRoot.querySelector("[data-cc-divider-width]");
  const dividerWidthOutputEl = calendarClockRoot.querySelector("[data-cc-divider-width-output]");
  const dividerDotsEl = calendarClockRoot.querySelector("[data-cc-divider-dots]");
  const dividerDotsOutputEl = calendarClockRoot.querySelector("[data-cc-divider-dots-output]");
  const dividerEmojiEl = calendarClockRoot.querySelector("[data-cc-divider-emoji]");
  const dividerLabelsEl = calendarClockRoot.querySelector("[data-cc-divider-labels]");
  const windowStartMarkerPulseEl = calendarClockRoot.querySelector("[data-cc-window-start-marker-pulse]");
  const dividerTransparencyEl = calendarClockRoot.querySelector("[data-cc-divider-transparency]");
  const dividerTransparencyOutputEl = calendarClockRoot.querySelector("[data-cc-divider-transparency-output]");
  const radial24HourEl = calendarClockRoot.querySelector("[data-cc-24-hour-radial]");
  const clockFaceEl = calendarClockRoot.querySelector("[data-cc-clock-face]");
  const magnifierEl = calendarClockRoot.querySelector("[data-cc-magnifier]");
  const magnifierSettingsToggleEl = calendarClockRoot.querySelector("[data-cc-action='magnifier-settings-toggle']");
  const magnifierSettingsPanelEl = calendarClockRoot.querySelector("[data-cc-magnifier-settings-panel]");
  const magnifierLensSizeEl = calendarClockRoot.querySelector("[data-cc-magnifier-lens-size]");
  const magnifierLensSizeOutputEl = calendarClockRoot.querySelector("[data-cc-magnifier-lens-size-output]");
  const magnifierHoverEl = calendarClockRoot.querySelector("[data-cc-magnifier-hover]");
  const magnifierCenterCursorEl = calendarClockRoot.querySelector("[data-cc-magnifier-center-cursor]");
  const magnifierAutoEl = calendarClockRoot.querySelector("[data-cc-magnifier-auto]");
  const magnifierAutoMinuteHandEl = calendarClockRoot.querySelector("[data-cc-magnifier-auto-minute-hand]");
  const magnifierAutoEventStartEl = calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-start]");
  const magnifierAutoEventStartAttentionEl = calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-start-attention]");
  const magnifierAutoEventEndEl = calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-end]");
  const magnifierAutoEventEndAttentionEl = calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-end-attention]");
  const magnifierAutoIntervalEl = calendarClockRoot.querySelector("[data-cc-magnifier-auto-interval]");
  const magnifierLaunchAutoEl = calendarClockRoot.querySelector("[data-cc-action='magnifier-launch-auto']");
  const arcsVisibleEl = calendarClockRoot.querySelector("[data-cc-arcs-visible]");
  const arcSettingsToggleEl = calendarClockRoot.querySelector("[data-cc-action='arc-settings-toggle']");
  const arcSettingsPanelEl = calendarClockRoot.querySelector("[data-cc-arc-settings-panel]");
  const eventLabelsEl = calendarClockRoot.querySelector("[data-cc-event-labels]");
  const eventLabelsSettingsToggleEl = calendarClockRoot.querySelector("[data-cc-action='event-labels-settings-toggle']");
  const eventLabelsSettingsPanelEl = calendarClockRoot.querySelector("[data-cc-event-labels-settings-panel]");
  const eventLabelStyleEl = calendarClockRoot.querySelector("[data-cc-event-label-style]");
  const eventLabelCustomColorRowEl = calendarClockRoot.querySelector("[data-cc-event-label-custom-color-row]");
  const eventLabelCustomColorEl = calendarClockRoot.querySelector("[data-cc-event-label-custom-color]");
  const eventLabelFontFamilyEl = calendarClockRoot.querySelector("[data-cc-event-label-font-family]");
  const eventLabelFontResetEl = calendarClockRoot.querySelector("[data-cc-action='event-label-font-reset']");
  const eventLabelFontSizeFullEl = calendarClockRoot.querySelector("[data-cc-event-label-font-size-full]");
  const eventLabelFontSizeFullOutputEl = calendarClockRoot.querySelector("[data-cc-event-label-font-size-full-output]");
  const eventLabelFontSizeMiniEl = calendarClockRoot.querySelector("[data-cc-event-label-font-size-mini]");
  const eventLabelFontSizeMiniOutputEl = calendarClockRoot.querySelector("[data-cc-event-label-font-size-mini-output]");
  const eventLabelProximityPriorityEl = calendarClockRoot.querySelector("[data-cc-event-label-proximity-priority]");
  const eventLabelMinLengthEl = calendarClockRoot.querySelector("[data-cc-event-label-min-length]");
  const eventLabelMinLengthOutputEl = calendarClockRoot.querySelector("[data-cc-event-label-min-length-output]");
  const eventLabelShortenThresholdEl = calendarClockRoot.querySelector("[data-cc-event-label-shorten-threshold]");
  const eventLabelShortenThresholdOutputEl = calendarClockRoot.querySelector("[data-cc-event-label-shorten-threshold-output]");
  const eventLabelAnchorEl = calendarClockRoot.querySelector("[data-cc-event-label-anchor]");
  const eventLabelAnchorOutputEl = calendarClockRoot.querySelector("[data-cc-event-label-anchor-output]");
  const eventLabelOpacityEl = calendarClockRoot.querySelector("[data-cc-event-label-opacity]");
  const eventLabelOpacityOutputEl = calendarClockRoot.querySelector("[data-cc-event-label-opacity-output]");
  const eventLabelArcDistanceEl = calendarClockRoot.querySelector("[data-cc-event-label-arc-distance]");
  const eventLabelArcDistanceOutputEl = calendarClockRoot.querySelector("[data-cc-event-label-arc-distance-output]");
  const menuDarkThemeEl = calendarClockRoot.querySelector("[data-cc-menu-dark-theme]");
  const densityEl = calendarClockRoot.querySelector("[data-cc-density-level]");
  const arcThicknessEl = calendarClockRoot.querySelector("[data-cc-arc-thickness-level]");
  const arcGapEl = calendarClockRoot.querySelector("[data-cc-arc-gap-level]");
  const captureLimitEl = calendarClockRoot.querySelector("[data-cc-capture-limit]");
  const arcSameLevelNonOverlappingEl = calendarClockRoot.querySelector("[data-cc-arc-same-level-non-overlapping]");
  const longDurationArcsVisibleEl = calendarClockRoot.querySelector("[data-cc-long-duration-arcs-visible]");

  presetEl.addEventListener("change", () => {
    if (presetEl.value === "generated") return;

    calendarClockState.followNow = false;
    if (presetEl.value === "custom") {
      setCustomDividerWindow(formatClockMinutes(getCustomWindowStartMinutes()), { recapture: true });
      return;
    }

    calendarClockState.windowPreset = presetEl.value;
    const [start, end] = presetEl.value.split("-");
    calendarClockState.windowStart = start;
    calendarClockState.windowEnd = end;
    rememberManualWindowState();
    persistWindowAndSync({ recapture: true });
  });

  followNowEl.addEventListener("change", () => {
    calendarClockState.followRadiusHours = clampFollowRadiusHours(followRadiusEl.value);

    if (followNowEl.checked) {
      rememberManualWindowState();
      calendarClockState.followNow = true;
      applyFollowNowWindow({ recapture: true });
    } else {
      calendarClockState.followNow = false;
      restoreManualWindowState({ recapture: true });
    }
  });

  followRadiusEl.addEventListener("input", () => {
    calendarClockState.followRadiusHours = clampFollowRadiusHours(followRadiusEl.value);
    if (calendarClockState.followNow) {
      applyFollowNowWindow({
        saveDebounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS,
        recapture: true
      });
    } else {
      saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
      updatePanelControls();
      renderDebugPanel();
    }
  });

  function applyCustomDividerControl(value, options = {}) {
    calendarClockState.followNow = false;
    setCustomDividerWindow(value, { ...options, recapture: true });
  }

  customDividerTimeEl.addEventListener("change", () => {
    applyCustomDividerControl(customDividerTimeEl.value);
  });

  customDividerSliderEl.addEventListener("input", () => {
    applyCustomDividerControl(customDividerSliderEl.value, { saveDebounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
  });

  windowStartMarkerEl.addEventListener("change", () => {
    calendarClockState.windowStartMarker = windowStartMarkerEl.checked;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
  });

  dividerSettingsToggleEl.addEventListener("click", () => {
    const isExpanded = dividerSettingsPanelEl.classList.toggle("expanded");
    calendarClockState.windowStartMarkerSettingsExpanded = isExpanded;
    saveCalendarClockState();
    if (!isExpanded) blurFocusedElementInside(dividerSettingsPanelEl);
  });

  dividerStyleEl.addEventListener("change", () => {
    applyWindowStartMarkerStylePreset(normalizeWindowStartMarkerStyle(dividerStyleEl.value));
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
  });

  dividerShapeEl.addEventListener("change", () => {
    markWindowStartMarkerPresetCustom();
    calendarClockState.windowStartMarkerShape = normalizeWindowStartMarkerShape(dividerShapeEl.value);
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
  });

  dividerColorEl.addEventListener("input", () => {
    markWindowStartMarkerPresetCustom();
    calendarClockState.windowStartMarkerColor = dividerColorEl.value;
    const colorPreviewEl = calendarClockRoot.querySelector("[data-cc-divider-color-dot]");
    if (colorPreviewEl) {
      colorPreviewEl.style.backgroundColor = dividerColorEl.value;
    }
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  dividerWidthEl.addEventListener("input", () => {
    markWindowStartMarkerPresetCustom();
    const val = clampWindowStartMarkerWidth(dividerWidthEl.value);
    calendarClockState.windowStartMarkerWidth = val;
    dividerWidthOutputEl.textContent = `${val}px`;
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    updatePanelControls();
    syncClockFrame();
  });

  dividerDotsEl.addEventListener("input", () => {
    markWindowStartMarkerPresetCustom();
    const val = clampWindowStartMarkerDots(dividerDotsEl.value);
    calendarClockState.windowStartMarkerDots = val;
    dividerDotsOutputEl.textContent = String(val);
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    updatePanelControls();
    syncClockFrame();
  });

  dividerEmojiEl.addEventListener("input", () => {
    markWindowStartMarkerPresetCustom();
    calendarClockState.windowStartMarkerEmoji = normalizeWindowStartMarkerEmoji(dividerEmojiEl.value);
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  dividerLabelsEl.addEventListener("change", () => {
    calendarClockState.windowStartMarkerLabels = dividerLabelsEl.checked;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
  });

  windowStartMarkerPulseEl.addEventListener("change", () => {
    calendarClockState.windowStartMarkerPulse = windowStartMarkerPulseEl.checked;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
  });

  dividerTransparencyEl.addEventListener("input", () => {
    markWindowStartMarkerPresetCustom();
    const opacity = clampIntegerRange(dividerTransparencyEl.value, 92, 0, 100);
    calendarClockState.windowStartMarkerTransparency = 100 - opacity;
    dividerTransparencyOutputEl.textContent = `${opacity}%`;
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    updatePanelControls();
    syncClockFrame();
  });

  radial24HourEl.addEventListener("change", () => {
    calendarClockState.radial24Hour = radial24HourEl.checked;
    if (calendarClockState.followNow) {
      applyFollowNowWindow({ recapture: true });
    } else {
      persistWindowAndSync({ recapture: true });
    }
  });

  clockFaceEl.addEventListener("change", () => {
    calendarClockState.clockFaceId = normalizeCalendarClockFaceId(clockFaceEl.value);
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame({ rebuild: true });
    renderDebugPanel();
  });

  magnifierEl.addEventListener("change", () => {
    calendarClockState.magnifierEnabled = magnifierEl.checked;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
    renderDebugPanel();
  });

  magnifierSettingsToggleEl.addEventListener("click", () => {
    calendarClockState.magnifierSettingsExpanded = magnifierSettingsPanelEl.classList.toggle("expanded");
    saveCalendarClockState();
  });

  magnifierLensSizeEl.addEventListener("input", () => {
    const val = clampMagnifierLensSize(magnifierLensSizeEl.value);
    calendarClockState.magnifierLensSize = val;
    magnifierLensSizeOutputEl.textContent = `${val}px`;
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  magnifierHoverEl.addEventListener("change", () => {
    calendarClockState.magnifierHoverEnabled = magnifierHoverEl.checked;
    saveCalendarClockState();
    syncClockFrame();
    renderDebugPanel();
  });

  magnifierCenterCursorEl.addEventListener("change", () => {
    calendarClockState.magnifierCenterCursor = magnifierCenterCursorEl.checked;
    saveCalendarClockState();
    syncClockFrame();
    renderDebugPanel();
  });

  magnifierAutoEl.addEventListener("change", () => {
    calendarClockState.magnifierAutoEnabled = magnifierAutoEl.checked;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
    renderDebugPanel();
  });

  magnifierAutoMinuteHandEl.addEventListener("change", () => {
    calendarClockState.magnifierAutoMinuteHandEnabled = magnifierAutoMinuteHandEl.checked;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
    renderDebugPanel();
  });

  magnifierAutoEventStartEl.addEventListener("change", () => {
    calendarClockState.magnifierAutoEventStartEnabled = magnifierAutoEventStartEl.checked;
    if (!calendarClockState.magnifierAutoEventStartEnabled) {
      calendarClockState.magnifierAutoEventStartAttention = false;
    }
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
    renderDebugPanel();
  });

  magnifierAutoEventStartAttentionEl.addEventListener("change", () => {
    calendarClockState.magnifierAutoEventStartAttention = magnifierAutoEventStartAttentionEl.checked;
    saveCalendarClockState();
    syncClockFrame();
    renderDebugPanel();
  });

  magnifierAutoEventEndEl.addEventListener("change", () => {
    calendarClockState.magnifierAutoEventEndEnabled = magnifierAutoEventEndEl.checked;
    if (!calendarClockState.magnifierAutoEventEndEnabled) {
      calendarClockState.magnifierAutoEventEndAttention = false;
    }
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
    renderDebugPanel();
  });

  magnifierAutoEventEndAttentionEl.addEventListener("change", () => {
    calendarClockState.magnifierAutoEventEndAttention = magnifierAutoEventEndAttentionEl.checked;
    saveCalendarClockState();
    syncClockFrame();
    renderDebugPanel();
  });

  magnifierAutoIntervalEl.addEventListener("input", () => {
    calendarClockState.magnifierAutoIntervalSeconds = clampMagnifierAutoIntervalSeconds(magnifierAutoIntervalEl.value);
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  magnifierAutoIntervalEl.addEventListener("change", () => {
    const val = clampMagnifierAutoIntervalSeconds(magnifierAutoIntervalEl.value);
    calendarClockState.magnifierAutoIntervalSeconds = val;
    magnifierAutoIntervalEl.value = String(val);
    saveCalendarClockState();
    syncClockFrame();
  });

  magnifierLaunchAutoEl.addEventListener("click", () => {
    if (!calendarClockState.magnifierEnabled) return;
    sendToClockFrame({ type: "CALENDAR_CLOCK_LAUNCH_AUTO_MAGNIFIER" });
  });

  arcsVisibleEl.addEventListener("change", () => {
    calendarClockState.arcsVisible = arcsVisibleEl.checked;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
    renderDebugPanel();
  });

  arcSettingsToggleEl.addEventListener("click", () => {
    calendarClockState.arcSettingsExpanded = arcSettingsPanelEl.classList.toggle("expanded");
    saveCalendarClockState();
  });

  eventLabelsEl.addEventListener("change", () => {
    calendarClockState.eventLabels = eventLabelsEl.checked;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
    renderDebugPanel();
  });

  eventLabelsSettingsToggleEl.addEventListener("click", () => {
    calendarClockState.eventLabelsSettingsExpanded = eventLabelsSettingsPanelEl.classList.toggle("expanded");
    saveCalendarClockState();
  });

  eventLabelStyleEl.addEventListener("change", () => {
    calendarClockState.eventLabelStyle = eventLabelStyleEl.value;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
    renderDebugPanel();
  });

  eventLabelCustomColorEl.addEventListener("input", () => {
    calendarClockState.eventLabelCustomColor = eventLabelCustomColorEl.value;
    const colorPreviewEl = calendarClockRoot.querySelector("[data-cc-event-labels-color-dot]");
    if (colorPreviewEl) {
      colorPreviewEl.style.backgroundColor = eventLabelCustomColorEl.value;
    }
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  eventLabelFontFamilyEl.addEventListener("input", () => {
    calendarClockState.eventLabelFontFamily = normalizeEventLabelFontFamily(eventLabelFontFamilyEl.value);
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  eventLabelFontFamilyEl.addEventListener("change", () => {
    calendarClockState.eventLabelFontFamily = normalizeEventLabelFontFamily(eventLabelFontFamilyEl.value);
    eventLabelFontFamilyEl.value = calendarClockState.eventLabelFontFamily;
    saveCalendarClockState();
    syncClockFrame();
  });

  eventLabelFontResetEl.addEventListener("click", () => {
    calendarClockState.eventLabelFontFamily = CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontFamily;
    calendarClockState.eventLabelFontSizeFull = CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeFull;
    calendarClockState.eventLabelFontSizeMini = CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeMini;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
  });

  eventLabelFontSizeFullEl.addEventListener("input", () => {
    const val = clampEventLabelFontSize(
      eventLabelFontSizeFullEl.value,
      CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeFull
    );
    calendarClockState.eventLabelFontSizeFull = val;
    eventLabelFontSizeFullOutputEl.textContent = `${val}px`;
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  eventLabelFontSizeMiniEl.addEventListener("input", () => {
    const val = clampEventLabelFontSize(
      eventLabelFontSizeMiniEl.value,
      CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeMini
    );
    calendarClockState.eventLabelFontSizeMini = val;
    eventLabelFontSizeMiniOutputEl.textContent = `${val}px`;
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  eventLabelProximityPriorityEl.addEventListener("change", () => {
    calendarClockState.eventLabelProximityPriority = eventLabelProximityPriorityEl.checked;
    saveCalendarClockState();
    syncClockFrame();
  });

  eventLabelMinLengthEl.addEventListener("input", () => {
    const val = Number(eventLabelMinLengthEl.value);
    calendarClockState.eventLabelMinLength = val;
    eventLabelMinLengthOutputEl.textContent = `${val} symbols`;
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  eventLabelShortenThresholdEl.addEventListener("input", () => {
    const val = clampIntegerRange(eventLabelShortenThresholdEl.value, CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelShortenThreshold, 50, CALENDAR_CLOCK_LABEL_SHORTEN_NEVER);
    calendarClockState.eventLabelShortenThreshold = val;
    eventLabelShortenThresholdOutputEl.textContent = formatEventLabelShortenThreshold(val);
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  eventLabelAnchorEl.addEventListener("input", () => {
    const anchor = getEventLabelAnchorFromSlider(eventLabelAnchorEl.value);
    const anchorText = formatEventLabelAnchor(anchor);
    calendarClockState.eventLabelAnchor = anchor;
    eventLabelAnchorOutputEl.textContent = anchorText;
    eventLabelAnchorEl.setAttribute("aria-valuetext", anchorText);
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  eventLabelOpacityEl.addEventListener("input", () => {
    const val = Number(eventLabelOpacityEl.value);
    calendarClockState.eventLabelOpacity = val;
    eventLabelOpacityOutputEl.textContent = `${val}%`;
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  eventLabelArcDistanceEl.addEventListener("input", () => {
    const val = clampEventLabelArcDistance(eventLabelArcDistanceEl.value);
    calendarClockState.eventLabelArcDistance = val;
    eventLabelArcDistanceOutputEl.textContent = `${val}px`;
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    syncClockFrame();
  });

  menuDarkThemeEl.addEventListener("change", () => {
    calendarClockState.menuDarkTheme = menuDarkThemeEl.checked;
    calendarClockState.menuThemeEdited = true;
    saveCalendarClockState();
    updatePanelControls();
  });

  densityEl.addEventListener("input", () => {
    calendarClockState.densityLevel = clampPercentLevel(densityEl.value, CALENDAR_CLOCK_PANEL_DEFAULT.densityLevel);
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    updatePanelControls();
    syncClockFrame();
  });

  arcThicknessEl.addEventListener("input", () => {
    calendarClockState.arcThicknessLevel = clampPercentLevel(arcThicknessEl.value, CALENDAR_CLOCK_PANEL_DEFAULT.arcThicknessLevel);
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    updatePanelControls();
    syncClockFrame();
  });

  arcGapEl.addEventListener("input", () => {
    calendarClockState.arcGapLevel = clampPercentLevel(arcGapEl.value, CALENDAR_CLOCK_PANEL_DEFAULT.arcGapLevel);
    saveCalendarClockState({ debounceMs: CALENDAR_CLOCK_STATE_SAVE_DEBOUNCE_MS });
    updatePanelControls();
    syncClockFrame();
  });

  captureLimitEl.addEventListener("change", () => {
    calendarClockState.captureLimit = normalizeCalendarClockCaptureLimit(captureLimitEl.value);
    saveCalendarClockState();
    updatePanelControls();
    void renderHelpPanel().catch(error => calendarClockWarn("failed to update capture-limit help", error));
    publishCalendarEvents();
  });

  arcSameLevelNonOverlappingEl.addEventListener("change", () => {
    calendarClockState.arcSameLevelNonOverlapping = arcSameLevelNonOverlappingEl.checked;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
    renderDebugPanel();
  });

  longDurationArcsVisibleEl.addEventListener("change", () => {
    calendarClockState.longDurationArcsVisible = longDurationArcsVisibleEl.checked;
    saveCalendarClockState();
    updatePanelControls();
    syncClockFrame();
    renderDebugPanel();
  });

  const miniSurfaceEl = calendarClockRoot.querySelector(".cc-clock-surface");
  if (miniSurfaceEl) {
    miniSurfaceEl.addEventListener("click", event => {
      const actionBtn = event.target.closest("[data-cc-mini-action]");
      if (!actionBtn) return;
      const action = actionBtn.dataset.ccMiniAction;
      if (action === "maximize") setClockMode("full");
      else if (action === "close") setClockMode("hidden");
    });
  }

  bindPanelDragging();
  bindTimePanelResizing();
  bindTimePanelWheelScrolling();
  bindMiniClockDragging();
}

function hardRefreshCalendarClockEventsFromToolbar(button) {
  if (button?.disabled) return;
  const previousText = button?.textContent || "Refresh";
  if (button) {
    button.disabled = true;
    button.textContent = "Resetting…";
  }
  calendarClockEvents = [];
  calendarClockCaptureMeta = { calendar: null, task: null };
  calendarClockStorageStatus = null;
  renderCalendarClockEventSnapshot();
  clearCalendarClockFrameEvents();

  const restoreButton = () => {
    if (!button?.isConnected) return;
    button.disabled = false;
    button.textContent = previousText;
  };
  const sent = sendCalendarClockRuntimeMessage({ type: "CALENDAR_CLOCK_HARD_REFRESH_EVENTS" }, response => {
    if (response?.ok === true) return;
    restoreButton();
    setCalendarClockDebugStatus(response?.error || "Calendar refresh failed before reload");
  });
  if (!sent) restoreButton();
}

function getPanelCoordinateKey(baseKey) {
  return calendarClockState.mode === "full" ? `${baseKey}_full` : baseKey;
}

function getTimePanelDimensionKey(baseKey) {
  return calendarClockState.mode === "full" ? `${baseKey}_full` : baseKey;
}

function bindPanelDragging() {
  function bindDraggableHeader(handleSelector, xKey, yKey) {
    let dragging = false;
    let activeHandle = null;
    let activePanel = null;
    let activePointerId = null;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    function finishDrag(event) {
      if (!dragging || event.pointerId !== activePointerId) return;
      dragging = false;
      activePanel?.classList.remove("cc-panel-dragging");
      if (activeHandle?.hasPointerCapture?.(event.pointerId)) {
        activeHandle.releasePointerCapture(event.pointerId);
      }
      activeHandle = null;
      activePanel = null;
      activePointerId = null;
      saveCalendarClockState();
    }

    calendarClockRoot.addEventListener("pointerdown", event => {
      const handle = event.target.closest?.(handleSelector);
      if (!handle || !calendarClockRoot.contains(handle)) return;
      if (event.target.closest("button")) return;
      const panel = handle.closest(".cc-panel");
      if (!panel) return;
      event.preventDefault();
      dragging = true;
      activeHandle = handle;
      activePanel = panel;
      activePointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      const origin = resolvePanelPosition(panel, xKey, yKey);
      originX = origin.x;
      originY = origin.y;
      panel.classList.add("cc-panel-dragging");
      handle.setPointerCapture(event.pointerId);
    });

    calendarClockRoot.addEventListener("pointermove", event => {
      if (!dragging || event.pointerId !== activePointerId) return;
      const next = clampPanelPosition(activePanel, originX + event.clientX - startX, originY + event.clientY - startY);
      const nextX = next.x;
      const nextY = next.y;
      const coordXKey = getPanelCoordinateKey(xKey);
      const coordYKey = getPanelCoordinateKey(yKey);
      calendarClockState[coordXKey] = nextX;
      calendarClockState[coordYKey] = nextY;
      updatePanelPosition();
    });

    calendarClockRoot.addEventListener("pointerup", finishDrag);
    calendarClockRoot.addEventListener("pointercancel", finishDrag);
  }

  // Bind View Panel dragging
  bindDraggableHeader(".cc-panel-view-header", "panelX", "panelY");

  // Bind Time Settings Panel dragging
  bindDraggableHeader(".cc-panel-time-header", "timePanelX", "timePanelY");
  bindDraggableHeader(".cc-panel-whats-new-header", "timePanelX", "timePanelY");

  // Bind Debug Panel dragging
  bindDraggableHeader(".cc-panel-debug-header", "debugPanelX", "debugPanelY");

  // Bind Help Panel dragging
  bindDraggableHeader(".cc-panel-help-header", "helpPanelX", "helpPanelY");
}

function bindTimePanelResizing() {
  if (!calendarClockTimePanel) return;

  const handles = calendarClockTimePanel.querySelectorAll("[data-cc-time-resize]");
  const minWidth = 300;
  const minHeight = 168;
  let resizing = false;
  let edge = "";
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let originWidth = 0;
  let originHeight = 0;

  function applyResize(event) {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const right = originX + originWidth;
    const bottom = originY + originHeight;
    let nextX = originX;
    let nextY = originY;
    let nextWidth = originWidth;
    let nextHeight = originHeight;

    if (edge.includes("e")) {
      nextWidth = Math.min(window.innerWidth - originX - 8, Math.max(minWidth, originWidth + dx));
    }
    if (edge.includes("s")) {
      nextHeight = Math.min(window.innerHeight - originY - 8, Math.max(minHeight, originHeight + dy));
    }
    if (edge.includes("w")) {
      nextX = Math.min(right - minWidth, Math.max(8, originX + dx));
      nextWidth = right - nextX;
    }
    if (edge.includes("n")) {
      nextY = Math.min(bottom - minHeight, Math.max(8, originY + dy));
      nextHeight = bottom - nextY;
    }

    const widthKey = getTimePanelDimensionKey("timePanelWidth");
    const heightKey = getTimePanelDimensionKey("timePanelHeight");
    const xKey = getPanelCoordinateKey("timePanelX");
    const yKey = getPanelCoordinateKey("timePanelY");
    calendarClockState[widthKey] = Math.round(nextWidth);
    calendarClockState[heightKey] = Math.round(nextHeight);
    calendarClockState[xKey] = Math.round(nextX);
    calendarClockState[yKey] = Math.round(nextY);
    updatePanelPosition();
  }

  handles.forEach(handle => {
    handle.addEventListener("pointerdown", event => {
      if (calendarClockState.timePanelCollapsed) return;
      resizing = true;
      edge = handle.dataset.ccTimeResize || "";
      startX = event.clientX;
      startY = event.clientY;
      const origin = resolvePanelPosition(calendarClockTimePanel, "timePanelX", "timePanelY");
      originX = origin.x;
      originY = origin.y;
      originWidth = calendarClockTimePanel.offsetWidth;
      originHeight = calendarClockTimePanel.offsetHeight;
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener("pointermove", event => {
      if (!resizing) return;
      applyResize(event);
    });

    handle.addEventListener("pointerup", event => {
      if (!resizing) return;
      resizing = false;
      handle.releasePointerCapture(event.pointerId);
      saveCalendarClockState();
    });

    handle.addEventListener("pointercancel", () => {
      if (!resizing) return;
      resizing = false;
      saveCalendarClockState();
    });
  });
}

function getCalendarClockWheelDelta(event, pageHeight) {
  const deltaY = Number(event?.deltaY) || 0;
  if (event?.deltaMode === 1) return deltaY * 16;
  if (event?.deltaMode === 2) return deltaY * Math.max(1, Number(pageHeight) || 1);
  return deltaY;
}

function bindTimePanelWheelScrolling() {
  if (!calendarClockTimePanel) return;

  calendarClockTimePanel.addEventListener("wheel", event => {
    if (calendarClockState.timePanelCollapsed || !event.deltaY) return;

    const hoveredBody = event.target.closest?.(".cc-settings-body, .cc-whats-new-body");
    const activeBody = calendarClockRoot.classList.contains("cc-whats-new-open")
      ? calendarClockTimePanel.querySelector(".cc-whats-new-body")
      : calendarClockTimePanel.querySelector(".cc-settings-body");
    const scrollBody = hoveredBody || activeBody;
    if (!scrollBody) return;

    const maxScrollTop = Math.max(0, scrollBody.scrollHeight - scrollBody.clientHeight);
    if (!maxScrollTop) return;

    const delta = getCalendarClockWheelDelta(event, scrollBody.clientHeight);
    scrollBody.scrollTop = Math.min(maxScrollTop, Math.max(0, scrollBody.scrollTop + delta));
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true, passive: false });
}

function clampPanelPosition(panel, x, y) {
  const panelWidth = panel?.offsetWidth || 40;
  const panelHeight = panel?.offsetHeight || 40;
  const maxX = Math.max(8, window.innerWidth - panelWidth - 8);
  const maxY = Math.max(8, window.innerHeight - Math.min(panelHeight, window.innerHeight - 16) - 8);
  return {
    x: Math.min(maxX, Math.max(8, x)),
    y: Math.min(maxY, Math.max(8, y))
  };
}

function getTimePanelSizeBounds() {
  return {
    minWidth: 300,
    minHeight: 168,
    maxWidth: Math.max(300, window.innerWidth - 16),
    maxHeight: Math.max(168, window.innerHeight - 16)
  };
}

function getTimePanelContentFitHeight(panel) {
  const body = panel?.querySelector(".cc-settings-body") || panel?.querySelector(".cc-whats-new-body");
  if (!panel || !body) return null;

  const panelRect = panel.getBoundingClientRect();
  const bodyRect = body.getBoundingClientRect();
  if (panelRect.width <= 0 || bodyRect.width <= 0) return null;

  const contentHeight = Math.max(body.scrollHeight, bodyRect.height);
  const panelStyle = getComputedStyle(panel);
  const bottomPadding = parseFloat(panelStyle.paddingBottom) || 0;
  const bottomBorder = parseFloat(panelStyle.borderBottomWidth) || 0;
  const contentTop = Math.max(0, bodyRect.top - panelRect.top);
  return Math.ceil(contentTop + contentHeight + bottomPadding + bottomBorder + 2);
}

function applyInitialTimePanelSize(options = {}) {
  if (!calendarClockTimePanel) return false;
  if (!options.force && !calendarClockTimePanelNeedsInitialSize) return false;

  const { minWidth, minHeight, maxWidth, maxHeight } = getTimePanelSizeBounds();
  const width = Math.max(minWidth, Math.min(CALENDAR_CLOCK_TIME_PANEL_INITIAL_WIDTH, maxWidth));
  calendarClockTimePanel.style.width = `${width}px`;
  calendarClockTimePanel.style.height = "";
  const contentFitHeight = getTimePanelContentFitHeight(calendarClockTimePanel);
  const comfortableHeight = Math.min(CALENDAR_CLOCK_TIME_PANEL_INITIAL_MIN_HEIGHT, maxHeight);
  const preferredHeight = contentFitHeight === null
    ? comfortableHeight
    : contentFitHeight;
  const height = Math.max(minHeight, Math.min(preferredHeight, maxHeight));
  let changed = false;

  ["", "_full"].forEach(suffix => {
    const widthKey = `timePanelWidth${suffix}`;
    const heightKey = `timePanelHeight${suffix}`;
    if (calendarClockState[widthKey] !== width) {
      calendarClockState[widthKey] = width;
      changed = true;
    }
    if (calendarClockState[heightKey] !== height) {
      calendarClockState[heightKey] = height;
      changed = true;
    }
  });

  calendarClockTimePanelNeedsInitialSize = false;
  if (calendarClockState.timePanelInitialSizeVersion !== CALENDAR_CLOCK_TIME_PANEL_INITIAL_SIZE_VERSION) {
    calendarClockState.timePanelInitialSizeVersion = CALENDAR_CLOCK_TIME_PANEL_INITIAL_SIZE_VERSION;
    changed = true;
  }

  return changed;
}

function clampTimePanelDimension(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function applyTimePanelSize(panel) {
  const widthKey = getTimePanelDimensionKey("timePanelWidth");
  const heightKey = getTimePanelDimensionKey("timePanelHeight");
  const { minWidth, minHeight, maxWidth, maxHeight } = getTimePanelSizeBounds();
  const width = clampTimePanelDimension(calendarClockState[widthKey], minWidth, maxWidth);
  const height = clampTimePanelDimension(calendarClockState[heightKey], minHeight, maxHeight);
  let changed = false;

  if (width === null) {
    panel.style.width = "";
  } else {
    panel.style.width = `${width}px`;
    if (calendarClockState[widthKey] !== width) {
      calendarClockState[widthKey] = width;
      changed = true;
    }
  }

  if (height === null || calendarClockState.timePanelCollapsed) {
    panel.style.height = "";
  } else {
    panel.style.height = `${height}px`;
    if (calendarClockState[heightKey] !== height) {
      calendarClockState[heightKey] = height;
      changed = true;
    }
  }

  return changed;
}

function getDefaultViewPanelPosition(panel) {
  const panelWidth = panel?.offsetWidth || 320;
  return clampPanelPosition(panel, Math.round((window.innerWidth - panelWidth) / 2), 12);
}

function getDefaultTimePanelPosition(panel) {
  const panelHeight = panel?.offsetHeight || 420;
  return clampPanelPosition(panel, 12, window.innerHeight - panelHeight - 12);
}

function resolvePanelPosition(panel, xKey, yKey) {
  const coordXKey = getPanelCoordinateKey(xKey);
  const coordYKey = getPanelCoordinateKey(yKey);
  const hasSavedPosition = Number.isFinite(calendarClockState[coordXKey]) && Number.isFinite(calendarClockState[coordYKey]);

  if (!hasSavedPosition) {
    if (xKey === "panelX" && yKey === "panelY") {
      if (calendarClockState.mode === "full") {
        return clampPanelPosition(panel, 12, 12);
      }
      return getDefaultViewPanelPosition(panel);
    }
    if (xKey === "timePanelX" && yKey === "timePanelY") {
      return getDefaultTimePanelPosition(panel);
    }
    if (xKey === "debugPanelX" && yKey === "debugPanelY") {
      const panelWidth = panel?.offsetWidth || 620;
      return clampPanelPosition(panel, window.innerWidth - panelWidth - 24, 24);
    }
    if (xKey === "helpPanelX" && yKey === "helpPanelY") {
      const panelWidth = panel?.offsetWidth || 620;
      return clampPanelPosition(panel, window.innerWidth - panelWidth - 24, 24);
    }
  }

  const fallbackX = Number(CALENDAR_CLOCK_PANEL_DEFAULT[xKey]);
  const fallbackY = Number(CALENDAR_CLOCK_PANEL_DEFAULT[yKey]);
  return clampPanelPosition(
    panel,
    Number.isFinite(calendarClockState[coordXKey]) ? calendarClockState[coordXKey] : (Number.isFinite(fallbackX) ? fallbackX : 24),
    Number.isFinite(calendarClockState[coordYKey]) ? calendarClockState[coordYKey] : (Number.isFinite(fallbackY) ? fallbackY : 96)
  );
}

function applyPanelPosition(panel, xKey, yKey) {
  const coordXKey = getPanelCoordinateKey(xKey);
  const coordYKey = getPanelCoordinateKey(yKey);
  const next = resolvePanelPosition(panel, xKey, yKey);
  const hasSavedPosition = Number.isFinite(calendarClockState[coordXKey]) && Number.isFinite(calendarClockState[coordYKey]);
  let changed = false;

  if (hasSavedPosition && (calendarClockState[coordXKey] !== next.x || calendarClockState[coordYKey] !== next.y)) {
    calendarClockState[coordXKey] = next.x;
    calendarClockState[coordYKey] = next.y;
    changed = true;
  }

  panel.style.left = `${next.x}px`;
  panel.style.top = `${next.y}px`;
  return changed;
}

const CALENDAR_CLOCK_EVENT_STORAGE_KEYS = [
  "calendarClockCalendarEvents",
  "calendarClockTaskEvents",
  "calendarClockEvents",
  "calendarClockSource",
  "calendarClockCalendarSource",
  "calendarClockTaskSource",
  "calendarClockCaptureMeta",
  "calendarClockStorageStatus",
  "calendarClockCalendarEventStore",
  "calendarClockFeedMode",
  "calendarClockActiveSource"
];

function setCalendarClockPageOwnedMode(enabled) {
  calendarClockState.pageOwnedInfo = enabled === true;
  globalThis.calendarClockPageOwnedInfo?.setEnabled?.(calendarClockState.pageOwnedInfo);
  calendarClockEvents = [];
  calendarClockCaptureMeta = { calendar: null, task: null };
  calendarClockStorageStatus = null;
  renderCalendarClockEventSnapshot();

  if (!canUseCalendarClockExtensionApi()) {
    publishCalendarEvents();
    return;
  }

  const finish = () => {
    if (calendarClockExtensionContextInvalidated) return;
    if (calendarClockState.pageOwnedInfo) {
      location.reload();
      return;
    }
    publishCalendarEvents();
    renderDebugPanel();
  };

  try {
    chrome.storage.local.set({ [CALENDAR_CLOCK_STATE_KEY]: calendarClockState }, () => {
      const runtimeError = getCalendarClockRuntimeLastError();
      if (runtimeError) {
        markCalendarClockExtensionContextInvalidated(runtimeError);
        return;
      }
      chrome.storage.local.remove(CALENDAR_CLOCK_EVENT_STORAGE_KEYS, () => {
        const removeError = getCalendarClockRuntimeLastError();
        if (removeError) {
          markCalendarClockExtensionContextInvalidated(removeError);
          return;
        }
        finish();
      });
    });
  } catch (error) {
    if (!markCalendarClockExtensionContextInvalidated(error)) calendarClockWarn("failed to switch event source", error);
    finish();
  }
}

function saveDefaultCalendarClockAppSettings(settings = CALENDAR_CLOCK_PANEL_DEFAULT) {
  if (!canUseCalendarClockExtensionApi()) return;

  try {
    chrome.storage.local.set({ [CALENDAR_CLOCK_STATE_KEY]: { ...settings } }, () => {
      const runtimeError = getCalendarClockRuntimeLastError();
      if (runtimeError) markCalendarClockExtensionContextInvalidated(runtimeError);
    });
  } catch (error) {
    if (!markCalendarClockExtensionContextInvalidated(error)) {
      calendarClockWarn("failed to wipe overlay state", error);
    }
  }
}

function setCalendarClockDebugStatus(text) {
  const status = calendarClockDebug?.querySelector("[data-cc-debug-copy-status]");
  if (status) status.textContent = text;
}

function wipeCalendarClockStoredEvents(callback) {
  calendarClockEvents = [];
  calendarClockCaptureMeta = { calendar: null, task: null };
  calendarClockStorageStatus = null;
  renderCalendarClockEventSnapshot();
  clearCalendarClockFrameEvents();
  setCalendarClockDebugStatus("Stored events wiped locally; clearing storage");

  if (!canUseCalendarClockExtensionApi()) {
    callback?.();
    return;
  }

  try {
    chrome.storage.local.remove(CALENDAR_CLOCK_EVENT_STORAGE_KEYS, () => {
      const runtimeError = getCalendarClockRuntimeLastError();
      if (runtimeError) {
        markCalendarClockExtensionContextInvalidated(runtimeError);
        return;
      }
      reloadCalendarClockFrameEvents();
      callback?.();
    });
  } catch (error) {
    if (!markCalendarClockExtensionContextInvalidated(error)) {
      calendarClockWarn("failed to wipe stored events", error);
    }
    callback?.();
  }
}

function wipeCalendarClockAppSettingsToDefault() {
  applyLoadedCalendarClockState({
    ...CALENDAR_CLOCK_PANEL_DEFAULT,
    timePanelOpen: false,
    timePanelCollapsed: false,
    debugOpen: true,
    helpOpen: false
  });
  globalThis.calendarClockEventReminders?.syncState?.({ clearCustomBlob: true });
  calendarClockWhatsNewOpen = false;
  applyInitialTimePanelSize({ force: true });
  saveDefaultCalendarClockAppSettings({ ...calendarClockState, debugOpen: false });
  updatePanelControls();
  updateRootClasses();
  updatePanelPosition();
  updateMiniClockPosition();
  syncClockFrame({ rebuild: true });
  renderDebugPanel();
  updatePanelStats();
  setCalendarClockDebugStatus("App settings wiped; clearing stored events");
  wipeCalendarClockStoredEvents(() => {
    if (calendarClockExtensionContextInvalidated) return;
    setCalendarClockDebugStatus("Stored events wiped; reloading Calendar");
    setTimeout(() => {
      if (!calendarClockExtensionContextInvalidated) location.reload();
    }, 50);
  });
}

function clampMiniClockPosition(x, y) {
  const maxX = Math.max(8, window.innerWidth - CALENDAR_CLOCK_MINI_SIZE - 8);
  const maxY = Math.max(8, window.innerHeight - CALENDAR_CLOCK_MINI_SIZE - 8);
  return {
    x: Math.min(maxX, Math.max(8, x)),
    y: Math.min(maxY, Math.max(8, y))
  };
}

function normalizeMiniClockPosition() {
  const fallbackX = Math.max(8, window.innerWidth - CALENDAR_CLOCK_MINI_SIZE - CALENDAR_CLOCK_MINI_MARGIN);
  const fallbackY = Math.max(8, window.innerHeight - CALENDAR_CLOCK_MINI_SIZE - CALENDAR_CLOCK_MINI_MARGIN);
  const rawX = Number.isFinite(calendarClockState.miniX) ? calendarClockState.miniX : fallbackX;
  const rawY = Number.isFinite(calendarClockState.miniY) ? calendarClockState.miniY : fallbackY;
  const next = clampMiniClockPosition(rawX, rawY);
  calendarClockState.miniX = next.x;
  calendarClockState.miniY = next.y;
}

function bindMiniClockDragging() {
  const handle = calendarClockRoot.querySelector(".cc-mini-drag-handle");
  if (!handle) {
    calendarClockWarn("mini clock drag handle unavailable");
    return;
  }

  let dragging = false;
  let dragFrameId = null;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;
  let pendingX = 0;
  let pendingY = 0;

  function applyPendingMiniPosition() {
    dragFrameId = null;
    calendarClockState.miniX = pendingX;
    calendarClockState.miniY = pendingY;
    updateMiniClockPosition();
  }

  function queueMiniClockPosition(next) {
    pendingX = next.x;
    pendingY = next.y;
    if (dragFrameId !== null) return;
    dragFrameId = requestAnimationFrame(applyPendingMiniPosition);
  }

  function flushMiniClockPosition() {
    if (dragFrameId === null) return;
    cancelAnimationFrame(dragFrameId);
    applyPendingMiniPosition();
  }

  handle.addEventListener("pointerdown", event => {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    originX = calendarClockState.miniX;
    originY = calendarClockState.miniY;
    handle.setPointerCapture(event.pointerId);
  });

  handle.addEventListener("pointermove", event => {
    if (!dragging) return;
    const next = clampMiniClockPosition(
      originX + event.clientX - startX,
      originY + event.clientY - startY
    );
    queueMiniClockPosition(next);
  });

  handle.addEventListener("pointerup", event => {
    if (!dragging) return;
    flushMiniClockPosition();
    dragging = false;
    handle.releasePointerCapture(event.pointerId);
    saveCalendarClockState();
  });

  handle.addEventListener("pointercancel", () => {
    if (!dragging) return;
    flushMiniClockPosition();
    dragging = false;
    saveCalendarClockState();
  });
}

function updateRootClasses() {
  if (!calendarClockRoot) return;
  const timePanelToggle = calendarClockRoot.querySelector("[data-cc-action='time-panel-toggle']");
  const settingsPanelOpen = calendarClockState.timePanelOpen === true;

  if (timePanelToggle) {
    timePanelToggle.disabled = settingsPanelOpen;
    timePanelToggle.tabIndex = settingsPanelOpen ? -1 : 0;
    timePanelToggle.setAttribute("aria-hidden", settingsPanelOpen ? "true" : "false");
  }

  calendarClockRoot.classList.toggle("cc-mode-full", calendarClockState.mode === "full");
  calendarClockRoot.classList.toggle("cc-mode-mini", calendarClockState.mode === "mini");
  calendarClockRoot.classList.toggle("cc-mode-hidden", calendarClockState.mode === "hidden");
  calendarClockRoot.classList.toggle("cc-time-panel-open", settingsPanelOpen);
  calendarClockRoot.classList.toggle("cc-time-panel-closed", !settingsPanelOpen);
  calendarClockRoot.classList.toggle("cc-time-panel-collapsed", calendarClockState.timePanelCollapsed);
  calendarClockRoot.classList.toggle("cc-debug-open", calendarClockState.debugOpen);
  calendarClockRoot.classList.toggle("cc-debug-collapsed", calendarClockState.debugCollapsed);
  calendarClockRoot.classList.toggle("cc-help-open", calendarClockState.helpOpen);
  calendarClockRoot.classList.toggle("cc-help-collapsed", calendarClockState.helpCollapsed);
  calendarClockRoot.classList.toggle("cc-menu-theme-dark", calendarClockState.menuDarkTheme);
  calendarClockRoot.classList.toggle("cc-whats-new-open", calendarClockWhatsNewOpen);
}

function updatePanelPosition() {
  let changed = false;
  if (calendarClockPanel) {
    changed = applyPanelPosition(calendarClockPanel, "panelX", "panelY") || changed;
  }
  if (calendarClockTimePanel) {
    changed = applyTimePanelSize(calendarClockTimePanel) || changed;
    changed = applyPanelPosition(calendarClockTimePanel, "timePanelX", "timePanelY") || changed;
  }
  if (calendarClockDebug && calendarClockState.debugOpen) {
    changed = applyPanelPosition(calendarClockDebug, "debugPanelX", "debugPanelY") || changed;
  }
  if (calendarClockHelp && calendarClockState.helpOpen) {
    changed = applyPanelPosition(calendarClockHelp, "helpPanelX", "helpPanelY") || changed;
  }
  return changed;
}

function persistPanelPositionIfChanged() {
  if (updatePanelPosition()) saveCalendarClockState();
}

function updateMiniClockPosition() {
  if (!calendarClockRoot) return;
  normalizeMiniClockPosition();
  calendarClockRoot.style.setProperty("--cc-mini-x", `${calendarClockState.miniX}px`);
  calendarClockRoot.style.setProperty("--cc-mini-y", `${calendarClockState.miniY}px`);
}

function getSelectableWindowPreset() {
  const presets = new Set([
    "08:00-20:00",
    "20:00-08:00",
    "00:00-12:00",
    "12:00-00:00",
    "custom"
  ]);
  const explicitPreset = calendarClockState.windowPreset || "";
  const rangePreset = `${calendarClockState.windowStart}-${calendarClockState.windowEnd}`;

  if (presets.has(explicitPreset)) return explicitPreset;
  if (presets.has(rangePreset)) return rangePreset;
  return null;
}

function updatePanelControls() {
  if (!calendarClockRoot) return;

  const presetEl = calendarClockRoot.querySelector("[data-cc-window-preset]");
  const generatedEl = presetEl.querySelector("option[value='generated']");
  const selectedPreset = getSelectableWindowPreset();
  const radial24Hour = calendarClockState.radial24Hour;
  generatedEl.textContent = calendarClockState.followNow && radial24Hour
    ? `Follow Now 24h (${calendarClockState.windowStart}-${calendarClockState.windowEnd})`
    : calendarClockState.followNow
      ? `Follow Now (${calendarClockState.windowStart}-${calendarClockState.windowEnd})`
      : `Automatic range (${calendarClockState.windowStart}-${calendarClockState.windowEnd})`;
  presetEl.disabled = calendarClockState.followNow || radial24Hour;
  presetEl.value = calendarClockState.followNow ? "generated" : selectedPreset || "generated";
  const followNowEl = calendarClockRoot.querySelector("[data-cc-follow-now]");
  const followRadiusEl = calendarClockRoot.querySelector("[data-cc-follow-radius]");
  const followLabelEl = calendarClockRoot.querySelector("[data-cc-follow-label]");
  const followHelpEl = calendarClockRoot.querySelector("[data-cc-follow-help]");
  followNowEl.checked = calendarClockState.followNow;
  followNowEl.disabled = false;
  const followWindowMinutes = getFollowWindowMinutes();
  const maxPastHours = followWindowMinutes / 60 - 0.5;
  followRadiusEl.min = String(-maxPastHours);
  followRadiusEl.max = "0";
  const followPastText = formatFollowRadiusHours(calendarClockState.followRadiusHours);
  const followFutureText = formatFollowRadiusHours(getFollowFutureHours(calendarClockState.followRadiusHours));
  followRadiusEl.value = followPastText === "0" ? "0" : `-${followPastText}`;
  followRadiusEl.disabled = false;
  if (radial24Hour) {
    const { endDate } = getWindowDateRange();
    const forwardUntilText = formatWindowDateTime(endDate);
    followLabelEl.title = `Keep a 24-hour radial range moving with the current time. You will see ${followPastText} hours back and ${followFutureText} hours forward, until ${forwardUntilText}.`;
    followRadiusEl.title = "Set how many hours before now the 24-hour radial range shows. More past time leaves less future time.";
    followHelpEl.textContent = calendarClockState.followNow
      ? `24h Radial shows ${followPastText}h back and ${followFutureText}h forward, until ${forwardUntilText}.`
      : "24h Radial shows the selected calendar day. Turn on Follow Now for a moving 24-hour range with an offset.";
  } else {
    followLabelEl.title = "Keep a 12-hour range moving with the current time. You will see Window Start stay the configured number of hours behind the current hour hand.";
    followRadiusEl.title = "Set where Window Start sits inside the moving 12-hour window. Negative values show that many past hours before now.";
    followHelpEl.textContent = followPastText === "0"
      ? `Clock keeps 12 hours visible, starting at now and showing the next ${followFutureText} hours.`
      : `Clock keeps 12 hours visible, showing the last ${followPastText} hours before now and the next ${followFutureText} hours after now.`;
  }
  const customWindowRow = calendarClockRoot.querySelector("[data-cc-custom-window-row]");
  const customStartMinutes = getCustomWindowStartMinutes();
  const customStartText = formatClockMinutes(customStartMinutes);
  const showCustomWindowControls = !radial24Hour && !calendarClockState.followNow && presetEl.value === "custom";
  customWindowRow.hidden = !showCustomWindowControls;
  const customDividerTimeEl = calendarClockRoot.querySelector("[data-cc-custom-divider-time]");
  const customDividerSliderEl = calendarClockRoot.querySelector("[data-cc-custom-divider-slider]");
  customDividerTimeEl.value = customStartText;
  customDividerTimeEl.disabled = radial24Hour;
  customDividerSliderEl.value = String(customStartMinutes / 60);
  customDividerSliderEl.disabled = radial24Hour;
  calendarClockRoot.querySelector("[data-cc-custom-divider-output]").textContent = customStartText;
  calendarClockRoot.querySelector("[data-cc-window-start-marker]").checked = calendarClockState.windowStartMarker;
  calendarClockRoot.querySelector("[data-cc-divider-help]").textContent = getWindowStartMarkerHelpText();

  const isWindowStartMarkerEnabled = calendarClockState.windowStartMarker;
  const toggleSettingsBtn = calendarClockRoot.querySelector("[data-cc-action='divider-settings-toggle']");
  const settingsPanel = calendarClockRoot.querySelector("[data-cc-divider-settings-panel]");
  const colorPreviewEl = calendarClockRoot.querySelector("[data-cc-divider-color-dot]");

  if (isWindowStartMarkerEnabled) {
    toggleSettingsBtn.style.display = "";
    if (colorPreviewEl) colorPreviewEl.style.display = "";
  } else {
    toggleSettingsBtn.style.display = "none";
    if (colorPreviewEl) colorPreviewEl.style.display = "none";
  }
  settingsPanel.classList.toggle("expanded", isWindowStartMarkerEnabled && calendarClockState.windowStartMarkerSettingsExpanded === true);

  const markerColor = calendarClockState.windowStartMarkerColor || "#3a1860";
  if (colorPreviewEl) {
    colorPreviewEl.style.backgroundColor = markerColor;
  }
  const markerStyle = normalizeWindowStartMarkerStyle(calendarClockState.windowStartMarkerStyle);
  const markerShape = normalizeWindowStartMarkerShape(calendarClockState.windowStartMarkerShape);
  const markerWidth = clampWindowStartMarkerWidth(calendarClockState.windowStartMarkerWidth);
  const markerDots = clampWindowStartMarkerDots(calendarClockState.windowStartMarkerDots);
  const markerEmoji = normalizeWindowStartMarkerEmoji(calendarClockState.windowStartMarkerEmoji);
  const markerTransparency = clampWindowStartMarkerTransparency(calendarClockState.windowStartMarkerTransparency);
  const markerOpacity = 100 - markerTransparency;
  calendarClockState.windowStartMarkerStyle = markerStyle;
  calendarClockState.windowStartMarkerShape = markerShape;
  calendarClockState.windowStartMarkerWidth = markerWidth;
  calendarClockState.windowStartMarkerDots = markerDots;
  calendarClockState.windowStartMarkerEmoji = markerEmoji;
  calendarClockState.windowStartMarkerLabels = calendarClockState.windowStartMarkerLabels === true;
  calendarClockState.windowStartMarkerPulse = calendarClockState.windowStartMarkerPulse !== false;
  calendarClockState.windowStartMarkerTransparency = markerTransparency;

  calendarClockRoot.querySelector("[data-cc-divider-style]").value = markerStyle;
  calendarClockRoot.querySelector("[data-cc-divider-shape]").value = markerShape;
  calendarClockRoot.querySelector("[data-cc-divider-color]").value = markerColor;
  calendarClockRoot.querySelector("[data-cc-divider-width]").value = String(markerWidth);
  calendarClockRoot.querySelector("[data-cc-divider-width-output]").textContent = `${markerWidth}px`;
  calendarClockRoot.querySelector("[data-cc-divider-dots]").value = String(markerDots);
  calendarClockRoot.querySelector("[data-cc-divider-dots-output]").textContent = String(markerDots);
  calendarClockRoot.querySelector("[data-cc-divider-emoji]").value = markerEmoji;
  calendarClockRoot.querySelector("[data-cc-divider-labels]").checked = calendarClockState.windowStartMarkerLabels;
  calendarClockRoot.querySelector("[data-cc-window-start-marker-pulse]").checked = calendarClockState.windowStartMarkerPulse;
  calendarClockRoot.querySelector("[data-cc-divider-transparency]").value = String(markerOpacity);
  calendarClockRoot.querySelector("[data-cc-divider-transparency-output]").textContent = `${markerOpacity}%`;
  calendarClockRoot.querySelector("[data-cc-divider-dots-row]").hidden = markerShape === "line";
  const emojiRow = calendarClockRoot.querySelector("[data-cc-divider-emoji-row]");
  const showEmojiRow = markerShape === "emoji";
  emojiRow.classList.toggle("is-collapsed", !showEmojiRow);
  emojiRow.setAttribute("aria-hidden", String(!showEmojiRow));
  calendarClockRoot.querySelector("[data-cc-divider-emoji]").disabled = !showEmojiRow;
  calendarClockRoot.querySelector("[data-cc-24-hour-radial]").checked = calendarClockState.radial24Hour;
  calendarClockState.clockFaceId = normalizeCalendarClockFaceId(calendarClockState.clockFaceId);
  updateCalendarClockFaceSelect();
  const isMagnifierEnabled = calendarClockState.magnifierEnabled !== false;
  const magnifierSettingsBtn = calendarClockRoot.querySelector("[data-cc-action='magnifier-settings-toggle']");
  const magnifierSettingsPanel = calendarClockRoot.querySelector("[data-cc-magnifier-settings-panel]");
  const magnifierLaunchBtn = calendarClockRoot.querySelector("[data-cc-action='magnifier-launch-auto']");
  const magnifierLensSize = clampMagnifierLensSize(calendarClockState.magnifierLensSize);
  const magnifierAutoInterval = clampMagnifierAutoIntervalSeconds(calendarClockState.magnifierAutoIntervalSeconds);
  const isMagnifierAutoEnabled = calendarClockState.magnifierAutoEnabled !== false;
  const isMagnifierMinuteHandEnabled = calendarClockState.magnifierAutoMinuteHandEnabled === true;
  const isMagnifierEventStartEnabled = calendarClockState.magnifierAutoEventStartEnabled === true;
  const isMagnifierEventEndEnabled = calendarClockState.magnifierAutoEventEndEnabled === true;
  calendarClockState.magnifierLensSize = magnifierLensSize;
  calendarClockState.magnifierAutoIntervalSeconds = magnifierAutoInterval;

  calendarClockRoot.querySelector("[data-cc-magnifier]").checked = isMagnifierEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-hover]").checked = calendarClockState.magnifierHoverEnabled !== false;
  calendarClockRoot.querySelector("[data-cc-magnifier-center-cursor]").checked = calendarClockState.magnifierCenterCursor === true;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto]").checked = isMagnifierAutoEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-minute-hand]").checked = isMagnifierMinuteHandEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-start]").checked = isMagnifierEventStartEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-start-attention]").checked = calendarClockState.magnifierAutoEventStartAttention === true;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-end]").checked = isMagnifierEventEndEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-end-attention]").checked = calendarClockState.magnifierAutoEventEndAttention === true;
  calendarClockRoot.querySelector("[data-cc-magnifier-lens-size]").value = String(magnifierLensSize);
  calendarClockRoot.querySelector("[data-cc-magnifier-lens-size-output]").textContent = `${magnifierLensSize}px`;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-interval]").value = String(magnifierAutoInterval);
  calendarClockRoot.querySelector("[data-cc-magnifier-hover]").disabled = !isMagnifierEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-center-cursor]").disabled = !isMagnifierEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto]").disabled = !isMagnifierEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-minute-hand]").disabled = !isMagnifierEnabled || !isMagnifierAutoEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-start]").disabled = !isMagnifierEnabled || !isMagnifierAutoEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-start-attention]").disabled = !isMagnifierEnabled || !isMagnifierAutoEnabled || !isMagnifierEventStartEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-end]").disabled = !isMagnifierEnabled || !isMagnifierAutoEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-event-end-attention]").disabled = !isMagnifierEnabled || !isMagnifierAutoEnabled || !isMagnifierEventEndEnabled;
  calendarClockRoot.querySelector("[data-cc-magnifier-auto-interval]").disabled = !isMagnifierEnabled || !isMagnifierAutoEnabled || !isMagnifierMinuteHandEnabled;
  magnifierSettingsBtn.style.display = "";
  magnifierLaunchBtn.disabled = !isMagnifierEnabled || !isMagnifierAutoEnabled;
  magnifierSettingsPanel.classList.toggle("expanded", isMagnifierEnabled && calendarClockState.magnifierSettingsExpanded === true);

  const areArcsVisible = calendarClockState.arcsVisible !== false;
  const arcSettingsBtn = calendarClockRoot.querySelector("[data-cc-action='arc-settings-toggle']");
  const arcSettingsPanel = calendarClockRoot.querySelector("[data-cc-arc-settings-panel]");
  calendarClockState.arcsVisible = areArcsVisible;
  calendarClockState.arcSettingsExpanded = calendarClockState.arcSettingsExpanded === true;
  calendarClockRoot.querySelector("[data-cc-arcs-visible]").checked = areArcsVisible;
  arcSettingsBtn.style.display = areArcsVisible ? "" : "none";
  arcSettingsPanel.classList.toggle("expanded", areArcsVisible && calendarClockState.arcSettingsExpanded === true);

  const isEventLabelsEnabled = areArcsVisible && calendarClockState.eventLabels === true;
  const eventLabelsSettingsBtn = calendarClockRoot.querySelector("[data-cc-action='event-labels-settings-toggle']");
  const eventLabelsSettingsPanel = calendarClockRoot.querySelector("[data-cc-event-labels-settings-panel]");
  const labelsColorDot = calendarClockRoot.querySelector("[data-cc-event-labels-color-dot]");

  if (isEventLabelsEnabled) {
    eventLabelsSettingsBtn.style.display = "";
  } else {
    eventLabelsSettingsBtn.style.display = "none";
  }
  eventLabelsSettingsPanel.classList.toggle("expanded", isEventLabelsEnabled && calendarClockState.eventLabelsSettingsExpanded === true);

  const labelStyle = calendarClockState.eventLabelStyle || CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelStyle;
  const labelCustomColor = calendarClockState.eventLabelCustomColor || "#ffffff";
  const labelFontFamily = normalizeEventLabelFontFamily(calendarClockState.eventLabelFontFamily);
  const labelFontSizeFull = clampEventLabelFontSize(
    calendarClockState.eventLabelFontSizeFull,
    CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeFull
  );
  const labelFontSizeMini = clampEventLabelFontSize(
    calendarClockState.eventLabelFontSizeMini,
    CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelFontSizeMini
  );
  const labelProximityPriority = calendarClockState.eventLabelProximityPriority === true;
  const labelMinLength = calendarClockState.eventLabelMinLength !== undefined ? calendarClockState.eventLabelMinLength : 5;
  const labelShortenThreshold = clampIntegerRange(calendarClockState.eventLabelShortenThreshold, CALENDAR_CLOCK_PANEL_DEFAULT.eventLabelShortenThreshold, 50, CALENDAR_CLOCK_LABEL_SHORTEN_NEVER);
  const labelAnchor = normalizeEventLabelAnchor(calendarClockState.eventLabelAnchor);
  const labelOpacity = calendarClockState.eventLabelOpacity !== undefined ? calendarClockState.eventLabelOpacity : 100;
  const labelArcDistance = clampEventLabelArcDistance(calendarClockState.eventLabelArcDistance);
  calendarClockState.eventLabelFontFamily = labelFontFamily;
  calendarClockState.eventLabelFontSizeFull = labelFontSizeFull;
  calendarClockState.eventLabelFontSizeMini = labelFontSizeMini;
  calendarClockState.eventLabelProximityPriority = labelProximityPriority;
  calendarClockState.eventLabelShortenThreshold = labelShortenThreshold;
  calendarClockState.eventLabelAnchor = labelAnchor;
  calendarClockState.eventLabelArcDistance = labelArcDistance;

  if (labelsColorDot) {
    if (isEventLabelsEnabled && labelStyle === "custom") {
      labelsColorDot.style.display = "";
      labelsColorDot.style.backgroundColor = labelCustomColor;
    } else {
      labelsColorDot.style.display = "none";
    }
  }

  const customColorRow = calendarClockRoot.querySelector("[data-cc-event-label-custom-color-row]");
  if (customColorRow) {
    customColorRow.hidden = (labelStyle !== "custom");
  }

  calendarClockRoot.querySelector("[data-cc-event-labels]").checked = calendarClockState.eventLabels === true;
  calendarClockRoot.querySelector("[data-cc-event-labels]").disabled = !areArcsVisible;
  calendarClockRoot.querySelector("[data-cc-event-label-style]").value = labelStyle;
  calendarClockRoot.querySelector("[data-cc-event-label-custom-color]").value = labelCustomColor;
  calendarClockRoot.querySelector("[data-cc-event-label-font-family]").value = labelFontFamily;
  calendarClockRoot.querySelector("[data-cc-event-label-font-size-full]").value = String(labelFontSizeFull);
  calendarClockRoot.querySelector("[data-cc-event-label-font-size-full-output]").textContent = `${labelFontSizeFull}px`;
  calendarClockRoot.querySelector("[data-cc-event-label-font-size-mini]").value = String(labelFontSizeMini);
  calendarClockRoot.querySelector("[data-cc-event-label-font-size-mini-output]").textContent = `${labelFontSizeMini}px`;
  calendarClockRoot.querySelector("[data-cc-event-label-proximity-priority]").checked = labelProximityPriority;
  calendarClockRoot.querySelector("[data-cc-event-label-min-length]").value = String(labelMinLength);
  calendarClockRoot.querySelector("[data-cc-event-label-min-length-output]").textContent = `${labelMinLength} symbols`;
  calendarClockRoot.querySelector("[data-cc-event-label-shorten-threshold]").value = String(labelShortenThreshold);
  calendarClockRoot.querySelector("[data-cc-event-label-shorten-threshold-output]").textContent = formatEventLabelShortenThreshold(labelShortenThreshold);
  const labelAnchorEl = calendarClockRoot.querySelector("[data-cc-event-label-anchor]");
  const labelAnchorText = formatEventLabelAnchor(labelAnchor);
  labelAnchorEl.value = String(getEventLabelAnchorSliderValue(labelAnchor));
  labelAnchorEl.setAttribute("aria-valuetext", labelAnchorText);
  calendarClockRoot.querySelector("[data-cc-event-label-anchor-output]").textContent = labelAnchorText;
  calendarClockRoot.querySelector("[data-cc-event-label-opacity]").value = String(labelOpacity);
  calendarClockRoot.querySelector("[data-cc-event-label-opacity-output]").textContent = `${labelOpacity}%`;
  calendarClockRoot.querySelector("[data-cc-event-label-arc-distance]").value = String(labelArcDistance);
  calendarClockRoot.querySelector("[data-cc-event-label-arc-distance-output]").textContent = `${labelArcDistance}px`;
  calendarClockRoot.querySelector("[data-cc-menu-dark-theme]").checked = calendarClockState.menuDarkTheme;
  const densityLevel = clampPercentLevel(calendarClockState.densityLevel, CALENDAR_CLOCK_PANEL_DEFAULT.densityLevel);
  const arcThicknessLevel = clampPercentLevel(calendarClockState.arcThicknessLevel, CALENDAR_CLOCK_PANEL_DEFAULT.arcThicknessLevel);
  const arcGapLevel = clampPercentLevel(calendarClockState.arcGapLevel, CALENDAR_CLOCK_PANEL_DEFAULT.arcGapLevel);
  calendarClockState.densityLevel = densityLevel;
  calendarClockState.arcThicknessLevel = arcThicknessLevel;
  calendarClockState.arcGapLevel = arcGapLevel;
  calendarClockState.captureLimit = normalizeCalendarClockCaptureLimit(calendarClockState.captureLimit);
  calendarClockState.arcSameLevelNonOverlapping = calendarClockState.arcSameLevelNonOverlapping === true;
  calendarClockState.longDurationArcsVisible = calendarClockState.longDurationArcsVisible !== false;
  calendarClockRoot.querySelector("[data-cc-density-level]").value = String(densityLevel);
  calendarClockRoot.querySelector("[data-cc-density-output]").textContent = String(densityLevel);
  calendarClockRoot.querySelector("[data-cc-arc-thickness-level]").value = String(arcThicknessLevel);
  calendarClockRoot.querySelector("[data-cc-arc-thickness-output]").textContent = String(arcThicknessLevel);
  calendarClockRoot.querySelector("[data-cc-arc-gap-level]").value = String(arcGapLevel);
  calendarClockRoot.querySelector("[data-cc-arc-gap-output]").textContent = String(arcGapLevel);
  calendarClockRoot.querySelector("[data-cc-capture-limit]").value = String(calendarClockState.captureLimit);
  calendarClockRoot.querySelector("[data-cc-arc-same-level-non-overlapping]").checked = calendarClockState.arcSameLevelNonOverlapping;
  calendarClockRoot.querySelector("[data-cc-long-duration-arcs-visible]").checked = calendarClockState.longDurationArcsVisible;
  const collapseButton = calendarClockRoot.querySelector("[data-cc-action='time-panel-collapse']");
  collapseButton.textContent = calendarClockState.timePanelCollapsed ? "+" : "_";
  collapseButton.setAttribute("aria-label", calendarClockState.timePanelCollapsed ? "Expand time settings" : "Collapse time settings");
  updatePanelPosition();
  updateMiniClockPosition();
  updateRootClasses();
  updatePanelStats();
}

function sanitizeCalendarClockFaceAvailability(data) {
  if (!Array.isArray(data?.options)) return null;

  const idPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
  const seenIds = new Set();
  const options = data.options.slice(0, 50).reduce((result, option) => {
    const id = typeof option?.id === "string" ? option.id.trim() : "";
    const name = typeof option?.name === "string" ? option.name.trim().slice(0, 80) : "";
    if (!idPattern.test(id) || !name || seenIds.has(id)) return result;
    seenIds.add(id);
    result.push({ id, name });
    return result;
  }, []);
  const activeFaceId = typeof data.activeFaceId === "string" && idPattern.test(data.activeFaceId)
    ? data.activeFaceId
    : null;
  const requestedFaceId = typeof data.requestedFaceId === "string" && idPattern.test(data.requestedFaceId)
    ? data.requestedFaceId
    : null;

  if (activeFaceId && options.length && !seenIds.has(activeFaceId)) return null;
  return {
    options,
    activeFaceId,
    requestedFaceId,
    activeFaceAuthoritative: data.activeFaceAuthoritative === true
  };
}

function updateCalendarClockFaceSelect() {
  const select = calendarClockRoot?.querySelector("[data-cc-clock-face]");
  if (!select) return;

  if (!Array.isArray(calendarClockFaceOptions)) {
    select.disabled = true;
    return;
  }

  const signature = JSON.stringify({ options: calendarClockFaceOptions, actual: calendarClockActualFaceId });
  if (select.dataset.ccFaceOptionsSignature !== signature) {
    const optionElements = calendarClockFaceOptions.map(face => {
      const option = document.createElement("option");
      option.value = face.id;
      option.textContent = face.name;
      return option;
    });

    if (!optionElements.length) {
      const fallbackOption = document.createElement("option");
      fallbackOption.value = calendarClockActualFaceId || "";
      fallbackOption.textContent = calendarClockActualFaceId
        ? `Current fallback: ${calendarClockActualFaceId}`
        : "No clock designs available";
      fallbackOption.disabled = true;
      optionElements.push(fallbackOption);
    }

    select.replaceChildren(...optionElements);
    select.dataset.ccFaceOptionsSignature = signature;
  }

  select.disabled = calendarClockFaceOptions.length === 0;
  select.value = normalizeCalendarClockFaceId(calendarClockState.clockFaceId);
}

function applyCalendarClockFaceAvailability(data) {
  const availability = sanitizeCalendarClockFaceAvailability(data);
  if (!availability) return;

  const previousFaceId = calendarClockState.clockFaceId;
  calendarClockFaceOptions = availability.options;
  calendarClockActualFaceId = availability.activeFaceId;

  const acknowledgedCurrentRequest = availability.requestedFaceId !== null
    && availability.requestedFaceId === String(previousFaceId || "").trim();
  const nextFaceId = (availability.activeFaceAuthoritative || acknowledgedCurrentRequest) && availability.activeFaceId
    ? availability.activeFaceId
    : normalizeCalendarClockFaceId(previousFaceId);
  const changed = nextFaceId !== previousFaceId;
  calendarClockState.clockFaceId = nextFaceId;
  updatePanelControls();

  if (!changed) return;
  saveCalendarClockState();
  syncClockFrame({ rebuild: true });
  renderDebugPanel();
}

function updatePanelStats() {
  if (!calendarClockRoot) return;
  const failedDateEvents = getCalendarClockDateParseFailures();
  const parsedEvents = calendarClockEvents.filter(event => !isCalendarClockDateParseFailed(event));
  const visible = parsedEvents.filter(event => getVisibleEventSegment(event)).length;
  const outside = Math.max(0, parsedEvents.length - visible);
  const hiddenUndatedTasks = parsedEvents.filter(isUndatedGoogleTaskHiddenOutsideToday);
  const omittedCaptureCount = getCalendarClockCaptureOmittedCount();
  const captureLimitNotice = getCalendarClockCaptureLimitNotice();
  const storageStatus = calendarClockStorageStatus;
  const stats = calendarClockRoot.querySelector("[data-cc-stats]");
  const summary = calendarClockRoot.querySelector("[data-cc-window-summary]");
  const warning = calendarClockRoot.querySelector("[data-cc-parser-warning]");
  const fitButton = calendarClockRoot.querySelector("[data-cc-action='fit']");
  const jumpButton = calendarClockRoot.querySelector("[data-cc-action='jump']");
  summary.textContent = `Clock shows ${getWindowSummaryText()}`;
  const baseStats = failedDateEvents.length
    ? `${visible} visible · ${outside} outside · ${failedDateEvents.length} date issue · ${calendarClockEvents.length} captured`
    : hiddenUndatedTasks.length
      ? `${visible} visible · ${outside} outside · ${hiddenUndatedTasks.length} undated task hidden · ${calendarClockEvents.length} captured`
    : `${visible} visible · ${outside} outside · ${calendarClockEvents.length} captured`;
  stats.textContent = omittedCaptureCount
    ? `${baseStats} · ${omittedCaptureCount} omitted`
    : storageStatus?.kind === "history-trimmed"
      ? `${baseStats} · older history trimmed`
      : baseStats;
  if (warning) {
    warning.hidden = failedDateEvents.length === 0
      && hiddenUndatedTasks.length === 0
      && omittedCaptureCount === 0
      && !storageStatus;
    renderCalendarClockWarningRows(warning, {
      storageStatus,
      omittedCaptureCount,
      captureLimitNotice,
      failedDateCount: failedDateEvents.length,
      hiddenUndatedTaskCount: hiddenUndatedTasks.length
    });
  }
  fitButton.disabled = calendarClockState.radial24Hour;
  jumpButton.disabled = calendarClockState.radial24Hour || outside === 0;
}

function persistWindowAndSync(options = {}) {
  if (!options.skipSave) saveCalendarClockState({ debounceMs: options.saveDebounceMs });
  updatePanelControls();
  syncClockFrame({ rebuild: options.rebuild === true });
  renderDebugPanel();
  if (options.recapture === true) queuePublishCalendarEvents();
}

function setClockMode(mode, options = {}) {
  calendarClockState.mode = ["full", "mini", "hidden"].includes(mode) ? mode : "hidden";
  if (calendarClockState.mode === "mini") updateMiniClockPosition();
  updatePanelPosition();
  updateRootClasses();
  if (!options.skipSave) saveCalendarClockState();
  syncClockFrame({ rebuild: true });
}

function setTimePanelOpen(open, options = {}) {
  calendarClockState.timePanelOpen = Boolean(open);
  let changed = false;
  if (calendarClockState.timePanelOpen) {
    calendarClockState.timePanelCollapsed = false;
    calendarClockWhatsNewOpen = false;
  }
  updateRootClasses();
  updatePanelControls();
  if (calendarClockState.timePanelOpen) {
    changed = applyInitialTimePanelSize();
  }
  changed = updatePanelPosition() || changed;
  if (!options.skipSave) saveCalendarClockState();
}

function getCalendarClockFrameTargetOrigin() {
  if (!canUseCalendarClockExtensionApi()) return null;

  try {
    return new URL(chrome.runtime.getURL("")).origin;
  } catch (error) {
    markCalendarClockExtensionContextInvalidated(error);
    return null;
  }
}

function postCalendarClockFrameMessage(message, targetOrigin) {
  try {
    calendarClockFrame.contentWindow.postMessage(message, targetOrigin);
    return true;
  } catch (error) {
    calendarClockFrameReady = false;
    calendarClockWarn("clock frame message skipped", error);
    return false;
  }
}

function syncClockFrame(options = {}) {
  const targetOrigin = getCalendarClockFrameTargetOrigin();
  if (!targetOrigin || !calendarClockFrame?.contentWindow) return;
  if (!calendarClockFrameReady) {
    calendarClockPendingFrameRebuild = calendarClockPendingFrameRebuild || options.rebuild === true;
    return;
  }
  const displayWindow = getDisplayWindow();
  const { startDate, endDate } = getWindowDateRange();
  const anchorDate = getWindowAnchorDate();
  const anchorStartDate = makeCalendarClockZonedDate(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), anchorDate.getUTCDate());
  if ([startDate, endDate, anchorStartDate].some(date => Number.isNaN(date.getTime()))) {
    calendarClockWarn("clock frame sync skipped: Calendar temporal context is unavailable");
    return;
  }
  calendarClockLastWindowDateRangeKey = `${startDate.getTime()}-${endDate.getTime()}`;
  if (!postCalendarClockFrameMessage({
    type: "CALENDAR_CLOCK_SET_WINDOW",
    mode: calendarClockState.mode,
    start: formatClockMinutes(displayWindow.start),
    end: formatClockMinutes(displayWindow.end),
    baseDate: anchorStartDate.toISOString(),
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    durationMinutes: displayWindow.duration,
    radial24Hour: calendarClockState.radial24Hour,
    clockFaceId: calendarClockState.clockFaceId,
    timeZone: typeof getCalendarClockTimeZone === "function" ? getCalendarClockTimeZone() : "",
    systemTimeZone: typeof getCalendarClockSystemTimeZone === "function" ? getCalendarClockSystemTimeZone() : "",
    transient: calendarClockState.followNow
  }, targetOrigin)) return;
  if (!postCalendarClockFrameMessage({
    type: "CALENDAR_CLOCK_SET_WINDOW_START_MARKER",
    visible: calendarClockState.windowStartMarker,
    style: calendarClockState.windowStartMarkerStyle,
    shape: calendarClockState.windowStartMarkerShape,
    color: calendarClockState.windowStartMarkerColor,
    width: calendarClockState.windowStartMarkerWidth,
    dots: calendarClockState.windowStartMarkerDots,
    emoji: calendarClockState.windowStartMarkerEmoji,
    labels: calendarClockState.windowStartMarkerLabels === true,
    pulse: calendarClockState.windowStartMarkerPulse !== false,
    transparency: calendarClockState.windowStartMarkerTransparency
  }, targetOrigin)) return;
  if (!postCalendarClockFrameMessage({
    type: "CALENDAR_CLOCK_SET_24_HOUR_RADIAL",
    enabled: calendarClockState.radial24Hour
  }, targetOrigin)) return;
  if (!postCalendarClockFrameMessage({
    type: "CALENDAR_CLOCK_SET_EVENT_LABELS",
    enabled: calendarClockState.eventLabels === true,
    style: calendarClockState.eventLabelStyle,
    customColor: calendarClockState.eventLabelCustomColor,
    fontFamily: calendarClockState.eventLabelFontFamily,
    fontSize: getCalendarClockEventLabelFontSizeForMode(),
    proximityPriority: calendarClockState.eventLabelProximityPriority === true,
    minLength: calendarClockState.eventLabelMinLength,
    shortenThreshold: calendarClockState.eventLabelShortenThreshold,
    anchor: calendarClockState.eventLabelAnchor,
    opacity: calendarClockState.eventLabelOpacity,
    arcDistance: calendarClockState.eventLabelArcDistance
  }, targetOrigin)) return;
  if (!postCalendarClockFrameMessage({
    type: "CALENDAR_CLOCK_SET_DENSITY",
    visible: calendarClockState.arcsVisible !== false,
    densityLevel: calendarClockState.densityLevel,
    arcThicknessLevel: calendarClockState.arcThicknessLevel,
    arcGapLevel: calendarClockState.arcGapLevel,
    sameLevelNonOverlapping: calendarClockState.arcSameLevelNonOverlapping === true,
    longDurationArcsVisible: calendarClockState.longDurationArcsVisible !== false
  }, targetOrigin)) return;
  if (!postCalendarClockFrameMessage({
    type: "CALENDAR_CLOCK_SET_MAGNIFIER",
    enabled: calendarClockState.magnifierEnabled !== false,
    hoverEnabled: calendarClockState.magnifierHoverEnabled !== false,
    centerCursor: calendarClockState.magnifierCenterCursor === true,
    autoEnabled: calendarClockState.magnifierAutoEnabled !== false,
    autoMinuteHandEnabled: calendarClockState.magnifierAutoMinuteHandEnabled === true,
    autoEventStartEnabled: calendarClockState.magnifierAutoEventStartEnabled === true,
    autoEventStartAttention: calendarClockState.magnifierAutoEventStartAttention === true,
    autoEventEndEnabled: calendarClockState.magnifierAutoEventEndEnabled === true,
    autoEventEndAttention: calendarClockState.magnifierAutoEventEndAttention === true,
    lensSize: calendarClockState.magnifierLensSize,
    autoIntervalSeconds: calendarClockState.magnifierAutoIntervalSeconds
  }, targetOrigin)) return;
  if (!postCalendarClockFrameMessage({
    type: "CALENDAR_CLOCK_SET_CONSOLE_LOGS",
    enabled: calendarClockState.consoleLogs === true
  }, targetOrigin)) return;
  if (options.rebuild === true) {
    postCalendarClockFrameMessage({ type: "CALENDAR_CLOCK_REBUILD" }, targetOrigin);
  }
}

function bindCalendarEventHover(node, eventId) {
  calendarClockBoundNodeEventIds.set(node, eventId);
  if (calendarClockBoundNodes.has(node)) return;
  calendarClockBoundNodes.add(node);

  node.addEventListener("pointerenter", () => {
    sendToClockFrame({ type: "CALENDAR_CLOCK_EVENT_HOVER", eventId: calendarClockBoundNodeEventIds.get(node) });
  });

  node.addEventListener("pointerleave", () => {
    sendToClockFrame({ type: "CALENDAR_CLOCK_EVENT_LEAVE", eventId: calendarClockBoundNodeEventIds.get(node) });
  });
}

function sendToClockFrame(message) {
  const targetOrigin = getCalendarClockFrameTargetOrigin();
  if (!targetOrigin || !calendarClockFrame?.contentWindow || !calendarClockFrameReady) return;
  postCalendarClockFrameMessage(message, targetOrigin);
}

function clearCalendarClockFrameEvents() {
  sendToClockFrame({ type: "CALENDAR_CLOCK_CLEAR_EVENTS" });
}

function reloadCalendarClockFrameEvents() {
  sendToClockFrame({ type: "CALENDAR_CLOCK_RELOAD_EVENTS" });
}

function highlightCalendarEvent(eventId, index, scroll) {
  const event = calendarClockEvents[index] || calendarClockEvents.find(item => item.id === eventId || item.domKey === eventId);
  const node = calendarClockEventNodes.get(eventId) || calendarClockEventNodes.get(event?.domKey);
  if (!node) return;

  if (highlightedCalendarNode && highlightedCalendarNode !== node) {
    highlightedCalendarNode.classList.remove("calendar-clock-dom-highlight");
  }

  highlightedCalendarNode = node;
  node.classList.add("calendar-clock-dom-highlight");
  if (scroll) node.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
}

function clearCalendarEventHighlight() {
  if (!highlightedCalendarNode) return;
  highlightedCalendarNode.classList.remove("calendar-clock-dom-highlight");
  highlightedCalendarNode = null;
}
