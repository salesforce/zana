import {
  EMPTY_FILTERS,
  hasActiveFilters,
  PRIORITY_LABELS,
  SORT_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_SORTS,
  TASK_STATUSES,
  type ListFilters,
  type TaskPriority,
  type TaskSort
} from '../model.js';
import { PriorityIcon, StatusIcon } from './icons.js';
import { ChipButton, MenuItem } from './menu.js';
import { Circle, ArrowUpDown, ListFilter, X } from 'lucide-react';

function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function FilterBar({
  filters,
  sort,
  taskCount,
  onFilters,
  onSort
}: {
  filters: ListFilters;
  sort: TaskSort;
  taskCount: number | undefined;
  onFilters: (filters: ListFilters) => void;
  onSort: (sort: TaskSort) => void;
}) {
  const active = hasActiveFilters(filters);
  return (
    <div className="tsk-filters">
      <div className="tsk-filters-left">
        <ChipButton
          icon={<Circle size={12} />}
          label="Status"
          activeText={filters.statuses.map((status) => STATUS_LABELS[status]).join(', ')}
        >
          {() =>
            TASK_STATUSES.map((status) => (
              <MenuItem
                key={status}
                icon={<StatusIcon status={status} />}
                checked={filters.statuses.includes(status)}
                onSelect={() => onFilters({ ...filters, statuses: toggled(filters.statuses, status) })}
              >
                {STATUS_LABELS[status]}
              </MenuItem>
            ))
          }
        </ChipButton>
        <ChipButton
          icon={<ArrowUpDown size={12} />}
          label="Priority"
          activeText={filters.priorities.map((priority) => PRIORITY_LABELS[priority]).join(', ')}
        >
          {() =>
            TASK_PRIORITIES.map((priority: TaskPriority) => (
              <MenuItem
                key={priority}
                icon={<PriorityIcon priority={priority} />}
                checked={filters.priorities.includes(priority)}
                onSelect={() => onFilters({ ...filters, priorities: toggled(filters.priorities, priority) })}
              >
                {PRIORITY_LABELS[priority]}
              </MenuItem>
            ))
          }
        </ChipButton>
        {active ? (
          <button type="button" className="tsk-chip" onClick={() => onFilters(EMPTY_FILTERS)}>
            <X size={12} />
            Clear
          </button>
        ) : null}
      </div>
      <ChipButton
        icon={<ListFilter size={12} />}
        label="Sort"
        activeText={sort === 'manual' ? undefined : SORT_LABELS[sort]}
        align="end"
      >
        {(close) =>
          TASK_SORTS.map((option) => (
            <MenuItem
              key={option}
              checked={sort === option}
              onSelect={() => {
                onSort(option);
                close();
              }}
            >
              {SORT_LABELS[option]}
            </MenuItem>
          ))
        }
      </ChipButton>
      <span className="tsk-count">
        {taskCount === undefined ? '' : `${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}`}
      </span>
    </div>
  );
}
