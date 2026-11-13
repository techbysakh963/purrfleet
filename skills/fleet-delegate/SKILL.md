---
name: fleet-delegate
description: Decide whether to hand work to a Codex or Antigravity helper through FLEET, and do it cheaply. Use when a task would benefit from an independent second opinion, a broad read across many files, or a long check that can run while you keep working.
---

# Delegate to the crew

A helper costs a round trip and your attention to check its answer. Delegate only when that pays.

**Delegate:**
- an independent second opinion on a change or a design
- a broad read across many files you don't need in your own context
- a long check (a review, a search, a test plan) that can run while you keep working

**Do it yourself:**
- anything you can settle in about five tool calls
- anything that needs this conversation's context to judge
- anything that changes files: helpers are read-only

**How:**
1. One self-contained `mcp__fleet__crew_ask`: the goal, what you know, where to look, what to send back.
2. `depth: "brief"` unless the detail is the point; `"deep"` only for a handoff or a full audit.
3. For two opinions at once, `agent: "both"` with a different angle for each in `tasks`.
4. Never wait idle: carry on, and read the result with `mcp__fleet__crew_read {"new": true}` when the notice comes. Use `grep` for one finding's detail.
5. Started one by mistake? `mcp__fleet__crew_stop {"thread": "..."}` (a deferred tool; load it with ToolSearch).
6. You are the lead: verify what comes back against the code before you rely on it.
