import { createTimer, normalizeTimers, timerValue, timerFinished, timerAtStart, formatTimerTime, parseTimerTime, changeTimer, snapshotTimers, restoreTimers } from "./model.mjs";
import { installDragging } from "./drag.mjs";

export async function install({ root, getState, saveState, onContextInvalidated }) {
  const document = root.ownerDocument;
  const window = document.defaultView;
  const host = root.querySelector(".cc-visuals-grid");
  if (!host) return null;
  const response = await fetch(new URL("./styles.css", import.meta.url));
  if (!response.ok) throw new Error("Timer styles unavailable");
  const style = document.createElement("style");
  style.textContent = await response.text();

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, title, onClick, className = "") {
    const node = element("button", className, text);
    node.type = "button";
    node.title = title;
    node.setAttribute("aria-label", title);
    node.addEventListener("click", onClick);
    return node;
  }
  const settings = element("div", "cc-timer-global-settings");
  const toggleLabel = element("label", "cc-toggle");
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  toggleLabel.append(enabled, element("span", "cc-toggle-slider"), element("span", "cc-toggle-label", "Timers (Full)"));
  const sideLabel = element("label", "cc-timer-side-label", "Side ");
  const side = document.createElement("select");
  side.setAttribute("aria-label", "Timer panel side");
  for (const [value, text] of [["left", "Left"], ["right", "Right"]]) {
    const option = element("option", "", text);
    option.value = value;
    side.append(option);
  }
  sideLabel.append(side);
  settings.append(toggleLabel, sideLabel);
  const panel = element("section", "cc-panel cc-timers");
  panel.setAttribute("aria-label", "Timers");
  const heading = element("div", "cc-timers-heading");
  const cards = element("div", "cc-timer-list");
  function addTimer() {
    const state = getState();
    if (state.timers.length >= 100) return;
    const timer = createTimer(window.crypto.randomUUID());
    state.timers = [...normalizeTimers(state.timers), timer];
    saveState();
    render();
    cards.lastElementChild?.querySelector("button")?.focus();
  }
  const add = button("+", "Add a timer", addTimer, "cc-timer-add");
  const close = button("×", "Close timers", () => {
    getState().timersEnabled = false;
    render();
    saveState();
    root.querySelector('[data-cc-action="time-panel-toggle"]')?.focus();
  }, "cc-timers-close");
  heading.append(element("strong", "", "Timers"), add, close);
  panel.append(heading, cards);
  root.append(style);
  root.querySelector(".cc-clock-surface").after(panel);
  host.append(settings);
  let rows = [];
  let signature = "";
  let interval = null;
  let destroyed = false;
  let lastSavedAt = Date.now();
  const dragging = installDragging({ panel, handle: heading, window, getState, saveState });
  getState().timers = restoreTimers(getState().timers);

  function snapshot() {
    return snapshotTimers(getState().timers);
  }

  function pauseTimers() {
    if (!normalizeTimers(getState().timers).some(timer => timer.phase === "running")) return;
    getState().timers = snapshot();
    saveState();
  }

  function onPageHide() {
    pauseTimers();
    render();
  }

  function commit(id, action, options, focusSelector) {
    getState().timers = normalizeTimers(getState().timers).map(timer => timer.id === id
      ? changeTimer(timer, action, Date.now(), options) : timer);
    saveState();
    render();
    const row = rows.find(item => item.timer.id === id);
    row?.card.querySelector(focusSelector ?? ".cc-timer-play")?.focus();
  }

  function makeCard(timer, index) {
    const card = element("article", "cc-timer-card");
    const header = element("div", "cc-timer-heading");
    const name = element("strong", "", `Timer ${index + 1}`);
    const remove = button("×", "Remove timer", () => {
      getState().timers = getState().timers.filter(item => item.id !== timer.id);
      if (!getState().timers.length) getState().timers = [createTimer(window.crypto.randomUUID())];
      saveState();
      render();
    }, "cc-timer-remove");
    header.append(name, remove);
    const display = button("", `Edit timer ${index + 1} time`, () => startEdit(), "cc-timer-display");
    display.title = "Click to set the time. Empty = 00:00:00.";
    const editor = element("input", "cc-timer-time-editor");
    editor.type = "text";
    editor.hidden = true;
    editor.maxLength = 20;
    editor.spellcheck = false;
    editor.placeholder = "00:00:00";
    editor.setAttribute("aria-label", "Timer time");
    const hint = element("small", "cc-timer-hint", "5:00 · 25m · 1h30m · 500 = 5:00 · empty = 0. Enter saves, Esc cancels.");
    hint.hidden = true;
    let editing = false;
    let originalTime = "";
    function startEdit() {
      const current = normalizeTimers(getState().timers).find(item => item.id === timer.id);
      originalTime = formatTimerTime(timerValue(current), current.mode);
      editor.value = originalTime;
      editor.setCustomValidity("");
      editing = true;
      display.hidden = true;
      editor.hidden = false;
      hint.hidden = false;
      editor.focus();
      editor.select();
    }
    function cancelEdit() {
      editing = false;
      editor.hidden = true;
      hint.hidden = true;
      display.hidden = false;
      display.focus();
    }
    function saveEdit() {
      if (!editing) return;
      if (editor.value.trim() === originalTime) { cancelEdit(); return; }
      const valueMs = parseTimerTime(editor.value);
      editor.setCustomValidity(valueMs === null ? "Try 5:00, 25m, 1h30m or 1:30:00." : "");
      if (!editor.reportValidity()) return;
      cancelEdit();
      commit(timer.id, "configure", { mode: timer.mode, valueMs }, ".cc-timer-display");
    }
    editor.addEventListener("input", () => editor.setCustomValidity(""));
    editor.addEventListener("blur", () => {
      // Leaving an invalid entry must not trap the user; it simply cancels.
      if (editing && parseTimerTime(editor.value) === null) cancelEdit();
      else saveEdit();
    });
    editor.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); saveEdit(); }
      if (event.key === "Escape") { event.preventDefault(); cancelEdit(); }
    });
    const status = element("span", "cc-timer-status");
    const adjust = element("div", "cc-timer-adjust");
    adjust.hidden = timer.mode !== "down";
    for (const minutes of [1, 5, 15]) {
      adjust.append(button(`+${minutes}m`, `Add ${minutes} minute${minutes > 1 ? "s" : ""}`,
        () => commit(timer.id, "adjust", { deltaMs: minutes * 60000 }, ".cc-timer-adjust button")));
    }
    const controls = element("div", "cc-timer-controls");
    const play = button("Start", "Start timer", () => {
      const current = normalizeTimers(getState().timers).find(item => item.id === timer.id);
      commit(timer.id, current.phase === "running" && !timerFinished(current) ? "pause" : "start");
    }, "cc-timer-play");
    const reset = button("Reset", "Reset", () => commit(timer.id, "reset", {}, ".cc-timer-reset"), "cc-timer-reset");
    controls.append(play, reset);
    const directionLabel = element("label", "cc-timer-direction", "Direction");
    const direction = document.createElement("select");
    direction.title = "Changing direction keeps the current reading and pauses the timer.";
    for (const [value, text] of [["up", "Count up"], ["down", "Count down to zero"]]) {
      const option = element("option", "", text);
      option.value = value;
      direction.append(option);
    }
    direction.value = timer.mode;
    direction.addEventListener("change", () => {
      commit(timer.id, "configure", { mode: direction.value }, ".cc-timer-direction select");
    });
    directionLabel.append(direction);
    card.append(header, directionLabel, display, editor, hint, status, adjust, controls);
    return { card, display, status, play, reset, timer };
  }

  function tick() {
    const now = Date.now();
    for (const row of rows) {
      const { timer } = row;
      const finished = timerFinished(timer, now);
      const value = timerValue(timer, now);
      row.display.textContent = formatTimerTime(value, timer.mode);
      row.card.dataset.finished = String(finished);
      const running = timer.phase === "running" && !finished;
      row.status.textContent = finished ? "Time's up"
        : running ? (timer.mode === "down" ? "Counting down" : "Counting up")
        : timer.phase === "paused" ? "Paused"
        : timer.mode === "down" && value === 0 ? "Set a time to count down"
        : "Ready";
      row.play.textContent = running ? "Pause" : timer.phase === "paused" ? "Resume"
        : finished || timer.phase === "stopped" ? "Restart" : "Start";
      row.play.setAttribute("aria-label", `${row.play.textContent} timer`);
      row.play.disabled = timer.mode === "down" && value === 0 && timer.initialMs === 0;
      const clears = timerAtStart(timer);
      row.reset.textContent = clears ? "Clear" : "Reset";
      row.reset.title = clears ? "Clear the time to 00:00:00"
        : `Back to ${formatTimerTime(timer.initialMs, timer.mode)}`;
      row.reset.setAttribute("aria-label", row.reset.title);
      row.reset.disabled = clears && timer.initialMs === 0;
    }
    if (rows.some(row => row.timer.phase === "running")
        && (now - lastSavedAt >= 1000 || rows.some(row => timerFinished(row.timer, now)))) {
      lastSavedAt = now;
      // A paused checkpoint also survives abrupt shutdowns where pagehide cannot run.
      saveState();
    }
    if (interval !== null && !rows.some(row => row.timer.phase === "running" && !timerFinished(row.timer, now))) {
      window.clearInterval(interval);
      interval = null;
    }
  }

  function render() {
    if (destroyed) return;
    const state = getState();
    enabled.checked = state.timersEnabled === true;
    side.value = state.timersSide === "left" ? "left" : "right";
    side.disabled = !enabled.checked;
    panel.dataset.side = side.value;
    panel.hidden = !enabled.checked || state.mode !== "full";
    if (panel.hidden) {
      dragging.update();
      pauseTimers();
      window.clearInterval(interval);
      interval = null;
      return;
    }
    let timers = normalizeTimers(state.timers);
    if (!timers.length) {
      timers = [createTimer(window.crypto.randomUUID())];
      state.timers = timers;
      saveState();
    }
    const nextSignature = JSON.stringify(timers);
    if (signature !== nextSignature) {
      signature = nextSignature;
      rows = timers.map(makeCard);
      cards.replaceChildren(...rows.map(row => row.card));
    }
    add.disabled = timers.length >= 100;
    dragging.update();
    tick();
    if (interval === null && timers.some(timer => timer.phase === "running" && !timerFinished(timer))) {
      interval = window.setInterval(tick, 250);
    }
  }
  enabled.addEventListener("change", () => {
    getState().timersEnabled = enabled.checked;
    saveState();
    render();
  });
  side.addEventListener("change", () => {
    getState().timersSide = side.value;
    getState().timersX = null;
    getState().timersY = null;
    saveState();
    render();
  });
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    dragging.destroy();
    pauseTimers();
    window.removeEventListener("pagehide", onPageHide);
    window.clearInterval(interval);
    panel.remove();
    settings.remove();
    style.remove();
  }
  window.addEventListener("pagehide", onPageHide);
  onContextInvalidated(destroy);
  render();
  return { update: render, destroy, snapshot };
}
