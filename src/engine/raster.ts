// Exact frame rasteriser for export. Renders a clip off-screen at stage scale 1, serialises the
// stage DOM into an SVG <foreignObject> (fonts embedded as data URLs, so nothing external), and
// draws it onto a canvas at the output resolution. Because the frame is vector until this point,
// 4K output is rendered at 4K, not upscaled. Background is dropped for transparent output.
import { createStage } from './stage';
import { typeVars } from './fonts';
import type { Clip } from './templates';
import { STAGE_H, STAGE_W } from './tokens';

export interface RasterOpts {
  width: number;
  height: number;
  fps: number;
  transparent: boolean;
  /** Seconds of the clip to render (default: whole clip). */
  from?: number;
  to?: number;
}

const fontCache = new Map<string, string>();
const toDataUrl = async (url: string) => {
  const hit = fontCache.get(url);
  if (hit) return hit;
  const blob = await (await fetch(url)).blob();
  const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob); });
  fontCache.set(url, data);
  return data;
};
const families = (stack: string) => stack.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

/** @font-face rules for the families a clip uses (Latin subsets), with sources inlined. */
async function embeddedFonts(clip: Clip): Promise<string> {
  const vars = typeVars(clip.props), want = new Set<string>(['Archivo Variable', 'Instrument Serif']);
  for (const [k, v] of Object.entries(vars)) if (k.endsWith('-f')) families(v).forEach(f => want.add(f));
  const rules: string[] = [];
  for (const sheet of [...document.styleSheets]) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; }
    for (const rule of [...list]) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const fam = rule.style.getPropertyValue('font-family').replace(/^['"]|['"]$/g, '');
      if (!want.has(fam)) continue;
      const src = rule.style.getPropertyValue('src'), m = /url\(["']?([^"')]+)["']?\)/.exec(src);
      if (!m || !/latin/.test(m[1])) continue;
      const url = new URL(m[1], sheet.href || location.href).href;
      const data = await toDataUrl(url);
      rules.push(rule.cssText.replace(/src:[^;]+;/, `src: url(${data});`));
    }
  }
  return rules.join('\n');
}

const decode = (img: HTMLImageElement, src: string) => new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('frame failed to rasterise')); img.src = src; });

/**
 * Render every frame of `clip`. Calls `onFrame` with the canvas for each frame in order; await it
 * to apply back-pressure (e.g. while the PNG is being written).
 */
export async function rasterize(clip: Clip, o: RasterOpts, onFrame: (canvas: HTMLCanvasElement, i: number, n: number) => Promise<void> | void, signal?: AbortSignal) {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-${STAGE_W * 4}px;top:0;width:${STAGE_W}px;height:${STAGE_H}px;pointer-events:none`;
  document.body.append(host);
  const stage = createStage(host);
  const canvas = document.createElement('canvas');
  canvas.width = o.width; canvas.height = o.height;
  const ctx = canvas.getContext('2d')!;
  const img = new Image();
  try {
    await document.fonts.ready;
    const fonts = await embeddedFonts(clip);
    const from = o.from ?? 0, to = o.to ?? clip.dur, n = Math.max(1, Math.round((to - from) * o.fps));
    const root = host.firstElementChild as HTMLElement;
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      stage.show(clip, from + i / o.fps, { transparent: o.transparent });
      const xhtml = new XMLSerializer().serializeToString(root);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${STAGE_W} ${STAGE_H}"><style>${fonts}</style><foreignObject x="0" y="0" width="${STAGE_W}" height="${STAGE_H}">${xhtml}</foreignObject></svg>`;
      // A data: URL (not blob:) keeps the canvas origin-clean, so frames can be read back as PNG.
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await decode(img, url);
      // WebKit can paint a foreignObject image before its webfonts are ready; the first frame decodes twice.
      if (i === 0) await decode(new Image(), url).then(() => decode(img, url));
      ctx.clearRect(0, 0, o.width, o.height);
      ctx.drawImage(img, 0, 0, o.width, o.height);
      await onFrame(canvas, i, n);
    }
  } finally {
    stage.destroy();
    host.remove();
  }
}

export const pngBytes = (canvas: HTMLCanvasElement) =>
  new Promise<Uint8Array<ArrayBuffer>>((res, rej) => canvas.toBlob(b => (b ? b.arrayBuffer().then(a => res(new Uint8Array(a)), rej) : rej(new Error('PNG encode failed'))), 'image/png'));
