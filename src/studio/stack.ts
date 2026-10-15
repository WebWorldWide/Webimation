// Layer stacking rules for the Studio timeline.
// A clip's `track` is its layer (0 = bottom). Clips on the same layer never overlap in time; when a
// clip would, it moves up to the lowest free layer. Clips that overlap in time form a stack, and a
// stack plays, previews and exports together.
import type { Clip } from '../engine';

export const MAX_LAYERS = 8;
export const trackOf = (c: Clip) => c.track ?? 0;
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 - 1e-6 && b0 < a1 - 1e-6;

/** Lowest layer (at or above `from`) with nothing in [start, end), ignoring clip `except`. */
export function freeTrack(clips: Clip[], start: number, end: number, from = 0, except?: string): number {
  for (let tr = from; tr < MAX_LAYERS; tr++) {
    if (!clips.some(c => c.id !== except && trackOf(c) === tr && overlaps(start, end, c.start, c.start + c.dur))) return tr;
  }
  return MAX_LAYERS - 1;
}

/** After a move/trim/add: if clip `id` collides on its layer, lift it to the nearest free layer above. */
export function settle(clips: Clip[], id: string): Clip[] {
  const c = clips.find(x => x.id === id);
  if (!c) return clips;
  const tr = freeTrack(clips, c.start, c.start + c.dur, trackOf(c), id);
  return compact(tr === trackOf(c) ? clips : clips.map(x => (x.id === id ? { ...x, track: tr } : x)));
}

/** Remove empty layers so the stack never has gaps (layer numbers stay 0..n-1). */
export function compact(clips: Clip[]): Clip[] {
  const used = [...new Set(clips.map(trackOf))].sort((a, b) => a - b), map = new Map(used.map((t, i) => [t, i]));
  return clips.map(c => (map.get(trackOf(c)) === trackOf(c) ? c : { ...c, track: map.get(trackOf(c)) }));
}

/** Graphics on screen at time t, bottom → top. */
export const activeAt = (clips: Clip[], t: number) =>
  clips.filter(c => t >= c.start && t < c.start + c.dur).sort((a, b) => trackOf(a) - trackOf(b) || a.start - b.start);

/** Everything stacked with `sel`: all clips connected to it by overlapping in time. */
export function stackOf(clips: Clip[], sel: Clip): Clip[] {
  const out = new Set([sel]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of clips) if (!out.has(c) && [...out].some(o => overlaps(c.start, c.start + c.dur, o.start, o.start + o.dur))) { out.add(c); grew = true; }
  }
  return [...out].sort((a, b) => trackOf(a) - trackOf(b) || a.start - b.start);
}
export const spanOf = (cs: Clip[]) => ({ start: Math.min(...cs.map(c => c.start)), end: Math.max(...cs.map(c => c.start + c.dur)) });

/** Move a clip one layer up (+1) or down (−1), swapping with whatever is in the way. */
export function shiftLayer(clips: Clip[], id: string, dir: 1 | -1): Clip[] {
  const c = clips.find(x => x.id === id);
  if (!c) return clips;
  const to = trackOf(c) + dir;
  if (to < 0 || to >= MAX_LAYERS) return clips;
  const end = c.start + c.dur, blockers = clips.filter(x => x.id !== id && trackOf(x) === to && overlaps(c.start, end, x.start, x.start + x.dur));
  const from = trackOf(c);
  // Swap only if the blockers fit on our old layer; otherwise just lift and let settle sort it out.
  const fits = blockers.every(b => !clips.some(x => x.id !== id && x.id !== b.id && trackOf(x) === from && overlaps(b.start, b.start + b.dur, x.start, x.start + x.dur)));
  const next = clips.map(x => (x.id === id ? { ...x, track: to } : fits && blockers.includes(x) ? { ...x, track: from } : x));
  return fits ? compact(next) : settle(next, id);
}
