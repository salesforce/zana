import { useSyncExternalStore } from 'react';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import { listThreadHeaderActions, subscribePluginSlots } from './plugin-slots.js';

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
