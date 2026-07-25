import "./appearance/outlook-appearance-contract.js";
import { createOutlookPresenceSuppressionPolicy } from "./presence-suppression/presence-policy.mjs";

const outlookAppearance = globalThis.CalendarClockOutlookAppearance;
const OUTLOOK_EVENT_SELECTOR = "[data-calitemid]";
const OUTLOOK_DATE_SELECTOR = "[data-column-date]";
const OUTLOOK_CALENDAR_LIST_SELECTOR = "[role='listbox'][aria-multiselectable='true']";
const OUTLOOK_CALENDAR_OPTION_SELECTOR = `${OUTLOOK_CALENDAR_LIST_SELECTOR} [role='option']`;
const OUTLOOK_CALENDAR_GROUP_SELECTOR = "button[id^='calendarGroupHeader'][aria-expanded]";
const OUTLOOK_ALL_DAY_SURFACE_SELECTOR = "[data-is-scrollable='true'][data-max-height]";
const OUTLOOK_TIMED_SURFACE_SELECTOR = "[data-is-scrollable='true']:not([data-max-height])";
const OUTLOOK_BUSY_SELECTOR = "[aria-busy='true'], [role='progressbar']";
const OUTLOOK_DIALOG_SELECTOR = "[role='dialog'], [aria-modal='true']";
// Expand only after a bounded live fixture proves another Outlook render class is fully mounted.
const OUTLOOK_MAX_PROVEN_TIMED_RECORDS = 2;
const OUTLOOK_PROVEN_TIMED_DURATIONS_MINUTES = Object.freeze([30, 150]);
const OUTLOOK_PROVEN_TIMED_GEOMETRY = Object.freeze({
  viewportWidth: 1044,
  viewportHeight: 752,
  surfaceX: 333,
  surfaceY: 258,
  surfaceWidth: 703,
  surfaceHeight: 494,
  clientHeight: 476,
  scrollHeight: 1921
});
const OUTLOOK_PRESENCE_ACTIVITY_SELECTOR = [
  OUTLOOK_EVENT_SELECTOR,
  OUTLOOK_DATE_SELECTOR,
  OUTLOOK_CALENDAR_LIST_SELECTOR,
  OUTLOOK_CALENDAR_OPTION_SELECTOR,
  OUTLOOK_CALENDAR_GROUP_SELECTOR,
  OUTLOOK_ALL_DAY_SURFACE_SELECTOR,
  OUTLOOK_TIMED_SURFACE_SELECTOR,
  OUTLOOK_BUSY_SELECTOR,
  OUTLOOK_DIALOG_SELECTOR
].join(",");
const PRESENCE_ACTIVITY_ATTRIBUTES = Object.freeze([
  "aria-busy",
  "aria-expanded",
  "aria-selected",
  "data-calitemid",
  "data-column-date",
  "data-max-height"
]);

