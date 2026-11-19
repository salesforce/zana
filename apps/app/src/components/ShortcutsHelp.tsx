import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { textMatchesFind } from '../lib/dom-find.js';
import { shortcutForCommand } from '../lib/keyboard-shortcut-settings.js';
import { OWN_FIND_ATTRIBUTE } from '../lib/thread-find.js';
import { useDialogFocusTrap } from '../hooks/useDialogFocusTrap.js';
import { platformKey, platformShortcut } from '../lib/platformShortcut.js';
import { ctrlVPastesByDefault, terminalPasteHelpRow } from '../lib/terminalPaste.js';

interface Props {
  onClose: () => void;
  /** Live "Ctrl+V pastes" setting; the platform default when omitted. */
  ctrlVPasteEnabled?: boolean;
}

interface Row {
  keys: string[];
  label: string;
}

interface Section {
  title: string;
  rows: Row[];
}

const sections = (pasteRow: Row | null): Section[] => [
  {
    title: 'Navigation',
    rows: [
      { keys: ['⌘', 'N'], label: 'New Chat' },
      { keys: ['⌘', 'P'], label: 'Command palette / project switcher' },
      { keys: ['⌘', '⇧', '1'], label: 'Switch to project 1 (… up to ⌘⇧9)' },
      { keys: ['⌘', '⇧', ']'], label: 'Next project' },
      { keys: ['⌘', '⇧', '['], label: 'Previous project' },
      { keys: ['⌘', 'E'], label: 'Find file in selected project' },
      { keys: ['⌘', '⇧', 'F'], label: 'Search file contents in selected project' },
      { keys: ['⌘', 'B'], label: 'Toggle Terminals / Explorer' },
      { keys: ['⌘', 'L'], label: 'Open Preview Browser' },
      { keys: ['⌘', 'O'], label: 'Open Agents dashboard' },
      { keys: ['⌘', 'I'], label: 'Toggle Inbox' },
      { keys: ['⌘', 'J'], label: 'Toggle Scheduler' },
      { keys: ['⌘', ','], label: 'Toggle Settings (Project settings inside a project)' },
      { keys: ['⌘', '?'], label: 'This help' }
    ]
  },
  {
    title: 'Inbox',
    rows: [
      { keys: ['j', 'k'], label: 'Next / previous message' },
      { keys: ['R'], label: 'Reply to the open message' },
      { keys: ['⌘', '↵'], label: 'Send the reply' },
      { keys: ['Esc'], label: 'Leave the reply box and keep reading' },
      { keys: ['Delete'], label: 'Delete the open message' }
    ]
  },
  {
    title: 'Tabs',
    rows: [
      { keys: ['⌘', 'T'], label: 'New tab (uses project’s default profile)' },
      { keys: ['⌘', '⇧', 'D'], label: 'Duplicate active tab (same profile)' },
      { keys: ['⌘', '⇧', 'R'], label: 'Restart active tab (kill + respawn)' },
      { keys: ['⌘', '⇧', 'T'], label: 'Reopen / resume last removed tab' },
      { keys: ['⌘', 'W'], label: 'Hide active tab (process keeps running)' },
      { keys: ['⌘', '⇧', 'W'], label: 'Archive active agent tab (a plain shell is deleted)' },
      { keys: ['⌘', '1'], label: 'Switch to tab 1 (… up to ⌘9)' },
      { keys: ['⌘', ']'], label: 'Next tab' },
      { keys: ['⌘', '['], label: 'Previous tab' }
    ]
  },
  {
    title: 'Thread',
    rows: [
      { keys: ['⌘', 'F'], label: 'Search in the open thread (remappable in Settings → Shortcuts)' },
      { keys: ['Esc'], label: 'Close thread search' },
      { keys: ['⌘', '↵'], label: 'Agent question: Next, or Submit on the last question' },
      { keys: ['1–9'], label: 'Agent question: choose an option (focus in the panel)' },
      { keys: ['↵'], label: 'Agent question: Next, or Submit, from a focused option' }
    ]
  },
  {
    title: 'Terminal',
    rows: [
      { keys: ['⌘', 'F'], label: 'Find in active terminal' },
      { keys: ['⌘', 'K'], label: 'Clear active terminal scrollback' },
      ...(pasteRow ? [pasteRow] : []),
      { keys: ['Enter'], label: 'Find: next match' },
      { keys: ['⇧', 'Enter'], label: 'Find: previous match' },
      { keys: ['Esc'], label: 'Close find / palette' },
      { keys: ['⌘', '.'], label: 'Close agent detail window' }
    ]
  },
  {
    title: 'Explorer',
    rows: [
      { keys: ['⌘', 'S'], label: 'Save edited file' },
      { keys: ['⌘', 'D'], label: 'Toggle diff vs HEAD on open file' },
      { keys: ['⌘', '⇧', 'G'], label: 'Toggle Changes view (modified files only)' }
    ]
  },
  {
    title: 'Split (remappable in Settings → Shortcuts)',
    rows: [
      { keys: ['⌘', '⌥', 'W'], label: 'Close focused pane' },
      { keys: ['⌘', '⇧', 'M'], label: 'Maximize / restore focused pane' },
      { keys: ['⌘', '⌥', '←', '→', '↑', '↓'], label: 'Focus the pane in that direction' },
      { keys: ['⌘', '1'], label: 'Focus pane 1 (… up to ⌘8)' },
      { keys: ['⌘', '⌥', ']'], label: 'Next pane' },
      { keys: ['⌘', '⌥', '['], label: 'Previous pane' }
    ]
  },
  {
    title: 'Tab actions (right-click)',
    rows: [
      { keys: ['Middle-click'], label: 'Hide tab (process keeps running)' },
      { keys: ['Rename'], label: 'Or double-click tab title' },
      { keys: ['Duplicate'], label: 'Spawn another tab with same profile' },
      { keys: ['Hide'], label: 'Detach: hide tab, keep process running' },
      { keys: ['Hide others'], label: 'Hide every other tab (processes keep running)' },
      { keys: ['Hide to right'], label: 'Hide all tabs after this one' },
      { keys: ['Archive'], label: 'Stop the agent and remove the tab; its conversation stays in History' },
      { keys: ['Delete'], label: 'Plain shell: end it and remove the tab' },
      { keys: ['Dismiss exited'], label: 'Clean up dead tabs' }
    ]
  }
];

