// Step 3 of 3: "Where's this going?" Pick your editor and Webimation picks the file type.
import { useEffect, useState } from 'react';
import { useApp } from '../App';
import { isDesktop } from '../desktop';
import { bounce, defaultDir, dragIcon, EDITORS, engineInfo, fileFor, FORMATS, lastExport, rememberExport, SIZES, type Editor, type Format, type Progress, type SizeId } from '../bounce';
import type { Scene } from '../types';

export function ExportDialog({ scene, name, onClose }: { scene: Scene; name: string; onClose: () => void }) {
  const { go, addClip, toast } = useApp();
  const last = lastExport();
  const [editor, setEditor] = useState<Editor>(last?.editor ?? 'premiere');
  const [size, setSize] = useState<SizeId>(last?.size ?? (scene.h > scene.w ? 'vertical' : '1080'));
  const [fps, setFps] = useState(last?.fps ?? 30);
  const [remember, setRemember] = useState(true);
  const [hevc, setHevc] = useState(false);
  const [small, setSmall] = useState(false);
  const [ff, setFf] = useState<boolean | null>(null);
  const [run, setRun] = useState<{ p: Progress | null; ctl: AbortController } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { engineInfo().then(i => setHevc(i.hevcAlpha)); if (isDesktop) import('@tauri-apps/api/core').then(m => m.invoke<string | null>('ffmpeg_status')).then(p => setFf(!!p)); else setFf(false); }, []);
  const format: Format = small && hevc && EDITORS[editor].format === 'prores' ? 'hevc' : EDITORS[editor].format;
  const needsFf = format !== 'png' && isDesktop;
  const effective: Format = isDesktop ? (needsFf && ff === false ? 'png' : format) : 'png';
  const f = FORMATS[effective], sz = SIZES[size];
  const fileName = f.ext ? `${name}.${f.ext}` : `${name} (PNG frames)`;
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !run) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, run]);

  async function make() {
    setErr(null);
    const ctl = new AbortController();
    setRun({ p: null, ctl });
    try {
      const dir = await defaultDir();
      const out = fileFor(dir, name, effective);
      const res = await bounce(scene, { format: effective, size, fps, out }, p => setRun(r => r && { ...r, p }), ctl.signal);
      if (remember) rememberExport({ editor, size, fps, format: effective });
      const chips = ['See-through background', `${sz.w} × ${sz.h}`, `${fps} fps`, `${+scene.dur.toFixed(1)} seconds`, f.label];
      const path = isDesktop ? res : res;
      if (isDesktop) await dragIcon(scene, path).catch(() => null);
      addClip({ path, name: fileName, at: Date.now(), chips, editor });
      go({ m: 'drop', path, name: fileName, chips, editor });
    } catch (e) {
      const m = String(e);
      if (!/cancel/i.test(m)) setErr(m.replace(/^Error: /, ''));
      setRun(null);
    }
  }

  return (
    <div className="modal-back" role="presentation" onClick={e => { if (e.target === e.currentTarget && !run) onClose(); }}>
      <div className="modal" role="dialog" aria-modal aria-labelledby="exp-h">
        <div className="modal-body">
          <p className="caps">Step 3 of 3</p>
          <h2 id="exp-h">Where's this going?</h2>
          <p className="lede">Pick your video editor and Webimation picks the right file type. The background stays see-through.</p>
          <div className="tiles five">
            {(Object.keys(EDITORS) as Editor[]).filter(e => e !== 'ae').map(e => (
              <button key={e} className={`tile${editor === e ? ' on' : ''}`} onClick={() => setEditor(e)} aria-pressed={editor === e}>
                <span className="ico" aria-hidden>▤</span><b>{EDITORS[e].name}</b><span>{FORMATS[EDITORS[e].format].note}</span>
              </button>
            ))}
          </div>
          <div className="two">
            <div>
              <h4>Shape and sharpness</h4>
              <div className="tiles three">
                {(['1080', '4k', 'vertical'] as SizeId[]).map(k => (
                  <button key={k} className={`tile${size === k ? ' on' : ''}`} onClick={() => setSize(k)} aria-pressed={size === k}>
                    <span className={`shape-ico ${k === 'vertical' ? 'v' : 'h'}`} aria-hidden /><b>{SIZES[k].label}</b><span>{SIZES[k].note}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h4>Frames per second</h4>
              <div className="fps">{[24, 25, 30, 60].map(n => <button key={n} className={fps === n ? 'on' : ''} onClick={() => setFps(n)} aria-pressed={fps === n}>{n}</button>)}</div>
              <p className="sub">Match your video project. Not sure? 30 is the safe pick.</p>
            </div>
          </div>
          {hevc && EDITORS[editor].format === 'prores' && <label className="check"><input type="checkbox" checked={small} onChange={e => setSmall(e.target.checked)} /> Smaller file (HEVC with transparency, Apple editors and Premiere on Mac)</label>}
          <div className="youget">
            <div><span className="sub">You'll get</span> <b>{fileName}</b></div>
            <div className="chips-row">{['See-through background', `${sz.w} × ${sz.h}`, `${fps}fps`, `${+scene.dur.toFixed(1)} seconds`, f.label].map(c => <span key={c} className="chip">{c}</span>)}</div>
            {!isDesktop && <p className="sub">In the browser you get a .zip of PNG frames. The desktop app writes real video files.</p>}
            {isDesktop && needsFf && ff === false && <p className="warn">ffmpeg isn't installed, so this will be PNG frames. Install it (<code>brew install ffmpeg</code>) for {FORMATS[format].label}.</p>}
          </div>
          <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Remember this, so next time exporting is one click</label>
          {err && <p className="warn" role="alert">{err}</p>}
        </div>
        <footer className="modal-foot">
          <button className="link" onClick={() => { onClose(); toast('Use Bounce in the Studio to export a timeline file'); go({ m: 'studio', tab: 'bounce' }); }}>Exporting graphics for a whole video? Make a timeline file instead</button>
          <span className="grow" />
          {run ? (
            <div className="progress-row">
              <div className="bar"><span style={{ width: `${run.p ? run.p.done / run.p.total * 100 : 2}%` }} /></div>
              <span className="mono">{run.p ? `${run.p.done}/${run.p.total} · ${run.p.fps.toFixed(0)} fps` : 'Starting…'}</span>
              <button className="btn" onClick={() => run.ctl.abort()}>Cancel</button>
            </div>
          ) : <>
            <button className="btn" onClick={onClose}>Back</button>
            <button className="btn-primary" onClick={make}>Make my clip</button>
          </>}
        </footer>
      </div>
    </div>
  );
}
