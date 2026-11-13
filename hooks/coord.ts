// The coordinator: how several FLEET windows share crew threads safely.
//   - a running turn has ONE owner: the window that spawned its helper. Its lease
//     ({ sid, at }) is renewed every few seconds; a lease older than LEASE_TTL means
//     that window is gone.
//   - another window never starts, finishes or resets a thread whose lease is live;
//     to stop it, it leaves `stopAsked` and the owner acts on it.
//   - a thread left "running" by a dead owner is settled as stopped, by anyone.
// Pure rules only; the lock and the store calls live in register.tsx.

import type { CrewThread } from '../types'

/** Seconds without a heartbeat after which an owner window counts as gone. */
export const LEASE_TTL = 45

export type Ownership = 'mine' | 'theirs' | 'dead' | 'none'

/** Who runs a thread right now, from this window's point of view. */
export function ownership(t: CrewThread, self: string, now: number): Ownership {
  if (t.status !== 'running') return 'none'
  const lease = t.lease
  if (!lease) return 'dead'
  if (lease.sid === self) return 'mine'
  return now - lease.at <= LEASE_TTL ? 'theirs' : 'dead'
}

/**
 * Threads left running by a window that is gone become stopped; a live owner's
 * thread is left alone. (Before leases, every stored running thread was reset at
 * startup, even one another window was still running.)
 */
export function settleOrphans(list: readonly CrewThread[], self: string, now: number, mine: ReadonlySet<string>): CrewThread[] {
  return list.map(t => {
    const o = ownership(t, self, now)
    // my own lease without a live run here: this window restarted, the child died with it
    const isOrphan = o === 'dead' || (o === 'mine' && !mine.has(t.name))
    if (!isOrphan) return t
    const { lease: _lease, stopAsked: _stop, ...rest } = t
    return {
      ...rest,
      status: 'idle' as const,
      updated: now,
      turns: t.turns.map(u => (u.status === 'running' ? { ...u, status: 'stopped' as const, ended: now } : u)),
    }
  })
}

/** Whether this window may start a new turn on `t` (another window may be running it). */
export function mayClaim(t: CrewThread | undefined, self: string, now: number): true | string {
  if (!t) return true
  const o = ownership(t, self, now)
  if (o === 'theirs') return `Thread "${t.name}" is running in another FLEET window. Wait for it, or stop it there.`
  if (o === 'mine') return `Thread "${t.name}" is still answering its last message. Wait for it (crew_read) or use another thread.`
  return true
}

/** Threads this window owns that another window asked to stop. */
export const stopsAskedOf = (list: readonly CrewThread[], self: string): string[] =>
  list.filter(t => t.status === 'running' && t.lease?.sid === self && (t.stopAsked ?? 0) > (t.lease?.since ?? 0)).map(t => t.name)
