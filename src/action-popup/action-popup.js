const POPUP_PROVIDER_STORAGE_KEY = "calendarClockPopupProvider";
function createPopupProvider(providerId, copy) {
    const definition = globalThis.CalendarClockProviders?.get?.(providerId);
    return definition ? Object.freeze({ ...definition, ...copy }) : null;
}

const POPUP_PROVIDERS = Object.freeze({
    google: createPopupProvider("google", {
        warning: "This popup uses the last stored Google Calendar and Tasks snapshot. If either page has not been opened recently, these items may be outdated.",
        listTitle: "Stored tasks and events",
        emptyText: "Open Google Calendar with Tasks visible to capture timed items for this snapshot."
    }),
    outlook: createPopupProvider("outlook", {
        warning: "This popup uses the last stored Outlook Calendar snapshot. Open Outlook Calendar to refresh it.",
        listTitle: "Stored calendar events",
        emptyText: "Open Outlook Calendar to capture timed events for this snapshot."
    })
});

const snapshotStatusEl = document.getElementById("snapshotStatus");
const snapshotCountEl = document.getElementById("snapshotCount");
const lastUpdatedEl = document.getElementById("lastUpdated");
const calendarCountEl = document.getElementById("calendarCount");
const taskCountEl = document.getElementById("taskCount");
const taskListEl = document.getElementById("taskList");
const openCalendarButtonEl = document.getElementById("openCalendarButton");
const calendarProviderEl = document.getElementById("calendarProvider");
const clockPreviewFrameEl = document.getElementById("clockPreviewFrame");
const snapshotWarningEl = document.getElementById("snapshotWarning");
const snapshotListTitleEl = document.getElementById("snapshotListTitle");
let activeProviderId = "google";
let snapshotLoadSequence = 0;

function getPopupProvider(providerId = activeProviderId) {
    return POPUP_PROVIDERS[providerId] || POPUP_PROVIDERS.google || {
        id: "unsupported",
        displayName: "Calendar",
        openUrl: "",
        eventsStorageKey: "calendarClockEvents",
        sourceStorageKey: "calendarClockSource",
        warning: "Calendar provider metadata is unavailable.",
        listTitle: "Stored calendar events",
        emptyText: "Reload Calendar Clock to restore provider metadata."
    };
}

function getSafeEvents(value, source = {}) {
    if (!Array.isArray(value)) return [];
    const context = source?.temporalContext;
    const temporal = globalThis.CalendarClockTemporalProjection;
    return value.filter(event => {
        if (event?.capturedFrom === "google-tasks-dom") return true;
        return temporal?.validateEvent?.(event, context) === true
            && context?.fingerprint === source?.contextFingerprint;
    });
}

function isSnapshotTask(event) {
    return event?.itemKind === "task"
        || event?.sourceKind === "calendar-task"
        || event?.capturedFrom === "google-tasks-dom";
}

function getSnapshotTypeCounts(events) {
    const taskCount = events.filter(isSnapshotTask).length;
    return {
        calendarCount: Math.max(0, events.length - taskCount),
        taskCount
    };
}

function getChromeApi() {
    try {
        if (typeof chrome === "undefined" || !chrome.runtime?.id) return null;
        return chrome;
    } catch (_error) {
        return null;
    }
}

function isValidTimestamp(value) {
    return Number.isFinite(value) && value > 0;
}

function formatRelativeTime(timestamp) {
    if (!isValidTimestamp(timestamp)) return "Never";

    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.round(hours / 24);
    return `${days}d ago`;
}

function formatAbsoluteTime(timestamp) {
    if (!isValidTimestamp(timestamp)) return "";

    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date(timestamp));
}

