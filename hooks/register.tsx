import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { CrewAgent, CrewThread, CrewTurn, Session, Snapshot, Tab } from '../types'
import { needsYou } from './fmt'
import {
  COMPACT_PROMPT,
  EFFORTS,
  argvFor,
  answersRoot, batchNotice, stillUnread,
  brief,
  digest,
  findingsIn,
  localBrief,
  mergeFindings,
  reviewDigest,
  reviewTask,
  sections,
  grepAnswer,
  receipt,
  UNTRUSTED,
  capAnswer,
  lines,
  mergeThreads,
  listing,
  modeLabel,
  needsCompaction,
  parseLine,
  report,
  settleRunning,
  RULES_FILES,
  rulesFor,
  slug,
  threadLine,
} from './crew'
import { PALETTE } from './theme'
import { fleetReport } from './brief'
import { inbox, isUnread, statusNews } from './inbox'
import type { Depth, Part } from './crew'
import { Band, Pane } from './views'
import type { Acts } from './views'

const PANE = 'fleet'
const POLL_MS = 1500
const palette = PALETTE

// A new tag makes a reload decline what an older shape stored.
const snap = atom({ plugin: 'fleet', key: 'snap' } as const, null, { shape: 'snap-2' })
const error = atom({ plugin: 'fleet', key: 'error' } as const, null)
const tab = atom({ plugin: 'fleet', key: 'tab' } as const, 'live')
const selected = atom({ plugin: 'fleet', key: 'selected' } as const, null)
const threads = atom({ plugin: 'fleet', key: 'threads' } as const, [], { shape: 'threads-1' })
const crewSel = atom({ plugin: 'fleet', key: 'crewSel' } as const, null)
const crewAgent = atom({ plugin: 'fleet', key: 'crewAgent' } as const, 'codex')
const crewModel = atom({ plugin: 'fleet', key: 'crewModel' } as const, 'default')
const crewEffort = atom({ plugin: 'fleet', key: 'crewEffort' } as const, 'default')
const crewModels = atom({ plugin: 'fleet', key: 'crewModels' } as const, { codex: [], agy: [] })
const crewFolder = atom({ plugin: 'fleet', key: 'crewFolder' } as const, null)
const crewOpenTurn = atom({ plugin: 'fleet', key: 'crewOpenTurn' } as const, null)
const crewDraft = atom({ plugin: 'fleet', key: 'crewDraft' } as const, '')
// bumped after each send: a fresh, empty field (the field owns its text while you type)
const crewOptions = atom({ plugin: 'fleet', key: 'crewOptions' } as const, false)
const toured = atom({ plugin: 'fleet', key: 'toured' } as const, true)
const crewShowAll = atom({ plugin: 'fleet', key: 'crewShowAll' } as const, false)
const crewAllTurns = atom({ plugin: 'fleet', key: 'crewAllTurns' } as const, null)
const crewInputGen = atom({ plugin: 'fleet', key: 'crewInputGen' } as const, 0)
const statusLine = atom({ plugin: 'fleet', key: 'statusLine' } as const, true)
// what the last status line (or a crew_read / fleet_read) already told Claude; in $.state,
// so a /reload-plugins doesn't make FLEET repeat news Claude already has
const statusTold = atom({ plugin: 'fleet', key: 'statusTold' } as const, '')

// Module variables start over on a reload; everything drawn lives in $.state.
let self = ''
let isPolling = false
let alerted = new Set<string>()
let sessionCwd = ''
let answersDir = '' // full helper answers, kept apart from the trimmed thread state
let lastOk = Date.now() // when the collector last answered
// the children of running crew turns, by thread; leaving a loop (return) kills its child
const running = new Map<string, AsyncIterator<unknown, unknown>>()
// the run that owns each thread right now; a stop revokes it, and a revoked run
// may neither start a child nor write the thread again
const owner = new Map<string, number>()
let runSeq = 0

const now = (): number => Date.now() / 1000

async function poll($: EngineInterface): Promise<void> {
  if (isPolling) return
  isPolling = true
  try {
    const run = await $.process.run(['python3', '-I', `${$.plugin.root}/bin/fleet_scan.py`], {
      timeoutMs: 20_000,
    })
    if (run.exitCode !== 0) {
      await update($, error, () => `collector exited ${run.exitCode}: ${run.stderr.slice(-300)}`)
      return
    }
    const next = JSON.parse(run.stdout) as Snapshot
    lastOk = Date.now()
    await update($, snap, () => next)
    await update($, error, () => null)
    await alertOnNew($, next.sessions)
  } catch (e) {
    await update($, error, () => `collector failed: ${String(e).slice(0, 300)}`)
  } finally {
    isPolling = false
  }
}

// One desktop notification per session each time it starts needing you; open FLEET
// windows record what they told in the store, so the user mostly hears it once.
async function alertOnNew($: EngineInterface, sessions: Session[]): Promise<void> {
  const fresh = new Set<string>()
  const due: Session[] = []
  for (const s of sessions.filter(needsYou)) {
    const key = `${s.sid}:${s.phase}:${s.phaseSince}`
    fresh.add(key)
    if (!alerted.has(key) && s.sid !== self) due.push(s)
  }
  alerted = fresh
  if (due.length === 0) return
  await claimAlerts($, due).catch(() => undefined)
}

/** Notify each session once, recording it in the store for the other windows. */
async function claimAlerts($: EngineInterface, due: readonly Session[]): Promise<void> {
  const saved = await $.store.get('alerted').catch(() => undefined)
  const claimed: Record<string, number> = saved && typeof saved === 'object' ? { ...(saved as Record<string, number>) } : {}
  const t = now()
  for (const k of Object.keys(claimed)) if (!(t - (claimed[k] ?? 0) < 86_400)) delete claimed[k]
  for (const s of due) {
    const key = `${s.sid}:${s.phase}:${s.phaseSince}`
    if (claimed[key]) continue // another window told the user already
    claimed[key] = t
    void $.ui.notify(
      s.phase === 'error' ? `${s.name}: the turn ended on an error` : `${s.name} is waiting for you`,
      { title: 'FLEET', key: `fleet-${s.sid}` },
    )
  }
  await $.store.set('alerted', claimed).catch(() => undefined)
}

/** A collector that stopped answering is said out loud, not left looking current. */
async function watchdog($: EngineInterface): Promise<void> {
  const age = Math.round((Date.now() - lastOk) / 1000)
  if (age > 6) await update($, error, () => `the collector hasn't answered for ${age}s; what you see may be out of date`)
}

async function isPaneShown($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE && p.isShown)
}

async function stopSession($: EngineInterface, s: Session): Promise<void> {
  const answer = await $.ui.ask(`Stop "${s.name}" (pid ${s.pid})?`, {
    header: 'FLEET',
    options: ['Interrupt its current turn', 'End the session', 'Cancel'],
  })
  const signal = answer === 'Interrupt its current turn' ? '-INT' : answer === 'End the session' ? '-TERM' : null
  if (signal === null) return
  const run = await $.process.run(['kill', signal, String(s.pid)])
  $.ui.toast(run.exitCode === 0 ? `Sent ${signal.slice(1)} to ${s.name}` : `kill failed: ${run.stderr.trim()}`)
  void poll($)
}

async function copyText($: EngineInterface, text: string, what: string): Promise<void> {
  const r = await $.ui.copy({ text })
  $.ui.toast(r.isCopied ? `Copied ${what}` : `Couldn't copy (${r.reason})`)
}

async function openPath($: EngineInterface, path: string): Promise<void> {
  await $.process.run(['xdg-open', path], { timeoutMs: 5000 }).catch(() => $.ui.toast(`Couldn't open ${path}`))
}


// ── git, for crew_review: nothing in it that executes (no fsmonitor, hooks,
// external diff, textconv, system config) ───────────────────────────────────
const SAFE_GIT = [
  '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.untrackedCache=false',
  '-c', 'core.pager=cat',
  '-c', 'protocol.allow=never',
] as const

