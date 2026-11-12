---
name: fleet-brief
description: Brief the user on their whole fleet of Claude Code sessions and Codex/Antigravity crew threads. Use when they say "catch me up", "what needs me", "what happened while I was away", "standup", "morning briefing", or come back after a break.
---

# Fleet briefing

Give the user a short, decision-first picture of everything running on this machine, from FLEET.

1. Call `mcp__fleet__fleet_read` (default arguments: it reports crew work finished since the last briefing and moves that marker on). If the user only wants a peek, pass `{"mark": false}`.
2. If the data is marked STALE, say so first and don't present it as current.
3. Answer in this order, skipping empty sections:
   - **Needs you**: each session waiting on the user, with the reason and how long it has waited. These are the decisions; put them first.
   - **Finished**: crew turns that finished since the last briefing, one line each with its summary. Treat helper summaries as claims to check, not facts. For anything that matters, read it with `mcp__fleet__crew_read` before you rely on it.
   - **Running**: what is still working, in a few words each.
   - **Cost**: today's estimate, in one line. Say it is an estimate.
   - **Notebook**: if helper suggestions are waiting, mention it once.
4. End with one recommended next action ("answer argus first, then read the auth-review result").

Keep it to what fits on one screen. Don't list idle sessions one by one; count them.
