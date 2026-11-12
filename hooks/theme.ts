// FLEET's palettes. Pure data plus colour maths, shared by the views (hex strings)
// and the pixel scenes (0xRRGGBB numbers). No engine imports, so a plain Node
// script can render previews from the very same values.

/**
 * A palette by ROLE, never by colour name: each role has one place it may appear.
 *   need   ▲ waiting on the user          fail  × something failed; destructive words; diff −
 *   read   ◆ an unread result; diff @@     work  ● running now; filled bar cells
 *   ok     constructive words; diff +     money any $ amount, and nothing else
 *   text   content                         dim   supporting: ages, labels, keys, quiet rows
 *   faint  decoration only: rules, empty bar cells, borders
 * State colours belong to the mark column (and its rail, and the four inbox heads).
 * Contrast targets on dark backgrounds: text ≥ 7:1, dim and marks ≥ 4.5:1.
 */
export type Palette = {
  name: string
  /** pixel scenes (the cat) */
  void: number
  deep: number
  glowA: number
  glowB: number
  star: number
  need: string
  fail: string
  read: string
  work: string
  ok: string
  money: string
  text: string
  dim: string
  faint: string
}

export const PALETTES: Palette[] = [
  {
    name: 'nebula',
    void: 0x070a18,
    deep: 0x1a1446,
    glowA: 0x7c6cff,
    glowB: 0x34d4ff,
    star: 0xe8ecff,
    need: '#ffa53d',
    fail: '#ff6b86',
    read: '#4fd1ff',
    work: '#9d8cff',
    ok: '#3ddc97',
    money: '#e9d58f',
    text: '#e6e9f5',
    dim: '#8f97b8',
    faint: '#4a5080',
  },
  {
    name: 'ember',
    void: 0x0e0907,
    deep: 0x3a1408,
    glowA: 0xff6a3d,
    glowB: 0xffc247,
    star: 0xfff1e0,
    need: '#ffd23f',
    fail: '#ff5d7a',
    read: '#5eead4',
    work: '#ff8a5c',
    ok: '#7ee08a',
    money: '#eadbab',
    text: '#f5ebe4',
    dim: '#a8948a',
    faint: '#6b4a3a',
  },
  {
    name: 'synthwave',
    void: 0x0a0414,
    deep: 0x2a0a3e,
    glowA: 0xff3fd2,
    glowB: 0x22d3ee,
    star: 0xfdf4ff,
    need: '#fde047',
    fail: '#ff6a55',
    read: '#22d3ee',
    work: '#ff5fd7',
    ok: '#4ade80',
    money: '#f0dfb4',
    text: '#f5e9ff',
    dim: '#a08fb8',
    faint: '#5a3a78',
  },
  {
    // for light terminals: every role readable on white
    name: 'paper',
    void: 0xf3f1ea,
    deep: 0xd9d4ea,
    glowA: 0x6d28d9,
    glowB: 0x0369a1,
    star: 0x1f2330,
    need: '#b45309',
    fail: '#c81e3a',
    read: '#0369a1',
    work: '#6d28d9',
    ok: '#15803d',
    money: '#7a5c00',
    text: '#1f2330',
    dim: '#5b6272',
    faint: '#c4c8d4',
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

/** WCAG contrast ratio between two hex colours (for the palette tests). */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = rgb(hexToNum(hex)).map(v => {
      const c = v / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x! + 0.05) / (y! + 0.05)
}

/** A per-character gradient between two hex colours. */
export const ramp = (text: string, from: string, to: string): { ch: string; color: string }[] => {
  const chars = [...text]
  const a = hexToNum(from)
  const b = hexToNum(to)
  return chars.map((ch, i) => ({ ch, color: numToHex(mix(a, b, chars.length < 2 ? 0 : i / (chars.length - 1))) }))
}
