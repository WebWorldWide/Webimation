// Mix: every layer is a channel. Stack effects in its slots, ride its fader, and record the moves
// as automation (Read, Touch, Latch, Write) while it plays.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../App';
import { coverage } from '../../engine';
import { Select, Slider } from '../../ui/controls';
import type { Obj } from '../../types';
import type { Auto, StudioCtx } from '../Studio';

const MODES: Auto[] = ['off', 'read', 'touch', 'latch', 'write'];
const HELP: Record<Auto, string> = {
  off: 'Off: recorded moves are ignored. The fader sets a fixed level.',
  read: 'Read: plays back what you recorded. Moving the fader changes the base level.',
  touch: 'Touch: press play, then hold and move a fader. Recording stops when you let go.',
  latch: 'Latch: press play, then move any fader. It keeps recording its last level until you stop.',
  write: 'Write: press play. Every armed fader records from start to stop, moved or not.'
};
const COLORS = ['#3D82FF', '#8B5CF6', '#38B6FF', '#B04CC4', '#F5C542', '#F0507A', '#22D37F', '#FF8A1F'];

export function MixTab({ c }: { c: StudioCtx }) {
  const { s, setObj, edit, player, solo, setSolo, auto, setAuto, sel, setSel } = c;
  const { cat } = useApp();
  const [mode, setMode] = useState<Auto>('read');
  const [meters, setMeters] = useState<Record<string, number>>({});
  const [lane, setLane] = useState<string | null>(sel);
  const touching = useRef<Record<string, number>>({});
  const latched = useRef<Record<string, number>>({});
  const recWin = useRef<Record<string, [number, number]>>({});
  const channels = [...s.objects].sort((a, b) => a.order - b.order);
  const modeOf = (o: Obj) => auto[o.id] ?? mode;
  const fx = (slot: string) => cat.effects.filter(e => e.slot === slot).map(e => [e.id, e.name] as const);

  // Meters: each channel's share of the frame at the playhead.
  useEffect(() => { let live = true; const id = setTimeout(() => coverage(c.view, player.t).then(m => live && setMeters(m)), player.playing ? 120 : 30); return () => { live = false; clearTimeout(id); }; }, [c.view, Math.round(player.t * 8)]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Write one automation point, replacing anything recorded since this pass started. */
  const record = (o: Obj, t: number, v: number) => {
    const w = recWin.current[o.id] ?? [t, t];
    recWin.current[o.id] = [Math.min(w[0], t), Math.max(w[1], t)];
    setObj(o.id, x => {
      const [a] = recWin.current[o.id];
      const keep = x.opacity_keys.filter(k => k[0] < a - 1e-3 || k[0] > t + 1e-3);
      const mine = x.opacity_keys.filter(k => k[0] >= a - 1e-3 && k[0] <= t + 1e-3 && k[0] < t - 1e-3);
      const pts = [...keep, ...mine, [+t.toFixed(3), +v.toFixed(3)] as [number, number]].sort((p, q) => p[0] - q[0]);
      return { ...x, opacity_keys: thin(pts), opacity: 1 };
    }, `auto-${o.id}`);
  };
  // Latch and Write keep recording every frame while playing.
  useEffect(() => {
    if (!player.playing) { touching.current = {}; latched.current = {}; recWin.current = {}; return; }
    for (const o of channels) {
      const m = modeOf(o);
      if (m === 'latch' && latched.current[o.id] !== undefined && touching.current[o.id] === undefined) record(o, player.t, latched.current[o.id]);
      if (m === 'write') record(o, player.t, touching.current[o.id] ?? latched.current[o.id] ?? shown(o));
    }
  }, [player.t, player.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const fader = (o: Obj, v: number) => {
    const m = modeOf(o);
    if (player.playing && (m === 'touch' || m === 'latch' || m === 'write')) { touching.current[o.id] = v; latched.current[o.id] = v; record(o, player.t, v); }
    else setObj(o.id, x => ({ ...x, opacity: v }), `op-${o.id}`);
  };
  const shown = (o: Obj) => (o.opacity_keys.length && modeOf(o) !== 'off' ? valueAt(o.opacity_keys, player.t) : o.opacity);
  const recording = player.playing && channels.some(o => ['touch', 'latch', 'write'].includes(modeOf(o)));
  const laneObj = channels.find(o => o.id === lane) ?? channels[0];

  return (
    <div className="st-mix">
      <header className="mix-h">
        <div><h1>Mix</h1><p className="sub">Every layer is a channel. Stack effects in its slots, ride its fader, record moves as keyframes.</p></div>
        <span className="grow" />
        <span className="caps">Automation</span>
        <div className="seg seg-md">{MODES.map(m => <button key={m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); channels.forEach(o => setAuto(o.id, m)); }}>{m[0].toUpperCase() + m.slice(1)}</button>)}</div>
        <button className={`rec${recording ? ' on' : ''}`} onClick={() => { if (player.playing) player.pause(); else player.play(); }}>{recording ? '● Recording · stop' : player.playing ? '❚❚ Stop' : '▶ Play'}</button>
        <span className="tc mono">{player.t.toFixed(2)} s</span>
      </header>
      <p className="mix-help">{HELP[mode]}</p>
      <div className="strips">
        {channels.map((o, i) => {
          const m = modeOf(o), col = COLORS[i % COLORS.length], v = shown(o), meter = Math.min(1, (meters[o.id] ?? 0) * 3);
          return (
            <div key={o.id} className={`strip${o.id === sel ? ' on' : ''}`} onClick={() => { setSel(o.id); setLane(o.id); }}>
              <p className="caps">Inserts</p>
              <div className="slot"><i style={{ background: '#B48CFF' }} /><b>A</b><Select label="In" value={o.enter.id} onChange={id => setObj(o.id, x => ({ ...x, enter: { ...x.enter, id } }))} options={fx('in')} /></div>
              <div className="slot"><i style={{ background: '#F5C542' }} /><b>B</b><Select label="Loop" value={o.on.id} onChange={id => setObj(o.id, x => ({ ...x, on: { ...x.on, id } }))} options={fx('on')} /></div>
              <div className="slot"><i style={{ background: '#38B6FF' }} /><b>C</b><Select label="Out" value={o.exit.id} onChange={id => setObj(o.id, x => ({ ...x, exit: { ...x.exit, id } }))} options={fx('out')} /></div>
              <div className="slot"><i style={{ background: '#22D37F' }} /><b>D</b><label className="slot-chk"><input type="checkbox" checked={o.as_ascii} onChange={e => setObj(o.id, x => ({ ...x, as_ascii: e.target.checked }))} />Characters</label></div>
              <p className="caps">Blend</p>
              <Select label="Blend" value={o.blend} onChange={blend => setObj(o.id, x => ({ ...x, blend }))} options={[['normal', 'Normal'], ['screen', 'Screen'], ['add', 'Add'], ['multiply', 'Multiply'], ['difference', 'Difference']]} />
              <p className="caps">Time</p>
              <input className="st-input mono" type="number" step={0.1} value={+o.start.toFixed(2)} onChange={e => setObj(o.id, x => ({ ...x, start: Math.max(0, +e.target.value), cue: 'manual' }), `t-${o.id}`)} aria-label="Start time" />
              <div className="fader-box">
                <div className="scale">{[100, 75, 50, 25, 0].map(n => <span key={n}>{n}</span>)}</div>
                <input className="fader" type="range" min={0} max={1} step={0.01} value={v} aria-label={`${o.name} level`} onChange={e => fader(o, +e.target.value)} onPointerUp={() => { delete touching.current[o.id]; if (m === 'touch') delete latched.current[o.id]; recWin.current[o.id] = recWin.current[o.id] ?? [0, 0]; }} />
                <div className="meter"><i style={{ height: `${meter * 100}%`, background: col }} /><i style={{ height: `${Math.max(0, meter - 0.06) * 100}%`, background: col }} /></div>
              </div>
              <b className="lvl">{Math.round(v * 100)}%</b>
              <button className={`amode m-${m}`} onClick={e => { e.stopPropagation(); setAuto(o.id, MODES[(MODES.indexOf(m) + 1) % MODES.length]); }}>{m.toUpperCase()}</button>
              <div className="ms"><button className={o.hidden ? 'on' : ''} onClick={e => { e.stopPropagation(); setObj(o.id, x => ({ ...x, hidden: !x.hidden })); }}>M</button><button className={solo.includes(o.id) ? 'on solo' : ''} onClick={e => { e.stopPropagation(); setSolo(sl => (sl.includes(o.id) ? sl.filter(x => x !== o.id) : [...sl, o.id])); }}>S</button></div>
              <footer style={{ borderTopColor: col }}><span className="mono">{String(i + 1).padStart(2, '0')}</span><b>{o.name}</b></footer>
            </div>
          );
        })}
        <div className="strip master">
          <p className="caps">Master inserts</p>
          <Slider label="A Scanlines" value={s.screen.scanlines} min={0} max={1} onChange={scanlines => edit(v => ({ ...v, screen: { ...v.screen, scanlines } }), 'ms1')} />
          <Slider label="B Grain" value={s.screen.grain} min={0} max={1} onChange={grain => edit(v => ({ ...v, screen: { ...v.screen, grain } }), 'ms2')} />
          <Slider label="C Glow" value={s.screen.glow} min={0} max={1.5} onChange={glow => edit(v => ({ ...v, screen: { ...v.screen, glow } }), 'ms3')} />
          <Slider label="D RGB split" value={s.screen.rgb_split} min={0} max={12} step={0.5} onChange={rgb_split => edit(v => ({ ...v, screen: { ...v.screen, rgb_split } }), 'ms4')} />
          <Slider label="E Vignette" value={s.screen.vignette} min={0} max={1} onChange={vignette => edit(v => ({ ...v, screen: { ...v.screen, vignette } }), 'ms5')} />
          <p className="caps">Output</p>
          <Select label="Background" value={s.bg.kind} onChange={kind => edit(v => ({ ...v, bg: { ...v.bg, kind } }))} options={[['clear', 'Transparent'], ['solid', 'Solid colour'], ['sky', 'Sky'], ['paper', 'Paper']]} />
          <span className="mono out">{s.w} × {s.h}</span>
          <Select label="Frame rate" value={String(s.fps)} onChange={f => edit(v => ({ ...v, fps: +f }))} options={[['30', '30 fps smooth'], ['12', '12 fps pixel'], ['6', '6 fps chunky']]} />
          <div className="meter master-m"><i style={{ height: `${Math.min(1, Object.values(meters).reduce((a, b) => a + b, 0)) * 100}%` }} /></div>
          <span className="sub">Alpha coverage</span>
          <footer><span className="mono">OUT</span><b>Master</b></footer>
        </div>
      </div>
      {laneObj && (
        <section className="auto-lane">
          <header><span className="caps">Automation</span><b>{laneObj.name} · opacity</b><span className="sub">Red is what you just recorded by riding the fader.</span><span className="grow" /><button className="btn-d" disabled={!laneObj.opacity_keys.length} onClick={() => setObj(laneObj.id, x => ({ ...x, opacity_keys: [] }))}>Clear automation</button></header>
          <svg viewBox={`0 0 1000 100`} preserveAspectRatio="none" className="lane-svg" onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); player.seek((e.clientX - r.left) / r.width * s.dur); }}>
            {recWin.current[laneObj.id] && <rect x={recWin.current[laneObj.id][0] / s.dur * 1000} width={(recWin.current[laneObj.id][1] - recWin.current[laneObj.id][0]) / s.dur * 1000} y={0} height={100} className="rec-win" />}
            <polyline points={(laneObj.opacity_keys.length ? [[0, laneObj.opacity_keys[0][1]], ...laneObj.opacity_keys, [s.dur, laneObj.opacity_keys[laneObj.opacity_keys.length - 1][1]]] : [[0, laneObj.opacity], [s.dur, laneObj.opacity]]).map(([t, v]) => `${t / s.dur * 1000},${95 - v * 90}`).join(' ')} />
            <line x1={player.t / s.dur * 1000} x2={player.t / s.dur * 1000} y1={0} y2={100} className="ph" />
          </svg>
        </section>
      )}
    </div>
  );
}

function valueAt(k: [number, number][], t: number) {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (t <= k[i][0]) { const [a, b] = [k[i - 1], k[i]]; return a[1] + (b[1] - a[1]) * (t - a[0]) / Math.max(1e-6, b[0] - a[0]); }
  return k[k.length - 1][1];
}
/** Drop points that sit on a straight line between their neighbours. */
function thin(k: [number, number][]) {
  if (k.length < 3) return k;
  const out = [k[0]];
  for (let i = 1; i < k.length - 1; i++) { const [a, b, c] = [out[out.length - 1], k[i], k[i + 1]]; const v = a[1] + (c[1] - a[1]) * (b[0] - a[0]) / Math.max(1e-6, c[0] - a[0]); if (Math.abs(v - b[1]) > 0.004) out.push(b); }
  out.push(k[k.length - 1]);
  return out;
}
