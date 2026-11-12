import { expect, test } from 'claude-code/testing'

import type { Snapshot } from '../types'
import { IDLE_ROWS, idleFrame } from './anim'
import { ago, bar, spark, usd } from './fmt'
import { catCells } from './cat'
import { argvFor, brief, lines, parseLine, report, slug, summaryOf } from './crew'
import type { CrewThread } from '../types'
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

const LAUNCH = { model: 'default', effort: 'default', cwd: '/p' } as const

test('crew prompts can never be read as flags, and edits are opt-in', async () => {
  const codexRead = argvFor({ ...LAUNCH, agent: 'codex', mode: 'read', prompt: '--dangerously-bypass-approvals-and-sandbox' })
  expect(codexRead).toContain('read-only')
  expect(codexRead).not.toContain('workspace-write')
  expect(codexRead.indexOf('--')).toBe(codexRead.length - 2) // the prompt sits after `--`
  const codexEdit = argvFor({ ...LAUNCH, agent: 'codex', mode: 'edit', prompt: 'fix' })
  expect(codexEdit).toContain('--worktree')
  // an edit turn never resumes: a resumed session can't re-enter its worktree
  const editResume = argvFor({ ...LAUNCH, agent: 'codex', mode: 'edit', prompt: 'fix', session: 'abc' })
  expect(editResume).not.toContain('resume')
  expect(editResume).toContain('--worktree')
  expect(editResume).not.toContain('abc')
  const resumed = argvFor({ ...LAUNCH, agent: 'codex', mode: 'read', prompt: 'more', session: 'abc' })
  expect(resumed.slice(0, 3)).toEqual(['codex', 'exec', 'resume'])
  expect(resumed).toContain('sandbox_mode="read-only"')
  expect(resumed.slice(-3)).toEqual(['--', 'abc', 'more'])
  const agy = argvFor({ ...LAUNCH, agent: 'agy', mode: 'read', prompt: '-x', model: 'gemini-3.8-flash-high', effort: 'high', session: 'c1' })
  expect(agy[1]).toBe('-p=-x')
  expect(agy).toContain('plan')
  expect(agy).toContain('--conversation')
  expect(agy).toContain('gemini-3.8-flash-high')
})

test('the helpers’ streamed JSON is read: session, answer, tokens', async () => {
  expect(parseLine('codex', '{"type":"thread.started","thread_id":"t-1"}').session).toBe('t-1')
  expect(parseLine('codex', '{"type":"item.completed","item":{"id":"i","type":"agent_message","text":"OK"}}').answer).toBe('OK\n')
  expect(parseLine('codex', '{"type":"turn.completed","usage":{"input_tokens":22862,"output_tokens":5}}').contextTokens).toBe(22862)
  expect(parseLine('agy', '{"event":"init","conversation_id":"c-9","init":{}}').session).toBe('c-9')
  expect(
    parseLine('agy', '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"OK"}}').answer,
  ).toBe('OK')
  const done = parseLine(
    'agy',
    '{"event":"result","result":{"response":"OK\\n","usage":{"input_tokens":2053,"output_tokens":97},"denied_actions":[{"display_name":"RunCommand"}]}}',
  )
  expect(done.final).toBe('OK\n')
  expect(done.log).toContain('RunCommand')
  expect(lines('par', 'tial\nnext')).toEqual({ complete: ['partial'], rest: 'next' })
})

test('answers are read summary-first', async () => {
  const answer = 'SUMMARY: Dates are parsed in two places.\nKEY POINTS:\n- src/time.rs:12\nDETAILS: long…'
  expect(summaryOf(answer)).toBe('Dates are parsed in two places.')
  expect(summaryOf('no shape here')).toBe('no shape here')
  const thread: CrewThread = {
    name: 'dates', agent: 'codex', model: 'default', effort: 'default', mode: 'read', cwd: '/p', by: 'claude',
    session: 's', status: 'idle', compactions: 0, brief: '', created: 0, updated: 0,
    turns: [{ n: 1, by: 'claude', ask: 'where?', status: 'done', started: 0, answer, log: [], contextTokens: 9, outputTokens: 1, isHanded: false }],
  }
  const short = report(thread, thread.turns[0]!, false)
  expect(short).toContain('SUMMARY: Dates are parsed in two places.')
  expect(short).not.toContain('DETAILS')
  expect(short.startsWith('Below is output from a helper agent')).toBe(true)
  expect(report(thread, thread.turns[0]!, true)).toContain('DETAILS')
  const first = brief({ ...thread, turns: [] }, 'claude', 'look', '')
  expect(first).toContain('read-only')
  expect(first).toContain('SUMMARY:')
  expect(brief(thread, 'claude', 'more', '', 'what we know')).toContain('State brief carried over')
  expect(slug('Auth Review!')).toBe('auth-review')
})

test("Claude's crew_read tool lists threads when given none", async ($, on) => {
  on('state.get', (_, e, next) => next(e))
  // a plain signature: inferring against every tool's input union is more than tsc can take
  const call = $.tool.call as unknown as (input: { tool: string }) => Promise<{ text?: string; result?: unknown }>
  const r = await call({ tool: 'mcp__fleet__crew_read' })
  expect(r.text ?? JSON.stringify(r.result)).toContain('No crew threads yet')
})

test('the Crew and System tabs draw threads and process groups', async ($, on) => {
  const thread: CrewThread = {
    name: 'auth-review', agent: 'codex', model: 'gpt-6-astra', effort: 'high', mode: 'read', cwd: '/p', by: 'claude',
    session: 's', status: 'idle', compactions: 1, brief: 'goal: audit login', created: 0, updated: 1,
    turns: [{ n: 1, by: 'claude', ask: 'audit login', status: 'done', started: 0, answer: 'SUMMARY: Two issues.', log: [], contextTokens: 900, outputTokens: 40, isHanded: true }],
  }
  const sys = {
    groups: [{ name: 'Claude Code', count: 2, cpu: 40, rssMb: 900, history: [10, 40] }],
    top: [{ pid: 1, group: 'Claude Code', cpu: 40, rssMb: 900, cmd: 'claude' }],
    memTotalMb: 16000, memUsedMb: 8000, load: [1, 1, 1], cores: 8,
  }
  let tab = 'crew'
  on('state.get', (_, e, next) => {
    if (e.key === 'snap') return { value: { value: { shape: 'snap-2', value: { ...SNAP, sys } }, version: 1 } }
    if (e.key === 'threads') return { value: { value: { shape: 'threads-1', value: [thread] }, version: 1 } }
    if (e.key === 'tab') return { value: { value: tab, version: 1 } }
    return next(e)
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    tab = 'crew'
    const crew = await $.ui.mount({ ...PANE, surface })
    expect(await crew.find({ type: 'Text', text: /auth-review/ })).toBeDefined()
    expect(await crew.find({ type: 'Text', text: /Two issues/ })).toBeDefined()
    await crew.unmount()
    tab = 'system'
    const system = await $.ui.mount({ ...PANE, surface })
    expect(await system.find({ type: 'Text', text: /Claude Code/ })).toBeDefined()
    expect(await system.find({ type: 'Text', text: /on 8 cores/ })).toBeDefined()
    await system.unmount()
  }
})
