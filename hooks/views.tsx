import type { Elements } from 'claude-code'

import type { CrewAgent, CrewMode, CrewNote, CrewThread, CrewTurn, Session, Snapshot, Tab } from '../types'
import { modeLabel, summaryOf } from './crew'
import { ago, clock, ctxPct, cut, hms, isBusy, needsYou, phaseLook, spark, tok, usd } from './fmt'
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
  showAllTurns: (thread: string) => void
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
  /** pixel art, drawn only where the surface has a Raster (the terminal) */
  aurora: Node | null
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
  crewAllTurns: string | null
  notebook: { folder: string; file: string; notes: readonly CrewNote[] }
}

const TABS: { tab: Tab; label: string; key: string }[] = [
  { tab: 'live', label: 'Live', key: '1' },
  { tab: 'feed', label: 'Feed', key: '2' },
  { tab: 'crew', label: 'Crew', key: '3' },
  { tab: 'cost', label: 'Cost', key: '4' },
  { tab: 'system', label: 'System', key: '5' },
  { tab: 'actions', label: 'Actions', key: '6' },
]

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
  const waiting = v.snap.sessions.filter(needsYou).length
  const busy = v.snap.sessions.filter(isBusy).length
  const agents = v.snap.sessions.reduce((n, s) => n + s.agents.length, 0)
  const crewBusy = v.threads.filter(t => t.status === 'running').length

  return (
    <Box flexDirection="column">
      {v.aurora ?? <Text>{Grad(E, '━'.repeat(Math.max(10, v.width)), p.accent, p.cyan)}</Text>}
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color={p.accent}>◆ </Text>
          {Grad(E, 'FLEET', p.accent, p.cyan, true)}
        </Text>
        <Text>
          <Text color={p.accent}>◉ </Text>
          <Text color={p.text}>{busy}</Text>
          <Text color={p.dim}>/{v.snap.sessions.length} busy</Text>
          {Sep(E, p)}
          <Text color={p.violet}>◇ </Text>
          <Text color={p.text}>{agents}</Text>
          <Text color={p.dim}> agents</Text>
          {Sep(E, p)}
          <Text color={p.gold}>{usd(v.snap.cost.today)}</Text>
        </Text>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {TABS.map(t => (
          <Button key={`tab-${t.tab}`} plain hotkey={t.key} onPress={() => act.tab(t.tab)}>
            {t.tab === v.tab ? (
              <Text color={p.accent} weight="bold">
                ◆ {t.label}
              </Text>
            ) : (
              <Text color={p.dim}>◇ {t.label}</Text>
            )}
            {t.tab === 'live' && waiting > 0 ? <Text color={p.warn} weight="bold"> ▲{waiting}</Text> : ''}
            {t.tab === 'crew' && crewBusy > 0 ? <Text color={p.accent}> ◉{crewBusy}</Text> : ''}
          </Button>
        ))}
      </Box>
      <Text color={p.border}>{'─'.repeat(Math.max(10, v.width))}</Text>
      {(v.tab === 'live' || v.tab === 'needs') && Live(E, v, act)}
      {v.tab === 'feed' && Feed(E, v, act)}
      {v.tab === 'crew' && Crew(E, v, act)}
      {v.tab === 'cost' && CostView(E, v)}
      {v.tab === 'system' && SystemView(E, v)}
      {v.tab === 'actions' && Actions(E, v, act)}
      <Box flexDirection="row" columnGap={2} marginTop={1}>
        <Button key="cycle-theme" plain hotkey="t" onPress={act.theme}>
          <Text color={p.dim}>t </Text>
          <Text color={p.accent}>● {p.name}</Text>
        </Button>
        <Button key="cycle-scene" plain hotkey="a" onPress={act.scene}>
          <Text color={p.dim}>a </Text>
          <Text color={p.cyan}>◎ {v.scene}</Text>
        </Button>
        <Text color={p.dim}>ctrl+x tab: focus the pane</Text>
      </Box>
    </Box>
  )
}

