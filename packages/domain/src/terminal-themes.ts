// Terminal color-theme registry (id + label only — the actual xterm ITheme
// palettes live renderer-side in `apps/app/src/lib/terminalThemes.ts`, which
// paints the canvas). This shared module is the single source of truth for
// WHICH terminal themes exist, so both the untrusted-renderer validation in
// main's `normalizeConfig` (rule 1) and the Settings dropdown agree on the set
// without either importing the other's process code.
//
// `'auto'` is the default and preserves the historical behavior: the terminal
// palette follows the app's light/dark `theme`. Every other id is an explicit,
// app-theme-independent palette.

export const TERMINAL_THEME_IDS = [
  'auto',
  'github-dark',
  'github-light',
  'dracula',
  'nord',
  'one-dark',
  'tokyo-night',
  'solarized-dark',
  'solarized-light',
  'gruvbox-dark',
  'monokai'
] as const;

export type TerminalThemeId = (typeof TERMINAL_THEME_IDS)[number];

export const DEFAULT_TERMINAL_THEME: TerminalThemeId = 'auto';

/** Human labels for the Settings picker, in display order (mirrors TERMINAL_THEME_IDS). */
export const TERMINAL_THEME_OPTIONS: ReadonlyArray<{ id: TerminalThemeId; label: string }> = [
  { id: 'auto', label: 'Auto (match app theme)' },
  { id: 'github-dark', label: 'GitHub Dark' },
  { id: 'github-light', label: 'GitHub Light' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'nord', label: 'Nord' },
  { id: 'one-dark', label: 'One Dark' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'solarized-dark', label: 'Solarized Dark' },
  { id: 'solarized-light', label: 'Solarized Light' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark' },
  { id: 'monokai', label: 'Monokai' }
];

export function isTerminalThemeId(v: unknown): v is TerminalThemeId {
  return typeof v === 'string' && (TERMINAL_THEME_IDS as readonly string[]).includes(v);
}
