// Webimation stage renderer. Every graphic is a pure function of local time, so it scrubs, loops and
// renders frame-exact. Reveal timing comes from the template's cues; the motion comes from a preset.
import { E, easeFn, exitFn, prog } from './easing';
import { FX, type FxCtx, type Render } from './effects';
import { getPreset, type FxRef, type Preset } from './presets';
import { hash } from './rand';
import { makeTarget } from './target';
import { TEMPLATES, type Clip } from './templates';
import { roleMetrics, typeVars } from './fonts';
import { accentHex, colorVars, fieldCss, onAccent, placement } from './look';
import { CAPS, SANS, STAGE_H, STAGE_W } from './tokens';

export type { Clip };
const FRAME = 1 / 30;
const CLIP_GROUPS = new Set(['Wipe', 'Slats', 'Tiles', 'Leader', 'Cut']);
const DECOR: FxRef = { fx: 'wipe', p: { dir: 'right' } };

/** Wire one revealable element to a preset. Returns its per-frame render. */
function reveal(wrap: HTMLElement, i: number, n: number, s: number, d: number, decor: boolean, pr: Preset, D: number, seed: number, accent: string) {
  const inner = wrap.firstElementChild as HTMLElement, tg = makeTarget(wrap, inner, seed, accent, decor);
  // Thin decor (rules, accent bars) follows geometric presets but wipes under mask/type presets.
  const clipish = (r?: FxRef) => !!r && CLIP_GROUPS.has(FX[r.fx]?.group);
  const en = decor && !clipish(pr.enter) ? DECOR : pr.enter;
  const ex = pr.exit && FX[pr.exit.fx]?.exit && (!decor || clipish(pr.exit)) ? pr.exit : undefined;
  // Exits finish on the clip's last displayed frame (D − 1 frame), never after it, so nothing pops off.
  const s2 = s * pr.gap, d2 = d * pr.pace, xs = D - FRAME - pr.exitDur - (n - 1 - i) * pr.exitGap;
  const def = FX[en.fx] || FX.wipe;
  const cx: FxCtx = { ein: easeFn(pr.ease), eout: exitFn(pr.ease), order: pr.order, spread: pr.spread ?? def.spread ?? 0.5, seed, dur: d2, xdur: pr.exitDur };
  // Effects are created on the first frame, after that frame's cue swaps, so any text they split is
  // measured in the layout it will actually be seen in.
  let enter: Render | null = null, exit: Render | null = null;
  const ready = () => {
    enter = def.make(tg, en.p, cx);
    exit = ex ? FX[ex.fx].make(tg, ex.p, { ...cx, spread: FX[ex.fx].spread ?? 0.5 }) : null;
  };
  // Hard guarantee, independent of the effect: nothing shows before its cue or once its exit is done.
  // (Binary opacity, not a fade: descendants can't override it the way they can visibility.)
  let off: boolean | null = null;
  return (t: number) => {
    const k = prog(t, s2, d2), x = prog(t, xs, pr.exitDur), o = k <= 0 || x >= 1 - 1e-6;
    if (o !== off) { off = o; wrap.style.opacity = o ? '0' : ''; }
    if (!enter) ready();
    if (o) return;
    if (!exit) enter!(k, x);
    else if (x > 0) { enter!(1, 0); exit(1, x); }
    else { exit(1, 0); enter!(k, 0); }
  };
}

/** Move/scale the template's content per the clip's placement props (before any target is measured). */
function place(layer: HTMLElement, content: HTMLElement, P: Record<string, string>) {
  if (!P.place && !P.size && !P.nx && !P.ny) return;
  const els = [...content.querySelectorAll<HTMLElement>('[data-r],[data-move],[data-box]')];
  if (!els.length) return;
  const lr = layer.getBoundingClientRect(), k = lr.width / STAGE_W || 1;
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const el of els) {
    if (el.dataset.move) continue;
    const r = el.getBoundingClientRect();
    box.x0 = Math.min(box.x0, (r.left - lr.left) / k); box.y0 = Math.min(box.y0, (r.top - lr.top) / k);
    box.x1 = Math.max(box.x1, (r.right - lr.left) / k); box.y1 = Math.max(box.y1, (r.bottom - lr.top) / k);
  }
  if (!isFinite(box.x0)) return;
  const pl = placement(P, box);
  if (pl.identity) return;
  content.style.transformOrigin = pl.origin;
  content.style.transform = pl.transform;
  content.dataset.k = String(pl.size);
}

