// The idle scene: a pulsing core with three satellites in orbit, leaving fading
// trails, over a slow scrolling wave. Pure: frame number and size in, lines out.

const CORE = ['◇', '◈', '◆', '◈']
const TRAIL = ['●', '•', '∙', '·']
const WAVE = '▁▂▃▄▅▆▇█'

export const IDLE_ROWS = 9

export function idleFrame(frame: number, width: number): string[] {
  const w = Math.max(20, Math.min(width, 60))
  const h = IDLE_ROWS - 2
  const grid: string[][] = Array.from({ length: h }, () => Array(w).fill(' '))
  const cx = Math.floor(w / 2)
  const cy = Math.floor(h / 2)
  const rx = Math.min(cx - 2, 16)
  const ry = Math.max(2, cy - 0.5)

  const plot = (x: number, y: number, ch: string) => {
    const col = Math.round(x)
    const row = Math.round(y)
    const line = grid[row]
    if (line !== undefined && col >= 0 && col < w && line[col] === ' ') line[col] = ch
  }

  // satellites first, so newer marks win over trails
  for (let k = 0; k < 3; k++) {
    for (let t = 0; t < TRAIL.length; t++) {
      const a = (frame - t * 1.4) * 0.18 + (k * 2 * Math.PI) / 3
      plot(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, TRAIL[t] ?? '·')
    }
  }
  const mid = grid[cy]
  if (mid !== undefined) mid[cx] = CORE[Math.floor(frame / 3) % CORE.length] ?? '◈'
  // faint ring sparks that blink in and out
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + frame * 0.03
    if ((frame + i * 5) % 14 < 4) plot(cx + Math.cos(a) * (rx + 2), cy + Math.sin(a) * (ry + 0.6), '+')
  }

  const wave = Array.from({ length: w }, (_, x) => {
    const v = (Math.sin((x + frame) * 0.35) + Math.sin((x - frame * 0.6) * 0.17)) / 2
    return WAVE[Math.max(0, Math.min(7, Math.round((v + 1) * 3.5)))]
  }).join('')

  const caption = 'all quiet · the fleet is on standby'
  const pad = Math.max(0, Math.floor((w - caption.length) / 2))
  return [...grid.map(r => r.join('')), wave, ' '.repeat(pad) + caption]
}
