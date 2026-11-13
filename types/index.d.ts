// FLEET's state contract: every value the pane and band draw from.

export type Tool = { tool: string; detail: string; since: number }

export type Agent = {
  id: string
  type: string
  task: string
  since: number
  tokens: number
  ctx: number
}

export type Phase =
  | 'ready'
  | 'thinking'
  | 'waiting'
  | 'compacting'
  | 'idle'
  | 'error'
  | (string & {})

export type Session = {
  pid: number
  sid: string
  name: string
  cwd: string
  status: string
  phase: Phase
  phaseSince: number
  startedAt: number
  tools: Tool[]
  agents: Agent[]
  calls: number
  model: string
  ctx: number
  cost: number
  tokens: number
  /** today's part of cost and tokens */
  costToday?: number
  tokensToday?: number
  transcript: string
  branch: string
  added: number
  removed: number
}

export type FeedItem = {
  t: number
  sid: string
  name: string
  tool: string
  detail: string
  agent: boolean
}

export type Cost = {
  today: number
  tokens: number
  cacheHit: number
  days: { date: string; usd: number }[]
  models: Record<string, number>
  pendingBytes: number
}

export type Snapshot = {
  now: number
  sys?: SysInfo
  /** every tool call of the last 10 minutes: session id → tool → count */
  tally?: Record<string, Record<string, number>>
  sessions: Session[]
  feed: FeedItem[]
  cost: Cost
}

export type Tab = 'live' | 'needs' | 'crew' | 'actions'

export type CrewAgent = 'codex' | 'agy'

/** One message to a crew thread and the helper's answer to it. */
export type CrewTurn = {
  n: number
  by: 'claude' | 'you'
  /** what was asked, as written (the brief wrapped around it is not kept) */
  ask: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  started: number
  ended?: number
  answer: string
  /** progress lines: commands it ran, steps, errors */
  log: string[]
  contextTokens: number
  outputTokens: number
  /** a finished turn Claude has been told about */
  isHanded: boolean
  /** finished and nobody has looked yet: shown under TO READ (or NEEDS YOU when failed) */
  unread?: boolean
  /** the turn that wrote a state brief before the thread was compacted */
  isCompaction?: boolean
}

/** A named, ongoing conversation with one helper agent. */
export type CrewThread = {
  name: string
  agent: CrewAgent
  model: string
  effort: string
  cwd: string
  by: 'claude' | 'you'
  /** the helper's own conversation id, to resume it */
  session: string
  status: 'idle' | 'running' | 'failed'
  turns: CrewTurn[]
  compactions: number
  /** the turn number the last compaction happened before (0: never) */
  compactedAt?: number
  /** the state brief a compaction carried into the fresh conversation */
  brief: string
  created: number
  updated: number
}

export type ProcGroup = {
  name: string
  count: number
  cpu: number
  rssMb: number
  history: number[]
}

export type SysInfo = {
  groups: ProcGroup[]
  top: { pid: number; group: string; cpu: number; rssMb: number; cmd: string }[]
  memTotalMb: number
  memUsedMb: number
  load: number[]
  cores: number
}

declare module 'claude-code' {
  interface PluginState {
    fleet: {
      snap: Shaped<Snapshot | null>
      error: string | null
      tab: Tab
      selected: string | null
      threads: Shaped<CrewThread[]>
      crewSel: string | null
      crewAgent: CrewAgent
      crewModel: string
      crewEffort: string
      crewModels: { codex: string[]; agy: string[] }
      crewFolder: string | null
      crewOpenTurn: string | null
      crewDraft: string
      crewInputGen: number
      crewShowAll: boolean
      crewOptions: boolean
      toured: boolean
      crewAllTurns: string | null
      /** a one-line crew update beside the user's prompt, for Claude only */
      statusLine: boolean
      /** the crew news Claude was last given (or read itself), so it isn't repeated */
      statusTold: string
    }
  }
}
