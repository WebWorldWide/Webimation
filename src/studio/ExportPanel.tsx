import { useEffect, useRef, useState } from 'react';
import type { Clip } from '../engine';
import { isDesktop } from './desktop';
import { stackOf, spanOf } from './stack';
import { fcpxml, readme, xmeml, type TimelineItem } from './timelineXml';
import { exportClip, ffmpegPath, FORMATS, FPS_OPTIONS, inFolder, join, nameOf, pickDestination, SIZES, slug, type ExportSettings, type FormatId, type SizeId } from './exporter';

type Item = { clip: Clip | Clip[]; name: string };
interface Job { id: number; name: string; clip: Clip | Clip[]; s: ExportSettings; dest: string; p: number; status: 'wait' | 'run' | 'done' | 'error' | 'cancelled'; result?: string }
interface Props {
  /** The selected graphic, or its whole stack when other graphics overlap it. */
  sel: Item | null;
  all: Item[];
  /** Every clip on the timeline, for the one-click editor package. */
  clips: Clip[];
  project: string;
  onLog: (msg: string) => void;
  onDone: (title: string, sub: string) => void;
  onStatus: (s: { name: string; p: number } | null) => void;
}

const KEY = 'webimation.export.v1';
const load = (): ExportSettings => {
  try { return { format: 'prores', size: 1080, fps: 30, transparent: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { format: 'prores', size: 1080, fps: 30, transparent: true }; }
};
const LABEL: Record<FormatId, string> = { prores: 'ProRes', png: 'PNG', webm: 'WebM', mp4: 'MP4' };

export function ExportPanel({ sel, all, clips, project, onLog, onDone, onStatus }: Props) {
  const [s, setS] = useState<ExportSettings>(load);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [ff, setFf] = useState<string | null | undefined>(undefined);
  const running = useRef(false), abort = useRef<AbortController | null>(null), jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  useEffect(() => { ffmpegPath().then(setFf); }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ } }, [s]);

  const F = FORMATS[s.format], blocked = F.video && !ff;
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
        onDone(`Exported ${j.name}`, result);
      } catch (e) {
        const cancelled = e instanceof DOMException && e.name === 'AbortError';
        patch(j.id, { status: cancelled ? 'cancelled' : 'error', result: cancelled ? 'Cancelled' : String(e instanceof Error ? e.message : e) });
      }
      await new Promise(r => setTimeout(r, 0));
    }
    abort.current = null;
    running.current = false;
    onStatus(null);
  };

  const enqueue = async (items: Item[]) => {
    if (!items.length) return;
    const many = items.length > 1, dest = await pickDestination(s, items[0].name, many);
    if (!dest) return;
    const now = Date.now(), add: Job[] = items.map((it, i) => ({
      id: now + i, name: it.name, clip: it.clip, s: { ...s }, p: 0, status: 'wait',
      dest: dest === 'download' || (!many && F.video) ? dest : inFolder(dest, s, it.name)
    }));
    jobsRef.current = [...jobsRef.current, ...add];
    setJobs(jobsRef.current);
    pump();
  };

  /** One folder: every graphic (stacks rendered together) as transparent ProRes, plus timeline files
   *  that put each one at its place in Premiere / Resolve / Final Cut. */
  const exportPackage = async () => {
    if (!clips.length || running.current) return;
    const dir = await pickDestination({ ...s, format: 'png' }, project, true);
    if (!dir || dir === 'download') return;
    const ps: ExportSettings = { ...s, format: 'prores', transparent: true };
    const stacks: Clip[][] = [];
    for (const c of [...clips].sort((a, b) => a.start - b.start)) if (!stacks.some(g => g.includes(c))) stacks.push(stackOf(clips, c));
    const [w, h] = SIZES[ps.size], items: TimelineItem[] = [];
    const id = Date.now();
    running.current = true;
    abort.current = new AbortController();
    const job: Job = { id, name: `${project} · ${stacks.length} graphics`, clip: clips, s: ps, dest: dir, p: 0, status: 'run' };
    setJobs(js => [...js, job]);
    try {
      for (let i = 0; i < stacks.length; i++) {
        const g = stacks[i], { start, end } = spanOf(g), nm = g.length > 1 ? `${nameOf(g[0])} + ${g.length - 1}` : nameOf(g[0]);
        const file = `${String(i + 1).padStart(2, '0')}-${slug(nm)}.mov`;
        await exportClip(g, ps, join(dir, file), file, p => { patch(id, { p: (i + p) / stacks.length * 0.98 }); onStatus({ name: job.name, p: (i + p) / stacks.length }); }, abort.current.signal);
        items.push({ name: nm, file, start: Math.round(start * ps.fps), frames: Math.max(1, Math.round((end - start) * ps.fps)), lane: 0 });
      }
      const spec = { name: slug(project), dir, fps: ps.fps, width: w, height: h, items };
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      await Promise.all([
        writeTextFile(join(dir, `${spec.name}.fcpxml`), fcpxml(spec)),
        writeTextFile(join(dir, `${spec.name}.xml`), xmeml(spec)),
        writeTextFile(join(dir, 'README.txt'), readme(spec))
      ]);
      patch(id, { status: 'done', p: 1, result: dir });
      onDone(`Editor package ready · ${stacks.length} graphics`, dir);
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === 'AbortError';
      patch(id, { status: cancelled ? 'cancelled' : 'error', result: cancelled ? 'Cancelled' : String(e instanceof Error ? e.message : e) });
    }
    abort.current = null; running.current = false; onStatus(null);
  };

  return (
    <section style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="seg">{(Object.keys(FORMATS) as FormatId[]).map(id => <button key={id} className={'ease' + (s.format === id ? ' on' : '')} disabled={FORMATS[id].video && ff === null} style={FORMATS[id].video && ff === null ? { opacity: 0.4 } : undefined} onClick={() => set({ format: id })}>{LABEL[id]}</button>)}</div>
      <div className="seg">{(Object.keys(SIZES) as unknown as SizeId[]).map(z => <button key={z} className={'ease' + (+s.size === +z ? ' on' : '')} onClick={() => set({ size: +z as SizeId })}>{+z === 2160 ? '4K' : `${z}p`}</button>)}</div>
      <div className="seg">{FPS_OPTIONS.map(f => <button key={f} className={'ease' + (s.fps === f ? ' on' : '')} onClick={() => set({ fps: f })}>{f}</button>)}</div>
      {F.alpha && (
        <div className="seg">
          <button className={'ease' + (s.transparent ? ' on' : '')} onClick={() => set({ transparent: true })}>Transparent</button>
          <button className={'ease' + (!s.transparent ? ' on' : '')} onClick={() => set({ transparent: false })}>Background</button>
        </div>
      )}
      {blocked && <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>{isDesktop ? 'Needs ffmpeg. Use PNG, or install ffmpeg and restart.' : 'Use PNG in the browser.'}</span>}
      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button className="btn-primary ease" style={{ flex: 1 }} disabled={!sel || blocked} onClick={() => sel && enqueue([sel])}>Export</button>
        <button className="btn ease" disabled={!all.length || blocked || (!isDesktop && all.length > 1)} onClick={() => enqueue(all)}>All</button>
      </div>
      {isDesktop && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
          <button className="btn ease" disabled={!clips.length || !ff} onClick={exportPackage}>Export timeline for editor</button>
          <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>{ff ? 'Every graphic as transparent ProRes plus a timeline file for Premiere, Resolve and Final Cut, each already at its time.' : 'Needs ffmpeg.'}</span>
        </div>
      )}
      {jobs.slice().reverse().map(j => {
        const c = j.status === 'done' ? 'var(--ok)' : j.status === 'error' ? 'var(--danger)' : 'var(--hi)';
        return (
          <div key={j.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: '1px solid var(--line-soft)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg)' }}>{j.name}</span>
              {j.status === 'run' || j.status === 'wait'
                ? <button className="btn-text" style={{ height: 'auto', padding: 0 }} onClick={() => (j.status === 'run' ? abort.current?.abort() : patch(j.id, { status: 'cancelled', result: 'Cancelled' }))}>Cancel</button>
                : <span className="mono" style={{ fontSize: 11.5, color: c }}>{j.status === 'done' ? 'Done' : j.status === 'error' ? 'Failed' : 'Cancelled'}</span>}
            </div>
            {j.status !== 'done' && j.status !== 'cancelled' && <div style={{ height: 4, background: 'var(--wash-3)' }}><div style={{ height: '100%', width: j.p * 100 + '%', background: c }} /></div>}
            {(j.status === 'error' || j.status === 'done') && j.result && <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.result}>{j.result}</span>}
          </div>
        );
      })}
    </section>
  );
}
