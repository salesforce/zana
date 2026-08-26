import { ListTodo } from 'lucide-react';
import type { ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import { MarkdownContent } from '../../MarkdownContent.js';
import { type ThreadPlanDocument, planFileTabTitle } from './thread-plan-document.js';

export function ThreadPlanPanel({
  document,
  todos,
  onOpenFile
}: {
  document: ThreadPlanDocument;
  todos?: ThreadTimelinePendingTodos | null;
  onOpenFile?: (path: string) => void;
}) {
  const items = todos?.items ?? [];
  const filePath = document.filePath;
  return (
    <div className="thread-plan-panel" data-testid="thread-plan-panel">
      {document.prompt ? (
        <p className="thread-plan-panel-prompt" data-testid="thread-plan-prompt">
          {document.prompt}
        </p>
      ) : null}
      {document.markdown ? (
        <div className="thread-plan-panel-body" data-testid="thread-plan-body">
          <MarkdownContent text={document.markdown} />
        </div>
      ) : (
        <p className="thread-plan-panel-empty" data-testid="thread-plan-empty">
          The agent has not written a plan yet.
        </p>
      )}
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
          <ul>
            {items.map((item) => (
              <li key={item.id} data-status={item.status}>{item.text}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
