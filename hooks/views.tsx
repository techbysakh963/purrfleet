import type { Elements } from 'claude-code'

import type { CrewAgent, CrewMode, CrewNote, CrewThread, CrewTurn, Session, Snapshot, Tab } from '../types'
import { NOTEBOOK_CAP, modeLabel, summaryOf } from './crew'
import { activity, ago, clock, ctxPct, cut, hms, isBusy, needsYou, phaseLook, spark, tok, usd } from './fmt'
import type { Group, Item } from './inbox'
import { inbox, tally } from './inbox'
import type { Palette } from './theme'
import { heat, ramp } from './theme'

/** Box, Text and Button: the elements every surface carries, with the same props. */
export type Els = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button'>
type Node = ReturnType<Els['Box']>

export type Acts = {
  tab: (tab: Tab) => void
  select: (sid: string) => void
  filter: (sid: string | null) => void
  copy: (text: string, what: string) => void
  open: (path: string) => void
  stop: (s: Session) => void
  theme: () => void
  scene: () => void
  crewAgent: () => void
  crewMode: () => void
  crewLaunch: (task: string) => void
  crewStop: (thread: string) => void
  crewSend: (thread: string, turn: number) => void
  crewSelect: (thread: string) => void
  crewNew: () => void
  crewModel: (model: string) => void
  crewEffort: (effort: string) => void
  crewFolder: (folder: string) => void
  crewOpen: (key: string) => void
  noteRemove: (folder: string, id: number) => void
  noteApprove: (folder: string, id: number) => void
  openNote: (file: string) => void
  showAllThreads: () => void
  toggleOptions: () => void
  finishTour: () => void
  showAllTurns: (thread: string) => void
  /** jump to a thread in the Crew tab (and mark its answers read) */
  openThread: (thread: string) => void
  /** jump to a project's notebook in the Crew tab */
  openNotebook: (folder: string) => void
}

export type View = {
  snap: Snapshot
  tab: Tab
  selected: string | null
  feedFilter: string | null
  width: number
  self: string
  p: Palette
  scene: string
  /** the cat: pixel art, drawn only where the surface has a Raster (the terminal) */
  hero: Node | null
  threads: readonly CrewThread[]
  crewSel: string | null
  crewAgent: CrewAgent
  crewMode: CrewMode
  /** the launch box: an Input, where the surface has one */
  launcher: Node | null
  /** the turn whose whole answer is open: "thread#n" */
  crewOpenTurn: string | null
  crewShowAll: boolean
  crewOptions: boolean
  /** the new-thread settings in one line: model · effort · folder */
  crewSummary: string
  toured: boolean
  crewAllTurns: string | null
  notebook: { folder: string; file: string; notes: readonly CrewNote[] }
  /** every project's notebook: pending suggestions show up on Live */
  notebooks: Readonly<Record<string, readonly CrewNote[]>>
}

const TABS: { tab: Tab; label: string; key: string }[] = [
  { tab: 'live', label: 'Live', key: '1' },
  { tab: 'feed', label: 'Feed', key: '2' },
  { tab: 'crew', label: 'Crew', key: '3' },
  { tab: 'cost', label: 'Cost', key: '4' },
  { tab: 'system', label: 'System', key: '5' },
  { tab: 'actions', label: 'Actions', key: '6' },
]

/**
 * FLEET's one visual grammar: each mark means one thing, everywhere.
 *   ▲ needs you   × failed   ◆ to read   ● working   ○ quiet
 */
export function mark(v: { p: Palette }, state: 'need' | 'error' | 'failed' | 'read' | 'work' | 'quiet'): { glyph: string; color: string } {
  const { p } = v
  switch (state) {
    case 'need':
      return { glyph: '▲', color: p.warn }
    case 'error':
      return { glyph: '▲', color: p.bad }
    case 'failed':
      return { glyph: '×', color: p.bad }
    case 'read':
      return { glyph: '◆', color: p.cyan }
    case 'work':
      return { glyph: '●', color: p.accent }
    default:
      return { glyph: '○', color: p.dim }
  }
}

const sessionMark = (v: { p: Palette }, s: Session) =>
  mark(v, s.phase === 'error' ? 'error' : needsYou(s) ? 'need' : isBusy(s) ? 'work' : 'quiet')

/** The colour a session keeps everywhere: its legend dot, its band dot, its feed name. */
export const sessionColor = (s: Session, p: Palette): string =>
  needsYou(s) ? phaseLook(s.phase, p).color : isBusy(s) ? p.accent : s.phase === 'ready' ? p.ok : p.cyan

function Grad(E: Els, text: string, from: string, to: string, bold = false) {
  const { Text } = E
  return (
    <Text weight={bold ? 'bold' : 'regular'}>
      {ramp(text, from, to).map(c => (
        <Text color={c.color}>{c.ch}</Text>
      ))}
    </Text>
  )
}

/** A fuel gauge: filled cells shade green → yellow → red along the bar. */
function Gauge(E: Els, pct: number, cells: number, p: Palette) {
  const { Text } = E
  const full = Math.round((Math.max(0, Math.min(100, pct)) / 100) * cells)
  return (
    <Text>
      {Array.from({ length: cells }, (_, i) =>
        i < full ? <Text color={heat(i / (cells - 1), p)}>■</Text> : <Text color={p.border}>□</Text>,
      )}
    </Text>
  )
}

const Sep = (E: Els, p: Palette) => <E.Text color={p.border}> │ </E.Text>

export function Pane(E: Els, v: View, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const count = tally(inbox(v.snap.sessions, v.threads, v.notebooks))
  const unread = v.threads.filter(t => t.turns.some(u => u.unread)).length
  const crewBusy = v.threads.filter(t => t.status === 'running').length
  const need = mark(v, 'need')
  const work = mark(v, 'work')
  const read = mark(v, 'read')

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {Grad(E, 'FLEET', p.accent, p.cyan, true)}
          {TABS.map(t => (
            <Button key={`tab-${t.tab}`} plain hotkey={t.key} onPress={() => act.tab(t.tab)}>
              {t.tab === v.tab ? (
                <Text color={p.text} weight="bold" underline>
                  {t.label}
                </Text>
              ) : (
                <Text color={p.dim}>{t.label}</Text>
              )}
              {t.tab === 'live' && count.need > 0 ? <Text color={need.color}> {need.glyph}{count.need}</Text> : ''}
              {t.tab === 'live' && count.read > 0 ? <Text color={read.color}> {read.glyph}{count.read}</Text> : ''}
              {t.tab === 'crew' && crewBusy > 0 ? <Text color={work.color}> {work.glyph}{crewBusy}</Text> : ''}
              {t.tab === 'crew' && unread > 0 ? <Text color={read.color}> {read.glyph}{unread}</Text> : ''}
            </Button>
          ))}
        </Box>
        <Box flexDirection="row" columnGap={2}>
          <Button key="cycle-theme" plain hotkey="t" onPress={act.theme}>
            <Text color={p.dim}>t theme</Text>
          </Button>
          <Button key="cycle-scene" plain hotkey="a" onPress={act.scene}>
            <Text color={p.dim}>a cat</Text>
          </Button>
        </Box>
      </Box>
      <Text color={p.border}>{'─'.repeat(Math.max(10, v.width))}</Text>
      {v.toured ? null : Tour(E, v, act)}
      {(v.tab === 'live' || v.tab === 'needs') && Live(E, v, act)}
      {v.tab === 'feed' && Feed(E, v, act)}
      {v.tab === 'crew' && Crew(E, v, act)}
      {v.tab === 'cost' && CostView(E, v)}
      {v.tab === 'system' && SystemView(E, v)}
      {v.tab === 'actions' && Actions(E, v, act)}
    </Box>
  )
}

