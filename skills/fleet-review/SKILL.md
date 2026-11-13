---
name: fleet-review
description: Review a change with the crew. Codex and Antigravity review in parallel and Claude verifies every finding before reporting. Use when the user asks to "review this with the crew", "get a second opinion", "have codex and agy look at this diff", or before merging something significant.
---

# Crew review

Run independent reviews on Codex and Antigravity, then act as the lead: verify, deduplicate, and report only what holds up.

1. **Pin down the target and intent.** Which change (uncommitted work, staged, a branch against its base, a commit, or named files) and what it is meant to do. If it's unclear, ask one question.
2. **One call:** `mcp__fleet__crew_review` with `intent`, `target` (`working` by default, or `staged`, `branch:<base>`, `commit:<sha>`, `files:<a,b>`), and `focus` if one area matters most. FLEET works out the diff, hands it to Codex (correctness, edge cases, concurrency, missing tests) and Antigravity (interface, naming, consistency), and asks for findings as `F<n> [high|med|low] path:line — claim — failure scenario`.
3. **Keep working** while they run. You get one notice when both are done.
4. **Read once:** `mcp__fleet__crew_read {"new": true}` shows one merged list: the same file within 5 lines counts once and names both reviewers. For one finding's detail, `{"thread": "<topic>-codex", "grep": "F2"}`.
5. **Verify every finding yourself** against the current code. Two reviewers agreeing is not verification. Drop anything you can't reproduce or point to in the code.
6. **Report** one list, most severe first: finding, file:line, why it matters, your verification (confirmed / plausible / rejected and why), and who raised it.

For a review that needs a custom brief (not a diff), use `mcp__fleet__crew_ask` with `agent: "both"` and an angle each in `tasks`.
