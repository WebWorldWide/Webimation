#!/usr/bin/env python3
"""Webimation logo: a 90s pixel-art computer, a wireframe globe behind it offset right, and an
orbit ring tying the two together.

Everything is drawn on a 64x64 pixel grid with exact integer rasterisation (no anti-aliased
pixels), then exported as crisp SVG rects. Outputs (next to this file):
  Webimation.icon/          Icon Composer bundle (layered for Liquid Glass depth)
  logo.svg                  mark on transparent background
  lockup-dark.svg / -light  mark + pixel wordmark
  app-icon.svg              flat tile for Windows / Linux / older macOS
Run:  python3 assets/logo/build.py
"""
import json, math, os, shutil

N = 64            # logical pixel grid
S = 1024 // N     # 16 px per logical pixel in the 1024 icon canvas
HERE = os.path.dirname(os.path.abspath(__file__))

# ── palette ─────────────────────────────────────────────────────────────────
OUT = '#0B0B0C'
BEZ_HI, BEZ, BEZ_SH, BEZ_DK = '#F4F0E6', '#DCD6C8', '#ABA597', '#6E6A60'
SCR, SCR_LINE, SCR_RIM = '#0E1A15', '#13251D', '#3F3C36'
PLAY, PLAY_HI, PLAY_SH = '#22D37F', '#8CF5BF', '#14945A'
LED = '#22D37F'
KEY, KEY_ALT = '#E6E1D5', '#C4BEB0'
G_FILL, G_BACK, G_FRONT, G_RIM, G_RIM_HI = '#0B1C47', '#173C8F', '#3D82FF', '#5E98FF', '#A9C8FF'
R_FRONT, R_HI, R_BACK = '#FF8A1F', '#FFB36B', '#A85508'
CASE_SLOT = '#2A2824'


class Layer:
    def __init__(self, name):
        self.name, self.px = name, {}

    def put(self, x, y, c):
        if 0 <= x < N and 0 <= y < N:
            self.px[(x, y)] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)

    def erase(self, pts):
        for p in pts:
            self.px.pop(p, None)

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


def clean(path):
    """Pixel-perfect line: drop L-corner pixels so curves are exactly one pixel thick."""
    out = []
    for p in path:
        if out and out[-1] == p:
            continue
        out.append(p)
    i = 1
    while i < len(out) - 1:
        a, b, c = out[i - 1], out[i], out[i + 1]
        if abs(a[0] - c[0]) == 1 and abs(a[1] - c[1]) == 1 and (a[0] == b[0] or a[1] == b[1]) and (c[0] == b[0] or c[1] == b[1]):
            out.pop(i)
        else:
            i += 1
    return out


def sample(fn, steps=1600):
    """fn(u) -> (x, y, depth) for u in [0,1]; returns pixel path with depth per pixel."""
    path, depth = [], {}
    for i in range(steps + 1):
        x, y, z = fn(i / steps)
        p = (int(math.floor(x + 0.5)), int(math.floor(y + 0.5)))
        path.append(p)
        depth[p] = z
    return clean(path), depth


# ── globe ───────────────────────────────────────────────────────────────────
GX, GY, GR = 43.5, 20.5, 16.0
TILT, VIEW, SPIN = math.radians(-18), math.radians(18), math.radians(12)


def sphere(lat, lon):
    x, y, z = math.cos(lat) * math.sin(lon + SPIN), -math.sin(lat), math.cos(lat) * math.cos(lon + SPIN)
    y, z = y * math.cos(VIEW) - z * math.sin(VIEW), y * math.sin(VIEW) + z * math.cos(VIEW)  # look down a little
    x, y = x * math.cos(TILT) - y * math.sin(TILT), x * math.sin(TILT) + y * math.cos(TILT)  # lean the axis
    return GX + x * GR, GY + y * GR, z


