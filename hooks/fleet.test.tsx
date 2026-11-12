import { expect, test } from 'claude-code/testing'

import type { Snapshot } from '../types'
import { IDLE_ROWS, idleFrame } from './anim'
import { ago, bar, spark, usd } from './fmt'
import { catCells } from './cat'
import { absorb, argvFor, report } from './crew'
import type { CrewJob } from '../types'
import { toBase64 } from './scenes'
import { PALETTES } from './theme'

const NOW = 1_794_434_000

const session = (over: Partial<Snapshot['sessions'][number]>) => ({
  pid: 100,
  sid: 'sid-a',
  name: 'demo-app',
  cwd: '/home/u/demo-app',
  status: 'busy',
  phase: 'thinking',
  phaseSince: NOW - 30,
  startedAt: NOW - 600,
  tools: [{ tool: 'Edit', detail: 'main.rs', since: NOW - 2 }],
  agents: [{ id: 'a1', type: 'Explore', task: 'List all files', since: NOW - 31, tokens: 41_000, ctx: 200_000 }],
  calls: 12,
  model: 'opus-5-5',
  ctx: 610_000,
  cost: 1.4,
  tokens: 2_000_000,
  transcript: '/home/u/.claude/projects/x/sid-a.jsonl',
  branch: 'main',
  added: 15,
  removed: 3,
  ...over,
})

const SNAP: Snapshot = {
  now: NOW,
  sessions: [
    session({}),
    session({ pid: 200, sid: 'sid-b', name: 'argus', phase: 'waiting', tools: [], agents: [], phaseSince: NOW - 180 }),
  ],
  feed: [{ t: NOW - 5, sid: 'sid-a', name: 'demo-app', tool: 'Bash', detail: 'cargo build', agent: false }],
  cost: {
    today: 4.12,
    tokens: 2_300_000,
    cacheHit: 0.81,
    days: [1, 2, 3, 4, 5, 6, 7].map(d => ({ date: `2026-11-0${d}`, usd: d })),
    models: { 'opus-5-5': 3, 'sonnet-5-5': 1.12 },
    pendingBytes: 0,
  },
}

const PANE = {
  plugin: 'fleet',
  component: 'Pane',
  requestId: 'fleet',
  props: {
    title: 'FLEET',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'fleet',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

test('helpers format what the pane shows', async () => {
  expect(ago(42)).toBe('42s')
  expect(ago(185)).toBe('3m05')
  expect(ago(7300)).toBe('2h01')
  expect(usd(4.123)).toBe('$4.12')
  expect(usd(52.17)).toBe('$52.2')
  expect(bar(50, 8)).toBe('▰▰▰▰▱▱▱▱')
  expect(spark([0, 7])).toBe('▁█')
})

test('the cat paints a full raster in every mood and palette', async () => {
  for (const p of PALETTES) {
    for (const mood of ['sleep', 'work', 'alarm'] as const) {
      const cells = catCells(1.5, 34, 12, mood, p)
      expect(cells.length).toBe(34 * 12 * 3)
      expect(cells[0]).toBe(0x2580)
    }
  }
  expect(toBase64(Uint32Array.of(0x2588, 0xff8800, 0x01000000))).toBe('iCUAAACI/wAAAAAB')
})

test('the idle scene keeps its size and moves', async () => {
  const a = idleFrame(0, 40)
  const b = idleFrame(5, 40)
  expect(a.length).toBe(IDLE_ROWS)
  expect(a.join('\n')).not.toBe(b.join('\n'))
  expect(a[a.length - 1]).toContain('standby')
})

test('before the first scan the pane says it is scanning', async ($, on) => {
  on('state.get', (_, e, next) => next(e))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Scanning/ })).toBeDefined()
    await ui.unmount()
  }
})

test('with a snapshot the pane and band show sessions, agents and who needs you', async ($, on) => {
  on('state.get', (_, e, next) =>
    e.key === 'snap' ? { value: { value: { shape: 'snap-2', value: SNAP }, version: 1 } } : next(e),
  )
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 's-sid-a' })).toBeDefined()
    // argus needs you, so it leads, expanded; demo-app is one calm row
    expect(await ui.find({ type: 'Text', text: /› Edit main.rs/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /NEEDS YOU/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /⌥ main/ })).toBeDefined()
    if (surface === 'terminal') expect(await ui.find({ key: 'hero' })).toBeDefined()
    await ui.unmount()

    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: /argus needs you/ })).toBeDefined()
    await band.unmount()
  }
})

test('crew jobs are read-only unless started with edits, and Codex edits stay in a worktree', async () => {
  const read = argvFor('codex', 'read', 'look', '/p')
  expect(read).toContain('read-only')
  expect(read).not.toContain('workspace-write')
  const edit = argvFor('codex', 'edit', 'fix', '/p')
  expect(edit).toContain('--worktree')
  expect(edit).toContain('workspace-write')
  expect(argvFor('agy', 'read', 'look', '/p')).toEqual(['agy', '-p', 'look', '--mode', 'plan'])
  expect(argvFor('agy', 'edit', 'fix', '/p')).toContain('accept-edits')
})

test('crew output is cleaned of colour codes and keeps its last lines', async () => {
  const job: CrewJob = {
    id: 1, agent: 'codex', mode: 'read', by: 'claude', task: 't', cwd: '/p', status: 'running',
    started: 0, output: '', log: '', tail: [], isHanded: false,
  }
  const a = absorb(job, 'stderr', '\u001b[32mreading src\u001b[0m\nline 2\n')
  const b = absorb(a, 'stdout', 'the answer\n')
  expect(b.tail).toEqual(['reading src', 'line 2', 'the answer'])
  expect(b.output).toBe('the answer\n')
  expect(report(b, 5)).toContain('Crew job #1')
})

test("Claude's crew_result tool answers, listing jobs when given no id", async ($, on) => {
  on('state.get', (_, e, next) => next(e))
  // a plain signature: inferring against every tool's input union is more than tsc can take
  const call = $.tool.call as unknown as (input: { tool: string }) => Promise<{ text?: string; result?: unknown }>
  const r = await call({ tool: 'mcp__fleet__crew_result' })
  expect(r.text ?? JSON.stringify(r.result)).toContain('No crew jobs yet')
})
