import type { Phase, Session } from '../types'
import type { Palette } from './theme'

export const ago = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
}

export const usd = (n: number): string =>
  n >= 100 ? `$${n.toFixed(0)}` : n >= 10 ? `$${n.toFixed(1)}` : `$${n.toFixed(2)}`

export const tok = (n: number): string =>
  n < 1000 ? `${n}` : n < 999_500 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`

export const bar = (pct: number, width: number): string => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '▰'.repeat(full) + '▱'.repeat(width - full)
}

const SPARKS = '▁▂▃▄▅▆▇█'
export const spark = (values: readonly number[]): string => {
  const max = Math.max(...values, 0)
  return values
    .map(v => (max <= 0 ? SPARKS[0] : SPARKS[Math.min(7, Math.round((v / max) * 7))]))
    .join('')
}

export const cut = (text: string, width: number): string =>
  width <= 1 ? '' : text.length > width ? `${text.slice(0, width - 1)}…` : text

/** A session needs you while it waits on a prompt or a question, or ended a turn on an error. */
export const needsYou = (s: Session): boolean => s.phase === 'waiting' || s.phase === 'error'

export const isBusy = (s: Session): boolean =>
  s.phase === 'thinking' || s.phase === 'compacting' || s.tools.length > 0 || s.agents.length > 0

/** How a state looks: a text glyph (never an emoji), a word, a palette colour. */
export const phaseLook = (phase: Phase, p: Palette): { glyph: string; label: string; color: string } => {
  switch (phase) {
    case 'thinking':
      return { glyph: '◉', label: 'BUSY', color: p.accent }
    case 'compacting':
      return { glyph: '◎', label: 'COMPACTING', color: p.violet }
    case 'waiting':
      return { glyph: '▲', label: 'NEEDS YOU', color: p.warn }
    case 'error':
      return { glyph: '×', label: 'ERROR', color: p.bad }
    case 'ready':
      return { glyph: '◇', label: 'READY', color: p.ok }
    default:
      return { glyph: '○', label: 'IDLE', color: p.dim }
  }
}

/** Elapsed time as 00:03:20, the way a stopwatch reads. */
export const hms = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds))
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':')
}

/** Context fill against a 1M window (every current model's; Haiku 4.5's 200k is the exception). */
export const ctxPct = (s: Session): number => {
  const window = /haiku-4/.test(s.model) ? 200_000 : 1_000_000
  return Math.min(100, Math.round((s.ctx / window) * 100))
}

export const clock = (epoch: number): string => {
  const d = new Date(epoch * 1000)
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':')
}

/** What a session is up to, in a few words. */
export function activity(s: Session): string {
  const tool = s.tools[s.tools.length - 1]
  if (s.phase === 'error') return 'last turn ended on an API error'
  if (needsYou(s)) return tool ? `${tool.tool}: ${tool.detail}` : 'waiting for your permission'
  if (tool) return `› ${tool.tool} ${tool.detail}`
  if (s.phase === 'thinking') return 'thinking…'
  if (s.phase === 'compacting') return 'compacting its context…'
  return s.phase === 'ready' ? 'ready' : 'idle'
}

