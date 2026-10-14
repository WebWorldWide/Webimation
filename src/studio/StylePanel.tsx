import { useState, type ReactNode } from 'react';
import { ACC, ANCHORS, FIELDS, FONT, FONTS, PAIRING, PAIRINGS, ROLES, accentHex, type Role } from '../engine';

type Props = { props: Record<string, string>; set: (k: string, v: string) => void; setMany: (patch: Record<string, string | undefined>) => void };

const ROLE_KEYS = ['Font', 'W', 'S', 'Ls', 'Tt', 'Z'];
const KIND_LABEL: Record<string, string> = { serif: 'Serif', sans: 'Sans', display: 'Display', mono: 'Mono', hand: 'Hand', pixel: 'Pixel' };
const HEX = /^#[0-9a-f]{6}$/i;

function Section({ title, note, children, open = true }: { title: string; note?: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="style-sec">
      <summary><span className="caps">{title}</span>{note != null && <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{note}</span>}</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 12 }}>{children}</div>
    </details>
  );
}

const Row = ({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 11.5, color: 'var(--label)' }}>{label}</span>
      {value != null && <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{value}</span>}
    </div>
    {children}
  </div>
);

function Slider({ value, min, max, step, onChange, disabled }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; disabled?: boolean }) {
  return <input className="range" type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(+e.target.value)} style={disabled ? { opacity: 0.35 } : undefined} />;
}

function Swatch({ color, on, label, onClick }: { color: string; on: boolean; label: string; onClick: () => void }) {
  return (
    <button className="ease" aria-label={label} title={label} aria-pressed={on} onClick={onClick}
      style={{ width: 26, height: 26, flex: 'none', background: color, border: 0, cursor: 'pointer', boxShadow: on ? '0 0 0 2px var(--panel), 0 0 0 3px var(--fg)' : 'inset 0 0 0 1px var(--line-strong)' }} />
  );
}

/** Colour picker swatch for custom hex values. */
function Custom({ value, onPick, label }: { value: string | undefined; onPick: (hex: string) => void; label: string }) {
  const on = !!value && HEX.test(value);
  return (
    <label title={label} style={{ position: 'relative', width: 26, height: 26, flex: 'none', cursor: 'pointer', background: on ? value : 'conic-gradient(#FF8A1F,#22D37F,#1E68F0,#8B5CF6,#FF8A1F)', boxShadow: on ? '0 0 0 2px var(--panel), 0 0 0 3px var(--fg)' : 'inset 0 0 0 1px var(--line-strong)' }}>
      <input type="color" aria-label={label} value={on ? value : '#1E68F0'} onChange={e => onPick(e.target.value.toUpperCase())}
        style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', border: 0, padding: 0 }} />
    </label>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(([id, label]) => <button key={id} className={'ease' + (id === value ? ' on' : '')} onClick={() => onChange(id)}>{label}</button>)}</div>;
}

