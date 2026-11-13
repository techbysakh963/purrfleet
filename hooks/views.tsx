import type { Elements } from 'claude-code'

import type { CrewAgent, CrewThread, Session, Snapshot, Tab } from '../types'
import { modeLabel, plain, sections, summaryOf } from './crew'
import { activity, ctxPct, cut, hms, isBusy, needsYou, tok, usd } from './fmt'
import type { Group, Item } from './inbox'
import { inbox, isFailure, segments } from './inbox'
import type { Palette } from './theme'
import { ramp } from './theme'

/** Box, Text and Button: the elements every surface carries, with the same props. */
export type Els = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button'>
type Node = ReturnType<Els['Box']>

export type Acts = {
  tab: (tab: Tab) => void
  select: (sid: string) => void
  copy: (text: string, what: string) => void
  open: (path: string) => void
  stop: (s: Session) => void
  crewAgent: () => void
  crewLaunch: (task: string) => void
  crewStop: (thread: string) => void
  crewSend: (thread: string, turn: number) => void
  crewSelect: (thread: string) => void
  crewNew: () => void
  crewModel: (model: string) => void
  crewEffort: (effort: string) => void
  crewFolder: (folder: string) => void
  crewOpen: (key: string) => void
  showAllThreads: () => void
  toggleOptions: () => void
  finishTour: () => void
  showAllTurns: (thread: string) => void
  /** jump to a thread in the Crew tab (and mark its answers read) */
  openThread: (thread: string) => void
  /** turn the crew status line beside the user's prompts on or off */
  toggleStatusLine: () => void
  /** open a crew row in place on Live ("crew:<thread>") */
  openInline: (key: string) => void
}

export type View = {
  snap: Snapshot
  /** how fresh the data is, and the collector's error if it has one */
  health?: { age: number; err: string | null }
  tab: Tab
  selected: string | null
  width: number
  self: string
  p: Palette
  threads: readonly CrewThread[]
  crewSel: string | null
  crewAgent: CrewAgent
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
  /** the `who` column width, from the whole pane's width so columns line up across tabs */
  ww?: number
  /** whether Claude gets the crew status line beside the user's prompts */
  statusLine?: boolean
}

