// Graphic templates. Each returns HTML for a 1280×720 stage, marking revealable elements with
// R(start, dur, html). Cue attributes the stage understands:
//   data-r="s,d"       revealable wrapper (preset-driven)     data-fx="wipe"  decor element
//   data-c="v|dec|suffix|s,d"  counter                       data-draw="s,d" stroke draws once
//   data-cut="t" / data-until="t"  frame cut on / off         data-move="x0,y0,x1,y1,s,d" cursor move
//   data-seg="frac|s|d"  bar fills in whole 12 px segments     data-press="t0,t1" press scale
import { E, prog as p } from './easing';
import { shapeHtml, shapeUpdate } from './shapeRender';
import { stickHtml, stickUpdate } from './stickRender';
import { CAPS, esc, INK, MONO, NUM, SANS, SERIF, type AccentId } from './tokens';

export interface Clip {
  id: string; tpl: string; start: number; dur: number; props: Record<string, string>;
  /** Layer in the stack (0 = bottom). Graphics on higher layers draw on top of lower ones. */
  track?: number;
  /** Unsaved preset to preview (Motion Lab); wins over props.reveal. */
  motion?: import('./presets').Preset;
}
type Html = (P: Record<string, string>, a: string, clip: Clip, ai: string) => string;
export interface Template {
  id: string;
  name: string;
  dur: number;
  fields: [key: string, label: string][];
  d: Record<string, string>;
  accent: AccentId;
  field: string;
  html: Html;
  /** Bespoke per-frame logic beyond the cue attributes. */
  update?: (layer: HTMLElement, clip: Clip) => (t: number) => void;
  /** Hidden from the Studio library (used for previews). */
  hidden?: boolean;
}

export const R = (s: number, d: number, html: string, o: { w?: string; i?: string; fx?: string } = {}) =>
  `<div data-r="${s},${d}"${o.fx ? ` data-fx="${o.fx}"` : ''} style="overflow:hidden;${o.w || ''}"><div style="${o.i || ''}">${html}</div></div>`;
const tc = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const seg = (a: string, frac: number, s: number, d: number, h = 30) =>
  `<div style="height:${h}px;box-shadow:inset 0 0 0 1px var(--w-rule);padding:3px;box-sizing:border-box"><div data-seg="${frac}|${s}|${d}" style="height:100%;width:0;background-image:repeating-linear-gradient(90deg,${a} 0 10px,transparent 10px 12px)"></div></div>`;

const ROWS = [{ n: 'Gaming', a: 210, b: 412 }, { n: 'Music', a: 240, b: 338 }, { n: 'Education', a: 98, b: 271 }, { n: 'Comedy', a: 120, b: 196 }, { n: 'Sports', a: 140, b: 154 }];

function rankUpd(layer: HTMLElement) {
  const rows = [...layer.querySelectorAll<HTMLElement>('[data-row]')].map(el => ({ el, bar: el.querySelector<HTMLElement>('[data-bar]')!, track: el.querySelector<HTMLElement>('[data-track]')!, val: el.querySelector<HTMLElement>('[data-val]')! }));
  const rk = (k: 'a' | 'b') => { const o = ROWS.map((_, i) => i).sort((x, y) => ROWS[y][k] - ROWS[x][k]), r: number[] = []; o.forEach((i, n) => (r[i] = n)); return r; };
  const rA = rk('a'), rB = rk('b'), mA = Math.max(...ROWS.map(r => r.a)), mB = Math.max(...ROWS.map(r => r.b));
  let tw = 0;
  return (t: number) => {
    if (!tw) tw = rows[0].track.clientWidth - 6;
    const m = E.io(p(t, 2.6, 0.7));
    rows.forEach((row, i) => {
      const r = ROWS[i], kin = E.out(p(t, 0.35 + rA[i] * 0.07, 0.8));
      row.el.style.transform = m <= 0 && rA[i] === 0 ? 'none' : `translate(0,${((rA[i] * (1 - m) + rB[i] * m) * 64).toFixed(3)}px)`;
      const frac = (r.a / mA) * (1 - m) + (r.b / mB) * m, n = Math.round((frac * kin * (tw + 2)) / 12);
      row.bar.style.width = Math.max(0, n * 12 - 2) + 'px';
      row.val.textContent = String(Math.round(r.a * kin * (1 - m) + r.b * m));
    });
  };
}

