import '@/lib/monaco-loader';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PanelLeftClose } from 'lucide-react';
import { useData } from '@/store';
import { HostDialogs } from '@/components/HostDialogs';
import { Toaster } from '@/components/Toaster';
import { PluginThemesHost } from '@/plugins/PluginThemesHost';
import { initPluginApps, reconcilePluginApps } from '@/plugins/plugin-app-loader';
import { showInMainWindow } from '@/plugins/plugin-view-windows';
import { closeThreadViewWindow } from '@/lib/thread-view-windows';
import { installThreadOpenFileSignals } from '@/components/thread/secondary-panel/useThreadOpenFileSignal';
import { useShellChromeState } from '@/hooks/useShellChromeState';
import { useEnsureThreads } from '@/hooks/useEnsureThreads';
import { product } from '@/lib/product-client';
import { getThreadRoutePath } from '@/lib/route-paths';
import type { ThreadViewSurfaceTarget } from '@/lib/threadViewSurface';
import { onThreadArchived, useThreads } from '@/thread-store';
import { ThreadDetail } from '@/views/threads/ThreadDetailView';
import { isCloseWindowShortcut } from '@/views/plugin-view/plugin-view-state';
import { threadViewDocumentTitle, threadViewForward } from './thread-view-state.js';

/**
 * The whole renderer of a thread view window: one thread and its side panel
 * under a thin title strip. It never mounts the main shell (sidebar, session
 * restore, CLI agent terminals), so it cannot drive main-window state.
 */
export function ThreadViewApp({ target }: { target: ThreadViewSurfaceTarget }) {
  const init = useData((s) => s.init);
  const thread = useThreads((s) => s.threads.find((row) => row.id === target.threadId));
  const projectId = thread?.projectId ?? target.projectId;
  const project = useData((s) => (projectId ? s.projects.find((row) => row.id === projectId) ?? null : null));
  const chrome = useShellChromeState();
  const location = useLocation();
  const navigate = useNavigate();
  const homePathname = useRef(location.pathname);
  useEnsureThreads();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(installThreadOpenFileSignals, []);

  useEffect(() => {
    let cancelled = false;
    void initPluginApps();
    const off = product.pluginApps.onChanged((entries) => {
      if (!cancelled) void reconcilePluginApps(entries);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  useEffect(() => {
    const base = import.meta.env.DEV ? 'Zana [DEV]' : 'Zana';
    document.title = threadViewDocumentTitle(thread?.title, project?.name, base);
  }, [thread?.title, project?.name]);

  const closeWindow = () => void closeThreadViewWindow(target);

  // An archived thread has nothing left to show here.
  useEffect(
    () => onThreadArchived((threadId) => {
      if (threadId === target.threadId) void closeThreadViewWindow(target);
    }),
    [target]
  );

  // Links out of the thread open in the main window; this one stays on its thread.
  useEffect(() => {
    const forward = threadViewForward(location.pathname, homePathname.current);
    if (!forward) return;
    navigate({ pathname: homePathname.current, search: location.search }, { replace: true });
    void showInMainWindow(forward.path).finally(() => {
      if (forward.closeWindow) void closeThreadViewWindow(target);
    });
  }, [location.pathname, location.search, navigate, target]);

  const bringBack = () => {
    void showInMainWindow(getThreadRoutePath(target.threadId, projectId)).finally(closeWindow);
  };

  // The menu's ⌘W reaches each window's own shortcut handler, and this window has no tabs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isCloseWindowShortcut(event, chrome.platform)) return;
      event.preventDefault();
      void closeThreadViewWindow(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chrome.platform, target]);

  return (
    <div
      className="plugin-view-shell thread-view-shell"
      data-testid="thread-view-window"
      data-thread-id={target.threadId}
      data-platform={chrome.platform}
      data-traffic-lights={chrome.reserveMacosTrafficLights}
      data-windows-caption={chrome.reserveWindowsCaptionButtons}
    >
      <header className="plugin-view-titlebar">
        <span className="plugin-view-title" data-testid="thread-view-title">
          {thread?.title?.trim() || 'Agent'}
          {project?.name ? <span className="plugin-view-title-project"> — {project.name}</span> : null}
        </span>
        <button
          type="button"
          className="plugin-view-bring-back"
          onClick={bringBack}
          title="Show this agent in the main window again"
          data-testid="thread-view-bring-back"
        >
          <PanelLeftClose size={13} aria-hidden="true" />
          <span>Bring back</span>
        </button>
      </header>
      <main className="plugin-view-body">
        <ThreadDetail threadId={target.threadId} />
      </main>
      <PluginThemesHost />
      <HostDialogs />
      <Toaster />
    </div>
  );
}
