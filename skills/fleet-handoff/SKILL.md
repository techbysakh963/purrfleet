---
name: fleet-handoff
description: Hand unfinished work over: save a checkpoint to pick it up tomorrow, or move a task to Codex or Antigravity with everything it needs. Use when the user says "continue tomorrow", "save where we are", "hand this to codex", "let agy finish this", or before ending a long session.
---

# Hand off unfinished work

A good handoff lets the next worker (tomorrow's session, or a crew helper) continue without rediscovering anything.

1. **Gather the state.** Cover the objective, what is done (and verified how), what was tried and failed, the files touched (`git status`, `git diff --stat`), open decisions, and the single next step.
2. **Separate done from proposed.** Never write "fixed" for something that wasn't verified.
3. **Checkpoint for later:** `mcp__fleet__crew_save {"title": "handoff <topic>", "text": "<the state above, as markdown>"}`. Tell the user the note's name, so a future session can attach it with `crew_ask {"notes": [...]}` or read it in Obsidian.
4. **Hand to a helper now:** `mcp__fleet__crew_ask` with a new or existing thread, `agent` (`codex` for code changes, which edit in their own git worktree; `agy` for analysis, design, or broad reading), and a task that includes the state above, the exact next step, and how to report back. Use `mode: "edit"` only if the user wants the helper to change files; FLEET asks the user to approve it. Attach the checkpoint note with `notes` if you saved one.
5. Durable facts the handoff surfaced go to the notebook (see the fleet-remember skill), not into the task text.
6. Report what was handed off, to whom, and how the user will know it's done (the Crew tab and a notice to you).
