import { ListTodo } from 'lucide-react';
import type { ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import { MarkdownContent } from '../../MarkdownContent.js';
import { ThreadTodoChecklist } from '../thread-todo-checklist.js';
import { type ThreadPlanDocument, planFileTabTitle } from './thread-plan-document.js';

export type DurablePlanPanelView = {
  markdown: string | null;
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
  referencedBy: Array<{ threadId: string; taskId: string | null }>;
};

export function ThreadPlanPanel({
  document,
  todos,
  durablePlan,
  onOpenFile
}: {
  document: ThreadPlanDocument;
  todos?: ThreadTimelinePendingTodos | null;
  durablePlan?: DurablePlanPanelView | null;
  onOpenFile?: (path: string) => void;
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
  return (
    <div className="thread-plan-panel" data-testid="thread-plan-panel">
      {document.prompt ? (
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
          The agent has not written a plan yet.
        </p>
      )}
      {durablePlan ? (
        <p className="thread-plan-panel-progress" data-testid="thread-plan-progress">
          {durablePlan.progress.completed}/{durablePlan.progress.total} complete
          {durablePlan.revision > 0 ? ` · revision ${durablePlan.revision}` : ''}
        </p>
      ) : null}
      {durablePlan?.processing ? (
        <p className="thread-plan-panel-processing" data-testid="thread-plan-processing">
          Working on {durablePlan.processing.text}
          {durablePlan.processing.owningThreadId ? ` · ${durablePlan.processing.owningThreadId}` : ''}
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
      {items.length > 0 ? (
        <section className="thread-plan-panel-todos" data-testid="thread-plan-todos">
          <h3 className="thread-plan-panel-todos-title">
            <ListTodo size={14} aria-hidden="true" />
            To-do
          </h3>
          <ThreadTodoChecklist items={items} />
        </section>
      ) : null}
      {durablePlan && durablePlan.referencedBy.length > 0 ? (
        <section className="thread-plan-panel-refs" data-testid="thread-plan-referenced-by">
          <h3>Referenced by</h3>
          <ul>
            {durablePlan.referencedBy.map((ref) => (
              <li key={`${ref.threadId}:${ref.taskId ?? ''}`}>{ref.threadId}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