function normalizeText(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function getEventButton(node) {
  if (node?.matches?.("[role='button'][aria-label]")) return node;
  return node?.querySelector?.("[role='button'][aria-label]") || null;
}

function getOutlookVisibleButtonText(button) {
  const ownerDocument = button?.ownerDocument;
  if (!ownerDocument?.createTreeWalker || !button) return normalizeText(button?.textContent);
  const showText = globalThis.NodeFilter?.SHOW_TEXT ?? 4;
  const walker = ownerDocument.createTreeWalker(button, showText);
  const fragments = [];
  while (walker.nextNode()) {
    const parent = walker.currentNode?.parentElement;
    if (!parent
        || parent.closest?.("svg, style, script, [aria-hidden='true']")
        || parent.hidden) continue;
    const text = normalizeText(walker.currentNode.nodeValue);
    if (text) fragments.push(text);
  }
  return normalizeText(fragments.join(" "));
}

function getOutlookEventTitle(button, eventNode, rawText) {
  const titleLine = String(button?.getAttribute?.("title") || "")
    .split(/\r?\n/)
    .map(normalizeText)
    .find(Boolean);
  if (titleLine) return titleLine.slice(0, 90);

  const visibleText = getOutlookVisibleButtonText(button)
    || normalizeText(eventNode?.textContent);
  if (visibleText) return visibleText.slice(0, 90);

  const firstAccessibleSegment = normalizeText(rawText).split(/\s*,\s*/).find(Boolean);
  return (firstAccessibleSegment || "(No title)").slice(0, 90);
}

function getOutlookViewMode(pathname = location.pathname) {
  const match = String(pathname || "").match(/\/calendar\/view\/(day|workweek|week|month)(?:\/|$)/i);
  return match ? match[1].toLowerCase() : "";
}

function getVisibleOutlookDateKeys({ document, isElementInViewport }) {
  const mode = getOutlookViewMode(document?.location?.pathname);
  const expectedCount = mode === "day" ? 1 : mode === "workweek" ? 5 : mode === "week" ? 7 : 0;
  if (!expectedCount) return [];

  const dateKeys = new Set();
  document.querySelectorAll(OUTLOOK_DATE_SELECTOR).forEach(node => {
    if (typeof isElementInViewport === "function" && !isElementInViewport(node)) return;
    const dateKey = normalizeText(node.getAttribute("data-column-date"));
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) dateKeys.add(dateKey);
  });
  const sorted = Array.from(dateKeys).sort();
  return sorted.length === expectedCount ? sorted : [];
}

function doesOutlookRecordIntersectVisibleDates(record, visibleDateKeys) {
  if (record?.durationKind !== "all-day") return visibleDateKeys.has(normalizeText(record?.date));
  const startDateKey = normalizeText(record?.allDayStartDateKey);
  const endDateKeyExclusive = normalizeText(record?.allDayEndDateKeyExclusive);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateKey)
      || !/^\d{4}-\d{2}-\d{2}$/.test(endDateKeyExclusive)
      || endDateKeyExclusive <= startDateKey) return false;
  return Array.from(visibleDateKeys).some(dateKey =>
    dateKey >= startDateKey && dateKey < endDateKeyExclusive
  );
}

function makeCanonicalKey(value) {
  return JSON.stringify(value);
}

function getElementIdentity(node, fallbackIndex = 0) {
  return [
    node?.getAttribute?.("id"),
    node?.getAttribute?.("data-unique-id"),
    node?.getAttribute?.("aria-label"),
    node?.getAttribute?.("title"),
    normalizeText(node?.textContent),
    fallbackIndex
  ].find(value => String(value || "").trim()) || String(fallbackIndex);
}

function getCalendarOptionName(node) {
  const title = normalizeText(node?.getAttribute?.("title"));
  const quotedName = title.match(/['"“„«‹‘]([^'"”»›’]+)['"”»›’]\s*$/u)?.[1];
  return normalizeText(quotedName || node?.textContent).toLocaleLowerCase();
}

