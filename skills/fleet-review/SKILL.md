---
name: fleet-review
description: Review a change with the crew. Codex and Antigravity review in parallel and Claude verifies every finding before reporting. Use when the user asks to "review this with the crew", "get a second opinion", "have codex and agy look at this diff", or before merging something significant.
---

# Crew review

Run independent reviews on Codex and Antigravity, then act as the lead: verify, deduplicate, and report only what holds up.

1. **Pin down the target.** Work out the diff or files under review (`git diff`, a branch, or files the user named) and what "correct" means here (the intent, constraints, acceptance criteria). If it's unclear, ask one question.
2. **Delegate in parallel**, read-only, with complementary scopes so they don't duplicate each other:
   - `mcp__fleet__crew_ask` with `agent: "codex"`, thread `review-<topic>`, task: correctness, edge cases, error handling, concurrency, tests that are missing.
   - `mcp__fleet__crew_ask` with `agent: "agy"`, thread `review-<topic>-design`, task: API and interface design, readability, naming, consistency with the surrounding code.
   - Make each task self-contained: the folder, the exact files or diff to read, the intent, and "cite path:line and a concrete failure scenario for every finding".
3. **Keep working** while they run. When both are done you get one notice naming both (a slow one never holds the other back more than 3 minutes).
4. **Read summaries first** with `mcp__fleet__crew_read`; pull `full: true` only for findings worth acting on.
5. **Verify every finding yourself** against the current code. Two reviewers agreeing is not verification. Drop anything you can't reproduce or point to in the code.
6. **Report** one merged list, most severe first: finding, file:line, why it matters, your verification status (confirmed / plausible / rejected and why). Say which reviewer raised it.
7. Offer to save the review with `mcp__fleet__crew_save {"thread": "review-<topic>"}`.
