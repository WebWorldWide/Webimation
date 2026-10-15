import { Component, createRef, type CSSProperties, type ReactNode } from 'react';
import { ACC, BASE_REVEALS, castLength, createStage, LIBRARY, LIBRARY_TEMPLATES, presetName, SCENES, SHAPE, SHAPE_GROUPS, SHAPES, TEMPLATES, type Clip, type Stage } from '../engine';
import { CastPanel } from './CastPanel';
import { clamp, fmt, fmtS, FPS, INIT, LINES, TOTAL, WORDS } from './data';
import { isDesktop, isMac } from './desktop';
import { ExportPanel } from './ExportPanel';
import { Help, helpSeen } from './Help';
import { MotionLibrary } from './MotionLibrary';
import { ShapePanel } from './ShapePanel';
import { activeAt, compact, freeTrack, MAX_LAYERS, settle, shiftLayer, spanOf, stackOf, trackOf } from './stack';
import { StylePanel } from './StylePanel';
import { ThemeSwitch } from './ThemeSwitch';

interface Props { autoplay?: boolean; defaultReveal?: string; startZoom?: 1 | 2 | 4 }
type AddTab = 'graphics' | 'shapes' | 'characters';
type EditTab = 'content' | 'style' | 'motion' | 'export';
interface State {
  clips: Clip[]; selId: string | null; anchor: { t: number; w: string } | null; playing: boolean; guides: boolean;
  zoom: number; exporting: { name: string; p: number } | null;
  /** Footage shown under the stage so graphics can be placed on the real shot. */
  footage: { url: string; kind: 'video' | 'image'; name: string } | null;
  /** 'single' loops the selected graphic and anything stacked with it; 'timeline' plays the episode. */
  mode: 'timeline' | 'single'; banner: { title: string; sub: string } | null; library: boolean; help: boolean;
  add: AddTab; edit: EditTab;
}

const HAIR = '1px solid var(--line)';
const LANE = 40;
const mono = (size: number, color = 'var(--muted)'): CSSProperties => ({ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: size, color });
const nameOf = (c: Clip) => (c.tpl === 'shape' ? SHAPE[c.props.shape]?.name ?? 'Shape' : c.tpl === 'stick' ? c.props.scene || 'Characters' : TEMPLATES[c.tpl]?.name ?? c.tpl);
const SHAPE_LABEL: Record<string, string> = { double: '2.4×', leaderline: 'Look here', bubble: 'This is the trick', pin: 'Reykjavík', number: '1', bracket: 'First 48 h', tag: 'New', progress: '72%' };
/** Graphic accents as chrome colours: white reads as ink on light chrome. */
const chromeAcc = (id: string) => (id === 'white' ? 'var(--fg)' : ACC[id as keyof typeof ACC] || (/^#[0-9a-f]{6}$/i.test(id) ? id : ACC.orange));
const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
const newId = () => 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
/** The project is saved automatically on this computer and reopened next time. */
const SAVE_KEY = 'webimation.project.v1';
const loadClips = (): Clip[] | null => {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    return Array.isArray(v) && v.every(c => c && typeof c.id === 'string' && TEMPLATES[c.tpl] && typeof c.start === 'number' && typeof c.dur === 'number' && c.props && typeof c.props === 'object') ? v : null;
  } catch { return null; }
};

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button className="toggle" onClick={onClick} aria-pressed={on}>
      <span className="track"><span className="knob" style={{ left: on ? 16 : 2, background: on ? 'var(--hi)' : 'var(--knob-off)' }} /></span>{label}
    </button>
  );
}
function Tabs<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="tabs">
      {options.map(([id, label]) => <button key={id} role="tab" aria-selected={value === id} className={'ease' + (value === id ? ' on' : '')} onClick={() => onChange(id)}>{label}</button>)}
    </div>
  );
}
const Stepper = ({ label, value, dec, inc }: { label: string; value: ReactNode; dec: () => void; inc: () => void }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
    <span style={{ fontSize: 13, color: 'var(--label)' }}>{label}</span>
    <div style={{ display: 'flex', border: '1px solid var(--line-strong)' }}>
      <button className="btn-text" aria-label={`${label} down`} style={{ width: 30, padding: 0, fontSize: 15, color: 'var(--fg-2)' }} onClick={dec}>−</button>
      <span style={{ minWidth: 58, display: 'flex', alignItems: 'center', justifyContent: 'center', ...mono(12.5, 'var(--fg)'), borderLeft: '1px solid var(--line-strong)', borderRight: '1px solid var(--line-strong)' }}>{value}</span>
      <button className="btn-text" aria-label={`${label} up`} style={{ width: 30, padding: 0, fontSize: 15, color: 'var(--fg-2)' }} onClick={inc}>+</button>
    </div>
  </div>
);

