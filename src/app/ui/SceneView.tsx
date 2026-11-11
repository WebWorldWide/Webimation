// A live view of a scene, rendered by the engine. Only the newest frame request is ever pending,
// so scrubbing and playback stay responsive however heavy the scene is.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { bounds, onFonts, renderFrame, renderThumb } from '../engine';
import type { Scene } from '../types';

interface Props {
  scene: Scene;
  t: number;
  /** Max pixel width to render at (defaults to the element's size × devicePixelRatio, capped at 1920). */
  maxRes?: number;
  checker?: 'light' | 'dark' | false;
  className?: string;
  style?: CSSProperties;
  /** Overlays positioned in design pixels (0..scene.w, 0..scene.h). */
  children?: ReactNode;
  onPointerDown?: (p: { x: number; y: number }, e: React.PointerEvent) => void;
  onPointerMove?: (p: { x: number; y: number }, e: React.PointerEvent) => void;
  onPointerUp?: (p: { x: number; y: number }, e: React.PointerEvent) => void;
  thumb?: boolean;
  pixelated?: boolean;
}

export function SceneView({ scene, t, maxRes = 1920, checker = 'light', className, style, children, onPointerDown, onPointerMove, onPointerUp, thumb, pixelated }: Props) {
  const box = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const [cssW, setCssW] = useState(0);
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => onFonts(() => setFontTick(n => n + 1)), []);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setCssW(el.clientWidth));
    ro.observe(el); setCssW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const json = useMemo(() => JSON.stringify(scene), [scene]);
  const resW = Math.max(16, Math.min(maxRes, Math.round(cssW * Math.min(2, window.devicePixelRatio || 1))));
  const resH = Math.max(9, Math.round(resW * scene.h / scene.w));
  const busy = useRef(false), want = useRef<{ json: string; t: number; w: number; h: number } | null>(null);
  const pump = useCallback(() => {
    if (busy.current || !want.current) return;
    const job = want.current; want.current = null; busy.current = true;
    (thumb ? renderThumb : renderFrame)(job.json, job.t, job.w, job.h).then(img => {
      const c = cv.current;
      if (c) { if (c.width !== img.width || c.height !== img.height) { c.width = img.width; c.height = img.height; } c.getContext('2d')!.putImageData(img, 0, 0); }
    }).catch(() => {}).finally(() => { busy.current = false; pump(); });
  }, [thumb]);
  useEffect(() => { if (cssW > 0) { want.current = { json, t, w: resW, h: resH }; pump(); } }, [json, t, resW, resH, cssW, pump, fontTick]);

  const toDesign = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * scene.w, y: (e.clientY - r.top) / r.height * scene.h }; };
  return (
    <div ref={box} className={`sv ${checker ? `checker-${checker}` : ''} ${className ?? ''}`} style={{ aspectRatio: `${scene.w} / ${scene.h}`, ...style }}
      onPointerDown={onPointerDown && (e => onPointerDown(toDesign(e), e))} onPointerMove={onPointerMove && (e => onPointerMove(toDesign(e), e))} onPointerUp={onPointerUp && (e => onPointerUp(toDesign(e), e))}>
      <canvas ref={cv} style={{ imageRendering: pixelated ? 'pixelated' : 'auto' }} />
      {children && <svg className="sv-over" viewBox={`0 0 ${scene.w} ${scene.h}`} preserveAspectRatio="none">{children}</svg>}
    </div>
  );
}

