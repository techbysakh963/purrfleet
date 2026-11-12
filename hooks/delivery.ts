// Codex delivery cards: a Codex edit turn works in its own git worktree
// (~/.codex/worktrees/<n>/<repo>, a detached HEAD with uncommitted changes), so its
// edits never touch your tree until you accept them. Pure helpers only: reading
// git's output. The git calls themselves live in register.tsx.

import type { Delivery } from '../types'

/** The worktree paths in `git worktree list --porcelain`. */
export function parseWorktrees(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter(l => l.startsWith('worktree '))
    .map(l => l.slice('worktree '.length).trim())
    .filter(Boolean)
}

/** The worktree a Codex edit turn made: new since `before`, and under Codex's own folder. */
export function newCodexWorktree(before: readonly string[], after: readonly string[], home: string): string | undefined {
  const fresh = after.filter(p => !before.includes(p) && p.startsWith(`${home}/.codex/worktrees/`))
  return fresh[fresh.length - 1]
}

/** Files from `git diff --numstat` (a binary file counts as 0/0). */
export function parseNumstat(text: string): Delivery['files'] {
  return text
    .split('\n')
    .map(l => l.split('\t'))
    .filter(p => p.length >= 3 && p[2])
    .map(([a, r, ...rest]) => ({
      path: rest.join('\t'),
      added: a === '-' ? 0 : Number(a) || 0,
      removed: r === '-' ? 0 : Number(r) || 0,
    }))
}

/** "3 files · +40 −2", or "no changes". */
export function deliveryLine(d: Pick<Delivery, 'files'>): string {
  if (d.files.length === 0) return 'no changes'
  const added = d.files.reduce((n, f) => n + f.added, 0)
  const removed = d.files.reduce((n, f) => n + f.removed, 0)
  return `${d.files.length} file${d.files.length === 1 ? '' : 's'} · +${added} −${removed}`
}