export function build(layer: HTMLElement, clip: Clip | null, transparent = false): ((t: number) => void) | null {
  const base = 'position:absolute;inset:0;overflow:hidden;';
  const T = clip && TEMPLATES[clip.tpl];
  if (!clip || !T) {
    if (transparent) { layer.style.cssText = base; layer.innerHTML = ''; return null; }
    layer.style.cssText = base + 'background:#111113';
    layer.innerHTML = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px"><span style="${CAPS}font-size:18px;color:#8B9198">A-roll · Camera 1</span><span style="${SANS}font-size:22px;color:#8B9198">No graphic at this frame</span></div>`;
    return null;
  }
  const P: Record<string, string> = { accent: T.accent, field: T.field, ...T.d, ...clip.props };
  const a = accentHex(P.accent), ai = onAccent(P.accent), D = clip.dur, pr = clip.motion ?? getPreset(P.reveal);
  // Transparent: no field at all (export with alpha, or preview over loaded footage).
  layer.style.cssText = base + (transparent ? 'background:transparent;' : fieldCss(P).css);
  for (const [k, v] of Object.entries({ ...typeVars(P), ...colorVars(P) })) layer.style.setProperty(k, v);
  const content = document.createElement('div');
  content.style.cssText = 'position:absolute;inset:0';
  content.innerHTML = roleMetrics(T.html(P, a, clip, ai));
  layer.replaceChildren(content);
  place(layer, content, P);
  const q = <E extends Element = HTMLElement>(s: string) => [...layer.querySelectorAll<E>(s)];
  const nums = (s: string) => s.split(',').map(Number);
  // Template logic runs first: it may retime cues (shapes cue their label after the drawing lands).
  const custom = T.update ? T.update(layer, clip) : null;
  const rEls = q('[data-r]');
  const rs = rEls.map((el, i) => { const [s, d] = nums(el.dataset.r!); return reveal(el, i, rEls.length, s, d, !!el.dataset.fx, pr, D, hash(clip.id + ':' + i), a); });
  const cs = q('[data-c]').map(el => { const [v, dec, suf, sd] = el.dataset.c!.split('|'); const [s, d] = nums(sd); return { el, v: +v, dec: +dec, suf, s, d }; });
  const ds = q<SVGElement>('[data-draw]').map(el => { const [s, d] = nums(el.dataset.draw!); return { el, s, d }; });
  const cuts = q<HTMLElement | SVGElement>('[data-cut]').map(el => ({ el, s: +el.dataset.cut!, o: el.style.display }));
  const untils = q<HTMLElement | SVGElement>('[data-until]').map(el => ({ el, s: +el.dataset.until!, o: el.style.display }));
  const segs = q('[data-seg]').map(el => { const [f, s, d] = el.dataset.seg!.split('|').map(Number); return { el, f, s, d, w: 0 }; });
  const mv = q<SVGElement>('[data-move]').map(el => ({ el, v: nums(el.dataset.move!), press: el.dataset.press ? nums(el.dataset.press) : null }));
  return t => {
    // Cue swaps first, so any text a reveal splits on this frame is measured in this frame's layout.
    for (const c of cuts) c.el.style.display = t >= c.s ? c.o : 'none';
    for (const c of untils) c.el.style.display = t < c.s ? c.o : 'none';
    for (const r of rs) r(t);
    for (const c of cs) c.el.textContent = (c.v * E.out(prog(t, c.s, c.d))).toFixed(c.dec) + c.suf;
    for (const d of ds) d.el.style.strokeDashoffset = (1 - E.out(prog(t, d.s, d.d))).toFixed(4);
    for (const g of segs) {
      if (!g.w) g.w = (g.el.parentElement?.clientWidth || 0) - 6;
      const n = Math.round((g.f * E.out(prog(t, g.s, g.d)) * (g.w + 2)) / 12);
      g.el.style.width = Math.max(0, n * 12 - 2) + 'px';
    }
    for (const m of mv) {
      const [x0, y0, x1, y1, s, d] = m.v, k = E.io(prog(t, s, d)), sc = m.press && t >= m.press[0] && t < m.press[1] ? 0.86 : 1;
      m.el.style.transform = `translate(${(x0 + (x1 - x0) * k).toFixed(2)}px,${(y0 + (y1 - y0) * k).toFixed(2)}px) scale(${sc})`;
      m.el.style.visibility = t >= s - 0.25 && t < D - 0.3 ? 'visible' : 'hidden';
    }
    if (custom) custom(t);
  };
}

const GUIDES = '<div style="position:absolute;left:5%;top:5%;right:5%;bottom:5%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.28)"></div><div style="position:absolute;left:10%;top:10%;right:10%;bottom:10%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)"></div><div style="position:absolute;left:628px;top:359px;width:24px;height:2px;background:rgba(255,255,255,.4)"></div><div style="position:absolute;left:639px;top:348px;width:2px;height:24px;background:rgba(255,255,255,.4)"></div>';

export interface Stage {
  show(clip: Clip | null, localTime: number, o?: { guides?: boolean; transparent?: boolean }): void;
  destroy(): void;
}

export function createStage(host: HTMLElement): Stage {
  host.innerHTML = '';
  const inner = document.createElement('div');
  inner.dataset.stageRoot = '';
  inner.style.cssText = `position:absolute;left:0;top:0;width:${STAGE_W}px;height:${STAGE_H}px;transform-origin:0 0;overflow:hidden;color:#fff;font-family:'Archivo Variable',Archivo,system-ui,sans-serif;font-variant-ligatures:none;font-kerning:normal;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased`;
  const layer = document.createElement('div'), guides = document.createElement('div');
  guides.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  guides.innerHTML = GUIDES;
  inner.append(layer, guides);
  host.append(inner);
  const fit = () => { inner.style.transform = `scale(${host.clientWidth / STAGE_W})`; };
  const ro = new ResizeObserver(fit);
  ro.observe(host);
  fit();
  let key: string | null = null, upd: ((t: number) => void) | null = null;
  // Text is measured at build time (kerning, splits, tile grids), so rebuild whenever a webfont lands.
  const refont = () => { key = null; };
  document.fonts?.addEventListener('loadingdone', refont);
  return {
    show(clip, lt, o = {}) {
      const k = (o.transparent ? 'T|' : '') + (clip ? clip.id + '|' + clip.tpl + '|' + clip.dur + '|' + clip.start + '|' + JSON.stringify(clip.props) + (clip.motion ? JSON.stringify(clip.motion) : '') : '-');
      if (k !== key) { key = k; upd = build(layer, clip, !!o.transparent); }
      guides.style.display = o.guides ? '' : 'none';
      if (upd) upd(lt);
    },
    destroy() { ro.disconnect(); document.fonts?.removeEventListener('loadingdone', refont); host.innerHTML = ''; }
  };
}
