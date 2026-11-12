import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { CrewAgent, CrewMode, CrewThread, CrewTurn, Session, Snapshot, Tab } from '../types'
import { isBusy, needsYou } from './fmt'
import type { Mood } from './cat'
import { catCells } from './cat'
import {
  COMPACT_AT,
  COMPACT_PROMPT,
  EFFORTS,
  argvFor,
  brief,
  capAnswer,
  lines,
  listing,
  modeLabel,
  parseLine,
  report,
  slug,
  summaryOf,
  threadLine,
} from './crew'
import { auroraCells, toBase64 } from './scenes'
import { PALETTES, paletteOf } from './theme'
import type { Palette } from './theme'
import { Band, Pane, ordered } from './views'
import type { Acts } from './views'

const PANE = 'fleet'
const POLL_MS = 1500
const FRAME_MS = 70 // ≈14 fps for the pixel scenes
const SCENE_CHOICES = ['cat', 'off'] as const

// A new tag makes a reload decline what an older shape stored.
const snap = atom({ plugin: 'fleet', key: 'snap' } as const, null, { shape: 'snap-2' })
const error = atom({ plugin: 'fleet', key: 'error' } as const, null)
const tab = atom({ plugin: 'fleet', key: 'tab' } as const, 'live')
const selected = atom({ plugin: 'fleet', key: 'selected' } as const, null)
const feedFilter = atom({ plugin: 'fleet', key: 'feedFilter' } as const, null)
const theme = atom({ plugin: 'fleet', key: 'theme' } as const, 'nebula')
const scene = atom({ plugin: 'fleet', key: 'scene' } as const, 'cat')
const threads = atom({ plugin: 'fleet', key: 'threads' } as const, [], { shape: 'threads-1' })
const crewSel = atom({ plugin: 'fleet', key: 'crewSel' } as const, null)
const crewAgent = atom({ plugin: 'fleet', key: 'crewAgent' } as const, 'codex')
const crewMode = atom({ plugin: 'fleet', key: 'crewMode' } as const, 'read')
const crewModel = atom({ plugin: 'fleet', key: 'crewModel' } as const, 'default')
const crewEffort = atom({ plugin: 'fleet', key: 'crewEffort' } as const, 'default')
const crewModels = atom({ plugin: 'fleet', key: 'crewModels' } as const, { codex: [], agy: [] })

// Module variables start over on a reload; everything drawn lives in $.state.
let self = ''
let isPolling = false
let alerted = new Set<string>()
// What the frame loop paints: the Rasters the last drawing mounted, and its inputs.
type Mounted = { kind: 'aurora' | 'cat'; cols: number; rows: number }
let mounted = new Map<string, Mounted>()
let palette: Palette = PALETTES[0]!
let mood: Mood = 'sleep'
let busyCount = 0
let sessionCwd = ''
// the children of running crew turns, by thread; leaving a loop (return) kills its child
const running = new Map<string, AsyncIterator<unknown, unknown>>()

const now = (): number => Date.now() / 1000

function frameOf(m: Mounted): string {
  return toBase64(
    m.kind === 'aurora'
      ? auroraCells(now(), m.cols, palette, busyCount)
      : catCells(now(), m.cols, m.rows, mood, palette),
  )
}

function remember(s: Snapshot): void {
  mood = s.sessions.some(needsYou) ? 'alarm' : s.sessions.some(isBusy) ? 'work' : 'sleep'
  busyCount = s.sessions.filter(isBusy).length
}

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
    remember(next)
    await update($, snap, () => next)
    await update($, error, () => null)
    await alertOnNew($, next.sessions)
  } catch (e) {
    await update($, error, () => `collector failed: ${String(e).slice(0, 300)}`)
  } finally {
    isPolling = false
  }
}

// One desktop notification per session each time it starts needing you.
async function alertOnNew($: EngineInterface, sessions: Session[]): Promise<void> {
  const fresh = new Set<string>()
  for (const s of sessions.filter(needsYou)) {
    const key = `${s.sid}:${s.phase}:${s.phaseSince}`
    fresh.add(key)
    if (!alerted.has(key) && s.sid !== self) {
      void $.ui.notify(
        s.phase === 'error' ? `${s.name}: the turn ended on an error` : `${s.name} is waiting for you`,
        { title: 'FLEET', key: `fleet-${s.sid}` },
      )
    }
  }
  alerted = fresh
}

