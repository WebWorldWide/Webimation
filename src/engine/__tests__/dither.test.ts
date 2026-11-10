import { describe, expect, it } from 'vitest';
import { coverage, DITHER_PRESETS, ditherFrames, ditherLevels, gridFor, hash, type DitherSpec } from '../dither';

const spec = (o: Partial<DitherSpec> = {}): DitherSpec => ({ ...DITHER_PRESETS[0].spec, ...o });
const g = (s: DitherSpec) => gridFor(s, 1920, 1080);
const count = (lv: Uint8Array, f: (k: number) => boolean) => lv.reduce((a, k) => a + (f(k) ? 1 : 0), 0);

describe('dither transitions', () => {
  it('is exactly clear at s=0 and exactly solid at s=1 for every preset and style', () => {
    for (const p of DITHER_PRESETS) for (const st of ['left', 'right', 'up', 'down', 'diagonal', 'radial', 'inward', 'noise'] as const) {
      const s = spec({ ...p.spec, style: st, mode: 'in' }), gr = g(s);
      const n = ditherLevels(s, gr, 1).reduce((a, k) => Math.max(a, k), 0);
      expect(count(ditherLevels(s, gr, 0), k => k !== 0), `${p.id}/${st} start`).toBe(0);
      expect(count(ditherLevels(s, gr, 1), k => k !== n), `${p.id}/${st} end`).toBe(0);
    }
  });
  it('inout starts and ends clear with a fully solid hold in the middle', () => {
    const s = spec({ mode: 'inout', hold: 0.2 }), gr = g(s), all = gr.cols * gr.rows;
    expect(count(ditherLevels(s, gr, 0), k => k !== 0)).toBe(0);
    expect(count(ditherLevels(s, gr, 1), k => k !== 0)).toBe(0);
    const mid = ditherLevels(s, gr, 0.5);
    expect(count(mid, k => k === 6)).toBe(all);
  });
  it('out is the mirror of in', () => {
    const s = spec({ mode: 'out' }), gr = g(s);
    expect(count(ditherLevels(s, gr, 0), k => k === 6)).toBe(gr.cols * gr.rows);
    expect(count(ditherLevels(s, gr, 1), k => k !== 0)).toBe(0);
  });
  it('coverage grows monotonically with progress and the sweep leads from the chosen side', () => {
    const m = { mode: 'in' as const, band: 0.4, hold: 0 };
    let prev = -1;
    for (let s = 0; s <= 1.0001; s += 0.05) { const c = coverage(m, s, 0.5); expect(c).toBeGreaterThanOrEqual(prev); prev = c; }
    const s = spec({ style: 'left', mode: 'in', band: 0.3 }), gr = g(s), lv = ditherLevels(s, gr, 0.4);
    const col = (x: number) => { let t = 0; for (let y = 0; y < gr.rows; y++) t += lv[y * gr.cols + x]; return t; };
    expect(col(2)).toBeGreaterThan(col(gr.cols - 3));
  });
  it('is deterministic: same time gives the same cells, regardless of earlier frames', () => {
    const s = spec({ style: 'noise' }), gr = g(s);
    const a = ditherLevels(s, gr, 0.37).slice();
    ditherLevels(s, gr, 0.9); ditherLevels(s, gr, 0.1);
    expect([...ditherLevels(s, gr, 0.37)]).toEqual([...a]);
    expect(hash(3, 4, 5)).toBe(hash(3, 4, 5));
  });
  it('scales the grid with output size and counts frames', () => {
    expect(gridFor(spec({ cell: 16 }), 3840, 2160).cw).toBe(32);
    expect(ditherFrames(spec({ dur: 1.2 }), 30)).toBe(36);
  });
});
