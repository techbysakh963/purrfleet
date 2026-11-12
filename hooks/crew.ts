// FLEET's crew: other coding agents on this machine that Claude (or you) can
// hand a job to. Pure helpers only: how each agent is started, how its output
// is kept and summarised. The runner lives in register.tsx.

import type { CrewAgent, CrewJob, CrewMode } from '../types'

export const AGENTS: { id: CrewAgent; label: string }[] = [
  { id: 'codex', label: 'Codex' },
  { id: 'agy', label: 'Antigravity' },
]

/** The command line for a job. Read-only unless the job was started with edits allowed. */
export function argvFor(agent: CrewAgent, mode: CrewMode, task: string, cwd: string): string[] {
  if (agent === 'codex') {
    return mode === 'edit'
      ? // edits land in a fresh git worktree, so they stay apart from your tree until accepted
        ['codex', 'exec', '--skip-git-repo-check', '--worktree', '-s', 'workspace-write', '-C', cwd, task]
      : ['codex', 'exec', '--skip-git-repo-check', '-s', 'read-only', '-C', cwd, task]
  }
  return ['agy', '-p', task, '--mode', mode === 'edit' ? 'accept-edits' : 'plan']
}

export const modeLabel = (agent: CrewAgent, mode: CrewMode): string =>
  mode === 'read' ? (agent === 'agy' ? 'plan mode' : 'read-only') : agent === 'codex' ? 'edits · worktree' : 'edits in place'

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g
const OUTPUT_CAP = 60_000

/** Folds a chunk of a child's output into the job: full text (capped) and its last lines. */
export function absorb(job: CrewJob, stream: 'stdout' | 'stderr', text: string): CrewJob {
  const clean = text.replace(ANSI, '').replace(/\r/g, '')
  const output = stream === 'stdout' ? (job.output + clean).slice(-OUTPUT_CAP) : job.output
  const log = (job.log + clean).slice(-OUTPUT_CAP)
  const tail = log
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .slice(-3)
  return { ...job, output, log, tail }
}

/** What Claude reads from crew_result: status first, then the answer (or the log when there is none). */
export function report(job: CrewJob, now: number): string {
  const secs = Math.round(((job.ended ?? now) - job.started) / 1)
  const head = [
    `Crew job #${job.id} · ${job.agent} · ${modeLabel(job.agent, job.mode)} · ${job.status} after ${secs}s`,
    `Task: ${job.task}`,
    `Folder: ${job.cwd}`,
    job.code !== null && job.code !== undefined ? `Exit code: ${job.code}` : '',
  ].filter(Boolean)
  const body = job.output.trim() || job.log.trim() || '(no output yet)'
  const tail = body.length > 20_000 ? `…(earlier output cut)\n${body.slice(-20_000)}` : body
  return `${head.join('\n')}\n\n${tail}`
}

export function listing(jobs: readonly CrewJob[]): string {
  if (jobs.length === 0) return 'No crew jobs yet.'
  return jobs
    .slice(-12)
    .reverse()
    .map(j => `#${j.id} ${j.agent} ${j.status} (${modeLabel(j.agent, j.mode)}, by ${j.by}): ${j.task.slice(0, 90)}`)
    .join('\n')
}
