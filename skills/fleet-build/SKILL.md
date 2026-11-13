---
name: fleet-build
description: Build a project in a self-paced loop from a PLAN.md, with Codex and Antigravity as reviewers at fixed checkpoints. Use when the user says "build this from the plan", "work through PLAN.md", "loop until it's done", "fleet-build", or gives a project goal and wants Claude to keep going on its own.
---

# Fleet build

Claude is the lead and builds; the crew reviews at fixed checkpoints. One iteration = one plan item.

## 0. The plan (once)

If the project folder has no `PLAN.md`, write one with the user and get a yes before building:

```markdown
# <name>
Goal: <one sentence: what it does for the user>
Done when: <checks a machine can run: tests pass, `<cmd>` prints …>
Stack: <language, no-dependency preference, where it installs>
Out of scope: <what NOT to build>

## Steps
- [ ] 1. … (small: one sitting, ends in something testable)
- [ ] M  milestone review          ← after every 3–4 steps
- [ ] …
- [ ] F  final review

## Log
```

Then start the loop with the `loop` skill, no interval (self-paced): `work the next unchecked item in <folder>/PLAN.md, following fleet-build`.

## 1. Each iteration

1. Read `PLAN.md`; take the **first** unchecked item. Nothing left → go to 3.
2. Build it. Small, test first where it fits. Run the project's checks.
3. Tick it `[x]`, add one line to `## Log` (what was done, anything learned), commit `step N: …`.
4. Schedule the next iteration. Short delay while work remains; never poll a helper.

## 2. When the crew comes in (fixed rules, not "whenever")

| Moment | Call | Then |
|---|---|---|
| An architecture choice that is hard to undo (data model, parser, storage) | `crew_ask` agent `codex`, depth `brief` | keep building what doesn't depend on it; decide when it answers |
| Milestone item `M` | `crew_review` `target: branch:<sha of the last commit before this stretch>`, `folder` = the project (a range like `a^..HEAD` is refused) | read with `crew_read {"new": true}` |
| The same failure twice | `crew_ask` `both`: the error, what you tried, the file | try their best idea once |
| Final item `F` | `crew_review` `branch:<sha of the last milestone commit>`: only what no review has seen yet. The diff is cut at 30,000 characters; if the stretch is bigger, review it in parts with `files:<a,b>` | fix, re-run Done-when checks |

- Write the commit and Log line for a review only **after** its receipt comes back; a failed send is logged as failed.
- Put the threat model in the plan (who could feed the tool bad input). Reviewers will keep asking for hardening; once the plan's threat model is covered, further hardening is out of scope.

- **Code only.** The crew reviews code, never visuals or design taste: in the A/B test, crew design critiques cost the most time and were mostly rejected, while code reviews found real bugs. Critique your own screenshots instead.
- **Never wait idle on the crew.** Send, continue the next independent item, read the notice when it comes.
- **Verify every finding yourself** against the code before fixing. Rejected ones go in the Log with one reason.
- Fixes from a review are their own commit: `review M2: fix F1, F3`.

## 3. Stop and ask the user (don't guess)

- a choice that changes what the user gets (scope, UX, anything in "Out of scope")
- deleting or overwriting anything outside the project folder
- the same item fails 3 times even after the crew's ideas
- Done-when checks pass: report what was built, the review findings fixed/rejected, how to use it. End the loop.

Write the question as the last line of the Log too, so it survives the session.
