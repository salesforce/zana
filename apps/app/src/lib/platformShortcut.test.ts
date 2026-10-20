import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMacShortcutPlatform, platformKey, platformShortcut } from './platformShortcut.js';

describe('platformShortcut', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('leaves macOS copy untouched', () => {
    expect(platformShortcut('Reopen with ⌘⇧T.', 'MacIntel')).toBe('Reopen with ⌘⇧T.');
    expect(platformKey('⌘', 'MacIntel')).toBe('⌘');
    expect(isMacShortcutPlatform('iPad')).toBe(true);
  });

  it('spells modifier glyph runs as PC chords', () => {
    expect(platformShortcut('⌘↵ to send', 'Win32')).toBe('Ctrl+Enter to send');
    expect(platformShortcut('Reopen with ⌘⇧T.', 'Win32')).toBe('Reopen with Ctrl+Shift+T.');
    expect(platformShortcut('⌘+Enter to save', 'Win32')).toBe('Ctrl+Enter to save');
    expect(platformShortcut('⌘ ⌥ W', 'Linux x86_64')).toBe('Ctrl+Alt+W');
    expect(platformShortcut('⌃⌘K', 'Win32')).toBe('Ctrl+K');
    expect(platformShortcut('Switch to tab 1 (… up to ⌘9)', 'Win32')).toBe('Switch to tab 1 (… up to Ctrl+9)');
    expect(platformShortcut('Press ⌘/ to see every shortcut.', 'Win32')).toBe('Press Ctrl+/ to see every shortcut.');
    expect(platformShortcut('↵ new · ⇧↵ active tab', 'Win32')).toBe('Enter new · Shift+Enter active tab');
  });

  it('spells key glyphs by name, alone or after modifiers', () => {
    expect(platformShortcut('⌘⌫ deletes the line', 'Win32')).toBe('Ctrl+Backspace deletes the line');
    expect(platformShortcut('⎋ closes · ⇧⇥ goes back · ⌦ removes', 'Win32')).toBe('Esc closes · Shift+Tab goes back · Delete removes');
    expect(platformKey('⎋', 'Win32')).toBe('Esc');
    expect(platformShortcut('⌘⌫', 'MacIntel')).toBe('⌘⌫');
  });

  it('shows ⌃⌘ chords as the single Ctrl they are pressed with off macOS', () => {
    expect(platformShortcut('⌃⌘X', 'Win32')).toBe(platformShortcut('⌘X', 'Win32'));
    expect(platformShortcut('⌃⌥⌘X', 'Win32')).toBe('Ctrl+Alt+X');
  });

  it('collapses already-bilingual copy to the PC half', () => {
    expect(platformShortcut('⌘/Ctrl+Enter to run', 'Win32')).toBe('Ctrl+Enter to run');
  });

  it('maps single key caps and passes unknown keys through', () => {
    expect(['⌘', '⇧', '⌥', '⌃', '↵', 'T'].map((key) => platformKey(key, 'Win32'))).toEqual(['Ctrl', 'Shift', 'Alt', 'Ctrl', 'Enter', 'T']);
    expect(platformShortcut('/tmp/project', 'Win32')).toBe('/tmp/project');
  });

  it('reads navigator.platform by default and treats a missing navigator as PC', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(platformShortcut('⌘S')).toBe('⌘S');
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(platformShortcut('⌘S')).toBe('Ctrl+S');
    vi.stubGlobal('navigator', undefined);
    expect(isMacShortcutPlatform()).toBe(false);
  });
});
