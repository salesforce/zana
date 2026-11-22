import { useSyncExternalStore } from 'react';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import { listThreadHeaderActions, listThreadPanelActions, subscribePluginSlots } from './plugin-slots.js';

export function PluginThreadHeaderActions({
  threadId,
  projectId
}: {
  threadId: string;
  projectId: string | null;
}) {
  const actions = useSyncExternalStore(
    subscribePluginSlots,
    listThreadHeaderActions,
    listThreadHeaderActions
  );
  if (actions.length === 0) return null;
  return (
    <div className="plugin-thread-header-actions" data-testid="plugin-thread-header-actions">
      {actions.map((action) => {
        const Component = action.component;
        return (
          <PluginSlotBoundary
            key={`${action.pluginId}/${action.id}:${action.generation}`}
            pluginId={action.pluginId}
            generation={action.generation}
          >
            <Component
              pluginId={action.pluginId}
              threadId={threadId}
              projectId={projectId ?? ''}
              isCompactViewport={false}
            />
          </PluginSlotBoundary>
        );
      })}
    </div>
  );
}

export function PluginOwnedThreadTitle({ threadId, title, owner, onOpen }: {
  threadId: string;
  title: string;
  owner: string;
  onOpen(pluginId: string, actionId: string): void;
}) {
  const actions = useSyncExternalStore(subscribePluginSlots, listThreadPanelActions, listThreadPanelActions);
  const action = actions.find(row => row.pluginId === owner && row.experimental_ownedThreadTitle);
  const Title = action?.experimental_ownedThreadTitle;
  if (!action || !Title) return <>{title}</>;
  return <PluginSlotBoundary key={`${owner}/${action.id}:${action.generation}:${threadId}`}
    pluginId={owner} generation={action.generation} fallback={title}>
    <Title threadId={threadId} title={title} openPanel={() => onOpen(owner, action.id)} />
  </PluginSlotBoundary>;
}
