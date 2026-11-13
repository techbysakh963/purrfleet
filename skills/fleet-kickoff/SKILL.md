---
name: fleet-kickoff
description: Turn a project idea into a ready-to-build project folder. Claude drafts the spec, Codex challenges it over a few rounds until the details are settled, then Claude writes every doc fleet-build needs (SPEC.md, PLAN.md, CLAUDE.md, DECISIONS.md) and starts the build. Use when the user says "I want to make…", "new project", "start a project", "plan this app", "kickoff", or gives a one-line idea to build.
---

# Fleet kickoff

Claude is the author and the lead; Codex is the critic who finds what's missing. Codex is read-only, so Claude writes every file and Codex reads them in the project folder. The user decides scope; Claude decides everything technical.

## 1. Pin the idea (one question round)

From the user's idea, ask **one** AskUserQuestion with at most 4 questions, each with a recommended option first. Only what changes the build:
- who it's for and the one job it does
- form: CLI, web page, desktop GUI, service, library (and platform)
- the must-have features (multi-select) and what is explicitly out
- anything that must not happen (network, deleting files, cost, privacy)

Don't ask what you can decide well yourself (language, structure, test tool): decide it and say so.

## 2. Create the folder

`~/Desktop/<short-kebab-name>` (refuse to reuse a folder that has content; pick another name). `git init -b main`.

## 3. Draft SPEC.md (the contract)

Precise enough that two people would build the same thing and a test could check it:
- **Goal**: one sentence. **Users**: who.
- **Interface**: every command / screen / endpoint, every option with its default, exit codes or error states.
- **Behaviour**: rules with the edge cases spelled out (empty input, huge input, odd names, broken data, time zones, ties). Lesson from the A/B test: the one place the two builds disagreed was a case the spec didn't cover.
- **Output formats** exactly (JSON shape, file names).
- **Threat model**: who can feed it bad input and what must never happen. Hardening beyond it is out of scope (reviewers keep asking for more otherwise).
- **Done when**: checks a machine can run, including one on real data, not only fixtures.
- **Out of scope**.
- For anything visual: the feel, the sizes it must work at, accessibility (keyboard, reduced motion). Leave the creative concept to the build.

## 4. The debate with Codex (2–3 rounds)

One thread, `<name>-spec`, `agent: "codex"`, `folder` = the project folder, `effort: "high"`, `depth: "normal"`.

Round 1 task:
> Read SPEC.md in this folder. You are the critic before anyone builds. List: (a) ambiguities: places two builders would do different things; (b) missing edge cases; (c) "Done when" items that can't be checked by a machine; (d) threat-model gaps; (e) anything that is over-scoped for the goal. Each as `S<n> [blocking|important|nice] — section — problem — your proposed wording`. Say "NO BLOCKING ISSUES" if there are none.

Then end your turn; FLEET's notice brings the answer. Read it with `crew_read {"thread": "<name>-spec", "part": "full"}`.

For each point: accept (edit SPEC.md), or reject with a reason. Never accept something that changes scope without asking the user. Write both into DECISIONS.md:

```markdown
## Spec round 1
- S1 accepted — <change>
- S3 rejected — <reason>
```

Round 2+: same thread (Codex remembers), task: "SPEC.md is revised; DECISIONS.md says what changed and why. Check the revisions and anything still open. Same format." Stop when Codex says NO BLOCKING ISSUES, or after round 3 (list what's left open in DECISIONS.md and decide it yourself).

## 5. PLAN.md, then one plan check

Write PLAN.md in fleet-build's format: Goal, Done when, Stack, Out of scope; 5–10 small steps that each end in something testable; `M  milestone review` after every 3–4 steps; `F  final review`; an empty `## Log`. Order: risky and core first, polish last; the first step proves the hardest part works.

Send Codex one message on the same thread: "Read PLAN.md against SPEC.md: steps missing, wrong order, too big to finish and test in one sitting? Same format, P<n>." Apply what holds, note it in DECISIONS.md.

## 6. CLAUDE.md for the project

Short rules any session in this folder follows: what the project is (point to SPEC.md as the contract), how to run it and its tests, code conventions you chose, "build by working PLAN.md with fleet-build", and the threat model's one-line version. Codex and agy are pointed to this file automatically.

## 7. Hand over

Commit everything (`kickoff: spec, plan, decisions`). Show the user, in a few lines: what will be built, the main decisions from the debate (and anything rejected), the step list. Then ask to start. On yes, start the build in this session with the `loop` skill, no interval:

`/loop /fleet:fleet-build work the next unchecked item in PLAN.md, following CLAUDE.md. The plan is approved, start building.`

Or, if the user prefers a fresh session: tell them to `cd` into the folder, run `claude`, switch to auto mode (Shift+Tab), and paste that line.
