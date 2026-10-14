import { setTheme, useTheme, type Theme } from './desktop';

export function ThemeSwitch() {
  const theme = useTheme();
  return (
    <div className="seg tight" role="group" aria-label="Theme">
      {(['light', 'dark'] as Theme[]).map(t => (
        <button key={t} className={'ease' + (theme === t ? ' on' : '')} aria-pressed={theme === t} onClick={() => setTheme(t)}>{t}</button>
      ))}
    </div>
  );
}
