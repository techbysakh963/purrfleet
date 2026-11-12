// FLEET's long-term memory: an Obsidian vault (a folder of markdown files).
//   <vault>/<project>/notebook.md            the crew notebook, synced both ways
//   <vault>/<project>/<date> <title>.md      findings Claude saved for later
// Pure helpers only: paths, the notebook as markdown and back, a findings note.

import type { CrewNote } from '../types'

const BY = new Set(['claude', 'codex', 'agy', 'you'])

/** A file or folder name that can't climb out of the vault or clash with Obsidian. */
export const safeName = (text: string): string =>
  text
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'untitled'

/** A short fingerprint of a full path (FNV-1a), so two projects named alike never share a folder. */
export function pathTag(path: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0').slice(0, 6)
}

/** The vault folder for a project: its folder's name plus a fingerprint of its full path. */
export const projectDir = (vault: string, cwd: string): string =>
  `${vault}/${safeName(cwd.split('/').filter(Boolean).pop() ?? 'project')}-${pathTag(cwd)}`

/** The project a vault note says it belongs to (its `project:` front matter). */
export function projectOf(markdown: string): string | undefined {
  const fm = markdown.match(/^---\n([\s\S]*?)\n---/)
  const line = fm?.[1]?.match(/^project:\s*"?(.*?)"?\s*$/m)
  return line?.[1]
}

export const notebookPath = (vault: string, cwd: string): string => `${projectDir(vault, cwd)}/notebook.md`

const stamp = (epoch: number): string => new Date(epoch * 1000).toISOString().slice(0, 19)

/** The notebook as an Obsidian note: ticked lines are sent to helpers, unticked ones wait. */
export function notebookMarkdown(cwd: string, notes: readonly CrewNote[], now: number): string {
  const name = cwd.split('/').filter(Boolean).pop() ?? 'project'
  return [
    '---',
    `project: "${cwd.replace(/"/g, '')}"`,
    `updated: ${stamp(now)}`,
    'fleet: notebook',
    'tags: [purrfleet, crew-notebook]',
    '---',
    `# ${name} · crew notebook`,
    '',
    'Every message FLEET sends to Codex or Antigravity carries the ticked notes.',
    "Unticked notes are a helper's offers: tick one to approve it. Delete a line to remove it; add a `- [x]` line to pin a fact.",
    '',
    ...notes.map(n => `- [${n.pending ? ' ' : 'x'}] ${n.text.replace(/\n/g, ' ')} — ${n.by} ^n${n.id}`),
    '',
  ].join('\n')
}

/**
 * The notebook read back from the note, after you edited it in Obsidian. Lines
 * keep their ids; a new line is yours and approved when ticked; anything that
 * is not a checklist line is ignored.
 */
export function parseNotebook(markdown: string, now: number): CrewNote[] {
  const out: CrewNote[] = []
  let fresh = Date.now()
  for (const line of markdown.split('\n')) {
    const m = line.match(/^\s*[-*] \[( |x|X)\] (.+?)\s*$/)
    if (!m) continue
    let body = m[2] ?? ''
    const id = body.match(/\s\^n(\d+)$/)
    if (id) body = body.slice(0, id.index).trimEnd()
    const by = body.match(/\s—\s(claude|codex|agy|you)$/)
    if (by) body = body.slice(0, by.index).trimEnd()
    if (!body) continue
    out.push({
      id: id ? Number(id[1]) : ++fresh,
      text: body.slice(0, 400),
      by: by && BY.has(by[1] ?? '') ? (by[1] as CrewNote['by']) : 'you',
      at: now,
      ...(m[1] === ' ' ? { pending: true } : {}),
    })
  }
  return out
}

/** A findings note Claude saves for later. */
export function findingMarkdown(o: {
  title: string
  text: string
  cwd: string
  thread?: string
  agent?: string
  now: number
}): string {
  return [
    '---',
    `project: "${o.cwd.replace(/"/g, '')}"`,
    `saved: ${stamp(o.now)}`,
    ...(o.thread ? [`thread: "${o.thread}"`, `agent: ${o.agent ?? ''}`] : []),
    'fleet: finding',
    'tags: [purrfleet, crew-finding]',
    '---',
    `# ${o.title}`,
    '',
    o.text.trim(),
    '',
  ].join('\n')
}

export const findingPath = (vault: string, cwd: string, title: string, now: number): string =>
  `${projectDir(vault, cwd)}/${stamp(now).slice(0, 10)} ${safeName(title)}.md`

/** Is `path` (already resolved) inside the vault? */
export const isInside = (vault: string, path: string): boolean => path === vault || path.startsWith(`${vault}/`)

export type VaultHit = { path: string; fleet: string; agent: string; lines: { n: number; text: string }[] }

/**
 * Notes where every word of `query` appears (any case), with up to two matching
 * lines each. notebook.md is skipped: it already travels with every helper message.
 */
export function searchNotes(files: readonly { path: string; text: string }[], query: string, limit = 5): VaultHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const hits: (VaultHit & { best: number })[] = []
  for (const f of files) {
    if (/(^|\/)notebook\.md$/.test(f.path)) continue
    const low = f.text.toLowerCase()
    if (!words.every(w => low.includes(w))) continue
    const fm = f.text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    const lines = f.text
      .split('\n')
      .map((text, i) => ({ n: i + 1, text }))
      .filter(l => words.some(w => l.text.toLowerCase().includes(w)) && !/^---$|^[a-z]+:/.test(l.text))
      .sort((a, b) => words.filter(w => b.text.toLowerCase().includes(w)).length - words.filter(w => a.text.toLowerCase().includes(w)).length)
      .slice(0, 2)
      .map(l => ({ n: l.n, text: l.text.trim().slice(0, 160) }))
    const best = Math.max(0, ...lines.map(l => words.filter(w => l.text.toLowerCase().includes(w)).length))
    hits.push({ path: f.path, fleet: fm.match(/^fleet:\s*(\S+)/m)?.[1] ?? '', agent: fm.match(/^agent:\s*(\S+)/m)?.[1] ?? '', lines, best })
  }
  // a line with every word first, then more matching lines, then the newest (notes are named by date)
  return hits
    .sort((a, b) => b.best - a.best || b.lines.length - a.lines.length || b.path.localeCompare(a.path))
    .slice(0, Math.max(1, Math.min(10, limit)))
    .map(({ best: _best, ...h }) => h)
}
