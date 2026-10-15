// Effect families. Each one turns (enter progress k, exit progress x) into styles on a Target.
// k and x are raw linear progress (0..1); effects apply the preset's curves themselves so they
// can stagger slats, tiles and glyphs before easing. Every render is a pure function of (k, x).
//
// House rules (Plotline motion): hard edges, no fades, no springs, no drift. Things wipe, rise
// inside masks, cut on frames, or fill in whole tiles. The resting frame (k = 1, x = 0) is always
// the untouched layout.
import { cl, type Ease } from './easing';
import { band, cells, EMPTY, FULL, isH, morton, poly, slats, within, type Dir, type Rect } from './geom';
import { hash, ranks, rng, shuffle, type Order } from './rand';
import { scaleOf, UCLIP, type Target, type Unit } from './target';
import { INK } from './tokens';

export type Params = Record<string, string | number>;
export interface FxCtx {
  ein: Ease;
  eout: Ease;
  order: Order;
  /** 0..1: how much of the element's window is spent staggering its parts. */
  spread: number;
  seed: number;
  /** Element enter duration and exit duration, in seconds. */
  dur: number;
  xdur: number;
}
export type Render = (k: number, x: number) => void;
export interface ParamDef { key: string; label: string; options: readonly (string | number)[] }
export type Group = 'Wipe' | 'Slats' | 'Tiles' | 'Leader' | 'Mask' | 'Type' | 'Cut';
export const GROUPS: Group[] = ['Wipe', 'Slats', 'Tiles', 'Leader', 'Mask', 'Type', 'Cut'];

export interface EffectDef {
  id: string;
  name: string;
  group: Group;
  blurb: string;
  params: ParamDef[];
  /** Uses the preset's stagger order and spread across its parts. */
  staggered?: boolean;
  spread?: number;
  /** Stagger orders worth minting presets for (first is the default). */
  orders?: Order[];
  /** Mint a stepped-curve preset for each variant. */
  stepped?: boolean;
  /** Works as a standalone exit (doesn't split text). */
  exit?: boolean;
  variant?(p: Params): string;
  make(tg: Target, p: Params, cx: FxCtx): Render;
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Per-part progress: part with rank r (0..1) starts at r·spread and runs for (1 − spread). */
export const sub = (u: number, r: number, s: number) => (s >= 1 ? (u > r ? 1 : 0) : cl((u - r * s) / (1 - s)));

const writer = (el: HTMLElement | SVGElement, prop: 'clipPath' | 'transform' | 'visibility' | 'background' | 'color') => {
  let last: string | null = null;
  return (v: string) => {
    if (v !== last) { last = v; el.style[prop] = v; }
  };
};
const clipper = (el: HTMLElement) => writer(el, 'clipPath');
const done = (k: number, x: number) => k >= 1 && x <= 0;
const DIR_OPT = ['right', 'left', 'down', 'up'] as const;
const ARROW: Record<string, string> = { right: '→', left: '←', down: '↓', up: '↑', tl: '↘', tr: '↙', bl: '↗', br: '↖' };
const colorOf = (tg: Target, c: unknown) => (c === 'accent' ? tg.accent : c === 'ink' ? INK : '#FFFFFF');
/** Pick a contrasting colour for a second plate when the accent is white. */
const second = (tg: Target) => (tg.accent.toUpperCase() === '#FFFFFF' ? INK : '#FFFFFF');
const minus = ([hx0, hy0, hx1, hy1]: Rect): Rect[] => {
  const x0 = cl(hx0 / 100) * 100, y0 = cl(hy0 / 100) * 100, x1 = cl(hx1 / 100) * 100, y1 = cl(hy1 / 100) * 100;
  return [[0, 0, 100, y0], [0, y1, 100, 100], [0, y0, x0, y1], [x1, y0, 100, y1]];
};
const holed = (ring: [number, number][]) =>
  `polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,${[...ring, ring[0]].map(([x, y]) => `${+x.toFixed(3)}% ${+y.toFixed(3)}%`).join(',')},0% 0%)`;

/** Sutherland–Hodgman: keep the part of a convex polygon where nx·x + ny·y ≤ c (or ≥ c). */
const halfPlane = (pts: [number, number][], nx: number, ny: number, c: number, less: boolean) => {
  const inside = (p: [number, number]) => (less ? nx * p[0] + ny * p[1] <= c : nx * p[0] + ny * p[1] >= c);
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c, t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
};

/** Grid of roughly square tiles of `px` stage pixels, capped so polygons stay cheap. */
const tileGrid = (tg: Target, px: number) => {
  const { w, h } = tg.size();
  let t = px;
  while (Math.ceil(w / t) * Math.ceil(h / t) > 420) t *= 1.25;
  const cols = Math.max(1, Math.round(w / t)), rows = Math.max(1, Math.round(h / t));
  return { cols, rows, cs: cells(cols, rows) };
};
/** Normalise arbitrary keys to 0..1 ranks, keeping ties equal. */
const byValue = (vals: number[]) => {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return vals.map(v => (hi > lo ? (v - lo) / (hi - lo) : 0));
};
/** Normalise keys by sorted position (uniform pacing, ties broken by index). */
const bySort = (vals: number[]) => {
  const idx = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]), out = new Array<number>(vals.length), m = Math.max(1, vals.length - 1);
  idx.forEach((i, k) => (out[i] = k / m));
  return out;
};

type TileMode = 'cut' | 'grow' | 'wipe';
/** Shared tile renderer: per-tile ranks decide when each tile lands. */
const tiles = (
  tg: Target, cx: FxCtx, px: number, rank: (g: ReturnType<typeof tileGrid>) => number[], mode: TileMode,
  opt: { dir?: Dir; flash?: string } = {}
): Render => {
  const set = clipper(tg.wrap);
  let g: ReturnType<typeof tileGrid> | null = null, rs: number[] = [];
  let flash: ((v: string) => void) | null = null;
  if (opt.flash) {
    const o = tg.overlay();
    o.style.background = opt.flash;
    flash = clipper(o);
  }
  return (k, x) => {
    if (done(k, x)) { set(FULL); flash?.(EMPTY); return; }
    if (!g) { g = tileGrid(tg, px); rs = rank(g); }
    const ek = cx.ein(k), ex = cx.eout(x), s = cx.spread, vis: Rect[] = [], hot: Rect[] = [];
    for (let i = 0; i < g.cs.length; i++) {
      const r = g.cs[i].r, u = sub(mode === 'cut' ? ek : k, rs[i], s), v = sub(mode === 'cut' ? ex : x, rs[i], s);
      if (mode === 'cut') {
        if (u > 0 && v < (flash ? 0.5 : 1e-9)) vis.push(r);
        if (flash && ((u > 0 && u < 0.5 && x <= 0) || (v > 0 && v < 0.5))) hot.push(r);
      } else if (mode === 'grow') {
        const a = cx.ein(u) * (1 - cx.eout(v));
        if (a > 0) {
          const hw = ((r[2] - r[0]) / 2) * a, hh = ((r[3] - r[1]) / 2) * a, mx = (r[0] + r[2]) / 2, my = (r[1] + r[3]) / 2;
          vis.push([mx - hw, my - hh, mx + hw, my + hh]);
        }
      } else vis.push(within(r, band(opt.dir || 'right', cx.ein(u), cx.eout(v))));
    }
    set(tg.poly(vis));
    flash?.(tg.poly(hot));
  };
};

