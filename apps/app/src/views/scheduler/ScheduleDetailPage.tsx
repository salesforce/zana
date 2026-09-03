import { useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Maximize2, Minimize2, PanelRight, X } from 'lucide-react';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { useScheduler, useUi } from '../../store.js';
import { getNewScheduleRoutePath, getScheduleRoutePath, getSchedulerRoutePath, getProjectWorkspaceRoutePath } from '../../lib/route-paths.js';
import { useOptionalPaneContext, usePaneSecondaryPanelRegistration } from '../thread-detail/PaneContext.js';
import { ThreadSecondaryPanel } from '../../components/thread/secondary-panel/ThreadSecondaryPanel.js';
import { ThreadNewTabPage } from '../../components/thread/secondary-panel/ThreadNewTabPage.js';
import { ThreadFilePreviewTab } from '../../components/thread/secondary-panel/ThreadFilePreviewTab.js';
import { BrowserTabDeck } from '../../components/thread/secondary-panel/BrowserTabDeck.js';
import { ThreadPluginTab } from '../../components/thread/secondary-panel/ThreadPluginTab.js';
import { ThreadExplorerTab } from '../../components/thread/secondary-panel/ThreadExplorerTab.js';
import { useSecondaryPanel } from '../../components/thread/secondary-panel/useThreadSecondaryPanel.js';
import { useInAppBrowserPanel } from '../../components/thread/secondary-panel/useInAppBrowserPanel.js';
import {
  activeClosableTab,
  activePinnedView
} from '../../components/thread/secondary-panel/threadSecondaryPanelState.js';
import { getDesktopBrowserApi } from '../../lib/desktop-browser.js';
import { getBrowserUrlHost } from '../../lib/browser-url.js';
import { tabInputFromRecentItem } from '../../components/thread/secondary-panel/threadRecentItems.js';
import { ScheduleEditor } from '../../components/scheduler/ScheduleEditor.js';
import { ScheduleInfoPanel } from '../../components/scheduler/ScheduleInfoPanel.js';
import { DeleteConfirmModal } from '../../components/scheduler/DeleteConfirmModal.js';
import { scheduleSeedFromLocationState, type ScheduleSeed } from '../../components/scheduler/schedule-seed.js';

/**
 * First-class schedule page in the split workspace. Looks up the scheduled task
 * from main's store (never from renderer free-text beyond the routed ids) and
 * hosts the editor + secondary-panel chrome. A vanished schedule shows an empty
 * state. `scheduleId === null` is the create page.
 */
export function ScheduleDetailPage({
  projectId,
  scheduleId
}: {
  projectId: string | null;
  scheduleId: string | null;
}) {
  const location = useLocation();
  const seed = scheduleSeedFromLocationState(location.state);
  const tasks = useScheduler((s) => s.tasks);
  const loading = useScheduler((s) => s.loading);
  const task = useMemo(
    () => (scheduleId ? tasks.find((row) => row.id === scheduleId) ?? null : null),
    [scheduleId, tasks]
  );

  if (scheduleId && !task && !loading) {
    return (
      <div className="thread-detail-empty" data-testid="schedule-missing">
        This schedule is no longer available.
      </div>
    );
  }

  return (
    <ScheduleDetailView
      task={task}
      seed={scheduleId ? null : seed}
      projectId={projectId}
      ownerId={scheduleId ?? `new:${projectId ?? 'global'}`}
    />
  );
}

