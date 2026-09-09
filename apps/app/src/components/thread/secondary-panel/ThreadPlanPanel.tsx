import { ListTodo } from 'lucide-react';
import type { ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import { MarkdownContent } from '../../MarkdownContent.js';
import { ThreadTodoChecklist } from '../thread-todo-checklist.js';
import {
  type PlanDocumentBadge,
  type PlanReferenceView,
  type ThreadPlanDocument,
  planDocumentBadge,
  planDocumentBadgeLabel,
  planFileTabTitle,
  planReferenceDetail,
  planReferenceSummary,
  uniquePlanReferences
} from './thread-plan-document.js';

export type DurablePlanPanelView = {
  markdown: string | null;
  filePath?: string | null;
  status?: string | null;
  revision: number;
  progress: { completed: number; total: number };
  executionModeMismatch?: boolean;
  requestedExecutionMode?: string | null;
  effectiveExecutionMode?: string | null;
  processing?: {
    text: string;
    owningThreadId: string | null;
    startedAt: number | null;
    latestActivity: string | null;
  } | null;
  tasks: Array<{
    id: string;
    text: string;
    status: string;
    owningThreadId: string | null;
    blockedReason: string | null;
  }>;
  referencedBy: PlanReferenceView[];
};

export function PlanStatusBadge({
  badge
}: {
  badge: PlanDocumentBadge;
}) {
  return (
    <span
      className={`thread-plan-status is-${badge}`}
      data-testid="thread-plan-status"
      data-status={badge}
    >
      {planDocumentBadgeLabel(badge)}
    </span>
  );
}

export function ThreadPlanPanel({
  document,
  todos,
  durablePlan,
  onOpenFile,
  showStatusBadge = true,
  emptyLabel = 'The agent has not written a plan yet.'
}: {
  document: ThreadPlanDocument;
  todos?: ThreadTimelinePendingTodos | null;
  durablePlan?: DurablePlanPanelView | null;
  onOpenFile?: (path: string) => void;
  showStatusBadge?: boolean;
  emptyLabel?: string;
}) {
  const items = durablePlan?.tasks.length
    ? durablePlan.tasks
    : (todos?.items ?? []).map((item) => ({
      id: item.id,
      text: item.text,
      status: item.status,
      owningThreadId: null,
      blockedReason: null
    }));
  const filePath = document.filePath;
  const markdown = document.markdown ?? durablePlan?.markdown ?? null;
  const badge = planDocumentBadge({
    status: durablePlan?.status,
    processing: durablePlan?.processing,
    progress: durablePlan?.progress,
    tasks: items,
    markdown
  });
  const refs = uniquePlanReferences(durablePlan?.referencedBy ?? []);
  return (
    <div className="thread-plan-panel" data-testid="thread-plan-panel">
      {showStatusBadge && (document.prompt || badge) ? (
        <header className="thread-plan-panel-chrome" data-testid="thread-plan-chrome">
          {document.prompt ? (
            <p className="thread-plan-panel-prompt" data-testid="thread-plan-prompt">{document.prompt}</p>
          ) : <span />}
          {badge ? <PlanStatusBadge badge={badge} /> : null}
        </header>
      ) : document.prompt ? (
        <p className="thread-plan-panel-prompt" data-testid="thread-plan-prompt">{document.prompt}</p>
      ) : null}
      {durablePlan?.executionModeMismatch ? (
        <p className="thread-plan-panel-mismatch" data-testid="thread-plan-mode-mismatch">
          Requested {durablePlan.requestedExecutionMode ?? 'plan'} but the harness is in {durablePlan.effectiveExecutionMode ?? 'another mode'}.
        </p>
      ) : null}
      {markdown ? (
        <div className="thread-plan-panel-body" data-testid="thread-plan-body">
          <MarkdownContent text={markdown} />
        </div>
      ) : items.length > 0 ? null : (
        <p className="thread-plan-panel-empty" data-testid="thread-plan-empty">
          {emptyLabel}
        </p>
      )}
      {items.length > 0 ? (
        <section className="thread-plan-panel-todos" data-testid="thread-plan-todos">
          <h3 className="thread-plan-panel-todos-title">
            <ListTodo size={14} aria-hidden="true" />
            To-do
            {durablePlan ? (
              <span className="thread-plan-panel-progress" data-testid="thread-plan-progress">
                {durablePlan.progress.completed}/{durablePlan.progress.total} complete
                {durablePlan.revision > 0 ? ` · revision ${durablePlan.revision}` : ''}
              </span>
            ) : null}
          </h3>
          <ThreadTodoChecklist items={items} />
        </section>
      ) : durablePlan ? (
        <p className="thread-plan-panel-progress" data-testid="thread-plan-progress">
          {durablePlan.progress.completed}/{durablePlan.progress.total} complete
          {durablePlan.revision > 0 ? ` · revision ${durablePlan.revision}` : ''}
        </p>
      ) : null}
      {filePath ? (
        onOpenFile ? (
          <button
            type="button"
            className="thread-plan-panel-file is-button"
            data-testid="thread-plan-open-file"
            title={filePath}
            onClick={() => onOpenFile(filePath)}
          >
            {planFileTabTitle(filePath)}
          </button>
        ) : (
          <p className="thread-plan-panel-file" title={filePath}>{filePath}</p>
        )
      ) : null}
      {refs.length > 0 ? (
        <section className="thread-plan-panel-refs" data-testid="thread-plan-referenced-by">
          <h3>{planReferenceSummary(refs)}</h3>
          <ul>
            {refs.map((ref) => (
              <li key={ref.threadId}>
                <span className="thread-plan-panel-refs-detail">{planReferenceDetail(ref)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
