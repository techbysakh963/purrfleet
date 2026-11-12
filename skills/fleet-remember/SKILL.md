---
name: fleet-remember
description: Save knowledge for the whole crew. Pin a durable fact to the shared notebook every helper receives, or save a decision or finding to the Obsidian vault. Use when the user says "remember that…", "pin this", "save this to memory", "note for the crew", or when a decision settles that future helpers must know.
---

# Remember for the crew

FLEET has two kinds of memory. Pick the right one.

- **Shared notebook** (`mcp__fleet__crew_note`): a few short, durable facts that every message to Codex and Antigravity carries, about 1.5k tokens in all. Use it for facts that stay true and that every helper needs: "tests run with vitest", "staging DB is Postgres 16 on 5433".
- **Vault** (`mcp__fleet__crew_save`): longer notes in the user's Obsidian vault, never sent automatically. Use it for decisions with their reasons, investigation results, and whole crew threads.

Steps:
1. Decide which kind it is. If it's longer than one line, or only matters sometimes, it goes to the vault.
2. Notebook: `mcp__fleet__crew_note {"add": "<one line, specific, no dates or session names>"}`. First list the notebook (`crew_note` with no arguments) to avoid duplicates, and remove anything the new fact makes outdated.
3. Vault: `mcp__fleet__crew_save {"title": "<short title>", "text": "<markdown: what was decided, why, evidence (path:line), open questions>"}`, or `{"thread": "<name>"}` to save a whole crew conversation.
4. Pending helper suggestions: when `crew_note` lists notes as PENDING, check each against the code before approving it (`{"approve": id}`). Remove anything wrong or outdated (`{"remove": id}`).
5. Tell the user in one line what you saved and where.
