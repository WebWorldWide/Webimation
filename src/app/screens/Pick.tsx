// Step 1: Pick. One page of animations playing on a checkerboard, plain-English filters, search,
// and a way back to what you were making.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Logo, Steps, useApp } from '../App';
import { preview, search, type LibItem, type Shelf } from '../library';
import { Thumb } from '../ui/SceneView';

const CHIPS: [string, (i: LibItem) => boolean][] = [
  ['Everything', () => true],
  ['Titles', i => i.shelf === 'Titles'], ['Name tags', i => i.shelf === 'Name tags'], ['Arrows & callouts', i => i.shelf === 'Arrows & callouts'],
  ['Numbers', i => i.shelf === 'Numbers'], ['Lists', i => i.shelf === 'Lists'], ['Subscribe & social', i => i.shelf === 'Subscribe & social'],
  ['Transitions', i => i.shelf === 'Transitions'], ['Pixel', i => i.shelf === 'Pixel · Web World Wide'], ['ASCII & glitch', i => i.shelf === 'Glyph & ASCII' || i.shelf === 'Dither & halftone'],
  ['Text effects', i => i.shelf === 'Text animators'], ['Shapes', i => i.shelf === 'Shapes'], ['Backgrounds', i => i.shelf === 'Backgrounds & loops'],
  ['Favourites', () => false]
];
/** "Everything" leads with the finished cards, then one of each kind so the page isn't 100 clouds. */
const FIRST: Shelf[] = ['Name tags', 'Arrows & callouts', 'Numbers', 'Lists', 'Subscribe & social', 'Titles'];

export function Pick() {
  const { lib, byId, recents, favs, toggleFav, openItem, go, quick, clips } = useApp();
  const [chip, setChip] = useState('Everything');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(48);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === '/' && document.activeElement !== box.current) { e.preventDefault(); box.current?.focus(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => setLimit(48), [chip, q]);
  const list = useMemo(() => {
    let l = q ? search(lib, q) : lib;
    if (chip === 'Favourites') l = l.filter(i => favs.includes(i.id));
    else if (chip !== 'Everything') l = l.filter(CHIPS.find(c => c[0] === chip)![1]);
    else if (!q) {
      const cards = l.filter(i => FIRST.includes(i.shelf));
      const seen = new Set<string>();
      const rest = l.filter(i => !FIRST.includes(i.shelf)).sort((a, b) => { const ka = seen.has(a.shelf), kb = seen.has(b.shelf); seen.add(a.shelf); seen.add(b.shelf); return Number(ka) - Number(kb); });
      // Round-robin the other shelves so every kind shows up early.
      const by = new Map<string, LibItem[]>(); for (const i of rest) by.set(i.shelf, [...(by.get(i.shelf) ?? []), i]);
      const mixed: LibItem[] = []; let more = true;
      for (let r = 0; more; r++) { more = false; for (const v of by.values()) if (v[r]) { mixed.push(v[r]); more = true; } }
      l = [...cards, ...mixed];
    }
    return l;
  }, [lib, q, chip, favs]);
  const last = quick.value && byId.get(quick.value.item);
  const words = quick.value?.scene.objects.map(o => o.kind.type === 'card' ? Object.values(o.kind.fields)[0] : o.kind.type === 'text' ? o.kind.text : '').find(Boolean);

  return (
    <div className="quick">
      <header className="topbar">
        <div className="brand"><Logo /> Webimation</div>
        <Steps at={1} />
        <nav className="top-actions">
          {clips.length > 0 && <button className="link" onClick={() => go({ m: 'drop', ...clips[0] })}>My clips</button>}
          <button className="btn" onClick={() => go({ m: 'lab' })}>Animation Lab</button>
          <button className="btn btn-dark" onClick={() => go({ m: 'studio', tab: 'edit' })}>Open Studio</button>
        </nav>
      </header>
      <main className="pick">
        <h1>What do you want to make?</h1>
        <p className="lede">Pick an animation, change the words, then drag it into Premiere, Resolve, Final Cut or CapCut. The background is already see-through.</p>
        <div className="search-row">
          <label className="search">
            <span aria-hidden>⌕</span>
            <input ref={box} value={q} onChange={e => setQ(e.target.value)} placeholder="Try “arrow”, “name”, “subscribe”, “countdown”, “ascii”…" aria-label="Search animations"
              onKeyDown={e => { if (e.key === 'Enter' && list[0]) openItem(list[0]); if (e.key === 'Escape') setQ(''); }} />
            {q && <span className="count">{list.length}</span>}
          </label>
          <p className="hint"><span className="checker-chip" aria-hidden /> Checkered means see-through: your video shows there.</p>
        </div>
        <div className="chips" role="tablist" aria-label="Kinds of animation">
          {CHIPS.filter(c => c[0] !== 'Favourites' || favs.length).map(([c]) => <button key={c} role="tab" aria-selected={chip === c} className={chip === c ? 'on' : ''} onClick={() => setChip(c)}>{c}</button>)}
        </div>
        {last && !q && chip === 'Everything' && (
          <button className="resume" onClick={() => go({ m: 'make' })}>
            <Thumb scene={quick.value!.scene} frame className="resume-thumb" />
            <span><b>Pick up where you left off</b><span>{last.name}{words ? `: “${words}”` : ''}</span></span>
            <span className="go">Open →</span>
          </button>
        )}
        {recents.length > 1 && !q && chip === 'Everything' && (
          <div className="recent-row" aria-label="Recently used">
            <span className="caps">Recent</span>
            {recents.slice(0, 8).map(id => byId.get(id)).filter(Boolean).map(i => <button key={i!.id} className="pill" onClick={() => openItem(i!)}>{i!.name}</button>)}
          </div>
        )}
        <div className="grid">
          {list.slice(0, limit).map(it => (
            <article key={it.id} className="card">
              <button className="card-hit" onClick={() => openItem(it)} aria-label={`${it.name}: ${it.blurb}`}>
                <Thumb scene={preview(it)} checker={it.transparent ? 'light' : false} frame={it.transparent && !it.loop} className="card-thumb" />
                <span className="card-name">{it.name}</span>
                <span className="card-blurb">{it.blurb}</span>
              </button>
              <button className={`fav${favs.includes(it.id) ? ' on' : ''}`} onClick={() => toggleFav(it.id)} aria-pressed={favs.includes(it.id)} aria-label={`Favourite ${it.name}`}>★</button>
            </article>
          ))}
        </div>
        {!list.length && <p className="empty">Nothing matches “{q}”. Try fewer words, or <button className="link" onClick={() => setQ('')}>see everything</button>.</p>}
        {list.length > limit && <div className="more-row"><button className="btn" onClick={() => setLimit(l => l + 48)}>Show more ({list.length - limit} left)</button></div>}
        <p className="foot">{lib.length} animations, all rendered live by the engine. Need something custom? Try the <button className="link" onClick={() => go({ m: 'lab' })}>Animation Lab</button> or <button className="link" onClick={() => go({ m: 'paint' })}>Pixel Paint</button>.</p>
      </main>
    </div>
  );
}