// ── the grid: every list in FLEET is rows of mark · who · what · age ──────────

type Mark = { glyph: string; color: string }

/** The `who` column: 22 wide where there is room, 16 below. One rule for every row. */
const whoWidth = (width: number): number => (width >= 84 ? 22 : 16)

/** A helper is "agent › thread"; when it must be cut, the thread name goes first, never the agent. */
export function fitWho(who: string, max: number): string {
  if (who.length <= max) return who
  const i = who.indexOf(' › ')
  if (i > 0 && i + 4 < max) return `${who.slice(0, i + 3)}${cut(who.slice(i + 3), max - i - 3)}`
  return cut(who, max)
}

/** One row of the grid. Colour lives in the mark alone; `what` is plain text (dim when quiet). */
function GridRow(
  E: Els,
  v: View,
  o: { key: string; m: Mark; who: string; what: string; age?: string; quiet?: boolean; press?: () => void },
) {
  const { Text, Button } = E
  const { p } = v
  const ww = whoWidth(v.width)
  const age = o.age ?? ''
  const room = Math.max(8, v.width - 2 - ww - 5)
  const body = [
    <Text color={o.m.color}>{o.m.glyph} </Text>,
    <Text color={o.quiet ? p.dim : p.text}>{fitWho(o.who, ww - 1).padEnd(ww)}</Text>,
    <Text color={o.quiet ? p.dim : p.text}>{cut(o.what.replace(/\s+/g, ' '), room).padEnd(room)}</Text>,
    <Text color={p.dim}> {age.padStart(4)}</Text>,
  ]
  return o.press ? (
    <Button key={o.key} plain onPress={o.press}>
      {body}
    </Button>
  ) : (
    <Text wrap="truncate-end">{body}</Text>
  )
}

/** Detail hangs under its row behind a rail in the row's colour: no boxes, so nothing moves. */
function Rail(E: Els, color: string, lines: readonly (Node | null)[]) {
  const { Box, Text } = E
  return (
    <Box flexDirection="column">
      {lines
        .filter(x => x !== null)
        .map(line => (
          <Box flexDirection="row">
            <Text color={color}>{'  │ '}</Text>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              {line}
            </Box>
          </Box>
        ))}
    </Box>
  )
}

