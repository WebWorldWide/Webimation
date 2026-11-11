// Drop it in: one big tile to drag onto your timeline, plus three short steps for your editor.
import { useEffect, useState } from 'react';
import { Logo, Steps, useApp, type Route } from '../App';
import { isDesktop } from '../desktop';
import { EDITORS, reveal, startDrag, type Editor } from '../bounce';
import { Thumb } from '../ui/SceneView';

export function Drop({ r }: { r: Extract<Route, { m: 'drop' }> }) {
  const { go, quick, clips, toast } = useApp();
  const [tab, setTab] = useState<Editor>((r.editor as Editor) in EDITORS ? (r.editor as Editor) : 'premiere');
  const [dragging, setDragging] = useState(false);
  useEffect(() => setTab((r.editor as Editor) in EDITORS ? (r.editor as Editor) : 'premiere'), [r.editor]);
  const icon = r.path.replace(/(\.[a-z0-9]+)?$/i, '') + '.drag.png';
  const folder = r.path.replace(/[\\/][^\\/]*$/, '');
  return (
    <div className="quick">
      <header className="topbar"><div className="brand"><Logo /> Webimation</div><Steps at={4} /><nav className="top-actions" /></header>
      <main className="drop">
        <div className="ready"><span className="tick" aria-hidden>✓</span><div><h1>Your clip is ready</h1><p className="sub">Saved to {isDesktop ? folder.split(/[\\/]/).slice(-2).join(' › ') : 'your Downloads'}</p></div></div>
        <div className={`drag-tile${dragging ? ' dragging' : ''}`} onPointerDown={async () => { if (!isDesktop) return; setDragging(true); try { await startDrag(r.path, icon); } catch (e) { toast(String(e)); } finally { setDragging(false); } }}>
          {quick.value ? <Thumb scene={quick.value.scene} live className="drag-thumb" /> : <div className="drag-thumb sv checker-light" />}
          <div className="drag-info">
            <h2><span className="grip" aria-hidden>⠿</span> {isDesktop ? 'Drag this straight onto your timeline' : 'Your download has started'}</h2>
            <b>{r.name}</b>
            <div className="chips-row">{r.chips.map(c => <span key={c} className="chip">{c}</span>)}</div>
          </div>
        </div>
        <div className="row gap">
          {isDesktop && <button className="btn" onClick={() => reveal(r.path)}>Show in folder</button>}
          {isDesktop && <button className="btn" onClick={() => navigator.clipboard.writeText(r.path).then(() => toast('File path copied'))}>Copy file path</button>}
          <button className="btn" onClick={() => go({ m: 'make' })} disabled={!quick.value}>Change something</button>
          <span className="grow" />
          <button className="btn-primary" onClick={() => go({ m: 'pick' })}>Make another</button>
        </div>
        <section className="howto">
          <header><h3>How to use it</h3>
            <div className="tabs" role="tablist">{(['premiere', 'resolve', 'fcp', 'capcut'] as Editor[]).map(e => <button key={e} role="tab" aria-selected={tab === e} className={tab === e ? 'on' : ''} onClick={() => setTab(e)}>{EDITORS[e].name}</button>)}</div>
          </header>
          <ol className="howto-steps">{EDITORS[tab].steps.map((s, i) => <li key={i}><span className="n">{i + 1}</span>{s}</li>)}</ol>
        </section>
        {clips.length > 1 && (
          <section className="myclips"><h3>My clips</h3>
            <ul>{clips.slice(0, 12).map(c => <li key={c.path}><button className="link" onClick={() => go({ m: 'drop', ...c })}>{c.name}</button><span className="sub">{new Date(c.at).toLocaleString()}</span></li>)}</ul>
          </section>
        )}
      </main>
    </div>
  );
}
