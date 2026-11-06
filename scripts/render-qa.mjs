// Contact-sheet QA gate (run with the dev server up: `npm run dev -- --port 5179`, then `npm run qa:sheet`).
// For every template in TEMPLATES, with the default preset, renders 6 evenly spaced frames from 0 up to the
// rest frame (dur - 0.5) through createStage into a 1280x720 host, then writes:
//   qa-output/<template>.png   contact sheet, 3 x 2 grid, frame times labelled, flagged frames outlined
//   qa-output/report.md        every warning and failure found
// Checks per frame:
//   overflow  (warning) text, or a text-less [data-r] box, whose bounds leave the 5% title-safe margin
//   console   (fail)    any page console error or uncaught page error
//   blank     (fail)    rest frame with no visible non-zero-size element, or a rest image of one colour
// Exits 1 on any blank frame or console error. Overflow warnings are listed and never fail the run.
// Heuristic limits: text clipped by an ancestor's overflow (mask/wipe reveals mid-animation) is measured
// unclipped, so it can be reported even though the visible part is inside the margin.
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const URL_ = process.env.WEBIMATION_URL || 'http://localhost:5179/';
const OUT = fileURLToPath(new URL('../qa-output/', import.meta.url));
const FRAMES = 6;
// Optional stage props applied to every frame, e.g. QA_PROPS='{"place":"br","size":"1.4"}' to stress placement.
const PROPS = JSON.parse(process.env.QA_PROPS || "{}");
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Runs in the page. Mounts one stage at `t`, returns overflow warnings and the visible element count.
async function renderFrame({ tpl, dur, t, props }) {
  const m = await import('/src/engine/index.ts');
  window.__qaStage?.destroy();
  let host = document.getElementById('qa-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'qa-host';
    host.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:720px;z-index:9999;pointer-events:none;background:#000;overflow:hidden';
    document.body.append(host);
  }
  const clip = { id: 'qa', tpl, start: 0, dur, props };
  const st = m.createStage(host);
  window.__qaStage = st;
  st.show(clip, t);
  await document.fonts.ready;      // webfonts can land after the first build; measure the settled layout
  st.show(clip, t);

  const root = host.querySelector('[data-stage-root]'), stack = root.children[0];
  const rr = root.getBoundingClientRect(), k = rr.width / 1280 || 1;
  const box = r => [(r.left - rr.left) / k, (r.top - rr.top) / k, (r.right - rr.left) / k, (r.bottom - rr.top) / k].map(v => Math.round(v * 10) / 10);
  // Effective opacity down to the stage root; 0 means not on screen (reveal not started, or exited).
  const shown = el => {
    let o = 1;
    for (let e = el; e && e !== root; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= parseFloat(cs.opacity);
    }
    return o;
  };
  const M = { x0: 0.05 * 1280, y0: 0.05 * 720, x1: 0.95 * 1280, y1: 0.95 * 720 };
  const outside = b => b[0] < M.x0 || b[1] < M.y0 || b[2] > M.x1 || b[3] > M.y1;

  const overflow = [];
  const tw = document.createTreeWalker(stack, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode());) {
    const s = n.textContent.trim();
    if (!s || n.parentElement.closest('style,script') || !shown(n.parentElement)) continue;
    const rg = document.createRange();
    rg.selectNodeContents(n);
    const r = rg.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const b = box(r);
    if (outside(b)) overflow.push({ kind: 'text', el: s.slice(0, 60), box: b });
  }
  for (const el of stack.querySelectorAll('[data-r]')) {
    if (el.textContent.trim() || !shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const b = box(r);
    if (outside(b)) overflow.push({ kind: 'box', el: el.tagName.toLowerCase() + (el.dataset.fx ? ` fx=${el.dataset.fx}` : ''), box: b });
  }
  let visible = 0;
  for (const el of stack.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && shown(el) > 0) visible++;
  }
  return { overflow, visible };
}