const git = ($: EngineInterface, args: readonly string[]) =>
  $.process.run(['git', ...SAFE_GIT, ...args], {
    timeoutMs: 30_000,
    env: { GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
  })

/** A git answer, or why there is none: a failed or cut-off output is never taken as whole. */
type GitOut = { ok: true; out: string } | { ok: false; why: string }
const gitOut = async ($: EngineInterface, args: readonly string[]): Promise<GitOut> => {
  const r = await git($, args).catch((e: unknown) => ({ exitCode: -1, stdout: '', stderr: String(e), isStdoutTruncated: false }))
  if (r.exitCode !== 0) return { ok: false, why: r.stderr.trim().split('\n')[0] || `git exited ${r.exitCode}` }
  if (r.isStdoutTruncated) return { ok: false, why: 'the change is too large to read whole (over 4 MB)' }
  return { ok: true, out: r.stdout }
}

/** The repository's top folder and current commit: patches are made and applied from the top. */
async function repoAt($: EngineInterface, cwd: string): Promise<{ root: string; head: string } | undefined> {
  const r = await gitOut($, ['-C', cwd, 'rev-parse', '--show-toplevel', 'HEAD'])
  if (!r.ok) return undefined
  const [root, head] = r.out.trim().split('\n')
  return root && head ? { root, head } : undefined
}

// ── crew: named, ongoing conversations with Codex and Antigravity ────────────

async function patchThread($: EngineInterface, name: string, fn: (t: CrewThread) => CrewThread): Promise<void> {
  await update($, threads, list => list.map(t => (t.name === name ? fn(t) : t)))
}

async function findThread($: EngineInterface, name: string): Promise<CrewThread | undefined> {
  return (await read($, threads)).find(t => t.name === name)
}

const trimmed = (list: readonly CrewThread[]): CrewThread[] =>
  list.map(t => ({
    ...t,
    turns: t.turns.slice(-12).map(u => ({ ...u, answer: u.answer.slice(0, 6000), log: u.log.slice(-6) })),
  }))

/**
 * Threads outlive the session (their helpers' own conversations do too), trimmed.
 * Threads only another FLEET window has are kept in the store, not overwritten.
 */
async function persist($: EngineInterface): Promise<void> {
  const saved = await $.store.get('threads').catch(() => undefined)
  const stored = Array.isArray(saved) ? (saved as CrewThread[]) : []
  await $.store.set('threads', trimmed(mergeThreads(await read($, threads), stored))).catch(() => undefined)
}

/** Which project rules files (CLAUDE.md, AGENTS.md, GEMINI.md) a folder has. */
async function rulesPresent($: EngineInterface, cwd: string): Promise<string[]> {
  const found = await Promise.all(RULES_FILES.map(f => $.fs.stat(`${cwd}/${f}`).then(() => f, () => '')))
  return found.filter(Boolean)
}

/** A finished turn was looked at (opened here, or read by Claude): it leaves TO READ. */
async function markRead($: EngineInterface, name: string, n?: number): Promise<void> {
  const t = await findThread($, name)
  if (!t?.turns.some(u => u.unread && (n === undefined || u.n === n))) return
  await patchThread($, name, x => ({
    ...x,
    turns: x.turns.map(u => (u.unread && (n === undefined || u.n === n) ? { ...u, unread: false } : u)),
  }))
  await persist($)
}

type AskOpts = {
  name: string
  agent?: CrewAgent
  model?: string
  effort?: string
  task: string
  context: string
  by: 'claude' | 'you'
  folder?: string
  /** how long an answer to ask for */
  depth?: Depth
}

/** Sends a message to a thread, opening it if it is new. Answers an error string, or the thread. */
// threads being claimed right now: checked and set with no await between, so two
// sends can never both find a thread idle and both start a turn
const claiming = new Set<string>()

async function sendToThread($: EngineInterface, o: AskOpts): Promise<CrewThread | string> {
  const name = slug(o.name)
  if (claiming.has(name)) return `Thread "${name}" is taking another message right now; try again in a moment.`
  claiming.add(name)
  try {
    return await claimAndSend($, name, o)
  } finally {
    claiming.delete(name)
  }
}

/** Opens or continues a thread, then runs the turn in the background. */
async function claimAndSend($: EngineInterface, name: string, o: AskOpts): Promise<CrewThread | string> {
  const claimed = await claim($, name, o)
  if (typeof claimed === 'string') return claimed
  await persist($)
  void runTurn($, name, claimed.turn.n, o.task, o.context, o.by, o.depth)
  return claimed.thread
}

async function claim($: EngineInterface, name: string, o: AskOpts): Promise<{ thread: CrewThread; turn: CrewTurn } | string> {
  const existing = await findThread($, name)
  if (existing?.status === 'running') return `Thread "${name}" is still answering its last message. Wait for it (crew_read) or use another thread.`
  if (existing && o.agent && existing.agent !== o.agent) {
    return `Thread "${name}" talks to ${existing.agent}, not ${o.agent}. Pick another thread name for ${o.agent}.`
  }
  if (!existing && !o.agent) return `There is no thread "${name}" yet; say which agent opens it ("codex" or "agy").`
  if (existing && o.folder && existing.cwd !== o.folder) {
    return `Thread "${name}" works in ${existing.cwd}. Open another thread for ${o.folder}.`
  }
  // the folder rule holds on every path, not only when a folder is passed: never / or
  // your home folder itself, which would hand a helper everything you own
  const folder = existing?.cwd ?? o.folder ?? sessionCwd
  const home = (await $.env.get('HOME')) ?? ''
  if (!folder || folder === '/' || folder === home || folder === `${home}/`) {
    return `Helpers don't work in ${folder || 'an unknown folder'} itself: it is too broad. Open a project folder, or name one.`
  }
  const base: CrewThread = existing ?? {
    name,
    agent: o.agent ?? 'codex',
    model: 'default',
    effort: 'default',
    cwd: o.folder ?? sessionCwd,
    by: o.by,
    session: '',
    status: 'idle',
    turns: [],
    compactions: 0,
    brief: '',
    created: now(),
    updated: now(),
  }
  const thread: CrewThread = {
    ...base,
    model: o.model ?? base.model,
    effort: o.effort ?? base.effort,
    status: 'running',
    updated: now(),
  }
  const turn: CrewTurn = {
    n: (base.turns[base.turns.length - 1]?.n ?? 0) + 1,
    by: o.by,
    ask: o.task,
    status: 'running',
    started: now(),
    answer: '',
    log: [],
    contextTokens: 0,
    outputTokens: 0,
    isHanded: false,
  }
  thread.turns = [...base.turns, turn].slice(-20)
  await update($, threads, list => {
    if (existing) return list.map(t => (t.name === name ? thread : t))
    // past 16 threads the oldest idle ones go; a running one never does
    const next = [...list, thread]
    while (next.length > 16) {
      const i = next.findIndex(t => t.status !== 'running')
      if (i < 0 || next[i] === thread) break
      next.splice(i, 1)
    }
    return next
  })
  return { thread, turn }
}

/**
 * runTurn, guarded: if it throws, the turn is marked failed and the run released,
 * so a crash can never leave a "zombie" run that looks busy forever.
 */
async function runTurn(
  $: EngineInterface,
  name: string,
  n: number,
  task: string,
  context: string,
  by: 'claude' | 'you',
  depth: Depth = 'normal',
): Promise<void> {
  try {
    await runTurnInner($, name, n, task, context, by, depth)
  } catch (err) {
    const t = await findThread($, name)
    const u = t?.turns.find(x => x.n === n)
    if (!t || !u || u.status !== 'running') return
    owner.delete(name)
    const child = running.get(name)
    running.delete(name)
    void child?.return?.(undefined)
    await patchThread($, name, x => ({
      ...x,
      status: 'failed',
      updated: now(),
      turns: x.turns.map(v => (v.n === n ? { ...v, status: 'failed', ended: now(), unread: true, log: [...v.log, `FLEET: ${String(err).slice(0, 200)}`] } : v)),
    }))
    await persist($)
  }
}

async function runTurnInner(
  $: EngineInterface,
  name: string,
  n: number,
  task: string,
  context: string,
  by: 'claude' | 'you',
  depth: Depth = 'normal',
): Promise<void> {
  let t = await findThread($, name)
  if (!t) return
  const run = ++runSeq
  owner.set(name, run)
  const isMine = () => owner.get(name) === run
  // A long thread is compacted first: the helper writes a state brief, and a
  // fresh conversation starts from it, so the thread keeps what matters.
  let seed: string | undefined
  const isStopped = async () =>
    !isMine() || (await findThread($, name))?.turns.find(u => u.n === n)?.status === 'stopped'
  if (t.session && needsCompaction(t)) {
    // FLEET builds the brief from the stored answers when it can: no extra helper turn
    const local = localBrief(t)
    const briefRun = local
      ? { ok: true, answer: local }
      : await execTurn($, t, COMPACT_PROMPT, n, true, isMine)
    if (await isStopped()) return
    const fresh = briefRun.ok ? briefRun.answer.trim() : ''
    // a failed brief keeps the conversation
    if (fresh) {
      seed = fresh
      await patchThread($, name, x => ({ ...x, session: '', brief: fresh, compactions: x.compactions + 1, compactedAt: n - 1 }))
      t = { ...((await findThread($, name)) ?? t), session: '' }
    }
  }
  // a fresh conversation after an earlier compaction (say, its first try failed) starts
  // from the saved brief, never from nothing
  if (!t.session && seed === undefined && t.brief) seed = t.brief
  if (await isStopped()) return
  // the project's rules go with the first message of a conversation, as Claude follows them
  const present = !t.session || seed !== undefined ? await rulesPresent($, t.cwd) : []
  const res = await execTurn($, t, brief(t, by, task, context, seed, depth, rulesFor(t.agent, present)), n, false, isMine)
  if (!isMine()) return
  await archiveAnswer($, name, n, res.answer)
  await patchThread($, name, x => {
    const mine = x.turns.find(u => u.n === n)
    // a stopped turn, or one a newer turn has replaced, does not get to set the thread's status
    if (!mine || mine.status === 'stopped' || x.turns[x.turns.length - 1]?.n !== n) return x
    return {
      ...x,
      status: res.ok ? 'idle' : 'failed',
      updated: now(),
      turns: x.turns.map(u => (u.n !== n ? u : { ...u, status: res.ok ? 'done' : 'failed', ended: now(), unread: true })),
    }
  })
  const settledThread = await findThread($, name)
  const settled = settledThread?.turns.find(u => u.n === n)
  if (isMine()) owner.delete(name)
  if (settled && settled.status !== 'stopped') {
    // a failure reaches the desktop whoever started it; a success is a toast for
    // your own turns, and a (batched) notice for Claude's
    if (settled.status === 'failed') {
      void $.ui.notify(`Crew · ${name} (${settledThread?.agent ?? 'helper'}) failed`, { title: 'FLEET', key: `fleet-crew-${name}` })
    }
    if (by === 'claude') await queueForClaude($, name, n)
    else $.ui.toast(`Crew · ${name} answered (${settled.status})`)
  }
  await persist($)
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g

/** Runs one exchange with the helper, streaming its progress into the turn. */
async function execTurn(
  $: EngineInterface,
  t: CrewThread,
  prompt: string,
  n: number,
  isBrief: boolean,
  isMine: () => boolean,
): Promise<{ ok: boolean; answer: string }> {
  const argv = argvFor({
    agent: t.agent,
    model: t.model,
    effort: t.effort,
    cwd: t.cwd,
    prompt,
    ...(t.session ? { session: t.session } : {}),
  })
  let answer = ''
  let final: string | undefined
  let session = t.session
  let ctx = 0
  let out = 0
  let code: number | null = null
  let isFatal = false
  let fresh: string[] = []
  let pushed = 0
  const buf = { stdout: '', stderr: '' }
  let it: AsyncIterator<{ stream: 'stdout' | 'stderr'; text: string }, unknown> | undefined
  const take = (stream: 'stdout' | 'stderr', line: string) => {
    const p = stream === 'stdout' ? parseLine(t.agent, line) : { log: line.trim() }
    if (p.session) session = p.session
    if (p.answer) answer = (answer + p.answer).slice(-200_000)
    if (p.final) final = p.final.slice(-200_000)
    if (p.contextTokens) ctx = p.contextTokens
    if (p.outputTokens) out = p.outputTokens
    if (p.log) fresh.push(isBrief ? `[state brief] ${p.log}` : p.log)
    if (p.fatal) isFatal = true
  }
  const flush = async (force: boolean) => {
    if (!force && now() - pushed < 0.4) return
    if (!isMine()) return // a revoked run writes nothing, its session id included
    pushed = now()
    const text = final ?? answer
    const add = fresh
    fresh = []
    await patchThread($, t.name, x => ({
      ...x,
      session: session || x.session,
      turns: x.turns.map(u =>
        u.n !== n
          ? u
          : {
              ...u,
              ...(isBrief ? {} : { answer: capAnswer(text) }),
              log: [...u.log, ...add].slice(-40),
              contextTokens: ctx || u.contextTokens,
              outputTokens: out || u.outputTokens,
            },
      ),
    }))
  }
  try {
    if (!isMine()) return { ok: false, answer: '' } // stopped before it started: no child at all
    it = $.process.spawn({ argv, cwd: t.cwd })[Symbol.asyncIterator]()
    running.set(t.name, it as AsyncIterator<unknown, unknown>)
    for (;;) {
      const step = await it.next()
      if (step.done) {
        code = (step.value as { code: number | null } | undefined)?.code ?? null
        break
      }
      const { stream, text } = step.value
      const split = lines(buf[stream], text.replace(ANSI, ''))
      // an unfinished line is held, but never grows without bound
      buf[stream] = split.rest.slice(-1_000_000)
      for (const line of split.complete) take(stream, line)
      await flush(false)
    }
  } catch (failure) {
    fresh.push(`! ${String(failure)}`)
  } finally {
    // only the run that owns the child forgets it
    if (it && running.get(t.name) === it) running.delete(t.name)
  }
  // a last line without a newline still counts
  if (buf.stdout.trim()) take('stdout', buf.stdout)
  if (buf.stderr.trim()) take('stderr', buf.stderr)
  await flush(true)
  return { ok: code === 0 && !isFatal, answer: final ?? answer }
}

async function stopThread($: EngineInterface, name: string): Promise<'stopped' | 'idle'> {
  const t = await findThread($, name)
  if (t?.status !== 'running' && !running.has(name)) return 'idle'
  // revoke the run and take its child before the thread looks idle to anyone
  owner.delete(name)
  const child = running.get(name)
  running.delete(name)
  await patchThread($, name, x => ({
    ...x,
    status: 'idle',
    updated: now(),
    turns: x.turns.map(u => (u.status === 'running' ? { ...u, status: 'stopped', ended: now() } : u)),
  }))
  await child?.return?.(undefined)
  await persist($)
  return 'stopped'
}

// Claude-started turns that finished while a sibling this window runs for Claude
// was still working: Claude hears about them together, in one notice, instead of
// being interrupted once per helper (and acting on the first before the rest land).
const HAND_WAIT_MS = 180_000 // a slow sibling never holds the others back longer than this
let handQueue: { name: string; n: number }[] = []
let handGen = 0

const RETRY_MS = 30_000
let handTries = 0

async function queueForClaude($: EngineInterface, name: string, n: number): Promise<void> {
  // the wait starts at the batch's FIRST finished turn: later ones never push it back
  const isFirst = handQueue.length === 0
  handQueue.push({ name, n })
  const siblings = (await read($, threads)).filter(
    t => t.status === 'running' && owner.has(t.name) && t.turns[t.turns.length - 1]?.by === 'claude',
  )
  if (siblings.length === 0) return flushForClaude($)
  if (!isFirst) return
  const gen = handGen
  void $.clock.sleep(HAND_WAIT_MS).then(() => (gen === handGen ? flushForClaude($) : undefined))
}

/** Sends what's queued as one notice; if the notice can't be sent, it is kept and tried again. */
async function flushForClaude($: EngineInterface): Promise<void> {
  const queued = handQueue
  handQueue = []
  handGen++
  const list = await read($, threads)
  const due = stillUnread(queued, list)
  if (due.length === 0) return
  const text = due.length === 1 ? singleNotice(list, due[0]!.name, due[0]!.n) : batchNotice(due, list)
  if (!text) return
  const isSent = await $.prompt
    .submit({ text })
    .then(() => true)
    .catch(() => false)
  if (isSent) {
    handTries = 0
    for (const { name, n } of due) {
      await patchThread($, name, x => ({ ...x, turns: x.turns.map(u => (u.n === n ? { ...u, isHanded: true } : u)) }))
    }
    return
  }
  // put them back in front and try again, a few times; the Crew tab still shows them either way
  handQueue = [...due, ...handQueue]
  if (++handTries <= 5) void $.clock.sleep(RETRY_MS).then(() => flushForClaude($))
  else handTries = 0
}

/** The fixed notice for one finished turn: the helper's words reach Claude through crew_read, never the prompt. */
function singleNotice(list: readonly CrewThread[], name: string, n: number): string {
  const t = list.find(x => x.name === name)
  const turn = t?.turns.find(u => u.n === n)
  if (!t || !turn) return ''
  return turn.by === 'claude'
    ? `[FLEET crew] Thread "${name}" (${t.agent}) finished turn ${n} (${turn.status}). ` +
        `Read it with crew_read {"new": true} and check it before relying on it.`
    : `[FLEET crew] The user sent you turn ${n} of thread "${name}" (${t.agent}) to review. ` +
        `Read it with crew_read {"thread": "${name}", "turn": ${n}, "full": true}, then say what you'd keep.`
}

/** The user's "send to Claude": one turn, now. */
async function handToClaude($: EngineInterface, name: string, n: number): Promise<void> {
  const text = singleNotice(await read($, threads), name, n)
  if (!text) return
  await $.prompt
    .submit({ text })
    .then(() => patchThread($, name, x => ({ ...x, turns: x.turns.map(u => (u.n === n ? { ...u, isHanded: true } : u)) })))
    .catch(() => $.ui.toast(`Couldn't hand ${name} to Claude right now; try again in a moment.`))
}

type Args = Record<string, unknown>
type Answer = { result: string } | { deny: string }
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

async function answerCrewAsk($: EngineInterface, e: Args): Promise<Answer> {
  const name = optStr(e.thread)
  const task = optStr(e.task)
  if (!name || !task) return { deny: 'crew_ask needs a thread name and a task.' }
  const isBoth = e.agent === 'both'
  const agent = e.agent === 'agy' || e.agent === 'codex' ? e.agent : undefined
  const depth: Depth = e.depth === 'brief' || e.depth === 'deep' ? e.depth : 'normal'
  let folder: string | undefined
  if (optStr(e.folder)) {
    const res = await resolveFolder($, optStr(e.folder) ?? '', 'run a helper')
    if (typeof res !== 'string') return res
    folder = res
  }
  // a model must be one the helper offers: the list lives here, not in every request's schema
  const model = optStr(e.model)
  if (model) {
    if (isBoth) return { deny: 'Pick a model per helper: send to codex and agy separately, or leave model out.' }
    const which = agent ?? (await findThread($, slug(name)))?.agent
    const offered = which ? (await read($, crewModels))[which] : []
    if (which && offered.length && !offered.includes(model)) {
      return { deny: `Unknown model "${model}" for ${which}. It offers: ${offered.join(', ')}.` }
    }
  }
  const context = optStr(e.context) ?? ''
  const angles = (e.tasks && typeof e.tasks === 'object' ? e.tasks : {}) as Record<string, unknown>
  const targets: { thread: string; agent?: CrewAgent; task: string }[] = isBoth
    ? (['codex', 'agy'] as const).map(a => ({
        thread: `${slug(name)}-${a}`,
        agent: a,
        task: optStr(angles[a]) ? `${task}\n\nYour focus: ${optStr(angles[a])}` : task,
      }))
    : [{ thread: name, ...(agent ? { agent } : {}), task }]

  const sent: { name: string; n: number; agent: CrewAgent }[] = []
  const refused: string[] = []
  for (const x of targets) {
    const res = await sendToThread($, {
      name: x.thread,
      task: x.task,
      context,
      by: 'claude',
      depth,
      ...(folder ? { folder } : {}),
      ...(x.agent ? { agent: x.agent } : {}),
      ...(model ? { model } : {}),
      ...(optStr(e.effort) ? { effort: optStr(e.effort) } : {}),
    })
    if (typeof res === 'string') refused.push(res)
    else sent.push({ name: res.name, n: res.turns[res.turns.length - 1]?.n ?? 1, agent: res.agent })
  }
  if (sent.length === 0) return { deny: refused.join(' ') }
  return { result: receipt(sent, refused.length ? ` · not sent: ${refused.join(' ')}` : '') }
}

const REVIEW_INLINE = 30_000 // characters of patch sent inside each reviewer's task

/** The git diff arguments for a review target; undefined when the target is not one FLEET accepts. */
function diffArgs(target: string): { args: string[]; label: string } | undefined {
  const ref = (x: string) => /^[\w./~^@{}-]+$/.test(x) && !x.startsWith('-')
  if (target === 'working') return { args: ['diff', 'HEAD'], label: 'git diff HEAD' }
  if (target === 'staged') return { args: ['diff', '--cached'], label: 'git diff --cached' }
  const [kind, rest = ''] = [target.slice(0, target.indexOf(':')), target.slice(target.indexOf(':') + 1)]
  if (kind === 'branch' && ref(rest)) return { args: ['diff', `${rest}...HEAD`], label: `git diff ${rest}...HEAD` }
  if (kind === 'commit' && ref(rest)) return { args: ['diff', `${rest}^!`], label: `git diff ${rest}^!` }
  if (kind === 'files') {
    const files = rest.split(',').map(f => f.trim()).filter(f => f && !f.startsWith('-'))
    if (files.length) return { args: ['diff', 'HEAD', '--', ...files], label: `git diff HEAD -- ${files.join(' ')}` }
  }
  return undefined
}

/** One call: FLEET works out the diff and has both helpers review it, each from its own angle. */
async function answerCrewReview($: EngineInterface, e: Args): Promise<Answer> {
  const intent = optStr(e.intent)
  if (!intent) return { deny: 'crew_review needs the intent: what the change is meant to do.' }
  const target = optStr(e.target) ?? 'working'
  const how = diffArgs(target)
  if (!how) return { deny: `Unknown target "${target}". Use working, staged, branch:<base>, commit:<sha>, or files:<a,b>.` }
  // the repo to review: the one named, else this session's folder
  let where = sessionCwd
  if (optStr(e.folder)) {
    const res = await resolveFolder($, optStr(e.folder) ?? '', 'review a change')
    if (typeof res !== 'string') return res
    where = res
  }
  const repo = await repoAt($, where)
  if (!repo) return { deny: `${where} is not a git repository. Pass folder: the project's absolute path.` }
  const opts = ['--no-ext-diff', '--no-textconv']
  const stat = await gitOut($, ['-C', repo.root, ...how.args.slice(0, 1), ...opts, '--stat', ...how.args.slice(1)])
  if (!stat.ok) return { deny: `git couldn't read the change: ${stat.why}` }
  if (!stat.out.trim()) return { deny: `No changes for target "${target}".` }
  const patch = await gitOut($, ['-C', repo.root, ...how.args.slice(0, 1), ...opts, ...how.args.slice(1)])
  if (!patch.ok) return { deny: `git couldn't read the change: ${patch.why}` }
  const truncated = patch.out.length > REVIEW_INLINE
  const head = patch.out.slice(0, REVIEW_INLINE)
  const branch = await gitOut($, ['-C', repo.root, 'rev-parse', '--abbrev-ref', 'HEAD'])
  const topic = slug(optStr(e.topic) ?? `review-${branch.ok ? branch.out.trim() : 'change'}`).slice(0, 24)
  const agents = (Array.isArray(e.agents) ? e.agents : ['codex', 'agy']).filter((a): a is CrewAgent => a === 'codex' || a === 'agy')
  if (agents.length === 0) return { deny: 'agents must name codex and/or agy.' }
  const sent: { name: string; n: number; agent: CrewAgent }[] = []
  const refused: string[] = []
  for (const agent of agents) {
    const res = await sendToThread($, {
      name: `${topic}-${agent}`,
      agent,
      task: reviewTask({ intent, ...(optStr(e.focus) ? { focus: optStr(e.focus) } : {}), agent, stat: stat.out, patch: head, truncated, diffCmd: how.label }),
      context: '',
      by: 'claude',
      depth: 'normal',
      folder: repo.root,
    })
    if (typeof res === 'string') refused.push(res)
    else sent.push({ name: res.name, n: res.turns[res.turns.length - 1]?.n ?? 1, agent: res.agent })
  }
  if (sent.length === 0) return { deny: refused.join(' ') }
  const files = stat.out.trim().split('\n').pop() ?? ''
  return {
    result: `review started · ${sent.map(x => `${x.name}#${x.n}`).join(' · ')} · ${files.trim()}${truncated ? ` · diff cut at ${REVIEW_INLINE.toLocaleString('en-US')} chars` : ''}${refused.length ? ` · not sent: ${refused.join(' ')}` : ''} · one notice when all finish, then crew_read {"new": true}`,
  }
}

/** Claude stops a helper turn it started by mistake. */
async function answerCrewStop($: EngineInterface, e: Args): Promise<Answer> {
  const name = slug(optStr(e.thread) ?? '')
  const t = await findThread($, name)
  if (!t) return { deny: `No thread "${name}".` }
  if (t.status !== 'running') return { result: `${name} is not running.` }
  const n = t.turns[t.turns.length - 1]?.n
  const how = await stopThread($, name)
  return {
    result: how === 'stopped' ? `stopped ${name}#${n}` : `${name} is not running.`,
  }
}

async function answerCrewRead($: EngineInterface, e: Args): Promise<Answer> {
  const list = await read($, threads)
  const t0 = now()
  // everything nobody has read yet, in one call
  if (e.new === true) {
    const due = list
      .flatMap(t => t.turns.filter(isUnread).map(u => ({ t, u })))
      .sort((a, b) => (a.u.ended ?? 0) - (b.u.ended ?? 0))
    if (due.length === 0) {
      const running = list.filter(t => t.status === 'running')
      return {
        result: `Nothing unread.${running.length ? ` ${running.length} running: ${running.map(t => `${t.name} (${t.agent}, ${Math.round(t0 - (t.turns[t.turns.length - 1]?.started ?? t0))}s)`).join(', ')}.` : ''}`,
      }
    }
    const blocks: string[] = []
    const done = new Set<string>()
    for (const { t, u } of due) {
      if (done.has(t.name)) continue
      // a review pair (<topic>-codex and <topic>-agy) whose answers carry F lines reads as one merged list
      const pair = t.name.match(/^(.*)-(codex|agy)$/)
      const mateName = pair ? `${pair[1]}-${pair[2] === 'codex' ? 'agy' : 'codex'}` : ''
      // the other half: unread too, or already read (the slower reviewer often lands later)
      const mateThread = pair ? list.find(x => x.name === mateName) : undefined
      const mateTurn = mateThread?.turns[mateThread.turns.length - 1]
      const mate =
        due.find(x => x.t.name === mateName) ??
        (mateThread && mateTurn && mateTurn.status === 'done' && Math.abs(mateTurn.started - u.started) < 600 ? { t: mateThread, u: mateTurn } : undefined)
      if (pair && mate) {
        const a = await fullTurn($, t.name, u)
        const b = await fullTurn($, mate.t.name, mate.u)
        const fa = findingsIn(a.answer, t.agent)
        const fb = findingsIn(b.answer, mate.t.agent)
        if (fa.length + fb.length > 0) {
          const conf = [a, b]
            .map((x, i) => {
              const c = sections(x.answer).confidence
              return c ? `${i === 0 ? t.agent : mate.t.agent} ${c.slice(0, 120)}` : ''
            })
            .filter(Boolean)
            .join(' · ')
          blocks.push(reviewDigest(pair[1] ?? t.name, mergeFindings([fa, fb]), conf))
          for (const x of [{ t, u }, mate]) {
            await markRead($, x.t.name, x.u.n)
            done.add(x.t.name)
          }
          continue
        }
      }
      blocks.push(digest(t, await fullTurn($, t.name, u), t0))
      await markRead($, t.name, u.n)
      done.add(t.name)
    }
    const told = statusNews(await read($, threads)).key
    await update($, statusTold, () => told)
    return { result: [UNTRUSTED, '', blocks.join('\n\n')].join('\n') }
  }
  const name = optStr(e.thread)
  if (!name) return { result: listing(list) }
  const t = list.find(x => x.name === slug(name))
  if (!t) return { deny: `No thread "${slug(name)}". ${listing(list)}` }
  const turn = typeof e.turn === 'number' ? t.turns.find(u => u.n === e.turn) : t.turns[t.turns.length - 1]
  if (!turn) return { result: threadLine(t) }
  void markRead($, t.name, turn.n)
  const whole = await fullTurn($, t.name, turn)
  if (optStr(e.grep)) {
    return { result: [UNTRUSTED, `${t.name} · turn ${turn.n} · lines matching "${optStr(e.grep)}"`, grepAnswer(whole.answer, optStr(e.grep) ?? '')].join('\n') }
  }
  const part: Part = e.full === true ? 'full' : e.part === 'full' || e.part === 'summary' ? e.part : 'digest'
  return { result: report(t, part === 'digest' ? whole : part === 'full' ? whole : turn, part, t0) }
}

async function loadModels($: EngineInterface): Promise<void> {
  const home = (await $.env.get('HOME')) ?? ''
  const codex: string[] = []
  try {
    const raw = JSON.parse(await $.fs.read(`${home}/.codex/models_cache.json`)) as unknown
    const list = Array.isArray(raw) ? raw : ((raw as { models?: unknown[] }).models ?? [])
    for (const m of list) {
      const slugOf = (m as { slug?: unknown; id?: unknown }).slug ?? (m as { id?: unknown }).id
      if (typeof slugOf === 'string') codex.push(slugOf)
    }
  } catch {
    // no Codex cache: the picker offers its default alone
  }
  const agy: string[] = []
  try {
    const run = await $.process.run(['agy', 'models'], { timeoutMs: 20_000 })
    for (const line of run.stdout.split('\n')) {
      const id = line.split('\t')[0]?.trim()
      if (id && !id.includes(' ') && line.includes('\t')) agy.push(id)
    }
  } catch {
    // agy missing or offline
  }
  const models = { codex, agy }
  await update($, crewModels, () => models)
  await $.store.set('models', models)
}

async function registerCrewTools($: EngineInterface): Promise<void> {
  await $.tool.register({
    name: 'crew_ask',
    description:
      'Send a message to a crew thread: an ongoing conversation with another coding agent on this machine, "codex" ' +
      '(OpenAI Codex CLI) or "agy" (Google Antigravity CLI), or "both" for two threads <thread>-codex and <thread>-agy with ' +
      'one task. Name threads by topic and reuse them: the helper remembers the thread. Returns at once with a one-line ' +
      'receipt; you get one notice when it (or both) finish, then crew_read {"new": true}. Make each task self-contained ' +
      '(goal, what you know, where to look, what you want back). Helpers are read-only. You are the lead: check what comes back.',
    inputSchema: {
      type: 'object',
      properties: {
        thread: { type: 'string', description: 'thread name by topic; an existing one continues, a new one opens' },
        task: { type: 'string', description: 'the message: a complete, self-contained instruction or follow-up' },
        agent: {
          type: 'string',
          enum: ['codex', 'agy', 'both'],
          description: 'which helper; required to open a new thread. both: <thread>-codex and <thread>-agy, same task',
        },
        tasks: {
          type: 'object',
          properties: { codex: { type: 'string' }, agy: { type: 'string' } },
          description: 'with agent both: a different angle for each, added after the shared task',
        },
        depth: {
          type: 'string',
          enum: ['brief', 'normal', 'deep'],
          description: 'answer length: brief = SUMMARY, KEY POINTS, CONFIDENCE only; normal (default) = DETAILS up to 400 words; deep = no cap',
        },
        context: { type: 'string', description: 'optional facts, snippets or file paths the helper should start from' },
        folder: {
          type: 'string',
          description: 'absolute project folder the helper works in (new threads only); defaults to this session\'s folder',
        },
        model: { type: 'string', description: 'optional model id; an unknown one is refused with the list the helper offers' },
        effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'], description: 'optional reasoning effort' },
      },
      required: ['thread', 'task'],
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'fleet_read',
    description:
      "See the user's whole fleet, as the FLEET pane shows it: every Claude Code session on this machine (who needs the " +
      'user and why, what each is doing), crew threads with Codex and Antigravity (running, failed, and turns finished ' +
      'since the last briefing with their summaries), estimated cost today, and data freshness. Use it for "catch me up", "what needs me", a standup, or before deciding what to work on. It moves ' +
      'the "since last briefing" marker on; pass mark: false to peek without moving it, since_last: false for all history.',
    inputSchema: {
      type: 'object',
      properties: {
        detail: {
          type: 'string',
          enum: ['counts', 'brief', 'full'],
          description: 'counts = one line; brief (default) = needs-you, new crew answers, running; full = adds idle sessions, folders, cost',
        },
        scope: { type: 'string', enum: ['project', 'all'], description: "project = this session's folder only; default all" },
        since_last: { type: 'boolean', description: 'count crew turns finished since the last briefing (default true)' },
        mark: { type: 'boolean', description: 'move the last-briefing marker to now (default true)' },
      },
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'crew_review',
    description:
      'Have Codex and Antigravity review a change, read-only, in parallel. FLEET works out the diff, hands it to each ' +
      'reviewer with a complementary focus (codex: correctness, edge cases, concurrency, missing tests; agy: interface, ' +
      'naming, consistency), and asks for findings as "F<n> [high|med|low] path:line — claim — failure scenario". You get ' +
      'one notice; crew_read {"new": true} then shows ONE merged list (the same file within 5 lines counts once, naming ' +
      'both). You still verify every finding.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'what the change is meant to do, in a sentence or two' },
        target: { type: 'string', description: 'working (default: uncommitted changes), staged, branch:<base>, commit:<sha>, or files:<a,b>' },
        focus: { type: 'string', description: 'optional: what to look hardest at' },
        agents: { type: 'array', items: { type: 'string', enum: ['codex', 'agy'] }, description: 'default both' },
        topic: { type: 'string', description: 'thread name stem; default review-<branch>' },
        folder: { type: 'string', description: "the repository to review (absolute path); default this session's folder" },
      },
      required: ['intent'],
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'crew_stop',
    description: 'Stop a crew thread that is running (one you started by mistake, or that went off track). Returns one line.',
    inputSchema: { type: 'object', properties: { thread: { type: 'string' } }, required: ['thread'] },
    isDeferred: true,
  })
  await $.tool.register({
    name: 'crew_read',
    description:
      'Read crew answers. Default: a digest (SUMMARY, KEY POINTS with path:line, CONFIDENCE) of the thread\'s latest turn. ' +
      'new: true reads every answer nobody has read yet, all threads, in one call. part "full" gives the whole answer; grep ' +
      'pulls only the lines that match from it. With no arguments, lists the threads.',
    inputSchema: {
      type: 'object',
      properties: {
        thread: { type: 'string' },
        turn: { type: 'integer', description: 'an earlier turn; default the latest' },
        new: { type: 'boolean', description: 'every unread finished turn, all threads; marks them read' },
        part: { type: 'string', enum: ['digest', 'summary', 'full'], description: 'default digest' },
        grep: { type: 'string', description: 'text to find in the full answer: matching lines with 2 around each, at most 40' },
        full: { type: 'boolean', description: 'same as part "full"' },
      },
    },
    isDeferred: false,
  })
}

const answerPath = (thread: string, n: number): string => `${answersDir}/${slug(thread)}/${n}.md`

/** Every full answer goes to disk, so trimming a thread's state never loses one. */
async function archiveAnswer($: EngineInterface, thread: string, n: number, answer: string): Promise<void> {
  if (!answersDir || !answer.trim()) return
  await $.fs.write(answerPath(thread, n), answer).catch(() => undefined)
}

/** A turn with its whole answer: from the archive when the kept copy was trimmed. */
async function fullTurn($: EngineInterface, thread: string, turn: CrewTurn): Promise<CrewTurn> {
  if (!answersDir) return turn
  const archived = await $.fs.read(answerPath(thread, turn.n)).catch(() => '')
  return archived.length > turn.answer.length ? { ...turn, answer: archived } : turn
}

async function finishTour($: EngineInterface): Promise<void> {
  await update($, toured, () => true)
  await $.store.set('toured', true)
}

async function answerFleetRead($: EngineInterface, e: Args): Promise<Answer> {
  const saved = await $.store.get('briefAt')
  const since = e.since_last === false ? 0 : typeof saved === 'number' ? saved : 0
  const text = fleetReport({
    snap: await read($, snap),
    threads: await read($, threads),
    since,
    now: now(),
    self,
    detail: e.detail === 'counts' || e.detail === 'full' ? e.detail : 'brief',
    scope: e.scope === 'project' ? 'project' : 'all',
    cwd: sessionCwd,
  })
  const told = statusNews(await read($, threads)).key
  await update($, statusTold, () => told)
  // a briefing moves the "since" marker on, unless asked not to
  if (e.mark !== false) await $.store.set('briefAt', now())
  return { result: text }
}

/**
 * Where a helper may work: the real path of a folder,
 * never / or your home folder itself. Known project folders pass; any other asks you.
 */
async function resolveFolder($: EngineInterface, path: string, why: string): Promise<string | { deny: string }> {
  const st = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  const real = st?.realPath
  if (!st || st.kind !== 'dir' || !real) return { deny: `${path} is not a folder on this machine.` }
  const home = (await $.env.get('HOME')) ?? ''
  if (real === '/' || real === home) return { deny: `${real} is too broad; name a project folder.` }
  const snapNow = await read($, snap)
  const known = new Set([sessionCwd, $.plugin.root, ...(snapNow?.sessions.map(s => s.cwd) ?? []), ...(await read($, threads)).map(t => t.cwd)])
  if (known.has(real)) return real
  const answer = await $.ui.ask(`Claude wants to ${why} in ${real}, which is not one of your open projects. Allow it?`, {
    header: 'FLEET crew',
    options: ['Allow this folder', 'Deny'],
  })
  return answer === 'Allow this folder' ? real : { deny: `The user did not allow ${real}.` }
}

async function toggleCrewAgent($: EngineInterface): Promise<void> {
  await update($, crewAgent, a => (a === 'codex' ? 'agy' : 'codex'))
  await update($, crewModel, () => 'default')
}

/** The launch box: continues the selected thread, or opens a new one named from the task. */
type Launch = { forceNew?: boolean; agent?: CrewAgent; thread?: string }

/**
 * Sends your message: to a named thread, else the selected one, else a new
 * thread named from the message. Answers what happened, for a toast or /crew.
 */
async function launch($: EngineInterface, task: string, how: Launch = {}): Promise<{ ok: boolean; message: string }> {
  const text = task.trim()
  if (!text) return { ok: false, message: 'Nothing to send.' }
  const sel = how.thread ?? (how.forceNew ? null : await read($, crewSel))
  const current = sel ? await findThread($, slug(sel)) : undefined
  if (how.thread && !current) return { ok: false, message: `No thread "${slug(how.thread)}". /crew lists them.` }
  const agent = how.agent ?? (await read($, crewAgent))
  const base = slug(text.split(/\s+/).slice(0, 4).join(' '))
  const taken = new Set((await read($, threads)).map(t => t.name))
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`
  const folder = await read($, crewFolder)
  const res = await sendToThread($, {
    name: current ? current.name : name,
    ...(!current && folder ? { folder } : {}),
    task: text,
    context: '',
    by: 'you',
    agent: current ? current.agent : agent,
    // the pickers set up a NEW thread; a follow-up keeps its thread's own settings
    ...(current
      ? {}
      : { model: await read($, crewModel), effort: await read($, crewEffort) }),
  })
  if (typeof res === 'string') return { ok: false, message: res }
  await update($, crewSel, () => res.name)
  return {
    ok: true,
    message: `Sent to ${res.agent} thread "${res.name}" (${modeLabel(res.agent)}). Its answer shows in the FLEET pane, tab 2.`,
  }
}

async function launchFromPane($: EngineInterface, task: string): Promise<void> {
  if (!task.trim()) return
  const res = await launch($, task)
  $.ui.toast(res.message)
  // the box empties only once the message is really on its way
  if (res.ok) {
    await update($, crewDraft, () => '')
    await update($, crewInputGen, g => g + 1)
  }
}

/**
 * /crew in Claude Code's own prompt, with all its editing:
 *   /crew <message>                 the selected thread, or a new one
 *   /crew new [codex|agy] <message> a new thread
 *   /crew @<thread> <message>       a named thread
 *   /crew                           the threads, and how to use it
 */
async function crewCommand($: EngineInterface, args: string): Promise<string> {
  const text = args.trim()
  // the pane opens only on /fleet: /crew just turns it to Crew for next time
  await update($, tab, () => 'crew')
  if (!text) {
    const sel = await read($, crewSel)
    return [
      listing(await read($, threads)),
      '',
      `Selected: ${sel ?? 'none (a message opens a new thread)'}`,
      'Usage: /crew <message> · /crew new codex|agy <message> · /crew @<thread> <message>',
    ].join('\n')
  }
  const fresh = text.match(/^new(?:\s+(codex|agy))?\s+([\s\S]+)$/i)
  if (fresh) {
    const agent = fresh[1]?.toLowerCase() === 'agy' ? 'agy' : fresh[1] ? 'codex' : undefined
    return (await launch($, fresh[2] ?? '', { forceNew: true, ...(agent ? { agent } : {}) })).message
  }
  const named = text.match(/^@(\S+)\s+([\s\S]+)$/)
  if (named) return (await launch($, named[2] ?? '', { thread: named[1] ?? '' })).message
  return (await launch($, text)).message
}

function acts($: EngineInterface): Acts {
  return {
    tab: (t: Tab) => void update($, tab, () => t),
    // pressing the expanded row again folds it back to a line
    select: sid => void update($, selected, cur => (cur === sid ? '' : sid)),
    copy: (text, what) => void copyText($, text, what),
    open: path => void openPath($, path),
    stop: s => void stopSession($, s),
    crewAgent: () => void toggleCrewAgent($),
    crewLaunch: task => void launchFromPane($, task),
    crewStop: name => void stopThread($, name),
    crewSend: (name, n) => void handToClaude($, name, n),
    crewSelect: name => {
      void update($, crewSel, cur => (cur === name ? null : name))
      void markRead($, name)
    },
    openThread: name => {
      void update($, crewSel, () => name)
      void update($, tab, () => 'crew')
      void markRead($, name)
    },
    crewNew: () => void update($, crewSel, () => null),
    crewModel: value => void update($, crewModel, () => value),
    crewEffort: value => void update($, crewEffort, () => value),
    crewFolder: value => void update($, crewFolder, () => value),
    crewOpen: key => {
      void update($, crewOpenTurn, cur => (cur === key ? null : key))
      const m = key.match(/^(.*)#(\d+)$/)
      if (m) void markRead($, m[1] ?? '', Number(m[2]))
    },
    toggleOptions: () => void update($, crewOptions, x => !x),
    finishTour: () => void finishTour($),
    showAllThreads: () => void update($, crewShowAll, x => !x),
    showAllTurns: name => void update($, crewAllTurns, cur => (cur === name ? null : name)),
    // a crew row on Live opens in place, like a session's; opening an answer reads it
    openInline: key => {
      void update($, selected, cur => (cur === key ? '' : key))
      // only the answer you can see counts as read, not older ones you never opened
      if (key.startsWith('crew:')) {
        const name = key.slice(5)
        void findThread($, name).then(t => (t ? markRead($, name, t.turns[t.turns.length - 1]?.n) : undefined))
      }
    },
    toggleStatusLine: () =>
      void update($, statusLine, x => !x).then(async () => $.store.set('statusLine', await read($, statusLine))),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    self = await $.session.id()
    sessionCwd = started.cwd
    // threads come back from the store; a turn a previous copy was running died with it
    const savedThreads = (await $.store.get('threads')) as CrewThread[] | undefined
    const savedModels = (await $.store.get('models')) as { codex: string[]; agy: string[] } | undefined
    if (Array.isArray(savedThreads) && (await read($, threads)).length === 0) await update($, threads, () => savedThreads)
    if (savedModels?.codex && savedModels.agy) await update($, crewModels, () => savedModels)
    // the first-run tour shows until it is dismissed once
    await update($, toured, () => false)
    if ((await $.store.get('toured')) === true) await update($, toured, () => true)
    const homeDir = (await $.env.get('HOME')) ?? ''
    if (homeDir) answersDir = answersRoot(homeDir, await $.env.get('CLAUDE_CONFIG_DIR'))
    // a turn left running died with the window (or reload) that ran it
    await update($, threads, list => settleRunning(list, now()))
    await registerCrewTools($)
    // the tool list is the same bytes every session: models are checked when used, not listed
    void loadModels($)
    if ((await $.store.get('statusLine')) === false) await update($, statusLine, () => false)
    await $.command.register({
      name: 'crew',
      description: 'Message a Codex/Antigravity crew thread from the prompt: /crew <msg>, /crew new codex|agy <msg>, /crew @thread <msg>',
      argumentHint: '[new codex|agy | @thread] <message>',
      immediate: true,
    })
    await $.command.register({
      name: 'fleet',
      description: 'Open or close FLEET, the live dashboard of all your Claude Code sessions; /fleet help shows the guide',
      argumentHint: '[help]',
    })
    void poll($)
    $.clock.every(POLL_MS, () => void poll($))
    // the watchdog: a collector that stopped answering is said out loud, not left looking current
    $.clock.every(5000, () => void watchdog($))
    // the pane opens only on /fleet; the band above the prompt is always there

    return started
  })

  // FLEET's own tools: the call's fields are its input
  on('tool.call', async ($, e, next) => {
    const name: string = e.tool
    if (name === 'mcp__fleet__crew_ask') return answerCrewAsk($, e as unknown as Args)
    if (name === 'mcp__fleet__crew_read') return answerCrewRead($, e as unknown as Args)
    if (name === 'mcp__fleet__fleet_read') return answerFleetRead($, e as unknown as Args)
    if (name === 'mcp__fleet__crew_stop') return answerCrewStop($, e as unknown as Args)
    if (name === 'mcp__fleet__crew_review') return answerCrewReview($, e as unknown as Args)
    return next(e)
  }).catch(($, e, next) => {
    // fail safe: FLEET's own tool reports the failure; every other tool goes on untouched
    const name: string = e.tool
    if (next.called) return next(e)
    return name.startsWith('mcp__fleet__') ? { deny: 'FLEET could not answer this tool call; try again.' } : next(e)
  })

  on('command.run', { command: 'crew' }, async ($, e) => ({ text: await crewCommand($, e.args) }))

  // When crew results changed since Claude last looked, one line rides along with the
  // user's next prompt (only the model reads it): no tool call needed to notice them.
  on('prompt.submit', async ($, e, next) => {
    const isTyped = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isTyped || e.command || e.isMeta || e.text.startsWith('[FLEET') || !(await read($, statusLine))) return next(e)
    const news = statusNews(await read($, threads))
    if (!news.key || news.key === (await read($, statusTold))) return next(e)
    await update($, statusTold, () => news.key)
    return next({ ...e, context: [...(e.context ?? []), news.text] })
  })

  on('command.run', { command: 'fleet' }, async ($, e) => {
    if (/^\s*help\b/i.test(e.args)) {
      await update($, tab, () => 'actions')
      await $.ui.open({ id: PANE, title: 'FLEET', focus: true })
      return { text: 'FLEET guide open (tab 3, Actions). Arrows scroll it once the pane has the keyboard.' }
    }
    // close only what you can see; a pane opened unasked on a narrow window comes up instead
    if (await isPaneShown($)) {
      await $.ui.close({ id: PANE })
      return { text: 'FLEET closed. /fleet opens it again.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'FLEET', focus: true })
    void poll($)
    return {
      text: opened.isPlaced
        ? 'FLEET open. ctrl+x tab to focus it: 1–3 switch tabs. /fleet help: the guide.'
        : 'FLEET is open but this terminal is too narrow to place it; widen the window.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const E = $.ui.resolve(e)
    const { Box, Text } = E
    // A draw that throws makes the engine close the pane, so failures are drawn instead.
    try {
      const s = await read($, snap)
      const err = await read($, error)
      if (s === null) {
        return (
          <Box flexDirection="column">
            <Text color={palette.work} weight="bold">
              FLEET
            </Text>
            {err ? (
              <Text color={palette.fail}>× FLEET cannot read your sessions: {err}</Text>
            ) : (
              <Text color={palette.dim}>scanning your sessions…</Text>
            )}
          </Box>
        )
      }
      const sel = await read($, selected)
      const currentTab = await read($, tab)
      const width = e.props.bodyColumns

      // the Crew tab's pickers and input box: Input and Select, where the surface has them
      const { Input, Select } = E as Partial<Elements['terminal']>
      const cAgent = await read($, crewAgent)
      const cModel = await read($, crewModel)
      const cEffort = await read($, crewEffort)
      const cSel = await read($, crewSel)
      const cThreads = await read($, threads)
      const target = cSel ? cThreads.find(t => t.name === cSel) : undefined
      const modelList = ['default', ...(await read($, crewModels))[target?.agent ?? cAgent]]
      const actions = acts($)
      // folders a new thread can work in: the live sessions', FLEET's own source, earlier threads'
      const folders = [...new Set([sessionCwd, ...s.sessions.map(x => x.cwd), $.plugin.root, ...cThreads.map(t => t.cwd)])].filter(Boolean)
      const cFolder = (await read($, crewFolder)) ?? sessionCwd
      const shortPath = (f: string) => f.replace(/^\/home\/[^/]+/, '~')
      const pickers =
        Select && !target && (await read($, crewOptions)) ? (
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            <Select
              key="crew-model"
              label="model "
              value={modelList.includes(cModel) ? cModel : 'default'}
              options={modelList.map(m => ({ value: m, label: m }))}
              onSelect={value => actions.crewModel(value)}
            />
            <Select
              key="crew-folder"
              label="folder "
              value={folders.includes(cFolder) ? cFolder : (folders[0] ?? '')}
              options={folders.map(f => ({ value: f, label: f === $.plugin.root ? `${shortPath(f)} (FLEET)` : shortPath(f) }))}
              onSelect={value => actions.crewFolder(value)}
            />
            <Select
              key="crew-effort"
              label="effort "
              value={cEffort}
              options={EFFORTS.map(x => ({ value: x, label: x }))}
              onSelect={value => actions.crewEffort(value)}
            />
          </Box>
        ) : null
      // the box grows with what you type, 1 to 8 rows, then scrolls within
      // The field owns its text while you type (a `value` drawn back would replace
      // it mid-keystroke); the draft is only read to size the box. Generous width
      // margin: the label sits left, the send hint right.
      const draft = await read($, crewDraft)
      const inputGen = await read($, crewInputGen)
      // The field shows one row per line you break, never wrapping a long one, so a
      // wrapped preview above it shows the whole message once it runs past the field.
      const boxWidth = Math.max(10, width - 30 - (target ? target.name.length + 4 : 18))
      const draftRows = Math.max(1, Math.min(8, draft.split('\n').length))
      const needsPreview = draft.split('\n').some(line => line.length > boxWidth)
      const launcher = Input ? (
        <Box flexDirection="column">
          {pickers}
          {needsPreview ? (
            <Box borderStyle="single" borderColor={palette.faint} paddingX={1} flexDirection="column">
              <Text color={palette.dim}>your message ({draft.length} chars)</Text>
              <Text color={palette.text} wrap="wrap">
                {draft.length > 3000 ? `…${draft.slice(-3000)}` : draft}
              </Text>
            </Box>
          ) : null}
          <Box borderStyle="round" borderColor={palette.work} paddingX={1}>
            <Input
              key={`crew-task-${inputGen}`}
              label={target ? `▸ ${target.name} ` : `▸ new ${cAgent} thread `}
              placeholder={target ? 'follow up in this thread…' : 'describe a task, then enter…'}
              submitLabel="send"
              rows={draftRows}
              onInput={value => void update($, crewDraft, () => value)}
              onSubmit={value => actions.crewLaunch(value)}
            />
          </Box>
        </Box>
      ) : null

      const age = Math.max(0, Math.round(Date.now() / 1000 - s.now))
      return (
        <Box flexDirection="column">
          {Pane(
            E,
            {
              snap: s,
              health: { age, err },
              tab: currentTab,
              // nothing starts expanded: you open the row you want
              selected: sel && (s.sessions.some(x => x.sid === sel) || sel.startsWith('crew:')) ? sel : null,
              width,
              self,
              p: palette,
              threads: cThreads,
              crewSel: target ? target.name : null,
              crewAgent: cAgent,
              launcher,
              crewOpenTurn: await read($, crewOpenTurn),
              crewShowAll: await read($, crewShowAll),
              crewOptions: await read($, crewOptions),
              crewSummary: [shortPath(cFolder), cModel !== 'default' ? cModel : '', cEffort !== 'default' ? `${cEffort} effort` : ''].filter(Boolean).join(' · '),
              toured: await read($, toured),
              crewAllTurns: await read($, crewAllTurns),
              statusLine: await read($, statusLine),
            },
            acts($),
          )}
        </Box>
      )
    } catch (failure) {
      return (
        <Box flexDirection="column">
          <Text color={palette.work} weight="bold">
            FLEET
          </Text>
          <Text color={palette.fail}>× this draw failed: {String(failure).slice(0, 300)}</Text>
          <Text color={palette.dim}>It retries on the next update (about 1.5 s).</Text>
        </Box>
      )
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey) return next(e)
    if (s === null) {
      // no snapshot yet: say so when the collector is failing, else stay out of the way
      const err = await read($, error)
      if (!err) return next(e)
      const { Text } = $.ui.resolve(e)
      return (
        <Text color={palette.fail} wrap="truncate-end">
          FLEET  × cannot read your sessions: {err}
        </Text>
      )
    }

    const list = await read($, threads)
    // the same inbox the Live tab draws: a failure stays on the band until someone looks
    const items = inbox(s.sessions, list)
    const age = Math.max(0, Math.round(Date.now() / 1000 - s.now))
    return Band($.ui.resolve(e), s, palette, { age, isStale: age > 6 || (await read($, error)) !== null, items })
  })
}
