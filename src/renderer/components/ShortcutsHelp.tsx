import { useEffect } from 'react';
import { X } from 'lucide-react';

interface Props {
  onClose: () => void;
}

interface Row {
  keys: string[];
  label: string;
}

interface Section {
  title: string;
  rows: Row[];
}

const SECTIONS: Section[] = [
  {
    title: 'Navigation',
    rows: [
      { keys: ['⌘', 'P'], label: 'Command palette / project switcher' },
      { keys: ['⌘', '⇧', '1'], label: 'Switch to project 1 (… up to ⌘⇧9)' },
      { keys: ['⌘', '⇧', ']'], label: 'Next project' },
      { keys: ['⌘', '⇧', '['], label: 'Previous project' },
      { keys: ['⌘', 'E'], label: 'Find file in selected project' },
      { keys: ['⌘', '⇧', 'F'], label: 'Search file contents in selected project' },
      { keys: ['⌘', 'R'], label: 'Resume Claude session…' },
      { keys: ['⌘', 'B'], label: 'Toggle Terminals / Explorer' },
      { keys: ['⌘', 'L'], label: 'Open Preview Browser' },
      { keys: ['⌘', 'O'], label: 'Toggle Overview (workspaces dashboard)' },
      { keys: ['⌘', 'I'], label: 'Toggle Inbox' },
      { keys: ['⌘', 'J'], label: 'Toggle Scheduler' },
      { keys: ['⌘', ','], label: 'Toggle Settings' },
      { keys: ['⌘', '?'], label: 'This help' }
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
    title: 'Terminal',
    rows: [
      { keys: ['⌘', 'F'], label: 'Find in active terminal' },
      { keys: ['⌘', 'K'], label: 'Clear active terminal scrollback' },
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

export function ShortcutsHelp({ onClose }: Props) {
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
          {SECTIONS.map((s) => (
            <section key={s.title} className="shortcuts-section">
              <h4>{s.title}</h4>
              {s.rows.map((r, i) => (
                <div key={i} className="shortcut-row">
                  <span className="shortcut-keys">
                    {r.keys.map((k, j) => (
                      <kbd key={j}>{k}</kbd>
                    ))}
                  </span>
                  <span className="shortcut-label">{r.label}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
