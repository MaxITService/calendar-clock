import { navigateWithPeriodControls, normalizeDateKeys } from "./navigation-contract.mjs";

function formatDateKey(date) {
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

export function getGoogleViewPeriod(pathname = "") {
  const match = String(pathname).match(/\/r\/(day|week|month|customday|customweek)(?:\/|$)/i);
  const mode = match?.[1]?.toLowerCase() || "";
  if (mode === "day" || mode === "customday") return "day";
  if (mode === "week" || mode === "customweek") return "week";
  return mode === "month" ? "month" : "";
}

export function getGoogleNavigableDateKeys(context = {}) {
  const hostDates = normalizeDateKeys(context.readHostDateKeys?.());
  if (hostDates.length) return hostDates;

  const pathname = String(context.window?.location?.pathname || context.document?.location?.pathname || "");
  const match = pathname.match(/\/r\/month\/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/i);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_value, index) =>
    formatDateKey(new Date(Date.UTC(year, month, index + 1)))
  );
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

function getAncestorButtonGroup(button, candidates) {
  let ancestor = button?.parentElement || null;
  for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
    const buttons = Array.from(ancestor.querySelectorAll?.("button, [role='button']") || [])
      .filter(candidate => candidates.includes(candidate));
    if (buttons.length !== 3 || buttons[0] !== button) continue;
    if (buttons.slice(1).every(candidate => !String(candidate.textContent || "").trim())) return buttons;
  }
  return null;
}

function findGooglePrimaryNavigationGroup(candidates) {
  const explicitToday = candidates.find(control => /\btoday\b/i.test(normalizedControlText(control)));
  const explicitGroup = getAncestorButtonGroup(explicitToday, candidates);
  if (explicitGroup) return explicitGroup;

  for (const control of candidates) {
    if (!String(control.textContent || "").trim()) continue;
    const group = getAncestorButtonGroup(control, candidates);
    if (group) return group;
  }
  return null;
}

function hasGoogleIcon(control, names) {
  return Array.from(control?.querySelectorAll?.(
    ".google-material-icons, .google-material-icons-extended, [data-icon-name]"
  ) || []).some(icon => {
    const value = `${icon.getAttribute?.("data-icon-name") || ""} ${icon.textContent || ""}`
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return names.some(name => value.includes(name));
  });
}

export function scoreGoogleNavigationCandidate(control, action, period = "") {
  const text = normalizedControlText(control);
  if (action === "today") return /\btoday\b/.test(text) ? 200 : 0;

  let score = new RegExp(`\\b${action}\\b`).test(text) ? 40 : 0;
  if (period && new RegExp(`\\b${action}\\s+${period}\\b`).test(text)) score += 160;
  if (period && /\b(day|week|month)\b/.test(text) && !new RegExp(`\\b${period}\\b`).test(text)) {
    score -= 120;
  }
  const iconNames = action === "previous"
    ? ["chevron_left", "navigate_before"]
    : ["chevron_right", "navigate_next"];
  if (hasGoogleIcon(control, iconNames)) score += 30;
  return score;
}

export function findGoogleCalendarNavigationControl(document, action) {
  const candidates = getProviderButtons(document);
  const primaryGroup = findGooglePrimaryNavigationGroup(candidates);
  if (primaryGroup) {
    return primaryGroup[action === "today" ? 0 : action === "previous" ? 1 : 2] || null;
  }

  const pathname = String(document?.location?.pathname || "");
  const period = getGoogleViewPeriod(pathname);
  return candidates
    .map(control => ({ control, score: scoreGoogleNavigationCandidate(control, action, period) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.control || null;
}

export function createAdapter() {
  return Object.freeze({
    id: "google",
    navigateToDate(context = {}) {
      return navigateWithPeriodControls({
        ...context,
        readVisibleDateKeys: () => getGoogleNavigableDateKeys(context),
        findControl: action => findGoogleCalendarNavigationControl(context.document, action)
      });
    }
  });
}
