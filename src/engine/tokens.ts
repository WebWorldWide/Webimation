// Plotline graphic tokens: Web World Wide palette, two typefaces, three fields.
export const ACC = { orange: '#FF8A1F', green: '#22D37F', purple: '#8B5CF6', white: '#FFFFFF' } as const;
export type AccentId = keyof typeof ACC;
export const INK = '#0B0B0C';
export const BLUE = '#1E68F0';
export const onAcc = (a: string) => (a === 'purple' ? '#FFFFFF' : INK);
export const accHex = (a: string) => ACC[a as AccentId] || ACC.orange;

export const STAGE_W = 1280, STAGE_H = 720;

export const SANS = "font-family:'Archivo Variable',Archivo,system-ui,sans-serif;";
export const CAPS = SANS + 'font-weight:600;font-stretch:78%;letter-spacing:.16em;text-transform:uppercase;line-height:1.2;';
export const SERIF = "font-family:'Instrument Serif',serif;font-weight:400;font-synthesis:none;";
export const NUM = SANS + 'font-weight:900;font-stretch:62%;font-variant-numeric:tabular-nums;';
export const MONO = 'font-family:ui-monospace,Menlo,monospace;';

const grid = (bg: string, a: number) =>
  `background-color:${bg};background-image:linear-gradient(rgba(255,255,255,${a}) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,${a}) 1px,transparent 1px);background-size:80px 80px;background-position:-1px -1px;`;
export const FIELD = {
  blue: grid(BLUE, 0.08),
  ink: grid(INK, 0.05),
  clear: 'background-color:#1C1C1F;background-image:conic-gradient(#26262A 25%,transparent 0 50%,#26262A 0 75%,transparent 0);background-size:32px 32px;'
} as const;
export type FieldId = keyof typeof FIELD;

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
