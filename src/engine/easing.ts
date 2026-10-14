// One curve family. Quart-out enters, cubic-in exits, quart in-out for moves.
// Stepped variants quantise the same curve into whole frames-worth of motion.
export type Ease = (x: number) => number;

export const cl = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Linear progress of local time `t` through the window [s, s + d]. */
export const prog = (t: number, s: number, d: number) => cl((t - s) / (d || 1e-6));

export const E = {
  out: (x: number) => 1 - Math.pow(1 - x, 4),
  in: (x: number) => x * x * x,
  io: (x: number) => (x < 0.5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2),
  lin: (x: number) => x
};

const stepped = (f: Ease, n: number): Ease => x => (x >= 1 ? 1 : Math.floor(f(x) * n) / n);

export const EASES = {
  out: { label: 'Quart out', fn: E.out },
  io: { label: 'Quart in-out', fn: E.io },
  lin: { label: 'Linear', fn: E.lin },
  step4: { label: 'Stepped · 4', fn: stepped(E.out, 4) },
  step8: { label: 'Stepped · 8', fn: stepped(E.out, 8) },
  step16: { label: 'Stepped · 16', fn: stepped(E.out, 16) }
} as const;
export type EaseId = keyof typeof EASES;
export const easeFn = (id: string | undefined): Ease => (EASES[id as EaseId] || EASES.out).fn;
/** Exits are always cubic-in; a stepped enter gets a stepped exit with the same count. */
export const exitFn = (id: string | undefined): Ease => {
  const n = /^step(\d+)$/.exec(id || '');
  return n ? stepped(E.in, +n[1]) : E.in;
};