const translate = (el: HTMLElement) => writer(el, 'transform');
const OFF: Record<string, [number, number]> = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] };
const axisOf = (dir: string) => (dir === 'left' || dir === 'right' ? 'x' : 'y');
/** Inner box offset for content entering from `dir`: travels `dist` px so its ink fully clears the clip. */
const slidePx = (dir: string, a: number, b: number, dist: number) => {
  const [ox, oy] = OFF[dir] || OFF.up, m = (1 - a) - b;
  return `translate(${(ox * m * dist).toFixed(3)}px,${(oy * m * dist).toFixed(3)}px)`;
};
/** Partial offset in percent of the box (for push, where content trails the wipe). */
const slidePct = (dir: string, a: number, b: number, pct: number) => {
  const [ox, oy] = OFF[dir] || OFF.up, m = (1 - a) - b;
  return `translate(${(ox * m * pct).toFixed(3)}%,${(oy * m * pct).toFixed(3)}%)`;
};
/** Unit offset: its own size plus the clip bleed (.35em vertical, .16em horizontal) on both sides. */
const slideUnit = (dir: string, a: number, b: number) => {
  const [ox, oy] = OFF[dir] || OFF.up, m = (1 - a) - b;
  const c = (o: number, pad: number) => (o ? `calc(${(o * m * 100).toFixed(3)}% + ${(o * m * pad).toFixed(4)}em)` : '0px');
  return `translate(${c(ox, 0.34)},${c(oy, 0.72)})`;
};
/** A unit's wipe: hard edge across the glyph box, keeping the bleed on the other three sides. */
const unitBand = (d: Dir, a: number, b: number) => {
  const A = (a * 100).toFixed(3), B = (b * 100).toFixed(3), off = (v: string) => `calc(${(100 - +v).toFixed(3)}%)`;
  switch (d) {
    case 'right': return `inset(-.35em ${off(A)} -.35em ${+B ? B + '%' : '-.16em'})`;
    case 'left': return `inset(-.35em ${+B ? B + '%' : '-.16em'} -.35em ${off(A)})`;
    case 'down': return `inset(${+B ? B + '%' : '-.35em'} -.16em ${off(A)} -.16em)`;
    default: return `inset(${off(A)} -.16em ${+B ? B + '%' : '-.35em'} -.16em)`;
  }
};

// ── text plumbing ──────────────────────────────────────────────────────────

interface TextBase {
  units: Unit[];
  r: number[];
  /** Map element progress to unit-phase progress; handles boxed plates. */
  frame(k: number, x: number): [number, number];
}
const textBase = (tg: Target, kind: 'char' | 'word' | 'line', cx: FxCtx): TextBase | null => {
  const units = tg.units(kind);
  if (!units.length) return null;
  let r: number[];
  if (kind === 'line') {
    const lr = ranks(units[units.length - 1].line + 1, cx.order, cx.seed);
    r = units.map(u => lr[u.line]);
  } else r = ranks(units.length, cx.order, cx.seed);
  if (!(tg.boxed || tg.decor)) return { units, r, frame: (k, x) => [k, x] };
  const set = clipper(tg.wrap);
  return {
    units, r,
    frame(k, x) {
      const a = cx.ein(cl(k / 0.4)), b = cx.eout(cl((x - 0.55) / 0.45));
      set(a >= 1 && b <= 0 ? FULL : tg.poly([band('right', a, b)]));
      return [cl((k - 0.22) / 0.78), cl(x / 0.6)];
    }
  };
};
/** Build a text effect from a per-unit renderer, falling back to a plain wipe when there's no text. */
const perUnit = (
  tg: Target, kind: 'char' | 'word' | 'line', cx: FxCtx,
  setup: (u: Unit, i: number) => (u: number, v: number, ku: number, xu: number) => void
): Render => {
  const tb = textBase(tg, kind, cx);
  if (!tb) return FX.wipe.make(tg, { dir: 'right' }, cx);
  const fns = tb.units.map(setup), s = cx.spread;
  return (k, x) => {
    const [ku, xu] = tb.frame(k, x);
    for (let i = 0; i < fns.length; i++) fns[i](sub(ku, tb.r[i], s), sub(xu, tb.r[i], s), ku, xu);
  };
};
/** Fix each unit's width to its final glyph so swapping glyphs never reflows the line. */
/** Hold each unit at its final glyph's exact width while other glyphs flick through it; once the
 *  final glyph is back the width is released, so the rest frame is the untouched layout. */
const pinned = (units: Unit[]) => {
  const ws = units.map(u => (u.el.getBoundingClientRect().width / (scaleOf(u.el) || 1)).toFixed(4) + 'px');
  const last = units.map(u => u.text);
  return (i: number, c: string) => {
    if (last[i] === c) return;
    last[i] = c;
    const u = units[i];
    u.el.textContent = c;
    u.el.style.width = c === u.text ? '' : ws[i];
  };
};
const GLYPHS: Record<string, string> = {
  glyph: '!<>-_\\/[]{}=+*^?#%&$',
  binary: '01',
  blocks: '█▓▒░▚▞▙▟',
  caps: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
};
const FLAP = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// ── families ───────────────────────────────────────────────────────────────

