// The animation library. Every item is generated from the engine's catalogue, so each one is a real,
// distinct animation the engine renders: finished cards, pixel sprites with motions, text animators,
// glyph and dither fields, transitions, shapes and starter scenes.
import { clone, FIELD, IN, obj, ON, OUT, scene, SCREEN, SHAPE_STYLE, TEXT_STYLE, TONE, type Catalogue, type DitherKind, type FxDef, type Obj, type Scene } from './types';

export type Shelf = 'Titles' | 'Name tags' | 'Arrows & callouts' | 'Numbers' | 'Lists' | 'Subscribe & social' | 'Pixel · Web World Wide' | 'Text animators' | 'Glyph & ASCII' | 'Dither & halftone' | 'Transitions' | 'Shapes' | 'Backgrounds & loops' | 'Scenes';
export const SHELVES: Shelf[] = ['Titles', 'Name tags', 'Arrows & callouts', 'Numbers', 'Lists', 'Subscribe & social', 'Pixel · Web World Wide', 'Text animators', 'Glyph & ASCII', 'Dither & halftone', 'Transitions', 'Shapes', 'Backgrounds & loops', 'Scenes'];
export type Mood = 'calm' | 'punchy' | 'glitchy' | 'retro' | 'elegant';
export const MOODS: Mood[] = ['calm', 'punchy', 'glitchy', 'retro', 'elegant'];

export interface LibItem {
  id: string; name: string; blurb: string; shelf: Shelf; tags: string[]; mood: Mood[];
  /** cover + reveal, loop, text in, emphasis … (the small label on library cards) */
  badge: string; loop: boolean; hasText: boolean; transparent: boolean;
  /** Card template id when the item is a Quick card (the Make-it-yours screen edits these). */
  card?: string;
  make(): Scene;
}

const WWW = { sky: '#1E68F0', ink: '#0E2960', cherry: '#EC5A2B', gold: '#F5C542', mint: '#28B083' };
const POS: Record<string, [number, number]> = { nametag: [140, 820], lowerthird: [140, 800], breaking: [96, 920], arrow: [700, 440], circleit: [700, 420], callout: [700, 380], location: [760, 440], countdown: [860, 300], subscribe: [780, 460], like: [760, 340] };
const fam = (e: FxDef) => (e.family === 'pixel' ? 'retro' : e.family === 'glyph' ? 'glitchy' : e.family === 'fun' ? 'punchy' : 'calm') as Mood;

