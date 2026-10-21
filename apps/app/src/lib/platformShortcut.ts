import { isMacKeyboardPlatform } from '@zana-ai/zcc-domain/thread-runtime';

/**
 * Shortcut copy is authored with macOS glyphs (`⌘⇧T`, `⌘↵`). Off macOS the
 * handlers bind Ctrl/Alt/Shift instead, so the label must say so too.
 *
 * `⌘` and `⌃` both name Ctrl: off macOS the mod key is Ctrl, so a chord using
 * both (`⌃⌘K`) is pressed as Ctrl+K, as `formatAppShortcut` also shows it.
 */
const PC_KEY_NAMES: Record<string, string> = {
  '⌘': 'Ctrl',
  '⌃': 'Ctrl',
  '⌥': 'Alt',
  '⇧': 'Shift',
  '↵': 'Enter',
  '⌫': 'Backspace',
  '⌦': 'Delete',
  '⎋': 'Esc',
  '⇥': 'Tab'
};

const KEY_GLYPHS = /[↵⌫⌦⎋⇥]/gu;

const MODIFIER_GLYPHS = /((?:[⌘⌃⌥⇧]\s?)+)\+?(↵|[^\s+])/gu;

function currentPlatform(): string {
  return typeof navigator === 'undefined' ? '' : navigator.platform;
}

export function isMacShortcutPlatform(platform = currentPlatform()): boolean {
  return isMacKeyboardPlatform(platform);
}

/** One key cap of a shortcut (`⌘` → `Ctrl` off macOS). */
export function platformKey(key: string, platform = currentPlatform()): string {
  if (isMacShortcutPlatform(platform)) return key;
  return PC_KEY_NAMES[key] ?? key;
}

/**
 * Rewrite every macOS shortcut glyph run in `text` for the current platform:
 * `⌘⇧T` → `Ctrl+Shift+T`, `⌘↵` / `⌘+Enter` → `Ctrl+Enter`, and the
 * already-bilingual `⌘/Ctrl+Enter` → `Ctrl+Enter`. Key glyphs such as `⌫` and
 * `⎋` are spelled out too, with or without modifiers. macOS text is unchanged.
 */
export function platformShortcut(text: string, platform = currentPlatform()): string {
  if (isMacShortcutPlatform(platform)) return text;
  return text
    .replace(/⌘\s?\/\s?(?=Ctrl\b)/gu, '')
    .replace(MODIFIER_GLYPHS, (_match, mods: string, key: string) => {
      const names = [...mods.replace(/\s/gu, '')].map((glyph) => PC_KEY_NAMES[glyph]!);
      return [...new Set(names), PC_KEY_NAMES[key] ?? key].join('+');
    })
    .replace(KEY_GLYPHS, (glyph) => PC_KEY_NAMES[glyph]!);
}
