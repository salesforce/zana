import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { WINDOWS_TITLEBAR_OVERLAY_COLORS } from './titlebar-overlay.js';
import {
  BG_BASE,
  resolveThemeSetting,
  seedDocumentTheme,
  themeFromArgv,
  windowThemeOptions
} from './window-theme.js';

const css = readFileSync(fileURLToPath(new URL('../../../app/src/styles/global.css', import.meta.url)), 'utf8');

function token(selector: string, name: string): string | undefined {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`no rule ${selector}`);
  return css.slice(start, css.indexOf('}', start)).match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
}

describe('window background colours', () => {
  it('match --bg-base in global.css for both themes, which the page paints under html and body', () => {
    expect(BG_BASE.dark).toBe(token(':root', '--bg-base'));
    expect(BG_BASE.light).toBe(token(":root[data-theme='light']", '--bg-base'));
    expect(css).toMatch(/\nhtml,\s*body,\s*#root \{[^}]*background: var\(--bg-base\);/);
  });

  it('are the colours the Windows caption buttons sit on', () => {
    expect(WINDOWS_TITLEBAR_OVERLAY_COLORS.dark.color).toBe(BG_BASE.dark);
    expect(WINDOWS_TITLEBAR_OVERLAY_COLORS.light.color).toBe(BG_BASE.light);
  });
});

describe('resolveThemeSetting', () => {
  it('pins dark and light without reading the OS', () => {
    const osDark = vi.fn(() => true);
    expect(resolveThemeSetting('dark', osDark)).toBe('dark');
    expect(resolveThemeSetting('light', osDark)).toBe('light');
    expect(osDark).not.toHaveBeenCalled();
  });

  it('follows the OS for System and unknown values', () => {
    expect(resolveThemeSetting('system', () => true)).toBe('dark');
    expect(resolveThemeSetting('system', () => false)).toBe('light');
    expect(resolveThemeSetting('sepia', () => false)).toBe('light');
  });

  it('treats an unset theme as dark, like the renderer, whatever the OS', () => {
    expect(resolveThemeSetting(undefined, () => false)).toBe('dark');
  });
});

describe('windowThemeOptions', () => {
  it('gives the background and preload argument for the effective theme', () => {
    expect(windowThemeOptions(() => 'light', vi.fn())).toEqual({ backgroundColor: '#f6f8fa', themeArg: '--zcc-theme=light' });
    expect(windowThemeOptions(() => 'dark', vi.fn())).toEqual({ backgroundColor: '#181818', themeArg: '--zcc-theme=dark' });
  });

  it('logs a failed theme read and opens dark', () => {
    const logError = vi.fn();
    const err = new Error('config unreadable');
    expect(windowThemeOptions(() => { throw err; }, logError)).toEqual({ backgroundColor: '#181818', themeArg: '--zcc-theme=dark' });
    expect(logError).toHaveBeenCalledWith('window theme', err);
  });
});

describe('themeFromArgv', () => {
  it('reads the theme argument among other argv tokens', () => {
    expect(themeFromArgv(['electron', '--zcc-e2e', '--zcc-theme=light'])).toBe('light');
    expect(themeFromArgv(['--zcc-theme=dark'])).toBe('dark');
  });

  it('ignores a missing or malformed theme', () => {
    expect(themeFromArgv(['--zcc-e2e'])).toBeNull();
    expect(themeFromArgv(['--zcc-theme=system'])).toBeNull();
    expect(themeFromArgv(['--zcc-theme='])).toBeNull();
  });
});

describe('seedDocumentTheme', () => {
  function fakeObserver() {
    const state = { callback: undefined as (() => void) | undefined, observed: [] as unknown[], disconnected: false };
    class Observer {
      constructor(callback: () => void) { state.callback = callback; }
      observe(target: unknown, options: unknown) { state.observed.push([target, options]); }
      disconnect() { state.disconnected = true; }
    }
    return { state, factory: Observer };
  }

  it('sets data-theme straight away when <html> exists', () => {
    const doc = { documentElement: { dataset: {} as Record<string, string | undefined> } };
    const { state, factory } = fakeObserver();
    seedDocumentTheme(['--zcc-theme=light'], doc, factory);
    expect(doc.documentElement.dataset.theme).toBe('light');
    expect(state.callback).toBeUndefined();
  });

  it('waits for the parser to create <html>, then stops watching', () => {
    const doc: { documentElement: { dataset: Record<string, string | undefined> } | null } = { documentElement: null };
    const { state, factory } = fakeObserver();
    seedDocumentTheme(['--zcc-theme=light'], doc, factory);
    expect(state.observed).toEqual([[doc, { childList: true }]]);
    // A mutation before <html> exists (e.g. the doctype) keeps watching.
    state.callback!();
    expect(state.disconnected).toBe(false);
    doc.documentElement = { dataset: {} };
    state.callback!();
    expect(doc.documentElement.dataset.theme).toBe('light');
    expect(state.disconnected).toBe(true);
  });

  it('keeps a theme the page already set', () => {
    const doc = { documentElement: { dataset: { theme: 'dark' } as Record<string, string | undefined> } };
    seedDocumentTheme(['--zcc-theme=light'], doc, fakeObserver().factory);
    expect(doc.documentElement.dataset.theme).toBe('dark');
  });

  it('does nothing without a theme argument or a document', () => {
    const doc = { documentElement: null };
    const { state, factory } = fakeObserver();
    seedDocumentTheme(['--zcc-e2e'], doc, factory);
    seedDocumentTheme(['--zcc-theme=light'], undefined, factory);
    expect(state.callback).toBeUndefined();
  });
});
