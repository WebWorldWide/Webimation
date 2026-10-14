// Episode fixtures from the Plotline Studio design (Webimation's source design).
import type { Clip } from '../engine';

export const TOTAL = 180, FPS = 30;

export const FMT = {
  mp4: { label: 'MP4', note: '16:9 · 4K', rate: 0.018 },
  prores: { label: 'ProRes', note: '4444 · alpha', rate: 0.011 },
  short: { label: 'Short', note: '9:16 · 1080', rate: 0.03 }
} as const;
export type FmtId = keyof typeof FMT;

export const REVEAL_NOTE: Record<string, string> = {
  wipe: 'Hard-edged wipe from the left, quart-out over 0.3–0.8 s.',
  mask: 'Each line rises inside its own mask, then exits upward.',
  cut: 'Frame cuts. Elements appear on their cue with no transition.'
};

export const INIT: Clip[] = [
  { id: 'c1', tpl: 'lt', start: 1, dur: 5, props: { name: 'Adam Nolle', role: 'Host · Web World Wide', accent: 'orange', field: 'clear', reveal: 'wipe' } },
  { id: 'c2', tpl: 'ch', start: 12, dur: 4.5, props: { label: 'Chapter', num: '01', title: 'The first 48 hours', accent: 'green', field: 'blue', reveal: 'mask' } },
  { id: 'c3', tpl: 'stat', start: 26.5, dur: 7, props: { label: 'Ep. 001 · first 48 h', value: '2.4', suffix: 'M', caption: 'views in the first 48 hours', delta: '+312%', accent: 'orange', field: 'blue', reveal: 'wipe' } },
  { id: 'c4', tpl: 'rank', start: 59.5, dur: 9, props: { unit: 'Monthly hours watched · billions', title: 'Where the hours go', from: '2018', to: '2024', accent: 'purple', field: 'ink', reveal: 'mask' } },
  { id: 'c5', tpl: 'check', start: 101, dur: 7, props: { title: "What you'll learn", a: 'How launch windows work', b: 'Why rankings shift', c: 'What to post next', accent: 'green', field: 'blue', reveal: 'wipe' } },
  { id: 'c6', tpl: 'sub', start: 157, dur: 5.5, props: { label: 'New every Thursday', handle: '@web_world_wide', cta: 'Subscribe', accent: 'orange', field: 'ink', reveal: 'cut' } }
];

export const LINES: [number, string][] = [[0, "Hey, I'm Adam, and this is Web World Wide."], [5, "Today we're looking at where all those hours on YouTube actually go."], [12, 'Chapter one. The first forty-eight hours.'], [20, 'When we posted episode one, we had no idea what would happen.'], [27, 'Two point four million views in the first two days.'], [36, "That's more than three hundred percent over our usual launch."], [48, "So where does everyone's time go?"], [60, 'Gaming took the top spot from music between 2018 and 2024.'], [70, 'Education grew faster than anything else on the chart.'], [84, 'Sports barely moved at all.'], [100, "Here's what you'll take away from this one."], [106, 'How launch windows work, why rankings shift, and what to post next.'], [125, 'We read every comment, so tell us what you want covered.'], [150, 'New episodes go up every Thursday.'], [158, "Subscribe so you don't miss the next one."], [170, 'See you then.']];

export const WORDS = LINES.map(([t, text], i) => {
  const next = (LINES[i + 1] || [TOTAL])[0], ws = text.split(' '), step = Math.min(0.36, (next - t) / (ws.length + 1));
  return ws.map((w, j) => ({ w, t: +(t + j * step).toFixed(2) }));
});

export const pad = (n: number) => String(n).padStart(2, '0');
export const fmt = (t: number) => { const s = Math.floor(t + 1e-6), f = Math.min(FPS - 1, Math.floor((t - s) * FPS + 1e-6)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}:${pad(f)}`; };
export const fmtS = (t: number) => `${Math.floor(t / 60)}:${pad(Math.floor(t % 60))}`;
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export const now = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
