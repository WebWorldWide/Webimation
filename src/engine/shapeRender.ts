// Renders a shape clip and animates it as a pure function of time.
//   strokes  draw along their length (quart-out), in step order; dashed strokes draw through a mask
//   fills    wipe on with a hard edge along the shape's direction
//   heads    cut on the frame their stroke arrives
//   label    is an ordinary reveal element, so it uses the clip's motion preset
// Exit (last 0.35 s): strokes retract from their start toward the tip, fills wipe off the same way,
// heads cut away as the line reaches them.
import { E, prog } from './easing';
import { SHAPE, shapeDefaults, type ShapeDef, type ShapePart } from './shapes';
import { R } from './templates';
import { esc, NUM, SANS, STAGE_H, STAGE_W } from './tokens';

const FRAME = 1 / 30, EXIT = 0.35;
let uid = 0;

export const shapeOf = (P: Record<string, string>): ShapeDef => SHAPE[P.shape] || SHAPE.arrow;
/** Shape params live in props as `p.<key>`; options too. */
export const shapeParams = (P: Record<string, string>) => {
  const def = shapeOf(P), d = shapeDefaults(def), out: Record<string, string | number> = {};
  for (const q of def.params) { const v = parseFloat(P['p.' + q.key]); out[q.key] = isFinite(v) ? Math.min(q.max, Math.max(q.min, v)) : +d[q.key]; }
  for (const o of def.options || []) out[o.key] = o.values.some(v => v[0] === P['p.' + o.key]) ? P['p.' + o.key] : d[o.key];
  return out;
};

const colorVar = (c: ShapePart['color'], a: string) => (c === 'accent' ? a : `var(--w-${c})`);

/** Wipe direction for fills, from the shape's angle when it has one. */
const fillDir = (p: Record<string, string | number>) => {
  const a = ((((+p.angle || 0) % 360) + 360) % 360);
  return a < 45 || a >= 315 ? 'right' : a < 135 ? 'down' : a < 225 ? 'left' : 'up';
};

export function shapeHtml(P: Record<string, string>, a: string, ai: string): string {
  const def = shapeOf(P), p = shapeParams(P), g = def.geom(p), id = `shp${++uid}`;
  const full = def.id === 'spotlight';
  const cx = full ? STAGE_W / 2 : parseFloat(P.sx) || STAGE_W / 2, cy = full ? STAGE_H / 2 : parseFloat(P.sy) || STAGE_H / 2;
  // Whole-pixel origin so every crisp coordinate inside the SVG lands on the device grid.
  const left = Math.round(cx - g.w / 2), top = Math.round(cy - g.h / 2);
  const defs: string[] = [], body: string[] = [];
  g.parts.forEach((pt, i) => {
    const col = colorVar(pt.color, a), attrs = `data-sp="${pt.kind}|${pt.step}" data-i="${i}"`;
    if (pt.kind === 'fill' || (pt.kind === 'head' && !pt.width)) {
      const op = def.id === 'spotlight' ? ` fill-opacity="${p.dim}"` : '';
      body.push(`<g ${attrs} clip-path="url(#${id}c${i})"><path d="${pt.d}" style="fill:${col}"${op} fill-rule="evenodd"></path></g>`);
      defs.push(`<clipPath id="${id}c${i}" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="0" height="0"></rect></clipPath>`);
      return;
    }
    const sw = `stroke-width="${pt.width ?? 4}" stroke-linecap="${pt.cap ?? 'butt'}" stroke-linejoin="${pt.join ?? 'miter'}" stroke-miterlimit="10"`;
    if (pt.dash) {
      defs.push(`<mask id="${id}m${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${g.w}" height="${g.h}"><path data-mask d="${pt.d}" pathLength="1" fill="none" stroke="#fff" stroke-width="${(pt.width ?? 4) + 6}" stroke-linecap="square" stroke-linejoin="miter" stroke-dasharray="1 1" stroke-dashoffset="1"></path></mask>`);
      body.push(`<g ${attrs} mask="url(#${id}m${i})"><path d="${pt.d}" fill="none" style="stroke:${col}" ${sw} stroke-dasharray="${pt.dash}"></path></g>`);
    } else body.push(`<path ${attrs} d="${pt.d}" pathLength="1" fill="none" style="stroke:${col}" ${sw} stroke-dasharray="1 1" stroke-dashoffset="1"></path>`);
  });
  let label = '';
  if (def.label && g.label && (P.label ?? '').trim()) {
    const L = g.label, onPlate = L.plate, isTag = def.id === 'tag' && P['p.fill'] !== 'plate';
    const color = isTag ? ai : onPlate ? 'var(--w-plate-fg)' : def.id === 'number' ? ai : 'var(--w-fg)';
    const font = def.id === 'number' ? `${NUM}` : `${SANS}font-weight:600;`;
    const just = L.anchor === 'start' ? 'flex-start' : L.anchor === 'end' ? 'flex-end' : 'center';
    // Zero-size flex anchor: the label is aligned by layout (no fractional transforms on text).
    const plateCss = def.id === 'leaderline' ? 'background:var(--w-plate);color:var(--w-plate-fg);padding:8px 14px;' : '';
    label = `<div style="position:absolute;left:${left + L.x}px;top:${top + L.y}px;width:0;height:0;display:flex;align-items:center;justify-content:${just};white-space:nowrap">
      ${R(0, 0.45, esc(P.label), { w: 'flex:none', i: `${font}font-size:${Math.round(L.size)}px;line-height:1.1;color:${color};${plateCss}` })}</div>`;
  }
  return `<svg data-box data-shape="${def.id}" data-dir="${fillDir(p)}" width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}" style="position:absolute;left:${left}px;top:${top}px;overflow:visible" shape-rendering="geometricPrecision"><defs>${defs.join('')}</defs>${body.join('')}</svg>${label}`;
}

