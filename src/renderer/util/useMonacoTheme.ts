import { useEffect, useState } from 'react';

/**
 * Monaco's built-in theme name that matches the app's current `data-theme`.
 *
 * The app theme lives as a `data-theme` attribute on `<html>` (set by
 * `applyTheme` in the store), not in reactive store state — so we observe that
 * attribute directly and re-render when it flips. Monaco editors that hardcode
 * `theme="vs-dark"` stay dark under light mode; pass this value instead.
 */
function monacoThemeFor(el: HTMLElement): 'vs-dark' | 'vs' {
  return el.dataset.theme === 'light' ? 'vs' : 'vs-dark';
}

export function useMonacoTheme(): 'vs-dark' | 'vs' {
  const [theme, setTheme] = useState<'vs-dark' | 'vs'>(() =>
    typeof document === 'undefined' ? 'vs-dark' : monacoThemeFor(document.documentElement)
  );

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setTheme(monacoThemeFor(root));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}