function Card(E: Els, v: View, s: Session, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const look = phaseLook(s.phase, p)
  const pct = ctxPct(s)
  const tool = s.tools[s.tools.length - 1]
  const isSel = s.sid === v.selected
  const w = Math.max(30, v.width - 4)
  const border = needsYou(s) ? look.color : isSel ? p.accent : isBusy(s) ? p.violet : p.border

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={border} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Button key={`s-${s.sid}`} plain onPress={() => act.select(s.sid)}>
          <Text color={look.color}>{look.glyph} </Text>
          <Text color={p.text} weight="bold">
            {cut(s.name, Math.max(10, w - 24))}
          </Text>
          {s.sid === v.self ? <Text color={p.dim}> · here</Text> : ''}
        </Button>
        <Text>
          <Text color={look.color} weight="bold">
            {look.label}
          </Text>
          <Text color={p.dim}> {ago(v.snap.now - s.phaseSince)}</Text>
        </Text>
      </Box>
      <Text wrap="truncate-end">
        <Text color={p.dim}>[ </Text>
        <Text color={p.cyan}>{s.model}</Text>
        <Text color={p.dim}> ] </Text>
        {Gauge(E, pct, 10, p)}
        <Text color={heat(pct / 100, p)}> {pct}%</Text>
        <Text color={p.dim}> ctx</Text>
        {Sep(E, p)}
        <Text color={p.gold}>{usd(s.cost)}</Text>
        {Sep(E, p)}
        <Text color={p.dim}>{hms(v.snap.now - s.startedAt)}</Text>
        {s.branch ? Sep(E, p) : ''}
        {s.branch ? <Text color={p.violet}>⌥ {cut(s.branch, 18)}</Text> : ''}
        {s.added || s.removed ? Sep(E, p) : ''}
        {s.added ? <Text color={p.ok}>+{s.added} </Text> : ''}
        {s.removed ? <Text color={p.bad}>−{s.removed}</Text> : ''}
      </Text>
      {needsYou(s) ? (
        <Text color={look.color} wrap="wrap">
          {look.glyph} {activity(s)}
        </Text>
      ) : null}
      {tool && !needsYou(s) ? (
        <Text wrap="truncate-end">
          <Text color={p.accent}>› </Text>
          <Text color={p.cyan} weight="bold">
            {tool.tool}
          </Text>
          <Text color={p.dim}> {cut(tool.detail, w - tool.tool.length - 4)}</Text>
        </Text>
      ) : null}
      {s.agents.map((a, i) => (
        <Text wrap="truncate-end">
          <Text color={p.border}>{i === s.agents.length - 1 ? '└─' : '├─'}</Text>
          <Text color={p.violet}>◇ {a.type}</Text>
          <Text color={p.dim}>
            {' '}
            {ago(v.snap.now - a.since)}
            {a.tokens ? ` · ${tok(a.tokens)}` : ''} · {cut(a.task, Math.max(8, w - a.type.length - 20))}
          </Text>
        </Text>
      ))}
    </Box>
  )
}

/** Who to look at first: needs-you, then busy, then the rest; newest change first within each. */
export const ordered = (sessions: readonly Session[]): Session[] =>
  [...sessions].sort((a, b) => {
    const rank = (s: Session) => (needsYou(s) ? 0 : isBusy(s) ? 1 : 2)
    return rank(a) - rank(b) || b.phaseSince - a.phaseSince
  })

/** What a session is up to, in a few words. */
function activity(s: Session): string {
  const tool = s.tools[s.tools.length - 1]
  if (s.phase === 'error') return 'last turn ended on an API error'
  if (needsYou(s)) return tool ? `${tool.tool}: ${tool.detail}` : 'waiting for your permission'
  if (tool) return `› ${tool.tool} ${tool.detail}`
  if (s.phase === 'thinking') return 'thinking…'
  if (s.phase === 'compacting') return 'compacting its context…'
  return s.phase === 'ready' ? 'ready' : 'idle'
}

