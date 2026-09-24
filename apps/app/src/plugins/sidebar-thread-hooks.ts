import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { PluginSdkApp } from '@zana-ai/zcc-plugin-sdk/app';
import { useData } from '../store.js';
import { useThreads } from '../thread-store.js';
import { product } from '../lib/product-client.js';
import { getThreadRoutePath, getNewThreadRoutePath } from '../lib/route-paths.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { useIsCompactViewport } from '../hooks/useIsCompactViewport.js';
import { useThreadRowSplitDrag } from '../components/sidebar/useThreadRowSplitDrag.js';
import { runThreadMenuAction } from '../components/threadCardActions.js';

export const useSidebarThreads: PluginSdkApp['experimental_useSidebarThreads'] = () => {
  const threads = useThreads(s => s.threads);
  const loading = useThreads(s => s.loading);
  const projects = useData(s => s.projects);
  return useMemo(() => ({
    status: loading ? 'loading' as const : 'ready' as const,
    threads: threads.filter(thread => !thread.archivedAt).map(thread => ({
      id: thread.id, projectId: thread.projectId, title: thread.title,
      providerId: thread.providerId, status: thread.runtime?.displayStatus ?? thread.status,
      createdAt: thread.createdAt, updatedAt: thread.updatedAt,
      pinnedAt: thread.pinnedAt, pinOrder: thread.pinOrder,
      hasPendingInteraction: thread.hasPendingInteraction,
      lastReadSeq: thread.lastReadSeq, maxSeq: thread.maxSeq, branchName: thread.branchName
    })),
    projects: projects.map(({ id, name }) => ({ id, name }))
  }), [threads, loading, projects]);
};

export const useSidebarThreadActions: PluginSdkApp['experimental_useSidebarThreadActions'] = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const route = useRouteState();
  const projectId = route.isProjectFocused ? route.focusedProjectId : null;
  const refresh = async (action: Promise<unknown>) => { await action; await useThreads.getState().load(); };
  const run = async (id: string, action: 'archive' | 'stop' | 'close-followup') => {
    const thread = useThreads.getState().threads.find(row => row.id === id);
    if (!thread) throw new Error('Thread is no longer available');
    await runThreadMenuAction(action, thread, {
      navigate, pathname, projectId, confirm: message => window.confirm(message),
      stop: product.threads.stop, fork: product.threads.fork,
      archive: product.threads.archive, closeFollowup: product.threads.closeFollowup,
      remove: id => useThreads.getState().remove(id)
    });
  };
  return {
    open: id => { void navigate(getThreadRoutePath(id, projectId)); },
    openNewThread: options => { void navigate(getNewThreadRoutePath(options?.projectId ?? projectId ?? undefined)); },
    setPinned: (id, pinned) => refresh(pinned ? product.threads.pin(id) : product.threads.unpin(id)),
    setRead: (id, read) => refresh(read ? product.threads.read(id) : product.threads.unread(id)),
    rename: (id, title) => refresh(product.threads.rename(id, title)),
    archive: id => run(id, 'archive'), stop: id => run(id, 'stop'), closeFollowup: id => run(id, 'close-followup')
  };
};

export const useSidebarThreadSplit: PluginSdkApp['experimental_useSidebarThreadSplit'] = (threadId) => {
  const route = useRouteState();
  const compact = useIsCompactViewport();
  const title = useThreads(s => s.threads.find(thread => thread.id === threadId)?.title ?? 'Untitled agent');
  const drag = useThreadRowSplitDrag({ threadId, title, projectId: route.isProjectFocused ? route.focusedProjectId : null });
  return { isAvailable: !compact, splitProps: { onPointerDown: drag.onPointerDown }, layout: null,
    openInSplit: drag.openInSplit, consumeClick: drag.consumeClick };
};
