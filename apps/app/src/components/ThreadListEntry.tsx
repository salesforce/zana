import { useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import type { ThreadListItem } from '../thread-store.js';
import { getThreadRoutePath } from '../lib/route-paths.js';
import { isBusyThreadStatus, threadStatusToAgentState } from './thread/thread-timeline-model.js';
import { FleetKindChip } from './FleetKindChip.js';

export function ThreadListEntry({
  thread,
  projectName,
  active = false
}: {
  thread: ThreadListItem;
  projectName?: string;
  active?: boolean;
}) {
  const navigate = useNavigate();
  const working = isBusyThreadStatus(thread.status);
  const state = threadStatusToAgentState(thread.status);
  return (
    <button
      type="button"
      className={`agents-row is-thread ${active ? 'active' : ''}`}
      data-testid="thread-list-entry"
      data-kind="thread"
      data-status={thread.status}
      onClick={() => navigate(getThreadRoutePath(thread.id))}
      aria-current={active ? 'true' : undefined}
      title={`${thread.title ?? 'Untitled thread'}${projectName ? ` — ${projectName}` : ''} · ${thread.status}`}
    >
      <span className="agents-row-icon">
        <MessageSquare size={13} aria-hidden="true" />
      </span>
      <span className="agents-row-text">
        <span className="agents-row-title-line">
          <span className={`tab-agent-dot agent-${state}`} aria-hidden="true" />
          <span className="agents-row-title">{thread.title ?? 'Untitled thread'}</span>
          <FleetKindChip kind="thread" />
        </span>
        <span className="agents-row-meta">
          {projectName && <span className="agents-row-project">{projectName}</span>}
          {working ? (
            <span className="thread-list-entry-working is-shimmer" data-testid="thread-list-entry-working">
              Working
            </span>
          ) : (
            <span className="agents-row-duration">{thread.status}</span>
          )}
        </span>
      </span>
    </button>
  );
}
