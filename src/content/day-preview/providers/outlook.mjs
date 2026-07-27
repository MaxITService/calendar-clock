import { navigateWithPeriodControls, normalizeDateKeys } from "./navigation-contract.mjs";

export const OUTLOOK_DAY_TRANSITION_MAX_ATTEMPTS = 7;

export function getOutlookViewMode(pathname = "") {
  const match = String(pathname).match(/\/calendar\/(?:[^/]+\/)?view\/(day|workweek|week|month)(?:\/|$)/i);
  return match?.[1]?.toLowerCase() || "";
}

export function getOutlookViewPeriod(pathname = "") {
  const mode = getOutlookViewMode(pathname);
  return mode === "workweek" ? "week" : mode;
}

export function isWeekendDateKey(dateKey = "") {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay();
  return Number.isFinite(date.getTime()) && (day === 0 || day === 6);
}

export function getOutlookNavigableDateKeys(context = {}) {
  const renderedDates = normalizeDateKeys(
    Array.from(context.document?.querySelectorAll?.("[data-column-date]") || [])
    .filter(node => !node.closest?.("#calendar-clock-root"))
    .map(node => String(node.getAttribute?.("data-column-date") || "").trim())
  );
  return renderedDates.length
    ? renderedDates
    : normalizeDateKeys(context.readHostDateKeys?.());
}

