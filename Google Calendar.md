# Google Calendar

Calendar Clock works on the visible Google Calendar page, not through the Google Calendar API.

- The content script runs on `https://calendar.google.com/*`.
- It reads event chips that intersect the browser viewport; Google Calendar may keep offscreen week-view chips in the DOM.
- It refreshes capture after Google Calendar route/title changes and after likely Calendar navigation controls such as Next, Previous, Today, and view switches.
- During week navigation, Google Calendar can briefly remove old event chips before rendering the next view; empty captures during that transition are ignored.
- Calendar captures update a bounded occurrence store. Queries intersect canonical civil-date spans, so a cross-midnight event remains available from either covered day without duplicating the event.
- Stable-ID replacements and explicit tombstones are date-independent. Missing-event purge requires a trusted `dated-url` or `visible-dom` capture scope; title and today fallbacks only guide display.
- The clock display is always anchored to today/real now. Windows that cross midnight can include yesterday/today or today/tomorrow.
- Day and week views are the best test views because event chips expose time labels.
- Parsed events are saved to `chrome.storage.local` as `calendarClockEvents`.
- The Tasks side panel is a `tasks.google.com` iframe, so timed tasks are collected by a separate iframe content script and merged with Calendar events.
- The extension overlay iframe reads those stored events and draws them as arcs.
- The toolbar icon opens the snapshot popup for the latest stored data.
- Overlay controls are available inside Google Calendar after the content script has added the overlay.
- Experimental page-owned mode is enabled by default and observes Calendar `sync.sync`/`sync.prefetcheventrange` plus Google Tasks `TasksApiService/Sync` at document start. Calendar records use ID `0`, updated time `4`, title `5`, start `35`, and optional end `36`; timed Tasks use ID `0`, title `1.1`, updated time `2`, schedule `8`, and optional Calendar relation `23`. Every record is validated before use. Responses are partial, so the cache is updated incrementally by unique event ID; a drag reschedule replaces that ID's prior time, and request sequence prevents an older response from restoring it.
- Page-owned records do not carry display colors or DOM nodes. Their raw event IDs are matched to the base64 IDs on Calendar DOM chips so arcs retain the original Calendar color and can highlight/scroll to the visible chip; unmatched offscreen records use a stable fallback color.
- Both structured and DOM records pass through the same versioned projection in the Calendar display timezone before filtering or storage. Timed intervals are `[start, end)`; all-day records retain their civil start and exclusive civil end without timezone-shifting API UTC sentinels.
- Stored projections are partitioned by Calendar timezone and projection-policy version. Missing/invalid timezone context or an unavailable projection module rejects publication instead of using the computer timezone.

## Clock Mapping

The black hands, event arcs, and Past/Future Divider use the same analog 12-hour clock geometry.

The selected display window, such as `08:00-20:00`, filters which events are shown and counted as visible or outside.

Arc placement still follows real clock positions:

- `15:00-16:00` appears near 3-4.
- `08:00-09:00` appears near 8-9.
- Events crossing 12 continue across the top of the face.

## Testing Notes

- Open Google Calendar in the dedicated Canary test browser.
- Refresh the extension overlay after changing the visible calendar date or view.
- Confirm event count in the overlay panel before judging arc placement.
- Leave one Google Calendar tab open after testing.
