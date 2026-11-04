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
import { NAMED_PANE_COMMANDS, PANE_FOCUS_INDEX_COMMANDS } from './split-layout/paneCommands.js';

const STORAGE_KEY = 'zcc.keyboard-overrides';

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'OS', 'Shift']);

export const REMAPPABLE_COMMANDS: Array<{
  command: AppCommandId;
  label: string;
  help: string;
}> = [
  { command: 'thread.new', label: 'New Chat', help: 'Open New Chat with your default launch mode.' },
  { command: 'thread.search', label: 'Command palette', help: 'Open the command palette.' },
  { command: 'thread.find', label: 'Search in thread', help: 'Search the conversation in the open thread.' },
  { command: 'file.quickOpen', label: 'Quick Open', help: 'Open a file in the selected project.' },
  { command: 'sidebar.toggle', label: 'Toggle explorer', help: 'Switch between terminals and the file explorer.' },
  { command: 'settings.open', label: 'Settings', help: 'Open or close Settings. Inside a project, opens its Project settings.' },
  { command: 'browser.focusLocation', label: 'Browser address bar', help: 'Focus the in-app browser address bar.' },
  { command: 'browser.find', label: 'Find in page', help: 'Find text in the in-app browser tab.' },
  { command: 'browser.reload', label: 'Reload browser tab', help: 'Reload the in-app browser tab.' },
  ...NAMED_PANE_COMMANDS
];

const SPLIT_PANE_WHEN = { all: ['splitActive' as const], none: ['modalOpen' as const] };

function splitPaneBinding(
  command: AppCommandId,
  key: string,
  modifiers: { alt?: boolean; shift?: boolean } = {}
): AppDefaultKeybindings[number] {
  return {
    command,
    desktopOnly: false,
    shortcut: { key, mod: true, meta: false, control: false, alt: modifiers.alt ?? false, shift: modifiers.shift ?? false },
    when: SPLIT_PANE_WHEN
  };
}

export const DEFAULT_APP_KEYBINDINGS: AppDefaultKeybindings = [
  {
    command: 'thread.new',
    desktopOnly: false,
    shortcut: { key: 'n', mod: true, meta: false, control: false, alt: false, shift: false },
    when: { all: [], none: [] }
  },
  {
    command: 'thread.search',
    desktopOnly: false,
    shortcut: { key: 'p', mod: true, meta: false, control: false, alt: false, shift: false },
    when: { all: [], none: [] }
  },
  {
    command: 'thread.find',
    desktopOnly: false,
    shortcut: { key: 'f', mod: true, meta: false, control: false, alt: false, shift: false },
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
  },
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
  },
  splitPaneBinding('pane.focus.left', 'ArrowLeft', { alt: true }),
  splitPaneBinding('pane.focus.right', 'ArrowRight', { alt: true }),
  splitPaneBinding('pane.focus.up', 'ArrowUp', { alt: true }),
  splitPaneBinding('pane.focus.down', 'ArrowDown', { alt: true }),
  splitPaneBinding('pane.focus.previous', '[', { alt: true }),
  splitPaneBinding('pane.focus.next', ']', { alt: true }),
  ...PANE_FOCUS_INDEX_COMMANDS.map((command, index) => splitPaneBinding(command, String(index + 1))),
  splitPaneBinding('pane.maximize.toggle', 'm', { shift: true }),
  splitPaneBinding('pane.close', 'w', { alt: true })
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

/**
 * The ways one key press can read: as normalized, as the composed character
 * (German ⌥5 types "["), and as the digit key it sits on (AZERTY ⌘& is ⌘1).
 */
function shortcutEventReadings(event: KeyboardEvent): AppShortcutInput[] {
  const readings: AppShortcutInput[] = [event, { ...modifiersOf(event), key: event.key, code: '' }];
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
  if (digit !== undefined && event.key !== digit) readings.push({ ...modifiersOf(event), key: digit, code: '' });
  return readings;
}

function modifiersOf(event: KeyboardEvent): Omit<AppShortcutInput, 'key' | 'code'> {
  return { altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey };
}

/**
 * First of `commands` whose resolved binding matches `event` (one storage read).
 * `acceptControlAsMod` also lets Ctrl stand in for ⌘ on mac `mod` bindings.
 */
export function commandForShortcutEvent<T extends AppCommandId>(
  commands: readonly T[],
  event: KeyboardEvent,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
  options: { acceptControlAsMod?: boolean } = {}
): T | null {
  const useMetaForMod = isMacKeyboardPlatform(platform);
  const controlAsMod = useMetaForMod && options.acceptControlAsMod === true && event.ctrlKey && !event.metaKey;
  const bindings = resolvedKeyboardBindings();
  const readings = shortcutEventReadings(event);
  for (const command of commands) {
    const binding = bindings.find((row) => row.command === command);
    if (!binding) continue;
    for (const input of readings) {
      if (matchesAppShortcut(input, binding.shortcut, useMetaForMod)) return command;
      if (controlAsMod && binding.shortcut.mod && matchesAppShortcut(input, binding.shortcut, false)) return command;
    }
  }
  return null;
}

/** Display label of a command's current binding, or null when it has none. */
export function shortcutLabelForCommand(
  command: AppCommandId,
  platform = typeof navigator === 'undefined' ? '' : navigator.platform
): string | null {
  const binding = resolvedKeyboardBindings().find((row) => row.command === command);
  return binding ? formatAppShortcut(binding.shortcut, platform) : null;
}

/** `label (⌘⌥W)` when the command has a binding, else just `label`. */
export function titleWithShortcut(label: string, command: AppCommandId): string {
  const shortcut = shortcutLabelForCommand(command);
  return shortcut === null ? label : `${label} (${shortcut})`;
}
