const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled]):not([hidden]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export class UploadGenerationGuard {
  constructor() {
    this.generation = 0;
    this.session = 0;
    this.uploadInFlight = false;
  }

  openSession() {
    this.session += 1;
    this.generation += 1;
    this.uploadInFlight = false;
    return this.session;
  }

  begin(session) {
    if (session !== this.session) return null;
    this.generation += 1;
    this.uploadInFlight = true;
    return { session, generation: this.generation };
  }

  isCurrent(ticket) {
    return Boolean(ticket)
      && ticket.session === this.session
      && ticket.generation === this.generation
      && this.uploadInFlight;
  }

  finish(ticket) {
    if (!this.isCurrent(ticket)) return false;
    this.uploadInFlight = false;
    return true;
  }

  invalidate(session = this.session) {
    if (session !== this.session) return false;
    this.generation += 1;
    this.uploadInFlight = false;
    return true;
  }

  closeSession(session = this.session) {
    if (session !== this.session) return false;
    this.generation += 1;
    this.session += 1;
    this.uploadInFlight = false;
    return true;
  }
}

export function inertModalBackground(modal, body) {
  const snapshots = [];
  let branch = modal;
  while (branch?.parentElement) {
    const parent = branch.parentElement;
    Array.from(parent.children || []).forEach(sibling => {
      if (sibling === branch) return;
      snapshots.push({ element: sibling, inert: Boolean(sibling.inert) });
      sibling.inert = true;
    });
    branch = parent;
    if (parent === body) break;
  }
  return () => {
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index];
      snapshot.element.inert = snapshot.inert;
    }
  };
}

export function wrapDialogTab(event, focusable, activeElement) {
  if (event.key !== "Tab" || !focusable.length) return false;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (activeElement === first || !focusable.includes(activeElement))) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (activeElement === last || !focusable.includes(activeElement))) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

export function createModalFocusBoundary({ document, modal, dialog, initialFocus, returnFocus }) {
  const restoreInert = inertModalBackground(modal, document.body);
  let active = true;
  const focusable = () => Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR));
  const focusFirst = () => (focusable()[0] || initialFocus)?.focus?.();
  const containFocus = event => {
    if (!active || dialog.contains(event.target)) return;
    focusFirst();
  };
  document.addEventListener("focusin", containFocus, true);
  (initialFocus || focusable()[0])?.focus?.();
  return {
    handleTab(event) {
      return wrapDialogTab(event, focusable(), document.activeElement);
    },
    destroy({ restoreFocus = true } = {}) {
      if (!active) return;
      active = false;
      document.removeEventListener("focusin", containFocus, true);
      restoreInert();
      if (restoreFocus) returnFocus?.focus?.();
    }
  };
}
