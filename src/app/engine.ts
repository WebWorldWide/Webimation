// Main-thread side of the engine. A small pool of workers each run the wasm engine; previews use
// worker 0 so scrubbing is ordered, thumbnails and browser export spread across the rest.
import type { Catalogue, Scene } from './types';

type Pending = { resolve: (v: any) => void; reject: (e: unknown) => void };
interface W { w: Worker; ready: Promise<Catalogue>; pending: Map<number, Pending>; busy: number }

const BASE = `${import.meta.env.BASE_URL}engine/`;
const POOL = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
let seq = 1;
let workers: W[] = [];
const fontListeners = new Set<() => void>();
export let fontsReady = false;

function spawn(): W {
  const w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, Pending>();
  let resolveReady!: (c: Catalogue) => void, rejectReady!: (e: unknown) => void;
  const ready = new Promise<Catalogue>((a, b) => { resolveReady = a; rejectReady = b; });
  const me: W = { w, ready, pending, busy: 0 };
  w.onmessage = e => {
    const m = e.data;
    if (m.type === 'ready') return resolveReady(m.catalogue);
    if (m.type === 'fonts') { if (me === workers[0]) { fontsReady = true; fontListeners.forEach(f => f()); } return; }
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id); me.busy--;
    if (m.type === 'error') p.reject(new Error(m.error));
    else if (m.type === 'frame') p.resolve(new ImageData(m.px, m.w, m.h));
    else if (m.type === 'png') p.resolve(m.bytes);
    else p.resolve(JSON.parse(m.json));
  };
  w.onerror = e => rejectReady(e);
  w.postMessage({ type: 'init', base: BASE });
  return me;
}

export function startEngine(): Promise<Catalogue> {
  if (!workers.length) workers = Array.from({ length: POOL }, spawn);
  return workers[0].ready;
}
export const onFonts = (f: () => void) => { fontListeners.add(f); return () => { fontListeners.delete(f); }; };

function call<T>(wi: number, msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const w = workers[wi] ?? workers[0];
  const id = seq++;
  w.busy++;
  return w.ready.then(() => new Promise<T>((resolve, reject) => { w.pending.set(id, { resolve, reject }); w.w.postMessage({ ...msg, id }, transfer); }));
}
/** Least busy worker other than the preview worker (falls back to 0 with a pool of one). */
const spare = () => { if (workers.length < 2) return 0; let best = 1; for (let i = 2; i < workers.length; i++) if (workers[i].busy < workers[best].busy) best = i; return best; };

const json = (s: Scene | string) => (typeof s === 'string' ? s : JSON.stringify(s));
/** Render a frame on the preview worker. */
export const renderFrame = (s: Scene | string, t: number, w: number, h: number) => call<ImageData>(0, { type: 'render', scene: json(s), t, w, h });
/** Render a frame on a background worker (thumbnails). */
export const renderThumb = (s: Scene | string, t: number, w: number, h: number) => call<ImageData>(spare(), { type: 'render', scene: json(s), t, w, h });
export const renderPng = (s: Scene | string, t: number, w: number, h: number, wi = spare()) => call<Uint8Array<ArrayBuffer>>(wi, { type: 'png', scene: json(s), t, w, h });
export const query = <T = any,>(req: Record<string, unknown>) => call<T>(0, { type: 'query', req: JSON.stringify(req) });
export const poolSize = () => workers.length;

export const bounds = (s: Scene) => query<Record<string, [number, number, number, number]>>({ op: 'bounds', scene: s });
export const coverage = (s: Scene, t: number) => query<Record<string, number>>({ op: 'coverage', scene: s, t });
export const frameText = (s: Scene, t: number, cols = 120, ramp = ' .:-=+*#%@') => query<{ text: string }>({ op: 'frameText', scene: s, t, cols, ramp }).then(r => r.text);
export const histogram = (s: Scene, t: number) => query<{ bins: number[] }>({ op: 'histogram', scene: s, t }).then(r => r.bins);
export const loadScene = (id: string) => query<Scene>({ op: 'scene', id });
