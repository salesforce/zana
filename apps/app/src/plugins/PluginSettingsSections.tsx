import { useSyncExternalStore } from 'react';
import { listSettingsSections, subscribePluginSlots } from './plugin-slots.js';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';

/** Host-owned settings slot mount. Complements a module's settingsPanel. */
export function PluginSettingsSections() {
  const sections = useSyncExternalStore(
    subscribePluginSlots,
    listSettingsSections,
    listSettingsSections
  );
  if (sections.length === 0) return null;
  return (
    <>
      {sections.map((section) => {
        const Component = section.component;
        return (
          <PluginSlotBoundary
            key={`${section.pluginId}:${section.id}:${section.generation}`}
            pluginId={section.pluginId}
            generation={section.generation}
          >
            <Component pluginId={section.pluginId} />
          </PluginSlotBoundary>
        );
      })}
    </>
  );
}
