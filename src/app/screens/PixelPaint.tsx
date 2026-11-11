// Pixel Paint: MS Paint for sprites. Draw on a grid, add flipbook frames, and see it move straight away.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addToProject, Logo, useApp } from '../App';
import { query } from '../engine';
import { saveAs } from '../bounce';
import { store, stored, useHistory } from '../history';
import { ExportDialog } from './ExportDialog';
import { Seg } from '../ui/controls';
import { SceneView, usePlayer } from '../ui/SceneView';
import { IN, obj, ON, OUT, scene, type Scene, type Sprite } from '../types';

type Tool = 'pencil' | 'line' | 'box' | 'filled' | 'circle' | 'fill' | 'eraser' | 'picker';
interface Doc { name: string; w: number; h: number; frames: number[][]; palette: string[]; fps: number }
const PAL = ['#0E2960', '#1E68F0', '#1450C8', '#3D82FF', '#A8C8F0', '#FFFFFF', '#EEF3FB', '#8FA3C8', '#0B0B0C', '#5A72B0', '#EC5A2B', '#FF8A1F', '#F5C542', '#3EC25D', '#28B083', '#1E6D50', '#F0507A', '#D94A3A', '#8B5CF6', '#38B6FF'];
const SIZES: [number, number][] = [[16, 16], [32, 18], [32, 32], [48, 27], [64, 36]];
const TOOLS: [Tool, string, string][] = [['pencil', '✎', 'Pencil'], ['line', '╱', 'Line'], ['box', '▢', 'Box'], ['filled', '■', 'Filled'], ['circle', '○', 'Circle'], ['fill', '◧', 'Fill'], ['eraser', '⌫', 'Eraser'], ['picker', '⊙', 'Picker']];
const MOTIONS = [['none', '·', 'Still'], ['bob', '↕', 'Bob'], ['float', '∿', 'Float'], ['pulse', '◇', 'Pulse'], ['wiggle', '≀', 'Wiggle'], ['spin3d', '⟳', '3D spin'], ['shadow-lift', '▟', 'Lift'], ['drift-across', '☁', 'Sky drift'], ['sparkle', '✦', 'Sparkle']] as const;
const KEY = 'webimation.paint.v1';

const blank = (w: number, h: number) => new Array(w * h).fill(0);
function fromSprite(sp: Sprite, name: string): Doc {
  const frames = sp.frames.map(f => { const a = blank(sp.w, sp.h); f.split('\n').forEach((row, y) => [...row].forEach((ch, x) => { if (x < sp.w && y < sp.h) a[y * sp.w + x] = /[1-9]/.test(ch) ? +ch : /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : 0; })); return a; });
  return { name, w: sp.w, h: sp.h, frames, palette: [...sp.palette], fps: sp.fps || 4 };
}
export function toSprite(d: Doc): Sprite {
  const ch = (i: number) => (i <= 0 ? '0' : i < 10 ? String(i) : String.fromCharCode(55 + i));
  return { w: d.w, h: d.h, palette: d.palette, fps: d.fps, frames: d.frames.map(f => Array.from({ length: d.h }, (_, y) => f.slice(y * d.w, y * d.w + d.w).map(ch).join('')).join('\n')) };
}
/** A 64×36 sky with three frames of drifting clouds: lines up with the Lab's Chunky grid. */
function skyScene(): Doc {
  const w = 64, h = 36, pal = ['#1E68F0', '#FFFFFF', '#A8C8F0', '#1450C8'];
  const cloud = ['0002220002220', '0022112202211', '0211111211112', '2111111111112', '0222222222220'];
  const frames = [0, 1, 2].map(f => {
    const a: number[] = new Array(w * h).fill(0).map((_, i) => (Math.floor(i / w) < 6 ? 4 : 1));
    for (const [cx, cy] of [[4 + f * 2, 6], [34 + f, 16], [14 + f * 3, 26]]) cloud.forEach((r, y) => [...r].forEach((c, x) => { const px = (cx + x) % w, py = cy + y; if (c !== '0' && py < h) a[py * w + px] = c === '1' ? 2 : 3; }));
    return a;
  });
  return { name: 'Sky scene', w, h, frames, palette: pal, fps: 4 };
}

