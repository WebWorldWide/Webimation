// Stick figures with no rigging. Every figure shares one built-in humanoid skeleton scaled by its
// height; you animate it by writing a script of steps ("walk 300 px in 2 s", "wave", "say 'Hi'").
//
// How motion stays clean:
//  • Gaits (walk, run, sneak) plant each foot with 2-bone IK while the hips travel at exactly the
//    stride speed, so feet never slide. Stride length is chosen so a whole number of steps lands
//    precisely on the requested distance.
//  • Every other pose is grounded automatically: the lowest point of the body (feet, knees, hands,
//    head, hips) is placed on the ground line, so nothing sinks through the floor or floats.
//  • Steps blend into each other in angle space (shortest way round) over a short window, so there
//    are no pops between actions. Everything is a pure function of time, so it scrubs and exports.

export interface Pose {
  /** Torso lean, degrees forward from vertical. */
  lean: number;
  /** Head tilt relative to the torso, + nods forward. */
  tilt: number;
  /** Arms: [shoulder angle from straight down (relative to torso, + forward), elbow bend (+ forward)]. f = front, b = back. */
  af: [number, number];
  ab: [number, number];
  /** Legs: [hip angle from straight down (+ forward), knee bend (+ shin swings back)]. */
  lf: [number, number];
  lb: [number, number];
  /** Hip height above the ground in px; undefined = ground automatically. */
  y?: number;
  /** Extra height for jumps (added after grounding). */
  lift?: number;
}

export interface Step {
  do: string;
  /** Seconds. */
  dur: number;
  /** Distance to travel (px, + = the way the figure faces). Used by moving actions. */
  dx?: number;
  /** Speech bubble text shown during the step. */
  say?: string;
  /** Turn to face this way at the start of the step. */
  face?: 'left' | 'right';
  /** Custom pose for 'pose' steps. */
  pose?: Pose;
}

export interface Figure {
  id: string;
  name: string;
  /** Height in stage px. */
  h: number;
  /** Starting x of the hips. */
  x: number;
  face: 'left' | 'right';
  color: string;
  steps: Step[];
}

export interface Cast { ground: number; weight: number; style: 'round' | 'solid' | 'block'; figures: Figure[] }

// ── skeleton ─────────────────────────────────────────────────────────────────
export const bones = (h: number) => ({
  head: 0.085 * h, torso: 0.31 * h, thigh: 0.245 * h, shin: 0.245 * h, upper: 0.17 * h, fore: 0.16 * h,
  shoulder: 0.045 * h, neck: 0.02 * h
});

type Pt = [number, number];
export interface Joints { hip: Pt; neck: Pt; shoulder: Pt; head: Pt; headR: number; ef: Pt; hf: Pt; eb: Pt; hb: Pt; kf: Pt; ff: Pt; kb: Pt; fb: Pt }

const RAD = Math.PI / 180;
/** Unit vector for an angle measured from straight down, + toward the facing direction. */
const dir = (a: number): Pt => [Math.sin(a * RAD), Math.cos(a * RAD)];
const at = (p: Pt, a: number, l: number, f: number): Pt => { const d = dir(a); return [p[0] + f * d[0] * l, p[1] + d[1] * l]; };

/** Forward kinematics. Returns joints with the hip at (x, hipY). */
export function fk(p: Pose, h: number, x: number, hipY: number, f: number): Joints {
  const B = bones(h), hip: Pt = [x, hipY];
  const up = 180 - p.lean, neck = at(hip, up, B.torso, f), shoulder = at(neck, -p.lean, B.shoulder, f);
  const head = at(neck, up - p.tilt, B.neck + B.head, f);
  const arm = ([s, e]: [number, number]) => { const el = at(shoulder, -p.lean + s, B.upper, f); return [el, at(el, -p.lean + s + e, B.fore, f)] as const; };
  const leg = ([a, k]: [number, number]) => { const kn = at(hip, a, B.thigh, f); return [kn, at(kn, a - k, B.shin, f)] as const; };
  const [ef, hf] = arm(p.af), [eb, hb] = arm(p.ab), [kf, ff] = leg(p.lf), [kb, fb] = leg(p.lb);
  return { hip, neck, shoulder, head, headR: B.head, ef, hf, eb, hb, kf, ff, kb, fb };
}

