// Mirrors the Rust engine's scene model (src-tauri/crates/wcore/src/scene.rs). Field names are the
// engine's snake_case so a scene goes to the engine as-is.

export type Ease = 'linear' | 'quart-out' | 'quart-in' | 'quart-in-out' | 'cubic-out' | 'cubic-in' | 'back-out' | 'bounce-out' | 'elastic-out' | 'steps4' | 'steps8' | 'steps16';
export type Dir = 'left' | 'right' | 'up' | 'down';
export type Size = 'small' | 'medium' | 'big';
export type Blend = 'normal' | 'screen' | 'multiply' | 'add' | 'difference';
export type DitherKind = 'none' | 'bayer2' | 'bayer4' | 'bayer8' | 'blue-noise' | 'floyd-steinberg' | 'atkinson' | 'row';
export type Channel = 'horizon' | 'tide' | 'signal' | 'plasma' | 'rain' | 'iris' | 'bloom' | 'dunes' | 'tunnel' | 'clouds' | 'text' | 'logo' | 'static' | 'scan';
export type ShapeKind = 'rect' | 'rounded' | 'ellipse' | 'triangle' | 'star' | 'line' | 'arrow' | 'elbow' | 'bubble' | 'pin' | 'check' | 'cross' | 'burst' | 'heart' | 'cloud' | 'underline' | 'circle-it' | 'progress' | 'bracket' | 'spotlight';

export interface FxIn { id: string; dur: number; dir: Dir; size: Size; ease: Ease; delay: number }
export interface FxOn { id: string; amp: number; speed: number }
export interface FxOut { id: string; dur: number; dir: Dir; size: Size; ease: Ease }

export interface Tone { black: number; white: number; gamma: number; contrast: number; brightness: number; cutoff: number; invert: boolean }
export interface Band { color: string; at: number }
export interface Palette { id: string; name: string; bands: Band[]; smooth: boolean }
export interface GlyphStyle {
  font: string; cell: number; cell_w: number; cell_h: number; chars: string; sort_by_ink: boolean; reverse: boolean;
  pick: 'brightness' | 'random' | 'message'; message: string; flicker: number; tone: Tone; dither: DitherKind;
  dither_strength: number; dither_animate: boolean; palette: Palette; fill_cells: boolean; ink: string;
}
export interface FieldParams { channel: Channel; zoom: number; rotate: number; pan_x: number; pan_y: number; warp: number; detail: number; speed: number; direction: 'forward' | 'reverse' | 'ping-pong'; seed: number; loop_s: number }
export interface Screen { scanlines: number; scan_spacing: number; grain: number; glow: number; rgb_split: number; phosphor: number; vignette: number }
export interface TextStyle { font: string; size: number; tracking: number; line_height: number; align: 'left' | 'center' | 'right'; uppercase: boolean; color: string; shadow: string; shadow_dx: number; shadow_dy: number; plate: string; pad_x: number; pad_y: number }
export interface ShapeStyle { kind: ShapeKind; fill: string; stroke: string; stroke_w: number; param: number; pixel: number; shadow: string }
export interface Sprite { w: number; h: number; frames: string[]; palette: string[]; fps: number }

export type ObjKind =
  | { type: 'pixel-text'; text: string; font: 'five' | 'three'; px: number; color: string; shadow: string }
  | { type: 'text'; text: string; style: TextStyle }
  | { type: 'sprite'; sprite: Sprite; px: number; tint: string }
  | { type: 'ascii'; text: string; cell: number; font: string; color: string }
  | { type: 'ascii-banner'; text: string; cell: number; font: string; on: string; color: string }
  | { type: 'field'; w: number; h: number; style: GlyphStyle; field: FieldParams; source: string }
  | { type: 'shape'; style: ShapeStyle; w: number; h: number }
  | { type: 'card'; template: string; fields: Record<string, string>; look: string; colors: string };

export interface Obj {
  id: string; name: string; kind: ObjKind; x: number; y: number; scale: number; rot: number; opacity: number;
  start: number; dur: number; order: number; enter: FxIn; on: FxOn; exit: FxOut; blend: Blend; hidden: boolean;
  as_ascii: boolean; ascii_font: string; ascii_chars: string; cue: 'start' | 'with' | 'after' | string; gap: number;
  opacity_keys: [number, number][]; locked: boolean;
}
export interface Background { kind: 'clear' | 'solid' | 'sky' | 'paper' | string; color: string; color2: string }
export interface Scene { name: string; w: number; h: number; fps: number; dur: number; seed: number; grid: number; bg: Background; objects: Obj[]; screen: Screen; view?: [number, number, number, number] | null }

