// The Studio: a dark, pro-style editor over the same project the Lab edits. Edit (layers, viewer,
// inspector, timeline), Draw, Library, Glyph Lab, Mix and Bounce share one clock and one selection.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Logo, useApp } from '../App';
import { bounds } from '../engine';
import { store, stored } from '../history';
import { resolveCues, safe } from '../layout';
import { search } from '../library';
import { kindName } from './AnimationLab';
import { BounceTab } from './studio/BounceTab';
import { DrawTab } from './studio/DrawTab';
import { GlyphLab } from './studio/GlyphLab';
import { LibraryTab } from './studio/LibraryTab';
import { MixTab } from './studio/MixTab';
import { Num, Select, Slider, Swatches } from '../ui/controls';
import { SceneView, usePlayer } from '../ui/SceneView';
import { clone, FIELD, IN, obj, OUT, SHAPE_STYLE, TEXT_STYLE, textOf, withText, type Obj, type ObjKind, type Scene } from '../types';

export type StudioTab = 'edit' | 'draw' | 'library' | 'glyph' | 'mix' | 'bounce';
export interface Marker { t: number; label: string }
export type Auto = 'off' | 'read' | 'touch' | 'latch' | 'write';

export interface StudioCtx {
  s: Scene; view: Scene;
  edit: (f: (s: Scene) => Scene, key?: string) => void;
  setObj: (id: string, f: (o: Obj) => Obj, key?: string) => void;
  sel: string | null; setSel: (id: string | null) => void;
  player: ReturnType<typeof usePlayer>;
  solo: string[]; setSolo: (f: (s: string[]) => string[]) => void;
  auto: Record<string, Auto>; setAuto: (id: string, a: Auto) => void;
  markers: Marker[]; setMarkers: (m: Marker[]) => void;
  box: Record<string, [number, number, number, number]>;
}