const defs: EffectDef[] = [
  // Wipe ─────────────────────────────────────────
  {
    id: 'wipe', name: 'Wipe', group: 'Wipe', exit: true, stepped: true,
    blurb: 'Hard-edged wipe; the exit carries on in the same direction.',
    params: [{ key: 'dir', label: 'Direction', options: DIR_OPT }],
    variant: p => ARROW[p.dir],
    make(tg, p, cx) {
      const set = clipper(tg.wrap), d = p.dir as Dir;
      return (k, x) => set(done(k, x) ? FULL : tg.poly([band(d, cx.ein(k), cx.eout(x))]));
    }
  },
  {
    id: 'split', name: 'Split', group: 'Wipe', exit: true, stepped: true,
    blurb: 'Opens from a centre seam; leaves by tearing apart at the same seam.',
    params: [{ key: 'axis', label: 'Opens', options: ['h', 'v'] }],
    variant: p => (p.axis === 'h' ? '↔' : '↕'),
    make(tg, p, cx) {
      const set = clipper(tg.wrap), h = p.axis === 'h';
      return (k, x) => {
        if (done(k, x)) return set(FULL);
        const a = cx.ein(k), g = 50 * cx.eout(x), lo = 50 - 50 * a, hi = 50 + 50 * a;
        set(tg.poly(h ? [[lo, 0, 50 - g, 100], [50 + g, 0, hi, 100]] : [[0, lo, 100, 50 - g], [0, 50 + g, 100, hi]]));
      };
    }
  },
  {
    id: 'converge', name: 'Converge', group: 'Wipe', exit: true, stepped: true,
    blurb: 'Two edges close in and meet in the middle; leaves by retreating to the edges.',
    params: [{ key: 'axis', label: 'Axis', options: ['h', 'v'] }],
    variant: p => (p.axis === 'h' ? '→←' : '↓↑'),
    make(tg, p, cx) {
      const set = clipper(tg.wrap), h = p.axis === 'h';
      return (k, x) => {
        if (done(k, x)) return set(FULL);
        const a = 50 * cx.ein(k), b = 50 * cx.eout(x);
        set(tg.poly(h ? [[b, 0, a, 100], [100 - a, 0, 100 - b, 100]] : [[0, b, 100, a], [0, 100 - a, 100, 100 - b]]));
      };
    }
  },
  {
    id: 'iris', name: 'Iris', group: 'Wipe', exit: true, stepped: true,
    blurb: 'A true square grows from a point; the exit punches a square hole from the same point.',
    params: [{ key: 'from', label: 'From', options: ['c', 'tl', 'tr', 'bl', 'br'] }],
    variant: p => (p.from === 'c' ? 'centre' : ARROW[p.from]),
    make(tg, p, cx) {
      const set = clipper(tg.wrap), o = String(p.from);
      const sq = (a: number): Rect => {
        const { w, h } = tg.size(), m = Math.max(w, h);
        if (o === 'c') { const hx = ((a * m) / 2 / w) * 100, hy = ((a * m) / 2 / h) * 100; return [50 - hx, 50 - hy, 50 + hx, 50 + hy]; }
        const ex = ((a * m) / w) * 100, ey = ((a * m) / h) * 100;
        const x0 = o[1] === 'l' ? 0 : 100 - ex, y0 = o[0] === 't' ? 0 : 100 - ey;
        return [x0, y0, x0 + ex, y0 + ey];
      };
      return (k, x) => set(done(k, x) ? FULL : x > 0 ? tg.poly(minus(sq(cx.eout(x)))) : tg.poly([sq(cx.ein(k))]));
    }
  },
  {
    id: 'diamond', name: 'Diamond', group: 'Wipe', exit: true, stepped: true,
    blurb: 'A 45° diamond opens from the centre; exits through a diamond hole.',
    params: [],
    make(tg, _p, cx) {
      const set = clipper(tg.wrap);
      const ring = (a: number): [number, number][] => {
        const { w, h } = tg.size(), R = a * (w / 2 + h / 2), rx = (R / w) * 100, ry = (R / h) * 100;
        return [[50, 50 - ry], [50 + rx, 50], [50, 50 + ry], [50 - rx, 50]];
      };
      return (k, x) => set(done(k, x) ? FULL : x > 0 ? holed(ring(cx.eout(x))) : tg.points(ring(cx.ein(k))));
    }
  },
  {
    id: 'cross', name: 'Cross', group: 'Wipe', exit: true,
    blurb: 'A hairline plus shoots to the edges, then thickens until it fills the box.',
    params: [],
    make(tg, _p, cx) {
      const set = clipper(tg.wrap);
      const at = (L: number, G: number): Rect[] => {
        const { w, h } = tg.size(), th = ((3 + G * (h / 2)) / h) * 100, tv = ((3 + G * (w / 2)) / w) * 100;
        return [[50 - 50 * L, 50 - th, 50 + 50 * L, 50 + th], [50 - tv, 50 - 50 * L, 50 + tv, 50 + 50 * L]];
      };
      return (k, x) => {
        if (done(k, x)) return set(FULL);
        if (x > 0) return set(tg.poly(at(1 - cx.eout(cl((x - 0.45) / 0.55)), 1 - cx.eout(cl(x / 0.7)))));
        set(tg.poly(at(cx.ein(cl(k / 0.55)), cx.ein(cl((k - 0.3) / 0.7)))));
      };
    }
  },
  {
    id: 'diagonal', name: 'Diagonal', group: 'Wipe', exit: true, stepped: true,
    blurb: 'A true 45° edge sweeps from a corner, measured in stage pixels.',
    params: [{ key: 'from', label: 'From', options: ['tl', 'tr', 'bl', 'br'] }],
    variant: p => ARROW[p.from],
    make(tg, p, cx) {
      const set = clipper(tg.wrap), o = String(p.from), nx = o[1] === 'l' ? 1 : -1, ny = o[0] === 't' ? 1 : -1;
      return (k, x) => {
        if (done(k, x)) return set(FULL);
        const { w, h } = tg.size(), box: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];
        const vs = box.map(([a, b]) => nx * a + ny * b), lo = Math.min(...vs), hi = Math.max(...vs);
        let pts = halfPlane(box, nx, ny, lo + cx.ein(k) * (hi - lo), true);
        if (x > 0) pts = halfPlane(pts, nx, ny, lo + cx.eout(x) * (hi - lo), false);
        set(tg.points(pts.map(([a, b]) => [(a / w) * 100, (b / h) * 100] as [number, number])));
      };
    }
  },
  {
    id: 'clock', name: 'Clock', group: 'Wipe', exit: true, stepped: true,
    blurb: 'A straight hand sweeps a full turn around the centre, square-edged at the box.',
    params: [{ key: 'start', label: 'Start', options: ['top', 'left'] }, { key: 'turn', label: 'Turn', options: ['cw', 'ccw'] }],
    variant: p => `${p.start === 'top' ? '12' : '9'} o'clock ${p.turn === 'cw' ? '↻' : '↺'}`,
    make(tg, p, cx) {
      const set = clipper(tg.wrap), t0 = p.start === 'top' ? -Math.PI / 2 : Math.PI, sg = p.turn === 'cw' ? 1 : -1;
      const sector = (a0: number, a1: number) => {
        const { w, h } = tg.size(), R = w + h, n = Math.max(2, Math.ceil((a1 - a0) * 48)), pts: [number, number][] = [[50, 50]];
        for (let i = 0; i <= n; i++) {
          const th = t0 + sg * (a0 + ((a1 - a0) * i) / n) * Math.PI * 2;
          pts.push([50 + ((Math.cos(th) * R) / w) * 100, 50 + ((Math.sin(th) * R) / h) * 100]);
        }
        return tg.points(pts);
      };
      return (k, x) => set(done(k, x) ? FULL : x > 0 ? sector(cx.eout(x), 1) : k <= 0 ? EMPTY : sector(0, cx.ein(k)));
    }
  },

  // Slats ────────────────────────────────────────
  {
    id: 'blinds', name: 'Blinds', group: 'Slats', exit: true, staggered: true, spread: 0.55, stepped: true, orders: ['seq', 'center', 'random'],
    blurb: 'Venetian slats each grow from their leading edge.',
    params: [{ key: 'axis', label: 'Slats', options: ['h', 'v'] }, { key: 'n', label: 'Count', options: [6, 4, 10] }],
    variant: p => `${p.axis === 'h' ? '≡' : '⦀'} ${p.n}`,
    make(tg, p, cx) {
      const set = clipper(tg.wrap), sl = slats(+p.n, p.axis as 'h' | 'v'), d: Dir = p.axis === 'h' ? 'down' : 'right', r = ranks(sl.length, cx.order, cx.seed);
      return (k, x) => set(done(k, x) ? FULL : tg.poly(sl.map((c, i) => within(c, band(d, cx.ein(sub(k, r[i], cx.spread)), cx.eout(sub(x, r[i], cx.spread)))))));
    }
  },
  {
    id: 'shutter', name: 'Shutter', group: 'Slats', exit: true, staggered: true, spread: 0.5, stepped: true, orders: ['seq', 'center', 'random'],
    blurb: 'Slats open from their own centre lines, like a camera shutter.',
    params: [{ key: 'axis', label: 'Slats', options: ['h', 'v'] }, { key: 'n', label: 'Count', options: [5, 3, 9] }],
    variant: p => `${p.axis === 'h' ? '≡' : '⦀'} ${p.n}`,
    make(tg, p, cx) {
      const set = clipper(tg.wrap), h = p.axis === 'h', sl = slats(+p.n, h ? 'h' : 'v'), r = ranks(sl.length, cx.order, cx.seed);
      return (k, x) => {
        if (done(k, x)) return set(FULL);
        const out: Rect[] = [];
        sl.forEach((c, i) => {
          const a = 50 * cx.ein(sub(k, r[i], cx.spread)), b = 50 * cx.eout(sub(x, r[i], cx.spread));
          const pair: Rect[] = h ? [[0, 50 - a, 100, 50 - b], [0, 50 + b, 100, 50 + a]] : [[50 - a, 0, 50 - b, 100], [50 + b, 0, 50 + a, 100]];
          for (const q of pair) out.push(within(c, q));
        });
        set(tg.poly(out));
      };
    }
  },
  {
    id: 'zipper', name: 'Zipper', group: 'Slats', exit: true, staggered: true, spread: 0.35, stepped: true, orders: ['seq', 'center'],
    blurb: 'Alternate slats wipe in from opposite sides and interlock.',
    params: [{ key: 'axis', label: 'Slats', options: ['h', 'v'] }, { key: 'n', label: 'Count', options: [4, 2, 8] }],
    variant: p => `${p.axis === 'h' ? '⇄' : '⇅'} ${p.n}`,
    make(tg, p, cx) {
      const set = clipper(tg.wrap), h = p.axis === 'h', sl = slats(+p.n, h ? 'h' : 'v'), r = ranks(sl.length, cx.order, cx.seed);
      return (k, x) => set(done(k, x) ? FULL : tg.poly(sl.map((c, i) => {
        const d: Dir = h ? (i % 2 ? 'left' : 'right') : i % 2 ? 'up' : 'down';
        return within(c, band(d, cx.ein(sub(k, r[i], cx.spread)), cx.eout(sub(x, r[i], cx.spread))));
      })));
    }
  },
  {
    id: 'stairs', name: 'Stairs', group: 'Slats', exit: true, staggered: true, spread: 0.6, stepped: true, orders: ['seq', 'rev', 'center', 'random'],
    blurb: 'Parallel strips wipe the same way on a stagger, leaving a staircase front.',
    params: [{ key: 'dir', label: 'Direction', options: DIR_OPT }, { key: 'n', label: 'Strips', options: [8, 4, 16] }],
    variant: p => `${ARROW[p.dir]} ${p.n}`,
    make(tg, p, cx) {
      const set = clipper(tg.wrap), d = p.dir as Dir, sl = slats(+p.n, isH(d) ? 'h' : 'v'), r = ranks(sl.length, cx.order, cx.seed);
      return (k, x) => set(done(k, x) ? FULL : tg.poly(sl.map((c, i) => within(c, band(d, cx.ein(sub(k, r[i], cx.spread)), cx.eout(sub(x, r[i], cx.spread)))))));
    }
  },
  {
    id: 'barcode', name: 'Barcode', group: 'Slats', exit: true, staggered: true, spread: 0.9, orders: ['random', 'seq', 'center'],
    blurb: 'Uneven vertical bars cut on one by one until the box is solid.',
    params: [{ key: 'n', label: 'Bars', options: [24, 12, 48] }],
    variant: p => `${p.n}`,
    make(tg, p, cx) {
      const set = clipper(tg.wrap), n = +p.n, R = rng(cx.seed ^ 0xbac0de), ws = Array.from({ length: n }, () => 0.25 + R() * 1.5);
      const tot = ws.reduce((a, b) => a + b, 0), bars: Rect[] = [];
      let acc = 0;
      for (const w of ws) { bars.push([(acc / tot) * 100, 0, ((acc + w) / tot) * 100, 100]); acc += w; }
      const r = ranks(n, cx.order, cx.seed);
      return (k, x) => {
        if (done(k, x)) return set(FULL);
        const ek = cx.ein(k), ex = cx.eout(x);
        set(tg.poly(bars.filter((_, i) => sub(ek, r[i], cx.spread) > 0 && sub(ex, r[i], cx.spread) <= 0)));
      };
    }
  },

  // Tiles ────────────────────────────────────────
  {
    id: 'dissolve', name: 'Dissolve', group: 'Tiles', exit: true, spread: 0.85,
    blurb: 'Square tiles cut on in shuffled order. A hard-edged dissolve with no opacity.',
    params: [{ key: 'tile', label: 'Tile px', options: [24, 12, 48] }],
    variant: p => `${p.tile} px`,
    make(tg, p, cx) {
      return tiles(tg, cx, +p.tile, g => bySort(shuffle(g.cs.map((_, i) => i), cx.seed)), 'cut');
    }
  },
  {
    id: 'raster', name: 'Raster', group: 'Tiles', exit: true, spread: 0.85,
    blurb: 'Draws like a GPU: Morton-ordered tiles in 8-tile bins, each landing with a white scan flash.',
    params: [{ key: 'tile', label: 'Tile px', options: [12, 8, 24] }],
    variant: p => `${p.tile} px`,
    make(tg, p, cx) {
      return tiles(tg, cx, +p.tile, g => bySort(g.cs.map(c => (c.col >> 3) * 1e4 + (c.row >> 3) * 64 + morton(c.col & 7, c.row & 7))), 'cut', { flash: 'rgba(255,255,255,.92)' });
    }
  },
  {
    id: 'sweep', name: 'Tile sweep', group: 'Tiles', exit: true, spread: 0.7, stepped: true,
    blurb: 'Tiles grow from their centres in a diagonal wave from one corner.',
    params: [{ key: 'from', label: 'From', options: ['tl', 'tr', 'bl', 'br'] }, { key: 'tile', label: 'Tile px', options: [32, 16] }],
    variant: p => `${ARROW[p.from]} ${p.tile} px`,
    make(tg, p, cx) {
      const o = String(p.from);
      return tiles(tg, cx, +p.tile, g => byValue(g.cs.map(c => (o[1] === 'l' ? c.col : g.cols - 1 - c.col) + (o[0] === 't' ? c.row : g.rows - 1 - c.row))), 'grow');
    }
  },
  {
    id: 'bloom', name: 'Bloom', group: 'Tiles', exit: true, spread: 0.7, stepped: true,
    blurb: 'Tiles grow from their centres in rings spreading out from the middle.',
    params: [{ key: 'tile', label: 'Tile px', options: [32, 20, 56] }],
    variant: p => `${p.tile} px`,
    make(tg, p, cx) {
      return tiles(tg, cx, +p.tile, g => byValue(g.cs.map(c => Math.hypot(c.col - (g.cols - 1) / 2, (c.row - (g.rows - 1) / 2) * (g.cols / g.rows > 2 ? 2 : 1)))), 'grow');
    }
  },
  {
    id: 'spiral', name: 'Spiral', group: 'Tiles', exit: true, spread: 0.9,
    blurb: 'Tiles cut on ring by ring, walking around the box.',
    params: [{ key: 'way', label: 'Way', options: ['in', 'out'] }, { key: 'tile', label: 'Tile px', options: [32, 20] }],
    variant: p => `${p.way === 'in' ? 'inward' : 'outward'} ${p.tile} px`,
    make(tg, p, cx) {
      return tiles(tg, cx, +p.tile, g => {
        const v = g.cs.map(c => {
          const ring = Math.min(c.col, c.row, g.cols - 1 - c.col, g.rows - 1 - c.row);
          const ang = (Math.atan2(c.row - (g.rows - 1) / 2, c.col - (g.cols - 1) / 2) + Math.PI) / (2 * Math.PI);
          return ring + ang * 0.99;
        });
        return bySort(p.way === 'in' ? v : v.map(x => -x));
      }, 'cut');
    }
  },
  {
    id: 'checker', name: 'Checker', group: 'Tiles', exit: true, spread: 0.6, stepped: true,
    blurb: 'Black squares, then white squares: a checkerboard that wipes in two passes.',
    params: [{ key: 'cell', label: 'Cell px', options: [48, 24, 96] }, { key: 'dir', label: 'Wipe', options: ['right', 'down'] }],
    variant: p => `${p.cell} px ${ARROW[p.dir]}`,
    make(tg, p, cx) {
      return tiles(tg, cx, +p.cell, g => g.cs.map(c => ((c.col + c.row) % 2) * 0.5 + (c.col / Math.max(1, g.cols - 1)) * 0.5), 'wipe', { dir: p.dir as Dir });
    }
  },
  {
    id: 'rain', name: 'Rain', group: 'Tiles', exit: true, spread: 0.85,
    blurb: 'Columns fill top to bottom, tile by tile, each column on its own delay.',
    params: [{ key: 'tile', label: 'Tile px', options: [16, 32] }],
    variant: p => `${p.tile} px`,
    make(tg, p, cx) {
      return tiles(tg, cx, +p.tile, g => {
        const R = rng(cx.seed ^ 0x5eed), delay = Array.from({ length: g.cols }, () => R() * 0.55);
        return g.cs.map(c => delay[c.col] + (c.row / Math.max(1, g.rows)) * 0.45);
      }, 'cut');
    }
  },

  // Leader ───────────────────────────────────────
  {
    id: 'leader', name: 'Leader', group: 'Leader', exit: true, stepped: true,
    blurb: 'A solid plate wipes across, then retracts to uncover the content behind it.',
    params: [{ key: 'dir', label: 'Direction', options: DIR_OPT }, { key: 'color', label: 'Plate', options: ['accent', 'white', 'ink'] }],
    variant: p => `${ARROW[p.dir]} ${p.color}`,
    make(tg, p, cx) {
      const d = p.dir as Dir, o = tg.overlay(), setW = clipper(tg.wrap), setO = clipper(o);
      o.style.background = colorOf(tg, p.color);
      return (k, x) => {
        if (done(k, x)) { setW(FULL); setO(EMPTY); return; }
        if (x > 0) {
          const l = cx.eout(cl(x / 0.6)), t = cx.eout(cl((x - 0.4) / 0.6));
          setW(tg.poly([band(d, 1, t)])); setO(tg.poly([band(d, l, t)]));
        } else {
          const l = cx.ein(cl(k / 0.62)), t = cx.ein(cl((k - 0.38) / 0.62));
          setW(tg.poly([band(d, l, 0)])); setO(tg.poly([band(d, l, t)]));
        }
      };
    }
  },
  {
    id: 'double', name: 'Double plate', group: 'Leader', exit: true, stepped: true,
    blurb: 'Accent plate, then a white plate chasing it, then the content.',
    params: [{ key: 'dir', label: 'Direction', options: DIR_OPT }],
    variant: p => ARROW[p.dir],
    make(tg, p, cx) {
      const d = p.dir as Dir, A = tg.overlay(), B = tg.overlay(), setW = clipper(tg.wrap), setA = clipper(A), setB = clipper(B);
      A.style.background = tg.accent; B.style.background = second(tg);
      return (k, x) => {
        if (done(k, x)) { setW(FULL); setA(EMPTY); setB(EMPTY); return; }
        const e = x > 0 ? cx.eout : cx.ein, u = x > 0 ? x : k;
        const lA = e(cl(u / 0.5)), lB = e(cl((u - 0.18) / 0.5)), t = e(cl((u - 0.42) / 0.58));
        if (x > 0) { setW(tg.poly([band(d, 1, t)])); setA(tg.poly([band(d, lA, t)])); setB(tg.poly([band(d, lB, t)])); }
        else { setW(tg.poly([band(d, lA, 0)])); setA(tg.poly([band(d, lA, t)])); setB(tg.poly([band(d, lB, t)])); }
      };
    }
  },
  {
    id: 'scan', name: 'Scan bar', group: 'Leader', exit: true, stepped: true,
    blurb: 'A 6 px bar travels the box and the content appears in its wake.',
    params: [{ key: 'dir', label: 'Direction', options: DIR_OPT }, { key: 'color', label: 'Bar', options: ['accent', 'white'] }],
    variant: p => `${ARROW[p.dir]} ${p.color}`,
    make(tg, p, cx) {
      const d = p.dir as Dir, o = tg.overlay(), setW = clipper(tg.wrap), setO = clipper(o);
      o.style.background = colorOf(tg, p.color);
      return (k, x) => {
        if (done(k, x)) { setW(FULL); setO(EMPTY); return; }
        const { w, h } = tg.size(), th = 6 / (isH(d) ? w : h);
        if (x > 0) {
          if (x >= 1) { setW(EMPTY); setO(EMPTY); return; }
          const b = cx.eout(x);
          setW(tg.poly([band(d, 1, Math.max(0, b - th))])); setO(tg.poly([band(d, b, Math.max(0, b - th))]));
        } else {
          const a = cx.ein(k);
          setW(k <= 0 ? EMPTY : tg.poly([band(d, Math.min(1, a + th), 0)])); setO(tg.poly([band(d, Math.min(1, a + th), a)]));
        }
      };
    }
  },
  {
    id: 'flash', name: 'Flash cut', group: 'Leader', exit: true,
    blurb: 'Cuts on as a solid plate for a couple of frames, then cuts to the content.',
    params: [{ key: 'color', label: 'Plate', options: ['white', 'accent', 'ink'] }, { key: 'frames', label: 'Frames', options: [2, 4] }],
    variant: p => `${p.color} · ${p.frames}f`,
    make(tg, p, cx) {
      const o = tg.overlay(), setW = clipper(tg.wrap), setO = clipper(o), fr = +p.frames / 30;
      o.style.background = colorOf(tg, p.color);
      return (k, x) => {
        if (x > 0) {
          const tx = x * cx.xdur - cx.xdur * 0.5;
          setW(tx < fr ? FULL : EMPTY); setO(tx >= 0 && tx < fr ? FULL : EMPTY);
          return;
        }
        setW(k > 0 ? FULL : EMPTY); setO(k > 0 && k * cx.dur < fr ? FULL : EMPTY);
      };
    }
  },

  // Mask ─────────────────────────────────────────
  {
    id: 'mask', name: 'Mask', group: 'Mask', exit: true, stepped: true,
    blurb: 'The content travels into place inside its own mask and leaves the same way.',
    params: [{ key: 'dir', label: 'Enters', options: ['up', 'down', 'right', 'left'] }],
    variant: p => ARROW[p.dir],
    make(tg, p, cx) {
      const set = translate(tg.inner), d = String(p.dir);
      return (k, x) => set(done(k, x) ? 'none' : slidePx(d, cx.ein(k), cx.eout(x), tg.reach(axisOf(d))));
    }
  },
  {
    id: 'push', name: 'Push', group: 'Mask', exit: true, stepped: true,
    blurb: 'A wipe with the content sliding a little behind it, like a page being pushed in.',
    params: [{ key: 'dir', label: 'Direction', options: DIR_OPT }],
    variant: p => ARROW[p.dir],
    make(tg, p, cx) {
      const d = p.dir as Dir, setW = clipper(tg.wrap), setT = translate(tg.inner);
      return (k, x) => {
        if (done(k, x)) { setW(FULL); setT('none'); return; }
        const a = cx.ein(k), b = cx.eout(x);
        setW(tg.poly([band(d, a, b)]));
        setT(slidePct(d, a, b, 28));
      };
    }
  },
  {
    id: 'jolt', name: 'Jolt', group: 'Mask', exit: true,
    blurb: 'Cuts on off-register and snaps home in three hard frames.',
    params: [{ key: 'axis', label: 'Axis', options: ['h', 'v'] }],
    variant: p => (p.axis === 'h' ? '↔' : '↕'),
    make(tg, p) {
      const setW = clipper(tg.wrap), setT = translate(tg.inner), h = p.axis === 'h', IN = [28, -14, 6, 0], OUT = [0, 6, -14, 28];
      const at = (v: number) => (h ? `translate(${v}px,0` : `translate(0,${v}px`);
      return (k, x) => {
        if (done(k, x)) { setW(FULL); setT('none'); return; }
        if (x > 0) { setW(x < 0.8 ? FULL : EMPTY); setT(at(OUT[Math.min(3, Math.floor(x * 4))])); return; }
        setW(k > 0 ? FULL : EMPTY); setT(at(IN[Math.min(3, Math.floor(cl(k * 1.6) * 4))]));
      };
    }
  },
  {
    id: 'zoom', name: 'Punch', group: 'Mask', exit: true, stepped: true,
    blurb: 'Cuts on scaled, then settles to 1:1 inside its mask. No overshoot.',
    params: [{ key: 'from', label: 'From', options: ['in', 'out'] }],
    variant: p => (p.from === 'in' ? 'in · 130%' : 'out · 70%'),
    make(tg, p, cx) {
      const setW = clipper(tg.wrap), setT = translate(tg.inner), s0 = p.from === 'in' ? 1.3 : 0.7;
      tg.inner.style.transformOrigin = '50% 50%';
      return (k, x) => {
        if (done(k, x)) { setW(FULL); setT('none'); return; }
        if (x > 0) { setW(x < 0.85 ? FULL : EMPTY); setT(`scale(${(1 + (s0 - 1) * cx.eout(x)).toFixed(4)})`); return; }
        setW(k > 0 ? FULL : EMPTY); setT(`scale(${(s0 + (1 - s0) * cx.ein(k)).toFixed(4)})`);
      };
    }
  },

  // Type ─────────────────────────────────────────
  {
    id: 'chars', name: 'Chars rise', group: 'Type', staggered: true, spread: 0.55, orders: ['seq', 'center', 'random', 'rev'],
    blurb: 'Every glyph rises in its own mask.',
    params: [{ key: 'dir', label: 'Enters', options: ['up', 'down'] }],
    variant: p => ARROW[p.dir],
    make(tg, p, cx) {
      const d = String(p.dir);
      return perUnit(tg, 'char', cx, u => { const set = translate(u.el); return (a, b) => set(a >= 1 && b <= 0 ? 'none' : slideUnit(d, cx.ein(a), cx.eout(b))); });
    }
  },
  {
    id: 'words', name: 'Words rise', group: 'Type', staggered: true, spread: 0.5, orders: ['seq', 'random', 'rev'],
    blurb: 'Word by word, each in its own mask.',
    params: [{ key: 'dir', label: 'Enters', options: ['up', 'down', 'right'] }],
    variant: p => ARROW[p.dir],
    make(tg, p, cx) {
      const d = String(p.dir);
      return perUnit(tg, 'word', cx, u => { const set = translate(u.el); return (a, b) => set(a >= 1 && b <= 0 ? 'none' : slideUnit(d, cx.ein(a), cx.eout(b))); });
    }
  },
  {
    id: 'lines', name: 'Lines rise', group: 'Type', staggered: true, spread: 0.4, orders: ['seq', 'rev'],
    blurb: 'Each wrapped line rises as one, in reading order.',
    params: [{ key: 'dir', label: 'Enters', options: ['up', 'down'] }],
    variant: p => ARROW[p.dir],
    make(tg, p, cx) {
      const d = String(p.dir);
      return perUnit(tg, 'line', cx, u => { const set = translate(u.el); return (a, b) => set(a >= 1 && b <= 0 ? 'none' : slideUnit(d, cx.ein(a), cx.eout(b))); });
    }
  },
  {
    id: 'interleave', name: 'Interleave', group: 'Type', staggered: true, spread: 0.45, orders: ['seq', 'center'],
    blurb: 'Alternate glyphs rise and drop into place, meeting on the baseline.',
    params: [{ key: 'unit', label: 'Unit', options: ['char', 'word'] }],
    variant: p => String(p.unit === 'char' ? 'glyphs' : 'words'),
    make(tg, p, cx) {
      return perUnit(tg, p.unit === 'word' ? 'word' : 'char', cx, (u, i) => {
        const set = translate(u.el), d = i % 2 ? 'down' : 'up';
        return (a, b) => set(a >= 1 && b <= 0 ? 'none' : slideUnit(d, cx.ein(a), cx.eout(b)));
      });
    }
  },
  {
    id: 'charwipe', name: 'Glyph wipe', group: 'Type', staggered: true, spread: 0.6, orders: ['seq', 'random'],
    blurb: 'Each glyph wipes on with its own hard edge.',
    params: [{ key: 'dir', label: 'Direction', options: ['right', 'down', 'up'] }],
    variant: p => ARROW[p.dir],
    make(tg, p, cx) {
      const d = p.dir as Dir;
      return perUnit(tg, 'char', cx, u => { const set = clipper(u.mask); return (a, b) => set(a >= 1 && b <= 0 ? UCLIP : a <= 0 || b >= 1 ? EMPTY : unitBand(d, cx.ein(a), cx.eout(b))); });
    }
  },
  {
    id: 'charcut', name: 'Glyph cut', group: 'Type', staggered: true, spread: 0.92, orders: ['random', 'seq'],
    blurb: 'Glyphs cut on one frame at a time and leave the same way.',
    params: [],
    make(tg, _p, cx) {
      return perUnit(tg, 'char', cx, u => { const set = writer(u.el, 'visibility'); return (a, b) => set(a > 0 && b <= 0 ? 'visible' : 'hidden'); });
    }
  },
  {
    id: 'wordflash', name: 'Word flash', group: 'Type', staggered: true, spread: 0.7, orders: ['seq', 'random'],
    blurb: 'Words cut on reversed out of a plate for two frames, then settle.',
    params: [{ key: 'color', label: 'Plate', options: ['accent', 'white'] }],
    variant: p => String(p.color),
    make(tg, p, cx) {
      const col = colorOf(tg, p.color), ink = col.toUpperCase() === '#8B5CF6' ? '#FFFFFF' : INK, s = cx.spread;
      return perUnit(tg, 'word', cx, u => {
        const vis = writer(u.el, 'visibility'), bg = writer(u.mask, 'background'), fg = writer(u.el, 'color');
        return (a, b) => {
          const ta = a * (1 - s) * cx.dur, tb = b * (1 - s) * cx.xdur, fl = (a > 0 && ta < 2 / 30 && b <= 0) || (b > 0 && tb < 2 / 30);
          vis(a > 0 && (b <= 0 || tb < 2 / 30) ? 'visible' : 'hidden'); bg(fl ? col : ''); fg(fl ? ink : '');
        };
      });
    }
  },
  {
    id: 'redact', name: 'Redact', group: 'Type', staggered: true, spread: 0.55, orders: ['seq', 'random'],
    blurb: 'A bar covers each word, then lifts off it. The exit re-redacts.',
    params: [{ key: 'color', label: 'Bar', options: ['ink', 'accent', 'white'] }],
    variant: p => String(p.color),
    make(tg, p, cx) {
      const col = colorOf(tg, p.color);
      return perUnit(tg, 'word', cx, u => {
        u.mask.style.position = 'relative';
        const bar = document.createElement('span');
        bar.style.cssText = `position:absolute;inset:0;background:${col};clip-path:${EMPTY}`;
        u.mask.append(bar);
        const setB = clipper(bar), vis = writer(u.el, 'visibility');
        return (a, b) => {
          if (a >= 1 && b <= 0) { setB(EMPTY); vis('visible'); return; }
          const e = b > 0 ? cx.eout : cx.ein, w = b > 0 ? b : a, l = e(cl(w / 0.5)), t = e(cl((w - 0.5) / 0.5));
          setB(poly([band('right', l, t)])); vis(b > 0 ? (w < 0.5 ? 'visible' : 'hidden') : w >= 0.5 ? 'visible' : 'hidden');
        };
      });
    }
  },
  {
    id: 'type', name: 'Typewriter', group: 'Type',
    blurb: 'Glyphs cut on in reading order behind a square caret; the exit backspaces.',
    params: [{ key: 'caret', label: 'Caret', options: ['accent', 'white', 'none'] }],
    variant: p => (p.caret === 'none' ? 'bare' : `${p.caret} caret`),
    make(tg, p, cx) {
      const tb = textBase(tg, 'char', { ...cx, order: 'seq' });
      if (!tb) return FX.wipe.make(tg, { dir: 'right' }, cx);
      const us = tb.units, vis = us.map(u => writer(u.el, 'visibility'));
      let caret: HTMLElement | null = null, at = -2;
      if (p.caret !== 'none') {
        // Absolutely positioned so it can never push a word onto the next line mid-type.
        caret = document.createElement('span');
        caret.style.cssText = `position:absolute;left:0;top:0;width:.42em;height:.82em;pointer-events:none;background:${colorOf(tg, p.caret)}`;
        if (getComputedStyle(tg.inner).position === 'static') tg.inner.style.position = 'relative';
      }
      const place = (u: Unit) => {
        const ir = tg.inner.getBoundingClientRect(), er = u.el.getBoundingClientRect(), k = scaleOf(tg.inner) || 1;
        caret!.style.transform = `translate(${((er.right - ir.left) / k).toFixed(3)}px,${((er.top - ir.top) / k).toFixed(3)}px) translate(.06em,.09em)`;
      };
      return (k, x) => {
        const [ku, xu] = tb.frame(k, x), n = x > 0 ? Math.ceil((1 - xu) * us.length) : Math.ceil(ku * us.length);
        for (let i = 0; i < us.length; i++) vis[i](i < n ? 'visible' : 'hidden');
        if (!caret) return;
        const on = (ku > 0 && ku < 1 && x <= 0) || (xu > 0 && xu < 1), pos = on ? Math.max(0, n - 1) : -1;
        if (pos !== at) {
          at = pos;
          if (pos < 0) caret.remove();
          else { if (!caret.isConnected) tg.inner.append(caret); place(us[pos]); }
        }
      };
    }
  },
  {
    id: 'decode', name: 'Decode', group: 'Type', staggered: true, spread: 1, orders: ['seq', 'random', 'center'],
    blurb: 'Glyphs arrive scrambled and lock to their final letter in order. The exit unlocks them.',
    params: [{ key: 'set', label: 'Glyphs', options: ['glyph', 'binary', 'blocks', 'caps'] }],
    variant: p => String(p.set),
    make(tg, p, cx) {
      const tb = textBase(tg, 'char', cx);
      if (!tb) return FX.wipe.make(tg, { dir: 'right' }, cx);
      const us = tb.units, G = GLYPHS[String(p.set)] || GLYPHS.glyph, txt = us.map(u => writer(u.el, 'visibility'));
      const put = pinned(us);
      const glyph = (i: number, step: number) => G[hash(`${cx.seed}:${i}:${step}`) % G.length];
      return (k, x) => {
        const [ku, xu] = tb.frame(k, x);
        for (let i = 0; i < us.length; i++) {
          const r = tb.r[i];
          if (x > 0) {
            const unlock = xu > r * 0.5, gone = xu > 0.5 + r * 0.5;
            txt[i](gone ? 'hidden' : 'visible');
            put(i, unlock ? glyph(i, Math.floor(xu * cx.xdur * 24)) : us[i].text);
          } else {
            const shown = ku > r * 0.3, locked = ku >= 0.3 + r * 0.7 || k >= 1;
            txt[i](shown ? 'visible' : 'hidden');
            put(i, locked ? us[i].text : glyph(i, Math.floor(ku * cx.dur * 24)));
          }
        }
      };
    }
  },
  {
    id: 'flap', name: 'Split-flap', group: 'Type', staggered: true, spread: 0.6, orders: ['seq', 'random'],
    blurb: 'Each character flips through the board alphabet and stops on its letter.',
    params: [{ key: 'rate', label: 'Flips / s', options: [30, 15] }],
    variant: p => `${p.rate} fps`,
    make(tg, p, cx) {
      const tb = textBase(tg, 'char', cx);
      if (!tb) return FX.wipe.make(tg, { dir: 'right' }, cx);
      const us = tb.units, rate = +p.rate, vis = us.map(u => writer(u.el, 'visibility')), L = FLAP.length;
      const put = pinned(us);
      const flips = us.map((_, i) => 4 + ((i * 7 + cx.seed) % 6));
      const target = us.map(u => FLAP.indexOf(u.text.toUpperCase()));
      const face = (i: number, st: number) => {
        const ti = target[i], lower = us[i].text !== us[i].text.toUpperCase();
        const c = ti < 0 ? FLAP[(hash(`${i}:${st}`) % (L - 1)) + 1] : FLAP[(ti - flips[i] + st + L * 4) % L];
        return lower ? c.toLowerCase() : c;
      };
      return (k, x) => {
        const [ku, xu] = tb.frame(k, x);
        for (let i = 0; i < us.length; i++) {
          const r = tb.r[i] * cx.spread;
          if (x > 0) {
            const st = Math.floor((xu - tb.r[i] * 0.5) * cx.xdur * rate);
            vis[i](st < 3 ? 'visible' : 'hidden');
            put(i, st < 0 ? us[i].text : FLAP[(Math.max(0, target[i]) + st + 1) % L]);
          } else {
            const st = Math.floor((ku - r) * cx.dur * rate);
            vis[i](ku > r ? 'visible' : 'hidden');
            put(i, st >= flips[i] || k >= 1 ? us[i].text : face(i, Math.max(0, st)));
          }
        }
      };
    }
  },

  // Cut ──────────────────────────────────────────
  {
    id: 'cut', name: 'Frame cut', group: 'Cut', exit: true,
    blurb: 'Elements appear on their cue with no transition and cut away together.',
    params: [],
    make(tg) {
      const set = clipper(tg.wrap);
      return (k, x) => set(k > 0 && x < 0.65 ? FULL : EMPTY);
    }
  }
];

export const EFFECTS = defs;
export const FX: Record<string, EffectDef> = Object.fromEntries(defs.map(d => [d.id, d]));
export const defaultParams = (d: EffectDef): Params => Object.fromEntries(d.params.map(q => [q.key, q.options[0]]));
