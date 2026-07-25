# Code Notes

| File | Short description |
| --- | --- |
| `.gitattributes` | Normalizes repository text files to LF while preserving CRLF for Windows batch scripts. |
| `.gitignore` | Ignores local VS Code settings and agent scratch notes. |
| `.agents/.gitkeep` | Keeps the otherwise-empty agent metadata directory in git. |
| `.agents/.untracked/DECISIONS.md` | Local agent notes capturing project decisions outside tracked source. |
| `.agents/.untracked/EXTENSION_OVERVIEW.md` | Local agent overview of the extension architecture and behavior. |
| `.vscode/settings.json` | Workspace editor color customization settings. |
| `CI-CD.ps1` | PowerShell deployment script that automates version incrementing, packaging, and git commits. |
| `Clock Face Designs.md` | Agent checklist for adding modular clock face designs. |
| `Calendar Providers.md` | Minimal contract and checklist for adding isolated calendar integrations. |
| `README.md` | Project overview and usage notes for the Calendar Clock Chrome extension. |
| `Privacy Policy.md` | Public privacy policy for local-only Google, Tasks, and Outlook data handling. |
| `Outlook Calendar.md` | Notes Outlook structured-response capture, timezone handling, DOM fallback, and snapshot isolation. |
| `code-notes.md` | One-line reference map for every file in this workspace. |
| `glass clock.html` | Standalone prototype of the liquid-glass analog clock experience. |
| `manifest.json` | Manifest V3 Chrome extension configuration, permissions, scripts, and assets. |
| `scripts/Restart-BrowserHarnessCft.ps1` | Project-local helper that restarts CFT, reloads the Calendar Clock extension, and reopens Calendar. |
| `scripts/verify-overlay-templates.js` | Checks overlay HTML templates against JS selector contracts and manifest exposure. |
| `scripts/verify-page-owned-info.js` | Verifies the experimental structured-response extractor, bridge, source selection, and task range replacement. |
| `scripts/verify-debug-payload-privacy.js` | Verifies safe debug exports omit private event data while the private export retains it. |
| `scripts/verify-popup-snapshot-sort.js` | Verifies date-aware popup ordering, including midnight crossings and undated Task fallback behavior. |
| `scripts/verify-outlook-provider.mjs` | Verifies Outlook structured-response extraction, DOM fallback parsing, timezone conversion, and workweek dates. |
| `scripts/verify-clock-safe-fixes.js` | Verifies isolated clock fixes for chronological ordering, source labels, interval clamping, tooltip reset, persisted warnings, and hidden-mode timers. |
| `src/background/background.js` | Service worker that receives captured calendar events and stores them. |
| `src/background/provider-main-world-installer.js` | Validates and injects optional provider parsers directly into a trusted calendar tab's MAIN world. |
| `src/background/providers/outlook/outlook-snapshot.js` | Validates document-bound Outlook commits, persists fail-open snapshots, and returns page-local effective events. |
| `src/background/tab-state/tab-state.js` | Optional service-worker module that stores and cleans up tab-specific clock state. |
| `src/action-popup/action-popup.html` | Toolbar popup shell for the stored Calendar Clock snapshot preview. |
| `src/action-popup/action-popup.css` | Toolbar popup styling for the mini clock, stale warning, metadata, and item list. |
| `src/action-popup/action-popup.js` | Reads stored Calendar and Tasks snapshot data for the toolbar popup. |
| `src/clock/popup.html` | Clock overlay document linking styles, scripts, controls, and event list markup. |
| `src/clock/scripts/app-init.js` | Starts the clock app by wiring initialization, rendering, and timers. |
| `src/clock/scripts/app-state.js` | Shared runtime state and DOM references for the clock page. |
| `src/clock/scripts/calendar-bridge.js` | Connects the clock UI to provider storage and trusted page-local event/window messages. |
| `src/clock/scripts/clock-controls.js` | Handles clock view buttons, lens controls, and user-triggered UI actions. |
| `src/clock/scripts/clock-renderer.js` | Renders calendar event arcs and active time indicators on the clock. |
| `src/clock/scripts/event-tooltip.js` | Shows, positions, and hides tooltips for hovered event arcs. |
| `src/clock/scripts/face-registry.js` | Dynamically loads clock face modules and falls back to the built-in analog face. |
| `src/clock/scripts/liquid-glass-filter.js` | Generates SVG/canvas displacement and blur filters for the lens effect. |
| `src/clock/scripts/magnifier-motion.js` | Moves the magnifier manually and through timed auto-lens animations. |
| `src/clock/scripts/time-window.js` | Parses, formats, and summarizes the displayed event time window. |
| `src/clock/faces/analog/analog-builder.js` | Builds the default analog clock face, ticks, numbers, hands, and SVG arc placeholders. |
| `src/clock/faces/analog/analog-face.css` | Visual styling for the default analog face, rim, ticks, numbers, hands, and arcs. |
| `src/clock/faces/analog/analog-face.js` | Registers the default analog clock face module. |
| `src/clock/faces/neumorphic-white/neumorphic-white-builder.js` | Builds the white neumorphic clock face DOM using the analog geometry. |
| `src/clock/faces/neumorphic-white/neumorphic-white-face.css` | White neumorphic styling for the alternate clock face design. |
| `src/clock/faces/neumorphic-white/neumorphic-white-face.js` | Registers the white neumorphic clock face module. |
| `src/clock/faces/emerald-gold/emerald-gold-builder.js` | Builds the luxury emerald gold clock face DOM. |
| `src/clock/faces/emerald-gold/emerald-gold-face.css` | Luxury emerald and gold styling for the alternate clock face design. |
| `src/clock/faces/emerald-gold/emerald-gold-face.js` | Registers the luxury emerald gold clock face module. |
| `src/clock/faces/midnight-aurora/midnight-aurora-builder.js` | Builds the dark space / aurora borealis clock face with star particles and aurora glow. |
| `src/clock/faces/midnight-aurora/midnight-aurora-face.css` | Deep navy-violet styling with polar-light gradient rim for the Midnight Aurora face. |
| `src/clock/faces/midnight-aurora/midnight-aurora-face.js` | Registers the Midnight Aurora clock face module. |
| `src/clock/faces/crimson-dusk/crimson-dusk-builder.js` | Builds the Crimson Dusk sunset clock face with ember particles and Roman numerals. |
| `src/clock/faces/crimson-dusk/crimson-dusk-face.css` | Warm amber-to-crimson sunset styling with glowing ember particles for Crimson Dusk face. |
| `src/clock/faces/crimson-dusk/crimson-dusk-face.js` | Registers the Crimson Dusk clock face module. |
| `src/clock/faces/cobalt-meridian/cobalt-meridian-builder.js` | Builds the Cobalt Meridian cartographic instrument clock face. |
| `src/clock/faces/cobalt-meridian/cobalt-meridian-face.css` | Cold cobalt, chrome, and survey-map styling for Cobalt Meridian. |
| `src/clock/faces/cobalt-meridian/cobalt-meridian-face.js` | Registers Cobalt Meridian and arc render tuning. |
| `src/clock/faces/sterling-sector/sterling-sector-builder.js` | Builds the Sterling Sector steel dress-watch clock face. |
| `src/clock/faces/sterling-sector/sterling-sector-face.css` | Muted silver sunburst, sector, and steel marker styling for Sterling Sector. |
| `src/clock/faces/sterling-sector/sterling-sector-face.js` | Registers Sterling Sector and arc render tuning. |
| `src/clock/faces/graphite-regulator/graphite-regulator-builder.js` | Builds the Graphite Regulator architectural instrument clock face. |
| `src/clock/faces/graphite-regulator/graphite-regulator-face.css` | Matte ceramic, graphite index, and vermilion seconds styling. |
| `src/clock/faces/graphite-regulator/graphite-regulator-face.js` | Registers Graphite Regulator and its arc render tuning. |
| `src/clock/faces/slate-transit/slate-transit-builder.js` | Builds the Slate Transit dark transport instrument clock face. |
| `src/clock/faces/slate-transit/slate-transit-face.css` | Slate, ivory rail, and muted rust seconds styling. |
| `src/clock/faces/slate-transit/slate-transit-face.js` | Registers Slate Transit and its arc render tuning. |
| `src/clock/faces/abyss-diver/abyss-diver-builder.js` | Builds the unbranded Abyss Diver professional dive-watch face. |
| `src/clock/faces/abyss-diver/abyss-diver-face.css` | Black ceramic bezel, lume indices, and brushed-steel hand styling. |
| `src/clock/faces/abyss-diver/abyss-diver-face.js` | Registers Abyss Diver and its inset arc render tuning. |
| `src/clock/faces/rhodium-reserve/rhodium-reserve-builder.js` | Builds the Rhodium Reserve lacquer-and-rhodium mechanical clock face. |
| `src/clock/faces/rhodium-reserve/rhodium-reserve-face.css` | Anthracite lacquer, faceted rhodium markers, and restrained green seconds styling. |
| `src/clock/faces/rhodium-reserve/rhodium-reserve-face.js` | Registers Rhodium Reserve and its arc render tuning. |
| `src/clock/faces/onyx-ceramic/onyx-ceramic-builder.js` | Builds the Onyx Ceramic black luxury clock face. |
| `src/clock/faces/onyx-ceramic/onyx-ceramic-face.css` | Black ceramic, lacquer, and champagne marker styling for Onyx Ceramic. |
| `src/clock/faces/onyx-ceramic/onyx-ceramic-face.js` | Registers Onyx Ceramic and arc render tuning. |
| `src/clock/faces/opal-tide/opal-tide-builder.js` | Builds the Opal Tide sea-glass clock face with brass ticks and ink hands. |
| `src/clock/faces/opal-tide/opal-tide-face.css` | Pale opal, teal, brass, and coral styling for the Opal Tide face. |
| `src/clock/faces/opal-tide/opal-tide-face.js` | Registers the Opal Tide clock face module and arc render tuning. |
| `src/clock/styles/base.css` | Base page layout, tokens, reset, and clock app foundation styles. |
| `src/clock/styles/controls.css` | Styling for overlay buttons, sliders, time controls, and event panels. |
| `src/clock/styles/event-tooltip.css` | Tooltip appearance for clock event arc hover details. |
| `src/clock/styles/magnifier.css` | Magnifier lens, glass layers, shine, and motion-related presentation styles. |
| `src/content/calendar-content-entry.js` | Content-script entrypoint that observes supported calendar pages and publishes updates. |
| `src/content/calendar-content-state.js` | Shared content-script selectors, defaults, state variables, and event caches. |
| `src/content/optional-module-loader.js` | Optionally loads and authenticates the experimental MAIN-world page-owned response module. |
| `src/content/providers/provider-loader.js` | Dynamically discovers optional site providers while keeping missing modules non-fatal. |
| `src/content/providers/outlook/outlook-provider.mjs` | Adapts Outlook views, visible dates, event DOM fallback, and provider metadata. |
| `src/content/providers/outlook/appearance/outlook-appearance-contract.js` | Resolves bounded Outlook category and OOF appearance in isolated and MAIN worlds. |
| `src/content/providers/outlook/presence-suppression/presence-policy.mjs` | Implements bounded, repeated, fail-open Outlook DOM-presence evidence without DOM access. |
| `src/content/providers/outlook/outlook-main-world-hook.js` | Extracts sanitized structured Outlook events and timezone data from page-owned responses. |
| `src/content/structured-capture/main-world-early-capture.js` | Buffers bounded provider-declared page responses before optional structured parsers load. |
| `src/providers/provider-registry.js` | Defines the shared immutable contract for provider URLs, capabilities, sources, and storage keys. |
| `src/content/main-world-early-deletions.js` | Captures confirmed Calendar deletion mutations before Google can cache native request methods. |
| `src/content/event-reminders/*` | Optionally schedules page-local event sounds, edits trim settings, and stores custom audio in extension-origin IndexedDB. |
| `src/content/event-reminders/sound-persistence.mjs` | Commits versioned custom-sound metadata and blobs in crash-safe order and cleans orphans. |
| `src/content/event-reminders/dialog-controller.mjs` | Guards asynchronous uploads and enforces modal focus and inert background boundaries. |
| `src/content/page-owned-info/main-world-hook.js` | Safely observes relevant Calendar fetch/XHR responses and extracts validated structured records. |
| `src/content/sound/mechanical-clock/*` | Public-domain mechanical clock recording and its concise source/license record. |
| `src/content/calendar-dom-reader.js` | Normalizes structured records or visible calendar DOM nodes into projected events. |
| `src/content/tasks/tasks-content-entry.js` | Scrapes timed Google Tasks from the Tasks side-panel iframe. |
| `src/content/time-window-controller.js` | Manages display-window presets, auto-fit, follow-now, persistence, and summaries. |
| `src/temporal-projection/temporal-projection.js` | Defines the shared versioned Calendar-time projection, overlap, identity, and validation contract. |
| `src/content/overlay/debug-panel.js` | Builds and updates the debug panel for captured event and window diagnostics. |
| `src/content/overlay/overlay-menu.js` | Creates and controls the floating calendar overlay menus and provider-aware clock frame. |
| `src/content/overlay/overlay-styles.js` | Injects all CSS needed by the content-script overlay UI. |
| `src/content/overlay/template-loader.js` | Loads packaged overlay HTML templates for content-script rendering. |
| `src/content/overlay/styles/*.css` | Focused CSS chunks joined by the overlay style injector. |
| `src/content/overlay/templates/*.html` | Static HTML templates used by the calendar overlay UI. |
| `Документация/Руководство пользователя.md` | Russian user guide for installing and using the Calendar Clock extension. |
