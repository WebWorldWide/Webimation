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

// ── cubic-bezier, solved the way browsers do: Newton steps, bisection as the fallback ──
/** CSS-style cubic-bezier(x1, y1, x2, y2). x1/x2 are clamped to 0..1 so x(t) stays monotone. */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  x1 = cl(x1); x2 = cl(x2);
  if (x1 === y1 && x2 === y2) return E.lin;
  const A = (a: number, b: number) => 1 - 3 * b + 3 * a, B = (a: number, b: number) => 3 * b - 6 * a, C = (a: number) => 3 * a;
  const at = (t: number, a: number, b: number) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t: number, a: number, b: number) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  const solve = (x: number) => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= (at(t, x1, x2) - x) / d;
    }
    if (t >= 0 && t <= 1 && Math.abs(at(t, x1, x2) - x) < 1e-6) return t;
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) { const v = at(t, x1, x2); if (Math.abs(v - x) < 1e-7) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return t;
  };
  return x => (x <= 0 ? 0 : x >= 1 ? 1 : at(solve(x), y1, y2));
}

/** Damped spring, normalised so it lands exactly on 1 at x = 1. `bounce` 0..1: how much it rings. */
export function spring(bounce = 0.4): Ease {
  const z = 1 - 0.85 * cl(bounce), w = 14, wd = w * Math.sqrt(Math.max(1e-6, 1 - z * z));
  const raw = (x: number) => (z >= 1 ? 1 - (1 + w * x) * Math.exp(-w * x) : 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + ((z * w) / wd) * Math.sin(wd * x)));
  const end = raw(1);
  return x => (x <= 0 ? 0 : x >= 1 ? 1 : raw(x) + (1 - end) * x);
}

const back = (s = 1.70158): Ease => x => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
const bounceOut: Ease = x => {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
const elastic: Ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin(((x * 10 - 0.75) * (2 * Math.PI)) / 3) + 1);

// Monotone 0 → 1 curves only: the reveal effects turn the eased value into clip geometry.
export const EASES = {
  out: { label: 'Quart out', fn: E.out },
  io: { label: 'Quart in-out', fn: E.io },
  lin: { label: 'Linear', fn: E.lin },
  smooth: { label: 'Smooth', fn: bezier(0.4, 0, 0.2, 1) },
  expo: { label: 'Expo out', fn: (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)) },
  sine: { label: 'Sine in-out', fn: (x: number) => -(Math.cos(Math.PI * x) - 1) / 2 },
  circ: { label: 'Circ out', fn: (x: number) => Math.sqrt(1 - Math.pow(x - 1, 2)) },
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

/**
 * Curves for keyframes. Unlike EASES these may overshoot (spring, back, elastic, bounce), which is
 * fine for transforms and opacity but would push a clip-path outside its box. Also accepts
 * `bezier(x1,y1,x2,y2)`, `spring(bounce)` and `hold` (jump at the end of the segment).
 */
export const CURVES: Record<string, { label: string; fn: Ease }> = {
  ...EASES,
  in: { label: 'Cubic in', fn: E.in },
  back: { label: 'Back out', fn: back() },
  elastic: { label: 'Elastic out', fn: elastic },
  bounce: { label: 'Bounce out', fn: bounceOut },
  spring: { label: 'Spring', fn: spring(0.4) },
  hold: { label: 'Hold', fn: (x: number) => (x >= 1 ? 1 : 0) }
};
const cache = new Map<string, Ease>();
const NUM = '(-?\\d*\\.?\\d+)';
const BEZ = new RegExp(`^bezier\\(\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*,\\s*${NUM}\\s*\\)$`);
const SPR = new RegExp(`^spring\\(\\s*${NUM}\\s*\\)$`);
/** Resolve a curve id or expression; null when it isn't one (callers decide the fallback). */
export function curveFn(id: string | undefined): Ease | null {
  if (!id) return null;
  const hit = cache.get(id) ?? CURVES[id]?.fn;
  if (hit) return hit;
  let f: Ease | null = null;
  const b = BEZ.exec(id), sp = SPR.exec(id);
  if (b) f = bezier(+b[1], +b[2], +b[3], +b[4]);
  else if (sp) f = spring(+sp[1]);
  if (f) { if (cache.size > 200) cache.clear(); cache.set(id, f); }
  return f;
}
