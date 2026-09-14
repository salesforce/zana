import { useSyncExternalStore } from 'react';
import { listSettingsSections, subscribePluginSlots } from './plugin-slots.js';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';

/**
 * Plugin `settingsSection` slot mounts on that plugin's hub Configure page
 * alongside the host `settings.define` form.
 */
export function PluginSettingsSections({ pluginId }: { pluginId: string }) {
  const sections = useSyncExternalStore(
    subscribePluginSlots,
    listSettingsSections,
    listSettingsSections
  ).filter((section) => section.pluginId === pluginId);
  if (sections.length === 0) return null;
  return (
    <div className="plugin-settings-sections" data-testid="plugin-settings-sections">
      {sections.map((section) => {
        const Component = section.component;
        return (
          <div
            key={`${section.pluginId}:${section.id}:${section.generation}`}
            className="ext-plugin-settings-panel"
          >
            {section.title ? <h4 className="plugin-setting-label">{section.title}</h4> : null}
            {section.description ? (
              <p className="plugin-setting-desc">{section.description}</p>
            ) : null}
            <PluginSlotBoundary pluginId={section.pluginId} generation={section.generation}>
              <Component pluginId={section.pluginId} />
            </PluginSlotBoundary>
          </div>
        );
      })}
    </div>
  );
}