const fmtTC = (t: number, fps: number) => { const f = Math.floor(t * fps + 1e-4), ff = f % fps, s = Math.floor(f / fps); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(ff).padStart(2, '0')}`; };
const TRACK_COLORS = ['#3D82FF', '#8B5CF6', '#38B6FF', '#B04CC4', '#F5C542', '#F0507A', '#22D37F', '#FF8A1F'];

export function Studio({ tab }: { tab: StudioTab }) {
  const app = useApp();
  const { project, go, lib, openItem } = app;
  const s = project.value;
  const edit = useCallback((f: (s: Scene) => Scene, key = '') => project.set(v => resolveCues(f(v)), key), [project]);
  const setObj = useCallback((id: string, f: (o: Obj) => Obj, key = '') => edit(v => ({ ...v, objects: v.objects.map(o => (o.id === id ? f(o) : o)) }), key), [edit]);
  const [sel, setSel] = useState<string | null>(s.objects[s.objects.length - 1]?.id ?? null);
  const [solo, setSoloS] = useState<string[]>([]);
  const setSolo = (f: (s: string[]) => string[]) => setSoloS(f);
  const [auto, setAutoS] = useState<Record<string, Auto>>({});
  const setAuto = (id: string, a: Auto) => setAutoS(m => ({ ...m, [id]: a }));
  const [markers, setMarkersS] = useState<Marker[]>(() => stored('webimation.markers.v1', () => []));
  const setMarkers = (m: Marker[]) => { setMarkersS(m); store('webimation.markers.v1')(m); };
  const [box, setBox] = useState<Record<string, [number, number, number, number]>>({});
  const player = usePlayer(Math.max(1, s.dur), s.fps, false);
  const [q, setQ] = useState('');
  // What's previewed: soloed layers only (when any), and automation off where a channel is set to Off.
  const view = useMemo(() => ({ ...s, objects: s.objects.map(o => ({ ...o, hidden: o.hidden || (solo.length > 0 && !solo.includes(o.id)), opacity_keys: auto[o.id] === 'off' ? [] : o.opacity_keys })) }), [s, solo, auto]);
  useEffect(() => { let live = true; const id = setTimeout(() => bounds(s).then(b => live && setBox(b)), 80); return () => { live = false; clearTimeout(id); }; }, [s]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); go({ m: 'studio', tab: 'bounce' }); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.getElementById('studio-q')?.focus(); return; }
      if (typing) return;
      if (e.key === ' ' && tab !== 'library') { e.preventDefault(); player.toggle(); }
      if (e.key === 'm' && !e.metaKey) setMarkers([...markers, { t: player.t, label: `Marker ${markers.length + 1}` }].sort((a, b) => a.t - b.t));
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && tab === 'edit') { e.preventDefault(); edit(v => ({ ...v, objects: v.objects.filter(o => o.id !== sel) })); setSel(null); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const ctx: StudioCtx = { s, view, edit, setObj, sel, setSel, player, solo, setSolo, auto, setAuto, markers, setMarkers, box };
  const hits = q ? [...search(lib, q).slice(0, 6).map(i => ({ label: i.name, sub: i.shelf, run: () => openItem(i) })), ...s.objects.filter(o => o.name.toLowerCase().includes(q.toLowerCase())).map(o => ({ label: o.name, sub: 'Layer', run: () => { setSel(o.id); go({ m: 'studio', tab: 'edit' }); } })), ...(['edit', 'draw', 'library', 'glyph', 'mix', 'bounce'] as StudioTab[]).filter(t => t.includes(q.toLowerCase())).map(t => ({ label: `Go to ${t}`, sub: 'Command', run: () => go({ m: 'studio', tab: t }) }))] : [];
  const TABS: [StudioTab | 'lab' | 'paint', string][] = [['edit', 'Edit'], ['draw', 'Draw'], ['library', 'Library'], ['lab', 'Animation Lab'], ['paint', 'Pixel Paint'], ['glyph', 'Glyph Lab'], ['mix', 'Mix']];

  return (
    <div className="studio">
      <header className="st-bar">
        <Logo size={26} />
        <input className="st-name" value={s.name} onChange={e => edit(v => ({ ...v, name: e.target.value }), 'name')} aria-label="Project name" />
        <div className="qs" role="group" aria-label="Mode"><button onClick={() => go({ m: 'pick' })}>Quick</button><button className="on">Studio</button></div>
        <nav className="st-tabs">{TABS.map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => go(id === 'lab' ? { m: 'lab' } : id === 'paint' ? { m: 'paint' } : { m: 'studio', tab: id })}>{l}</button>)}</nav>
        <span className="grow" />
        <div className="st-search">
          <input id="studio-q" value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${lib.length} animations, layers, commands`} aria-label="Search" onKeyDown={e => { if (e.key === 'Enter' && hits[0]) { hits[0].run(); setQ(''); } if (e.key === 'Escape') setQ(''); }} /><kbd>⌘K</kbd>
          {hits.length > 0 && <ul className="st-hits">{hits.map((h, i) => <li key={i}><button onClick={() => { h.run(); setQ(''); }}>{h.label}<span>{h.sub}</span></button></li>)}</ul>}
        </div>
        <button className="st-bounce" onClick={() => go({ m: 'studio', tab: 'bounce' })}>Bounce <kbd>⌘B</kbd></button>
      </header>
      {tab === 'edit' && <EditTab c={ctx} />}
      {tab === 'draw' && <DrawTab c={ctx} />}
      {tab === 'library' && <LibraryTab c={ctx} />}
      {tab === 'glyph' && <GlyphLab c={ctx} />}
      {tab === 'mix' && <MixTab c={ctx} />}
      {tab === 'bounce' && <BounceTab c={ctx} />}
    </div>
  );
}

