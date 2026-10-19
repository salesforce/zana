import { useSyncExternalStore } from 'react';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import { threadPanelActionMatchesScope, type PluginThreadPanelPage, type PluginThreadPanelScope } from '@zana-ai/zcc-plugin-sdk';
import { ProjectExtensionTab } from '../../../views/project/ProjectExtensionTab.js';
import { useData } from '../../../store.js';
import { PluginSlotBoundary } from '../../../plugins/PluginSlotBoundary.js';
import {
  listNewThreadPanelActions,
  listThreadPanelActions,
  subscribePluginSlots
} from '../../../plugins/plugin-slots.js';

export function ThreadPluginTab({
  moduleId,
  projectId,
  threadId,
  actionId,
  params,
  layout,
  surface,
  page,
  tabId
}: {
  moduleId: string;
  projectId: string | null;
  threadId?: string;
  actionId?: string;
  params?: JsonValue | null;
  layout?: 'padded' | 'flush';
  /** Which side panel shows the tab; forwarded to the plugin's component. */
  surface?: PluginThreadPanelScope;
  /** With `surface="plugin-page"`: the page beside the panel. */
  page?: PluginThreadPanelPage;
  /** The side-panel tab showing the component; forwarded to it. */
  tabId?: string;
}) {
  const project = useData((s) => s.projects.find((row) => row.id === projectId) ?? null);
  const threadActions = useSyncExternalStore(
    subscribePluginSlots,
    listThreadPanelActions,
    listThreadPanelActions
  );
  const newThreadActions = useSyncExternalStore(
    subscribePluginSlots,
    listNewThreadPanelActions,
    listNewThreadPanelActions
  );
  const threadAction = actionId
    ? threadActions.find((row) => row.pluginId === moduleId && row.id === actionId)
    : undefined;
  const composeAction = actionId
    ? newThreadActions.find((row) => row.pluginId === moduleId && row.id === actionId)
    : undefined;
  const action = threadAction ?? composeAction;
  // A stored or by-id tab whose tool does not open here (a plugin page's own tool in a thread).
  if (threadAction && surface && !threadPanelActionMatchesScope(threadAction, surface, page)) {
    return <p className="thread-detail-empty" data-testid="thread-plugin-tab-unavailable">{threadAction.title} is not available in this panel.</p>;
  }

  if (threadAction || composeAction) {
    const action = threadAction ?? composeAction!;
    const ThreadPanel = threadAction?.component;
    const ComposePanel = composeAction?.component;
    const padded = (layout ?? action.layout) !== 'flush';
    return (
      <div
        className={`thread-plugin-tab${padded ? ' is-padded' : ' is-flush'}`}
        data-testid="thread-plugin-tab"
        data-layout={padded ? 'padded' : 'flush'}
      >
        <PluginSlotBoundary pluginId={action.pluginId} generation={action.generation}>
          {ThreadPanel ? (
            <ThreadPanel
              pluginId={action.pluginId}
              projectId={projectId ?? undefined}
              threadId={threadId ?? ''}
              params={params ?? null}
              {...(surface ? { surface } : {})}
              {...(tabId ? { tabId } : {})}
            />
          ) : ComposePanel ? (
            <ComposePanel
              pluginId={action.pluginId}
              projectId={projectId}
              params={params ?? null}
            />
          ) : null}
        </PluginSlotBoundary>
      </div>
    );
  }

  if (!project) {
    return <p className="thread-detail-empty">Project is unavailable for this panel.</p>;
  }
  return (
    <div className="thread-plugin-tab" data-testid="thread-plugin-tab">
      <ProjectExtensionTab moduleId={moduleId} project={project} />
    </div>
  );
}
