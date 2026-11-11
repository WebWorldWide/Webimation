// Export ("bounce"). Desktop: the Rust engine renders on every core and pipes frames into ffmpeg.
// Browser: frames render in the worker pool and download as a PNG-sequence zip.
import { isDesktop } from './desktop';
import { fcpxml, readme, xmeml, type TimelineItem } from './timelineXml';
import { renderPng } from './engine';
import type { Scene } from './types';

export type Format = 'prores' | 'hevc' | 'webm' | 'mp4' | 'png';
export const FORMATS: Record<Format, { label: string; ext: string; alpha: boolean; note: string }> = {
  prores: { label: 'ProRes 4444', ext: 'mov', alpha: true, note: 'Transparent .mov' },
  hevc: { label: 'HEVC with alpha', ext: 'mov', alpha: true, note: 'Transparent .mov, small files (Mac)' },
  webm: { label: 'WebM VP9', ext: 'webm', alpha: true, note: 'Transparent .webm' },
  mp4: { label: 'MP4 H.264', ext: 'mp4', alpha: false, note: 'No transparency' },
  png: { label: 'PNG frames', ext: '', alpha: true, note: 'PNG images, works anywhere' }
};

export type Editor = 'premiere' | 'resolve' | 'fcp' | 'capcut' | 'ae' | 'other';
export const EDITORS: Record<Editor, { name: string; format: Format; timeline: 'xmeml' | 'fcpxml' | null; steps: string[] }> = {
  premiere: { name: 'Premiere Pro', format: 'prores', timeline: 'xmeml', steps: ['Drag the clip onto track V2, above your footage.', 'Slide it to the moment it should appear.', "That's it. The see-through parts show your video."] },
  resolve: { name: 'DaVinci Resolve', format: 'prores', timeline: 'fcpxml', steps: ['Drag the clip from the Media Pool onto Video 2.', 'Line it up with the moment it should appear.', 'The background is already transparent. No keying needed.'] },
  fcp: { name: 'Final Cut Pro', format: 'prores', timeline: 'fcpxml', steps: ['Drag the clip above your primary storyline.', 'It connects to the shot underneath.', 'Transparency comes through automatically.'] },
  capcut: { name: 'CapCut', format: 'webm', timeline: null, steps: ['Import the clip, then drag it onto an overlay track.', 'Stretch it to fill the frame if needed.', 'The see-through parts show your video.'] },
  ae: { name: 'After Effects', format: 'prores', timeline: null, steps: ['Import the clip into your project.', 'Drag it into the comp above your footage.', 'Alpha is straight, so it interprets automatically.'] },
  other: { name: 'Something else', format: 'png', timeline: null, steps: ['Import the PNG folder as an image sequence.', 'Most editors spot the numbered frames automatically.', 'Each frame keeps its transparency.'] }
};

export type SizeId = '1080' | '4k' | 'vertical' | 'square';
export const SIZES: Record<SizeId, { label: string; note: string; w: number; h: number }> = {
  '1080': { label: 'Widescreen', note: '1080p, most videos', w: 1920, h: 1080 },
  '4k': { label: 'Widescreen 4K', note: 'Sharpest, bigger file', w: 3840, h: 2160 },
  vertical: { label: 'Vertical', note: 'Shorts, Reels, TikTok', w: 1080, h: 1920 },
  square: { label: 'Square', note: 'Feeds and posts', w: 1080, h: 1080 }
};

export interface BounceOpts { format: Format; size: SizeId; fps: number; out: string; from?: number; to?: number }
export interface Progress { done: number; total: number; fps: number }

const invoke = async <T,>(cmd: string, args?: unknown, opts?: { headers: Record<string, string> }) => (await import('@tauri-apps/api/core')).invoke<T>(cmd, args as never, opts);

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'Webimation clip';
export const fileFor = (dir: string, name: string, f: Format) => join(dir, FORMATS[f].ext ? `${safeName(name)}.${FORMATS[f].ext}` : safeName(name));
export const join = (dir: string, name: string) => dir.replace(/[\\/]+$/, '') + (dir.includes('\\') && !dir.includes('/') ? '\\' : '/') + name;

let outDir: Promise<string> | null = null;
export const defaultDir = () => (outDir ??= isDesktop ? invoke<string>('default_out_dir') : Promise.resolve('Downloads'));
export const engineInfo = () => (isDesktop ? invoke<{ fonts: number; threads: number; hevcAlpha: boolean }>('engine_info') : Promise.resolve({ fonts: 36, threads: navigator.hardwareConcurrency || 4, hevcAlpha: false }));

/** Fit a scene's design canvas to an output shape (vertical clips get a 1080×1920 canvas). */
export function fitScene(s: Scene, size: SizeId): Scene {
  const { w, h } = SIZES[size];
  const dw = w > h ? 1920 : 1080, dh = Math.round(dw * h / w);
  if (s.w === dw && s.h === dh) return s;
  // Re-centre content: keep each object's position relative to the middle of the frame.
  const kx = dw / s.w;
  return { ...s, w: dw, h: dh, objects: s.objects.map(o => ({ ...o, x: Math.round((o.x - s.w / 2) * Math.min(1, kx) + dw / 2), y: Math.round(o.y - s.h / 2 + dh / 2), scale: o.scale * Math.min(1, kx) })) };
}

