import { useEffect, useRef } from 'react';
import { createStage, TEMPLATES, type Clip, type Preset, type Stage } from '../engine';

// One rAF for every live preview on screen.
const ticks = new Set<(now: number) => void>();
let raf = 0;
const loop = (now: number) => {
  ticks.forEach(f => f(now));
  raf = ticks.size ? requestAnimationFrame(loop) : 0;
};
export const onTick = (f: (now: number) => void) => {
  ticks.add(f);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => { ticks.delete(f); };
};

export const RM = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The library specimen: caps label, serif headline, accent bar and a white plate. */
export const specimenClip = (preset: Preset | string, accent = 'orange', field = 'blue'): Clip => {
  const T = TEMPLATES.specimen;
  return typeof preset === 'string'
    ? { id: 'spec', tpl: 'specimen', start: 0, dur: T.dur, props: { ...T.d, accent, field, reveal: preset } }
    : { id: 'spec', tpl: 'specimen', start: 0, dur: T.dur, props: { ...T.d, accent, field, reveal: preset.id }, motion: preset };
};
const HOLD = 0.7;
/** Still frame shown when a card isn't playing: every element has landed, nothing has started leaving. */
export const POSTER_T = 2.6;

/**
 * Library thumbnail. Builds its stage the first time it scrolls into view. Shows the poster frame
 * until `playing` (hover, or "animate all"), then plays from the first frame and loops.
 */
export function Thumb({ preset, playing }: { preset: string; playing: boolean }) {
  const ref = useRef<HTMLDivElement>(null), stage = useRef<Stage | null>(null), seen = useRef(false);
  const clip = useRef(specimenClip(preset));
  clip.current = specimenClip(preset);
  useEffect(() => {
    const host = ref.current!;
    const io = new IntersectionObserver(([e]) => {
      seen.current = e.isIntersecting;
      if (e.isIntersecting && !stage.current) { stage.current = createStage(host); stage.current.show(clip.current, POSTER_T); }
      host.dispatchEvent(new Event('thumbvis'));
    }, { rootMargin: '120px' });
    io.observe(host);
    return () => { io.disconnect(); stage.current?.destroy(); stage.current = null; };
  }, []);
  useEffect(() => {
    const host = ref.current!;
    let off: (() => void) | null = null;
    const sync = () => {
      off?.(); off = null;
      const st = stage.current;
      if (!st) return;
      if (!playing || RM || !seen.current) { st.show(clip.current, POSTER_T); return; }
      const t0 = performance.now(), L = clip.current.dur + HOLD;
      off = onTick(now => st.show(clip.current, ((now - t0) / 1000) % L));
    };
    sync();
    host.addEventListener('thumbvis', sync);
    return () => { host.removeEventListener('thumbvis', sync); off?.(); };
  }, [playing, preset]);
  return <div ref={ref} className="thumb" />;
}
