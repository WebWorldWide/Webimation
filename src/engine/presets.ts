// Motion presets. A preset is a recipe: which effect enters, which leaves, on what curve,
// in what order, at what pace. The library is minted from every effect family's parameter
// space, plus a hand-tuned signature set, plus anything you save from the Motion Lab.
import { EASES, type EaseId } from './easing';
import { EFFECTS, FX, GROUPS, defaultParams, type EffectDef, type Group, type Params } from './effects';
import { ORDER_LABEL, ORDERS, rng, hash, type Order } from './rand';

export interface FxRef { fx: string; p: Params }
export type PresetGroup = Group | 'Signature' | 'Custom';
export const PRESET_GROUPS: PresetGroup[] = ['Signature', ...GROUPS, 'Custom'];

export interface Preset {
  id: string;
  name: string;
  group: PresetGroup;
  enter: FxRef;
  /** Leave with a different effect. Omitted: the enter effect's own exit. */
  exit?: FxRef;
  ease: EaseId;
  order: Order;
  /** Overrides the family's stagger spread (0..0.95). */
  spread?: number;
  /** Multiplies the template's start cues (stagger between elements). */
  gap: number;
  /** Multiplies each element's enter duration. */
  pace: number;
  /** Exit window in seconds (house default 0.35) and per-element exit stagger. */
  exitDur: number;
  exitGap: number;
  blurb?: string;
  custom?: boolean;
}

const BASE = { ease: 'out' as EaseId, order: 'seq' as Order, gap: 1, pace: 1, exitDur: 0.35, exitGap: 0 };

const combos = (d: EffectDef): Params[] =>
  d.params.reduce<Params[]>((acc, q) => acc.flatMap(p => q.options.map(o => ({ ...p, [q.key]: o }))), [{}]);
const variantId = (d: EffectDef, p: Params) => [d.id, ...d.params.map(q => String(p[q.key]))].join('-');
const variantName = (d: EffectDef, p: Params) => (d.variant && d.params.length ? `${d.name} ${d.variant(p)}` : d.name);

/** Every family × every parameter combination × its useful stagger orders, plus stepped cuts. */
function mintLibrary(): Preset[] {
  const out: Preset[] = [];
  for (const d of EFFECTS) {
    const orders = d.orders?.length ? d.orders : ['seq' as Order];
    for (const p of combos(d)) {
      const id = variantId(d, p), name = variantName(d, p), blurb = d.blurb;
      orders.forEach((o, i) => out.push({
        ...BASE, id: i ? `${id}~${o}` : id, name: i ? `${name} · ${ORDER_LABEL[o].toLowerCase()}` : name,
        group: d.group, enter: { fx: d.id, p }, order: o, blurb
      }));
      if (d.stepped) out.push({ ...BASE, id: `${id}+step`, name: `${name} · stepped`, group: d.group, enter: { fx: d.id, p }, ease: 'step8', blurb: blurb + ' Quantised to 8 hard steps.' });
    }
  }
  return out;
}

const sig = (id: string, name: string, enter: [string, Params?], o: Partial<Preset> & { exit_?: [string, Params?] } = {}): Preset => {
  const { exit_, ...rest } = o;
  const ref = ([fx, p]: [string, Params?]): FxRef => ({ fx, p: { ...defaultParams(FX[fx]), ...p } });
  return { ...BASE, id: 'sig-' + id, name, group: 'Signature', enter: ref(enter), ...(exit_ ? { exit: ref(exit_) } : {}), ...rest };
};

