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
  /** today's part of cost and tokens (Cost's "today by session") */
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

export type Tab = 'live' | 'needs' | 'feed' | 'crew' | 'cost' | 'system' | 'actions'

export type CrewAgent = 'codex' | 'agy'
export type CrewMode = 'read' | 'edit'

/** A fact in a project's shared crew notebook: what every helper's brief carries. */
export type CrewNote = {
  id: number
  text: string
  by: 'claude' | 'codex' | 'agy' | 'you'
  at: number
  /** a helper's offer: kept out of every brief until you or Claude approve it */
  pending?: boolean
}

/** What a Codex edit turn changed, waiting in its own git worktree until you accept or discard it. */
export type Delivery = {
  /** the worktree Codex edited in */
  path: string
  /** the repository's top folder: patches are made and applied from here */
  root?: string
  /** the commit the turn started from: the diff covers Codex's commits too */
  base?: string
  files: { path: string; added: number; removed: number }[]
  state: 'pending' | 'accepted' | 'discarded'
  /** why the last accept failed, if it did */
  note?: string
}

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
  /** a Codex edit turn's changes, apart from your tree until you accept them */
  delivery?: Delivery
  /** the turn that wrote a state brief before the thread was compacted */
  isCompaction?: boolean
}

/** A named, ongoing conversation with one helper agent. */
export type CrewThread = {
  name: string
  agent: CrewAgent
  model: string
  effort: string
  mode: CrewMode
  cwd: string
  by: 'claude' | 'you'
  /** the helper's own conversation id, to resume it */
  session: string
  status: 'idle' | 'running' | 'failed'
  turns: CrewTurn[]
  compactions: number
  /** the turn number the last compaction happened before (0: never) */
  compactedAt?: number
  /** the approved notes this helper's conversation has already been sent */
  sentNotes?: { id: number; text: string }[]
  /** the state brief a compaction carried into the fresh conversation */
  brief: string
  /** the window running this thread now: its session id, when its run began, its last heartbeat */
  lease?: { sid: string; since: number; at: number }
  /** another window asked the owner to stop this thread (epoch seconds) */
  stopAsked?: number
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
      feedFilter: string | null
      theme: string
      scene: string
      threads: Shaped<CrewThread[]>
      crewSel: string | null
      crewAgent: CrewAgent
      crewMode: CrewMode
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
      notebooks: Record<string, CrewNote[]>
      /** the diff open in the Crew tab: "thread#n" and its text */
      crewDiff: { key: string; text: string } | null
      /** a one-line crew update beside the user's prompt, for Claude only */
      statusLine: boolean
      /** the crew news Claude was last given (or read itself), so it isn't repeated */
      statusTold: string
    }
  }
}
