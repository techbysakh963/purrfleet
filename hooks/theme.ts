// FLEET's palette, by role, plus the colour maths the views need. Pure data.

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

/** FLEET's one palette (nebula). */
export const PALETTE: Palette = {
  need: '#ffa53d',
  fail: '#ff6b86',
  read: '#4fd1ff',
  work: '#9d8cff',
  ok: '#3ddc97',
  money: '#e9d58f',
  text: '#e6e9f5',
  dim: '#8f97b8',
  faint: '#4a5080',
}

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
