// Deterministic randomness so every frame is a pure function of (seed, time).
export const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export const rng = (seed: number) => {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const shuffle = <T>(xs: T[], seed: number) => {
  const r = rng(seed), out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export const ORDERS = ['seq', 'rev', 'center', 'edges', 'random', 'alt'] as const;
export type Order = (typeof ORDERS)[number];
export const ORDER_LABEL: Record<Order, string> = { seq: 'In order', rev: 'Reverse', center: 'Centre out', edges: 'Edges in', random: 'Shuffled', alt: 'Alternate' };

/** Normalised start offset (0..1) for each of `n` items under a stagger order. */
export const ranks = (n: number, order: Order, seed: number): number[] => {
  if (n <= 1) return [0];
  const m = n - 1, mid = m / 2;
  switch (order) {
    case 'rev': return Array.from({ length: n }, (_, i) => (m - i) / m);
    case 'center': return Array.from({ length: n }, (_, i) => Math.abs(i - mid) / mid);
    case 'edges': return Array.from({ length: n }, (_, i) => 1 - Math.abs(i - mid) / mid);
    case 'random': {
      const out = new Array<number>(n);
      shuffle([...Array(n).keys()], seed).forEach((i, k) => (out[i] = k / m));
      return out;
    }
    case 'alt': {
      const evens = Math.ceil(n / 2);
      return Array.from({ length: n }, (_, i) => (i % 2 ? evens + (i - 1) / 2 : i / 2) / m);
    }
    default: return Array.from({ length: n }, (_, i) => i / m);
  }
};
