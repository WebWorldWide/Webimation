// Sub-pixel rest-frame audit (run with the dev server up: `npm run dev -- --port 5179`, then
// `npm run audit:precision`). For every font pairing x placement x template x text-capable effect,
// every glyph at rest must sit within 1/16 px of where it sits in the untouched layout, in
// both engines the app ships on (Chromium = Windows WebView2, WebKit = macOS/Linux), at 1x and 2x.
// Exits non-zero if any case is over tolerance.
import { webkit, chromium } from 'playwright';
const engines = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'webkit'];
const URL_ = process.env.WEBIMATION_URL || 'http://localhost:5179/';
let failed = false;
for (const name of engines) {
  const browser = await ({ chromium, webkit })[name].launch(), page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: +(process.env.DPR || 1) });
  await page.goto(URL_, { waitUntil: 'networkidle' });
  const r = await page.evaluate(async onlyW => {
    const m = await import('/src/engine/index.ts'); await document.fonts.ready;
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:720px;z-index:9999;pointer-events:none'; document.body.append(box);
    const glyphs = root => { const out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), r = document.createRange(); let n; while ((n = w.nextNode())) { const s = n.textContent; for (let i = 0; i < s.length; i++) { if (/\s/.test(s[i])) continue; r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getBoundingClientRect(); if (b.width || b.height) out.push([s[i], b.left, b.top]); } } return out; };
    const fxs = m.EFFECTS.filter(e => e.group === 'Type').map(e => e.id).concat(['wipe', 'mask', 'blinds', 'leader', 'raster']);
    const res = []; let n = 0, worst = 0;
    for (const W of (onlyW ? [onlyW] : [1280, 833])) for (const pr of m.PAIRINGS) for (const [extra, lbl, k] of [[{}, 'tpl', 1], [{ place: 'br', size: '1.2' }, 'br×1.2', 1.2], [{ place: 'mc', size: '0.7', nx: '13' }, 'mc×.7', 0.7]]) for (const tpl of Object.keys(m.TEMPLATES).filter(t => !['shape', 'stick'].includes(t))) {
      box.style.width = W + 'px'; box.style.height = W * 9 / 16 + 'px';
      // 1/16 screen px: a quarter of the ¼-px subpixel step browsers position glyphs at, so nothing within it
      // can change a rendered pixel. (Measured residuals are 2–3 layout units, ≤ 0.05 px.)
      const T = m.TEMPLATES[tpl], t = T.dur - 1, tol = 1 / 16;
      const mk = reveal => { box.innerHTML = ''; const h = document.createElement('div'); h.style.cssText = 'position:absolute;inset:0'; box.append(h); const st = m.createStage(h); st.show({ id: 'a', tpl, start: 0, dur: T.dur, props: { reveal, type: pr.id, ...extra } }, t); return { h, st }; };
      const ref = mk('cut'), R = glyphs(ref.h); ref.st.destroy();
      for (const fx of fxs) {
        const p = m.LIBRARY.find(x => x.enter.fx === fx && !x.exit && x.group !== 'Signature'), { h, st } = mk(p.id), G = glyphs(h); n++;
        let d = 0, at = ''; const note = R.length !== G.length ? `count ${R.length}≠${G.length}` : '';
        for (let i = 0; i < Math.min(R.length, G.length); i++) { const dd = Math.max(Math.abs(R[i][1] - G[i][1]), Math.abs(R[i][2] - G[i][2])); if (dd > d) { d = dd; at = R[i][0] + '@' + i; } }
        if (d > tol || note) res.push(`${W} ${pr.id}/${lbl}/${tpl}/${fx}: Δ${d.toFixed(4)} ${at} ${note}`);
        worst = Math.max(worst, d); st.destroy();
      }
    }
    const big = res.map(x => [x, parseFloat((/Δ([\d.]+)/.exec(x) || [0, 0])[1])]).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]);
    const counts = res.filter(x => /count \d+≠/.test(x)).slice(0, 8);
    const mag = { '<0.05': 0, '<0.25': 0, '<1': 0, '<5': 0, '>=5': 0, count: 0 }, by = {};
    for (const x of res) {
      const v = parseFloat((/Δ([\d.]+)/.exec(x) || [0, 0])[1]);
      if (/count \d+≠/.test(x)) mag.count++; else mag[v < 0.05 ? '<0.05' : v < 0.25 ? '<0.25' : v < 1 ? '<1' : v < 5 ? '<5' : '>=5']++;
      const [, pr, pl, tpl, fx] = /^\d+ ([^/]+)\/([^/]+)\/([^/]+)\/([^:]+):/.exec(x) || [];
      for (const k of ['pr:' + pr, 'tpl:' + tpl, 'fx:' + fx, 'pl:' + pl]) by[k] = (by[k] || 0) + 1;
    }
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 24);
    return { checked: n, worstPx: +worst.toFixed(4), over: res.length, mag, top, big: Object.entries(res.filter(x => parseFloat((/Δ([\d.]+)/.exec(x) || [0, 0])[1]) >= 0.05).reduce((o, x) => { const key = x.split('/')[2] + ' ' + x.split('/')[1]; o[key] = (o[key] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 20), counts: counts.slice(0, 4) };
  }, process.env.W ? +process.env.W : 0);
  console.log(name, `dpr ${process.env.DPR || 1}`, JSON.stringify(r, null, 1));
  if (r.over) failed = true;
  await browser.close();
}
process.exit(failed ? 1 : 0);
