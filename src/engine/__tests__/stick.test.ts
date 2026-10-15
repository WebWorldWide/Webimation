import { describe, expect, it } from 'vitest';
import { ACTION, ACTIONS, figureAt, SCENES, castLength, type Figure } from '..';

const G = 610, W = 10;
const lowest = (j: ReturnType<typeof figureAt>['j']) => Math.max(j.ff[1], j.fb[1], j.kf[1], j.kb[1], j.hf[1], j.hb[1], j.hip[1], j.neck[1], j.head[1] + j.headR) + W / 2;
const fig = (steps: Figure['steps'], face: Figure['face'] = 'right', h = 260): Figure => ({ id: 'a', name: 'A', h, x: 500, face, color: 'fg', steps });

describe('stick figures', () => {
  it('nothing ever goes through the floor, for every action after every action', () => {
    let worst = 0;
    for (const a of ACTIONS) for (const b of ACTIONS) for (const face of ['right', 'left'] as const) {
      const F = fig([{ do: b.id, dur: b.dur, dx: b.dx }, { do: a.id, dur: a.dur, dx: a.dx }], face), T = b.dur + a.dur;
      for (let i = 0; i <= T * 30; i++) worst = Math.max(worst, lowest(figureAt(F, i / 30, G, W).j) - G);
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('planted feet never slide during gaits', () => {
    for (const id of ['walk', 'run', 'sneak']) for (const face of ['right', 'left'] as const) for (const dx of [180, 333, 700, -240]) {
      const F = fig([{ do: id, dur: 2, dx }], face);
      // Compare consecutive 30 fps frames after the blend-in window.
      let prev = figureAt(F, 18 / 30, G, W).j;
      for (let i = 19; i < 60; i++) {
        const j = figureAt(F, i / 30, G, W).j;
        for (const k of ['ff', 'fb'] as const) if (Math.abs(j[k][1] - (G - W / 2)) < 1e-3 && Math.abs(prev[k][1] - (G - W / 2)) < 1e-3) expect(Math.abs(j[k][0] - prev[k][0])).toBeLessThan(1e-6);
        prev = j;
      }
    }
  });

  it('gaits arrive exactly at the requested distance', () => {
    for (const id of ['walk', 'run', 'sneak']) for (const dx of [123, 360, 777]) {
      const end = figureAt(fig([{ do: id, dur: 2, dx }, { do: 'stand', dur: 1 }]), 2.5, G, W).j.hip[0];
      expect(end).toBeCloseTo(500 + dx, 6);
    }
  });

  it('every action and scene is deterministic and finite', () => {
    for (const a of ACTIONS) {
      const F = fig([{ do: a.id, dur: a.dur, dx: a.dx }]);
      for (const t of [0, a.dur / 3, a.dur]) {
        const x = figureAt(F, t, G, W).j, y = figureAt(F, t, G, W).j;
        expect(x).toEqual(y);
        for (const v of Object.values(x).flat()) expect(Number.isFinite(v)).toBe(true);
      }
    }
    for (const s of SCENES) expect(castLength(s.cast())).toBeGreaterThan(1);
    expect(ACTION.walk.dx).toBeGreaterThan(0);
  });
});
