// Undo history for a document. Changes inside `coalesceMs` with the same key merge into one step
// (dragging a slider is one undo, not sixty).
import { useCallback, useRef, useState } from 'react';

export function useHistory<T>(initial: T | (() => T), save?: (v: T) => void) {
  const [state, setState] = useState(() => ({ past: [] as T[], now: typeof initial === 'function' ? (initial as () => T)() : initial, future: [] as T[] }));
  const last = useRef<{ key: string; at: number } | null>(null);
  const set = useCallback((next: T | ((v: T) => T), key = '') => {
    setState(s => {
      const v = typeof next === 'function' ? (next as (v: T) => T)(s.now) : next;
      if (v === s.now) return s;
      const t = performance.now();
      const merge = key && last.current && last.current.key === key && t - last.current.at < 700;
      last.current = { key, at: t };
      save?.(v);
      return { past: merge ? s.past : [...s.past.slice(-99), s.now], now: v, future: [] };
    });
  }, [save]);
  const undo = useCallback(() => setState(s => { if (!s.past.length) return s; const now = s.past[s.past.length - 1]; save?.(now); last.current = null; return { past: s.past.slice(0, -1), now, future: [s.now, ...s.future] }; }), [save]);
  const redo = useCallback(() => setState(s => { if (!s.future.length) return s; const now = s.future[0]; save?.(now); last.current = null; return { past: [...s.past, s.now], now, future: s.future.slice(1) }; }), [save]);
  const reset = useCallback((v: T) => { save?.(v); last.current = null; setState({ past: [], now: v, future: [] }); }, [save]);
  return { value: state.now, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

export function stored<T>(key: string, fallback: () => T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback(); } catch { return fallback(); }
}
export const store = (key: string) => (v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* full or blocked */ } };
