// The Animation Lab, built like PowerPoint's Animations tab: click anything on the slide, pick how it
// comes in, what it does while on screen and how it goes out. Everything sits on a pixel grid.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Logo, useApp } from '../App';
import { bounds, loadScene } from '../engine';
import { animateEverything, resolveCues, restyle, sceneEnd, type Style } from '../layout';
import { ExportDialog } from './ExportDialog';
import { Field, Num, Seg, Select, Swatches, Toggle } from '../ui/controls';
import { fmtTime } from '../ui/controls';
import { SceneView, Thumb, usePlayer } from '../ui/SceneView';
import { clone, FIELD, IN, obj, ON, OUT, scene, SHAPE_STYLE, TEXT_STYLE, textOf, withText, type FxDef, type Obj, type ObjKind, type Scene } from '../types';

type Ribbon = 'start' | 'home' | 'insert' | 'animations' | 'canvas';
type Slot = 'in' | 'on' | 'out';
const WWW = ['#FFFFFF', '#0E2960', '#1E68F0', '#1450C8', '#A8C8F0', '#EC5A2B', '#28B083', '#3EC25D', '#F5C542', '#EEF3FB', '#0B0B0C', '#F58AD0', '#B04CC4', '#38B6FF'];
const LAB_FONTS = ['archivo', 'archivo-black', 'anton', 'bebas', 'instrument-serif', 'dm-serif', 'permanent-marker', 'caveat', 'press-start', 'vt323', 'silkscreen', 'pixelify', 'jetbrains-mono', 'space-mono', 'sixtyfour', 'doto'];
const FAMILY_LABEL: Record<string, string> = { clean: 'Clean', pixel: 'Pixel', glyph: 'Glyph · ASCII', fun: 'Fun', shape: 'Shape', text: 'Text' };
const SPEEDS = [['fast', 'Fast', 0.3], ['normal', 'Normal', 0.55], ['slow', 'Slow', 1]] as const;

const fxScenes = new Map<string, Scene>();
/** Tiny looping scene for a gallery tile: a "W" block doing the effect. */
function fxScene(slot: Slot, id: string): Scene {
  const key = `${slot}:${id}`;
  let s = fxScenes.get(key);
  if (!s) {
    const o = obj({ type: 'pixel-text', text: 'W', font: 'five', px: 22, color: '#FFFFFF', shadow: '#0E2960' }, {
      x: 104, y: 76, enter: slot === 'in' ? IN(id, { dur: 0.8 }) : IN('appear'), on: slot === 'on' ? ON(id) : ON(), exit: slot === 'out' ? OUT(id, { dur: 0.8 }) : OUT('stay')
    });
    const bgTile = obj({ type: 'shape', style: SHAPE_STYLE({ fill: '#1E68F0' }), w: 200, h: 200 }, { x: 60, y: 60, enter: IN('none'), exit: OUT('stay') });
    s = scene({ w: 320, h: 320, dur: slot === 'on' ? 3 : 1.8, fps: 12, objects: [bgTile, { ...o, order: 1 }], grid: 64 });
    fxScenes.set(key, s);
  }
  return s;
}

