# Calendar Clock User Guide

## 1. Quick start

1. Open Google Calendar.
2. Switch to Day or Week view.
3. Click the **Calendar Clock** extension icon.
4. The clock and control panel will appear on the calendar page.
5. Click **Refresh** if events do not appear immediately.

Calendar events appear as colored arcs. Longer events have longer arcs.

## 2. Main controls

| Control | Action |
| --- | --- |
| **Open** | Shows the large clock over the calendar. |
| **Mini** | Switches to the compact clock. |
| **Hide** | Hides the clock. You can reopen it from the extension. |
| **Refresh** | Reads the visible Google Calendar events again. |
| **Fit now** | Selects a 12-hour window that better displays current events. |
| **Jump** | Moves the window to the nearest event outside the current clock display. |
| **Debug** | Opens a technical panel with diagnostic data. |

Drag the control panel by its **Calendar Clock** title bar to move it.

## 3. Time window

The clock shows a selected 12-hour window rather than the whole day. For example:

- `08-20`: 08:00 to 20:00.
- `20-08`: 20:00 to 08:00 the next day.
- `00-12`: the first half of the day.
- `12-00`: the second half of the day.
- `Custom`: a window you set yourself.

For **Custom**, set the start and end times in the fields beside the dropdown.

## 4. Automatic modes

### Schedule

**Schedule** switches automatically between day and night windows. Set the start of each window in the adjacent fields. For example, with day starting at `08:00` and night at `20:00`, the extension alternates between `08:00-20:00` and `20:00-08:00`.

### Auto-fit

**Auto-fit** chooses a display window around events visible in Google Calendar. It is useful when events fall outside the usual daytime hours.

### Follow hour hand

**Follow hour hand** keeps the window centered around the current time. Set the radius in the `+/- hours` field. For example, `6` shows roughly six hours before and six hours after the current time.

## 5. Current-time marker

The **Now** switch shows or hides the current-time marker on the clock. Turn it off if it obscures events.

## 6. Event arc density

**Arc density** controls how closely event arcs are placed:

| Mode | Best for |
| --- | --- |
| **Auto** | Most calendars; the extension chooses the density. |
| **Readable** | Fewer events, with more space between arcs. |
| **Compact** | Many events. |
| **Ultra compact** | Very busy calendars. |

## 7. Reading events on the clock

- A colored arc represents a Google Calendar event.
- Its beginning and end show the event's start and end times.
- The arc color usually matches the event color in the calendar.
- Hover over an arc to see the event title and time.
- Click an arc to highlight the corresponding event in Google Calendar, when available.

## 8. Standalone clock page

You can open `glass clock.html` in a browser to view the clock without Google Calendar. The page provides a large clock, a magnifying-glass effect, lens size controls, manual control of automatic lens movement, and a list of events if the extension has supplied them.

For everyday use, open the clock on the Google Calendar page through the extension.

## 9. If events do not appear

1. Confirm that `https://calendar.google.com/` is open.
2. Switch to Day or Week view.
3. Make sure the events are visible on the page.
4. Click **Refresh** in the Calendar Clock panel.
5. Check that the selected time window includes the events.
6. Click **Fit now** to choose a suitable window automatically.
7. Click **Jump** if an event is outside the current window.

The extension reads events from the visible Google Calendar page. If Google changes its page structure, or an event is outside the visible area, the clock may not show it.

## 10. Privacy

The extension works with events visible on the Google Calendar page and stores captured data locally in the browser with `chrome.storage.local`.

It does not use the full Google Calendar API or request OAuth access to your Google account.

## 11. Diagnostics

1. Click **Debug**.
2. Review the list of captured events.
3. Click **Copy JSON** to copy the diagnostic data.

This can help identify whether an event was captured but falls outside the selected time window.