// Catalogue (from the engine's `catalogue` query).
export interface FxDef { id: string; name: string; slot: 'in' | 'on' | 'out'; family: 'clean' | 'pixel' | 'glyph' | 'fun' | 'shape' | 'text'; blurb: string; cell: boolean; has_dir: boolean }
export interface CardDef { id: string; name: string; blurb: string; category: string; fields: [string, string, string][]; dur: number }
export interface ColorSet { id: string; plate: string; onPlate: string; accent: string; ink: string; paper: string }
export interface FontDef { id: string; name: string; file: string; group: 'clean' | 'loud' | 'elegant' | 'retro' | 'hand' | 'code' | 'display'; mono: boolean; z: number }
export interface Look { id: string; name: string; style: GlyphStyle; field: FieldParams; screen: Screen }
export interface Catalogue {
  effects: FxDef[]; cards: CardDef[]; colorSets: ColorSet[]; fonts: FontDef[]; palettes: Palette[];
  charsets: { id: string; name: string; chars: string }[]; channels: { id: Channel; name: string; blurb: string }[];
  dithers: { id: DitherKind; name: string }[]; shapes: { id: ShapeKind; name: string; open: boolean }[];
  starters: { id: string; name: string; note: string; sprite: Sprite }[]; looks: Look[]; scenes: { id: string; name: string; blurb: string }[];
}

// ── defaults (match the engine's Default impls) ─────────────────────────────
export const IN = (id = 'wipe', o: Partial<FxIn> = {}): FxIn => ({ id, dur: 0.5, dir: 'right', size: 'medium', ease: 'quart-out', delay: 0, ...o });
export const ON = (id = 'none', o: Partial<FxOn> = {}): FxOn => ({ id, amp: 1, speed: 1, ...o });
export const OUT = (id = 'wipe', o: Partial<FxOut> = {}): FxOut => ({ id, dur: 0.35, dir: 'right', size: 'medium', ease: 'cubic-in', ...o });
export const TEXT_STYLE = (o: Partial<TextStyle> = {}): TextStyle => ({ font: 'archivo', size: 72, tracking: 0, line_height: 1.1, align: 'left', uppercase: false, color: '#FFFFFF', shadow: '', shadow_dx: 4, shadow_dy: 4, plate: '', pad_x: 0, pad_y: 0, ...o });
export const SHAPE_STYLE = (o: Partial<ShapeStyle> = {}): ShapeStyle => ({ kind: 'rect', fill: '#1E68F0', stroke: '', stroke_w: 0, param: 0, pixel: 0, shadow: '', ...o });
export const SCREEN = (o: Partial<Screen> = {}): Screen => ({ scanlines: 0, scan_spacing: 3, grain: 0, glow: 0, rgb_split: 0, phosphor: 0, vignette: 0, ...o });
export const TONE = (o: Partial<Tone> = {}): Tone => ({ black: 0, white: 1, gamma: 1, contrast: 0, brightness: 0, cutoff: 0, invert: false, ...o });
export const FIELD = (o: Partial<FieldParams> = {}): FieldParams => ({ channel: 'horizon', zoom: 1, rotate: 0, pan_x: 0, pan_y: 0, warp: 0, detail: 4, speed: 1, direction: 'forward', seed: 1, loop_s: 4, ...o });

let idn = 0;
export const newId = (p = 'o') => `${p}${Date.now().toString(36)}${(idn++).toString(36)}`;

export function obj(kind: ObjKind, o: Partial<Obj> = {}): Obj {
  return {
    id: newId(), name: 'Object', kind, x: 0, y: 0, scale: 1, rot: 0, opacity: 1, start: 0, dur: 0, order: 0,
    enter: IN(), on: ON(), exit: OUT(), blend: 'normal', hidden: false, as_ascii: false, ascii_font: 'jetbrains-mono',
    ascii_chars: ' .:-=+*#%@', cue: 'manual', gap: 0, opacity_keys: [], locked: false, ...o
  };
}
export const scene = (o: Partial<Scene> = {}): Scene => ({ name: 'Untitled', w: 1920, h: 1080, fps: 30, dur: 5, seed: 1, grid: 128, bg: { kind: 'clear', color: '#1E68F0', color2: '#1450C8' }, objects: [], screen: SCREEN(), ...o });

export const clone = <T,>(v: T): T => structuredClone(v);
/** Text an object shows, if it has any (for "Words" fields and layer names). */
export function textOf(o: Obj): string | null {
  const k = o.kind;
  return k.type === 'text' || k.type === 'pixel-text' || k.type === 'ascii-banner' || k.type === 'ascii' ? k.text : k.type === 'field' && (k.field.channel === 'text') ? k.source : null;
}
export function withText(o: Obj, text: string): Obj {
  const k = o.kind;
  if (k.type === 'text' || k.type === 'pixel-text' || k.type === 'ascii-banner' || k.type === 'ascii') return { ...o, kind: { ...k, text } };
  if (k.type === 'field') return { ...o, kind: { ...k, source: text } };
  return o;
}
