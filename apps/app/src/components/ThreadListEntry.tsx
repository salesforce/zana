import { useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import type { ThreadListItem } from '../thread-store.js';
import { getThreadRoutePath } from '../lib/route-paths.js';
import { isBusyThreadStatus } from './thread/thread-timeline-model.js';

export function ThreadListEntry({ thread }: { thread: ThreadListItem }) {
  const navigate = useNavigate();
  const working = isBusyThreadStatus(thread.status);
  return (
    <button
      type="button"
      className="thread-list-entry"
      data-testid="thread-list-entry"
      data-status={thread.status}
      onClick={() => navigate(getThreadRoutePath(thread.id))}
    >
      <MessageSquare size={14} aria-hidden="true" />
      <span className="thread-list-entry-title">{thread.title ?? 'Untitled thread'}</span>
      {working ? (
        <span className="thread-list-entry-working is-shimmer" data-testid="thread-list-entry-working">
          Working
        </span>
      ) : (
        <span className="thread-list-entry-status">{thread.status}</span>
      )}
    </button>
  );
}
