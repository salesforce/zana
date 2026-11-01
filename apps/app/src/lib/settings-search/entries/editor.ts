import {
  EXPLORER_FILE_ICON_THEME_LABELS,
  EXPLORER_MINIMAP_LABELS,
  resolveExplorerFileIconTheme,
  resolveExplorerMinimap
} from '@zana-ai/zcc-domain/product';
import type { SettingsSearchEntry } from '../types';
import { fileManagerBlurb, fileManagerTitle } from '../../file-manager';

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
    label: fileManagerTitle(),
    help: `${fileManagerBlurb()} Show in the opener bar, install status and launcher overrides.`,
    keywords: ['reveal', 'file manager', 'finder', 'explorer', 'macos', 'windows', 'linux', 'opener bar'],
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
    help: 'macOS: app name launched via ‘open -a <name>’; blank ⇒ auto-pick iTerm → WezTerm → Alacritty → Terminal. Windows: program name or path started in the folder, without arguments, such as pwsh or cmd; blank ⇒ PowerShell.',
    keywords: ['iterm', 'wezterm', 'alacritty', 'open -a', 'powershell', 'pwsh', 'cmd', 'advanced'],
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
  },
  {
    id: 'editor.explorer-preview',
    section: 'editor',
    anchor: 'editor-explorer-preview',
    label: 'Explorer preview',
    help: 'How the Explorer shows file contents.',
    keywords: ['file viewer', 'file preview'],
    kind: 'subsection'
  },
  {
    id: 'editor.explorer-minimap',
    section: 'editor',
    anchor: 'editor-explorer-preview',
    label: 'Minimap',
    help: 'Show a zoomed-out overview of the file on the edge of the Explorer preview. It scrolls with the file; click or drag it to jump. You can also right-click the minimap or the scrollbar in the editor. It is hidden automatically when the preview is narrow.',
    keywords: ['overview', 'scroll', 'explorer', 'file preview', 'right-click'],
    kind: 'setting',
    value: (s) => (resolveExplorerMinimap(s.config).enabled ? 'On' : 'Off')
  },
  {
    id: 'editor.explorer-minimap-width',
    section: 'editor',
    anchor: 'editor-explorer-preview',
    label: 'Minimap width',
    help: 'How wide the minimap is. Default: Default.',
    keywords: ['size', 'narrow', 'wide', 'columns'],
    kind: 'setting',
    value: (s) => EXPLORER_MINIMAP_LABELS[resolveExplorerMinimap(s.config).width]
  },
  {
    id: 'editor.explorer-minimap-characters',
    section: 'editor',
    anchor: 'editor-explorer-preview',
    label: 'Render characters',
    help: 'Draw the actual characters in the minimap instead of plain color blocks.',
    keywords: ['minimap', 'color blocks', 'text'],
    kind: 'setting',
    value: (s) => (resolveExplorerMinimap(s.config).renderCharacters ? 'On' : 'Off')
  },
  {
    id: 'editor.explorer-minimap-vertical-size',
    section: 'editor',
    anchor: 'editor-explorer-preview',
    label: 'Minimap vertical size',
    help: 'Proportional keeps each line a fixed height, Fill stretches the minimap to the full editor height, and Fit shrinks it to fit short files.',
    keywords: ['minimap', 'proportional', 'fill', 'fit', 'height'],
    kind: 'setting',
    value: (s) => EXPLORER_MINIMAP_LABELS[resolveExplorerMinimap(s.config).verticalSize]
  },
  {
    id: 'editor.explorer-minimap-slider',
    section: 'editor',
    anchor: 'editor-explorer-preview',
    label: 'Minimap slider',
    help: 'When the viewport slider is drawn over the minimap.',
    keywords: ['minimap', 'viewport', 'mouse over', 'always'],
    kind: 'setting',
    value: (s) => EXPLORER_MINIMAP_LABELS[resolveExplorerMinimap(s.config).slider]
  },
  {
    id: 'editor.explorer-minimap-side',
    section: 'editor',
    anchor: 'editor-explorer-preview',
    label: 'Minimap side',
    help: 'Which edge of the editor the minimap sits on.',
    keywords: ['minimap', 'left', 'right', 'edge'],
    kind: 'setting',
    value: (s) => EXPLORER_MINIMAP_LABELS[resolveExplorerMinimap(s.config).side]
  },
  {
    id: 'editor.explorer-files',
    section: 'editor',
    anchor: 'editor-explorer-files',
    label: 'Explorer files',
    help: 'How files are listed in the Explorer, Changes list, Quick Open and Library.',
    keywords: ['file list', 'file tree'],
    kind: 'subsection'
  },
  {
    id: 'editor.explorer-file-icons',
    section: 'editor',
    anchor: 'editor-explorer-files',
    label: 'File icon theme',
    help: "Seti matches VS Code's default icons; Minimal uses one plain file glyph; None hides file and folder icons.",
    keywords: ['icons', 'file icons', 'seti', 'vscode', 'vs code', 'explorer', 'tree'],
    kind: 'setting',
    value: (s) => EXPLORER_FILE_ICON_THEME_LABELS[resolveExplorerFileIconTheme(s.config)]
  }
];
