// Type system for graphics. Templates never name a font: they use four roles (display, text,
// label, numerals) that resolve to CSS variables on the clip's layer. A pairing sets all four;
// any role can be overridden per graphic, with weight, width, tracking, case and size.
//
// Each font carries metric corrections relative to the design fonts (Instrument Serif for display,
// Archivo for the rest): `z` scales size so cap heights roughly match, `lh` scales line-height so
// stacked lines keep the same rhythm.
export interface FontDef {
  id: string;
  name: string;
  family: string;
  /** Weight axis range (variable fonts) or the single weight. */
  wght: [number, number];
  /** Width axis range in % (Archivo, Bricolage), else [100, 100]. */
  wdth: [number, number];
  z: number;
  lh: number;
  italic?: boolean;
  kind: 'serif' | 'sans' | 'display' | 'mono' | 'hand' | 'pixel';
}

export const FONTS: FontDef[] = [
  { id: 'instrument', name: 'Instrument Serif', family: "'Instrument Serif',serif", wght: [400, 400], wdth: [100, 100], z: 1, lh: 1, italic: true, kind: 'serif' },
  { id: 'archivo', name: 'Archivo', family: "'Archivo Variable',Archivo,system-ui,sans-serif", wght: [100, 900], wdth: [62, 125], z: 1, lh: 1, kind: 'sans' },
  { id: 'inter', name: 'Inter', family: "'Inter Variable',Inter,system-ui,sans-serif", wght: [100, 900], wdth: [100, 100], z: 0.94, lh: 1.04, kind: 'sans' },
  { id: 'space', name: 'Space Grotesk', family: "'Space Grotesk Variable','Space Grotesk',sans-serif", wght: [300, 700], wdth: [100, 100], z: 0.95, lh: 1.04, kind: 'sans' },
  { id: 'bricolage', name: 'Bricolage Grotesque', family: "'Bricolage Grotesque Variable',sans-serif", wght: [200, 800], wdth: [75, 100], z: 0.95, lh: 1.06, kind: 'sans' },
  { id: 'syne', name: 'Syne', family: "'Syne Variable',Syne,sans-serif", wght: [400, 800], wdth: [100, 100], z: 0.9, lh: 1.08, kind: 'display' },
  { id: 'fraunces', name: 'Fraunces', family: "'Fraunces Variable',Fraunces,serif", wght: [100, 900], wdth: [100, 100], z: 0.86, lh: 1.08, italic: true, kind: 'serif' },
  { id: 'playfair', name: 'Playfair Display', family: "'Playfair Display Variable','Playfair Display',serif", wght: [400, 900], wdth: [100, 100], z: 0.86, lh: 1.1, italic: true, kind: 'serif' },
  { id: 'dmserif', name: 'DM Serif Display', family: "'DM Serif Display',serif", wght: [400, 400], wdth: [100, 100], z: 0.88, lh: 1.06, italic: true, kind: 'serif' },
  { id: 'bebas', name: 'Bebas Neue', family: "'Bebas Neue',sans-serif", wght: [400, 400], wdth: [100, 100], z: 1.12, lh: 0.96, kind: 'display' },
  { id: 'anton', name: 'Anton', family: "'Anton',sans-serif", wght: [400, 400], wdth: [100, 100], z: 0.82, lh: 1.08, kind: 'display' },
  { id: 'jetbrains', name: 'JetBrains Mono', family: "'JetBrains Mono Variable','JetBrains Mono',ui-monospace,monospace", wght: [100, 800], wdth: [100, 100], z: 0.84, lh: 1.08, italic: true, kind: 'mono' },
  { id: 'vt323', name: 'VT323', family: "'VT323',monospace", wght: [400, 400], wdth: [100, 100], z: 1.28, lh: 0.92, kind: 'pixel' },
  { id: 'pixel', name: 'Press Start 2P', family: "'Press Start 2P',monospace", wght: [400, 400], wdth: [100, 100], z: 0.5, lh: 1.5, kind: 'pixel' },
  { id: 'marker', name: 'Permanent Marker', family: "'Permanent Marker',cursive", wght: [400, 400], wdth: [100, 100], z: 0.82, lh: 1.12, kind: 'hand' },
  { id: 'caveat', name: 'Caveat', family: "'Caveat Variable',Caveat,cursive", wght: [400, 700], wdth: [100, 100], z: 1.28, lh: 0.92, kind: 'hand' },
  { id: 'mono', name: 'System mono', family: 'ui-monospace,Menlo,monospace', wght: [400, 700], wdth: [100, 100], z: 0.86, lh: 1.06, kind: 'mono' }
];
export const FONT: Record<string, FontDef> = Object.fromEntries(FONTS.map(f => [f.id, f]));

