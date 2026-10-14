// Plotline graphic tokens: Web World Wide palette, two typefaces, three fields.
export const ACC = { orange: '#FF8A1F', green: '#22D37F', purple: '#8B5CF6', white: '#FFFFFF' } as const;
export type AccentId = keyof typeof ACC;
export const INK = '#0B0B0C';
export const BLUE = '#1E68F0';

export const STAGE_W = 1280, STAGE_H = 720;

// Type roles. Fonts, weights, widths, tracking, case and size come from CSS variables set per graphic
// (see fonts.ts); templates add their own size/line-height/tracking, which roleMetrics() scales.
export const SANS = 'font-family:var(--w-text-f);font-stretch:var(--w-text-s);font-synthesis:none;letter-spacing:0em;';
export const CAPS = 'font-family:var(--w-label-f);font-weight:var(--w-label-w);font-stretch:var(--w-label-s);font-synthesis:none;letter-spacing:.16em;text-transform:uppercase;line-height:1.2;';
export const SERIF = 'font-family:var(--w-disp-f);font-weight:var(--w-disp-w);font-stretch:var(--w-disp-s);text-transform:var(--w-disp-tt);font-synthesis:none;letter-spacing:0em;';
export const NUM = 'font-family:var(--w-num-f);font-weight:var(--w-num-w);font-stretch:var(--w-num-s);font-synthesis:none;letter-spacing:0em;font-variant-numeric:tabular-nums;';
export const MONO = 'font-family:ui-monospace,Menlo,monospace;';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
