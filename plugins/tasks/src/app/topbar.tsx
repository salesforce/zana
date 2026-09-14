import { ChevronDown, ChevronLeft, ChevronUp, Plus } from 'lucide-react';
import type { PublicTask } from '../model.js';
import type { TasksRoute, TasksView } from '../routes.js';

export function Topbar({
  route,
  pager,
  onBack,
  onView,
  onNew,
  onStep
}: {
  route: TasksRoute;
  pager: { index: number; total: number; prevKey: string | null; nextKey: string | null } | null;
  onBack: () => void;
  onView: (view: TasksView) => void;
  onNew: () => void;
  onStep: (key: string) => void;
}) {
  return (
    <header className="tsk-topbar">
      <div className="tsk-topbar-lead">
        {route.kind === 'task' ? (
          <>
            <button type="button" className="tsk-icon-btn" aria-label="Back (Esc)" onClick={onBack}>
              <ChevronLeft size={16} />
            </button>
            <span className="tsk-crumb">{route.taskKey}</span>
          </>
        ) : (
          <span className="tsk-crumb-title">All tasks</span>
        )}
      </div>
      {route.kind === 'task' && pager ? (
        <div className="tsk-pager">
          <span>
            {pager.index} / {pager.total}
          </span>
          <button
            type="button"
            className="tsk-icon-btn"
            aria-label="Previous task"
            disabled={!pager.prevKey}
            onClick={() => pager.prevKey && onStep(pager.prevKey)}
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            className="tsk-icon-btn"
            aria-label="Next task"
            disabled={!pager.nextKey}
            onClick={() => pager.nextKey && onStep(pager.nextKey)}
          >
            <ChevronDown size={14} />
          </button>
        </div>
      ) : null}
      {route.kind === 'browse' ? (
        <div className="tsk-view-toggle" role="group" aria-label="Task view">
          <button
            type="button"
            className={route.view === 'list' ? 'is-active' : ''}
            aria-pressed={route.view === 'list'}
            onClick={() => onView('list')}
          >
            List
          </button>
          <button
            type="button"
            className={route.view === 'board' ? 'is-active' : ''}
            aria-pressed={route.view === 'board'}
            onClick={() => onView('board')}
          >
            Board
          </button>
        </div>
      ) : null}
      {route.kind === 'browse' ? (
        <button type="button" className="tsk-btn tsk-btn-primary tsk-new" aria-label="New task" onClick={onNew}>
          <Plus size={14} />
          <span>New task</span>
        </button>
      ) : null}
    </header>
  );
}

export function pagerPosition(tasks: readonly PublicTask[], taskKey: string) {
  const wanted = taskKey.toUpperCase();
  const index = tasks.findIndex((task) => task.key.toUpperCase() === wanted);
  if (index === -1) return null;
  return {
    index: index + 1,
    total: tasks.length,
    prevKey: tasks[index - 1]?.key ?? null,
    nextKey: tasks[index + 1]?.key ?? null
  };
}