/** Lowest drawn point below the hip, so the figure can stand on the ground line. */
const lowest = (j: Joints, w: number) => Math.max(j.ff[1], j.fb[1], j.kf[1], j.kb[1], j.hf[1], j.hb[1], j.hip[1], j.neck[1], j.head[1] + j.headR) + w / 2;

/** Two-bone IK: knee/elbow position for a chain from `a` reaching `t`, bending toward `bend` (+1 forward). */
function ik(a: Pt, t: Pt, l1: number, l2: number, f: number, bend: number): Pt {
  const dx = t[0] - a[0], dy = t[1] - a[1], d = Math.min(Math.hypot(dx, dy), l1 + l2 - 1e-6), ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), y = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const s = bend * f; // perpendicular pointing toward the bend side
  return [a[0] + ux * x - uy * y * -s, a[1] + uy * x + ux * y * -s];
}
/** Angle (from down, + forward) of the vector a→b for a figure facing f. */
const ang = (a: Pt, b: Pt, f: number) => Math.atan2(f * (b[0] - a[0]), b[1] - a[1]) / RAD;

/** Leg angles that put the foot at `foot` (absolute), knee bending forward. */
function legTo(hip: Pt, foot: Pt, h: number, f: number): [number, number] {
  const B = bones(h), knee = ik(hip, foot, B.thigh, B.shin, f, 1), a = ang(hip, knee, f), s = ang(knee, foot, f);
  return [a, a - s];
}

// ── poses ────────────────────────────────────────────────────────────────────
export const STAND: Pose = { lean: 0, tilt: 0, af: [14, 6], ab: [-12, 6], lf: [7, 0], lb: [-7, 0] };
const P = (o: Partial<Pose>): Pose => ({ ...STAND, ...o, af: o.af ?? STAND.af, ab: o.ab ?? STAND.ab, lf: o.lf ?? STAND.lf, lb: o.lb ?? STAND.lb });

const wrap = (a: number) => ((a + 540) % 360) - 180;
const mixA = (a: number, b: number, k: number) => a + wrap(b - a) * k;
const mix2 = (a: [number, number], b: [number, number], k: number): [number, number] => [mixA(a[0], b[0], k), mixA(a[1], b[1], k)];
/**
 * Blend from `a` toward a moving target `b`, choosing each joint's rotation direction once from the
 * target's first frame `b0` (so a joint ~180° away can never flip sides mid-blend).
 */
function mixToward(a: Pose, b: Pose, b0: Pose, k: number): Pose {
  const m = (x: number, y: number, y0: number) => x + (wrap(y0 - x) + wrap(y - y0)) * k;
  const m2 = (x: [number, number], y: [number, number], y0: [number, number]): [number, number] => [m(x[0], y[0], y0[0]), m(x[1], y[1], y0[1])];
  const y = a.y !== undefined && b.y !== undefined ? a.y + (b.y - a.y) * k : undefined;
  return { lean: m(a.lean, b.lean, b0.lean), tilt: m(a.tilt, b.tilt, b0.tilt), af: m2(a.af, b.af, b0.af), ab: m2(a.ab, b.ab, b0.ab), lf: m2(a.lf, b.lf, b0.lf), lb: m2(a.lb, b.lb, b0.lb), y, lift: (a.lift ?? 0) + ((b.lift ?? 0) - (a.lift ?? 0)) * k };
}
export function mixPose(a: Pose, b: Pose, k: number): Pose {
  const y = a.y !== undefined && b.y !== undefined ? a.y + (b.y - a.y) * k : k < 1 ? a.y ?? b.y : b.y;
  return { lean: mixA(a.lean, b.lean, k), tilt: mixA(a.tilt, b.tilt, k), af: mix2(a.af, b.af, k), ab: mix2(a.ab, b.ab, k), lf: mix2(a.lf, b.lf, k), lb: mix2(a.lb, b.lb, k), y, lift: (a.lift ?? 0) + ((b.lift ?? 0) - (a.lift ?? 0)) * k };
}
const io = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** Sine in-out: peak speed ≈1.57× average (cubic is 3×), so limbs never whip between keys. */
const sio = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
const cl = (x: number) => Math.max(0, Math.min(1, x));
const sin = (x: number) => Math.sin(x * 2 * Math.PI);

