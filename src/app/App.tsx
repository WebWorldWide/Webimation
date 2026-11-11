// Webimation. Quick mode (Pick → Make it yours → Drop it in) for anyone; the Animation Lab and
// Pixel Paint for people who know PowerPoint and Paint; the Studio (Edit, Draw, Library, Glyph Lab,
// Mix, Bounce) for everything else. One engine renders all of it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { startEngine } from './engine';
import { store, stored, useHistory } from './history';
import { buildLibrary, type LibItem } from './library';
import { AnimationLab } from './screens/AnimationLab';
import { Drop } from './screens/Drop';
import { Make } from './screens/Make';
import { Pick } from './screens/Pick';
import { PixelPaint } from './screens/PixelPaint';
import { Studio, type StudioTab } from './screens/Studio';
import { clone, scene, type Catalogue, type Scene } from './types';
import './app.css';

export type Route =
  | { m: 'pick' } | { m: 'make' } | { m: 'drop'; path: string; name: string; chips: string[]; editor: string }
  | { m: 'lab' } | { m: 'paint' } | { m: 'studio'; tab: StudioTab };

export interface Clip { path: string; name: string; at: number; chips: string[]; editor: string }
interface Quick { item: string; scene: Scene }

interface Ctx {
  cat: Catalogue; lib: LibItem[]; byId: Map<string, LibItem>;
  route: Route; go: (r: Route) => void;
  quick: ReturnType<typeof useHistory<Quick | null>>;
  project: ReturnType<typeof useHistory<Scene>>;
  recents: string[]; touch: (id: string) => void;
  favs: string[]; toggleFav: (id: string) => void;
  clips: Clip[]; addClip: (c: Clip) => void;
  openItem: (it: LibItem) => void;
  toast: (msg: string) => void;
}
const C = createContext<Ctx | null>(null);
export const useApp = () => useContext(C)!;

const PROJECT = 'webimation.project.v2', QUICK = 'webimation.quick.v2';
const blankProject = () => scene({ name: 'Episode 12', dur: 30 });

export function App() {
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { startEngine().then(setCat).catch(e => setErr(String(e))); }, []);
  if (err) return <div className="boot"><h1>Webimation couldn't start its engine</h1><p className="mono">{err}</p><p>Run <code>npm run engine</code> to build it, then reload.</p></div>;
  if (!cat) return <div className="boot"><div className="boot-mark" aria-hidden /><p>Starting the engine…</p></div>;
  return <Shell cat={cat} />;
}

/** Let the UI show each bundled font (style buttons, font pickers) from the same files the engine uses. */
function fontFaces(cat: Catalogue) {
  if (document.getElementById('w-fonts')) return;
  const st = document.createElement('style');
  st.id = 'w-fonts';
  st.textContent = cat.fonts.map(f => `@font-face{font-family:'w-${f.id}';src:url('${import.meta.env.BASE_URL}engine/fonts/${f.file}') format('truetype');font-display:swap}`).join('\n');
  document.head.appendChild(st);
}