function getCalendarVisibilitySnapshot(document, structuredFolders) {
  const listboxes = Array.from(document?.querySelectorAll?.(OUTLOOK_CALENDAR_LIST_SELECTOR) || [])
    .filter(isUsableSurface);
  const options = listboxes.length === 1
    ? Array.from(listboxes[0].querySelectorAll?.("[role='option']") || [])
    : [];
  const groups = Array.from(document?.querySelectorAll?.(OUTLOOK_CALENDAR_GROUP_SELECTOR) || []);
  const folderNamesById = new Map();
  const folderIdsByName = new Map();
  (Array.isArray(structuredFolders) ? structuredFolders : []).forEach(folder => {
    const id = normalizeText(folder?.id);
    const name = normalizeText(folder?.name).toLocaleLowerCase();
    if (!id || !name || folderNamesById.has(id) || folderIdsByName.has(name)) return;
    folderNamesById.set(id, name);
    folderIdsByName.set(name, id);
  });
  const completeStructuredInventory = folderNamesById.size > 0
    && folderNamesById.size === (Array.isArray(structuredFolders) ? structuredFolders.length : 0);
  const optionNames = new Set();
  const selectedFolderIds = new Set();
  const optionStates = options.map((node, index) => {
    const selected = node.getAttribute("aria-selected");
    const name = getCalendarOptionName(node);
    const folderId = folderIdsByName.get(name);
    if ((selected !== "true" && selected !== "false")
        || !name
        || !folderId
        || optionNames.has(name)) return "";
    optionNames.add(name);
    if (selected === "true") selectedFolderIds.add(folderId);
    return [getElementIdentity(node, index), folderId, name, selected];
  });
  const groupStates = groups
    .map((node, index) => [getElementIdentity(node, index), node.getAttribute("aria-expanded")])
    .sort((left, right) => makeCanonicalKey(left).localeCompare(makeCanonicalKey(right)));
  const trusted = listboxes.length === 1
    && completeStructuredInventory
    && options.length === folderNamesById.size
    && options.length > 0
    && options.length <= 50
    && optionStates.every(Boolean)
    && optionNames.size === folderIdsByName.size
    && Array.from(folderIdsByName.keys()).every(name => optionNames.has(name))
    && selectedFolderIds.size > 0
    && groups.length > 0
    && groups.every(node => node.getAttribute("aria-expanded") === "true");
  return {
    trusted,
    key: trusted
      ? makeCanonicalKey([
        optionStates.sort((left, right) => makeCanonicalKey(left).localeCompare(makeCanonicalKey(right))),
        groupStates
      ])
      : "",
    folderNamesById,
    selectedFolderIds
  };
}

function isUsableSurface(node) {
  if (!node?.isConnected) return false;
  const rect = node.getBoundingClientRect?.();
  return Boolean(rect && rect.width > 1 && rect.height > 1);
}

function getUniqueSurface(document, selector) {
  const surfaces = Array.from(document?.querySelectorAll?.(selector) || []).filter(isUsableSurface);
  return surfaces.length === 1 ? surfaces[0] : null;
}

function makeSurfaceGeometryKey(surface) {
  if (!surface) return "";
  const rect = surface.getBoundingClientRect?.();
  if (!rect) return "";
  return [
    Math.round(rect.width),
    Math.round(rect.height),
    Math.round(Number(surface.clientWidth) || 0),
    Math.round(Number(surface.clientHeight) || 0),
    Math.round(Number(surface.scrollWidth) || 0),
    Math.round(Number(surface.scrollHeight) || 0)
  ].join(":");
}

function makeStructuredRevision(status) {
  const capturedResponses = Math.max(0, Math.round(Number(status?.capturedResponses) || 0));
  const lastCapturedAt = Math.max(0, Math.round(Number(status?.lastCapturedAt) || 0));
  return capturedResponses > 0 && lastCapturedAt > 0 ? `${capturedResponses}:${lastCapturedAt}` : "";
}

function makeRecordsRevision(records) {
  const identities = (Array.isArray(records) ? records : [])
    .map(record => [
      normalizeText(record?.id),
      normalizeText(record?.startDate || record?.allDayStartDateKey),
      normalizeText(record?.endDate || record?.allDayEndDateKeyExclusive),
      normalizeText(record?.endDateKey),
      normalizeText(record?.calendar),
      normalizeText(record?.calendarName),
      normalizeText(record?.durationKind),
      normalizeText(record?.sourceKind),
      normalizeText(record?.itemKind),
      normalizeText(record?.status),
      normalizeText(record?.seriesMasterId),
      normalizeText(record?.calendarItemType),
      normalizeText(record?.itemClass),
      normalizeText(record?.meetingStatus)
    ])
    .filter(identity => identity.some(Boolean))
    .sort((left, right) => makeCanonicalKey(left).localeCompare(makeCanonicalKey(right)));
  return identities.length ? makeCanonicalKey(identities) : "";
}

