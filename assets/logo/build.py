#!/usr/bin/env python3
"""Webimation logo: one chunky 90s CRT monitor with a big play button, a dithered drop shadow and
pixel sparkles, on a blue tile.

Everything is drawn on a 64x64 pixel grid with exact integer rasterisation (no anti-aliased
pixels), then exported as crisp SVG rects. Outputs (next to this file):
  Webimation.icon/          Icon Composer bundle (layered for Liquid Glass depth)
  logo.svg                  mark on transparent background
  lockup-dark.svg / -light  mark + pixel wordmark
  app-icon.svg              flat tile for Windows / Linux / older macOS
Run:  python3 assets/logo/build.py
"""
import json, os, shutil

N = 64            # logical pixel grid
S = 1024 // N     # 16 px per logical pixel in the 1024 icon canvas
OY = 1            # shift the whole drawing down one pixel so it sits optically centred
HERE = os.path.dirname(os.path.abspath(__file__))

# ── palette ─────────────────────────────────────────────────────────────────
OUT = '#0B0B0C'
BEZ_HI, BEZ, BEZ_SH, BEZ_DK = '#FBF8EF', '#E3DDCF', '#B4AE9F', '#6E6A60'
SCR, SCR_LINE, SCR_RIM = '#0A1713', '#10261D', '#34322D'
PLAY, PLAY_HI, PLAY_SH = '#2BE58C', '#B6FFD9', '#139A5D'
LED = '#2BE58C'
SHADOW = '#0B2A86'
SPARK = '#FFFFFF'


class Layer:
    def __init__(self, name):
        self.name, self.px = name, {}

    def put(self, x, y, c):
        y += OY
        if 0 <= x < N and 0 <= y < N:
            self.px[(x, y)] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)

    def rrect(self, x0, y0, x1, y1, c, r=2):
        """Filled rectangle with pixel-stepped corners (r = 1, 2 or 3 pixels)."""
        cut = {1: [(0, 0)], 2: [(0, 0), (1, 0), (0, 1)], 3: [(0, 0), (1, 0), (2, 0), (0, 1), (0, 2), (1, 1)]}[r]
        skip = set()
        for dx, dy in cut:
            skip |= {(x0 + dx, y0 + dy), (x1 - dx, y0 + dy), (x0 + dx, y1 - dy), (x1 - dx, y1 - dy)}
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if (x, y) not in skip:
                    self.put(x, y, c)

    def svg_rects(self, scale, ox=0, oy=0):
        """Merge horizontal runs of one colour into single rects."""
        out = []
        for y in range(N):
            x = 0
            while x < N:
                c = self.px.get((x, y))
                if not c:
                    x += 1
                    continue
                x1 = x
                while self.px.get((x1 + 1, y)) == c:
                    x1 += 1
                out.append(f'<rect x="{ox + x * scale}" y="{oy + y * scale}" width="{(x1 - x + 1) * scale}" height="{scale}" fill="{c}"/>')
                x = x1 + 1
        return '\n'.join(out)


def draw_monitor():
    m = Layer('monitor')
    # CRT body: outline, bevelled bezel
    m.rrect(7, 5, 56, 46, OUT, 3)
    m.rrect(8, 6, 55, 45, BEZ, 2)
    m.rect(11, 7, 52, 7, BEZ_HI)
    m.rect(9, 9, 9, 42, BEZ_HI)
    m.rect(11, 44, 52, 44, BEZ_SH)
    m.rect(54, 9, 54, 42, BEZ_SH)
    # recessed screen
    m.rrect(12, 10, 51, 41, BEZ_SH, 3)
    m.rect(14, 41, 49, 41, BEZ_HI)
    m.rect(51, 13, 51, 39, BEZ_HI)
    m.rrect(13, 11, 50, 40, SCR_RIM, 3)
    m.rrect(14, 12, 49, 39, SCR, 2)
    for y in range(14, 39, 2):
        for x in range(14, 50):
            if m.px.get((x, y + OY)) == SCR:
                m.put(x, y, SCR_LINE)
    # bezel: vent slots and power LED
    for x in (14, 16, 18, 20):
        m.rect(x, 43, x + 1, 43, BEZ_SH)
    m.rect(47, 43, 48, 43, LED)
    # neck and base
    m.rect(23, 47, 40, 50, OUT)
    m.rect(24, 47, 39, 49, BEZ_SH)
    m.rect(24, 47, 25, 49, BEZ)
    m.rrect(14, 50, 49, 55, OUT, 1)
    m.rrect(15, 51, 48, 54, BEZ, 1)
    m.rect(16, 51, 47, 51, BEZ_HI)
    m.rect(16, 54, 47, 54, BEZ_SH)
    return m


def draw_play():
    p = Layer('play')
    TX, TY, H = 25, 17, 17
    mid = H // 2
    for row in range(H):
        w = (mid - abs(row - mid)) * 2 + 1
        for x in range(w):
            p.put(TX + x, TY + row, PLAY)
        p.put(TX + w - 1, TY + row, PLAY_SH if row >= mid else PLAY)
        if row < mid:
            p.put(TX + w - 1, TY + row, PLAY_HI if w > 2 else PLAY)
    p.rect(TX, TY, TX, TY + H - 1, PLAY_HI)
    p.rect(TX + 1, TY + 1, TX + 1, TY + H - 2, PLAY_HI)
    # glass glare in the screen's top-left corner
    for dx, dy in ((0, 0), (1, 0), (2, 0), (0, 1), (0, 2)):
        p.put(16 + dx, 14 + dy, '#3B6E5A')
    # pixel sparkles: one big, one small
    for dx, dy in ((0, 0), (1, 0), (2, 0), (-1, 0), (-2, 0), (0, 1), (0, 2), (0, -1), (0, -2)):
        p.put(59 + dx, 6 + dy, SPARK)
    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        p.put(4 + dx, 49 + dy, SPARK)
    return p