export function AnimationLab() {
  const { project, go, cat, toast } = useApp();
  const s = project.value;
  const edit = useCallback((f: (s: Scene) => Scene, key = '') => project.set(v => resolveCues(f(v)), key), [project]);
  const [ribbon, setRibbon] = useState<Ribbon>(s.objects.length ? 'animations' : 'start');
  const [slot, setSlot] = useState<Slot>('in');
  const [filter, setFilter] = useState<string>('all');
  const [sel, setSel] = useState<string | null>(s.objects[0]?.id ?? null);
  const [style, setStyle] = useState<Style>('pixel');
  const [gridLines, setGridLines] = useState(true);
  const [snapOn, setSnapOn] = useState(true);
  const [safeZones, setSafeZones] = useState(false);
  const [clean, setClean] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [box, setBox] = useState<Record<string, [number, number, number, number]>>({});
  const end = useMemo(() => Math.max(s.dur, 1), [s.dur]);
  const player = usePlayer(end, s.fps, false);
  const selObj = s.objects.find(o => o.id === sel) ?? null;
  const ordered = useMemo(() => [...s.objects].sort((a, b) => a.order - b.order), [s.objects]);
  const cell = s.w / s.grid;

  useEffect(() => { let live = true; const id = setTimeout(() => bounds(s).then(b => live && setBox(b)), 60); return () => { live = false; clearTimeout(id); }; }, [s]);
  useEffect(() => { if (sel && !s.objects.some(o => o.id === sel)) setSel(ordered[0]?.id ?? null); }, [s.objects, sel, ordered]);

  const setObj = (id: string, f: (o: Obj) => Obj, key = '') => edit(v => ({ ...v, objects: v.objects.map(o => (o.id === id ? f(o) : o)) }), key);
  const add = (kind: ObjKind, o: Partial<Obj> = {}) => {
    const n = obj(kind, { name: o.name ?? kindName(kind), x: Math.round(s.w * 0.3 / cell) * cell, y: Math.round(s.h * 0.35 / cell) * cell, order: Math.max(-1, ...s.objects.map(x => x.order)) + 1, cue: 'after', enter: IN(style === 'pixel' ? 'blocky-wipe' : style === 'glyph' ? 'decode' : 'wipe'), exit: OUT(style === 'glyph' ? 'dither-out' : 'wipe'), ...o });
    edit(v => ({ ...v, objects: [...v.objects, n] }));
    setSel(n.id); setRibbon('animations');
  };
  const del = () => { if (!sel) return; edit(v => ({ ...v, objects: v.objects.filter(o => o.id !== sel) })); };
  const dup = () => { if (!selObj) return; const n = { ...clone(selObj), id: `${selObj.id}c${Date.now().toString(36)}`, x: selObj.x + cell * 4, y: selObj.y + cell * 4, order: Math.max(...s.objects.map(x => x.order)) + 1, cue: 'with' }; edit(v => ({ ...v, objects: [...v.objects, n] })); setSel(n.id); };
  const move = (id: string, dir: -1 | 1) => edit(v => {
    const list = [...v.objects].sort((a, b) => a.order - b.order), i = list.findIndex(o => o.id === id), j = i + dir;
    if (j < 0 || j >= list.length) return v;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...v, objects: v.objects.map(o => ({ ...o, order: list.findIndex(x => x.id === o.id) })) };
  });

  // ── stage interaction: click to pick, drag to move on the grid, arrows nudge one grid pixel ──
  const drag = useRef<{ id: string; x0: number; y0: number; ox: number; oy: number } | null>(null);
  const hit = (p: { x: number; y: number }) => [...ordered].reverse().find(o => { const b = box[o.id]; return b && !o.hidden && !o.locked && p.x >= b[0] - 6 && p.x <= b[2] + 6 && p.y >= b[1] - 6 && p.y <= b[3] + 6 && !(o.kind.type === 'field' && o.kind.w >= s.w * 0.9 && ordered.length > 1 && o !== ordered[ordered.length - 1] && false); });
  const snapV = (v: number) => (snapOn ? Math.round(v / cell) * cell : Math.round(v));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === ' ') { e.preventDefault(); player.toggle(); return; }
      if (!selObj) return;
      const step = (snapOn ? cell : 1) * (e.shiftKey ? 8 : 1);
      const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
      if (d) { e.preventDefault(); setObj(selObj.id, o => ({ ...o, x: o.x + d[0], y: o.y + d[1] }), 'nudge'); }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); del(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); dup(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const effects = cat.effects.filter(e => e.slot === slot && (filter === 'all' || e.family === filter || (filter === 'pixel' && e.cell && e.family === 'glyph')));
  const current = selObj ? (slot === 'in' ? selObj.enter.id : slot === 'on' ? selObj.on.id : selObj.exit.id) : '';
  const apply = (fx: FxDef) => selObj && setObj(selObj.id, o => slot === 'in' ? { ...o, enter: { ...o.enter, id: fx.id } } : slot === 'on' ? { ...o, on: { ...o.on, id: fx.id } } : { ...o, exit: { ...o.exit, id: fx.id } });
  const fxName = (sl: Slot, id: string) => cat.effects.find(e => e.slot === sl && e.id === id)?.name ?? id;
  const short = s.h > s.w;

  return (
    <div className="lab light">
      <header className="lab-bar">
        <div className="brand"><Logo /> Animation Lab</div>
        <input className="title-in" value={s.name} onChange={e => edit(v => ({ ...v, name: e.target.value }), 'name')} aria-label="Animation name" />
        <button className="ghost" onClick={project.undo} disabled={!project.canUndo}>↶ Undo</button>
        <button className="ghost" onClick={project.redo} disabled={!project.canRedo}>↷ Redo</button>
        <span className="grow" />
        <button className="ghost" onClick={() => go({ m: 'pick' })}>Quick mode</button>
        <button className="ghost" onClick={() => go({ m: 'paint' })}>Pixel Paint</button>
        <button className="ghost" onClick={() => go({ m: 'studio', tab: 'glyph' })}>Glyph Lab</button>
        <button className="ghost" onClick={() => go({ m: 'studio', tab: 'edit' })}>Studio</button>
        <button className="btn-white" onClick={() => setExporting(true)} disabled={!s.objects.length}>Export video</button>
      </header>
      <nav className="ribbon-tabs" role="tablist">
        {(['start', 'home', 'insert', 'animations', 'canvas'] as Ribbon[]).map(r => <button key={r} role="tab" aria-selected={ribbon === r} className={ribbon === r ? 'on' : ''} onClick={() => setRibbon(r)}>{r[0].toUpperCase() + r.slice(1)}</button>)}
      </nav>
      <div className="ribbon">
        {ribbon === 'start' && <>
          <div className="group">
            <div className="scene-tiles">
              {cat.scenes.map(sc => <button key={sc.id} className="scene-tile" title={sc.blurb} onClick={async () => { const n = await loadScene(sc.id); project.set(() => n); setSel(n.objects[0]?.id ?? null); player.seek(0); player.play(); toast(`${sc.name}: everything is already animated`); }}><span className={`st-ico st-${sc.id}`}>{sc.name.slice(0, 3).toUpperCase()}</span>{sc.name}</button>)}
              <button className="scene-tile" onClick={() => { project.set(() => scene({ name: 'Untitled', fps: 12, dur: 6, bg: { kind: 'sky', color: '#1E68F0', color2: '#1450C8' } })); setSel(null); }}><span className="st-ico">+</span>Blank</button>
            </div>
            <span className="glabel">Start from a scene: everything is already animated</span>
          </div>
          <div className="group">
            <Seg value={style} onChange={setStyle} options={[['pixel', 'Pixel'], ['glyph', 'Glyph'], ['clean', 'Clean']]} />
            <button className="btn-go" disabled={!s.objects.length} onClick={() => { edit(v => animateEverything(v, style)); player.seek(0); player.play(); }}>✦ Animate everything</button>
            <button className="btn" disabled={!s.objects.length} onClick={() => edit(v => restyle(v, style))}>Restyle everything</button>
            <span className="glabel">One click</span>
          </div>
        </>}
        {ribbon === 'home' && <>
          <div className="group wide">
            {selObj && textOf(selObj) !== null ? <Field label="Text" value={textOf(selObj)!} multiline={selObj.kind.type === 'ascii'} onChange={v => setObj(selObj.id, o => withText(o, v), 'txt')} /> : <p className="sub">Pick some text on the slide to change its words.</p>}
            <span className="glabel">Words</span>
          </div>
          <div className="group">
            {selObj?.kind.type === 'text' && <Select label="Font" value={selObj.kind.style.font} onChange={font => setObj(selObj.id, o => o.kind.type === 'text' ? { ...o, kind: { ...o.kind, style: { ...o.kind.style, font } } } : o)} options={LAB_FONTS.map(id => [id, cat.fonts.find(f => f.id === id)?.name ?? id] as const)} />}
            {selObj && <Num label="Size" value={Math.round(selObj.scale * 100)} min={10} max={800} step={10} suffix="%" onChange={v => setObj(selObj.id, o => ({ ...o, scale: v / 100 }), 'scale')} />}
            {selObj && (selObj.kind.type === 'sprite' || selObj.kind.type === 'pixel-text') && <Toggle on={selObj.as_ascii} onChange={v => setObj(selObj.id, o => ({ ...o, as_ascii: v }))} label="Show as characters" />}
            <span className="glabel">Look</span>
          </div>
          <div className="group">
            <Seg size="sm" value={s.bg.kind} onChange={kind => edit(v => ({ ...v, bg: { ...v.bg, kind } }))} options={[['clear', 'See-through'], ['sky', 'Sky'], ['solid', 'Colour'], ['paper', 'Paper']]} />
            {s.bg.kind === 'solid' && <Swatches colors={WWW} value={s.bg.color} onChange={color => edit(v => ({ ...v, bg: { ...v.bg, color } }))} />}
            <span className="glabel">Background</span>
          </div>
          <div className="group">
            <button className="btn" onClick={dup} disabled={!selObj}>Duplicate</button>
            <button className="btn" onClick={del} disabled={!selObj}>Delete</button>
            <span className="glabel">Arrange</span>
          </div>
        </>}
        {ribbon === 'insert' && <>
          <div className="group">
            <button className="ins" onClick={() => add({ type: 'pixel-text', text: 'HELLO', font: 'five', px: 12, color: '#FFFFFF', shadow: '#0E2960' })}><b>Aa</b>Pixel text</button>
            <button className="ins" onClick={() => add({ type: 'text', text: 'Your words', style: TEXT_STYLE({ font: 'archivo-black', size: 96 }) })}><b>T</b>Text</button>
            <span className="glabel">Text</span>
          </div>
          <div className="group">
            {cat.starters.map(st => <button key={st.id} className="ins" onClick={() => add({ type: 'sprite', sprite: clone(st.sprite), px: Math.max(6, Math.round(160 / Math.max(st.sprite.w, st.sprite.h))), tint: '' }, { name: st.name })}><SpriteIcon sprite={st.sprite} />{st.name}</button>)}
            <button className="ins" onClick={() => go({ m: 'paint' })}><b>✎</b>Draw one</button>
            <span className="glabel">Pixel art</span>
          </div>
          <div className="group">
            {(['rect', 'ellipse', 'star', 'heart', 'arrow', 'bubble', 'cloud', 'check'] as const).map(k => <button key={k} className="ins" onClick={() => add({ type: 'shape', style: SHAPE_STYLE({ kind: k, fill: k === 'arrow' || k === 'check' ? '#FFFFFF' : '#F5C542', pixel: style === 'pixel' ? cell : 0, shadow: style === 'pixel' ? '#0E2960' : '' }), w: k === 'arrow' ? 320 : 220, h: k === 'arrow' ? 90 : 180 }, { name: cat.shapes.find(x => x.id === k)?.name })}><b>{({ rect: '■', ellipse: '●', star: '★', heart: '♥', arrow: '→', bubble: '💬', cloud: '☁', check: '✓' } as Record<string, string>)[k]}</b>{cat.shapes.find(x => x.id === k)?.name}</button>)}
            <span className="glabel">Shapes</span>
          </div>
          <div className="group">
            <button className="ins" onClick={() => setPasting(true)}><b>{'>_'}</b>Paste ASCII art</button>
            <button className="ins" onClick={() => add({ type: 'ascii-banner', text: 'SIGNAL', cell: 22, font: 'jetbrains-mono', on: '#', color: '#22D37F' }, { enter: IN('decode', { dur: 1 }) })}><b>##</b>ASCII banner</button>
            {(['horizon', 'plasma', 'rain', 'tunnel', 'static'] as const).map(ch => <button key={ch} className="ins" onClick={() => add({ type: 'field', w: s.w, h: s.h, style: { ...clone(cat.looks[0].style), cell: 14 }, field: FIELD({ channel: ch }), source: 'WEBIMATION' }, { name: `ASCII ${ch}`, x: 0, y: 0, order: -1, cue: 'start', enter: IN('dither-in'), exit: OUT('dither-out') })}><b>░</b>{ch[0].toUpperCase() + ch.slice(1)} field</button>)}
            <span className="glabel">ASCII</span>
          </div>
        </>}
        {ribbon === 'animations' && <>
          <div className="group">
            <button className="btn-go" onClick={() => { if (selObj) player.seek(selObj.start); player.play(); }}>▶ Preview</button>
            <span className="glabel">Preview</span>
          </div>
          <div className="group">
            <div className="arrows">{(['left', 'up', 'down', 'right'] as const).map(d => <button key={d} className={selObj?.[slot === 'out' ? 'exit' : 'enter'].dir === d ? 'on' : ''} disabled={!selObj} onClick={() => selObj && setObj(selObj.id, o => slot === 'out' ? { ...o, exit: { ...o.exit, dir: d } } : { ...o, enter: { ...o.enter, dir: d } })} aria-label={`Direction ${d}`}>{({ left: '←', up: '↑', down: '↓', right: '→' })[d]}</button>)}</div>
            <Seg size="sm" value={selObj?.enter.size ?? 'medium'} onChange={size => selObj && setObj(selObj.id, o => ({ ...o, enter: { ...o.enter, size }, exit: { ...o.exit, size } }))} options={[['small', 'Small'], ['medium', 'Medium'], ['big', 'Big']]} />
            <span className="glabel">Effect options</span>
          </div>
          <div className="group">
            <Select label="Start" value={selObj?.cue ?? 'start'} onChange={cue => selObj && setObj(selObj.id, o => ({ ...o, cue }))} options={[['start', 'At the beginning'], ['with', 'With previous'], ['after', 'After previous'], ['manual', 'At a set time']]} />
            {selObj?.cue === 'manual' ? <Num label="At" value={selObj.start} step={0.1} min={0} suffix="s" onChange={v => setObj(selObj.id, o => ({ ...o, start: v }), 'start')} /> : <Num label="Delay" value={selObj?.gap ?? 0} step={0.1} min={0} suffix="s" onChange={v => selObj && setObj(selObj.id, o => ({ ...o, gap: v }), 'gap')} />}
            <span className="glabel">Timing</span>
          </div>
          <div className="group">
            <Seg size="sm" value={selObj ? (SPEEDS.find(x => Math.abs(x[2] - (slot === 'out' ? selObj.exit.dur : selObj.enter.dur)) < 0.08)?.[0] ?? '') : ''} onChange={v => { const d = SPEEDS.find(x => x[0] === v)![2]; if (selObj) setObj(selObj.id, o => slot === 'out' ? { ...o, exit: { ...o.exit, dur: d } } : slot === 'on' ? { ...o, on: { ...o.on, speed: v === 'fast' ? 1.8 : v === 'slow' ? 0.5 : 1 } } : { ...o, enter: { ...o.enter, dur: d } }); }} options={SPEEDS.map(x => [x[0], x[1]] as const)} />
            <Num label="On screen for" value={selObj?.dur ?? 0} step={0.5} min={0} suffix={selObj?.dur ? 's' : 's (to the end)'} onChange={v => selObj && setObj(selObj.id, o => ({ ...o, dur: v }), 'dur')} />
            <span className="glabel">Speed and length</span>
          </div>
        </>}
        {ribbon === 'canvas' && <>
          <div className="group">
            <Seg value={s.grid} onChange={grid => edit(v => ({ ...v, grid }))} options={[[64, 'Chunky 64'], [128, 'Classic 128'], [256, 'Fine 256']]} />
            <Toggle on={gridLines} onChange={setGridLines} label="Grid lines" />
            <Toggle on={snapOn} onChange={setSnapOn} label="Snap to grid" />
            <span className="glabel">Pixel grid</span>
          </div>
          <div className="group">
            <Seg value={s.fps} onChange={fps => edit(v => ({ ...v, fps }))} options={[[30, 'Smooth 30'], [12, 'Pixel 12'], [6, 'Chunky 6']]} />
            <span className="glabel">Motion feel</span>
          </div>
          <div className="group">
            <Seg value={short ? '916' : s.w === s.h ? '11' : '169'} onChange={f => edit(v => reshape(v, f))} options={[['169', '16:9'], ['916', '9:16 Shorts'], ['11', 'Square']]} />
            <Toggle on={safeZones} onChange={setSafeZones} label="Safe zones" />
            <span className="glabel">Format</span>
          </div>
          <div className="group">
            <Num label="Whole animation" value={s.dur} step={0.5} min={1} max={120} suffix="s" onChange={dur => edit(v => ({ ...v, dur }), 'sdur')} />
            <button className="btn" onClick={() => edit(v => ({ ...v, dur: +sceneEnd(v).toFixed(1) }))}>Fit to content</button>
            <span className="glabel">Length</span>
          </div>
        </>}
      </div>

      <div className="lab-body">
        <aside className="lab-left">
          {selObj ? <>
            <p className="sub">Animating</p>
            <h2>{selObj.name}</h2>
            <p className="sub">{kindName(selObj.kind)}{selObj.kind.type === 'pixel-text' ? ' · 5×7 letters on the grid' : ''}</p>
            <div className="slot-tabs" role="tablist">
              {([['in', 'Comes in'], ['on', 'While on'], ['out', 'Goes out']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={slot === k} className={`slot-${k}${slot === k ? ' on' : ''}`} onClick={() => setSlot(k)}><i />{l}</button>)}
            </div>
            <p className="sub">{slot === 'in' ? 'How it shows up. Short and quick usually looks best.' : slot === 'on' ? 'What it does while it waits. Keep it gentle.' : 'How it leaves.'}</p>
            <Seg size="sm" wrap value={filter} onChange={setFilter} options={[['all', 'All'], ['pixel', 'Pixel'], ['glyph', 'Glyph'], ['clean', 'Clean'], ['fun', 'Fun']]} />
            <div className="fx-grid">
              {effects.map(e => (
                <button key={`${e.slot}-${e.id}`} className={`fx${current === e.id ? ' on' : ''}`} onClick={() => apply(e)} title={e.blurb}>
                  <Thumb scene={fxScene(slot, e.id)} checker={false} className="fx-thumb" />
                  <b>{e.name}</b><span className={`fam fam-${e.family}`}>{FAMILY_LABEL[e.family]}{e.cell ? ' & ASCII' : ''}</span>
                </button>
              ))}
            </div>
          </> : <div className="empty-left"><h2>Nothing picked</h2><p>Click anything on the slide, or start from a scene on the Start tab.</p><button className="btn-go" onClick={() => setRibbon('start')}>Start from a scene</button></div>}
        </aside>

        <main className="lab-center">
          <div className="center-head"><span>Click anything to pick it. Green numbers show the order things come in.</span><b>Whole animation: {s.dur.toFixed(1)} s</b></div>
          <div className="lab-stage" style={{ maxWidth: `calc((100vh - 420px) * ${s.w / s.h})` }}>
            <SceneView scene={s} t={player.t} checker={s.bg.kind === 'clear' ? 'light' : false} pixelated={s.fps < 30}
              onPointerDown={(p, e) => { const o = hit(p); setSel(o?.id ?? null); if (o) { drag.current = { id: o.id, x0: p.x, y0: p.y, ox: o.x, oy: o.y }; (e.target as Element).setPointerCapture?.(e.pointerId); } }}
              onPointerMove={p => { const d = drag.current; if (!d) return; setObj(d.id, o => ({ ...o, x: snapV(d.ox + p.x - d.x0), y: snapV(d.oy + p.y - d.y0) }), 'drag'); }}
              onPointerUp={() => { drag.current = null; }}>
              {gridLines && !clean && <GridLines s={s} />}
              {safeZones && <SafeZones s={s} />}
              {!clean && ordered.map((o, i) => { const b = box[o.id]; if (!b || b[2] <= b[0]) return null; const on = o.id === sel; return (
                <g key={o.id}>
                  {on && <rect x={b[0] - 4} y={b[1] - 4} width={b[2] - b[0] + 8} height={b[3] - b[1] + 8} className="sel-rect" />}
                  <rect x={b[0] - 30} y={b[1] - 30} width={26} height={26} className="badge" /><text x={b[0] - 17} y={b[1] - 11} className="badge-t">{i + 1}</text>
                </g>
              ); })}
              {selObj && box[selObj.id] && !clean && <text x={box[selObj.id][0]} y={box[selObj.id][3] + 26} className="pos-t">x {Math.round(selObj.x / cell)} · y {Math.round(selObj.y / cell)}</text>}
            </SceneView>
          </div>
          <div className="lab-transport">
            <button onClick={() => player.seek(0)} aria-label="To start">⏮</button>
            <button onClick={() => player.step(-1)} aria-label="Back one frame">◀</button>
            <button className="play-go" onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'}>{player.playing ? '❚❚' : '▶'}</button>
            <button onClick={() => player.step(1)} aria-label="Forward one frame">▶</button>
            <input type="range" min={0} max={end} step={1 / s.fps} value={player.t} onChange={e => { player.pause(); player.seek(+e.target.value); }} aria-label="Time" />
            <span className="mono">{fmtTime(player.t, s.fps)} / {fmtTime(end, s.fps)}</span>
            <button className={player.loop ? 'on' : ''} onClick={() => player.setLoop(!player.loop)}>Loop</button>
            <button className={clean ? 'on' : ''} onClick={() => setClean(c => !c)}>{clean ? 'Edit view' : 'Clean view'}</button>
          </div>
          {selObj && <div className="colour-strip"><span>Colour</span><Swatches colors={WWW} value={colourOf(selObj)} onChange={c => setObj(selObj.id, o => tint(o, c), 'col')} /></div>}
        </main>

        <aside className="lab-right">
          <header><h3>Animation order</h3><button className="btn-go sm" onClick={() => { player.seek(0); player.play(); }}>▶ Play all</button></header>
          <ol className="order">
            {ordered.map((o, i) => (
              <li key={o.id} className={o.id === sel ? 'on' : ''} onClick={() => setSel(o.id)}>
                <span className="n">{i + 1}</span>
                <div className="o-body">
                  <b>{o.name}</b>
                  <div className="o-chips"><span className="c-in">In: {fxName('in', o.enter.id)}</span><span className="c-on">{fxName('on', o.on.id)}</span><span className="c-out">Out: {fxName('out', o.exit.id)}</span></div>
                  <span className="sub">{cueText(o)} · on at {o.start.toFixed(1)} s</span>
                </div>
                <div className="o-move"><button onClick={e => { e.stopPropagation(); move(o.id, -1); }} aria-label="Earlier">↑</button><button onClick={e => { e.stopPropagation(); move(o.id, 1); }} aria-label="Later">↓</button></div>
              </li>
            ))}
          </ol>
          {!ordered.length && <p className="sub pad">Insert something, or pick a scene on the Start tab.</p>}
          <div className="mini-tl">
            <h4>Timeline</h4>
            {ordered.map(o => { const st = o.start / end * 100, en = o.enter.dur / end * 100, endT = o.dur > 0 ? o.start + o.dur : s.dur, ex = ['stay', 'none'].includes(o.exit.id) ? 0 : o.exit.dur / end * 100, total = (endT - o.start) / end * 100; return (
              <div key={o.id} className="tl-row" onClick={() => setSel(o.id)}><span style={{ marginLeft: `${st}%`, width: `${en}%` }} className="tl-in" /><span style={{ width: `${Math.max(0, total - en - ex)}%` }} className="tl-on" /><span style={{ width: `${ex}%` }} className="tl-out" /></div>
            ); })}
            <div className="tl-head" style={{ left: `${player.t / end * 100}%` }} />
            <div className="tl-axis"><span>0 s</span><span>{end.toFixed(1)} s</span></div>
          </div>
        </aside>
      </div>
      {pasting && <PasteAscii onClose={() => setPasting(false)} onAdd={text => { add({ type: 'ascii', text, cell: 18, font: 'jetbrains-mono', color: '#FFFFFF' }, { name: 'ASCII art', enter: IN('type-on', { dur: 1 }), exit: OUT('melt', { dur: 0.8 }) }); setPasting(false); }} />}
      {exporting && <ExportDialog scene={s} name={s.name} onClose={() => setExporting(false)} />}
    </div>
  );
}

function PasteAscii({ onClose, onAdd }: { onClose: () => void; onAdd: (t: string) => void }) {
  const [t, setT] = useState(" /\\_/\\\n( o.o )\n > ^ <");
  return (
    <div className="modal-back" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal small" role="dialog" aria-modal aria-label="Paste ASCII art">
        <div className="modal-body"><h2>Paste ASCII art</h2><p className="lede">Every character becomes a cell, so Type on, Rain in and Melt work letter by letter.</p>
          <textarea className="ascii-in" value={t} onChange={e => setT(e.target.value)} rows={10} spellCheck={false} autoFocus /></div>
        <footer className="modal-foot"><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={() => onAdd(t)} disabled={!t.trim()}>Add to slide</button></footer>
      </div>
    </div>
  );
}

function GridLines({ s }: { s: Scene }) {
  const c = s.w / s.grid;
  return (
    <>
      <defs>
        <pattern id="g1" width={c} height={c} patternUnits="userSpaceOnUse"><path d={`M ${c} 0 L 0 0 0 ${c}`} className="grid-1" /></pattern>
        <pattern id="g8" width={c * 8} height={c * 8} patternUnits="userSpaceOnUse"><path d={`M ${c * 8} 0 L 0 0 0 ${c * 8}`} className="grid-8" /></pattern>
      </defs>
      {s.grid <= 128 && <rect width={s.w} height={s.h} fill="url(#g1)" />}
      <rect width={s.w} height={s.h} fill="url(#g8)" />
    </>
  );
}
/** Where YouTube's own UI covers the frame. */
function SafeZones({ s }: { s: Scene }) {
  if (s.h > s.w) return <g className="zones"><rect x={s.w * 0.84} y={s.h * 0.38} width={s.w * 0.16} height={s.h * 0.5} /><rect x={0} y={s.h * 0.8} width={s.w} height={s.h * 0.2} /><rect x={0} y={0} width={s.w} height={s.h * 0.08} /><text x={s.w * 0.5} y={s.h * 0.9} className="zone-t">Captions and channel name</text><text x={s.w * 0.86} y={s.h * 0.36} className="zone-t">Buttons</text></g>;
  return <g className="zones"><rect x={s.w * 0.06} y={s.h * 0.28} width={s.w * 0.32} height={s.h * 0.4} className="card-zone" /><rect x={s.w * 0.62} y={s.h * 0.28} width={s.w * 0.32} height={s.h * 0.4} className="card-zone" /><rect x={0} y={s.h * 0.9} width={s.w} height={s.h * 0.1} /><text x={s.w * 0.22} y={s.h * 0.26} className="zone-t">End-screen card</text><text x={s.w * 0.78} y={s.h * 0.26} className="zone-t">End-screen card</text><text x={s.w * 0.5} y={s.h * 0.96} className="zone-t">Player controls</text></g>;
}

function SpriteIcon({ sprite }: { sprite: { w: number; h: number; frames: string[]; palette: string[] } }) {
  const rows = sprite.frames[0].split('\n');
  return <svg className="spr" viewBox={`0 0 ${sprite.w} ${sprite.h}`} shapeRendering="crispEdges" aria-hidden>{rows.flatMap((r, y) => [...r].map((ch, x) => { const i = /[1-9]/.test(ch) ? +ch : /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : 0; return i ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={sprite.palette[i - 1]} /> : null; }))}</svg>;
}

export function kindName(k: ObjKind): string {
  return ({ 'pixel-text': 'Pixel text', text: 'Text', sprite: 'Pixel art', ascii: 'ASCII art', 'ascii-banner': 'ASCII banner', field: 'Glyph field', shape: 'Shape', card: 'Card' } as const)[k.type];
}
function cueText(o: Obj) {
  const w = o.gap ? `, waits ${o.gap.toFixed(1)} s` : '';
  return o.cue === 'start' ? `Starts at the beginning${w}` : o.cue === 'with' ? `Starts with the one above${w}` : o.cue === 'after' ? `Starts after the one above${w}` : 'At a set time';
}
function colourOf(o: Obj): string {
  const k = o.kind;
  return k.type === 'text' ? k.style.color : 'color' in k ? (k as { color: string }).color : k.type === 'shape' ? k.style.fill || k.style.stroke : k.type === 'sprite' ? k.tint : '';
}
function tint(o: Obj, c: string): Obj {
  const k = o.kind;
  if (k.type === 'text') return { ...o, kind: { ...k, style: { ...k.style, color: c } } };
  if (k.type === 'pixel-text' || k.type === 'ascii' || k.type === 'ascii-banner') return { ...o, kind: { ...k, color: c } };
  if (k.type === 'shape') return { ...o, kind: { ...k, style: { ...k.style, fill: k.style.fill ? c : '', stroke: k.style.stroke ? c : '' } } };
  if (k.type === 'sprite') return { ...o, kind: { ...k, tint: c } };
  return o;
}
function reshape(s: Scene, f: string): Scene {
  const [w, h] = f === '916' ? [1080, 1920] : f === '11' ? [1080, 1080] : [1920, 1080];
  return { ...s, w, h, objects: s.objects.map(o => ({ ...o, x: Math.round(o.x * Math.min(1, w / s.w)), y: Math.round(o.y * h / s.h), kind: o.kind.type === 'field' && o.kind.w >= s.w * 0.9 ? { ...o.kind, w, h } : o.kind })) };
}
