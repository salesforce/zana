import type { ListFilters, TaskSort } from './model.js';
import { EMPTY_FILTERS, isTaskPriority, isTaskSort, isTaskStatus } from './model.js';
import type { TasksView } from './routes.js';

const VIEW_KEY = 'zcc-tasks:view';
const FILTER_KEY = 'zcc-tasks:filters';
const SORT_KEY = 'zcc-tasks:sort';

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

export function loadViewMode(): TasksView {
  return readStorage(VIEW_KEY) === 'board' ? 'board' : 'list';
}

export function storeViewMode(view: TasksView): void {
  writeStorage(VIEW_KEY, view);
}

export function loadSort(): TaskSort {
  const value = readStorage(SORT_KEY);
  return isTaskSort(value) ? value : 'manual';
}

export function storeSort(sort: TaskSort): void {
  writeStorage(SORT_KEY, sort);
}

export function loadFilters(): ListFilters {
  const raw = readStorage(FILTER_KEY);
  if (!raw) return { ...EMPTY_FILTERS };
  try {
    const parsed = JSON.parse(raw) as { statuses?: unknown; priorities?: unknown };
    const statuses = Array.isArray(parsed.statuses)
      ? parsed.statuses.filter(isTaskStatus)
      : [];
    const priorities = Array.isArray(parsed.priorities)
      ? parsed.priorities.filter(isTaskPriority)
      : [];
    return { statuses, priorities };
  } catch {
    return { ...EMPTY_FILTERS };
  }
}

export function storeFilters(filters: ListFilters): void {
  writeStorage(FILTER_KEY, JSON.stringify(filters));
}
