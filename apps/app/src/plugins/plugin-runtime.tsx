import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  PluginComposerApi,
  PluginSdkApp,
  PluginSettingsState,
  ZccNavigate
} from '@zana-ai/zcc-plugin-sdk/app';
import { callPluginRpc, getPluginSettings } from '@zana-ai/zcc-plugin-sdk/app';
import { MarkdownContent } from '../components/MarkdownContent.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { useThreads } from '../thread-store.js';
import {
  getPluginDetailRoutePath,
  getPluginPanelRoutePath,
  getProjectRoutePath,
  getThreadRoutePath,
  NEW_THREAD_ROUTE_PATH
} from '../lib/route-paths.js';
import { appNavigate } from '../lib/app-navigate.js';
import { getActiveComposerApi } from './plugin-composer-api.js';
import { usePluginRuntimeContext } from './PluginSlotBoundary.js';
import { openPluginThreadPanel } from './plugin-thread-panel.js';

const ThreadDetailLazy = lazy(async () => {
  const mod = await import('../views/threads/ThreadDetailView.js');
  return { default: mod.ThreadDetail };
});

const NewThreadViewLazy = lazy(async () => {
  const mod = await import('../views/threads/NewThreadView.js');
  return { default: mod.NewThreadView };
});

function useRpcImpl() {
  const { pluginId } = usePluginRuntimeContext();
  return {
    call: (method: string, args?: unknown) => callPluginRpc(pluginId, method, args)
  };
}

function useSettingsImpl(): PluginSettingsState {
  const { pluginId } = usePluginRuntimeContext();
  const [values, setValues] = useState<Record<string, string | boolean> | undefined>(undefined);
  const [isLoading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void getPluginSettings(pluginId)
      .then((snapshot) => {
        if (cancelled) return;
        const next: Record<string, string | boolean> = {};
        for (const [key, value] of Object.entries(snapshot.values)) {
          if (typeof value === 'string' || typeof value === 'boolean') next[key] = value;
        }
        setValues(next);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId]);
  return { values, isLoading };
}

function useZccContextImpl() {
  const route = useRouteState();
  return { projectId: route.focusedProjectId, threadId: route.threadId };
}

function useZccNavigateImpl(): ZccNavigate {
  const navigate = useNavigate();
  const { pluginId } = usePluginRuntimeContext();
  const route = useRouteState();
  return useMemo(
    () => ({
      toThread(threadId: string) {
        void navigate(getThreadRoutePath(threadId));
      },
      toProject(projectId: string) {
        void navigate(getProjectRoutePath(projectId));
      },
      toPluginPanel(path: string, options?: { subPath?: string; replace?: boolean }) {
        const to = getPluginPanelRoutePath({ pluginId, path, subPath: options?.subPath });
        void navigate(to, { replace: options?.replace });
      },
      toCompose(options?: { initialPrompt?: string; focusPrompt?: boolean }) {
        const params = new URLSearchParams();
        if (options?.initialPrompt) params.set('prompt', options.initialPrompt);
        if (options?.focusPrompt) params.set('focus', '1');
        const query = params.toString();
        void navigate(query ? `${NEW_THREAD_ROUTE_PATH}?${query}` : NEW_THREAD_ROUTE_PATH);
      },
      openThreadPanel(options) {
        return openPluginThreadPanel({
          pluginId,
          threadId: route.threadId,
          actionId: options.actionId,
          title: options.title,
          params: options.params ?? null
        });
      }
    }),
    [navigate, pluginId, route.threadId]
  );
}

const composerFallback: PluginComposerApi = {
  scope: { kind: 'new-thread', projectId: null },
  text: '',
  setText() {},
  updateText() {},
  clear() {},
  setTextEffect() {},
  setInputLock() {},
  addQuote() {},
  insertMention() {},
  focus() {}
};

function ThreadChatImpl({ threadId, className }: { threadId: string; className?: string }) {
  return (
    <div className={className} data-testid="plugin-thread-chat">
      <Suspense fallback={null}>
        <ThreadDetailLazy threadId={threadId} embedded />
      </Suspense>
    </div>
  );
}

function MarkdownImpl({ content, className }: { content: string; className?: string }) {
  return (
    <div className={className}>
      <MarkdownContent text={content} />
    </div>
  );
}

function NewThreadComposerImpl({
  defaultProjectId,
  initialPrompt
}: {
  defaultProjectId?: string;
  initialPrompt?: string;
}) {
  void defaultProjectId;
  void initialPrompt;
  return (
    <Suspense fallback={null}>
      <NewThreadViewLazy />
    </Suspense>
  );
}

export function installPluginRuntime(): void {
  const runtime: PluginSdkApp = {
    definePluginApp: (setup) => ({ __zccPluginApp: true, setup }),
    useRpc: useRpcImpl,
    useRealtime: () => undefined,
    useRealtimeConnectionState: () => 'connected',
    useSettings: useSettingsImpl,
    useZccContext: useZccContextImpl,
    useZccNavigate: useZccNavigateImpl,
    useComposer: () => getActiveComposerApi() ?? composerFallback,
    useComposerView: () => ({
      scope: getActiveComposerApi()?.scope ?? { kind: 'new-thread', projectId: null },
      layout: 'expanded',
      draft: {
        text: getActiveComposerApi()?.text ?? '',
        isEmpty: !(getActiveComposerApi()?.text ?? ''),
        attachmentCount: 0
      },
      run: { isRunning: false, isSubmitting: false }
    }),
    experimental_useSidebarThreads: () => {
      const threads = useThreads.getState().threads.map((thread) => ({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title
      }));
      return { status: 'ready', threads, projects: [] };
    },
    experimental_useSidebarThreadActions: () => ({
      open: (threadId: string) => {
        appNavigate(getThreadRoutePath(threadId));
      },
      openNewThread: () => {
        appNavigate(NEW_THREAD_ROUTE_PATH);
      }
    }),
    experimental_useSidebarThreadPullRequest: () => ({ isLoading: false, pullRequest: null }),
    experimental_useSidebarThreadSplit: () => ({ isAvailable: false, splitProps: {}, layout: null }),
    ThreadChat: ThreadChatImpl as ComponentType<{ threadId: string }>,
    Markdown: MarkdownImpl as ComponentType<{ content: string; className?: string }>,
    experimental_NewThreadComposer: NewThreadComposerImpl as never,
    toast: (message, kind = 'info') => {
      void import('../store.js').then((mod) => {
        mod.useUi.getState().pushToast(message, kind);
      });
    }
  };
  (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginSdkApp }).__ZCC_PLUGIN_RUNTIME__ = runtime;
}

export { setActiveComposerApi } from './plugin-composer-api.js';

export function openPluginSettings(pluginId: string): void {
  appNavigate(getPluginDetailRoutePath(pluginId));
}
