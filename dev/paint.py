import json, sys
from PIL import Image, ImageDraw, ImageFont
data = json.load(open(sys.argv[1])); CW, CH = 12, 24
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 16)
pad, gap, lab = 16, 14, 24
fw = max(f['cols'] * CW for r in data for f in r['frames']); hs = [max(f['rows'] * CH for f in r['frames']) for r in data]
img = Image.new('RGB', (pad * 2 + len(data[0]['frames']) * (fw + gap), pad * 2 + sum(h + lab + gap for h in hs)), (12, 12, 16)); d = ImageDraw.Draw(img); y = pad
for row, h in zip(data, hs):
    d.text((pad, y), row['label'], fill=(190, 190, 205), font=font); y += lab
    for k, f in enumerate(row['frames']):
        x0 = pad + k * (fw + gap); c = f['cells']
        for i in range(f['cols'] * f['rows']):
            fg, bg = c[i*3+1], c[i*3+2]; cx, cy = x0 + (i % f['cols']) * CW, y + (i // f['cols']) * CH
            d.rectangle([cx, cy, cx+CW-1, cy+CH//2-1], fill=((fg>>16)&255, (fg>>8)&255, fg&255))
            d.rectangle([cx, cy+CH//2, cx+CW-1, cy+CH-1], fill=((bg>>16)&255, (bg>>8)&255, bg&255))
    y += h + gap
img.save(sys.argv[2]); print(sys.argv[2], img.size)
