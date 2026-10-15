import { describe, expect, it } from 'vitest';
import type { Clip } from '../../engine';
import { activeAt, compact, freeTrack, settle, shiftLayer, spanOf, stackOf, trackOf } from '../stack';

const c = (id: string, start: number, dur: number, track = 0): Clip => ({ id, tpl: 'lt', start, dur, track, props: {} });

describe('stacking', () => {
  it('adds on top only when something is already on screen', () => {
    const cs = [c('a', 10, 5)];
    expect(freeTrack(cs, 12, 14)).toBe(1);
    expect(freeTrack(cs, 15, 18)).toBe(0); // touching end-to-start is not overlapping
    expect(freeTrack([...cs, c('b', 11, 2, 1)], 12, 14)).toBe(2);
  });

  it('lifts a clip that collides on its layer after a move', () => {
    const out = settle([c('a', 10, 5), c('b', 12, 3)], 'b');
    expect(trackOf(out.find(x => x.id === 'b')!)).toBe(1);
  });

  it('removes empty layers', () => {
    const out = compact([c('a', 0, 5, 0), c('b', 0, 5, 3)]);
    expect(out.map(trackOf)).toEqual([0, 1]);
  });

  it('draws bottom to top', () => {
    const cs = [c('top', 0, 5, 1), c('bottom', 0, 5, 0), c('later', 9, 2, 0)];
    expect(activeAt(cs, 2).map(x => x.id)).toEqual(['bottom', 'top']);
    expect(activeAt(cs, 9.5).map(x => x.id)).toEqual(['later']);
  });

  it('finds the whole stack a clip belongs to, through chains of overlap', () => {
    const cs = [c('a', 0, 5), c('b', 4, 5, 1), c('c', 8, 3), c('far', 20, 2)];
    expect(stackOf(cs, cs[0]).map(x => x.id).sort()).toEqual(['a', 'b', 'c']);
    expect(spanOf(stackOf(cs, cs[0]))).toEqual({ start: 0, end: 11 });
  });

  it('bring forward / send back swaps with the clip in the way', () => {
    const cs = [c('a', 0, 5, 0), c('b', 1, 3, 1)];
    const up = shiftLayer(cs, 'a', 1);
    expect(trackOf(up.find(x => x.id === 'a')!)).toBe(1);
    expect(trackOf(up.find(x => x.id === 'b')!)).toBe(0);
    expect(shiftLayer(cs, 'a', -1)).toEqual(cs); // already at the bottom
  });
});
