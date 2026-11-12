// FLEET's cat: an original pixel-art goof who reports the fleet's mood.
//   sleep : nothing is running        → curled eyes shut, z's float up
//   work  : sessions are busy         → derpy darting eyes, tail whips, paws tap
//   alarm : a session needs you       → eyes like saucers, ears up, a blinking "!"
// Every frame is a pure function of time and mood, so a Node preview renders the
// same pixels the pane shows. No engine imports.

import type { Palette } from './theme'
import { mix, rgb } from './theme'

export type Mood = 'sleep' | 'work' | 'alarm'

// The sprite, front-facing, 18 × 16 px. Each letter is a colour role:
// O outline · F fur · S stripe · W white (muzzle, belly, paws) · P inner ear
// N nose · T tongue · E eye (filled later) · . see-through
const BODY = [
  '..OO..........OO..',
  '.OPPO........OPPO.',
  '.OPFFO......OFFPO.',
  '.OFFFFOOOOOOFFFFO.',
  'OFFSSFFFFFFFFSSFFO',
  'OFFFFFFFFFFFFFFFFO',
  'OFFEEEFFFFFFEEEFFO',
  'OFFEEEFFFFFFEEEFFO',
  'OFFFFFFFWNWFFFFFFO',
  'OSFFFFFWWWWWFFFFSO',
  '.OFFFFFFWWWFFFFFO.',
  '..OOFFFFFFFFFFOO..',
  '..OFFFWWWWWWFFFO..',
  '.OFFFWWWWWWWWFFFO.',
  '.OFSFWWWWWWWWFSFO.',
  '.OOWWOOOOOOOOWWOO.',
]
const W = 18
const H = 16
const EYE_ROW = 6 // the eyes are 3 × 2 at x 3 and x 12
const EYES_X = [3, 12]

const FUR = 0xf2a65a
const STRIPE = 0xc7702e
const WHITE = 0xfff4e6
const OUTLINE = 0x2a1a12
const PINK = 0xff9fb2
const TONGUE = 0xff6f91
const PUPIL = 0x14101a

type Canvas = { w: number; h: number; px: Uint32Array; set: (x: number, y: number, c: number) => void }

function canvas(w: number, h: number, bg: (x: number, y: number) => number): Canvas {
  const px = new Uint32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = bg(x, y)
  return {
    w,
    h,
    px,
    set(x, y, c) {
      const xi = Math.round(x)
      const yi = Math.round(y)
      if (xi >= 0 && yi >= 0 && xi < w && yi < h) px[yi * w + xi] = c
    },
  }
}

const ROLE: Record<string, number> = { O: OUTLINE, F: FUR, S: STRIPE, W: WHITE, P: PINK, N: PINK }

/** Where each pupil sits inside its 3 × 2 eye: [dx, dy], 0..1 each way. */
function derpEyes(t: number, mood: Mood): [[number, number], [number, number]] {
  if (mood === 'alarm') return [[1, 1], [1, 1]]
  // each eye wanders on its own schedule: the goofy part
  const a = Math.floor(t * 1.7)
  const b = Math.floor(t * 1.3 + 0.5)
  const looks: [number, number][] = [[0, 0], [2, 0], [1, 1], [0, 1], [2, 1], [1, 0]]
  const look = (n: number): [number, number] => looks[n % looks.length] ?? [1, 1]
  return [look(a * 7 + 1), look(b * 5 + 4)]
}

function drawCat(c: Canvas, ox: number, oy: number, t: number, mood: Mood): void {
  const isBlink = mood !== 'sleep' && t % 3.7 < 0.14
  const isBlep = mood === 'work' && t % 5.3 < 1.6
  const earUp = mood === 'alarm' ? -1 : 0
  for (let y = 0; y < H; y++) {
    const row = BODY[y]!
    for (let x = 0; x < W; x++) {
      const ch = row[x]!
      if (ch === '.' || ch === 'E') continue
      const dy = y <= 2 ? earUp : 0
      c.set(ox + x, oy + y + dy, ROLE[ch] ?? FUR)
    }
  }
  // eyes
  const pupils = derpEyes(t, mood)
  EYES_X.forEach((ex, k) => {
    if (mood === 'sleep' || isBlink) {
      // closed: a little smile-shaped line
      c.set(ox + ex, oy + EYE_ROW + 1, OUTLINE)
      c.set(ox + ex + 1, oy + EYE_ROW + 1, OUTLINE)
      c.set(ox + ex + 2, oy + EYE_ROW + 1, OUTLINE)
      c.set(ox + ex, oy + EYE_ROW, FUR)
      c.set(ox + ex + 1, oy + EYE_ROW, FUR)
      c.set(ox + ex + 2, oy + EYE_ROW, FUR)
      return
    }
    const top = mood === 'alarm' ? -1 : 0 // saucers: the whites grow a row taller
    for (let yy = top; yy < 2; yy++) for (let xx = 0; xx < 3; xx++) c.set(ox + ex + xx, oy + EYE_ROW + yy, WHITE)
    const [px, py] = pupils[k]!
    c.set(ox + ex + px, oy + EYE_ROW + py - (mood === 'alarm' ? 1 : 0), PUPIL)
  })
  // the blep: a tongue poking out under the nose
  if (isBlep) {
    c.set(ox + 9, oy + 10, TONGUE)
    c.set(ox + 9, oy + 11, TONGUE)
  }
  if (mood === 'alarm') {
    // mouth open in shock
    c.set(ox + 8, oy + 10, OUTLINE)
    c.set(ox + 9, oy + 10, PUPIL)
    c.set(ox + 10, oy + 10, OUTLINE)
  }
  // paws tap while working
  if (mood === 'work') {
    const tap = Math.floor(t * 6) % 2
    c.set(ox + 3, oy + 15 - tap, WHITE)
    c.set(ox + 4, oy + 15 - tap, WHITE)
    c.set(ox + 13, oy + 14 + tap, WHITE)
    c.set(ox + 14, oy + 14 + tap, WHITE)
  }
}

