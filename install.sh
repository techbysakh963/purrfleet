#!/usr/bin/env bash
# FLEET: install or update on this machine in one go.
#   bash <(gh api -H 'Accept: application/vnd.github.raw' repos/techbysakh963/purrfleet/contents/install.sh)
# The repository is private, so the GitHub CLI fetches this script and lets git clone it.
set -euo pipefail
REPO=techbysakh963/purrfleet

say() { printf 'FLEET install: %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { say "$1 is missing. $2" >&2; exit 1; }; }

need claude "Install Claude Code first: https://claude.com/claude-code"
need git "Install git (sudo apt install git)."
need python3 "Install Python 3 (sudo apt install python3); the dashboard's scanner needs it."
need gh "Install the GitHub CLI (https://cli.github.com), then run: gh auth login"
gh auth status >/dev/null 2>&1 || { say "run 'gh auth login' first: the repository is private." >&2; exit 1; }
gh auth setup-git # lets git (and so Claude Code) clone the private repository

if claude plugin list 2>/dev/null | grep -q 'fleet@purrfleet'; then
  say "already installed; updating."
  claude plugin marketplace update purrfleet
  claude plugin update fleet@purrfleet
else
  # HTTPS, not SSH: gh's sign-in covers it, and a new machine may have no SSH key
  claude plugin marketplace add "https://github.com/$REPO.git"
  claude plugin install fleet@purrfleet
fi

for helper in codex agy; do
  command -v "$helper" >/dev/null 2>&1 || say "optional: '$helper' isn't installed; the crew works with whichever helpers are present."
done
say "done. In a running Claude Code session type /reload-plugins (or start a new one), then /fleet."