// Runs in the sheet page once the frame images are loaded. Counts distinct quantised colours per frame.
async function colourCounts() {
  const imgs = [...document.images];
  await Promise.all(imgs.map(i => i.decode()));
  const c = document.createElement('canvas');
  c.width = 320; c.height = 180;
  const g = c.getContext('2d', { willReadFrequently: true });
  return imgs.map(i => {
    g.clearRect(0, 0, 320, 180);
    g.drawImage(i, 0, 0, 320, 180);
    const d = g.getImageData(0, 0, 320, 180).data, seen = new Set();
    for (let p = 0; p < d.length; p += 4) seen.add(((d[p] >> 4) << 8) | ((d[p + 1] >> 4) << 4) | (d[p + 2] >> 4));
    return seen.size;
  });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
let ctx = 'startup';
const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push({ ctx, text: msg.text() }); });
page.on('pageerror', e => consoleErrors.push({ ctx, text: 'uncaught: ' + e.message }));
await page.goto(URL_, { waitUntil: 'networkidle' });
const templates = await page.evaluate(async () => {
  const m = await import('/src/engine/index.ts');
  await document.fonts.ready;
  return Object.entries(m.TEMPLATES).map(([id, t]) => ({ id, name: t.name, dur: t.dur }));
});

const report = [];       // one record per template
const sheetPage = await browser.newPage({ viewport: { width: 2000, height: 900 }, deviceScaleFactor: 1 });

for (const tpl of templates) {
  const rest = +(tpl.dur - 0.5).toFixed(3);
  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    const t = +(rest * i / (FRAMES - 1)).toFixed(3);
    ctx = `${tpl.id}@${t}`;
    const info = await page.evaluate(renderFrame, { tpl: tpl.id, dur: tpl.dur, t, props: PROPS });
    await page.waitForTimeout(40); // let console events from this frame arrive before the next one is tagged
    const png = await page.locator('#qa-host').screenshot();
    frames.push({ t, isRest: i === FRAMES - 1, png: png.toString('base64'), overflow: info.overflow, visible: info.visible });
  }

  // Contact sheet. Pixel check on the rest frame uses the same screenshots the sheet shows.
  const tiles = frames.map(f => `<div class="tile"><img src="data:image/png;base64,${f.png}"><div class="cap"><span>t=${f.t.toFixed(2)}s${f.isRest ? ' · REST' : ''}</span><span>${f.overflow.length ? `${f.overflow.length} margin` : ''}</span></div></div>`).join('');
  await sheetPage.setContent(`<!doctype html><html><head><style>
    body{margin:0;background:#1b1b1f;font:14px/1.3 system-ui,sans-serif;color:#ddd}
    #sheet{width:1976px;padding:24px;box-sizing:border-box}
    h1{font-size:20px;margin:0 0 4px} .sub{color:#9a9ca3;margin-bottom:16px}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px 16px}
    .tile img{display:block;width:100%;aspect-ratio:16/9;outline:4px solid transparent;outline-offset:-4px}
    .tile.warn img{outline-color:#ffb020} .tile.fail img{outline-color:#ff3b30}
    .cap{display:flex;justify-content:space-between;font:12px ui-monospace,Menlo,monospace;color:#9a9ca3;padding:5px 2px}
    .cap span:last-child{color:#ffb020}
  </style></head><body><div id="sheet">
    <h1>${esc(tpl.id)} · ${esc(tpl.name)}</h1>
    <div class="sub">default preset · dur ${tpl.dur}s · rest frame ${rest}s</div>
    <div class="grid">${tiles}</div>
  </div></body></html>`);
  const colours = await sheetPage.evaluate(colourCounts);
  const blankPixels = colours.map((c, i) => (frames[i].isRest && c <= 2 ? i : -1)).filter(i => i >= 0);
  await sheetPage.evaluate(({ warn, fail }) => {
    [...document.querySelectorAll('.tile')].forEach((el, i) => {
      if (fail.includes(i)) el.classList.add('fail'); else if (warn.includes(i)) el.classList.add('warn');
    });
  }, {
    warn: frames.map((f, i) => (f.overflow.length ? i : -1)).filter(i => i >= 0),
    fail: blankPixels
  });
  const safe = tpl.id.replace(/[^\w-]/g, '_');
  await sheetPage.locator('#sheet').screenshot({ path: OUT + safe + '.png' });

  // A rest frame is blank if the DOM has no visible element or its image is a single colour.
  const blank = [];
  if (frames[FRAMES - 1].visible === 0) blank.push(rest);
  for (const i of blankPixels) if (!blank.includes(frames[i].t)) blank.push(frames[i].t);
  report.push({ tpl, frames: frames.map((f, i) => ({ t: f.t, isRest: f.isRest, visible: f.visible, overflow: f.overflow, colours: colours[i] })), blank });
}
await sheetPage.close();

