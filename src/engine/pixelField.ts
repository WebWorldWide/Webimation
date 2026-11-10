// Pixel-field transitions: a hard-edged shape sweeps the frame; behind the edge the picture is covered by a
// noise-dithered two-tone fill with a bright rim, ahead of it a stipple halo of single pixels thins out.
// Everything is drawn on a coarse block grid (chunky pixels) and scaled up without smoothing.
// Like every other graphic it is a pure function of time: `fieldFrame(ctx, w, h, s, spec)` and nothing else.
// Covered pixels are fully opaque and everything else is transparent or a lone stipple pixel, so the
// ProRes / PNG export keeps a true alpha channel and s = 0 / s = 1 are exactly clear / exactly covered.
import { hash } from './dither';

export type FieldShape = 'tide' | 'eclipse' | 'aperture' | 'blade' | 'rise';
export type FieldPalette = 'orchid' | 'ember' | 'glacier' | 'toxic' | 'paper';
export type FieldMode = 'in' | 'out' | 'inout';

export interface FieldSpec {
  shape: FieldShape;
  mode: FieldMode;
  palette: FieldPalette;
  /** Block size in px on a 1920-wide frame. */
  block: number;
  dur: number;
  /** Stipple halo reach, fraction of the frame diagonal. */
  halo: number;
  /** Stipple density 0..1. */
  grain: number;
  /** Fraction of the duration the frame stays fully covered in `inout`. */
  hold: number;
  /** How much the edge wobbles, 0..1. */
  wobble: number;
  seed: number;
}

export const SHAPE_LABEL: Record<FieldShape, string> = { tide: 'Tide', eclipse: 'Eclipse', aperture: 'Aperture', blade: 'Blade', rise: 'Rise' };
export const PALETTE_LABEL: Record<FieldPalette, string> = { orchid: 'Orchid', ember: 'Ember', glacier: 'Glacier', toxic: 'Toxic', paper: 'Paper' };

interface Pal { deep: string; mid: string; rim: string; speck: string }
export const PALETTES: Record<FieldPalette, Pal> = {
  orchid: { deep: '#3A0B2E', mid: '#E4569F', rim: '#8EA2FF', speck: '#FFFFFF' },
  ember: { deep: '#2B0A06', mid: '#FF6A2B', rim: '#FFD36B', speck: '#FFF1D6' },
  glacier: { deep: '#06203A', mid: '#2FA8E8', rim: '#C8F4FF', speck: '#FFFFFF' },
  toxic: { deep: '#06210F', mid: '#37E27A', rim: '#E3FF6B', speck: '#F2FFD9' },
  paper: { deep: '#C9C2B2', mid: '#F2EEE3', rim: '#111111', speck: '#111111' }
};

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** How far the edge has travelled, 0 = nothing covered, 1 = everything covered. */
export function reach(spec: Pick<FieldSpec, 'mode' | 'hold'>, s: number): number {
  const e = (t: number) => smooth(clamp01(t)) * 0.35 + clamp01(t) * 0.65; // gentle ease, still reads as a sweep
  if (spec.mode === 'in') return e(s);
  if (spec.mode === 'out') return 1 - e(s);
  const h = Math.min(0.5, Math.max(0, spec.hold)), a = (1 - h) / 2;
  if (s < a) return e(s / a);
  if (s < a + h) return 1;
  return 1 - e((s - a - h) / a);
}

/**
 * Signed distance (in block units, negative = covered) from block (x, y) to the edge, for reach r.
 * Shapes are fully covered at r = 1 and fully clear (beyond the halo) at r = 0.
 */
export function edgeDistance(shape: FieldShape, x: number, y: number, cols: number, rows: number, r: number, wob: number, seed: number): number {
  const diag = Math.hypot(cols, rows), w = wob * diag * 0.012 * Math.sin(y * 0.09 + seed) + wob * diag * 0.008 * Math.sin(x * 0.047 + seed * 1.7);
  const reachPx = diag * 1.12; // enough for every corner plus halo
  switch (shape) {
    case 'tide': { // a huge arc rising from the bottom-right corner
      const cx = cols * 1.05, cy = rows * 1.25, R = -diag * 0.12 + r * (Math.hypot(cx, cy) + diag * 0.2);
      return Math.hypot(x - cx, y - cy) - R + w;
    }
    case 'eclipse': { // a disc growing from the centre
      const R = -diag * 0.12 + r * reachPx * 0.62;
      return Math.hypot(x - cols / 2, (y - rows / 2) * 1.0) - R + w;
    }
    case 'aperture': { // closes in from the frame edges: covered = outside a shrinking disc
      const R = (1 - r) * reachPx * 0.62 - diag * 0.12 * r;
      return R - Math.hypot(x - cols / 2, y - rows / 2) + w;
    }
    case 'blade': { // a straight diagonal edge, 30° off vertical
      const nx = Math.cos(0.52), ny = Math.sin(0.52), proj = x * nx + y * ny, max = cols * nx + rows * ny;
      return proj - (-diag * 0.12 + r * (max + diag * 0.24)) + w;
    }
    case 'rise': // flat horizon climbing from the bottom; covered below it
      return rows * (1 - r) + diag * 0.12 * (1 - 2 * r) - y + w * 0.6;
  }
}

