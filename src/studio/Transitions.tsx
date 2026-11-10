import { useEffect, useRef, useState } from 'react';
import {
  DITHER_PRESETS, ditherFrame, ditherRaster, FIELD_PRESETS, fieldFrame, fieldRaster, MODE_LABEL, PALETTE_LABEL, prepareDither, RAMP_LABEL, SHAPE_LABEL, STYLE_LABEL,
  type DitherSpec, type FieldSpec
} from '../engine';
import { isDesktop } from './desktop';
import { exportFrames, ffmpegPath, FORMATS, FPS_OPTIONS, pickDestination, SIZES, slug, type ExportSettings, type FormatId, type SizeId } from './exporter';
import { onTick, RM } from './Preview';

type Item = { id: string; name: string; note: string } & ({ kind: 'field'; spec: FieldSpec } | { kind: 'glyph'; spec: DitherSpec });
const ITEMS: Item[] = [
  ...FIELD_PRESETS.map(p => ({ ...p, kind: 'field' as const })),
  ...DITHER_PRESETS.map(p => ({ ...p, kind: 'glyph' as const }))
];
const HOLD = 0.5;
const KEY = 'webimation.export.v1';
const ALPHA_FORMATS: FormatId[] = ['prores', 'png', 'webm'];
const LABEL: Record<FormatId, string> = { prores: 'ProRes', png: 'PNG', webm: 'WebM', mp4: 'MP4' };

const loadSettings = (): ExportSettings => {
  const d: ExportSettings = { format: 'prores', size: 1080, fps: 30, transparent: true };
  try { const s = { ...d, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; return ALPHA_FORMATS.includes(s.format) ? s : d; } catch { return d; }
};

/** Draw a transition at progress s onto a canvas (a stand-in picture shows the alpha). */
function paint(cv: HTMLCanvasElement, item: Item, s: number) {
  const ctx = cv.getContext('2d')!;
  if (item.kind === 'field') fieldFrame(ctx, cv.width, cv.height, s, item.spec); else ditherFrame(ctx, cv.width, cv.height, s, item.spec);
}

function Card({ item, on, onPick }: { item: Item; on: boolean; onPick: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null), [hover, setHover] = useState(false);
  useEffect(() => {
    const c = cv.current!;
    if (!hover || RM) { paint(c, item, 0.35); return; }
    const t0 = performance.now(), L = item.spec.dur + HOLD;
    return onTick(now => paint(c, item, Math.min(1, (((now - t0) / 1000) % L) / item.spec.dur)));
  }, [hover, item]);
  return (
    <button className="ease" onClick={onPick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 0, background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--fg)' }}>
      <div style={{ position: 'relative', aspectRatio: '16/9', background: 'linear-gradient(135deg,#3b4a5e,#7d8fa6 55%,#a9b6c7)', boxShadow: on ? '0 0 0 2px var(--hi)' : '0 0 0 1px var(--line)' }}>
        <canvas ref={cv} width={480} height={270} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{item.name}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{item.note}</span>
      </div>
    </button>
  );
}

const Row = ({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 11.5, color: 'var(--label)' }}>{label}</span>{note && <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{note}</span>}</div>
    {children}
  </div>
);
const Seg = <T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) => (
  <div className={'seg' + (options.length > 3 ? ' grid' : '')} style={options.length > 3 ? { gridTemplateColumns: 'repeat(3,minmax(0,1fr))' } : undefined}>
    {options.map(([id, l]) => <button key={id} className={'ease' + (value === id ? ' on' : '')} onClick={() => onChange(id)}>{l}</button>)}
  </div>
);
const Slider = ({ label, value, min, max, step, onChange, fmt = (v: number) => String(+v.toFixed(2)) }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) => (
  <Row label={label} note={fmt(value)}><input className="range" type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} /></Row>
);

