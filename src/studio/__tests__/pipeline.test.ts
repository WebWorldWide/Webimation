import { describe, expect, it } from 'vitest';
import { pipeline } from '../exporter';

const cv = () => { const c = document.createElement('canvas'); c.width = c.height = 2; (c as any).toBlob = (cb: (b: Blob) => void) => setTimeout(() => cb(new Blob([new Uint8Array([1, 2, 3])])), 1); return c; };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('export pipeline', () => {
  it('delivers every frame with its index and never holds more than depth in flight', async () => {
    let live = 0, peak = 0; const seen: number[] = [];
    const pl = pipeline(async (_b, i) => { live++; peak = Math.max(peak, live); await wait(5); seen.push(i); live--; }, 3);
    for (let i = 0; i < 20; i++) await pl.push(cv(), i);
    await pl.drain();
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(peak).toBeLessThanOrEqual(3);
  });
  it('surfaces a failed write instead of swallowing it', async () => {
    const pl = pipeline(async (_b, i) => { if (i === 2) throw new Error('disk full'); }, 2);
    await expect((async () => { for (let i = 0; i < 6; i++) await pl.push(cv(), i); await pl.drain(); })()).rejects.toThrow('disk full');
  });
});