def draw_globe():
    g = Layer('globe')
    inside = lambda x, y: (x + 0.5 - GX - 0.5) ** 2 + (y + 0.5 - GY - 0.5) ** 2 <= (GR - 0.2) ** 2
    for y in range(N):
        for x in range(N):
            if inside(x, y):
                g.put(x, y, G_FILL)
    lines = []
    for lon in range(0, 180, 45):
        lines.append(sample(lambda u, L=math.radians(lon): sphere(-math.pi / 2 + u * 2 * math.pi, L)))
    for lat in (-45, 0, 45):
        lines.append(sample(lambda u, L=math.radians(lat): sphere(L, u * 2 * math.pi)))
    for path, depth in lines:  # back half first, dim
        for p in path:
            if depth[p] < 0 and inside(*p):
                g.put(*p, G_BACK)
    for path, depth in lines:  # front half over it, bright
        for p in path:
            if depth[p] >= 0 and inside(*p):
                g.put(*p, G_FRONT)
    rim, _ = sample(lambda u: (GX + GR * math.cos(u * 2 * math.pi), GY + GR * math.sin(u * 2 * math.pi), 0))
    for p in rim:
        a = math.atan2(p[1] - GY, p[0] - GX)
        g.put(*p, G_RIM_HI if -2.6 < a < -1.0 else G_RIM)  # lit from top-left
    return g


# ── orbit ring ───────────────────────────────────────────────────────────
RX, RY, RCX, RCY, RT = 27.5, 7.0, 37.0, 29.0, math.radians(-16)


def ring_pt(u, inset=0.0):
    a = u * 2 * math.pi
    x, y = (RX - inset) * math.cos(a), (RY - inset * RY / RX) * math.sin(a)
    return RCX + x * math.cos(RT) - y * math.sin(RT), RCY + x * math.sin(RT) + y * math.cos(RT), math.sin(a)


def ring_dist(px, py):
    """Approximate signed pixel distance from the ring ellipse, plus whether the point is on the near side."""
    dx, dy = px - RCX, py - RCY
    x, y = dx * math.cos(-RT) - dy * math.sin(-RT), dx * math.sin(-RT) + dy * math.cos(-RT)
    f = x * x / RX ** 2 + y * y / RY ** 2 - 1
    g = 2 * math.sqrt(x * x / RX ** 4 + y * y / RY ** 4) or 1
    return f / g, y >= 0


def draw_ring():
    """A solid band two pixels thick everywhere (distance field, not sampled strokes)."""
    back, front = Layer('ring-back'), Layer('ring-front')
    for py in range(N):
        for px in range(N):
            d, near = ring_dist(px + 0.5, py + 0.5)
            if -1.0 <= d < 1.0:
                if near:
                    front.put(px, py, R_HI if d < 0 and ring_dist(px + 0.5, py - 0.5)[0] < -1.0 else R_FRONT)
                else:
                    back.put(px, py, R_BACK)
    return back, front


