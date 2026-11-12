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

- `/fleet` opens or closes the pane. The band above the prompt is always on.
- `ctrl+x tab` gives the pane the keyboard: `1`–`6` switch tabs, `t` cycles the theme, `a` toggles the cat.
- **Live**: one calm row per session, needs-you on top; press a row to expand it.
- **Feed**: every tool call across sessions, grouped, with a 10-minute summary.
- **Crew**: named, ongoing threads with Codex (`codex exec` / `exec resume`) and Antigravity
  (`agy -p` / `--conversation`), each with its own model, effort and mode. Claude talks to them
  through `crew_ask` / `crew_read`. Every message is wrapped in a brief that asks for a SUMMARY
  first, so Claude reads summaries and pulls full answers on demand. Threads over ~120k tokens
  of context compact themselves into a state brief and continue fresh. Read-only by default;
  edits need your approval (Codex edits in its own git worktree).
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

Read-only: `~/.claude/sessions/*.json`, the Claude Core HUD hook state under
`$XDG_RUNTIME_DIR/claude-hud/`, and transcripts under `~/.claude/projects/`, parsed incrementally
by `bin/fleet_scan.py`. Cost is an estimate at API list prices (`PRICES` in that file).

## Develop

This folder is both the repository and the installed plugin's source (marketplace `purrfleet`,
installed as `fleet@purrfleet`): edit here, then `/reload-plugins` in Claude Code.

- `claude plugin validate .` and `claude plugin test .`
- type-check: `tsc -p .dev/tsconfig.json` (`.dev/` is ignored by git and holds the engine's type
  files copied out of a loaded session)
- `dev/preview-cat.sh` renders the cat's moods to `dev/out/cat.png` from the real module
