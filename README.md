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
- `ctrl+x tab` gives the pane the keyboard: `1`–`5` switch tabs, `t` cycles the theme, `a` toggles the cat.
- **Live**: one calm row per session, needs-you on top; press a row to expand it.
- **Feed**: every tool call across sessions, grouped, with a 10-minute summary.
- **Crew**: jobs for Codex (`codex exec`) and Antigravity (`agy -p`), read-only unless edits are
  switched on (Codex edits in its own git worktree). Claude delegates through the
  `crew_run` / `crew_result` tools and reviews what comes back.
- **Cost** and **Actions**: estimated spend, and per-session actions (copy, open transcript, stop).

## How it reads the machine

Read-only: `~/.claude/sessions/*.json`, the Claude Core HUD hook state under
`$XDG_RUNTIME_DIR/claude-hud/`, and transcripts under `~/.claude/projects/`, parsed incrementally
by `bin/fleet_scan.py`. Cost is an estimate at API list prices (`PRICES` in that file).

## Develop

`dev/preview-cat.sh` renders the cat's moods to `dev/out/cat.png` from the real module.
`claude plugin validate .`, `claude plugin test .`.