const T: Template[] = [
  // ── from the Plotline Studio design ──────────────────────────────────────
  {
    id: 'lt', name: 'Lower third', dur: 5, fields: [['name', 'Name'], ['role', 'Role']], d: { name: 'Name Surname', role: 'Role · Channel' }, accent: 'orange', field: 'clear',
    html: (P, a) => `<div style="position:absolute;left:96px;bottom:92px;display:flex">
    ${R(0, 0.32, '', { w: 'display:flex', i: `width:14px;background:${a}`, fx: 'wipe' })}
    <div style="display:flex;flex-direction:column;align-items:flex-start">
      ${R(0.06, 0.5, esc(P.name), { i: `background:var(--w-plate);color:var(--w-plate-fg);padding:18px 30px 16px;${SANS}font-weight:600;font-size:46px;line-height:1.05;letter-spacing:-.01em` })}
      ${R(0.24, 0.45, esc(P.role), { i: `background:var(--w-plate2);color:var(--w-plate2-fg);padding:12px 30px;${CAPS}font-size:15px` })}
    </div></div>`
  },
  {
    id: 'ch', name: 'Chapter card', dur: 4.5, fields: [['label', 'Label'], ['num', 'Number'], ['title', 'Title']], d: { label: 'Chapter', num: '02', title: 'Next chapter' }, accent: 'green', field: 'blue',
    html: (P, a, c) => `<div style="position:absolute;left:96px;right:96px;top:104px;bottom:104px">
    <div style="position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;align-items:center">
      ${R(0, 0.4, `<span style="width:14px;height:14px;background:${a}"></span>${esc(P.label)}`, { i: `display:flex;align-items:center;gap:14px;${CAPS}font-size:16px;color:var(--w-fg)` })}
      ${R(0.1, 0.4, tc(c.start), { i: `${MONO}font-size:16px;letter-spacing:.06em;color:var(--w-fg)` })}
    </div>
    ${R(0.05, 0.8, '', { w: 'position:absolute;left:0;right:0;top:40px;height:2px', i: 'height:2px;background:var(--w-fg)', fx: 'wipe' })}
    ${R(0.15, 0.6, esc(P.num), { w: 'position:absolute;left:-10px;top:72px', i: `${NUM}font-size:300px;line-height:.84;color:var(--w-fg)` })}
    ${R(0.32, 0.7, esc(P.title), { w: 'position:absolute;left:0;right:0;bottom:-12px;padding-bottom:14px', i: `${SERIF}font-size:136px;line-height:1;letter-spacing:-.01em;color:var(--w-fg)` })}
  </div>`
  },
  {
    id: 'stat', name: 'Stat', dur: 7, fields: [['label', 'Label'], ['value', 'Value'], ['suffix', 'Suffix'], ['caption', 'Caption'], ['delta', 'Change']], d: { label: 'Metric', value: '128', suffix: 'K', caption: 'subscribers this month', delta: '+24%' }, accent: 'orange', field: 'blue',
    html: (P, a, _c, ai) => {
      const v = parseFloat(String(P.value).replace(/,/g, '')) || 0, dec = (String(P.value).split('.')[1] || '').length, area = a === '#FFFFFF' ? INK : a;
      return `<div style="position:absolute;left:96px;top:110px;display:flex;flex-direction:column;gap:22px">
      ${R(0, 0.4, esc(P.label), { i: `${CAPS}font-size:16px;color:var(--w-fg)` })}
      ${R(0.08, 0.55, `<span data-c="${v}|${dec}|${esc(P.suffix)}|.12,1.3">${v.toFixed(dec)}${esc(P.suffix)}</span>`, { i: `${NUM}font-size:250px;line-height:.86;color:var(--w-fg)` })}
      ${R(0.4, 0.6, esc(P.caption), { w: 'padding-bottom:10px;max-width:600px', i: `${SERIF}font-size:58px;line-height:1.02;color:var(--w-fg)` })}
    </div>
    ${R(0.5, 0.6, `<div style="display:flex;justify-content:space-between;align-items:center"><span style="${CAPS}font-size:13px;color:var(--w-plate-fg)">First 48 h</span><span data-cut="1.55" style="background:${a};color:${ai};padding:6px 10px;${CAPS}font-size:13px;box-shadow:inset 0 0 0 1px var(--w-plate-fg)">${esc(P.delta)}</span></div>
      <svg viewBox="0 0 384 150" width="384" height="150" style="display:block;overflow:visible">
        <path data-cut="1.7" d="M0 132L48 124L96 128L144 108L192 112L240 82L288 62L336 32L384 8V150H0Z" fill="${area}" opacity="${a === '#FFFFFF' ? 0.1 : 0.35}"></path>
        <path d="M0 149.5H384" style="stroke:var(--w-plate-fg)" stroke-width="1" opacity=".3"></path>
        <path data-draw=".75,1" pathLength="1" d="M0 132L48 124L96 128L144 108L192 112L240 82L288 62L336 32L384 8" fill="none" style="stroke:var(--w-plate-fg)" stroke-width="4" stroke-dasharray="1" stroke-dashoffset="1"></path>
        <rect data-cut="1.72" x="377" y="1" width="14" height="14" fill="${a}" style="stroke:var(--w-plate-fg)" stroke-width="2"></rect>
      </svg>`, { w: 'position:absolute;right:96px;top:160px;width:440px', i: 'background:var(--w-plate);padding:26px 28px 30px;display:flex;flex-direction:column;gap:20px' })}`;
    }
  },
  {
    id: 'rank', name: 'Ranking', dur: 9, fields: [['unit', 'Label'], ['title', 'Title'], ['from', 'From year'], ['to', 'To year']], d: { unit: 'Monthly hours watched · billions', title: 'Where the hours go', from: '2018', to: '2024' }, accent: 'purple', field: 'ink',
    update: rankUpd,
    html: (P, a) => `<div style="position:absolute;left:96px;right:96px;top:84px;bottom:84px">
    ${R(0, 0.4, esc(P.unit), { i: `${CAPS}font-size:15px;color:var(--w-fg)` })}
    ${R(0.08, 0.6, esc(P.title), { w: 'margin-top:14px;padding-bottom:8px;max-width:760px', i: `${SERIF}font-size:76px;line-height:1;color:var(--w-fg)` })}
    ${R(0.2, 0.5, `<span data-until="2.6">${esc(P.from)}</span><span data-cut="2.6">${esc(P.to)}</span>`, { w: 'position:absolute;right:0;top:0', i: `${NUM}font-size:150px;line-height:.86;color:var(--w-fg)` })}
    <div style="position:absolute;left:0;right:0;top:216px">
      ${ROWS.map((r, i) => `<div data-row="${i}" style="position:absolute;left:0;right:0;top:0;height:50px;display:flex;align-items:center;gap:24px">
        ${R(0.28 + i * 0.06, 0.45, r.n, { w: 'width:190px;flex:none', i: `${SANS}font-weight:600;font-size:28px;line-height:1.3;color:var(--w-fg)` })}
        ${R(0.3 + i * 0.06, 0.35, `<div data-track style="height:30px;box-shadow:inset 0 0 0 1px var(--w-rule);padding:3px;box-sizing:border-box"><div data-bar style="height:100%;width:0;background-image:repeating-linear-gradient(90deg,${a} 0 10px,transparent 10px 12px)"></div></div>`, { w: 'flex:1;min-width:0' })}
        ${R(0.34 + i * 0.06, 0.4, '<span data-val>0</span>', { w: 'width:96px;flex:none;text-align:right', i: `${NUM}font-size:40px;line-height:1.1;color:var(--w-fg)` })}
      </div>`).join('')}
    </div></div>`
  },
  {
    id: 'check', name: 'Checklist', dur: 7, fields: [['title', 'Title'], ['a', 'Item 1'], ['b', 'Item 2'], ['c', 'Item 3']], d: { title: "What you'll learn", a: 'First point', b: 'Second point', c: 'Third point' }, accent: 'green', field: 'blue',
    html: (P, a) => `<div style="position:absolute;left:96px;top:150px;width:440px;display:flex;flex-direction:column;gap:20px">
      ${R(0, 0.4, 'In this episode', { i: `${CAPS}font-size:15px;color:var(--w-fg)` })}
      ${R(0.08, 0.6, esc(P.title), { w: 'padding-bottom:12px', i: `${SERIF}font-size:100px;line-height:.98;color:var(--w-fg)` })}
    </div>
    <div style="position:absolute;left:600px;right:96px;top:196px;display:flex;flex-direction:column">
      ${[P.a, P.b, P.c].map((txt, i) => { const s = 0.35 + i * 0.32; return `${R(s - 0.05, 0.6, '', { i: 'height:1px;background:var(--w-rule)', fx: 'wipe' })}
        <div style="display:flex;align-items:center;gap:28px;padding:22px 0">
          ${R(s, 0.3, `<svg width="48" height="48" viewBox="0 0 48 48" style="display:block"><rect x="1.5" y="1.5" width="45" height="45" fill="none" style="stroke:var(--w-fg)" stroke-width="3"></rect><path data-draw="${s + 0.28},.3" pathLength="1" d="M11 25L20 34L38 14" fill="none" stroke="${a}" stroke-width="6" stroke-dasharray="1" stroke-dashoffset="1"></path></svg>`, { w: 'flex:none' })}
          ${R(s + 0.06, 0.5, esc(txt), { w: 'flex:1;min-width:0', i: `${SANS}font-weight:500;font-size:36px;line-height:1.15;color:var(--w-fg)` })}
        </div>`; }).join('')}
    </div>`
  },
  {
    id: 'sub', name: 'Subscribe', dur: 5.5, fields: [['label', 'Label'], ['handle', 'Handle'], ['cta', 'Button']], d: { label: 'New every Thursday', handle: '@web_world_wide', cta: 'Subscribe' }, accent: 'orange', field: 'ink',
    html: (P, a, _c, ai) => `<div style="position:absolute;left:250px;top:250px;display:flex;gap:40px;align-items:flex-start">
      ${R(0, 0.45, `<div style="width:160px;height:160px;background:${a};display:flex;align-items:center;justify-content:center;${SERIF}font-size:120px;line-height:1;color:${ai}">W</div>`)}
      <div style="display:flex;flex-direction:column;gap:14px;align-items:flex-start">
        ${R(0.08, 0.45, esc(P.label), { i: `${CAPS}font-size:15px;color:var(--w-fg)` })}
        ${R(0.14, 0.5, esc(P.handle), { w: 'padding-bottom:6px', i: `${SANS}font-weight:600;font-size:56px;line-height:1.05;letter-spacing:-.01em;color:var(--w-fg)` })}
        <div style="display:flex;gap:18px;align-items:center;margin-top:4px">
          ${R(0.3, 0.45, `<div data-until="1.35" data-nosplit style="background:var(--w-plate);color:var(--w-plate-fg);padding:18px 30px;${CAPS}font-size:18px">${esc(P.cta)}</div><div data-cut="1.35" data-nosplit style="display:flex;align-items:center;gap:12px;background:var(--w-plate2);color:var(--w-plate2-fg);box-shadow:inset 0 0 0 2px var(--w-plate2-fg);padding:18px 30px;${CAPS}font-size:18px"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8.5L6 12.5L14 3.5" fill="none" stroke="${a}" stroke-width="3"></path></svg>Subscribed</div>`)}
          <div data-cut="1.6" style="display:flex;align-items:center;gap:10px;${CAPS}font-size:14px;color:var(--w-fg)"><span style="width:12px;height:12px;background:${a}"></span>Notifications on</div>
        </div>
      </div></div>
    <svg data-move="1180,700,540,392,.55,.7" data-press="1.28,1.42" width="34" height="40" viewBox="0 0 34 40" style="position:absolute;left:0;top:0"><path d="M3 3V31L10 24L15 36L20 34L15 22H25Z" fill="#fff" stroke="${INK}" stroke-width="2"></path></svg>`
  },

  // ── extended library, same vocabulary ────────────────────────────────────
  {
    id: 'title', name: 'Title card', dur: 5, fields: [['kicker', 'Kicker'], ['title', 'Title'], ['em', 'Emphasis']], d: { kicker: 'Web World Wide · Ep. 001', title: 'Where the', em: 'hours go' }, accent: 'orange', field: 'blue',
    html: (P, a) => `<div style="position:absolute;left:96px;right:96px;top:170px">
      ${R(0, 0.4, esc(P.kicker), { i: `${CAPS}font-size:16px;color:var(--w-fg)` })}
      ${R(0.06, 0.7, '', { w: 'margin-top:22px;height:2px', i: `height:2px;background:${a}`, fx: 'wipe' })}
      ${R(0.14, 0.7, esc(P.title), { w: 'margin-top:30px;padding-bottom:16px', i: `${SERIF}font-size:168px;line-height:.92;letter-spacing:-.015em;color:var(--w-fg)` })}
      ${R(0.3, 0.7, `<i>${esc(P.em)}</i>`, { w: 'padding-bottom:20px', i: `${SERIF}font-size:168px;line-height:.92;letter-spacing:-.015em;color:${a}` })}
    </div>`
  },
  {
    id: 'quote', name: 'Quote', dur: 7, fields: [['quote', 'Quote'], ['who', 'Attribution'], ['src', 'Source']], d: { quote: 'The algorithm rewards the second minute, not the first.', who: 'Creator Insider', src: 'Livestream · 2024' }, accent: 'purple', field: 'ink',
    html: (P, a) => `<div style="position:absolute;left:96px;right:200px;top:120px">
      ${R(0, 0.35, '', { w: 'width:56px;height:56px', i: `width:56px;height:56px;background:${a}`, fx: 'wipe' })}
      ${R(0.1, 0.8, esc(P.quote), { w: 'margin-top:36px;padding-bottom:14px', i: `${SERIF}font-size:84px;line-height:1.02;color:var(--w-fg);text-wrap:balance` })}
      <div style="display:flex;align-items:center;gap:18px;margin-top:34px">
        ${R(0.55, 0.5, '', { w: 'width:48px;height:2px', i: 'height:2px;background:var(--w-fg)', fx: 'wipe' })}
        ${R(0.6, 0.5, esc(P.who), { i: `${CAPS}font-size:16px;color:var(--w-fg)` })}
        ${R(0.7, 0.5, esc(P.src), { i: `${MONO}font-size:15px;color:var(--w-dim)` })}
      </div>
    </div>`
  },
  {
    id: 'versus', name: 'Versus', dur: 7, fields: [['la', 'Left label'], ['lv', 'Left value'], ['ra', 'Right label'], ['rv', 'Right value'], ['note', 'Footnote']], d: { la: 'Shorts', lv: '61%', ra: 'Long-form', rv: '39%', note: 'Share of watch time · Q3' }, accent: 'green', field: 'blue',
    html: (P, a, _c, ai) => `<div style="position:absolute;inset:96px">
      ${R(0.3, 0.6, '', { w: 'position:absolute;left:50%;top:0;bottom:60px;width:2px;margin-left:-1px', i: 'width:2px;height:100%;background:var(--w-fg)', fx: 'wipe' })}
      <div style="position:absolute;left:0;width:calc(50% - 60px);top:40px;display:flex;flex-direction:column;gap:18px">
        ${R(0, 0.4, esc(P.la), { i: `${CAPS}font-size:18px;color:var(--w-fg)` })}
        ${R(0.1, 0.6, esc(P.lv), { i: `${NUM}font-size:220px;line-height:.86;color:var(--w-fg)` })}
        ${R(0.5, 0.6, seg('var(--w-fg)', 0.61, 0.9, 1.2, 26))}
      </div>
      <div style="position:absolute;right:0;width:calc(50% - 60px);top:40px;display:flex;flex-direction:column;gap:18px;align-items:stretch">
        ${R(0.12, 0.4, esc(P.ra), { i: `${CAPS}font-size:18px;color:var(--w-fg)` })}
        ${R(0.22, 0.6, esc(P.rv), { i: `${NUM}font-size:220px;line-height:.86;color:${a}` })}
        ${R(0.6, 0.6, seg(a, 0.39, 1.0, 1.2, 26))}
      </div>
      ${R(0.45, 0.3, 'VS', { w: 'position:absolute;left:50%;top:150px;margin-left:-40px', i: `width:80px;height:80px;display:flex;align-items:center;justify-content:center;background:${a};color:${ai};${CAPS}font-size:22px;letter-spacing:.1em` })}
      ${R(0.8, 0.5, esc(P.note), { w: 'position:absolute;left:0;bottom:0', i: `${MONO}font-size:15px;color:var(--w-dim)` })}
    </div>`
  },
  {
    id: 'steps', name: 'Steps', dur: 8, fields: [['title', 'Title'], ['a', 'Step 1'], ['b', 'Step 2'], ['c', 'Step 3'], ['d', 'Step 4']], d: { title: 'The launch window', a: 'Hook', b: 'Retain', c: 'Re-surface', d: 'Recommend' }, accent: 'orange', field: 'ink',
    html: (P, a, _c, ai) => `<div style="position:absolute;left:96px;right:96px;top:120px">
      ${R(0, 0.4, 'How it works', { i: `${CAPS}font-size:15px;color:var(--w-fg)` })}
      ${R(0.08, 0.6, esc(P.title), { w: 'margin-top:14px;padding-bottom:10px', i: `${SERIF}font-size:96px;line-height:1;color:var(--w-fg)` })}
      <div style="position:relative;margin-top:70px;display:grid;grid-template-columns:repeat(4,1fr);gap:0">
        ${R(0.3, 1.4, '', { w: 'position:absolute;left:0;right:0;top:27px;height:2px', i: 'height:2px;background:var(--w-rule)', fx: 'wipe' })}
        ${[P.a, P.b, P.c, P.d].map((s, i) => `<div style="position:relative;display:flex;flex-direction:column;gap:22px;padding-right:24px">
          ${R(0.4 + i * 0.3, 0.3, String(i + 1).padStart(2, '0'), { w: 'align-self:flex-start', i: `width:56px;height:56px;display:flex;align-items:center;justify-content:center;${i === 3 ? `background:${a};color:${ai}` : 'background:var(--w-plate);color:var(--w-plate-fg)'};${NUM}font-size:30px` })}
          ${R(0.48 + i * 0.3, 0.5, esc(s), { w: 'padding-bottom:6px', i: `${SANS}font-weight:600;font-size:40px;line-height:1.05;color:var(--w-fg)` })}
        </div>`).join('')}
      </div>
    </div>`
  },
  {
    id: 'loc', name: 'Location', dur: 5, fields: [['label', 'Label'], ['place', 'Place'], ['coords', 'Coordinates']], d: { label: 'Filmed in', place: 'Reykjavík, Iceland', coords: '64.1466° N · 21.9426° W' }, accent: 'green', field: 'clear',
    html: (P, a, _c, ai) => `<div style="position:absolute;left:96px;top:96px;display:flex;gap:22px;align-items:stretch">
      ${R(0, 0.35, `<svg width="44" height="44" viewBox="0 0 44 44" style="display:block"><rect x="1.5" y="1.5" width="41" height="41" fill="none" stroke="${ai}" stroke-width="3"></rect><path data-draw=".35,.5" pathLength="1" d="M22 10V34M10 22H34" stroke="${ai}" stroke-width="3" fill="none" stroke-dasharray="1" stroke-dashoffset="1"></path></svg>`, { i: `background:${a};padding:14px` })}
      <div style="display:flex;flex-direction:column;gap:10px;justify-content:center">
        ${R(0.08, 0.4, esc(P.label), { i: `${CAPS}font-size:14px;color:var(--w-fg)` })}
        ${R(0.14, 0.55, esc(P.place), { w: 'padding-bottom:4px', i: `${SANS}font-weight:600;font-size:44px;line-height:1.05;letter-spacing:-.01em;color:var(--w-fg)` })}
        ${R(0.3, 0.5, esc(P.coords), { i: `${MONO}font-size:15px;color:var(--w-dim)` })}
      </div>
    </div>`
  },
  {
    id: 'news', name: 'Breaking bar', dur: 6, fields: [['tag', 'Tag'], ['head', 'Headline'], ['tick', 'Ticker']], d: { tag: 'Breaking', head: 'Shorts now count toward watch hours', tick: 'Update rolls out Thursday · Applies to all partner channels · Existing hours unaffected' }, accent: 'orange', field: 'clear',
    html: (P, a, _c, ai) => `<div style="position:absolute;left:0;right:0;bottom:80px">
      <div style="display:flex;align-items:stretch;margin-left:96px;margin-right:96px">
        ${R(0, 0.35, esc(P.tag), { w: 'flex:none', i: `height:100%;box-sizing:border-box;display:flex;align-items:center;padding:0 26px;background:${a};color:${ai};${CAPS}font-size:18px` })}
        ${R(0.1, 0.6, esc(P.head), { w: 'flex:1;min-width:0', i: `background:var(--w-plate);color:var(--w-plate-fg);padding:22px 28px;${SANS}font-weight:600;font-size:40px;line-height:1.05;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis` })}
      </div>
      ${R(0.3, 0.6, esc(P.tick), { w: 'margin:0 96px', i: `background:var(--w-plate2);color:var(--w-plate2-fg);padding:12px 28px;${MONO}font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis` })}
    </div>`
  },
  {
    id: 'define', name: 'Definition', dur: 7, fields: [['word', 'Word'], ['say', 'Pronunciation'], ['pos', 'Part of speech'], ['def', 'Definition']], d: { word: 'Retention', say: '/rɪˈtɛn.ʃən/', pos: 'Noun', def: 'The share of a video people are still watching at a given moment.' }, accent: 'purple', field: 'ink',
    html: (P, a) => `<div style="position:absolute;left:96px;right:240px;top:130px">
      <div style="display:flex;align-items:baseline;gap:24px">
        ${R(0, 0.7, esc(P.word), { w: 'padding-bottom:14px', i: `${SERIF}font-size:150px;line-height:.95;color:var(--w-fg)` })}
        ${R(0.3, 0.5, esc(P.say), { i: `${MONO}font-size:22px;color:var(--w-dim)` })}
      </div>
      ${R(0.35, 0.8, '', { w: 'margin-top:20px;height:2px', i: 'height:2px;background:var(--w-rule)', fx: 'wipe' })}
      <div style="display:flex;gap:28px;margin-top:30px;align-items:flex-start">
        ${R(0.45, 0.35, esc(P.pos), { w: 'flex:none', i: `background:${a};color:var(--w-fg);padding:8px 14px;${CAPS}font-size:14px` })}
        ${R(0.55, 0.7, esc(P.def), { w: 'padding-bottom:6px', i: `${SANS}font-weight:500;font-size:40px;line-height:1.2;color:var(--w-fg)` })}
      </div>
    </div>`
  },
  {
    id: 'count', name: 'Countdown', dur: 5, fields: [['label', 'Label'], ['num', 'Number'], ['title', 'Title']], d: { label: 'Top five · Number', num: '03', title: 'The second-minute hook' }, accent: 'orange', field: 'blue',
    html: (P, a, _c, ai) => `<div style="position:absolute;left:96px;right:96px;top:96px;bottom:96px;display:flex;gap:56px;align-items:flex-end">
      ${R(0, 0.55, esc(P.num), { w: 'flex:none', i: `background:${a};color:${ai};padding:24px 30px 6px;${NUM}font-size:330px;line-height:.82` })}
      <div style="display:flex;flex-direction:column;gap:18px;padding-bottom:10px;min-width:0">
        ${R(0.15, 0.4, esc(P.label), { i: `${CAPS}font-size:16px;color:var(--w-fg)` })}
        ${R(0.25, 0.7, esc(P.title), { w: 'padding-bottom:14px', i: `${SERIF}font-size:104px;line-height:.96;color:var(--w-fg)` })}
      </div>
    </div>`
  },
  {
    id: 'poll', name: 'Poll', dur: 8, fields: [['q', 'Question'], ['a', 'Option A'], ['av', 'A %'], ['b', 'Option B'], ['bv', 'B %'], ['c', 'Option C'], ['cv', 'C %']], d: { q: 'When do you watch?', a: 'Evenings', av: '54', b: 'Lunch break', bv: '28', c: 'Commute', cv: '18' }, accent: 'green', field: 'ink',
    html: (P, a) => {
      const rows = [[P.a, P.av], [P.b, P.bv], [P.c, P.cv]].map(([n, v]) => [n, Math.max(0, Math.min(100, parseFloat(v) || 0))] as const);
      return `<div style="position:absolute;left:96px;right:96px;top:110px">
      ${R(0, 0.4, 'Community poll', { i: `${CAPS}font-size:15px;color:var(--w-fg)` })}
      ${R(0.08, 0.6, esc(P.q), { w: 'margin-top:14px;padding-bottom:10px', i: `${SERIF}font-size:96px;line-height:1;color:var(--w-fg)` })}
      <div style="margin-top:46px;display:flex;flex-direction:column;gap:26px">
      ${rows.map(([n, v], i) => `<div style="display:grid;grid-template-columns:260px 1fr 120px;gap:24px;align-items:center">
        ${R(0.3 + i * 0.1, 0.45, esc(n), { i: `${SANS}font-weight:600;font-size:32px;line-height:1.2;color:var(--w-fg)` })}
        ${R(0.34 + i * 0.1, 0.35, seg(i ? 'var(--w-fg)' : a, v / 100, 0.6 + i * 0.12, 1.1, 34))}
        ${R(0.4 + i * 0.1, 0.4, `<span data-c="${v}|0|%|${0.6 + i * 0.12},1.1">0%</span>`, { w: 'text-align:right', i: `${NUM}font-size:48px;line-height:1.05;color:${i ? 'var(--w-fg)' : a}` })}
      </div>`).join('')}
      </div></div>`;
    }
  },

  // ── shapes: arrows, callouts, frames, marks (see shapes.ts) ───────────────
  {
    id: 'shape', name: 'Shape', dur: 4, hidden: true, fields: [['label', 'Label']], d: { shape: 'arrow', label: '' }, accent: 'orange', field: 'clear',
    html: (P, a, _c, ai) => shapeHtml(P, a, ai),
    update: (layer, clip) => shapeUpdate(layer, clip)
  },

  // ── stick figures: scripted characters (see stick.ts) ─────────────────────
  {
    id: 'stick', name: 'Stick figures', dur: 6.3, hidden: true, fields: [], d: {}, accent: 'orange', field: 'paper',
    html: (P, a) => stickHtml(P, a),
    update: (layer, clip) => stickUpdate(layer, clip)
  },

  // ── preview specimen for the motion library ──────────────────────────────
  {
    id: 'specimen', name: 'Specimen', dur: 3.4, hidden: true, fields: [['label', 'Label'], ['title', 'Title'], ['tag', 'Tag']], d: { label: 'Webimation · Motion', title: 'Where the hours go', tag: 'Ep. 001' }, accent: 'orange', field: 'blue',
    html: (P, a) => `<div style="position:absolute;left:110px;right:110px;top:150px">
      ${R(0, 0.45, esc(P.label), { i: `${CAPS}font-size:24px;color:var(--w-fg)` })}
      ${R(0.1, 0.75, esc(P.title), { w: 'margin-top:26px;padding-bottom:18px', i: `${SERIF}font-size:150px;line-height:.95;letter-spacing:-.01em;color:var(--w-fg)` })}
      <div style="display:flex;gap:0;margin-top:40px;align-items:stretch">
        ${R(0.3, 0.4, '', { w: 'display:flex', i: `width:22px;background:${a}`, fx: 'wipe' })}
        ${R(0.36, 0.55, esc(P.tag), { i: `background:var(--w-plate);color:var(--w-plate-fg);padding:20px 34px;${CAPS}font-size:32px` })}
      </div>
    </div>`
  }
];

export const TEMPLATES: Record<string, Template> = Object.fromEntries(T.map(t => [t.id, t]));
export const LIBRARY_TEMPLATES = T.filter(t => !t.hidden);
