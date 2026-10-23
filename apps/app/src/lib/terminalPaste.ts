// Ctrl+V / Ctrl+Shift+V paste in the embedded terminal (Windows and Linux).
//
// xterm turns Ctrl+V into the `^V` control character (0x16) and cancels the
// key, so the browser's own paste never runs. Shift+Insert already pastes,
// because xterm leaves that key to the browser: Chromium runs its Paste editing
// command on xterm's hidden textarea, the textarea gets a `paste` event, and
// xterm's paste handler sends the text through its paste path (CR line endings,
// bracketed-paste markers when the program asked for them). Ctrl+V takes the
// same route: the custom key handler returns false for the chord, which tells
// xterm to leave the key alone, and Chromium's Ctrl+V / Ctrl+Shift+V bindings
// do the rest. The renderer never reads the clipboard itself (the desktop
// session denies `navigator.clipboard`), and no new clipboard-read IPC exists.
//
// Programs running in the terminal still can't read the clipboard (OSC 52
// reads stay refused); this is a paste the user asked for with a keystroke.
//
// macOS is unchanged: ⌘V pastes, and Ctrl+V still sends `^V`.

import { isMacShortcutPlatform } from './platformShortcut.js';

function currentPlatform(): string {
  return typeof navigator === 'undefined' ? '' : navigator.platform;
}

/** Virtual-key code of V. Chromium's paste bindings match on it too, so a
 *  non-Latin layout (where `key` is `м`, say) behaves like Chromium's own. */
const VK_V = 86;

/**
 * Default for AppConfig.terminalCtrlVPasteEnabled. On for Windows, where
 * Ctrl+V pastes in Windows Terminal and VS Code. Off for Linux, where terminals
 * keep Ctrl+V as `^V` (and agent TUIs such as Claude Code use it to paste an
 * image) and paste with Ctrl+Shift+V instead.
 */
export function ctrlVPastesByDefault(platform = currentPlatform()): boolean {
  return platform.toUpperCase().startsWith('WIN');
}

export interface TerminalPasteKeyContext {
  /** Resolved "Ctrl+V pastes" setting (stored value, else the platform default). */
  ctrlVPasteEnabled: boolean;
  platform?: string;
}

/**
 * True when this key event is a terminal paste chord, so the custom key
 * handler should return false and leave it to the browser's native paste.
 *
 * - Ctrl+Shift+V pastes on Windows and Linux, always.
 * - Ctrl+V pastes when the setting is on. Off, it stays `^V` (readline's
 *   "insert next character literally", vim's block select).
 * - Never on macOS, never with Alt (AltGr on Windows reports Ctrl+Alt) or Meta.
 *
 * Keydown only: xterm turns the chord into `^V` on keydown, and its keypress
 * handler never sends anything while Ctrl is held.
 */
export function isTerminalPasteKey(
  e: Pick<KeyboardEvent, 'type' | 'keyCode' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
  ctx: TerminalPasteKeyContext
): boolean {
  if (e.type !== 'keydown') return false;
  if (isMacShortcutPlatform(ctx.platform ?? currentPlatform())) return false;
  if (!e.ctrlKey || e.altKey || e.metaKey || e.keyCode !== VK_V) return false;
  return e.shiftKey || ctx.ctrlVPasteEnabled;
}

/**
 * The Ctrl+/ help row for terminal paste, following the resolved "Ctrl+V
 * pastes" setting, or null on macOS (⌘V, unchanged).
 */
export function terminalPasteHelpRow(
  ctrlVPasteEnabled: boolean,
  platform = currentPlatform()
): { keys: string[]; label: string } | null {
  if (isMacShortcutPlatform(platform)) return null;
  return ctrlVPasteEnabled
    ? { keys: ['Ctrl', 'V'], label: 'Paste (Ctrl+Shift+V too; turn off “Ctrl+V pastes” in Settings → Terminal to send ^V)' }
    : { keys: ['Ctrl', '⇧', 'V'], label: 'Paste (turn on “Ctrl+V pastes” in Settings → Terminal for Ctrl+V)' };
}
