import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Archive } from 'lucide-react';
import { product } from '../lib/product-client.js';
import { getAgentsRoutePath, getProjectRoutePath, getThreadRoutePath, projectIdFromThreadPath, threadIdFromPath } from '../lib/route-paths.js';
import { openThreadInSplit } from '../lib/split-layout/openThreadInSplit.js';
import { useSplitWorkspace } from '../lib/split-layout/store.js';
import { focusedPaneRoute } from '../lib/split-layout/splitThreadNavigation.js';
import { isCompactViewport } from '../hooks/useIsCompactViewport.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { useThreads, type ThreadListItem } from '../thread-store.js';
import { SHOW_THREAD_FORK } from './thread/ThreadDetailOverflow.js';
import { shouldShowThreadStop } from './thread/thread-timeline-model.js';
import { clampMenuAnchor } from './agentCardActions.js';

/** Open right-click menu: which thread + where to anchor it (viewport coords). */
export interface ThreadMenu {
  thread: ThreadListItem;
  x: number;
  y: number;
}

export type ThreadMenuAction = 'open' | 'open-split' | 'stop' | 'fork' | 'archive' | 'close-followup';

export interface ThreadMenuContext {
  navigate: (path: string) => void;
  pathname: string;
  projectId?: string | null;
  confirm: (message: string) => boolean;
  stop: (id: string) => Promise<unknown>;
  fork: (id: string) => Promise<{ ok: boolean; value?: { id: string } }>;
  archive: (id: string) => Promise<{ ok?: boolean }>;
  closeFollowup: (id: string) => Promise<{ ok?: boolean; summarized?: number; followedUp?: number }>;
  remove: (id: string) => void;
}

export function threadTitle(thread: Pick<ThreadListItem, 'title'>): string {
  return thread.title?.trim() || 'Untitled agent';
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
  if (action === 'open-split') {
    openThreadInSplit({
      navigate: ctx.navigate,
      projectId: projectId ?? null,
      threadId: thread.id,
      isCompact: isCompactViewport(),
      currentPathname: ctx.pathname
    });
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
  if (action === 'close-followup') {
    if (ctx.confirm && !ctx.confirm(`Close “${title}” and file a follow-up if work is left?`)) return;
    const result = await ctx.closeFollowup(thread.id);
    if (result && result.ok === false) return;
    ctx.remove(thread.id);
    const closed = useSplitWorkspace.getState().closePanesForThreads([thread.id]);
    if (closed.removedAny && closed.focusedRouteContent) {
      const route = focusedPaneRoute(closed.focusedRouteContent);
      if (route) {
        ctx.navigate(route);
        return;
      }
    }
    if (viewingThread(ctx.pathname, thread.id)) {
      const scoped = ctx.projectId || projectIdFromThreadPath(ctx.pathname) || undefined;
      ctx.navigate(scoped ? getProjectRoutePath(scoped) : getAgentsRoutePath());
    }
    return;
  }
  if (action === 'archive' && ctx.confirm && !ctx.confirm(`Archive “${title}”?`)) return;
  await archiveThreadWithoutConfirm(thread, ctx);
}

export async function archiveThreadWithoutConfirm(
  thread: Pick<ThreadListItem, 'id' | 'title'>,
  ctx: ThreadMenuContext
): Promise<void> {
  const result = await ctx.archive(thread.id);
  if (result && result.ok === false) return;
  ctx.remove(thread.id);
  const closed = useSplitWorkspace.getState().closePanesForThreads([thread.id]);
  if (closed.removedAny && closed.focusedRouteContent) {
    const route = focusedPaneRoute(closed.focusedRouteContent);
    if (route) {
      ctx.navigate(route);
      return;
    }
  }
  if (viewingThread(ctx.pathname, thread.id)) {
    const projectId = ctx.projectId || projectIdFromThreadPath(ctx.pathname) || undefined;
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
  const projectId = route.isProjectFocused ? route.focusedProjectId : null;

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
      closeFollowup: (id) => product.threads.closeFollowup(id),
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
      <button type="button" onClick={() => run('open-split')}>
        Open in split
      </button>
      {canStop && (
        <button
          type="button"
          onClick={() => run('stop')}
          title="Stop this agent. The conversation stays in the list."
        >
          Stop
        </button>
      )}
      {SHOW_THREAD_FORK ? (
        <button
          type="button"
          onClick={() => run('fork')}
          title="Start a new agent from this conversation"
        >
          Fork
        </button>
      ) : null}
      {!thread.archivedAt && (
        <button
          type="button"
          onClick={() => run('close-followup')}
          title="Close the agent, summarising its work to your inbox and filing a follow-up if it left something unfinished"
        >
          Close with follow-up
        </button>
      )}
      <div className="tab-context-sep" />
      <button
        type="button"
        className="tab-context-danger"
        onClick={() => run('archive')}
        title="Archive this agent and remove it from the list"
      >
        Archive
      </button>
    </div>
  );
}

/** Hover-revealed one-click archive. Same lifecycle as the menu, without a confirm dialog. */
export function ThreadArchiveQuickAction({ thread }: { thread: ThreadListItem }) {
  const navigate = useNavigate();
  const location = useLocation();
  const route = useRouteState();
  const projectId = route.isProjectFocused ? route.focusedProjectId : null;
  return (
    <button
      type="button"
      className="project-terminal-close thread-archive-quick"
      data-testid="thread-archive-quick"
      aria-label={`Archive ${threadTitle(thread)}`}
      title="Archive agent"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void archiveThreadWithoutConfirm(thread, {
          navigate,
          pathname: location.pathname,
          projectId,
          confirm: () => true,
          stop: (id) => product.threads.stop(id),
          fork: (id) => product.threads.fork(id),
          archive: (id) => product.threads.archive(id),
          closeFollowup: (id) => product.threads.closeFollowup(id),
          remove: (id) => useThreads.getState().remove(id)
        });
      }}
    >
      <Archive size={12} />
    </button>
  );
}
