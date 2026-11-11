import { describe, expect, it } from 'vitest';
import { animateEverything, resolveCues, restyle } from '../layout';
import { buildLibrary, search } from '../library';
import { IN, obj, scene, SHAPE_STYLE, type Catalogue } from '../types';

const box = (o = {}) => obj({ type: 'shape', style: SHAPE_STYLE(), w: 10, h: 10 }, o);

describe('start cues', () => {
  it('keeps timed objects where they are', () => {
    const s = resolveCues(scene({ objects: [box({ start: 1.6 }), box({ start: 0.3, order: 1 })] }));
    expect(s.objects.map(o => o.start)).toEqual([1.6, 0.3]);
  });
  it('chains with previous and after previous', () => {
    const s = resolveCues(scene({ objects: [
      box({ cue: 'start', order: 0, enter: IN('wipe', { dur: 0.5 }) }),
      box({ cue: 'with', gap: 0.2, order: 1, enter: IN('wipe', { dur: 0.5 }) }),
      box({ cue: 'after', order: 2, enter: IN('wipe', { dur: 1 }) }),
      box({ cue: 'after', gap: 0.5, order: 3 })
    ] }));
    expect(s.objects.map(o => o.start)).toEqual([0, 0.2, 0.7, 2.2]);
  });
});

describe('one-click tools', () => {
  const s = scene({ objects: [obj({ type: 'text', text: 'Hi', style: { font: 'archivo', size: 72, tracking: 0, line_height: 1.1, align: 'left', uppercase: false, color: '#fff', shadow: '', shadow_dx: 4, shadow_dy: 4, plate: '', pad_x: 0, pad_y: 0 } }), box({ order: 1 })] });
  it('animate everything gives every object an entrance, motion and exit in order', () => {
    const a = animateEverything(s, 'pixel');
    expect(a.fps).toBe(12);
    expect(a.objects.every(o => o.enter.id !== 'wipe' || o.kind.type !== 'text')).toBe(true);
    expect(a.objects[1].start).toBeGreaterThan(a.objects[0].start);
  });
  it('restyle switches fonts and motion feel', () => {
    const r = restyle(s, 'glyph');
    expect(r.fps).toBe(30);
    expect(r.objects[0].kind.type === 'text' && r.objects[0].kind.style.font).toBe('jetbrains-mono');
  });
});

describe('library', () => {
  const fx = (id: string, slot: 'in' | 'on' | 'out', family = 'clean', cell = false) => ({ id, name: id, slot, family, blurb: '', cell, has_dir: false }) as Catalogue['effects'][0];
  const style = { font: 'jetbrains-mono', cell: 12, cell_w: 1, cell_h: 1, chars: ' .#', sort_by_ink: false, reverse: false, pick: 'brightness', message: '', flicker: 0, tone: { black: 0, white: 1, gamma: 1, contrast: 0, brightness: 0, cutoff: 0, invert: false }, dither: 'none', dither_strength: 1, dither_animate: false, palette: { id: 'p', name: 'P', bands: [{ color: '#000', at: 0 }], smooth: false }, fill_cells: false, ink: '' } as Catalogue['looks'][0]['style'];
  const cat = {
    effects: [fx('wipe', 'in'), fx('pop', 'in', 'fun'), fx('dither-in', 'in', 'glyph', true), fx('bob', 'on', 'pixel'), fx('shimmer', 'on', 'glyph', true), fx('wipe', 'out'), fx('melt', 'out', 'glyph', true), fx('stay', 'out')],
    cards: [{ id: 'nametag', name: 'Name tag', blurb: 'Who', category: 'Name tags', fields: [['name', 'Name', 'Ada']], dur: 5 }],
    colorSets: [], fonts: [], palettes: [style.palette], charsets: [], channels: [{ id: 'horizon', name: 'Horizon', blurb: '' }], dithers: [{ id: 'bayer4', name: 'Bayer 4×4' }],
    shapes: [{ id: 'arrow', name: 'Arrow', open: true }], starters: [{ id: 'cloud', name: 'Pixel cloud', note: '', sprite: { w: 2, h: 1, frames: ['11'], palette: ['#fff'], fps: 0 } }],
    looks: [{ id: 'horizon', name: 'Horizon glow', style, field: { channel: 'horizon', zoom: 1, rotate: 0, pan_x: 0, pan_y: 0, warp: 0, detail: 4, speed: 1, direction: 'forward', seed: 1, loop_s: 4 }, screen: { scanlines: 0, scan_spacing: 3, grain: 0, glow: 0, rgb_split: 0, phosphor: 0, vignette: 0 } }],
    scenes: []
  } as Catalogue;
  const lib = buildLibrary(cat);
  it('has unique ids and every item builds a scene', () => {
    expect(new Set(lib.map(i => i.id)).size).toBe(lib.length);
    for (const i of lib) { const s = i.make(); expect(s.objects.length).toBeGreaterThan(0); expect(s.dur).toBeGreaterThan(0); }
  });
  it('search needs every word and ranks names first', () => {
    expect(search(lib, 'name tag')[0].id).toBe('card-nametag');
    expect(search(lib, 'zzz nothing')).toEqual([]);
  });
});
