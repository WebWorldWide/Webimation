// Step 2: Make it yours. A big live preview and a short list of plain-English settings. The deep
// stuff (timing curves, exits, motion feel, the Lab) sits behind one closed "More options".
import { useEffect, useMemo, useRef, useState } from 'react';
import { addToProject, Logo, Steps, useApp } from '../App';
import { bounds } from '../engine';
import { ANCHORS, anchorOf, place, safe, type Anchor } from '../layout';
import { ExportDialog } from './ExportDialog';
import { lastExport, EDITORS, SIZES } from '../bounce';
import { Field, Seg, Select, Stepper, Swatches } from '../ui/controls';
import { SceneView, usePlayer } from '../ui/SceneView';
import { textOf, withText, type Ease, type Obj, type Scene } from '../types';

const LOOKS = [['clean', 'Clean', 'archivo'], ['loud', 'Loud', 'archivo-black'], ['elegant', 'Elegant', 'instrument-serif'], ['retro', 'Retro pixel', 'press-start'], ['hand', 'Handwritten', 'permanent-marker']] as const;
const ENTER = [['wipe', 'Wipe'], ['slide', 'Slide'], ['pop', 'Pop'], ['typewriter', 'Type-on']] as const;
const SPEED: Record<string, { dur: number; ease: Ease; label: string }> = { calm: { dur: 0.9, ease: 'quart-in-out', label: 'Calm' }, normal: { dur: 0.5, ease: 'quart-out', label: 'Normal' }, snappy: { dur: 0.25, ease: 'cubic-out', label: 'Snappy' } };
const MOTIONS = [['none', 'Still'], ['bob', 'Bob'], ['float', 'Float'], ['pulse', 'Pulse'], ['wiggle', 'Wiggle'], ['spin3d', '3D spin'], ['shadow-lift', 'Lift'], ['drift-across', 'Drift'], ['blink', 'Blink']] as const;
const COLOURS = ['#FFFFFF', '#0B0B0C', '#1E68F0', '#E8433A', '#FF8A1F', '#F5C542', '#22D37F', '#8B5CF6'];

