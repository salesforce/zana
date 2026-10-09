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

describe('keyboard search provider', () => {
  it('yields one entry per remappable command, matching the rendered searchId', async () => {
    const { keyboardSearchProvider } = await import('../../lib/settings-search/providers/keyboard.js');
    const entries = keyboardSearchProvider({ config: {} as never });
    expect(entries.map((e) => e.id)).toEqual(REMAPPABLE_COMMANDS.map((c) => `keyboard.${c.command}`));
    expect(entries[0]).toMatchObject({ section: 'keyboard', anchor: 'keyboard', label: REMAPPABLE_COMMANDS[0].label, help: REMAPPABLE_COMMANDS[0].help });
    const html = renderToStaticMarkup(<KeyboardSettingsSection />);
    for (const e of entries) expect(html).toContain(`data-settings-target="${e.id}"`);
  });
});
