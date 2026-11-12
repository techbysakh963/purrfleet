// FLEET's header aurora for the terminal's Raster element. Each cell is one
// upper-half block '▀': its foreground is the top pixel, its background the
// bottom one, so a cols × rows raster is a cols × (2·rows) truecolour image.
// Every frame is a pure function of time, so a Node preview renders the same
// pixels the pane shows. No engine imports.

import type { Palette } from './theme'
import { rgb } from './theme'


type Px = { w: number; h: number; r: Float32Array; g: Float32Array; b: Float32Array }

const newPx = (w: number, h: number): Px => ({
  w,
  h,
  r: new Float32Array(w * h),
  g: new Float32Array(w * h),
  b: new Float32Array(w * h),
})

function fill(px: Px, f: (x: number, y: number) => [number, number, number]): void {
  for (let y = 0; y < px.h; y++) {
    for (let x = 0; x < px.w; x++) {
      const [r, g, b] = f(x, y)
      const i = y * px.w + x
      px.r[i] = r
      px.g[i] = g
      px.b[i] = b
    }
  }
}

/** One 1-row-tall aurora ribbon for the pane's header; always gently moving. */
function aurora(px: Px, t: number, p: Palette, busy: number, pulse = 0): void {
  const [vr, vg, vb] = rgb(p.void)
  const [ar, ag, ab] = rgb(p.glowA)
  const [br, bg, bb] = rgb(p.glowB)
  const speed = 0.6 + Math.min(3, busy) * 0.6
  fill(px, (x, y) => {
    const u = x / px.w
    const wave = (Math.sin(u * 9 - t * speed * 2) + Math.sin(u * 23 + t * speed * 1.3) * 0.5 + 1.5) / 3
    // the docked pulse: a bright sweep across the ribbon that fades out
    const sweep = pulse > 0 ? Math.max(0, 1 - Math.abs(u - (1 - pulse)) * 6) * pulse : 0
    const k = Math.min(1.4, Math.max(0, wave - (y === 0 ? 0.15 : 0)) * 0.95 + sweep * 0.9)
    const m = (Math.sin(u * 4 + t * 0.4) + 1) / 2
    return [
      vr + (ar + (br - ar) * m - vr) * k,
      vg + (ag + (bg - ag) * m - vg) * k,
      vb + (ab + (bb - ab) * m - vb) * k,
    ]
  })
}

// ── packing ──────────────────────────────────────────────────────────────────

const UPPER_HALF = 0x2580

/** Pixels → Raster cells: [codePoint, fg, bg] per cell, row-major. */
function toCells(px: Px): Uint32Array {
  const cols = px.w
  const rows = Math.floor(px.h / 2)
  const out = new Uint32Array(cols * rows * 3)
  const c = (i: number) => {
    const r = Math.min(255, px.r[i]!) | 0
    const g = Math.min(255, px.g[i]!) | 0
    const b = Math.min(255, px.b[i]!) | 0
    return (r << 16) | (g << 8) | b
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const o = (y * cols + x) * 3
      out[o] = UPPER_HALF
      out[o + 1] = c(2 * y * cols + x)
      out[o + 2] = c((2 * y + 1) * cols + x)
    }
  }
  return out
}

export function auroraCells(t: number, cols: number, p: Palette, busy: number, pulse = 0): Uint32Array {
  const px = newPx(cols, 2)
  aurora(px, t, p, busy, pulse)
  return toCells(px)
}

// ── base64, as the Raster's `cells` prop wants it ────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(words: Uint32Array): string {
  const bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength)
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i]! << 16
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`
  }
  return out
}