export type Role = 'disp' | 'text' | 'label' | 'num';
export const ROLES: [Role, string][] = [['disp', 'Headline'], ['text', 'Body'], ['label', 'Label'], ['num', 'Numerals']];

export interface RoleStyle {
  font: string;
  /** Weight (clamped to the font's axis). */
  w: number;
  /** Width in % (only on fonts with a width axis). */
  s: number;
  /** Extra tracking in em, added to the template's own. */
  ls: number;
  tt: 'none' | 'uppercase' | 'lowercase';
  /** User size multiplier on top of the font's metric correction. */
  z: number;
  italic?: boolean;
}

const R = (font: string, w: number, o: Partial<RoleStyle> = {}): RoleStyle => ({ font, w, s: 100, ls: 0, tt: 'none', z: 1, ...o });

export interface Pairing { id: string; name: string; roles: Record<Role, RoleStyle> }
export const PAIRINGS: Pairing[] = [
  { id: 'editorial', name: 'Editorial', roles: { disp: R('instrument', 400), text: R('archivo', 600), label: R('archivo', 600, { s: 78 }), num: R('archivo', 900, { s: 62 }) } },
  { id: 'broadcast', name: 'Broadcast', roles: { disp: R('archivo', 800, { s: 75, tt: 'uppercase', ls: -0.01, z: 0.82 }), text: R('archivo', 600), label: R('archivo', 600, { s: 78 }), num: R('archivo', 900, { s: 62 }) } },
  { id: 'swiss', name: 'Swiss', roles: { disp: R('inter', 800, { ls: -0.035, z: 0.9 }), text: R('inter', 600), label: R('inter', 700), num: R('inter', 800, { ls: -0.03 }) } },
  { id: 'grotesk', name: 'Grotesk', roles: { disp: R('space', 600, { ls: -0.02, z: 0.92 }), text: R('space', 500), label: R('space', 600), num: R('space', 700) } },
  { id: 'bricolage', name: 'Bricolage', roles: { disp: R('bricolage', 800, { s: 75, ls: -0.02, z: 0.92 }), text: R('bricolage', 500), label: R('bricolage', 700, { s: 75 }), num: R('bricolage', 800, { s: 75 }) } },
  { id: 'classic', name: 'Classic', roles: { disp: R('playfair', 600), text: R('inter', 600), label: R('inter', 700), num: R('playfair', 800) } },
  { id: 'soft', name: 'Soft serif', roles: { disp: R('fraunces', 600), text: R('inter', 600), label: R('inter', 700), num: R('fraunces', 800) } },
  { id: 'didone', name: 'Didone', roles: { disp: R('dmserif', 400), text: R('inter', 600), label: R('inter', 700), num: R('dmserif', 400) } },
  { id: 'poster', name: 'Poster', roles: { disp: R('bebas', 400, { tt: 'uppercase', ls: 0.01 }), text: R('archivo', 600), label: R('archivo', 600, { s: 78 }), num: R('anton', 400) } },
  { id: 'impact', name: 'Impact', roles: { disp: R('anton', 400, { tt: 'uppercase' }), text: R('inter', 700), label: R('inter', 800), num: R('anton', 400) } },
  { id: 'expressive', name: 'Expressive', roles: { disp: R('syne', 800, { ls: -0.02 }), text: R('inter', 600), label: R('syne', 700), num: R('syne', 800) } },
  { id: 'wide', name: 'Wide', roles: { disp: R('archivo', 800, { s: 125, z: 0.72, ls: -0.02 }), text: R('archivo', 600, { s: 112 }), label: R('archivo', 700, { s: 125 }), num: R('archivo', 900, { s: 100 }) } },
  { id: 'terminal', name: 'Terminal', roles: { disp: R('jetbrains', 700, { ls: -0.03 }), text: R('jetbrains', 500), label: R('jetbrains', 700), num: R('jetbrains', 800) } },
  { id: 'retro', name: 'Retro CRT', roles: { disp: R('vt323', 400), text: R('vt323', 400), label: R('vt323', 400), num: R('vt323', 400) } },
  { id: 'pixel', name: 'Pixel', roles: { disp: R('pixel', 400, { tt: 'uppercase' }), text: R('vt323', 400), label: R('pixel', 400, { z: 1.25 }), num: R('pixel', 400) } },
  { id: 'marker', name: 'Marker', roles: { disp: R('marker', 400), text: R('caveat', 700), label: R('archivo', 600, { s: 78 }), num: R('marker', 400) } },
  { id: 'handwritten', name: 'Handwritten', roles: { disp: R('caveat', 700), text: R('caveat', 600), label: R('caveat', 700), num: R('caveat', 700) } }
];
export const PAIRING: Record<string, Pairing> = Object.fromEntries(PAIRINGS.map(p => [p.id, p]));

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/**
 * Resolve a clip's type props into CSS variables. Per-role overrides use prop keys
 * `<role>Font`, `<role>W`, `<role>S`, `<role>Ls`, `<role>Tt`, `<role>Z`.
 */
