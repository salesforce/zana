import { describe, it, expect, afterEach } from 'vitest';
import { resolveTheme } from '../store.js';

/**
 * resolveTheme maps the stored tri-state AppConfig.theme to the concrete
 * dark/light the app paints (WARP-A2). 'dark'/'light' pin; 'system' (and any
 * unknown value) follows the OS via `matchMedia('(prefers-color-scheme: light)')`,
 * defaulting to dark when matchMedia is unavailable (headless/test) — the app's
 * historical default. The test env is node (no jsdom), so we stub window.
 */

function stubMatchMedia(prefersLight: boolean | null) {
  if (prefersLight === null) {
    delete (globalThis as { window?: unknown }).window;
    return;
  }
  (globalThis as { window?: unknown }).window = {
    matchMedia: (q: string) => ({
      matches: q.includes('light') ? prefersLight : !prefersLight
    })
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('resolveTheme (WARP-A2)', () => {
  it('pins dark / light regardless of the OS', () => {
    stubMatchMedia(true); // OS prefers light
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it("'system' follows the OS preference", () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('light');
    stubMatchMedia(false);
    expect(resolveTheme('system')).toBe('dark');
  });

  it("'system' defaults to dark when matchMedia is unavailable", () => {
    stubMatchMedia(null);
    expect(resolveTheme('system')).toBe('dark');
  });

  it('an undefined / unknown value follows the OS (never throws)', () => {
    stubMatchMedia(true);
    expect(resolveTheme(undefined)).toBe('light');
  });
});
