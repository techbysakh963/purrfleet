import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { CrewAgent, CrewJob, CrewMode, Session, Snapshot, Tab } from '../types'
import { isBusy, needsYou } from './fmt'
import type { Mood } from './cat'
import { catCells } from './cat'
import { argvFor, absorb, listing, modeLabel, report } from './crew'
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
const crew = atom({ plugin: 'fleet', key: 'crew' } as const, [], { shape: 'crew-1' })
const crewAgent = atom({ plugin: 'fleet', key: 'crewAgent' } as const, 'codex')
const crewMode = atom({ plugin: 'fleet', key: 'crewMode' } as const, 'read')

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
// the children of running crew jobs; leaving a loop (return) kills its child
const running = new Map<number, AsyncIterator<unknown, unknown>>()

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


// ── crew: jobs handed to Codex or Antigravity ────────────────────────────────

async function patchJob($: EngineInterface, id: number, fn: (j: CrewJob) => CrewJob): Promise<void> {
  await update($, crew, list => list.map(j => (j.id === id ? fn(j) : j)))
}

async function startJob($: EngineInterface, agent: CrewAgent, mode: CrewMode, task: string, by: 'claude' | 'you'): Promise<CrewJob> {
  const jobs = await read($, crew)
  const job: CrewJob = {
    id: jobs.reduce((m, j) => Math.max(m, j.id), 0) + 1,
    agent,
    mode,
    by,
    task,
    cwd: sessionCwd,
    status: 'running',
    started: now(),
    output: '',
    log: '',
    tail: [],
    isHanded: false,
  }
  await update($, crew, list => [...list, job].slice(-30))
  void runJob($, job)
  return job
}

async function runJob($: EngineInterface, job: CrewJob): Promise<void> {
  let cur = job
  let pushed = 0
  try {
    const stream = $.process.spawn({ argv: argvFor(job.agent, job.mode, job.task, job.cwd), cwd: job.cwd })
    const it = stream[Symbol.asyncIterator]()
    running.set(job.id, it as AsyncIterator<unknown, unknown>)
    for (;;) {
      const step = await it.next()
      if (step.done) {
        const end = step.value as { code: number | null }
        cur = { ...cur, status: end.code === 0 ? 'done' : 'failed', code: end.code, ended: now() }
        break
      }
      cur = absorb(cur, step.value.stream, step.value.text)
      if (now() - pushed > 0.5) {
        pushed = now()
        const at = cur
        await patchJob($, job.id, j => ({ ...at, status: j.status }))
      }
    }
  } catch (failure) {
    cur = { ...absorb(cur, 'stderr', `\n${String(failure)}`), status: 'failed', ended: now() }
  } finally {
    running.delete(job.id)
  }
  const last = cur
  // a job you stopped stays 'stopped' whatever its child said on the way out
  await patchJob($, job.id, j => ({ ...last, status: j.status === 'stopped' ? 'stopped' : last.status }))
  const settled = (await read($, crew)).find(j => j.id === job.id)
  if (settled && settled.by === 'claude' && settled.status !== 'stopped') await handToClaude($, job.id)
  else $.ui.toast(`Crew job #${job.id} (${job.agent}) ${settled?.status ?? last.status}`)
}

async function stopJob($: EngineInterface, id: number): Promise<void> {
  await patchJob($, id, j => (j.status === 'running' ? { ...j, status: 'stopped', ended: now() } : j))
  await running.get(id)?.return?.(undefined)
}

/** Wakes Claude to review a finished job: a prompt of its own once the session is idle. */
async function handToClaude($: EngineInterface, id: number): Promise<void> {
  const job = (await read($, crew)).find(j => j.id === id)
  if (!job) return
  await patchJob($, id, j => ({ ...j, isHanded: true }))
  const text =
    job.by === 'claude'
      ? `[FLEET crew] Job #${job.id} (${job.agent}, ${modeLabel(job.agent, job.mode)}) ${job.status}: "${job.task}". ` +
        `Read it with mcp__fleet__crew_result {"id": ${job.id}} and review it critically before relying on it.`
      : `[FLEET crew] I ran this job myself; please review the result critically and tell me what you'd keep.\n\n${report(job, now())}`
  void $.prompt.submit({ text })
}

