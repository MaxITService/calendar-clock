// Keeps the optional timer panel movable and reachable after viewport/content changes.
export function installDragging({ panel, handle, window, getState, saveState }) {
  let drag = null;
  handle.title = "Drag to move timers. Use arrow keys when focused.";
  handle.tabIndex = 0;
  handle.setAttribute("aria-label", "Move timers panel");

  function place(x, y) {
    const rect = panel.getBoundingClientRect();
    const state = getState();
    state.timersX = Math.round(Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)));
    state.timersY = Math.round(Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)));
    panel.style.left = `${state.timersX}px`;
    panel.style.top = `${state.timersY}px`;
    panel.style.right = "auto";
    panel.style.transform = "none";
  }

  function finish(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    const { pointerId } = drag;
    drag = null;
    delete handle.dataset.dragging;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    saveState();
  }

  function down(event) {
    if (event.button !== 0 || event.isPrimary === false || event.target.closest("button") || panel.hidden) return;
    const rect = panel.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    handle.dataset.dragging = "true";
    event.preventDefault();
  }

  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    place(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
  }

  function keydown(event) {
    if (event.target !== handle || event.altKey || event.ctrlKey || event.metaKey || panel.hidden) return;
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const step = event.shiftKey ? 50 : 10;
    place(rect.left + direction[0] * step, rect.top + direction[1] * step);
    saveState();
  }

  function update() {
    if (panel.hidden) { finish(); return; }
    const state = getState();
    if (!Number.isFinite(state.timersX) || !Number.isFinite(state.timersY)) {
      for (const property of ["left", "top", "right", "transform"]) panel.style.removeProperty(property);
      return;
    }
    const { timersX, timersY } = state;
    place(timersX, timersY);
    if (state.timersX !== timersX || state.timersY !== timersY) saveState();
  }

  handle.addEventListener("pointerdown", down);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  handle.addEventListener("keydown", keydown);
  window.addEventListener("resize", update);
  const observer = window.ResizeObserver ? new window.ResizeObserver(update) : null;
  observer?.observe(panel);
  return {
    update,
    destroy() {
      finish();
      observer?.disconnect();
      window.removeEventListener("resize", update);
      handle.removeEventListener("pointerdown", down);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      handle.removeEventListener("lostpointercapture", finish);
      handle.removeEventListener("keydown", keydown);
    }
  };
}