export class Studio extends Component<Props, State> {
  state: State = {
    clips: loadClips() ?? INIT.map(c => ({ ...c, track: 0, props: { ...c.props } })), selId: loadClips() ? null : 'c3', anchor: null, playing: false, guides: false,
    zoom: this.props.startZoom ?? 4, exporting: null, footage: null, mode: 'timeline', banner: null, library: false, help: !helpSeen(),
    add: 'graphics', edit: 'content'
  };
  t = 27.8;
  /** Time inside the selected stack in single mode. */
  lt = 0;
  videoRef = createRef<HTMLVideoElement>(); fileRef = createRef<HTMLInputElement>(); clipRangeRef = createRef<HTMLInputElement>();
  RM = false; dead = false; dirty = true; prev = 0; raf = 0;
  stage: Stage | null = null;
  stageRef = createRef<HTMLDivElement>(); playRef = createRef<HTMLDivElement>(); tcRef = createRef<HTMLSpanElement>();
  tlRef = createRef<HTMLDivElement>(); scrollRef = createRef<HTMLDivElement>();
  onKey = (e: KeyboardEvent) => this.key(e);

  componentDidMount() {
    this.RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.dead = false;
    this.stage = createStage(this.stageRef.current!);
    window.addEventListener('keydown', this.onKey);
    this.prev = performance.now();
    const loop = (ts: number) => {
      const dt = Math.min(0.05, (ts - this.prev) / 1000);
      this.prev = ts;
      if (this.state.playing && this.state.mode === 'single') {
        const g = this.group();
        if (g) this.lt = (this.lt + dt) % (spanOf(g).end - spanOf(g).start + 0.4);
        this.draw();
      } else if (this.state.playing) {
        let t = this.t + dt;
        if (t >= TOTAL) t = 0;
        this.t = t; this.draw(); this.follow();
      } else if (this.dirty) { this.dirty = false; this.draw(); }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    if ((this.props.autoplay ?? true) && !this.RM) { this.t = 26.5; this.setState({ playing: true }); }
    requestAnimationFrame(() => this.follow(true));
    document.fonts?.ready.then(() => { this.dirty = true; });
    if (import.meta.env.DEV) {
      // Hooks for scripts/docs-screenshots.mjs: jump to an exact moment.
      const w = window as unknown as Record<string, unknown>;
      w.__webimationSeek = (t: number) => { this.setState({ playing: false }); this.seek(t); this.follow(true); };
      w.__webimationSingle = (t: number) => { this.setState({ playing: false }); this.lt = t; this.dirty = true; };
    }
  }
  componentDidUpdate(_: Props, ps: State) {
    this.dirty = true;
    if (ps.zoom !== this.state.zoom) requestAnimationFrame(() => this.follow(true));
    if (ps.clips !== this.state.clips) try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.state.clips)); } catch { /* storage full or blocked */ }
  }
  componentWillUnmount() { this.dead = true; cancelAnimationFrame(this.raf); window.removeEventListener('keydown', this.onKey); this.stage?.destroy(); }

  sel() { return this.state.clips.find(c => c.id === this.state.selId) || null; }
  sorted() { return [...this.state.clips].sort((a, b) => a.start - b.start || trackOf(a) - trackOf(b)); }
  /** The selected graphic plus everything stacked with it. */
  group() { const s = this.sel(); return s ? stackOf(this.state.clips, s) : null; }
  /** Global time being shown. */
  now() { const g = this.state.mode === 'single' && this.group(); return g ? spanOf(g).start + this.lt : this.t; }
  draw() {
    const single = this.state.mode === 'single', g = single ? this.group() : null, at = this.now();
    const pool = g ?? this.state.clips, items = activeAt(pool, at).map(c => ({ clip: c, t: this.RM ? Math.min(c.dur - 0.5, 2.4) : at - c.start }));
    // Over loaded footage, a 'clear' bottom graphic (or an empty frame) renders transparent so the shot shows through.
    const bottom = items[0]?.clip, transparent = !!this.state.footage && (!bottom || (bottom.props.field ?? TEMPLATES[bottom.tpl]?.field) === 'clear');
    this.stage?.showStack(items, { guides: this.state.guides, transparent });
    this.syncFootage(at);
    if (this.clipRangeRef.current && g) { const sp = spanOf(g); this.clipRangeRef.current.max = String(sp.end - sp.start); this.clipRangeRef.current.value = String(this.lt); }
    if (this.playRef.current) this.playRef.current.style.left = (this.t / TOTAL) * 100 + '%';
    if (this.tcRef.current) this.tcRef.current.textContent = fmt(single ? this.lt : this.t);
  }
  syncFootage(at: number) {
    const v = this.videoRef.current;
    if (!v || !v.duration) return;
    const want = at % v.duration;
    if (this.state.playing) {
      if (v.paused) v.play().catch(() => {});
      if (Math.abs(v.currentTime - want) > 0.2) v.currentTime = want;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - want) > 1 / 60) v.currentTime = want;
    }
  }
  loadFootage(f: File) {
    if (this.state.footage) URL.revokeObjectURL(this.state.footage.url);
    this.setState({ footage: { url: URL.createObjectURL(f), kind: f.type.startsWith('image') ? 'image' : 'video', name: f.name } });
  }
  follow(force?: boolean) {
    const sc = this.scrollRef.current;
    if (!sc) return;
    const x = (this.t / TOTAL) * sc.scrollWidth;
    if (force || x < sc.scrollLeft + 24 || x > sc.scrollLeft + sc.clientWidth - 24) sc.scrollLeft = x - sc.clientWidth * 0.25;
  }
  seek(t: number) { this.t = clamp(t, 0, TOTAL - 1 / FPS); this.dirty = true; }
  poster(c: Clip) { return this.state.playing ? c.start : c.start + Math.min(2.4, c.dur * 0.45); }
  select(id: string) { const c = this.state.clips.find(x => x.id === id); this.lt = 0; this.setState({ selId: id, anchor: null }); if (c) this.seek(this.poster(c)); }

  /** Add a graphic at time `at`. If something is already on screen there, it stacks on a new layer above. */
  add(tpl: string, at: number, extra: Record<string, string> = {}, dur?: number) {
    const T = TEMPLATES[tpl], d = dur ?? T.dur;
    const single = this.state.mode === 'single', sel = single ? this.sel() : null;
    // Single mode: new things join the selected stack, starting with it. With nothing selected they
    // start a fresh stack after everything else, so they don't land on top of existing graphics.
    const after = Math.max(0, ...this.state.clips.map(c => c.start + c.dur)) + 1;
    const want = sel ? sel.start : single ? (after + d <= TOTAL ? after : at) : at;
    const start = +clamp(want, 0, TOTAL - d).toFixed(2), id = newId();
    const track = freeTrack(this.state.clips, start, start + d);
    const clip: Clip = { id, tpl, start, dur: d, track, props: { ...T.d, accent: T.accent, field: T.field, reveal: this.props.defaultReveal ?? 'wipe', ...extra } };
    this.setState(s => ({ clips: [...s.clips, clip], selId: id, anchor: null, edit: 'content' }));
    if (!sel) this.seek(start);
    this.lt = 0;
    if (!this.state.playing) this.setState({ playing: !this.RM });
  }
  patch(fn: (c: Clip) => Clip) { const id = this.state.selId; this.setState(s => ({ clips: s.clips.map(c => (c.id === id ? fn(c) : c)) })); }
  setProp(k: string, v: string) { this.patch(c => ({ ...c, props: { ...c.props, [k]: v } })); }
  /** Set several props at once; `undefined` removes a prop (back to the default). */
  setProps(patch: Record<string, string | undefined>) {
    this.patch(c => {
      const props = { ...c.props };
      for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete props[k]; else props[k] = v; }
      return { ...c, props };
    });
  }
  setDur(dur: number) { const id = this.state.selId!; this.setState(s => ({ clips: settle(s.clips.map(c => (c.id === id ? { ...c, dur } : c)), id) })); }
  replay() { const c = this.sel(); if (!c) return; this.lt = c.start - (this.group() ? spanOf(this.group()!).start : c.start); this.seek(c.start); this.setState({ playing: true }); }
  remove() { const c = this.sel(); if (!c) return; this.setState(s => ({ clips: compact(s.clips.filter(x => x.id !== c.id)), selId: null })); }
  duplicate() {
    const c = this.sel();
    if (!c) return;
    const id = newId(), start = +clamp(c.start + c.dur + 0.5, 0, TOTAL - c.dur).toFixed(2);
    this.setState(s => ({ clips: settle([...s.clips, { ...c, id, start, props: { ...c.props } }], id), selId: id }));
    this.seek(this.poster({ ...c, start }));
  }
  step(dir: number) {
    const cs = this.sorted(), t = this.t + 0.001;
    const c = dir > 0 ? cs.find(x => x.start > t + 0.05) : [...cs].reverse().find(x => x.start < t - 0.3);
    if (c) this.select(c.id);
  }
  shuffleMotion() { const p = LIBRARY[Math.floor(Math.random() * LIBRARY.length)]; this.setProp('reveal', p.id); this.replay(); }
  key(e: KeyboardEvent) {
    if (this.state.library || this.state.help) return;
    const tg = (e.target as HTMLElement | null)?.tagName;
    if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
    const single = this.state.mode === 'single';
    if (e.code === 'Space') { e.preventDefault(); this.setState(s => ({ playing: !s.playing })); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && single) {
      e.preventDefault();
      const g = this.group();
      this.setState({ playing: false });
      if (g) this.lt = clamp(this.lt + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / FPS), 0, spanOf(g).end - spanOf(g).start);
      this.dirty = true;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.setState({ playing: false }); this.seek(this.t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / FPS)); this.follow(); }
    else if (e.key === '[' || e.key === ']') this.step(e.key === ']' ? 1 : -1);
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.sel()) { e.preventDefault(); this.remove(); } }
    else if (e.key === 'Escape') this.setState({ anchor: null });
    else if (e.key === 'm' || e.key === 'M') this.setState({ library: true });
    else if (e.key === '?') this.setState({ help: true });
  }
  /** Drag on the preview: moves the selected graphic if it's on screen, otherwise the top one. */
  stageDown = (e: React.PointerEvent) => {
    const on = activeAt(this.state.mode === 'single' ? this.group() ?? [] : this.state.clips, this.now()), s = this.sel();
    const c = s && on.includes(s) ? s : on[on.length - 1];
    if (e.button || !c) return;
    if (c.id !== this.state.selId) this.setState({ selId: c.id, anchor: null });
    const host = this.stageRef.current!, k = host.clientWidth / 1280, x0 = e.clientX, y0 = e.clientY;
    const shape = c.tpl === 'shape', kx = shape ? 'sx' : 'nx', ky = shape ? 'sy' : 'ny';
    const bx = parseFloat(c.props[kx]) || (shape ? 640 : 0), by = parseFloat(c.props[ky]) || (shape ? 360 : 0);
    let moved = false;
    const move = (ev: PointerEvent) => {
      let dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      this.setState(st => ({ clips: st.clips.map(cl => (cl.id === c.id ? { ...cl, props: { ...cl.props, [kx]: String(Math.round(bx + dx)), [ky]: String(Math.round(by + dy)) } } : cl)) }));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  scrubDown = (e: React.PointerEvent) => {
    if (e.button) return;
    const move = (ev: PointerEvent | React.PointerEvent) => { const r = this.tlRef.current!.getBoundingClientRect(); this.seek(((ev.clientX - r.left) / r.width) * TOTAL); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    move(e); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  /** Drag a clip sideways to retime it, up/down to change its layer, or its right edge to trim. */
  clipDown(id: string, mode: 'move' | 'trim', lanes: number) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      if (e.button) return;
      const c = this.state.clips.find(x => x.id === id)!, r = this.tlRef.current!.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      let moved = false;
      this.setState({ selId: id, anchor: null });
      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
        moved = true;
        const dx = ((ev.clientX - x0) / r.width) * TOTAL;
        if (mode === 'trim') { const dur = Math.round(clamp(c.dur + dx, 1, Math.min(30, TOTAL - c.start)) * 10) / 10; this.patch(k => ({ ...k, dur })); return; }
        const start = Math.round(clamp(c.start + dx, 0, TOTAL - c.dur) * 10) / 10;
        const track = clamp(trackOf(c) - Math.round((ev.clientY - y0) / LANE), 0, Math.min(MAX_LAYERS - 1, lanes - 1));
        this.patch(k => ({ ...k, start, track }));
        this.seek(start + Math.min(2.4, c.dur * 0.45));
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        if (!moved) this.seek(this.poster(c));
        else this.setState(s => ({ clips: settle(s.clips, id) }));
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
  }

  renderAdd() {
    const s = this.state, at = () => this.t;
    const row = (key: string, label: string, onClick: () => void) => <button key={key} className="add-row ease" onClick={onClick}>{label}</button>;
    return (
      <aside style={{ flex: '0 0 230px', minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRight: HAIR }}>
        <div style={{ padding: '14px 14px 0' }}>
          <Tabs value={s.add} onChange={v => this.setState({ add: v })} options={[['graphics', 'Graphics'], ['shapes', 'Shapes'], ['characters', 'Characters']]} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 0 16px' }}>
          {s.add === 'graphics' && LIBRARY_TEMPLATES.map(T => row(T.id, T.name, () => this.add(T.id, at())))}
          {s.add === 'shapes' && SHAPE_GROUPS.map(g => (
            <div key={g} style={{ padding: '6px 0' }}>
              <div className="caps" style={{ padding: '8px 20px 4px' }}>{g}</div>
              {SHAPES.filter(x => x.group === g).map(x => row(x.id, x.name, () => this.add('shape', at(), { shape: x.id, label: SHAPE_LABEL[x.id] ?? '' })))}
            </div>
          ))}
          {s.add === 'characters' && SCENES.map(sc => row(sc.id, sc.name, () => { const cast = sc.cast(); this.add('stick', at(), { cast: JSON.stringify(cast), scene: sc.name }, +(castLength(cast) + 0.3).toFixed(1)); }))}
        </div>
      </aside>
    );
  }

  renderTimeline() {
    const s = this.state, cs = this.sorted();
    const lanes = Math.min(MAX_LAYERS, Math.max(1, ...cs.map(c => trackOf(c) + 1)) + 1);
    const marks: { left: string; label: string }[] = [];
    const every = s.zoom >= 2 ? 10 : 30;
    for (let k = 0; k < TOTAL; k += every) marks.push({ left: (k / TOTAL) * 100 + '%', label: fmtS(k) });
    return (
      <div style={{ border: HAIR, background: 'var(--panel)' }}>
        <div ref={this.scrollRef} style={{ overflowX: 'auto', overflowY: 'hidden' }}>
          <div ref={this.tlRef} onPointerDown={this.scrubDown} style={{ position: 'relative', width: s.zoom * 100 + '%', minWidth: '100%', userSelect: 'none', touchAction: 'none' }}>
            <div style={{ position: 'relative', height: 22, borderBottom: HAIR }}>
              {marks.map((m, i) => <span key={i} style={{ position: 'absolute', left: m.left, top: 4, paddingLeft: 6, borderLeft: '1px solid var(--tick)', ...mono(10.5) }}>{m.label}</span>)}
            </div>
            {Array.from({ length: lanes }, (_, i) => lanes - 1 - i).map(tr => (
              <div key={tr} style={{ position: 'relative', height: LANE, borderBottom: '1px solid var(--line-soft)' }}>
                {cs.filter(c => trackOf(c) === tr).map(c => {
                  const on = c.id === s.selId, a = chromeAcc(c.props.accent);
                  return (
                    <div key={c.id} className="ease" onPointerDown={this.clipDown(c.id, 'move', lanes)} title={nameOf(c)}
                      style={{ position: 'absolute', top: 6, bottom: 6, left: (c.start / TOTAL) * 100 + '%', width: (c.dur / TOTAL) * 100 + '%', boxSizing: 'border-box', background: on ? mix(a, 30) : mix(a, 12), boxShadow: `inset 0 0 0 1px ${on ? a : mix(a, 45)}`, color: 'var(--fg)', display: 'flex', alignItems: 'center', padding: '0 10px', overflow: 'hidden', cursor: 'grab' }}>
                      <span style={{ fontSize: 12, fontWeight: on ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(c)}</span>
                      <span onPointerDown={this.clipDown(c.id, 'trim', lanes)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} />
                    </div>
                  );
                })}
              </div>
            ))}
            <div ref={this.playRef} style={{ position: 'absolute', top: 0, bottom: 0, width: 1, marginLeft: -0.5, background: 'var(--hi)', pointerEvents: 'none' }}><span style={{ position: 'absolute', left: -4, top: 0, width: 9, height: 9, background: 'var(--hi)' }} /></div>
          </div>
        </div>
      </div>
    );
  }

  renderTranscript() {
    const s = this.state, cs = this.sorted(), cover = (t: number) => activeAt(cs, t).at(-1);
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
        {s.anchor && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '10px 12px', background: 'var(--raised)', boxShadow: 'inset 0 0 0 1px var(--hi-line)' }}>
            <span style={{ fontSize: 14, color: 'var(--fg)', paddingRight: 8 }}>“{s.anchor.w}”</span>
            {LIBRARY_TEMPLATES.map(T => <button key={T.id} className="btn btn-sm ease" onClick={() => this.add(T.id, s.anchor ? s.anchor.t : this.t)}>{T.name}</button>)}
            <span style={{ flex: 1 }} />
            <button className="btn-text" onClick={() => this.setState({ anchor: null })}>Cancel</button>
          </div>
        )}
        {LINES.map(([t], i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '48px minmax(0,1fr)', gap: 12, padding: '5px 0' }}>
            <button className="tc-btn ease" onClick={() => { this.seek(t); this.follow(true); }}>{fmtS(t)}</button>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 0', fontSize: 15, lineHeight: 1.55 }}>
              {WORDS[i].map((wd, j) => {
                const isA = s.anchor && s.anchor.t === wd.t, cv = cover(wd.t);
                return (
                  <span key={j} className="word ease" onClick={() => { this.setState({ anchor: { t: wd.t, w: wd.w.replace(/[.,?!]$/, '') } }); this.seek(wd.t); this.follow(); }}
                    style={{ color: isA ? 'var(--panel)' : cv ? 'var(--fg)' : 'var(--fg-3)', background: isA ? 'var(--fg)' : 'transparent', boxShadow: `inset 0 -2px 0 ${!isA && cv ? chromeAcc(cv.props.accent) : 'transparent'}` }}>{wd.w}</span>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    );
  }

  renderInspector() {
    const s = this.state, sel = this.sel(), cs = this.sorted();
    if (!sel) return (
      <aside style={{ flex: '0 0 320px', minWidth: 0, overflowY: 'auto', background: 'var(--panel)', borderLeft: HAIR, padding: 20 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>Nothing selected.</p>
      </aside>
    );
    const T = TEMPLATES[sel.tpl], g = stackOf(s.clips, sel), reveal = sel.props.reveal ?? 'wipe', base = BASE_REVEALS.some(b => b[0] === reveal);
    const name = (c: Clip) => `${String(cs.indexOf(c) + 1).padStart(2, '0')} ${nameOf(c)}`;
    const fields = T.fields.filter(([k]) => sel.tpl !== 'shape' || (k === 'label' && SHAPE[sel.props.shape]?.label));
    return (
      <aside style={{ flex: '0 0 320px', minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderLeft: HAIR }}>
        <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: "'Instrument Serif',serif", fontSize: 30, lineHeight: 1.05, color: 'var(--fg)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(sel)}</span>
            <span style={mono(11.5)}>{fmtS(sel.start)}</span>
          </div>
          <Tabs value={s.edit} onChange={v => this.setState({ edit: v })} options={[['content', 'Content'], ['style', 'Style'], ['motion', 'Motion'], ['export', 'Export']]} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {s.edit === 'content' && (
            <section style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {sel.tpl === 'stick' && <CastPanel props={sel.props} set={(k, v) => this.setProp(k, v)} time={this.now() - sel.start} fit={d => this.setDur(Math.min(30, d))} />}
              {sel.tpl === 'shape' && <ShapePanel props={sel.props} set={(k, v) => this.setProp(k, v)} setMany={p => this.setProps(p)} />}
              {fields.map(([k, label]) => (
                <label key={sel.id + k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontSize: 12.5, color: 'var(--label)' }}>{label}</span><input className="field-input ease" value={sel.props[k] ?? ''} onChange={e => this.setProp(k, e.target.value)} /></label>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 14, borderTop: HAIR }}>
                <Stepper label="Length" value={`${sel.dur.toFixed(1)} s`} dec={() => this.setDur(Math.max(1, +(sel.dur - 0.5).toFixed(1)))} inc={() => this.setDur(Math.min(30, TOTAL - sel.start, +(sel.dur + 0.5).toFixed(1)))} />
                <Stepper label="Layer" value={`${trackOf(sel) + 1}`} dec={() => this.setState(st => ({ clips: shiftLayer(st.clips, sel.id, -1) }))} inc={() => this.setState(st => ({ clips: shiftLayer(st.clips, sel.id, 1) }))} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm ease" onClick={() => this.replay()}>Replay</button>
                <button className="btn btn-sm ease" onClick={() => this.duplicate()}>Duplicate</button>
                <button className="btn-text" style={{ marginLeft: 'auto', color: 'var(--danger)' }} onClick={() => this.remove()}>Delete</button>
              </div>
            </section>
          )}
          {s.edit === 'style' && (
            <section style={{ padding: '6px 20px 20px' }}>
              <StylePanel props={{ ...T.d, accent: T.accent, field: T.field, ...sel.props }} set={(k, v) => this.setProp(k, v)} setMany={p => this.setProps(p)} />
            </section>
          )}
          {s.edit === 'motion' && (
            <section style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="seg">{BASE_REVEALS.map(([id, label]) => <button key={id} className={'ease' + (reveal === id ? ' on' : '')} onClick={() => { this.setProp('reveal', id); this.replay(); }}>{label}</button>)}</div>
              <button className="btn ease" style={{ height: 'auto', padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textTransform: 'none', letterSpacing: 0, fontSize: 13.5, fontStretch: '100%', ...(base ? {} : { borderColor: 'var(--hi-line)', background: 'var(--hi-wash)' }) }} onClick={() => this.setState({ library: true })}>
                <span>{base ? 'More animations' : presetName(reveal)}</span><span style={{ color: 'var(--muted)' }}>→</span>
              </button>
              <button className="btn-text" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => this.shuffleMotion()}>Surprise me</button>
            </section>
          )}
          {s.edit === 'export' && (
            <ExportPanel
              sel={{ clip: g.length > 1 ? g : sel, name: g.length > 1 ? `${name(g[0])} + ${g.length - 1}` : name(sel) }}
              all={cs.map(c => ({ clip: c, name: name(c) }))}
              onLog={() => {}}
              onDone={(title, sub) => this.setState({ banner: { title, sub } })}
              onStatus={st => this.setState({ exporting: st })}
            />
          )}
        </div>
      </aside>
    );
  }

  render() {
    const s = this.state, sel = this.sel(), g = s.mode === 'single' ? this.group() : null;
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--app)', overflow: 'hidden' }}>
        <header data-tauri-drag-region className={'titlebar' + (isDesktop && isMac ? ' mac-inset' : '')} style={{ minHeight: 52, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', background: 'var(--header)', borderBottom: HAIR }}>
          <span style={{ width: 20, height: 20, background: 'var(--hi)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 1L9 5L2 9Z" fill="#FFFFFF" /></svg></span>
          <div className="seg tight" role="group" aria-label="Workspace">
            {([['timeline', 'Timeline'], ['single', 'Single']] as const).map(([m, label]) => <button key={m} className={'ease' + (s.mode === m ? ' on' : '')} aria-pressed={s.mode === m} onClick={() => { this.lt = 0; this.setState({ mode: m }); }}>{label}</button>)}
          </div>
          <span style={{ flex: 1 }} />
          {s.exporting && <span style={mono(12, 'var(--fg-2)')}>Exporting {Math.floor(s.exporting.p * 100)}%</span>}
          <button className="btn btn-sm ease" onClick={() => this.setState({ library: true })}>Animations</button>
          <ThemeSwitch />
          <button className="btn btn-sm ease" aria-label="Help" title="Help" style={{ width: 28, padding: 0 }} onClick={() => this.setState({ help: true })}>?</button>
        </header>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {this.renderAdd()}

          <main className="col" style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: 20, background: 'var(--canvas)' }}>
            {s.banner && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--ok-wash)', boxShadow: 'inset 0 0 0 1px var(--ok-line)' }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}><b style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>{s.banner.title}</b><span style={{ ...mono(11.5, 'var(--fg-3)'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.banner.sub}</span></div>
                <button className="btn-text" aria-label="Dismiss" onClick={() => this.setState({ banner: null })}>×</button>
              </div>
            )}

            <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden', background: s.footage ? '#000' : '#111113', boxShadow: '0 0 0 1px var(--stage-ring)' }}>
              {s.footage?.kind === 'video' && <video ref={this.videoRef} src={s.footage.url} muted playsInline preload="auto" onLoadedMetadata={() => { this.dirty = true; }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
              {s.footage?.kind === 'image' && <img src={s.footage.url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
              <div ref={this.stageRef} onPointerDown={this.stageDown} style={{ position: 'absolute', inset: 0, cursor: 'move', touchAction: 'none' }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {s.mode === 'single' && <button className="btn btn-sm ease" onClick={() => { this.lt = 0; this.setState({ selId: null }); }}>New</button>}
              {s.mode === 'timeline' && <button className="icon-btn ease" aria-label="Previous" onClick={() => this.step(-1)}><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1.5V10.5M10.5 1.5L4 6L10.5 10.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" /></svg></button>}
              <button className="play-btn ease" aria-label="Play or pause" onClick={() => this.setState({ playing: !s.playing })}>
                {s.playing ? <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1H5V11H2ZM7 1H10V11H7Z" fill="currentColor" /></svg> : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 1L11 6L2.5 11Z" fill="currentColor" /></svg>}
              </button>
              {s.mode === 'timeline' && <button className="icon-btn ease" aria-label="Next" onClick={() => this.step(1)}><svg width="12" height="12" viewBox="0 0 12 12"><path d="M10 1.5V10.5M1.5 1.5L8 6L1.5 10.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" /></svg></button>}
              <span ref={this.tcRef} style={{ ...mono(14, 'var(--fg)'), padding: '0 8px', fontVariantNumeric: 'tabular-nums' }}>00:00:00</span>
              {s.mode === 'single' && g && (
                <input ref={this.clipRangeRef} className="range" style={{ flex: 1 }} type="range" min={0} step={1 / FPS} defaultValue={0} aria-label="Scrub"
                  onInput={e => { this.setState({ playing: false }); this.lt = +(e.target as HTMLInputElement).value; this.dirty = true; }} />
              )}
              <span style={{ flex: s.mode === 'single' && g ? 'none' : 1 }} />
              <button className="btn btn-sm ease" onClick={() => this.fileRef.current?.click()}>{s.footage ? 'Change video' : 'Add your video'}</button>
              {s.footage && <button className="btn-text" onClick={() => { URL.revokeObjectURL(s.footage!.url); this.setState({ footage: null }); }}>Remove</button>}
              <input ref={this.fileRef} type="file" accept="video/*,image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) this.loadFootage(f); e.target.value = ''; }} />
              <Toggle on={s.guides} label="Guides" onClick={() => this.setState({ guides: !s.guides })} />
              {s.mode === 'timeline' && (
                <div className="seg tight">
                  {([[1, 'Fit'], [2, '2×'], [4, '4×']] as const).map(([z, label]) => <button key={z} className={'ease' + (s.zoom === z ? ' on' : '')} onClick={() => this.setState({ zoom: z })}>{label}</button>)}
                </div>
              )}
            </div>

            {s.mode === 'timeline' && this.renderTimeline()}
            {s.mode === 'timeline' && this.renderTranscript()}
            {s.mode === 'single' && !sel && <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>Add something from the left.</p>}
          </main>

          {this.renderInspector()}
        </div>

        {s.library && (
          <MotionLibrary
            current={sel?.props.reveal ?? null}
            target={sel}
            onApply={sel ? id => { this.setProp('reveal', id); this.replay(); } : null}
            onClose={() => this.setState({ library: false })}
            onLog={() => {}}
          />
        )}
        {s.help && <Help onClose={() => this.setState({ help: false })} />}
      </div>
    );
  }
}
