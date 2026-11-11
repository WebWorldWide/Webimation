// Glyph Lab: an ASCII workstation. A field (one of 14 channels, or your own text/logo) is turned
// into characters with full control over the glyphs, tone, dithering, colour, motion and screen.
import { useEffect, useMemo, useState } from 'react';
import { addToProject, useApp } from '../../App';
import { frameText, histogram, query } from '../../engine';
import { store, stored } from '../../history';
import { clone, IN, obj, OUT, scene, SCREEN, type Channel, type DitherKind, type FieldParams, type GlyphStyle, type Look, type Obj, type Scene, type Screen } from '../../types';
import { Field, Num, Seg, Slider, Toggle } from '../../ui/controls';
import { SceneView, usePlayer } from '../../ui/SceneView';
import { ExportDialog } from '../ExportDialog';
import type { StudioCtx } from '../Studio';

type Tab = 'glyphs' | 'tone' | 'colour' | 'field' | 'screen' | 'output';
interface Doc { style: GlyphStyle; field: FieldParams; screen: Screen; source: string; transparent: boolean }
const KEY = 'webimation.glyph.v1', LOOKS_KEY = 'webimation.glyphLooks.v1';

export function GlyphLab({ c }: { c: StudioCtx }) {
  const { cat, project, go, toast } = useApp();
  const initial = (): Doc => ({ style: clone(cat.looks[0].style), field: clone(cat.looks[0].field), screen: clone(cat.looks[0].screen), source: 'WEBIMATION', transparent: false });
  // Edit the selected project field layer when there is one, otherwise this lab's own document.
  const target = c.s.objects.find(o => o.id === c.sel && o.kind.type === 'field');
  const [local, setLocal] = useState<Doc>(() => stored(KEY, initial));
  const doc: Doc = target && target.kind.type === 'field' ? { style: target.kind.style, field: target.kind.field, screen: c.s.screen, source: target.kind.source, transparent: c.s.bg.kind === 'clear' } : local;
  const set = (f: (d: Doc) => Doc, key = '') => {
    if (target) {
      const n = f(doc);
      c.edit(v => ({ ...v, screen: n.screen, objects: v.objects.map(o => (o.id === target.id && o.kind.type === 'field' ? { ...o, kind: { ...o.kind, style: n.style, field: n.field, source: n.source } } : o)) }), key);
    } else setLocal(d => { const n = f(d); store(KEY)(n); return n; });
  };
  const setStyle = (p: Partial<GlyphStyle>, key = '') => set(d => ({ ...d, style: { ...d.style, ...p } }), key);
  const setField = (p: Partial<FieldParams>, key = '') => set(d => ({ ...d, field: { ...d.field, ...p } }), key);
  const setScreen = (p: Partial<Screen>, key = '') => set(d => ({ ...d, screen: { ...d.screen, ...p } }), key);
  const [tab, setTab] = useState<Tab>('glyphs');
  const [fontGroup, setFontGroup] = useState<'all' | 'code' | 'retro' | 'display'>('all');
  const [saved, setSaved] = useState<Look[]>(() => stored(LOOKS_KEY, () => []));
  const [use, setUse] = useState<'loop' | 'transition' | 'text' | 'layer'>('loop');
  const [exporting, setExporting] = useState(false);
  const [hist, setHist] = useState<number[]>([]);
  const [ramp, setRamp] = useState<{ chars: string; ink: number[] } | null>(null);
  const [grid, setGrid] = useState<{ cols: number; rows: number; cw: number; ch: number } | null>(null);

  const fieldObj = (extra: Partial<Obj> = {}): Obj => obj({ type: 'field', w: 1920, h: 1080, style: doc.style, field: doc.field, source: doc.source }, { name: `${cat.channels.find(x => x.id === doc.field.channel)?.name ?? 'Glyph'} field`, enter: IN('none'), exit: OUT('stay'), ...extra });
  const s: Scene = useMemo(() => scene({ name: 'Glyph field', dur: Math.max(1, doc.field.loop_s / Math.max(0.05, doc.field.speed) * (doc.field.direction === 'ping-pong' ? 2 : 1)), fps: 30, bg: doc.transparent ? { kind: 'clear', color: '', color2: '' } : { kind: 'solid', color: '#07070C', color2: '' }, screen: doc.screen, objects: [fieldObj()] }), [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const player = usePlayer(s.dur, 30, true);
  useEffect(() => { let live = true; const id = setTimeout(() => { histogram({ ...s, screen: SCREEN() }, player.t).then(h => live && setHist(h)); }, 250); return () => { live = false; clearTimeout(id); }; }, [s, Math.floor(player.t)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { query<{ chars: string; ink: number[] }>({ op: 'inkOrder', font: doc.style.font, chars: doc.style.chars }).then(r => { if (!doc.style.sort_by_ink) { const chars = doc.style.reverse ? [...doc.style.chars].reverse().join('') : doc.style.chars; const inkMap = new Map([...r.chars].map((ch, i) => [ch, r.ink[i]])); setRamp({ chars, ink: [...chars].map(ch => inkMap.get(ch) ?? 0) }); } else setRamp(doc.style.reverse ? { chars: [...r.chars].reverse().join(''), ink: [...r.ink].reverse() } : r); }); }, [doc.style.font, doc.style.chars, doc.style.sort_by_ink, doc.style.reverse]);
  useEffect(() => { query<{ cols: number; rows: number; cw: number; ch: number }>({ op: 'grid', style: doc.style, w: 1920, h: 1080 }).then(setGrid); }, [doc.style]);
  const fonts = cat.fonts.filter(f => f.mono && (fontGroup === 'all' || (fontGroup === 'code' && f.group === 'code') || (fontGroup === 'retro' && f.group === 'retro') || (fontGroup === 'display' && f.group === 'display')));
  const ch = cat.channels.findIndex(x => x.id === doc.field.channel);
  const maxInk = Math.max(1e-3, ...(ramp?.ink ?? [1]));
  const applyLook = (l: Look) => set(d => ({ ...d, style: clone(l.style), field: { ...clone(l.field), seed: d.field.seed }, screen: clone(l.screen) }));
  const useIt = (dest: 'lab' | 'studio') => {
    const extra: Partial<Obj> = use === 'transition' ? { enter: IN('dither-in', { dur: 0.6 }), exit: OUT('dither-out', { dur: 0.6 }), dur: 1.6 } : use === 'text' ? {} : use === 'layer' ? { enter: IN('dither-in'), exit: OUT('dither-out'), blend: 'screen' } : {};
    const o = fieldObj(extra);
    if (use === 'text' && o.kind.type === 'field') o.kind.field = { ...o.kind.field, channel: 'text' };
    addToProject(project, scene({ dur: use === 'transition' ? 1.6 : s.dur, screen: doc.screen, bg: s.bg, objects: [o] }), dest === 'studio' ? c.player.t : 0);
    toast(dest === 'lab' ? 'Field added to the Animation Lab' : 'Field added at the playhead');
    go(dest === 'lab' ? { m: 'lab' } : { m: 'studio', tab: 'edit' });
  };

  return (
    <div className="st-glyph">
      <aside className="gl-left">
        <p className="caps">Channels</p>
        <ol className="channels">{cat.channels.map((x, i) => <li key={x.id}><button className={doc.field.channel === x.id ? 'on' : ''} onClick={() => setField({ channel: x.id as Channel })}><span className="mono">{String(i + 1).padStart(2, '0')}</span><span><b>{x.name}</b><i>{x.blurb}</i></span></button></li>)}</ol>
        <p className="caps">Looks</p>
        <ul className="looks-list">
          {[...cat.looks, ...saved].map(l => <li key={l.id}><button onClick={() => applyLook(l)}><span className="lk-sw">{l.style.palette.bands.slice(0, 4).map(b => <i key={b.at} style={{ background: b.color }} />)}</span>{l.name}</button></li>)}
        </ul>
      </aside>
      <main className="gl-center">
        <div className="gl-head"><span className="mono">CH {String(ch + 1).padStart(2, '0')} · {cat.channels[ch]?.name.toUpperCase()}</span>{target && <span className="tag">Editing layer: {target.name}</span>}<span className="grow" /><span className="live">LIVE · {use === 'transition' ? 'TRANSITION' : use === 'text' ? 'TEXT FILL' : use === 'layer' ? 'LAYER EFFECT' : 'BACKGROUND LOOP'}</span></div>
        <SceneView scene={s} t={player.t} checker={doc.transparent ? 'dark' : false} className="gl-view" />
        <div className="gl-transport">
          <button className="pp" onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'}>{player.playing ? '❚❚' : '▶'}</button>
          <div className="loopbar" onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); player.seek((e.clientX - r.left) / r.width * s.dur); }}><span>Loops seamlessly every {s.dur.toFixed(1)} s</span><i style={{ left: `${player.t / s.dur * 100}%` }} /></div>
          <span className="mono">{player.t.toFixed(1)} / {s.dur.toFixed(1)} s</span>
          <button className="btn-d" onClick={async () => { const t = await frameText(s, player.t, 120, ramp?.chars || ' .:-=+*#%@'); await navigator.clipboard.writeText(t); toast('Frame copied as text'); }}>Copy frame as text</button>
        </div>
        <div className="gl-info">
          <div className="ramp-box">
            <header><span className="caps">Character ramp · dark to bright</span><span className="mono">{ramp?.chars.length ?? 0} levels</span></header>
            <div className="ramp">{ramp && [...ramp.chars].map((chr, i) => <span key={i}><b style={{ fontFamily: `'w-${doc.style.font}'` }}>{chr === ' ' ? '·' : chr}</b><i style={{ height: `${4 + ramp.ink[i] / maxInk * 24}px` }} /></span>)}</div>
          </div>
          <div className="grid-box">
            <span className="caps">Grid</span>
            {grid && <><b className="mono big">{grid.cols} × {grid.rows}</b><span className="mono">cell {grid.cw.toFixed(1)} × {grid.ch.toFixed(1)} px · {(grid.cols * grid.rows).toLocaleString()} cells</span><span className="mono">{cat.fonts.find(f => f.id === doc.style.font)?.name}</span></>}
          </div>
        </div>
      </main>
      <aside className="gl-right">
        <nav className="gl-tabs">{(['glyphs', 'tone', 'colour', 'field', 'screen', 'output'] as Tab[]).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</nav>
        <div className="gl-body">
          {tab === 'glyphs' && <>
            <header className="gl-sec"><span className="caps">Font · {cat.fonts.filter(f => f.mono).length} fonts</span><Seg size="sm" value={fontGroup} onChange={setFontGroup} options={[['all', 'All'], ['code', 'Code'], ['retro', 'Retro'], ['display', 'Display']]} /></header>
            <div className="font-grid">{fonts.map(f => <button key={f.id} className={doc.style.font === f.id ? 'on' : ''} onClick={() => setStyle({ font: f.id })}><b style={{ fontFamily: `'w-${f.id}'` }}>@#%&01</b><span>{f.name}</span></button>)}</div>
            <p className="caps">Cell</p>
            <Slider label="Cell size" value={doc.style.cell} min={4} max={48} step={1} onChange={cell => setStyle({ cell }, 'cell')} fmt={v => `${v}px`} reset={12} />
            <Slider label="Cell width" value={doc.style.cell_w} min={0.5} max={2} onChange={cell_w => setStyle({ cell_w }, 'cw')} fmt={v => `${v.toFixed(2)}×`} reset={1} />
            <Slider label="Cell height" value={doc.style.cell_h} min={0.5} max={2} onChange={cell_h => setStyle({ cell_h }, 'ch')} fmt={v => `${v.toFixed(2)}×`} reset={1} />
            <p className="caps">Character set</p>
            <div className="charsets">{cat.charsets.map(cs => <button key={cs.id} className={doc.style.chars === cs.chars ? 'on' : ''} onClick={() => setStyle({ chars: cs.chars })}><b style={{ fontFamily: `'w-${doc.style.font}'` }}>{cs.chars.trim().slice(0, 6)}</b><span>{cs.name}</span></button>)}</div>
            <p className="sub">Type your own set. The first character should be a space, so it stays see-through.</p>
            <input className="st-input mono" value={doc.style.chars} onChange={e => setStyle({ chars: e.target.value }, 'chars')} aria-label="Custom characters" />
            <div className="row2b"><Toggle on={doc.style.sort_by_ink} onChange={sort_by_ink => setStyle({ sort_by_ink })} label="Sort by measured ink" /><Toggle on={doc.style.reverse} onChange={reverse => setStyle({ reverse })} label="Reverse order" /></div>
            <p className="caps">How cells pick a character</p>
            <Seg value={doc.style.pick} onChange={pick => setStyle({ pick })} options={[['brightness', 'Brightness'], ['random', 'Random'], ['message', 'Message']]} />
            <p className="sub">{doc.style.pick === 'brightness' ? 'Brighter cells get denser characters from the set. The classic ASCII-art look.' : doc.style.pick === 'random' ? 'Lit cells pick any character at random; flicker makes them change.' : 'Lit cells spell out your message, over and over.'}</p>
            {doc.style.pick === 'message' && <Field label="Message" value={doc.style.message} onChange={message => setStyle({ message }, 'msg')} />}
            <Slider label="Flicker" value={doc.style.flicker} min={0} max={1} onChange={flicker => setStyle({ flicker }, 'fl')} fmt={v => `${Math.round(v * 100)}%`} reset={0} />
          </>}
          {tab === 'tone' && <>
            <p className="caps">Levels</p>
            <div className="hist" aria-label="Histogram">{hist.map((h, i) => <i key={i} style={{ height: `${h * 100}%`, opacity: i / 31 < doc.style.tone.black || i / 31 > doc.style.tone.white ? 0.3 : 1 }} />)}</div>
            <Slider label="Black point" value={doc.style.tone.black} min={0} max={0.95} onChange={black => setStyle({ tone: { ...doc.style.tone, black } }, 'tb')} reset={0} />
            <Slider label="White point" value={doc.style.tone.white} min={0.05} max={1} onChange={white => setStyle({ tone: { ...doc.style.tone, white } }, 'tw')} reset={1} />
            <Slider label="Gamma" value={doc.style.tone.gamma} min={0.2} max={3} onChange={gamma => setStyle({ tone: { ...doc.style.tone, gamma } }, 'tg')} reset={1} />
            <Slider label="Contrast" value={doc.style.tone.contrast} min={-1} max={1} onChange={contrast => setStyle({ tone: { ...doc.style.tone, contrast } }, 'tc')} reset={0} />
            <Slider label="Brightness" value={doc.style.tone.brightness} min={-1} max={1} onChange={brightness => setStyle({ tone: { ...doc.style.tone, brightness } }, 'tbr')} reset={0} />
            <Slider label="See-through below" value={doc.style.tone.cutoff} min={0} max={0.9} onChange={cutoff => setStyle({ tone: { ...doc.style.tone, cutoff } }, 'tcut')} reset={0} />
            <Toggle on={doc.style.tone.invert} onChange={invert => setStyle({ tone: { ...doc.style.tone, invert } })} label="Invert" />
            <p className="caps">Dither</p>
            <div className="dither-grid">{cat.dithers.map(d => <button key={d.id} className={doc.style.dither === d.id ? 'on' : ''} onClick={() => setStyle({ dither: d.id as DitherKind })}>{d.name}</button>)}</div>
            <Slider label="Strength" value={doc.style.dither_strength} min={0} max={2} onChange={dither_strength => setStyle({ dither_strength }, 'ds')} reset={1} />
            <Toggle on={doc.style.dither_animate} onChange={dither_animate => setStyle({ dither_animate })} label="Moving pattern" />
          </>}
          {tab === 'colour' && <>
            <p className="caps">Palette</p>
            <div className="pal-grid">{cat.palettes.map(p => <button key={p.id} className={doc.style.palette.id === p.id ? 'on' : ''} onClick={() => setStyle({ palette: clone(p) })}><span>{p.bands.map(b => <i key={b.at} style={{ background: b.color }} />)}</span>{p.name}</button>)}</div>
            <p className="caps">Colour bands</p>
            <p className="sub">Each band starts at a brightness and holds until the next.</p>
            {doc.style.palette.bands.map((b, i) => (
              <div key={i} className="band">
                <input type="color" value={b.color.slice(0, 7)} onChange={e => setStyle({ palette: { ...doc.style.palette, id: 'custom', bands: doc.style.palette.bands.map((x, j) => (j === i ? { ...x, color: e.target.value.toUpperCase() } : x)) } }, `bc${i}`)} aria-label={`Band ${i + 1} colour`} />
                <input type="range" min={0} max={1} step={0.01} value={b.at} onChange={e => setStyle({ palette: { ...doc.style.palette, id: 'custom', bands: doc.style.palette.bands.map((x, j) => (j === i ? { ...x, at: +e.target.value } : x)) } }, `ba${i}`)} aria-label={`Band ${i + 1} starts at`} />
                <span className="mono">{Math.round(b.at * 100)}%</span>
                <button className="x" disabled={doc.style.palette.bands.length <= 2} onClick={() => setStyle({ palette: { ...doc.style.palette, id: 'custom', bands: doc.style.palette.bands.filter((_, j) => j !== i) } })} aria-label="Remove band">×</button>
              </div>
            ))}
            <button className="btn-d" disabled={doc.style.palette.bands.length >= 6} onClick={() => setStyle({ palette: { ...doc.style.palette, id: 'custom', bands: [...doc.style.palette.bands, { color: '#FFFFFF', at: 0.98 }] } })}>+ Add band</button>
            <div className="row2b"><Toggle on={doc.style.palette.smooth} onChange={smooth => setStyle({ palette: { ...doc.style.palette, smooth } })} label="Blend bands" /><Toggle on={doc.style.fill_cells} onChange={fill_cells => setStyle({ fill_cells })} label="Fill cell backgrounds" /></div>
            <p className="caps">One ink for every character</p>
            <div className="row2b"><input type="color" value={doc.style.ink || '#FFFFFF'} onChange={e => setStyle({ ink: e.target.value.toUpperCase() }, 'ink')} aria-label="Ink colour" /><button className="btn-d" onClick={() => setStyle({ ink: '' })} disabled={!doc.style.ink}>Use the palette</button></div>
          </>}
          {tab === 'field' && <>
            <p className="caps">Transform</p>
            <Slider label="Zoom" value={doc.field.zoom} min={0.2} max={4} onChange={zoom => setField({ zoom }, 'z')} reset={1} />
            <Slider label="Rotate" value={doc.field.rotate} min={-180} max={180} step={1} onChange={rotate => setField({ rotate }, 'r')} fmt={v => `${v}°`} reset={0} />
            <Slider label="Pan X" value={doc.field.pan_x} min={-1} max={1} onChange={pan_x => setField({ pan_x }, 'px')} reset={0} />
            <Slider label="Pan Y" value={doc.field.pan_y} min={-1} max={1} onChange={pan_y => setField({ pan_y }, 'py')} reset={0} />
            <Slider label="Warp" value={doc.field.warp} min={0} max={2} onChange={warp => setField({ warp }, 'w')} reset={0} />
            <Slider label="Detail" value={doc.field.detail} min={1} max={6} step={1} onChange={detail => setField({ detail }, 'd')} reset={4} />
            <p className="caps">Playback</p>
            <Slider label="Speed" value={doc.field.speed} min={0.1} max={4} onChange={speed => setField({ speed }, 's')} fmt={v => `${v.toFixed(2)}×`} reset={1} />
            <Seg value={doc.field.direction} onChange={direction => setField({ direction })} options={[['forward', 'Forward'], ['reverse', 'Reverse'], ['ping-pong', 'Ping-pong']]} />
            <div className="row2"><Num label="Loop" value={doc.field.loop_s} step={0.5} min={0.5} max={60} suffix="s" onChange={loop_s => setField({ loop_s }, 'l')} /><Num label="Seed" value={doc.field.seed} step={1} min={0} onChange={seed => setField({ seed }, 'seed')} /></div>
            <button className="btn-d" onClick={() => setField({ seed: Math.floor(Math.random() * 99999) })}>🎲 New seed</button>
            {(doc.field.channel === 'text' || doc.field.channel === 'logo') && <>
              <p className="caps">{doc.field.channel === 'text' ? 'Your words' : 'Your shape'}</p>
              {doc.field.channel === 'text' ? <Field label="Text" value={doc.source} onChange={source => set(d => ({ ...d, source }), 'src')} /> : <div className="charsets">{cat.starters.map(st => <button key={st.id} className={doc.source === st.id ? 'on' : ''} onClick={() => set(d => ({ ...d, source: st.id }))}>{st.name}</button>)}</div>}
            </>}
          </>}
          {tab === 'screen' && <>
            <p className="caps">CRT</p>
            <Slider label="Scanlines" value={doc.screen.scanlines} min={0} max={1} onChange={scanlines => setScreen({ scanlines }, 'sl')} reset={0} />
            <Slider label="Line spacing" value={doc.screen.scan_spacing} min={2} max={8} step={1} onChange={scan_spacing => setScreen({ scan_spacing }, 'ss')} fmt={v => `${v}px`} reset={3} />
            <Slider label="Grain" value={doc.screen.grain} min={0} max={1} onChange={grain => setScreen({ grain }, 'g')} reset={0} />
            <Slider label="Glow" value={doc.screen.glow} min={0} max={1.5} onChange={glow => setScreen({ glow }, 'gl')} reset={0} />
            <Slider label="RGB split" value={doc.screen.rgb_split} min={0} max={12} step={0.5} onChange={rgb_split => setScreen({ rgb_split }, 'rgb')} fmt={v => `${v}px`} reset={0} />
            <Slider label="Phosphor trails" value={doc.screen.phosphor} min={0} max={0.95} onChange={phosphor => setScreen({ phosphor }, 'ph')} reset={0} />
            <Slider label="Vignette" value={doc.screen.vignette} min={0} max={1} onChange={vignette => setScreen({ vignette }, 'v')} reset={0} />
          </>}
          {tab === 'output' && <>
            <p className="caps">Use it as</p>
            <div className="use-grid">{([['loop', 'Background loop', 'Fills the frame and loops'], ['transition', 'Transition', 'Dithers in, then out: hides a cut'], ['text', 'Text fill', 'Your words made of the field'], ['layer', 'Layer effect', 'Screened over whatever is below']] as const).map(([k, l, b]) => <button key={k} className={use === k ? 'on' : ''} onClick={() => setUse(k)}><b>{l}</b><span>{b}</span></button>)}</div>
            <Toggle on={doc.transparent} onChange={transparent => set(d => ({ ...d, transparent }))} label="See-through background (export with alpha)" />
            <p className="caps">Save this look</p>
            <SaveLook onSave={name => { const l: Look = { id: `my-${Date.now().toString(36)}`, name, style: clone(doc.style), field: clone(doc.field), screen: clone(doc.screen) }; const n = [...saved, l]; setSaved(n); store(LOOKS_KEY)(n); toast(`Saved “${name}”`); }} />
            {saved.length > 0 && <ul className="saved">{saved.map(l => <li key={l.id}>{l.name}<button className="x" onClick={() => { const n = saved.filter(x => x.id !== l.id); setSaved(n); store(LOOKS_KEY)(n); }} aria-label={`Delete ${l.name}`}>×</button></li>)}</ul>}
            <button className="btn-d" onClick={() => setExporting(true)}>Bounce this field</button>
          </>}
        </div>
        <footer className="gl-foot">
          <button className="btn-d" onClick={() => { if (target) toast('Reset applies to the lab document; pick no layer first'); else { const d = initial(); setLocal(d); store(KEY)(d); } }}>Reset everything</button>
          <button className="st-bounce" onClick={() => useIt('lab')}>Use in Animation Lab</button>
          <button className="btn-d" onClick={() => useIt('studio')}>Add at playhead</button>
        </footer>
      </aside>
      {exporting && <ExportDialog scene={s} name={`${cat.channels[ch]?.name ?? 'Glyph'} field`} onClose={() => setExporting(false)} />}
    </div>
  );
}

function SaveLook({ onSave }: { onSave: (n: string) => void }) {
  const [n, setN] = useState('');
  return <form className="row2b" onSubmit={e => { e.preventDefault(); if (n.trim()) { onSave(n.trim()); setN(''); } }}><input className="st-input" value={n} onChange={e => setN(e.target.value)} placeholder="Name your look" aria-label="Look name" /><button className="btn-d" disabled={!n.trim()}>Save look</button></form>;
}
