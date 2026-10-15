import { useEffect, useRef, useState } from 'react';
import type { Clip } from '../engine';
import { isDesktop } from './desktop';
import { exportClip, ffmpegPath, FORMATS, FPS_OPTIONS, inFolder, pickDestination, SIZES, type ExportSettings, type FormatId, type SizeId } from './exporter';

interface Job { id: number; name: string; clip: Clip; s: ExportSettings; dest: string; p: number; status: 'wait' | 'run' | 'done' | 'error' | 'cancelled'; result?: string }
interface Props {
  sel: { clip: Clip; name: string } | null;
  all: { clip: Clip; name: string }[];
  onLog: (msg: string) => void;
  onDone: (title: string, sub: string) => void;
  /** Lets the parent show export status in the header. */
  onStatus: (s: { name: string; p: number } | null) => void;
}

const KEY = 'webimation.export.v1';
const load = (): ExportSettings => {
  try { return { format: 'prores', size: 1080, fps: 30, transparent: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { format: 'prores', size: 1080, fps: 30, transparent: true }; }
};

export function ExportPanel({ sel, all, onLog, onDone, onStatus }: Props) {
  const [s, setS] = useState<ExportSettings>(load);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [ff, setFf] = useState<string | null | undefined>(undefined);
  const running = useRef(false), abort = useRef<AbortController | null>(null), jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  useEffect(() => { ffmpegPath().then(setFf); }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ } }, [s]);

  const F = FORMATS[s.format], videoBlocked = F.video && !ff;
  const set = (p: Partial<ExportSettings>) => setS(x => ({ ...x, ...p }));
  const patch = (id: number, p: Partial<Job>) => setJobs(js => js.map(j => (j.id === id ? { ...j, ...p } : j)));

  const pump = async () => {
    if (running.current) return;
    running.current = true;
    for (;;) {
      const j = jobsRef.current.find(x => x.status === 'wait');
      if (!j) break;
      patch(j.id, { status: 'run', p: 0 });
      abort.current = new AbortController();
      let last = 0;
      try {
        const result = await exportClip(j.clip, j.s, j.dest, j.name, p => {
          if (p - last > 0.01 || p >= 1) { last = p; patch(j.id, { p }); onStatus({ name: j.name, p }); }
        }, abort.current.signal);
        patch(j.id, { status: 'done', p: 1, result });
        onLog(`Exported ${j.name}`);
        onDone(`Export complete — ${j.name}`, result);
      } catch (e) {
        const cancelled = e instanceof DOMException && e.name === 'AbortError';
        patch(j.id, { status: cancelled ? 'cancelled' : 'error', result: cancelled ? 'Cancelled' : String(e instanceof Error ? e.message : e) });
        onLog(cancelled ? `Cancelled ${j.name}` : `Export failed: ${j.name}`);
      }
      // Let React commit the status before the next job is picked.
      await new Promise(r => setTimeout(r, 0));
    }
    abort.current = null;
    running.current = false;
    onStatus(null);
  };

  const enqueue = async (items: { clip: Clip; name: string }[]) => {
    if (!items.length) return;
    const many = items.length > 1, dest = await pickDestination(s, items[0].name, many);
    if (!dest) return;
    const now = Date.now(), add: Job[] = items.map((it, i) => ({
      id: now + i, name: it.name, clip: it.clip, s: { ...s }, p: 0, status: 'wait',
      dest: dest === 'download' || (!many && F.video) ? dest : inFolder(dest, s, many ? `${String(i + 1).padStart(2, '0')} ${it.name}` : it.name)
    }));
    jobsRef.current = [...jobsRef.current, ...add];
    setJobs(jobsRef.current);
    onLog(`Queued ${items.length > 1 ? `${items.length} graphics` : items[0].name} · ${F.label} ${SIZES[s.size][1]}p${s.fps}`);
    pump();
  };

  return (
    <section style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="caps">Export</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{SIZES[s.size][0]}×{SIZES[s.size][1]} · {s.fps} fps</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 1, background: 'var(--line)', border: '1px solid var(--line)' }}>
        {(Object.keys(FORMATS) as FormatId[]).map(id => {
          const X = FORMATS[id], on = s.format === id, off = X.video && ff === null;
          return (
            <button key={id} className="ease" onClick={() => set({ format: id })} title={off ? 'Needs ffmpeg (see below)' : X.note}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '9px 10px', background: on ? 'var(--primary)' : 'var(--panel)', color: on ? 'var(--primary-fg)' : 'var(--fg-2)', border: 0, cursor: 'pointer', textAlign: 'left', opacity: off && !on ? 0.5 : 1 }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, fontStretch: '78%', letterSpacing: '.12em', textTransform: 'uppercase' }}>{X.label}</span>
              <span className="mono" style={{ fontSize: 10.5, color: on ? 'var(--on-sub)' : 'var(--muted)' }}>{X.note}</span>
            </button>
          );
        })}
      </div>
      <div className="seg">{(Object.keys(SIZES) as unknown as SizeId[]).map(z => <button key={z} className={'ease' + (+s.size === +z ? ' on' : '')} onClick={() => set({ size: +z as SizeId })}>{z === 2160 || +z === 2160 ? '4K' : `${z}p`}</button>)}</div>
      <div className="seg">{FPS_OPTIONS.map(f => <button key={f} className={'ease' + (s.fps === f ? ' on' : '')} onClick={() => set({ fps: f })}>{f} fps</button>)}</div>
      <div className="seg">
        <button className={'ease' + (s.transparent && F.alpha ? ' on' : '')} disabled={!F.alpha} onClick={() => set({ transparent: true })}>Transparent</button>
        <button className={'ease' + (!s.transparent || !F.alpha ? ' on' : '')} onClick={() => set({ transparent: false })}>With field</button>
      </div>
      <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>
        {!F.alpha ? 'MP4 has no alpha channel, so the field is rendered. Use ProRes 4444 or PNG for overlays.'
          : s.transparent ? 'Background removed: drop it on a track above your footage in Premiere, Resolve, Final Cut or CapCut.'
          : 'The field is rendered as the background.'}
      </span>
      {videoBlocked && (
        <div style={{ padding: '10px 12px', background: 'var(--hi-wash)', boxShadow: 'inset 2px 0 0 var(--hi)', fontSize: 12, lineHeight: 1.5, color: 'var(--fg-2)' }}>
          {isDesktop
            ? <>Video export uses ffmpeg, which isn't installed. Install it (<span className="mono">brew install ffmpeg</span> · <span className="mono">winget install ffmpeg</span> · <span className="mono">sudo apt install ffmpeg</span>), then restart Webimation. PNG sequences work without it.</>
            : <>Video formats need the desktop app. In the browser, export a PNG sequence (.zip).</>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primary ease" style={{ flex: 1 }} disabled={!sel || videoBlocked} onClick={() => sel && enqueue([sel])}>Export graphic</button>
        <button className="btn ease" style={{ flex: 1 }} disabled={!all.length || videoBlocked || (!isDesktop && all.length > 1)} title={!isDesktop ? 'Batch export needs the desktop app' : undefined} onClick={() => enqueue(all)}>Export all · {all.length}</button>
      </div>
      {!jobs.length && <span style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing exported yet.</span>}
      {jobs.slice().reverse().map(j => {
        const c = j.status === 'done' ? 'var(--ok)' : j.status === 'error' ? 'var(--danger)' : 'var(--hi)';
        return (
          <div key={j.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg)' }}>{j.name}</span>
              <span className="mono" style={{ flex: 'none', fontSize: 11.5, color: j.status === 'done' ? 'var(--ok)' : j.status === 'error' ? 'var(--danger)' : j.status === 'run' ? 'var(--fg-2)' : 'var(--muted)' }}>
                {j.status === 'done' ? 'DONE' : j.status === 'error' ? 'FAILED' : j.status === 'cancelled' ? 'CANCELLED' : j.status === 'run' ? Math.floor(j.p * 100) + '%' : 'WAITING'}
              </span>
            </div>
            <div style={{ height: 10, boxSizing: 'border-box', border: '1px solid var(--line-strong)', padding: 1 }}>
              <div style={{ height: '100%', width: (Math.floor(j.p * 40) / 40) * 100 + '%', backgroundImage: `repeating-linear-gradient(90deg,${c} 0 6px,transparent 6px 8px)` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.result || j.dest}>
                {j.result || `${FORMATS[j.s.format].label} · ${SIZES[j.s.size][1]}p${j.s.fps}${j.s.transparent && FORMATS[j.s.format].alpha ? ' · alpha' : ''}`}
              </span>
              {(j.status === 'run' || j.status === 'wait') && <button className="btn-text" style={{ height: 'auto', padding: 0 }} onClick={() => (j.status === 'run' ? abort.current?.abort() : patch(j.id, { status: 'cancelled', result: 'Cancelled' }))}>Cancel</button>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
