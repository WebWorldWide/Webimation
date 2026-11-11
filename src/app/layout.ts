// Scene helpers that don't need the engine: start cues, timing, snapping, 9-spot placement,
// "Animate everything" and "Restyle everything".
import { bounds } from './engine';
import { IN, ON, OUT, type Obj, type Scene } from './types';

/** Resolve "at the beginning / with previous / after previous" into start times, in order. */
export function resolveCues(s: Scene): Scene {
  const objs = [...s.objects].sort((a, b) => a.order - b.order);
  let prevStart = 0, prevEnterEnd = 0;
  const starts = new Map<string, number>();
  for (const o of objs) {
    const base = o.cue === 'with' ? prevStart : o.cue === 'after' ? prevEnterEnd : o.cue === 'start' ? 0 : o.start;
    const start = Math.max(0, +(base + (o.cue === 'start' || o.cue === 'with' || o.cue === 'after' ? o.gap : 0)).toFixed(3));
    starts.set(o.id, start);
    prevStart = start;
    prevEnterEnd = start + o.enter.delay + (o.enter.id === 'none' ? 0 : o.enter.dur);
  }
  return { ...s, objects: s.objects.map(o => (o.cue === 'start' || o.cue === 'with' || o.cue === 'after' ? { ...o, start: starts.get(o.id)! } : o)) };
}

/** Whole animation length: when the last thing has finished coming in, plus a hold. */
export const sceneEnd = (s: Scene) => Math.max(1, ...s.objects.map(o => (o.dur > 0 ? o.start + o.dur : o.start + o.enter.dur + 1)));

export const snap = (s: Scene, v: number) => { const c = s.w / Math.max(8, s.grid); return Math.round(v / c) * c; };

export type Anchor = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';
export const ANCHORS: Anchor[] = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
/** Title-safe area: 5% of width, 6.7% of height (keeps words off phone and TV edges). */
export const safe = (s: Scene) => ({ x0: Math.round(s.w * 0.05), y0: Math.round(s.h * 0.067), x1: Math.round(s.w * 0.95), y1: Math.round(s.h * 0.933) });

/** Move objects so their visible box sits on an anchor of the safe area. */
export async function place(s: Scene, ids: string[], a: Anchor): Promise<Scene> {
  const b = await bounds(s);
  const sel = s.objects.filter(o => ids.includes(o.id) && b[o.id]);
  if (!sel.length) return s;
  const box = sel.reduce((acc, o) => { const r = b[o.id]; return [Math.min(acc[0], r[0]), Math.min(acc[1], r[1]), Math.max(acc[2], r[2]), Math.max(acc[3], r[3])]; }, [Infinity, Infinity, -Infinity, -Infinity]);
  const sa = safe(s), fx = { l: 0, c: 0.5, r: 1 }[a[1] as 'l' | 'c' | 'r'], fy = { t: 0, m: 0.5, b: 1 }[a[0] as 't' | 'm' | 'b'];
  const dx = Math.round(sa.x0 + (sa.x1 - sa.x0 - (box[2] - box[0])) * fx - box[0]);
  const dy = Math.round(sa.y0 + (sa.y1 - sa.y0 - (box[3] - box[1])) * fy - box[1]);
  return { ...s, objects: s.objects.map(o => (ids.includes(o.id) ? { ...o, x: o.x + dx, y: o.y + dy } : o)) };
}

/** Which anchor a box is nearest to (for showing the current spot in the 9-grid). */
export function anchorOf(s: Scene, box: [number, number, number, number]): Anchor {
  const cx = (box[0] + box[2]) / 2 / s.w, cy = (box[1] + box[3]) / 2 / s.h;
  return `${cy < 0.36 ? 't' : cy > 0.64 ? 'b' : 'm'}${cx < 0.36 ? 'l' : cx > 0.64 ? 'r' : 'c'}` as Anchor;
}

