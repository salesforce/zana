import { TERMINAL_THEME_OPTIONS } from '@zana-ai/zcc-domain/terminal-themes';
import type { SettingsSearchEntry } from '../types';

const onOff = (value: boolean | undefined, fallback: boolean) => ((value ?? fallback) ? 'On' : 'Off');
const TMUX_SCOPES: Record<string, string> = { off: 'Off', remote: 'Remote only', all: 'All sessions' };

/** Settings > Terminal. */
export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'terminal.theme',
    section: 'terminal',
    anchor: 'terminal-appearance',
    label: 'Terminal theme',
    help: 'Color palette for the terminal, independent of the app theme. ‘Auto’ follows the app’s light/dark mode. Applies live to open terminals.',
    options: TERMINAL_THEME_OPTIONS.map((option) => option.label),
    keywords: ['colours', 'colors', 'palette', 'dracula', 'nord', 'solarized', 'xterm'],
    kind: 'setting',
    value: (s) => TERMINAL_THEME_OPTIONS.find((option) => option.id === (s.config.terminalTheme ?? 'auto'))?.label
  },
  {
    id: 'terminal.font-size',
    section: 'terminal',
    anchor: 'terminal-appearance',
    label: 'Terminal font size',
    help: 'Range 10–20. Affects new tabs.',
    keywords: ['text size', 'zoom', 'bigger', 'smaller'],
    kind: 'setting',
    value: (s) => (typeof s.config.fontSize === 'number' ? String(s.config.fontSize) : undefined)
  },
  {
    id: 'terminal.default-shell',
    section: 'terminal',
    anchor: 'terminal-shell',
    label: 'Default shell',
    help: 'Path to the shell launched for shell tabs.',
    keywords: ['zsh', 'bash', 'fish', 'sh', 'binary', 'path'],
    kind: 'setting',
    value: (s) => s.config.shell || undefined
  },
  {
    id: 'terminal.wheel-scroll',
    section: 'terminal',
    anchor: 'terminal-shell',
    label: 'Mouse wheel scrolls full-screen programs',
    help: 'When on (default), the mouse wheel scrolls inside pagers like less, man and git. Turn OFF if scrolling a shell prompt cycles through your command history instead of paging — the wheel then does nothing in those programs (use their keys, or tmux \'mouse on\', to scroll). Applies immediately to open terminals.',
    keywords: ['scroll', 'pager', 'less', 'man', 'git', 'arrow keys', 'history', 'trackpad'],
    kind: 'setting',
    value: (s) => onOff(s.config.terminalWheelArrowsEnabled, true)
  },
  {
    id: 'terminal.clipboard-intro',
    section: 'terminal',
    anchor: 'terminal-clipboard',
    label: 'Clipboard',
    help: 'Control whether terminal output may change your system clipboard.',
    keywords: ['copy', 'paste'],
    kind: 'subsection'
  },
  {
    id: 'terminal.clipboard-write',
    section: 'terminal',
    anchor: 'terminal-clipboard',
    label: 'Allow terminal output to write the clipboard (OSC 52)',
    help: 'When on (default), a program in a local or remote terminal can copy text to your system clipboard via the OSC 52 escape sequence (a visible notification always fires). Turn OFF to refuse these writes — a clipboard-poisoning defense so untrusted process output can’t silently replace a copied command or address. Clipboard reads by terminal programs are always refused, regardless of this setting.',
    keywords: ['osc52', 'osc 52', 'copy', 'security', 'escape sequence', 'poisoning'],
    kind: 'setting',
    value: (s) => onOff(s.config.terminalClipboardWriteEnabled, true)
  },
  {
    id: 'terminal.tmux-intro',
    section: 'terminal',
    anchor: 'terminal-tmux',
    label: 'tmux',
    help: 'Session durability backed by tmux.',
    keywords: ['multiplexer', 'persistence'],
    kind: 'subsection'
  },
  {
    id: 'terminal.tmux-persistence',
    section: 'terminal',
    anchor: 'terminal-tmux',
    label: 'tmux session persistence',
    help: 'Back sessions with tmux so they survive an app restart or a dropped SSH connection. A durability feature, not a speed-up — it does not make terminals faster. Needs tmux installed; ignored on Windows or when tmux is absent. Off: never wrap. Remote only: wrap SSH sessions only — the strongest use case (surviving a dropped link) — and skip the extra tmux server for local runs that don\'t need it. All sessions: wrap local and remote (the default).',
    options: ['Off', 'Remote only', 'All sessions'],
    keywords: ['tmux', 'survive restart', 'ssh', 'durable', 'detach', 'reconnect'],
    kind: 'setting',
    value: (s) => TMUX_SCOPES[(s.config.tmuxScope ?? 'all') as string]
  },
  {
    id: 'terminal.tmux-status',
    section: 'terminal',
    anchor: 'terminal-tmux',
    label: 'Runtime status',
    help: 'Whether tmux is installed and its version. Checking tmux… Could not check tmux. Retry tmux check. Persistence is enabled but unavailable.',
    keywords: ['tmux installed', 'tmux version', 'install tmux', 'not found'],
    kind: 'setting',
    dependsOn: 'terminal.tmux-persistence'
  }
];
