import { useSidebarThreads, useSidebarThreadActions, useSidebarThreadSplit } from './sidebar-thread-hooks.js';
import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  HarnessRoutingEditorProps as PluginHarnessRoutingEditorProps,
  PluginComposerApi,
  PluginSdkApp,
  PluginSettingsState,
  ThreadChatProps,
  ZccContext,
  ZccDeepLinks,
  ZccNavigate,
  ZccWindowTitle
} from '@zana-ai/zcc-plugin-sdk/app';
import { callPluginRpc, getPluginSettings } from '@zana-ai/zcc-plugin-sdk/app';
import { MarkdownContent } from '../components/MarkdownContent.js';
import { useRouteState } from '../hooks/useRouteState.js';
import {
  getPluginDetailRoutePath,
  getProjectRoutePath,
  getThreadRoutePath,
  NEW_THREAD_ROUTE_PATH
} from '../lib/route-paths.js';
import { appNavigate } from '../lib/app-navigate.js';
import { getPluginViewTarget } from '../lib/pluginViewSurface.js';
import { isScopedWindow } from '../lib/windowScope.js';
import { hrefForPluginNavPanel, hrefForPluginProjectTab, pluginProjectResourceFromSearch } from './plugin-nav-href.js';
import { listProjectTabs } from './plugin-slots.js';
import {
  isPluginViewOpen,
  listOpenPluginViews,
  openPluginViewWindow,
  showInMainWindow
} from './plugin-view-windows.js';
import { addThreadContext } from './thread-context-target.js';
import { ComposerApiContext, ComposerViewContext, getActiveComposerApi, getActiveComposerView, setPluginLaunchPatch } from './plugin-composer-api.js';
import { usePluginRuntimeContext } from './PluginSlotBoundary.js';
import { openPluginThreadPanel } from './plugin-thread-panel.js';
import { registerPluginWindowCloseHandler } from './plugin-window-close.js';
import { claimPluginViewTitle, sanitizePluginViewTitle, type PluginViewTitleSlot } from './plugin-view-title.js';
import { requestPluginPanelAgent } from './plugin-panel-agent.js';
import { requestPluginPanelScope, requestPluginPanelTool, usePluginPagePanel, usePluginPagePanelOpen } from './plugin-page-panel.js';
import { resolveThreadPanelOwnerId, useThreadPanelOwnerId } from './thread-panel-owner.js';
import { subscribeProductEvent } from '../lib/product-ws.js';
import { deepLinksFor } from './plugin-deep-links.js';
import { HarnessRoutingEditor } from '../views/settings/HarnessRoutingEditor.js';

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
  return useMemo(
    () => ({
      call: (method: string, args?: unknown) => callPluginRpc(pluginId, method, args)
    }),
    [pluginId]
  );
}

