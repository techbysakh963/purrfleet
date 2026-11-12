# ◆ purrfleet

**FLEET**: a command center for Claude Code that runs inside the terminal, next to the chat.
It shows every Claude Code session on this machine and the subagents each one runs, pins
whichever session is waiting on you, and streams a feed of what they're all doing. It also
estimates what it costs, runs a crew of Codex and Antigravity helpers that Claude can hand
work to, and has a pixel cat that naps, works or panics with the fleet.

> Beta. Built and iterated live inside Claude Code.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install fleet --marketplace techbysakh963/purrfleet
```

From a shell:

```
claude plugin install fleet --marketplace techbysakh963/purrfleet
```

This is a private repository: it installs only for people who can read it on GitHub and whose
machine already holds a git credential for github.com (`gh auth login`, then `gh auth setup-git`).

## Use

- `/crew <message>` talks to the crew from Claude Code's own prompt (full editing, wrapping, paste):
  `/crew new codex|agy <message>` opens a thread, `/crew @thread <message>` picks one, `/crew` lists them.
- Ask Claude **"catch me up"**: its `fleet_read` tool sees what the pane sees, and the
  `fleet-brief` skill answers decisions first, then crew work finished since your last briefing.
- Skills shipped with FLEET: `fleet-brief`, `fleet-review` (Codex and agy review in parallel; Claude
  verifies every finding), `fleet-remember` (notebook or vault), `fleet-handoff` (checkpoint or
  hand work to a helper).
- `/fleet` opens or closes the pane. The band above the prompt is always on.
- `ctrl+x tab` gives the pane the keyboard: `1`–`6` switch tabs, `t` cycles the theme, `a` toggles the cat.
- **Live**: one attention list for the whole fleet, in groups: NEEDS YOU (sessions waiting on
  you, crew turns that failed), TO READ (crew answers nobody has opened, notebook suggestions),
  WORKING (busy sessions, running crew threads), QUIET. Rows hold still inside a group. Press a
  session to expand it, a crew row to open it in Crew. A small cat beside them naps, works or
  panics with the fleet. The band and `fleet_read` show the same list. Nothing starts expanded.
- Every list is one grid: mark · who · what · age. Press a row and its detail opens beneath it
  behind a rail (a session's model, context, cost, folder, recent calls, agents, then copy id ·
  copy folder · open transcript · stop). A crew thread opens to its last answer as SUMMARY,
  KEY POINTS and CONFIDENCE. The band reads like the Live headline and spells out the first thing
  that needs you.
- Crew and notebook rows open in place on Live too: a thread's latest answer (and any Codex
  changes card), or a notebook's suggestions with keep · edit · reject.
- **Cost** is one table on the same grid: this week, today by session and by model (one-colour
  bars), crew usage (not priced), and three machine lines plus a `hot` row when a process runs hot.
- **Colour by role** (v0.13): every colour has one job: ▲ need, × fail, ◆ read, ● work, then ok,
  money, text, dim, faint. State colour appears only in the mark column (plus its rail and the four
  inbox heads). Each theme is checked for contrast: text ≥ 7:1 and marks and dim ≥ 4.5:1 on dark
  backgrounds. A fourth theme, `paper`, is for light terminals.
- **One headline** drives the band, Live, the tab badges, the cat's mood and `fleet_read`: ▲ needs
  you · × failed · ◆ to read · ● working · ○ quiet. A session that stopped on an error is `×`, like a
  failed helper. The band spells out a count of one.
- **Keys**: `/fleet` then Enter opens the most urgent row (it has the focus). An open answer:
  `r` full · `s` send to Claude · `c` copy · `e` earlier turns · `g` open in Crew · `x` stop.
  Codex changes: `v` diff · `p` apply · `d` discard. Feed: `f` filter. A test keeps hotkeys unique.
- One mark per state, everywhere: ▲ needs you · × failed · ◆ to read · ● working · ○ quiet.
  Buttons are plain words; the tab or filter you're on is bold and underlined.
- Notices: threads Claude started that finish together reach Claude as one notice (it waits up to
  3 minutes for a slow sibling). A failed crew turn sends a desktop notification whoever started it;
  your own successful turns show a toast.
- Several windows: FLEET windows share their crew threads (merged, never overwritten) and send each
  desktop notification once for the whole machine.
- **Feed**: every tool call across sessions, grouped, with a 10-minute summary.
- **Crew**: NEW threads (running or unread) on top, the ones you have seen folded under EARLIER. Named, ongoing threads with Codex (`codex exec` / `exec resume`) and Antigravity
  (`agy -p` / `--conversation`), each with its own model, effort and mode. Claude talks to them
  through `crew_ask` / `crew_read`. Every message is wrapped in a brief that asks for a SUMMARY
  first, so Claude reads summaries and pulls full answers on demand. Threads compact themselves into
  a state brief after 10 turns, or after three or more turns once one processed over 600k tokens, and continue fresh. FLEET builds that brief itself from the stored SUMMARY and KEY POINTS when it can, so it costs no extra helper turn (a Codex edit turn used to pay one). Read-only by default;
  edits need your approval (Codex edits in its own git worktree).
- **Claude's tools, built to be cheap.** `crew_ask` takes `agent: "both"` (two threads, one task,
  an angle each through `tasks`) and `depth` (brief · normal · deep) and answers with a one-line
  receipt. `crew_read` returns a digest by default (SUMMARY, KEY POINTS with path:line, CONFIDENCE),
  `{"new": true}` reads every unread answer in one call, and `grep` pulls only matching lines.
  `fleet_read` has `detail` (counts · brief · full) and `scope: "project"`, and lists each crew
  turn once. `crew_note` answers a change in one line. The tool list no longer embeds model
  names, so it is the same every session; an unknown model is refused with the real list.
  `vault_search` finds past findings in the vault (every word, with line numbers); `crew_stop` stops a
  helper Claude started by mistake. `crew_note`, `crew_save`, `vault_search` and `crew_stop` are
  deferred tools, loaded on demand, so they cost nothing in requests that don't use them. A new
  `fleet-delegate` skill says when a helper pays for itself.
- Codex changes: after a Codex edit turn, the thread shows a card with the files it changed
  (+/− per file), **view diff**, **accept into your tree** (asks first; applies with `git apply`,
  never commits) and **discard** (deletes Codex's worktree). Until you decide, it stays on Live.
  `crew_read` tells Claude where the worktree is, so it can inspect the changes; only you decide.
  The card covers everything since the turn began (Codex's own commits too), is made and applied
  from the repository's top folder, and is read with filters, hooks and fsmonitor off and
  attributes taken from the starting commit, so nothing Codex wrote can run while FLEET reads it.
  One Codex edit runs per folder at a time; if two worktrees appear at once, FLEET claims neither.
- Every confirmation takes only its exact answer: a typed reply ("no, explain first") never
  allows an edit, an apply, a discard or a stop.
- **Shared notebook**: per project folder, a short list of durable facts (about 1.5k tokens at
  most) that every helper message carries, so Claude, Codex and Antigravity share what matters
  without re-sending history. Helpers add `NOTE:` lines; Claude curates with `crew_note`.
- **Long-term memory in Obsidian**: a vault (default `~/Desktop/purrfleet-memory`) with a folder
  per project. `notebook.md` mirrors the crew notebook both ways: tick a helper's offer to approve
  it, delete a line to remove it, add a `- [x]` line to pin a fact. Claude saves findings or
  whole threads there with `crew_save`, and attaches a note to one message with
  `crew_ask {"notes": [...]}`: the vault is never sent wholesale.
- **System**: CPU and memory of everything Claude-related (Claude windows, their MCP servers,
  the tools they started, Codex, Antigravity, FLEET), with sparklines and the busiest processes.
- **Cost** and **Actions**: estimated spend, and per-session actions (copy, open transcript, stop).

## How it reads the machine

One collector serves every Claude window: it scans under a lock and the others reuse its snapshot
(fresh for 1.2 s); the full transcript walk runs every 30 s. Read-only: `~/.claude/sessions/*.json`, the Claude Core HUD hook state under
`$XDG_RUNTIME_DIR/claude-hud/`, and transcripts under `~/.claude/projects/`, parsed incrementally
by `bin/fleet_scan.py`. Cost is an estimate at API list prices (`PRICES` in that file).

## Develop

This folder is both the repository and the installed plugin's source (marketplace `purrfleet`,
installed as `fleet@purrfleet`): edit here, then `/reload-plugins` in Claude Code.

- `claude plugin validate .` and `claude plugin test .`
- type-check: `tsc -p .dev/tsconfig.json` (`.dev/` is ignored by git and holds the engine's type
  files copied out of a loaded session)
- `dev/preview-cat.sh` renders the cat's moods to `dev/out/cat.png` from the real module