// ── Viewer with selection handles and snap guides (shared by Edit and Draw) ──────────────────
export function Viewer({ c, tool, onCreate, checker, guides = true }: { c: StudioCtx; tool?: string; onCreate?: (r: [number, number, number, number]) => void; checker: boolean; guides?: boolean }) {
  const { s, view, sel, setSel, setObj, box, player } = c;
  const drag = useRef<{ mode: 'move' | 'scale' | 'create'; id?: string; x0: number; y0: number; ox: number; oy: number; os: number; b?: [number, number, number, number] } | null>(null);
  const [rubber, setRubber] = useState<[number, number, number, number] | null>(null);
  const [snapX, setSnapX] = useState(false), [snapY, setSnapY] = useState(false);
  const ordered = [...s.objects].sort((a, b) => b.order - a.order);
  const selB = sel ? box[sel] : null;
  const sa = safe(s);
  const down = (p: { x: number; y: number }, e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool && tool !== 'select' && onCreate) { drag.current = { mode: 'create', x0: p.x, y0: p.y, ox: 0, oy: 0, os: 1 }; setRubber([p.x, p.y, p.x, p.y]); return; }
    if (selB && Math.abs(p.x - selB[2]) < 18 && Math.abs(p.y - selB[3]) < 18) { const o = s.objects.find(x => x.id === sel)!; drag.current = { mode: 'scale', id: o.id, x0: p.x, y0: p.y, ox: o.x, oy: o.y, os: o.scale, b: selB }; return; }
    const o = ordered.find(x => { const b = box[x.id]; return b && !x.hidden && !x.locked && p.x >= b[0] - 4 && p.x <= b[2] + 4 && p.y >= b[1] - 4 && p.y <= b[3] + 4 && !(x.kind.type === 'field' && x.kind.w >= s.w * 0.9 && ordered.some(y => y !== x && box[y.id] && p.x >= box[y.id][0] && p.x <= box[y.id][2] && p.y >= box[y.id][1] && p.y <= box[y.id][3])); });
    setSel(o?.id ?? null);
    if (o) drag.current = { mode: 'move', id: o.id, x0: p.x, y0: p.y, ox: o.x, oy: o.y, os: o.scale, b: box[o.id] };
  };
  const move = (p: { x: number; y: number }) => {
    const d = drag.current; if (!d) return;
    if (d.mode === 'create') { setRubber([d.x0, d.y0, p.x, p.y]); return; }
    if (d.mode === 'move' && d.b) {
      let dx = p.x - d.x0, dy = p.y - d.y0;
      const cx = (d.b[0] + d.b[2]) / 2 + dx, cy = (d.b[1] + d.b[3]) / 2 + dy;
      const sx = Math.abs(cx - s.w / 2) < 10, sy = Math.abs(cy - s.h / 2) < 10;
      if (sx) dx += s.w / 2 - cx; if (sy) dy += s.h / 2 - cy;
      setSnapX(sx); setSnapY(sy);
      setObj(d.id!, o => ({ ...o, x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) }), 'move');
    }
    if (d.mode === 'scale' && d.b) {
      const w0 = d.b[2] - d.b[0], k = Math.max(0.1, (w0 + p.x - d.x0) / Math.max(1, w0));
      setObj(d.id!, o => ({ ...o, scale: +(d.os * k).toFixed(3) }), 'scale');
    }
  };
  const up = () => { const d = drag.current; drag.current = null; setSnapX(false); setSnapY(false); if (d?.mode === 'create' && rubber && onCreate) { const r: [number, number, number, number] = [Math.min(rubber[0], rubber[2]), Math.min(rubber[1], rubber[3]), Math.max(rubber[0], rubber[2]), Math.max(rubber[1], rubber[3])]; onCreate(r); } setRubber(null); };
  return (
    <SceneView scene={view} t={player.t} checker={checker ? 'dark' : false} onPointerDown={down} onPointerMove={move} onPointerUp={up} className="st-viewer">
      {guides && <rect x={sa.x0} y={sa.y0} width={sa.x1 - sa.x0} height={sa.y1 - sa.y0} className="safe dark" />}
      {snapX && <line x1={s.w / 2} y1={0} x2={s.w / 2} y2={s.h} className="snap" />}
      {snapY && <line x1={0} y1={s.h / 2} x2={s.w} y2={s.h / 2} className="snap" />}
      {selB && selB[2] > selB[0] && <g className="handles">
        <rect x={selB[0]} y={selB[1]} width={selB[2] - selB[0]} height={selB[3] - selB[1]} />
        {[[0, 1], [2, 1], [0, 3], [2, 3], [(0), -1], [2, -1], [-1, 1], [-1, 3]].slice(0, 4).map(([xi, yi], i) => <rect key={i} className="h" x={selB[xi] - 7} y={selB[yi] - 7} width={14} height={14} />)}
        <rect x={(selB[0] + selB[2]) / 2 - 60} y={selB[3] + 12} width={120} height={30} className="dim-bg" />
        <text x={(selB[0] + selB[2]) / 2} y={selB[3] + 33} className="dim-t">W {Math.round(selB[2] - selB[0])} H {Math.round(selB[3] - selB[1])}</text>
      </g>}
      {rubber && <rect x={Math.min(rubber[0], rubber[2])} y={Math.min(rubber[1], rubber[3])} width={Math.abs(rubber[2] - rubber[0])} height={Math.abs(rubber[3] - rubber[1])} className="rubber" />}
    </SceneView>
  );
}

