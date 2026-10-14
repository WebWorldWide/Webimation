// Desktop shell glue. In the Tauri app files go through native dialogs; in a browser they fall
// back to a download link and a file input, so `npm run dev` keeps working on its own.
import { useSyncExternalStore } from 'react';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent);

interface Filter { name: string; extensions: string[] }

/** Save text to a user-chosen file. Resolves false if the user cancels. */
export async function saveText(defaultName: string, text: string, filter: Filter): Promise<boolean> {
  if (isDesktop) {
    const [{ save }, { writeTextFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
    const path = await save({ defaultPath: defaultName, filters: [filter] });
    if (!path) return false;
    await writeTextFile(path, text);
    return true;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

/** Let the user pick a file and read it as text. Resolves null if they cancel. */
export async function openText(filter: Filter): Promise<{ name: string; text: string } | null> {
  if (isDesktop) {
    const [{ open }, { readTextFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
    const path = await open({ multiple: false, directory: false, filters: [filter] });
    if (!path || Array.isArray(path)) return null;
    return { name: path.split(/[\\/]/).pop() || path, text: await readTextFile(path) };
  }
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = filter.extensions.map(e => '.' + e).join(',');
    input.onchange = async () => { const f = input.files?.[0]; resolve(f ? { name: f.name, text: await f.text() } : null); };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// ── theme ─────────────────────────────────────────────────────────────────

export type Theme = 'light' | 'dark';
const THEME_KEY = 'webimation.theme';
let theme: Theme = (() => { try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } })();
const subs = new Set<() => void>();
const apply = () => { document.documentElement.dataset.theme = theme; };
if (typeof document !== 'undefined') apply();

export const setTheme = (t: Theme) => {
  theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage blocked */ }
  apply();
  subs.forEach(f => f());
};
export const useTheme = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => theme);
