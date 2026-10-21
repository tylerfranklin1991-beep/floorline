#!/usr/bin/env python3
"""Draw the Floorline Beta launcher icons (the favicon mark + an orange BETA bar)
into android/app/src/main/res. Re-run after `npx cap add android`. Needs Pillow."""
from PIL import Image, ImageDraw
import os
RES = os.path.join(os.path.dirname(__file__), "..", "android", "app", "src", "main", "res")
DARK, PAPER, INK, ACCENT = "#101112", "#f4f0e6", "#1c1b18", "#e8772e"

def mark(size, pad_frac, bg=True, round_=False):
    S = size * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg:
        if round_: d.ellipse([0, 0, S, S], fill=DARK)
        else: d.rounded_rectangle([0, 0, S, S], radius=S * 7 // 32, fill=DARK)
    p = S * pad_frac; u = (S - 2 * p) / 22  # 22-unit art box, as in favicon.svg
    X = lambda v: p + (v - 5) * u
    d.rounded_rectangle([X(5), X(5), X(27), X(27)], radius=2 * u, fill=PAPER)
    d.polygon([(X(9), X(9)), (X(22), X(9)), (X(22), X(14)), (X(14), X(14)), (X(14), X(24)), (X(9), X(24))], fill=INK)
    d.rectangle([X(16), X(21), X(22), X(23)], fill=ACCENT)
    return im.resize((size, size), Image.LANCZOS)

dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for name, k in dens.items():
    dd = os.path.join(RES, f"mipmap-{name}")
    mark(int(48 * k), 0.16).save(os.path.join(dd, "ic_launcher.png"))
    mark(int(48 * k), 0.2, round_=True).save(os.path.join(dd, "ic_launcher_round.png"))
    mark(int(108 * k), 0.3, bg=False).save(os.path.join(dd, "ic_launcher_foreground.png"))
with open(os.path.join(RES, "values", "ic_launcher_background.xml"), "w") as f:
    f.write(f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{DARK}</color>\n</resources>\n')
