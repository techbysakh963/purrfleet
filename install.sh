#!/usr/bin/env bash
# FLEET: install or update on this machine in one go.
#   curl -fsSL https://raw.githubusercontent.com/techbysakh963/purrfleet/main/install.sh | bash
set -euo pipefail
REPO=techbysakh963/purrfleet

say() { printf 'FLEET install: %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { say "$1 is missing. $2" >&2; exit 1; }; }

need claude "Install Claude Code first: https://claude.com/claude-code"
need git "Install git (sudo apt install git)."
need python3 "Install Python 3 (sudo apt install python3); the dashboard's scanner needs it."

# </dev/null: piped through bash, stdin is this script; claude must not read it
if claude plugin list </dev/null 2>/dev/null | grep -q 'fleet@purrfleet'; then
  say "already installed; updating."
  claude plugin marketplace update purrfleet </dev/null
  claude plugin update fleet@purrfleet </dev/null
else
  # HTTPS, not SSH: works on a machine with no SSH key or GitHub account
  claude plugin marketplace add "https://github.com/$REPO.git" </dev/null
  claude plugin install fleet@purrfleet </dev/null
fi

for helper in codex agy; do
  command -v "$helper" >/dev/null 2>&1 || say "optional: '$helper' isn't installed; the crew works with whichever helpers are present."
done
say "done. In a running Claude Code session type /reload-plugins (or start a new one), then /fleet."
