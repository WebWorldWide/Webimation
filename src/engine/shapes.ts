// Shapes: arrows, callouts, brackets, frames, markers and badges for pointing at things in a video.
// Every shape is a set of SVG parts on its own canvas: strokes that draw on, fills that wipe or cut
// on, and heads/caps that land when their stroke arrives. Geometry is built from parameters, not
// stored paths, so any size, angle, weight or curvature stays exact (strokes sit on half pixels
// when their width is odd, so 1 px and 3 px lines stay crisp).
//
// A shape's animation is chosen separately (see SHAPE_MOTIONS) and is a pure function of time.

export interface ShapePart {
  d: string;
  /** 'stroke' draws along its length; 'fill' is a solid area; 'head' lands at the end of a stroke. */
  kind: 'stroke' | 'fill' | 'head';
  /** Colour role: accent, fg (white/ink by field), plate or plate-fg. */
  color: 'accent' | 'fg' | 'plate' | 'plate-fg';
  width?: number;
  /** Order of drawing (0 first). Parts with the same step draw together. */
  step: number;
  dash?: string;
  cap?: 'butt' | 'square' | 'round';
  join?: 'miter' | 'round' | 'bevel';
}

export interface ShapeGeom { w: number; h: number; parts: ShapePart[]; label?: { x: number; y: number; anchor: 'start' | 'middle' | 'end'; size: number; plate?: boolean } }

export interface ShapeParam { key: string; label: string; min: number; max: number; step: number; def: number; unit?: string }
export interface ShapeDef {
  id: string;
  name: string;
  group: 'Arrows' | 'Lines' | 'Callouts' | 'Frames' | 'Marks' | 'Badges';
  blurb: string;
  params: ShapeParam[];
  /** Options shown as segmented choices. */
  options?: { key: string; label: string; values: [string, string][] }[];
  label?: boolean;
  geom(p: Record<string, number | string>): ShapeGeom;
}

// ── geometry helpers ─────────────────────────────────────────────────────────
const n = (v: number) => +v.toFixed(3);
/** Crisp coordinate: on a half pixel for odd stroke widths, on the integer grid for even ones. */
const crisp = (v: number, w: number) => (Math.round(w) % 2 ? Math.floor(v) + 0.5 : Math.round(v));
type Pt = [number, number];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const norm = (a: Pt): Pt => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a: Pt): Pt => [-a[1], a[0]];
const M = (p: Pt) => `M${n(p[0])} ${n(p[1])}`;
const L = (p: Pt) => `L${n(p[0])} ${n(p[1])}`;
const Q = (c: Pt, p: Pt) => `Q${n(c[0])} ${n(c[1])} ${n(p[0])} ${n(p[1])}`;
const C = (c1: Pt, c2: Pt, p: Pt) => `C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(p[0])} ${n(p[1])}`;

/** Arrowhead at `tip` pointing along `dir`. Styles: tri (solid), open (chevron), bar, dot, diamond. */
function head(tip: Pt, dir: Pt, size: number, style: string, w: number): ShapePart | null {
  const u = norm(dir), v = perp(u), back = add(tip, mul(u, -size));
  switch (style) {
    case 'tri': {
      // Pull the tip back by the miter so the solid head's point lands exactly on `tip`.
      const a = add(back, mul(v, size * 0.55)), b = add(back, mul(v, -size * 0.55));
      return { d: `${M(tip)}${L(a)}${L(b)}Z`, kind: 'head', color: 'accent', step: 1 };
    }
    case 'open': {
      const a = add(back, mul(v, size * 0.6)), b = add(back, mul(v, -size * 0.6));
      return { d: `${M(a)}${L(tip)}${L(b)}`, kind: 'head', color: 'accent', step: 1, width: w, join: 'miter', cap: 'square' };
    }
    case 'bar': {
      const a = add(tip, mul(v, size * 0.5)), b = add(tip, mul(v, -size * 0.5));
      return { d: `${M(a)}${L(b)}`, kind: 'head', color: 'accent', step: 1, width: w, cap: 'butt' };
    }
    case 'dot': {
      const r = size * 0.38, c = add(tip, mul(u, -r));
      return { d: `M${n(c[0] - r)} ${n(c[1])}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`, kind: 'head', color: 'accent', step: 1 };
    }
    case 'diamond': {
      const m = add(tip, mul(u, -size * 0.55)), e = add(tip, mul(u, -size * 1.1));
      return { d: `${M(tip)}${L(add(m, mul(v, size * 0.4)))}${L(e)}${L(add(m, mul(v, -size * 0.4)))}Z`, kind: 'head', color: 'accent', step: 1 };
    }
    default: return null;
  }
}
/** How far a head eats into the stroke so the line ends under the head instead of poking through. */
const headInset = (style: string, size: number, w: number) => (style === 'tri' ? size * 0.7 : style === 'diamond' ? size * 0.6 : style === 'dot' ? size * 0.38 : style === 'open' ? w * 0.5 : 0);

const HEADS: [string, string][] = [['tri', 'Solid'], ['open', 'Open'], ['bar', 'Bar'], ['dot', 'Dot'], ['diamond', 'Diamond'], ['none', 'None']];
const W = (def: number): ShapeParam => ({ key: 'weight', label: 'Weight', min: 1, max: 24, step: 1, def, unit: 'px' });
const PAD = 24;

