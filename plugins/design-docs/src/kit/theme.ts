/** Light and dark: by the reader's OS until they pick one, which the page remembers. */
import type { KitWindow } from './dom.js';

export const THEME_KEY = 'zcc-kit-theme';

export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'auto';

export interface ThemeControl {
  /** What the page shows now. */
  get(): Theme;
  /** What the reader picked; `auto` follows the OS. */
  choice(): ThemeChoice;
  set(choice: ThemeChoice): void;
  /** Wire `[data-kit-theme]` buttons under `root`. */
  bind(root: ParentNode): void;
}

function stored(win: KitWindow): ThemeChoice {
  try {
    const value = win.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

function prefersDark(win: KitWindow): boolean {
  return typeof win.matchMedia === 'function' && win.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function createTheme(win: KitWindow): ThemeControl {
  const doc = win.document;
  const buttons = new Set<HTMLElement>();
  let choice = stored(win);

  const current = (): Theme => (choice === 'auto' ? (prefersDark(win) ? 'dark' : 'light') : choice);

  const sync = () => {
    const theme = current();
    for (const button of buttons) {
      if (!button.isConnected) {
        buttons.delete(button);
        continue;
      }
      const wanted = button.dataset.kitTheme;
      if (wanted === 'light' || wanted === 'dark' || wanted === 'auto') button.setAttribute('aria-pressed', String(choice === wanted));
      else {
        // A toggle names what it switches to.
        const next = theme === 'dark' ? 'light' : 'dark';
        button.setAttribute('aria-label', `Switch to ${next} theme`);
        button.dataset.theme = theme;
      }
    }
  };

  const apply = () => {
    if (choice === 'auto') delete doc.documentElement.dataset.theme;
    else doc.documentElement.dataset.theme = choice;
    sync();
  };

  const control: ThemeControl = {
    get: current,
    choice: () => choice,
    set(next) {
      choice = next === 'light' || next === 'dark' ? next : 'auto';
      try {
        if (choice === 'auto') win.localStorage.removeItem(THEME_KEY);
        else win.localStorage.setItem(THEME_KEY, choice);
      } catch {
        // Storage can be off; the choice still holds for this visit.
      }
      apply();
      win.dispatchEvent(new win.CustomEvent('kit:theme', { detail: { theme: current(), choice } }));
    },
    bind(root) {
      for (const button of root.querySelectorAll<HTMLElement>('[data-kit-theme]')) {
        if (buttons.has(button)) continue;
        buttons.add(button);
        button.addEventListener('click', () => {
          const wanted = button.dataset.kitTheme;
          control.set(wanted === 'light' || wanted === 'dark' || wanted === 'auto' ? wanted : current() === 'dark' ? 'light' : 'dark');
        });
      }
      sync();
    }
  };

  // Apply before the page paints, and follow the OS while the reader has not picked.
  apply();
  if (typeof win.matchMedia === 'function') win.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', sync);
  return control;
}
