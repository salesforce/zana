import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { PluginComposerScope } from '@zana-ai/zcc-plugin-sdk/app';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import {
  listComposerCustomizations,
  subscribePluginSlots
} from './plugin-slots.js';
import {
  composerContributionKey,
  composerCustomizationApplies
} from './plugin-slot-resolvers.js';

type ComposerRegion = 'meta' | 'advanced';

function PluginComposerRegion({
  scope,
  region,
  className
}: {
  scope: PluginComposerScope;
  region: ComposerRegion;
  className?: string;
}): ReactNode {
  const customizations = useSyncExternalStore(
    subscribePluginSlots,
    listComposerCustomizations,
    listComposerCustomizations
  );
  const items = useMemo(
    () => customizations.flatMap((row) => {
      if (!composerCustomizationApplies(row, scope.kind)) return [];
      return (row[region] ?? []).map((entry) => {
        const Component = entry.component;
        return (
          <PluginSlotBoundary
            key={composerContributionKey(row.pluginId, row.generation, row.id, entry.id)}
            pluginId={row.pluginId}
            generation={row.generation}
          >
            <Component />
          </PluginSlotBoundary>
        );
      });
    }),
    [customizations, region, scope.kind]
  );
  if (items.length === 0) return null;
  return <div className={className}>{items}</div>;
}

export function PluginComposerMeta({
  scope
}: {
  scope: PluginComposerScope;
}): ReactNode {
  return (
    <PluginComposerRegion
      scope={scope}
      region="meta"
      className="plugin-composer-meta"
    />
  );
}

export function PluginComposerAdvanced({
  scope
}: {
  scope: PluginComposerScope;
}): ReactNode {
  return (
    <PluginComposerRegion
      scope={scope}
      region="advanced"
      className="plugin-composer-advanced"
    />
  );
}