export function buildLibrary(cat: Catalogue): LibItem[] {
  const items: LibItem[] = [];
  const add = (i: Omit<LibItem, 'transparent' | 'loop' | 'hasText'> & Partial<LibItem>) => items.push({ transparent: true, loop: false, hasText: false, ...i });
  const ins = cat.effects.filter(e => e.slot === 'in' && e.id !== 'none');
  const ons = cat.effects.filter(e => e.slot === 'on' && e.id !== 'none');
  const outs = cat.effects.filter(e => e.slot === 'out' && !['stay', 'disappear'].includes(e.id));

  // ── Quick cards ────────────────────────────────────────────────────────────
  for (const c of cat.cards) {
    const [x, y] = POS[c.id] ?? [200, 380];
    const shelf = (c.category === 'Arrows & callouts' || c.category === 'Numbers' || c.category === 'Lists' || c.category === 'Name tags' || c.category === 'Subscribe & social' ? c.category : 'Titles') as Shelf;
    const loud = ['bignumber', 'percent', 'countdown', 'versus'].includes(c.id);
    add({
      id: `card-${c.id}`, name: c.name, blurb: c.blurb, shelf, card: c.id, tags: [c.category, ...c.fields.map(f => f[1])], mood: c.id.startsWith('pixel') ? ['retro'] : c.id.startsWith('ascii') ? ['glitchy'] : loud ? ['punchy'] : ['calm'],
      badge: 'text in', hasText: true,
      make: () => scene({ name: c.name, dur: c.dur, objects: [obj({ type: 'card', template: c.id, fields: {}, look: c.id === 'pixeltitle' ? 'retro' : 'clean', colors: c.id === 'pixeltitle' ? 'www' : 'blue' }, { name: c.name, x, y, enter: IN(c.id === 'asciititle' ? 'decode' : c.id === 'pixeltitle' ? 'blocky-wipe' : 'wipe'), exit: OUT('wipe') })] })
    });
  }

  // ── Pixel · Web World Wide: every starter sprite with every motion ─────────
  const spriteMotions = ['bob', 'float', 'sway', 'pulse', 'spin3d', 'shadow-lift', 'blink', 'wiggle', 'hover', 'drift-across', 'sparkle', 'glow-pulse', 'jitter'];
  for (const st of cat.starters) {
    for (const m of spriteMotions) {
      const def = ons.find(e => e.id === m);
      if (!def) continue;
      const px = Math.max(6, Math.round(260 / Math.max(st.sprite.w, st.sprite.h)));
      add({
        id: `px-${st.id}-${m}`, name: `${st.name} · ${def.name}`, blurb: def.blurb, shelf: 'Pixel · Web World Wide', tags: ['pixel', 'sprite', st.name, def.name, 'www'], mood: ['retro'],
        badge: m === 'drift-across' ? 'loop' : 'loop', loop: true, transparent: false,
        make: () => scene({ name: `${st.name} ${def.name}`, fps: 12, dur: 6, bg: { kind: 'sky', color: WWW.sky, color2: '#1450C8' }, objects: [obj({ type: 'sprite', sprite: clone(st.sprite), px, tint: '' }, { name: st.name, x: 960 - (st.sprite.w * px) / 2, y: 540 - (st.sprite.h * px) / 2, enter: IN('pop', { dur: 0.4 }), on: ON(m, { speed: m === 'drift-across' ? 2 : 1 }), exit: OUT('stay') })] })
      });
    }
  }
  // Pixel text with the website's motions.
  for (const [m, word] of [['sway', 'WEB WORLD WIDE'], ['bob', 'NEW VIDEO'], ['wiggle', 'HELLO!'], ['blink', 'PRESS START'], ['glow-pulse', 'LIVE'], ['shimmer', 'GAME OVER'], ['wave-rows', 'WAVY'], ['colour-cycle', 'RAINBOW']] as const) {
    const def = ons.find(e => e.id === m);
    if (!def) continue;
    add({ id: `px-text-${m}`, name: `Pixel text · ${def.name}`, blurb: def.blurb, shelf: 'Pixel · Web World Wide', tags: ['pixel', 'text', def.name], mood: ['retro'], badge: 'emphasis', loop: true, hasText: true, make: () => scene({ name: word, fps: 12, dur: 5, objects: [obj({ type: 'pixel-text', text: word, font: 'five', px: Math.round(1500 / (word.length * 6)), color: '#FFFFFF', shadow: WWW.ink }, { name: 'Pixel text', x: 160, y: 440, enter: IN('blocky-wipe', { dur: 0.6 }), on: ON(m), exit: OUT('dither-out') })] }) });
  }

  // ── Text animators: every entrance on a title, every exit too ───────────────
  // Every entrance in three type looks: a bold sans on a hard shadow, an elegant serif, and chunky pixels.
  const LOOKS3 = [
    ['bold', 'Bold', (txt: string) => ({ type: 'text' as const, text: txt, style: TEXT_STYLE({ font: 'archivo-black', size: 120, color: '#FFFFFF', shadow: '#0B0B0C', shadow_dx: 6, shadow_dy: 6 }) }), 30, 'punchy'],
    ['serif', 'Elegant', (txt: string) => ({ type: 'text' as const, text: txt, style: TEXT_STYLE({ font: 'instrument-serif', size: 150, color: '#0B0B0C' }) }), 30, 'elegant'],
    ['pixel', 'Pixel', (txt: string) => ({ type: 'pixel-text' as const, text: txt.toUpperCase(), font: 'five' as const, px: 14, color: '#FFFFFF', shadow: WWW.ink }), 12, 'retro']
  ] as const;
  for (const e of ins) {
    if (e.id === 'draw-on') continue;
    for (const [lid, lname, mk, fps, mood] of LOOKS3) {
      const kind = e.family === 'glyph' && lid === 'bold' ? { type: 'text' as const, text: 'Where the hours go', style: TEXT_STYLE({ font: 'jetbrains-mono', size: 110, color: '#22D37F' }) } : mk('Where the hours go');
      add({ id: `text-in-${e.id}-${lid}`, name: `${e.name} · ${lname}`, blurb: e.blurb, shelf: 'Text animators', tags: ['text', 'entrance', e.family, e.name, lname], mood: [fam(e), mood as Mood], badge: 'text in', hasText: true, make: () => scene({ name: e.name, dur: 3.5, fps, objects: [obj(kind, { name: 'Title', x: 200, y: 460, enter: IN(e.id, { dur: e.cell ? 1 : 0.6 }), exit: OUT('wipe', { dur: 0.35 }) })] }) });
    }
  }
  for (const e of outs) {
    add({ id: `text-out-${e.id}`, name: `${e.name} (exit)`, blurb: e.blurb, shelf: 'Text animators', tags: ['text', 'exit', e.family, e.name], mood: [fam(e)], badge: 'text out', hasText: true, make: () => scene({ name: e.name, dur: 3, objects: [obj({ type: 'text', text: 'Top secret plans', style: TEXT_STYLE({ font: e.family === 'glyph' ? 'ibm-plex-mono' : 'instrument-serif', size: 130, color: '#FFFFFF' }) }, { name: 'Title', x: 240, y: 440, enter: IN('appear'), exit: OUT(e.id, { dur: e.cell ? 1 : 0.6 }) })] }) });
  }
  for (const e of ons.filter(o => o.cell || ['pulse', 'wiggle', 'jitter', 'breathe'].includes(o.id))) {
    add({ id: `text-on-${e.id}`, name: `${e.name} (emphasis)`, blurb: e.blurb, shelf: 'Text animators', tags: ['text', 'emphasis', e.name], mood: [fam(e)], badge: 'emphasis', loop: true, hasText: true, make: () => scene({ name: e.name, dur: 4, objects: [obj({ type: 'text', text: 'this part matters', style: TEXT_STYLE({ font: 'archivo-black', size: 110, color: '#0B0B0C', plate: WWW.gold, pad_x: 24, pad_y: 10 }) }, { name: 'Words', x: 420, y: 470, enter: IN('pop', { dur: 0.35 }), on: ON(e.id), exit: OUT('shrink') })] }) });
  }

  // ── Glyph & ASCII: one-click looks, every channel, ASCII titles ─────────────
  const field = (name: string, style = cat.looks[0].style, fp = cat.looks[0].field, screen = cat.looks[0].screen, extra: Partial<Obj> = {}) =>
    scene({ name, dur: Math.max(4, fp.loop_s), bg: { kind: 'solid', color: '#07070C', color2: '#07070C' }, screen: clone(screen), objects: [obj({ type: 'field', w: 1920, h: 1080, style: clone(style), field: clone(fp), source: 'WEBIMATION' }, { name, enter: IN('dither-in', { dur: 0.6 }), exit: OUT('stay'), ...extra })] });
  for (const l of cat.looks) add({ id: `look-${l.id}`, name: l.name, blurb: 'One-click glyph look', shelf: 'Glyph & ASCII', tags: ['ascii', 'glyph', 'look', l.field.channel], mood: ['glitchy'], badge: 'loop', loop: true, transparent: false, make: () => field(l.name, l.style, l.field, l.screen) });
  for (const c of cat.channels) add({ id: `chan-${c.id}`, name: c.name, blurb: c.blurb, shelf: 'Glyph & ASCII', tags: ['ascii', 'channel', c.name], mood: ['glitchy'], badge: 'loop', loop: true, transparent: false, make: () => field(c.name, cat.looks[0].style, FIELD({ channel: c.id })) });
  for (const [fx, out, name] of [['decode', 'decode-out', 'Decode title'], ['rain-in', 'melt', 'Rain title'], ['scan-in', 'glitch-out', 'Scan title'], ['type-on', 'type-off', 'Typed banner'], ['dither-in', 'dither-out', 'Dither banner'], ['glitch-in', 'glyph-scatter', 'Glitch banner']] as const) {
    add({ id: `ascii-${fx}`, name, blurb: 'Pixel letters drawn in characters', shelf: 'Glyph & ASCII', tags: ['ascii', 'banner', 'title'], mood: ['glitchy'], badge: 'text in', hasText: true, make: () => scene({ name, dur: 4, objects: [obj({ type: 'ascii-banner', text: 'SIGNAL', cell: 26, font: 'jetbrains-mono', on: '#', color: '#22D37F' }, { name: 'Banner', x: 420, y: 380, enter: IN(fx, { dur: 1 }), exit: OUT(out, { dur: 0.8 }) })] }) });
  }

  // ── Dither & halftone: every dither on four channels ───────────────────────
  const dithers: DitherKind[] = ['bayer2', 'bayer4', 'bayer8', 'blue-noise', 'floyd-steinberg', 'atkinson', 'row'];
  const dch = [['bloom', 'Bloom', 'glacier'], ['iris', 'Iris', 'ember'], ['dunes', 'Dunes', 'orchid'], ['plasma', 'Plasma', 'matrix']] as const;
  for (const d of dithers) for (const [ch, cn, pal] of dch) {
    const dn = cat.dithers.find(x => x.id === d)?.name ?? d;
    add({ id: `dither-${d}-${ch}`, name: `${dn} ${cn}`, blurb: `${cn} through ${dn}`, shelf: 'Dither & halftone', tags: ['dither', dn, cn, 'halftone'], mood: ['retro'], badge: 'loop', loop: true, transparent: false, make: () => field(`${dn} ${cn}`, { ...cat.looks[0].style, chars: ' ░▒▓█', dither: d, cell: 9, palette: clone(cat.palettes.find(p => p.id === pal) ?? cat.palettes[0]), tone: TONE() }, FIELD({ channel: ch }), SCREEN()) });
  }

  // ── Transitions: cover + reveal, on three plates ───────────────────────────
  const pairs: [string, string, string][] = [['blocky-wipe', 'blocky-wipe', 'Pixel wipe'], ['dither-in', 'dither-out', 'Dither fade'], ['rain-in', 'melt', 'Rain & melt'], ['scan-in', 'dither-out', 'Scanline'], ['blinds', 'blinds', 'Blinds'], ['pixelate-in', 'pixelate-out', 'Pixelate'], ['glitch-in', 'glitch-out', 'Glitch cut'], ['type-on', 'type-off', 'Type cover'], ['wipe', 'wipe', 'Hard wipe'], ['slide', 'slide', 'Push']];
  const plates: [string, string, (o: Partial<Obj>) => Obj][] = [
    ['Blue', '#1E68F0', o => obj({ type: 'shape', style: SHAPE_STYLE({ fill: '#1E68F0' }), w: 1920, h: 1080 }, o)],
    ['Ink', '#0B0B0C', o => obj({ type: 'shape', style: SHAPE_STYLE({ fill: '#0B0B0C' }), w: 1920, h: 1080 }, o)],
    ['Glyph', '#07070C', o => obj({ type: 'field', w: 1920, h: 1080, style: { ...clone(cat.looks[0].style), fill_cells: true }, field: FIELD({ channel: 'static' }), source: '' }, o)]
  ];
  const dirOf: Record<string, string> = { left: '←', right: '→', up: '↑', down: '↓' };
  for (const [inn, out, name] of pairs) for (const [pn, , mk] of plates) for (const d of (['wipe', 'blocky-wipe', 'slide'].includes(inn) ? ['right', 'left', 'down', 'up'] : ['right']) as ('right' | 'left' | 'down' | 'up')[]) {
    const dn = d === 'right' && !['wipe', 'blocky-wipe', 'slide'].includes(inn) ? '' : ` ${dirOf[d]}`;
    add({ id: `tr-${inn}-${pn.toLowerCase()}-${d}`, name: `${name}${dn} · ${pn}`, blurb: 'Hides a cut between two clips', shelf: 'Transitions', tags: ['transition', 'cover', 'reveal', name, pn, d], mood: [inn.includes('glitch') || inn.includes('rain') ? 'glitchy' : inn.includes('pixel') || inn.includes('blocky') ? 'retro' : 'punchy'], badge: 'cover + reveal', make: () => scene({ name: `${name} ${pn}`, dur: 1.6, objects: [mk({ name: 'Cover', enter: IN(inn, { dur: 0.6, ease: 'linear', dir: d }), exit: OUT(out, { dur: 0.6, ease: 'linear', dir: d }) })] }) });
  }

  // ── Shapes: each one with a good entrance and a gentle loop ────────────────
  for (const s of cat.shapes) {
    const open = s.open;
    add({ id: `shape-${s.id}`, name: s.name, blurb: open ? 'Draws itself on' : 'Pops in and floats', shelf: 'Shapes', tags: ['shape', s.name], mood: ['calm'], badge: open ? 'draw on' : 'emphasis', make: () => scene({ name: s.name, dur: 3.5, objects: [obj({ type: 'shape', style: SHAPE_STYLE({ kind: s.id, fill: open ? '' : '#FF8A1F', stroke: open ? '#FF8A1F' : '', stroke_w: open ? 12 : 0, param: s.id === 'progress' ? 0.72 : 0 }), w: s.id === 'line' || s.id === 'underline' || s.id === 'progress' ? 640 : 360, h: s.id === 'line' || s.id === 'underline' ? 40 : s.id === 'progress' ? 40 : 300 }, { name: s.name, x: 780, y: 380, enter: IN(open ? 'draw-on' : 'pop', { dur: 0.7 }), on: ON(open ? 'none' : 'hover'), exit: OUT(open ? 'wipe' : 'shrink') })] }) });
  }

  // ── Backgrounds & loops ────────────────────────────────────────────────────
  add({ id: 'bg-sky', name: 'WWW sky', blurb: 'Pixel clouds drifting on the sky', shelf: 'Backgrounds & loops', tags: ['sky', 'clouds', 'www', 'background'], mood: ['calm', 'retro'], badge: 'loop', loop: true, transparent: false, make: () => scene({ name: 'Sky', fps: 12, dur: 10, bg: { kind: 'sky', color: WWW.sky, color2: '#1450C8' }, objects: cat.starters.filter(s => s.id.startsWith('cloud')).flatMap((s, i) => [0, 1].map(j => obj({ type: 'sprite', sprite: clone(s.sprite), px: 8 + ((i + j * 2) % 4) * 3, tint: '' }, { name: 'Cloud', x: (i * 520 + j * 900) % 1900, y: 60 + ((i * 3 + j * 5) % 8) * 115, enter: IN('none'), on: ON('drift-across', { speed: 0.6 + ((i + j) % 3) * 0.3 }), exit: OUT('stay'), opacity: 0.6 + 0.1 * ((i + j) % 4) }))) }) });
  for (const l of cat.looks.slice(0, 6)) add({ id: `bg-${l.id}`, name: `${l.name} loop`, blurb: 'Seamless background loop', shelf: 'Backgrounds & loops', tags: ['background', 'loop', l.name], mood: ['glitchy'], badge: 'loop', loop: true, transparent: false, make: () => { const s = field(l.name, l.style, { ...l.field, loop_s: 6 }, l.screen, { enter: IN('none') }); s.dur = 6; return s; } });

  // ── Starter scenes (filled from the engine on demand) ──────────────────────
  return items;
}

/** Search: every word must match somewhere; name matches rank first. */
export function search(items: LibItem[], q: string): LibItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  const scored = items.map(it => {
    const name = it.name.toLowerCase(), hay = `${name} ${it.blurb} ${it.shelf} ${it.tags.join(' ')} ${it.badge}`.toLowerCase();
    if (!words.every(w => hay.includes(w))) return null;
    return { it, s: words.reduce((a, w) => a + (name.startsWith(w) ? 3 : name.includes(w) ? 2 : 0), 0) };
  }).filter(Boolean) as { it: LibItem; s: number }[];
  return scored.sort((a, b) => b.s - a.s).map(x => x.it);
}

const previews = new WeakMap<LibItem, Scene>();
/** A cached scene for showing an item (thumbnails); `make()` still gives a fresh copy to edit. */
export const preview = (it: LibItem) => { let s = previews.get(it); if (!s) { s = it.make(); previews.set(it, s); } return s; };
