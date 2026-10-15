// A Target is one revealable element on the stage: a wrapper (the clipper) around an inner box
// (the content). Effects read and write only through this interface.
//
// Precision rules this file enforces:
//  • Bleed: unboxed text gets invisible padding (cancelled by equal negative margin) so clipping
//    never shaves ascenders, accents or italic overhangs. Layout is unchanged to the sub-pixel.
//  • Splits keep kerning: after splitting text into masked units, every unit is nudged back to
//    the exact x position its glyphs had in the unsplit text (verified to < 0.01 px).
//  • Clip edges snap to device pixels, so hard wipes stay hard at any stage scale.
import type { Rect } from './geom';

export type SplitKind = 'char' | 'word' | 'line';

export interface Unit {
  /** The moving glyph/word. */
  el: HTMLElement;
  /** Its own clipping mask (clip-path extends .35em/.16em past the glyph box). */
  mask: HTMLElement;
  /** Final text of the unit, for decoders and flaps. */
  text: string;
  /** Line index (reading order). */
  line: number;
}

export interface Target {
  wrap: HTMLElement;
  inner: HTMLElement;
  seed: number;
  accent: string;
  /** True when the inner box paints its own background (a plate, a pill, a card). */
  boxed: boolean;
  /** Inner holds visible non-text parts (swatches, icons, counters) that a text split would leave static. */
  decor: boolean;
  /** Invisible clip room around the content, in stage px. */
  bleed: { x: number; y: number };
  /** Wrapper border box in stage px (content + bleed), measured once. */
  size(): { w: number; h: number };
  /** Distance the inner box must travel along an axis to leave the wrapper's clip entirely. */
  reach(axis: 'x' | 'y'): number;
  /** Split the inner text into masked units. Cached; only one kind per target. */
  units(kind: SplitKind): Unit[];
  /** A new full-bleed layer inside the wrapper, above the content. Starts fully clipped. */
  overlay(): HTMLElement;
  /** Clip-path for a union of rects given in percent of the wrapper, snapped to device pixels. */
  poly(rects: readonly Rect[]): string;
  /** Clip-path polygon from percent points, snapped to device pixels. */
  points(pts: readonly (readonly [number, number])[]): string;
}

export const EMPTY = 'polygon(0 0,0 0,0 0)';
// Units clip with clip-path, not overflow: an overflow-hidden inline-block takes its baseline from its
// bottom edge, which would move every sibling aligned to it. clip-path changes nothing in layout.
export const UCLIP = 'inset(-.35em -.16em)';
const UMASK = `display:inline-block;clip-path:${UCLIP};`;
const SKIP = '[data-c],[data-val],[data-nosplit],svg';
const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (s: string) => (seg ? [...seg.segment(s)].map(x => x.segment) : [...s]);

/** Screen px per layout px, exact: the stage root is exactly 1280 layout px wide, times any placement scale. */
export const scaleOf = (el: Element) => {
  const root = el.closest<HTMLElement>('[data-stage-root]');
  if (root) {
    const content = el.closest<HTMLElement>('[data-k]');
    return (root.getBoundingClientRect().width / 1280) * (content ? +content.dataset.k! || 1 : 1);
  }
  const h = el as HTMLElement, w = h.offsetWidth;
  return w ? h.getBoundingClientRect().width / w : 1;
};
type Pos = { x: number; y: number };
/** Position of a glyph range on screen, or null when it isn't rendered (inside display:none). */
const rangeAt = (range: Range, node: Node, start: number, end: number): Pos | null => {
  if (typeof range.getClientRects !== 'function') return { x: 0, y: 0 };
  range.setStart(node, start); range.setEnd(node, end);
  const r = range.getClientRects()[0];
  return r ? { x: r.left, y: r.top } : null;
};

interface Pending { node: Text; tokens: { text: string; space: boolean; at: number; brk?: boolean }[] }
const BREAK = /(?<=[-\u2010\u2013\u2014/])(?=.)/;

