import { useEffect, useMemo } from 'react';
import { ChevronRight, HelpCircle } from 'lucide-react';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';
import {
  maybeRefreshInboxSummary,
  useData,
  useInboxAnswered,
  useInboxRead,
  useInboxSelection
} from '../store.js';
import { InboxSummaryCard } from './InboxSummaryCard.js';
import { InboxGuidance } from './InboxGuidance.js';
import { PaneEmptyState } from './PaneEmptyState.js';
import { formatRelative } from './InboxSidebar.js';
import {
  inboxContextLine,
  inboxPrimaryTitle,
  isPinnedBlockingQuestion
} from '../lib/inboxPresentation.js';

/**
 * Inbox attention landing — the detail-column home when no entry is selected.
 * Surfaces what needs a human (pending blocking questions) and an AI digest of
 * the same scoped slice the feed shows. Ideas live in Library; reports and
 * goals stay in the feed rather than being re-catalogued here.
 */
export function InboxOverview({
  scopeProjectId,
  entries
}: {
  scopeProjectId: string | null;
  entries: InboxEntry[];
}) {
  const select = useInboxSelection((s) => s.select);
  const markRead = useInboxRead((s) => s.markRead);
  const answeredIds = useInboxAnswered((s) => s.answeredIds);
  const projects = useData((s) => s.projects);

  useEffect(() => {
    if (entries.length === 0) return;
    maybeRefreshInboxSummary(scopeProjectId, entries);
  }, [scopeProjectId, entries]);

  const pendingQuestions = useMemo(
    () =>
      entries
        .filter((e) => isPinnedBlockingQuestion(e, answeredIds))
        .sort((a, b) => b.ts - a.ts),
    [entries, answeredIds]
  );

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const openEntry = (id: string) => {
    select(id);
    markRead(id);
  };

  if (entries.length === 0) {
    return (
      <PaneEmptyState
        art="inbox"
        title="No inbox messages yet"
        hint="Projects will push status updates here as they work — finished analyses, blocked tasks, questions back to you."
        className="inbox-overview-empty-pane"
        testId="inbox-overview-empty"
      >
        <InboxGuidance />
      </PaneEmptyState>
    );
  }

  return (
    <div className="inbox-overview">
      {pendingQuestions.length > 0 && (
        <section className="inbox-overview-questions" aria-label="Needs your answer">
          <div className="inbox-overview-questions-head">
            <HelpCircle size={13} strokeWidth={2.5} aria-hidden />
            <span className="inbox-overview-questions-label">Needs your answer</span>
            <span className="inbox-overview-questions-count">{pendingQuestions.length}</span>
          </div>
          <div className="inbox-overview-questions-rows">
            {pendingQuestions.map((entry) => {
              const project = projectsById.get(entry.projectId);
              const projectName = project?.name ?? entry.projectLabel ?? entry.projectId;
              const context = inboxContextLine(entry);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="inbox-overview-question"
                  onClick={() => openEntry(entry.id)}
                >
                  <span className="inbox-overview-question-main">
                    <span className="inbox-overview-question-title">{inboxPrimaryTitle(entry)}</span>
                    {context ? (
                      <span className="inbox-overview-question-context">{context}</span>
                    ) : null}
                    <span className="inbox-overview-question-meta">
                      <span
                        className={`inbox-project-dot ${project?.color ? '' : 'inbox-project-dot--none'}`}
                        style={project?.color ? { background: project.color } : undefined}
                        aria-hidden
                      />
                      <span className="inbox-overview-question-project">{projectName}</span>
                      <span className="inbox-overview-question-ts">{formatRelative(entry.ts)}</span>
                    </span>
                  </span>
                  <span className="inbox-overview-question-cta">
                    Answer
                    <ChevronRight size={12} aria-hidden />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <InboxSummaryCard scopeProjectId={scopeProjectId} entries={entries} />
    </div>
  );
}
