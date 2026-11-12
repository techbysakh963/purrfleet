// FLEET's palettes. Pure data plus colour maths, shared by the views (hex strings)
// and the pixel scenes (0xRRGGBB numbers). No engine imports, so a plain Node
// script can render previews from the very same values.

export type Palette = {
  name: string
  /** pixel scenes */
  void: number // deepest background
  deep: number // nebula / glow base
  glowA: number // first glow colour
  glowB: number // second glow colour
  star: number
  /** text */
  accent: string // headings, brand mark
  cyan: string // models, tools
  violet: string // agents, branch
  ok: string
  warn: string
  bad: string
  gold: string // money
  dim: string
  text: string
  border: string
}

export const PALETTES: Palette[] = [
  {
    name: 'nebula',
    void: 0x070a18,
    deep: 0x1a1446,
    glowA: 0x7c6cff,
    glowB: 0x34d4ff,
    star: 0xe8ecff,
    accent: '#9d8cff',
    cyan: '#4fd1ff',
    violet: '#b48cff',
    ok: '#3ddc97',
    warn: '#ffa53d', // needs-you: a strong amber
    bad: '#ff5c7a',
    gold: '#e9d58f', // money: a pale gold, clearly not the warning
    dim: '#6b7394',
    text: '#e6e9f5',
    border: '#3a3f66',
  },
  {
    name: 'ember',
    void: 0x0e0907,
    deep: 0x3a1408,
    glowA: 0xff6a3d,
    glowB: 0xffc247,
    star: 0xfff1e0,
    accent: '#ff8a5c',
    cyan: '#5eead4',
    violet: '#f0a6ff',
    ok: '#7ee08a',
    warn: '#ffa940',
    bad: '#ff5a5a',
    gold: '#eadbab',
    dim: '#8a7468',
    text: '#f5ebe4',
    border: '#5a3a2c',
  },
  {
    name: 'synthwave',
    void: 0x0a0414,
    deep: 0x2a0a3e,
    glowA: 0xff3fd2,
    glowB: 0x22d3ee,
    star: 0xfdf4ff,
    accent: '#ff5fd7',
    cyan: '#22d3ee',
    violet: '#c084fc',
    ok: '#4ade80',
    warn: '#fde047',
    bad: '#fb7185',
    gold: '#f6b86b', // money: a warm amber, never the warning yellow
    dim: '#7c6a93',
    text: '#f5e9ff',
    border: '#4b2a66',
  },
]

export const paletteOf = (name: string): Palette => PALETTES.find(p => p.name === name) ?? PALETTES[0]!

// ── colour maths ─────────────────────────────────────────────────────────────

export const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255]
export const pack = (r: number, g: number, b: number): number =>
  (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)
const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))

export const mix = (a: number, b: number, t: number): number => {
  const [ar, ag, ab] = rgb(a)
  const [br, bg, bb] = rgb(b)
  const k = Math.max(0, Math.min(1, t))
  return pack(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k)
}

export const hexToNum = (hex: string): number => parseInt(hex.slice(1), 16)
export const numToHex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`

/** Green → yellow → red, the way a fuel gauge reads: t in 0..1. */
export const heat = (t: number, p: Palette): string => {
  const ok = hexToNum(p.ok)
  const warn = hexToNum(p.warn)
  const bad = hexToNum(p.bad)
  return numToHex(t < 0.55 ? mix(ok, warn, t / 0.55) : mix(warn, bad, (t - 0.55) / 0.45))
}

/** A per-character gradient between two hex colours. */
export const ramp = (text: string, from: string, to: string): { ch: string; color: string }[] => {
  const chars = [...text]
  const a = hexToNum(from)
  const b = hexToNum(to)
  return chars.map((ch, i) => ({ ch, color: numToHex(mix(a, b, chars.length < 2 ? 0 : i / (chars.length - 1))) }))
}
