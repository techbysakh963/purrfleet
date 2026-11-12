#!/usr/bin/env bash
# Renders the cat's three moods at several moments to dev/out/cat.png, from the real module.
set -e
H="$(cd "$(dirname "$0")/.." && pwd)"; B="$H/dev/.build"; rm -rf "$B"; mkdir -p "$B" "$H/dev/out"
for f in theme cat; do sed -E "s#from '\./([a-z]+)'#from './\1.ts'#" "$H/hooks/$f.ts" > "$B/$f.ts"; done
cat > "$B/dump.mjs" <<'JS'
import { catCells } from './cat.ts'
import { PALETTES } from './theme.ts'
const cols = 26, rows = 9, out = []
for (const mood of ['sleep', 'work', 'alarm'])
  out.push({ label: mood, frames: [0.3, 1.0, 1.65, 2.4, 3.71].map(t => ({ cols, rows, cells: Array.from(catCells(t, cols, rows, mood, PALETTES[0])) })) })
console.log(JSON.stringify(out))
JS
node --no-warnings "$B/dump.mjs" > "$B/frames.json"
python3 -I "$H/dev/paint.py" "$B/frames.json" "$H/dev/out/cat.png"