type Args = Record<string, unknown>
type Answer = { result: string } | { deny: string }

async function answerCrewRun($: EngineInterface, e: Args): Promise<Answer> {
  const agent: CrewAgent | null = e.agent === 'agy' ? 'agy' : e.agent === 'codex' ? 'codex' : null
  const task = typeof e.task === 'string' ? e.task.trim() : ''
  if (agent === null || task === '') return { deny: 'crew_run needs agent ("codex" or "agy") and a non-empty task.' }
  const mode: CrewMode = e.mode === 'edit' ? 'edit' : 'read'
  const job = await startJob($, agent, mode, task, 'claude')
  return {
    result:
      `Started crew job #${job.id} on ${agent} (${modeLabel(agent, mode)}) in ${job.cwd}. ` +
      `It runs in the background; you'll be prompted when it finishes. Read it with crew_result {"id": ${job.id}}.`,
  }
}

async function answerCrewResult($: EngineInterface, e: Args): Promise<Answer> {
  const jobs = await read($, crew)
  if (typeof e.id !== 'number') return { result: listing(jobs) }
  const job = jobs.find(j => j.id === e.id)
  return job ? { result: report(job, now()) } : { deny: `No crew job #${String(e.id)}. ${listing(jobs)}` }
}

async function toggleCrewAgent($: EngineInterface): Promise<void> {
  await update($, crewAgent, a => (a === 'codex' ? 'agy' : 'codex'))
}

async function toggleCrewMode($: EngineInterface): Promise<void> {
  await update($, crewMode, m => (m === 'read' ? 'edit' : 'read'))
}

async function launchFromPane($: EngineInterface, task: string): Promise<void> {
  const text = task.trim()
  if (!text) return
  const job = await startJob($, await read($, crewAgent), await read($, crewMode), text, 'you')
  $.ui.toast(`Crew job #${job.id} started on ${job.agent}`)
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
    crewStop: id => void stopJob($, id),
    crewSend: id => void handToClaude($, id),
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    self = await $.session.id()
    sessionCwd = started.cwd
    // jobs a previous copy of the module was running died with it
    await update($, crew, list => list.map(j => (j.status === 'running' ? { ...j, status: 'stopped', ended: now() } : j)))
    await $.tool.register({
      name: 'crew_run',
      description:
        'Hand a task to another coding agent on this machine and get a job id back at once: "codex" (OpenAI Codex CLI) or ' +
        '"agy" (Google Antigravity CLI). The job runs in the background in this project folder, read-only unless mode is ' +
        '"edit" (Codex then edits in a separate git worktree; Antigravity edits in place). Use it to parallelise independent ' +
        'investigation or to get a second opinion. You stay the lead: when the job finishes you are prompted, and you must ' +
        'read its output with crew_result and check it before relying on it. The user watches jobs in the FLEET pane.',
      inputSchema: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: ['codex', 'agy'], description: 'which agent runs the job' },
          task: { type: 'string', description: 'a complete, self-contained instruction; the agent has no other context' },
          mode: { type: 'string', enum: ['read', 'edit'], description: 'read (default) or edit' },
        },
        required: ['agent', 'task'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'crew_result',
      description:
        "Read a crew job's status and output (its answer, or its progress log while it runs). Without an id, lists recent jobs.",
      inputSchema: { type: 'object', properties: { id: { type: 'integer', description: 'the job id crew_run gave' } } },
      isDeferred: false,
    })
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
    if (name === 'mcp__fleet__crew_run') return answerCrewRun($, e as unknown as Args)
    if (name === 'mcp__fleet__crew_result') return answerCrewResult($, e as unknown as Args)
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
      const { Input } = E as Partial<Elements['terminal']>
      const launcher = Input ? (
        <Input
          key="crew-task"
          placeholder={`describe a job for ${await read($, crewAgent)}, then enter`}
          submitLabel="run"
          onSubmit={value => acts($).crewLaunch(value)}
        />
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
              crew: await read($, crew),
              crewAgent: await read($, crewAgent),
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