/** Keyframed action: [u, pose] pairs (u in 0..1), eased in-out between keys. */
const keys = (k: [number, Pose][]) => (u: number): Pose => {
  if (u <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (u <= k[i][0]) return mixPose(k[i - 1][1], k[i][1], sio((u - k[i - 1][0]) / (k[i][0] - k[i - 1][0])));
  return k[k.length - 1][1];
};

export interface ActionCtx { h: number; f: number; d: number; dx: number; ground: number; x0: number; weight: number }
/** Returns the pose and the hip x offset (relative to the step start) at progress u. */
type Action = (u: number, c: ActionCtx) => { pose: Pose; x: number };

/** Foot-planted gait. */
function gait(kind: 'walk' | 'run' | 'sneak'): Action {
  return (u, c) => {
    const B = bones(c.h), L = B.thigh + B.shin, dist = Math.abs(c.dx), sg = Math.sign(c.dx) || 1;
    // Stride per step (heel to heel). Runs cover extra ground in the air, so their planted stride stays short.
    const base = kind === 'run' ? 0.42 : kind === 'sneak' ? 0.26 : 0.4, S0 = base * c.h;
    // Whole number of cycles so the last step lands exactly at dx (each cycle = 2 steps).
    const cycles = Math.max(1, Math.round(dist / (2 * S0))), S = dist / (2 * cycles) || S0, phase = (u * cycles) % 1;
    const stanceFrac = kind === 'run' ? 0.38 : 0.5;
    const crouch = kind === 'sneak' ? 0.82 : kind === 'run' ? 0.94 : 1;
    const H0 = Math.sqrt(Math.max(0, (L * crouch) ** 2 - (S / 2) ** 2)) * 0.985, bob = Math.min(0.025 * c.h, L * 0.995 * crouch - H0);
    const lift = (kind === 'run' ? 0.12 : kind === 'sneak' ? 0.04 : 0.07) * c.h;
    const hipX = sg * u * dist, hipH = kind === 'run' ? H0 + bob + 0.05 * c.h * Math.max(0, Math.sin(phase * 4 * Math.PI)) : H0 + bob * Math.sin(phase * 2 * Math.PI) ** 2;
    const hip: Pt = [c.x0 + c.f * hipX, c.ground - hipH];
    const foot = (ph: number): Pt => {
      const p = ((ph % 1) + 1) % 1, half = 0.5;
      let rel: number, up = 0;
      if (p < half) {
        // Stance: planted. Relative to the hip it moves back by exactly the distance the hip travels.
        rel = S / 2 - (p / half) * S;
      } else {
        const v = (p - half) / half;
        rel = -S / 2 + S * io(v);
        up = lift * Math.sin(Math.PI * v) ** (kind === 'run' ? 0.8 : 1);
      }
      if (kind === 'run' && p < half) up = lift * 0.25 * Math.max(0, Math.sin(Math.PI * (p / half - stanceFrac / half) * 2));
      return [hip[0] + c.f * sg * rel, c.ground - up - c.weight / 2];
    };
    const lf = legTo(hip, foot(phase), c.h, c.f * sg), lb = legTo(hip, foot(phase + 0.5), c.h, c.f * sg);
    const sw = sin(phase), arm = kind === 'run' ? 50 : kind === 'sneak' ? 12 : 26;
    const pose: Pose = {
      lean: kind === 'run' ? 14 : kind === 'sneak' ? 22 : 4, tilt: kind === 'sneak' ? -14 : 0,
      af: kind === 'sneak' ? [55 + 8 * sw, 70] : [arm * -sw + 4, kind === 'run' ? 95 : 18 + 10 * Math.max(0, -sw)],
      ab: kind === 'sneak' ? [40 - 8 * sw, 80] : [arm * sw + 4, kind === 'run' ? 95 : 18 + 10 * Math.max(0, sw)],
      lf, lb, y: hipH
    };
    if (sg < 0) { pose.lf = [-lf[0], -lf[1]]; pose.lb = [-lb[0], -lb[1]]; pose.lean = -pose.lean; }
    return { pose, x: hipX };
  };
}
const still = (p: Pose): Action => () => ({ pose: p, x: 0 });
const move = (fn: (u: number, c: ActionCtx) => Pose, travel = (u: number) => u): Action => (u, c) => ({ pose: fn(u, c), x: c.dx * travel(u) });

export interface ActionDef { id: string; name: string; group: 'Move' | 'Gesture' | 'Emote' | 'Body' | 'Custom'; dur: number; dx?: number; fn: Action; blurb: string }
export const ACTIONS: ActionDef[] = [
  { id: 'stand', name: 'Stand', group: 'Body', dur: 1, fn: still(STAND), blurb: 'Hold a relaxed standing pose.' },
  { id: 'walk', name: 'Walk', group: 'Move', dur: 2, dx: 360, fn: gait('walk'), blurb: 'Feet plant and roll; stride fits the distance exactly.' },
  { id: 'run', name: 'Run', group: 'Move', dur: 1.4, dx: 520, fn: gait('run'), blurb: 'Leaning run with a flight phase and pumping arms.' },
  { id: 'sneak', name: 'Sneak', group: 'Move', dur: 2.4, dx: 220, fn: gait('sneak'), blurb: 'Crouched tiptoe, hands up.' },
  {
    id: 'jump', name: 'Jump', group: 'Move', dur: 1.1, dx: 0, blurb: 'Crouch, spring, land, absorb. Set a distance to jump forward.',
    fn: (u, c) => {
      const crouch = P({ lean: 18, af: [-30, 30], ab: [-40, 30], lf: [40, 80], lb: [30, 70] });
      const air = P({ lean: -4, af: [160, 10], ab: [150, 10], lf: [20, 30], lb: [-10, 40] });
      const pose = keys([[0, STAND], [0.22, crouch], [0.36, P({ lean: 0, af: [170, 0], ab: [165, 0], lf: [4, 0], lb: [-4, 0] })], [0.55, air], [0.78, crouch], [1, STAND]])(u);
      const fl = cl((u - 0.34) / 0.42);
      pose.lift = 0.45 * c.h * Math.sin(Math.PI * fl);
      return { pose, x: c.dx * io(fl) };
    }
  },
  { id: 'wave', name: 'Wave', group: 'Gesture', dur: 1.8, blurb: 'Raised hand waving side to side.', fn: still(STAND) },
  { id: 'point', name: 'Point', group: 'Gesture', dur: 1.4, blurb: 'Arm snaps out straight and holds.', fn: keys([[0, STAND], [0.25, P({ af: [96, -6], lean: 3 })], [1, P({ af: [92, -4], lean: 3 })]]) as unknown as Action },
  { id: 'pointup', name: 'Point up', group: 'Gesture', dur: 1.4, blurb: 'Points up at something overhead.', fn: keys([[0, STAND], [0.25, P({ af: [158, 4], tilt: -14, lean: -3 })], [1, P({ af: [160, 2], tilt: -16, lean: -3 })]]) as unknown as Action },
  { id: 'cheer', name: 'Cheer', group: 'Emote', dur: 1.6, blurb: 'Both fists up, bouncing.', fn: still(STAND) },
  { id: 'clap', name: 'Clap', group: 'Gesture', dur: 1.6, blurb: 'Hands meet in front of the chest, again and again.', fn: still(STAND) },
  { id: 'think', name: 'Think', group: 'Emote', dur: 2, blurb: 'Hand to chin, head tilted.', fn: keys([[0, STAND], [0.3, P({ af: [40, 128], ab: [20, 100], tilt: 12, lean: -2 })], [1, P({ af: [40, 130], ab: [20, 100], tilt: 14, lean: -2 })]]) as unknown as Action },
  { id: 'shrug', name: 'Shrug', group: 'Emote', dur: 1.3, blurb: 'Palms out, shoulders up, head tilt.', fn: keys([[0, STAND], [0.35, P({ af: [40, 95], ab: [-40, -95], tilt: 10 })], [0.7, P({ af: [42, 98], ab: [-42, -98], tilt: 12 })], [1, STAND]]) as unknown as Action },
  { id: 'facepalm', name: 'Facepalm', group: 'Emote', dur: 1.8, blurb: 'Hand to forehead, head drops.', fn: keys([[0, STAND], [0.3, P({ af: [60, 140], tilt: 20, lean: 6 })], [1, P({ af: [58, 142], tilt: 24, lean: 8 })]]) as unknown as Action },
  { id: 'celebrate', name: 'Celebrate', group: 'Emote', dur: 1.5, blurb: 'Jump with both arms flung up.', fn: still(STAND) },
  { id: 'dance', name: 'Dance', group: 'Emote', dur: 2.4, blurb: 'Alternating arm pumps with a hip bounce.', fn: still(STAND) },
  { id: 'bow', name: 'Bow', group: 'Body', dur: 1.6, blurb: 'Bends at the waist and comes back up.', fn: keys([[0, STAND], [0.4, P({ lean: 62, tilt: 10, af: [-6, 0], ab: [-10, 0] })], [0.6, P({ lean: 62, tilt: 10, af: [-6, 0], ab: [-10, 0] })], [1, STAND]]) as unknown as Action },
  { id: 'sit', name: 'Sit down', group: 'Body', dur: 1.2, blurb: 'Sits on the floor, knees up, and stays there.', fn: keys([[0, STAND], [0.6, P({ lean: 8, af: [40, 40], ab: [30, 40], lf: [50, 100], lb: [40, 90] })], [1, P({ lean: -6, af: [-30, 10], ab: [-40, 10], lf: [72, 132], lb: [66, 128] })]]) as unknown as Action },
  { id: 'getup', name: 'Get up', group: 'Body', dur: 1.2, blurb: 'From sitting or lying back to standing.', fn: keys([[0, P({ lean: -6, af: [-30, 10], ab: [-40, 10], lf: [72, 132], lb: [66, 128] })], [0.45, P({ lean: 30, af: [30, 20], ab: [20, 20], lf: [50, 100], lb: [40, 90] })], [1, STAND]]) as unknown as Action },
  { id: 'fall', name: 'Fall over', group: 'Body', dur: 1.2, blurb: 'Topples forward and lands flat.', fn: keys([[0, STAND], [0.25, P({ lean: 14, af: [60, 10], ab: [40, 10], tilt: -10 })], [0.75, P({ lean: 82, af: [150, 10], ab: [140, 10], lf: [-60, 10], lb: [-70, 20] })], [1, P({ lean: 90, tilt: -6, af: [170, 6], ab: [176, 6], lf: [-90, 0], lb: [-86, 6] })]]) as unknown as Action },
  { id: 'kick', name: 'Kick', group: 'Body', dur: 1, blurb: 'Wind up and a straight front kick.', fn: keys([[0, STAND], [0.3, P({ lean: -6, lf: [30, 90], af: [-20, 20], ab: [30, 30] })], [0.5, P({ lean: -14, lf: [95, 0], af: [-40, 10], ab: [50, 20] })], [0.75, P({ lean: -4, lf: [20, 40] })], [1, STAND]]) as unknown as Action },
  { id: 'punch', name: 'Punch', group: 'Body', dur: 0.9, blurb: 'Guard up, jab out, back to guard.', fn: keys([[0, STAND], [0.3, P({ lean: 4, af: [50, 120], ab: [40, 130], lf: [14, 0], lb: [-14, 0] })], [0.5, P({ lean: 10, af: [90, 0], ab: [40, 130], lf: [14, 0], lb: [-14, 0] })], [0.7, P({ lean: 4, af: [50, 120], ab: [40, 130], lf: [14, 0], lb: [-14, 0] })], [1, STAND]]) as unknown as Action },
  { id: 'lookout', name: 'Look out', group: 'Gesture', dur: 1.8, blurb: 'Leans in, hand shading the eyes.', fn: keys([[0, STAND], [0.3, P({ lean: 12, tilt: -6, af: [130, 120] })], [1, P({ lean: 14, tilt: -8, af: [132, 122] })]]) as unknown as Action },
  { id: 'surprise', name: 'Surprise', group: 'Emote', dur: 1, blurb: 'Jolts back, hands up.', fn: keys([[0, STAND], [0.15, P({ lean: -14, tilt: -10, af: [120, 40], ab: [110, 40] })], [1, P({ lean: -10, tilt: -8, af: [115, 45], ab: [105, 45] })]]) as unknown as Action },
  { id: 'pose', name: 'Custom pose', group: 'Custom', dur: 1, blurb: 'Your own pose: drag joints on the stage to set it.', fn: still(STAND) }
];
// Keyframe actions return a Pose; wrap them into Actions (x = 0) and attach the procedural ones.
for (const a of ACTIONS) {
  const f = a.fn as unknown as (u: number, c: ActionCtx) => Pose | { pose: Pose; x: number };
  a.fn = (u, c) => { const r = f(u, c); return 'pose' in r ? r : { pose: r, x: 0 }; };
}
const A = Object.fromEntries(ACTIONS.map(a => [a.id, a])) as Record<string, ActionDef>;
A.wave.fn = move(u => { const k = io(cl(u / 0.2)) * io(cl((1 - u) / 0.15)); return mixPose(STAND, P({ af: [150, 20 + 40 * sin(u * 4.5)], tilt: 4 }), k); }, () => 0);
A.cheer.fn = move((u, c) => { const b = Math.abs(Math.sin(u * 4 * Math.PI)), k = io(cl(u / 0.15)) * io(cl((1 - u) / 0.12)); const p = mixPose(STAND, P({ af: [148, 18], ab: [-148, -18], lf: [8 + 12 * b, 24 * b], lb: [-8 + 12 * b, 24 * b] }), k); p.lift = 0.05 * c.h * b * k; return p; }, () => 0);
A.clap.fn = move(u => { const k = io(cl(u / 0.15)) * io(cl((1 - u) / 0.15)), s = 0.5 + 0.5 * Math.cos(u * 6 * 2 * Math.PI); return mixPose(STAND, P({ af: [70 - 18 * s, 70 + 22 * s], ab: [60 + 22 * s, 80 + 18 * s] }), k); }, () => 0);
A.celebrate.fn = (u, c) => { const r = A.jump.fn(u, { ...c, dx: 0 }); const k = io(cl((u - 0.25) / 0.2)) * io(cl((1 - u) / 0.2)); r.pose.af = mix2(r.pose.af, [146, 8], k); r.pose.ab = mix2(r.pose.ab, [-146, -8], k); return r; };
A.dance.fn = move((u, c) => {
  // Arms trade places on each beat: a fast but continuous pump (≈0.2 s per swap), never a cut.
  const s = sin(u * 4), k = sio(cl(s * 1.3 + 0.5)), b = Math.abs(Math.sin(u * 8 * Math.PI)), e = io(cl(u / 0.12)) * io(cl((1 - u) / 0.12));
  const up: [number, number] = [160, 10], down: [number, number] = [40, 110];
  const p = P({ lean: 6 * s, tilt: -8 * s, af: mix2(down, up, k), ab: mix2(up, down, k), lf: [12 + 10 * b, 30 * b], lb: [-12 + 10 * b, 30 * b] });
  const r = mixPose(STAND, p, e);
  r.lift = 0.02 * c.h * b * e;
  return r;
}, () => 0);
export const ACTION = A;

// ── timeline ─────────────────────────────────────────────────────────────────
/** Blend between steps: at least 0.2 s, longer when the body has further to go (≤ 400°/s per joint). */
const BLEND_MIN = 0.2, BLEND_SPEED = 400;
const poseDist = (a: Pose, b: Pose) => Math.max(...([[a.lean, b.lean], [a.tilt, b.tilt], ...(['af', 'ab', 'lf', 'lb'] as const).flatMap(k => [[a[k][0], b[k][0]], [a[k][1], b[k][1]]])] as [number, number][]).map(([x, y]) => Math.abs(wrap(y - x))));
export interface FigureFrame { j: Joints; f: number; say: string | null; sayK: number }

/** Pose + position of a figure at time t (seconds into the clip). */
export function figureAt(fig: Figure, t: number, ground: number, weight: number): FigureFrame {
  let x = fig.x, f = fig.face === 'left' ? -1 : 1, t0 = 0, prev: Pose = STAND;
  let pose: Pose = STAND, say: string | null = null, sayK = 0, done = false;
  for (let i = 0; i < fig.steps.length && !done; i++) {
    const s = fig.steps[i], a = ACTION[s.do] || ACTION.stand, d = Math.max(0.1, s.dur);
    if (s.face) f = s.face === 'left' ? -1 : 1;
    const ctx: ActionCtx = { h: fig.h, f, d, dx: s.dx ?? 0, ground, x0: x, weight };
    const run = (u: number) => (s.do === 'pose' && s.pose ? { pose: s.pose, x: 0 } : a.fn(u, ctx));
    if (t < t0 + d) {
      const u = cl((t - t0) / d), r = run(u), first = run(0).pose;
      const bt = Math.min(Math.max(BLEND_MIN, poseDist(prev, first) / BLEND_SPEED), d * 0.6), bk = sio(cl((t - t0) / bt));
      if (bk >= 1) pose = r.pose;
      else if (prev.y === undefined && r.pose.y === undefined) pose = mixToward(prev, r.pose, first, bk);
      else {
        // One side has an explicit hip height (a gait): blend real hip heights, grounding the other.
        const ya = prev.y ?? hipHeight(prev, fig.h, ground, f, weight), yb = r.pose.y ?? hipHeight(r.pose, fig.h, ground, f, weight);
        pose = mixToward({ ...prev, y: ya }, { ...r.pose, y: yb }, first, bk);
      }
      x += f * r.x;
      if (s.say) { say = s.say; sayK = cl((t - t0) / 0.12) * cl((t0 + d - t) / 0.08); }
      done = true;
    } else {
      const r = run(1);
      x += f * r.x;
      prev = r.pose;
      pose = r.pose;
      t0 += d;
    }
  }
  const j = place(pose, fig.h, x, ground, f, weight);
  return { j, f, say, sayK };
}

/** Hip height above the ground for an auto-grounded pose. */
const hipHeight = (p: Pose, h: number, ground: number, f: number, w: number) => ground - place({ ...p, y: undefined, lift: 0 }, h, 0, ground, f, w).hip[1];

function place(p: Pose, h: number, x: number, ground: number, f: number, w: number): Joints {
  if (p.y !== undefined) {
    // Explicit hip height (gaits and blends into them): still never let anything sink through the floor.
    const hy = ground - p.y - (p.lift ?? 0), j = fk(p, h, x, hy, f), over = lowest(j, w) - ground;
    return over > 1e-6 ? fk(p, h, x, hy - over, f) : j;
  }
  const j0 = fk(p, h, x, 0, f), dy = ground - lowest(j0, w) - (p.lift ?? 0);
  return fk(p, h, x, dy, f);
}

/** Total length of a figure's script. */
export const scriptLength = (fig: Figure) => fig.steps.reduce((a, s) => a + Math.max(0.1, s.dur), 0);
/** Which step is running at time t. */
export function stepAt(fig: Figure, t: number) {
  let t0 = 0;
  for (let i = 0; i < fig.steps.length; i++) { const d = Math.max(0.1, fig.steps[i].dur); if (t < t0 + d) return { i, t0, u: (t - t0) / d }; t0 += d; }
  return { i: fig.steps.length - 1, t0: t0 - (fig.steps.at(-1)?.dur ?? 0), u: 1 };
}

// ── defaults ─────────────────────────────────────────────────────────────────
export const newFigure = (i: number): Figure => ({
  id: 'f' + Date.now().toString(36) + i, name: `Figure ${i + 1}`, h: 260, x: 300 + i * 360, face: i % 2 ? 'left' : 'right', color: i ? 'accent' : 'fg',
  steps: i
    ? [{ do: 'stand', dur: 0.8 }, { do: 'wave', dur: 1.6, say: 'Hey!' }, { do: 'cheer', dur: 1.4 }]
    : [{ do: 'walk', dur: 2, dx: 320 }, { do: 'wave', dur: 1.6, say: 'Hi there' }, { do: 'jump', dur: 1.1 }, { do: 'cheer', dur: 1.2 }]
});
export const defaultCast = (): Cast => ({ ground: 610, weight: 10, style: 'round', figures: [newFigure(0)] });
export function parseCast(s: string | undefined): Cast {
  try {
    const c = JSON.parse(s || '') as Partial<Cast>;
    if (!c || !Array.isArray(c.figures)) return defaultCast();
    return { ground: +(c.ground ?? 610), weight: +(c.weight ?? 10), style: c.style === 'block' || c.style === 'solid' ? c.style : 'round', figures: c.figures.slice(0, 6) };
  } catch { return defaultCast(); }
}
export const castLength = (c: Cast) => Math.max(1, ...c.figures.map(scriptLength));

// ── ready-made scenes ────────────────────────────────────────────────────────
const fig = (o: Partial<Figure> & { steps: Step[] }, i: number): Figure => ({ ...newFigure(i), ...o });
export const SCENES: { id: string; name: string; blurb: string; cast: () => Cast }[] = [
  { id: 'hello', name: 'Walk in and wave', blurb: 'One figure walks on, waves and says hi.', cast: () => ({ ...defaultCast() }) },
  {
    id: 'meet', name: 'Two friends meet', blurb: 'Walk toward each other, wave, celebrate.', cast: () => ({
      ground: 610, weight: 10, style: 'round', figures: [
        fig({ name: 'Ada', x: 140, face: 'right', color: 'fg', steps: [{ do: 'walk', dur: 2.2, dx: 330 }, { do: 'wave', dur: 1.4, say: 'Hey!' }, { do: 'celebrate', dur: 1.4 }] }, 0),
        fig({ name: 'Ben', x: 1140, face: 'left', color: 'accent', steps: [{ do: 'walk', dur: 2.2, dx: 330 }, { do: 'stand', dur: 0.6 }, { do: 'wave', dur: 1.2, say: 'Oh hi!' }, { do: 'cheer', dur: 1 }] }, 1)
      ]
    })
  },
  {
    id: 'race', name: 'Race', blurb: 'Two runners sprint across; one trips.', cast: () => ({
      ground: 620, weight: 9, style: 'round', figures: [
        fig({ name: 'Fast', x: 90, h: 220, face: 'right', color: 'accent', steps: [{ do: 'stand', dur: 0.4 }, { do: 'run', dur: 2.2, dx: 880 }, { do: 'cheer', dur: 1.4, say: 'First!' }] }, 0),
        fig({ name: 'Slow', x: 60, h: 220, face: 'right', color: 'fg', steps: [{ do: 'stand', dur: 0.4 }, { do: 'run', dur: 1.3, dx: 420 }, { do: 'fall', dur: 0.9 }, { do: 'getup', dur: 1.2 }] }, 1)
      ]
    })
  },
  {
    id: 'idea', name: 'Big idea', blurb: 'Thinks, gets it, points up.', cast: () => ({
      ground: 610, weight: 10, style: 'round', figures: [fig({ name: 'Thinker', x: 640, steps: [{ do: 'think', dur: 1.8, say: 'Hmm…' }, { do: 'surprise', dur: 0.7 }, { do: 'pointup', dur: 1.4, say: 'Got it!' }, { do: 'celebrate', dur: 1.3 }] }, 0)]
    })
  },
  {
    id: 'argue', name: 'Disagreement', blurb: 'One explains, the other shrugs and facepalms.', cast: () => ({
      ground: 610, weight: 10, style: 'block', figures: [
        fig({ name: 'Pro', x: 470, face: 'right', color: 'fg', steps: [{ do: 'point', dur: 1.5, say: 'Shorts win.' }, { do: 'punch', dur: 0.8 }, { do: 'point', dur: 1.4, say: 'Every time.' }] }, 0),
        fig({ name: 'Con', x: 820, face: 'left', color: 'accent', steps: [{ do: 'stand', dur: 1.2 }, { do: 'shrug', dur: 1.2, say: 'Long-form?' }, { do: 'facepalm', dur: 1.4 }] }, 1)
      ]
    })
  },
  {
    id: 'party', name: 'Dance party', blurb: 'Three figures dance, then bow.', cast: () => ({
      ground: 620, weight: 9, style: 'solid', figures: [0, 1, 2].map(i => fig({ name: ['Ana', 'Bo', 'Cy'][i], x: 360 + i * 280, h: 240, face: i === 2 ? 'left' : 'right', color: i === 1 ? 'accent' : 'fg', steps: [{ do: 'stand', dur: 0.2 * i }, { do: 'dance', dur: 2.6 }, { do: 'clap', dur: 1 }, { do: 'bow', dur: 1.5 }] }, i))
    })
  },
  {
    id: 'sneaky', name: 'Sneak and surprise', blurb: 'One sneaks up; the other jumps.', cast: () => ({
      ground: 610, weight: 10, style: 'round', figures: [
        fig({ name: 'Sneak', x: 160, face: 'right', color: 'fg', steps: [{ do: 'sneak', dur: 2.6, dx: 460 }, { do: 'stand', dur: 0.2 }, { do: 'cheer', dur: 1, say: 'Boo!' }] }, 0),
        fig({ name: 'Victim', x: 820, face: 'right', color: 'accent', steps: [{ do: 'lookout', dur: 2.8 }, { do: 'surprise', dur: 0.5, face: 'left' }, { do: 'jump', dur: 0.9 }, { do: 'run', dur: 1, dx: 420, face: 'right' }] }, 1)
      ]
    })
  }
];