function getSnapshotTimestamp(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function getSnapshotDateKey(event) {
    if (typeof event?.temporal?.firstDateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(event.temporal.firstDateKey)) {
        return event.temporal.firstDateKey;
    }
    return "";
}

function getSnapshotTimeKey(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
        ? value
        : "";
}

function compareSnapshotText(left, right) {
    const leftText = String(left || "");
    const rightText = String(right || "");
    if (leftText < rightText) return -1;
    if (leftText > rightText) return 1;
    return 0;
}

function compareSnapshotItems(left, right) {
    const leftStartTimestamp = getSnapshotTimestamp(left.item?.temporal?.startInstant);
    const rightStartTimestamp = getSnapshotTimestamp(right.item?.temporal?.startInstant);
    const leftDate = getSnapshotDateKey(left.item);
    const rightDate = getSnapshotDateKey(right.item);

    const leftIsDated = Boolean(leftDate);
    const rightIsDated = Boolean(rightDate);
    if (leftIsDated !== rightIsDated) return Number(rightIsDated) - Number(leftIsDated);

    if (leftIsDated && leftStartTimestamp !== null && rightStartTimestamp !== null) {
        const startDelta = leftStartTimestamp - rightStartTimestamp;
        if (startDelta) return startDelta;
    } else {
        const dateDelta = leftDate.localeCompare(rightDate);
        if (dateDelta) return dateDelta;
    }

    const startTimeDelta = compareSnapshotText(getSnapshotTimeKey(left.item?.start), getSnapshotTimeKey(right.item?.start));
    if (startTimeDelta) return startTimeDelta;

    const leftEndTimestamp = getSnapshotTimestamp(left.item?.temporal?.endInstant);
    const rightEndTimestamp = getSnapshotTimestamp(right.item?.temporal?.endInstant);
    if (leftEndTimestamp !== null && rightEndTimestamp !== null) {
        const endDelta = leftEndTimestamp - rightEndTimestamp;
        if (endDelta) return endDelta;
    }

    const endTimeDelta = compareSnapshotText(getSnapshotTimeKey(left.item?.end), getSnapshotTimeKey(right.item?.end));
    if (endTimeDelta) return endTimeDelta;

    // Undated Tasks deliberately remain after dated items: their clock time is not a real calendar date.
    // Their time, end, title, id, and original snapshot order make that fallback stable without persisting a date.
    const titleDelta = compareSnapshotText(left.item?.title, right.item?.title);
    if (titleDelta) return titleDelta;

    const idDelta = compareSnapshotText(left.item?.id || left.item?.domKey, right.item?.id || right.item?.domKey);
    return idDelta || left.index - right.index;
}

function getSortedSnapshotItems(events) {
    return events
        .map((item, index) => ({ item, index }))
        .sort(compareSnapshotItems)
        .map(({ item }) => item);
}

function formatSnapshotDateLabel(dateKey) {
    return new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric"
    }).format(new Date(`${dateKey}T12:00:00`));
}

function getSnapshotListEntries(events) {
    const datedKeys = new Set(events.map(getSnapshotDateKey).filter(Boolean));
    if (datedKeys.size <= 1) return events.map(event => ({ type: "item", event }));

    const entries = [];
    let previousGroupKey = null;
    events.forEach(event => {
        const dateKey = getSnapshotDateKey(event);
        const groupKey = dateKey || "undated";
        if (groupKey !== previousGroupKey) {
            entries.push({
                type: "label",
                text: dateKey ? formatSnapshotDateLabel(dateKey) : "No date"
            });
            previousGroupKey = groupKey;
        }
        entries.push({ type: "item", event });
    });
    return entries;
}

function createSnapshotItemRow(event) {
    const isTask = isSnapshotTask(event);
    const title = String(event.title || "").trim()
        || (isTask ? "Google Task" : "(No title)");
    const start = typeof event.start === "string" ? event.start.slice(0, 5) : "";
    const end = typeof event.end === "string" ? event.end.slice(0, 5) : "";
    const time = event.durationKind === "all-day" || event.isAllDay === true
        ? "All day"
        : start && end ? `${start} - ${end}` : "Timed item";
    const color = event.color || (isTask ? "#4285f4" : "#b88d5a");

    const rowEl = document.createElement("div");
    rowEl.className = "task-row";

    const dotEl = document.createElement("span");
    dotEl.className = "task-dot";
    dotEl.style.setProperty("--item-color", color);

    const titleEl = document.createElement("span");
    titleEl.className = "task-title";
    titleEl.title = title;
    titleEl.textContent = title;

    const timeEl = document.createElement("span");
    timeEl.className = "task-time";
    timeEl.textContent = time;

    rowEl.append(dotEl, titleEl, timeEl);
    return rowEl;
}

function createSnapshotDateLabel(text) {
    const labelEl = document.createElement("div");
    labelEl.className = "snapshot-date-label";
    labelEl.textContent = text;
    return labelEl;
}

