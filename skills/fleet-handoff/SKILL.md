---
name: fleet-handoff
description: Hand unfinished work over to Codex or Antigravity with everything it needs, or write a checkpoint to pick it up tomorrow. Use when the user says "continue tomorrow", "save where we are", "hand this to codex", "let agy finish this", or before ending a long session.
---

# Hand off unfinished work

A good handoff lets the next worker (tomorrow's session, or a crew helper) continue without rediscovering anything.

1. **Gather the state.** Cover the objective, what is done (and verified how), what was tried and failed, the files touched (`git status`, `git diff --stat`), open decisions, and the single next step.
2. **Separate done from proposed.** Never write "fixed" for something that wasn't verified.
3. **Checkpoint for later:** write the state above as markdown to a file the user names (default `HANDOFF.md` in the project), and tell them where it is.
4. **Hand to a helper now:** `mcp__fleet__crew_ask` with a new or existing thread, `agent` (`codex` for a correctness or code-level read, `agy` for analysis, design, or broad reading), and a task that includes the state above, the exact next step, and how to report back. Helpers are read-only: they investigate and propose, and you (or the user) make the changes.
5. Report what was handed off, to whom, and how the user will know it's done (the Crew tab and a notice to you).