export type Style = 'pixel' | 'glyph' | 'clean';
const PLAN: Record<Style, { in: string[]; on: string[]; out: string[]; fps: number }> = {
  pixel: { in: ['blocky-wipe', 'drop-bounce', 'typewriter', 'pop', 'rain-in'], on: ['bob', 'sway', 'float', 'pulse', 'shadow-lift'], out: ['dither-out', 'blocky-wipe', 'shrink'], fps: 12 },
  glyph: { in: ['decode', 'rain-in', 'scan-in', 'dither-in', 'type-on'], on: ['shimmer', 'row-glitch', 'wave-rows', 'none'], out: ['glyph-scatter', 'melt', 'dither-out', 'type-off'], fps: 30 },
  clean: { in: ['wipe', 'rise', 'slide', 'pop', 'letter-cascade'], on: ['none', 'breathe', 'hover'], out: ['wipe', 'rise-out', 'slide'], fps: 30 }
};
/** Give every object a sensible entrance, middle and exit, and an order (big things first). */
export function animateEverything(s: Scene, style: Style): Scene {
  const p = PLAN[style];
  const objs = [...s.objects].sort((a, b) => a.order - b.order);
  const out = objs.map((o, i): Obj => {
    const bg = o.kind.type === 'field' && o.kind.w >= s.w * 0.9;
    const textish = ['text', 'pixel-text', 'ascii-banner', 'card'].includes(o.kind.type);
    const enter = bg ? 'dither-in' : textish ? p.in[i % p.in.length] : o.kind.type === 'shape' ? (style === 'clean' ? 'draw-on' : 'pop') : p.in[(i + 3) % p.in.length];
    const on = bg ? 'none' : o.kind.type === 'sprite' ? (o.on.id === 'drift-across' ? 'drift-across' : p.on[i % p.on.length]) : textish ? p.on[(i + 1) % p.on.length] : p.on[i % p.on.length];
    return { ...o, order: i, cue: i === 0 ? 'start' : bg ? 'start' : 'with', gap: i === 0 || bg ? 0 : 0.3, enter: IN(enter, { dur: enter.includes('rain') || enter === 'decode' ? 0.9 : 0.55, dir: o.enter.dir }), on: ON(on), exit: OUT(i % 2 ? p.out[1] : p.out[0], { dir: o.exit.dir }) };
  });
  return resolveCues({ ...s, fps: p.fps, objects: out });
}

const FONT: Record<Style, { text: string; mono: string }> = { pixel: { text: 'press-start', mono: 'vt323' }, glyph: { text: 'jetbrains-mono', mono: 'jetbrains-mono' }, clean: { text: 'archivo', mono: 'archivo' } };
/** Switch fonts, background, grid and motion feel in one go. */
export function restyle(s: Scene, style: Style): Scene {
  const f = FONT[style];
  const objects = s.objects.map(o => {
    const k = o.kind;
    if (k.type === 'text') return { ...o, kind: { ...k, style: { ...k.style, font: k.style.size > 90 && style === 'clean' ? 'archivo-black' : f.text } } };
    if (k.type === 'card') return { ...o, kind: { ...k, look: style === 'pixel' ? 'retro' : style === 'glyph' ? 'loud' : 'clean' } };
    if (k.type === 'ascii' || k.type === 'ascii-banner') return { ...o, kind: { ...k, font: f.mono } };
    if (k.type === 'sprite' || k.type === 'pixel-text') return { ...o, as_ascii: style === 'glyph', ascii_font: 'jetbrains-mono' };
    return o;
  });
  const bg = style === 'pixel' ? { kind: 'sky', color: '#1E68F0', color2: '#1450C8' } : style === 'glyph' ? { kind: 'solid', color: '#07070C', color2: '#07070C' } : s.bg;
  return { ...s, fps: PLAN[style].fps, grid: style === 'pixel' ? 128 : style === 'glyph' ? 256 : s.grid, bg, objects };
}
