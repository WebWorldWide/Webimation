// Draws a cast of stick figures as SVG and updates it per frame from the script (see stick.ts).
import { castLength, figureAt, parseCast, type Joints } from './stick';

const n = (v: number) => +v.toFixed(2);
const line = (...p: [number, number][]) => p.map((q, i) => `${i ? 'L' : 'M'}${n(q[0])} ${n(q[1])}`).join('');

export function stickHtml(P: Record<string, string>, a: string): string {
  const c = parseCast(P.cast), round = c.style !== 'block';
  const figs = c.figures.map((f, i) => {
    const col = f.color === 'accent' ? a : f.color === 'fg' || !f.color ? 'var(--w-fg)' : f.color;
    const st = `fill="none" style="stroke:${col}" stroke-width="${c.weight}" stroke-linecap="${round ? 'round' : 'square'}" stroke-linejoin="${round ? 'round' : 'miter'}"`;
    const headFill = c.style === 'round' ? 'none' : col;
    return `<g data-fig="${i}">
      <path data-b="ab" ${st}></path><path data-b="lb" ${st}></path><path data-b="torso" ${st}></path>
      <path data-b="head" style="stroke:${col};fill:${headFill}" stroke-width="${c.weight}" stroke-linejoin="${round ? 'round' : 'miter'}"></path>
      <path data-b="lf" ${st}></path><path data-b="af" ${st}></path>
    </g>`;
  }).join('');
  const bubbles = c.figures.map((_, i) => `<div data-say="${i}" style="position:absolute;left:0;top:0;display:none;pointer-events:none"><div data-say-in style="position:relative;background:var(--w-plate);color:var(--w-plate-fg);font-family:var(--w-text-f);font-weight:600;font-stretch:var(--w-text-s);font-size:calc(30px * var(--w-text-z,1));line-height:1.15;padding:12px 18px;white-space:nowrap"></div><div style="position:absolute;left:22px;bottom:-14px;width:0;height:0;border-left:0 solid transparent;border-right:16px solid transparent;border-top:14px solid var(--w-plate)"></div></div>`).join('');
  return `<svg data-stick width="1280" height="720" viewBox="0 0 1280 720" style="position:absolute;left:0;top:0;overflow:visible">${figs}</svg>${bubbles}`;
}

function headPath(j: Joints, block: boolean, lean: [number, number]) {
  const [cx, cy] = j.head, r = j.headR;
  if (!block) return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
  // Square head aligned with the neck direction.
  const [ux, uy] = lean, vx = -uy, vy = ux, q = (a: number, b: number): [number, number] => [cx + ux * a * r + vx * b * r, cy + uy * a * r + vy * b * r];
  return line(q(-1, -1), q(-1, 1), q(1, 1), q(1, -1)) + 'Z';
}

export function stickUpdate(layer: HTMLElement, clip: { props: Record<string, string> }) {
  const c = parseCast(clip.props.cast), svg = layer.querySelector('svg[data-stick]');
  if (!svg) return () => {};
  const figs = c.figures.map((f, i) => {
    const g = svg.querySelector(`[data-fig="${i}"]`)!, b = (k: string) => g.querySelector<SVGPathElement>(`[data-b="${k}"]`)!;
    const bubble = layer.querySelector<HTMLElement>(`[data-say="${i}"]`)!, text = bubble.querySelector<HTMLElement>('[data-say-in]')!;
    return { f, ab: b('ab'), lb: b('lb'), torso: b('torso'), head: b('head'), lf: b('lf'), af: b('af'), bubble, text, said: '' };
  });
  return (t: number) => {
    for (const F of figs) {
      const { j, say, sayK } = figureAt(F.f, t, c.ground, c.weight);
      F.ab.setAttribute('d', line(j.shoulder, j.eb, j.hb));
      F.af.setAttribute('d', line(j.shoulder, j.ef, j.hf));
      F.lb.setAttribute('d', line(j.hip, j.kb, j.fb));
      F.lf.setAttribute('d', line(j.hip, j.kf, j.ff));
      F.torso.setAttribute('d', line(j.hip, j.neck));
      const dx = j.head[0] - j.neck[0], dy = j.head[1] - j.neck[1], l = Math.hypot(dx, dy) || 1;
      F.head.setAttribute('d', headPath(j, c.style === 'block', [dx / l, dy / l]));
      if (say && sayK > 0) {
        if (F.said !== say) { F.said = say; F.text.textContent = say; }
        // Whole-pixel position so the bubble text never sits on a fractional pixel.
        F.bubble.style.display = '';
        F.bubble.style.transform = `translate(${Math.round(j.head[0] - 10)}px,${Math.round(j.head[1] - j.headR - 34)}px) translateY(-100%)`;
        F.bubble.style.clipPath = sayK >= 1 ? '' : `inset(0 ${((1 - sayK) * 100).toFixed(2)}% 0 0)`;
      } else F.bubble.style.display = 'none';
    }
  };
}

export const stickLength = (P: Record<string, string>) => castLength(parseCast(P.cast));
