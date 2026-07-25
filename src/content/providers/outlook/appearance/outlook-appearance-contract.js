// Shared Outlook event-appearance contract for isolated and MAIN worlds.
((root) => {
  if (root.CalendarClockOutlookAppearance) return;

  const MAX_EVENT_CATEGORIES = 25;
  const MAX_CATEGORY_CATALOG_ENTRIES = 200;
  const MAX_CATEGORY_NAME_LENGTH = 256;
  const MAX_VISITED_NODES = 50000;
  const OUTLOOK_OOF_COLOR = "#b4009e";
  // Stable arc colors for Outlook's documented preset0..preset24 category contract.
  // Visible DOM events still use the current client's computed color when available.
  const CATEGORY_PRESET_COLORS = Object.freeze([
    "#c50f1f", "#a74109", "#8e562e", "#835b00", "#0e7a0b",
    "#00666d", "#5c5f0d", "#006a88", "#6656d1", "#af33a1",
    "#4f6bed", "#3b3a39", "#707070", "#424242", "#242424",
    "#a4262c", "#8a3707", "#6f4e37", "#8f761e", "#0b6a0b",
    "#005b70", "#4c5000", "#004377", "#4f3d8f", "#881798"
  ]);
  const CATEGORY_COLOR_NAMES = Object.freeze({
    red: 0,
    orange: 1,
    brown: 2,
    peach: 2,
    yellow: 3,
    green: 4,
    teal: 5,
    olive: 6,
    blue: 7,
    purple: 8,
    cranberry: 9,
    maroon: 9,
    steel: 10,
    darksteel: 11,
    gray: 12,
    grey: 12,
    darkgray: 13,
    darkgrey: 13,
    black: 14,
    darkred: 15,
    darkorange: 16,
    darkbrown: 17,
    darkpeach: 17,
    darkyellow: 18,
    darkgreen: 19,
    darkteal: 20,
    darkolive: 21,
    darkblue: 22,
    darkpurple: 23,
    darkcranberry: 24,
    darkmaroon: 24
  });

  function normalizeText(value, maxLength = 500) {
    return typeof value === "string"
      ? value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
      : "";
  }

  function normalizeCssColor(value) {
    const color = normalizeText(value, 80);
    return /^(?:#[0-9a-f]{6}|rgba?\(\s*\d+(?:\.\d+)?(?:%|\s*)\s*,\s*\d+(?:\.\d+)?(?:%|\s*)\s*,\s*\d+(?:\.\d+)?(?:%|\s*)(?:,\s*(?:0|1|0?\.\d+|(?:\d+(?:\.\d+)?)%))?\s*\))$/i.test(color)
      ? color
      : "";
  }

  function isTransparentColor(value) {
    const color = normalizeCssColor(value).toLowerCase();
    return !color
      || color === "rgba(0, 0, 0, 0)"
      || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color);
  }

  function parseRgb(value) {
    const match = normalizeCssColor(value).match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
    return match ? match.slice(1, 4).map(Number) : null;
  }

  function isNearWhite(value) {
    const rgb = parseRgb(value);
    return Boolean(rgb && rgb.every(channel => channel >= 242));
  }

  // Outlook Web master categories send `Color` as the 0-based preset index (Red 0, Purple 8).
  function normalizeCategoryPreset(value) {
    if (typeof value === "number" && Number.isInteger(value)) {
      return value >= 0 && value < CATEGORY_PRESET_COLORS.length ? value : -1;
    }
    const text = normalizeText(value, 40);
    const presetMatch = text.match(/^preset(\d{1,2})$/i);
    if (presetMatch) {
      const index = Number(presetMatch[1]);
      return index >= 0 && index < CATEGORY_PRESET_COLORS.length ? index : -1;
    }
    if (/^\d{1,2}$/.test(text)) {
      const index = Number(text);
      return index < CATEGORY_PRESET_COLORS.length ? index : -1;
    }
    const key = text.toLowerCase().replace(/[^a-z]/g, "");
    return Object.prototype.hasOwnProperty.call(CATEGORY_COLOR_NAMES, key)
      ? CATEGORY_COLOR_NAMES[key]
      : -1;
  }

  function categoryPresetToColor(value) {
    const index = normalizeCategoryPreset(value);
    return index >= 0 ? CATEGORY_PRESET_COLORS[index] : "";
  }

  function normalizeCategories(value) {
    if (!Array.isArray(value)) return [];
    const categories = [];
    const seen = new Set();
    for (const entry of value) {
      const name = normalizeText(entry, MAX_CATEGORY_NAME_LENGTH);
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      categories.push(name);
      if (categories.length >= MAX_EVENT_CATEGORIES) break;
    }
    return categories;
  }

  function normalizeFreeBusyStatus(value) {
    const key = normalizeText(value, 64).toLowerCase().replace(/[\s_-]+/g, "");
    return {
      free: "free",
      workingelsewhere: "workingElsewhere",
      tentative: "tentative",
      busy: "busy",
      oof: "oof",
      outofoffice: "oof",
      unknown: "unknown",
      nodata: "unknown"
    }[key] || "";
  }

  function getCategoryDefinition(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const name = normalizeText(
      value.displayName ?? value.DisplayName ?? value.name ?? value.Name,
      MAX_CATEGORY_NAME_LENGTH
    );
    const color = categoryPresetToColor(value.color ?? value.Color);
    return name && color ? { name, color } : null;
  }

  function extractCategoryCatalog(payload, options = {}) {
    const maxVisitedNodes = Math.min(
      MAX_VISITED_NODES,
      Math.max(1, Math.round(Number(options.maxVisitedNodes) || MAX_VISITED_NODES))
    );
    const catalog = new Map();
    const stack = [{ value: payload, categoryContext: false }];
    const seen = new WeakSet();
    let visited = 0;
    while (stack.length && visited < maxVisitedNodes && catalog.size < MAX_CATEGORY_CATALOG_ENTRIES) {
      const { value, categoryContext } = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      if (categoryContext && !Array.isArray(value)) {
        const definition = getCategoryDefinition(value);
        if (definition) catalog.set(definition.name.toLocaleLowerCase(), definition.color);
      }
      Object.entries(value).forEach(([key, child]) => {
        if (!child || typeof child !== "object") return;
        stack.push({
          value: child,
          categoryContext: categoryContext || /categor/i.test(key)
        });
      });
    }
    return catalog;
  }

  function resolveStructuredAppearance(value, categoryCatalog = new Map()) {
    const categories = normalizeCategories(value?.categories ?? value?.Categories);
    const status = normalizeFreeBusyStatus(
      value?.status ?? value?.FreeBusyType ?? value?.showAs ?? value?.ShowAs
    );
    const categoryColor = categories
      .map(name => categoryCatalog.get?.(name.toLocaleLowerCase()) || "")
      .find(Boolean) || "";
    return {
      categories,
      status,
      categoryColor,
      statusColor: status === "oof" ? OUTLOOK_OOF_COLOR : "",
      color: categoryColor || (status === "oof" ? OUTLOOK_OOF_COLOR : "")
    };
  }

  function getStyle(element) {
    if (!element) return null;
    const getter = element.ownerDocument?.defaultView?.getComputedStyle || root.getComputedStyle;
    if (typeof getter !== "function") return null;
    try {
      return getter.call(element.ownerDocument?.defaultView || root, element);
    } catch (_error) {
      return null;
    }
  }

  function getEventButton(node) {
    if (node?.matches?.("[role='button'][aria-label]")) return node;
    return node?.querySelector?.("[role='button'][aria-label]") || null;
  }

  function getEventUnderlay(node, button) {
    return Array.from(node?.children || []).find(child => child !== button && !child.contains?.(button)) || null;
  }

  function getLayerColor(element) {
    const style = getStyle(element);
    if (!style) return "";
    const background = normalizeCssColor(style.backgroundColor);
    const border = normalizeCssColor(style.borderLeftColor || style.borderColor);
    if (background && !isTransparentColor(background) && !isNearWhite(background)) return background;
    if (border && !isTransparentColor(border) && !isNearWhite(border)) return border;
    return background && !isTransparentColor(background) ? background : "";
  }

  function isOofUnderlay(element) {
    const style = getStyle(element);
    return Boolean(style
      && normalizeText(style.backgroundImage, 500) !== "none"
      && /repeating-linear-gradient/i.test(style.backgroundImage));
  }

  function resolveDomAppearance(node, button = getEventButton(node)) {
    const underlay = getEventUnderlay(node, button);
    const underlayColor = getLayerColor(underlay);
    const buttonColor = normalizeCssColor(getStyle(button)?.backgroundColor);
    const isOof = isOofUnderlay(underlay);
    if (!isOof) {
      return {
        categories: [],
        status: "",
        categoryColor: "",
        statusColor: "",
        color: underlayColor || buttonColor
      };
    }

    const statusVariable = normalizeCssColor(getStyle(node)?.getPropertyValue?.("--freeBusyAwayColor"));
    const statusColor = statusVariable || underlayColor || OUTLOOK_OOF_COLOR;
    return {
      categories: [],
      status: "oof",
      categoryColor: "",
      statusColor,
      color: statusColor
    };
  }

  root.CalendarClockOutlookAppearance = Object.freeze({
    OUTLOOK_OOF_COLOR,
    CATEGORY_PRESET_COLORS,
    normalizeCssColor,
    normalizeCategoryPreset,
    categoryPresetToColor,
    normalizeCategories,
    normalizeFreeBusyStatus,
    extractCategoryCatalog,
    resolveStructuredAppearance,
    resolveDomAppearance
  });
})(globalThis);
