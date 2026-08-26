import { useSyncExternalStore } from 'react';
import { AuroraGrid } from '@/components/AuroraGrid';
import { HomeAgentComposer } from '@/components/HomeAgentComposer';
import { PluginNewThreadActions } from '@/plugins/PluginNewThreadActions';
import { listHomepageSections, subscribePluginSlots } from '@/plugins/plugin-slots';
import { PluginSlotBoundary } from '@/plugins/PluginSlotBoundary';

/**
 * New Chat compose surface at `/`. ListPane returns null for `nav === 'home'`,
 * so this panel spans the remaining shell track. Submit already opens
 * `/threads/:id`. Plugin CTAs and homepage sections sit under the prompt.
 * AuroraGrid fills the pane behind the composer (same host as Plugins).
 */
export function HomeView() {
  const pluginHomepage = useSyncExternalStore(
    subscribePluginSlots,
    listHomepageSections,
    listHomepageSections
  );

  return (
    <div className="settings-panel home-panel aurora-host">
      <AuroraGrid />
      <div className="settings-inner">
        <HomeAgentComposer allowLegacyAgent />
        <PluginNewThreadActions projectId={null} />
        {pluginHomepage.length > 0 && (
          <div className="home-plugin-sections">
            {pluginHomepage.map((section) => {
              const Section = section.component;
              return (
                <PluginSlotBoundary
                  key={`${section.id}:${section.generation}`}
                  pluginId={section.id}
                  generation={section.generation}
                >
                  <section className="home-plugin-section">
                    <h3>{section.title}</h3>
                    <Section pluginId={section.id} projectId={null} />
                  </section>
                </PluginSlotBoundary>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export { HomeView as HomePanel };
