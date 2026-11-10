// ASCII / ordered-dither transitions: a full-frame overlay that covers or uncovers the picture with a
// grid of glyphs. Like every other graphic it is a pure function of time: `ditherFrame(ctx, w, h, s, spec)`
// draws the frame at progress s ∈ [0, 1] and nothing else decides what appears.
//
// Each cell gets a coverage c ∈ [0, 1] from the sweep (position + soft band + a little jitter), then an 8×8
// Bayer threshold turns c into a glyph tier. Tier 0 is empty (the picture shows through), the last tier is a
// solid cell, so s = 0 and s = 1 are exactly transparent / exactly opaque and the editor's cut can hide in them.

export type DitherStyle = 'left' | 'right' | 'up' | 'down' | 'diagonal' | 'radial' | 'inward' | 'noise';
/** in: clear → solid · out: solid → clear · inout: clear → solid → clear (cut on the solid middle). */
export type DitherMode = 'in' | 'out' | 'inout';
export type DitherRamp = 'ascii' | 'code' | 'binary' | 'bayer' | 'dots';

export interface DitherSpec {
  style: DitherStyle;
  mode: DitherMode;
  ramp: DitherRamp;
  /** Cell width in pixels on a 1920-wide frame; scales with the output size. */
  cell: number;
  dur: number;
  /** Glyph colour and solid colour (CSS). */
  fg: string;
  bg: string;
  /** Width of the dithered edge, as a fraction of the sweep (0.1 sharp … 1 very soft). */
  band: number;
  /** Time the solid middle is held in `inout`, as a fraction of the duration. */
  hold: number;
  /** Glyph shimmer in changes per second (0 = still). */
  flicker: number;
  seed: number;
}

export const STYLE_LABEL: Record<DitherStyle, string> = { left: 'Wipe right', right: 'Wipe left', up: 'Wipe up', down: 'Wipe down', diagonal: 'Diagonal', radial: 'From centre', inward: 'From edges', noise: 'Static' };
export const RAMP_LABEL: Record<DitherRamp, string> = { ascii: 'ASCII', code: 'Code', binary: 'Binary', bayer: 'Pixel dither', dots: 'Halftone' };
export const MODE_LABEL: Record<DitherMode, string> = { in: 'Cover', out: 'Reveal', inout: 'Cover + reveal' };

interface RampDef { kind: 'text' | 'bayer' | 'dots'; tiers: string[]; /** cell height / width */ aspect: number }
const RAMPS: Record<DitherRamp, RampDef> = {
  ascii: { kind: 'text', tiers: ['.', ':', '-+', '=*', '#%', '@'], aspect: 1.9 },
  code: { kind: 'text', tiers: ['.', '/', '\\/|', '{}[]', '<>$&', '#@%'], aspect: 1.9 },
  binary: { kind: 'text', tiers: ['0', '1', '01', '10', '01', '10'], aspect: 1.9 },
  bayer: { kind: 'bayer', tiers: ['', '', '', '', '', ''], aspect: 1 },
  dots: { kind: 'dots', tiers: ['', '', '', '', '', ''], aspect: 1 }
};

const BAYER8 = (() => {
  const m = [[0, 2], [3, 1]];
  let n = 2, cur = m;
  while (n < 8) {
    const next: number[][] = Array.from({ length: n * 2 }, () => new Array(n * 2).fill(0));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = cur[y][x] * 4;
      next[y][x] = v; next[y][x + n] = v + 2; next[y + n][x] = v + 3; next[y + n][x + n] = v + 1;
    }
    cur = next; n *= 2;
  }
  return cur.map(r => r.map(v => (v + 0.5) / 64));
})();