export function Make() {
  const { quick, byId, go, cat, project, toast } = useApp();
  const q = quick.value!;
  const s = q.scene;
  const item = byId.get(q.item);
  const [bg, setBg] = useState<'see' | 'dark' | 'light' | 'video'>('see');
  const [video, setVideo] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [more, setMore] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const player = usePlayer(s.dur, s.fps);
  const main = s.objects.find(o => o.kind.type === 'card') ?? s.objects.find(o => textOf(o) !== null) ?? s.objects[0];
  const card = main?.kind.type === 'card' ? main.kind : null;
  const cardDef = card ? cat.cards.find(c => c.id === card.template) : null;
  const full = s.objects.some(o => (o.kind.type === 'field' || o.kind.type === 'shape') && o.kind.w >= s.w * 0.9);

  const set = (f: (s: Scene) => Scene, key = '') => quick.set(v => v && { ...v, scene: f(v.scene) }, key);
  const setObj = (id: string, f: (o: Obj) => Obj, key = '') => set(sc => ({ ...sc, objects: sc.objects.map(o => (o.id === id ? f(o) : o)) }), key);
  const setAll = (f: (o: Obj) => Obj, key = '') => set(sc => ({ ...sc, objects: sc.objects.map(f) }), key);

  useEffect(() => { let live = true; if (main && !full) bounds(s).then(b => { if (live && b[main.id]) setAnchor(anchorOf(s, b[main.id])); }); return () => { live = false; }; }, [s, main, full]);
  const sa = safe(s);
  const inEnd = main ? main.start + main.enter.dur + (card ? 0.6 : 0) : 0, outStart = main ? (main.dur > 0 ? main.start + main.dur : s.dur) - main.exit.dur : s.dur;
  const speedOf = main ? (Object.entries(SPEED).find(([, v]) => Math.abs(v.dur - main.enter.dur) < 0.05)?.[0] ?? 'normal') : 'normal';
  const look = card ? card.look : main?.kind.type === 'text' ? (LOOKS.find(l => l[2] === (main.kind as { style: { font: string } }).style.font)?.[0] ?? '') : '';
  const last = lastExport();
  const texts = useMemo(() => s.objects.filter(o => textOf(o) !== null), [s.objects]);
  const vref = useRef<HTMLVideoElement>(null);
  useEffect(() => { const v = vref.current; if (v && video) { v.currentTime = player.t % (v.duration || 1e9); } }, [player.t, video]);

  return (
    <div className="quick">
      <header className="topbar">
        <div className="brand"><Logo /> Webimation</div>
        <Steps at={2} />
        <nav className="top-actions">
          <button className="link" onClick={quick.undo} disabled={!quick.canUndo}>Undo</button>
          <button className="btn btn-dark" onClick={() => { addToProject(project, s); go({ m: 'studio', tab: 'edit' }); toast('Added to your Studio project'); }}>Open in Studio</button>
        </nav>
      </header>
      <div className="make">
        <main className="make-stage">
          <div className="make-head">
            <button className="link" onClick={() => go({ m: 'pick' })}>← All animations</button>
            <h1>{item?.name ?? s.name}</h1>
            <Seg size="sm" value={bg} onChange={v => { if (v === 'video' && !video) document.getElementById('vid-in')?.click(); else setBg(v); }} options={[['see', 'See-through'], ['dark', 'Dark'], ['light', 'Light'], ['video', '+ Try over my video']]} />
            <input id="vid-in" type="file" accept="video/*,image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) { setVideo(URL.createObjectURL(f)); setBg('video'); } }} />
          </div>
          <div className={`stage-wrap bg-${bg}`} style={{ maxWidth: `calc((100vh - 290px) * ${s.w / s.h})` }}>
            {bg === 'video' && video && <video ref={vref} src={video} muted playsInline className="under" />}
            <SceneView scene={s} t={player.t} checker={bg === 'see' ? 'light' : false}>
              <rect x={sa.x0} y={sa.y0} width={sa.x1 - sa.x0} height={sa.y1 - sa.y0} className="safe" />
            </SceneView>
          </div>
          <div className="transport">
            <button className="play" onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'}>{player.playing ? '❚❚' : '▶'}</button>
            <div className="phase" onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); player.pause(); player.seek((e.clientX - r.left) / r.width * s.dur); }}>
              <span className="ph in" style={{ width: `${inEnd / s.dur * 100}%` }}>Comes in</span>
              <span className="ph on" style={{ width: `${Math.max(0, outStart - inEnd) / s.dur * 100}%` }}>On screen</span>
              <span className="ph out" style={{ width: `${Math.max(0, s.dur - outStart) / s.dur * 100}%` }}>Goes out</span>
              <span className="head" style={{ left: `${player.t / s.dur * 100}%` }} />
            </div>
            <span className="mono">{s.dur.toFixed(1)} s</span>
          </div>
          <p className="note">The dashed line is the safe area: keep words inside it and they won't get cut off on phones or TVs.</p>
        </main>

        <aside className="make-panel">
          {(cardDef || texts.length > 0) && (
            <section className="sec"><h3>Words</h3>
              {cardDef && main ? cardDef.fields.map(([k, label, d]) => (
                <Field key={k} label={label} value={card!.fields[k] ?? d} onChange={v => setObj(main.id, o => o.kind.type === 'card' ? { ...o, kind: { ...o.kind, fields: { ...o.kind.fields, [k]: v } } } : o, `w-${k}`)} />
              )) : texts.map(o => <Field key={o.id} label={o.name} value={textOf(o)!} multiline={o.kind.type === 'ascii'} onChange={v => setObj(o.id, x => withText(x, v), `w-${o.id}`)} />)}
            </section>
          )}

          <section className="sec"><h3>Colours</h3>
            {card ? (
              <div className="colorsets">
                {cat.colorSets.map(c => <button key={c.id} className={`cs${card.colors === c.id ? ' on' : ''}`} onClick={() => setObj(main!.id, o => o.kind.type === 'card' ? { ...o, kind: { ...o.kind, colors: c.id } } : o)} aria-label={`Colour set ${c.id}`}><span style={{ background: c.plate }} /><span style={{ background: c.accent }} /></button>)}
              </div>
            ) : s.objects.some(o => o.kind.type === 'field') ? (
              <div className="colorsets">
                {cat.palettes.map(p => <button key={p.id} title={p.name} className={`cs pal${s.objects.some(o => o.kind.type === 'field' && o.kind.style.palette.id === p.id) ? ' on' : ''}`} onClick={() => setAll(o => o.kind.type === 'field' ? { ...o, kind: { ...o.kind, style: { ...o.kind.style, palette: p } } } : o)}>{p.bands.map(b => <span key={b.at} style={{ background: b.color }} />)}</button>)}
              </div>
            ) : (
              <Swatches colors={COLOURS} value={mainColor(main) ?? '#FFFFFF'} onChange={c => setAll(o => recolor(o, c), 'col')} />
            )}
          </section>

          {(card || main?.kind.type === 'text') && (
            <section className="sec"><h3>Style</h3>
              <div className="looks">
                {LOOKS.map(([id, label, font]) => <button key={id} className={`look${look === id || look === font ? ' on' : ''}`} onClick={() => setAll(o => o.kind.type === 'card' ? { ...o, kind: { ...o.kind, look: id } } : o.kind.type === 'text' ? { ...o, kind: { ...o.kind, style: { ...o.kind.style, font } } } : o)}><span className="aa" style={{ fontFamily: `'w-${font}'` }}>Aa</span>{label}</button>)}
              </div>
            </section>
          )}

          {main && !full && (
            <section className="sec"><h3>Animation</h3>
              <div className="sub">Comes in with a</div>
              <Seg value={ENTER.some(e => e[0] === main.enter.id) ? main.enter.id : ''} onChange={id => setObj(main.id, o => ({ ...o, enter: { ...o.enter, id } }))} options={ENTER} />
              <div className="sub">Speed</div>
              <Seg value={speedOf} onChange={v => setObj(main.id, o => ({ ...o, enter: { ...o.enter, dur: SPEED[v].dur, ease: SPEED[v].ease }, exit: { ...o.exit, dur: Math.min(0.5, SPEED[v].dur) } }))} options={Object.entries(SPEED).map(([k, v]) => [k, v.label] as const)} />
              {(item?.loop || main.on.id !== 'none' || main.kind.type === 'sprite') && <>
                <div className="sub">While on screen</div>
                <Seg size="sm" wrap value={main.on.id} onChange={id => setObj(main.id, o => ({ ...o, on: { ...o.on, id } }))} options={MOTIONS} />
              </>}
            </section>
          )}

          {main && !full && (
            <section className="sec"><h3>Where on screen</h3>
              <div className="nine" role="radiogroup" aria-label="Where on screen">
                {ANCHORS.map(a => <button key={a} role="radio" aria-checked={anchor === a} className={anchor === a ? 'on' : ''} aria-label={a} onClick={async () => { setAnchor(a); const ids = s.objects.filter(o => !((o.kind.type === 'field' || o.kind.type === 'shape') && o.kind.w >= s.w * 0.9)).map(o => o.id); const ns = await place(s, ids, a); set(() => ns); }}><span /></button>)}
              </div>
            </section>
          )}

          <section className="sec"><h3>How long</h3>
            <Stepper label="seconds" value={`${+s.dur.toFixed(1)} sec`} onDec={() => set(sc => resize(sc, Math.max(1, sc.dur - 1)))} onInc={() => set(sc => resize(sc, Math.min(60, sc.dur + 1)))} />
          </section>

          <details className="sec more" open={more} onToggle={e => setMore((e.target as HTMLDetailsElement).open)}>
            <summary><h3>More options</h3><span className="sub">Fonts, timing, exits, Lab</span></summary>
            {main && <>
              <div className="sub">Goes out with</div>
              <Select label="Exit" value={main.exit.id} onChange={id => setObj(main.id, o => ({ ...o, exit: { ...o.exit, id } }))} options={cat.effects.filter(e => e.slot === 'out').map(e => [e.id, e.name] as const)} />
              <div className="sub">Comes in with (every option)</div>
              <Select label="Entrance" value={main.enter.id} onChange={id => setObj(main.id, o => ({ ...o, enter: { ...o.enter, id } }))} options={cat.effects.filter(e => e.slot === 'in').map(e => [e.id, e.name] as const)} />
              <div className="sub">Timing curve</div>
              <Select<Ease> label="Timing curve" value={main.enter.ease} onChange={ease => setObj(main.id, o => ({ ...o, enter: { ...o.enter, ease } }))} options={[['quart-out', 'Smooth stop'], ['quart-in-out', 'Smooth both ends'], ['back-out', 'Overshoot'], ['bounce-out', 'Bounce'], ['elastic-out', 'Springy'], ['linear', 'Steady'], ['steps4', '4 hard steps'], ['steps8', '8 hard steps']]} />
              {main.kind.type === 'text' && <>
                <div className="sub">Font</div>
                <Select label="Font" value={main.kind.style.font} onChange={font => setObj(main.id, o => o.kind.type === 'text' ? { ...o, kind: { ...o.kind, style: { ...o.kind.style, font } } } : o)} options={cat.fonts.map(f => [f.id, f.name] as const)} />
              </>}
            </>}
            <div className="sub">Motion feel</div>
            <Seg value={s.fps} onChange={fps => set(sc => ({ ...sc, fps }))} options={[[30, 'Smooth'], [12, '12 fps pixel'], [6, '6 fps chunky']]} />
            <div className="row gap">
              <button className="btn" onClick={() => { addToProject(project, s); go({ m: 'lab' }); }}>Open in Animation Lab</button>
              <button className="btn" onClick={() => { addToProject(project, s); go({ m: 'studio', tab: 'edit' }); }}>Open in Studio</button>
            </div>
          </details>

          <button className="btn-primary big" onClick={() => setExporting(true)}>Export clip →</button>
          {last && <button className="link small" onClick={() => setExporting(true)}>Export like last time: {EDITORS[last.editor].name}, {SIZES[last.size].label}, {last.fps} fps</button>}
        </aside>
      </div>
      {exporting && <ExportDialog scene={s} name={clipName(item?.name ?? s.name, s)} onClose={() => setExporting(false)} />}
    </div>
  );
}