function useSettingsImpl(): PluginSettingsState {
  const { pluginId } = usePluginRuntimeContext();
  const [values, setValues] = useState<Record<string, string | number | boolean> | undefined>(undefined);
  const [isLoading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void getPluginSettings(pluginId)
      .then((snapshot) => {
        if (cancelled) return;
        const next: Record<string, string | number | boolean> = {};
        for (const [key, value] of Object.entries(snapshot.values)) {
          if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
            next[key] = value;
          }
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

function useRealtimeImpl(channel: string, handler: (payload: unknown) => void): void {
  const { pluginId } = usePluginRuntimeContext();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  useEffect(
    () =>
      subscribeProductEvent<{ pluginId?: unknown; channel?: unknown; payload?: unknown }>('plugin-signal', (signal) => {
        if (signal?.pluginId !== pluginId || signal.channel !== channel) return;
        handlerRef.current(signal.payload);
      }),
    [channel, pluginId]
  );
}

function useRealtimeConnectionStateImpl() {
  return useSyncExternalStore(
    () => () => undefined,
    () => 'connected' as const,
    () => 'connected' as const
  );
}

function useZccContextImpl(): ZccContext {
  const location = useLocation();
  const panelOwnerId = useThreadPanelOwnerId();
  const route = useRouteState();
  const { pluginId } = usePluginRuntimeContext();
  // Only the page's own plugin gets its side panel; another plugin's slot nested in it does not.
  const panelOpen = usePluginPagePanelOpen();
  const sidePanel = usePluginPagePanel()?.pluginId === pluginId
    ? { sidePanel: true, ...(panelOpen === undefined ? {} : { sidePanelOpen: panelOpen }) }
    : {};
  const view = getPluginViewTarget();
  // A plugin view window shows one project tab and has no routes of its own.
  if (view) return { projectId: view.projectId, threadId: null, surface: 'plugin-view', ...(view.resourceId === undefined ? {} : { resourceId: view.resourceId }), ...sidePanel };
  const resourceId = pluginProjectResourceFromSearch(pluginId, route.focusedProjectId, location.pathname, location.search);
  return {
    ...(resourceId === undefined ? {} : { resourceId, resourceRequestId: location.key }),
    projectId: route.focusedProjectId,
    threadId: panelOwnerId ?? route.threadId,
    surface: isScopedWindow() ? 'project-window' : 'main',
    ...sidePanel
  };
}

/** Titles the plugin view window, and only when it shows this plugin's own tab. */
function useWindowTitleImpl(title: ZccWindowTitle | null | undefined): void {
  const { pluginId } = usePluginRuntimeContext();
  const own = getPluginViewTarget()?.pluginId === pluginId;
  const slot = useRef<PluginViewTitleSlot | null>(null);
  // The place is held from mount to unmount, so a changed title does not jump above a nested one.
  useEffect(() => {
    if (!own) return;
    const claimed = claimPluginViewTitle();
    slot.current = claimed;
    return () => {
      slot.current = null;
      claimed.release();
    };
  }, [own]);
  const clean = sanitizePluginViewTitle(title);
  const text = clean?.title;
  const detail = clean?.detail;
  const badge = clean?.badge;
  const tone = clean?.tone;
  useEffect(() => {
    slot.current?.set(text && tone ? { title: text, ...(detail ? { detail } : {}), ...(badge ? { badge } : {}), tone } : null);
  }, [own, badge, detail, text, tone]);
}

function useWindowCloseHandlerImpl(handler: ((signal: AbortSignal) => void | Promise<void>) | null): void {
  const { pluginId } = usePluginRuntimeContext();
  const own = getPluginViewTarget()?.pluginId === pluginId;
  const latest = useRef(handler);
  latest.current = handler;
  const enabled = own && handler !== null;
  useEffect(() => {
    if (!enabled) return;
    return registerPluginWindowCloseHandler(signal => latest.current?.(signal));
  }, [enabled]);
}

/** This plugin's detachable project tab: the named one, else its first. */
function detachableProjectTab(pluginId: string, tabId: string | undefined) {
  return listProjectTabs().find(
    (tab) => tab.pluginId === pluginId && tab.detachable === true && (tabId === undefined || tab.id === tabId)
  );
}

function useZccNavigateImpl(): ZccNavigate {
  const navigate = useNavigate();
  const { pluginId } = usePluginRuntimeContext();
  const route = useRouteState();
  const panelOwnerId = useThreadPanelOwnerId();
  // The side panel beside this page: requests go to it, not to another pane's.
  const enclosing = usePluginPagePanel();
  const sidePanel = enclosing?.pluginId === pluginId ? enclosing : undefined;
  return useMemo(() => {
    const view = getPluginViewTarget();
    // A plugin view window has no routes: send in-app navigation to the main window.
    const go = (to: string, options?: { replace?: boolean }) => {
      if (view) void showInMainWindow(to);
      else void navigate(to, options);
    };
    return {
      toThread(threadId: string) {
        go(getThreadRoutePath(threadId));
      },
      toProject(projectId: string, options?: { tabId?: string; inMainWindow?: boolean }) {
        if (options?.tabId) {
          const target = { pluginId, tabId: options.tabId, projectId };
          // A tab open in its own window (this one included) lives there; bring that window forward.
          if (!options.inMainWindow && isPluginViewOpen(view ? [view, ...listOpenPluginViews()] : listOpenPluginViews(), target)) {
            void openPluginViewWindow(target);
            return;
          }
          go(hrefForPluginProjectTab(pluginId, projectId, options.tabId));
          return;
        }
        go(getProjectRoutePath(projectId));
      },
      toPluginPanel(path: string, options?: { subPath?: string; replace?: boolean }) {
        go(hrefForPluginNavPanel(pluginId, path, options?.subPath), { replace: options?.replace });
      },
      toCompose(options?: { initialPrompt?: string; focusPrompt?: boolean }) {
        const params = new URLSearchParams();
        if (options?.initialPrompt) params.set('prompt', options.initialPrompt);
        if (options?.focusPrompt) params.set('focus', '1');
        const query = params.toString();
        go(query ? `${NEW_THREAD_ROUTE_PATH}?${query}` : NEW_THREAD_ROUTE_PATH);
      },
      openInWindow(projectId: string, options?: { tabId?: string; resourceId?: string }) {
        const tab = detachableProjectTab(pluginId, options?.tabId);
        if (!tab) return Promise.resolve(false);
        return openPluginViewWindow({ pluginId, tabId: tab.id, projectId, ...(options?.resourceId === undefined ? {} : { resourceId: options.resourceId }) });
      },
      openThreadPanel(options) {
        // No conversation sits beside a plugin view window.
        if (view) return false;
        return openPluginThreadPanel({
          pluginId,
          threadId: resolveThreadPanelOwnerId([
            panelOwnerId,
            options.threadId,
            route.threadId,
            route.sessionId
          ]),
          actionId: options.actionId,
          title: options.title,
          params: options.params ?? null
        });
      },
      supportsContextReferences: true,
      addThreadContext(reference) {
        if (view || enclosing) return false;
        return addThreadContext(resolveThreadPanelOwnerId([panelOwnerId, route.threadId]), reference);
      },
      openPanelAgent(options) {
        return requestPluginPanelAgent({ ...options, pluginId }, sidePanel);
      },
      setPanelScope(scope) {
        requestPluginPanelScope(pluginId, scope, sidePanel);
      },
      openPanelTool(options) {
        return requestPluginPanelTool(pluginId, options, sidePanel);
      }
    };
  }, [navigate, panelOwnerId, pluginId, route.sessionId, route.threadId, sidePanel, enclosing]);
}

function useZccDeepLinksImpl(): ZccDeepLinks {
  const { pluginId } = usePluginRuntimeContext();
  return useMemo(() => deepLinksFor(pluginId), [pluginId]);
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
  focus() {},
  experimental_setLaunchPatch() {}
};

function ThreadChatImpl(props: ThreadChatProps) {
  return (
    <div className={props.className} data-testid="plugin-thread-chat">
      <Suspense fallback={null}>
        <ThreadDetailLazy
          threadId={props.threadId}
          embedded
          leadingContent={props.leadingContent}
          messageActions={props.messageActions}
          includePluginMessageActions={props.includePluginMessageActions ?? false}
        />
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

function HarnessRoutingEditorImpl({ descriptors, ...rest }: PluginHarnessRoutingEditorProps) {
  return <HarnessRoutingEditor descriptors={[...descriptors]} {...rest} />;
}

export function installPluginRuntime(): void {
  const runtime: PluginSdkApp = {
    definePluginApp: (setup) => ({ __zccPluginApp: true, setup }),
    useRpc: useRpcImpl,
    useRealtime: useRealtimeImpl,
    useRealtimeConnectionState: useRealtimeConnectionStateImpl,
    useSettings: useSettingsImpl,
    useZccContext: useZccContextImpl,
    useZccNavigate: useZccNavigateImpl,
    useZccDeepLinks: useZccDeepLinksImpl,
    useWindowTitle: useWindowTitleImpl,
    useWindowCloseHandler: useWindowCloseHandlerImpl,
    useComposer: () => {
      const { pluginId } = usePluginRuntimeContext();
      const scoped = useContext(ComposerApiContext);
      const active = getActiveComposerApi() ?? composerFallback;
      // New insertion is scoped; retain legacy global behavior for older APIs.
      const api = scoped ?? { ...active, insertContextReference: undefined };
      return {
        ...api,
        experimental_setLaunchPatch(patch) {
          setPluginLaunchPatch(pluginId, patch);
        }
      };
    },
    useComposerView: () => useContext(ComposerViewContext) ?? getActiveComposerView() ?? {
      scope: getActiveComposerApi()?.scope ?? { kind: 'new-thread', projectId: null },
      layout: 'expanded',
      draft: {
        text: getActiveComposerApi()?.text ?? '',
        isEmpty: !(getActiveComposerApi()?.text ?? ''),
        attachmentCount: 0
      },
      run: { isRunning: false, isSubmitting: false }
    },
    experimental_useSidebarThreads: useSidebarThreads,
    experimental_useSidebarThreadActions: useSidebarThreadActions,
    experimental_useSidebarThreadPullRequest: () => ({ isLoading: false, pullRequest: null }),
    experimental_useSidebarThreadSplit: useSidebarThreadSplit,
    ThreadChat: ThreadChatImpl,
    Markdown: MarkdownImpl as ComponentType<{ content: string; className?: string }>,
    experimental_NewThreadComposer: NewThreadComposerImpl as never,
    experimental_HarnessRoutingEditor: HarnessRoutingEditorImpl,
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
  appNavigate(getPluginDetailRoutePath(pluginId, { view: 'installed' }));
}
