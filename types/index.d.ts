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
  sessions: Session[]
  feed: FeedItem[]
  cost: Cost
}

export type Tab = 'live' | 'needs' | 'feed' | 'crew' | 'cost' | 'actions'

export type CrewAgent = 'codex' | 'agy'
export type CrewMode = 'read' | 'edit'

/** A job handed to another coding agent, by Claude (through crew_run) or by you. */
export type CrewJob = {
  id: number
  agent: CrewAgent
  mode: CrewMode
  by: 'claude' | 'you'
  task: string
  cwd: string
  status: 'running' | 'done' | 'failed' | 'stopped'
  started: number
  ended?: number
  code?: number | null
  /** stdout: the agent's answer */
  output: string
  /** stdout and stderr together: its progress */
  log: string
  /** the last few progress lines, for the tab */
  tail: string[]
  /** a finished job Claude has been told about (or that you sent it) */
  isHanded: boolean
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
      crew: Shaped<CrewJob[]>
      crewAgent: CrewAgent
      crewMode: CrewMode
    }
  }
}