export interface FieldGrid { bs: number; cols: number; rows: number }
export const fieldGrid = (spec: FieldSpec, w: number, h: number): FieldGrid => {
  const bs = Math.max(1, Math.round(spec.block * (w / 1920)));
  return { bs, cols: Math.ceil(w / bs), rows: Math.ceil(h / bs) };
};
export const fieldFrames = (spec: FieldSpec, fps: number) => Math.max(2, Math.round(spec.dur * fps));

/** Colour class of a block: 0 clear, 1 stipple, 2 rim, 3 mid, 4 deep. Pure; used by the renderer and the tests. */
export function classify(spec: FieldSpec, g: FieldGrid, x: number, y: number, s: number, tick: number): number {
  const r = reach(spec, s), d = edgeDistance(spec.shape, x, y, g.cols, g.rows, r, spec.wobble, spec.seed);
  const diag = Math.hypot(g.cols, g.rows), halo = Math.max(2, spec.halo * diag), rim = Math.max(1.5, diag * 0.012);
  if (r >= 1) return 4 - (hash(x, y, spec.seed) < 0.5 ? 1 : 0); // fully covered: no edge anywhere
  if (d >= 0) {
    if (d > halo || r <= 0) return 0;
    const u = d / halo, p = spec.grain * (1 - u) ** 2.2;
    return hash(x, y, spec.seed + 31 * tick) < p ? 1 : 0;
  }
  const depth = -d;
  if (depth < rim) return hash(x, y, spec.seed + 5) < 0.9 ? 2 : 3;
  const t = clamp01((depth - rim) / (diag * 0.28)), pMid = 1 - 0.78 * t ** 0.7;
  return hash(x, y, spec.seed + 11) < pMid ? 3 : 4;
}

let small: HTMLCanvasElement | null = null;

/** Draw one frame at progress s ∈ [0, 1] onto `ctx` (w × h). Clears it first. */
export function fieldFrame(ctx: CanvasRenderingContext2D, w: number, h: number, s: number, spec: FieldSpec): void {
  const g = fieldGrid(spec, w, h), pal = PALETTES[spec.palette];
  const cols = [[0, 0, 0], rgb(pal.speck), rgb(pal.rim), rgb(pal.mid), rgb(pal.deep)];
  if (!small) small = document.createElement('canvas');
  if (small.width !== g.cols || small.height !== g.rows) { small.width = g.cols; small.height = g.rows; }
  const sc = small.getContext('2d')!, img = sc.createImageData(g.cols, g.rows), d = img.data;
  const tick = Math.floor(s * spec.dur * 12);
  for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
    const k = classify(spec, g, x, y, s, tick);
    if (!k) continue;
    const i = (y * g.cols + x) * 4, c = cols[k];
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  sc.putImageData(img, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, g.cols, g.rows, 0, 0, g.cols * g.bs, g.rows * g.bs);
}

export async function fieldRaster(spec: FieldSpec, o: { width: number; height: number; fps: number }, onFrame: (canvas: HTMLCanvasElement, i: number, n: number) => Promise<void> | void, signal?: AbortSignal) {
  const canvas = document.createElement('canvas');
  canvas.width = o.width; canvas.height = o.height;
  const ctx = canvas.getContext('2d')!, n = fieldFrames(spec, o.fps);
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    fieldFrame(ctx, o.width, o.height, i / (n - 1), spec);
    await onFrame(canvas, i, n);
  }
}

const base: FieldSpec = { shape: 'tide', mode: 'inout', palette: 'orchid', block: 5, dur: 1.4, halo: 0.16, grain: 0.1, hold: 0.1, wobble: 0.15, seed: 3 };
export interface FieldPreset { id: string; name: string; note: string; spec: FieldSpec }
export const FIELD_PRESETS: FieldPreset[] = [
  { id: 'tide', name: 'Tide', note: 'A dithered limb rises from the corner', spec: base },
  { id: 'eclipse', name: 'Eclipse', note: 'A disc blooms from the centre', spec: { ...base, shape: 'eclipse', palette: 'ember', seed: 8 } },
  { id: 'aperture', name: 'Aperture', note: 'Closes in from every edge', spec: { ...base, shape: 'aperture', palette: 'glacier', mode: 'in', dur: 1.1, seed: 5 } },
  { id: 'blade', name: 'Blade', note: 'A hard diagonal cut with a stipple wake', spec: { ...base, shape: 'blade', palette: 'toxic', block: 4, grain: 0.14, dur: 1.0, seed: 12 } },
  { id: 'rise', name: 'Rise', note: 'A horizon lifts and clears', spec: { ...base, shape: 'rise', palette: 'paper', wobble: 0.45, seed: 21 } },
  { id: 'tide-out', name: 'Tide reveal', note: 'Solid screen peels away', spec: { ...base, mode: 'out', palette: 'orchid', dur: 1.2, seed: 17 } }
];