function getPresentIdsByLane(document, allDaySurface, timedSurface) {
  const ids = { timed: new Set(), allDay: new Set() };
  const unclassifiedIds = new Set();
  Array.from(document?.querySelectorAll?.(OUTLOOK_EVENT_SELECTOR) || []).forEach(node => {
    const id = normalizeText(node.getAttribute("data-calitemid"));
    if (!id || !node.isConnected) return;
    if (allDaySurface?.contains?.(node)) ids.allDay.add(id);
    else if (timedSurface?.contains?.(node)) ids.timed.add(id);
    else unclassifiedIds.add(id);
  });
  return { ...ids, unclassifiedIds };
}

function isProvenTimedRecord(record) {
  const startMilliseconds = Date.parse(record?.startDate);
  const endMilliseconds = Date.parse(record?.endDate);
  return record?.durationKind === "range"
    && record?.sourceKind === "calendar-event"
    && record?.itemKind === "event"
    && !normalizeText(record?.seriesMasterId)
    && ["", "Single"].includes(normalizeText(record?.calendarItemType))
    && normalizeText(record?.itemClass) === "IPM.Appointment"
    && record?.meetingStatus === "appointment"
    && /^\d{4}-\d{2}-\d{2}$/.test(record?.date || "")
    && record.date === record.endDateKey
    && Number.isFinite(startMilliseconds)
    && Number.isFinite(endMilliseconds)
    && endMilliseconds > startMilliseconds;
}

function getExpectedIdsByLane(records, visibleDateKeys, calendarVisibility) {
  const expected = {
    timed: { ids: new Set(), identityComplete: true, coverageComplete: true, layoutProfileKey: "" },
    allDay: { ids: new Set(), identityComplete: true, coverageComplete: false }
  };
  const visibleDates = new Set(visibleDateKeys);
  const allIds = new Set();
  const timedIntervals = [];
  (Array.isArray(records) ? records : []).forEach(record => {
    const id = normalizeText(record?.id);
    if (!id || !doesOutlookRecordIntersectVisibleDates(record, visibleDates)) return;
    const lane = expected[record?.durationKind === "all-day" ? "allDay" : "timed"];
    if (allIds.has(id)) {
      expected.timed.identityComplete = false;
      expected.allDay.identityComplete = false;
      return;
    }
    allIds.add(id);
    const folderId = normalizeText(record?.calendar);
    const calendarName = normalizeText(record?.calendarName).toLocaleLowerCase();
    if (!folderId
        || !calendarName
        || calendarVisibility.folderNamesById.get(folderId) !== calendarName) {
      lane.identityComplete = false;
      return;
    }
    if (!calendarVisibility.selectedFolderIds.has(folderId)) return;
    if (lane === expected.timed && !isProvenTimedRecord(record)) {
      lane.coverageComplete = false;
      return;
    }
    if (lane.ids.has(id)) {
      lane.identityComplete = false;
      return;
    }
    lane.ids.add(id);
    if (lane === expected.timed) {
      timedIntervals.push({
        start: Date.parse(record.startDate),
        end: Date.parse(record.endDate)
      });
    }
  });
  timedIntervals.sort((left, right) => left.start - right.start || left.end - right.end);
  const hasTimedOverlap = timedIntervals.some((interval, index) =>
    index > 0 && interval.start < timedIntervals[index - 1].end
  );
  const timedDurationsMinutes = timedIntervals
    .map(interval => Math.round((interval.end - interval.start) / 60_000))
    .sort((left, right) => left - right);
  const durationsProven = makeCanonicalKey(timedDurationsMinutes)
    === makeCanonicalKey(OUTLOOK_PROVEN_TIMED_DURATIONS_MINUTES);
  if (expected.timed.ids.size !== OUTLOOK_MAX_PROVEN_TIMED_RECORDS
      || hasTimedOverlap
      || !durationsProven) {
    expected.timed.coverageComplete = false;
  } else {
    expected.timed.layoutProfileKey = makeCanonicalKey([
      "ordinary-single-day-nonoverlap",
      timedDurationsMinutes
    ]);
  }
  return expected;
}