function ScheduleDetailView({
  task,
  seed,
  projectId,
  ownerId
}: {
  task: ScheduledTask | null;
  seed: ScheduleSeed | null;
  projectId: string | null;
  ownerId: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const pane = useOptionalPaneContext();
  const hostedSecondary = pane?.secondaryPanelHost != null;
  const panel = useSecondaryPanel(ownerId, { defaultOpen: true });
  useInAppBrowserPanel(ownerId, panel);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isExternal = task?.external?.kind === 'claude-loop';

  const pin = activePinnedView(panel.state);
  const closable = activeClosableTab(panel.state);
  const panelOpen = hostedSecondary ? false : panel.state.isOpen;
  const viewClass = [
    'thread-detail-view',
    'schedule-detail-view',
    pane?.isSplitPane ? 'thread-detail-view--split-pane' : '',
    pane?.isFocused === false ? 'is-pane-inactive' : '',
    panelOpen ? 'is-secondary-open' : '',
    !hostedSecondary && panel.state.isMaximized ? 'is-secondary-maximized' : ''
  ].filter(Boolean).join(' ');

  const title = task?.name
    ?? (seed?.kind === 'template' ? `New schedule · ${seed.template.name}` : null)
    ?? (seed?.kind === 'duplicate' ? `Duplicate · ${seed.source.name}` : null)
    ?? 'New schedule';

  const onSaved = (scheduleId: string) => {
    navigate(getScheduleRoutePath(scheduleId, projectId), { replace: true });
  };

  const onDuplicate = task
    ? () => {
        navigate(getNewScheduleRoutePath(projectId), {
          state: { seed: { kind: 'duplicate', source: task } satisfies ScheduleSeed }
        });
      }
    : undefined;

  let panelBody: ReactNode = null;
  if (pin === 'info') {
    panelBody = (
      <ScheduleInfoPanel
        task={task}
        onDuplicate={onDuplicate}
        onAskDelete={task && !isExternal ? () => setConfirmDelete(true) : undefined}
        navigate={navigate}
        currentPathname={location.pathname}
      />
    );
  } else if (closable?.kind === 'new-tab') {
    panelBody = (
      <ThreadNewTabPage
        projectId={task?.projectId ?? projectId}
        cwd={null}
        threadId={ownerId}
        allowSidecarTerminal={false}
        onOpenFile={(path, fileTitle) => panel.addTab({ kind: 'file-preview', title: fileTitle, path })}
        onOpenBrowser={() => panel.addTab({ kind: 'browser', title: 'Browser', url: '' })}
        onOpenExplorer={() => panel.addTab({ kind: 'explorer', title: 'Explorer' })}
        onOpenPlugin={(moduleId, pluginTitle, options) => {
          panel.addTab({
            kind: 'plugin',
            title: pluginTitle,
            moduleId,
            actionId: options?.actionId,
            params: options?.params ?? null,
            layout: options?.layout
          });
        }}
        onOpenRecent={(item) => panel.addTab(tabInputFromRecentItem(item))}
      />
    );
  } else if ((closable?.kind === 'file-preview' || closable?.kind === 'storage-preview') && closable.path) {
    panelBody = (
      <ThreadFilePreviewTab
        threadId={ownerId}
        path={closable.path}
        openerKey={closable.openerKey}
        projectId={task?.projectId ?? projectId}
        storage={closable.kind === 'storage-preview'}
      />
    );
  } else if (closable?.kind === 'browser') {
    panelBody = null;
  } else if (closable?.kind === 'plugin' && closable.moduleId) {
    panelBody = (
      <ThreadPluginTab
        moduleId={closable.moduleId}
        projectId={task?.projectId ?? projectId}
        threadId={ownerId}
        actionId={closable.actionId}
        params={closable.params}
        layout={closable.layout}
      />
    );
  } else if (closable?.kind === 'explorer') {
    panelBody = <ThreadExplorerTab projectId={task?.projectId ?? projectId} />;
  }

  const secondaryPanelNode: ReactNode = panel.state.isOpen ? (
    <ThreadSecondaryPanel
      state={panel.state}
      showDiffPin={false}
      showPlanPin={false}
      onSelectInfo={() => panel.selectPin('info')}
      onSelectDiff={() => panel.selectPin('diff')}
      onNewTab={panel.openNewTab}
      onCloseTab={panel.closeTab}
      onActivateTab={panel.activateTab}
      onToggleMaximized={panel.toggleMaximized}
      onHide={panel.close}
      onResize={panel.setWidth}
    >
      {panelBody}
      <BrowserTabDeck
        browserTabs={panel.state.tabs.filter((tab) => tab.kind === 'browser')}
        activeBrowserTabId={closable?.kind === 'browser' ? closable.id : null}
        canShowNativeBrowserView={panel.state.isOpen && (hostedSecondary || pane?.isFocused !== false)}
        threadId={ownerId}
        onUpdate={({ tabId, url, title: nextTitle }) => {
          const resolvedTitle = nextTitle && nextTitle.length > 0 ? nextTitle : getBrowserUrlHost(url) || 'Browser';
          panel.patchTab(tabId, { url, title: resolvedTitle });
        }}
        onStopAutomation={(targetId) => {
          void getDesktopBrowserApi()?.stopAutomation?.(targetId);
          const tab = panel.state.tabs.find((row) => row.automationTargetId === targetId);
          if (tab) panel.patchTab(tab.id, { automationTargetId: null });
        }}
      />
    </ThreadSecondaryPanel>
  ) : null;

  usePaneSecondaryPanelRegistration(
    hostedSecondary
      ? {
          contentKey: ownerId,
          isOpen: panel.state.isOpen,
          panel: secondaryPanelNode,
          onToggle: () => {
            if (panel.state.isOpen) panel.close();
            else panel.open();
          }
        }
      : null
  );

  const cataloguePath = projectId
    ? getProjectWorkspaceRoutePath(projectId, 'scheduler')
    : getSchedulerRoutePath();

  return (
    <section
      className={viewClass}
      data-testid="schedule-detail"
      style={panelOpen ? { ['--thread-secondary-width' as string]: `${panel.state.widthPx}px` } : undefined}
    >
      <div className="thread-detail-split">
        <div className="thread-detail-main">
          <header className="thread-detail-header">
            <div className="thread-detail-heading">
              <h1>{title}</h1>
            </div>
            <div className="thread-detail-actions">
              {pane?.onToggleMaximize ? (
                <button
                  type="button"
                  className="icon-btn"
                  title={pane.isMaximized ? 'Restore pane' : 'Maximize pane'}
                  aria-label={pane.isMaximized ? 'Restore pane' : 'Maximize pane'}
                  data-testid="split-pane-maximize"
                  onClick={pane.onToggleMaximize}
                >
                  {pane.isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              ) : null}
              {pane?.onRequestClose ? (
                <button
                  type="button"
                  className="icon-btn"
                  title="Close pane"
                  aria-label="Close pane"
                  data-testid="split-pane-close"
                  onClick={pane.onRequestClose}
                >
                  <X size={14} />
                </button>
              ) : null}
              {!panelOpen ? (
                <button
                  type="button"
                  className="icon-btn"
                  title="Show right panel"
                  aria-label="Show right panel"
                  data-testid="thread-secondary-show"
                  onClick={panel.open}
                >
                  <PanelRight size={14} />
                </button>
              ) : null}
            </div>
          </header>
          <div className="thread-detail-body schedule-editor-body">
            <div className="thread-detail-column">
              <ScheduleEditor
                task={task}
                seed={seed}
                lockedProjectId={projectId}
                readOnly={isExternal}
                onSaved={onSaved}
              />
            </div>
          </div>
        </div>
        {hostedSecondary ? null : secondaryPanelNode}
      </div>
      {confirmDelete && task ? (
        <DeleteConfirmModal
          task={task}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            const id = task.id;
            setConfirmDelete(false);
            const result = await product.scheduler.delete(id);
            if (!result.ok) {
              useUi.getState().pushToast(`Delete failed: ${result.message}`, 'error');
              return;
            }
            navigate(cataloguePath);
          }}
        />
      ) : null}
    </section>
  );
}
