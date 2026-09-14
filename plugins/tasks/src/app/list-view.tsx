import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  EMPTY_FILTERS,
  groupTasksByStatus,
  hasActiveFilters,
  matchesFilters,
  sortTasks,
  STATUS_LABELS,
  type ListFilters,
  type PublicTask,
  type TaskPriority,
  type TaskSort,
  type TaskStatus
} from '../model.js';
import { EmptyState } from './empty-state.js';
import { FilterBar } from './filter-bar.js';
import { StatusIcon } from './icons.js';
import { TaskRow } from './task-row.js';

export function ListView({
  items,
  error,
  filters,
  sort,
  onFilters,
  onSort,
  onOpen,
  onEdit,
  onNew
}: {
  items: PublicTask[] | undefined;
  error: string | null;
  filters: ListFilters;
  sort: TaskSort;
  onFilters: (filters: ListFilters) => void;
  onSort: (sort: TaskSort) => void;
  onOpen: (task: PublicTask) => void;
  onEdit: (task: PublicTask, patch: { status?: TaskStatus; priority?: TaskPriority }) => void;
  onNew: () => void;
}) {
  const filtered = items?.filter((task) => matchesFilters(task, filters));
  const groups = filtered ? groupTasksByStatus(sortTasks(filtered, sort)) : [];
  const filteredOut = Boolean(filtered && filtered.length === 0 && items && items.length > 0 && hasActiveFilters(filters));

  let body: ReactNode;
  if (items === undefined) {
    body = (
      <div className="tsk-skeleton" aria-hidden>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="tsk-skeleton-row" />
        ))}
      </div>
    );
  } else if (error && items.length === 0) {
    body = <EmptyState title="Couldn't load tasks" description={error} />;
  } else if (filteredOut) {
    body = (
      <EmptyState
        title="No tasks match these filters"
        action={
          <button type="button" className="tsk-btn tsk-btn-secondary" onClick={() => onFilters(EMPTY_FILTERS)}>
            Clear filters
          </button>
        }
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        title="No tasks yet"
        description="Create the first task to start tracking work."
        action={
          <button type="button" className="tsk-btn tsk-btn-primary" onClick={onNew}>
            <Plus size={14} />
            New task
          </button>
        }
      />
    );
  } else {
    body = groups.map((group) => (
      <section key={group.status} className="tsk-group">
        <div className="tsk-group-head" data-status-group-header={group.status}>
          <StatusIcon status={group.status} />
          <span>{STATUS_LABELS[group.status]}</span>
          <span className="tsk-group-count">{group.tasks.length}</span>
        </div>
        {group.tasks.map((task) => (
          <TaskRow key={task.id} task={task} onOpen={() => onOpen(task)} onEdit={(patch) => onEdit(task, patch)} />
        ))}
      </section>
    ));
  }

  return (
    <div className="tsk-list">
      <FilterBar filters={filters} sort={sort} taskCount={filtered?.length} onFilters={onFilters} onSort={onSort} />
      <div className="tsk-list-body">{body}</div>
    </div>
  );
}
