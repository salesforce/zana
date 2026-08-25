import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { product } from '../lib/product-client.js';
import { getAgentsRoutePath, getProjectRoutePath, getThreadRoutePath, projectIdFromThreadPath, threadIdFromPath } from '../lib/route-paths.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { useThreads, type ThreadListItem } from '../thread-store.js';
import { shouldShowThreadStop } from './thread/thread-timeline-model.js';
import { clampMenuAnchor } from './agentCardActions.js';

/** Open right-click menu: which thread + where to anchor it (viewport coords). */
export interface ThreadMenu {
  thread: ThreadListItem;
  x: number;
  y: number;
}

export type ThreadMenuAction = 'open' | 'stop' | 'fork' | 'archive';

export interface ThreadMenuContext {
  navigate: (path: string) => void;
  pathname: string;
  projectId?: string | null;
  confirm: (message: string) => boolean;
  stop: (id: string) => Promise<unknown>;
  fork: (id: string) => Promise<{ ok: boolean; value?: { id: string } }>;
  archive: (id: string) => Promise<{ ok?: boolean }>;
  remove: (id: string) => void;
}

export function threadTitle(thread: Pick<ThreadListItem, 'title'>): string {
  return thread.title?.trim() || 'Untitled thread';
}

export function viewingThread(pathname: string, threadId: string): boolean {
  return threadIdFromPath(pathname) === threadId;
}

export async function runThreadMenuAction(
  action: ThreadMenuAction,
  thread: Pick<ThreadListItem, 'id' | 'title'>,
  ctx: ThreadMenuContext
): Promise<void> {
  const projectId = ctx.projectId || projectIdFromThreadPath(ctx.pathname) || undefined;
  if (action === 'open') {
    ctx.navigate(getThreadRoutePath(thread.id, projectId));
    return;
  }
  if (action === 'stop') {
    await ctx.stop(thread.id);
    return;
  }
  if (action === 'fork') {
    const forked = await ctx.fork(thread.id);
    if (forked.ok && forked.value?.id) ctx.navigate(getThreadRoutePath(forked.value.id, projectId));
    return;
  }
  const title = threadTitle(thread);
  if (!ctx.confirm(`Archive “${title}”?`)) return;
  const result = await ctx.archive(thread.id);
  if (result && result.ok === false) return;
  ctx.remove(thread.id);
  if (viewingThread(ctx.pathname, thread.id)) {
    ctx.navigate(projectId ? getProjectRoutePath(projectId) : getAgentsRoutePath());
  }
}

export function openThreadMenu(
  e: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number },
  thread: ThreadListItem,
  setMenu: (menu: ThreadMenu | null) => void
): void {
  e.preventDefault();
  e.stopPropagation();
  setMenu({ thread, ...clampMenuAnchor(e) });
}

/**
 * Right-click menu state for conversation threads. Same dismiss-on-outside
 * interaction as {@link useAgentCardActions} so a thread row and an agent row
 * feel identical in the Agents list.
 */
export function useThreadCardActions(): {
  menu: ThreadMenu | null;
  setMenu: (menu: ThreadMenu | null) => void;
} {
  const [menu, setMenu] = useState<ThreadMenu | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  return { menu, setMenu };
}

interface ThreadCardMenuProps {
  menu: ThreadMenu;
  setMenu: (menu: ThreadMenu | null) => void;
}

/**
 * Thread right-click menu. Reuses the TabBar context-menu styling; stopPropagation
 * on mousedown keeps the global close-on-mousedown from firing before a click.
 */
export function ThreadCardMenu({ menu, setMenu }: ThreadCardMenuProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const route = useRouteState();
  const { thread } = menu;
  const canStop = shouldShowThreadStop(thread.id, thread.status);
  const projectId = route.isProjectWorkspace ? route.focusedProjectId : null;

  const run = (action: ThreadMenuAction) => {
    setMenu(null);
    void runThreadMenuAction(action, thread, {
      navigate,
      pathname: location.pathname,
      projectId,
      confirm: (message) => window.confirm(message),
      stop: (id) => product.threads.stop(id),
      fork: (id) => product.threads.fork(id),
      archive: (id) => product.threads.archive(id),
      remove: (id) => useThreads.getState().remove(id)
    });
  };

  return (
    <div
      className="tab-context-menu"
      data-testid="thread-context-menu"
      style={{ top: menu.y, left: menu.x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" onClick={() => run('open')}>
        Open
      </button>
      {canStop && (
        <button
          type="button"
          onClick={() => run('stop')}
          title="Stop this thread. The conversation stays in the list."
        >
          Stop
        </button>
      )}
      <button
        type="button"
        onClick={() => run('fork')}
        title="Start a new thread from this conversation"
      >
        Fork
      </button>
      <div className="tab-context-sep" />
      <button
        type="button"
        className="tab-context-danger"
        onClick={() => run('archive')}
        title="Archive this thread and remove it from the list"
      >
        Archive
      </button>
    </div>
  );
}
