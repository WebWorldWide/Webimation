// Draw: simple graphics you make yourself. Pick a shape, drag it out, then "Make it move".
import { useState } from 'react';
import { useApp } from '../../App';
import { IN, obj, ON, SHAPE_STYLE, TEXT_STYLE, type Obj, type ShapeKind, type ShapeStyle } from '../../types';
import { Num, Slider, Swatches } from '../../ui/controls';
import { Transport, Viewer, type StudioCtx } from '../Studio';

const GROUPS: [string, [ShapeKind, string, string][]][] = [
  ['Basics', [['rect', '▭', 'Rectangle'], ['rounded', '▢', 'Rounded'], ['ellipse', '◯', 'Ellipse'], ['triangle', '△', 'Triangle'], ['star', '☆', 'Star'], ['line', '╱', 'Line']]],
  ['Arrows', [['arrow', '→', 'Straight'], ['elbow', '↳', 'Elbow'], ['bracket', '[ ]', 'Bracket']]],
  ['Callouts', [['bubble', '💬', 'Bubble'], ['pin', '⌖', 'Pin'], ['burst', '✸', 'Burst'], ['spotlight', '◎', 'Spotlight'], ['cloud', '☁', 'Cloud'], ['heart', '♡', 'Heart']]],
  ['Marks', [['check', '✓', 'Check'], ['cross', '✕', 'Cross'], ['underline', '⎽', 'Underline'], ['circle-it', '◌', 'Circle it'], ['progress', '▬', 'Progress']]]
];
const FILLS = ['#F5C542', '#F4F4F5', '#3D82FF', '#F0507A', '#22D37F', '#B48CFF', '#FF8A1F', '#0B0B0C'];
const SUGGEST: [string, string, string, Partial<Obj>][] = [
  ['draw-on', 'Draw on', 'The outline draws itself on', { enter: IN('draw-on', { dur: 0.8 }) }],
  ['pop', 'Pop', 'Scales up with a small overshoot', { enter: IN('pop', { dur: 0.45 }) }],
  ['dither-in', 'Dither in', 'Fills in through 25, 50, 75% patterns', { enter: IN('dither-in', { dur: 0.6 }) }],
  ['stamp', 'Stamp', 'Slams down at a slight angle', { enter: IN('stamp', { dur: 0.35 }) }],
  ['wiggle', 'Wiggle', 'Hand-held jitter on hard frames', { on: ON('jitter') }],
  ['float', 'Float', 'A slow, endless bob', { on: ON('bob') }]
];
const STYLES = [['outline', 'Outline'], ['solid', 'Solid'], ['shadow', 'Hard shadow'], ['pixel', 'Pixel'], ['glyph', 'Glyph']] as const;