/** Words people type for a key cap that the platform glyph or short name doesn't spell. */
const KEY_ALIASES: Record<string, string> = {
  '⌘': 'cmd command',
  '⌃': 'control',
  '⌥': 'option opt',
  '⇧': 'shift',
  Esc: 'escape',
  '↵': 'return enter',
  Enter: 'return'
};

/** What a row reads as on this platform, plus `Ctrl+F` spelled with plus signs so a typed combo matches. */
function rowHaystack(section: Section, row: Row): string {
  const keys = row.keys.map((key) => platformKey(key));
  const aliases = row.keys.map((key) => KEY_ALIASES[key] ?? '');
  const named = row.keys.map((key, i) => aliases[i]?.split(' ')[0] || keys[i]);
  return [section.title, platformShortcut(row.label), keys.join(' '), keys.join('+'), aliases.join(' '), named.join('+')].join('\n');
}

function filterSections(all: Section[], query: string): Section[] {
  const needle = query.trim().replace(/\s*\+\s*/gu, '+');
  if (!needle) return all;
  return all
    .map((section) => ({ ...section, rows: section.rows.filter((row) => textMatchesFind(rowHaystack(section, row), needle)) }))
    .filter((section) => section.rows.length > 0);
}

function ShortcutRow({ row }: { row: Row }) {
  return (
    <div className="shortcut-row">
      <span className="shortcut-keys">
        {row.keys.map((k, j) => (
          <kbd key={j}>{platformKey(k)}</kbd>
        ))}
      </span>
      <span className="shortcut-label">{platformShortcut(row.label)}</span>
    </div>
  );
}

/**
 * Ctrl+F filter for the panel. Esc clears the text first and closes the panel
 * when there is nothing to clear; either way focus stays inside the panel.
 */
function useShortcutsFilter(onClose: () => void) {
  const [query, setQuery] = useState('');
  const queryRef = useRef('');
  queryRef.current = query;
  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Tab stays inside the dialog and focus returns to the opener on close; Esc is handled below.
  useDialogFocusTrap(hostRef, undefined);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (!queryRef.current) return onClose();
      setQuery('');
      hostRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const onHostKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (!shortcutForCommand('thread.find', event.nativeEvent)) return;
    event.preventDefault();
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  return { query, setQuery, hostRef, inputRef, onHostKeyDown };
}

function countText(shown: number): string {
  return `${shown} ${shown === 1 ? 'shortcut' : 'shortcuts'}`;
}

export function ShortcutsHelp({ onClose, ctrlVPasteEnabled = ctrlVPastesByDefault() }: Props) {
  const { query, setQuery, hostRef, inputRef, onHostKeyDown } = useShortcutsFilter(onClose);
  const visible = filterSections(sections(terminalPasteHelpRow(ctrlVPasteEnabled)), query);
  const shown = visible.reduce((total, section) => total + section.rows.length, 0);
  const filtering = query.trim().length > 0;

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        ref={hostRef}
        className="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        tabIndex={-1}
        {...{ [OWN_FIND_ATTRIBUTE]: '' }}
        onKeyDown={onHostKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="shortcuts-header">
          <h3>Keyboard Shortcuts</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        <div className="shortcuts-filter" role="search">
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Filter shortcuts"
            aria-label="Filter shortcuts"
            onChange={(event) => setQuery(event.target.value)}
          />
          {filtering && <span className="shortcuts-filter-count" aria-hidden="true">{countText(shown)}</span>}
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{filtering ? `${countText(shown)} match` : ''}</span>
        </div>
        <div className="shortcuts-body">
          {visible.map((s) => (
            <section key={s.title} className="shortcuts-section">
              <h4>{s.title}</h4>
              {s.rows.map((r, i) => <ShortcutRow key={i} row={r} />)}
            </section>
          ))}
          {shown === 0 && <p className="shortcuts-empty">No shortcuts match “{query.trim()}”.</p>}
        </div>
      </div>
    </div>
  );
}
