import { describe, expect, it } from 'vitest';
import type { AppKeybindings } from '@zana-ai/zcc-domain/thread-runtime';
import {
  DESKTOP_BROWSER_DEFAULT_KEYBINDINGS,
  resolveDesktopBrowserAppCommand
} from './desktop-browser-shortcuts.js';

const keybindings: AppKeybindings = [
  {
    command: 'thread.search',
    desktopOnly: false,
    shortcut: { key: 'k', mod: true, meta: false, control: false, alt: false, shift: false },
    when: { all: ['mainSurface'], none: [] }
  },
  ...DESKTOP_BROWSER_DEFAULT_KEYBINDINGS
];

describe('resolveDesktopBrowserAppCommand', () => {
  it('resolves only browser commands using platform modifier semantics', () => {
    expect(
      resolveDesktopBrowserAppCommand({
        input: {
          altKey: false,
          ctrlKey: false,
          code: 'KeyL',
          key: 'l',
          metaKey: true,
          shiftKey: false
        },
        isMac: true,
        keybindings
      })
    ).toBe('browser.focusLocation');
    expect(
      resolveDesktopBrowserAppCommand({
        input: {
          altKey: false,
          ctrlKey: false,
          code: 'KeyF',
          key: 'f',
          metaKey: true,
          shiftKey: false
        },
        isMac: true,
        keybindings
      })
    ).toBe('browser.find');
    expect(
      resolveDesktopBrowserAppCommand({
        input: {
          altKey: false,
          ctrlKey: false,
          code: 'KeyK',
          key: 'k',
          metaKey: true,
          shiftKey: false
        },
        isMac: true,
        keybindings
      })
    ).toBeNull();
    expect(
      resolveDesktopBrowserAppCommand({
        input: {
          altKey: false,
          ctrlKey: true,
          code: 'KeyL',
          key: 'l',
          metaKey: false,
          shiftKey: false
        },
        isMac: false,
        keybindings
      })
    ).toBe('browser.focusLocation');
  });
});
