import { useState, useSyncExternalStore } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { AuroraGrid } from '@/components/AuroraGrid';
import { HomeAgentComposer } from '@/components/HomeAgentComposer';
import { HomeLauncherTips } from '@/components/HomeLauncherTips';
import { ConversationWelcome } from '@/components/ConversationWelcome';
import { PluginNewThreadActions } from '@/plugins/PluginNewThreadActions';
import { listHomepageSections, subscribePluginSlots } from '@/plugins/plugin-slots';
import { PluginSlotBoundary } from '@/plugins/PluginSlotBoundary';
import { composePromptSeedFrom } from '@/lib/compose-prompt-seed';
import { useBasicUi } from '@/lib/basic-ui';
import { HomeWidgets, loadHomeWidgets } from './widgets/HomeWidgets.js';
import { pluginSource } from './widgets/WidgetContent.js';
import '../../components/basic/basic-conversation.css';

/**
 * New Chat compose surface at `/`. ListPane returns null for `nav === 'home'`,
 * so this panel spans the remaining shell track. Submit already opens
 * `/threads/:id`. Plugin CTAs and homepage sections sit under the prompt.
 * Advanced shows the ambient background behind the composer.
 */
export function HomeView() {
  const basic = useBasicUi();
  const [widgets, setWidgets] = useState(loadHomeWidgets);
  const location = useLocation();
  const [search] = useSearchParams();
  const seed = composePromptSeedFrom({ searchParams: search, state: location.state });
  const pluginHomepage = useSyncExternalStore(
    subscribePluginSlots,
    listHomepageSections,
    listHomepageSections
  );

  const pinnedSources = new Set(widgets.map(widget => widget.source));

  return (
    <div className="settings-panel home-panel aurora-host">
      {!basic && <AuroraGrid />}
      <div className="settings-inner">
        {basic && <ConversationWelcome heading="h1" />}
        <HomeLauncherTips>
          <HomeAgentComposer
            allowLegacyAgent
            initialText={seed.initialText}
            autoFocus={seed.focusPrompt}
          />
          <div hidden={basic} inert={basic || undefined}>
            <PluginNewThreadActions projectId={null} />
          </div>
        </HomeLauncherTips>
        {basic && <HomeWidgets plugins={pluginHomepage} widgets={widgets} onChange={setWidgets} />}
        {pluginHomepage.length > 0 && (
          <div className="home-plugin-sections" hidden={basic} inert={basic || undefined}>
            {pluginHomepage.map((section) => {
              if (basic && pinnedSources.has(pluginSource(section))) return null;
              const Section = section.component;
              return (
                <PluginSlotBoundary
                  key={`${section.pluginId}:${section.id}:${section.generation}`}
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
