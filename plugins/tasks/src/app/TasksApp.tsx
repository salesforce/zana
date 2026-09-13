import { useEffect, useMemo, useState } from 'react';
import { useZccNavigate, type PluginNavPanelProps, type PluginThreadPanelProps } from '@zana-ai/zcc-plugin-sdk/app';
import {
  EMPTY_FILTERS,
  groupTasksByStatus,
  sortTasks,
  type ListFilters,
  type PublicTask,
  type TaskPriority,
  type TaskSort,
  type TaskStatus
} from '../model.js';
import { loadFilters, loadSort, loadViewMode, storeFilters, storeSort, storeViewMode } from '../preference.js';
import { resolveTasksRoute, subPathForRoute, type TasksView } from '../routes.js';
import { BoardView } from './board-view.js';
import { DetailView } from './detail-view.js';
import { ListView } from './list-view.js';
import { NewTaskDialog, type NewTaskDraft } from './new-task-dialog.js';
import { pagerPosition, Topbar } from './topbar.js';
import { useTaskList } from './use-task-list.js';

export function TasksApp({ pluginId, subPath }: PluginNavPanelProps) {
  const navigate = useZccNavigate();
  const { items, error, refresh, rpc } = useTaskList();
  const [filters, setFilters] = useState<ListFilters>(loadFilters);
  const [sort, setSort] = useState<TaskSort>(loadSort);
  const [dialog, setDialog] = useState<{ open: boolean; status: TaskStatus }>({ open: false, status: 'todo' });
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [route, setRoute] = useState(() => resolveTasksRoute(subPath, loadViewMode()));

  useEffect(() => {
    setRoute(resolveTasksRoute(subPath, loadViewMode()));
  }, [subPath]);

  const go = (next: Parameters<typeof subPathForRoute>[0], replace = false) => {
    if (next.kind === 'browse') storeViewMode(next.view);
    setRoute(next);
    navigate.toPluginPanel('main', { subPath: subPathForRoute(next), replace });
  };

  useEffect(() => {
    if (route.kind !== 'task') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) {
        return;
      }
      go({ kind: 'browse', view: loadViewMode() });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.kind]);

  const ordered = useMemo(() => {
    if (!items) return [];
    return groupTasksByStatus(sortTasks(items, sort)).flatMap((group) => group.tasks);
  }, [items, sort]);

  const detail = route.kind === 'task' ? items?.find((task) => task.key.toUpperCase() === route.taskKey.toUpperCase()) : undefined;

  const mutate = async (work: () => Promise<unknown>) => {
    try {
      await work();
      await refresh();
      return true;
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const onEdit = (task: PublicTask, patch: { status?: TaskStatus; priority?: TaskPriority; title?: string; description?: string; dueDate?: string | null }) => {
    void mutate(() => rpc.call('update', { id: task.id, ...patch }));
  };

  const onCreate = (draft: NewTaskDraft) => {
    setBusy(true);
    setFormError(null);
    void rpc
      .call('add', {
        title: draft.title,
        description: draft.description,
        status: draft.status,
        priority: draft.priority,
        dueDate: draft.dueDate || undefined
      })
      .then(async (created) => {
        const task = created as PublicTask;
        setDialog({ open: false, status: 'todo' });
        await refresh();
        if (task?.key) go({ kind: 'task', taskKey: task.key });
      })
      .catch((cause: unknown) => {
        setFormError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="tsk-panel" data-plugin={pluginId}>
      <Topbar
        route={route}
        pager={route.kind === 'task' ? pagerPosition(ordered, route.taskKey) : null}
        onBack={() => go({ kind: 'browse', view: loadViewMode() })}
        onView={(view: TasksView) => go({ kind: 'browse', view }, true)}
        onNew={() => {
          setFormError(null);
          setDialog({ open: true, status: 'todo' });
        }}
        onStep={(key) => go({ kind: 'task', taskKey: key })}
      />
      {route.kind === 'browse' && route.view === 'list' ? (
        <ListView
          items={items}
          error={error}
          filters={filters}
          sort={sort}
          onFilters={(next) => {
            setFilters(next);
            storeFilters(next);
          }}
          onSort={(next) => {
            setSort(next);
            storeSort(next);
          }}
          onOpen={(task) => go({ kind: 'task', taskKey: task.key })}
          onEdit={onEdit}
          onNew={() => setDialog({ open: true, status: 'todo' })}
        />
      ) : null}
      {route.kind === 'browse' && route.view === 'board' ? (
        <BoardView
          items={items}
          error={error}
          onOpen={(task) => go({ kind: 'task', taskKey: task.key })}
          onMove={(task, status, index) => {
            void mutate(() => rpc.call('boardMove', { id: task.id, status, index }));
          }}
          onNew={(status) => {
            setFormError(null);
            setDialog({ open: true, status });
          }}
        />
      ) : null}
      {route.kind === 'task' ? (
        <DetailView
          task={detail}
          error={error ?? (items && !detail ? `task not found: ${route.taskKey}` : null)}
          onPatch={(patch) => {
            if (detail) onEdit(detail, patch);
          }}
          onRemove={() => {
            if (!detail) return;
            void mutate(() => rpc.call('remove', { id: detail.id })).then((ok) => {
              if (ok) go({ kind: 'browse', view: loadViewMode() });
            });
          }}
        />
      ) : null}
      <NewTaskDialog
        open={dialog.open}
        defaultStatus={dialog.status}
        busy={busy}
        error={formError}
        onClose={() => setDialog({ open: false, status: 'todo' })}
        onCreate={onCreate}
      />
    </div>
  );
}

export function TasksThreadPanel({ pluginId }: PluginThreadPanelProps) {
  return <TasksApp pluginId={pluginId} subPath="" />;
}
