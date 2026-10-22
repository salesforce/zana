import type { SettingsSearchEntry } from '../types';
import { platformShortcut } from '../../platformShortcut.js';

/**
 * Settings > Shortcuts. Per-command rows come from the runtime provider in
 * `providers/keyboard.ts` (built from REMAPPABLE_COMMANDS); only the static
 * rows live here.
 */
export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'keyboard.shortcuts-intro',
    section: 'keyboard',
    anchor: 'keyboard',
    label: 'Shortcuts',
    help: platformShortcut('Remap New Chat, the palette, thread search, Quick Open, the explorer, Settings, and split-pane navigation. Press ⌘/ to see every shortcut.'),
    keywords: ['keybindings', 'hotkeys', 'keyboard', 'remap', 'chords'],
    kind: 'subsection'
  },
  {
    id: 'keyboard.all-shortcuts',
    section: 'keyboard',
    anchor: 'keyboard',
    label: 'All shortcuts',
    help: platformShortcut('The full list, including chords that are not remappable here. Press ⌘/ from anywhere. Show'),
    keywords: ['cheat sheet', 'hotkeys', 'keybindings'],
    kind: 'action'
  }
];
