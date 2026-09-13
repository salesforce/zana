export type TasksView = 'list' | 'board';

export type TasksRoute =
  | { kind: 'browse'; view: TasksView }
  | { kind: 'task'; taskKey: string };

export function parseTasksRoute(subPath: string): Omit<TasksRoute, 'view'> & { view?: TasksView } | TasksRoute {
  const parts = subPath.split('/').filter(Boolean);
  if (parts[0] === 'task' && parts[1]) {
    return { kind: 'task', taskKey: parts[1] };
  }
  if (parts[0] === 'board') return { kind: 'browse', view: 'board' };
  if (parts[0] === 'list') return { kind: 'browse', view: 'list' };
  return { kind: 'browse' };
}

export function resolveTasksRoute(subPath: string, fallbackView: TasksView): TasksRoute {
  const parsed = parseTasksRoute(subPath);
  if (parsed.kind === 'task') return parsed;
  return { kind: 'browse', view: parsed.view ?? fallbackView };
}

export function subPathForRoute(route: TasksRoute): string {
  if (route.kind === 'task') return `task/${route.taskKey}`;
  return route.view === 'board' ? 'board' : '';
}
