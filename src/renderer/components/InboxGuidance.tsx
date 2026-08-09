import { Lightbulb } from 'lucide-react';
import { useData, useUi } from '../store';

export function InboxGuidance() {
  const enabled = useData((s) => s.inboxGuidanceEnabled);
  const setNav = useUi((s) => s.setNav);
  const setSettingsTab = useUi((s) => s.setSettingsTab);

  if (!enabled) return null;

  return (
    <aside className="inbox-guidance" aria-label="Inbox guidance">
      <div className="inbox-guidance-head">
        <Lightbulb size={14} strokeWidth={1.75} />
        <span>How to push to this inbox</span>
      </div>
      <p className="inbox-guidance-body">
        Claude tabs spawned from the app already have <code>ZCC_MCP_URL</code> in their
        environment. From inside a session, ask Claude to call the local{' '}
        <code>mcp__cc__inbox_push</code> tool with a short comment — finished
        analyses, blocked tasks, or questions back to you land here.
      </p>
      <button
        type="button"
        className="inbox-guidance-dismiss"
        onClick={() => {
          setNav('settings');
          setSettingsTab('global');
        }}
      >
        Hide in Settings →
      </button>
    </aside>
  );
}