/** A short age for the right edge: 12s, 4m, 3h, 2d. Never wider than four columns. */
export const age = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86_400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86_400)}d`
}

/** Helper answers are markdown; on the grid, bold markers are noise. */
const plain = (text: string): string => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')

/** A labelled rail line: "session   opus · context 62% · …". */
function Labeled(E: Els, v: View, label: string, value: Node | string, wrap = false) {
  const { Text } = E
  const { p } = v
  return (
    <Text wrap={wrap ? 'wrap' : 'truncate-end'}>
      <Text color={p.dim}>{label.padEnd(14)}</Text>
      {typeof value === 'string' ? <Text color={p.text}>{value}</Text> : value}
    </Text>
  )
}

/** Plain-word actions on one line: the last line of whatever they act on. */
function ActionLine(E: Els, v: View, items: ({ key: string; label: string; color?: string; hotkey?: string; press: () => void } | null)[]) {
  const { Box, Text, Button } = E
  const { p } = v
  const list = items.filter(x => x !== null)
  return (
    <Box flexDirection="row" flexWrap="wrap">
      {list.flatMap((x, i) => [
        i ? <Text color={p.dim}> · </Text> : null,
        <Button key={x.key} plain {...(x.hotkey ? { hotkey: x.hotkey } : {})} onPress={x.press}>
          <Text color={x.color ?? p.text}>{x.label}</Text>
        </Button>,
      ])}
    </Box>
  )
}

const sessionWhat = (s: Session): string =>
  activity(s) + (s.agents.length ? ` · ${s.agents.length} agent${s.agents.length === 1 ? '' : 's'}` : '')

/** A session's row; opened, its detail and actions hang under it. */
function SessionRow(E: Els, v: View, s: Session, act: Acts) {
  const { Box, Text } = E
  const { p } = v
  const m = sessionMark(v, s)
  const row = GridRow(E, v, {
    key: `s-${s.sid}`,
    m,
    who: s.name + (s.sid === v.self ? ' (here)' : ''),
    what: sessionWhat(s),
    age: age(v.snap.now - s.phaseSince),
    quiet: !needsYou(s) && !isBusy(s),
    press: () => act.select(s.sid),
  })
  if (s.sid !== v.selected) return row
  const pct = ctxPct(s)
  const recent = v.snap.feed
    .filter(f => f.sid === s.sid)
    .slice(-3)
    .reverse()
    .map(f => `${f.tool} ${f.detail}`.trim())
  const session = (
    <Text>
      <Text color={p.text}>{s.model} · context </Text>
      <Text color={pct >= 80 ? heat(pct / 100, p) : p.text}>{pct}%</Text>
      <Text color={p.text}> · </Text>
      <Text color={p.gold}>{usd(s.cost)}</Text>
      <Text color={p.text}> · up {hms(v.snap.now - s.startedAt)}</Text>
      {s.branch ? <Text color={p.text}> · {cut(s.branch, 24)}</Text> : ''}
      {s.added ? <Text color={p.ok}> · +{s.added}</Text> : ''}
      {s.removed ? <Text color={p.bad}> −{s.removed}</Text> : ''}
    </Text>
  )
  return (
    <Box flexDirection="column">
      {row}
      {Rail(E, m.color, [
          needsYou(s) ? Labeled(E, v, s.phase === 'error' ? 'error' : 'waiting', activity(s), true) : null,
          Labeled(E, v, 'session', session),
          Labeled(E, v, 'folder', s.cwd.replace(/^\/home\/[^/]+/, '~')),
          recent.length ? Labeled(E, v, 'recent', recent.join(' · ')) : null,
          ...s.agents.map((a, i) =>
            Labeled(E, v, i === 0 ? 'agents' : '', `${a.type} · ${age(v.snap.now - a.since)}${a.tokens ? ` · ${tok(a.tokens)} tokens` : ''}${a.task ? ` · ${a.task}` : ''}`),
          ),
          ActionLine(E, v, [
            { key: 'a-id', label: 'copy id', hotkey: 'c', press: () => act.copy(s.sid, 'session id') },
            { key: 'a-dir', label: 'copy folder', hotkey: 'f', press: () => act.copy(s.cwd, 'folder') },
            { key: 'a-open', label: 'open transcript', hotkey: 'o', press: () => act.open(s.transcript) },
            s.sid === v.self ? null : { key: 'a-stop', label: 'stop…', color: p.bad, hotkey: 'x', press: () => act.stop(s) },
          ]),
        ])}
    </Box>
  )
}

/**
 * Who to look at first: needs-you, then busy, then the rest. Within each group the
 * order holds still (oldest session first), so rows don't jump on every phase change.
 */
export const ordered = (sessions: readonly Session[]): Session[] =>
  [...sessions].sort((a, b) => {
    const rank = (s: Session) => (needsYou(s) ? 0 : isBusy(s) ? 1 : 2)
    return rank(a) - rank(b) || a.startedAt - b.startedAt || a.sid.localeCompare(b.sid)
  })

/** Three short cards the first time FLEET opens; the full guide stays in Actions. */
function Tour(E: Els, v: View, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const cards: [string, string][] = [
    ['move around', 'ctrl+x tab focuses this pane · 1-6 switch tabs · t theme · a the cat'],
    ['the marks', '▲ needs you · × failed · ◆ to read · ● working · ○ quiet, the same everywhere'],
    ['the crew', 'type /crew <task> to hand work to Codex or agy; Claude can too ("catch me up" works)'],
  ]
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={p.text} weight="bold">
        WELCOME TO FLEET
      </Text>
      {cards.map(([title, body]) => (
        <Text wrap="wrap">
          <Text color={p.dim}>{title.padEnd(12)}</Text>
          <Text color={p.text}>{body}</Text>
        </Text>
      ))}
      <Button key="tour-done" plain onPress={act.finishTour}>
        <Text color={p.ok}>got it</Text>
        <Text color={p.dim}> · /fleet help shows the full guide any time</Text>
      </Button>
    </Box>
  )
}

/** The headline: what the whole fleet wants from you. The band says the same words. */
export function headline(items: readonly Item[]): { state: Parameters<typeof mark>[1]; text: string }[] {
  const count = tally(items)
  const out: { state: Parameters<typeof mark>[1]; text: string }[] = []
  if (count.need) out.push({ state: 'need', text: `${count.need} need${count.need === 1 ? 's' : ''} you` })
  if (count.read) out.push({ state: 'read', text: `${count.read} to read` })
  if (count.work) out.push({ state: 'work', text: `${count.work} working` })
  if (out.length === 0) out.push({ state: 'quiet', text: 'all quiet · the cat is napping' })
  else if (count.quiet) out.push({ state: 'quiet', text: `${count.quiet} quiet` })
  return out
}

function Headline(E: Els, v: View, items: readonly Item[], right: Node) {
  const { Box, Text } = E
  const { p } = v
  const parts = headline(items)
  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text wrap="truncate-end">
        {parts.flatMap((x, i) => {
          const m = mark(v, x.state)
          const seg = (
            <Text color={m.color} weight={x.state === 'need' ? 'bold' : 'regular'}>
              {m.glyph} {x.text}
            </Text>
          )
          return i ? [<Text color={p.dim}> · </Text>, seg] : [seg]
        })}
      </Text>
      {right}
    </Box>
  )
}

/** The keys, always the pane's last line. */
function Keys(E: Els, v: View, text: string) {
  const { Box, Text } = E
  return (
    <Box marginTop={1}>
      <Text color={v.p.dim} wrap="truncate-end">
        {text}
      </Text>
    </Box>
  )
}

const HEADS: Record<Group, string> = { need: 'NEEDS YOU', read: 'TO READ', work: 'WORKING', quiet: 'QUIET' }

/** One row for a crew item in the inbox; pressing it opens it in the Crew tab. */
function CrewRow(E: Els, v: View, x: Exclude<Item, { kind: 'session' }>, act: Acts) {
  const now = v.snap.now
  if (x.kind === 'notes') {
    return GridRow(E, v, {
      key: `inbox-${x.key}`,
      m: mark(v, 'read'),
      who: 'notebook',
      what: `${x.count} suggestion${x.count === 1 ? '' : 's'} to keep or reject · ${x.folder.replace(/^\/home\/[^/]+/, '~')}`,
      press: () => act.openNotebook(x.folder),
    })
  }
  const who = `${x.t.agent} › ${x.t.name}`
  if (x.kind === 'running') {
    const u = x.u
    return GridRow(E, v, {
      key: `inbox-${x.key}`,
      m: mark(v, 'work'),
      who,
      what: u?.log[u.log.length - 1] ?? 'working…',
      age: u ? age(now - u.started) : '',
      press: () => act.openThread(x.t.name),
    })
  }
  const failed = x.u.status === 'failed'
  return GridRow(E, v, {
    key: `inbox-${x.key}`,
    m: mark(v, failed ? 'failed' : 'read'),
    who,
    what: failed ? `failed: ${x.u.log[x.u.log.length - 1] ?? (summaryOf(x.u.answer) || 'no answer')}` : summaryOf(x.u.answer) || 'answered',
    age: age(now - (x.u.ended ?? now)),
    press: () => act.openThread(x.t.name),
  })
}

const CAT_COLS = 26 // the compact cat beside the rows (Raster columns)

function Live(E: Els, v: View, act: Acts) {
  const { Box, Text } = E
  const { p } = v
  // the rows come first; the cat sits beside them when there is room, else below
  const isBeside = v.hero !== null && v.width >= 90 // narrower, the rows need the room
  const rowsView = isBeside ? { ...v, width: v.width - CAT_COLS - 2 } : v
  const items = inbox(v.snap.sessions, v.threads, v.notebooks)
  // group headings only when there is more than one kind of thing to look at
  const isGrouped = new Set(items.map(x => x.group)).size > 1
  const rows: Node[] = [
    Headline(E, rowsView, items, <Text color={p.gold}>{usd(v.snap.cost.today)} today</Text>),
    <Text> </Text>,
  ]
  let last: Group | null = null
  for (const x of items) {
    if (isGrouped && x.group !== last) {
      const color = x.group === 'need' ? p.warn : x.group === 'read' ? p.cyan : x.group === 'work' ? p.accent : p.dim
      rows.push(
        <Text color={color} weight="bold">
          {HEADS[x.group]}
        </Text>,
      )
      last = x.group
    }
    rows.push(x.kind === 'session' ? SessionRow(E, rowsView, x.s, act) : CrewRow(E, rowsView, x, act))
  }

  return (
    <Box flexDirection="column">
      {isBeside ? (
        <Box flexDirection="row">
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            {rows}
          </Box>
          <Box marginLeft={2} flexShrink={0}>
            {v.hero}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {rows}
          {v.hero ? <Box marginTop={1}>{v.hero}</Box> : null}
        </Box>
      )}
      {Keys(E, v, 'tab move · enter open · 1-6 tabs · t theme · a cat · /fleet close')}
    </Box>
  )
}

/**
 * Runs of three or more calls of one kind collapse into a single line ("read 12
 * files: a, b, c…"), so a burst of reads doesn't flood the feed.
 */
type FeedItem = Snapshot['feed'][number]
const VERB: Record<string, string> = { read: 'read', write: 'edited', run: 'ran', web: 'fetched', agent: 'started' }
function bursts(items: readonly FeedItem[]): FeedItem[] {
  const out: FeedItem[] = []
  let i = 0
  while (i < items.length) {
    const first = items[i]!
    const k = kindOf(first.tool)
    let j = i
    while (j + 1 < items.length && kindOf(items[j + 1]!.tool) === k && items[j + 1]!.agent === first.agent) j++
    const run = items.slice(i, j + 1)
    if (run.length >= 3 && k !== 'ask' && k !== 'other') {
      const names = [...new Set(run.map(f => f.detail).filter(Boolean))]
      const noun = k === 'run' ? 'commands' : k === 'agent' ? 'agents' : k === 'web' ? 'pages' : 'files'
      out.push({
        ...first,
        tool: `${VERB[k] ?? k} ${run.length} ${noun}`,
        detail: names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : ''),
      })
    } else out.push(...run)
    i = j + 1
  }
  return out
}

type Kind = { glyph: string; color: (p: Palette) => string; label: string }
const KINDS: Record<string, Kind> = {
  read: { glyph: '·', color: p => p.cyan, label: 'reads' },
  write: { glyph: '■', color: p => p.gold, label: 'edits' },
  run: { glyph: '$', color: p => p.accent, label: 'commands' },
  agent: { glyph: '+', color: p => p.violet, label: 'agents' },
  web: { glyph: '◎', color: p => p.ok, label: 'web' },
  ask: { glyph: '▲', color: p => p.warn, label: 'questions' },
  other: { glyph: '›', color: p => p.dim, label: 'other' },
}
const kindOf = (tool: string): string =>
  /^read \d|^(Read|Glob|Grep|LS|NotebookRead)$/.test(tool)
    ? 'read'
    : /^edited \d/.test(tool)
      ? 'write'
      : /^ran \d/.test(tool)
        ? 'run'
        : /^fetched \d/.test(tool)
          ? 'web'
          : /^started \d/.test(tool)
            ? 'agent'
            : kindOfTool(tool)

const kindOfTool = (tool: string): string =>
  /^(Read|Glob|Grep|LS|NotebookRead)$/.test(tool)
    ? 'read'
    : /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)
      ? 'write'
      : /^(Bash|BashOutput|KillShell|Monitor)$/.test(tool)
        ? 'run'
        : /^(Agent|Task|Workflow|SendMessage)$/.test(tool)
          ? 'agent'
          : /^(WebFetch|WebSearch)$/.test(tool) || tool.startsWith('mcp__')
            ? 'web'
            : /^(AskUserQuestion|ExitPlanMode)$/.test(tool)
              ? 'ask'
              : 'other'

function Feed(E: Els, v: View, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const colorOf = new Map(v.snap.sessions.map(s => [s.sid, sessionColor(s, p)]))
  const all = v.snap.feed.filter(f => !v.feedFilter || f.sid === v.feedFilter)
  // the collector counts every call of the last 10 minutes; the feed itself keeps only a few
  const tally = new Map<string, number>()
  let recentCount = 0
  if (v.snap.tally) {
    for (const [sid, tools] of Object.entries(v.snap.tally)) {
      if (v.feedFilter && sid !== v.feedFilter) continue
      for (const [tool, n] of Object.entries(tools)) {
        tally.set(kindOf(tool), (tally.get(kindOf(tool)) ?? 0) + n)
        recentCount += n
      }
    }
  } else {
    for (const f of all.filter(x => v.snap.now - x.t < 600)) {
      tally.set(kindOf(f.tool), (tally.get(kindOf(f.tool)) ?? 0) + 1)
      recentCount += 1
    }
  }
  const items = all.slice(-24).reverse()
  const w = Math.max(30, v.width)

  // runs of the same session read as one block under its name
  const blocks: { sid: string; name: string; items: typeof items }[] = []
  for (const f of items) {
    const last = blocks[blocks.length - 1]
    if (last && last.sid === f.sid) last.items.push(f)
    else blocks.push({ sid: f.sid, name: f.name, items: [f] })
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Button key="f-all" plain onPress={() => act.filter(null)}>
          <Text color={v.feedFilter === null ? p.text : p.dim} weight={v.feedFilter === null ? 'bold' : 'regular'} underline={v.feedFilter === null}>all</Text>
        </Button>
        {v.snap.sessions.map(s => (
          <Button key={`f-${s.sid}`} plain onPress={() => act.filter(s.sid)}>
            <Text color={v.feedFilter === s.sid ? p.text : p.dim} weight={v.feedFilter === s.sid ? 'bold' : 'regular'} underline={v.feedFilter === s.sid}>
              {cut(s.name, 16)}
            </Text>
          </Button>
        ))}
      </Box>
      <Text wrap="truncate-end">
        <Text color={p.dim}>last 10 min </Text>
        <Text color={p.text}>{recentCount}</Text>
        <Text color={p.dim}> tool calls</Text>
        {[...tally]
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => {
            const kind = KINDS[k] ?? KINDS.other!
            return (
              <Text>
                <Text color={p.border}> · </Text>
                <Text color={kind.color(p)}>
                  {kind.glyph} {n}
                </Text>
                <Text color={p.dim}> {kind.label}</Text>
              </Text>
            )
          })}
      </Text>
      {items.length === 0 ? <Text color={p.dim}>No activity yet. Tool calls stream in here as they happen.</Text> : null}
      {blocks.map(b => (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            <Text color={colorOf.get(b.sid) ?? p.dim}>● </Text>
            <Text color={p.text} weight="bold">
              {b.name}
            </Text>
          </Text>
          {bursts(b.items).map(f => {
            const kind = KINDS[kindOf(f.tool)] ?? KINDS.other!
            return (
              <Text wrap="truncate-end">
                <Text color={p.dim}>{ago(v.snap.now - f.t).padStart(6)} </Text>
                <Text color={p.border}>{f.agent ? '┊ ' : '│ '}</Text>
                <Text color={kind.color(p)}>{kind.glyph} </Text>
                <Text color={f.agent ? p.violet : p.text}>{f.tool}</Text>
                <Text color={p.dim}> {cut(f.detail, w - 14 - f.tool.length)}</Text>
              </Text>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}


/** An answer's own shape: its SUMMARY, KEY POINTS and CONFIDENCE sections, when it has them. */
export function sections(answer: string): { summary: string; points: string[]; confidence: string } {
  const out = { summary: '', points: [] as string[], confidence: '' }
  let at: 'summary' | 'points' | 'confidence' | 'other' | null = null
  for (const raw of answer.split('\n')) {
    const line = raw.trim()
    const head = line.match(/^\**(SUMMARY|KEY POINTS|CONFIDENCE|DETAILS|NOTES?)\**:\s*(.*)$/i)
    if (head) {
      const name = (head[1] ?? '').toUpperCase()
      at = name === 'SUMMARY' ? 'summary' : name === 'KEY POINTS' ? 'points' : name === 'CONFIDENCE' ? 'confidence' : 'other'
      const rest = head[2] ?? ''
      if (rest && at === 'summary') out.summary = rest
      if (rest && at === 'confidence') out.confidence = rest
      if (rest && at === 'points') out.points.push(rest)
      continue
    }
    if (!line) continue
    if (at === 'summary') out.summary = `${out.summary} ${line}`.trim()
    else if (at === 'points') out.points.push(line.replace(/^[-*•]\s*|^\d+[.)]\s*/, ''))
    else if (at === 'confidence') out.confidence = `${out.confidence} ${line}`.trim()
  }
  if (!out.summary) out.summary = summaryOf(answer)
  return out
}

const threadMark = (v: View, t: CrewThread): Mark =>
  t.status === 'running'
    ? mark(v, 'work')
    : t.turns.some(u => u.unread && u.status === 'failed')
      ? mark(v, 'failed')
      : t.turns.some(u => u.unread)
        ? mark(v, 'read')
        : mark(v, 'quiet')

/** One thread on the grid; the open one shows its latest turn in the answer's own shape. */
function ThreadView(E: Els, v: View, t: CrewThread, act: Acts) {
  const { Box, Text } = E
  const { p } = v
  const isOpen = t.name === v.crewSel
  const last = t.turns[t.turns.length - 1]
  const m = threadMark(v, t)
  const what = !last
    ? 'no messages yet'
    : last.status === 'running'
      ? (last.log[last.log.length - 1] ?? 'working…')
      : last.status === 'failed'
        ? `failed: ${last.log[last.log.length - 1] ?? 'no answer'}`
        : summaryOf(last.answer) || last.status
  const row = GridRow(E, v, {
    key: `th-${t.name}`,
    m,
    who: `${t.agent} › ${t.name}`,
    what,
    age: last ? age(v.snap.now - (last.ended ?? last.started)) : '',
    quiet: m.glyph === mark(v, 'quiet').glyph,
    press: () => act.crewSelect(t.name),
  })
  if (!isOpen || !last) return row
  const isFull = v.crewOpenTurn === `${t.name}#${last.n}`
  const sec = sections(last.answer)
  const meta = [
    `turn ${last.n} of ${t.turns.length}`,
    modeLabel(t.agent, t.mode),
    t.model !== 'default' ? t.model : '',
    t.effort !== 'default' ? `${t.effort} effort` : '',
    last.contextTokens ? `${tok(last.contextTokens)} processed · ${tok(last.outputTokens)} written` : '',
    t.compactions ? `compacted ${t.compactions}×` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const earlier = v.crewAllTurns === t.name ? t.turns.slice(0, -1) : []
  return (
    <Box flexDirection="column">
      {row}
      {Rail(E, m.color, [
          ...earlier.map(u => Labeled(E, v, `turn ${u.n}`, `${u.by === 'claude' ? 'Claude' : 'you'}: ${u.ask.replace(/\s+/g, ' ')} → ${plain(summaryOf(u.answer)) || u.status}`)),
          Labeled(E, v, last.by === 'claude' ? 'Claude asked' : 'you asked', last.ask.replace(/\s+/g, ' ')),
          ...(last.status === 'running'
            ? last.log.slice(-3).map((l, i) => Labeled(E, v, i === 0 ? 'doing' : '', l))
            : last.status === 'failed' || last.status === 'stopped'
              ? [Labeled(E, v, last.status, last.log[last.log.length - 1] ?? 'no answer', true)]
              : []),
          last.answer && !isFull ? Labeled(E, v, 'SUMMARY', plain(sec.summary), true) : null,
          ...(last.answer && !isFull ? sec.points.slice(0, 5).map((pt, i) => Labeled(E, v, i === 0 ? 'KEY POINTS' : '', `${i + 1}  ${plain(pt)}`)) : []),
          last.answer && !isFull && sec.confidence ? Labeled(E, v, 'CONFIDENCE', plain(sec.confidence)) : null,
          ...(isFull
            ? last.answer
                .trim()
                .split('\n')
                .map(line => (
                  <Text wrap="wrap" color={/^(SUMMARY|KEY POINTS|CONFIDENCE|DETAILS|NOTE):/i.test(line) ? p.dim : p.text}>
                    {line || ' '}
                  </Text>
                ))
            : []),
          <Text color={p.dim} wrap="truncate-end">
            {meta}
          </Text>,
          ActionLine(E, v, [
            last.status === 'running' ? { key: `stop-${t.name}`, label: 'stop', color: p.bad, press: () => act.crewStop(t.name) } : null,
            last.answer
              ? { key: `open-${t.name}-${last.n}`, label: isFull ? 'show the summary' : 'read full answer', press: () => act.crewOpen(`${t.name}#${last.n}`) }
              : null,
            last.status !== 'running' && !last.isHanded
              ? { key: `send-${t.name}-${last.n}`, label: 'send to Claude', press: () => act.crewSend(t.name, last.n) }
              : null,
            last.answer ? { key: `copy-${t.name}-${last.n}`, label: 'copy', color: p.dim, press: () => act.copy(last.answer, `${t.name} answer`) } : null,
            t.turns.length > 1
              ? {
                  key: `turns-${t.name}`,
                  label: v.crewAllTurns === t.name ? 'hide earlier turns' : `${t.turns.length - 1} earlier turn${t.turns.length === 2 ? '' : 's'}`,
                  color: p.dim,
                  press: () => act.showAllTurns(t.name),
                }
              : null,
          ]),
          last.isHanded && last.status !== 'running' ? <Text color={p.dim}>Claude has this answer</Text> : null,
        ])}
    </Box>
  )
}