function findCommonAncestor(nodes) {
  const connectedNodes = nodes.filter(node => node?.isConnected);
  if (!connectedNodes.length || connectedNodes.length !== nodes.length) return null;
  let candidate = connectedNodes[0];
  while (candidate && !connectedNodes.every(node => candidate.contains?.(node))) {
    candidate = candidate.parentElement;
  }
  return candidate || null;
}

function getViewStructure(document, visibleDateKeys, allDaySurface, timedSurface) {
  const visibleDates = new Set(visibleDateKeys);
  const dateNodes = Array.from(document?.querySelectorAll?.(OUTLOOK_DATE_SELECTOR) || [])
    .filter(node => visibleDates.has(normalizeText(node.getAttribute("data-column-date"))));
  const root = dateNodes.length === visibleDateKeys.length
    ? findCommonAncestor([...dateNodes, allDaySurface, timedSurface])
    : null;
  const structurallyBound = Boolean(
    root
    && root !== document?.body
    && root !== document?.documentElement
    && dateNodes.every(node => root.contains(node))
    && root.contains(allDaySurface)
    && root.contains(timedSurface)
  );
  return { root, structurallyBound };
}

function makeCoverageProfileKey(
  viewMode,
  visibleDateKeys,
  surface,
  laneName,
  structurallyBound,
  recordCount,
  layoutProfileKey
) {
  if (laneName !== "timed"
      || !structurallyBound
      || !surface
      || !layoutProfileKey
      || recordCount > OUTLOOK_MAX_PROVEN_TIMED_RECORDS) return "";
  const rect = surface.getBoundingClientRect?.();
  const view = surface.ownerDocument?.defaultView;
  const width = Math.round(Number(rect?.width) || 0);
  const height = Math.round(Number(rect?.height) || 0);
  const geometryProven = Math.round(Number(view?.innerWidth) || 0) === OUTLOOK_PROVEN_TIMED_GEOMETRY.viewportWidth
    && Math.round(Number(view?.innerHeight) || 0) === OUTLOOK_PROVEN_TIMED_GEOMETRY.viewportHeight
    && Math.round(Number(rect?.x) || 0) === OUTLOOK_PROVEN_TIMED_GEOMETRY.surfaceX
    && Math.round(Number(rect?.y) || 0) === OUTLOOK_PROVEN_TIMED_GEOMETRY.surfaceY
    && width === OUTLOOK_PROVEN_TIMED_GEOMETRY.surfaceWidth
    && height === OUTLOOK_PROVEN_TIMED_GEOMETRY.surfaceHeight
    && Math.round(Number(surface.clientHeight) || 0) === OUTLOOK_PROVEN_TIMED_GEOMETRY.clientHeight
    && Math.round(Number(surface.scrollHeight) || 0) === OUTLOOK_PROVEN_TIMED_GEOMETRY.scrollHeight
    && (!view?.visualViewport || Number(view.visualViewport.scale) === 1);
  return geometryProven
    ? makeCanonicalKey([
      "dom-stable-v2",
      viewMode,
      visibleDateKeys,
      laneName,
      OUTLOOK_PROVEN_TIMED_GEOMETRY,
      layoutProfileKey
    ])
    : "";
}

function makeSourceInstanceId() {
  const randomId = globalThis.crypto?.randomUUID?.();
  return normalizeText(randomId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).slice(0, 100);
}