function split(inner: HTMLElement, kind: SplitKind): Unit[] {
  // 1. Record where every token sits in the unsplit text.
  const pend: Pending[] = [];
  const walk = (node: Node) => {
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === Node.TEXT_NODE) {
        const s = ch.textContent || '';
        if (!s.trim()) continue;
        const tokens: Pending['tokens'] = [];
        let at = 0;
        for (const tok of s.split(/(\s+)/)) {
          if (!tok) continue;
          if (/^\s+$/.test(tok)) { tokens.push({ text: ' ', space: true, at }); at += tok.length; continue; }
          // Keep the line-break opportunities plain text has after hyphens, dashes and slashes.
          const parts = tok.split(BREAK);
          parts.forEach((part, pi) => {
            if (pi) tokens.push({ text: '', space: false, at, brk: true });
            if (kind === 'char') { let a = at; for (const g of graphemes(part)) { tokens.push({ text: g, space: false, at: a }); a += g.length; } }
            else tokens.push({ text: part, space: false, at });
            at += part.length;
          });
        }
        pend.push({ node: ch as Text, tokens });
      } else if (ch instanceof HTMLElement && !ch.matches(SKIP)) walk(ch);
    }
  };
  walk(inner);
  const range = document.createRange(), orig: (Pos | null)[] = [], origAll: (Pos | null)[][] = [];
  for (const p of pend) for (const t of p.tokens) {
    if (t.space || t.brk) continue;
    const gs: (Pos | null)[] = [];
    let a = t.at;
    for (const g of graphemes(t.text)) { gs.push(rangeAt(range, p.node, a, a + g.length)); a += g.length; }
    origAll.push(gs);
    orig.push(gs[0]);
  }
  // Freeze the element's outer box: splitting may change its intrinsic size by fractions of a pixel
  // (each unit rounds to the layout grid), which would move siblings in flex rows and stacks. Fixing the
  // wrapper at its laid-out size (not changing its basis) leaves every sibling exactly where it was.
  const wrap = inner.parentElement!, k0 = scaleOf(inner) || 1, box0 = wrap.getBoundingClientRect();
  const hidden = orig.some(o => !o);

  // 2. Replace text with masked units.
  const units: Unit[] = [];
  const unit = (text: string) => {
    const mask = document.createElement('span'), el = document.createElement('span');
    mask.style.cssText = UMASK;
    el.style.cssText = 'display:inline-block';
    el.textContent = text;
    mask.append(el);
    units.push({ el, mask, text, line: 0 });
    return mask;
  };
  for (const p of pend) {
    const frag = document.createDocumentFragment();
    let word: HTMLElement | null = null;
    for (const t of p.tokens) {
      if (t.space) { word = null; frag.append(document.createTextNode(' ')); continue; }
      if (t.brk) { word = null; frag.append(document.createElement('wbr')); continue; }
      if (kind === 'char') {
        if (!word) { word = document.createElement('span'); word.dataset.w = ''; word.style.cssText = 'display:inline-block;white-space:nowrap'; frag.append(word); }
        word.append(unit(t.text));
      } else frag.append(unit(t.text));
    }
    p.node.replaceWith(frag);
  }

  // 2b. Lock the original line breaks. Splitting can change where a line wraps (a word that only just
  //     fit can be pushed down by sub-pixel differences), so break exactly where the text broke before
  //     and nowhere else.
  //     Only among rendered text: hidden alternates (cue swaps) have no position and never break lines.
  let breaks = 0, prevY: number | null = null;
  for (let i = 0; i < units.length; i++) {
    const o = orig[i];
    if (!o) continue;
    if (prevY !== null && o.y > prevY + 1) {
      const m = units[i].mask, at = m.parentElement?.dataset.w !== undefined && m.parentElement!.firstChild === m ? m.parentElement! : m;
      at.before(document.createElement('br'));
      breaks++;
    }
    prevY = o.y;
  }
  if (breaks) inner.style.whiteSpace = 'nowrap';

  // Only when the content is static: cue-driven swaps (data-cut/until), counters and hidden alternates
  // legitimately change the size later.
  if (pend.length && !hidden && !inner.querySelector('[data-cut],[data-until],[data-c],[data-val],[data-seg]')) {
    wrap.style.boxSizing = 'border-box';
    wrap.style.width = (box0.width / k0).toFixed(4) + 'px';
    wrap.style.height = (box0.height / k0).toFixed(4) + 'px';
    wrap.style.flex = '0 0 auto';
  }

  // 3. Put every unit back where its glyphs were. Relative offsets don't reflow anything, so each unit
  //    is corrected independently against its own original position (no error can accumulate).
  const k = scaleOf(inner) || 1;
  const glyphs = (u: Unit) => { const out: (Pos | null)[] = []; let a = 0; for (const g of graphemes(u.text)) { out.push(rangeAt(range, u.el.firstChild!, a, a + g.length)); a += g.length; } return out; };
  const now = units.map(u => rangeAt(range, u.el.firstChild!, 0, graphemes(u.text)[0].length));
  const off = units.map((_, i) => { const o = orig[i], n = now[i]; return (o && n ? [(o.x - n.x) / k, (o.y - n.y) / k] : [0, 0]) as [number, number]; });
  const put = (i: number, dx: number, dy: number) => {
    const m = units[i].mask;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) { m.style.position = ''; m.style.left = ''; m.style.top = ''; return; }
    m.style.position = 'relative';
    m.style.left = dx.toFixed(4) + 'px';
    m.style.top = dy.toFixed(4) + 'px';
  };
  units.forEach((_, i) => put(i, off[i][0], off[i][1]));
  // Engines that snap glyphs to whole pixels (WebKit at 1x) round each glyph from where its run starts,
  // so a multi-glyph unit can differ inside by 1 px. Search the sub-pixel start that reproduces the
  // original rounding for every glyph in the unit.
  const err = (i: number) => { const g = glyphs(units[i]), o = origAll[i]; let e = 0; for (let n = 0; n < g.length; n++) { const a = g[n], b = o[n]; if (a && b) e = Math.max(e, Math.abs(a.x - b.x), Math.abs(a.y - b.y)); } return e; };
  units.forEach((_, i) => {
    if (origAll[i].length < 2 || !orig[i]) return;
    let best = err(i);
    if (best < 0.02) return;
    let bx = off[i][0];
    for (let d = -0.5; d <= 0.5 + 1e-9; d += 1 / 16) {
      put(i, off[i][0] + d / k, off[i][1]);
      const e = err(i);
      if (e < best - 1e-6) { best = e; bx = off[i][0] + d / k; }
    }
    put(i, bx, off[i][1]);
    if (best < 0.02) return;
    // Still off: this engine shapes from the run start and snaps every glyph, so give each glyph its
    // own inline span and place it exactly. The unit (u.el) still moves as one piece.
    const u = units[i], gs = graphemes(u.text);
    u.el.textContent = '';
    const spans = gs.map(g => { const sp = document.createElement('span'); sp.textContent = g; u.el.append(sp); return sp; });
    put(i, off[i][0], off[i][1]);
    for (let pass = 0; pass < 2; pass++) {
      spans.forEach((sp, n) => {
        const r = rangeAt(range, sp.firstChild!, 0, gs[n].length), o = origAll[i][n];
        if (!r || !o) return;
        const dx = (o.x - r.x) / k + (parseFloat(sp.style.left) || 0), dy = (o.y - r.y) / k + (parseFloat(sp.style.top) || 0);
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
        sp.style.position = 'relative';
        sp.style.left = dx.toFixed(4) + 'px';
        sp.style.top = dy.toFixed(4) + 'px';
      });
    }
  });

  // 3b. Splitting a unit into glyph spans can change its advance and move later units in the flow, so
  //     settle every unit once more against its original position (relative offsets never reflow).
  units.forEach((u, i) => {
    const spans = [...u.el.children] as HTMLElement[];
    if (spans.length) {
      spans.forEach((sp, n) => {
        const r = rangeAt(range, sp.firstChild!, 0, sp.textContent!.length), o = origAll[i][n];
        if (!r || !o) return;
        const dx = (o.x - r.x) / k, dy = (o.y - r.y) / k;
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
        sp.style.position = 'relative';
        sp.style.left = ((parseFloat(sp.style.left) || 0) + dx).toFixed(4) + 'px';
        sp.style.top = ((parseFloat(sp.style.top) || 0) + dy).toFixed(4) + 'px';
      });
      return;
    }
    const r = rangeAt(range, u.el.firstChild!, 0, graphemes(u.text)[0].length), o = orig[i];
    if (!r || !o) return;
    const dx = (o.x - r.x) / k, dy = (o.y - r.y) / k;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
    put(i, (parseFloat(u.mask.style.left) || 0) + dx, (parseFloat(u.mask.style.top) || 0) + dy);
  });

  // 4. Line index by rendered row.
  let line = -1, top = -Infinity;
  for (const u of units) {
    const y = u.el.getBoundingClientRect().top / k;
    if (y > top + 2) { line++; top = y; }
    u.line = line;
  }
  return units;
}

