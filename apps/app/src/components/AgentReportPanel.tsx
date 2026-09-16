import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText } from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { useInbox } from '../store.js';
import { isReport } from '@zana-ai/zcc-domain/feed-categories';
import { inboxPrimaryTitle } from '../lib/inboxPresentation.js';
import { InboxEntryBody } from './InboxEntryBody.js';

/**
 * The "Report" stage of the agent-inspector modal: the reports this agent has
 * pushed to the inbox (`inbox_push({ report: true })`) via the session-scoped
 * MCP route, which stamps `InboxEntry.sessionId` — the same linkage
 * {@link ModalPendingQuestion} in AgentTerminalModal already relies on. A list
 * on entry; clicking a report shows its rendered markdown (docs, then
 * comments) with a back arrow to return to the list. Renders an empty state
 * when the agent hasn't pushed a flagged report yet.
 */
export function AgentReportPanel({
  sessionId,
  project
}: {
  sessionId: string;
  project: Project | null;
}) {
  const entries = useInbox((s) => s.entries);
  const reports = useMemo(
    () => entries.filter((e) => e.sessionId === sessionId && isReport(e)),
    [entries, sessionId]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Keep selection valid as the live list changes underneath (a coalesced
  // entry refreshing in place, or the list shrinking).
  useEffect(() => {
    if (selectedId && !reports.some((r) => r.id === selectedId)) setSelectedId(null);
  }, [reports, selectedId]);

  const selected = selectedId ? reports.find((r) => r.id === selectedId) ?? null : null;

  if (reports.length === 0) {
    return (
      <div className="agent-report-empty">
        <FileText size={22} strokeWidth={1.5} aria-hidden />
        <p>No reports yet. Reports the agent pushes to the inbox will show up here.</p>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="agent-report-detail">
        <button
          type="button"
          className="agent-report-back"
          onClick={() => setSelectedId(null)}
        >
          <ArrowLeft size={13} /> All reports
        </button>
        <InboxEntryBody entry={selected} project={project} />
      </div>
    );
  }

  return (
    <div className="agent-report-list" role="list">
      {reports.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="listitem"
          className="agent-report-row"
          onClick={() => setSelectedId(entry.id)}
        >
          <FileText size={14} strokeWidth={1.75} className="agent-report-row-icon" aria-hidden />
          <span className="agent-report-row-title">{inboxPrimaryTitle(entry)}</span>
          <span className="agent-report-row-ts">{formatReportTime(entry.ts)}</span>
        </button>
      ))}
    </div>
  );
}

function formatReportTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