function normalizedControlText(control) {
  return [
    control?.getAttribute?.("aria-label"),
    control?.getAttribute?.("title"),
    control?.getAttribute?.("data-tooltip"),
    control?.getAttribute?.("tooltip"),
    control?.textContent
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

function getProviderButtons(document) {
  return Array.from(document?.querySelectorAll?.("button, [role='button']") || [])
    .filter(control => !control.closest?.("#calendar-clock-root") && !control.disabled);
}

function getButtonGroup(button, candidates) {
  let ancestor = button?.parentElement || null;
  for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
    const buttons = Array.from(ancestor.querySelectorAll?.("button, [role='button']") || [])
      .filter(candidate => candidates.includes(candidate));
    const periodButtons = buttons.filter(candidate => candidate.getAttribute?.("toolbaritemtype") === "10");
    const dateMenu = buttons.find(candidate => candidate.getAttribute?.("aria-haspopup") === "menu");
    if (periodButtons.length !== 2 || !dateMenu) continue;
    const today = buttons.find(candidate => !periodButtons.includes(candidate) && candidate !== dateMenu);
    if (today) return { today, previous: periodButtons[0], next: periodButtons[1] };
  }
  return null;
}

function findOutlookPrimaryNavigationGroup(candidates) {
  for (const control of candidates) {
    if (control.getAttribute?.("toolbaritemtype") !== "10") continue;
    const group = getButtonGroup(control, candidates);
    if (group) return group;
  }
  return null;
}

function hasOutlookIcon(control, iconPrefix) {
  return Array.from(control?.querySelectorAll?.("[data-icon-name]") || []).some(icon =>
    String(icon.getAttribute?.("data-icon-name") || "")
      .toLowerCase()
      .startsWith(iconPrefix.toLowerCase())
  );
}

export function findOutlookDayViewControl(document) {
  const byCommandId = document?.querySelector?.('button[data-unique-id="Ribbon-2504"]');
  if (byCommandId && !byCommandId.disabled && !byCommandId.closest?.("#calendar-clock-root")) {
    return byCommandId;
  }

  const dayIcon = document?.querySelector?.('[data-icon-name="CalendarDayRegular"]');
  const byIcon = dayIcon?.closest?.("button, [role='button']");
  return byIcon && !byIcon.disabled && !byIcon.closest?.("#calendar-clock-root")
    ? byIcon
    : null;
}

async function waitForOutlookDayView(context, previousDateKeys) {
  const timeoutMs = Math.max(250, Math.min(5000, Number(context.settleTimeoutMs) || 2500));
  const pollMs = Math.max(40, Math.min(500, Number(context.pollMs) || 100));
  const deadline = Date.now() + timeoutMs;
  let stableSignature = "";
  let stablePollCount = 0;
  while (!context.signal?.aborted && Date.now() < deadline) {
    const mode = getOutlookViewMode(context.document?.location?.pathname);
    const dateKeys = getOutlookNavigableDateKeys(context);
    const navigationGroup = findOutlookPrimaryNavigationGroup(
      getProviderButtons(context.document)
    );
    const dayControl = findOutlookDayViewControl(context.document);
    const pressed = dayControl?.getAttribute?.("aria-pressed");
    const ready = mode === "day" && dateKeys.length
        && dateKeys.join(",") !== previousDateKeys.join(",")
        && navigationGroup?.previous
        && navigationGroup?.next
        && pressed !== "false";
    if (ready) {
      const signature = `${mode}|${dateKeys.join(",")}|${normalizedControlText(
        navigationGroup.previous
      )}|${normalizedControlText(navigationGroup.next)}`;
      stablePollCount = signature === stableSignature ? stablePollCount + 1 : 1;
      stableSignature = signature;
      if (stablePollCount >= 2) {
        return { ok: true, visibleDateKeys: dateKeys };
      }
    } else {
      stableSignature = "";
      stablePollCount = 0;
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  return {
    ok: false,
    reason: context.signal?.aborted
      ? "navigation superseded"
      : "Outlook did not settle in Day view"
  };
}

export async function prepareOutlookViewForTarget(context = {}) {
  const mode = getOutlookViewMode(context.document?.location?.pathname);
  if (mode !== "workweek" || !isWeekendDateKey(context.targetDateKey)) {
    return { ok: true, navigationCount: 0 };
  }

  const control = findOutlookDayViewControl(context.document);
  if (!control || typeof control.click !== "function") {
    return {
      ok: false,
      reason: "Outlook Day view control is unavailable for weekend preview"
    };
  }

  const previousDateKeys = getOutlookNavigableDateKeys(context);
  try {
    control.click();
  } catch (error) {
    return {
      ok: false,
      reason: `Outlook Day view switch failed: ${String(error?.message || error)}`
    };
  }

  const settled = await waitForOutlookDayView(context, previousDateKeys);
  return settled.ok
    ? { ...settled, navigationCount: 1 }
    : settled;
}

export function scoreOutlookNavigationCandidate(control, action, period = "") {
  const text = normalizedControlText(control);
  if (action === "today") {
    return (/\btoday\b/.test(text) ? 180 : 0)
      + (hasOutlookIcon(control, "CalendarToday") ? 40 : 0);
  }

  let score = new RegExp(`\\b${action}\\b`).test(text) ? 40 : 0;
  if (period && new RegExp(`\\b${action}\\s+${period}\\b`).test(text)) score += 160;
  if (period && /\b(day|week|month)\b/.test(text) && !new RegExp(`\\b${period}\\b`).test(text)) {
    score -= 120;
  }
  const iconPrefix = action === "previous" ? "ChevronLeft" : "ChevronRight";
  if (hasOutlookIcon(control, iconPrefix)) score += 30;
  return score;
}

export function findOutlookCalendarNavigationControl(document, action) {
  const candidates = getProviderButtons(document);
  const primaryGroup = findOutlookPrimaryNavigationGroup(candidates);
  if (primaryGroup?.[action]) return primaryGroup[action];

  const pathname = String(document?.location?.pathname || "");
  const period = getOutlookViewPeriod(pathname);
  return candidates
    .map(control => ({ control, score: scoreOutlookNavigationCandidate(control, action, period) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.control || null;
}

export function createAdapter() {
  return Object.freeze({
    id: "outlook",
    async navigateToDate(context = {}) {
      const prepared = await prepareOutlookViewForTarget(context);
      if (!prepared.ok) return prepared;

      const result = await navigateWithPeriodControls({
        ...context,
        maxAttempts: prepared.navigationCount
          ? OUTLOOK_DAY_TRANSITION_MAX_ATTEMPTS
          : context.maxAttempts,
        readVisibleDateKeys: () => getOutlookNavigableDateKeys(context),
        findControl: action => findOutlookCalendarNavigationControl(context.document, action)
      });
      return result.ok
        ? {
            ...result,
            navigationCount: result.navigationCount + prepared.navigationCount
          }
        : result;
    }
  });
}
