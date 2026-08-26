import { useSyncExternalStore, type ReactNode } from 'react';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import { listThreadLists, subscribePluginSlots } from './plugin-slots.js';
import { resolveActiveThreadList } from './plugin-slot-resolvers.js';

export function PluginExclusiveThreadList({
  activeThreadId,
  activeProjectId,
  searchQuery = '',
  children
}: {
  activeThreadId: string | null;
  activeProjectId: string | null;
  searchQuery?: string;
  children: ReactNode;
}) {
  const registrations = useSyncExternalStore(subscribePluginSlots, listThreadLists, listThreadLists);
  const exclusive = resolveActiveThreadList(registrations);
  if (!exclusive) return <>{children}</>;
  const Component = exclusive.component;
  const Original = () => <>{children}</>;
  return (
    <PluginSlotBoundary pluginId={exclusive.pluginId} generation={exclusive.generation}>
      <Component
        pluginId={exclusive.pluginId}
        activeThreadId={activeThreadId}
        activeProjectId={activeProjectId}
        isCompactViewport={false}
        onNavigate={() => undefined}
        searchQuery={searchQuery}
        experimental_Original={Original}
      />
    </PluginSlotBoundary>
  );
}
