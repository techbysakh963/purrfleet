// What fleet_read tells Claude: the fleet as the pane shows it, in a compact text
// shaped for a briefing. Decisions first, then what finished since the last
// briefing, then what is still running. Pure: snapshot and threads in, text out.

import type { CrewThread, Snapshot } from '../types'
import { UNTRUSTED, summaryOf } from './crew'
import { activity, ago, isBusy, needsYou, usd } from './fmt'

export type BriefInput = {
  snap: Snapshot | null
  threads: readonly CrewThread[]
  /** epoch seconds of the last briefing; finished work after it is "new" */
  since: number
  now: number
  pendingNotes: number
  self: string
}

export function fleetReport(b: BriefInput): string {
  const out: string[] = []
  if (!b.snap) return 'FLEET has no snapshot yet: its collector has not answered. Try again in a few seconds.'
  const s = b.snap
  const age = Math.max(0, Math.round(b.now - s.now))
  out.push(
    `FLEET · ${s.sessions.length} Claude session${s.sessions.length === 1 ? '' : 's'} · data ${age}s old${age > 6 ? ' (STALE: the collector may have stopped)' : ''}` +
      (b.since ? ` · "new" means since the last briefing ${ago(b.now - b.since)} ago` : ''),
  )

  const need = s.sessions.filter(needsYou)
  out.push('', `NEEDS YOU (${need.length})`)
  if (need.length === 0) out.push('- nothing is waiting on the user')
  for (const x of need) {
    out.push(`- ${x.name}${x.sid === b.self ? ' (this session)' : ''}: ${activity(x)} · ${ago(b.now - x.phaseSince)} · ${x.cwd}`)
  }

  const finished = b.threads
    .flatMap(t => t.turns.map(u => ({ t, u })))
    .filter(({ u }) => u.status !== 'running' && (u.ended ?? 0) > b.since)
    .sort((x, y) => (y.u.ended ?? 0) - (x.u.ended ?? 0))
  out.push('', `CREW FINISHED${b.since ? ' SINCE LAST BRIEFING' : ''} (${finished.length})`)
  if (finished.length === 0) out.push('- none')
  else out.push(`(${UNTRUSTED})`)
  for (const { t, u } of finished.slice(0, 8)) {
    out.push(
      `- ${t.name} · ${t.agent} · turn ${u.n} · ${u.status} ${ago(b.now - (u.ended ?? b.now))} ago: ${summaryOf(u.answer).slice(0, 220) || '(no answer)'}`,
    )
  }

  const busy = s.sessions.filter(x => isBusy(x) && !needsYou(x))
  const crewRunning = b.threads.filter(t => t.status === 'running')
  out.push('', `RUNNING (${busy.length} session${busy.length === 1 ? '' : 's'}, ${crewRunning.length} crew)`)
  for (const x of busy) {
    out.push(`- ${x.name}${x.sid === b.self ? ' (this session)' : ''}: ${activity(x)}${x.agents.length ? ` · ${x.agents.length} subagent(s)` : ''} · ${x.cwd}`)
  }
  for (const t of crewRunning) {
    const last = t.turns[t.turns.length - 1]
    out.push(`- crew ${t.name} · ${t.agent}: ${last?.log[last.log.length - 1] ?? 'working'} · ${ago(b.now - (last?.started ?? b.now))}`)
  }
  if (busy.length === 0 && crewRunning.length === 0) out.push('- nothing is running')

  const idle = s.sessions.filter(x => !isBusy(x) && !needsYou(x))
  if (idle.length) out.push('', `IDLE: ${idle.map(x => x.name).join(', ')}`)
  const failed = b.threads.filter(t => t.status === 'failed')
  if (failed.length) out.push(`CREW FAILED: ${failed.map(t => t.name).join(', ')}`)

  out.push(
    '',
    `COST today ${usd(s.cost.today)} (an estimate at API list prices) · cache hit ${Math.round(s.cost.cacheHit * 100)}%`,
  )
  if (b.pendingNotes) out.push(`NOTEBOOK: ${b.pendingNotes} helper suggestion(s) waiting for approval`)
  return out.join('\n')
}
