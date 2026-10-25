import { useEffect } from 'react';
import { X } from 'lucide-react';
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
      { keys: ['⌘', '⇧', 'W'], label: 'Delete active tab (terminates the process)' },
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
      { keys: ['Delete'], label: 'Terminate the process and remove the tab' },
      { keys: ['Dismiss exited'], label: 'Clean up dead tabs' }
    ]
  }
];

export function ShortcutsHelp({ onClose, ctrlVPasteEnabled = ctrlVPastesByDefault() }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="shortcuts-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="shortcuts-header">
          <h3>Keyboard Shortcuts</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        <div className="shortcuts-body">
          {sections(terminalPasteHelpRow(ctrlVPasteEnabled)).map((s) => (
            <section key={s.title} className="shortcuts-section">
              <h4>{s.title}</h4>
              {s.rows.map((r, i) => (
                <div key={i} className="shortcut-row">
                  <span className="shortcut-keys">
                    {r.keys.map((k, j) => (
                      <kbd key={j}>{platformKey(k)}</kbd>
                    ))}
                  </span>
                  <span className="shortcut-label">{platformShortcut(r.label)}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