export function typeVars(P: Record<string, string>): Record<string, string> {
  const base = PAIRING[P.type] || PAIRING.editorial, out: Record<string, string> = {};
  for (const [role] of ROLES) {
    const b = base.roles[role], o = (k: string) => P[role + k];
    const f = FONT[o('Font') || b.font] || FONT.archivo;
    const num = (k: string, d: number) => { const v = parseFloat(o(k)); return isFinite(v) ? v : d; };
    const w = clamp(num('W', b.w), f.wght[0], f.wght[1]), s = clamp(num('S', b.s), f.wdth[0], f.wdth[1]);
    const tt = (o('Tt') as RoleStyle['tt']) || b.tt;
    out[`--w-${role}-f`] = f.family;
    out[`--w-${role}-w`] = String(w);
    out[`--w-${role}-s`] = s + '%';
    out[`--w-${role}-ls`] = num('Ls', b.ls) + 'em';
    out[`--w-${role}-tt`] = tt;
    out[`--w-${role}-z`] = String(+(f.z * num('Z', b.z)).toFixed(4));
    out[`--w-${role}-lh`] = String(f.lh);
  }
  return out;
}

/**
 * Templates write plain `font-size:Npx`, `line-height:N` and `letter-spacing:X` next to a role's
 * font stack. Rewrite those so they follow the role's size, rhythm and tracking variables.
 */
export function roleMetrics(html: string): string {
  return html.replace(/style="([^"]*)"/g, (m, css: string) => {
    const role = /var\(--w-(disp|text|label|num)-f\)/.exec(css)?.[1];
    if (!role) return m;
    const out = css
      .replace(/font-size:\s*([\d.]+)px/g, `font-size:calc($1px * var(--w-${role}-z,1))`)
      .replace(/line-height:\s*([\d.]+)(?![\d.]*(?:px|em|%))/g, `line-height:calc($1 * var(--w-${role}-lh,1))`)
      .replace(/letter-spacing:\s*(-?[\d.]+em)/g, `letter-spacing:calc($1 + var(--w-${role}-ls,0em))`);
    return `style="${out}"`;
  });
}