function drawTail(c: Canvas, ox: number, oy: number, t: number, mood: Mood): void {
  const speed = mood === 'work' ? 5 : mood === 'alarm' ? 12 : 0.8
  const amp = mood === 'sleep' ? 0.6 : mood === 'alarm' ? 1.4 : 2
  // a fat curved tail: rises from the right hip, curls at the tip, swishes
  for (let i = 0; i < 12; i++) {
    const k = i / 11
    const sway = Math.sin(t * speed - i * 0.45) * amp * k
    const x = ox + W - 2 + Math.sin(k * 2.2) * 5 + sway
    const y = oy + H - 2 - k * 10
    const colour = i >= 9 ? STRIPE : i % 4 === 2 ? STRIPE : FUR
    c.set(x, y, colour)
    c.set(x + 1, y, colour)
    c.set(x + 2, y, OUTLINE)
    c.set(x - 1, y, OUTLINE)
    if (mood === 'alarm') {
      c.set(x - 1, y, FUR) // puffed up
      c.set(x - 2, y, OUTLINE)
    }
  }
  c.set(ox + W - 2 + Math.sin(2.2) * 5 + Math.sin(t * speed - 11 * 0.45) * amp, oy + H - 13, OUTLINE)
}

/** A fat pixel 'z' or '!' drawn from tiny bitmaps. */
const GLYPH: Record<string, string[]> = {
  z: ['###', '..#', '.#.', '#..', '###'],
  Z: ['####', '...#', '..#.', '.#..', '####'],
  '!': ['#', '#', '#', '.', '#'],
}
function glyph(c: Canvas, g: string, x: number, y: number, color: number): void {
  GLYPH[g]!.forEach((row, yy) => [...row].forEach((ch, xx) => ch === '#' && c.set(x + xx, y + yy, color)))
}

export function catPixels(t: number, w: number, h: number, mood: Mood, p: Palette): Uint32Array {
  const glowColor = mood === 'alarm' ? parseInt(p.warn.slice(1), 16) : p.glowA
  const cx = w / 2
  const c = canvas(w, h, (x, y) => {
    // a soft spotlight behind the cat, a floor line under it
    const d = Math.hypot((x - cx) / (w * 0.5), (y - h * 0.55) / (h * 0.7))
    const k = Math.max(0, 1 - d) ** 2 * (mood === 'alarm' ? 0.4 + 0.2 * Math.sin(t * 8) : 0.3)
    const base = mix(p.void, glowColor, k)
    return y === h - 1 ? mix(base, p.glowB, 0.35) : base
  })
  const bob = mood === 'work' ? Math.round(Math.abs(Math.sin(t * 4)) * -1) : mood === 'alarm' ? Math.round(Math.sin(t * 20)) * 0 - (Math.floor(t * 10) % 2) : 0
  const breathe = mood === 'sleep' ? (Math.sin(t * 1.5) > 0 ? 0 : -1) : 0
  const ox = Math.round(cx - W / 2 - 3)
  const oy = h - 1 - H + bob + breathe
  drawTail(c, ox, oy, t, mood)
  drawCat(c, ox, oy, t, mood)
  if (mood === 'sleep') {
    // the snot bubble: swells with each breath, then pops and starts again
    const r = ((t * 0.5) % 1) * 3.2
    if (r > 0.6) {
      const bx = ox + 11 + r
      const by = oy + 9
      for (let a = 0; a < 24; a++) {
        const th = (a / 24) * Math.PI * 2
        c.set(bx + Math.cos(th) * r, by + Math.sin(th) * r, mix(p.glowB, 0xffffff, 0.5))
      }
      c.set(bx - r * 0.4, by - r * 0.4, 0xffffff)
    }
    // z's drift up and to the right, fading
    for (let k = 0; k < 2; k++) {
      const phase = (t * 0.3 + k / 2) % 1
      // the z's drift up beside the head, and never off the canvas
      const zx = Math.min(w - 5, ox + W + 1 + phase * 6 + (k === 1 ? 1 : 0))
      const zy = oy + 3 - phase * (h * 0.45)
      if (zy > -5) glyph(c, phase > 0.5 ? 'Z' : 'z', zx, zy, mix(p.void, p.star, 1 - phase * 0.8))
    }
  }
  if (mood === 'alarm' && Math.floor(t * 4) % 2 === 0) {
    glyph(c, '!', ox + W / 2 - 0.5, Math.max(0, oy - 7), parseInt(p.warn.slice(1), 16))
  }
  return c.px
}

/** Pixels → Raster cells, two pixels per cell with the upper-half block. */
export function catCells(t: number, cols: number, rows: number, mood: Mood, p: Palette): Uint32Array {
  const px = catPixels(t, cols, rows * 2, mood, p)
  const out = new Uint32Array(cols * rows * 3)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const o = (y * cols + x) * 3
      out[o] = 0x2580
      out[o + 1] = px[2 * y * cols + x]!
      out[o + 2] = px[(2 * y + 1) * cols + x]!
    }
  }
  return out
}

export const CAT_SIZE = { w: W, h: H }
export { rgb }