export function StylePanel({ props: P, set, setMany }: Props) {
  const [role, setRole] = useState<Role>('disp');
  const pairing = PAIRING[P.type] || PAIRING.editorial, base = pairing.roles[role];
  const r = (k: string) => P[role + k];
  const font = FONT[r('Font') || base.font] || FONT.archivo;
  const num = (k: string, d: number) => { const v = parseFloat(r(k)); return isFinite(v) ? v : d; };
  const w = Math.min(font.wght[1], Math.max(font.wght[0], num('W', base.w))), s = Math.min(font.wdth[1], Math.max(font.wdth[0], num('S', base.s)));
  const roleTouched = ROLE_KEYS.some(k => P[role + k] !== undefined && P[role + k] !== '');
  const resetRole = () => setMany(Object.fromEntries(ROLE_KEYS.map(k => [role + k, undefined])));
  const placed = !!(P.place || P.size || P.nx || P.ny);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Section title="Type" note={pairing.name}>
        <Row label="Pairing">
          <select className="field-input" value={pairing.id} onChange={e => set('type', e.target.value)}>
            {PAIRINGS.map(p => <option key={p.id} value={p.id}>{p.name} — {FONT[p.roles.disp.font].name} / {FONT[p.roles.text.font].name}</option>)}
          </select>
        </Row>
        <div className="seg">{ROLES.map(([id, label]) => <button key={id} className={'ease' + (role === id ? ' on' : '')} onClick={() => setRole(id)}>{label}</button>)}</div>
        <Row label="Font" value={roleTouched ? <button className="btn-text" style={{ height: 'auto', padding: 0 }} onClick={resetRole}>Reset</button> : 'from pairing'}>
          <select className="field-input" value={r('Font') || ''} onChange={e => set(role + 'Font', e.target.value)} style={{ fontFamily: font.family }}>
            <option value="">Pairing default · {FONT[base.font].name}</option>
            {Object.entries(KIND_LABEL).map(([kind, label]) => (
              <optgroup key={kind} label={label}>{FONTS.filter(f => f.kind === kind).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>
            ))}
          </select>
        </Row>
        <Row label="Weight" value={font.wght[0] === font.wght[1] ? 'single weight' : w}>
          <Slider value={w} min={font.wght[0]} max={font.wght[1]} step={10} disabled={font.wght[0] === font.wght[1]} onChange={v => set(role + 'W', String(v))} />
        </Row>
        <Row label="Width" value={font.wdth[0] === font.wdth[1] ? 'fixed' : s + '%'}>
          <Slider value={s} min={font.wdth[0]} max={font.wdth[1]} step={1} disabled={font.wdth[0] === font.wdth[1]} onChange={v => set(role + 'S', String(v))} />
        </Row>
        <Row label="Tracking" value={num('Ls', base.ls).toFixed(3) + ' em'}>
          <Slider value={num('Ls', base.ls)} min={-0.08} max={0.3} step={0.005} onChange={v => set(role + 'Ls', v.toFixed(3))} />
        </Row>
        <Row label="Size" value={'×' + num('Z', base.z).toFixed(2)}>
          <Slider value={num('Z', base.z)} min={0.5} max={1.6} step={0.01} onChange={v => set(role + 'Z', v.toFixed(2))} />
        </Row>
        {role !== 'label' && role !== 'num' && (
          <Row label="Case">
            <Seg value={(r('Tt') || base.tt) as 'none' | 'uppercase' | 'lowercase'} options={[['none', 'As typed'], ['uppercase', 'Upper'], ['lowercase', 'Lower']]} onChange={v => set(role + 'Tt', v)} />
          </Row>
        )}
      </Section>

      <Section title="Colour" note={P.field ? FIELDS.find(f => f.id === P.field)?.name : undefined}>
        <Row label="Accent" value={accentHex(P.accent)}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, paddingLeft: 2 }}>
            {Object.entries(ACC).map(([id, hex]) => <Swatch key={id} color={hex} label={id} on={P.accent === id} onClick={() => set('accent', id)} />)}
            <Swatch color="#1E68F0" label="blue" on={P.accent === '#1E68F0'} onClick={() => set('accent', '#1E68F0')} />
            <Swatch color="#E8433A" label="red" on={P.accent === '#E8433A'} onClick={() => set('accent', '#E8433A')} />
            <Swatch color="#FFD23F" label="yellow" on={P.accent === '#FFD23F'} onClick={() => set('accent', '#FFD23F')} />
            <Custom label="Custom accent" value={HEX.test(P.accent || '') && !['#1E68F0', '#E8433A', '#FFD23F'].includes(P.accent) ? P.accent : undefined} onPick={hex => set('accent', hex)} />
          </div>
        </Row>
        <Row label="Field">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, paddingLeft: 2 }}>
            {FIELDS.map(f => <Swatch key={f.id} label={f.name} color={f.swatch === 'accent' ? accentHex(P.accent) : f.swatch} on={(P.field || 'blue') === f.id} onClick={() => set('field', f.id)} />)}
          </div>
        </Row>
        <Row label="Grid lines">
          <Seg value={(P.grid || 'auto') as 'auto' | '1' | '0'} options={[['auto', 'Field default'], ['1', 'On'], ['0', 'Off']]} onChange={v => set('grid', v === 'auto' ? '' : v)} />
        </Row>
        <Row label="Text">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1 }}><Seg value={(HEX.test(P.fg || '') ? 'custom' : P.fg || 'auto') as string} options={[['auto', 'Auto'], ['white', 'White'], ['ink', 'Ink'], ['accent', 'Accent']]} onChange={v => set('fg', v)} /></div>
            <Custom label="Custom text colour" value={HEX.test(P.fg || '') ? P.fg : undefined} onPick={hex => set('fg', hex)} />
          </div>
        </Row>
        <Row label="Plates">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1 }}><Seg value={(HEX.test(P.plate || '') ? 'custom' : P.plate || 'auto') as string} options={[['auto', 'Auto'], ['white', 'White'], ['ink', 'Ink'], ['accent', 'Accent']]} onChange={v => set('plate', v)} /></div>
            <Custom label="Custom plate colour" value={HEX.test(P.plate || '') ? P.plate : undefined} onPick={hex => set('plate', hex)} />
          </div>
        </Row>
      </Section>

      <Section title="Placement" note={placed ? (P.place ? P.place.toUpperCase() : 'nudged') : 'template'}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div role="group" aria-label="Anchor" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,26px)', gap: 3, padding: 4, boxShadow: 'inset 0 0 0 1px var(--line-strong)', background: 'var(--sunk)' }}>
            {ANCHORS.map(a => (
              <button key={a} className="ease" aria-label={`Anchor ${a}`} aria-pressed={P.place === a} onClick={() => set('place', P.place === a ? '' : a)}
                style={{ width: 26, height: 18, border: 0, cursor: 'pointer', background: P.place === a ? 'var(--hi)' : 'var(--wash-3)' }} />
            ))}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Snap the graphic to a corner, edge or centre of the title-safe area, or drag it on the stage.</span>
            {placed && <button className="btn btn-sm ease" style={{ alignSelf: 'flex-start' }} onClick={() => setMany({ place: undefined, size: undefined, nx: undefined, ny: undefined })}>Back to template layout</button>}
          </div>
        </div>
        <Row label="Size" value={'×' + (parseFloat(P.size) || 1).toFixed(2)}>
          <Slider value={parseFloat(P.size) || 1} min={0.5} max={1.6} step={0.01} onChange={v => set('size', v === 1 ? '' : v.toFixed(2))} />
        </Row>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {(['nx', 'ny'] as const).map(k => (
            <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11.5, color: 'var(--label)' }}>Nudge {k === 'nx' ? 'X' : 'Y'} · px</span>
              <input className="field-input" type="number" step={1} value={P[k] || '0'} onChange={e => set(k, String(Math.round(+e.target.value || 0)))} />
            </label>
          ))}
        </div>
      </Section>
    </div>
  );
}
