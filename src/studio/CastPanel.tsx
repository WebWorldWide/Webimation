import { useState } from 'react';
import { ACTION, ACTIONS, castLength, newFigure, parseCast, STAND, stepAt, type Cast, type Figure, type Pose, type Step } from '../engine';

interface Props {
  props: Record<string, string>;
  set: (k: string, v: string) => void;
  /** Fit the clip length to the script. */
  fit: (dur: number) => void;
  /** Current local time in the clip, to highlight the running step. */
  time: number;
}

const GROUPS = ['Move', 'Gesture', 'Emote', 'Body', 'Custom'] as const;
const COLORS: [string, string][] = [['fg', 'Field text'], ['accent', 'Accent'], ['#FFFFFF', 'White'], ['#0B0B0C', 'Ink'], ['#1E68F0', 'Blue'], ['#22D37F', 'Green'], ['#8B5CF6', 'Purple'], ['#E8433A', 'Red']];
const POSE_SLIDERS: [keyof Pose, number | null, string, number, number][] = [
  ['lean', null, 'Lean', -90, 90], ['tilt', null, 'Head', -45, 45],
  ['af', 0, 'Front shoulder', -180, 180], ['af', 1, 'Front elbow', -150, 150],
  ['ab', 0, 'Back shoulder', -180, 180], ['ab', 1, 'Back elbow', -150, 150],
  ['lf', 0, 'Front hip', -120, 120], ['lf', 1, 'Front knee', 0, 160],
  ['lb', 0, 'Back hip', -120, 120], ['lb', 1, 'Back knee', 0, 160]
];

function Num({ label, value, min, max, step, onChange, unit = '' }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 11.5, color: 'var(--label)' }}>{label}</span><span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{+value.toFixed(2)}{unit}</span></div>
      <input className="range" type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} />
    </label>
  );
}

