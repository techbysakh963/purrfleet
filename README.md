# ◆ purrfleet

**FLEET**: a command center for Claude Code that runs inside the terminal, next to the chat.
It shows every Claude Code session on this machine and the subagents each one runs, pins
whichever session is waiting on you, and runs a crew of Codex and Antigravity helpers that
Claude can hand read-only work to: second opinions, broad reads, and two-helper reviews.

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

- `/fleet` opens or closes the pane. The band above the prompt is always on.
- `ctrl+x tab` gives the pane the keyboard: `1`–`3` switch tabs (Live · Crew · Actions).
- `/crew <message>` talks to the crew from Claude Code's own prompt (full editing, wrapping, paste):
  `/crew new codex|agy <message>` opens a thread, `/crew @thread <message>` picks one, `/crew` lists them.
- Ask Claude **"catch me up"**: its `fleet_read` tool sees what the pane sees, and the
  `fleet-brief` skill answers decisions first, then crew work finished since your last briefing.
- Skills shipped with FLEET: `fleet-brief`, `fleet-review` (Codex and agy review in parallel; Claude
  verifies every finding), `fleet-delegate` (when a helper pays for itself), `fleet-handoff`
  (checkpoint, or hand work to a helper).

### The pane

- **Live**: one attention list for the whole fleet, in groups: NEEDS YOU (sessions waiting on
  you, crew turns that failed), TO READ (crew answers nobody has opened), WORKING (busy sessions,
  running crew threads), QUIET. Rows hold still inside a group. Nothing starts expanded. The band
  and `fleet_read` show the same list.
- Every list is one grid: mark · who · what · age. Press a row and its detail opens beneath it
  behind a rail (a session's model, context, cost, folder, recent calls, agents, then copy id ·
  copy folder · open transcript · stop). A crew row opens to its last answer as SUMMARY, KEY POINTS
  and CONFIDENCE.
- One mark per state, everywhere: ▲ needs you · × failed · ◆ to read · ● working · ○ quiet. A
  session that stopped on an error is `×`, like a failed helper. The band spells out a count of one.
- **Crew**: NEW threads (running or unread) on top, the ones you have seen folded under EARLIER.
  `g` picks the helper, `n` a new thread, `o` the options (model · folder · effort).
- **Actions**: the crew-news setting and the full guide (`/fleet help`).
- **Keys** on an open answer: `r` full · `s` send to Claude · `c` copy · `e` earlier turns · `g`
  open in Crew · `x` stop. A test keeps hotkeys unique.

### The crew

- Named, ongoing threads with Codex (`codex exec` / `exec resume`, sandbox read-only) and
  Antigravity (`agy -p` / `--conversation`, plan mode). Helpers are **always read-only**: they
  investigate and report; you or Claude make the changes.
- Every message is wrapped in a brief that asks for SUMMARY, KEY POINTS and CONFIDENCE first, so
  Claude reads digests and pulls full answers on demand. Threads compact themselves into a state
  brief after 10 turns (or three turns once one processed over 600k tokens); FLEET builds that
  brief from the stored answers when it can, so it costs no extra helper turn.
- **Claude's tools**: `crew_ask` (`agent: "both"` with an angle each in `tasks`; `depth` brief ·
  normal · deep; a one-line receipt), `crew_read` (a digest by default; `{"new": true}` reads every
  unread answer at once; `grep` pulls matching lines), `crew_review` (Codex and agy review a change
  in parallel with complementary focus; one merged finding list), `crew_stop` (deferred), and
  `fleet_read` (`detail` counts · brief · full, `scope: "project"`).
- **Notices**: threads Claude started that finish together reach Claude as one notice (it waits up
  to 3 minutes for a slow sibling). A failed crew turn sends a desktop notification; your own
  successful turns show a toast.
- **Crew news for Claude**: when a helper answered or failed since Claude last looked, one line
  rides along with your next typed prompt, which only the model reads. Fixed words and thread names
  only, never a helper's own text, never twice. Actions turns it off.
- One FLEET window drives a thread at a time. Saving keeps threads another window opened; a turn
  left running when a window closes is marked stopped the next time FLEET starts.

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