let jobN = 0;
/** Bounce one scene. Resolves with the written path (or a description in the browser). */
export async function bounce(s: Scene, o: BounceOpts, onProgress: (p: Progress) => void, signal?: AbortSignal): Promise<string> {
  const { w, h } = SIZES[o.size];
  const scene = fitScene(s, o.size);
  if (isDesktop) {
    const { listen } = await import('@tauri-apps/api/event');
    const job = `b${Date.now().toString(36)}${jobN++}`;
    const un = await listen<{ job: string } & Progress>('bounce-progress', e => { if (e.payload.job === job) onProgress(e.payload); });
    const abort = () => { invoke('bounce_cancel', { job }).catch(() => {}); };
    signal?.addEventListener('abort', abort);
    try {
      return await invoke<string>('bounce', { job, scene: JSON.stringify(scene), fps: o.fps, width: w, height: h, format: o.format, out: o.out, from: o.from ?? null, to: o.to ?? null });
    } finally { un(); signal?.removeEventListener('abort', abort); }
  }
  // Browser: PNG zip, rendered across the worker pool a few frames at a time.
  const total = Math.max(1, Math.round(scene.dur * o.fps)), from = o.from ?? 0, to = Math.min(total, o.to ?? total), n = to - from;
  const files: { name: string; data: Uint8Array<ArrayBuffer> }[] = new Array(n);
  const json = JSON.stringify(scene), t0 = performance.now();
  let done = 0, next = from;
  const stem = safeName(scene.name).replace(/\s+/g, '-');
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < to) {
      if (signal?.aborted) throw new Error('cancelled');
      const i = next++;
      files[i - from] = { name: `${stem}_${String(i - from + 1).padStart(5, '0')}.png`, data: await renderPng(json, i / o.fps, w, h) };
      done++;
      if (done % 4 === 0 || done === n) onProgress({ done, total: n, fps: done / ((performance.now() - t0) / 1000) });
    }
  }));
  download(zip(files), `${stem}-png.zip`);
  return `${n} frames · ${stem}-png.zip`;
}

/** A finished clip's drag icon: a PNG still written next to the clip (desktop). */
export async function dragIcon(s: Scene, clipPath: string): Promise<string | null> {
  if (!isDesktop) return null;
  const png = await renderPng(s, Math.min(s.dur * 0.5, 2), 256, Math.round(256 * s.h / s.w));
  const path = clipPath.replace(/(\.[a-z0-9]+)?$/i, '') + '.drag.png';
  await invoke('write_file', png, { headers: { 'x-path': encodeURI(path) } });
  return path;
}
export async function startDrag(path: string, icon: string | null) {
  if (!isDesktop) return;
  const { startDrag: drag } = await import('@crabnebula/tauri-plugin-drag');
  await drag({ item: [path], icon: icon ?? path });
}
export async function reveal(path: string) {
  if (!isDesktop) return;
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}
export const writeText = (path: string, text: string) => (isDesktop ? invoke('write_text', { path, text }) : Promise.resolve(download(new Blob([text], { type: 'text/plain' }), path.split(/[\\/]/).pop()!)));
export async function pickFolder(): Promise<string | null> {
  if (!isDesktop) return 'Downloads';
  const { open } = await import('@tauri-apps/plugin-dialog');
  const d = await open({ directory: true, multiple: false, title: 'Bounce into…' });
  return typeof d === 'string' ? d : null;
}

/** Timeline files for an editor, placing each bounced clip at its start frame. */
export async function writeTimeline(name: string, dir: string, fps: number, size: SizeId, items: TimelineItem[]) {
  const { w, h } = SIZES[size];
  const spec = { name, dir, fps, width: w, height: h, items };
  const base = join(dir, safeName(name));
  await writeText(`${base}.fcpxml`, fcpxml(spec));
  await writeText(`${base}.xml`, xmeml(spec));
  await writeText(join(dir, 'README.txt'), readme(spec));
  return [`${base}.fcpxml`, `${base}.xml`];
}

// ── last export (one-click "Export like last time") ──────────────────────────
export interface LastExport { editor: Editor; size: SizeId; fps: number; format: Format }
const LAST = 'webimation.lastExport.v1';
export const lastExport = (): LastExport | null => { try { return JSON.parse(localStorage.getItem(LAST) || 'null'); } catch { return null; } };
export const rememberExport = (e: LastExport | null) => { try { if (e) localStorage.setItem(LAST, JSON.stringify(e)); else localStorage.removeItem(LAST); } catch { /* blocked */ } };

// ── browser fallback zip (stored; PNGs are already compressed) ───────────────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files: { name: string; data: Uint8Array<ArrayBuffer> }[]): Blob {
  const parts: BlobPart[] = [], central: Uint8Array<ArrayBuffer>[] = [];
  let off = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name), crc = crc32(f.data), hd = new DataView(new ArrayBuffer(30));
    hd.setUint32(0, 0x04034b50, true); hd.setUint16(4, 20, true); hd.setUint32(14, crc, true); hd.setUint32(18, f.data.length, true); hd.setUint32(22, f.data.length, true); hd.setUint16(26, name.length, true);
    parts.push(hd.buffer, name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + f.data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Save a file the user names (desktop: native Save dialog; browser: download). */
export async function saveAs(name: string, data: Uint8Array<ArrayBuffer> | string, ext: string) {
  if (!isDesktop) { download(new Blob([data], { type: typeof data === 'string' ? 'text/plain' : 'image/png' }), name); return name; }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (!path) return null;
  if (typeof data === 'string') await invoke('write_text', { path, text: data });
  else await invoke('write_file', data, { headers: { 'x-path': encodeURI(path) } });
  return path;
}
