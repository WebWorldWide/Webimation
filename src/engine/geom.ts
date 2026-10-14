// Hard-edged clip geometry. Every reveal is a union of axis-aligned rectangles (or one polygon),
// expressed in percent of the element so it needs no measuring and stays crisp at any scale.
export type Rect = readonly [x0: number, y0: number, x1: number, y1: number];
export type Dir = 'right' | 'left' | 'down' | 'up';
export const DIRS: Dir[] = ['right', 'left', 'down', 'up'];
export const DIR_LABEL: Record<Dir, string> = { right: '→', left: '←', down: '↓', up: '↑' };

const f = (n: number) => +n.toFixed(3) + '%';
export const EMPTY = 'polygon(0 0,0 0,0 0)';
export const FULL = 'none';

/** One polygon covering a union of rects; rects are joined by zero-area bridges. */
export const poly = (rects: readonly Rect[]): string => {
  const rs = rects.filter(r => r[2] - r[0] > 0.001 && r[3] - r[1] > 0.001);
  if (!rs.length) return EMPTY;
  const pts: string[] = [];
  for (const [x0, y0, x1, y1] of rs) pts.push(`${f(x0)} ${f(y0)}`, `${f(x1)} ${f(y0)}`, `${f(x1)} ${f(y1)}`, `${f(x0)} ${f(y1)}`, `${f(x0)} ${f(y0)}`);
  for (let i = rs.length - 2; i >= 0; i--) pts.push(`${f(rs[i][0])} ${f(rs[i][1])}`);
  return `polygon(${pts.join(',')})`;
};

export const points = (pts: readonly (readonly [number, number])[]) =>
  pts.length < 3 ? EMPTY : `polygon(${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(',')})`;

/** The part of a box revealed by a wipe travelling `dir`: leading edge at `a`, trailing edge at `b` (0..1). */
export const band = (dir: Dir, a: number, b = 0): Rect => {
  const A = a * 100, B = b * 100;
  switch (dir) {
    case 'right': return [B, 0, A, 100];
    case 'left': return [100 - A, 0, 100 - B, 100];
    case 'down': return [0, B, 100, A];
    case 'up': return [0, 100 - A, 100, 100 - B];
  }
};

/** Map a rect given in a cell's local percent space into the parent's space. */
export const within = (cell: Rect, r: Rect): Rect => {
  const w = cell[2] - cell[0], h = cell[3] - cell[1];
  return [cell[0] + (r[0] / 100) * w, cell[1] + (r[1] / 100) * h, cell[0] + (r[2] / 100) * w, cell[1] + (r[3] / 100) * h];
};

/** Split the box into `n` equal slats: 'h' gives horizontal rows, 'v' vertical columns. */
export const slats = (n: number, axis: 'h' | 'v'): Rect[] =>
  Array.from({ length: n }, (_, i) =>
    axis === 'h' ? [0, (i / n) * 100, 100, ((i + 1) / n) * 100] : [(i / n) * 100, 0, ((i + 1) / n) * 100, 100]);

export interface Cell { r: Rect; cx: number; cy: number; col: number; row: number }
export const cells = (cols: number, rows: number): Cell[] => {
  const out: Cell[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++)
      out.push({ r: [(col / cols) * 100, (row / rows) * 100, ((col + 1) / cols) * 100, ((row + 1) / rows) * 100], cx: col, cy: row, col, row });
  return out;
};

export const morton = (x: number, y: number) => {
  let m = 0;
  for (let i = 0; i < 8; i++) m |= (((x >> i) & 1) << (2 * i)) | (((y >> i) & 1) << (2 * i + 1));
  return m;
};

export const rev = (d: Dir): Dir => ({ right: 'left', left: 'right', down: 'up', up: 'down' } as const)[d];
export const isH = (d: Dir) => d === 'right' || d === 'left';