/** Repaint every mounted Raster in place; one that no longer stands is forgotten. */
async function paint($: EngineInterface): Promise<void> {
  for (const [key, m] of [...mounted]) {
    const r = await $.ui.blit({ requestId: PANE, key, cells: frameOf(m) })
    if (r.deny !== undefined) mounted.delete(key)
  }
}

async function isPaneShown($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE && p.isShown)
}

async function cycleTheme($: EngineInterface): Promise<void> {
  const name = await read($, theme)
  const i = PALETTES.findIndex(p => p.name === name)
  const next = PALETTES[(i + 1) % PALETTES.length]!.name
  palette = paletteOf(next)
  await update($, theme, () => next)
  await $.store.set('theme', next)
  const s = await read($, snap)
  if (s) remember(s)
}

async function cycleScene($: EngineInterface): Promise<void> {
  const name = await read($, scene)
  const i = SCENE_CHOICES.findIndex(x => x === (name === 'off' ? 'off' : 'cat'))
  const next = SCENE_CHOICES[(i + 1) % SCENE_CHOICES.length]!
  await update($, scene, () => next)
  await $.store.set('scene', next)
}

async function stopSession($: EngineInterface, s: Session): Promise<void> {
  const answer = await $.ui.ask(`Stop "${s.name}" (pid ${s.pid})?`, {
    header: 'FLEET',
    options: ['Interrupt its current turn', 'End the session', 'Cancel'],
  })
  const signal = answer.startsWith('Interrupt') ? '-INT' : answer.startsWith('End') ? '-TERM' : null
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


// ── crew: named, ongoing conversations with Codex and Antigravity ────────────

async function patchThread($: EngineInterface, name: string, fn: (t: CrewThread) => CrewThread): Promise<void> {
  await update($, threads, list => list.map(t => (t.name === name ? fn(t) : t)))
}

async function findThread($: EngineInterface, name: string): Promise<CrewThread | undefined> {
  return (await read($, threads)).find(t => t.name === name)
}

/** Threads outlive the session (their helpers' own conversations do too), trimmed. */
async function persist($: EngineInterface): Promise<void> {
  const list = await read($, threads)
  await $.store.set(
    'threads',
    list.map(t => ({
      ...t,
      turns: t.turns.slice(-12).map(u => ({ ...u, answer: u.answer.slice(0, 6000), log: u.log.slice(-6) })),
    })),
  )
}

type AskOpts = {
  name: string
  agent?: CrewAgent
  model?: string
  effort?: string
  mode?: CrewMode
  task: string
  context: string
  by: 'claude' | 'you'
}

/** Sends a message to a thread, opening it if it is new. Answers an error string, or the thread. */
async function sendToThread($: EngineInterface, o: AskOpts): Promise<CrewThread | string> {
  const name = slug(o.name)
  const existing = await findThread($, name)
  if (existing?.status === 'running') {
    return `Thread "${name}" is still answering its last message. Wait for it (crew_read) or use another thread.`
  }
  if (existing && o.agent && existing.agent !== o.agent) {
    return `Thread "${name}" talks to ${existing.agent}, not ${o.agent}. Pick another thread name for ${o.agent}.`
  }
  if (!existing && !o.agent) return `There is no thread "${name}" yet; say which agent opens it ("codex" or "agy").`
  const base: CrewThread = existing ?? {
    name,
    agent: o.agent ?? 'codex',
    model: 'default',
    effort: 'default',
    mode: 'read',
    cwd: sessionCwd,
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
    mode: o.mode ?? base.mode,
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
  await update($, threads, list => (existing ? list.map(t => (t.name === name ? thread : t)) : [...list, thread].slice(-16)))
  void runTurn($, name, turn.n, o.task, o.context, o.by)
  return thread
}

async function runTurn(
  $: EngineInterface,
  name: string,
  n: number,
  task: string,
  context: string,
  by: 'claude' | 'you',
): Promise<void> {
  let t = await findThread($, name)
  if (!t) return
  // A long thread is compacted first: the helper writes a state brief, and a
  // fresh conversation starts from it, so the thread keeps what matters.
  let seed: string | undefined
  const lastDone = [...t.turns].reverse().find(u => u.status === 'done')
  if (t.session && (lastDone?.contextTokens ?? 0) > COMPACT_AT) {
    const brief = await execTurn($, t, COMPACT_PROMPT, n, true)
    if (brief.ok && brief.answer.trim()) {
      seed = brief.answer.trim()
      await patchThread($, name, x => ({ ...x, session: '', compactions: x.compactions + 1, brief: seed ?? '' }))
      t = (await findThread($, name)) ?? t
    }
  }
  const res = await execTurn($, t, brief(t, by, task, context, seed), n, false)
  await patchThread($, name, x => ({
    ...x,
    status: res.ok ? 'idle' : 'failed',
    updated: now(),
    turns: x.turns.map(u =>
      u.n !== n || u.status === 'stopped' ? u : { ...u, status: res.ok ? 'done' : 'failed', ended: now() },
    ),
  }))
  const settled = (await findThread($, name))?.turns.find(u => u.n === n)
  if (settled && settled.status !== 'stopped') {
    if (by === 'claude') await handToClaude($, name, n)
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
): Promise<{ ok: boolean; answer: string }> {
  const argv = argvFor({
    agent: t.agent,
    mode: t.mode,
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
  let fresh: string[] = []
  let pushed = 0
  const buf = { stdout: '', stderr: '' }
  const flush = async (force: boolean) => {
    if (!force && now() - pushed < 0.4) return
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
    const it = $.process.spawn({ argv, cwd: t.cwd })[Symbol.asyncIterator]()
    running.set(t.name, it as AsyncIterator<unknown, unknown>)
    for (;;) {
      const step = await it.next()
      if (step.done) {
        code = (step.value as { code: number | null }).code
        break
      }
      const { stream, text } = step.value
      const split = lines(buf[stream], text.replace(ANSI, ''))
      buf[stream] = split.rest
      for (const line of split.complete) {
        const p = stream === 'stdout' ? parseLine(t.agent, line) : { log: line.trim() }
        if (p.session) session = p.session
        if (p.answer) answer += p.answer
        if (p.final) final = p.final
        if (p.contextTokens) ctx = p.contextTokens
        if (p.outputTokens) out = p.outputTokens
        if (p.log) fresh.push(isBrief ? `[state brief] ${p.log}` : p.log)
      }
      await flush(false)
    }
  } catch (failure) {
    fresh.push(`! ${String(failure)}`)
  } finally {
    running.delete(t.name)
  }
  await flush(true)
  return { ok: code === 0, answer: final ?? answer }
}

async function stopThread($: EngineInterface, name: string): Promise<void> {
  await patchThread($, name, x => ({
    ...x,
    status: 'idle',
    turns: x.turns.map(u => (u.status === 'running' ? { ...u, status: 'stopped', ended: now() } : u)),
  }))
  await running.get(name)?.return?.(undefined)
}

/** Tells Claude a turn finished: the summary inline (no extra call), the rest on demand. */
async function handToClaude($: EngineInterface, name: string, n: number): Promise<void> {
  const t = await findThread($, name)
  const turn = t?.turns.find(u => u.n === n)
  if (!t || !turn) return
  await patchThread($, name, x => ({ ...x, turns: x.turns.map(u => (u.n === n ? { ...u, isHanded: true } : u)) }))
  const text =
    turn.by === 'claude'
      ? `[FLEET crew] Thread "${name}" (${t.agent}) answered your message (turn ${n}, ${turn.status}).\n` +
        `SUMMARY: ${summaryOf(turn.answer) || '(no answer)'}\n` +
        `Check it before relying on it. Full answer: crew_read {"thread": "${name}", "full": true}. ` +
        `Continue the conversation with crew_ask {"thread": "${name}", ...}.`
      : `[FLEET crew] I asked thread "${name}" (${t.agent}): ${turn.ask}\n\nIts answer:\n\n${capAnswer(turn.answer).slice(0, 8000)}\n\n` +
        `Please review it critically and tell me what you'd keep. You can continue this thread with crew_ask {"thread": "${name}", ...}.`
  void $.prompt.submit({ text })
}

type Args = Record<string, unknown>
type Answer = { result: string } | { deny: string }
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

async function answerCrewAsk($: EngineInterface, e: Args): Promise<Answer> {
  const name = optStr(e.thread)
  const task = optStr(e.task)
  if (!name || !task) return { deny: 'crew_ask needs a thread name and a task.' }
  const agent = e.agent === 'agy' || e.agent === 'codex' ? e.agent : undefined
  const mode: CrewMode | undefined = e.mode === 'edit' ? 'edit' : e.mode === 'read' ? 'read' : undefined
  const existing = await findThread($, slug(name))
  if ((mode ?? existing?.mode) === 'edit' && existing?.mode !== 'edit') {
    // Claude never gets to let a helper change files on its own say-so
    const who = agent ?? existing?.agent ?? 'the helper'
    const answer = await $.ui.ask(
      `Claude wants ${who} to EDIT files in thread "${slug(name)}"${who === 'codex' ? ' (in its own git worktree)' : ' (in place)'}: ${task.slice(0, 160)}`,
      { header: 'FLEET crew', options: ['Allow edits', 'Read-only instead', 'Cancel'] },
    )
    if (answer.startsWith('Cancel')) return { deny: 'The user cancelled this crew message.' }
    if (answer.startsWith('Read-only')) return answerCrewAsk($, { ...e, mode: 'read' })
  }
  const res = await sendToThread($, {
    name,
    task,
    context: optStr(e.context) ?? '',
    by: 'claude',
    ...(agent ? { agent } : {}),
    ...(optStr(e.model) ? { model: optStr(e.model) } : {}),
    ...(optStr(e.effort) ? { effort: optStr(e.effort) } : {}),
    ...(mode ? { mode } : {}),
  })
  if (typeof res === 'string') return { deny: res }
  const turn = res.turns[res.turns.length - 1]
  return {
    result:
      `Sent to thread "${res.name}" (${res.agent}${res.model !== 'default' ? ` ${res.model}` : ''}, ${modeLabel(res.agent, res.mode)}), ` +
      `turn ${turn?.n ?? 1}. It answers in the background; you'll get its SUMMARY when it finishes. ` +
      `Meanwhile carry on with other work.`,
  }
}

async function answerCrewRead($: EngineInterface, e: Args): Promise<Answer> {
  const list = await read($, threads)
  const name = optStr(e.thread)
  if (!name) return { result: listing(list) }
  const t = list.find(x => x.name === slug(name))
  if (!t) return { deny: `No thread "${slug(name)}". ${listing(list)}` }
  const turn = typeof e.turn === 'number' ? t.turns.find(u => u.n === e.turn) : t.turns[t.turns.length - 1]
  if (!turn) return { result: threadLine(t) }
  return { result: report(t, turn, e.full === true) }
}

/** The models each helper offers: Codex's from its cache file, Antigravity's from `agy models`. */
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
  const models = await read($, crewModels)
  await $.tool.register({
    name: 'crew_ask',
    description:
      'Send a message to a crew thread: an ongoing conversation with another coding agent on this machine, "codex" ' +
      '(OpenAI Codex CLI) or "agy" (Google Antigravity CLI). Name threads by topic ("auth-review") and keep reusing them: ' +
      'the helper remembers the whole thread, and FLEET compacts long threads into a state brief by itself. It returns at ' +
      'once; the helper works in the background and you get its SUMMARY when it is done. Helpers see only what you send ' +
      'plus their thread, so make each task self-contained (goal, what you know, where to look, what you want back). ' +
      'Read-only unless mode is "edit", which the user must approve. You are the lead: check what comes back.',
    inputSchema: {
      type: 'object',
      properties: {
        thread: { type: 'string', description: 'thread name by topic; an existing one continues, a new one opens' },
        task: { type: 'string', description: 'the message: a complete, self-contained instruction or follow-up' },
        agent: { type: 'string', enum: ['codex', 'agy'], description: 'which helper; required to open a new thread' },
        context: { type: 'string', description: 'optional facts, snippets or file paths the helper should start from' },
        model: {
          type: 'string',
          description:
            `optional model. codex: ${models.codex.slice(0, 10).join(', ') || 'its default'}. ` +
            `agy: ${models.agy.slice(0, 10).join(', ') || 'its default'}.`,
        },
        effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'], description: 'optional reasoning effort' },
        mode: { type: 'string', enum: ['read', 'edit'], description: 'read (default) or edit (asks the user first)' },
      },
      required: ['thread', 'task'],
    },
    isDeferred: false,
  })
  await $.tool.register({
    name: 'crew_read',
    description:
      "Read a crew thread's latest answer: its SUMMARY by default (cheap), the whole answer with full: true. A turn number " +
      'reads an earlier one. Without a thread, lists every thread with its status and last summary.',
    inputSchema: {
      type: 'object',
      properties: {
        thread: { type: 'string' },
        turn: { type: 'integer' },
        full: { type: 'boolean' },
      },
    },
    isDeferred: false,
  })
}

async function toggleCrewAgent($: EngineInterface): Promise<void> {
  await update($, crewAgent, a => (a === 'codex' ? 'agy' : 'codex'))
  await update($, crewModel, () => 'default')
}

async function toggleCrewMode($: EngineInterface): Promise<void> {
  await update($, crewMode, m => (m === 'read' ? 'edit' : 'read'))
}

/** The launch box: continues the selected thread, or opens a new one named from the task. */
async function launchFromPane($: EngineInterface, task: string): Promise<void> {
  const text = task.trim()
  if (!text) return
  const sel = await read($, crewSel)
  const current = sel ? await findThread($, sel) : undefined
  const agent = await read($, crewAgent)
  const base = slug(text.split(/\s+/).slice(0, 4).join(' '))
  const taken = new Set((await read($, threads)).map(t => t.name))
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`
  const res = await sendToThread($, {
    name: current ? current.name : name,
    task: text,
    context: '',
    by: 'you',
    agent: current ? current.agent : agent,
    model: await read($, crewModel),
    effort: await read($, crewEffort),
    mode: await read($, crewMode),
  })
  if (typeof res === 'string') $.ui.toast(res)
  else {
    await update($, crewSel, () => res.name)
    $.ui.toast(`Crew · sent to ${res.name}`)
  }
}

function acts($: EngineInterface): Acts {
  return {
    tab: (t: Tab) => void update($, tab, () => t),
    // pressing the expanded row again folds it back to a line
    select: sid => void update($, selected, cur => (cur === sid ? '' : sid)),
    filter: sid => void update($, feedFilter, () => sid),
    copy: (text, what) => void copyText($, text, what),
    open: path => void openPath($, path),
    stop: s => void stopSession($, s),
    theme: () => void cycleTheme($),
    scene: () => void cycleScene($),
    crewAgent: () => void toggleCrewAgent($),
    crewMode: () => void toggleCrewMode($),
    crewLaunch: task => void launchFromPane($, task),
    crewStop: name => void stopThread($, name),
    crewSend: (name, n) => void handToClaude($, name, n),
    crewSelect: name => void update($, crewSel, cur => (cur === name ? null : name)),
    crewNew: () => void update($, crewSel, () => null),
    crewModel: value => void update($, crewModel, () => value),
    crewEffort: value => void update($, crewEffort, () => value),
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
    await update($, threads, list =>
      list.map(t =>
        t.status !== 'running'
          ? t
          : {
              ...t,
              status: 'idle',
              turns: t.turns.map(u => (u.status === 'running' ? { ...u, status: 'stopped', ended: now() } : u)),
            },
      ),
    )
    await registerCrewTools($)
    // refresh the model lists in the background, then describe them to Claude
    void loadModels($).then(() => registerCrewTools($))
    // the look you picked last time, kept across sessions
    const savedTheme = await $.store.get('theme')
    const savedScene = await $.store.get('scene')
    if (typeof savedTheme === 'string') await update($, theme, () => savedTheme)
    if (typeof savedScene === 'string') await update($, scene, () => savedScene)
    palette = paletteOf(await read($, theme))
    await $.command.register({
      name: 'fleet',
      description: 'Open or close FLEET, the live dashboard of all your Claude Code sessions',
    })
    void poll($)
    $.clock.every(POLL_MS, () => void poll($))
    $.clock.every(FRAME_MS, () => void (mounted.size > 0 ? paint($) : undefined))
    // the pane opens only on /fleet; the band above the prompt is always there

    return started
  })

  // FLEET's own tools: the call's fields are its input
  on('tool.call', async ($, e, next) => {
    const name: string = e.tool
    if (name === 'mcp__fleet__crew_ask') return answerCrewAsk($, e as unknown as Args)
    if (name === 'mcp__fleet__crew_read') return answerCrewRead($, e as unknown as Args)
    return next(e)
  })

  on('command.run', { command: 'fleet' }, async $ => {
    // close only what you can see; a pane opened unasked on a narrow window comes up instead
    if (await isPaneShown($)) {
      await $.ui.close({ id: PANE })
      return { text: 'FLEET closed. /fleet opens it again.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'FLEET', focus: true })
    void poll($)
    return {
      text: opened.isPlaced
        ? 'FLEET open. ctrl+x tab to focus it: 1–4 switch tabs, t the theme, a the cat.'
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
      palette = paletteOf(await read($, theme))
      if (s === null) {
        return (
          <Box flexDirection="column">
            <Text color={palette.accent}>◆ FLEET</Text>
            <Text color={palette.dim}>{err ?? 'Scanning your sessions…'}</Text>
          </Box>
        )
      }
      remember(s)
      const sel = await read($, selected)
      const sceneName = await read($, scene)
      const currentTab = await read($, tab)
      const width = e.props.bodyColumns

      // Pixel art where the surface has a Raster (the terminal); text elsewhere.
      const { Raster } = E as Partial<Elements['terminal']>
      const next = new Map<string, Mounted>()
      const raster = (key: string, m: Mounted) => {
        if (!Raster) return null
        next.set(key, m)
        return <Raster key={key} columns={m.cols} rows={m.rows} cells={frameOf(m)} />
      }
      const aurora = raster('aurora', { kind: 'aurora', cols: Math.max(10, width), rows: 1 })
      // the cat sits beside the session legend; any stored value but 'off' means the cat
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
      const pickers =
        Select && !target ? (
          <Box flexDirection="row" columnGap={2}>
            <Select
              key="crew-model"
              label="model "
              value={modelList.includes(cModel) ? cModel : 'default'}
              options={modelList.map(m => ({ value: m, label: m }))}
              onSelect={value => actions.crewModel(value)}
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
      const launcher = Input ? (
        <Box flexDirection="column">
          {pickers}
          <Box borderStyle="round" borderColor={palette.accent} paddingX={1}>
            <Input
              key="crew-task"
              label={target ? `▸ ${target.name} ` : `▸ new ${cAgent} thread `}
              placeholder={target ? 'follow up in this thread…' : 'describe a task, then enter…'}
              submitLabel="send"
              onSubmit={value => actions.crewLaunch(value)}
            />
          </Box>
        </Box>
      ) : null
      const hero = currentTab === 'live' && sceneName !== 'off' ? raster('hero', { kind: 'cat', cols: 34, rows: 12 }) : null
      mounted = next

      return (
        <Box flexDirection="column">
          {Pane(
            E,
            {
              snap: s,
              tab: currentTab,
              selected: sel === '' ? '' : sel && s.sessions.some(x => x.sid === sel) ? sel : (ordered(s.sessions)[0]?.sid ?? null),
              feedFilter: await read($, feedFilter),
              width,
              self,
              p: palette,
              scene: sceneName === 'off' ? 'off' : 'cat',
              aurora,
              hero,
              frame: Math.floor(Date.now() / 140),
              threads: cThreads,
              crewSel: target ? target.name : null,
              crewAgent: cAgent,
              crewMode: await read($, crewMode),
              launcher,
            },
            acts($),
          )}
          {err ? <Text color={palette.bad}>{err}</Text> : null}
        </Box>
      )
    } catch (failure) {
      mounted = new Map()
      return (
        <Box flexDirection="column">
          <Text color={palette.accent}>◆ FLEET</Text>
          <Text color={palette.bad}>This draw failed: {String(failure).slice(0, 300)}</Text>
          <Text color={palette.dim}>It retries on the next update (about 1.5 s).</Text>
        </Box>
      )
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, snap)
    if (e.props.hasSurvey || s === null) return next(e)

    return Band($.ui.resolve(e), s, paletteOf(await read($, theme)))
  })
}
