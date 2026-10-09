import { REMAPPABLE_COMMANDS } from '../../keyboard-shortcut-settings';
import type { SettingsSearchEntry, SettingsSearchProvider } from '../types';

/**
 * Runtime provider for Settings > Shortcuts: one entry per remappable command,
 * so a renamed or added command is searchable without touching a static list.
 * The Shortcuts view renders each row with `searchId={`keyboard.${command}`}`.
 */
export const keyboardSearchProvider: SettingsSearchProvider = () =>
  REMAPPABLE_COMMANDS.map(
    (command): SettingsSearchEntry => ({
      id: `keyboard.${command.command}`,
      section: 'keyboard',
      anchor: 'keyboard',
      label: command.label,
      help: command.help,
      keywords: ['shortcut', 'keybinding', 'hotkey', 'chord', 'remap'],
      kind: 'setting'
    })
  );