const TABS: { tab: Tab; label: string; key: string }[] = [
  { tab: 'live', label: 'Live', key: '1' },
  { tab: 'crew', label: 'Crew', key: '2' },
  { tab: 'actions', label: 'Actions', key: '3' },
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



export function Pane(E: Els, v0: View, act: Acts) {
  const { Box, Text, Button } = E
  // one who-column width for every tab, from the whole pane
  const v: View = { ...v0, ww: v0.ww ?? whoWidth(v0.width) }
  const { p } = v
  const segs = segments(inbox(v.snap.sessions, v.threads))
  const badge = (state: string) => segs.find(x => x.state === state)?.n ?? 0
  const unread = v.threads.filter(t => t.turns.some(u => u.unread)).length
  const crewBusy = v.threads.filter(t => t.status === 'running').length
  const need = mark(v, 'need')
  const work = mark(v, 'work')
  const read = mark(v, 'read')

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
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
      </Box>
      <Text color={p.faint}>{'─'.repeat(Math.max(10, v.width))}</Text>
      {v.health?.err ? (
        <Text color={p.fail} wrap="wrap">
          × FLEET cannot read your sessions: {v.health.err} · what you see is the last good snapshot ({v.health.age}s old)
        </Text>
      ) : v.health && v.health.age > 6 ? (
        <Text color={p.need}>data {v.health.age}s old · the collector may have stopped</Text>
      ) : null}
      {v.tab === 'crew' ? Crew(E, v, act) : v.tab === 'actions' ? Actions(E, v, act) : Live(E, v, act)}
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
    ['move around', 'ctrl+x tab focuses this pane · 1-3 switch tabs · enter opens a row'],
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
  if (v.selected !== `crew:${x.t.name}`) return row
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
  return GridRow(E, v, {
    key: `inbox-${x.key}`,
    m: mark(v, failed ? 'failed' : 'read'),
    who,
    what: failed ? `failed: ${x.u.log[x.u.log.length - 1] ?? (summaryOf(x.u.answer) || 'no answer')}` : summaryOf(x.u.answer) || 'answered',
    age: age(now - (x.u.ended ?? now)),
    focus,
    press: () => act.openInline(`crew:${x.t.name}`),
  })
}

function Live(E: Els, v: View, act: Acts) {
  const { Box, Text } = E
  const { p } = v
  // an opened crew row stays listed while it is open, even once it has been read
  const keep = v.selected?.startsWith('crew:') ? v.selected.slice(5) : undefined
  const items = inbox(v.snap.sessions, v.threads, keep)
  // group headings only when there is more than one kind of thing to look at
  const isGrouped = new Set(items.map(x => x.group)).size > 1
  const rows: Node[] = [
    Headline(E, v, items, <Text color={p.money}>{usd(v.snap.cost.today)} today</Text>),
    <Text> </Text>,
    ...(v.toured ? [] : [Tour(E, v, act)]),
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
    rows.push(x.kind === 'session' ? SessionRow(E, v, x.s, act, x === items[0]) : CrewRow(E, v, x, act, x === items[0]))
  }
  if (segments(items).every(x => x.state === 'quiet')) {
    rows.push(<Text color={p.dim}>Nothing needs you. Hand off work with /crew &lt;task&gt;, or press 2.</Text>)
  }

  return (
    <Box flexDirection="column">
      {rows}
      {Keys(E, v, 'enter open · tab move · 1-3 tabs · /fleet close')}
    </Box>
  )
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
    modeLabel(t.agent),
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

function Crew(E: Els, v: View, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const list = [...v.threads].sort((a, b) => b.updated - a.updated)
  const target = v.threads.find(t => t.name === v.crewSel)
  // what is new (running, unread, or open right now) shows; what you've seen folds away
  const isFresh = (t: CrewThread) =>
    t.status === 'running' || t.turns.some(u => u.unread) || t.name === v.crewSel
  const fresh = list.filter(isFresh)
  const earlier = list.filter(t => !isFresh(t))
  const running = list.filter(t => t.status === 'running').length
  const toRead = list.filter(t => t.turns.some(u => u.unread && u.status !== 'failed')).length
  const failed = list.filter(t => t.turns.some(u => u.unread && u.status === 'failed')).length
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
  const askAgent = target ? target.agent : v.crewAgent
  const askTo = target ? `to ${target.agent} › ${target.name} · ` : `to ${v.crewAgent} · `
  const askRest = target ? '' : ` · ${v.crewSummary} · new thread`

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">{parts.flatMap((x, i) => (i ? [<Text color={p.dim}> · </Text>, x] : [x]))}</Text>
      <Text> </Text>
      <Text color={p.dim} weight="bold">
        ASK
      </Text>
      <Box flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate-end">
          <Text color={p.dim}>{'  '}</Text>
          <Text color={p.text}>{askTo}</Text>
          <Text color={p.ok}>{modeLabel(askAgent)}</Text>
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
      {Keys(E, v, 'tab move · enter open · n new thread · g helper · o options · or /crew <message> at Claude\'s prompt')}
    </Box>
  )
}

/** The guide: every command, key and idea in one place. Each line wraps; nothing is cut. */
const GUIDE: { title: string; rows: [string, string][] }[] = [
  {
    title: 'READ THE PANE',
    rows: [
      ['▲ × ◆ ● ○', 'needs you · failed · to read · working · quiet. The same five marks everywhere.'],
      ['rows', 'mark · who · what · age; press one to open its detail and actions beneath it'],
      ['the band', 'the Live headline, above your prompt, even with this pane closed'],
    ],
  },
  {
    title: 'OPEN AND MOVE',
    rows: [
      ['/fleet', 'open or close this pane · /fleet help jumps here'],
      ['ctrl+x tab', 'give the pane the keyboard; tab walks the buttons, enter presses one'],
      ['1 – 3', 'switch tabs: Live · Crew · Actions'],
      ['arrows', 'scroll the pane while it has the keyboard'],
    ],
  },
  {
    title: 'TABS',
    rows: [
      ['1 Live', 'everything that wants you: NEEDS YOU · TO READ · WORKING · QUIET; press a row to open it'],
      ['2 Crew', 'conversations with Codex and Antigravity that Claude (or you) start'],
      ['3 Actions', 'settings and this guide; session actions are on their rows in Live'],
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
      ['g · n · o', 'helper codex/agy · new thread instead of the selected one · options'],
      ['options', 'model · folder (where it works) · effort, for a new thread'],
      ['\\ + enter', 'a new line in the box; a long line shows a wrapped preview above it'],
      ['press a thread', 'open its conversation: read full answer · send to Claude · stop'],
    ],
  },
  {
    title: 'ASK CLAUDE, IN PLAIN WORDS',
    rows: [
      ['delegate', '"have codex review the auth code in a thread called auth-review"'],
      ['review', '"review my changes with the crew" (both helpers, one merged list)'],
      ['its tools', 'crew_ask · crew_read · crew_review · crew_stop · fleet_read'],
    ],
  },
  {
    title: 'SAFETY',
    rows: [
      ['read-only', 'helpers only read and report; they never change your files'],
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
      {setting('set-status', 'crew news for Claude', 'a line beside your prompts · on · off', v.statusLine === false ? 'off' : 'on', act.toggleStatusLine)}
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
  const items = info.items ?? inbox(snap.sessions, [])
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
