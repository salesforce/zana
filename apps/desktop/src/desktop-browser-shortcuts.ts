import {
  matchesAppShortcut,
  type AppCommandId,
  type AppKeybindings,
  type AppShortcutInput
} from '@zana-ai/zcc-domain/thread-runtime';

interface ResolveDesktopBrowserAppCommandArgs {
  input: AppShortcutInput;
  isMac: boolean;
  keybindings: AppKeybindings;
}

export const DESKTOP_BROWSER_DEFAULT_KEYBINDINGS: AppKeybindings = [
  {
    command: 'browser.focusLocation',
    desktopOnly: true,
    shortcut: { key: 'l', mod: true, meta: false, control: false, alt: false, shift: false },
    when: { all: ['mainSurface', 'browserFocus'], none: ['modalOpen'] }
  },
  {
    command: 'browser.reload',
    desktopOnly: true,
    shortcut: { key: 'r', mod: true, meta: false, control: false, alt: false, shift: false },
    when: { all: ['mainSurface', 'browserFocus'], none: ['modalOpen'] }
  },
  {
    command: 'browser.find',
    desktopOnly: true,
    shortcut: { key: 'f', mod: true, meta: false, control: false, alt: false, shift: false },
    when: { all: ['mainSurface', 'browserFocus'], none: ['modalOpen'] }
  }
];

export function resolveDesktopBrowserAppCommand({
  input,
  isMac,
  keybindings
}: ResolveDesktopBrowserAppCommandArgs): AppCommandId | null {
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding || !binding.when.all.includes('browserFocus')) continue;
    if (matchesAppShortcut(input, binding.shortcut, isMac)) {
      return binding.command;
    }
  }
  return null;
}