/** Cue for the label reveal, after the shape's last step lands. Read by the stage via data-r rewrite. */
export function shapeUpdate(layer: HTMLElement, clip: { dur: number }) {
  const svg = layer.querySelector<SVGSVGElement>('svg[data-shape]');
  if (!svg) return () => {};
  const D = clip.dur, xs = D - FRAME - EXIT, dir = svg.dataset.dir || 'right';
  const els = [...svg.querySelectorAll<SVGElement>('[data-sp]')].map(el => {
    const [kind, step] = el.dataset.sp!.split('|');
    const path = (el.tagName === 'path' ? el : el.querySelector('path')) as SVGPathElement;
    const mask = el.getAttribute('mask') ? svg.querySelector<SVGPathElement>(`${el.getAttribute('mask')!.slice(4, -1)} [data-mask]`) : null;
    const clipRect = el.getAttribute('clip-path') ? svg.querySelector<SVGRectElement>(`${el.getAttribute('clip-path')!.slice(4, -1)} rect`) : null;
    let len = 0, bb = { x: 0, y: 0, width: 0, height: 0 };
    try { len = path.getTotalLength(); bb = path.getBBox(); } catch { /* not rendered (tests) */ }
    return { el, kind, step: +step, path, mask, clipRect, len, bb };
  });
  // Step timing: each step draws for a time that grows with stroke length, overlapping the next a little.
  const steps = [...new Set(els.map(e => e.step))].sort((x, y) => x - y), start: Record<number, number> = {}, dur: Record<number, number> = {};
  let at = 0.08;
  for (const s of steps) {
    const L = Math.max(0, ...els.filter(e => e.step === s && e.kind === 'stroke').map(e => e.len));
    const has = els.some(e => e.step === s && e.kind !== 'head');
    dur[s] = has ? Math.min(1.1, 0.4 + L / 1400) : 0;
    start[s] = at;
    at += dur[s] * 0.82;
  }
  const end = at;
  // The label lands as the shape finishes.
  layer.querySelectorAll<HTMLElement>('[data-r]').forEach(r => { r.dataset.r = `${end.toFixed(3)},${r.dataset.r!.split(',')[1]}`; });
  const wipe = (r: SVGRectElement, bb: typeof els[0]['bb'], a: number, b: number) => {
    const x0 = bb.x - 2, y0 = bb.y - 2, w = bb.width + 4, h = bb.height + 4;
    const set = (x: number, y: number, ww: number, hh: number) => { r.setAttribute('x', x.toFixed(3)); r.setAttribute('y', y.toFixed(3)); r.setAttribute('width', Math.max(0, ww).toFixed(3)); r.setAttribute('height', Math.max(0, hh).toFixed(3)); };
    if (dir === 'right') set(x0 + w * b, y0, w * (a - b), h);
    else if (dir === 'left') set(x0 + w * (1 - a), y0, w * (a - b), h);
    else if (dir === 'down') set(x0, y0 + h * b, w, h * (a - b));
    else set(x0, y0 + h * (1 - a), w, h * (a - b));
  };
  return (t: number) => {
    const x = prog(t, xs, EXIT), ex = E.in(x);
    for (const e of els) {
      const s = start[e.step], d = dur[e.step];
      if (e.kind === 'stroke') {
        const k = E.out(prog(t, s, d)), off = x > 0 ? (-ex).toFixed(5) : (1 - k).toFixed(5);
        (e.mask || e.path).style.strokeDashoffset = off;
        e.el.style.visibility = t >= s && x < 1 ? '' : 'hidden';
      } else if (e.kind === 'head' && !e.clipRect) {
        e.el.style.visibility = t >= s && ex < 0.85 ? '' : 'hidden';
      } else if (e.clipRect) {
        if (e.kind === 'head') { const on = t >= s && ex < 0.85; wipe(e.clipRect, e.bb, on ? 1 : 0, 0); continue; }
        wipe(e.clipRect, e.bb, E.out(prog(t, s, Math.max(0.3, d))), ex);
      }
    }
  };
}
