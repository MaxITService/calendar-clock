# Instructions on Multiple Agents Flow

This workflow coordinates three agents communicating via the `messages.md` file.

### Agent Roles
1. **Agent 1 (Orchestrator)**: Interacts directly with the user and coordinates the task.
2. **Agent 2 & optional Agent 3 (Helpers)**: Advise, verify, and edit only when the user explicitly assigns edits to them.
3. **Writer (optional assigned role)**: Implements changes that two other agents already agreed on. A Writer does not advise unless it finds a critical omission, contradiction, or implementation blocker in the agreed plan.
4. Ask user which role you are holding.
5. Select a name for yourself without asking the user. The name must consist of exactly three words, and you must not choose a name of any agent that is already present in messages.md. Write this name in messages.md.
6. Active agents are only agents that have introduced themselves in `messages.md` or were explicitly assigned by the user. Do not address a theoretical third agent until it exists.

### Communication Flow
- User Writes MAF: If there is no message from other agents, then you are the orchestrator.
- If you are the orchestrator and the user already gave concrete tasks in the current chat, write task briefs to `messages.md` for helper agents before doing implementation work. Record every active task, not just the newest one.
- Give each task a short stable name in square brackets, for example `[Mini Window Icons]`. Use that name in later replies and cleanup notes.
- If there are multiple tasks, write one brief per task or a clearly numbered task list. Include goal, relevant files if known, constraints, status, and what kind of advice or verification you want.
- If there is message from other agents: You are helper. Read message, write response as helper.
- All agents read and write to `messages.md`, using tags plus names like `@Agent1 Codex-Lumen` or `@Agent2 Opus-Compass` to route messages. Once an agent's name is known, address that agent by both tag and name.
- Route messages only to active agents. If only two agents exist, do not include `@Agent3`; write an open note such as "future helper may also advise" only when useful.
- Every message added to `messages.md` must start with an ISO-like local timestamp, for example `[2026-06-14T22:40:04+03:00] @Agent1 Name: ...`.
- Active helpers perform advice, verification, and other read-only tasks by default, then post their progress/results back in `messages.md`. They edit files only when the user explicitly assigns edits to them.

### User Commands

- `MV` means "move": read `Multiple Agents Flow.md` and `messages.md`, check messages addressed to your tag/name and active task updates, then respond with a timestamped status/action message. If nothing is actionable, say that briefly.
- `Запиши` means the user is assigning the addressed/current agent to write changes for a named task. Treat that agent as Writer unless the user says otherwise.
- `clean` means force a `messages.md` cleanup attempt. Remove obsolete completed-task chatter, stale addressed messages, and old protocol notes when they are no longer useful. Preserve the header, active tasks, unresolved feedback, latest coordination closures, latest change notes, and active agent names. If cleanup risk is unclear, ask the user what to remove.
- Commands wake only the agent/thread where the user sends them. If another agent must react, ask the user to send that command to that agent too.

### Emoji Status Protocol

- Agents should use status emojis in both user-facing chat and `messages.md`. Keep them useful, not decorative.
- In `messages.md`, put the status emoji after the timestamp and before the agent tag, for example `[2026-06-14T22:59:51+03:00] ✅ @Agent1 Name: ...`.
- In user-facing chat, start status updates and final summaries with the most relevant status emoji when it helps scanning.
- Use these predefined emojis:
  - 👀 reading/checking messages or files
  - 💬 answered or gave advice
  - ✅ done / task handled
  - 📝 wrote notes or updated `messages.md`
  - ✍️ wrote code or edited project files
  - 🧪 tested or verified
  - ⚠️ blocker, risk, or critical omission
  - 🧹 cleaned `messages.md`
  - 🔒 coordination closed / agreed plan is ready for implementation
  - 💤 sleeping / waiting for user to wake another agent
  - ➡️ handing off or asking another agent to continue
- If no emoji fits, use a plain message rather than inventing many one-off symbols.

### Wake And Sleep Model

- Agents are not background workers. An agent is awake only while the user has started or messaged that agent in its own chat/thread.
- `messages.md` is a shared log/mailbox, not a notification system. Writing there does not wake sleeping agents.
- If an awake agent needs input from a sleeping or non-active agent, ask the user to wake/start that agent and tell it which task name to read.
- Do not wait indefinitely for sleeping or optional agents. If their advice is not needed, record that decision in `messages.md` and continue with the active agents.
- When an agent wakes, it must read `Multiple Agents Flow.md` and `messages.md`, identify active tasks and known agent names, then reply with a timestamped status message before advising or editing.

### Coordination Closure

- The default implementation path is: task brief -> active helper advice -> two-agent agreement -> coordination closed -> edit owner implements.
- Two-agent agreement means the edit owner and at least one other active agent agree on the approach. If no other active agent is available, ask the user whether to wake another agent or proceed solo.
- Writer path is stricter: when the user assigns a Writer, the Writer should implement only after two other agents have agreed and written a closure/brief for the task. If two other agents are unavailable, ask the user whether to wake another agent or explicitly proceed with fewer reviewers.
- When discussion is complete or more advice is no longer useful, the orchestrator may close coordination by writing a timestamped message for that task with: agreed approach, unresolved risks, edit owner, and next action.
- After coordination is closed, the edit owner may implement without waiting for sleeping or theoretical agents.
- If a helper wakes after coordination is closed, it should treat the latest closure/change note as current state and only reopen discussion if it finds a concrete risk.

### Edit Ownership

- By default, Agent 1 is the only agent that edits project files. Active helpers are read-only advisors and verifiers.
- Before Agent 1 makes implementation changes for a task, follow the coordination closure rules above. If both helpers are active, include both when practical.
- The user may explicitly assign edits to any specific agent. That user instruction overrides the default edit owner for that task.
- A Writer may edit only the files needed for the agreed task and should not expand scope without asking the user or reopening coordination for a concrete risk.
- If any agent edits files, that agent must add a short timestamped message to `messages.md` describing what changed, which files were touched, and whether follow-up verification is needed.

### Maintenance

- Wipe all content below this line when the user requests it, propose to do it when the task is finished.
- You may edit `messages.md` to remove tasks that are definitely complete and will not be revisited. If cleanup is not obvious, ask the user which tasks or messages to remove.
- During cleanup, preserve active tasks, unresolved helper feedback, and decisions that are still useful.
