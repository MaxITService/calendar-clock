# Clock Face Designs

Short agent contract for adding a modular clock face. Related: [[code-notes]].

## Module

Create one isolated `src/clock/faces/<face-id>/` folder with:

- `<face-id>-builder.js`: builds this face's DOM.
- `<face-id>-face.css`: styles this face only.
- `<face-id>-face.js`: calls `registerClockFace(...)`.

Use lowercase kebab-case. Add exactly one matching descriptor to `CLOCK_FACE_MODULES` in `src/clock/scripts/face-registry.js`: CSS first, then builder JS, then registration JS. This descriptor and successful runtime registration are the only sources of truth. The Calendar dropdown is built from loaded faces; do not add hardcoded options or face-id lists elsewhere.

The folder is an atomic optional module. Missing CSS, missing JS, failed registration, or deleting the whole folder must only omit that face. Never depend on another face folder.

## Builder Contract

The builder runs repeatedly for both the primary face and the magnifier. It must be re-entrant, deterministic for identical state, and mutate only its `target`.

- Clear `target.innerHTML`, remove `is-clock-face-missing`, and toggle `is-24-hour` from `use24HourRadial`.
- Use the shared state and helpers; do not own timers, document-level listeners, event geometry, hand motion, or selection state.
- Create `.window-start-marker`, `.hour-hand`, `.minute-hand`, `.second-hand`, and `.center`.
- Create one canonical event scaffold per `calendarEvents` item: `.time-arc`, `.time-point`, `.time-arc-separator`, `.time-arc-label-path`, `.time-arc-label` with `textPath`, and `.time-point-callout`.
- Derive SVG path ids from the target id so primary and magnifier ids never collide. Attach the shared arc tooltip handlers.
- Prefix every face-specific class with a short unique prefix.
- Do not use `Math.random()` during a build. Decorative layouts must use index-based math or a fixed-seed local generator reset on every build so the primary face, magnifier, and rebuilds match.

Copy the shared event scaffold from the current Analog builder exactly unless the scaffold has first been centralized for all faces.

## Shared Behavior

The face owns static DOM and appearance. The shared clock runtime owns arcs, labels, point events, callouts, time-window geometry, user visibility settings, and fallbacks.

- A face may tune documented `renderConfig.arcs` dimensions such as `labelScale` and point size.
- Do not set `labelsVisible: false`, hide shared event classes, or override a user-controlled feature merely to simplify a design.
- Support both 12-hour and 24-hour radial modes.
- Let builder errors propagate. The registry activates the registered Analog face for every current render target; do not implement a face-local fallback or catch-and-ignore a partial build.

## CSS

- The registry enables only the active face stylesheet; keep all face rules in that file.
- Keep shared arcs, labels, hands, focus states, and tooltips readable.
- Add `prefers-reduced-motion` handling for animation.
- Use no remote fonts, images, libraries, or network dependencies.

## Documentation

Add one concise row per new source file in [[code-notes]]. Do not document obvious static assets.

## Verification

Run:

```powershell
node --check src/clock/faces/<face-id>/<face-id>-builder.js
node --check src/clock/faces/<face-id>/<face-id>-face.js
node --check src/clock/scripts/face-registry.js
rg -n "Math\.random" src/clock/faces/<face-id>/<face-id>-builder.js
node scripts/verify-clock-safe-fixes.js
node scripts/verify-overlay-templates.js
git diff --check
```

The `rg` command must return no builder-time randomness. Review both render targets, 12/24-hour branches, shared event scaffolds, module removal, and Analog fallback. Browser testing is optional for code-only edits; if used, follow [[AGENTS]].
