import type { SettingsSearchEntry } from '../types';

const shown = (hidden: readonly string[] | undefined, target: string) => ((hidden ?? []).includes(target) ? 'Off' : 'On');

/** Settings > Editor (open-in-editor bar). Override rows live behind each editor's collapsed Advanced block. */
export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'editor.bar-intro',
    section: 'editor',
    anchor: 'editor-status',
    label: 'Open-in-editor bar',
    help: 'Choose which buttons appear in the “open in editor / terminal” bar throughout the app, and how each one launches. The install check shows whether an editor’s command-line launcher is on your PATH — a missing launcher is why an “open in…” button would fail.',
    keywords: ['opener', 'editors', 'launcher', 'path'],
    kind: 'subsection'
  },
  {
    id: 'editor.cursor',
    section: 'editor',
    anchor: 'editor-cursor',
    label: 'Cursor',
    help: 'Opens a path in the Cursor editor. Show in the opener bar, install status and launcher overrides.',
    keywords: ['open in editor', 'ide', 'opener bar'],
    kind: 'setting',
    value: (s) => shown(s.config.openerHiddenTargets, 'cursor')
  },
  {
    id: 'editor.cursor-binary',
    section: 'editor',
    anchor: 'editor-cursor',
    label: 'CLI launcher',
    help: 'Command run to open a path. Blank ⇒ ‘cursor’ on your PATH.',
    keywords: ['cli', 'binary', 'shim', 'Cursor', 'advanced'],
    kind: 'setting',
    reveal: 'advanced',
    value: (s) => s.config.editorCursorBinary || undefined
  },
  {
    id: 'editor.cursor-app',
    section: 'editor',
    anchor: 'editor-cursor',
    label: 'macOS app name',
    help: 'Fallback (‘open -a <name>’) when the CLI launcher isn’t found. Blank ⇒ ‘Cursor’.',
    keywords: ['open -a', 'application name', 'fallback', 'Cursor', 'advanced'],
    kind: 'setting',
    reveal: 'advanced',
    value: (s) => s.config.editorCursorApp || undefined
  },
  {
    id: 'editor.code',
    section: 'editor',
    anchor: 'editor-code',
    label: 'VS Code',
    help: 'Opens a path in Visual Studio Code. Show in the opener bar, install status and launcher overrides.',
    keywords: ['visual studio code', 'vscode', 'open in editor', 'ide', 'opener bar'],
    kind: 'setting',
    value: (s) => shown(s.config.openerHiddenTargets, 'code')
  },
  {
    id: 'editor.code-binary',
    section: 'editor',
    anchor: 'editor-code',
    label: 'CLI launcher',
    help: 'Command run to open a path. Blank ⇒ ‘code’ on your PATH.',
    keywords: ['cli', 'binary', 'shim', 'VS Code', 'advanced'],
    kind: 'setting',
    reveal: 'advanced',
    value: (s) => s.config.editorCodeBinary || undefined
  },
  {
    id: 'editor.code-app',
    section: 'editor',
    anchor: 'editor-code',
    label: 'macOS app name',
    help: 'Fallback (‘open -a <name>’) when the CLI launcher isn’t found. Blank ⇒ ‘Visual Studio Code’.',
    keywords: ['open -a', 'application name', 'fallback', 'VS Code', 'advanced'],
    kind: 'setting',
    reveal: 'advanced',
    value: (s) => s.config.editorCodeApp || undefined
  },
  {
    id: 'editor.intellij',
    section: 'editor',
    anchor: 'editor-intellij',
    label: 'IntelliJ IDEA',
    help: 'Opens a path in IntelliJ IDEA. Show in the opener bar, install status and launcher overrides.',
    keywords: ['idea', 'jetbrains', 'open in editor', 'ide', 'opener bar'],
    kind: 'setting',
    value: (s) => shown(s.config.openerHiddenTargets, 'intellij')
  },
  {
    id: 'editor.intellij-binary',
    section: 'editor',
    anchor: 'editor-intellij',
    label: 'CLI launcher',
    help: 'Command run to open a path. Blank ⇒ ‘idea’ on your PATH.',
    keywords: ['cli', 'binary', 'shim', 'IntelliJ IDEA', 'advanced'],
    kind: 'setting',
    reveal: 'advanced',
    value: (s) => s.config.editorIntellijBinary || undefined
  },
  {
    id: 'editor.intellij-app',
    section: 'editor',
    anchor: 'editor-intellij',
    label: 'macOS app name',
    help: 'Fallback (‘open -a <name>’) when the CLI launcher isn’t found. Blank ⇒ ‘IntelliJ IDEA’.',
    keywords: ['open -a', 'application name', 'fallback', 'IntelliJ IDEA', 'advanced'],
    kind: 'setting',
    reveal: 'advanced',
    value: (s) => s.config.editorIntellijApp || undefined
  },
  {
    id: 'editor.finder',
    section: 'editor',
    anchor: 'editor-finder',
    label: 'Finder',
    help: 'Reveals a path in the macOS Finder. Show in the opener bar, install status and launcher overrides.',
    keywords: ['reveal', 'file manager', 'macos', 'opener bar'],
    kind: 'setting',
    value: (s) => shown(s.config.openerHiddenTargets, 'finder')
  },
  {
    id: 'editor.terminal',
    section: 'editor',
    anchor: 'editor-terminal',
    label: 'Terminal',
    help: 'Opens a path in an external terminal. Show in the opener bar, install status and launcher overrides.',
    keywords: ['external terminal', 'iterm', 'wezterm', 'alacritty', 'opener bar'],
    kind: 'setting',
    value: (s) => shown(s.config.openerHiddenTargets, 'terminal')
  },
  {
    id: 'editor.terminal-app',
    section: 'editor',
    anchor: 'editor-terminal',
    label: 'Preferred terminal app',
    help: 'macOS app name launched via ‘open -a <name>’. Blank ⇒ auto-pick iTerm → WezTerm → Alacritty → Terminal.',
    keywords: ['iterm', 'wezterm', 'alacritty', 'open -a', 'advanced'],
    kind: 'setting',
    reveal: 'advanced',
    value: (s) => s.config.terminalApp || undefined
  },
  {
    id: 'editor.recheck',
    section: 'editor',
    anchor: 'editor-status',
    label: 'Re-check installs',
    help: 'Probe each editor’s command-line launcher again.',
    keywords: ['refresh', 'verify', 'detect editors'],
    kind: 'action'
  }
];
