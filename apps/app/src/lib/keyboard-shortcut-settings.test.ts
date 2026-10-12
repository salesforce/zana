/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  commandForShortcutEvent,
  DEFAULT_APP_KEYBINDINGS,
  REMAPPABLE_COMMANDS,
  setCommandShortcutOverride,
  shortcutLabelForCommand,
  titleWithShortcut
} from './keyboard-shortcut-settings.js';
import { NAMED_PANE_COMMANDS, PANE_FOCUS_INDEX_COMMANDS } from './split-layout/paneCommands.js';

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

afterEach(() => {
  localStorage.removeItem('zcc.keyboard-overrides');
});

describe('split pane default bindings', () => {
  it('binds every pane command, gated to an active split outside modals', () => {
    for (const command of [...NAMED_PANE_COMMANDS.map((row) => row.command), ...PANE_FOCUS_INDEX_COMMANDS]) {
      const binding = DEFAULT_APP_KEYBINDINGS.find((row) => row.command === command);
      expect(binding, command).toBeDefined();
      expect(binding?.shortcut?.mod).toBe(true);
      expect(binding?.when).toEqual({ all: ['splitActive'], none: ['modalOpen'] });
    }
  });

  it('lists named pane commands as remappable, but not the numbered ones', () => {
    const remappable = REMAPPABLE_COMMANDS.map((row) => row.command);
    for (const { command } of NAMED_PANE_COMMANDS) expect(remappable).toContain(command);
    expect(remappable).not.toContain('pane.focus.1');
  });
});

describe('commandForShortcutEvent', () => {
  const commands = ['pane.focus.left', 'pane.focus.next', 'pane.close', 'pane.focus.2'] as const;

  it('returns the first matching command for the platform', () => {
    expect(
      commandForShortcutEvent(commands, key({ key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true, altKey: true }), 'MacIntel')
    ).toBe('pane.focus.left');
    expect(commandForShortcutEvent(commands, key({ key: '2', code: 'Digit2', ctrlKey: true }), 'Win32')).toBe(
      'pane.focus.2'
    );
    // Option+] composes "‘" on macOS.
    expect(
      commandForShortcutEvent(commands, key({ key: '‘', code: 'BracketRight', metaKey: true, altKey: true }), 'MacIntel')
    ).toBe('pane.focus.next');
  });

  it('returns null when nothing matches, including the wrong platform modifier', () => {
    expect(commandForShortcutEvent(commands, key({ key: 'x', code: 'KeyX', metaKey: true }), 'MacIntel')).toBeNull();
    expect(commandForShortcutEvent(commands, key({ key: '2', code: 'Digit2', ctrlKey: true }), 'MacIntel')).toBeNull();
  });

  it('matches the digit key on non-US layouts and the composed bracket', () => {
    // AZERTY: ⌘ + the 2 key reports "é".
    expect(commandForShortcutEvent(commands, key({ key: 'é', code: 'Digit2', metaKey: true }), 'MacIntel')).toBe(
      'pane.focus.2'
    );
    // German Mac: "[" is ⌥5, so ⌘⌥[ arrives as code Digit5.
    expect(
      commandForShortcutEvent(['pane.focus.previous'], key({ key: '[', code: 'Digit5', metaKey: true, altKey: true }), 'MacIntel')
    ).toBe('pane.focus.previous');
    // US ⌘⌥5 composes "∞"; nothing is bound there.
    expect(
      commandForShortcutEvent(['pane.focus.previous', 'pane.focus.2'], key({ key: '∞', code: 'Digit5', metaKey: true, altKey: true }), 'MacIntel')
    ).toBeNull();
  });

  it('lets Ctrl stand in for ⌘ on mac only when asked', () => {
    const ctrl2 = key({ key: '2', code: 'Digit2', ctrlKey: true });
    const options = { acceptControlAsMod: true };
    expect(commandForShortcutEvent(commands, ctrl2, 'MacIntel', options)).toBe('pane.focus.2');
    expect(
      commandForShortcutEvent(commands, key({ key: 'w', code: 'KeyW', ctrlKey: true, altKey: true }), 'MacIntel', options)
    ).toBe('pane.close');
    // Ctrl+⌘ is neither binding; non-mod overrides stay exact.
    expect(
      commandForShortcutEvent(commands, key({ key: '2', code: 'Digit2', ctrlKey: true, metaKey: true }), 'MacIntel', options)
    ).toBeNull();
    window.localStorage.setItem(
      'zcc.keyboard-overrides',
      JSON.stringify([
        { command: 'pane.focus.2', shortcut: { key: 'g', mod: false, meta: true, control: false, alt: false, shift: false } }
      ])
    );
    expect(commandForShortcutEvent(commands, key({ key: 'g', code: 'KeyG', ctrlKey: true }), 'MacIntel', options)).toBeNull();
    window.localStorage.removeItem('zcc.keyboard-overrides');
  });

  it('follows overrides and drops an unbound command', () => {
    setCommandShortcutOverride('pane.close', {
      key: 'q',
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true
    });
    setCommandShortcutOverride('pane.focus.left', null);
    expect(
      commandForShortcutEvent(commands, key({ key: 'Q', code: 'KeyQ', metaKey: true, shiftKey: true }), 'MacIntel')
    ).toBe('pane.close');
    expect(
      commandForShortcutEvent(commands, key({ key: 'w', code: 'KeyW', metaKey: true, altKey: true }), 'MacIntel')
    ).toBeNull();
    expect(
      commandForShortcutEvent(commands, key({ key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true, altKey: true }), 'MacIntel')
    ).toBeNull();
  });
});

describe('shortcut labels and titles', () => {
  it('formats the current binding', () => {
    expect(shortcutLabelForCommand('pane.maximize.toggle', 'MacIntel')).toContain('M');
    expect(titleWithShortcut('Close pane', 'pane.close')).toMatch(/^Close pane \(.+\)$/);
  });

  it('falls back to the bare label once a command is unbound', () => {
    setCommandShortcutOverride('pane.close', null);
    expect(shortcutLabelForCommand('pane.close', 'MacIntel')).toBeNull();
    expect(titleWithShortcut('Close pane', 'pane.close')).toBe('Close pane');
  });
});
