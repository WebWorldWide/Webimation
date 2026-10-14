import { describe, expect, it } from 'vitest';
import { EFFECTS, FX, LIBRARY, getPreset, mint, sanitize, build, TEMPLATES, type Clip } from '..';
import { band, poly } from '../geom';
import { ranks } from '../rand';

describe('preset library', () => {
  it('mints hundreds of unique presets', () => {
    expect(LIBRARY.length).toBeGreaterThan(300);
    expect(new Set(LIBRARY.map(p => p.id)).size).toBe(LIBRARY.length);
    expect(new Set(LIBRARY.map(p => p.name)).size).toBe(LIBRARY.length);
  });
  it('every preset references real effects', () => {
    for (const p of LIBRARY) {
      expect(FX[p.enter.fx], p.id).toBeTruthy();
      if (p.exit) expect(FX[p.exit.fx].exit, p.id).toBe(true);
    }
  });
  it('resolves the Studio base reveals', () => {
    expect(getPreset('wipe').enter).toEqual({ fx: 'wipe', p: { dir: 'right' } });
    expect(getPreset('mask').enter.fx).toBe('mask');
    expect(getPreset('cut').enter.fx).toBe('cut');
    expect(getPreset('nope').id).toBe('wipe-right');
  });
  it('mint is deterministic and resolvable', () => {
    const a = mint(1234), b = mint(1234);
    expect(a).toEqual(b);
    expect(getPreset(a.id)).toEqual(a);
  });
  it('sanitize rejects junk and clamps numbers', () => {
    expect(sanitize({ enter: { fx: 'evil' } })).toBeNull();
    const s = sanitize({ name: 'x', enter: { fx: 'blinds', p: { n: 999, axis: 'v' } }, gap: 99, order: 'bogus' })!;
    expect(s.enter.p).toEqual({ axis: 'v', n: 6 });
    expect(s.gap).toBe(2.5);
    expect(s.order).toBe('seq');
  });
});

describe('geometry', () => {
  it('bands follow the wipe direction', () => {
    expect(band('right', 0.5)).toEqual([0, 0, 50, 100]);
    expect(band('up', 0.25)).toEqual([0, 75, 100, 100]);
    expect(band('right', 1, 0.5)).toEqual([50, 0, 100, 100]);
  });
  it('poly hides empty unions', () => {
    expect(poly([[0, 0, 0, 100]])).toBe('polygon(0 0,0 0,0 0)');
    expect(poly([[0, 0, 50, 100]])).toContain('50% 100%');
  });
  it('ranks span 0..1 for every order', () => {
    for (const o of ['seq', 'rev', 'center', 'edges', 'random', 'alt'] as const) {
      const r = ranks(7, o, 9);
      expect(Math.min(...r)).toBe(0);
      expect(Math.max(...r)).toBe(1);
    }
  });
});

describe('stage', () => {
  it('builds every template under every effect family and rests on the plain layout', () => {
    for (const tpl of Object.keys(TEMPLATES)) {
      for (const fx of EFFECTS) {
        const preset = LIBRARY.find(p => p.enter.fx === fx.id)!;
        const layer = document.createElement('div');
        document.body.append(layer);
        const clip: Clip = { id: 't', tpl, start: 0, dur: TEMPLATES[tpl].dur, props: { reveal: preset.id } };
        const upd = build(layer, clip)!;
        for (const t of [0, 0.2, 0.6, 2.9, clip.dur - 0.2, clip.dur]) upd(t);
        upd(2.9);
        layer.remove();
      }
    }
  }, 120_000);
});
