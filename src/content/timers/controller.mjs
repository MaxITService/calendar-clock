import { createTimer, normalizeTimers, timerValue, timerFinished, formatTimerTime, parseTimerTime, changeTimer, snapshotTimers, restoreTimers } from "./model.mjs";

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
  const add = button("+", "Add a timer", () => {
    const state = getState();
    if (state.timers.length >= 100) return;
    state.timers = [...normalizeTimers(state.timers), createTimer(window.crypto.randomUUID())];
    saveState();
    render();
    cards.lastElementChild?.querySelector("button")?.focus();
  }, "cc-timer-add");
  heading.append(element("strong", "", "Timers"), add);
  panel.append(heading, cards);
  root.append(style);
  root.querySelector(".cc-clock-surface").after(panel);
  host.append(settings);
  let rows = [];
  let signature = "";
  let interval = null;
  let destroyed = false;
  let lastSavedAt = Date.now();
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

  function commit(id, action, options) {
    getState().timers = normalizeTimers(getState().timers).map(timer => timer.id === id
      ? changeTimer(timer, action, Date.now(), options) : timer);
    saveState();
    render();
    const row = rows.find(item => item.timer.id === id);
    row?.card.querySelector(action === "configure" ? ".cc-divider-settings-btn" : ".cc-timer-controls button")?.focus();
  }

  function makeCard(timer, index) {
    const card = element("article", "cc-timer-card");
    const header = element("div", "cc-timer-heading");
    const name = element("strong", "", `Timer ${index + 1}`);
    const details = element("div", "cc-timer-settings");
    details.hidden = true;
    const gear = button("⚙️", "Timer settings: direction and starting time", () => {
      details.hidden = !details.hidden;
      gear.setAttribute("aria-expanded", String(!details.hidden));
      if (!details.hidden) {
        const current = normalizeTimers(getState().timers).find(item => item.id === timer.id);
        direction.value = current.mode;
        time.value = formatTimerTime(timerValue(current), current.mode);
      }
    }, "cc-divider-settings-btn");
    gear.setAttribute("aria-expanded", "false");
    const remove = button("×", "Remove timer", () => {
      getState().timers = getState().timers.filter(item => item.id !== timer.id);
      if (!getState().timers.length) getState().timers = [createTimer(window.crypto.randomUUID())];
      saveState();
      render();
    }, "cc-timer-remove");
    header.append(name, gear, remove);
    const display = element("output", "cc-timer-display");
    display.setAttribute("aria-label", `Timer ${index + 1} time`);
    const status = element("span", "cc-timer-status");
    const controls = element("div", "cc-timer-controls");
    const play = button("Start", "Start timer", () => {
      const current = normalizeTimers(getState().timers).find(item => item.id === timer.id);
      commit(timer.id, current.phase === "running" && !timerFinished(current) ? "pause" : "start");
    });
    const stop = button("Stop", "Stop and keep the result. Start begins again from the configured time.", () => commit(timer.id, "stop"));
    const reset = button("Reset", "Reset to the configured starting time", () => commit(timer.id, "reset"));
    controls.append(play, stop, reset);
    const directionLabel = element("label", "", "Direction");
    const direction = document.createElement("select");
    for (const [value, text] of [["up", "Count up"], ["down", "Count down to zero"]]) {
      const option = element("option", "", text);
      option.value = value;
      direction.append(option);
    }
    direction.value = timer.mode;
    directionLabel.append(direction);
    const timeLabel = element("label", "", "Starting time (HH:MM:SS)");
    const time = document.createElement("input");
    time.type = "text";
    time.value = formatTimerTime(timerValue(timer), timer.mode);
    time.placeholder = "00:05:00";
    time.maxLength = 12;
    time.spellcheck = false;
    time.addEventListener("input", () => time.setCustomValidity(""));
    timeLabel.append(time);
    const apply = button("Apply", "Set starting time and direction; timer will be ready to start", () => {
      const valueMs = parseTimerTime(time.value);
      time.setCustomValidity(valueMs === null ? "Enter hours, minutes and seconds, for example 00:05:00." : "");
      if (!time.reportValidity()) return;
      commit(timer.id, "configure", { mode: direction.value, valueMs });
    });
    details.append(directionLabel, timeLabel, element("small", "", "Uses the current reading. Edit it or choose a direction, then Apply and Start."), apply);
    card.append(header, display, status, controls, details);
    return { card, display, status, play, stop, timer };
  }

  function tick() {
    const now = Date.now();
    for (const row of rows) {
      const { timer } = row;
      const finished = timerFinished(timer, now);
      row.display.textContent = formatTimerTime(timerValue(timer, now), timer.mode);
      row.status.textContent = finished ? "Finished" : `${timer.mode === "down" ? "Count down" : "Count up"} · ${timer.phase}`;
      row.play.textContent = timer.phase === "running" && !finished ? "Pause" : timer.phase === "paused" ? "Resume" : "Start";
      row.play.setAttribute("aria-label", `${row.play.textContent} timer`);
      row.play.disabled = timer.mode === "down" && timerValue(timer, now) === 0 && timer.initialMs === 0;
      row.stop.disabled = ["idle", "stopped"].includes(timer.phase) || finished;
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
    saveState();
    render();
  });
  function destroy() {
    if (destroyed) return;
    destroyed = true;
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