# ── computer ────────────────────────────────────────────────────────────────
def draw_computer():
    """Monitor sitting on a horizontal 90s desktop case, keyboard in front, mouse on the right."""
    c = Layer('computer')
    # monitor body with 1 px outline and bevel
    X0, Y0, X1, Y1 = 9, 12, 35, 35
    c.rect(X0, Y0, X1, Y1, OUT)
    c.rect(X0 + 1, Y0 + 1, X1 - 1, Y1 - 1, BEZ)
    c.rect(X0 + 1, Y0 + 1, X1 - 1, Y0 + 1, BEZ_HI)
    c.rect(X0 + 1, Y0 + 1, X0 + 1, Y1 - 1, BEZ_HI)
    c.rect(X0 + 1, Y1 - 1, X1 - 1, Y1 - 1, BEZ_SH)
    c.rect(X1 - 1, Y0 + 2, X1 - 1, Y1 - 1, BEZ_SH)
    # recessed screen
    SX0, SY0, SX1, SY1 = 13, 15, 31, 29
    c.rect(SX0 - 1, SY0 - 1, SX1 + 1, SY1 + 1, BEZ_SH)
    c.rect(SX0 - 1, SY1 + 1, SX1 + 1, SY1 + 1, BEZ_HI)
    c.rect(SX1 + 1, SY0, SX1 + 1, SY1 + 1, BEZ_HI)
    c.rect(SX0, SY0, SX1, SY1, SCR_RIM)
    c.rect(SX0 + 1, SY0 + 1, SX1 - 1, SY1 - 1, SCR)
    for y in range(SY0 + 2, SY1, 2):
        c.rect(SX0 + 1, y, SX1 - 1, y, SCR_LINE)
    # play triangle
    TX, TY, TH = 19, 17, 10
    for row in range(TH + 1):
        w = (TH // 2 - abs(row - TH // 2)) * 2 + 1
        c.rect(TX, TY + row, TX + w - 1, TY + row, PLAY)
        c.put(TX + w - 1, TY + row, PLAY_SH if row > TH // 2 else PLAY)
    c.rect(TX, TY, TX, TY + TH, PLAY_HI)
    for row in range(TH // 2 + 1):
        c.put(TX + row * 2, TY + row, PLAY_HI)
    # bezel details: vent line + power LED
    c.rect(12, 32, 17, 32, BEZ_SH)
    c.rect(31, 32, 32, 32, LED)
    # desktop case under the monitor (wider than the monitor, like a 90s pizza box)
    CX0, CY0, CX1, CY1 = 5, 36, 39, 44
    c.rect(CX0, CY0, CX1, CY1, OUT)
    c.rect(CX0 + 1, CY0 + 1, CX1 - 1, CY1 - 1, BEZ)
    c.rect(CX0 + 1, CY0 + 1, CX1 - 1, CY0 + 1, BEZ_HI)
    c.rect(CX0 + 1, CY0 + 1, CX0 + 1, CY1 - 1, BEZ_HI)
    c.rect(CX0 + 1, CY1 - 1, CX1 - 1, CY1 - 1, BEZ_SH)
    c.rect(CX1 - 1, CY0 + 2, CX1 - 1, CY1 - 1, BEZ_SH)
    # 3.5" floppy drive: dark slot in a recessed bay, with eject button
    c.rect(8, 39, 21, 41, BEZ_SH)
    c.rect(9, 40, 20, 40, CASE_SLOT)
    c.rect(18, 41, 19, 41, BEZ_DK)
    # second drive bay (blank) + vents
    c.rect(24, 39, 29, 41, BEZ_SH)
    c.rect(25, 40, 28, 40, BEZ)
    # power button + LED
    c.rect(33, 39, 35, 41, BEZ_DK)
    c.rect(34, 40, 34, 40, BEZ_HI)
    c.put(36, 42, LED)
    # keyboard
    c.rect(7, 47, 33, 51, OUT)
    c.rect(8, 48, 32, 50, KEY)
    for y in (48, 49):
        for x in range(8 + (y % 2), 33, 2):
            c.put(x, y, KEY_ALT)
    c.rect(12, 50, 28, 50, KEY_ALT)
    # mouse to the right of the keyboard, cord running back to the case
    MX0, MY0, MX1, MY1 = 37, 47, 41, 53
    c.rect(MX0, MY0 + 1, MX1, MY1 - 1, OUT)
    c.rect(MX0 + 1, MY0, MX1 - 1, MY1, OUT)
    c.rect(MX0 + 1, MY0 + 1, MX1 - 1, MY1 - 1, BEZ)
    c.rect(MX0 + 1, MY0 + 1, MX1 - 1, MY0 + 1, BEZ_HI)
    c.rect(MX0 + 1, MY0 + 3, MX1 - 1, MY0 + 3, BEZ_SH)
    c.put(MX0 + 2, MY0 + 2, BEZ_SH)
    c.rect(MX0 + 1, MY1 - 1, MX1 - 1, MY1 - 1, BEZ_SH)
    for p in ((39, 46), (40, 45), (41, 45)):
        c.put(*p, OUT)
    return c


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
    globe = draw_globe()
    rback, rfront = draw_ring()
    comp = draw_computer()
    # back arc of the ring goes behind the globe's front face only where the globe isn't drawn
    rback.erase([p for p in list(rback.px) if p in globe.px and globe.px[p] in (G_FRONT, G_RIM, G_RIM_HI)])
    order = [globe, rback, comp, rfront]  # bottom → top

    svg = lambda body, w, h, extra='': f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" shape-rendering="crispEdges"{extra}>\n{body}\n</svg>\n'

    # Icon Composer bundle: one SVG per depth layer on the 1024 canvas.
    icon = os.path.join(HERE, 'Webimation.icon')
    shutil.rmtree(icon, ignore_errors=True)
    os.makedirs(os.path.join(icon, 'Assets'))
    names = {'globe': '01-globe.svg', 'ring-back': '02-ring-back.svg', 'computer': '03-computer.svg', 'ring-front': '04-ring-front.svg'}
    for L in order:
        with open(os.path.join(icon, 'Assets', names[L.name]), 'w') as f:
            f.write(svg(L.svg_rects(S), 1024, 1024))
    spec = {
        'fill': {'automatic-gradient': 'extended-srgb:0.05490,0.10588,0.23922,1.00000'},
        # Pixel art must stay hard-edged: glass tile + depth shadows, but no refraction/translucency on the art.
        'groups': [
            {'name': 'Orbit', 'layers': [{'image-name': names['ring-front'], 'name': 'Ring front'}],
             'shadow': {'kind': 'neutral', 'opacity': 0.45}, 'translucency': {'enabled': False, 'value': 0}},
            {'name': 'Computer', 'layers': [{'image-name': names['computer'], 'name': '90s computer'}],
             'shadow': {'kind': 'neutral', 'opacity': 0.45}, 'translucency': {'enabled': False, 'value': 0}},
            {'name': 'Globe', 'layers': [{'image-name': names['ring-back'], 'name': 'Ring back'}, {'image-name': names['globe'], 'name': 'Wireframe globe'}],
             'shadow': {'kind': 'neutral', 'opacity': 0.35}, 'translucency': {'enabled': False, 'value': 0}}
        ],
        'supported-platforms': {'circles': ['watchOS'], 'squares': 'shared'}
    }
    with open(os.path.join(icon, 'icon.json'), 'w') as f:
        json.dump(spec, f, separators=(',', ':'))

    # Flat mark + tiles.
    mark = lambda scale, ox=0, oy=0: '\n'.join(L.svg_rects(scale, ox, oy) for L in order)
    with open(os.path.join(HERE, 'logo.svg'), 'w') as f:
        f.write(svg(mark(16), 1024, 1024))
    tile = ('<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16295C"/><stop offset="1" stop-color="#0A1430"/></linearGradient></defs>\n'
            '<rect x="100" y="100" width="824" height="824" rx="184" fill="url(#bg)" shape-rendering="geometricPrecision"/>\n')
    # 64 grid × 12 px = 768, centred in the 824 tile
    with open(os.path.join(HERE, 'app-icon.svg'), 'w') as f:
        f.write(svg(tile + mark(12, 128, 120), 1024, 1024))
    for theme, bg, fg in (('dark', '#0B0B0C', '#F0F1F2'), ('light', '#F7F8FA', '#111316')):
        words, ww = wordmark('WEBIMATION', 10, fg, 0, 0)
        w, h = 64 * 4 + 40 + ww + 48, 64 * 4
        body = f'<rect width="{w}" height="{h}" fill="{bg}"/>\n' + mark(4) + f'\n<g transform="translate({64 * 4 + 40},{h // 2 - 35})">\n{words}\n</g>'
        with open(os.path.join(HERE, f'lockup-{theme}.svg'), 'w') as f:
            f.write(svg(body, w, h))
    print('wrote', ', '.join(sorted(os.listdir(HERE))))


if __name__ == '__main__':
    main()