export function PixelPaint() {
  const { cat, go, project, toast } = useApp();
  const doc = useHistory<Doc>(() => stored(KEY, () => fromSprite(cat.starters[0].sprite, 'Pixel cloud')), store(KEY));
  const d = doc.value;
  const [frame, setFrame] = useState(0);
  const [tool, setTool] = useState<Tool>('pencil');
  const [brush, setBrush] = useState(1);
  const [c1, setC1] = useState(1), [c2, setC2] = useState(0);
  const [mirrorX, setMirrorX] = useState(false), [mirrorY, setMirrorY] = useState(false);
  const [lines, setLines] = useState(true), [guides, setGuides] = useState(true), [onion, setOnion] = useState(true);
  const [cursor, setCursor] = useState<[number, number]>([0, 0]);
  const [preview, setPreview] = useState<number[] | null>(null);
  const [motion, setMotion] = useState('bob');
  const [behind, setBehind] = useState<'sky' | 'clear' | 'ink'>('sky');
  const [showAs, setShowAs] = useState<'pixels' | 'ascii'>('pixels');
  const [exporting, setExporting] = useState(false);
  const fr = Math.min(frame, d.frames.length - 1);
  const cur = preview ?? d.frames[fr];
  const cv = useRef<HTMLCanvasElement>(null);
  const start = useRef<[number, number] | null>(null);
  const setFrames = (f: (fs: number[][]) => number[][], key = '') => doc.set(v => ({ ...v, frames: f(v.frames) }), key);

  // ── drawing primitives (all mirror-aware) ──
  const plot = useCallback((a: number[], x: number, y: number, v: number) => {
    const pts: [number, number][] = [];
    for (let dy = 0; dy < brush; dy++) for (let dx = 0; dx < brush; dx++) pts.push([x + dx, y + dy]);
    for (const [px, py] of pts) {
      const all: [number, number][] = [[px, py]];
      if (mirrorX) all.push([d.w - 1 - px, py]);
      if (mirrorY) all.push([px, d.h - 1 - py]);
      if (mirrorX && mirrorY) all.push([d.w - 1 - px, d.h - 1 - py]);
      for (const [qx, qy] of all) if (qx >= 0 && qy >= 0 && qx < d.w && qy < d.h) a[qy * d.w + qx] = v;
    }
  }, [brush, mirrorX, mirrorY, d.w, d.h]);
  const line = (a: number[], x0: number, y0: number, x1: number, y1: number, v: number) => {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
    for (;;) { plot(a, x0, y0, v); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  };
  const shape = (base: number[], t: Tool, [x0, y0]: [number, number], [x1, y1]: [number, number], v: number) => {
    const a = [...base];
    const [l, r, tp, b] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
    if (t === 'line') line(a, x0, y0, x1, y1, v);
    else if (t === 'box') { line(a, l, tp, r, tp, v); line(a, l, b, r, b, v); line(a, l, tp, l, b, v); line(a, r, tp, r, b, v); }
    else if (t === 'filled') { for (let y = tp; y <= b; y++) for (let x = l; x <= r; x++) plot(a, x, y, v); }
    else if (t === 'circle') {
      const cx = (l + r) / 2, cy = (tp + b) / 2, rx = Math.max(0.5, (r - l) / 2), ry = Math.max(0.5, (b - tp) / 2);
      for (let y = tp; y <= b; y++) for (let x = l; x <= r; x++) { const q = ((x - cx) / (rx + 0.5)) ** 2 + ((y - cy) / (ry + 0.5)) ** 2, q2 = ((x - cx) / Math.max(0.01, rx - 0.5)) ** 2 + ((y - cy) / Math.max(0.01, ry - 0.5)) ** 2; if (q <= 1 && (q2 >= 1 || rx < 1.5 || ry < 1.5)) plot(a, x, y, v); }
    }
    return a;
  };
  const flood = (base: number[], x: number, y: number, v: number) => {
    const a = [...base], target = a[y * d.w + x]; if (target === v) return a;
    const st = [[x, y]];
    while (st.length) { const [px, py] = st.pop()!; if (px < 0 || py < 0 || px >= d.w || py >= d.h || a[py * d.w + px] !== target) continue; a[py * d.w + px] = v; st.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]); }
    return a;
  };
  const colourFor = (e: { button: number }) => (tool === 'eraser' ? 0 : e.button === 2 ? c2 : c1);
  const cellAt = (e: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * d.w), Math.floor((e.clientY - r.top) / r.height * d.h)] as [number, number]; };
  const down = (e: React.PointerEvent) => {
    e.preventDefault(); (e.target as Element).setPointerCapture(e.pointerId);
    const p = cellAt(e); setCursor(p); start.current = p;
    const v = colourFor(e);
    if (tool === 'picker') { const i = d.frames[fr][p[1] * d.w + p[0]]; if (e.button === 2) setC2(i); else setC1(i); return; }
    if (tool === 'fill') { setFrames(fs => fs.map((f, i) => (i === fr ? flood(f, p[0], p[1], v) : f))); return; }
    if (tool === 'pencil' || tool === 'eraser') { const a = [...d.frames[fr]]; plot(a, p[0], p[1], v); setPreview(a); }
  };
  const moveP = (e: React.PointerEvent) => {
    const p = cellAt(e); setCursor(p);
    if (!start.current || !(e.buttons & 3)) return;
    const v = colourFor({ button: e.buttons & 2 ? 2 : 0 });
    if (tool === 'pencil' || tool === 'eraser') { const a = [...(preview ?? d.frames[fr])]; line(a, start.current[0], start.current[1], p[0], p[1], v); start.current = p; setPreview(a); }
    else if (['line', 'box', 'filled', 'circle'].includes(tool)) setPreview(shape(d.frames[fr], tool, start.current, p, v));
  };
  const up = () => { if (preview) { const a = preview; setFrames(fs => fs.map((f, i) => (i === fr ? a : f))); } setPreview(null); start.current = null; };

  // ── canvas ──
  useEffect(() => {
    const c = cv.current; if (!c) return;
    const k = Math.max(4, Math.floor(Math.min(780 / d.w, 470 / d.h)));
    c.width = d.w * k; c.height = d.h * k;
    const g = c.getContext('2d')!;
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) { g.fillStyle = (x + y) % 2 ? '#E9ECF0' : '#FFFFFF'; g.fillRect(x * k, y * k, k, k); }
    if (onion && fr > 0) { g.globalAlpha = 0.25; d.frames[fr - 1].forEach((v, i) => { if (v) { g.fillStyle = d.palette[v - 1]; g.fillRect((i % d.w) * k, Math.floor(i / d.w) * k, k, k); } }); g.globalAlpha = 1; }
    cur.forEach((v, i) => { if (v) { g.fillStyle = d.palette[v - 1] ?? '#f0f'; g.fillRect((i % d.w) * k, Math.floor(i / d.w) * k, k, k); } });
    if (lines) { g.strokeStyle = 'rgba(17,19,22,.1)'; g.lineWidth = 1; g.beginPath(); for (let x = 1; x < d.w; x++) { g.moveTo(x * k + 0.5, 0); g.lineTo(x * k + 0.5, c.height); } for (let y = 1; y < d.h; y++) { g.moveTo(0, y * k + 0.5); g.lineTo(c.width, y * k + 0.5); } g.stroke(); }
    if (guides) { g.strokeStyle = 'rgba(30,104,240,.55)'; g.beginPath(); for (let x = 8; x < d.w; x += 8) { g.moveTo(x * k + 0.5, 0); g.lineTo(x * k + 0.5, c.height); } for (let y = 8; y < d.h; y += 8) { g.moveTo(0, y * k + 0.5); g.lineTo(c.width, y * k + 0.5); } g.stroke(); }
    g.strokeStyle = '#1E68F0'; g.lineWidth = 2; g.strokeRect(cursor[0] * k + 1, cursor[1] * k + 1, k * brush - 2, k * brush - 2);
  }, [cur, d, fr, lines, guides, onion, cursor, brush]);

  // ── keyboard drawing: arrows move, Space paints ──
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) doc.redo(); else doc.undo(); return; }
      const mv = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
      if (mv) { e.preventDefault(); setCursor(([x, y]) => [Math.max(0, Math.min(d.w - 1, x + mv[0])), Math.max(0, Math.min(d.h - 1, y + mv[1]))]); return; }
      if (e.key === ' ') { e.preventDefault(); setFrames(fs => fs.map((f, i) => { if (i !== fr) return f; const a = [...f]; plot(a, cursor[0], cursor[1], tool === 'eraser' ? 0 : c1); return a; }), 'kbd'); }
      const t = ({ p: 'pencil', l: 'line', b: 'box', f: 'fill', e: 'eraser', i: 'picker', o: 'circle' } as Record<string, Tool>)[e.key];
      if (t && !mod) setTool(t);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const pick = (hex: string, second = false) => {
    let i = d.palette.findIndex(p => p.toUpperCase() === hex.toUpperCase()) + 1;
    if (!i) { if (d.palette.length >= 35) { toast('This sprite already uses 35 colours'); return; } doc.set(v => ({ ...v, palette: [...v.palette, hex] })); i = d.palette.length + 1; }
    if (second) setC2(i); else setC1(i);
  };
  const shift = (dx: number, dy: number) => setFrames(fs => fs.map((f, i) => (i !== fr ? f : f.map((_, j) => { const x = (j % d.w) - dx, y = Math.floor(j / d.w) - dy; return x >= 0 && y >= 0 && x < d.w && y < d.h ? f[y * d.w + x] : 0; }))));
  const flip = () => setFrames(fs => fs.map((f, i) => (i !== fr ? f : f.map((_, j) => f[Math.floor(j / d.w) * d.w + (d.w - 1 - (j % d.w))]))));
  const resize = (w: number, h: number) => doc.set(v => ({ ...v, w, h, frames: v.frames.map(f => Array.from({ length: w * h }, (_, j) => { const x = j % w, y = Math.floor(j / w); return x < v.w && y < v.h ? f[y * v.w + x] : 0; })) }));
  const sprite = useMemo(() => toSprite(d), [d]);
  const moveScene: Scene = useMemo(() => {
    const px = Math.max(4, Math.floor(Math.min(1400 / d.w, 700 / d.h)));
    return scene({ name: d.name, fps: 12, dur: motion === 'drift-across' ? 8 : 4, bg: behind === 'sky' ? { kind: 'sky', color: '#1E68F0', color2: '#1450C8' } : behind === 'ink' ? { kind: 'solid', color: '#0E2960', color2: '#0E2960' } : { kind: 'clear', color: '', color2: '' },
      objects: [obj({ type: 'sprite', sprite, px, tint: '' }, { name: d.name, x: Math.round((1920 - d.w * px) / 2), y: Math.round((1080 - d.h * px) / 2), enter: IN('none'), on: ON(motion), exit: OUT('stay'), as_ascii: showAs === 'ascii', ascii_chars: ' .:-=+*#%@' })] });
  }, [sprite, d.w, d.h, d.name, motion, behind, showAs]);
  const player = usePlayer(moveScene.dur, 12);

  return (
    <div className="paint light">
      <header className="lab-bar">
        <div className="brand"><Logo /> Pixel Paint</div>
        <input className="title-in" value={d.name} onChange={e => doc.set(v => ({ ...v, name: e.target.value }), 'name')} aria-label="Sprite name" />
        <span className="sub-w">{d.w} × {d.h}</span>
        <button className="ghost" onClick={doc.undo} disabled={!doc.canUndo}>↶ Undo</button>
        <button className="ghost" onClick={doc.redo} disabled={!doc.canRedo}>↷ Redo</button>
        <span className="grow" />
        <button className="ghost" onClick={() => go({ m: 'lab' })}>Animation Lab</button>
        <button className="btn-white" onClick={() => { addToProject(project, moveScene); go({ m: 'lab' }); toast(`${d.name} added to your animation`); }}>Use in my animation</button>
      </header>
      <div className="ribbon paint-ribbon">
        <div className="group">{TOOLS.map(([t, ico, l]) => <button key={t} className={`tool${tool === t ? ' on' : ''}`} onClick={() => setTool(t)} title={`${l} (${t[0].toUpperCase()})`}><b>{ico}</b>{l}</button>)}<span className="glabel">Tools</span></div>
        <div className="group">{[1, 2, 3].map(b => <button key={b} className={`tool${brush === b ? ' on' : ''}`} onClick={() => setBrush(b)}><i className="dot" style={{ width: 4 + b * 4, height: 4 + b * 4 }} />{b} px</button>)}<span className="glabel">Brush</span></div>
        <div className="group col">
          <div className="row"><button className={`tg${mirrorX ? ' on' : ''}`} onClick={() => setMirrorX(m => !m)}>Mirror ⇆</button><button className={`tg${mirrorY ? ' on' : ''}`} onClick={() => setMirrorY(m => !m)}>Mirror ⇅</button></div>
          <div className="row"><button className={`tg${lines ? ' on' : ''}`} onClick={() => setLines(v => !v)}>Grid lines</button><button className={`tg${guides ? ' on' : ''}`} onClick={() => setGuides(v => !v)}>8-pixel guides</button></div>
          <div className="row"><button className={`tg${onion ? ' on' : ''}`} onClick={() => setOnion(v => !v)}>See last frame</button></div>
          <span className="glabel">Grid & helpers</span>
        </div>
        <div className="group"><div className="pad"><span /><button onClick={() => shift(0, -1)} aria-label="Move up">↑</button><span /><button onClick={() => shift(-1, 0)} aria-label="Move left">←</button><button onClick={flip} aria-label="Flip">⇆</button><button onClick={() => shift(1, 0)} aria-label="Move right">→</button><span /><button onClick={() => shift(0, 1)} aria-label="Move down">↓</button><span /></div><span className="glabel">Move · flip</span></div>
        <div className="group">
          <div className="cc"><span className="c1" style={{ background: c1 ? d.palette[c1 - 1] : 'transparent' }} title="Colour 1" /><span className="c2" style={{ background: c2 ? d.palette[c2 - 1] : 'transparent' }} title="Colour 2" /></div>
          <button className="btn sm" onClick={() => { setC1(c2); setC2(c1); }}>⇄ Swap</button>
          <div className="pal">{PAL.map(c => <button key={c} style={{ background: c }} onClick={() => pick(c)} onContextMenu={e => { e.preventDefault(); pick(c, true); }} aria-label={`Colour ${c}`} className={d.palette[c1 - 1]?.toUpperCase() === c ? 'on' : ''} />)}<label className="any">+<input type="color" onChange={e => pick(e.target.value.toUpperCase())} /></label></div>
          <span className="glabel">Colour 1 paints (left click) · Colour 2 is your spare (right click)</span>
        </div>
      </div>
      <div className="paint-body">
        <aside className="paint-left">
          <h3>Start from</h3>
          {cat.starters.slice(0, 1).map(st => <button key={st.id} className="starter" onClick={() => { doc.set(() => fromSprite(st.sprite, st.name)); setFrame(0); }}><b>{st.name}</b><span>{st.note}</span></button>)}
          <button className="starter" onClick={() => { doc.set(() => skyScene()); setFrame(0); }}><b>Sky scene</b><span>64 × 36 · fills the screen</span></button>
          {cat.starters.slice(4).map(st => <button key={st.id} className="starter" onClick={() => { doc.set(() => fromSprite(st.sprite, st.name)); setFrame(0); }}><b>{st.name}</b><span>{st.note}</span></button>)}
          <button className="starter" onClick={() => { doc.set(v => ({ ...v, name: 'Blank', frames: [blank(v.w, v.h)], palette: PAL.slice(0, 8) })); setFrame(0); }}><b>Blank</b><span>Draw anything</span></button>
          <h3>Grid size</h3>
          <p className="sub">64 × 36 matches the Lab's Chunky grid, so a full scene lines up pixel for pixel.</p>
          <div className="sizes">{SIZES.map(([w, h]) => <button key={`${w}x${h}`} className={d.w === w && d.h === h ? 'on' : ''} onClick={() => resize(w, h)}>{w} × {h}</button>)}</div>
        </aside>
        <main className="paint-center">
          <div className="center-head"><span>Click or drag to draw. Right-click paints Colour 2. Arrow keys + Space draw from the keyboard.</span><span className="mono">x {cursor[0] + 1} y {cursor[1] + 1}</span></div>
          <canvas ref={cv} className="paint-cv" onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up} onContextMenu={e => e.preventDefault()} />
          <div className="frames-head"><b>Frames</b><span className="sub">a flipbook: each frame is a drawing</span><span className="grow" />
            <button className="btn sm" onClick={() => { setFrames(fs => [...fs.slice(0, fr + 1), [...fs[fr]], ...fs.slice(fr + 1)]); setFrame(fr + 1); }}>+ Copy this frame</button>
            <button className="btn sm" onClick={() => { setFrames(fs => [...fs.slice(0, fr + 1), blank(d.w, d.h), ...fs.slice(fr + 1)]); setFrame(fr + 1); }}>+ Blank frame</button>
            <button className="btn sm" disabled={d.frames.length < 2} onClick={() => { setFrames(fs => fs.filter((_, i) => i !== fr)); setFrame(Math.max(0, fr - 1)); }}>Remove</button>
          </div>
          <div className="frames">{d.frames.map((f, i) => <button key={i} className={i === fr ? 'on' : ''} onClick={() => setFrame(i)}><span className="fn">{i + 1}</span><MiniFrame f={f} d={d} /></button>)}</div>
        </main>
        <aside className="paint-right">
          <header><h3>Make it move</h3><span className="mono hi">{d.frames.length} frame{d.frames.length > 1 ? 's' : ''} · {d.fps} fps</span></header>
          <SceneView scene={moveScene} t={player.t} checker={behind === 'clear' ? 'light' : false} pixelated className="move-view" />
          <div className="kv"><span>Show as</span><Seg size="sm" value={showAs} onChange={setShowAs} options={[['pixels', 'Pixels'], ['ascii', 'ASCII']]} /></div>
          <div className="kv"><span>Flipbook</span><Seg size="sm" value={d.fps} onChange={fps => doc.set(v => ({ ...v, fps }))} options={[[2, 'Slow'], [4, 'Normal'], [8, 'Fast'], [12, 'Very fast']]} /></div>
          <h4>Motion</h4>
          <div className="motions">{MOTIONS.map(([id, ico, l]) => <button key={id} className={motion === id ? 'on' : ''} onClick={() => setMotion(id)}><b>{ico}</b>{l}</button>)}</div>
          <div className="kv"><span>Behind it</span><Seg size="sm" value={behind} onChange={setBehind} options={[['sky', 'Sky'], ['clear', 'See-through'], ['ink', 'Ink']]} /></div>
          <span className="grow" />
          <button className="btn-primary big" onClick={() => { addToProject(project, moveScene); go({ m: 'lab' }); }}>Use in my animation</button>
          <div className="row three">
            <button className="btn" onClick={() => setExporting(true)}>Video</button>
            <button className="btn" onClick={async () => { const png = await sheet(d); if (png) await saveAs(`${d.name} sheet.png`, png, 'png'); }}>Sprite sheet</button>
            <button className="btn" onClick={async () => { const parts = await Promise.all(d.frames.map((_, i) => query<{ text: string }>({ op: 'ascii', sprite, frame: i, ramp: ' .:-=+*#%@' }))); await saveAs(`${d.name}.txt`, parts.map(p => p.text).join('\n'), 'txt'); }}>ASCII .txt</button>
          </div>
        </aside>
      </div>
      {exporting && <ExportDialog scene={moveScene} name={d.name} onClose={() => setExporting(false)} />}
    </div>
  );
}

function MiniFrame({ f, d }: { f: number[]; d: Doc }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current; if (!c) return; c.width = d.w; c.height = d.h; const g = c.getContext('2d')!; g.clearRect(0, 0, d.w, d.h); f.forEach((v, i) => { if (v) { g.fillStyle = d.palette[v - 1]; g.fillRect(i % d.w, Math.floor(i / d.w), 1, 1); } }); }, [f, d.w, d.h, d.palette]);
  return <canvas ref={ref} style={{ imageRendering: 'pixelated' }} />;
}

/** All frames side by side, 8× scale, as PNG bytes. */
async function sheet(d: Doc): Promise<Uint8Array<ArrayBuffer> | null> {
  const k = 8, c = document.createElement('canvas');
  c.width = d.w * k * d.frames.length; c.height = d.h * k;
  const g = c.getContext('2d')!;
  d.frames.forEach((f, n) => f.forEach((v, i) => { if (v) { g.fillStyle = d.palette[v - 1]; g.fillRect(n * d.w * k + (i % d.w) * k, Math.floor(i / d.w) * k, k, k); } }));
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