/** One calm line per session; pressing it selects it (and expands it into its card). */
function Row(E: Els, v: View, s: Session, act: Acts) {
  const { Text, Button } = E
  const { p } = v
  const look = phaseLook(s.phase, p)
  const quiet = !needsYou(s) && !isBusy(s)
  const tail = `${s.agents.length ? ` ◇${s.agents.length}` : ''} ${ago(v.snap.now - s.phaseSince)}`
  const room = Math.max(8, v.width - 16 - tail.length - 2)

  return (
    <Button key={`s-${s.sid}`} plain onPress={() => act.select(s.sid)}>
      <Text color={look.color}>{look.glyph} </Text>
      <Text color={quiet ? p.dim : p.text}>{cut(s.name, 13).padEnd(14)}</Text>
      <Text color={s.phase === 'error' ? p.bad : needsYou(s) ? p.warn : quiet ? p.dim : p.cyan}>
        {cut(activity(s), room).padEnd(room)}
      </Text>
      {s.agents.length ? <Text color={p.violet}> ◇{s.agents.length}</Text> : ''}
      <Text color={p.dim}> {ago(v.snap.now - s.phaseSince)}</Text>
    </Button>
  )
}

/** What the whole fleet is up to, in one line. */
function FleetStatus(E: Els, v: View) {
  const { Text } = E
  const { p } = v
  const need = v.snap.sessions.filter(needsYou)
  const busy = v.snap.sessions.filter(isBusy).length
  if (need.length > 0) {
    return (
      <Text color={p.warn} weight="bold" wrap="truncate-end">
        ▲ {need.map(s => s.name).join(', ')} {need.length === 1 ? 'needs' : 'need'} you
      </Text>
    )
  }
  return busy > 0 ? (
    <Text color={p.accent}>
      ◉ {busy} of {v.snap.sessions.length} working
    </Text>
  ) : (
    <Text color={p.dim}>○ all quiet · the cat is napping</Text>
  )
}

const CAT_COLS = 26 // the compact cat beside the rows (Raster columns)

function Live(E: Els, v: View, act: Acts) {
  const { Box, Text } = E
  const { p } = v
  // the rows come first; the cat sits beside them when there is room, else below
  const isBeside = v.hero !== null && v.width >= 90 // narrower, the rows need the room
  const rowsView = isBeside ? { ...v, width: v.width - CAT_COLS - 2 } : v
  const rows = ordered(v.snap.sessions).map(s =>
    s.sid === v.selected ? Card(E, rowsView, s, act) : Row(E, rowsView, s, act),
  )

  return (
    <Box flexDirection="column">
      {FleetStatus(E, v)}
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
      <Text color={p.dim}>press a row for its details · 6 for actions and the guide</Text>
    </Box>
  )
}