/** Hand-tuned recipes that mix families, curves and pacing. */
export const SIGNATURE: Preset[] = [
  sig('broadcast', 'Broadcast', ['leader', { dir: 'right', color: 'accent' }], { exit_: ['wipe', { dir: 'right' }], blurb: 'Accent plate leads every element on; a clean wipe takes them off.' }),
  sig('stagehand', 'Stagehand', ['double', { dir: 'right' }], { gap: 1.2, exitGap: 0.04, blurb: 'Accent, then white, then content. Elements leave one after another.' }),
  sig('ledger', 'Ledger', ['blinds', { axis: 'h', n: 10 }], { exit_: ['stairs', { dir: 'up', n: 8 }], blurb: 'Ten slats rule the content in; a staircase lifts it out.' }),
  sig('morton', 'Morton', ['raster', { tile: 12 }], { pace: 1.5, exit_: ['dissolve', { tile: 24 }], blurb: 'GPU tile raster with a white scan front, out through a hard dissolve.' }),
  sig('teletype', 'Teletype', ['type', { caret: 'accent' }], { pace: 1.8, gap: 1.3, blurb: 'Typed on behind an accent caret, backspaced off.' }),
  sig('departures', 'Departures', ['flap', { rate: 30 }], { pace: 1.6, exit_: ['blinds', { axis: 'h', n: 4 }], blurb: 'Split-flap board that shutters off.' }),
  sig('cipher', 'Cipher', ['decode', { set: 'glyph' }], { order: 'random', pace: 1.6, blurb: 'Scrambled glyphs lock in at random and unlock on the way out.' }),
  sig('classified', 'Classified', ['redact', { color: 'ink' }], { pace: 1.4, exit_: ['leader', { dir: 'right', color: 'ink' }], blurb: 'Every word un-redacts; an ink plate wipes it all back out.' }),
  sig('highlighter', 'Highlighter', ['redact', { color: 'accent' }], { pace: 1.3, blurb: 'An accent bar passes over each word as it lands.' }),
  sig('monolith', 'Monolith', ['split', { axis: 'v' }], { exit_: ['converge', { axis: 'v' }], ease: 'io', blurb: 'Opens from a horizon line, closes from top and bottom.' }),
  sig('aperture', 'Aperture', ['iris', { from: 'c' }], { ease: 'step16', blurb: 'Square iris in 16 hard steps; exits through a square hole.' }),
  sig('sundial', 'Sundial', ['clock', { start: 'top', turn: 'cw' }], { pace: 1.3, blurb: 'One clean sweep of the hand per element.' }),
  sig('downpour', 'Downpour', ['rain', { tile: 16 }], { pace: 1.4, exit_: ['stairs', { dir: 'down', n: 16 }], blurb: 'Columns fill like rain and drain away in a staircase.' }),
  sig('mosaic', 'Mosaic', ['bloom', { tile: 20 }], { exit_: ['sweep', { from: 'br', tile: 16 }], blurb: 'Tiles bloom from the centre, swept away from the corner.' }),
  sig('slot', 'Slot machine', ['chars', { dir: 'up' }], { order: 'random', spread: 0.75, exit_: ['mask', { dir: 'up' }], blurb: 'Glyphs land at random like reels stopping.' }),
  sig('marquee', 'Marquee', ['words', { dir: 'right' }], { exit_: ['push', { dir: 'right' }], gap: 1.2, blurb: 'Words slide in from the left; pushed off to the right.' }),
  sig('telex', 'Telex', ['charcut', {}], { order: 'seq', spread: 0.95, pace: 1.5, exit_: ['cut'], blurb: 'Glyph-by-glyph frame cuts, all cut away together.' }),
  sig('strobe', 'Strobe', ['flash', { color: 'white', frames: 2 }], { exit_: ['flash', { color: 'accent', frames: 2 }], gap: 1.4, blurb: 'Two-frame white flash on, two-frame accent flash off.' }),
  sig('register', 'Off-register', ['jolt', { axis: 'h' }], { exit_: ['jolt', { axis: 'v' }], blurb: 'Snaps home in three frames, kicks out vertically.' }),
  sig('punch', 'Punch-in', ['zoom', { from: 'in' }], { exit_: ['wipe', { dir: 'left' }], blurb: 'Cuts in at 130%, settles, wipes away.' }),
  sig('checkout', 'Checkout', ['barcode', { n: 24 }], { exit_: ['scan', { dir: 'right', color: 'accent' }], blurb: 'Barcode bars cut on; an accent scanner wipes them off.' }),
  sig('cascade', 'Cascade', ['stairs', { dir: 'down', n: 16 }], { order: 'rev', exitGap: 0.05, blurb: 'A sixteen-step staircase from the right.' }),
  sig('ripple', 'Ripple', ['sweep', { from: 'tl', tile: 16 }], { ease: 'io', blurb: 'Diagonal tile wave in and out.' }),
  sig('interlock', 'Interlock', ['zipper', { axis: 'v', n: 8 }], { ease: 'step8', blurb: 'Eight columns zip from top and bottom in hard steps.' }),
  sig('crosshair', 'Crosshair', ['cross', {}], { pace: 1.3, exit_: ['iris', { from: 'c' }], blurb: 'A hairline plus finds the centre, then floods the box.' }),
  sig('gem', 'Gemstone', ['diamond', {}], { exit_: ['diamond'], ease: 'io', blurb: 'Diamond in, diamond hole out.' }),
  sig('tickertape', 'Tickertape', ['lines', { dir: 'up' }], { gap: 1.4, pace: 0.8, exitGap: 0.05, blurb: 'Brisk line rises, staggered exits.' }),
  sig('encore', 'Encore', ['chars', { dir: 'up' }], { order: 'center', exitGap: 0.06, exit_: ['stairs', { dir: 'up', n: 8 }], blurb: 'Glyphs rise from the middle out; elements step off one by one.' }),
  sig('newsroom', 'Newsroom', ['scan', { dir: 'down', color: 'white' }], { exit_: ['blinds', { axis: 'h', n: 6 }], blurb: 'A white scan line prints each element top to bottom.' }),
  sig('pressroom', 'Pressroom', ['wordflash', { color: 'accent' }], { order: 'seq', pace: 1.3, blurb: 'Each word punches on reversed out of accent for two frames.' }),
  sig('swift', 'Swift wipe', ['wipe', { dir: 'right' }], { gap: 0.55, pace: 0.6, blurb: 'The house wipe at double speed with tight cues.' }),
  sig('unhurried', 'Unhurried mask', ['mask', { dir: 'up' }], { gap: 1.6, pace: 1.5, exitGap: 0.08, blurb: 'The house mask, slowed and spaced out, leaving one by one.' }),
  sig('checkmate', 'Checkmate', ['checker', { cell: 48, dir: 'down' }], { exit_: ['checker', { cell: 96, dir: 'right' }], blurb: 'Two passes of checkerboard, out through a bigger board.' }),
  sig('vortex', 'Vortex', ['spiral', { way: 'out', tile: 20 }], { exit_: ['spiral', { way: 'in', tile: 20 }], blurb: 'Spirals out from the middle and back in.' })
];

