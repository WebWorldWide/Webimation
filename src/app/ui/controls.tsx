// Small, consistent controls. Square corners, 1px lines, one highlight colour.
import { useId, type ReactNode } from 'react';

export function Seg<T extends string | number>({ value, options, onChange, size = 'md', wrap }: { value: T; options: readonly (readonly [T, ReactNode])[]; onChange: (v: T) => void; size?: 'sm' | 'md'; wrap?: boolean }) {
  return (
    <div className={`seg seg-${size}${wrap ? ' seg-wrap' : ''}`} role="radiogroup">
      {options.map(([v, label]) => <button key={String(v)} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, fmt, reset }: { label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string; reset?: number }) {
  const id = useId();
  return (
    <div className="slider">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} />
      <span className="mono val">{fmt ? fmt(value) : +value.toFixed(2)}</span>
      {reset !== undefined && <button className="reset" title="Reset" aria-label={`Reset ${typeof label === 'string' ? label : ''}`} onClick={() => onChange(reset)} disabled={value === reset}>↺</button>}
    </div>
  );
}

export function Swatches({ colors, value, onChange, allowCustom = true }: { colors: string[]; value: string; onChange: (c: string) => void; allowCustom?: boolean }) {
  return (
    <div className="swatches">
      {colors.map(c => <button key={c} className={`sw${value.toUpperCase() === c.toUpperCase() ? ' on' : ''}`} style={{ background: c }} title={c} aria-label={`Colour ${c}`} onClick={() => onChange(c)} />)}
      {allowCustom && <label className="sw sw-custom" title="Any colour"><input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={e => onChange(e.target.value.toUpperCase())} />+</label>}
    </div>
  );
}

export function Field({ label, value, onChange, placeholder, multiline }: { label: ReactNode; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea id={id} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} rows={4} spellCheck={false} /> : <input id={id} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}
    </div>
  );
}

export function Num({ label, value, onChange, step = 1, min, max, suffix }: { label: ReactNode; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  const id = useId();
  const clamp = (v: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
  return (
    <div className="num">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" value={+value.toFixed(3)} step={step} min={min} max={max} onChange={e => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(clamp(v)); }} />
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  );
}

export function Stepper({ value, onDec, onInc, label }: { value: ReactNode; onDec: () => void; onInc: () => void; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button onClick={onDec} aria-label={`Less ${label}`}>−</button><span>{value}</span><button onClick={onInc} aria-label={`More ${label}`}>+</button>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}><span className="knob" />{label}</button>;
}

export function Section({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return <section className="sec"><header><h3>{title}</h3>{aside}</header>{children}</section>;
}

export function Select<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label?: string }) {
  return <select className="select" aria-label={label} value={value} onChange={e => onChange(e.target.value as T)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}

export const fmtTime = (t: number, fps = 30) => { const s = Math.floor(t + 1e-6), f = Math.min(fps - 1, Math.round((t - s) * fps)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(f).padStart(2, '0')}`; };
