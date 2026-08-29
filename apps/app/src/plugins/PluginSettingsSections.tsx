import { useSyncExternalStore } from 'react';
import { listSettingsSections, subscribePluginSlots } from './plugin-slots.js';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';

/**
 * Plugin `settingsSection` slot mounts on that plugin's detail page.
 * Slot UIs replace the host `settings.define` form — ExtensionDetail skips
 * PluginDefinedSettings when this component has sections for the plugin.
 */
export function PluginSettingsSections({ pluginId }: { pluginId: string }) {
  const sections = useSyncExternalStore(
    subscribePluginSlots,
    listSettingsSections,
    listSettingsSections
  ).filter((section) => section.pluginId === pluginId);
  if (sections.length === 0) return null;
  return (
    <div data-testid="plugin-settings-sections">
      {sections.map((section) => {
        const Component = section.component;
        return (
          <section
            key={`${section.pluginId}:${section.id}:${section.generation}`}
            className="settings-section"
          >
            {section.description ? (
              <p className="settings-help">{section.description}</p>
            ) : null}
            <PluginSlotBoundary pluginId={section.pluginId} generation={section.generation}>
              <Component pluginId={section.pluginId} />
            </PluginSlotBoundary>
          </section>
        );
      })}
    </div>
  );
}
