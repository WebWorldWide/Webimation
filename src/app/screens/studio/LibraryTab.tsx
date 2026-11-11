// Library: every animation the engine can make, by shelf. Hover to play, click to preview.
import { useMemo, useState } from 'react';
import { addToProject, useApp } from '../../App';
import { preview, search, SHELVES, MOODS, type LibItem, type Mood, type Shelf } from '../../library';
import { clone } from '../../types';
import { Seg } from '../../ui/controls';
import { Thumb } from '../../ui/SceneView';
import type { StudioCtx } from '../Studio';

const SH_COLOR: Record<string, string> = { 'Pixel · Web World Wide': '#FF8A1F', 'Text animators': '#3D82FF', 'Glyph & ASCII': '#B48CFF', 'Dither & halftone': '#38B6FF', Transitions: '#F0507A', Titles: '#F4F4F5', 'Name tags': '#B48CFF', 'Arrows & callouts': '#F5C542', Shapes: '#FF8A1F', Numbers: '#22D37F', Lists: '#22D37F', 'Subscribe & social': '#F0507A', 'Backgrounds & loops': '#38B6FF', Scenes: '#3D82FF' };

export function LibraryTab({ c }: { c: StudioCtx }) {
  const { lib, favs, recents, byId, toggleFav, project, go, toast } = useApp();
  const [shelf, setShelf] = useState<Shelf | 'all' | 'favs' | 'recent' | 'project'>('all');
  const [q, setQ] = useState('');
  const [mood, setMood] = useState<Mood | 'any'>('any');
  const [flags, setFlags] = useState({ transparent: false, loops: false, text: false, short: false });
  const [pick, setPick] = useState<LibItem | null>(null);
  const [variation, setVariation] = useState(1);
  const [over, setOver] = useState<'sample' | 'selection'>('sample');
  const [sort, setSort] = useState<'shelf' | 'name'>('shelf');
  const filtered = useMemo(() => {
    let l = q ? search(lib, q) : lib;
    if (mood !== 'any') l = l.filter(i => i.mood.includes(mood));
    if (flags.transparent) l = l.filter(i => i.transparent);
    if (flags.loops) l = l.filter(i => i.loop);
    if (flags.text) l = l.filter(i => i.hasText);
    if (flags.short) l = l.filter(i => preview(i).dur <= 2);
    if (shelf === 'favs') l = l.filter(i => favs.includes(i.id));
    else if (shelf === 'recent') l = recents.map(id => byId.get(id)).filter((i): i is LibItem => !!i && l.includes(i));
    else if (shelf !== 'all' && shelf !== 'project') l = l.filter(i => i.shelf === shelf);
    if (sort === 'name') l = [...l].sort((a, b) => a.name.localeCompare(b.name));
    return l;
  }, [lib, q, mood, flags, shelf, favs, recents, byId, sort]);
  const counts = useMemo(() => Object.fromEntries(SHELVES.map(sh => [sh, lib.filter(i => i.shelf === sh).length])), [lib]);
  const groups = shelf === 'all' && !q ? SHELVES.map(sh => [sh, filtered.filter(i => i.shelf === sh)] as const).filter(g => g[1].length) : [[shelf === 'all' ? 'Results' : String(shelf), filtered] as const];
  const sel = c.s.objects.find(o => o.id === c.sel);
  const pv = pick ? (() => {
    const base = clone(preview(pick));
    base.seed = variation;
    base.objects.forEach(o => { if (o.kind.type === 'field') o.kind.field.seed = variation; });
    if (over === 'selection' && sel) { const m = base.objects[base.objects.length - 1]; return { ...c.s, objects: [{ ...clone(sel), start: 0, dur: 0, enter: m.enter, on: m.on, exit: m.exit, hidden: false }], dur: base.dur, bg: { kind: 'clear', color: '', color2: '' } }; }
    return base;
  })() : null;

  return (
    <div className="st-library">
      <aside className="lib-left">
        <p className="caps">Collections</p>
        <button className={shelf === 'favs' ? 'on' : ''} onClick={() => setShelf('favs')}>★ Favourites<span>{favs.length}</span></button>
        <button className={shelf === 'recent' ? 'on' : ''} onClick={() => setShelf('recent')}>Recent<span>{recents.length}</span></button>
        <p className="caps">Library</p>
        <button className={shelf === 'all' ? 'on' : ''} onClick={() => setShelf('all')}><i style={{ background: '#F4F4F5' }} />Everything<span>{lib.length}</span></button>
        {SHELVES.filter(sh => counts[sh]).map(sh => <button key={sh} className={shelf === sh ? 'on' : ''} onClick={() => setShelf(sh)}><i style={{ background: SH_COLOR[sh] }} />{sh}<span>{counts[sh]}</span></button>)}
      </aside>
      <main className="lib-main">
        <header><div><h1>Library</h1><p className="sub">Every animation works on text, shapes, pixel art or whole layers. Hover to play, click to preview.</p></div><span className="grow" /><span className="caps">Sort</span><Seg size="sm" value={sort} onChange={setSort} options={[['shelf', 'By shelf'], ['name', 'A–Z']]} /></header>
        <input className="st-input lib-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Try “glitchy title”, “ascii rain”, “arrow draw on”, “retro wipe”" aria-label="Search the library" />
        <div className="lib-filters">
          <span className="caps">Mood</span>
          <Seg size="sm" value={mood} onChange={setMood} options={[['any', 'Any'], ...MOODS.map(m => [m, m[0].toUpperCase() + m.slice(1)] as const)]} />
          {(['transparent', 'loops', 'text', 'short'] as const).map(f => <button key={f} className={`chip-b${flags[f] ? ' on' : ''}`} onClick={() => setFlags(x => ({ ...x, [f]: !x[f] }))}>{({ transparent: 'Transparent', loops: 'Loops', text: 'Has text', short: 'Under 2 s' })[f]}</button>)}
        </div>
        {groups.map(([name, items]) => (
          <section key={name} className="shelf">
            <header><i style={{ background: SH_COLOR[name] ?? '#3D82FF' }} /><h3>{name}</h3><span className="mono">{items.length}</span><span className="grow" />{shelf === 'all' && !q && items.length > 6 && <button className="link" onClick={() => setShelf(name as Shelf)}>See all</button>}</header>
            <div className="lib-grid">
              {(shelf === 'all' && !q ? items.slice(0, 6) : items.slice(0, 120)).map(i => (
                <button key={i.id} className={`lib-card${pick?.id === i.id ? ' on' : ''}`} onClick={() => { setPick(i); setVariation(1); }} onDoubleClick={() => { addToProject(project, i.make(), c.player.t); toast(`${i.name} added at the playhead`); }}>
                  <Thumb scene={preview(i)} checker={i.transparent ? 'light' : false} frame={i.transparent && !i.loop} className="lib-thumb" />
                  <span className="ln">{i.name}</span><span className="mono badge">{i.badge}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {!filtered.length && <p className="empty">Nothing matches. Try fewer filters.</p>}
      </main>
      <aside className="lib-right">
        <header><span className="caps">Preview</span><span className="live">LIVE · LOOP</span></header>
        {pick && pv ? <>
          <Thumb key={`${pick.id}-${variation}-${over}`} scene={pv} live checker={pick.transparent ? 'light' : false} frame={pick.transparent && !pick.loop && over === 'sample'} className="lib-preview" />
          <h2>{pick.name} <button className={`fav${favs.includes(pick.id) ? ' on' : ''}`} onClick={() => toggleFav(pick.id)} aria-label="Favourite">★</button></h2>
          <p className="sub">{pick.blurb}</p>
          <Seg size="sm" value={over} onChange={setOver} options={[['sample', 'Sample'], ['selection', sel ? `On ${sel.name}` : 'My selection']]} />
          <p className="caps">Variations</p>
          <div className="variations">{[1, 2, 3, 4, 5, 6].map(v => <button key={v} className={variation === v ? 'on' : ''} onClick={() => setVariation(v)}>{v}</button>)}</div>
          <p className="sub">Every variation is a new seed: same feel, different motion.</p>
          <span className="grow" />
          <button className="st-bounce wide" onClick={() => { const sc = clone(preview(pick)); sc.seed = variation; addToProject(project, sc, c.player.t); toast(`${pick.name} added at ${c.player.t.toFixed(1)} s`); go({ m: 'studio', tab: 'edit' }); }}>Add at playhead</button>
          <div className="row2b">
            <button className="btn-d" disabled={!sel} onClick={() => { if (!sel) return; const m = preview(pick).objects[preview(pick).objects.length - 1]; c.setObj(sel.id, o => ({ ...o, enter: m.enter, on: m.on, exit: m.exit })); toast(`Applied to ${sel.name}`); }}>Apply to selection</button>
            <button className="btn-d" disabled={!preview(pick).objects.some(o => o.kind.type === 'field')} onClick={() => { addToProject(project, preview(pick), c.player.t); go({ m: 'studio', tab: 'glyph' }); }}>Open in Glyph Lab</button>
          </div>
        </> : <p className="sub pad">Click any card to preview it here. Double-click adds it at the playhead.</p>}
      </aside>
    </div>
  );
}
