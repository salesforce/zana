import { useSyncExternalStore } from 'react';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
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
  layout
}: {
  moduleId: string;
  projectId: string | null;
  threadId?: string;
  actionId?: string;
  params?: JsonValue | null;
  layout?: 'padded' | 'flush';
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
              threadId={threadId ?? ''}
              params={params ?? null}
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
