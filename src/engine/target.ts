// A Target is one revealable element on the stage: an overflow-hidden wrapper (the clipper)
// around an inner box (the content). Effects read and write only through this interface.
export type SplitKind = 'char' | 'word' | 'line';

export interface Unit {
  /** The moving glyph/word. */
  el: HTMLElement;
  /** Its own overflow-hidden mask. */
  mask: HTMLElement;
  /** Final text of the unit, for decoders and flaps. */
  text: string;
  /** Line index (only meaningful for 'line' splits). */
  line: number;
}

export interface Target {
  wrap: HTMLElement;
  inner: HTMLElement;
  seed: number;
  accent: string;
  /** Element size in stage pixels (1280×720 space), measured once. */
  size(): { w: number; h: number };
  /** Split the inner text into masked units. Cached per kind; only one kind per target. */
  units(kind: SplitKind): Unit[];
  /** A new full-bleed layer inside the wrapper, above the content. Starts fully clipped. */
  overlay(): HTMLElement;
  /** Inner holds visible non-text parts (swatches, icons, counters) that a text split would leave static. */
  decor: boolean;
  /** True when the inner box paints its own background (a plate, a pill, a card). */
  boxed: boolean;
}

const MASK = 'display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.14em;margin-bottom:-.14em;';
const SKIP = '[data-c],[data-val],[data-nosplit],svg';

function split(inner: HTMLElement, kind: SplitKind): Unit[] {
  const units: Unit[] = [];
  const unit = (text: string) => {
    const mask = document.createElement('span'), el = document.createElement('span');
    mask.style.cssText = MASK;
    el.style.cssText = 'display:inline-block;will-change:transform';
    el.textContent = text;
    mask.append(el);
    units.push({ el, mask, text, line: 0 });
    return mask;
  };
  const walk = (node: Node) => {
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === Node.TEXT_NODE) {
        const s = ch.textContent || '';
        if (!s.trim()) continue;
        const frag = document.createDocumentFragment();
        for (const tok of s.split(/(\s+)/)) {
          if (!tok) continue;
          if (/^\s+$/.test(tok)) { frag.append(document.createTextNode(' ')); continue; }
          if (kind === 'char') {
            const word = document.createElement('span');
            word.style.cssText = 'display:inline-block;white-space:nowrap';
            for (const c of [...tok]) word.append(unit(c));
            frag.append(word);
          } else frag.append(unit(tok));
        }
        ch.replaceWith(frag);
      } else if (ch instanceof HTMLElement && !ch.matches(SKIP)) walk(ch);
    }
  };
  walk(inner);
  if (kind === 'line' && units.length) {
    let line = -1, top = -Infinity;
    for (const u of units) {
      const y = u.mask.offsetTop;
      if (y > top + 2) { line++; top = y; }
      u.line = line;
    }
  }
  return units;
}

export function makeTarget(wrap: HTMLElement, inner: HTMLElement, seed: number, accent: string): Target {
  let sz: { w: number; h: number } | null = null;
  let split_: Unit[] | null = null;
  const st = inner.style;
  return {
    wrap, inner, seed, accent,
    boxed: !!(st.background || st.backgroundColor || st.backgroundImage || st.boxShadow),
    decor: !!inner.querySelector(SKIP) || [...inner.querySelectorAll<HTMLElement>('span,div')].some(e => !e.textContent?.trim()),
    size() {
      if (!sz || !sz.w) sz = { w: wrap.offsetWidth || 1, h: wrap.offsetHeight || 1 };
      return sz;
    },
    units(kind) {
      if (!split_) split_ = split(inner, kind);
      return split_;
    },
    overlay() {
      if (!wrap.style.position) wrap.style.position = 'relative';
      const o = document.createElement('div');
      o.style.cssText = 'position:absolute;inset:0;pointer-events:none;clip-path:polygon(0 0,0 0,0 0)';
      wrap.append(o);
      return o;
    }
  };
}
