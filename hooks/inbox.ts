// FLEET's attention inbox: one list of everything that wants the user, shared by
// the Live tab, the band and fleet_read so all three always agree.
//   NEEDS YOU  sessions waiting on the user, crew turns that failed and nobody has seen
//   TO READ    crew answers nobody has seen
//   WORKING    busy sessions, crew threads running
//   QUIET      everything else
// Pure: sessions and threads in, grouped items out.

import type { CrewThread, CrewTurn, Session } from '../types'
import { isBusy, needsYou } from './fmt'

export type Group = 'need' | 'read' | 'work' | 'quiet'

export type Item =
  | { kind: 'session'; group: Group; key: string; s: Session }
  | { kind: 'turn'; group: Group; key: string; t: CrewThread; u: CrewTurn }
  | { kind: 'running'; group: 'work'; key: string; t: CrewThread; u: CrewTurn | undefined }

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
    // only the newest unread turn of a thread: one row per thread
    const unread = [...t.turns].reverse().find(isUnread)
    if (unread) {
      items.push({ kind: 'turn', group: unread.status === 'failed' ? 'need' : 'read', key: `t:${t.name}`, t, u: unread })
    } else if (t.name === keep && last && t.status !== 'running') {
      items.push({ kind: 'turn', group: 'read', key: `t:${t.name}`, t, u: last })
    }
  }
  const order = (x: Item): string =>
    x.kind === 'session' ? `0${String(x.s.startedAt).padStart(14, '0')}${x.s.sid}` : `1${x.t.name}`
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
 * The one headline: the band, Live, the tab badges and fleet_read all say
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

/**
 * The line FLEET puts beside the user's prompt when crew results changed since Claude
 * last looked: fixed words, thread names and counts only, never a helper's own words.
 * `key` fingerprints what it reports, so the same news is never attached twice.
 */
export function statusNews(threads: readonly CrewThread[]): { key: string; text: string } {
  const parts: string[] = []
  const keys: string[] = []
  for (const t of threads) {
    for (const u of t.turns) {
      if (!isUnread(u)) continue
      keys.push(`${t.name}#${u.n}:${u.status}`)
      parts.push(u.status === 'failed' ? `× ${t.name}#${u.n} (${t.agent}) failed` : `◆ ${t.name}#${u.n} (${t.agent}) answered`)
    }
  }
  if (parts.length === 0) return { key: '', text: '' }
  const shown = parts.length > 6 ? [...parts.slice(0, 6), `${parts.length - 6} more`] : parts
  return { key: keys.sort().join('|'), text: `[FLEET] since you last looked: ${shown.join(' · ')}. crew_read {"new": true} reads them.` }
}
