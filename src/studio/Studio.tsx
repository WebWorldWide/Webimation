import { Component, createRef, type CSSProperties } from 'react';
import { ACC, BASE_REVEALS, createStage, getPreset, LIBRARY, LIBRARY_TEMPLATES, castLength, presetName, SCENES, SHAPE, SHAPE_GROUPS, SHAPES, TEMPLATES, type Clip, type Stage } from '../engine';
import { clamp, fmt, fmtS, FPS, INIT, LINES, now, pad, REVEAL_NOTE, TOTAL, WORDS } from './data';
import { isDesktop, isMac } from './desktop';
import { MotionLibrary } from './MotionLibrary';
import { CastPanel } from './CastPanel';
import { ExportPanel } from './ExportPanel';
import { ShapePanel } from './ShapePanel';
import { StylePanel } from './StylePanel';
import { ThemeSwitch } from './ThemeSwitch';

interface Props { autoplay?: boolean; defaultReveal?: string; startZoom?: 1 | 2 | 4 }
interface State {
  clips: Clip[]; selId: string | null; anchor: { t: number; w: string } | null; playing: boolean; guides: boolean; loop: boolean;
  zoom: number; exporting: { name: string; p: number } | null;
  /** Footage shown under the stage so graphics can be placed and sized on the real shot. */
  footage: { url: string; kind: 'video' | 'image'; name: string } | null;
  /** 'single' loops one graphic on its own (one-off animations); 'episode' plays the timeline. */
  mode: 'episode' | 'single'; banner: { title: string; sub: string } | null; log: { time: string; msg: string }[]; library: boolean;
}

const HAIR = '1px solid var(--line)';
const capsLabel: CSSProperties = { fontSize: 10.5, fontWeight: 600, fontStretch: '78%', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--label)' };
const mono = (size: number, color = 'var(--muted)'): CSSProperties => ({ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: size, color });
const tplName = (c: Clip) => (c.tpl === 'shape' ? SHAPE[c.props.shape]?.name ?? 'Shape' : c.tpl === 'stick' ? c.props.scene || 'Stick figures' : TEMPLATES[c.tpl]?.name ?? c.tpl);
/** Starter labels for shapes that carry text. */
const SHAPE_LABEL: Record<string, string> = { double: '2.4×', leaderline: 'Look here', bubble: 'This is the trick', pin: 'Reykjavík', number: '1', bracket: 'First 48 h', tag: 'New', progress: 'Rendering · 72%' };
const isBase = (r: string | undefined) => BASE_REVEALS.some(b => b[0] === r);
/** Graphic accents as chrome colours: white reads as ink on light chrome. */
const chromeAcc = (id: string) => (id === 'white' ? 'var(--fg)' : ACC[id as keyof typeof ACC] || ACC.orange);
const onChromeAcc = (id: string) => (id === 'white' ? 'var(--panel)' : id === 'purple' ? '#FFFFFF' : '#0B0B0C');
const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button className="toggle" onClick={onClick} aria-pressed={on}>
      <span className="track"><span className="knob" style={{ left: on ? 16 : 2, background: on ? 'var(--hi)' : 'var(--muted)' }} /></span>{label}
    </button>
  );
}