// Attribute console errors to the frame they were emitted during (frame tag is set before each render).
const errorsByTpl = {};
for (const e of consoleErrors) {
  const tplId = e.ctx.split('@')[0];
  (errorsByTpl[tplId] ||= []).push(e);
}
await browser.close();

const failures = report.filter(r => r.blank.length).length + Object.keys(errorsByTpl).length;
const overflows = report.flatMap(r => r.frames.flatMap(f => f.overflow.map(o => ({ tpl: r.tpl.id, t: f.t, ...o }))));
const blankAll = report.flatMap(r => r.blank.map(t => ({ tpl: r.tpl.id, t })));

const lines = [];
lines.push('# Render QA report', '');
lines.push(`Generated ${new Date().toISOString()} against ${URL_}`, '');
lines.push(`- Templates: ${templates.length} · frames: ${templates.length * FRAMES} (${FRAMES} per template, last one is the rest frame at dur − 0.5 s)`);
lines.push(`- Blank frames: ${blankAll.length} · console errors: ${consoleErrors.length} · margin warnings: ${overflows.length} in ${new Set(overflows.map(o => o.tpl)).size} templates`);
lines.push(`- Result: ${blankAll.length || consoleErrors.length ? 'FAIL' : overflows.length ? 'PASS (warnings only)' : 'PASS'}`, '');
lines.push('## Failures', '');
if (!blankAll.length && !consoleErrors.length) lines.push('None.', '');
for (const b of blankAll) lines.push(`- Blank frame: \`${b.tpl}\` at t=${b.t}s`);
for (const [tplId, errs] of Object.entries(errorsByTpl)) for (const e of errs) lines.push(`- Console error in \`${tplId}\` (${e.ctx}): ${e.text.replace(/\n/g, ' ').slice(0, 300)}`);
lines.push('', '## Margin warnings (5% title-safe box, 1280x720 stage)', '');
if (!overflows.length) lines.push('None.');
else {
  lines.push('| template | t (s) | kind | element | box x0,y0 → x1,y1 |', '|---|---|---|---|---|');
  for (const o of overflows) lines.push(`| \`${o.tpl}\` | ${o.t.toFixed(2)} | ${o.kind} | ${o.el.replace(/\|/g, '\\|')} | ${o.box.join(', ')} |`);
}
lines.push('');
writeFileSync(OUT + 'report.md', lines.join('\n'));

console.log(`qa:sheet ${templates.length} templates → ${OUT}`);
for (const o of overflows.slice(0, 10)) console.log(`  warn  ${o.tpl}@${o.t}s ${o.kind} "${o.el}" ${o.box.join(', ')}`);
if (overflows.length > 10) console.log(`  … ${overflows.length - 10} more in report.md`);
for (const b of blankAll) console.log(`  FAIL  blank frame ${b.tpl}@${b.t}s`);
for (const [tplId, errs] of Object.entries(errorsByTpl)) for (const e of errs) console.log(`  FAIL  console error ${e.ctx}: ${e.text.slice(0, 160)}`);
console.log(failures ? `failed: ${blankAll.length} blank, ${consoleErrors.length} console errors` : `passed (${overflows.length} margin warnings)`);
process.exitCode = blankAll.length || consoleErrors.length ? 1 : 0;
