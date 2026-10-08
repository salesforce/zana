import { describe, expect, it, vi } from 'vitest';
import type { KitWindow } from './dom.js';
import { createTheme, THEME_KEY } from './theme.js';
import { load, newWindow } from './test-window.js';

const BUTTONS = '<button data-kit-theme id="toggle"></button><button data-kit-theme="light" id="light"></button><button data-kit-theme="dark" id="dark"></button><button data-kit-theme="auto" id="auto"></button>';

function themed(prefers: 'light' | 'dark' = 'light'): KitWindow {
  const win = newWindow(undefined, prefers);
  load(win, `<!doctype html><html><head></head><body>${BUTTONS}</body></html>`);
  return win;
}

const byId = (win: KitWindow, id: string) => win.document.getElementById(id)!;

describe('theme', () => {
  it('follows the OS until the reader picks, then remembers the pick', () => {
    const win = themed('dark');
    const theme = createTheme(win);
    const events: unknown[] = [];
    win.addEventListener('kit:theme', (event) => events.push((event as CustomEvent).detail));
    expect(theme.get()).toBe('dark');
    expect(theme.choice()).toBe('auto');
    expect(win.document.documentElement.dataset.theme).toBeUndefined();

    theme.bind(win.document);
    const toggle = byId(win, 'toggle');
    expect(toggle.getAttribute('aria-label')).toBe('Switch to light theme');
    expect(toggle.dataset.theme).toBe('dark');
    expect(byId(win, 'auto').getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    expect(theme.get()).toBe('light');
    expect(win.document.documentElement.dataset.theme).toBe('light');
    expect(win.localStorage.getItem(THEME_KEY)).toBe('light');
    expect(toggle.getAttribute('aria-label')).toBe('Switch to dark theme');
    expect(byId(win, 'light').getAttribute('aria-pressed')).toBe('true');
    expect(events).toEqual([{ theme: 'light', choice: 'light' }]);

    byId(win, 'dark').click();
    expect(win.document.documentElement.dataset.theme).toBe('dark');
    byId(win, 'auto').click();
    expect(win.localStorage.getItem(THEME_KEY)).toBeNull();
    expect(win.document.documentElement.dataset.theme).toBeUndefined();
    theme.set('sepia' as never);
    expect(theme.choice()).toBe('auto');
  });

  it('reads a stored pick and binds each button once', () => {
    const win = themed();
    win.localStorage.setItem(THEME_KEY, 'dark');
    const theme = createTheme(win);
    expect(win.document.documentElement.dataset.theme).toBe('dark');
    theme.bind(win.document);
    theme.bind(win.document);
    const events = vi.fn();
    win.addEventListener('kit:theme', events);
    byId(win, 'toggle').click();
    expect(events).toHaveBeenCalledTimes(1);
    expect(theme.get()).toBe('light');
  });

  it('forgets buttons that left the page', () => {
    const win = themed();
    const theme = createTheme(win);
    theme.bind(win.document);
    const toggle = byId(win, 'toggle');
    toggle.remove();
    theme.set('dark');
    expect(toggle.dataset.theme).toBe('light');
  });

  it('keeps working when storage and media queries are unavailable', () => {
    const win = themed();
    vi.spyOn(win.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(win.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    Object.defineProperty(win, 'matchMedia', { value: undefined, configurable: true });
    const theme = createTheme(win);
    expect(theme.get()).toBe('light');
    theme.set('dark');
    expect(theme.get()).toBe('dark');
  });

  it('updates toggles when the OS scheme changes', () => {
    const win = themed();
    let dark = false;
    let listener: (() => void) | undefined;
    Object.defineProperty(win, 'matchMedia', {
      configurable: true,
      value: () => ({
        get matches() {
          return dark;
        },
        addEventListener: (_: string, handler: () => void) => (listener = handler)
      })
    });
    const theme = createTheme(win);
    theme.bind(win.document);
    dark = true;
    listener!();
    expect(byId(win, 'toggle').getAttribute('aria-label')).toBe('Switch to light theme');
  });
});
