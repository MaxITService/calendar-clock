# Local platform instructions
- At the start of work, read `.agents/.untracked/agents-platform.md` if it exists and follow it together with this file. It contains machine- and platform-specific instructions and is intentionally untracked.

# Testing Instructions
- code editing tasks do not require  browser testing.  
- For browser testing, use the isolated browser setup described by the local platform instructions when available. If a calendar tab is open, you may use it.
- Cleanup tabs, use one tab maximum, unless taks needs more.
- Use bounded retry limits for browser/testing operations. For a single operation, try at most 3 total attempts (initial attempt plus up to 2 retries) with safe recovery steps such as reconnecting the browser harness, reloading the allowed test extension, or refreshing Calendar tabs. Do not switch browser profiles, kill browser processes, or bypass permissions without asking the user. If the operation still fails after the limit, stop and report the blocker in chat with the attempts made.
- After the browser connection is ready, open Google Calendar and switch Calendar Clock to its `Full` display mode before testing. `Full` means the extension clock mode, not browser fullscreen.
- After testing, leave one Google Calendar tab open so the user can inspect the result.
- If extension files need to be refreshed, reloaded, or updated in the browser, try to do it in the allowed test browser/profile first. Some browsers/profiles can reload an unpacked extension programmatically, and some cannot; always verify whether the loaded extension actually updated. After an extension reload/update, refresh Google Calendar pages before testing content scripts again.

## Calendar test events

- Read [[test/calendar-fixtures/README]] before populating Google Calendar with test events.
- The default fixture config intentionally tests overlaps, short events, and an overnight event. For a specialized one-off schedule, use a separate untracked config; do not rewrite the default config.
- Fixture cleanup is limited to the exact `[CC FIXTURE v1 YYYY-MM-DD]` title marker. Never remove real-looking calendar events.

# Documentation and help

- AI Documentation language is English and documentation must be as short as possible.
- Different areas of AI documentation should be in different files linked by Obsidian-style [[links]].
- Google Calendar behavior: [[Google Calendar.md]]. Only info about exotic DOM manipulation or API behavior.
- Clock face design workflow: [[Clock Face Designs.md]].
- code notes: [[code-notes.md]] add max 1 row per new file. Obvious files, like icons, images, do not need to be documented.

# New Code & Modularity

All new code must adhere to strict modularity principles:
- **Isolated Folders:** Each module or design (e.g., a watch face) must reside in its own dedicated sub-folder.
- **Dynamic Loading & Resilience:** Implement dynamic module discovery and loading. Deleting any individual design/module folder must not cause the application to fail or crash. The application should gracefully omit the missing module and continue running.
- **Loose Coupling:** Integrate modules with a decoupled architecture so that removing a folder is completely self-contained.
- commit every change if you are sure it is not fragile, ask user if you are not sure, if user asks for another change this means user had already tested this one: commit before implementing another change, so it is easier to track changes in cases of bugs.


# Subagent delegation
- fork_context false. Create a perfect prompt for subagent instead.

# Other agents

- Multiple agents may be editing the project at the same time: if fatal changes detected - stop and report in chat. If possible to work as it touches different logic - continue. If unsure, tell user when task is done about what potential conflicts may exist.

# Temporary files
- put them in .agents/ ,ask to clean when they seem to be not needed, but do not clean automatically.

# How to code
- Every collapsible element should unroll. 
- Use `rg` for text/content searches inside files.
- Prefer to ask user about the task if unclear. Very convinient: numbered menu, with few answeer options, so user can answer 1 a 2 b 3 a, etc
- Only proceed with writing code when task is clear to you. Write 1-3 sentences of short description of how you understood user, then code right away.
- extension is not released yet, no need to care about backward compatibility or migration
- Google is your friend: do not guess, search for solutiuon. Internet is full of lies and outdated info, always check several sources.

# Multi agent flow
ONLY if requested, read [[Multiple Agents Flow.md]]. Request looks as followng: user writes code word "MAF".