/** Deterministic hash → [0, 1). */
export const hash = (a: number, b: number, c = 0): number => {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Where a cell sits along the sweep, 0 = first to change, 1 = last. */
function position(style: DitherStyle, x: number, y: number, cols: number, rows: number, seed: number): number {
  const fx = cols > 1 ? x / (cols - 1) : 0, fy = rows > 1 ? y / (rows - 1) : 0;
  switch (style) {
    case 'left': return fx;
    case 'right': return 1 - fx;
    case 'down': return fy;
    case 'up': return 1 - fy;
    case 'diagonal': return (fx + fy) / 2;
    case 'radial': return clamp01(Math.hypot(fx - 0.5, (fy - 0.5) * (rows / cols) * 1.9) / 0.62);
    case 'inward': return 1 - clamp01(Math.hypot(fx - 0.5, (fy - 0.5) * (rows / cols) * 1.9) / 0.62);
    case 'noise': return hash(x, y, seed);
  }
}

/** Sweep progress for one direction of travel: 0..1 in → coverage of a cell at position u. */
const sweep = (s: number, u: number, band: number) => clamp01((s * (1 + band) - u) / band);

/** Coverage 0..1 for a cell at overall progress s. */
export function coverage(spec: Pick<DitherSpec, 'mode' | 'band' | 'hold'>, s: number, u: number): number {
  const b = Math.max(0.05, spec.band);
  if (spec.mode === 'in') return sweep(s, u, b);
  if (spec.mode === 'out') return 1 - sweep(s, u, b);
  const h = Math.min(0.5, Math.max(0, spec.hold)), a = (1 - h) / 2;
  if (s < a) return sweep(s / a, u, b);
  if (s < a + h) return 1;
  return 1 - sweep((s - a - h) / a, u, b);
}

export interface Grid { cw: number; ch: number; cols: number; rows: number }
export const gridFor = (spec: DitherSpec, w: number, h: number): Grid => {
  const cw = Math.max(3, Math.round(spec.cell * (w / 1920))), ch = Math.max(3, Math.round(cw * RAMPS[spec.ramp].aspect));
  return { cw, ch, cols: Math.ceil(w / cw), rows: Math.ceil(h / ch) };
};

/** Tier per cell: 0 = clear … tiers.length = solid. Row-major, cols × rows. */
export function ditherLevels(spec: DitherSpec, g: Grid, s: number, out?: Uint8Array): Uint8Array {
  const n = RAMPS[spec.ramp].tiers.length, lv = out && out.length === g.cols * g.rows ? out : new Uint8Array(g.cols * g.rows);
  const jit = 0.1;
  for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
    const u = position(spec.style, x, y, g.cols, g.rows, spec.seed) * (1 - jit) + hash(x, y, spec.seed + 7) * jit;
    const c = coverage(spec, s, u), k = Math.floor(c * n + BAYER8[y & 7][x & 7]);
    lv[y * g.cols + x] = k > n ? n : k;
  }
  return lv;
}

// ── drawing ──────────────────────────────────────────────────────────────

const MONO = "'JetBrains Mono Variable','JetBrains Mono',ui-monospace,Menlo,Consolas,monospace";
let fontsReady: Promise<unknown> | null = null;
/** Make sure the glyph font is loaded before the first frame is drawn. */
export const prepareDither = () => (fontsReady ??= typeof document === 'undefined' ? Promise.resolve() : Promise.all([document.fonts.load(`700 16px ${MONO}`), document.fonts.ready]).catch(() => {}));

interface Atlas { key: string; tiles: HTMLCanvasElement; variants: number[] }
let atlas: Atlas | null = null;

