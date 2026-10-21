import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMacPlatform, modShortcut } from './shortcut-label.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('shortcut labels', () => {
  it('keeps macOS glyphs on Apple platforms', () => {
    for (const platform of ['MacIntel', 'iPad', 'iPhone']) expect(isMacPlatform(platform)).toBe(true);
    expect(modShortcut('P', 'MacIntel')).toBe('⌘P');
    expect(modShortcut('Enter', 'MacIntel')).toBe('⌘↵');
  });

  it('spells out Ctrl on Windows and Linux', () => {
    for (const platform of ['Win32', 'Linux x86_64', '']) expect(isMacPlatform(platform)).toBe(false);
    expect(modShortcut('S', 'Win32')).toBe('Ctrl+S');
    expect(modShortcut('Enter', 'Linux x86_64')).toBe('Ctrl+Enter');
  });

  it('reads the platform from navigator, and treats a missing navigator as non-Mac', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(modShortcut('B')).toBe('⌘B');
    vi.stubGlobal('navigator', undefined);
    expect(modShortcut('B')).toBe('Ctrl+B');
  });
});