// ── catalogue ────────────────────────────────────────────────────────────────
export const SHAPES: ShapeDef[] = [
  // Arrows ─────────────────────────────────────
  {
    id: 'arrow', name: 'Arrow', group: 'Arrows', blurb: 'Straight arrow at any angle. The head lands as the line arrives.',
    params: [{ key: 'len', label: 'Length', min: 60, max: 900, step: 1, def: 320, unit: 'px' }, { key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, def: 0, unit: '°' }, W(8), { key: 'head', label: 'Head size', min: 8, max: 120, step: 1, def: 34, unit: 'px' }],
    options: [{ key: 'tip', label: 'Head', values: HEADS }, { key: 'tail', label: 'Tail', values: HEADS.slice().reverse() }],
    geom(p) {
      const len = +p.len, a = (+p.angle * Math.PI) / 180, w = +p.weight, hs = +p.head, u: Pt = [Math.cos(a), Math.sin(a)];
      const ext = len / 2 + hs, cx = ext + PAD, cy = ext + PAD, s: Pt = [cx - u[0] * len / 2, cy - u[1] * len / 2], e: Pt = [cx + u[0] * len / 2, cy + u[1] * len / 2];
      const tip = String(p.tip), tail = String(p.tail);
      const s2 = add(s, mul(u, headInset(tail, hs, w))), e2 = add(e, mul(u, -headInset(tip, hs, w)));
      const parts: ShapePart[] = [{ d: `${M(s2)}${L(e2)}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt' }];
      const h1 = head(e, u, hs, tip, w), h0 = head(s, mul(u, -1), hs, tail, w);
      if (h1) parts.push(h1);
      if (h0) parts.push({ ...h0, step: 0 });
      return { w: 2 * (ext + PAD), h: 2 * (ext + PAD), parts };
    }
  },
  {
    id: 'curve', name: 'Curved arrow', group: 'Arrows', blurb: 'A single smooth bend. Positive bend curves left of travel, negative right.',
    params: [{ key: 'len', label: 'Length', min: 80, max: 900, step: 1, def: 380, unit: 'px' }, { key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, def: -20, unit: '°' }, { key: 'bend', label: 'Bend', min: -0.8, max: 0.8, step: 0.01, def: 0.35 }, W(8), { key: 'head', label: 'Head size', min: 8, max: 120, step: 1, def: 34, unit: 'px' }],
    options: [{ key: 'tip', label: 'Head', values: HEADS }],
    geom(p) {
      const len = +p.len, a = (+p.angle * Math.PI) / 180, w = +p.weight, hs = +p.head, b = +p.bend, u: Pt = [Math.cos(a), Math.sin(a)], v = perp(u);
      const ext = len / 2 + hs + Math.abs(b) * len * 0.5, cx = ext + PAD, cy = ext + PAD;
      const s: Pt = [cx - u[0] * len / 2, cy - u[1] * len / 2], e: Pt = [cx + u[0] * len / 2, cy + u[1] * len / 2], c = add([cx, cy], mul(v, -b * len));
      const tan = norm([e[0] - c[0], e[1] - c[1]]), tip = String(p.tip), e2 = add(e, mul(tan, -headInset(tip, hs, w)));
      const parts: ShapePart[] = [{ d: `${M(s)}${Q(c, e2)}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt' }];
      const h = head(e, tan, hs, tip, w);
      if (h) parts.push(h);
      return { w: 2 * (ext + PAD), h: 2 * (ext + PAD), parts };
    }
  },
  {
    id: 'swoop', name: 'Swoop', group: 'Arrows', blurb: 'An S-curve that leaves one way and arrives another, like a hand-drawn pointer.',
    params: [{ key: 'w', label: 'Width', min: 120, max: 900, step: 1, def: 420, unit: 'px' }, { key: 'h', label: 'Drop', min: -400, max: 400, step: 1, def: 160, unit: 'px' }, { key: 'swing', label: 'Swing', min: 0, max: 1, step: 0.01, def: 0.6 }, W(8), { key: 'head', label: 'Head size', min: 8, max: 120, step: 1, def: 34, unit: 'px' }],
    options: [{ key: 'tip', label: 'Head', values: HEADS }],
    geom(p) {
      const w0 = +p.w, h0 = +p.h, sw = +p.swing, w = +p.weight, hs = +p.head, tip = String(p.tip);
      const m = hs + PAD + Math.abs(h0) * 0.2, s: Pt = [m, m + Math.max(0, -h0)], e: Pt = [m + w0, m + Math.max(0, h0)];
      const c1: Pt = [s[0] + w0 * sw, s[1]], c2: Pt = [e[0] - w0 * sw, e[1]];
      const tan = norm([e[0] - c2[0], e[1] - c2[1]]), e2 = add(e, mul(tan, -headInset(tip, hs, w)));
      const parts: ShapePart[] = [{ d: `${M(s)}${C(c1, c2, e2)}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt' }];
      const h = head(e, tan, hs, tip, w);
      if (h) parts.push(h);
      return { w: w0 + 2 * m, h: Math.abs(h0) + 2 * m, parts };
    }
  },
  {
    id: 'elbow', name: 'Elbow arrow', group: 'Arrows', blurb: 'Right-angled connector: across, then down (or the reverse). Square corners.',
    params: [{ key: 'w', label: 'Across', min: 40, max: 900, step: 1, def: 300, unit: 'px' }, { key: 'h', label: 'Down', min: -500, max: 500, step: 1, def: 180, unit: 'px' }, { key: 'radius', label: 'Corner', min: 0, max: 120, step: 1, def: 0, unit: 'px' }, W(6), { key: 'head', label: 'Head size', min: 8, max: 120, step: 1, def: 28, unit: 'px' }],
    options: [{ key: 'first', label: 'Goes', values: [['h', 'Across first'], ['v', 'Down first']] }, { key: 'tip', label: 'Head', values: HEADS }],
    geom(p) {
      const W0 = +p.w, H0 = +p.h, w = +p.weight, hs = +p.head, tip = String(p.tip), r = Math.min(+p.radius, W0 / 2, Math.abs(H0) / 2);
      const m = hs + PAD, sy = H0 >= 0 ? m : m - H0, s: Pt = [crisp(m, w), crisp(sy, w)], e: Pt = [crisp(m + W0, w), crisp(sy + H0, w)];
      const hFirst = p.first !== 'v', k: Pt = hFirst ? [e[0], s[1]] : [s[0], e[1]], dir: Pt = hFirst ? [0, Math.sign(H0) || 1] : [1, 0];
      const e2 = add(e, mul(dir, -headInset(tip, hs, w)));
      let d: string;
      if (r > 0) {
        const into = norm([k[0] - s[0], k[1] - s[1]]), out = norm([e[0] - k[0], e[1] - k[1]]);
        d = `${M(s)}${L(add(k, mul(into, -r)))}${Q(k, add(k, mul(out, r)))}${L(e2)}`;
      } else d = `${M(s)}${L(k)}${L(e2)}`;
      const parts: ShapePart[] = [{ d, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt', join: 'miter' }];
      const h = head(e, dir, hs, tip, w);
      if (h) parts.push(h);
      return { w: W0 + 2 * m, h: Math.abs(H0) + 2 * m, parts };
    }
  },
  {
    id: 'block', name: 'Block arrow', group: 'Arrows', blurb: 'A solid filled arrow shape. Wipes on along its direction.',
    params: [{ key: 'len', label: 'Length', min: 80, max: 800, step: 1, def: 300, unit: 'px' }, { key: 'thick', label: 'Body', min: 10, max: 200, step: 1, def: 56, unit: 'px' }, { key: 'head', label: 'Head', min: 20, max: 300, step: 1, def: 120, unit: 'px' }, { key: 'angle', label: 'Angle', min: -180, max: 180, step: 90, def: 0, unit: '°' }],
    geom(p) {
      const len = +p.len, t = +p.thick, hh = Math.max(+p.head, t), hl = hh * 0.62, a = (+p.angle * Math.PI) / 180;
      const pts: Pt[] = [[0, -t / 2], [len - hl, -t / 2], [len - hl, -hh / 2], [len, 0], [len - hl, hh / 2], [len - hl, t / 2], [0, t / 2]];
      const ext = Math.max(len, hh) / 2 + PAD + Math.max(len, hh) * 0.5;
      const rot = (q: Pt): Pt => { const x = q[0] - len / 2, y = q[1]; return [Math.round(ext + x * Math.cos(a) - y * Math.sin(a)), Math.round(ext + x * Math.sin(a) + y * Math.cos(a))]; };
      return { w: 2 * ext, h: 2 * ext, parts: [{ d: `${M(rot(pts[0]))}${pts.slice(1).map(q => L(rot(q))).join('')}Z`, kind: 'fill', color: 'accent', step: 0 }] };
    }
  },
  {
    id: 'double', name: 'Double arrow', group: 'Arrows', blurb: 'Two-way arrow for comparisons and ranges. Draws out from the middle.',
    params: [{ key: 'len', label: 'Length', min: 80, max: 1100, step: 1, def: 520, unit: 'px' }, W(6), { key: 'head', label: 'Head size', min: 8, max: 100, step: 1, def: 28, unit: 'px' }],
    options: [{ key: 'tip', label: 'Heads', values: HEADS.slice(0, 5) }, { key: 'axis', label: 'Axis', values: [['h', 'Horizontal'], ['v', 'Vertical']] }],
    label: true,
    geom(p) {
      const len = +p.len, w = +p.weight, hs = +p.head, tip = String(p.tip), V = p.axis === 'v';
      const L0 = len + 2 * (hs + PAD), T = 2 * (hs + PAD) + 60, c = crisp(T / 2, w), mid = L0 / 2;
      const P = (x: number): Pt => (V ? [c, x] : [x, c]), u: Pt = V ? [0, 1] : [1, 0];
      const a = hs + PAD, b = L0 - hs - PAD, inset = headInset(tip, hs, w);
      const parts: ShapePart[] = [
        { d: `${M(P(mid))}${L(P(a + inset))}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt' },
        { d: `${M(P(mid))}${L(P(b - inset))}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt' }
      ];
      for (const h of [head(P(a), mul(u, -1), hs, tip, w), head(P(b), u, hs, tip, w)]) if (h) parts.push(h);
      return { w: V ? T : L0, h: V ? L0 : T, parts, label: V ? { x: c + 26, y: mid, anchor: 'start', size: 30 } : { x: mid, y: c - 22, anchor: 'middle', size: 30 } };
    }
  },

  // Lines ──────────────────────────────────────
  {
    id: 'underline', name: 'Underline', group: 'Lines', blurb: 'A rule to sit under words. Straight, double or hand-drawn swash.',
    params: [{ key: 'len', label: 'Length', min: 40, max: 1100, step: 1, def: 420, unit: 'px' }, W(8)],
    options: [{ key: 'style', label: 'Style', values: [['straight', 'Straight'], ['double', 'Double'], ['swash', 'Swash'], ['zig', 'Zigzag']] }],
    geom(p) {
      const len = +p.len, w = +p.weight, st = String(p.style), x0 = PAD, x1 = PAD + len, y = crisp(PAD + 30, w);
      const parts: ShapePart[] = [];
      if (st === 'double') {
        parts.push({ d: `${M([x0, y])}${L([x1, y])}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt' });
        const y2 = crisp(y + w * 2, w);
        parts.push({ d: `${M([x0, y2])}${L([x1, y2])}`, kind: 'stroke', color: 'accent', width: w, step: 1, cap: 'butt' });
      } else if (st === 'swash') {
        parts.push({ d: `${M([x0, y + 6])}${C([x0 + len * 0.3, y - 14], [x0 + len * 0.62, y + 16], [x1, y - 8])}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'round' });
      } else if (st === 'zig') {
        const k = Math.max(2, Math.round(len / (w * 4 + 16))), dx = len / k, amp = w + 6;
        let d = M([x0, y]);
        for (let i = 1; i <= k; i++) d += L([x0 + dx * (i - 0.5), y + (i % 2 ? -amp : amp) * 0.5]) + L([x0 + dx * i, y]);
        parts.push({ d, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt', join: 'miter' });
      } else parts.push({ d: `${M([x0, y])}${L([x1, y])}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt' });
      return { w: len + 2 * PAD, h: 60 + PAD * 2, parts };
    }
  },
  {
    id: 'strike', name: 'Strike', group: 'Lines', blurb: 'A cross-out: one hard stroke, a pair, or a scribble.',
    params: [{ key: 'len', label: 'Length', min: 40, max: 1100, step: 1, def: 360, unit: 'px' }, { key: 'h', label: 'Height', min: 20, max: 240, step: 1, def: 80, unit: 'px' }, W(8)],
    options: [{ key: 'style', label: 'Style', values: [['line', 'Line'], ['x', 'Cross'], ['scribble', 'Scribble']] }],
    geom(p) {
      const len = +p.len, h = +p.h, w = +p.weight, st = String(p.style), x0 = PAD, x1 = PAD + len, y0 = PAD, y1 = PAD + h, ym = crisp((y0 + y1) / 2, w);
      const parts: ShapePart[] = [];
      if (st === 'x') {
        parts.push({ d: `${M([x0, y0])}${L([x1, y1])}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt' });
        parts.push({ d: `${M([x1, y0])}${L([x0, y1])}`, kind: 'stroke', color: 'accent', width: w, step: 1, cap: 'butt' });
      } else if (st === 'scribble') {
        const k = Math.max(3, Math.round(len / 60)), dx = len / k;
        let d = M([x0, ym]);
        for (let i = 0; i < k; i++) d += L([x0 + dx * (i + 0.7), y0 + h * 0.15]) + L([x0 + dx * (i + 1), y1 - h * 0.15]);
        parts.push({ d, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'round', join: 'round' });
      } else parts.push({ d: `${M([x0, ym])}${L([x1, ym])}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt' });
      return { w: len + 2 * PAD, h: h + 2 * PAD, parts };
    }
  },
  {
    id: 'divider', name: 'Divider', group: 'Lines', blurb: 'A section rule with end ticks or a centre mark.',
    params: [{ key: 'len', label: 'Length', min: 60, max: 1180, step: 1, def: 900, unit: 'px' }, W(2), { key: 'tick', label: 'Tick', min: 0, max: 60, step: 1, def: 16, unit: 'px' }],
    options: [{ key: 'mark', label: 'Mark', values: [['ends', 'End ticks'], ['center', 'Centre square'], ['none', 'Plain']] }],
    geom(p) {
      const len = +p.len, w = +p.weight, tk = +p.tick, y = crisp(PAD + 30, w), x0 = PAD, x1 = PAD + len, parts: ShapePart[] = [{ d: `${M([x0, y])}${L([x1, y])}`, kind: 'stroke', color: 'fg', width: w, step: 0, cap: 'butt' }];
      if (p.mark === 'ends' && tk) parts.push({ d: `${M([crisp(x0, w), y - tk / 2])}${L([crisp(x0, w), y + tk / 2])}${M([crisp(x1, w), y - tk / 2])}${L([crisp(x1, w), y + tk / 2])}`, kind: 'head', color: 'fg', width: w, step: 1, cap: 'butt' });
      if (p.mark === 'center') { const s = Math.max(8, tk), cx = Math.round(PAD + len / 2 - s / 2), cy = Math.round(y - s / 2); parts.push({ d: `M${cx} ${cy}h${s}v${s}h${-s}Z`, kind: 'head', color: 'accent', step: 1 }); }
      return { w: len + 2 * PAD, h: 60 + 2 * PAD, parts };
    }
  },

  // Callouts ───────────────────────────────────
  {
    id: 'leaderline', name: 'Leader label', group: 'Callouts', blurb: 'A dot on the thing, a line out to a label plate. The classic broadcast callout.',
    params: [{ key: 'dx', label: 'Reach X', min: -600, max: 600, step: 1, def: 260, unit: 'px' }, { key: 'dy', label: 'Reach Y', min: -400, max: 400, step: 1, def: -160, unit: 'px' }, { key: 'shelf', label: 'Shelf', min: 0, max: 400, step: 1, def: 120, unit: 'px' }, W(3), { key: 'dot', label: 'Dot', min: 6, max: 60, step: 1, def: 18, unit: 'px' }],
    label: true,
    geom(p) {
      const dx = +p.dx, dy = +p.dy, sh = +p.shelf, w = +p.weight, ds = +p.dot, sx = Math.sign(dx) || 1;
      const mx = PAD + ds + Math.max(0, -dx - sh * (sx < 0 ? 1 : 0)) + (sx < 0 ? sh + 220 : 0), my = PAD + ds + Math.max(0, -dy) + 40;
      const o: Pt = [crisp(mx, w), crisp(my, w)], k: Pt = [crisp(mx + dx, w), crisp(my + dy, w)], e: Pt = [crisp(mx + dx + sx * sh, w), k[1]];
      const r = ds / 2;
      return {
        w: Math.abs(dx) + sh + 2 * PAD + 2 * ds + 240 + (sx < 0 ? sh + 220 : 0), h: Math.abs(dy) + 2 * PAD + 2 * ds + 80,
        parts: [
          { d: `M${n(o[0] - r)} ${n(o[1])}a${n(r)} ${n(r)} 0 1 0 ${n(ds)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-ds)} 0Z`, kind: 'fill', color: 'accent', step: 0 },
          { d: `${M(o)}${L(k)}${L(e)}`, kind: 'stroke', color: 'fg', width: w, step: 1, cap: 'butt', join: 'miter' }
        ],
        label: { x: e[0] + sx * 14, y: e[1], anchor: sx > 0 ? 'start' : 'end', size: 30, plate: true }
      };
    }
  },
  {
    id: 'bubble', name: 'Speech bubble', group: 'Callouts', blurb: 'A square speech box with a tail. Outline draws, then the label lands.',
    params: [{ key: 'w', label: 'Width', min: 160, max: 900, step: 1, def: 440, unit: 'px' }, { key: 'h', label: 'Height', min: 80, max: 500, step: 1, def: 150, unit: 'px' }, { key: 'tail', label: 'Tail at', min: 0.1, max: 0.9, step: 0.01, def: 0.22 }, { key: 'tl', label: 'Tail length', min: 10, max: 160, step: 1, def: 46, unit: 'px' }, W(4)],
    options: [{ key: 'fill', label: 'Body', values: [['plate', 'Plate'], ['outline', 'Outline'], ['accent', 'Accent']] }],
    label: true,
    geom(p) {
      const W0 = +p.w, H0 = +p.h, w = +p.weight, tl = +p.tl, x0 = crisp(PAD, w), y0 = crisp(PAD, w), x1 = crisp(PAD + W0, w), y1 = crisp(PAD + H0, w);
      const tx = Math.round(x0 + W0 * +p.tail), tw = Math.min(40, W0 * 0.12);
      const d = `${M([x0, y0])}${L([x1, y0])}${L([x1, y1])}${L([tx + tw, y1])}${L([tx - tw * 0.2, y1 + tl])}${L([tx, y1])}${L([x0, y1])}Z`;
      const fill = String(p.fill), parts: ShapePart[] = [];
      if (fill !== 'outline') parts.push({ d, kind: 'fill', color: fill === 'accent' ? 'accent' : 'plate', step: 1 });
      parts.push({ d, kind: 'stroke', color: fill === 'outline' ? 'fg' : fill === 'accent' ? 'accent' : 'plate', width: w, step: 0, join: 'miter' });
      return { w: W0 + 2 * PAD, h: H0 + tl + 2 * PAD, parts, label: { x: x0 + 30, y: (y0 + y1) / 2, anchor: 'start', size: 38, plate: fill !== 'outline' } };
    }
  },
  {
    id: 'pin', name: 'Map pin', group: 'Callouts', blurb: 'A square pin with a stem and a pulse ring that lands on the spot.',
    params: [{ key: 'size', label: 'Size', min: 24, max: 200, step: 1, def: 64, unit: 'px' }, { key: 'stem', label: 'Stem', min: 0, max: 300, step: 1, def: 70, unit: 'px' }, W(4)],
    label: true,
    geom(p) {
      const s = +p.size, st = +p.stem, w = +p.weight, cx = Math.round(PAD + s), top = PAD + 10, base = top + s + st;
      return {
        w: 2 * s + 2 * PAD + 300, h: s + st + 2 * PAD + 50,
        parts: [
          { d: `M${cx - s / 2} ${top}h${s}v${s}h${-s}Z`, kind: 'fill', color: 'accent', step: 0 },
          { d: `M${cx - s / 6} ${top + s / 3}h${s / 3}v${s / 3}h${-s / 3}Z`, kind: 'fill', color: 'plate-fg', step: 0 },
          { d: `${M([crisp(cx, w), top + s])}${L([crisp(cx, w), base])}`, kind: 'stroke', color: 'accent', width: w, step: 1, cap: 'butt' },
          { d: `M${n(cx - s * 0.45)} ${base}a${n(s * 0.45)} ${n(s * 0.14)} 0 1 0 ${n(s * 0.9)} 0a${n(s * 0.45)} ${n(s * 0.14)} 0 1 0 ${n(-s * 0.9)} 0Z`, kind: 'stroke', color: 'accent', width: Math.max(2, w / 2), step: 2 }
        ],
        label: { x: cx + s / 2 + 22, y: top + s / 2, anchor: 'start', size: 32 }
      };
    }
  },
  {
    id: 'number', name: 'Step marker', group: 'Callouts', blurb: 'A numbered square (or circle) to tag a step, with an optional pointer line.',
    params: [{ key: 'size', label: 'Size', min: 24, max: 200, step: 1, def: 72, unit: 'px' }, { key: 'reach', label: 'Pointer', min: 0, max: 500, step: 1, def: 0, unit: 'px' }, { key: 'angle', label: 'Pointer angle', min: -180, max: 180, step: 1, def: 45, unit: '°' }, W(4)],
    options: [{ key: 'form', label: 'Form', values: [['square', 'Square'], ['circle', 'Circle']] }],
    label: true,
    geom(p) {
      const s = +p.size, r = +p.reach, a = (+p.angle * Math.PI) / 180, w = +p.weight, ext = s / 2 + r + PAD, c: Pt = [Math.round(ext), Math.round(ext)];
      const parts: ShapePart[] = [];
      if (r > 0) { const u: Pt = [Math.cos(a), Math.sin(a)]; parts.push({ d: `${M(add(c, mul(u, s / 2)))}${L(add(c, mul(u, s / 2 + r)))}`, kind: 'stroke', color: 'accent', width: w, step: 1, cap: 'butt' }); }
      parts.unshift(p.form === 'circle'
        ? { d: `M${c[0] - s / 2} ${c[1]}a${s / 2} ${s / 2} 0 1 0 ${s} 0a${s / 2} ${s / 2} 0 1 0 ${-s} 0Z`, kind: 'fill', color: 'accent', step: 0 }
        : { d: `M${c[0] - s / 2} ${c[1] - s / 2}h${s}v${s}h${-s}Z`, kind: 'fill', color: 'accent', step: 0 });
      return { w: 2 * ext, h: 2 * ext, parts, label: { x: c[0], y: c[1], anchor: 'middle', size: s * 0.5 } };
    }
  },

  // Frames ─────────────────────────────────────
  {
    id: 'box', name: 'Highlight box', group: 'Frames', blurb: 'A hard rectangle around something. Draws clockwise from the top-left.',
    params: [{ key: 'w', label: 'Width', min: 40, max: 1180, step: 1, def: 420, unit: 'px' }, { key: 'h', label: 'Height', min: 30, max: 660, step: 1, def: 240, unit: 'px' }, W(6)],
    options: [{ key: 'style', label: 'Style', values: [['solid', 'Solid'], ['dashed', 'Dashed'], ['double', 'Double']] }],
    geom(p) {
      const W0 = +p.w, H0 = +p.h, w = +p.weight, x0 = crisp(PAD, w), y0 = crisp(PAD, w), x1 = crisp(PAD + W0, w), y1 = crisp(PAD + H0, w);
      const rect = (i: number) => `M${x0 - i} ${y0 - i}H${x1 + i}V${y1 + i}H${x0 - i}Z`;
      const dash = p.style === 'dashed' ? `${w * 3} ${w * 2}` : undefined;
      const parts: ShapePart[] = [{ d: rect(0), kind: 'stroke', color: 'accent', width: w, step: 0, join: 'miter', cap: 'square', dash }];
      if (p.style === 'double') parts.push({ d: rect(w * 2), kind: 'stroke', color: 'accent', width: Math.max(1, Math.round(w / 2)), step: 1, join: 'miter' });
      return { w: W0 + 2 * PAD, h: H0 + 2 * PAD, parts };
    }
  },
  {
    id: 'corners', name: 'Corner brackets', group: 'Frames', blurb: 'Four viewfinder corners that snap in around a subject.',
    params: [{ key: 'w', label: 'Width', min: 60, max: 1180, step: 1, def: 420, unit: 'px' }, { key: 'h', label: 'Height', min: 40, max: 660, step: 1, def: 260, unit: 'px' }, { key: 'arm', label: 'Arm', min: 8, max: 200, step: 1, def: 48, unit: 'px' }, W(6)],
    geom(p) {
      const W0 = +p.w, H0 = +p.h, w = +p.weight, a = Math.min(+p.arm, W0 / 2, H0 / 2), x0 = crisp(PAD, w), y0 = crisp(PAD, w), x1 = crisp(PAD + W0, w), y1 = crisp(PAD + H0, w);
      const c = (x: number, y: number, sx: number, sy: number, i: number): ShapePart => ({ d: `M${x} ${y + sy * a}V${y}H${x + sx * a}`, kind: 'stroke', color: 'accent', width: w, step: i, join: 'miter', cap: 'square' });
      return { w: W0 + 2 * PAD, h: H0 + 2 * PAD, parts: [c(x0, y0, 1, 1, 0), c(x1, y0, -1, 1, 0), c(x1, y1, -1, -1, 0), c(x0, y1, 1, -1, 0)] };
    }
  },
  {
    id: 'bracket', name: 'Bracket', group: 'Frames', blurb: 'A square brace to group a range, with a centre spur pointing at the label.',
    params: [{ key: 'len', label: 'Length', min: 40, max: 660, step: 1, def: 300, unit: 'px' }, { key: 'depth', label: 'Depth', min: 6, max: 80, step: 1, def: 24, unit: 'px' }, { key: 'spur', label: 'Spur', min: 0, max: 80, step: 1, def: 18, unit: 'px' }, W(4)],
    options: [{ key: 'side', label: 'Opens', values: [['right', 'Right'], ['left', 'Left'], ['down', 'Down'], ['up', 'Up']] }],
    label: true,
    geom(p) {
      const len = +p.len, dp = +p.depth, sp = +p.spur, w = +p.weight, side = String(p.side), V = side === 'right' || side === 'left', sg = side === 'right' || side === 'down' ? 1 : -1;
      const base = crisp(PAD + (sg > 0 ? 0 : dp + sp), w), lo = PAD, hi = PAD + len, mid = Math.round(PAD + len / 2), tip = base + sg * (dp + sp);
      const P = (along: number, across: number): Pt => (V ? [across, along] : [along, across]);
      const d = `${M(P(lo, base + sg * dp))}${L(P(lo, base))}${L(P(hi, base))}${L(P(hi, base + sg * dp))}${M(P(mid, base))}${L(P(mid, tip))}`;
      const T = dp + sp + 2 * PAD;
      const lp = P(mid, tip + sg * 20);
      return { w: V ? T + 300 : len + 2 * PAD, h: V ? len + 2 * PAD : T + 60, parts: [{ d, kind: 'stroke', color: 'fg', width: w, step: 0, join: 'miter', cap: 'butt' }], label: { x: lp[0], y: lp[1], anchor: V ? (sg > 0 ? 'start' : 'end') : 'middle', size: 30 } };
    }
  },
  {
    id: 'ring', name: 'Circle', group: 'Frames', blurb: 'A ring around something, or a hand-drawn loop that overshoots its start.',
    params: [{ key: 'rx', label: 'Width', min: 20, max: 600, step: 1, def: 200, unit: 'px' }, { key: 'ry', label: 'Height', min: 20, max: 340, step: 1, def: 110, unit: 'px' }, W(6)],
    options: [{ key: 'style', label: 'Style', values: [['clean', 'Clean'], ['loop', 'Hand loop'], ['dashed', 'Dashed']] }],
    geom(p) {
      const rx = +p.rx / 2 + 0, ry = +p.ry / 2, w = +p.weight, cx = Math.round(rx + PAD + 10), cy = Math.round(ry + PAD + 10);
      let d: string;
      if (p.style === 'loop') {
        const k = 64, pts: string[] = [];
        for (let i = 0; i <= k; i++) {
          const t = (i / k) * 2.18 * Math.PI - 0.4, g = 1 + 0.06 * Math.sin(t * 1.5) + (t / (2 * Math.PI)) * 0.08;
          pts.push(`${i ? 'L' : 'M'}${n(cx + rx * g * Math.cos(t))} ${n(cy + ry * g * Math.sin(t))}`);
        }
        d = pts.join('');
      } else d = `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
      return { w: 2 * (rx + PAD + 10), h: 2 * (ry + PAD + 10), parts: [{ d, kind: 'stroke', color: 'accent', width: w, step: 0, cap: p.style === 'loop' ? 'round' : 'butt', join: 'round', dash: p.style === 'dashed' ? `${w * 2.5} ${w * 1.8}` : undefined }] };
    }
  },
  {
    id: 'spotlight', name: 'Spotlight', group: 'Frames', blurb: 'Darkens the whole frame except a square or round window.',
    params: [{ key: 'x', label: 'Centre X', min: 0, max: 1280, step: 1, def: 820, unit: 'px' }, { key: 'y', label: 'Centre Y', min: 0, max: 720, step: 1, def: 330, unit: 'px' }, { key: 'w', label: 'Width', min: 40, max: 1200, step: 1, def: 360, unit: 'px' }, { key: 'h', label: 'Height', min: 40, max: 700, step: 1, def: 240, unit: 'px' }, { key: 'dim', label: 'Dim', min: 0.2, max: 0.95, step: 0.01, def: 0.65 }],
    options: [{ key: 'form', label: 'Window', values: [['rect', 'Square'], ['ellipse', 'Round']] }],
    geom(p) {
      const x = +p.x, y = +p.y, w = +p.w / 2, h = +p.h / 2;
      const hole = p.form === 'ellipse' ? `M${x - w} ${y}a${w} ${h} 0 1 0 ${2 * w} 0a${w} ${h} 0 1 0 ${-2 * w} 0Z` : `M${Math.round(x - w)} ${Math.round(y - h)}V${Math.round(y + h)}H${Math.round(x + w)}V${Math.round(y - h)}Z`;
      return { w: 1280, h: 720, parts: [{ d: `M0 0H1280V720H0Z${hole}`, kind: 'fill', color: 'plate-fg', step: 0 }] };
    }
  },

  // Marks ──────────────────────────────────────
  {
    id: 'check', name: 'Check / cross', group: 'Marks', blurb: 'A hard tick or cross, stroke-drawn, optionally in a square.',
    params: [{ key: 'size', label: 'Size', min: 20, max: 300, step: 1, def: 96, unit: 'px' }, W(10)],
    options: [{ key: 'mark', label: 'Mark', values: [['check', 'Check'], ['cross', 'Cross']] }, { key: 'frame', label: 'Frame', values: [['none', 'None'], ['square', 'Square'], ['fill', 'Filled']] }],
    geom(p) {
      const s = +p.size, w = +p.weight, o = PAD, parts: ShapePart[] = [], fr = String(p.frame), col = fr === 'fill' ? 'plate-fg' : 'accent';
      if (fr === 'square') parts.push({ d: `M${crisp(o, 3)} ${crisp(o, 3)}h${s}v${s}h${-s}Z`, kind: 'stroke', color: 'fg', width: 3, step: 0, join: 'miter' });
      if (fr === 'fill') parts.push({ d: `M${o} ${o}h${s}v${s}h${-s}Z`, kind: 'fill', color: 'accent', step: 0 });
      const k = s / 48;
      parts.push(p.mark === 'cross'
        ? { d: `M${o + 14 * k} ${o + 14 * k}L${o + 34 * k} ${o + 34 * k}M${o + 34 * k} ${o + 14 * k}L${o + 14 * k} ${o + 34 * k}`, kind: 'stroke', color: col, width: w * k * 0.55, step: 1, cap: 'square' }
        : { d: `M${o + 11 * k} ${o + 25 * k}L${o + 20 * k} ${o + 34 * k}L${o + 38 * k} ${o + 14 * k}`, kind: 'stroke', color: col, width: w * k * 0.55, step: 1, cap: 'square', join: 'miter' });
      return { w: s + 2 * PAD, h: s + 2 * PAD, parts };
    }
  },
  {
    id: 'burst', name: 'Burst', group: 'Marks', blurb: 'Emphasis rays that shoot out from a point.',
    params: [{ key: 'rays', label: 'Rays', min: 3, max: 24, step: 1, def: 8 }, { key: 'r0', label: 'Inner', min: 0, max: 200, step: 1, def: 40, unit: 'px' }, { key: 'r1', label: 'Outer', min: 20, max: 400, step: 1, def: 110, unit: 'px' }, { key: 'spin', label: 'Rotate', min: 0, max: 90, step: 1, def: 0, unit: '°' }, W(8)],
    geom(p) {
      const k = +p.rays, r0 = +p.r0, r1 = Math.max(+p.r1, r0 + 4), w = +p.weight, c = r1 + PAD, sp = (+p.spin * Math.PI) / 180, parts: ShapePart[] = [];
      for (let i = 0; i < k; i++) { const a = sp + (i / k) * 2 * Math.PI - Math.PI / 2, u: Pt = [Math.cos(a), Math.sin(a)]; parts.push({ d: `${M(add([c, c], mul(u, r0)))}${L(add([c, c], mul(u, r1)))}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt' }); }
      return { w: 2 * c, h: 2 * c, parts };
    }
  },
  {
    id: 'star', name: 'Star', group: 'Marks', blurb: 'A sharp four- to twelve-point star, filled or outlined.',
    params: [{ key: 'points', label: 'Points', min: 4, max: 12, step: 1, def: 5 }, { key: 'r', label: 'Size', min: 20, max: 300, step: 1, def: 90, unit: 'px' }, { key: 'inner', label: 'Inner', min: 0.15, max: 0.85, step: 0.01, def: 0.45 }, W(6)],
    options: [{ key: 'fill', label: 'Style', values: [['fill', 'Filled'], ['outline', 'Outline']] }],
    geom(p) {
      const k = +p.points, r = +p.r, ri = r * +p.inner, c = r + PAD, pts: Pt[] = [];
      for (let i = 0; i < k * 2; i++) { const a = (i / (k * 2)) * 2 * Math.PI - Math.PI / 2, rr = i % 2 ? ri : r; pts.push([c + Math.cos(a) * rr, c + Math.sin(a) * rr]); }
      const d = `${M(pts[0])}${pts.slice(1).map(L).join('')}Z`;
      return { w: 2 * c, h: 2 * c, parts: [p.fill === 'outline' ? { d, kind: 'stroke', color: 'accent', width: +p.weight, step: 0, join: 'miter' } : { d, kind: 'fill', color: 'accent', step: 0 }] };
    }
  },
  {
    id: 'crosshair', name: 'Crosshair', group: 'Marks', blurb: 'A target reticle: hairlines, a gap in the middle, an optional ring.',
    params: [{ key: 'size', label: 'Size', min: 30, max: 400, step: 1, def: 140, unit: 'px' }, { key: 'gap', label: 'Gap', min: 0, max: 100, step: 1, def: 18, unit: 'px' }, W(3)],
    options: [{ key: 'ring', label: 'Ring', values: [['on', 'Ring'], ['off', 'No ring']] }],
    geom(p) {
      const s = +p.size / 2, g = +p.gap, w = +p.weight, c = crisp(s + PAD, w), parts: ShapePart[] = [
        { d: `M${c - s} ${c}H${c - g}M${c + g} ${c}H${c + s}M${c} ${c - s}V${c - g}M${c} ${c + g}V${c + s}`, kind: 'stroke', color: 'accent', width: w, step: 0, cap: 'butt' }
      ];
      if (p.ring === 'on') parts.push({ d: `M${c - s * 0.62} ${c}a${s * 0.62} ${s * 0.62} 0 1 0 ${s * 1.24} 0a${s * 0.62} ${s * 0.62} 0 1 0 ${-s * 1.24} 0`, kind: 'stroke', color: 'accent', width: w, step: 1 });
      return { w: 2 * (s + PAD), h: 2 * (s + PAD), parts };
    }
  },
  {
    id: 'cursor', name: 'Cursor', group: 'Marks', blurb: 'A pointer arrow, the click target for "tap here" moments.',
    params: [{ key: 'size', label: 'Size', min: 20, max: 200, step: 1, def: 60, unit: 'px' }],
    options: [{ key: 'click', label: 'Click ring', values: [['on', 'Click'], ['off', 'No click']] }],
    geom(p) {
      const k = +p.size / 40, o = PAD + 40 * k * 0.5, parts: ShapePart[] = [];
      if (p.click === 'on') parts.push({ d: `M${o - 22 * k} ${o}a${22 * k} ${22 * k} 0 1 0 ${44 * k} 0a${22 * k} ${22 * k} 0 1 0 ${-44 * k} 0`, kind: 'stroke', color: 'accent', width: Math.max(2, 3 * k), step: 1 });
      const d = `M${o} ${o}V${o + 28 * k}L${o + 7 * k} ${o + 21 * k}L${o + 12 * k} ${o + 33 * k}L${o + 17 * k} ${o + 31 * k}L${o + 12 * k} ${o + 19 * k}H${o + 22 * k}Z`;
      parts.unshift({ d, kind: 'fill', color: 'plate', step: 0 }, { d, kind: 'stroke', color: 'plate-fg', width: Math.max(1, 2 * k), step: 0, join: 'miter' });
      return { w: o + 40 * k + PAD, h: o + 40 * k + PAD, parts };
    }
  },

  // Badges ─────────────────────────────────────
  {
    id: 'tag', name: 'Tag', group: 'Badges', blurb: 'A solid label plate. Wipes on, then the text lands.',
    params: [{ key: 'w', label: 'Width', min: 60, max: 900, step: 1, def: 260, unit: 'px' }, { key: 'h', label: 'Height', min: 24, max: 200, step: 1, def: 64, unit: 'px' }, { key: 'notch', label: 'Notch', min: 0, max: 60, step: 1, def: 0, unit: 'px' }],
    options: [{ key: 'fill', label: 'Fill', values: [['accent', 'Accent'], ['plate', 'Plate']] }],
    label: true,
    geom(p) {
      const W0 = +p.w, H0 = +p.h, nt = +p.notch, x0 = PAD, y0 = PAD, x1 = PAD + W0, y1 = PAD + H0;
      const d = nt ? `M${x0} ${y0}H${x1 - nt}L${x1} ${(y0 + y1) / 2}L${x1 - nt} ${y1}H${x0}Z` : `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
      return { w: W0 + 2 * PAD, h: H0 + 2 * PAD, parts: [{ d, kind: 'fill', color: p.fill === 'plate' ? 'plate' : 'accent', step: 0 }], label: { x: x0 + 24, y: (y0 + y1) / 2, anchor: 'start', size: Math.round(H0 * 0.42), plate: p.fill === 'plate' } };
    }
  },
  {
    id: 'progress', name: 'Progress bar', group: 'Badges', blurb: 'A segmented bar that fills in whole 12 px blocks to a percentage.',
    params: [{ key: 'w', label: 'Width', min: 100, max: 1100, step: 1, def: 520, unit: 'px' }, { key: 'h', label: 'Height', min: 10, max: 80, step: 1, def: 30, unit: 'px' }, { key: 'value', label: 'Value', min: 0, max: 100, step: 1, def: 72, unit: '%' }],
    label: true,
    geom(p) {
      const W0 = Math.round(+p.w), H0 = Math.round(+p.h), x0 = PAD, y0 = PAD + 44, inner = W0 - 6, segs = Math.round(((+p.value / 100) * (inner + 2)) / 12), parts: ShapePart[] = [
        { d: `M${x0 + 0.5} ${y0 + 0.5}h${W0 - 1}v${H0 - 1}h${-(W0 - 1)}Z`, kind: 'stroke', color: 'fg', width: 1, step: 0, join: 'miter' }
      ];
      let d = '';
      for (let i = 0; i < segs; i++) d += `M${x0 + 3 + i * 12} ${y0 + 3}h10v${H0 - 6}h-10Z`;
      if (d) parts.push({ d, kind: 'fill', color: 'accent', step: 1 });
      return { w: W0 + 2 * PAD, h: H0 + 44 + 2 * PAD, parts, label: { x: x0, y: PAD + 16, anchor: 'start', size: 22 } };
    }
  }
];
export const SHAPE: Record<string, ShapeDef> = Object.fromEntries(SHAPES.map(s => [s.id, s]));
export const SHAPE_GROUPS = ['Arrows', 'Lines', 'Callouts', 'Frames', 'Marks', 'Badges'] as const;

export const shapeDefaults = (s: ShapeDef): Record<string, string> => ({
  ...Object.fromEntries(s.params.map(q => [q.key, String(q.def)])),
  ...Object.fromEntries((s.options || []).map(o => [o.key, o.values[0][0]]))
});