export function makeTarget(wrap: HTMLElement, inner: HTMLElement, seed: number, accent: string, thin = false): Target {
  let sz: { w: number; h: number } | null = null, grid: { ox: number; oy: number; k: number; w: number; h: number } | null = null;
  let split_: Unit[] | null = null;
  const st = inner.style;
  const boxed = !!(st.background || st.backgroundColor || st.backgroundImage || st.boxShadow);
  const fs = parseFloat(getComputedStyle(inner).fontSize) || 16;
  const bleed = boxed || thin ? { x: 0, y: 0 } : { x: Math.ceil(fs * 0.16), y: Math.ceil(fs * 0.3) };
  if (bleed.x || bleed.y) {
    const cs = getComputedStyle(wrap), px = (v: string) => parseFloat(v) || 0;
    wrap.style.padding = `${px(cs.paddingTop) + bleed.y}px ${px(cs.paddingRight) + bleed.x}px ${px(cs.paddingBottom) + bleed.y}px ${px(cs.paddingLeft) + bleed.x}px`;
    wrap.style.margin = `${px(cs.marginTop) - bleed.y}px ${px(cs.marginRight) - bleed.x}px ${px(cs.marginBottom) - bleed.y}px ${px(cs.marginLeft) - bleed.x}px`;
  }
  const measure = () => {
    const r = wrap.getBoundingClientRect(), k = scaleOf(wrap), dpr = window.devicePixelRatio || 1;
    grid = { w: r.width / k, h: r.height / k, k: k * dpr, ox: r.left * dpr, oy: r.top * dpr };
    return grid;
  };
  const sx = (g: NonNullable<typeof grid>, pct: number) => {
    const v = (pct / 100) * g.w;
    return pct <= 0 || pct >= 100 ? v : (Math.round(g.ox + v * g.k) - g.ox) / g.k;
  };
  const sy = (g: NonNullable<typeof grid>, pct: number) => {
    const v = (pct / 100) * g.h;
    return pct <= 0 || pct >= 100 ? v : (Math.round(g.oy + v * g.k) - g.oy) / g.k;
  };
  const f = (n: number) => +n.toFixed(3) + 'px';
  return {
    wrap, inner, seed, accent, boxed, bleed,
    decor: !!inner.querySelector(SKIP) || [...inner.querySelectorAll<HTMLElement>('span,div')].some(e => !e.textContent?.trim()),
    size() {
      if (!sz || !sz.w) { const r = wrap.getBoundingClientRect(), k = scaleOf(wrap); sz = { w: r.width / k || 1, h: r.height / k || 1 }; }
      return sz;
    },
    reach(axis) {
      return axis === 'x' ? inner.offsetWidth + 2 * bleed.x + 1 : inner.offsetHeight + 2 * bleed.y + 1;
    },
    units(kind) {
      if (!split_) split_ = split(inner, kind);
      return split_;
    },
    overlay() {
      if (!wrap.style.position) wrap.style.position = 'relative';
      const o = document.createElement('div');
      o.style.cssText = `position:absolute;inset:0;pointer-events:none;clip-path:${EMPTY}`;
      wrap.append(o);
      return o;
    },
    poly(rects) {
      const g = grid || measure(), rs = rects.filter(r => r[2] - r[0] > 0.001 && r[3] - r[1] > 0.001);
      if (!rs.length) return EMPTY;
      const pts: string[] = [];
      const q = rs.map(([x0, y0, x1, y1]) => [f(sx(g, x0)), f(sy(g, y0)), f(sx(g, x1)), f(sy(g, y1))]);
      for (const [x0, y0, x1, y1] of q) pts.push(`${x0} ${y0}`, `${x1} ${y0}`, `${x1} ${y1}`, `${x0} ${y1}`, `${x0} ${y0}`);
      for (let i = q.length - 2; i >= 0; i--) pts.push(`${q[i][0]} ${q[i][1]}`);
      return `polygon(${pts.join(',')})`;
    },
    points(pts) {
      if (pts.length < 3) return EMPTY;
      const g = grid || measure();
      return `polygon(${pts.map(([x, y]) => `${f(sx(g, x))} ${f(sy(g, y))}`).join(',')})`;
    }
  };
}
