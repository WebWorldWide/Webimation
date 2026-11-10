import { describe, expect, it } from 'vitest';
import { classify, FIELD_PRESETS, fieldFrames, fieldGrid, reach, type FieldShape, type FieldSpec } from '../pixelField';

const SHAPES: FieldShape[] = ['tide', 'eclipse', 'aperture', 'blade', 'rise'];
const hist = (spec: FieldSpec, s: number) => {
  const g = fieldGrid(spec, 1280, 720), h = [0, 0, 0, 0, 0];
  for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) h[classify(spec, g, x, y, s, 0)]++;
  return { h, all: g.cols * g.rows };
};

describe('pixel-field transitions', () => {
  it('is fully clear at s=0 and fully covered at s=1 for every shape and palette', () => {
    for (const p of FIELD_PRESETS) for (const shape of SHAPES) {
      const spec = { ...p.spec, shape, mode: 'in' as const }, a = hist(spec, 0), b = hist(spec, 1);
      expect(a.h[0], `${p.id}/${shape} start`).toBe(a.all);
      expect(b.h[0] + b.h[1] + b.h[2], `${p.id}/${shape} end`).toBe(0);
    }
  });
  it('inout is clear at both ends and fully covered through the hold', () => {
    const spec = { ...FIELD_PRESETS[0].spec, mode: 'inout' as const, hold: 0.2 };
    expect(hist(spec, 0).h[0]).toBe(hist(spec, 0).all);
    expect(hist(spec, 1).h[0]).toBe(hist(spec, 1).all);
    const mid = hist(spec, 0.5);
    expect(mid.h[0] + mid.h[1] + mid.h[2]).toBe(0);
  });
  it('coverage never shrinks as an "in" transition advances', () => {
    for (const shape of SHAPES) {
      const spec = { ...FIELD_PRESETS[0].spec, shape, mode: 'in' as const };
      let prev = -1;
      for (let s = 0; s <= 1.0001; s += 0.1) { const { h } = hist(spec, Math.min(1, s)), covered = h[2] + h[3] + h[4]; expect(covered, `${shape}@${s.toFixed(1)}`).toBeGreaterThanOrEqual(prev - 2); prev = covered; }
    }
  });
  it('is a pure function of time', () => {
    const spec = FIELD_PRESETS[1].spec, g = fieldGrid(spec, 1280, 720), at = () => Array.from({ length: 400 }, (_, i) => classify(spec, g, i % 97, (i * 7) % 83, 0.41, 3));
    const a = at(); classify(spec, g, 5, 5, 0.9, 1); expect(at()).toEqual(a);
  });
  it('reach is monotone for in, and mirrors for out', () => {
    expect(reach({ mode: 'in', hold: 0 }, 0)).toBe(0);
    expect(reach({ mode: 'in', hold: 0 }, 1)).toBeCloseTo(1);
    expect(reach({ mode: 'out', hold: 0 }, 0)).toBeCloseTo(1);
    expect(fieldFrames({ ...FIELD_PRESETS[0].spec, dur: 1.4 }, 30)).toBe(42);
  });
});
