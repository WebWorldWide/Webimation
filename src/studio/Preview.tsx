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

/** Library thumbnail: builds its stage the first time it scrolls into view, animates only while visible. */
export function Thumb({ preset }: { preset: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!, clip = specimenClip(preset), L = clip.dur + HOLD;
    let stage: Stage | null = null, off: (() => void) | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        stage ??= createStage(host);
        if (RM) stage.show(clip, 1.8);
        else if (!off) off = onTick(now => stage!.show(clip, (now / 1000) % L));
      } else { off?.(); off = null; }
    }, { rootMargin: '120px' });
    io.observe(host);
    return () => { io.disconnect(); off?.(); stage?.destroy(); };
  }, [preset]);
  return <div ref={ref} className="thumb" />;
}
