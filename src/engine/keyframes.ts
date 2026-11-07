// Keyframes: per-graphic transform and opacity tracks over the clip's local time.
//
// A track is a list of keys {t, v, ease}. Sampling is a pure function of time, so tracks scrub, loop
// and rasterise frame-exact like everything else on the stage. `ease` on a key shapes the segment
// that LEAVES that key (as in most editors); the last key's ease is unused.
//
// Clip props carry them as JSON: props.kf = {"x":[{"t":0,"v":-200,"ease":"expo"},{"t":0.6,"v":0}]}
import { cl, curveFn, E, type Ease } from './easing';

export interface Key { t: number; v: number; ease?: string }
export type Track = Key[];

/** Animatable properties. Rotation is in degrees, x/y in stage px, scale is a multiplier. */
export const KF_PROPS = {
  x: { label: 'Position X', def: 0, min: -4000, max: 4000 },
  y: { label: 'Position Y', def: 0, min: -4000, max: 4000 },
  scale: { label: 'Scale', def: 1, min: 0.01, max: 20 },
  rotate: { label: 'Rotation', def: 0, min: -3600, max: 3600 },
  opacity: { label: 'Opacity', def: 1, min: 0, max: 1 }
} as const;
export type KfProp = keyof typeof KF_PROPS;
export const KF_ORDER = Object.keys(KF_PROPS) as KfProp[];
export type Keyframes = Partial<Record<KfProp, Track>>;

const MAX_KEYS = 64, MAX_T = 3600;

/** Value of one track at time `t`. Holds the first value before the first key and the last after the last. */
export function sample(track: Track | undefined, t: number, fallback: number): number {
  if (!track || !track.length) return fallback;
  const n = track.length;
  if (t <= track[0].t) return track[0].v;
  if (t >= track[n - 1].t) return track[n - 1].v;
  // Binary search for the segment [lo, lo + 1] containing t.
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (track[mid].t <= t) lo = mid; else hi = mid; }
  const a = track[lo], b = track[hi], f = curveFn(a.ease) ?? E.lin as Ease;
  return a.v + (b.v - a.v) * f(cl((t - a.t) / (b.t - a.t)));
}

/**
 * Parse and sanitise keyframes from a props string. Anything malformed is dropped rather than
 * thrown: unknown properties, non-finite numbers, unknown eases (fall back to linear), keys out of
 * order (sorted), keys on the same instant (the last one wins), values clamped to the property's range.
 */
export function parseKeyframes(raw: string | undefined): Keyframes {
  if (!raw) return {};
  let src: unknown;
  try { src = JSON.parse(raw); } catch { return {}; }
  if (!src || typeof src !== 'object' || Array.isArray(src)) return {};
  const out: Keyframes = {};
  for (const prop of KF_ORDER) {
    const list = (src as Record<string, unknown>)[prop];
    if (!Array.isArray(list)) continue;
    const D = KF_PROPS[prop], keys: Key[] = [];
    for (const k of list.slice(0, MAX_KEYS)) {
      if (!k || typeof k !== 'object') continue;
      const { t, v, ease } = k as Record<string, unknown>;
      if (typeof t !== 'number' || typeof v !== 'number' || !isFinite(t) || !isFinite(v)) continue;
      const key: Key = { t: Math.min(MAX_T, Math.max(0, t)), v: Math.min(D.max, Math.max(D.min, v)) };
      if (typeof ease === 'string' && curveFn(ease)) key.ease = ease;
      keys.push(key);
    }
    // Stable sort, then collapse duplicates on one instant (later in the list wins).
    const sorted = keys.map((k, i) => [k, i] as const).sort((p, q) => p[0].t - q[0].t || p[1] - q[1]).map(p => p[0]);
    const dedup = sorted.filter((k, i) => i === sorted.length - 1 || sorted[i + 1].t !== k.t);
    if (dedup.length) out[prop] = dedup;
  }
  return out;
}

export const hasKeyframes = (kf: Keyframes) => KF_ORDER.some(p => kf[p]?.length);

export interface KfPose { x: number; y: number; scale: number; rotate: number; opacity: number }
export const poseAt = (kf: Keyframes, t: number): KfPose => ({
  x: sample(kf.x, t, 0), y: sample(kf.y, t, 0), scale: sample(kf.scale, t, 1), rotate: sample(kf.rotate, t, 0), opacity: sample(kf.opacity, t, 1)
});

const r = (n: number, d: number) => (+n.toFixed(d)).toString();
/** CSS for a pose. The identity pose is the empty string, so an untouched frame adds no transform at all. */
export function poseCss(p: KfPose): { transform: string; opacity: string } {
  const parts: string[] = [];
  if (Math.abs(p.x) > 1e-4 || Math.abs(p.y) > 1e-4) parts.push(`translate(${r(p.x, 3)}px,${r(p.y, 3)}px)`);
  if (Math.abs(p.rotate) > 1e-4) parts.push(`rotate(${r(p.rotate, 4)}deg)`);
  if (Math.abs(p.scale - 1) > 1e-6) parts.push(`scale(${r(p.scale, 5)})`);
  return { transform: parts.join(' '), opacity: p.opacity >= 1 - 1e-6 ? '' : r(p.opacity, 4) };
}

/** Evenly re-time every track so its last key lands on `dur` (used when a clip is resized). */
export function fitKeyframes(kf: Keyframes, from: number, to: number): Keyframes {
  if (!(from > 0) || !(to > 0)) return kf;
  const k = to / from, out: Keyframes = {};
  for (const p of KF_ORDER) if (kf[p]) out[p] = kf[p]!.map(key => ({ ...key, t: +(key.t * k).toFixed(4) }));
  return out;
}

export const serializeKeyframes = (kf: Keyframes) => (hasKeyframes(kf) ? JSON.stringify(kf) : '');

/** Ready-made motions: each returns tracks for a clip of `dur` seconds. */
export const KF_PRESETS: Record<string, { label: string; make: (dur: number) => Keyframes }> = {
  drift: { label: 'Slow drift', make: d => ({ x: [{ t: 0, v: -24, ease: 'sine' }, { t: d, v: 24 }] }) },
  push: { label: 'Push in', make: d => ({ scale: [{ t: 0, v: 1, ease: 'smooth' }, { t: d, v: 1.08 }] }) },
  pop: { label: 'Pop', make: () => ({ scale: [{ t: 0, v: 0.7, ease: 'spring(0.5)' }, { t: 0.7, v: 1 }], opacity: [{ t: 0, v: 0, ease: 'smooth' }, { t: 0.15, v: 1 }] }) },
  swing: { label: 'Swing in', make: () => ({ rotate: [{ t: 0, v: -12, ease: 'back' }, { t: 0.6, v: 0 }], x: [{ t: 0, v: -120, ease: 'expo' }, { t: 0.5, v: 0 }] }) },
  breathe: { label: 'Breathe', make: d => ({ scale: [{ t: 0, v: 1, ease: 'sine' }, { t: d / 2, v: 1.03, ease: 'sine' }, { t: d, v: 1 }] }) },
  shake: { label: 'Shake', make: () => ({ x: [0, 1, 2, 3, 4, 5, 6].map((i, _, a) => ({ t: i * 0.05, v: i === a.length - 1 ? 0 : (i % 2 ? 1 : -1) * (14 - i * 2), ease: 'smooth' })) }) }
};
