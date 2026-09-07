import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyboardSettingsSection } from './KeyboardSettingsSection.js';
import {
  appShortcutFromInput,
  DEFAULT_APP_KEYBINDINGS,
  formatAppShortcut,
  REMAPPABLE_COMMANDS
} from '@/lib/keyboard-shortcut-settings';

describe('KeyboardSettingsSection', () => {
  it('lists remappable commands', () => {
    const html = renderToStaticMarkup(<KeyboardSettingsSection />);
    expect(html).toContain('settings-anchor-keyboard');
    for (const command of REMAPPABLE_COMMANDS) {
      expect(html).toContain(`keyboard-shortcut-${command.command}`);
      expect(html).toContain(command.label);
    }
  });
});

describe('keyboard shortcut helpers', () => {
  it('formats a Mac command chord', () => {
    expect(formatAppShortcut(DEFAULT_APP_KEYBINDINGS[0]!.shortcut!, 'MacIntel')).toBe('⌘ P');
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