/** The crew's two memory layers for the project in view: the notebook, then the vault. */
function Notebook(E: Els, v: View, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const notes = v.notebook.notes
  const pending = notes.filter(n => n.pending)
  const kept = notes.filter(n => !n.pending).sort((a, b) => b.at - a.at)
  const isOpen = v.crewOpenTurn === 'notebook'
  const used = kept.reduce((n, x) => n + x.text.length + 3, 0)
  const folder = v.notebook.folder.replace(/^\/home\/[^/]+/, '~')
  const head = (
    <Button key="notebook" plain onPress={() => act.crewOpen('notebook')}>
      <Text color={p.dim}>{isOpen ? '▾ ' : '▸ '}</Text>
      <Text color={p.dim} weight="bold">
        NOTEBOOK
      </Text>
      <Text color={p.dim}>
        {' '}
        · {kept.length} fact{kept.length === 1 ? '' : 's'}
      </Text>
      {pending.length ? <Text color={mark(v, 'read').color}> · ◆ {pending.length} suggestion{pending.length === 1 ? '' : 's'}</Text> : ''}
      <Text color={p.dim}> · {folder}</Text>
    </Button>
  )
  if (!isOpen) return head
  const narrow = { ...v, width: Math.max(30, v.width - 9) }
  return (
    <Box flexDirection="column">
      {head}
      <Text color={used > NOTEBOOK_CAP * 0.8 ? p.warn : p.dim}>
        {'  '}
        {used.toLocaleString('en-US')} of {NOTEBOOK_CAP.toLocaleString('en-US')} characters · sent with every helper message
      </Text>
      <Text> </Text>
      <Text color={p.dim} weight="bold">
        SUGGESTED <Text weight="regular">· not sent to anyone until you keep it</Text>
      </Text>
      {pending.length === 0 ? <Text color={p.dim}>  nothing waiting</Text> : null}
      {pending.map(n => (
        <Box flexDirection="column">
          {GridRow(E, v, { key: `note-${n.id}`, m: mark(v, 'read'), who: n.by, what: n.text, age: age(v.snap.now - n.at) })}
          {Rail(E, mark(v, 'read').color, [
            ActionLine(E, v, [
              { key: `note-ok-${n.id}`, label: 'keep', color: p.ok, press: () => act.noteApprove(v.notebook.folder, n.id) },
              { key: `note-x-${n.id}`, label: 'reject', color: p.bad, press: () => act.noteRemove(v.notebook.folder, n.id) },
            ]),
          ])}
        </Box>
      ))}
      <Text> </Text>
      <Text color={p.dim} weight="bold">
        KEPT <Text weight="regular">· newest first</Text>
      </Text>
      {kept.length === 0 ? <Text color={p.dim}>  empty: helpers suggest NOTE: lines, and Claude pins facts with crew_note</Text> : null}
      {kept.map(n => (
        <Box flexDirection="row">
          {GridRow(E, narrow, { key: `kept-${n.id}`, m: { glyph: ' ', color: p.dim }, who: n.by, what: n.text, age: age(v.snap.now - n.at) })}
          <Button key={`note-del-${n.id}`} plain onPress={() => act.noteRemove(v.notebook.folder, n.id)}>
            <Text color={p.dim}> delete</Text>
          </Button>
        </Box>
      ))}
      <Text> </Text>
      <Text color={p.dim} weight="bold">
        VAULT <Text weight="regular">· never sent whole · attach a note to one message</Text>
      </Text>
      {v.notebook.file ? (
        <Box flexDirection="column">
          <Text color={p.dim} wrap="truncate-end">
            {'  '}
            {v.notebook.file.replace(/^\/home\/[^/]+/, '~').replace(/\/notebook\.md$/, '')}
          </Text>
          <Text color={p.dim}>  notebook.md mirrors this list both ways; tick a line in Obsidian to keep it</Text>
          {Rail(E, p.dim, [ActionLine(E, v, [{ key: 'notebook-obsidian', label: 'open in Obsidian', press: () => act.openNote(v.notebook.file) }])])}
        </Box>
      ) : (
        <Text color={p.dim}>  no vault set up</Text>
      )}
    </Box>
  )
}

