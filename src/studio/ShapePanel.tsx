import { SHAPE, SHAPES, SHAPE_GROUPS, shapeParams } from '../engine';

type Props = { props: Record<string, string>; set: (k: string, v: string) => void; setMany: (patch: Record<string, string | undefined>) => void };

/** Shape picker and geometry controls for a shape clip. Params are stored as `p.<key>` props. */
export function ShapePanel({ props: P, set, setMany }: Props) {
  const def = SHAPE[P.shape] || SHAPE.arrow, p = shapeParams(P), full = def.id === 'spotlight';
  const pick = (id: string) => setMany({ shape: id, ...Object.fromEntries(Object.keys(P).filter(k => k.startsWith('p.')).map(k => [k, undefined])) });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caps">Shape</span>
        <select className="field-input" value={def.id} onChange={e => pick(e.target.value)}>
          {SHAPE_GROUPS.map(g => <optgroup key={g} label={g}>{SHAPES.filter(s => s.group === g).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>)}
        </select>
        <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>{def.blurb}</span>
      </label>
      {(def.options || []).map(o => (
        <div key={o.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 11.5, color: 'var(--label)' }}>{o.label}</span>
          <div className={'seg' + (o.values.length > 3 ? ' grid' : '')} style={o.values.length > 3 ? { gridTemplateColumns: 'repeat(3,minmax(0,1fr))' } : undefined}>
            {o.values.map(([id, label]) => <button key={id} className={'ease' + (p[o.key] === id ? ' on' : '')} onClick={() => set('p.' + o.key, id)}>{label}</button>)}
          </div>
        </div>
      ))}
      {def.params.map(q => (
        <label key={q.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11.5, color: 'var(--label)' }}>{q.label}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{+(+p[q.key]).toFixed(2)}{q.unit ?? ''}</span>
          </div>
          <input className="range" type="range" min={q.min} max={q.max} step={q.step} value={+p[q.key]} onChange={e => set('p.' + q.key, e.target.value)} />
        </label>
      ))}
      {!full && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {([['sx', 'Centre X', 640], ['sy', 'Centre Y', 360]] as const).map(([k, label, d]) => (
            <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11.5, color: 'var(--label)' }}>{label} · px</span>
              <input className="field-input" type="number" step={1} value={P[k] || String(d)} onChange={e => set(k, String(Math.round(+e.target.value || 0)))} />
            </label>
          ))}
        </div>
      )}
      <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Drag on the stage to move it. Shift-drag to move it in straight lines.</span>
    </div>
  );
}