export class Studio extends Component<Props, State> {
  state: State = {
    clips: INIT.map(c => ({ ...c, props: { ...c.props } })), selId: 'c3', anchor: null, playing: false, guides: true, loop: true,
    zoom: this.props.startZoom ?? 4, exporting: null, footage: null, mode: 'episode', banner: null, library: false,
    log: [{ time: now(), msg: 'Transcript synced · 16 lines' }, { time: now(), msg: 'Opened ep-001-final.mov' }]
  };
  t = 27.8;
  /** Local time inside the selected graphic in one-off mode. */
  lt = 0;
  videoRef = createRef<HTMLVideoElement>(); fileRef = createRef<HTMLInputElement>(); clipRangeRef = createRef<HTMLInputElement>();
  RM = false; dead = false; dirty = true; prev = 0; raf = 0; timer = 0;
  stage: Stage | null = null;
  stageRef = createRef<HTMLDivElement>(); playRef = createRef<HTMLDivElement>(); tcRef = createRef<HTMLSpanElement>();
  nowRef = createRef<HTMLSpanElement>(); tlRef = createRef<HTMLDivElement>(); scrollRef = createRef<HTMLDivElement>();
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
        const c = this.sel();
        if (c) this.lt = (this.lt + dt) % (c.dur + 0.4);
        this.draw();
      } else if (this.state.playing) {
        let t = this.t + dt;
        const c = this.sel();
        if (this.state.loop && c && this.t >= c.start && this.t < c.start + c.dur && t >= c.start + c.dur) t = c.start;
        if (t >= TOTAL) t = 0;
        this.t = t; this.draw(); this.follow();
      } else if (this.dirty) { this.dirty = false; this.draw(); }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    if ((this.props.autoplay ?? true) && !this.RM) { this.t = 26.5; this.setState({ playing: true }); }
    requestAnimationFrame(() => this.follow(true));
    document.fonts?.ready.then(() => { this.dirty = true; });
  }
  componentDidUpdate(_: Props, ps: State) { this.dirty = true; if (ps.zoom !== this.state.zoom) requestAnimationFrame(() => this.follow(true)); }
  componentWillUnmount() { this.dead = true; cancelAnimationFrame(this.raf); window.removeEventListener('keydown', this.onKey); this.stage?.destroy(); }

  sel() { return this.state.clips.find(c => c.id === this.state.selId) || null; }
  sorted() { return [...this.state.clips].sort((a, b) => a.start - b.start); }
  active(t: number) { let r: Clip | null = null; for (const c of this.sorted()) if (t >= c.start && t < c.start + c.dur) r = c; return r; }
  draw() {
    const single = this.state.mode === 'single', t = this.t, c = single ? this.sel() : this.active(t);
    const lt = c ? (this.RM ? Math.min(c.dur - 0.5, 2.4) : single ? this.lt : t - c.start) : 0;
    // Over loaded footage, 'clear' graphics (and empty frames) render transparent so the shot shows through.
    const transparent = !!this.state.footage && (!c || (c.props.field ?? TEMPLATES[c.tpl]?.field) === 'clear');
    this.stage?.show(c, lt, { guides: this.state.guides, transparent });
    this.syncFootage(single && c ? c.start + lt : t);
    if (this.clipRangeRef.current && c) { this.clipRangeRef.current.max = String(c.dur); this.clipRangeRef.current.value = String(lt); }
    if (this.playRef.current) this.playRef.current.style.left = (t / TOTAL) * 100 + '%';
    if (this.tcRef.current) this.tcRef.current.textContent = fmt(single ? lt : t);
    if (this.nowRef.current) this.nowRef.current.textContent = c ? `${pad(this.sorted().indexOf(c) + 1)} · ${tplName(c)} · ${presetName(c.props.reveal)}` : 'A-roll · no graphic';
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
    const kind = f.type.startsWith('image') ? 'image' : 'video';
    this.setState({ footage: { url: URL.createObjectURL(f), kind, name: f.name } });
    this.log(`Loaded footage ${f.name}`);
  }
  follow(force?: boolean) {
    const sc = this.scrollRef.current;
    if (!sc) return;
    const x = (this.t / TOTAL) * sc.scrollWidth;
    if (force || x < sc.scrollLeft + 24 || x > sc.scrollLeft + sc.clientWidth - 24) sc.scrollLeft = x - sc.clientWidth * 0.25;
  }
  seek(t: number) { this.t = clamp(t, 0, TOTAL - 1 / FPS); this.dirty = true; }
  poster(c: Clip) { return this.state.playing ? c.start : c.start + Math.min(2.4, c.dur * 0.45); }
  log(msg: string) { this.setState(s => ({ log: [{ time: now(), msg }, ...s.log].slice(0, 7) })); }
  select(id: string) { const c = this.state.clips.find(x => x.id === id); this.setState({ selId: id, anchor: null }); if (c) this.seek(this.poster(c)); }

  pin(tpl: string, at: number, extra: Record<string, string> = {}, dur?: number) {
    const T = TEMPLATES[tpl], d = dur ?? T.dur, start = +clamp(at, 0, TOTAL - d).toFixed(2), id = 'c' + Date.now().toString(36);
    const clip: Clip = { id, tpl, start, dur: d, props: { ...T.d, accent: T.accent, field: T.field, reveal: this.props.defaultReveal ?? 'wipe', ...extra } };
    this.setState(s => ({ clips: [...s.clips, clip], selId: id, anchor: null }));
    this.seek(start);
    if (!this.state.playing) this.setState({ playing: !this.RM });
    this.log(`Pinned ${tplName(clip)} at ${fmtS(start)}`);
  }
  patch(fn: (c: Clip) => Clip) { const id = this.state.selId; this.setState(s => ({ clips: s.clips.map(c => (c.id === id ? fn(c) : c)) })); }
  setProp(k: string, v: string) { this.patch(c => ({ ...c, props: { ...c.props, [k]: v } })); }
  /** Set several props at once; `undefined` removes a prop (back to the template/pairing default). */
  setProps(patch: Record<string, string | undefined>) {
    this.patch(c => {
      const props = { ...c.props };
      for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete props[k]; else props[k] = v; }
      return { ...c, props };
    });
  }
  replay() { const c = this.sel(); if (!c) return; this.lt = 0; this.seek(c.start); this.setState({ playing: true }); }
  remove() { const c = this.sel(); if (!c) return; this.setState(s => ({ clips: s.clips.filter(x => x.id !== c.id), selId: null })); this.log(`Removed ${tplName(c)}`); }
  duplicate() {
    const c = this.sel();
    if (!c) return;
    const id = 'c' + Date.now().toString(36), start = +clamp(c.start + c.dur + 0.5, 0, TOTAL - c.dur).toFixed(2);
    this.setState(s => ({ clips: [...s.clips, { ...c, id, start, props: { ...c.props } }], selId: id }));
    this.seek(this.poster({ ...c, start }));
    this.log(`Duplicated ${tplName(c)} to ${fmtS(start)}`);
  }
  step(dir: number) {
    const cs = this.sorted(), t = this.t + 0.001;
    const c = dir > 0 ? cs.find(x => x.start > t + 0.05) : [...cs].reverse().find(x => x.start < t - 0.3);
    if (c) this.select(c.id);
  }
  /** Random preset from the library, for the shuffle button. */
  shuffleMotion() {
    const p = LIBRARY[Math.floor(Math.random() * LIBRARY.length)];
    this.setProp('reveal', p.id); this.replay(); this.log(`Motion → ${p.name}`);
  }
  key(e: KeyboardEvent) {
    if (this.state.library) return;
    const tg = (e.target as HTMLElement | null)?.tagName;
    if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); this.setState(s => ({ playing: !s.playing })); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && this.state.mode === 'single') { e.preventDefault(); const c = this.sel(); this.setState({ playing: false }); if (c) this.lt = clamp(this.lt + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / FPS), 0, c.dur); this.dirty = true; }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.setState({ playing: false }); this.seek(this.t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / FPS)); this.follow(); }
    else if (e.key === '[' || e.key === ']') this.step(e.key === ']' ? 1 : -1);
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (this.sel()) { e.preventDefault(); this.remove(); } }
    else if (e.key === 'Escape') this.setState({ anchor: null });
    else if (e.key === 'm' || e.key === 'M') this.setState({ library: true });
  }
  /** Drag the graphic on the stage: moves shapes by their centre, other graphics by pixel nudge. */
  stageDown = (e: React.PointerEvent) => {
    const c = this.active(this.t);
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
      this.patch(cl => ({ ...cl, props: { ...cl.props, [kx]: String(Math.round(bx + dx)), [ky]: String(Math.round(by + dy)) } }));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) this.log(`Moved ${tplName(c)} on stage`); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  scrubDown = (e: React.PointerEvent) => {
    if (e.button) return;
    const move = (ev: PointerEvent | React.PointerEvent) => { const r = this.tlRef.current!.getBoundingClientRect(); this.seek(((ev.clientX - r.left) / r.width) * TOTAL); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    move(e); window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  clipDown(id: string, mode: 'move' | 'trim') {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      if (e.button) return;
      const c = this.state.clips.find(x => x.id === id)!, r = this.tlRef.current!.getBoundingClientRect(), x0 = e.clientX;
      let moved = false;
      this.setState({ selId: id, anchor: null });
      const move = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return;
        moved = true;
        const dx = ((ev.clientX - x0) / r.width) * TOTAL;
        if (mode === 'trim') { const dur = Math.round(clamp(c.dur + dx, 1, Math.min(30, TOTAL - c.start)) * 10) / 10; this.patch(k => ({ ...k, dur })); }
        else { const start = Math.round(clamp(c.start + dx, 0, TOTAL - c.dur) * 10) / 10; this.patch(k => ({ ...k, start })); this.seek(start + Math.min(2.4, c.dur * 0.45)); }
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const n = this.sel();
        if (!moved) this.seek(this.poster(c));
        else if (n) this.log(mode === 'trim' ? `Trimmed ${tplName(n)} to ${n.dur.toFixed(1)} s` : `Moved ${tplName(n)} to ${fmtS(n.start)}`);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
  }

  render() {
    const s = this.state, cs = this.sorted(), sel = this.sel(), idx = sel ? cs.indexOf(sel) : -1;
    const run = s.exporting;
    const ticks: { left: string; h: number; c: string }[] = [], marks: { left: string; label: string }[] = [];
    for (let k = 0; k <= TOTAL; k += 5) {
      const big = k % 30 === 0;
      ticks.push({ left: (k / TOTAL) * 100 + '%', h: big ? 10 : 5, c: big ? 'var(--tick-big)' : 'var(--tick)' });
      if (big && k < TOTAL) marks.push({ left: (k / TOTAL) * 100 + '%', label: fmtS(k) });
    }
    if (s.zoom >= 2) for (let k = 0; k < TOTAL; k += 10) if (k % 30) marks.push({ left: (k / TOTAL) * 100 + '%', label: fmtS(k) });
    const cover = (t: number) => cs.find(c => t >= c.start && t < c.start + c.dur);
    const reveal = sel?.props.reveal ?? 'wipe';
    const motionNote = sel ? (isBase(reveal) ? REVEAL_NOTE[reveal] : getPreset(reveal).blurb || '') : '';

    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--app)', overflow: 'hidden' }}>
        <header data-tauri-drag-region className={'titlebar' + (isDesktop && isMac ? ' mac-inset' : '')} style={{ minHeight: 56, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, padding: '0 20px', background: 'var(--header)', borderBottom: HAIR }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 22, height: 22, background: 'var(--hi)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1L9 5L2 9Z" fill="#FFFFFF" /></svg></span>
            <span style={{ fontSize: 13, fontWeight: 700, fontStretch: '90%', letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--fg)' }}>Webimation</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 26, padding: '0 10px', border: '1px solid var(--line-strong)', ...capsLabel, color: 'var(--fg-2)' }}>
            <span style={{ width: 7, height: 7, background: run ? 'var(--hi)' : 'var(--ok)' }} />
            <span>{run ? `Exporting · ${run.name} · ${Math.floor(run.p * 100)}%` : `Ep. 001 · ${s.clips.length} graphics · Saved`}</span>
          </div>
          <div className="seg tight" role="group" aria-label="Workspace">
            {([['episode', 'Episode'], ['single', 'One-off']] as const).map(([m, label]) => <button key={m} className={'ease' + (s.mode === m ? ' on' : '')} aria-pressed={s.mode === m} onClick={() => { this.lt = 0; this.setState({ mode: m }); }}>{label}</button>)}
          </div>
          <button className="btn btn-sm ease" onClick={() => this.setState({ library: true })} title="Motion library (M)">Motion library · {LIBRARY.length}</button>
          <span style={{ flex: 1 }} />
          <span style={mono(12)}>~/Videos/Web World Wide/ep-001-final.mov</span>
          <ThemeSwitch />
        </header>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <aside style={{ flex: '0 0 260px', minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderRight: HAIR }}>
            <section style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, borderBottom: HAIR }}>
              <span style={capsLabel}>Source</span>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{ width: 64, height: 36, flex: 'none', background: '#1E68F0', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.25)' }}><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1L9 5L2 9Z" fill="#FFFFFF" /></svg></span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <b style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25, color: 'var(--fg)' }}>Ep. 001 — Where the hours go</b>
                  <span style={mono(11.5)}>3:00 · 3840×2160 · 30 fps</span>
                  <span style={mono(11.5)}>{LINES.length} transcript lines</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
                <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>{s.footage ? <>Showing <span className="mono" style={{ color: 'var(--fg-2)' }}>{s.footage.name}</span> under the stage. Clear-field graphics render over it.</> : 'Load your footage to place and size graphics on the real shot. It stays on your computer.'}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm ease" onClick={() => this.fileRef.current?.click()}>{s.footage ? 'Replace footage' : 'Load footage…'}</button>
                  {s.footage && <button className="btn-text" onClick={() => { URL.revokeObjectURL(s.footage!.url); this.setState({ footage: null }); }}>Remove</button>}
                </div>
                <input ref={this.fileRef} type="file" accept="video/*,image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) this.loadFootage(f); e.target.value = ''; }} />
              </div>
            </section>
            <section style={{ padding: '20px 0 12px', borderBottom: HAIR }}>
              <div style={{ padding: '0 20px 12px', display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={capsLabel}>Library</span><span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Click to pin at playhead</span></div>
              {LIBRARY_TEMPLATES.map((T, i) => {
                const n = s.clips.filter(c => c.tpl === T.id).length;
                return (
                  <button key={T.id} className="lib-row ease" onClick={() => this.pin(T.id, this.t)}>
                    <span style={mono(11)}>{pad(i + 1)}</span><span style={{ fontSize: 14 }}>{T.name}</span>
                    <span style={mono(11, 'var(--hi-text)')}>{n ? '×' + n : ''}</span><span style={{ ...mono(11), textAlign: 'right' }}>{T.dur.toFixed(1)} s</span>
                  </button>
                );
              })}
            </section>
            <section style={{ padding: '20px 0 12px', borderBottom: HAIR }}>
              <div style={{ padding: '0 20px 12px', display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={capsLabel}>Shapes</span><span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{SHAPES.length} kinds</span></div>
              {SHAPE_GROUPS.map(g => (
                <div key={g} style={{ borderTop: '1px solid var(--line-soft)', padding: '8px 20px 10px' }}>
                  <div style={{ ...capsLabel, fontSize: 9.5, paddingBottom: 6 }}>{g}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {SHAPES.filter(x => x.group === g).map(x => <button key={x.id} className="btn btn-sm ease" title={x.blurb} onClick={() => this.pin('shape', this.t, { shape: x.id, label: SHAPE_LABEL[x.id] ?? '' })}>{x.name}</button>)}
                  </div>
                </div>
              ))}
            </section>
            <section style={{ padding: '20px 0 12px', borderBottom: HAIR }}>
              <div style={{ padding: '0 20px 12px', display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={capsLabel}>Stick figures</span><span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{SCENES.length} scenes</span></div>
              {SCENES.map(sc => (
                <button key={sc.id} className="lib-row ease" title={sc.blurb} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
                  onClick={() => { const cast = sc.cast(); this.pin('stick', this.t, { cast: JSON.stringify(cast), scene: sc.name }, +(castLength(cast) + 0.3).toFixed(1)); }}>
                  <span style={{ fontSize: 14 }}>{sc.name}</span><span style={{ ...mono(11), textAlign: 'right' }}>{castLength(sc.cast()).toFixed(1)} s</span>
                </button>
              ))}
            </section>
            <section style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ ...capsLabel, paddingBottom: 4 }}>Activity</span>
              {s.log.map((l, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 10, fontSize: 12.5, lineHeight: 1.45, paddingTop: 8, borderTop: '1px solid var(--line-soft)' }}>
                  <span style={mono(11.5)}>{l.time}</span><span style={{ color: 'var(--fg-3)' }}>{l.msg}</span>
                </div>
              ))}
            </section>
          </aside>

          <main className="col" style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, padding: 20, background: 'var(--canvas)' }}>
            {s.banner && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: 'var(--ok-wash)', border: '1px solid var(--ok-line)', boxShadow: 'inset 3px 0 0 var(--ok)' }}>
                <span style={{ width: 20, height: 20, flex: 'none', background: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6.5L5 9.5L10.5 3" fill="none" stroke="#FFFFFF" strokeWidth="2" /></svg></span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}><b style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{s.banner.title}</b><span style={mono(12, 'var(--fg-3)')}>{s.banner.sub}</span></div>
                <button className="icon-btn ease" style={{ background: 'transparent', border: 0, width: 32, height: 32, color: 'var(--muted)' }} aria-label="Dismiss" onClick={() => this.setState({ banner: null })}><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" /></svg></button>
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 18px' }}>
              <span style={capsLabel}>Preview</span>
              <span ref={this.nowRef} style={{ fontSize: 13, color: 'var(--fg-2)' }}>—</span>
              <span style={{ flex: 1 }} />
              <Toggle on={s.guides} label="Guides" onClick={() => this.setState({ guides: !s.guides })} />
              <Toggle on={s.loop} label="Loop clip" onClick={() => this.setState({ loop: !s.loop })} />
            </div>

            <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden', background: s.footage ? '#000' : '#111113', boxShadow: '0 0 0 1px var(--stage-ring)' }}>
              {s.footage?.kind === 'video' && <video ref={this.videoRef} src={s.footage.url} muted playsInline preload="auto" onLoadedMetadata={() => { this.dirty = true; }} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
              {s.footage?.kind === 'image' && <img src={s.footage.url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />}
              <div ref={this.stageRef} onPointerDown={this.stageDown} title="Drag to move the graphic" style={{ position: 'absolute', inset: 0, cursor: 'move', touchAction: 'none' }} />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <button className="icon-btn ease" aria-label="Previous graphic" onClick={() => this.step(-1)}><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1.5V10.5M10.5 1.5L4 6L10.5 10.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" /></svg></button>
              <button className="play-btn ease" aria-label="Play or pause" onClick={() => this.setState({ playing: !s.playing })}>
                {s.playing ? <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1H5V11H2ZM7 1H10V11H7Z" fill="currentColor" /></svg> : <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 1L11 6L2.5 11Z" fill="currentColor" /></svg>}
              </button>
              <button className="icon-btn ease" aria-label="Next graphic" onClick={() => this.step(1)}><svg width="12" height="12" viewBox="0 0 12 12"><path d="M10 1.5V10.5M1.5 1.5L8 6L1.5 10.5Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" /></svg></button>
              <span ref={this.tcRef} style={{ ...mono(15, 'var(--fg)'), padding: '0 4px 0 10px', fontVariantNumeric: 'tabular-nums' }}>00:00:00</span><span style={mono(13)}>/ {s.mode === 'single' && sel ? fmt(sel.dur) : '03:00:00'}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Space play · ← → frame · ⇧ 1 s · [ ] graphic · Del remove · M motion</span>
              <div className="seg tight">
                {([[1, 'Fit'], [2, '2×'], [4, '4×']] as const).map(([z, label]) => <button key={z} className={'ease' + (s.zoom === z ? ' on' : '')} onClick={() => this.setState({ zoom: z })}>{label}</button>)}
              </div>
            </div>

            {s.mode === 'single' ? (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, border: HAIR, background: 'var(--panel)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={capsLabel}>One-off · {sel ? tplName(sel) : 'nothing selected'}</span>
                  <span style={mono(11.5)}>{sel ? `${sel.dur.toFixed(1)} s · loops` : ''}</span>
                </div>
                {sel ? (
                  <input ref={this.clipRangeRef} className="range" type="range" min={0} max={sel.dur} step={1 / FPS} defaultValue={0} aria-label="Scrub graphic"
                    onInput={e => { this.setState({ playing: false }); this.lt = +(e.target as HTMLInputElement).value; this.dirty = true; }} />
                ) : null}
                <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>
                  Build a single animation without an episode: pick a graphic or shape from the left, style it in the inspector, drag it on the stage, then export it as ProRes 4444, WebM or PNG with a transparent background and drop it on a track in your editor.
                </span>
              </section>
            ) : (
              <>
            <div style={{ border: HAIR, background: 'var(--panel)' }}>
              <div ref={this.scrollRef} style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                <div ref={this.tlRef} onPointerDown={this.scrubDown} style={{ position: 'relative', width: s.zoom * 100 + '%', minWidth: '100%', userSelect: 'none', touchAction: 'none', cursor: 'default' }}>
                  <div style={{ position: 'relative', height: 24, borderBottom: HAIR }}>
                    {ticks.map((tk, i) => <span key={i} style={{ position: 'absolute', left: tk.left, bottom: 0, width: 1, height: tk.h, background: tk.c }} />)}
                    {marks.map((m, i) => <span key={i} style={{ position: 'absolute', left: m.left, top: 5, paddingLeft: 5, ...mono(10.5) }}>{m.label}</span>)}
                  </div>
                  <div style={{ position: 'relative', height: 52 }}>
                    {cs.map(c => {
                      const on = c.id === s.selId, a = chromeAcc(c.props.accent), ink = onChromeAcc(c.props.accent);
                      return (
                        <div key={c.id} className="ease" onPointerDown={this.clipDown(c.id, 'move')} title={`${tplName(c)} · ${presetName(c.props.reveal)}`}
                          style={{ position: 'absolute', top: 7, bottom: 7, left: (c.start / TOTAL) * 100 + '%', width: (c.dur / TOTAL) * 100 + '%', boxSizing: 'border-box', background: on ? a : mix(a, 14), boxShadow: `inset 0 0 0 1px ${on ? a : mix(a, 60)}`, color: on ? ink : 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 0 8px', overflow: 'hidden', cursor: 'grab' }}>
                          <span style={{ width: 6, height: 6, flex: 'none', background: on ? ink : a }} />
                          <span style={{ fontSize: 10.5, fontWeight: 600, fontStretch: '78%', letterSpacing: '.12em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tplName(c)}</span>
                          <span onPointerDown={this.clipDown(c.id, 'trim')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', boxShadow: `inset -2px 0 0 ${on ? ink : 'transparent'}` }} />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ position: 'relative', height: 16, borderTop: '1px solid var(--line-soft)' }}>
                    {LINES.map(([t], i) => <span key={i} style={{ position: 'absolute', left: (t / TOTAL) * 100 + '%', top: 4, width: ((((LINES[i + 1] || [TOTAL])[0] as number) - t) / TOTAL) * 100 + '%', height: 7, background: 'var(--lane)', boxShadow: 'inset 1px 0 0 var(--lane-edge)' }} />)}
                  </div>
                  <div ref={this.playRef} style={{ position: 'absolute', top: 0, bottom: 0, width: 1, marginLeft: -0.5, background: 'var(--hi)', pointerEvents: 'none' }}><span style={{ position: 'absolute', left: -4, top: 0, width: 9, height: 9, background: 'var(--hi)' }} /></div>
                </div>
              </div>
            </div>

            <section style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, borderBottom: HAIR, paddingBottom: 10 }}>
                <span style={capsLabel}>Transcript</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>Click a word to pin a graphic to it. Underlined words are covered.</span>
              </div>
              {s.anchor && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--raised)', border: '1px solid var(--hi-line)' }}>
                  <span style={{ ...capsLabel, color: 'var(--hi-text)' }}>Pin at {fmt(s.anchor.t)}</span><span style={{ fontSize: 14, color: 'var(--fg)', paddingRight: 6 }}>“{s.anchor.w}”</span>
                  {LIBRARY_TEMPLATES.map(T => <button key={T.id} className="btn btn-sm ease" onClick={() => this.pin(T.id, s.anchor ? s.anchor.t : this.t)}>{T.name}</button>)}
                  <span style={{ flex: 1 }} />
                  <button className="btn-text" onClick={() => this.setState({ anchor: null })}>Cancel · Esc</button>
                </div>
              )}
              <div>
                {LINES.map(([t], i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr)', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
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
              </div>
            </section>
              </>
            )}
          </main>

          <aside style={{ flex: '0 0 320px', minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', background: 'var(--panel)', borderLeft: HAIR }}>
            <section style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18, borderBottom: HAIR }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span style={capsLabel}>Inspector</span><span style={mono(11.5)}>{sel ? `${pad(idx + 1)} / ${pad(cs.length)}` : `— / ${pad(cs.length)}`}</span></div>
              {sel ? (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={{ fontFamily: "'Instrument Serif',serif", fontSize: 38, lineHeight: 1, color: 'var(--fg)' }}>{tplName(sel)}</span><span style={mono(11.5)}>IN {fmt(sel.start)} · OUT {fmt(sel.start + sel.dur)}</span></div>
                  {sel.tpl === 'stick' && <CastPanel props={sel.props} set={(k, v) => this.setProp(k, v)} time={this.state.mode === 'single' ? this.lt : this.t - sel.start} fit={d => this.patch(c => ({ ...c, dur: Math.min(30, d) }))} />}
                  {sel.tpl === 'shape' && <ShapePanel props={sel.props} set={(k, v) => this.setProp(k, v)} setMany={p => this.setProps(p)} />}
                  {TEMPLATES[sel.tpl].fields.filter(([k]) => sel.tpl !== 'shape' || (k === 'label' && SHAPE[sel.props.shape]?.label)).map(([k, label]) => (
                    <label key={sel.id + k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><span style={capsLabel}>{label}</span><input className="field-input ease" value={sel.props[k] ?? ''} onChange={e => this.setProp(k, e.target.value)} /></label>
                  ))}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><span style={capsLabel}>Reveal</span>
                    <div className="seg">{BASE_REVEALS.map(([id, label]) => <button key={id} className={'ease' + (reveal === id ? ' on' : '')} onClick={() => { this.setProp('reveal', id); this.replay(); }}>{label}</button>)}</div>
                    <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${isBase(reveal) ? 'var(--line-strong)' : 'var(--hi-line)'}` }}>
                      <button className="ease" onClick={() => this.setState({ library: true })} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '7px 10px', background: isBase(reveal) ? 'transparent' : 'var(--hi-wash)', border: 0, cursor: 'pointer', textAlign: 'left' }}>
                        <span style={{ ...capsLabel, color: isBase(reveal) ? 'var(--label)' : 'var(--hi-text)' }}>Motion preset</span>
                        <span style={{ fontSize: 13.5, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{isBase(reveal) ? `Browse ${LIBRARY.length} presets…` : presetName(reveal)}</span>
                      </button>
                      <button className="btn-text" aria-label="Random preset" title="Random preset" style={{ height: 'auto', borderLeft: '1px solid var(--line-strong)' }} onClick={() => this.shuffleMotion()}>Shuffle</button>
                    </div>
                    <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>{motionNote}</span>
                  </div>
                  <StylePanel props={{ ...TEMPLATES[sel.tpl].d, accent: TEMPLATES[sel.tpl].accent, field: TEMPLATES[sel.tpl].field, ...sel.props }} set={(k, v) => this.setProp(k, v)} setMany={p => this.setProps(p)} />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: HAIR, borderBottom: HAIR }}>
                    <span style={{ fontSize: 13, color: 'var(--label)' }}>Duration</span>
                    <div style={{ display: 'flex', border: '1px solid var(--line-strong)' }}>
                      <button className="btn-text" aria-label="Shorter" style={{ width: 30, padding: 0, fontSize: 15, color: 'var(--fg-2)' }} onClick={() => this.patch(c => ({ ...c, dur: Math.max(2, +(c.dur - 0.5).toFixed(1)) }))}>−</button>
                      <span style={{ minWidth: 62, display: 'flex', alignItems: 'center', justifyContent: 'center', ...mono(12.5, 'var(--fg)'), borderLeft: '1px solid var(--line-strong)', borderRight: '1px solid var(--line-strong)' }}>{sel.dur.toFixed(1)} s</span>
                      <button className="btn-text" aria-label="Longer" style={{ width: 30, padding: 0, fontSize: 15, color: 'var(--fg-2)' }} onClick={() => this.patch(c => ({ ...c, dur: Math.min(30, TOTAL - c.start, +(c.dur + 0.5).toFixed(1)) }))}>+</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button className="btn ease" onClick={() => this.replay()}>Replay</button>
                    <button className="btn ease" onClick={() => this.duplicate()}>Duplicate</button>
                    <button className="btn-danger ease" style={{ marginLeft: 'auto' }} onClick={() => this.remove()}>Remove</button>
                  </div>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--fg-3)', textWrap: 'pretty' }}>No graphic selected. Click a clip in the timeline, or click a word in the transcript to pin a new one there.</p>
              )}
            </section>

            <ExportPanel
              sel={sel ? { clip: sel, name: `${pad(idx + 1)} ${tplName(sel)}` } : null}
              all={cs.map((c, i) => ({ clip: c, name: `${pad(i + 1)} ${tplName(c)}` }))}
              onLog={m => this.log(m)}
              onDone={(title, sub) => this.setState({ banner: { title, sub } })}
              onStatus={st => this.setState({ exporting: st })}
            />
          </aside>
        </div>

        {s.library && (
          <MotionLibrary
            current={sel?.props.reveal ?? null}
            target={sel}
            onApply={sel ? id => { this.setProp('reveal', id); this.replay(); } : null}
            onClose={() => this.setState({ library: false })}
            onLog={msg => this.log(msg)}
          />
        )}
      </div>
    );
  }
}