def draw_shadow(monitor):
    """Checkerboard-dithered drop shadow, three pixels down and right of the monitor's silhouette."""
    sh = Layer('shadow')
    for (x, y) in monitor.px:
        for dx, dy in ((3, 3), (2, 2)):
            nx, ny = x + dx, y + dy
            if (nx, ny) not in monitor.px and (nx + ny) % 2 == 0 and 0 <= nx < N and 0 <= ny < N:
                sh.px[(nx, ny)] = SHADOW
    return sh


# ── pixel wordmark (5x7) ────────────────────────────────────────────────────
FONT = {
    'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    'I': ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
}


def wordmark(text, px, color, ox, oy):
    out, x = [], ox
    for ch in text:
        g = FONT[ch]
        for r, row in enumerate(g):
            c = 0
            while c < 5:
                if row[c] == '1':
                    c1 = c
                    while c1 + 1 < 5 and row[c1 + 1] == '1':
                        c1 += 1
                    out.append(f'<rect x="{x + c * px}" y="{oy + r * px}" width="{(c1 - c + 1) * px}" height="{px}" fill="{color}"/>')
                    c = c1 + 1
                else:
                    c += 1
        x += 6 * px
    return '\n'.join(out), x - px - ox


# ── build ───────────────────────────────────────────────────────────────────
def main():
    mon = draw_monitor()
    shadow = draw_shadow(mon)
    play = draw_play()
    order = [shadow, mon, play]  # bottom → top

    svg = lambda body, w, h, extra='': f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" shape-rendering="crispEdges"{extra}>\n{body}\n</svg>\n'

    # Icon Composer bundle: one SVG per depth layer on the 1024 canvas.
    icon = os.path.join(HERE, 'Webimation.icon')
    shutil.rmtree(icon, ignore_errors=True)
    os.makedirs(os.path.join(icon, 'Assets'))
    names = {'shadow': '01-shadow.svg', 'monitor': '02-monitor.svg', 'play': '03-play.svg'}
    for L in order:
        with open(os.path.join(icon, 'Assets', names[L.name]), 'w') as f:
            f.write(svg(L.svg_rects(S), 1024, 1024))
    nt = {'enabled': False, 'value': 0}
    spec = {
        'fill': {'automatic-gradient': 'extended-srgb:0.11765,0.40784,0.94118,1.00000'},
        # Pixel art must stay hard-edged: glass tile + depth shadows, but no refraction/translucency on the art.
        'groups': [
            {'name': 'Play', 'layers': [{'image-name': names['play'], 'name': 'Play button'}], 'shadow': {'kind': 'neutral', 'opacity': 0.4}, 'translucency': nt},
            {'name': 'Monitor', 'layers': [{'image-name': names['monitor'], 'name': '90s CRT'}], 'shadow': {'kind': 'neutral', 'opacity': 0.45}, 'translucency': nt},
            {'name': 'Shadow', 'layers': [{'image-name': names['shadow'], 'name': 'Dither shadow'}], 'shadow': {'kind': 'none', 'opacity': 0}, 'translucency': nt}
        ],
        'supported-platforms': {'circles': ['watchOS'], 'squares': 'shared'}
    }
    with open(os.path.join(icon, 'icon.json'), 'w') as f:
        json.dump(spec, f, separators=(',', ':'))

    # Flat mark + tiles.
    mark = lambda scale, ox=0, oy=0: '\n'.join(L.svg_rects(scale, ox, oy) for L in order)
    with open(os.path.join(HERE, 'logo.svg'), 'w') as f:
        f.write(svg(mark(16), 1024, 1024))
    tile = ('<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B87FF"/><stop offset="1" stop-color="#1346C4"/></linearGradient>\n'
            '<pattern id="dz" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#0B2A86"/><rect x="12" y="12" width="12" height="12" fill="#0B2A86"/></pattern>\n'
            '<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>\n'
            '<mask id="m"><rect x="100" y="100" width="824" height="824" fill="url(#fade)"/></mask>\n'
            '<clipPath id="t"><rect x="100" y="100" width="824" height="824" rx="184"/></clipPath></defs>\n'
            '<rect x="100" y="100" width="824" height="824" rx="184" fill="url(#bg)" shape-rendering="geometricPrecision"/>\n'
            '<g clip-path="url(#t)"><rect x="100" y="100" width="824" height="824" fill="url(#dz)" opacity=".5" mask="url(#m)"/></g>\n')
    # 64 grid × 11 px = 704, centred in the 1024 canvas
    with open(os.path.join(HERE, 'app-icon.svg'), 'w') as f:
        f.write(svg(tile + mark(11, 160, 160), 1024, 1024))
    for theme, bg, fg in (('dark', '#0B0B0C', '#F0F1F2'), ('light', '#F7F8FA', '#111316')):
        words, ww = wordmark('WEBIMATION', 10, fg, 0, 0)
        shade, _ = wordmark('WEBIMATION', 10, '#1E68F0', 6, 6)
        w, h = 64 * 4 + 40 + ww + 54, 64 * 4
        body = f'<rect width="{w}" height="{h}" fill="{bg}"/>\n' + mark(4) + f'\n<g transform="translate({64 * 4 + 40},{h // 2 - 38})">\n{shade}\n{words}\n</g>'
        with open(os.path.join(HERE, f'lockup-{theme}.svg'), 'w') as f:
            f.write(svg(body, w, h))
    print('wrote', ', '.join(sorted(os.listdir(HERE))))


if __name__ == '__main__':
    main()