/** Script editor for stick-figure clips: cast, per-figure steps, custom poses. Stored as JSON in props.cast. */
export function CastPanel({ props, set, fit, time }: Props) {
  const cast = parseCast(props.cast), [fi, setFi] = useState(0), [open, setOpen] = useState<number | null>(null);
  const F = cast.figures[Math.min(fi, cast.figures.length - 1)];
  const save = (c: Cast) => set('cast', JSON.stringify(c));
  const setFig = (patch: Partial<Figure>) => save({ ...cast, figures: cast.figures.map(f => (f.id === F.id ? { ...f, ...patch } : f)) });
  const setStep = (i: number, patch: Partial<Step>) => setFig({ steps: F.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const running = F ? stepAt(F, time).i : -1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="caps">Cast</span>
          <button className="btn-text" style={{ height: 'auto', padding: 0 }} onClick={() => fit(+(castLength(cast) + 0.3).toFixed(1))}>Fit clip to script · {castLength(cast).toFixed(1)} s</button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {cast.figures.map((f, i) => <button key={f.id} className={'btn btn-sm ease'} style={i === fi ? { background: 'var(--primary)', color: 'var(--primary-fg)', borderColor: 'var(--primary)' } : undefined} onClick={() => { setFi(i); setOpen(null); }}>{f.name}</button>)}
          {cast.figures.length < 6 && <button className="btn btn-sm ease" onClick={() => { save({ ...cast, figures: [...cast.figures, newFigure(cast.figures.length)] }); setFi(cast.figures.length); }}>+ Figure</button>}
        </div>
      </div>

      {F && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <input className="field-input" aria-label="Figure name" value={F.name} onChange={e => setFig({ name: e.target.value })} />
            <div className="seg tight">{(['left', 'right'] as const).map(d => <button key={d} className={'ease' + (F.face === d ? ' on' : '')} onClick={() => setFig({ face: d })}>{d === 'left' ? '← Faces' : 'Faces →'}</button>)}</div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingLeft: 2 }}>
            {COLORS.map(([c, label]) => (
              <button key={c} className="ease" title={label} aria-label={label} aria-pressed={F.color === c} onClick={() => setFig({ color: c })}
                style={{ width: 24, height: 24, border: 0, cursor: 'pointer', background: c === 'fg' ? 'linear-gradient(135deg,#fff 50%,#0B0B0C 50%)' : c === 'accent' ? 'conic-gradient(#FF8A1F,#22D37F,#8B5CF6,#FF8A1F)' : c, boxShadow: F.color === c ? '0 0 0 2px var(--panel), 0 0 0 3px var(--fg)' : 'inset 0 0 0 1px var(--line-strong)' }} />
            ))}
          </div>
          <Num label="Height" value={F.h} min={80} max={560} step={1} unit=" px" onChange={v => setFig({ h: v })} />
          <Num label="Start X" value={F.x} min={-200} max={1480} step={1} unit=" px" onChange={v => setFig({ x: v })} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderTop: '1px solid var(--line)' }}>
            {F.steps.map((s, i) => {
              const A = ACTION[s.do] || ACTION.stand, isOpen = open === i;
              return (
                <div key={i} style={{ borderBottom: '1px solid var(--line-soft)', background: i === running ? 'var(--hi-wash)' : undefined, boxShadow: i === running ? 'inset 2px 0 0 var(--hi)' : undefined }}>
                  <button className="ease" onClick={() => setOpen(isOpen ? null : i)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 8, alignItems: 'baseline', padding: '9px 6px', background: 'transparent', border: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--fg)' }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{String(i + 1).padStart(2, '0')}</span>
                    <span style={{ fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{A.name}{s.dx ? ` ${Math.round(s.dx)} px` : ''}{s.say ? ` · “${s.say}”` : ''}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{s.dur.toFixed(1)} s</span>
                  </button>
                  {isOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '2px 6px 12px' }}>
                      <select className="field-input" value={s.do} onChange={e => { const a = ACTION[e.target.value]; setStep(i, { do: a.id, dur: a.dur, dx: a.dx, pose: a.id === 'pose' ? s.pose ?? { ...STAND } : undefined }); }}>
                        {GROUPS.map(g => <optgroup key={g} label={g}>{ACTIONS.filter(a => a.group === g).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}
                      </select>
                      <span style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--muted)' }}>{A.blurb}</span>
                      <Num label="Duration" value={s.dur} min={0.2} max={8} step={0.1} unit=" s" onChange={v => setStep(i, { dur: v })} />
                      {A.dx !== undefined && <Num label="Distance" value={s.dx ?? 0} min={-1200} max={1200} step={10} unit=" px" onChange={v => setStep(i, { dx: v })} />}
                      <input className="field-input" placeholder="Says… (optional speech bubble)" value={s.say ?? ''} onChange={e => setStep(i, { say: e.target.value || undefined })} />
                      <div className="seg tight">
                        {([['', 'Keep facing'], ['left', 'Turn ←'], ['right', 'Turn →']] as const).map(([v, l]) => <button key={v} className={'ease' + ((s.face ?? '') === v ? ' on' : '')} onClick={() => setStep(i, { face: (v || undefined) as Step['face'] })}>{l}</button>)}
                      </div>
                      {s.do === 'pose' && s.pose && POSE_SLIDERS.map(([k, idx, label, min, max]) => {
                        const v = idx === null ? (s.pose![k] as number) : (s.pose![k] as [number, number])[idx];
                        return <Num key={label} label={label} value={v} min={min} max={max} step={1} unit="°" onChange={nv => {
                          const p = { ...s.pose! } as Pose;
                          if (idx === null) (p[k] as number) = nv; else { const pair = [...(p[k] as [number, number])] as [number, number]; pair[idx] = nv; (p[k] as [number, number]) = pair; }
                          setStep(i, { pose: p });
                        }} />;
                      })}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-sm ease" disabled={i === 0} onClick={() => { const st = [...F.steps]; [st[i - 1], st[i]] = [st[i], st[i - 1]]; setFig({ steps: st }); setOpen(i - 1); }}>↑</button>
                        <button className="btn btn-sm ease" disabled={i === F.steps.length - 1} onClick={() => { const st = [...F.steps]; [st[i + 1], st[i]] = [st[i], st[i + 1]]; setFig({ steps: st }); setOpen(i + 1); }}>↓</button>
                        <button className="btn btn-sm ease" onClick={() => { const st = [...F.steps]; st.splice(i + 1, 0, { ...s }); setFig({ steps: st }); setOpen(i + 1); }}>Duplicate</button>
                        <button className="btn-text" style={{ marginLeft: 'auto', color: 'var(--danger)' }} disabled={F.steps.length < 2} onClick={() => { setFig({ steps: F.steps.filter((_, k) => k !== i) }); setOpen(null); }}>Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="field-input" value="" onChange={e => { const a = ACTION[e.target.value]; if (!a) return; setFig({ steps: [...F.steps, { do: a.id, dur: a.dur, dx: a.dx, pose: a.id === 'pose' ? { ...STAND } : undefined }] }); setOpen(F.steps.length); }}>
              <option value="">+ Add step…</option>
              {GROUPS.map(g => <optgroup key={g} label={g}>{ACTIONS.filter(a => a.group === g).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>)}
            </select>
            {cast.figures.length > 1 && <button className="btn-text" style={{ color: 'var(--danger)' }} onClick={() => { save({ ...cast, figures: cast.figures.filter(f => f.id !== F.id) }); setFi(0); }}>Remove figure</button>}
          </div>
        </>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
        <span className="caps">Drawing</span>
        <div className="seg">{([['round', 'Classic'], ['solid', 'Solid head'], ['block', 'Block']] as const).map(([v, l]) => <button key={v} className={'ease' + (cast.style === v ? ' on' : '')} onClick={() => save({ ...cast, style: v })}>{l}</button>)}</div>
        <Num label="Line weight" value={cast.weight} min={2} max={28} step={1} unit=" px" onChange={v => save({ ...cast, weight: v })} />
        <Num label="Ground" value={cast.ground} min={200} max={720} step={1} unit=" px" onChange={v => save({ ...cast, ground: v })} />
      </div>
    </div>
  );
}
