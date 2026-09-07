import {
  applyAppKeybindingOverrides,
  appKeybindingOverridesSchema,
  isMacKeyboardPlatform,
  matchesAppShortcut,
  normalizeAppShortcutInputKey,
  type AppCommandId,
  type AppDefaultKeybindings,
  type AppKeybindingOverrides,
  type AppShortcut,
  type AppShortcutInput
} from '@zana-ai/zcc-domain/thread-runtime';

const STORAGE_KEY = 'zcc.keyboard-overrides';

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'OS', 'Shift']);

export const REMAPPABLE_COMMANDS: Array<{
  command: AppCommandId;
  label: string;
  help: string;
}> = [
  { command: 'thread.search', label: 'Command palette', help: 'Open the command palette.' },
  { command: 'file.quickOpen', label: 'Quick Open', help: 'Open a file in the selected project.' },
  { command: 'sidebar.toggle', label: 'Toggle explorer', help: 'Switch between terminals and the file explorer.' },
  { command: 'settings.open', label: 'Settings', help: 'Open or close Settings.' }
];

export const DEFAULT_APP_KEYBINDINGS: AppDefaultKeybindings = [
  {
    command: 'thread.search',
    desktopOnly: false,
    shortcut: { key: 'p', mod: true, meta: false, control: false, alt: false, shift: false },
    when: { all: [], none: [] }
  },
  {
    command: 'file.quickOpen',
    desktopOnly: false,
    shortcut: { key: 'e', mod: true, meta: false, control: false, alt: false, shift: false },
    when: { all: [], none: [] }
  },
  {
    command: 'sidebar.toggle',
    desktopOnly: false,
    shortcut: { key: 'b', mod: true, meta: false, control: false, alt: false, shift: false },
    when: { all: [], none: [] }
  },
  {
    command: 'settings.open',
    desktopOnly: false,
    shortcut: { key: ',', mod: true, meta: false, control: false, alt: false, shift: false },
    when: { all: [], none: [] }
  }
];

export function appShortcutFromInput(
  input: AppShortcutInput,
  platform: string
): AppShortcut | null {
  if (MODIFIER_KEYS.has(input.key) || input.key === 'Dead' || input.key === 'Unidentified') {
    return null;
  }
  const normalizedKey = normalizeAppShortcutInputKey(input);
  if (normalizedKey.length === 0 || normalizedKey.length > 32) return null;
  const useMetaForMod = isMacKeyboardPlatform(platform);
  const mod = useMetaForMod ? input.metaKey : input.ctrlKey;
  return {
    key: normalizedKey.length === 1 ? normalizedKey.toLowerCase() : normalizedKey,
    mod,
    meta: input.metaKey && !(mod && useMetaForMod),
    control: input.ctrlKey && !(mod && !useMetaForMod),
    alt: input.altKey,
    shift: input.shiftKey
  };
}

export function formatAppShortcut(shortcut: AppShortcut, platform: string): string {
  const useMetaForMod = isMacKeyboardPlatform(platform);
  const showMeta = shortcut.meta || (shortcut.mod && useMetaForMod);
  const showControl = shortcut.control || (shortcut.mod && !useMetaForMod);
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  if (useMetaForMod) {
    const parts: string[] = [];
    if (showControl) parts.push('⌃');
    if (shortcut.alt) parts.push('⌥');
    if (shortcut.shift) parts.push('⇧');
    if (showMeta) parts.push('⌘');
    parts.push(key);
    return parts.join(' ');
  }
  const parts: string[] = [];
  if (showControl) parts.push('Ctrl');
  if (shortcut.alt) parts.push('Alt');
  if (shortcut.shift) parts.push('Shift');
  if (showMeta) parts.push('Meta');
  parts.push(key);
  return parts.join(' + ');
}

export function readKeyboardOverrides(): AppKeybindingOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return appKeybindingOverridesSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeKeyboardOverrides(overrides: AppKeybindingOverrides): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appKeybindingOverridesSchema.parse(overrides)));
}

export function resolvedKeyboardBindings(
  overrides: AppKeybindingOverrides = readKeyboardOverrides()
) {
  return applyAppKeybindingOverrides(DEFAULT_APP_KEYBINDINGS, overrides);
}

export function shortcutForCommand(
  command: AppCommandId,
  event: KeyboardEvent,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform
): boolean {
  const binding = resolvedKeyboardBindings().find((row) => row.command === command);
  if (!binding) return false;
  return matchesAppShortcut(event, binding.shortcut, isMacKeyboardPlatform(platform));
}

export function setCommandShortcutOverride(command: AppCommandId, shortcut: AppShortcut | null): void {
  const next = readKeyboardOverrides().filter((row) => row.command !== command);
  next.push({ command, shortcut });
  writeKeyboardOverrides(next);
}

export function resetCommandShortcutOverride(command: AppCommandId): void {
  writeKeyboardOverrides(readKeyboardOverrides().filter((row) => row.command !== command));
}
