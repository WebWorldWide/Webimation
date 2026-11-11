/// <reference lib="webworker" />
// Runs the Rust engine (wcore.wasm) off the main thread. Requests are answered in order; the main
// thread keeps at most one render in flight per view, so the queue never backs up.

interface Exports {
  memory: WebAssembly.Memory;
  wasm_alloc(len: number): number;
  wasm_free(ptr: number, len: number): void;
  load_font(id: number, idLen: number, data: number, len: number): number;
  render(json: number, len: number, t: number, w: number, h: number): number;
  render_png(json: number, len: number, t: number, w: number, h: number): number;
  query(json: number, len: number): number;
  out_len(): number;
}

let ex: Exports | null = null;
const enc = new TextEncoder(), dec = new TextDecoder();
// The last scene JSON is kept in wasm memory so scrubbing the same scene doesn't re-copy it.
let lastJson = '', lastPtr = 0, lastLen = 0;

function put(bytes: Uint8Array): [number, number] {
  const p = ex!.wasm_alloc(bytes.length);
  new Uint8Array(ex!.memory.buffer, p, bytes.length).set(bytes);
  return [p, bytes.length];
}
function sceneArg(json: string): [number, number] {
  if (json === lastJson && lastPtr) return [lastPtr, lastLen];
  if (lastPtr) ex!.wasm_free(lastPtr, lastLen);
  [lastPtr, lastLen] = put(enc.encode(json));
  lastJson = json;
  return [lastPtr, lastLen];
}
function query(req: string): string {
  const [p, n] = put(enc.encode(req));
  const out = ex!.query(p, n);
  const len = ex!.out_len();
  const s = dec.decode(new Uint8Array(ex!.memory.buffer, out, len));
  ex!.wasm_free(p, n);
  return s;
}

async function loadFont(base: string, id: string) {
  try {
    const r = await fetch(`${base}fonts/${id}.ttf`);
    if (!r.ok) return false;
    const data = new Uint8Array(await r.arrayBuffer());
    const idb = enc.encode(id);
    const [ip, il] = put(idb), [dp, dl] = put(data);
    const ok = ex!.load_font(ip, il, dp, dl) === 1;
    ex!.wasm_free(ip, il); ex!.wasm_free(dp, dl);
    return ok;
  } catch { return false; }
}

const FIRST = ['archivo', 'archivo-black', 'instrument-serif', 'press-start', 'permanent-marker', 'jetbrains-mono'];

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      const r = await fetch(`${m.base}wcore.wasm`);
      const { instance } = await WebAssembly.instantiate(await r.arrayBuffer(), {});
      ex = instance.exports as unknown as Exports;
      const cat = JSON.parse(query('{"op":"catalogue"}'));
      await Promise.all(FIRST.map(id => loadFont(m.base, id)));
      self.postMessage({ type: 'ready', catalogue: cat });
      // Everything else in the background; tell the UI so views redraw with the real faces.
      const rest = (cat.fonts as { id: string }[]).map(f => f.id).filter(id => !FIRST.includes(id));
      await Promise.all(rest.map(id => loadFont(m.base, id)));
      self.postMessage({ type: 'fonts' });
      return;
    }
    if (!ex) throw new Error('engine not ready');
    if (m.type === 'render') {
      const [p, n] = sceneArg(m.scene);
      const ptr = ex.render(p, n, m.t, m.w, m.h);
      if (!ptr) throw new Error('bad scene');
      const px = new Uint8ClampedArray(ex.memory.buffer, ptr, m.w * m.h * 4).slice();
      self.postMessage({ type: 'frame', id: m.id, w: m.w, h: m.h, px }, [px.buffer]);
    } else if (m.type === 'png') {
      const [p, n] = sceneArg(m.scene);
      const ptr = ex.render_png(p, n, m.t, m.w, m.h);
      if (!ptr) throw new Error('bad scene');
      const bytes = new Uint8Array(ex.memory.buffer, ptr, ex.out_len()).slice();
      self.postMessage({ type: 'png', id: m.id, bytes }, [bytes.buffer]);
    } else if (m.type === 'query') {
      self.postMessage({ type: 'reply', id: m.id, json: query(m.req) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, error: String(err) });
  }
};
