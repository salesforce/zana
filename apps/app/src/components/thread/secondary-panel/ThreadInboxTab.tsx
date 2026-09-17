import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Inbox } from 'lucide-react';
import { useData, useInbox, useInboxRead } from '../../../store.js';
import { isReport } from '@zana-ai/zcc-domain/feed-categories';
import { InboxSidebar } from '../../InboxSidebar.js';
import { InboxEntryBody } from '../../InboxEntryBody.js';
import { focusInboxEntry } from '../../../lib/inboxNavigation.js';

export function ThreadInboxTab({ projectId }: { projectId: string | null }) {
  const project = useData((s) => s.projects.find((row) => row.id === projectId) ?? null);
  const entries = useInbox((s) => s.entries);
  const readIds = useInboxRead((s) => s.readIds);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [reportsOnly, setReportsOnly] = useState(false);

  const scoped = useMemo(
    () => (projectId ? entries.filter((e) => e.projectId === projectId) : []),
    [entries, projectId]
  );

  useEffect(() => {
    if (selectedId && !scoped.some((e) => e.id === selectedId)) setSelectedId(null);
  }, [scoped, selectedId]);

  if (!projectId || !project) {
    return <p className="thread-detail-empty">Project is unavailable for Inbox.</p>;
  }

  const selected = selectedId ? scoped.find((e) => e.id === selectedId) ?? null : null;
  if (selected) {
    return (
      <div className="thread-inbox-tab" data-testid="thread-inbox-tab">
        <div className="agent-report-detail thread-inbox-detail">
          <div className="thread-inbox-detail-bar">
            <button
              type="button"
              className="agent-report-back"
              data-testid="thread-inbox-back"
              onClick={() => setSelectedId(null)}
            >
              <ArrowLeft size={13} /> All messages
            </button>
            <button
              type="button"
              className="thread-inbox-open"
              data-testid="thread-inbox-open-in-inbox"
              onClick={() => focusInboxEntry(selected)}
            >
              <ExternalLink size={13} /> Open in Inbox
            </button>
          </div>
          <InboxEntryBody entry={selected} project={project} />
        </div>
      </div>
    );
  }

  if (scoped.length === 0) {
    return (
      <div className="thread-inbox-tab" data-testid="thread-inbox-tab">
        <div className="agent-report-empty">
          <Inbox size={22} strokeWidth={1.5} aria-hidden />
          <p>No inbox messages for this project yet.</p>
        </div>
      </div>
    );
  }

  const unreadCount = scoped.reduce((n, e) => (readIds[e.id] ? n : n + 1), 0);
  const reportCount = scoped.reduce((n, e) => (isReport(e) ? n + 1 : n), 0);
  const unreadChipLabel = unreadOnly ? 'Show all messages' : `Unread${unreadCount > 0 ? ` ${unreadCount}` : ''}`;
  const reportsChipLabel = reportsOnly ? 'Show all messages' : `Reports${reportCount > 0 ? ` ${reportCount}` : ''}`;

  return (
    <div className="thread-inbox-tab" data-testid="thread-inbox-tab">
      <div className="inbox-filter-row thread-inbox-filters">
        <button
          type="button"
          className={`inbox-filter-chip ${unreadOnly ? 'on' : ''}`}
          data-testid="thread-inbox-unread-chip"
          aria-pressed={unreadOnly}
          aria-label={unreadChipLabel}
          title={unreadChipLabel}
          disabled={unreadCount === 0 && !unreadOnly}
          onClick={() => setUnreadOnly((v) => !v)}
        >
          Unread{unreadCount > 0 ? ` ${unreadCount}` : ''}
        </button>
        <button
          type="button"
          className={`inbox-filter-chip ${reportsOnly ? 'on' : ''}`}
          data-testid="thread-inbox-reports-chip"
          aria-pressed={reportsOnly}
          aria-label={reportsChipLabel}
          title={reportsChipLabel}
          disabled={reportCount === 0 && !reportsOnly}
          onClick={() => setReportsOnly((v) => !v)}
        >
          Reports{reportCount > 0 ? ` ${reportCount}` : ''}
        </button>
      </div>
      <div className="thread-inbox-list">
        <InboxSidebar
          unreadOnly={unreadOnly}
          reportsOnly={reportsOnly}
          scopeProjectId={projectId}
          grouping="time"
          selectedId={selectedId}
          onSelect={setSelectedId}
          autoSelect={false}
        />
      </div>
    </div>
  );
}
