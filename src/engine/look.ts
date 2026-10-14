// Per-graphic look: colours, field (background) and placement. Everything resolves to CSS
// variables on the clip's layer, so templates only ever say var(--w-fg), var(--w-plate), …
import { ACC, BLUE, INK, STAGE_H, STAGE_W } from './tokens';

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = (hex: string) => {
  const c = rgb(hex).map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const alpha = (hex: string, a: number) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
/** Ink or white, whichever reads better on `bg`. */
export const inkOn = (bg: string) => (contrast(bg, INK) >= contrast(bg, '#FFFFFF') ? INK : '#FFFFFF');

/** Accent: a palette id or any #rrggbb. */
export const accentHex = (a: string | undefined) => (a && HEX.test(a) ? a.toUpperCase() : ACC[a as keyof typeof ACC] || ACC.orange);
/** Text on the accent. Palette accents keep the design's pairing (white on purple); custom hexes pick by contrast. */
export const onAccent = (a: string | undefined) => (a === 'purple' ? '#FFFFFF' : a && HEX.test(a) ? inkOn(a) : INK);

// ── fields ─────────────────────────────────────────────────────────────────
export interface FieldDef { id: string; name: string; base: (accent: string) => string; light: boolean; grid: boolean; swatch: string }
const gridLines = (a: number, light: boolean) => {
  const c = light ? `rgba(11,11,12,${a})` : `rgba(255,255,255,${a})`;
  return `background-image:linear-gradient(${c} 1px,transparent 1px),linear-gradient(90deg,${c} 1px,transparent 1px);background-size:80px 80px;background-position:-1px -1px;`;
};
export const FIELDS: FieldDef[] = [
  { id: 'blue', name: 'Blue', base: () => `background-color:${BLUE};`, light: false, grid: true, swatch: BLUE },
  { id: 'ink', name: 'Ink', base: () => `background-color:${INK};`, light: false, grid: true, swatch: INK },
  { id: 'night', name: 'Night', base: () => 'background-color:#0E1B3D;', light: false, grid: true, swatch: '#0E1B3D' },
  { id: 'accent', name: 'Accent', base: a => `background-color:${a};`, light: false, grid: false, swatch: 'accent' },
  { id: 'dusk', name: 'Dusk', base: () => 'background-color:#1E68F0;background-image:linear-gradient(135deg,#1E68F0 0%,#8B5CF6 100%);', light: false, grid: false, swatch: 'linear-gradient(135deg,#1E68F0,#8B5CF6)' },
  { id: 'ember', name: 'Ember', base: () => 'background-color:#FF8A1F;background-image:linear-gradient(135deg,#FF8A1F 0%,#E8433A 100%);', light: false, grid: false, swatch: 'linear-gradient(135deg,#FF8A1F,#E8433A)' },
  { id: 'paper', name: 'Paper', base: () => 'background-color:#F3EFE6;', light: true, grid: false, swatch: '#F3EFE6' },
  { id: 'white', name: 'White', base: () => 'background-color:#FFFFFF;', light: true, grid: true, swatch: '#FFFFFF' },
  { id: 'clear', name: 'Clear', base: () => 'background-color:#1C1C1F;background-image:conic-gradient(#26262A 25%,transparent 0 50%,#26262A 0 75%,transparent 0);background-size:32px 32px;', light: false, grid: false, swatch: 'conic-gradient(#26262A 25%,#1C1C1F 0 50%,#26262A 0 75%,#1C1C1F 0) 0 0/10px 10px' }
];
export const FIELD_BY: Record<string, FieldDef> = Object.fromEntries(FIELDS.map(f => [f.id, f]));

/** Background CSS for the layer. Grid lines layer over flat fields when enabled. */
export function fieldCss(P: Record<string, string>) {
  const f = FIELD_BY[P.field] || FIELD_BY.blue, a = accentHex(P.accent);
  const grid = P.grid ? P.grid === '1' : f.grid;
  const base = f.base(a), light = f.id === 'accent' ? inkOn(a) === INK : f.light;
  if (!grid || f.id === 'clear' || base.includes('background-image')) return { css: base, light };
  return { css: base + gridLines(light ? 0.07 : f.id === 'blue' ? 0.08 : 0.05, light), light };
}

/** Colour roles for the graphic. `fg` text on the field; `plate` boxes; `plate2` the secondary box. */
export function colorVars(P: Record<string, string>): Record<string, string> {
  const a = accentHex(P.accent), { light } = fieldCss(P);
  const pick = (v: string | undefined, auto: string) => (!v || v === 'auto' ? auto : v === 'white' ? '#FFFFFF' : v === 'ink' ? INK : v === 'accent' ? a : HEX.test(v) ? v : auto);
  const fg = pick(P.fg, light ? INK : '#FFFFFF');
  const plate = pick(P.plate, light ? INK : '#FFFFFF');
  const plate2 = plate.toUpperCase() === INK ? (light ? a : '#FFFFFF') : INK;
  return {
    '--w-fg': fg, '--w-dim': alpha(fg, 0.7), '--w-rule': alpha(fg, 0.35),
    '--w-plate': plate, '--w-plate-fg': inkOn(plate), '--w-plate2': plate2, '--w-plate2-fg': inkOn(plate2)
  };
}

// ── placement ──────────────────────────────────────────────────────────────
export const ANCHORS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'] as const;
export type Anchor = (typeof ANCHORS)[number];
/** Title-safe box the anchors align to (the templates' own 96 px side margins). */
export const SAFE = { x0: 96, y0: 72, x1: STAGE_W - 96, y1: STAGE_H - 72 };

/**
 * Transform for the template's content so its visible bounding box lands on `anchor` inside the
 * title-safe area, at `size`, nudged by (nx, ny). Translations are whole stage pixels, so at size 1
 * every edge stays exactly on the pixel grid.
 */
export function placement(P: Record<string, string>, box: { x0: number; y0: number; x1: number; y1: number }) {
  const size = Math.min(2, Math.max(0.4, parseFloat(P.size) || 1)), nx = Math.round(parseFloat(P.nx) || 0), ny = Math.round(parseFloat(P.ny) || 0);
  const anchor = (ANCHORS as readonly string[]).includes(P.place) ? (P.place as Anchor) : null;
  const fx = anchor ? ({ l: 0, c: 0.5, r: 1 } as const)[anchor[1] as 'l' | 'c' | 'r'] : 0;
  const fy = anchor ? ({ t: 0, m: 0.5, b: 1 } as const)[anchor[0] as 't' | 'm' | 'b'] : 0;
  // Pivot: the anchor point of the content box (or its top-left when the template keeps its own spot).
  const px = box.x0 + (box.x1 - box.x0) * fx, py = box.y0 + (box.y1 - box.y0) * fy;
  let dx = nx, dy = ny;
  if (anchor) {
    dx += Math.round(SAFE.x0 + (SAFE.x1 - SAFE.x0) * fx - px);
    dy += Math.round(SAFE.y0 + (SAFE.y1 - SAFE.y0) * fy - py);
  }
  const identity = !dx && !dy && size === 1;
  return { identity, size, transform: `translate(${dx}px,${dy}px) scale(${size})`, origin: `${px}px ${py}px` };
}