type Kind = { glyph: string; color: (p: Palette) => string; label: string }
const KINDS: Record<string, Kind> = {
  read: { glyph: '○', color: p => p.cyan, label: 'reads' },
  write: { glyph: '■', color: p => p.gold, label: 'edits' },
  run: { glyph: '$', color: p => p.accent, label: 'commands' },
  agent: { glyph: '◇', color: p => p.violet, label: 'agents' },
  web: { glyph: '◎', color: p => p.ok, label: 'web' },
  ask: { glyph: '▲', color: p => p.warn, label: 'questions' },
  other: { glyph: '›', color: p => p.dim, label: 'other' },
}
const kindOf = (tool: string): string =>
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
          <Text color={v.feedFilter === null ? p.accent : p.dim}>{v.feedFilter === null ? '◆' : '◇'} all</Text>
        </Button>
        {v.snap.sessions.map(s => (
          <Button key={`f-${s.sid}`} plain onPress={() => act.filter(s.sid)}>
            <Text color={v.feedFilter === s.sid ? p.accent : p.dim}>
              {v.feedFilter === s.sid ? '◆' : '◇'} {cut(s.name, 16)}
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
          {b.items.map(f => {
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


function turnLook(v: View, status: CrewTurn['status']) {
  const { p } = v
  return status === 'running'
    ? { glyph: '◉', color: p.accent }
    : status === 'done'
      ? { glyph: '◆', color: p.ok }
      : status === 'failed'
        ? { glyph: '×', color: p.bad }
        : { glyph: '■', color: p.dim }
}

/** One thread as a row; the selected one opens into its whole conversation. */
function ThreadView(E: Els, v: View, t: CrewThread, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const isOpen = t.name === v.crewSel
  const last = t.turns[t.turns.length - 1]
  const look = turnLook(v, t.status === 'running' ? 'running' : t.status === 'failed' ? 'failed' : 'done')
  const tokens = last ? last.contextTokens + last.outputTokens : 0
  const w = Math.max(30, v.width - 4)
  const head = (
    <Button key={`th-${t.name}`} plain onPress={() => act.crewSelect(t.name)}>
      <Text color={look.color}>{look.glyph} </Text>
      <Text color={p.cyan} weight="bold">
        {t.agent}
      </Text>
      <Text color={p.dim}> · </Text>
      <Text color={p.text} weight="bold">
        {t.name}
      </Text>
      <Text color={p.dim}>
        {'  '}
        {t.model !== 'default' ? `${t.model} · ` : ''}
        {t.effort !== 'default' ? `${t.effort} · ` : ''}
        {t.turns.length} msg{t.turns.length === 1 ? '' : 's'}
        {tokens ? ` · ${tok(tokens)} processed` : ''}
        {t.compactions ? ` · compacted ${t.compactions}×` : ''}
      </Text>
      <Text color={t.by === 'claude' ? p.violet : p.gold}> · started by {t.by === 'claude' ? 'Claude' : 'you'}</Text>
    </Button>
  )
  if (!isOpen) {
    return (
      <Box flexDirection="column">
        {head}
        {last ? (
          <Text wrap="truncate-end">
            <Text color={p.border}>{'  ┊ '}</Text>
            <Text color={p.dim}>
              {last.status === 'running' ? (last.log[last.log.length - 1] ?? 'working…') : summaryOf(last.answer) || last.status}
            </Text>
          </Text>
        ) : null}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.status === 'running' ? p.accent : p.violet} paddingX={1}>
      {head}
      <Text color={p.dim}>
        {modeLabel(t.agent, t.mode)} · {t.cwd}
        {t.session ? ` · session ${t.session.slice(0, 8)}` : ''}
      </Text>
      {t.brief ? (
        <Text color={p.dim} wrap="truncate-end">
          ◇ carried-over brief: {cut(t.brief.replace(/\s+/g, ' '), w - 24)}
        </Text>
      ) : null}
      {t.turns.length > 4 ? (
        <Button key={`turns-${t.name}`} plain onPress={() => act.showAllTurns(t.name)}>
          <Text color={p.cyan}>
            {v.crewAllTurns === t.name ? '▾ show only the last 4 messages' : `▸ show all ${t.turns.length} messages`}
          </Text>
        </Button>
      ) : null}
      {(v.crewAllTurns === t.name ? t.turns : t.turns.slice(-4)).map(u => {
        const tl = turnLook(v, u.status)
        return (
          <Box flexDirection="column" marginTop={1}>
            <Text wrap="truncate-end">
              <Text color={u.by === 'claude' ? p.violet : p.gold}>{u.by === 'claude' ? 'Claude' : 'you'} › </Text>
              <Text color={p.text}>{cut(u.ask.replace(/\s+/g, ' '), w - 10)}</Text>
            </Text>
            {u.status === 'running'
              ? u.log.slice(-3).map(l => (
                  <Text wrap="truncate-end">
                    <Text color={p.border}>┊ </Text>
                    <Text color={p.dim}>{cut(l, w - 2)}</Text>
                  </Text>
                ))
              : null}
            {u.answer && v.crewOpenTurn === `${t.name}#${u.n}` ? (
              <Box flexDirection="column" borderStyle="single" borderColor={p.border} paddingX={1}>
                {u.answer
                  .trim()
                  .split('\n')
                  .map(line => (
                    <Text wrap="wrap" color={/^(SUMMARY|KEY POINTS|CONFIDENCE|DETAILS|NOTE):/i.test(line) ? p.accent : p.text}>
                      {line || ' '}
                    </Text>
                  ))}
              </Box>
            ) : u.answer ? (
              <Text wrap="wrap">
                <Text color={tl.color}>{tl.glyph} </Text>
                <Text color={p.text}>{summaryOf(u.answer)}</Text>
              </Text>
            ) : u.status !== 'running' ? (
              <Text color={tl.color}>
                {tl.glyph} {u.status}
                {u.log.length ? `: ${cut(u.log[u.log.length - 1] ?? '', w - 12)}` : ''}
              </Text>
            ) : null}
            <Box flexDirection="row" columnGap={3}>
              {u.status === 'running' ? (
                <Button key={`stop-${t.name}`} plain onPress={() => act.crewStop(t.name)}>
                  <Text color={p.bad}>■ stop</Text>
                </Button>
              ) : u.isHanded ? (
                <Text color={p.dim}>↳ Claude has it</Text>
              ) : (
                <Button key={`send-${t.name}-${u.n}`} plain onPress={() => act.crewSend(t.name, u.n)}>
                  <Text color={p.violet}>↳ send to Claude</Text>
                </Button>
              )}
              {u.answer ? (
                <Button key={`open-${t.name}-${u.n}`} plain onPress={() => act.crewOpen(`${t.name}#${u.n}`)}>
                  <Text color={p.cyan}>{v.crewOpenTurn === `${t.name}#${u.n}` ? '▾ hide full answer' : '▸ read full answer'}</Text>
                </Button>
              ) : null}
              {u.answer ? (
                <Button key={`copy-${t.name}-${u.n}`} plain onPress={() => act.copy(u.answer, `${t.name} answer`)}>
                  <Text color={p.dim}>◇ copy</Text>
                </Button>
              ) : null}
              {u.contextTokens ? (
                <Text color={p.dim}>
                  {tok(u.contextTokens)} processed · {tok(u.outputTokens)} written
                </Text>
              ) : null}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

/** The crew's shared memory for the project in view: what every helper message carries. */
function Notebook(E: Els, v: View, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const notes = v.notebook.notes
  const isOpen = v.crewOpenTurn === 'notebook'
  const w = Math.max(30, v.width - 8)
  return (
    <Box flexDirection="column">
      <Button key="notebook" plain onPress={() => act.crewOpen('notebook')}>
        <Text color={p.violet}>{isOpen ? '▾' : '▸'} shared notebook </Text>
        <Text color={p.dim}>
          {notes.length} note{notes.length === 1 ? '' : 's'}
          {notes.some(n => n.pending) ? ` (${notes.filter(n => n.pending).length} pending)` : ''} · {v.notebook.folder.replace(/^\/home\/[^/]+/, '~')} · every helper gets it
        </Text>
      </Button>
      {isOpen && v.notebook.file ? (
        <Button key="notebook-obsidian" plain onPress={() => act.openNote(v.notebook.file)}>
          <Text color={p.violet}>  ◇ open in Obsidian </Text>
          <Text color={p.dim}>{v.notebook.file.replace(/^\/home\/[^/]+/, '~')} · tick to approve, edit freely</Text>
        </Button>
      ) : null}
      {isOpen ? (
        <Text color={p.dim} wrap="wrap">
          {'  '}Short facts sent with every message to Codex and agy. Helpers suggest them; a suggestion waits until you
          approve it. Keep only facts that stay true; delete anything outdated.
        </Text>
      ) : null}
      {isOpen && notes.length === 0 ? (
        <Text color={p.dim}>  empty: helpers add NOTE: lines, and Claude pins facts with crew_note</Text>
      ) : null}
      {isOpen
        ? notes.map(n => (
            <Box flexDirection="row" columnGap={1}>
              {n.pending ? (
                <Button key={`note-ok-${n.id}`} plain onPress={() => act.noteApprove(v.notebook.folder, n.id)}>
                  <Text color={p.ok}>◆ keep</Text>
                </Button>
              ) : null}
              <Button key={`note-x-${n.id}`} plain onPress={() => act.noteRemove(v.notebook.folder, n.id)}>
                <Text color={p.bad}>{n.pending ? '× reject' : '× delete'}</Text>
              </Button>
              <Text wrap="wrap">
                <Text color={n.by === 'claude' ? p.violet : n.by === 'you' ? p.gold : p.cyan}>{n.by} </Text>
                {n.pending ? <Text color={p.warn}>suggests </Text> : <Text color={p.dim}>· </Text>}
                <Text color={p.text}>{cut(n.text, w * 3)}</Text>
              </Text>
            </Box>
          ))
        : null}
    </Box>
  )
}

function Crew(E: Els, v: View, act: Acts) {
  const { Box, Text, Button } = E
  const { p } = v
  const list = [...v.threads].sort((a, b) => b.updated - a.updated)
  const target = v.threads.find(t => t.name === v.crewSel)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {target ? (
          <Button key="crew-new" plain hotkey="n" onPress={act.crewNew}>
            <Text color={p.dim}>n </Text>
            <Text color={p.accent}>◇ new thread instead</Text>
          </Button>
        ) : (
          <Button key="crew-agent" plain hotkey="g" onPress={act.crewAgent}>
            <Text color={p.dim}>g </Text>
            <Text color={p.cyan} weight="bold">
              ◆ {v.crewAgent}
            </Text>
          </Button>
        )}
        {target ? null : (
          <Button key="crew-mode" plain hotkey="m" onPress={act.crewMode}>
            <Text color={p.dim}>m </Text>
            <Text color={v.crewMode === 'edit' ? p.warn : p.ok}>◇ {modeLabel(v.crewAgent, v.crewMode)}</Text>
          </Button>
        )}
      </Box>
      {v.launcher ?? <Text color={p.dim}>(the input box needs the terminal or the desktop app)</Text>}
      <Text color={p.dim}>or type in Claude's prompt: /crew your message · /crew new agy … · /crew @thread …</Text>
      {Notebook(E, v, act)}
      {list.length === 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={p.dim}>No threads yet. Type a task above, or ask Claude:</Text>
          <Text color={p.text}> "open a codex thread 'auth-review' and have it audit the login flow"</Text>
          <Text color={p.dim}>Threads remember their conversation; long ones are compacted into a brief (some detail is lost).</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {(v.crewShowAll ? list : list.filter((t, i) => i < 8 || t.name === v.crewSel)).map(t => ThreadView(E, v, t, act))}
          {list.length > 8 ? (
            <Button key="threads-all" plain onPress={act.showAllThreads}>
              <Text color={p.cyan}>{v.crewShowAll ? '▾ show only the 8 newest threads' : `▸ show all ${list.length} threads`}</Text>
            </Button>
          ) : null}
        </Box>
      )}
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
      ['1 Live', 'every Claude window; whoever needs you is on top; press a row for its card'],
      ['2 Feed', 'every tool call across sessions, grouped, with a 10-minute tally'],
      ['3 Crew', 'conversations with Codex and Antigravity that Claude (or you) start'],
      ['4 Cost', "today's and this week's estimated spend, by model and session"],
      ['5 System', 'CPU and memory of Claude, its MCP servers and tools, Codex, Antigravity'],
      ['6 Actions', 'actions for the selected session, and this guide'],
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
      ['◆ approve', "a helper's suggested note stays pending until you or Claude approve it"],
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
          ◆ HOW TO USE FLEET
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
  const s = v.snap.sessions.find(x => x.sid === v.selected) ?? v.snap.sessions[0]
  const btn = (key: string, hotkey: string, label: string, color: string, onPress: () => void) => (
    <Button key={key} plain hotkey={hotkey} onPress={onPress}>
      <Text color={p.dim}>{hotkey} </Text>
      <Text color={color}>{label}</Text>
    </Button>
  )

  return (
    <Box flexDirection="column">
      {s ? Card(E, v, s, act) : <Text color={p.dim}>No live sessions.</Text>}
      {s ? (
        <Box flexDirection="column" paddingX={1}>
          <Text color={p.dim} wrap="truncate-middle">
            {s.cwd} · pid {s.pid}
          </Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={3} marginTop={1}>
            {btn('a-id', 'c', '◇ copy id', p.cyan, () => act.copy(s.sid, 'session id'))}
            {btn('a-dir', 'f', '◇ copy folder', p.cyan, () => act.copy(s.cwd, 'folder'))}
            {btn('a-open', 'o', '◇ open transcript', p.violet, () => act.open(s.transcript))}
            {s.sid === v.self ? null : btn('a-stop', 'x', '■ stop…', p.bad, () => act.stop(s))}
          </Box>
          <Text color={p.dim}>pick another session on the Live tab (1)</Text>
        </Box>
      ) : null}
      {Guide(E, v, act)}
    </Box>
  )
}

export type BandInfo = { age: number; isStale: boolean; crew: { running: number; failed: number } }

export function Band(E: Els, snap: Snapshot, p: Palette, info: BandInfo = { age: 0, isStale: false, crew: { running: 0, failed: 0 } }) {
  const { Box, Text } = E
  const busy = snap.sessions.filter(isBusy).length
  const agents = snap.sessions.reduce((n, s) => n + s.agents.length, 0)
  const need = snap.sessions.filter(needsYou)

  return (
    <Box flexDirection="row">
      <Text color={p.accent}>◆ </Text>
      {Grad(E, 'FLEET', p.accent, p.cyan, true)}
      {need.length > 0 ? (
        // the reason to look at the band comes first, before it can be cut off
        <Text color={need.some(s => s.phase === 'error') ? p.bad : p.warn} weight="bold">
          {'  '}▲ {need.map(s => s.name).join(', ')} {need.length === 1 ? 'needs' : 'need'} you
        </Text>
      ) : null}
      <Text>
        {'  '}
        {snap.sessions.map(s => (
          <Text color={sessionColor(s, p)}>●</Text>
        ))}
        <Text color={p.dim}> {snap.sessions.length} live</Text>
        {Sep(E, p)}
        <Text color={p.accent}>◉ {busy}</Text>
        <Text color={p.dim}> busy</Text>
        {Sep(E, p)}
        <Text color={p.violet}>◇ {agents}</Text>
        <Text color={p.dim}> agents</Text>
        {Sep(E, p)}
        <Text color={p.gold}>{usd(snap.cost.today)}</Text>
        <Text color={p.dim}> today</Text>
        {info.crew.running ? (
          <Text>
            {Sep(E, p)}
            <Text color={p.violet}>◇ crew {info.crew.running} running</Text>
          </Text>
        ) : null}
        {info.crew.failed ? (
          <Text>
            {Sep(E, p)}
            <Text color={p.bad}>× {info.crew.failed} failed</Text>
          </Text>
        ) : null}
        {info.isStale ? (
          <Text>
            {Sep(E, p)}
            <Text color={p.warn}>◌ stale {info.age}s</Text>
          </Text>
        ) : null}
      </Text>
    </Box>
  )
}
