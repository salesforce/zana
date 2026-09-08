import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyboardSettingsSection } from './KeyboardSettingsSection.js';
import {
  appShortcutFromInput,
  DEFAULT_APP_KEYBINDINGS,
  formatAppShortcut,
  REMAPPABLE_COMMANDS
} from '@/lib/keyboard-shortcut-settings';

vi.mock('@/store', () => ({
  useUi: { getState: () => ({ setShortcutsOpen: () => {} }) }
}));

describe('KeyboardSettingsSection', () => {
  it('lists remappable commands', () => {
    const html = renderToStaticMarkup(<KeyboardSettingsSection />);
    expect(html).toContain('settings-anchor-keyboard');
    expect(html).toContain('show-all-shortcuts');
    expect(html).toContain('⌘/');
    expect(html).toContain('Shortcuts');
    for (const command of REMAPPABLE_COMMANDS) {
      expect(html).toContain(`keyboard-shortcut-${command.command}`);
      expect(html).toContain(command.label);
    }
  });
});

describe('keyboard shortcut helpers', () => {
  it('formats a Mac command chord', () => {
    const palette = DEFAULT_APP_KEYBINDINGS.find((row) => row.command === 'thread.search');
    expect(formatAppShortcut(palette!.shortcut!, 'MacIntel')).toBe('⌘ P');
    const newChat = DEFAULT_APP_KEYBINDINGS.find((row) => row.command === 'thread.new');
    expect(formatAppShortcut(newChat!.shortcut!, 'MacIntel')).toBe('⌘ N');
  });

  it('captures a command chord from a keyboard event', () => {
    const shortcut = appShortcutFromInput(
      {
        altKey: false,
        code: 'KeyK',
        ctrlKey: false,
        key: 'k',
        metaKey: true,
        shiftKey: false
      },
      'MacIntel'
    );
    expect(shortcut).toEqual({
      key: 'k',
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false
    });
  });
});
