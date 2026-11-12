import type { Elements } from 'claude-code'

import type { CrewAgent, CrewMode, CrewNote, CrewThread, CrewTurn, Delivery, Session, Snapshot, Tab } from '../types'
import { NOTEBOOK_CAP, modeLabel, plain, sections, summaryOf } from './crew'
import { deliveryLine } from './delivery'
import { activity, ago, ctxPct, cut, hms, isBusy, needsYou, spark, tok, usd } from './fmt'
import type { Group, Item } from './inbox'
import { inbox, isFailure, segments, tally } from './inbox'
import type { Palette } from './theme'
import { ramp } from './theme'

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
  /** rewrite a notebook fact (asks for the new text) */
  noteEdit: (folder: string, id: number) => void
  /** open a crew or notebook row in place on Live ("crew:<thread>", "notes:<folder>") */
  openInline: (key: string) => void
  /** a Codex delivery: show its diff, apply it to your tree, or throw it away */
  deliveryView: (thread: string, turn: number) => void
  deliveryAccept: (thread: string, turn: number) => void
  deliveryDiscard: (thread: string, turn: number) => void
}

export type View = {
  snap: Snapshot
  /** how fresh the data is, and the collector's error if it has one */
  health?: { age: number; err: string | null }
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
  /** the `who` column width, from the whole pane's width so columns line up across tabs */
  ww?: number
  /** the Codex diff open under its card */
  crewDiff?: { key: string; text: string } | null
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
export function mark(v: { p: Palette }, state: 'need' | 'failed' | 'read' | 'work' | 'quiet'): { glyph: string; color: string } {
  const { p } = v
  switch (state) {
    case 'need':
      return { glyph: '▲', color: p.need }
    case 'failed':
      return { glyph: '×', color: p.fail }
    case 'read':
      return { glyph: '◆', color: p.read }
    case 'work':
      return { glyph: '●', color: p.work }
    default:
      return { glyph: '○', color: p.dim }
  }
}

const sessionMark = (v: { p: Palette }, s: Session) =>
  mark(v, s.phase === 'error' ? 'failed' : needsYou(s) ? 'need' : isBusy(s) ? 'work' : 'quiet')


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


const Sep = (E: Els, p: Palette) => <E.Text color={p.dim}> · </E.Text>

export function Pane(E: Els, v0: View, act: Acts) {
  const { Box, Text, Button } = E
  // one who-column width for every tab, from the whole pane (Live's cat doesn't change it)
  const v: View = { ...v0, ww: v0.ww ?? whoWidth(v0.width) }
  const { p } = v
  const segs = segments(inbox(v.snap.sessions, v.threads, v.notebooks))
  const badge = (state: string) => segs.find(x => x.state === state)?.n ?? 0
  const unread = v.threads.filter(t => t.turns.some(u => u.unread)).length
  const crewBusy = v.threads.filter(t => t.status === 'running').length
  const need = mark(v, 'need')
  const work = mark(v, 'work')
  const read = mark(v, 'read')

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {Grad(E, 'FLEET', p.work, p.read, true)}
          {TABS.map(t => (
            <Button key={`tab-${t.tab}`} plain hotkey={t.key} onPress={() => act.tab(t.tab)}>
              {t.tab === v.tab ? (
                <Text color={p.text} weight="bold" underline>
                  {t.label}
                </Text>
              ) : (
                <Text color={p.dim}>{t.label}</Text>
              )}
              {t.tab === 'live' && badge('need') > 0 ? <Text color={need.color}> {need.glyph}{badge('need')}</Text> : ''}
              {t.tab === 'live' && badge('failed') > 0 ? <Text color={p.fail}> ×{badge('failed')}</Text> : ''}
              {t.tab === 'live' && badge('read') > 0 ? <Text color={read.color}> {read.glyph}{badge('read')}</Text> : ''}
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
      <Text color={p.faint}>{'─'.repeat(Math.max(10, v.width))}</Text>
      {v.health?.err ? (
        <Text color={p.fail} wrap="wrap">
          × FLEET cannot read your sessions: {v.health.err} · what you see is the last good snapshot ({v.health.age}s old)
        </Text>
      ) : v.health && v.health.age > 6 ? (
        <Text color={p.need}>data {v.health.age}s old · the collector may have stopped</Text>
      ) : null}
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
  o: { key: string; m: Mark; who: string; what: string; age?: string; quiet?: boolean; press?: () => void; focus?: boolean },
) {
  const { Text, Button } = E
  const { p } = v
  const ww = v.ww ?? whoWidth(v.width)
  const age = o.age ?? ''
  const room = Math.max(8, v.width - 2 - ww - 5)
  const body = [
    <Text color={o.m.color}>{o.m.glyph} </Text>,
    <Text color={o.quiet ? p.dim : p.text}>{fitWho(o.who, ww - 1).padEnd(ww)}</Text>,
    <Text color={o.quiet ? p.dim : p.text}>{cut(o.what.replace(/\s+/g, ' '), room).padEnd(room)}</Text>,
    <Text color={p.dim}> {age.padStart(4)}</Text>,
  ]
  return o.press ? (
    <Button key={o.key} plain onPress={o.press} {...(o.focus ? { autoFocus: true as const } : {})}>
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
function SessionRow(E: Els, v: View, s: Session, act: Acts, focus = false) {
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
    focus,
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
      <Text color={pct >= 80 ? p.need : p.text}>{pct}%</Text>
      <Text color={p.text}> · </Text>
      <Text color={p.money}>{usd(s.cost)}</Text>
      <Text color={p.text}> · up {hms(v.snap.now - s.startedAt)}</Text>
      {s.branch ? <Text color={p.text}> · {cut(s.branch, 24)}</Text> : ''}
      {s.added ? <Text color={p.ok}> · +{s.added}</Text> : ''}
      {s.removed ? <Text color={p.fail}> −{s.removed}</Text> : ''}
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
            s.sid === v.self ? null : { key: 'a-stop', label: 'stop…', color: p.fail, hotkey: 'x', press: () => act.stop(s) },
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
function Headline(E: Els, v: View, items: readonly Item[], right: Node) {
  const { Box, Text } = E
  const { p } = v
  const parts = segments(items)
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

/** One row for a crew item in the inbox; pressing it opens it in place, like a session. */
function CrewRow(E: Els, v: View, x: Exclude<Item, { kind: 'session' }>, act: Acts, focus = false) {
  const { Box } = E
  const row = CrewLine(E, v, x, act, focus)
  const key = x.kind === 'notes' ? `notes:${x.folder}` : `crew:${x.t.name}`
  if (v.selected !== key) return row
  if (x.kind === 'notes') {
    const { p } = v
    const pending = (v.notebooks[x.folder] ?? []).filter(n => n.pending)
    return (
      <Box flexDirection="column">
        {row}
        {Rail(E, mark(v, 'read').color, [
          ...pending.flatMap(n => [
            Labeled(E, v, n.by, n.text, true),
            ActionLine(E, v, [
              { key: `live-ok-${n.id}`, label: 'keep', color: p.ok, press: () => act.noteApprove(x.folder, n.id) },
              { key: `live-ed-${n.id}`, label: 'edit', press: () => act.noteEdit(x.folder, n.id) },
              { key: `live-x-${n.id}`, label: 'reject', color: p.fail, press: () => act.noteRemove(x.folder, n.id) },
            ]),
          ]),
          ActionLine(E, v, [{ key: `live-nb-${x.folder}`, label: 'open the notebook in Crew', color: p.dim, press: () => act.openNotebook(x.folder) }]),
        ])}
      </Box>
    )
  }
  const m = x.kind === 'running' ? mark(v, 'work') : mark(v, x.u.status === 'failed' ? 'failed' : 'read')
  return (
    <Box flexDirection="column">
      {row}
      {ThreadDetail(E, v, x.t, m, act, true)}
    </Box>
  )
}

function CrewLine(E: Els, v: View, x: Exclude<Item, { kind: 'session' }>, act: Acts, focus = false) {
  const now = v.snap.now
  if (x.kind === 'notes') {
    return GridRow(E, v, {
      key: `inbox-${x.key}`,
      m: mark(v, 'read'),
      who: 'notebook',
      what: `${x.count} suggestion${x.count === 1 ? '' : 's'} to keep or reject · ${x.folder.replace(/^\/home\/[^/]+/, '~')}`,
      focus,
      press: () => act.openInline(`notes:${x.folder}`),
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
      focus,
      press: () => act.openInline(`crew:${x.t.name}`),
    })
  }
  const failed = x.u.status === 'failed'
  const d = x.u.delivery
  return GridRow(E, v, {
    key: `inbox-${x.key}`,
    m: mark(v, failed ? 'failed' : 'read'),
    who,
    what: d?.state === 'pending' && !failed
      ? `changes to review: ${deliveryLine(d)}`
      : failed ? `failed: ${x.u.log[x.u.log.length - 1] ?? (summaryOf(x.u.answer) || 'no answer')}` : summaryOf(x.u.answer) || 'answered',
    age: age(now - (x.u.ended ?? now)),
    focus,
      press: () => act.openInline(`crew:${x.t.name}`),
  })
}

const CAT_COLS = 26 // the compact cat beside the rows (Raster columns)

function Live(E: Els, v: View, act: Acts) {
  const { Box, Text } = E
  const { p } = v
  // the rows come first; the cat sits beside them when there is room, else below
  const isBeside = v.hero !== null && v.width >= 90 // narrower, the rows need the room
  const rowsView = isBeside ? { ...v, width: v.width - CAT_COLS - 2 } : v
  // an opened crew row stays listed while it is open, even once it has been read
  const keep = v.selected?.startsWith('crew:') ? v.selected.slice(5) : undefined
  const items = inbox(v.snap.sessions, v.threads, v.notebooks, keep)
  // group headings only when there is more than one kind of thing to look at
  const isGrouped = new Set(items.map(x => x.group)).size > 1
  const rows: Node[] = [
    Headline(E, rowsView, items, <Text color={p.money}>{usd(v.snap.cost.today)} today</Text>),
    <Text> </Text>,
    ...(v.toured ? [] : [Tour(E, rowsView, act)]),
  ]
  let last: Group | null = null
  for (const x of items) {
    if (isGrouped && x.group !== last) {
      const color = x.group === 'need' ? p.need : x.group === 'read' ? p.read : x.group === 'work' ? p.work : p.dim
      rows.push(
        <Text color={color} weight="bold">
          {HEADS[x.group]}
        </Text>,
      )
      last = x.group
    }
    rows.push(x.kind === 'session' ? SessionRow(E, rowsView, x.s, act, x === items[0]) : CrewRow(E, rowsView, x, act, x === items[0]))
  }
  if (segments(items).every(x => x.state === 'quiet')) {
    rows.push(<Text color={p.dim}>Nothing needs you. Hand off work with /crew &lt;task&gt;, or press 3.</Text>)
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
      {Keys(E, v, 'enter open · tab move · 1-6 tabs · t theme · a cat · /fleet close')}
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

const KIND_LABEL: Record<string, string> = {
  read: 'reads',
  write: 'edits',
  run: 'commands',
  agent: 'agents',
  web: 'web',
  ask: 'questions',
  other: 'other',
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

/** Feed: what everyone is doing, in time order. IN FLIGHT (running now), then RECENT, on the grid. */
function Feed(E: Els, v: View, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const sessions = v.snap.sessions.filter(s => !v.feedFilter || s.sid === v.feedFilter)
  const bySid = new Map(v.snap.sessions.map(s => [s.sid, s]))
  const all = v.snap.feed.filter(f => !v.feedFilter || f.sid === v.feedFilter)
  // the collector counts every call of the last 10 minutes; the feed itself keeps only a few
  const tally = new Map<string, number>()
  let total = 0
  if (v.snap.tally) {
    for (const [sid, tools] of Object.entries(v.snap.tally)) {
      if (v.feedFilter && sid !== v.feedFilter) continue
      for (const [tool, n] of Object.entries(tools)) {
        tally.set(kindOf(tool), (tally.get(kindOf(tool)) ?? 0) + n)
        total += n
      }
    }
  } else {
    for (const f of all.filter(x => v.snap.now - x.t < 600)) {
      tally.set(kindOf(f.tool), (tally.get(kindOf(f.tool)) ?? 0) + 1)
      total += 1
    }
  }
  const filterName = v.feedFilter ? (bySid.get(v.feedFilter)?.name ?? 'one session') : 'all sessions'
  // f cycles: all → each session → all
  const order = v.snap.sessions.map(s => s.sid)
  const nextFilter = v.feedFilter === null ? (order[0] ?? null) : (order[order.indexOf(v.feedFilter) + 1] ?? null)
  const headline = (
    <Box flexDirection="row" justifyContent="space-between">
      <Text wrap="truncate-end">
        {total === 0 ? (
          <Text color={p.dim}>no tool calls in the last 10 minutes</Text>
        ) : (
          [
            <Text color={p.text}>{total}</Text>,
            <Text color={p.dim}> tool calls in the last 10 min</Text>,
            ...[...tally]
              .sort((a, b) => b[1] - a[1])
              .flatMap(([k, n]) => [<Text color={p.dim}> · </Text>, <Text color={p.text}>{n}</Text>, <Text color={p.dim}> {KIND_LABEL[k] ?? k}</Text>]),
          ]
        )}
      </Text>
      <Button key="feed-filter" plain hotkey="f" onPress={() => act.filter(nextFilter)}>
        <Text color={p.text}>{cut(filterName, 20)}</Text>
        <Text color={p.dim}> · f filter</Text>
      </Button>
    </Box>
  )
  // IN FLIGHT: each tool call running now, with its session's mark
  const flight = sessions.flatMap(s =>
    s.tools.map((tl, i) => {
      const m = sessionMark(v, s)
      const waits = needsYou(s) && i === s.tools.length - 1
      return GridRow(E, v, {
        key: `fl-${s.sid}-${i}`,
        m,
        who: i === 0 ? s.name : '',
        what: `${tl.tool} ${tl.detail}`.trim() + (waits ? ' · waiting for you' : ''),
        age: age(v.snap.now - tl.since),
      })
    }),
  )
  // RECENT: newest first, bursts collapsed; a session's name only on the first row of its run
  const items = bursts(all.slice(-40).reverse()).slice(0, 24)
  const recent = items.map((f, i) => {
    const prev = items[i - 1]
    return GridRow(E, v, {
      key: `rc-${i}`,
      m: { glyph: ' ', color: p.dim },
      who: prev && prev.sid === f.sid ? '' : f.name + (f.sid === v.self ? ' (here)' : ''),
      // a collapsed burst reads "read 12 files: a, b, c…"
      what: `${f.agent ? '↳ ' : ''}${f.tool}${/^\w+ \d+ \w+$/.test(f.tool) && f.detail ? ':' : ''} ${f.detail}`.trim(),
      age: age(v.snap.now - f.t),
    })
  })
  return (
    <Box flexDirection="column">
      {headline}
      <Text> </Text>
      {flight.length ? (
        <Text color={p.dim} weight="bold">
          IN FLIGHT
        </Text>
      ) : null}
      {flight}
      <Text color={p.dim} weight="bold">
        RECENT <Text weight="regular">· newest first</Text>
      </Text>
      {recent.length ? recent : <Text color={p.dim}>  Calls appear here as sessions make them.</Text>}
      {Keys(E, v, 'f filter · tab move · 1-6 tabs · t theme · a cat · /fleet close')}
    </Box>
  )
}


const threadMark = (v: View, t: CrewThread): Mark =>
  t.status === 'running'
    ? mark(v, 'work')
    : t.turns.some(u => u.unread && u.status === 'failed')
      ? mark(v, 'failed')
      : t.turns.some(u => u.unread || u.delivery?.state === 'pending')
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
  return (
    <Box flexDirection="column">
      {row}
      {ThreadDetail(E, v, t, m, act)}
    </Box>
  )
}

/** A thread's latest turn on a rail, in the answer's own shape: used in Crew and, opened in place, on Live. */
function ThreadDetail(E: Els, v: View, t: CrewThread, m: Mark, act: Acts, isOnLive = false) {
  const { Text } = E
  const { p } = v
  const last = t.turns[t.turns.length - 1]
  if (!last) return null
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
  return Rail(E, m.color, [
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
          ...(last.delivery ? DeliveryCard(E, v, t, last.n, last.delivery, act, last.delivery.state === 'pending') : []),
          // an earlier turn's changes still waiting for a decision keep their card and buttons
          ...t.turns
            .filter(u => u.n !== last.n && u.delivery?.state === 'pending')
            .flatMap((u, i) => [
              Labeled(E, v, `turn ${u.n}`, 'changes from this earlier turn are still waiting'),
              // keys go to one card only: the latest turn's when it has one, else the first earlier one
              ...DeliveryCard(E, v, t, u.n, u.delivery!, act, i === 0 && last.delivery?.state !== 'pending'),
            ]),
          <Text color={p.dim} wrap="truncate-end">
            {meta}
          </Text>,
          ActionLine(E, v, [
            last.status === 'running' ? { key: `stop-${t.name}`, label: 'stop', color: p.fail, hotkey: 'x', press: () => act.crewStop(t.name) } : null,
            last.answer
              ? { key: `open-${t.name}-${last.n}`, label: isFull ? 'show the summary' : 'read full answer', hotkey: 'r', press: () => act.crewOpen(`${t.name}#${last.n}`) }
              : null,
            last.status !== 'running' && !last.isHanded
              ? { key: `send-${t.name}-${last.n}`, label: 'send to Claude', hotkey: 's', press: () => act.crewSend(t.name, last.n) }
              : null,
            last.answer ? { key: `copy-${t.name}-${last.n}`, label: 'copy', color: p.dim, hotkey: 'c', press: () => act.copy(last.answer, `${t.name} answer`) } : null,
            t.turns.length > 1
              ? {
                  key: `turns-${t.name}`,
                  label: v.crewAllTurns === t.name ? 'hide earlier turns' : `${t.turns.length - 1} earlier turn${t.turns.length === 2 ? '' : 's'}`,
                  color: p.dim,
                  hotkey: 'e',
                  press: () => act.showAllTurns(t.name),
                }
              : null,
            isOnLive ? { key: `crew-tab-${t.name}`, label: 'open in Crew', color: p.dim, hotkey: 'g', press: () => act.openThread(t.name) } : null,
          ]),
          last.isHanded && last.status !== 'running' ? <Text color={p.dim}>Claude has this answer</Text> : null,
        ])
}

/**
 * What a Codex edit turn changed, as rail lines: the files, the diff on demand, and
 * accept or discard. Nothing reaches your tree until you accept.
 */
function DeliveryCard(E: Els, v: View, t: CrewThread, n: number, d: Delivery, act: Acts, withKeys = true): Node[] {
  const { Text } = E
  const { p } = v
  const key = `${t.name}#${n}`
  const isOpen = v.crewDiff?.key === key
  const state =
    d.state === 'pending' ? 'waiting in its own worktree' : d.state === 'accepted' ? 'applied to your tree (not committed)' : 'discarded'
  const lines: Node[] = [
    Labeled(
      E,
      v,
      'changes',
      <Text>
        <Text color={d.state === 'pending' ? p.text : p.dim}>{deliveryLine(d)}</Text>
        <Text color={p.dim}> · {state}</Text>
      </Text>,
    ),
    ...d.files.slice(0, 8).map(f =>
      Labeled(
        E,
        v,
        '',
        <Text>
          <Text color={p.text}>{f.path} </Text>
          <Text color={p.ok}>+{f.added}</Text>
          <Text color={p.fail}> −{f.removed}</Text>
        </Text>,
      ),
    ),
    d.files.length > 8 ? Labeled(E, v, '', `… and ${d.files.length - 8} more`) : null,
    d.note ? Labeled(E, v, 'note', <Text color={p.need}>{d.note}</Text>) : null,
  ].filter(x => x !== null)
  if (isOpen && v.crewDiff) {
    for (const line of v.crewDiff.text.split('\n').slice(0, 400)) {
      const color = /^\+(?!\+\+)/.test(line) ? p.ok : /^-(?!--)/.test(line) ? p.fail : /^@@/.test(line) ? p.read : p.dim
      lines.push(
        <Text color={color} wrap="truncate-end">
          {line || ' '}
        </Text>,
      )
    }
  }
  if (d.state === 'pending') {
    lines.push(
      ActionLine(E, v, [
        { key: `dv-${key}`, label: isOpen ? 'hide diff' : 'view diff', ...(withKeys ? { hotkey: 'v' } : {}), press: () => act.deliveryView(t.name, n) },
        { key: `da-${key}`, label: 'accept into your tree', color: p.ok, ...(withKeys ? { hotkey: 'p' } : {}), press: () => act.deliveryAccept(t.name, n) },
        { key: `dd-${key}`, label: 'discard', color: p.fail, ...(withKeys ? { hotkey: 'd' } : {}), press: () => act.deliveryDiscard(t.name, n) },
      ]),
    )
  }
  return lines
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
  const narrow = { ...v, width: Math.max(30, v.width - 14) }
  return (
    <Box flexDirection="column">
      {head}
      <Text color={used > NOTEBOOK_CAP * 0.8 ? p.need : p.dim}>
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
              { key: `note-ed-${n.id}`, label: 'edit', press: () => act.noteEdit(v.notebook.folder, n.id) },
              { key: `note-x-${n.id}`, label: 'reject', color: p.fail, press: () => act.noteRemove(v.notebook.folder, n.id) },
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
          <Button key={`note-ed-${n.id}`} plain onPress={() => act.noteEdit(v.notebook.folder, n.id)}>
            <Text color={p.dim}> edit</Text>
          </Button>
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
  const isFresh = (t: CrewThread) =>
    t.status === 'running' || t.turns.some(u => u.unread || u.delivery?.state === 'pending') || t.name === v.crewSel
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
  // only the mode words carry colour: ok when read-only, need when the helper may edit
  const askMode = target ? target.mode : v.crewMode
  const askAgent = target ? target.agent : v.crewAgent
  const askTo = target ? `to ${target.agent} › ${target.name} · ` : `to ${v.crewAgent} · `
  const askRest = target ? '' : ` · ${v.crewSummary} · new thread`

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
          <Text color={p.text}>{askTo}</Text>
          <Text color={askMode === 'edit' ? p.need : p.ok}>{modeLabel(askAgent, askMode)}</Text>
          <Text color={p.text}>{askRest}</Text>
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

/**
 * One bar row on the grid, shared by Cost and System: mark · label · bar · value · note.
 * When the pane is narrow the bar goes first; the value is never cut.
 */
function BarRow(
  E: Els,
  v: View,
  o: { m?: Mark; label: string; frac: number; value: string; valueColor?: string; note?: string; bold?: boolean; quiet?: boolean },
) {
  const { Text } = E
  const { p } = v
  const ww = v.ww ?? whoWidth(v.width)
  const cells = Math.min(40, v.width - 2 - ww - 10 - 24)
  return (
    <Text wrap="truncate-end">
      <Text color={o.m?.color ?? p.dim}>{o.m ? `${o.m.glyph} ` : '  '}</Text>
      <Text color={o.quiet ? p.dim : p.text}>{fitWho(o.label, ww - 1).padEnd(ww)}</Text>
      {cells >= 6 ? HBar(E, v, o.frac, cells, o.bold) : ''}
      <Text color={o.valueColor ?? p.text}> {o.value.padStart(8)}</Text>
      <Text color={p.dim}>{o.note ? `   ${o.note}` : ''}</Text>
    </Text>
  )
}

const HOT_CPU = 80 // a process at or over this % of one core is "hot"

/** System: the machine on the same bar table as Cost. */
function SystemView(E: Els, v: View) {
  const { Box, Text } = E
  const { p } = v
  const sys = v.snap.sys
  const keys = Keys(E, v, 'tab move · 1-6 tabs · t theme · a cat · /fleet close')
  if (!sys) {
    return (
      <Box flexDirection="column">
        <Text color={p.dim}>measuring… about 2 s (CPU needs two samples)</Text>
        {keys}
      </Box>
    )
  }
  const memPct = sys.memTotalMb ? Math.round((sys.memUsedMb / sys.memTotalMb) * 100) : 0
  const load = sys.load[0] ?? 0
  const stackCpu = Math.round(sys.groups.reduce((n, g) => n + g.cpu, 0))
  const stackGb = sys.groups.reduce((n, g) => n + g.rssMb, 0) / 1024
  const hotGroups = new Set(sys.top.filter(t => t.cpu >= HOT_CPU).map(t => t.group))
  const need = mark(v, 'need')
  const total = Math.max(1, sys.cores * 100)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text color={p.dim}>memory </Text>
          <Text color={memPct >= 85 ? p.need : p.text}>{memPct}%</Text>
          <Text color={p.dim}> of {(sys.memTotalMb / 1024).toFixed(0)} GB · load </Text>
          <Text color={load >= sys.cores ? p.need : p.text}>{load.toFixed(1)}</Text>
          <Text color={p.dim}> on {sys.cores} cores · Claude stack </Text>
          <Text color={p.text}>{stackCpu}% cpu, {stackGb.toFixed(1)} GB</Text>
        </Text>
        <Text color={p.dim}>100% cpu = one core</Text>
      </Box>
      <Text> </Text>
      <Text color={p.dim} weight="bold">
        GROUPS
      </Text>
      {sys.groups.map(g =>
        BarRow(E, v, {
          ...(hotGroups.has(g.name) ? { m: need } : {}),
          label: `${g.name} · ${g.count}`,
          frac: g.cpu / total,
          value: `${Math.round(g.cpu)}%`,
          note: `${(g.rssMb / 1024).toFixed(1)} GB  ${g.history.length ? spark(g.history.slice(-8)) : ''}`,
          quiet: g.count === 0,
        }),
      )}
      <Text> </Text>
      <Text color={p.dim} weight="bold">
        PROCESSES <Text weight="regular">· busiest first</Text>
      </Text>
      {sys.top.map((t, i) =>
        GridRow(E, v, {
          key: `proc-${i}`,
          m: t.cpu >= HOT_CPU ? need : { glyph: ' ', color: p.dim },
          who: t.group,
          what: `${t.cmd} · ${(t.rssMb / 1024).toFixed(1)} GB${t.cpu >= HOT_CPU ? ` · over ${HOT_CPU}% cpu` : ''}`,
          age: `${Math.round(t.cpu)}%`,
        }),
      )}
      {keys}
    </Box>
  )
}

/** A one-colour horizontal bar on the grid: filled to `frac`, the rest dim. */
function HBar(E: Els, v: View, frac: number, cells: number, bold = false) {
  const { Text } = E
  const { p } = v
  const full = Math.round(Math.max(0, Math.min(1, frac)) * cells)
  return (
    <Text>
      <Text color={p.work} weight={bold ? 'bold' : 'regular'}>
        {'█'.repeat(full)}
      </Text>
      <Text color={p.faint}>{'░'.repeat(cells - full)}</Text>
    </Text>
  )
}

/** Cost as one table: every row is label · bar · amount · note, on the same grid as Live. */
function CostView(E: Els, v: View) {
  const { Box, Text } = E
  const { p } = v
  const c = v.snap.cost
  const ww = v.ww ?? whoWidth(v.width)
  const week = c.days.reduce((n, d) => n + d.usd, 0)
  const peak = Math.max(...c.days.map(d => d.usd), 0.01)
  // today's spend only: a session that also ran yesterday counts just today's part
  const todayOf = (s: Session) => s.costToday ?? s.cost
  const live = [...v.snap.sessions].sort((a, b) => todayOf(b) - todayOf(a))
  const closed = Math.max(0, c.today - live.reduce((n, s) => n + todayOf(s), 0))
  const top = Math.max(...live.map(todayOf), closed, 0.01)
  const models = Object.entries(c.models).sort((a, b) => b[1] - a[1])
  const topModel = Math.max(...models.map(([, n]) => n), 0.01)
  const row = (mk: Mark | undefined, label: string, frac: number, amount: number, note = '', bold = false, quiet = false) =>
    BarRow(E, v, { ...(mk ? { m: mk } : {}), label, frac, value: usd(amount), valueColor: p.money, note, bold, quiet })
  const blank = <Text>{'  '}</Text>
  const head = (title: string, note = '') => (
    <Text>
      <Text color={p.dim} weight="bold">
        {title}
      </Text>
      <Text color={p.dim}>{note ? ` · ${note}` : ''}</Text>
    </Text>
  )
  // crew helpers aren't priced (they run on your Codex and Antigravity plans); their use still counts
  const dayStart = (() => {
    const d = new Date(v.snap.now * 1000)
    d.setHours(0, 0, 0, 0)
    return d.getTime() / 1000
  })()
  const crew = (['codex', 'agy'] as const).map(agent => {
    const turns = v.threads.filter(t => t.agent === agent).flatMap(t => t.turns.filter(u => (u.ended ?? u.started) >= dayStart))
    return { agent, turns: turns.length, inTok: turns.reduce((n, u) => n + u.contextTokens, 0), outTok: turns.reduce((n, u) => n + u.outputTokens, 0) }
  })
  const sys = v.snap.sys
  const hot = sys?.top.find(x => x.cpu >= 80)
  const memPct = sys && sys.memTotalMb ? Math.round((sys.memUsedMb / sys.memTotalMb) * 100) : 0
  const stackCpu = sys ? Math.round(sys.groups.reduce((n, g) => n + g.cpu, 0)) : 0
  const stackMem = sys ? sys.groups.reduce((n, g) => n + g.rssMb, 0) / 1024 : 0

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={p.money} weight="bold">
            {usd(c.today)} today
          </Text>
          <Text color={p.dim}> · </Text>
          <Text color={p.money}>{usd(week)} this week</Text>
          <Text color={p.dim}> · cache hit {Math.round(c.cacheHit * 100)}%</Text>
        </Text>
        <Text color={p.dim}>an estimate at API list prices</Text>
      </Box>
      {blank}
      {head('THIS WEEK')}
      {c.days.map((d, i) => {
        const isToday = i === c.days.length - 1
        const day = 'Sun Mon Tue Wed Thu Fri Sat'.split(' ')[new Date(`${d.date}T12:00:00`).getDay()] ?? d.date
        return row(undefined, `${day}${isToday ? ' today' : ''}`, d.usd / peak, d.usd, d.usd === peak && peak > 0.01 ? 'peak' : '', isToday)
      })}
      {blank}
      {head('TODAY BY SESSION')}
      {live.map(s => {
        const m = sessionMark(v, s)
        return row(m, s.name, todayOf(s) / top, todayOf(s), `${s.model} · ${tok(s.tokensToday ?? s.tokens)} tokens today`, false, !needsYou(s) && !isBusy(s))
      })}
      {closed > 0.005 ? row(undefined, 'closed sessions', closed / top, closed, '', false, true) : null}
      {blank}
      {head('TODAY BY MODEL')}
      {models.length === 0 ? <Text color={p.dim}>  none yet</Text> : null}
      {models.map(([m, n]) => row(undefined, m, n / topModel, n))}
      {blank}
      {head('CREW', 'not priced: helpers run on your Codex and Antigravity plans')}
      {crew.map(x => (
        <Text color={x.turns ? p.text : p.dim} wrap="truncate-end">
          {'  '}
          {x.agent.padEnd(ww)}
          {x.turns ? `${x.turns} turn${x.turns === 1 ? '' : 's'} today · ${tok(x.inTok)} processed · ${tok(x.outTok)} written` : 'no turns today'}
        </Text>
      ))}
      {blank}
      {head('MACHINE', 'tab 5 has the detail')}
      {sys ? (
        <Box flexDirection="column">
          <Text wrap="truncate-end">
            {'  '}
            <Text color={p.text}>{'memory'.padEnd(ww)}</Text>
            <Text color={memPct >= 85 ? p.need : p.text}>{memPct}%</Text>
            <Text color={p.dim}>
              {' '}
              · {(sys.memUsedMb / 1024).toFixed(1)} of {(sys.memTotalMb / 1024).toFixed(1)} GB
            </Text>
          </Text>
          <Text wrap="truncate-end">
            {'  '}
            <Text color={p.text}>{'load'.padEnd(ww)}</Text>
            <Text color={p.text}>{(sys.load[0] ?? 0).toFixed(1)}</Text>
            <Text color={p.dim}> on {sys.cores} cores</Text>
          </Text>
          <Text wrap="truncate-end">
            {'  '}
            <Text color={p.text}>{'Claude stack'.padEnd(ww)}</Text>
            <Text color={p.text}>{stackCpu}% cpu</Text>
            <Text color={p.dim}> (100% = one core) · {stackMem.toFixed(1)} GB</Text>
          </Text>
          {hot ? (
            <Text wrap="truncate-end">
              <Text color={mark(v, 'need').color}>{mark(v, 'need').glyph} </Text>
              <Text color={p.text}>{'hot'.padEnd(ww)}</Text>
              <Text color={p.text}>
                {cut(hot.cmd, 40)} · {Math.round(hot.cpu)}% cpu · {(hot.rssMb / 1024).toFixed(1)} GB
              </Text>
              <Text color={p.dim}> · {hot.group}</Text>
            </Text>
          ) : null}
        </Box>
      ) : (
        <Text color={p.dim}>  measuring… (CPU needs two samples)</Text>
      )}
      {c.pendingBytes > 0 ? <Text color={p.dim}>reading history… {tok(c.pendingBytes)}B to go</Text> : null}
      {Keys(E, v, 'tab move · 1-6 tabs · t theme · a cat · /fleet close · a subscription bills differently')}
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
      ['t · a', 'cycle the theme (nebula · ember · synthwave · paper for light terminals) · show or hide the cat'],
      ['arrows', 'scroll the pane while it has the keyboard'],
    ],
  },
  {
    title: 'TABS',
    rows: [
      ['1 Live', 'everything that wants you: NEEDS YOU · TO READ · WORKING · QUIET; press a row to open it'],
      ['2 Feed', 'IN FLIGHT (running now) and RECENT tool calls, newest first; f cycles the session filter'],
      ['3 Crew', 'conversations with Codex and Antigravity that Claude (or you) start'],
      ['4 Cost', 'estimated spend this week and today, crew usage, and the machine in three lines'],
      ['5 System', 'the machine on a bar table: groups and the busiest processes; ▲ marks one running hot'],
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
      ['changes', 'its card lists the files: view diff · accept into your tree (asks first, never commits) · discard'],
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
        <Text color={p.dim} weight="bold">
          HOW TO USE FLEET
        </Text>
        <Text color={p.dim}> · /fleet help opens this</Text>
      </Text>
      {GUIDE.map(section => (
        <Box flexDirection="column" marginTop={1}>
          <Text color={p.dim} weight="bold">
            {section.title}
          </Text>
          {section.rows.map(([key, what]) => (
            <Box flexDirection="row">
              <Box width={keyWidth} flexShrink={0}>
                <Text color={p.text} wrap="wrap">
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
        <Text color={p.dim}>HANDY COMMANDS · press one to copy it</Text>
        {COMMANDS.map(([cmd, what]) => (
          <Button key={`tip-${cmd}`} plain onPress={() => act.copy(cmd, cmd)}>
            <Text color={p.text}>{cmd.padEnd(keyWidth)}</Text>
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

/**
 * The line above the prompt: the Live headline, word for word, except that a
 * needs-you or failed count of one is spelled out ("api-refactor: Bash npm test").
 */
export function Band(E: Els, snap: Snapshot, p: Palette, info: BandInfo = { age: 0, isStale: false }) {
  const { Box, Text } = E
  const v = { p }
  const items = info.items ?? inbox(snap.sessions, [], {})
  const parts: Node[] = []
  for (const seg of segments(items)) {
    const m = mark(v, seg.state)
    let text = seg.text
    if (seg.n === 1 && seg.state === 'need') {
      const x = items.find(i => i.group === 'need' && !isFailure(i))
      if (x?.kind === 'session') text = `${x.s.name}: ${activity(x.s)}`
    }
    if (seg.n === 1 && seg.state === 'failed') {
      const x = items.find(isFailure)
      if (x?.kind === 'session') text = `${x.s.name} stopped on an error`
      if (x?.kind === 'turn') text = `${x.t.agent} › ${x.t.name} failed`
    }
    parts.push(
      <Text color={m.color} weight={seg.state === 'need' ? 'bold' : 'regular'}>
        {m.glyph} {text}
      </Text>,
    )
  }
  if (info.isStale) parts.push(<Text color={p.need}>data {info.age}s old</Text>)
  else parts.push(<Text color={p.money}>{usd(snap.cost.today)} today</Text>)
  return (
    <Box flexDirection="row">
      {Grad(E, 'FLEET', p.work, p.read, true)}
      <Text wrap="truncate-end">
        {'  '}
        {parts.flatMap((x, i) => (i ? [<Text color={p.dim}> · </Text>, x] : [x]))}
      </Text>
    </Box>
  )
}