function Shell({ cat }: { cat: Catalogue }) {
  useEffect(() => fontFaces(cat), [cat]);
  const lib = useMemo(() => buildLibrary(cat), [cat]);
  const byId = useMemo(() => new Map(lib.map(i => [i.id, i])), [lib]);
  const [route, setRoute] = useState<Route>(() => stored<Route>('webimation.route.v1', () => ({ m: 'pick' })));
  const go = useCallback((r: Route) => { setRoute(r); store('webimation.route.v1')(r.m === 'drop' ? { m: 'pick' } : r); window.scrollTo(0, 0); }, []);
  const quick = useHistory<Quick | null>(() => stored<Quick | null>(QUICK, () => null), store(QUICK));
  const project = useHistory<Scene>(() => stored<Scene>(PROJECT, blankProject), store(PROJECT));
  const [recents, setRecents] = useState<string[]>(() => stored('webimation.recents.v1', () => []));
  const [favs, setFavs] = useState<string[]>(() => stored('webimation.favs.v1', () => []));
  const [clips, setClips] = useState<Clip[]>(() => stored('webimation.clips.v1', () => []));
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const touch = useCallback((id: string) => setRecents(r => { const n = [id, ...r.filter(x => x !== id)].slice(0, 24); store('webimation.recents.v1')(n); return n; }), []);
  const toggleFav = useCallback((id: string) => setFavs(f => { const n = f.includes(id) ? f.filter(x => x !== id) : [id, ...f]; store('webimation.favs.v1')(n); return n; }), []);
  const addClip = useCallback((c: Clip) => setClips(cs => { const n = [c, ...cs.filter(x => x.path !== c.path)].slice(0, 50); store('webimation.clips.v1')(n); return n; }), []);
  const toast = useCallback((msg: string) => { const id = Date.now() + Math.random(); setToasts(t => [...t, { id, msg }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200); }, []);
  const openItem = useCallback((it: LibItem) => { quick.reset({ item: it.id, scene: it.make() }); touch(it.id); go({ m: 'make' }); }, [quick, touch, go]);
  const ctx: Ctx = { cat, lib, byId, route, go, quick, project, recents, touch, favs, toggleFav, clips, addClip, openItem, toast };

  // Global shortcuts that don't depend on the screen.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      const doc = route.m === 'make' ? quick : route.m === 'studio' || route.m === 'lab' ? project : null;
      if (mod && e.key.toLowerCase() === 'z' && doc) { e.preventDefault(); if (e.shiftKey) doc.redo(); else doc.undo(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [route.m, quick, project]);

  const dark = route.m === 'studio';
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  return (
    <C.Provider value={ctx}>
      <div className={`app ${dark ? 'dark' : 'light'}`}>
        {route.m === 'pick' && <Pick />}
        {route.m === 'make' && (quick.value ? <Make /> : <Pick />)}
        {route.m === 'drop' && <Drop r={route} />}
        {route.m === 'lab' && <AnimationLab />}
        {route.m === 'paint' && <PixelPaint />}
        {route.m === 'studio' && <Studio tab={route.tab} />}
        <div className="toasts" role="status" aria-live="polite">{toasts.map(t => <div key={t.id} className="toast">{t.msg}</div>)}</div>
      </div>
    </C.Provider>
  );
}

/** Put a scene into the shared Lab/Studio project (adding its objects on top of what's there). */
export function addToProject(project: Ctx['project'], s: Scene, at = 0) {
  project.set(p => {
    const maxOrder = Math.max(-1, ...p.objects.map(o => o.order));
    const objs = clone(s.objects).map((o, i) => ({ ...o, id: `${o.id}-${Date.now().toString(36)}${i}`, start: o.start + at, order: maxOrder + 1 + i, cue: 'manual' }));
    return { ...p, dur: Math.max(p.dur, at + s.dur), objects: [...p.objects, ...objs], screen: p.objects.length ? p.screen : s.screen, bg: p.objects.length ? p.bg : s.bg };
  });
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden shapeRendering="crispEdges">
      <rect width="16" height="16" fill="var(--hi, #1E68F0)" />
      <rect x="5" y="4" width="2" height="8" fill="#fff" /><rect x="7" y="5" width="2" height="6" fill="#fff" /><rect x="9" y="6" width="2" height="4" fill="#fff" /><rect x="11" y="7" width="1" height="2" fill="#fff" />
    </svg>
  );
}

export function Steps({ at }: { at: 1 | 2 | 3 | 4 }) {
  const s = ['Pick', 'Make it yours', 'Drop it in'];
  return (
    <ol className="steps" aria-label="Steps">
      {s.map((l, i) => <li key={l} className={i + 1 < at ? 'done' : i + 1 === at ? 'now' : ''} aria-current={i + 1 === at ? 'step' : undefined}><span className="n">{i + 1 < at ? '✓' : i + 1}</span>{l}</li>)}
    </ol>
  );
}