function doesMutationAffectOutlookPresence(record, ownNodePredicate) {
  if (!record || ownNodePredicate(record.target)) return false;
  if (record.type === "attributes") return true;
  if (record.target?.closest?.(OUTLOOK_PRESENCE_ACTIVITY_SELECTOR)) return true;
  return [...Array.from(record.addedNodes || []), ...Array.from(record.removedNodes || [])].some(node =>
    node?.nodeType === 1
    && (node.matches?.(OUTLOOK_PRESENCE_ACTIVITY_SELECTOR)
      || node.querySelector?.(OUTLOOK_PRESENCE_ACTIVITY_SELECTOR))
  );
}

export function createOutlookCalendarClockProvider(definition) {
  if (definition?.id !== "outlook") return null;
  const presencePolicy = createOutlookPresenceSuppressionPolicy();
  const surfaceIds = new WeakMap();
  let nextSurfaceId = 1;
  let trackingReady = false;
  let activityRevision = 0;
  let lastActivityAt = Date.now();
  let isOwnNode = () => false;
  let activityObserver = null;
  let activityCallback = null;
  let interactionActive = false;
  const sourceInstanceId = makeSourceInstanceId();
  let observationSequence = 0;

  function getSurfaceKey(surface, laneName) {
    if (!surface) return "";
    if (!surfaceIds.has(surface)) surfaceIds.set(surface, `${laneName}-${nextSurfaceId++}`);
    return surfaceIds.get(surface);
  }

  function markPresenceActivity(onActivity) {
    activityRevision += 1;
    lastActivityAt = Date.now();
    presencePolicy.clearEvidence(lastActivityAt);
    onActivity?.();
  }

  return {
    ...definition,
    eventSelector: OUTLOOK_EVENT_SELECTOR,

    isEventNode(node) {
      return Boolean(node?.matches?.(OUTLOOK_EVENT_SELECTOR) && getEventButton(node));
    },

    readEventNode(node, helpers) {
      if (!this.isEventNode(node)) return null;
      const button = getEventButton(node);
      const rawText = [
        button?.getAttribute?.("aria-label"),
        button?.getAttribute?.("title"),
        node?.textContent
      ].filter(Boolean).join(" ");
      const contextText = helpers.collectDateContext(node);
      const range = helpers.parseTimeRange(rawText)
        || helpers.parseSingleTime(rawText)
        || helpers.parseAllDayRange(rawText, contextText);
      if (!range) return null;
      const appearance = outlookAppearance?.resolveDomAppearance?.(node, button) || {};

      return {
        rawText,
        range,
        title: getOutlookEventTitle(button, node, rawText),
        stableId: normalizeText(node.getAttribute("data-calitemid")),
        eventNode: node,
        color: appearance.color || "",
        status: appearance.status || "",
        calendarName: "",
        capturedFrom: "outlook-calendar-dom"
      };
    },

    // The generic reader would pick the event wrapper's gray border.
    readEventColor(node) {
      return this.isEventNode(node) ? outlookAppearance?.resolveDomAppearance?.(node)?.color || "" : "";
    },

    getViewMode: getOutlookViewMode,
    getVisibleDateKeys: getVisibleOutlookDateKeys,

    installPresenceActivityTracking({ window, document, onActivity, isOwnNode: ownNodePredicate }) {
      if (trackingReady || !window || !document) return () => {};
      isOwnNode = typeof ownNodePredicate === "function" ? ownNodePredicate : () => false;
      activityCallback = onActivity;
      const markActivity = event => {
        if (event?.target && isOwnNode(event.target)) return;
        markPresenceActivity(onActivity);
      };
      const beginInteraction = event => {
        if (event?.target && isOwnNode(event.target)) return;
        interactionActive = true;
        markPresenceActivity(onActivity);
      };
      const endInteraction = event => {
        if (event?.target && isOwnNode(event.target)) return;
        interactionActive = false;
        markPresenceActivity(onActivity);
      };
      const MutationObserverConstructor = window.MutationObserver || globalThis.MutationObserver;
      const observer = typeof MutationObserverConstructor === "function"
        ? new MutationObserverConstructor(records => {
          if (!records.some(record => doesMutationAffectOutlookPresence(record, isOwnNode))) return;
          markActivity();
        })
        : null;
      if (!observer) {
        activityCallback = null;
        return () => {};
      }
      activityObserver = observer;
      observer?.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: PRESENCE_ACTIVITY_ATTRIBUTES
      });
      window.addEventListener("scroll", markActivity, true);
      window.addEventListener("resize", markActivity);
      window.addEventListener("pageshow", markActivity);
      document.addEventListener("visibilitychange", markActivity);
      document.addEventListener("animationstart", markActivity, true);
      document.addEventListener("animationend", markActivity, true);
      document.addEventListener("transitionstart", markActivity, true);
      document.addEventListener("transitionend", markActivity, true);
      document.addEventListener("pointerdown", beginInteraction, true);
      document.addEventListener("pointerup", endInteraction, true);
      document.addEventListener("pointercancel", endInteraction, true);
      document.addEventListener("dragstart", beginInteraction, true);
      document.addEventListener("dragend", endInteraction, true);
      trackingReady = true;
      markActivity();

      return () => {
        observer?.disconnect();
        window.removeEventListener("scroll", markActivity, true);
        window.removeEventListener("resize", markActivity);
        window.removeEventListener("pageshow", markActivity);
        document.removeEventListener("visibilitychange", markActivity);
        document.removeEventListener("animationstart", markActivity, true);
        document.removeEventListener("animationend", markActivity, true);
        document.removeEventListener("transitionstart", markActivity, true);
        document.removeEventListener("transitionend", markActivity, true);
        document.removeEventListener("pointerdown", beginInteraction, true);
        document.removeEventListener("pointerup", endInteraction, true);
        document.removeEventListener("pointercancel", endInteraction, true);
        document.removeEventListener("dragstart", beginInteraction, true);
        document.removeEventListener("dragend", endInteraction, true);
        trackingReady = false;
        interactionActive = false;
        activityObserver = null;
        activityCallback = null;
        presencePolicy.reset();
      };
    },

    evaluatePageOwnedPresence({
      document,
      records,
      captureView,
      pageOwnedStatus,
      isCaptureViewTrusted,
      now = Date.now()
    }) {
      const pendingRecords = activityObserver?.takeRecords?.() || [];
      if (pendingRecords.some(record => doesMutationAffectOutlookPresence(record, isOwnNode))) {
        markPresenceActivity(activityCallback);
      }
      const observedAt = Math.max(Number(now) || 0, Date.now());
      observationSequence += 1;
      const visibleDateKeys = Array.isArray(captureView?.visibleDateKeys)
        ? captureView.visibleDateKeys.filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort()
        : [];
      const allDaySurface = getUniqueSurface(document, OUTLOOK_ALL_DAY_SURFACE_SELECTOR);
      const timedSurface = getUniqueSurface(document, OUTLOOK_TIMED_SURFACE_SELECTOR);
      const calendarVisibility = getCalendarVisibilitySnapshot(
        document,
        pageOwnedStatus?.calendarFolders
      );
      const presentIds = getPresentIdsByLane(document, allDaySurface, timedSurface);
      const expectedIds = getExpectedIdsByLane(records, visibleDateKeys, calendarVisibility);
      const viewStructure = getViewStructure(document, visibleDateKeys, allDaySurface, timedSurface);
      const animations = typeof document?.getAnimations === "function"
        ? document.getAnimations().filter(animation =>
          !isOwnNode(animation?.effect?.target)
          && !["finished", "idle"].includes(animation.playState)
        )
        : null;
      const busyNodes = Array.from(document?.querySelectorAll?.(OUTLOOK_BUSY_SELECTOR) || [])
        .filter(node => !isOwnNode(node));
      const dialogs = Array.from(document?.querySelectorAll?.(OUTLOOK_DIALOG_SELECTOR) || [])
        .filter(node => !isOwnNode(node) && isUsableSurface(node));
      const viewMode = getOutlookViewMode(document?.location?.pathname);
      const routeDateConsistent = captureView?.mode === viewMode
        && captureView?.dateKeySource === "visible-dom"
        && Array.isArray(captureView.visibleDateKeys)
        && captureView.visibleDateKeys.length === visibleDateKeys.length
        && captureView.visibleDateKeys.every((dateKey, index) => dateKey === visibleDateKeys[index]);
      const displayTimeZoneKey = normalizeText(pageOwnedStatus?.timeZone);
      const scopeKey = makeCanonicalKey([
        viewMode,
        visibleDateKeys.join(","),
        displayTimeZoneKey
      ]);
      const timedCoverageProfileKey = makeCoverageProfileKey(
        viewMode,
        visibleDateKeys,
        timedSurface,
        "timed",
        viewStructure.structurallyBound,
        expectedIds.timed.ids.size,
        expectedIds.timed.layoutProfileKey
      );
      const allDayCoverageProfileKey = makeCoverageProfileKey(
        viewMode,
        visibleDateKeys,
        allDaySurface,
        "allDay",
        viewStructure.structurallyBound,
        expectedIds.allDay.ids.size,
        ""
      );

      return presencePolicy.observe({
        now: observedAt,
        sourceInstanceId,
        observationSequence,
        viewMode,
        visibleDateKeys,
        captureTrusted: isCaptureViewTrusted === true,
        routeDateConsistent,
        documentVisible: document?.visibilityState === "visible",
        trackingReady,
        calendarVisibilityTrusted: calendarVisibility.trusted,
        calendarVisibilityKey: calendarVisibility.key,
        apiRevision: makeStructuredRevision(pageOwnedStatus),
        recordsRevision: makeRecordsRevision(records),
        displayTimeZoneKey,
        scopeKey,
        animationsKnown: Array.isArray(animations),
        animationCount: Array.isArray(animations) ? animations.length : -1,
        busyState: document?.readyState === "complete"
            && !interactionActive
            && busyNodes.length === 0
            && dialogs.length === 0
          ? "idle"
          : busyNodes.length || dialogs.length || interactionActive
            ? "busy"
            : "unknown",
        activityRevision,
        lastActivityAt,
        lanes: {
          timed: {
            trusted: Boolean(timedSurface)
              && viewStructure.structurallyBound
              && expectedIds.timed.coverageComplete
              && presentIds.unclassifiedIds.size === 0,
            identityComplete: expectedIds.timed.identityComplete,
            surfaceKey: getSurfaceKey(timedSurface, "timed"),
            geometryKey: makeSurfaceGeometryKey(timedSurface),
            coverageProfileKey: timedCoverageProfileKey,
            overflow: false,
            expectedIds: expectedIds.timed.ids,
            presentIds: presentIds.timed
          },
          allDay: {
            trusted: Boolean(allDaySurface)
              && viewStructure.structurallyBound
              && expectedIds.allDay.coverageComplete
              && presentIds.unclassifiedIds.size === 0,
            identityComplete: expectedIds.allDay.identityComplete,
            surfaceKey: getSurfaceKey(allDaySurface, "all-day"),
            geometryKey: makeSurfaceGeometryKey(allDaySurface),
            coverageProfileKey: allDayCoverageProfileKey,
            overflow: allDaySurface
              ? Number(allDaySurface.scrollHeight) > Number(allDaySurface.clientHeight) + 1
              : null,
            expectedIds: expectedIds.allDay.ids,
            presentIds: presentIds.allDay
          }
        }
      });
    },

    getTimeZone({ pageOwnedTimeZone, systemTimeZone }) {
      return normalizeText(pageOwnedTimeZone || systemTimeZone);
    }
  };
}

export const createCalendarClockProvider = createOutlookCalendarClockProvider;
