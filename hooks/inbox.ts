// FLEET's attention inbox: one list of everything that wants the user, shared by
// the Live tab, the band and fleet_read so all three always agree.
//   NEEDS YOU  sessions waiting on the user, crew turns that failed and nobody has seen
//   TO READ    crew answers nobody has seen, helper notes waiting for approval
//   WORKING    busy sessions, crew threads running
//   QUIET      everything else
// Pure: sessions, threads and notebooks in, grouped items out.

import type { CrewNote, CrewThread, CrewTurn, Session } from '../types'
import { isBusy, needsYou } from './fmt'

export type Group = 'need' | 'read' | 'work' | 'quiet'

export type Item =
  | { kind: 'session'; group: Group; key: string; s: Session }
  | { kind: 'turn'; group: Group; key: string; t: CrewThread; u: CrewTurn }
  | { kind: 'running'; group: 'work'; key: string; t: CrewThread; u: CrewTurn | undefined }
  | { kind: 'notes'; group: 'read'; key: string; folder: string; count: number }

/** A finished turn nobody has looked at yet (opened in the pane, read by Claude). */
export const isUnread = (u: CrewTurn): boolean => u.unread === true && u.status !== 'running'

const RANK: Record<Group, number> = { need: 0, read: 1, work: 2, quiet: 3 }

/**
 * Everything in attention order. Within a group the order is stable (oldest first
 * for sessions, by name for threads), so rows stay put when a phase changes.
 */
export function inbox(
  sessions: readonly Session[],
  threads: readonly CrewThread[],
  notebooks: Readonly<Record<string, readonly CrewNote[]>>,
  /** a thread opened on Live: it stays listed while open, read or not */
  keep?: string,
): Item[] {
  const items: Item[] = []
  for (const s of sessions) {
    items.push({ kind: 'session', group: needsYou(s) ? 'need' : isBusy(s) ? 'work' : 'quiet', key: `s:${s.sid}`, s })
  }
  for (const t of threads) {
    const last = t.turns[t.turns.length - 1]
    if (t.status === 'running') items.push({ kind: 'running', group: 'work', key: `r:${t.name}`, t, u: last })
    // only the newest unread turn of a thread: one row per thread. Codex changes
    // waiting for accept or discard stay listed after they're read: they're a decision.
    const unread = [...t.turns].reverse().find(u => isUnread(u) || u.delivery?.state === 'pending')
    if (unread) {
      items.push({ kind: 'turn', group: unread.status === 'failed' ? 'need' : 'read', key: `t:${t.name}`, t, u: unread })
    } else if (t.name === keep && last && t.status !== 'running') {
      items.push({ kind: 'turn', group: 'read', key: `t:${t.name}`, t, u: last })
    }
  }
  for (const [folder, notes] of Object.entries(notebooks)) {
    const count = notes.filter(n => n.pending).length
    if (count) items.push({ kind: 'notes', group: 'read', key: `n:${folder}`, folder, count })
  }
  const order = (x: Item): string =>
    x.kind === 'session' ? `0${String(x.s.startedAt).padStart(14, '0')}${x.s.sid}` : x.kind === 'notes' ? `2${x.folder}` : `1${x.t.name}`
  return items.sort((a, b) => RANK[a.group] - RANK[b.group] || order(a).localeCompare(order(b)))
}

/** The counts the band and the Live headline show. */
export function tally(items: readonly Item[]): Record<Group, number> {
  const out: Record<Group, number> = { need: 0, read: 0, work: 0, quiet: 0 }
  for (const x of items) out[x.group]++
  return out
}

export type Segment = { state: 'need' | 'failed' | 'read' | 'work' | 'quiet'; n: number; text: string }

/** Whether an item is a failure: a session that ended on an error, or a helper turn that failed. */
export const isFailure = (x: Item): boolean =>
  (x.kind === 'session' && x.s.phase === 'error') || (x.kind === 'turn' && x.group === 'need' && x.u.status === 'failed')

/**
 * The one headline: the band, Live, the tab badges, the cat and fleet_read all say
 * this, in this order. ▲ needs you · × failed · ◆ to read · ● working, then ○ quiet
 * last (or "○ all quiet" when nothing else shows).
 */
export function segments(items: readonly Item[]): Segment[] {
  const count = tally(items)
  const failed = items.filter(isFailure).length
  const need = count.need - failed
  const out: Segment[] = []
  if (need) out.push({ state: 'need', n: need, text: `${need} need${need === 1 ? 's' : ''} you` })
  if (failed) out.push({ state: 'failed', n: failed, text: `${failed} failed` })
  if (count.read) out.push({ state: 'read', n: count.read, text: `${count.read} to read` })
  if (count.work) out.push({ state: 'work', n: count.work, text: `${count.work} working` })
  if (out.length === 0) out.push({ state: 'quiet', n: count.quiet, text: 'all quiet' })
  else if (count.quiet) out.push({ state: 'quiet', n: count.quiet, text: `${count.quiet} quiet` })
  return out
}

/** The cat's mood from the same headline: alarm on anything that needs you or failed. */
export const moodOf = (items: readonly Item[]): 'alarm' | 'work' | 'sleep' => {
  const s = segments(items)
  return s.some(x => x.state === 'need' || x.state === 'failed') ? 'alarm' : s.some(x => x.state === 'work') ? 'work' : 'sleep'
}
