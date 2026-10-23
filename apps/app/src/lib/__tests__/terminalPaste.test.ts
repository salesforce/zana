import { describe, expect, it } from 'vitest';
import { ctrlVPastesByDefault, isTerminalPasteKey, terminalPasteHelpRow } from '../terminalPaste.js';

const key = (over: Partial<KeyboardEvent> = {}) => ({
  type: 'keydown', keyCode: 86, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...over
});
const on = { ctrlVPasteEnabled: true, platform: 'Win32' };
const off = { ctrlVPasteEnabled: false, platform: 'Win32' };

describe('ctrlVPastesByDefault', () => {
  it('is on for Windows only', () => {
    expect(ctrlVPastesByDefault('Win32')).toBe(true);
    expect(ctrlVPastesByDefault('win64')).toBe(true);
    expect(ctrlVPastesByDefault('Linux x86_64')).toBe(false);
    expect(ctrlVPastesByDefault('MacIntel')).toBe(false);
    expect(ctrlVPastesByDefault('')).toBe(false);
  });

  it('reads navigator.platform by default', () => {
    expect(ctrlVPastesByDefault()).toBe(ctrlVPastesByDefault(navigator.platform));
  });
});

describe('isTerminalPasteKey', () => {
  it('treats Ctrl+V as paste only while the setting is on', () => {
    expect(isTerminalPasteKey(key(), on)).toBe(true);
    expect(isTerminalPasteKey(key(), off)).toBe(false);
  });

  it('always treats Ctrl+Shift+V as paste off macOS', () => {
    expect(isTerminalPasteKey(key({ shiftKey: true }), off)).toBe(true);
    expect(isTerminalPasteKey(key({ shiftKey: true }), { ctrlVPasteEnabled: false, platform: 'Linux x86_64' })).toBe(true);
  });

  it('never matches on macOS', () => {
    const mac = { ctrlVPasteEnabled: true, platform: 'MacIntel' };
    expect(isTerminalPasteKey(key(), mac)).toBe(false);
    expect(isTerminalPasteKey(key({ shiftKey: true }), mac)).toBe(false);
  });

  it('ignores Alt (AltGr), Meta, other keys, missing Ctrl and non-keydown events', () => {
    expect(isTerminalPasteKey(key({ altKey: true }), on)).toBe(false);
    expect(isTerminalPasteKey(key({ metaKey: true }), on)).toBe(false);
    expect(isTerminalPasteKey(key({ keyCode: 67 }), on)).toBe(false);
    expect(isTerminalPasteKey(key({ ctrlKey: false }), on)).toBe(false);
    expect(isTerminalPasteKey(key({ type: 'keyup' }), on)).toBe(false);
    expect(isTerminalPasteKey(key({ type: 'keypress' }), on)).toBe(false);
  });

  it('falls back to navigator.platform when no platform is given', () => {
    const mac = navigator.platform.toUpperCase().startsWith('MAC');
    expect(isTerminalPasteKey(key(), { ctrlVPasteEnabled: true })).toBe(!mac);
  });
});

describe('terminalPasteHelpRow', () => {
  it('follows the setting, not the platform default, and shows nothing on macOS', () => {
    for (const platform of ['Win32', 'Linux x86_64']) {
      expect(terminalPasteHelpRow(true, platform)?.keys).toEqual(['Ctrl', 'V']);
      expect(terminalPasteHelpRow(true, platform)?.label).toContain('turn off “Ctrl+V pastes”');
      expect(terminalPasteHelpRow(false, platform)?.keys).toEqual(['Ctrl', '⇧', 'V']);
      expect(terminalPasteHelpRow(false, platform)?.label).toContain('turn on “Ctrl+V pastes”');
    }
    expect(terminalPasteHelpRow(true, 'MacIntel')).toBeNull();
    expect(terminalPasteHelpRow(false, 'MacIntel')).toBeNull();
  });

  it('reads navigator.platform by default', () => {
    expect(terminalPasteHelpRow(true)).toEqual(terminalPasteHelpRow(true, navigator.platform));
  });
});