/** The Studio's three base reveals keep their short ids. */
const ALIAS: Record<string, string> = { wipe: 'wipe-right', mask: 'mask-up', cut: 'cut' };
export const BASE_REVEALS = [['wipe', 'Wipe'], ['mask', 'Mask'], ['cut', 'Cut']] as const;

export const LIBRARY: Preset[] = [...SIGNATURE, ...mintLibrary()];
const byId = new Map(LIBRARY.map(p => [p.id, p]));

// ── custom presets (Motion Lab) ────────────────────────────────────────────

const KEY = 'webimation.motion.custom.v1';
let custom: Preset[] = [];
const subs = new Set<() => void>();
try { custom = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem('plotline.motion.custom.v1') || '[]'); } catch { custom = []; }
const persist = () => {
  try { localStorage.setItem(KEY, JSON.stringify(custom)); } catch { /* storage full or blocked */ }
  subs.forEach(f => f());
};
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const customPresets = () => custom;
export const saveCustom = (p: Preset) => {
  const q = { ...p, group: 'Custom' as const, custom: true };
  custom = [q, ...custom.filter(c => c.id !== q.id)];
  persist();
  return q;
};
export const deleteCustom = (id: string) => { custom = custom.filter(c => c.id !== id); persist(); };
export const allPresets = () => [...LIBRARY, ...custom];

export const getPreset = (id: string | undefined): Preset =>
  byId.get(ALIAS[id || ''] || id || '') || custom.find(c => c.id === id) || (id?.startsWith('mint-') ? mint(parseInt(id.slice(5), 36)) : null) || byId.get('wipe-right')!;
export const presetName = (id: string | undefined) => {
  if (id && id in ALIAS) return BASE_REVEALS.find(b => b[0] === id)![1];
  return getPreset(id).name;
};