function createTaskListEmptyState(provider = getPopupProvider()) {
    const emptyStateEl = document.createElement("div");
    emptyStateEl.className = "empty-state";
    emptyStateEl.textContent = provider.emptyText;
    return emptyStateEl;
}

function renderSnapshot(result, provider = getPopupProvider()) {
    const source = result[provider.sourceStorageKey] || {};
    const events = getSafeEvents(result[provider.eventsStorageKey], source);
    const snapshotCapturedAt = Number(source.capturedAt);
    const { calendarCount, taskCount } = getSnapshotTypeCounts(events);

    snapshotStatusEl.textContent = snapshotCapturedAt
        ? `Snapshot ${formatAbsoluteTime(snapshotCapturedAt)}`
        : "No stored capture yet";
    snapshotCountEl.textContent = `${events.length} ${events.length === 1 ? "item" : "items"}`;
    lastUpdatedEl.textContent = formatRelativeTime(snapshotCapturedAt);
    lastUpdatedEl.title = formatAbsoluteTime(snapshotCapturedAt);
    calendarCountEl.textContent = String(calendarCount);
    taskCountEl.textContent = String(taskCount);

    const rows = getSnapshotListEntries(getSortedSnapshotItems(events))
        .map(entry => entry.type === "label"
            ? createSnapshotDateLabel(entry.text)
            : createSnapshotItemRow(entry.event));
    taskListEl.replaceChildren(...(rows.length ? rows : [createTaskListEmptyState(provider)]));
}

function updateProviderUi(provider) {
    activeProviderId = provider.id;
    calendarProviderEl.value = provider.id;
    snapshotWarningEl.textContent = provider.warning;
    snapshotListTitleEl.textContent = provider.listTitle;
    openCalendarButtonEl.textContent = `Open ${provider.displayName}`;

    const chromeApi = getChromeApi();
    if (!chromeApi?.runtime?.getURL) return;
    const previewUrl = new URL(chromeApi.runtime.getURL("src/clock/popup.html"));
    previewUrl.searchParams.set("embedded", "1");
    previewUrl.searchParams.set("actionPopup", "1");
    previewUrl.searchParams.set("provider", provider.id);
    if (clockPreviewFrameEl.src !== previewUrl.href) clockPreviewFrameEl.src = previewUrl.href;
}

function loadSnapshot(providerId = activeProviderId, options = {}) {
    const provider = getPopupProvider(providerId);
    const loadSequence = ++snapshotLoadSequence;
    updateProviderUi(provider);
    const chromeApi = getChromeApi();
    if (!chromeApi?.storage?.local) {
        renderSnapshot({}, provider);
        return;
    }

    if (options.persist === true) {
        chromeApi.storage.local.set({ [POPUP_PROVIDER_STORAGE_KEY]: provider.id });
    }
    chromeApi.storage.local.get([provider.eventsStorageKey, provider.sourceStorageKey], result => {
        if (loadSequence !== snapshotLoadSequence || provider.id !== activeProviderId) return;
        const runtimeError = chromeApi.runtime?.lastError;
        if (runtimeError) {
            renderSnapshot({}, provider);
            snapshotStatusEl.textContent = "Stored snapshot unavailable";
            snapshotStatusEl.title = String(runtimeError.message || runtimeError);
            return;
        }
        snapshotStatusEl.title = "";
        renderSnapshot(result, provider);
    });
}

calendarProviderEl.addEventListener("change", () => {
    loadSnapshot(calendarProviderEl.value, { persist: true });
});

openCalendarButtonEl.addEventListener("click", () => {
    const chromeApi = getChromeApi();
    if (chromeApi?.tabs?.create && getPopupProvider().openUrl) {
        chromeApi.tabs.create({ url: getPopupProvider().openUrl });
    }
    window.close();
});

const chromeApi = getChromeApi();
if (chromeApi?.storage?.local) {
    chromeApi.storage.local.get([POPUP_PROVIDER_STORAGE_KEY], result => {
        const providerId = result?.[POPUP_PROVIDER_STORAGE_KEY];
        loadSnapshot(providerId);
    });
    chromeApi.storage.onChanged?.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        const provider = getPopupProvider();
        if (changes[provider.eventsStorageKey] || changes[provider.sourceStorageKey]) {
            loadSnapshot(provider.id);
        }
    });
} else {
    loadSnapshot();
}
