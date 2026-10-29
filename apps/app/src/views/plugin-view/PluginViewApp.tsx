import '@/lib/monaco-loader';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { PanelLeftClose } from 'lucide-react';
import { useData } from '@/store';
import { PaneEmptyState } from '@/components/PaneEmptyState';
import { HostDialogs } from '@/components/HostDialogs';
import { Toaster } from '@/components/Toaster';
import { PluginThemesHost } from '@/plugins/PluginThemesHost';
import { PluginSlotBoundary } from '@/plugins/PluginSlotBoundary';
import { PluginPanelHostLayout } from '@/views/thread-detail/PluginPanelHostLayout';
import { initPluginApps, reconcilePluginApps } from '@/plugins/plugin-app-loader';
import { listProjectTabs, subscribePluginSlots } from '@/plugins/plugin-slots';
import { hrefForPluginProjectTab } from '@/plugins/plugin-nav-href';
import { closePluginViewWindow, showInMainWindow } from '@/plugins/plugin-view-windows';
import { useShellChromeState } from '@/hooks/useShellChromeState';
import { product } from '@/lib/product-client';
import type { PluginViewSurfaceTarget } from '@/lib/pluginViewSurface';
import { usePluginWindowCloseState } from '@/plugins/plugin-window-close';
import { usePluginViewTitle } from '@/plugins/plugin-view-title';
import { isCloseWindowShortcut, pluginViewDocumentTitle, pluginViewTitleContext, resolvePluginViewState } from './plugin-view-state.js';

/**
 * The whole renderer of a plugin view window: one plugin project tab under a
 * thin title strip. It never mounts the main shell (sidebar, session restore,
 * shortcuts), so the window stays cheap and cannot drive main-window state.
 */
export function PluginViewApp({ target }: { target: PluginViewSurfaceTarget }) {
  const init = useData((s) => s.init);
  const projectsLoaded = useData((s) => s.configLoaded);
  const project = useData((s) => s.projects.find((row) => row.id === target.projectId) ?? null);
  const tabs = useSyncExternalStore(subscribePluginSlots, listProjectTabs, listProjectTabs);
  const [appsReady, setAppsReady] = useState(false);
  const chrome = useShellChromeState();
  const pluginTitle = usePluginViewTitle();
  const closeState = usePluginWindowCloseState();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    let cancelled = false;
    void initPluginApps().finally(() => {
      if (!cancelled) setAppsReady(true);
    });
    const off = product.pluginApps.onChanged((entries) => {
      if (!cancelled) void reconcilePluginApps(entries);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const state = resolvePluginViewState({
    target,
    tabs,
    appsReady,
    projectsLoaded,
    hasProject: !!project
  });
  const label = state.kind === 'ready' || state.kind === 'not-detachable' ? state.tab.label : undefined;
  // Only the mounted tab titles the window; once it is gone the host's label returns.
  const custom = state.kind === 'ready' ? pluginTitle : null;
  const context = pluginViewTitleContext(project?.name, custom);

  useEffect(() => {
    const base = import.meta.env.DEV ? 'Zana [DEV]' : 'Zana';
    document.title = pluginViewDocumentTitle(label, project?.name, base, custom);
  }, [custom, label, project?.name]);

  const bringBack = () => {
    void showInMainWindow(hrefForPluginProjectTab(target.pluginId, target.projectId, target.tabId, target.resourceId)).then(
      (shown) => { if (shown) void closePluginViewWindow(target); }
    );
  };
  const closeWindow = () => void closePluginViewWindow(target);

  // The menu's ⌘W reaches each window's own shortcut handler, and this window has no tabs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isCloseWindowShortcut(event, chrome.platform)) return;
      event.preventDefault();
      void closePluginViewWindow(target);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chrome.platform, target]);

  return (
    <div
      className="plugin-view-shell"
      data-testid="plugin-view-window"
      data-plugin-id={target.pluginId}
      data-tab-id={target.tabId}
      data-platform={chrome.platform}
      data-traffic-lights={chrome.reserveMacosTrafficLights}
      data-windows-caption={chrome.reserveWindowsCaptionButtons}
    >
      <header className="plugin-view-titlebar">
        <span className="plugin-view-title" data-testid="plugin-view-title">
          {custom?.title ?? label ?? 'Plugin'}
          {context ? <span className="plugin-view-title-project"> — {context}</span> : null}
        </span>
        {custom?.badge ? (
          <span className={`plugin-view-title-badge is-${custom.tone}`} data-testid="plugin-view-title-badge">
            {custom.badge}
          </span>
        ) : null}
        {state.kind === 'ready' ? (
          <button
            type="button"
            className="plugin-view-bring-back"
            onClick={bringBack}
            title="Show this tab in the main window again"
            data-testid="plugin-view-bring-back"
          >
            <PanelLeftClose size={13} aria-hidden="true" />
            <span>Bring back</span>
          </button>
        ) : null}
      </header>
      {closeState.error ? <div role="alert" style={{ padding: '8px 16px', color: 'var(--text-danger, #b42318)' }}>{closeState.error}</div> : null}
      {closeState.pending ? <div role="status" style={{ padding: '8px 16px' }}>Finishing your workspace before closing…</div> : null}
      <main className="plugin-view-body">
        {state.kind === 'loading' ? (
          <PaneEmptyState art="loading" title="Loading…" testId="plugin-view-loading" />
        ) : state.kind === 'missing-project' ? (
          <PaneEmptyState art="missing" title="Project not found" hint="This project is no longer available." testId="plugin-view-missing">
            <button type="button" className="btn" onClick={closeWindow}>Close window</button>
          </PaneEmptyState>
        ) : state.kind === 'missing-tab' ? (
          <PaneEmptyState art="missing" title="Plugin tab unavailable" hint="The plugin was disabled, removed or no longer offers this tab." testId="plugin-view-missing">
            <button type="button" className="btn" onClick={closeWindow}>Close window</button>
          </PaneEmptyState>
        ) : state.kind === 'not-detachable' ? (
          <PaneEmptyState art="missing" title={`${state.tab.label} stays in the main window`} hint="This tab does not open in its own window." testId="plugin-view-not-detachable">
            <button type="button" className="btn" onClick={bringBack}>Show in main window</button>
          </PaneEmptyState>
        ) : (
          // The same side panel as in the main window, so agents and page tools open beside the tab here too.
          <PluginPanelHostLayout pluginId={state.tab.pluginId} panelPath={state.tab.id} scopeId={target.projectId} resourceId={target.resourceId} separateWindow>
            <PluginSlotBoundary pluginId={state.tab.pluginId} generation={state.tab.generation}>
              {(() => {
                const Component = state.tab.component;
                return <Component pluginId={state.tab.pluginId} projectId={target.projectId} />;
              })()}
            </PluginSlotBoundary>
          </PluginPanelHostLayout>
        )}
      </main>
      <PluginThemesHost />
      <HostDialogs />
      <Toaster />
    </div>
  );
}
