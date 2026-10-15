import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  allPresets, createStage, customPresets, defaultParams, deleteCustom, EASES, EFFECTS, FX, getPreset, GROUPS, mint,
  ORDER_LABEL, ORDERS, PRESET_GROUPS, sanitize, saveCustom, subscribe, type Clip, type EaseId, type FxRef, type Order, type Preset, type PresetGroup, type Stage
} from '../engine';
import { isDesktop, isMac, openText, saveText } from './desktop';
import { onTick, RM, specimenClip, Thumb } from './Preview';

interface Props {
  /** Reveal id of the selected graphic, if any. */
  current: string | null;
  /** The selected graphic, so the Lab can preview on the real thing. */
  target: Clip | null;
  onApply: ((presetId: string) => void) | null;
  onClose: () => void;
  onLog: (msg: string) => void;
}

const HOLD = 0.7;
const PRESET_FILES = { name: 'Webimation preset', extensions: ['json'] };
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const fmtT = (t: number) => t.toFixed(2).padStart(5, '0') + ' s';

function LabStage({ clip }: { clip: Clip }) {
  const host = useRef<HTMLDivElement>(null), range = useRef<HTMLInputElement>(null), tcRef = useRef<HTMLSpanElement>(null);
  const clipRef = useRef(clip), t = useRef(0), stage = useRef<Stage | null>(null);
  const [playing, setPlaying] = useState(!RM);
  const playRef = useRef(playing);
  clipRef.current = clip; playRef.current = playing;
  useEffect(() => {
    stage.current = createStage(host.current!);
    let prev = performance.now();
    const off = onTick(now => {
      const dt = Math.min(0.05, (now - prev) / 1000), c = clipRef.current, L = c.dur + HOLD;
      prev = now;
      if (playRef.current) t.current = (t.current + dt) % L;
      stage.current!.show(c, t.current, { guides: false });
      if (range.current) { range.current.max = String(L); range.current.value = String(t.current); }
      if (tcRef.current) tcRef.current.textContent = fmtT(t.current);
    });
    return () => { off(); stage.current?.destroy(); };
  }, []);
  useEffect(() => { t.current = 0; }, [clip.tpl, clip.motion?.id]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div ref={host} style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden', background: '#111113', boxShadow: '0 0 0 1px var(--stage-ring)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="play-btn" style={{ width: 38, height: 28 }} aria-label="Play or pause" onClick={() => setPlaying(p => !p)}>
          {playing
            ? <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1H5V11H2ZM7 1H10V11H7Z" fill="currentColor" /></svg>
            : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 1L11 6L2.5 11Z" fill="currentColor" /></svg>}
        </button>
        <input ref={range} className="range" type="range" min={0} step={1 / 60} defaultValue={0} aria-label="Scrub preview"
          onInput={e => { setPlaying(false); t.current = +(e.target as HTMLInputElement).value; }} />
        <span ref={tcRef} className="mono" style={{ fontSize: 12, color: 'var(--fg)', minWidth: 58, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>00.00 s</span>
      </div>
    </div>
  );
}

const Label = ({ children, note }: { children: ReactNode; note?: ReactNode }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
    <span className="caps">{children}</span>{note != null && <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{note}</span>}
  </div>
);

function Seg<T extends string | number>({ value, options, onChange, cols, label }: { value: T; options: readonly T[]; onChange: (v: T) => void; cols?: number; label?: (v: T) => string }) {
  return (
    <div className={'seg' + (cols ? ' grid' : '')} style={cols ? { gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` } : undefined}>
      {options.map(o => <button key={String(o)} className={'ease' + (o === value ? ' on' : '')} onClick={() => onChange(o)}>{label ? label(o) : String(o)}</button>)}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, unit = '×' }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Label note={unit === 's' ? value.toFixed(2) + ' s' : value.toFixed(2) + unit}>{label}</Label>
      <input className="range" type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} />
    </label>
  );
}

function FxEditor({ value, onChange, exitOnly }: { value: FxRef; onChange: (r: FxRef) => void; exitOnly?: boolean }) {
  const def = FX[value.fx];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select className="field-input" value={value.fx} onChange={e => onChange({ fx: e.target.value, p: defaultParams(FX[e.target.value]) })}>
        {GROUPS.map(g => {
          const fams = EFFECTS.filter(d => d.group === g && (!exitOnly || d.exit));
          return fams.length ? <optgroup key={g} label={g}>{fams.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup> : null;
        })}
      </select>
      {def.params.map(q => (
        <div key={q.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{q.label}</span>
          <Seg value={value.p[q.key] ?? q.options[0]} options={q.options} onChange={v => onChange({ ...value, p: { ...value.p, [q.key]: v } })} />
        </div>
      ))}
    </div>
  );
}

export function MotionLibrary({ current, target, onApply, onClose, onLog }: Props) {
  const custom = useSyncExternalStore(subscribe, customPresets);
  const [group, setGroup] = useState<PresetGroup | 'All'>('All');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Preset>(() => ({ ...getPreset(current || 'sig-broadcast') }));
  const [dirty, setDirty] = useState(false);
  const [on, setOn] = useState<'specimen' | 'graphic'>(target ? 'graphic' : 'specimen');
  const [hover, setHover] = useState<string | null>(null);
  const [animateAll, setAnimateAll] = useState(() => { try { return localStorage.getItem('webimation.library.animateAll') === '1'; } catch { return false; } });
  const toggleAll = (v: boolean) => { setAnimateAll(v); try { localStorage.setItem('webimation.library.animateAll', v ? '1' : '0'); } catch { /* storage blocked */ } };

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);

  const all = useMemo(() => allPresets(), [custom]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(p => (group === 'All' || p.group === group) && (!q || `${p.name} ${p.id} ${FX[p.enter.fx]?.name} ${p.blurb || ''}`.toLowerCase().includes(q)));
  }, [all, group, query]);

  const edit = (patch: Partial<Preset>) => { setDraft(d => ({ ...d, ...patch })); setDirty(true); };
  const load = (p: Preset) => { setDraft({ ...p }); setDirty(false); };
  const persist = (): Preset => {
    const saved = saveCustom({ ...draft, id: draft.custom ? draft.id : 'custom-' + Date.now().toString(36) });
    setDraft(saved); setDirty(false);
    return saved;
  };
  const apply = () => {
    if (!onApply) return;
    const id = dirty ? persist().id : draft.id;
    onApply(id);
    onLog(`Applied ${getPreset(id).name}`);
  };
  const exportJson = async () => {
    try {
      if (await saveText(`${draft.name.replace(/[^\w-]+/g, '-').toLowerCase()}.webimation.json`, JSON.stringify(draft, null, 2), PRESET_FILES)) onLog(`Exported ${draft.name}`);
    } catch (e) { onLog(`Export failed: ${e instanceof Error ? e.message : e}`); }
  };
  const importJson = async () => {
    const f = await openText(PRESET_FILES).catch(() => null);
    if (!f) return;
    try {
      const raw = JSON.parse(f.text), items = (Array.isArray(raw) ? raw : [raw]).map(sanitize).filter((p): p is Preset => !!p);
      items.forEach(p => saveCustom(p));
      if (items[0]) load(getPreset(items[0].id));
      onLog(items.length ? `Imported ${items.length} preset${items.length > 1 ? 's' : ''}` : `No valid presets in ${f.name}`);
    } catch { onLog(`Couldn't read ${f.name}`); }
  };

  const enterDef = FX[draft.enter.fx];
  const previewClip: Clip = on === 'graphic' && target ? { ...target, motion: draft } : specimenClip(draft);

  return (
    <div role="dialog" aria-label="Animations" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', background: 'var(--app)' }}>
      <header data-tauri-drag-region className={'titlebar' + (isDesktop && isMac ? ' mac-inset' : '')} style={{ minHeight: 56, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '0 20px', background: 'var(--header)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 22, height: 22, background: 'var(--hi)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1H9V9H1Z" fill="none" stroke="#FFFFFF" strokeWidth="2" /></svg></span>
          <span style={{ fontSize: 13, fontWeight: 700, fontStretch: '90%', letterSpacing: '.22em', textTransform: 'uppercase' }}>Animations</span>
        </div>
        <span style={{ flex: 1 }} />
        <input className="field-input" placeholder="Search" value={query} onChange={e => setQuery(e.target.value)} style={{ width: 220, height: 30 }} aria-label="Search" />
        <button className="toggle" aria-pressed={animateAll} onClick={() => toggleAll(!animateAll)}>
          <span className="track"><span className="knob" style={{ left: animateAll ? 16 : 2, background: animateAll ? 'var(--hi)' : 'var(--knob-off)' }} /></span>Play all
        </button>
        <button className="btn-text" onClick={onClose}>Close</button>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <aside style={{ width: 220, flex: 'none', overflowY: 'auto', background: 'var(--panel)', borderRight: '1px solid var(--line)', padding: '20px 0' }}>
          {(['All', ...PRESET_GROUPS] as const).map(g => (
            <button key={g} className={'group-btn ease' + (group === g ? ' on' : '')} onClick={() => setGroup(g)}>
              <span>{g}</span>
            </button>
          ))}
        </aside>

        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 20, background: 'var(--canvas)' }}>
          {list.length === 0
            ? <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-3)' }}>{group === 'Custom' && !query ? 'Nothing saved yet.' : 'No results.'}</p>
            : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 14 }}>
                {list.map(p => (
                  <button key={p.id} className={'tile ease' + (p.id === draft.id ? ' on' : '')} onClick={() => load(p)}
                    onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(h => (h === p.id ? null : h))} onFocus={() => setHover(p.id)} onBlur={() => setHover(h => (h === p.id ? null : h))} onDoubleClick={() => { load(p); if (onApply) { onApply(p.id); onLog(`Applied ${p.name}`); } }}>
                    <Thumb preset={p.id} playing={animateAll || hover === p.id} />
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '9px 10px 10px' }}>
                      <span style={{ fontSize: 13.5, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                      {p.id === current && <span aria-label="In use" style={{ color: 'var(--hi-text)', flex: 'none' }}>●</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
        </main>

        <aside style={{ width: 380, flex: 'none', overflowY: 'auto', background: 'var(--panel)', borderLeft: '1px solid var(--line)' }}>
          <section style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <input aria-label="Preset name" value={draft.name} onChange={e => edit({ name: e.target.value })}
              style={{ background: 'transparent', border: 0, borderBottom: '1px solid var(--line-strong)', padding: '0 0 6px', color: 'var(--fg)', fontFamily: "'Instrument Serif',serif", fontSize: 30, lineHeight: 1, outline: 'none' }} />
            <LabStage clip={previewClip} />
            {target && <Seg value={on} options={['specimen', 'graphic'] as const} onChange={setOn} label={v => (v === 'graphic' ? 'Your graphic' : 'Sample')} />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1 }} disabled={!onApply} onClick={apply}>Use this</button>
              <button className="btn" onClick={() => { load(mint(randomSeed())); setDirty(false); }}>Random</button>
            </div>
          </section>

          <details className="style-sec" style={{ padding: '4px 20px 20px', borderTop: '1px solid var(--line)' }}>
            <summary style={{ padding: '10px 0' }}><span className="caps">Customise</span></summary>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingTop: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Label>In</Label>
              <FxEditor value={draft.enter} onChange={r => edit({ enter: r, spread: undefined })} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Label>Out</Label>
              <Seg value={draft.exit ? 'other' : 'own'} options={['own', 'other'] as const} label={v => (v === 'own' ? 'Same' : 'Different')}
                onChange={v => edit({ exit: v === 'own' ? undefined : draft.exit ?? { fx: 'wipe', p: { dir: 'right' } } })} />
              {draft.exit && <FxEditor exitOnly value={draft.exit} onChange={r => edit({ exit: r })} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Label>Easing</Label>
              <Seg cols={3} value={draft.ease} options={Object.keys(EASES) as EaseId[]} label={v => EASES[v].label.replace('Quart ', '').replace('Stepped · ', 'Step ')} onChange={v => edit({ ease: v })} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Label>Order</Label>
              <Seg cols={3} value={draft.order} options={ORDERS} label={v => ORDER_LABEL[v as Order]} onChange={v => edit({ order: v })} />
            </div>
            <Slider label="Stagger" value={draft.spread ?? enterDef.spread ?? 0.5} min={0} max={0.95} step={0.01} unit="" onChange={v => edit({ spread: v })} />
            <Slider label="Spacing" value={draft.gap} min={0.3} max={2.5} step={0.05} onChange={v => edit({ gap: v })} />
            <Slider label="Length" value={draft.pace} min={0.3} max={2.5} step={0.05} onChange={v => edit({ pace: v })} />
            <Slider label="Out length" value={draft.exitDur} min={0.12} max={1.2} step={0.01} unit="s" onChange={v => edit({ exitDur: v })} />
            <Slider label="Out stagger" value={draft.exitGap} min={0} max={0.2} step={0.01} unit="s" onChange={v => edit({ exitGap: v })} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button className="btn btn-sm" onClick={() => { const s = persist(); onLog(`Saved preset ${s.name}`); }}>Save</button>
              <button className="btn btn-sm" onClick={exportJson}>Export</button>
              <button className="btn btn-sm" onClick={importJson}>Import</button>
              {draft.custom && <button className="btn-text" style={{ marginLeft: 'auto', color: 'var(--danger)' }} onClick={() => { deleteCustom(draft.id); onLog(`Deleted ${draft.name}`); load(getPreset('sig-broadcast')); }}>Delete</button>}
            </div>
          </section>
          </details>
        </aside>
      </div>
    </div>
  );
}
