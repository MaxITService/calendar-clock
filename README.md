# Calendar Clock Chrome Extension

[![Hits](https://hits.sh/github.com/MaxITService/calendar-clock.svg?style=flat)](https://hits.sh/github.com/MaxITService/calendar-clock/)

![Calendar Clock demo](Promo/Gif%20Demo.gif)

### More clock-face designs

<p align="center">
  <img src="Promo/dark%20design.png" alt="Dark 24-hour Calendar Clock design" width="48%">
  <img src="Promo/other%20design.png" alt="Light Calendar Clock design" width="48%">
</p>

<p align="center"><em>Dark 24-hour design (left) and light 12-hour design (right).</em></p>

### Calendar view

![Calendar Clock displayed over Google Calendar](Promo/How_Clock_Looks.png)

> **Chrome Web Store status:** Calendar Clock is currently awaiting review. Until the store listing is approved, you can install the extension manually:
>
> 1. Download or clone this repository.
> 2. Open `chrome://extensions` in Google Chrome.
> 3. Enable **Developer mode** in the top-right corner.
> 4. Click **Load unpacked**.
> 5. Select the downloaded `calendar-clock` folder.
> 6. Open or refresh [Google Calendar](https://calendar.google.com/) or [Outlook Calendar](https://outlook.live.com/calendar/view/workweek). Pin the extension and click its icon to open the snapshot popup. Enable site access if needed.

Privacy: see [Privacy Policy](Privacy%20Policy.md).

This repo contains a Manifest V3 Chrome extension.

## Built with Codex and GPT-5.6

Calendar Clock was built during OpenAI Build Week with Codex and GPT-5.6, primarily using the Sol model across a variety of reasoning levels.

- Codex turned an initial single-page HTML clock prototype into a modular Manifest V3 extension and helped separate the overlay, background service, event pipeline, clock faces, reminders, and time projection into focused components.
- A dedicated Chrome for Testing profile and Browser Harness let Codex inspect live Google and Outlook calendar pages, structured data, fallback DOM, and visible results.
- Codex created regression checks for time-window projection, overlapping and overnight events, deleted and cached events, refresh behavior, stable event colors, privacy-safe diagnostics, and reminder storage and playback.
- GPT-5.6 helped reason through Calendar's changing data and DOM behavior, event-lane layout, cross-week caching, and the modular architecture. Key decisions included keeping captured data local, preferring structured page-owned data with a resilient DOM fallback, and making clock-face modules independently removable.

The toolbar popup switches between separate Google and Outlook snapshots. On both sites, Calendar Clock prefers structured calendar data already loaded by the page and falls back to visible event chips when necessary. Snapshots stay in `chrome.storage.local`; the clock turns their event ranges into arcs.

After the calendar overlay appears, use its floating panel to open full or mini view, hide the clock, refresh events, open debug, and choose the displayed time span.

## Key features

- **12-hour and 24-hour modes:** Use a familiar 12-hour clock or see the entire day on one 24-hour dial. The dark design above shows the 24-hour mode.
- **Multiple clock-face designs:** Switch between light, dark, and themed faces without changing your calendar.
- **Events at a glance:** See event duration, color, and overlaps directly as arcs on the clock.
- **Flexible display:** Use full or mini mode, move or resize the mini clock with remembered geometry, or hide it when you do not need it.
- **Smart time window:** Follow the current hour, fit the view around your events, or jump to an event outside the visible range.
- **Local by design:** Captured calendar data stays in your browser.
- **Google and Outlook:** Keep independent snapshots and choose either calendar in the toolbar popup.

Notes:

- For the visual-text fallback, use a day or week-style view where event chips include readable time labels.
- Calendar page internals are not stable APIs. The fallback uses accessibility attributes and stable item data attributes where available.

---

## My other projects

- [AivoRelay: AI Voice Relay for Windows](https://github.com/MaxITService/AIVORelay)
- [OneClickPrompts: Your Quick Prompt Companion for Multiple AI Chats!](https://github.com/MaxITService/OneClickPrompts)
- [AI for Complete Beginners: Guide to LLMs](https://medium.com/@maxim.fomins/ai-for-complete-beginners-guide-llms-f19c4b8a8a79)