/** Playback clock. Time is quantised to `fps`, loops over [0, dur). */
export function usePlayer(dur: number, fps = 30, autoplay = true) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [loop, setLoop] = useState(true);
  const raf = useRef(0), base = useRef({ wall: 0, t: 0 });
  const tRef = useRef(t); tRef.current = t;
  useEffect(() => {
    if (!playing) return;
    base.current = { wall: performance.now(), t: tRef.current >= dur - 1e-3 ? 0 : tRef.current };
    const tick = (now: number) => {
      let nt = base.current.t + (now - base.current.wall) / 1000;
      if (nt >= dur) { if (loop) { nt = nt % Math.max(dur, 1e-3); base.current = { wall: now, t: nt }; } else { setT(dur - 1 / fps); setPlaying(false); return; } }
      setT(Math.floor(nt * fps + 1e-4) / fps);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, dur, fps, loop]);
  useEffect(() => { if (t > dur) setT(0); }, [dur, t]);
  const seek = (v: number) => setT(Math.max(0, Math.min(dur - 1 / fps, Math.round(v * fps) / fps)));
  return { t, playing, loop, setLoop, seek, play: () => setPlaying(true), pause: () => setPlaying(false), toggle: () => setPlaying(p => !p), step: (n: number) => { setPlaying(false); seek(tRef.current + n / fps); } };
}

/** A library thumbnail: a still at rest, and the animation while hovered (or when `live`). */
const framed = new WeakMap<Scene, Promise<Scene>>();
/** The same scene with a camera on its content (padded, canvas aspect, never tighter than 30% wide). */
export function frameScene(s: Scene): Promise<Scene> {
  let p = framed.get(s);
  if (!p) {
    p = bounds(s).then(b => {
      const bs = Object.values(b).filter(r => r[2] > r[0] && r[3] > r[1]);
      if (!bs.length) return s;
      let [x0, y0, x1, y1] = bs.reduce((a, r) => [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])], [Infinity, Infinity, -Infinity, -Infinity]);
      const pad = Math.max(x1 - x0, (y1 - y0) * s.w / s.h) * 0.14;
      x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
      let w = Math.max(x1 - x0, (y1 - y0) * s.w / s.h, s.w * 0.3);
      w = Math.min(w, s.w);
      const h = w * s.h / s.w, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const vx = Math.max(0, Math.min(s.w - w, cx - w / 2)), vy = Math.max(0, Math.min(s.h - h, cy - h / 2));
      return w >= s.w * 0.98 ? s : { ...s, view: [vx, vy, w, h] as [number, number, number, number] };
    }).catch(() => s);
    framed.set(s, p);
  }
  return p;
}

export function Thumb({ scene: raw, live, className, checker = 'light', frame }: { scene: Scene; live?: boolean; className?: string; checker?: 'light' | 'dark' | false; frame?: boolean }) {
  const [scene, setScene] = useState(raw);
  useEffect(() => { setScene(raw); if (frame) { let ok = true; frameScene(raw).then(f => ok && setScene(f)); return () => { ok = false; }; } }, [raw, frame]);
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false), [hover, setHover] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const playing = live || hover;
  const [t, setT] = useState(() => restTime(scene));
  useEffect(() => {
    if (!playing) { setT(restTime(scene)); return; }
    let id = 0; const start = performance.now();
    const tick = () => { const nt = ((performance.now() - start) / 1000) % scene.dur; setT(Math.floor(nt * 15) / 15); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, scene]);
  return (
    <div ref={ref} className={className} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {seen ? <SceneView scene={scene} t={t} maxRes={playing ? 400 : 320} checker={checker} thumb /> : <div className={`sv checker-${checker || 'light'}`} style={{ aspectRatio: `${scene.w} / ${scene.h}` }} />}
    </div>
  );
}

/** A good still moment: everything in, nothing leaving. */
export function restTime(s: Scene) {
  if (!s.objects.length) return 0;
  // Cards stagger their parts internally, so give them the time their last part needs.
  const settle = Math.max(...s.objects.map(o => o.start + o.enter.delay + (o.enter.id === 'none' ? 0 : o.enter.dur) + (o.kind.type === 'card' ? Math.min(2.2, (o.dur || s.dur) * 0.45) : 0)));
  const leave = Math.min(...s.objects.map(o => { const end = o.dur > 0 ? o.start + o.dur : s.dur; return ['stay', 'none'].includes(o.exit.id) ? end : end - o.exit.dur; }));
  return Math.max(0, Math.min(s.dur - 0.05, leave - 0.05, Math.max(settle + 0.05, Math.min(leave - 0.05, settle + 0.4))));
}
