import { useSyncExternalStore, type ComponentType } from 'react';
import { Bot } from 'lucide-react';
import { PluginSlotBoundary } from '../../../plugins/PluginSlotBoundary.js';
import { listProviderIcons, subscribePluginSlots } from '../../../plugins/plugin-slots.js';
import { resolveProviderIcon } from '../../../plugins/plugin-slot-resolvers.js';
import { providerIconForId } from './provider-icon.js';

export function ProviderIcon({
  providerId,
  size = 13,
  className
}: {
  providerId: string;
  size?: number;
  className?: string;
}) {
  const registrations = useSyncExternalStore(
    subscribePluginSlots,
    listProviderIcons,
    listProviderIcons
  );
  const plugin = resolveProviderIcon(providerId, registrations);
  if (plugin) {
    const Icon = plugin.icon as ComponentType<{ className?: string; size?: number }>;
    return (
      <PluginSlotBoundary pluginId={plugin.pluginId} generation={plugin.generation}>
        <Icon className={className} size={size} />
      </PluginSlotBoundary>
    );
  }
  const Fallback = providerIconForId(providerId);
  if (Fallback) return <Fallback size={size} className={className} />;
  return <Bot size={size} className={className} aria-hidden="true" />;
}
