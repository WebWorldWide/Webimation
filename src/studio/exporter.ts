// Export graphics as files for a real video editor.
// Desktop: frames stream to the Rust side, which writes a PNG sequence or encodes ProRes 4444 /
// WebM / MP4 with the system's ffmpeg. Browser: PNG sequence in a .zip download.
import { pngBytes, rasterize, type Clip } from '../engine';
import { isDesktop } from './desktop';

export const FORMATS = {
  prores: { label: 'ProRes 4444', note: 'alpha · .mov', alpha: true, ext: 'mov', video: true },
  png: { label: 'PNG sequence', note: 'alpha · any editor', alpha: true, ext: '', video: false },
  webm: { label: 'WebM VP9', note: 'alpha · web', alpha: true, ext: 'webm', video: true },
  mp4: { label: 'MP4 H.264', note: 'no alpha · .mp4', alpha: false, ext: 'mp4', video: true }
} as const;
export type FormatId = keyof typeof FORMATS;
export const SIZES = { 720: [1280, 720], 1080: [1920, 1080], 1440: [2560, 1440], 2160: [3840, 2160] } as const;
export type SizeId = keyof typeof SIZES;
export const FPS_OPTIONS = [24, 25, 30, 50, 60] as const;

export interface ExportSettings { format: FormatId; size: SizeId; fps: number; transparent: boolean }

const invoke = async <T,>(cmd: string, args?: unknown, opts?: { headers: Record<string, string> }) =>
  (await import('@tauri-apps/api/core')).invoke<T>(cmd, args as never, opts);

let ff: Promise<string | null> | null = null;
/** Path of the system ffmpeg (desktop only), or null. */
export const ffmpegPath = () => (ff ??= isDesktop ? invoke<string | null>('ffmpeg_status').catch(() => null) : Promise.resolve(null));
export const canExport = async (f: FormatId) => !FORMATS[f].video || !!(await ffmpegPath());

export const slug = (s: string) => s.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'graphic';
const join = (dir: string, name: string) => dir + (dir.includes('\\') && !dir.includes('/') ? '\\' : '/') + name;

/** Ask where to save. Returns a file path (video) or folder path (PNG sequence), or null. */
export async function pickDestination(s: ExportSettings, name: string, many: boolean): Promise<string | null> {
  if (!isDesktop) return 'download';
  const { open, save } = await import('@tauri-apps/plugin-dialog');
  if (many || !FORMATS[s.format].video) {
    const dir = await open({ directory: true, multiple: false, title: many ? 'Export graphics into…' : 'Export PNG sequence into…' });
    return typeof dir === 'string' ? dir : null;
  }
  const F = FORMATS[s.format];
  return save({ defaultPath: `${slug(name)}.${F.ext}`, filters: [{ name: F.label, extensions: [F.ext] }] });
}

/** Where a clip lands inside a folder chosen for a batch / PNG export. */
export const inFolder = (dir: string, s: ExportSettings, name: string) => join(dir, FORMATS[s.format].video ? `${slug(name)}.${FORMATS[s.format].ext}` : slug(name));

/** Render one clip and write it. `dest` is a file (video), a folder (PNG), or 'download' (browser). */
export async function exportClip(clip: Clip, s: ExportSettings, dest: string, name: string, onProgress: (p: number) => void, signal?: AbortSignal): Promise<string> {
  const [width, height] = SIZES[s.size], F = FORMATS[s.format];
  const opts = { width, height, fps: s.fps, transparent: s.transparent && F.alpha };
  if (!isDesktop) {
    const files: { name: string; data: Uint8Array<ArrayBuffer> }[] = [];
    await rasterize(clip, opts, async (cv, i, n) => {
      files.push({ name: `${slug(name)}_${String(i + 1).padStart(5, '0')}.png`, data: await pngBytes(cv) });
      onProgress((i + 1) / n);
    }, signal);
    download(zip(files), `${slug(name)}-png.zip`);
    return `${files.length} frames · ${slug(name)}-png.zip`;
  }
  const id = await invoke<string>('export_begin');
  try {
    await rasterize(clip, opts, async (cv, i, n) => {
      await invoke('export_frame', await pngBytes(cv), { headers: { 'x-export-id': id, 'x-index': String(i) } });
      onProgress(((i + 1) / n) * (F.video ? 0.92 : 0.98));
    }, signal);
    const out = await invoke<string>('export_finish', { id, format: s.format, fps: s.fps, out: dest, stem: slug(name) });
    onProgress(1);
    return out;
  } catch (e) {
    await invoke('export_cancel', { id }).catch(() => {});
    throw e;
  }
}

// ── browser fallback: stored (uncompressed) zip; PNGs are already compressed ──
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files: { name: string; data: Uint8Array<ArrayBuffer> }[]): Blob {
  const parts: BlobPart[] = [], central: Uint8Array<ArrayBuffer>[] = [];
  let off = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
    parts.push(h.buffer, name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + f.data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
