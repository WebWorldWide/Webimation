import { Fragment, useEffect } from 'react';

const KEY = 'webimation.help.seen.v1';
export const helpSeen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked */ } };

const STEPS = ['Add a graphic from the left.', 'Edit it on the right.', 'Export it.'];

const KEYS: [string, string][] = [
  ['Space', 'Play / pause'], ['← →', 'Frame'], ['⇧ ← →', 'Second'],
  ['[ ]', 'Previous / next'], ['Delete', 'Remove'], ['M', 'Animations']
];

export function Help({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); markSeen(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  const close = () => { markSeen(); onClose(); };
  return (
    <div role="dialog" aria-label="Help" onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'color-mix(in srgb, var(--app) 70%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 100%)', background: 'var(--panel)', boxShadow: '0 0 0 1px var(--line-strong), 0 24px 60px rgba(0,0,0,.16)', padding: 28, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {STEPS.map((s, i) => (
            <li key={s} style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 16, color: 'var(--fg)' }}>
              <span style={{ width: 26, height: 26, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--hi)', color: 'var(--hi-fg)', fontWeight: 700, fontSize: 13 }}>{i + 1}</span>{s}
            </li>
          ))}
        </ol>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 13.5, color: 'var(--fg-3)' }}>
          {KEYS.map(([k, d]) => (
            <Fragment key={k}><span className="mono" style={{ fontSize: 12, color: 'var(--fg)' }}>{k}</span><span>{d}</span></Fragment>
          ))}
        </div>
        <button className="btn-primary" style={{ alignSelf: 'flex-start' }} onClick={close}>Start</button>
      </div>
    </div>
  );
}