function Crew(E: Els, v: View, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const list = [...v.threads].sort((a, b) => b.updated - a.updated)
  const target = v.threads.find(t => t.name === v.crewSel)
  // what is new (running, unread, or open right now) shows; what you've seen folds away
  const isFresh = (t: CrewThread) => t.status === 'running' || t.turns.some(u => u.unread) || t.name === v.crewSel
  const fresh = list.filter(isFresh)
  const earlier = list.filter(t => !isFresh(t))
  const running = list.filter(t => t.status === 'running').length
  const toRead = list.filter(t => t.turns.some(u => u.unread && u.status !== 'failed')).length
  const failed = list.filter(t => t.turns.some(u => u.unread && u.status === 'failed')).length
  const kept = v.notebook.notes.filter(n => !n.pending).length
  const pending = v.notebook.notes.length - kept
  const parts: Node[] = []
  const seg = (state: Parameters<typeof mark>[1], text: string) => {
    const m = mark(v, state)
    parts.push(
      <Text color={m.color}>
        {m.glyph} {text}
      </Text>,
    )
  }
  if (running) seg('work', `${running} running`)
  if (toRead) seg('read', `${toRead} to read`)
  if (failed) seg('failed', `${failed} failed`)
  if (earlier.length) parts.push(<Text color={p.dim}>{earlier.length} earlier</Text>)
  if (parts.length === 0) parts.push(<Text color={p.dim}>no threads yet</Text>)
  const where = target
    ? `to ${target.agent} › ${target.name} · ${modeLabel(target.agent, target.mode)}`
    : `to ${v.crewAgent} · ${modeLabel(v.crewAgent, v.crewMode)} · ${v.crewSummary} · new thread`

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">{parts.flatMap((x, i) => (i ? [<Text color={p.dim}> · </Text>, x] : [x]))}</Text>
        <Text color={p.dim}>
          notebook: {kept} fact{kept === 1 ? '' : 's'}
          {pending ? <Text color={mark(v, 'read').color}> · ◆ {pending} suggestion{pending === 1 ? '' : 's'}</Text> : ''}
        </Text>
      </Box>
      <Text> </Text>
      <Text color={p.dim} weight="bold">
        ASK
      </Text>
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text color={p.dim}>{'  '}</Text>
          <Text color={(target ?? { mode: v.crewMode }).mode === 'edit' ? p.warn : p.text}>{where}</Text>
        </Text>
        <Box flexDirection="row" columnGap={2}>
          {target ? (
            <Button key="crew-new" plain hotkey="n" onPress={act.crewNew}>
              <Text color={p.dim}>n new thread</Text>
            </Button>
          ) : (
            <Button key="crew-agent" plain hotkey="g" onPress={act.crewAgent}>
              <Text color={p.dim}>g helper</Text>
            </Button>
          )}
          {target ? null : (
            <Button key="crew-mode" plain hotkey="m" onPress={act.crewMode}>
              <Text color={p.dim}>m mode</Text>
            </Button>
          )}
          {target ? null : (
            <Button key="crew-options" plain hotkey="o" onPress={act.toggleOptions}>
              <Text color={p.dim}>o {v.crewOptions ? '▾' : '▸'} options</Text>
            </Button>
          )}
        </Box>
      </Box>
      {v.launcher ?? <Text color={p.dim}>  (the input box needs the terminal or the desktop app)</Text>}
      {list.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={p.dim}>No threads yet. Type a task above, or ask Claude:</Text>
          <Text color={p.text}> "open a codex thread 'auth-review' and have it audit the login flow"</Text>
          <Text color={p.dim}>Threads remember their conversation; long ones are compacted into a brief (some detail is lost).</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {fresh.length ? (
            <Text color={p.dim} weight="bold">
              NEW
            </Text>
          ) : null}
          {fresh.map(t => ThreadView(E, v, t, act))}
          {earlier.length ? (
            <Box marginTop={fresh.length ? 1 : 0}>
              <Button key="threads-all" plain onPress={act.showAllThreads}>
                <Text color={p.dim}>{v.crewShowAll ? '▾ ' : '▸ '}</Text>
                <Text color={p.dim} weight="bold">
                  EARLIER
                </Text>
                <Text color={p.dim}> · {earlier.length} thread{earlier.length === 1 ? '' : 's'} you've seen</Text>
              </Button>
            </Box>
          ) : null}
          {v.crewShowAll ? earlier.map(t => ThreadView(E, v, t, act)) : null}
        </Box>
      )}
      {Notebook(E, v, act)}
      {Keys(E, v, 'tab move · enter open · n new thread · g helper · m mode · o options · or /crew <message> at Claude\'s prompt')}
    </Box>
  )
}

