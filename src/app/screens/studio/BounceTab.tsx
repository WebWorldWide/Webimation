// Bounce: render transparent clips your editor understands, and keep working while it runs.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../App';
import { isDesktop } from '../../desktop';
import { bounce, defaultDir, dragIcon, EDITORS, engineInfo, FORMATS, join, pickFolder, reveal, safeName, SIZES, startDrag, writeTimeline, type Editor, type Format, type Progress, type SizeId } from '../../bounce';
import type { Scene } from '../../types';
import { Seg } from '../../ui/controls';
import type { StudioCtx } from '../Studio';

type What = 'selection' | 'layers' | 'whole' | 'timeline' | 'range';
interface Job { id: number; name: string; file: string; scene: Scene; from: number; to: number; start: number; lane: number; p: Progress | null; status: 'wait' | 'run' | 'done' | 'error'; err?: string; out?: string; icon?: string | null; kind: 'clip' | 'xml' }

export function BounceTab({ c }: { c: StudioCtx }) {
  const { s, sel, markers } = c;
  const { go, toast } = useApp();
  const selObj = s.objects.find(o => o.id === sel);
  const [what, setWhat] = useState<What>('timeline');
  const [editor, setEditor] = useState<Editor>('resolve');
  const [format, setFormat] = useState<Format>(EDITORS.resolve.format);
  const [size, setSize] = useState<SizeId>(s.h > s.w ? 'vertical' : '1080');
  const [fps, setFps] = useState(s.fps === 30 ? 30 : 30);
  const [handles, setHandles] = useState(12);
  const [pattern, setPattern] = useState('{project}_{layer}_{timecode}');
  const [dir, setDir] = useState<string>('');
  const [range, setRange] = useState<[number, number]>([markers[0]?.t ?? 0, markers[1]?.t ?? s.dur]);
  const [hevc, setHevc] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const running = useRef(false), ctl = useRef<AbortController | null>(null);
  useEffect(() => { defaultDir().then(d => setDir(join(d, safeName(s.name)))); engineInfo().then(i => setHevc(i.hevcAlpha)); }, [s.name]);
  useEffect(() => setFormat(EDITORS[editor].format), [editor]);

  const tc = (t: number) => { const x = Math.floor(t); return `${String(Math.floor(x / 3600)).padStart(2, '0')}-${String(Math.floor(x / 60) % 60).padStart(2, '0')}-${String(x % 60).padStart(2, '0')}`; };
  const named = (layer: string, t: number) => safeName(pattern.replace('{project}', s.name).replace('{layer}', layer).replace('{timecode}', tc(t)));
  const objEnd = (o: Scene['objects'][0]) => (o.dur > 0 ? Math.min(s.dur, o.start + o.dur) : s.dur);
  const plan = (): Omit<Job, 'id' | 'p' | 'status'>[] => {
    const h = handles / fps;
    const layerJob = (o: Scene['objects'][0], lane: number) => { const a = Math.max(0, o.start - h), b = Math.min(s.dur, objEnd(o) + h); return { name: named(o.name, o.start), file: '', scene: { ...s, objects: [{ ...o, hidden: false }] }, from: Math.round(a * fps), to: Math.round(b * fps), start: a, lane, kind: 'clip' as const }; };
    if (what === 'selection') return selObj ? [layerJob(selObj, 0)] : [];
    if (what === 'layers' || what === 'timeline') return [...s.objects].filter(o => !o.hidden).sort((a, b) => a.order - b.order).map((o, i) => layerJob(o, i));
    if (what === 'range') return [{ name: named('in-out', range[0]), file: '', scene: s, from: Math.round(range[0] * fps), to: Math.round(range[1] * fps), start: range[0], lane: 0, kind: 'clip' }];
    return [{ name: named('timeline', 0), file: '', scene: s, from: 0, to: Math.round(s.dur * fps), start: 0, lane: 0, kind: 'clip' }];
  };
  const planned = plan();

  async function run() {
    if (running.current) return;
    let out = dir;
    if (!out) { const d = await pickFolder(); if (!d) return; out = d; setDir(d); }
    const ext = FORMATS[format].ext;
    const list: Job[] = planned.map((j, i) => ({ ...j, id: Date.now() + i, file: ext ? `${j.name}.${ext}` : j.name, p: null, status: 'wait' }));
    const withXml = what === 'timeline';
    setJobs(js => [...list, ...(withXml ? [{ id: Date.now() + 999, name: `${safeName(s.name)} timeline`, file: `${safeName(s.name)}.fcpxml`, scene: s, from: 0, to: 0, start: 0, lane: 0, p: null, status: 'wait' as const, kind: 'xml' as const }] : []), ...js.filter(j => j.status === 'done')]);
    running.current = true; ctl.current = new AbortController();
    const done: Job[] = [];
    for (const j of list) {
      setJobs(js => js.map(x => (x.id === j.id ? { ...x, status: 'run' } : x)));
      try {
        const path = join(out, j.file);
        const res = await bounce(j.scene, { format, size, fps, out: path, from: j.from, to: j.to }, p => setJobs(js => js.map(x => (x.id === j.id ? { ...x, p } : x))), ctl.current.signal);
        const icon = isDesktop ? await dragIcon(j.scene, res).catch(() => null) : null;
        done.push({ ...j, out: res });
        setJobs(js => js.map(x => (x.id === j.id ? { ...x, status: 'done', out: res, icon } : x)));
      } catch (e) {
        setJobs(js => js.map(x => (x.id === j.id ? { ...x, status: 'error', err: String(e).replace(/^Error: /, '') } : x)));
        if (/cancel/i.test(String(e))) break;
      }
    }
    if (withXml && done.length) {
      const files = await writeTimeline(s.name, out, fps, size, done.map(j => ({ name: j.name, file: j.file, start: Math.round(j.start * fps), frames: j.to - j.from, lane: j.lane })));
      setJobs(js => js.map(x => (x.kind === 'xml' && x.status === 'wait' ? { ...x, status: 'done', out: files[0] } : x)));
      toast(`Timeline written for ${EDITORS[editor].name}`);
    }
    running.current = false;
  }
  const waiting = jobs.filter(j => j.status === 'wait' || j.status === 'run').length;

  return (
    <div className="st-bounce-tab">
      <header className="bt-h"><div><h1>Bounce</h1><p className="sub">Render transparent clips your editor understands. Keep working while it runs.</p></div><span className="grow" /><button className="btn-d" onClick={() => go({ m: 'studio', tab: 'edit' })}>Close</button></header>
      <div className="bt-cols">
        <section>
          <p className="caps">1 · What</p>
          {([
            ['selection', 'Selection only', selObj ? `Just the ${selObj.name} layer, ${(objEnd(selObj) - selObj.start).toFixed(1)} s, as one clip.` : 'Select a layer first.'],
            ['layers', 'Each layer as its own clip', `${s.objects.filter(o => !o.hidden).length} transparent clips you can move around separately in your editor.`],
            ['whole', 'Whole timeline, one clip', `Everything stacked into a single ${s.dur.toFixed(0)} s clip.`],
            ['timeline', 'Timeline for your editor', 'Every clip, plus a timeline file that places each one at the right time. Open it and it all lands in position.'],
            ['range', 'In to out', `Only ${range[0].toFixed(1)} to ${range[1].toFixed(1)} s, every layer flattened.`]
          ] as const).map(([k, t, b]) => (
            <button key={k} className={`what${what === k ? ' on' : ''}`} onClick={() => setWhat(k)} disabled={k === 'selection' && !selObj}><span className="radio" /><span><b>{t}{k === 'timeline' && <em>BEST</em>}</b><span>{b}</span></span></button>
          ))}
          {what === 'range' && <div className="row2b"><label>In <input className="st-input" type="number" step={0.1} value={range[0]} onChange={e => setRange([+e.target.value, range[1]])} /></label><label>Out <input className="st-input" type="number" step={0.1} value={range[1]} onChange={e => setRange([range[0], +e.target.value])} /></label></div>}
        </section>
        <section>
          <p className="caps">2 · Where it's going</p>
          <div className="ed-grid">{(Object.keys(EDITORS) as Editor[]).map(e => <button key={e} className={editor === e ? 'on' : ''} onClick={() => setEditor(e)}><b>{e === 'other' ? 'Anything else' : EDITORS[e].name}</b><span className="mono">{FORMATS[EDITORS[e].format].label}{EDITORS[e].timeline ? ` + ${EDITORS[e].timeline === 'fcpxml' ? 'FCPXML' : 'XML'}` : ''}</span></button>)}</div>
          <div className="fmt">
            <header><span className="caps">Format</span><span className="sub">Set from {EDITORS[editor].name}. Change anything.</span></header>
            <div className="kv"><span>Codec</span><Seg size="sm" value={format} onChange={setFormat} options={(['prores', ...(hevc ? ['hevc'] : []), 'webm', 'png', 'mp4'] as Format[]).map(f => [f, FORMATS[f].label] as const)} /></div>
            <div className="kv"><span>Size</span><Seg size="sm" value={size} onChange={setSize} options={(Object.keys(SIZES) as SizeId[]).map(k => [k, k === '1080' ? '1080p' : k === '4k' ? '4K' : SIZES[k].label] as const)} /></div>
            <div className="kv"><span>Frame rate</span><Seg size="sm" value={fps} onChange={setFps} options={[[24, '24'], [25, '25'], [30, '30'], [50, '50'], [60, '60']]} /></div>
            <div className="kv"><span>Handles</span><Seg size="sm" value={handles} onChange={setHandles} options={[[0, 'None'], [6, '+6 frames'], [12, '+12 frames'], [24, '+24 frames']]} /></div>
            <div className="kv"><span>File names</span><input className="st-input mono" value={pattern} onChange={e => setPattern(e.target.value)} aria-label="File name pattern" /></div>
            <div className="kv"><span>Folder</span><span className="mono path">{dir || 'Choose…'}</span><button className="btn-d" onClick={async () => { const d = await pickFolder(); if (d) setDir(d); }}>Change</button></div>
            <div className="kv"><span>Rendering</span><span className="sub">Vector at output size, so 4K is never upscaled. Alpha is straight, not premultiplied. {isDesktop ? 'Rendered natively on every core.' : 'The browser build writes PNG frames in a .zip.'}</span></div>
          </div>
        </section>
        <section>
          <header className="q-h"><p className="caps">3 · Queue</p><span className="sub">{jobs.length} items{waiting ? ` · ${waiting} to go` : ''}</span></header>
          <ul className="queue">
            {jobs.map(j => (
              <li key={j.id} className={j.status} draggable={false} onPointerDown={async () => { if (j.status === 'done' && j.out && isDesktop && j.kind === 'clip') await startDrag(j.out, j.icon ?? null).catch(() => {}); }}>
                <span className="q-ico" />
                <div><b>{j.file}</b><span className="status">{j.status === 'done' ? (j.kind === 'clip' ? 'Done · drag me' : 'Done') : j.status === 'run' ? `${j.p ? Math.round(j.p.done / j.p.total * 100) : 0}%` : j.status === 'error' ? 'Failed' : 'Waiting'}</span>
                  <div className="bar"><i style={{ width: `${j.status === 'done' ? 100 : j.p ? j.p.done / j.p.total * 100 : 0}%` }} /></div>
                  <span className="mono sub">{j.kind === 'xml' ? `places ${jobs.filter(x => x.kind === 'clip').length} clips · ${EDITORS[editor].name}` : `${((j.to - j.from) / fps).toFixed(1)} s · ${SIZES[size].label} · ${FORMATS[format].label}${j.p && j.status === 'run' ? ` · ${j.p.fps.toFixed(0)} fps` : ''}`}</span>
                  {j.err && <span className="warn">{j.err}</span>}
                  {j.status === 'done' && j.out && isDesktop && <button className="link" onClick={e => { e.stopPropagation(); reveal(j.out!); }}>Show in folder</button>}
                </div>
              </li>
            ))}
          </ul>
          {isDesktop && <p className="drag-hint">⠿ Finished clips can be dragged straight from here into any editor.</p>}
          {waiting ? <button className="st-bounce wide" onClick={() => ctl.current?.abort()}>Cancel</button>
            : <button className="st-bounce wide" disabled={!planned.length} onClick={run}>Bounce {planned.length} clip{planned.length === 1 ? '' : 's'}{what === 'timeline' ? ' + timeline' : ''} <kbd>⌘↵</kbd></button>}
        </section>
      </div>
    </div>
  );
}