export function Transitions({ initial, onClose, onDone }: { initial?: string; onClose: () => void; onDone: (title: string, sub: string) => void }) {
  const [item, setItem] = useState<Item>(() => ITEMS.find(i => i.id === initial) ?? ITEMS[0]);
  const [es, setEs] = useState<ExportSettings>(loadSettings);
  const [ff, setFf] = useState<string | null | undefined>(undefined);
  const [job, setJob] = useState<{ p: number; err?: string; done?: string } | null>(null);
  const cv = useRef<HTMLCanvasElement>(null), range = useRef<HTMLInputElement>(null), abort = useRef<AbortController | null>(null);
  const itemRef = useRef(item), t = useRef(0), playing = useRef(!RM);
  itemRef.current = item;
  useEffect(() => { ffmpegPath().then(setFf); prepareDither(); }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(es)); } catch { /* storage blocked */ } }, [es]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  useEffect(() => {
    let prev = performance.now();
    return onTick(now => {
      const it = itemRef.current, L = it.spec.dur + HOLD, dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      if (playing.current) t.current = (t.current + dt) % L;
      paint(cv.current!, it, Math.min(1, t.current / it.spec.dur));
      if (range.current) { range.current.max = String(L); range.current.value = String(t.current); }
    });
  }, []);

  const patch = (p: Partial<FieldSpec & DitherSpec>) => setItem(i => ({ ...i, spec: { ...i.spec, ...p } }) as Item);
  const blocked = FORMATS[es.format].video && !ff;
  const busy = !!job && job.p < 1 && !job.err && !job.done;

  const run = async () => {
    const dest = await pickDestination(es, item.name, false);
    if (!dest) return;
    abort.current = new AbortController();
    setJob({ p: 0 });
    const raster = (o: { width: number; height: number; fps: number }, f: (c: HTMLCanvasElement, i: number, n: number) => Promise<void> | void, sig?: AbortSignal) =>
      item.kind === 'field' ? fieldRaster(item.spec, o, f, sig) : ditherRaster(item.spec, o, f, sig);
    try {
      const out = await exportFrames(raster, { ...es, transparent: true }, dest, item.name, p => setJob({ p }), abort.current.signal);
      setJob({ p: 1, done: out });
      onDone(`Exported ${item.name}`, out);
    } catch (e) {
      setJob(e instanceof DOMException && e.name === 'AbortError' ? null : { p: 0, err: String(e instanceof Error ? e.message : e) });
    }
  };

  const spec = item.spec as FieldSpec & DitherSpec;
  return (
    <div role="dialog" aria-label="Transitions" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', background: 'var(--app)' }}>
      <header style={{ minHeight: 52, display: 'flex', alignItems: 'center', gap: 14, padding: '0 20px', background: 'var(--header)', borderBottom: '1px solid var(--line)' }}>
        <b style={{ fontSize: 15 }}>Transitions</b>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Dithered covers and reveals, exported with real transparency</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm ease" onClick={onClose}>Close</button>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 22, alignContent: 'start' }}>
          {ITEMS.map(it => <Card key={it.id} item={it.id === item.id ? item : it} on={it.id === item.id} onPick={() => { setItem(it); t.current = 0; }} />)}
        </div>
        <aside style={{ width: 380, flex: 'none', borderLeft: '1px solid var(--line)', background: 'var(--panel)', overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ position: 'relative', aspectRatio: '16/9', background: 'linear-gradient(135deg,#3b4a5e,#7d8fa6 55%,#a9b6c7)', boxShadow: '0 0 0 1px var(--stage-ring)' }}>
            <canvas ref={cv} width={760} height={428} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', imageRendering: 'pixelated' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-sm ease" onClick={() => { playing.current = !playing.current; }}>Play / pause</button>
            <input ref={range} className="range" type="range" min={0} max={item.spec.dur + HOLD} step={0.01} defaultValue={0} style={{ flex: 1 }} onChange={e => { playing.current = false; t.current = +e.target.value; }} />
          </div>

          <Row label="Direction"><Seg value={spec.mode} options={(Object.keys(MODE_LABEL) as (keyof typeof MODE_LABEL)[]).map(k => [k, MODE_LABEL[k]])} onChange={v => patch({ mode: v })} /></Row>
          {item.kind === 'field' ? (
            <>
              <Row label="Shape"><Seg value={spec.shape} options={(Object.keys(SHAPE_LABEL) as (keyof typeof SHAPE_LABEL)[]).map(k => [k, SHAPE_LABEL[k]])} onChange={v => patch({ shape: v })} /></Row>
              <Row label="Palette"><Seg value={spec.palette} options={(Object.keys(PALETTE_LABEL) as (keyof typeof PALETTE_LABEL)[]).map(k => [k, PALETTE_LABEL[k]])} onChange={v => patch({ palette: v })} /></Row>
              <Slider label="Pixel size" value={spec.block} min={2} max={12} step={1} onChange={v => patch({ block: v })} fmt={v => v + ' px'} />
              <Slider label="Stipple" value={spec.grain} min={0} max={0.4} step={0.01} onChange={v => patch({ grain: v })} />
              <Slider label="Halo reach" value={spec.halo} min={0.02} max={0.4} step={0.01} onChange={v => patch({ halo: v })} />
              <Slider label="Edge wobble" value={spec.wobble} min={0} max={1} step={0.05} onChange={v => patch({ wobble: v })} />
            </>
          ) : (
            <>
              <Row label="Sweep"><Seg value={spec.style} options={(Object.keys(STYLE_LABEL) as (keyof typeof STYLE_LABEL)[]).map(k => [k, STYLE_LABEL[k]])} onChange={v => patch({ style: v })} /></Row>
              <Row label="Glyphs"><Seg value={spec.ramp} options={(Object.keys(RAMP_LABEL) as (keyof typeof RAMP_LABEL)[]).map(k => [k, RAMP_LABEL[k]])} onChange={v => patch({ ramp: v })} /></Row>
              <Slider label="Cell size" value={spec.cell} min={6} max={40} step={1} onChange={v => patch({ cell: v })} fmt={v => v + ' px'} />
              <Slider label="Soft edge" value={spec.band} min={0.1} max={1} step={0.05} onChange={v => patch({ band: v })} />
              <Slider label="Shimmer" value={spec.flicker} min={0} max={30} step={1} onChange={v => patch({ flicker: v })} fmt={v => v + '/s'} />
            </>
          )}
          <Slider label="Length" value={spec.dur} min={0.4} max={4} step={0.1} onChange={v => patch({ dur: v })} fmt={v => v.toFixed(1) + ' s'} />
          {spec.mode === 'inout' && <Slider label="Hold covered" value={spec.hold} min={0} max={0.5} step={0.02} onChange={v => patch({ hold: v })} />}

          <div style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="seg">{ALPHA_FORMATS.map(f => <button key={f} className={'ease' + (es.format === f ? ' on' : '')} disabled={FORMATS[f].video && ff === null} onClick={() => setEs(x => ({ ...x, format: f }))}>{LABEL[f]}</button>)}</div>
            <div className="seg">{(Object.keys(SIZES) as unknown as SizeId[]).map(z => <button key={z} className={'ease' + (+es.size === +z ? ' on' : '')} onClick={() => setEs(x => ({ ...x, size: +z as SizeId }))}>{+z === 2160 ? '4K' : `${z}p`}</button>)}</div>
            <div className="seg">{FPS_OPTIONS.map(f => <button key={f} className={'ease' + (es.fps === f ? ' on' : '')} onClick={() => setEs(x => ({ ...x, fps: f }))}>{f}</button>)}</div>
            {blocked && <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{isDesktop ? 'Needs ffmpeg. Use PNG, or install ffmpeg and restart.' : 'Use PNG in the browser.'}</span>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary ease" style={{ flex: 1 }} disabled={blocked || busy} onClick={run}>{busy ? `Exporting ${Math.floor((job?.p ?? 0) * 100)}%` : 'Export transition'}</button>
              {busy && <button className="btn ease" onClick={() => abort.current?.abort()}>Cancel</button>}
            </div>
            {job?.err && <span className="mono" style={{ fontSize: 11.5, color: 'var(--danger)' }}>{job.err}</span>}
            {job?.done && <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)', wordBreak: 'break-all' }} title={slug(item.name)}>{job.done}</span>}
            <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>Drop it on a track above the cut. The covered middle hides the edit.</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