const GROUP_COLOR = (p: Palette, name: string): string =>
  name === 'Claude Code'
    ? p.accent
    : name === 'MCP servers'
      ? p.violet
      : name === 'Codex'
        ? p.cyan
        : name === 'Antigravity'
          ? p.ok
          : name === 'FLEET'
            ? p.gold
            : p.dim

function SystemView(E: Els, v: View) {
  const { Box, Text } = E
  const { p } = v
  const sys = v.snap.sys
  if (!sys) return <Text color={p.dim}>Measuring… (CPU needs two samples, about 2 s)</Text>
  const memPct = sys.memTotalMb ? (sys.memUsedMb / sys.memTotalMb) * 100 : 0
  const loadPct = (sys.load[0] ?? 0) / sys.cores * 100
  const claudeCpu = sys.groups.reduce((n, g) => n + g.cpu, 0)
  const claudeMem = sys.groups.reduce((n, g) => n + g.rssMb, 0)

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={p.dim}>machine  mem </Text>
        {Gauge(E, memPct, 12, p)}
        <Text color={heat(memPct / 100, p)}> {Math.round(memPct)}%</Text>
        <Text color={p.dim}>
          {' '}
          {(sys.memUsedMb / 1024).toFixed(1)}/{(sys.memTotalMb / 1024).toFixed(1)} GB
        </Text>
        {Sep(E, p)}
        <Text color={p.dim}>load </Text>
        <Text color={heat(Math.min(1, loadPct / 100), p)}>{(sys.load[0] ?? 0).toFixed(1)}</Text>
        <Text color={p.dim}> on {sys.cores} cores</Text>
      </Text>
      <Text>
        <Text color={p.dim}>claude stack  </Text>
        <Text color={p.text}>{claudeCpu.toFixed(0)}% cpu</Text>
        <Text color={p.dim}> (100% = one core)</Text>
        {Sep(E, p)}
        <Text color={p.text}>{(claudeMem / 1024).toFixed(2)} GB</Text>
        <Text color={p.dim}> memory</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {sys.groups.map(g => (
          <Text wrap="truncate-end">
            <Text color={GROUP_COLOR(p, g.name)}>● {g.name.padEnd(15)}</Text>
            <Text color={g.count ? p.text : p.dim}>{String(g.count).padStart(3)} </Text>
            {Gauge(E, Math.min(100, g.cpu / sys.cores), 8, p)}
            <Text color={heat(Math.min(1, g.cpu / 100 / sys.cores), p)}>{`${g.cpu.toFixed(0)}%`.padStart(6)}</Text>
            <Text color={p.dim}>{`${g.rssMb} MB`.padStart(9)} </Text>
            <Text color={GROUP_COLOR(p, g.name)}>{spark(g.history.length ? g.history : [0])}</Text>
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={p.dim}>BUSIEST PROCESSES</Text>
        {sys.top.map(t => (
          <Text wrap="truncate-end">
            <Text color={GROUP_COLOR(p, t.group)}>● </Text>
            <Text color={p.text}>{`${t.cpu.toFixed(0)}%`.padStart(5)}</Text>
            <Text color={p.dim}>{`${Math.round(t.rssMb)}MB`.padStart(8)} </Text>
            <Text color={p.dim}>{t.cmd}</Text>
          </Text>
        ))}
      </Box>
      <Text color={p.dim}>groups: Claude Code windows · their MCP servers · tools and shells they started · Codex · Antigravity · FLEET</Text>
    </Box>
  )
}

const BARS = ' ▁▂▃▄▅▆▇█'

function CostView(E: Els, v: View) {
  const { Box, Text } = E
  const { p } = v
  const c = v.snap.cost
  const days = c.days.map(d => d.usd)
  const max = Math.max(...days, 0.01)
  const week = days.reduce((a, b) => a + b, 0)
  const models = Object.entries(c.models)
  const today = c.today || 1
  const H = 4
  // a 4-row bar chart: each day a 3-wide column, shaded by how heavy the day was
  const level = (usdOf: number) => (usdOf / max) * H * 8

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={p.dim}>TODAY </Text>
        <Text color={p.gold} weight="bold">
          {usd(c.today)}
        </Text>
        {Sep(E, p)}
        <Text color={p.text}>{tok(c.tokens)}</Text>
        <Text color={p.dim}> tokens</Text>
        {Sep(E, p)}
        <Text color={p.dim}>cache </Text>
        <Text color={p.ok}>{Math.round(c.cacheHit * 100)}%</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {Array.from({ length: H }, (_, row) => (
          <Text>
            {days.map(d => {
              const fill = Math.max(0, Math.min(8, Math.round(level(d) - (H - 1 - row) * 8)))
              return <Text color={heat(d / max, p)}>{` ${BARS[fill]!.repeat(3)}`}</Text>
            })}
          </Text>
        ))}
        <Text color={p.dim}>
          {c.days.map(d => ` ${'SMTWTFS'[new Date(`${d.date}T12:00:00`).getDay()]}  `).join('')}
        </Text>
        <Text>
          <Text color={p.dim}>7 days </Text>
          <Text color={p.gold}>{usd(week)}</Text>
          <Text color={p.dim}> · peak {usd(max)}</Text>
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={p.dim}>MODELS TODAY</Text>
        {models.length === 0 ? <Text color={p.dim}>none yet</Text> : null}
        {models.map(([m, n]) => (
          <Text>
            <Text color={p.cyan}>{cut(m, 12).padEnd(12)} </Text>
            {Gauge(E, (n / today) * 100, 14, { ...p, ok: p.accent, warn: p.violet, bad: p.cyan })}
            <Text color={p.gold}> {usd(n)}</Text>
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color={p.dim}>LIVE SESSIONS</Text>
        {v.snap.sessions.map(s => (
          <Text wrap="truncate-end">
            <Text color={sessionColor(s, p)}>● </Text>
            <Text color={p.text}>{cut(s.name, 22).padEnd(22)} </Text>
            <Text color={p.gold}>{usd(s.cost).padStart(7)}</Text>
            <Text color={p.dim}> · {tok(s.tokens)} tok</Text>
          </Text>
        ))}
      </Box>
      {c.pendingBytes > 0 ? <Text color={p.dim}>reading history… {tok(c.pendingBytes)}B to go</Text> : null}
      <Text color={p.dim}>≈ API list prices · a subscription bills differently</Text>
    </Box>
  )
}

/** The guide: every command, key and idea in one place. Each line wraps; nothing is cut. */
const GUIDE: { title: string; rows: [string, string][] }[] = [
  {
    title: 'READ THE PANE',
    rows: [
      ['▲ × ◆ ● ○', 'needs you · failed · to read · working · quiet. The same five marks everywhere.'],
      ['rows', 'mark · who · what · age, on every tab; press one to open its detail and actions beneath it'],
      ['the band', 'the Live headline, above your prompt, even with this pane closed'],
    ],
  },
  {
    title: 'OPEN AND MOVE',
    rows: [
      ['/fleet', 'open or close this pane · /fleet help jumps here'],
      ['ctrl+x tab', 'give the pane the keyboard; tab walks the buttons, enter presses one'],
      ['1 – 6', 'switch tabs: Live · Feed · Crew · Cost · System · Actions'],
      ['t · a', 'cycle the colour theme · show or hide the cat'],
      ['arrows', 'scroll the pane while it has the keyboard'],
    ],
  },
  {
    title: 'TABS',
    rows: [
      ['1 Live', 'everything that wants you: NEEDS YOU · TO READ · WORKING · QUIET; press a row to open it'],
      ['2 Feed', 'every tool call across sessions, grouped, with a 10-minute tally'],
      ['3 Crew', 'conversations with Codex and Antigravity that Claude (or you) start'],
      ['4 Cost', "today's and this week's estimated spend, by model and session"],
      ['5 System', 'CPU and memory of Claude, its MCP servers and tools, Codex, Antigravity'],
      ['6 Actions', 'settings and this guide; session actions are on their rows in Live'],
    ],
  },
  {
    title: 'CREW FROM CLAUDE\'S PROMPT (full editing and wrapping)',
    rows: [
      ['/crew <message>', 'send to the selected thread, or open a new one'],
      ['/crew new codex …', 'open a new thread with Codex (or: /crew new agy …)'],
      ['/crew @name …', 'send to a thread by name'],
      ['/crew', 'list the threads and what each said last'],
    ],
  },
  {
    title: 'CREW TAB',
    rows: [
      ['g · m · n', 'helper codex/agy · read-only or edits · new thread instead of the selected one'],
      ['pickers', 'model · folder (where it works) · effort, for a new thread'],
      ['\\ + enter', 'a new line in the box; a long line shows a wrapped preview above it'],
      ['press a thread', 'open its conversation: ▸ read full answer · ↳ send to Claude · ■ stop'],
    ],
  },
  {
    title: 'MEMORY',
    rows: [
      ['shared notebook', 'facts every helper message carries (about 1.5k tokens at most)'],
      ['keep', "a helper's suggested note stays pending until you or Claude approve it"],
      ['Obsidian vault', '~/Desktop/purrfleet-memory: notebook.md (tick to approve) and saved findings'],
    ],
  },
  {
    title: 'ASK CLAUDE, IN PLAIN WORDS',
    rows: [
      ['delegate', '"have codex review the auth code in a thread called auth-review"'],
      ['remember', '"pin a note: tests run with vitest" · "save this thread to the vault"'],
      ['its tools', 'crew_ask · crew_read · crew_note · crew_save'],
    ],
  },
  {
    title: 'SAFETY',
    rows: [
      ['read-only', 'helpers only read, unless you allow edits (Claude must ask you first)'],
      ['worktree', 'Codex edits happen in a separate git worktree, apart from your files'],
      ['folders', 'helpers work only in projects you have open; any other folder asks you'],
    ],
  },
]

const COMMANDS: [string, string][] = [
  ['/fleet', 'this pane'],
  ['/crew', 'the crew'],
  ['/reload-plugins', 'reload FLEET after an edit'],
  ['/context', "what fills this session's context"],
  ['/usage', 'plan limits and usage'],
  ['/compact', 'shrink a long conversation'],
  ['/resume', 'reopen an earlier session'],
]

function Guide(E: Els, v: View, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const keyWidth = Math.min(18, Math.max(10, Math.floor(v.width / 4)))
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text color={p.accent} weight="bold">
          HOW TO USE FLEET
        </Text>
        <Text color={p.dim}> · /fleet help opens this</Text>
      </Text>
      {GUIDE.map(section => (
        <Box flexDirection="column" marginTop={1}>
          <Text color={p.violet}>{section.title}</Text>
          {section.rows.map(([key, what]) => (
            <Box flexDirection="row">
              <Box width={keyWidth} flexShrink={0}>
                <Text color={p.cyan} wrap="wrap">
                  {key}
                </Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text color={p.text} wrap="wrap">
                  {what}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
      ))}
      <Box flexDirection="column" marginTop={1}>
        <Text color={p.violet}>HANDY COMMANDS · press one to copy it</Text>
        {COMMANDS.map(([cmd, what]) => (
          <Button key={`tip-${cmd}`} plain onPress={() => act.copy(cmd, cmd)}>
            <Text color={p.cyan}>{cmd.padEnd(keyWidth)}</Text>
            <Text color={p.dim}>{what}</Text>
          </Button>
        ))}
      </Box>
    </Box>
  )
}

function Actions(E: Els, v: View, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const setting = (key: string, label: string, choices: string, now: string, press: () => void) => (
    <Button key={key} plain onPress={press}>
      <Text color={p.text}>{('  ' + label).padEnd(22)}</Text>
      <Text color={p.dim}>{choices.padEnd(36)}</Text>
      <Text color={p.text}>now: {now}</Text>
    </Button>
  )
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={p.text}>Settings and the guide.</Text>
        <Text color={p.dim}>session and thread actions are on their rows</Text>
      </Box>
      <Text> </Text>
      <Text color={p.dim} weight="bold">
        SETTINGS
      </Text>
      {setting('set-theme', 't  theme', 'nebula · ember · synthwave', p.name, act.theme)}
      {setting('set-cat', 'a  cat', 'on · off', v.scene === 'off' ? 'off' : 'on', act.scene)}
      {Guide(E, v, act)}
    </Box>
  )
}

export type BandInfo = { age: number; isStale: boolean; items?: readonly Item[] }

/** The line above the prompt: the Live headline, with the first thing that needs you spelled out. */
export function Band(E: Els, snap: Snapshot, p: Palette, info: BandInfo = { age: 0, isStale: false }) {
  const { Box, Text } = E
  const v = { p }
  const items = info.items ?? inbox(snap.sessions, [], {})
  const parts: Node[] = []
  const seg = (state: Parameters<typeof mark>[1], text: string, bold = false) => {
    const m = mark(v, state)
    parts.push(
      <Text color={m.color} weight={bold ? 'bold' : 'regular'}>
        {m.glyph} {text}
      </Text>,
    )
  }
  const sessions = items.flatMap(x => (x.kind === 'session' && x.group === 'need' ? [x.s] : []))
  const failed = items.flatMap(x => (x.kind === 'turn' && x.group === 'need' ? [x] : []))
  // the reason to look at the band comes first, before it can be cut off
  if (sessions.length === 1) {
    const s = sessions[0]!
    seg(s.phase === 'error' ? 'error' : 'need', `${s.name}: ${activity(s)}`, true)
  } else if (sessions.length > 1) {
    seg('need', `${sessions.length} need you: ${sessions.map(s => s.name).join(', ')}`, true)
  }
  if (failed.length === 1) seg('failed', `${failed[0]!.t.agent} › ${failed[0]!.t.name} failed`)
  else if (failed.length > 1) seg('failed', `${failed.length} crew failed`)
  const count = tally(items)
  if (count.read) seg('read', `${count.read} to read`)
  if (count.work) seg('work', `${count.work} working`)
  const isUrgent = sessions.length + failed.length > 0
  if (!isUrgent && !count.read && count.quiet) seg('quiet', `${count.quiet} quiet`)
  if (info.isStale) parts.push(<Text color={p.warn}>data {info.age}s old</Text>)
  else parts.push(<Text color={p.gold}>{usd(snap.cost.today)}{isUrgent ? '' : ' today'}</Text>)
  return (
    <Box flexDirection="row">
      {Grad(E, 'FLEET', p.accent, p.cyan, true)}
      <Text wrap="truncate-end">
        {'  '}
        {parts.flatMap((x, i) => (i ? [<Text color={p.dim}> · </Text>, x] : [x]))}
      </Text>
    </Box>
  )
}