/** Validate an imported preset (from JSON) so a bad file can't break the stage. */
export const sanitize = (raw: unknown): Preset | null => {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Preset>, num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const fx = (f: unknown): FxRef | undefined => {
    const x = f as FxRef | undefined;
    if (!x || !FX[x.fx]) return undefined;
    const d = FX[x.fx], p = defaultParams(d);
    for (const q of d.params) if (x.p && q.options.includes(x.p[q.key] as never)) p[q.key] = x.p[q.key];
    return { fx: d.id, p };
  };
  const enter = fx(r.enter);
  if (!enter) return null;
  const exit = fx(r.exit);
  return {
    id: typeof r.id === 'string' ? r.id.slice(0, 64) : 'custom-' + Date.now().toString(36),
    name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 48) : 'Imported',
    group: 'Custom', custom: true, enter, ...(exit && FX[exit.fx].exit ? { exit } : {}),
    ease: (r.ease && r.ease in EASES ? r.ease : 'out') as EaseId,
    order: (ORDERS as readonly string[]).includes(r.order as string) ? (r.order as Order) : 'seq',
    ...(r.spread !== undefined ? { spread: num(r.spread, 0, 0.95, 0.5) } : {}),
    gap: num(r.gap, 0.3, 2.5, 1), pace: num(r.pace, 0.3, 2.5, 1), exitDur: num(r.exitDur, 0.12, 1.2, 0.35), exitGap: num(r.exitGap, 0, 0.2, 0),
    blurb: typeof r.blurb === 'string' ? r.blurb.slice(0, 200) : undefined
  };
};

// ── minting: a fresh, never-seen recipe from a seed ────────────────────────

const ADJ = ['Copper', 'Signal', 'Static', 'Night', 'Paper', 'Quartz', 'Carbon', 'Vector', 'Ferro', 'Neon', 'Granite', 'Cobalt', 'Index', 'Prime', 'Hollow', 'Latent', 'Brass', 'Delta', 'Tandem', 'Overt'];
const NOUN = ['Ledger', 'Relay', 'Shutter', 'Lattice', 'Gate', 'Cipher', 'Frame', 'Grid', 'Pulse', 'Column', 'Plate', 'Seam', 'Vault', 'Switch', 'Array', 'Ribbon', 'Stencil', 'Cut', 'Bracket', 'Sector'];
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

export function mint(seed: number): Preset {
  const r = rng(seed ^ 0x9e3779b9), d = pick(r, EFFECTS.filter(e => e.id !== 'cut'));
  const p: Params = Object.fromEntries(d.params.map(q => [q.key, pick(r, q.options)]));
  const exits = EFFECTS.filter(e => e.exit);
  const exitDef = r() < 0.45 ? pick(r, exits) : null;
  const ep = exitDef ? Object.fromEntries(exitDef.params.map(q => [q.key, pick(r, q.options)])) : null;
  const ease = pick(r, ['out', 'out', 'out', 'io', 'step8', 'step4', 'step16'] as EaseId[]);
  const order = d.staggered ? pick(r, d.orders?.length ? [...d.orders, ...ORDERS] : ORDERS) : 'seq';
  const code = (seed >>> 0).toString(36).toUpperCase().slice(-4);
  return {
    id: 'mint-' + (seed >>> 0).toString(36),
    name: `${pick(r, ADJ)} ${pick(r, NOUN)} ${code}`,
    group: 'Custom',
    enter: { fx: d.id, p },
    ...(exitDef && ep && exitDef.id !== d.id ? { exit: { fx: exitDef.id, p: ep } } : {}),
    ease, order,
    ...(d.staggered && r() < 0.5 ? { spread: +(0.3 + r() * 0.6).toFixed(2) } : {}),
    gap: +(0.6 + r() * 0.9).toFixed(2), pace: +(0.7 + r() * 0.9).toFixed(2),
    exitDur: 0.35, exitGap: pick(r, [0, 0, 0.03, 0.05, 0.08]),
    blurb: `${d.name}${exitDef ? ` in, ${exitDef.name.toLowerCase()} out` : ''} · ${EASES[ease].label.toLowerCase()} · ${ORDER_LABEL[order as Order].toLowerCase()}.`
  };
}
export const mintFrom = (text: string) => mint(hash(text));
export const describe = (p: Preset) =>
  `${FX[p.enter.fx]?.name ?? p.enter.fx}${p.exit ? ` → ${FX[p.exit.fx]?.name ?? p.exit.fx}` : ''} · ${EASES[p.ease].label} · ${ORDER_LABEL[p.order]}`;