/** One strip per tier, every variant of every tier side by side. Rebuilt only when cell size, ramp or colour change. */
function atlasFor(spec: DitherSpec, g: Grid): Atlas {
  const ink = RAMPS[spec.ramp].kind === 'text' ? spec.fg : spec.bg, key = [spec.ramp, g.cw, g.ch, ink].join('|');
  if (atlas?.key === key) return atlas;
  const def = RAMPS[spec.ramp], n = def.tiers.length;
  const variants = def.tiers.map(t => (def.kind === 'text' ? [...t].length : 1));
  const total = variants.reduce((a, b) => a + b, 0);
  const cv = document.createElement('canvas');
  cv.width = g.cw * total; cv.height = g.ch;
  const c = cv.getContext('2d')!;
  c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.font = `700 ${Math.round(g.cw / 0.6)}px ${MONO}`;
  let x = 0;
  for (let i = 0; i < n; i++) {
    const frac = (i + 1) / (n + 1);
    for (let v = 0; v < variants[i]; v++, x += g.cw) {
      if (def.kind === 'text') {
        const ch = [...def.tiers[i]][v];
        c.fillText(ch, x + g.cw / 2, Math.round(g.ch * 0.74));
      } else if (def.kind === 'bayer') {
        // a 4×4 ordered-dither tile at this tier's density
        const px = g.cw / 4, py = g.ch / 4;
        for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) if (BAYER8[yy * 2][xx * 2] < frac) c.fillRect(Math.round(x + xx * px), Math.round(yy * py), Math.ceil(px), Math.ceil(py));
      } else {
        c.beginPath();
        c.arc(x + g.cw / 2, g.ch / 2, Math.max(0.5, (Math.min(g.cw, g.ch) / 2) * 1.05 * Math.sqrt(frac)), 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  return (atlas = { key, tiles: cv, variants });
}

let levelBuf: Uint8Array | undefined;

/** Draw one frame at progress s ∈ [0, 1] onto `ctx` (a w × h canvas). Clears it first. */
export function ditherFrame(ctx: CanvasRenderingContext2D, w: number, h: number, s: number, spec: DitherSpec): void {
  const g = gridFor(spec, w, h), def = RAMPS[spec.ramp], n = def.tiers.length;
  const lv = (levelBuf = ditherLevels(spec, g, s, levelBuf)), at = atlasFor(spec, g);
  const starts: number[] = []; let acc = 0;
  for (const v of at.variants) { starts.push(acc); acc += v; }
  const tick = spec.flicker > 0 ? Math.floor(s * spec.dur * spec.flicker) : 0;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = spec.bg;
  for (let y = 0; y < g.rows; y++) {
    const py = y * g.ch;
    let run = -1;
    for (let x = 0; x <= g.cols; x++) {
      const k = x < g.cols ? lv[y * g.cols + x] : 0;
      // solid cells are batched into one rect per run
      if (k === n) { if (run < 0) run = x; continue; }
      if (run >= 0) { ctx.fillRect(run * g.cw, py, (x - run) * g.cw, g.ch); run = -1; }
      if (k === 0) continue;
      const tier = k - 1, nv = at.variants[tier], v = nv > 1 ? Math.floor(hash(x, y, tick + spec.seed) * nv) : 0;
      if (def.kind === 'text') {
        ctx.globalAlpha = 0.9 * (k / n) ** 1.5;
        ctx.fillRect(x * g.cw, py, g.cw, g.ch);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(at.tiles, (starts[tier] + v) * g.cw, 0, g.cw, g.ch, x * g.cw, py, g.cw, g.ch);
    }
  }
  ctx.globalAlpha = 1;
}

export interface DitherRasterOpts { width: number; height: number; fps: number }
export const ditherFrames = (spec: DitherSpec, fps: number) => Math.max(2, Math.round(spec.dur * fps));

/** Render every frame of a transition. First frame is s = 0, last is s = 1. */
export async function ditherRaster(spec: DitherSpec, o: DitherRasterOpts, onFrame: (canvas: HTMLCanvasElement, i: number, n: number) => Promise<void> | void, signal?: AbortSignal) {
  await prepareDither();
  const canvas = document.createElement('canvas');
  canvas.width = o.width; canvas.height = o.height;
  const ctx = canvas.getContext('2d')!, n = ditherFrames(spec, o.fps);
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    ditherFrame(ctx, o.width, o.height, i / (n - 1), spec);
    await onFrame(canvas, i, n);
  }
}

// ── presets ──────────────────────────────────────────────────────────────

const base: DitherSpec = { style: 'left', mode: 'inout', ramp: 'ascii', cell: 14, dur: 1.2, fg: '#FFFFFF', bg: '#0B0B0D', band: 0.45, hold: 0.12, flicker: 10, seed: 1 };
export interface DitherPreset { id: string; name: string; note: string; spec: DitherSpec }
export const DITHER_PRESETS: DitherPreset[] = [
  { id: 'ascii-sweep', name: 'ASCII sweep', note: 'Glyphs wash across and clear behind', spec: base },
  { id: 'terminal', name: 'Terminal green', note: 'Green phosphor on black', spec: { ...base, ramp: 'code', fg: '#3DFF7A', bg: '#04100A', style: 'down', cell: 12, band: 0.6 } },
  { id: 'pixel-dissolve', name: 'Pixel dissolve', note: 'Ordered-dither fade, no glyphs', spec: { ...base, ramp: 'bayer', style: 'noise', cell: 10, band: 0.5, flicker: 0, dur: 1 } },
  { id: 'halftone-bloom', name: 'Halftone bloom', note: 'Dots swell out from the centre', spec: { ...base, ramp: 'dots', style: 'radial', cell: 20, fg: '#FFFFFF', bg: '#1E68F0', band: 0.55, flicker: 0, dur: 1.1 } },
  { id: 'binary-rain', name: 'Binary rain', note: '0s and 1s fall and fill', spec: { ...base, ramp: 'binary', style: 'down', fg: '#9FD0FF', bg: '#08111F', cell: 16, band: 0.8, flicker: 14, dur: 1.4 } },
  { id: 'iris-close', name: 'Iris close', note: 'Closes in from the edges', spec: { ...base, style: 'inward', mode: 'in', cell: 16, band: 0.4, dur: 0.9 } },
  { id: 'static', name: 'Static', note: 'Glyph noise cuts in and out', spec: { ...base, style: 'noise', flicker: 24, band: 0.35, cell: 12, dur: 0.8 } },
  { id: 'diagonal-reveal', name: 'Diagonal reveal', note: 'Solid screen peels away', spec: { ...base, style: 'diagonal', mode: 'out', cell: 14, dur: 1 } }
];