export function Transport({ c, right }: { c: StudioCtx; right?: React.ReactNode }) {
  const { player, s } = c;
  return (
    <div className="st-transport">
      <button onClick={() => player.seek(0)} aria-label="To start">⏮</button>
      <button className={`pp${player.playing ? ' on' : ''}`} onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'}>{player.playing ? '❚❚' : '▶'}</button>
      <button className={player.loop ? 'on' : ''} onClick={() => player.setLoop(!player.loop)} aria-label="Loop">⟲</button>
      <span className="tc">{fmtTC(player.t, s.fps)}</span><span className="fps">{s.fps} FPS</span>
      <span className="grow" />{right}
    </div>
  );
}

// ── Edit ──────────────────────────────────────────────────────────────────────────────────
function EditTab({ c }: { c: StudioCtx }) {
  const { s, edit, setObj, sel, setSel, player, markers, setMarkers } = c;
  const { cat, go } = useApp();
  const [left, setLeft] = useState<'layers' | 'markers'>('layers');
  const [insp, setInsp] = useState<'layer' | 'animate' | 'fx'>('layer');
  const [checker, setChecker] = useState(true), [guides, setGuides] = useState(true);
  const [rename, setRename] = useState<string | null>(null);
  const layers = [...s.objects].sort((a, b) => b.order - a.order);
  const o = s.objects.find(x => x.id === sel) ?? null;
  const add = (kind: ObjKind, extra: Partial<Obj> = {}) => { const n = obj(kind, { name: kindName(kind), x: 760, y: 440, start: +player.t.toFixed(2), dur: 4, cue: 'manual', order: Math.max(-1, ...s.objects.map(x => x.order)) + 1, ...extra }); edit(v => ({ ...v, objects: [...v.objects, n], dur: Math.max(v.dur, n.start + 4) })); setSel(n.id); };
  const fxCount = (x: Obj) => [x.enter.id !== 'none', x.on.id !== 'none', !['stay', 'none'].includes(x.exit.id), x.as_ascii].filter(Boolean).length;
  const fxName = (slot: string, id: string) => cat.effects.find(e => e.slot === slot && e.id === id)?.name ?? id;

  return (
    <div className="st-edit">
      <aside className="st-left">
        <div className="st-ltabs"><button className={left === 'layers' ? 'on' : ''} onClick={() => setLeft('layers')}>Layers</button><button className={left === 'markers' ? 'on' : ''} onClick={() => setLeft('markers')}>Markers</button></div>
        {left === 'layers' ? (
          <ul className="layers">
            {layers.map(x => (
              <li key={x.id} className={x.id === sel ? 'on' : ''} onClick={() => setSel(x.id)} onDoubleClick={() => setRename(x.id)}>
                <button className={`eye${x.hidden ? ' off' : ''}`} onClick={e => { e.stopPropagation(); setObj(x.id, y => ({ ...y, hidden: !y.hidden })); }} aria-label={x.hidden ? 'Show' : 'Hide'}>◉</button>
                <span className="lk">{({ text: 'T', 'pixel-text': 'P', sprite: '▦', ascii: '>', 'ascii-banner': '#', field: '#', shape: '▲', card: '▭' } as Record<string, string>)[x.kind.type]}</span>
                {rename === x.id ? <input autoFocus defaultValue={x.name} onBlur={e => { setObj(x.id, y => ({ ...y, name: e.target.value || y.name })); setRename(null); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} /> : <span className="ln">{x.name}</span>}
                {fxCount(x) > 0 && <span className="fxc">FX {fxCount(x)}</span>}
                <button className={`lock${x.locked ? ' on' : ''}`} onClick={e => { e.stopPropagation(); setObj(x.id, y => ({ ...y, locked: !y.locked })); }} aria-label="Lock">{x.locked ? '🔒' : '·'}</button>
              </li>
            ))}
            {!layers.length && <li className="empty">No layers yet. Add one below or open the Library.</li>}
          </ul>
        ) : (
          <ul className="layers">{markers.map((m, i) => <li key={i} onClick={() => player.seek(m.t)}><span className="lk">◆</span><span className="ln">{m.label}</span><span className="fxc">{m.t.toFixed(1)}s</span><button className="lock" onClick={e => { e.stopPropagation(); setMarkers(markers.filter((_, j) => j !== i)); }} aria-label="Delete marker">×</button></li>)}<li className="empty">Press M to drop a marker at the playhead.</li></ul>
        )}
        <div className="quick-add">
          <p className="caps">Quick add</p>
          <div className="qa-grid">
            <button onClick={() => add({ type: 'text', text: 'New title', style: TEXT_STYLE({ font: 'archivo-black', size: 96 }) })}>Text</button>
            <button onClick={() => add({ type: 'shape', style: SHAPE_STYLE({ kind: 'rounded', fill: '#3D82FF' }), w: 320, h: 180 })}>Shape</button>
            <button onClick={() => add({ type: 'shape', style: SHAPE_STYLE({ kind: 'arrow', fill: '#FF8A1F' }), w: 320, h: 90 }, { enter: IN('draw-on', { dur: 0.6 }) })}>Arrow</button>
            <button onClick={() => add({ type: 'field', w: s.w, h: s.h, style: clone(cat.looks[0].style), field: FIELD(), source: 'WEBIMATION' }, { x: 0, y: 0, order: -1, enter: IN('dither-in'), exit: OUT('dither-out'), dur: 0 })}>ASCII field</button>
            <button onClick={() => add({ type: 'sprite', sprite: clone(cat.starters[0].sprite), px: 12, tint: '' })}>Pixel art</button>
            <button onClick={() => go({ m: 'studio', tab: 'library' })}>Library…</button>
          </div>
        </div>
      </aside>
      <main className="st-center">
        <Transport c={c} right={<><button className={`chip-b${guides ? ' on' : ''}`} onClick={() => setGuides(g => !g)}>Safe</button><button className={`chip-b${checker ? ' on' : ''}`} onClick={() => setChecker(v => !v)}>Checker</button></>} />
        <div className="viewer-wrap"><Viewer c={c} checker={checker} guides={guides} /></div>
        <div className="st-caption"><span>Checker = transparent. Only what you see over it is exported.</span><span className="mono">{s.w} × {s.h} · vector · alpha</span></div>
      </main>
      <aside className="st-right">
        {o ? <>
          <header className="insp-h"><h2>{o.name}</h2><span className="caps">{kindName(o.kind)} layer</span></header>
          <div className="insp-tabs">{(['layer', 'animate', 'fx'] as const).map(t => <button key={t} className={insp === t ? 'on' : ''} onClick={() => setInsp(t)}>{t === 'fx' ? `FX ${fxCount(o)}` : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
          {insp === 'layer' && <div className="insp">
            {textOf(o) !== null && <><p className="caps">Text</p><textarea className="st-input" value={textOf(o)!} rows={2} onChange={e => setObj(o.id, x => withText(x, e.target.value), 'txt')} /></>}
            {o.kind.type === 'text' && <>
              <Select label="Font" value={o.kind.style.font} onChange={font => setObj(o.id, x => x.kind.type === 'text' ? { ...x, kind: { ...x.kind, style: { ...x.kind.style, font } } } : x)} options={cat.fonts.map(f => [f.id, f.name] as const)} />
              <div className="row3"><Num label="Sz" value={o.kind.style.size} onChange={size => setObj(o.id, x => x.kind.type === 'text' ? { ...x, kind: { ...x.kind, style: { ...x.kind.style, size } } } : x, 'sz')} /><Num label="Tr" value={o.kind.style.tracking * 100} suffix="%" onChange={v => setObj(o.id, x => x.kind.type === 'text' ? { ...x, kind: { ...x.kind, style: { ...x.kind.style, tracking: v / 100 } } } : x, 'tr')} /><Num label="Lh" value={o.kind.style.line_height} step={0.05} onChange={line_height => setObj(o.id, x => x.kind.type === 'text' ? { ...x, kind: { ...x.kind, style: { ...x.kind.style, line_height } } } : x, 'lh')} /></div>
              <Swatches colors={['#F4F4F5', '#0B0B0C', '#3D82FF', '#F5C542', '#FF8A1F', '#22D37F', '#F0507A', '#8B5CF6']} value={o.kind.style.color} onChange={color => setObj(o.id, x => x.kind.type === 'text' ? { ...x, kind: { ...x.kind, style: { ...x.kind.style, color } } } : x)} />
            </>}
            <p className="caps">Transform <KeyNav o={o} c={c} /></p>
            <div className="row2"><Num label="X" value={o.x} onChange={x => setObj(o.id, y => ({ ...y, x }), 'x')} /><Num label="Y" value={o.y} onChange={y => setObj(o.id, z => ({ ...z, y }), 'y')} /></div>
            <div className="row2"><Num label="Scale" value={Math.round(o.scale * 100)} suffix="%" onChange={v => setObj(o.id, y => ({ ...y, scale: v / 100 }), 'sc')} /><Num label="Rotation" value={o.rot} suffix="°" onChange={rot => setObj(o.id, y => ({ ...y, rot }), 'rot')} /></div>
            <div className="kf-row"><Slider label="Opacity" value={o.opacity} min={0} max={1} onChange={opacity => setObj(o.id, y => ({ ...y, opacity }), 'op')} fmt={v => `${Math.round(v * 100)}%`} /><button className="diamond" title="Add an opacity keyframe at the playhead" onClick={() => setObj(o.id, y => ({ ...y, opacity_keys: [...y.opacity_keys.filter(k => Math.abs(k[0] - player.t) > 1e-3), [player.t, y.opacity] as [number, number]].sort((a, b) => a[0] - b[0]), opacity: 1 }))}>◆</button></div>
            <div className="row2"><Num label="Starts" value={o.start} step={0.1} suffix="s" onChange={start => setObj(o.id, y => ({ ...y, start, cue: 'manual' }), 'st')} /><Num label="Length" value={o.dur} step={0.1} suffix={o.dur ? 's' : 's · to end'} onChange={dur => setObj(o.id, y => ({ ...y, dur }), 'du')} /></div>
          </div>}
          {insp === 'animate' && <div className="insp">
            <p className="caps">Animate</p>
            <div className="anim-row"><span>In</span><Select label="In" value={o.enter.id} onChange={id => setObj(o.id, y => ({ ...y, enter: { ...y.enter, id } }))} options={cat.effects.filter(e => e.slot === 'in').map(e => [e.id, e.name] as const)} /><Num label="" value={o.enter.dur} step={0.1} suffix="s" onChange={dur => setObj(o.id, y => ({ ...y, enter: { ...y.enter, dur } }), 'ed')} /></div>
            <div className="anim-row"><span>Out</span><Select label="Out" value={o.exit.id} onChange={id => setObj(o.id, y => ({ ...y, exit: { ...y.exit, id } }))} options={cat.effects.filter(e => e.slot === 'out').map(e => [e.id, e.name] as const)} /><Num label="" value={o.exit.dur} step={0.1} suffix="s" onChange={dur => setObj(o.id, y => ({ ...y, exit: { ...y.exit, dur } }), 'xd')} /></div>
            <div className="anim-row"><span>Loop</span><Select label="Loop" value={o.on.id} onChange={id => setObj(o.id, y => ({ ...y, on: { ...y.on, id } }))} options={cat.effects.filter(e => e.slot === 'on').map(e => [e.id, e.name] as const)} /><Num label="" value={o.on.speed} step={0.1} suffix="×" onChange={speed => setObj(o.id, y => ({ ...y, on: { ...y.on, speed } }), 'os')} /></div>
            <Slider label="Loop amount" value={o.on.amp} min={0} max={3} onChange={amp => setObj(o.id, y => ({ ...y, on: { ...y.on, amp } }), 'amp')} reset={1} />
            <Select label="Curve" value={o.enter.ease} onChange={ease => setObj(o.id, y => ({ ...y, enter: { ...y.enter, ease } }))} options={[['quart-out', 'Quart out'], ['cubic-out', 'Cubic out'], ['quart-in-out', 'In-out'], ['back-out', 'Overshoot'], ['bounce-out', 'Bounce'], ['elastic-out', 'Elastic'], ['linear', 'Linear'], ['steps4', '4 steps'], ['steps8', '8 steps'], ['steps16', '16 steps']]} />
            <button className="link" onClick={() => go({ m: 'studio', tab: 'library' })}>Browse {cat.effects.length} effects and the full library →</button>
          </div>}
          {insp === 'fx' && <div className="insp">
            <p className="caps">Effects chain <button className="link" onClick={() => go({ m: 'studio', tab: 'mix' })}>Open in Mix</button></p>
            <ol className="chain">
              <li><b>A</b> {fxName('in', o.enter.id)} <span>in</span></li>
              <li><b>B</b> {fxName('on', o.on.id)} <span>loop</span></li>
              <li><b>C</b> {fxName('out', o.exit.id)} <span>out</span></li>
              <li><b>D</b> <label><input type="checkbox" checked={o.as_ascii} onChange={e => setObj(o.id, y => ({ ...y, as_ascii: e.target.checked }))} /> Draw as characters</label></li>
            </ol>
            {o.as_ascii && <><Select label="Character font" value={o.ascii_font} onChange={ascii_font => setObj(o.id, y => ({ ...y, ascii_font }))} options={cat.fonts.filter(f => f.mono).map(f => [f.id, f.name] as const)} /><Select label="Characters" value={o.ascii_chars} onChange={ascii_chars => setObj(o.id, y => ({ ...y, ascii_chars }))} options={cat.charsets.map(cs => [cs.chars, cs.name] as const)} /></>}
            <Select label="Blend" value={o.blend} onChange={blend => setObj(o.id, y => ({ ...y, blend }))} options={[['normal', 'Normal'], ['screen', 'Screen'], ['add', 'Add'], ['multiply', 'Multiply'], ['difference', 'Difference']]} />
            {o.kind.type === 'field' && <button className="btn" onClick={() => go({ m: 'studio', tab: 'glyph' })}>Open in Glyph Lab</button>}
          </div>}
        </> : <div className="insp empty"><h2>Nothing selected</h2><p>Click a layer or anything in the viewer.</p></div>}
      </aside>
      <Timeline c={c} />
    </div>
  );
}

function KeyNav({ o, c }: { o: Obj; c: StudioCtx }) {
  const ks = o.opacity_keys.map(k => k[0]);
  const prev = [...ks].reverse().find(t => t < c.player.t - 1e-3), next = ks.find(t => t > c.player.t + 1e-3);
  return <span className="keynav"><button disabled={prev === undefined} onClick={() => prev !== undefined && c.player.seek(prev)} aria-label="Previous keyframe">◂</button>◆<button disabled={next === undefined} onClick={() => next !== undefined && c.player.seek(next)} aria-label="Next keyframe">▸</button></span>;
}

// ── Timeline ──────────────────────────────────────────────────────────────────────────────
export function Timeline({ c }: { c: StudioCtx }) {
  const { s, edit, setObj, sel, setSel, player, solo, setSolo, markers, setMarkers } = c;
  const { cat } = useApp();
  const [zoomS, setZoom] = useState<number | null>(null), [snapOn, setSnapOn] = useState(true);
  const lane = useRef<HTMLDivElement>(null);
  const [laneW, setLaneW] = useState(800);
  useEffect(() => { const el = lane.current; if (!el) return; const ro = new ResizeObserver(() => setLaneW(el.clientWidth)); ro.observe(el); return () => ro.disconnect(); }, []);
  // Until you zoom, the whole project fits the lane.
  const zoom = zoomS ?? Math.max(0.25, Math.min(6, (laneW - 24) / (Math.max(1, s.dur) * 40)));
  const pxs = 40 * zoom;
  const width = Math.max(1, s.dur) * pxs;
  const tracks = [...s.objects].sort((a, b) => a.order - b.order);
  const toT = (clientX: number) => { const r = lane.current!.getBoundingClientRect(); return Math.max(0, (clientX - r.left + lane.current!.scrollLeft) / pxs); };
  const snapT = (t: number) => { if (!snapOn) return +t.toFixed(3); const f = Math.round(t * s.fps) / s.fps; const m = markers.find(mk => Math.abs(mk.t - t) < 6 / pxs); return m ? m.t : f; };
  const scrub = (e: React.PointerEvent) => { player.pause(); player.seek(toT(e.clientX)); };
  const dragClip = (o: Obj, mode: 'move' | 'trim', e: React.PointerEvent) => {
    e.stopPropagation(); setSel(o.id);
    const t0 = toT(e.clientX), s0 = o.start, d0 = o.dur > 0 ? o.dur : s.dur - o.start;
    const mv = (ev: PointerEvent) => { const dt = toT(ev.clientX) - t0; if (mode === 'move') setObj(o.id, x => ({ ...x, start: Math.max(0, snapT(s0 + dt)), cue: 'manual' }), 'clip'); else setObj(o.id, x => ({ ...x, dur: Math.max(0.2, snapT(s0 + d0 + dt) - s0) }), 'trim'); };
    const upf = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upf); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upf);
  };
  const fxn = (slot: string, id: string) => cat.effects.find(e => e.slot === slot && e.id === id)?.name ?? id;
  const ticks = Array.from({ length: Math.ceil(s.dur) + 1 }, (_, i) => i).filter(i => zoom >= 1 || i % 5 === 0);
  return (
    <section className="st-timeline">
      <header><span className="caps">Timeline</span><span className="sub">{tracks.length} tracks · {s.dur.toFixed(1)} s</span><span className="grow" />
        <button className="chip-b" onClick={() => setMarkers([...markers, { t: player.t, label: `Marker ${markers.length + 1}` }].sort((a, b) => a.t - b.t))}>+ Marker</button>
        <button className={`chip-b${snapOn ? ' on' : ''}`} onClick={() => setSnapOn(v => !v)}>Snap: frames + markers</button>
        <Num label="Length" value={s.dur} step={1} min={1} max={3600} suffix="s" onChange={dur => edit(v => ({ ...v, dur }), 'sdur')} />
        <label className="zoom">Zoom <input type="range" min={0.25} max={6} step={0.05} value={zoom} onChange={e => setZoom(+e.target.value)} /></label>
      </header>
      <div className="tl-grid">
        <div className="tl-heads">
          <div className="tl-ruler-h" /><div className="tl-mk-h caps">Markers</div>
          {tracks.map((o, i) => (
            <div key={o.id} className={`trk-head${o.id === sel ? ' on' : ''}`} style={{ borderLeftColor: TRACK_COLORS[i % TRACK_COLORS.length] }} onClick={() => setSel(o.id)}>
              <span className="mono">{String(i + 1).padStart(2, '0')}</span><span className="tn">{o.name}</span>
              <button className={o.hidden ? 'on' : ''} onClick={e => { e.stopPropagation(); setObj(o.id, x => ({ ...x, hidden: !x.hidden })); }} aria-label="Mute">M</button>
              <button className={solo.includes(o.id) ? 'on solo' : ''} onClick={e => { e.stopPropagation(); setSolo(sl => sl.includes(o.id) ? sl.filter(x => x !== o.id) : [...sl, o.id]); }} aria-label="Solo">S</button>
            </div>
          ))}
        </div>
        <div className="tl-lanes" ref={lane}>
          <div style={{ width, position: 'relative' }}>
            <div className="tl-ruler" onPointerDown={e => { scrub(e); const mv = (ev: PointerEvent) => player.seek(toT(ev.clientX)); const upf = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upf); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upf); }}>
              {ticks.map(i => <span key={i} style={{ left: i * pxs }}>{Math.floor(i / 60)}:{String(i % 60).padStart(2, '0')}</span>)}
            </div>
            <div className="tl-markers">{markers.map((m, i) => <button key={i} style={{ left: m.t * pxs }} onClick={() => player.seek(m.t)} onDoubleClick={() => { const l = prompt('Marker name', m.label); if (l) setMarkers(markers.map((x, j) => (j === i ? { ...x, label: l } : x))); }}>{m.label}</button>)}</div>
            {tracks.map((o, i) => {
              const end = o.dur > 0 ? o.start + o.dur : s.dur, col = TRACK_COLORS[i % TRACK_COLORS.length];
              return (
                <div key={o.id} className="tl-lane">
                  <div className={`clip${o.id === sel ? ' on' : ''}${o.hidden ? ' muted' : ''}`} style={{ left: o.start * pxs, width: Math.max(8, (end - o.start) * pxs), background: `color-mix(in srgb, ${col} 32%, #111)`, borderColor: col }} onPointerDown={e => dragClip(o, 'move', e)}>
                    <span>{o.name} · {fxn('in', o.enter.id)} · {fxn('out', o.exit.id)}</span>
                    <i className="trim" onPointerDown={e => dragClip(o, 'trim', e)} />
                  </div>
                  {o.opacity_keys.length > 0 && <svg className="auto-line" style={{ width }} viewBox={`0 0 ${width} 20`} preserveAspectRatio="none"><polyline points={o.opacity_keys.map(k => `${k[0] * pxs},${18 - k[1] * 16}`).join(' ')} />{o.opacity_keys.map((k, j) => <rect key={j} x={k[0] * pxs - 3} y={18 - k[1] * 16 - 3} width={6} height={6} transform={`rotate(45 ${k[0] * pxs} ${18 - k[1] * 16})`} />)}</svg>}
                </div>
              );
            })}
            <div className="tl-play" style={{ left: player.t * pxs }} />
          </div>
        </div>
      </div>
    </section>
  );
}