export function DrawTab({ c }: { c: StudioCtx }) {
  const { s, edit, setObj, sel, setSel, player } = c;
  const { go } = useApp();
  const [tool, setTool] = useState<ShapeKind | 'select' | 'text'>('select');
  const [menu, setMenu] = useState(false);
  const [grid8, setGrid8] = useState(true);
  const o = s.objects.find(x => x.id === sel);
  const shape = o?.kind.type === 'shape' ? o.kind : null;
  const snap = (v: number) => (grid8 ? Math.round(v / 8) * 8 : Math.round(v));
  const create = (kind: ShapeKind | 'text', r: [number, number, number, number]) => {
    const w = Math.max(40, snap(r[2] - r[0])), h = Math.max(kind === 'line' || kind === 'underline' || kind === 'arrow' ? 30 : 40, snap(r[3] - r[1]));
    const open = ['line', 'underline', 'check', 'cross', 'circle-it', 'bracket', 'elbow'].includes(kind);
    const n = kind === 'text'
      ? obj({ type: 'text', text: 'NEW VIDEO!', style: TEXT_STYLE({ font: 'archivo-black', size: Math.max(40, h * 0.7), color: '#0B0B0C' }) }, { name: 'Text', x: snap(r[0]), y: snap(r[1]) })
      : obj({ type: 'shape', style: SHAPE_STYLE({ kind, fill: open ? '' : '#F5C542', stroke: open ? '#F5C542' : '', stroke_w: open ? 10 : 0 }), w, h }, { name: GROUPS.flatMap(g => g[1]).find(x => x[0] === kind)?.[2] ?? 'Shape', x: snap(r[0]), y: snap(r[1]), enter: IN(open ? 'draw-on' : 'pop', { dur: 0.6 }) });
    Object.assign(n, { start: +player.t.toFixed(2), dur: 3.2, cue: 'manual', order: Math.max(-1, ...s.objects.map(x => x.order)) + 1 });
    edit(v => ({ ...v, objects: [...v.objects, n], dur: Math.max(v.dur, n.start + n.dur) }));
    setSel(n.id); setTool('select');
    // Show what you just made: park the playhead where it has fully come in.
    player.pause(); player.seek(n.start + n.enter.dur + 0.1);
  };
  const setStyle = (f: (st: ShapeStyle) => ShapeStyle, key = '') => o && setObj(o.id, x => (x.kind.type === 'shape' ? { ...x, kind: { ...x.kind, style: f(x.kind.style) } } : x), key);
  const setGeom = (p: { w?: number; h?: number }) => o && setObj(o.id, x => (x.kind.type === 'shape' ? { ...x, kind: { ...x.kind, ...p } } : x), 'geom');
  const styleOf = (): string => !shape ? '' : o!.as_ascii ? 'glyph' : shape.style.pixel > 0 ? 'pixel' : shape.style.shadow ? 'shadow' : shape.style.fill ? 'solid' : 'outline';
  const applyStyle = (k: string) => { if (!o || !shape) return; const col = shape.style.fill || shape.style.stroke || '#F5C542'; setObj(o.id, x => x.kind.type !== 'shape' ? x : ({ ...x, as_ascii: k === 'glyph', kind: { ...x.kind, style: { ...x.kind.style, fill: k === 'outline' ? '' : col, stroke: k === 'outline' ? col : '', stroke_w: k === 'outline' ? Math.max(6, x.kind.style.stroke_w) : x.kind.style.stroke_w, pixel: k === 'pixel' ? 15 : 0, shadow: k === 'shadow' || k === 'pixel' ? '#0B0B0C' : '' } } })); };

  return (
    <div className="st-draw">
      <nav className="tool-rail" aria-label="Tools">
        {([['select', '➤', 'Select (V)'], ['rect', '▭', 'Rectangle'], ['ellipse', '◯', 'Ellipse'], ['star', '☆', 'Star'], ['arrow', '↗', 'Arrow'], ['bubble', '💬', 'Bubble'], ['text', 'T', 'Text']] as const).map(([t, i, l]) => <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)} title={l} aria-label={l}>{i}</button>)}
      </nav>
      <aside className="shape-panel">
        <p className="caps">Shapes</p>
        <p className="sub">Click to add, or pick one and drag it out on the canvas. Every shape stays editable.</p>
        {GROUPS.map(([g, items]) => <div key={g}><h4>{g}</h4><div className="shape-grid">{items.map(([k, i, l]) => <button key={k} className={tool === k ? 'on' : ''} onClick={() => setTool(k)} onDoubleClick={() => create(k, [760, 400, 1120, 640])} draggable onDragStart={e => e.dataTransfer.setData('text/shape', k)}><b>{i}</b>{l}</button>)}</div></div>)}
      </aside>
      <main className="draw-center">
        <div className="draw-head">
          <span className="caps">Selected</span><b>{o?.name ?? 'Nothing'}</b>{shape && <span className="sub">· {shape.w}×{shape.h}</span>}
          <span className="grow" /><span className="sub">Snap to</span><button className={`chip-b${grid8 ? ' on' : ''}`} onClick={() => setGrid8(v => !v)}>8 px grid</button>
        </div>
        <div className="draw-stage" onDragOver={e => e.preventDefault()} onDrop={e => { const k = e.dataTransfer.getData('text/shape') as ShapeKind; if (!k) return; const r = (e.currentTarget as HTMLElement).querySelector('.sv')!.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * s.w, y = (e.clientY - r.top) / r.height * s.h; create(k, [x - 160, y - 100, x + 160, y + 100]); }}>
          {o && <div className="float-bar">
            <span className="fb-sw" style={{ background: shape?.style.fill || shape?.style.stroke || '#fff' }} />
            {shape && <span className="mono">{shape.style.stroke_w} px</span>}
            <button onClick={() => edit(v => ({ ...v, objects: v.objects.map(x => (x.id === o.id ? { ...x, order: Math.max(...v.objects.map(y => y.order)) + 1 } : x)) }))} title="Bring to front">⇡</button>
            <button onClick={() => edit(v => ({ ...v, objects: v.objects.map(x => (x.id === o.id ? { ...x, order: Math.min(...v.objects.map(y => y.order)) - 1 } : x)) }))} title="Send to back">⇣</button>
            <button className="mim" onClick={() => setMenu(m => !m)} aria-expanded={menu}>Make it move ▾</button>
            {menu && <div className="mim-menu"><p className="caps">Suggested for shapes</p>{SUGGEST.map(([id, n, b, p]) => <button key={id} onClick={() => { setObj(o.id, x => ({ ...x, ...p })); setMenu(false); player.seek(o.start); player.play(); }}><b>{n}</b><span>{b}</span></button>)}<button className="link" onClick={() => go({ m: 'studio', tab: 'library' })}>All shape animations →</button></div>}
          </div>}
          <Viewer c={c} tool={tool === 'select' ? 'select' : tool} checker onCreate={r => tool !== 'select' && create(tool, r)} />
        </div>
        {o && <div className="draw-clip"><span className="caps">{o.name}</span><div className="dc-bar"><span style={{ left: `${o.start / s.dur * 100}%`, width: `${((o.dur || s.dur - o.start) / s.dur) * 100}%` }}>In: {o.enter.id} · hold · {o.exit.id}</span></div><span className="mono">{o.start.toFixed(1)}–{(o.start + (o.dur || s.dur - o.start)).toFixed(1)} s</span></div>}
        <Transport c={c} />
      </main>
      <aside className="st-right">
        {shape && o ? <div className="insp">
          <header className="insp-h"><h2>{o.name}</h2><span className="caps">Shape</span></header>
          <p className="caps">Style</p>
          <div className="style-grid">{STYLES.map(([k, l]) => <button key={k} className={styleOf() === k ? 'on' : ''} onClick={() => applyStyle(k)}>{l}</button>)}</div>
          <p className="caps">Geometry</p>
          <div className="row2"><Num label="W" value={shape.w} onChange={w => setGeom({ w })} /><Num label="H" value={shape.h} onChange={h => setGeom({ h })} /></div>
          {['rounded', 'star', 'burst', 'bubble', 'progress'].includes(shape.style.kind) && <Slider label={shape.style.kind === 'rounded' ? 'Corner' : shape.style.kind === 'bubble' ? 'Tail' : shape.style.kind === 'progress' ? 'Value' : 'Points'} value={shape.style.param} min={shape.style.kind === 'star' || shape.style.kind === 'burst' ? 3 : 0} max={shape.style.kind === 'rounded' ? 120 : shape.style.kind === 'star' || shape.style.kind === 'burst' ? 24 : 1} step={shape.style.kind === 'star' || shape.style.kind === 'burst' ? 1 : 0.01} onChange={param => setStyle(st => ({ ...st, param }), 'param')} />}
          <p className="caps">Fill</p>
          <Swatches colors={FILLS} value={shape.style.fill || shape.style.stroke} onChange={col => setStyle(st => ({ ...st, fill: st.fill ? col : '', stroke: st.stroke ? col : st.fill ? st.stroke : col }))} />
          <p className="caps">Stroke</p>
          <Slider label="Width" value={shape.style.stroke_w} min={0} max={40} step={1} onChange={stroke_w => setStyle(st => ({ ...st, stroke_w, stroke: st.stroke || (stroke_w > 0 ? '#F4F4F5' : '') }), 'sw')} />
          <p className="caps">Draw-on</p>
          <Num label="Takes" value={o.enter.dur} step={0.1} suffix="s" onChange={dur => setObj(o.id, x => ({ ...x, enter: { ...x.enter, id: 'draw-on', dur } }), 'dd')} />
        </div> : <div className="insp empty"><h2>{o ? o.name : 'Draw something'}</h2><p>Pick a shape on the left, then drag it out on the canvas. Select a shape to style it here.</p></div>}
      </aside>
    </div>
  );
}