export function clipName(base: string, s: Scene) {
  const o = s.objects.find(x => x.kind.type === 'card') ?? s.objects.find(x => textOf(x));
  const words = o?.kind.type === 'card' ? Object.values(o.kind.fields).find(Boolean) : o ? textOf(o) : null;
  return words && words.trim() && words.length < 40 ? `${base} – ${words.trim()}` : base;
}

/** Change the length: everything that was on to the end stays on to the end. */
function resize(s: Scene, dur: number): Scene {
  return { ...s, dur, objects: s.objects.map(o => (o.dur > 0 && o.start + o.dur >= s.dur - 0.01 ? { ...o, dur: Math.max(0.2, dur - o.start) } : o)) };
}
function mainColor(o: Obj | undefined): string | null {
  if (!o) return null;
  const k = o.kind;
  return k.type === 'text' ? k.style.color : k.type === 'pixel-text' || k.type === 'ascii' || k.type === 'ascii-banner' ? k.color : k.type === 'shape' ? k.style.fill || k.style.stroke : k.type === 'sprite' ? k.tint || null : null;
}
function recolor(o: Obj, c: string): Obj {
  const k = o.kind;
  if (k.type === 'text') return { ...o, kind: { ...k, style: k.style.plate ? { ...k.style, plate: c, color: c === '#FFFFFF' || c === '#F5C542' || c === '#22D37F' ? '#0B0B0C' : '#FFFFFF' } : { ...k.style, color: c } } };
  if (k.type === 'pixel-text' || k.type === 'ascii' || k.type === 'ascii-banner') return { ...o, kind: { ...k, color: c } };
  if (k.type === 'shape') return { ...o, kind: { ...k, style: { ...k.style, fill: k.style.fill ? c : '', stroke: k.style.stroke ? c : '' } } };
  if (k.type === 'sprite') return { ...o, kind: { ...k, tint: c } };
  return o;
}
