import { describe, expect, it } from 'vitest';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import {
  arrangePluginNavPanels,
  clearPluginSlots,
  interpretPluginApp,
  listHomepageSections,
  listNavPanels,
  listExtensionsHubPanels,
  listSidebarNavPanels,
  listPendingInteractionSlots,
  listCommandPaletteActions,
  listSidebarFooterActions,
  listTimelineRenderers,
  listProjectMenuActions,
  listAgentCardActions,
  listAgentsBoardActions
} from './plugin-slots.js';

describe('plugin slot registry', () => {
  it('replaces wholesale and stamps generation', () => {
    clearPluginSlots('tasks');
    const first = interpretPluginApp(
      'tasks',
      definePluginApp((app) => {
        app.slots.navPanel({ id: 'main', title: 'Tasks', icon: 'ListTodo', component: () => null });
      })
    );
    expect(first.generation).toBe(1);
    expect(listNavPanels()).toHaveLength(1);
    interpretPluginApp(
      'tasks',
      definePluginApp((app) => {
        app.slots.navPanel({ id: 'main', title: 'Tasks', icon: 'ListTodo', component: () => null });
        app.slots.homepageSection({ id: 'open', title: 'Open', component: () => null });
        app.slots.pendingInteraction({ id: 'confirm', component: () => null });
        app.slots.commandPaletteAction({
          id: 'open',
          title: 'Open Tasks',
          run: () => undefined
        });
        app.slots.experimental_timelineRenderer({
          kind: 'tasks/card',
          component: () => null
        });
        app.slots.experimental_projectMenuAction({
          id: 'open-here',
          title: 'Open in Tasks',
          placement: 'project',
          run: () => undefined
        });
        app.slots.experimental_agentCardAction({
          id: 'card',
          title: 'Card',
          run: () => undefined
        });
        app.slots.experimental_agentsBoardAction({
          id: 'board',
          title: 'Board',
          run: () => undefined
        });
      })
    );
    expect(listNavPanels()).toHaveLength(1);
    expect(listHomepageSections()).toHaveLength(1);
    expect(listPendingInteractionSlots()).toHaveLength(1);
    expect(listCommandPaletteActions()).toHaveLength(1);
    expect(listTimelineRenderers()).toHaveLength(1);
    expect(listProjectMenuActions()).toHaveLength(1);
    expect(listAgentCardActions()).toHaveLength(1);
    expect(listAgentsBoardActions()).toHaveLength(1);
    expect(listNavPanels()[0]?.generation).toBe(2);
  });

  it('keeps extensions-hub navPanels off the global sidebar list', () => {
    clearPluginSlots('guide');
    interpretPluginApp(
      'guide',
      definePluginApp((app) => {
        app.slots.navPanel({
          id: 'guide',
          title: 'Guide',
          icon: 'Puzzle',
          path: 'guide',
          placement: 'extensions',
          component: () => null
        });
      })
    );
    expect(listNavPanels().some((panel) => panel.pluginId === 'guide')).toBe(true);
    expect(listSidebarNavPanels().some((panel) => panel.pluginId === 'guide')).toBe(false);
    expect(listExtensionsHubPanels()).toEqual(
      expect.arrayContaining([expect.objectContaining({ pluginId: 'guide', placement: 'extensions' })])
    );
    // useSyncExternalStore identity: a fresh .filter() every call loops React.
    expect(listSidebarNavPanels()).toBe(listSidebarNavPanels());
    expect(listExtensionsHubPanels()).toBe(listExtensionsHubPanels());
    clearPluginSlots('guide');
  });

  it('appends never-ordered panels and keeps stored slots', () => {
    const panels = [
      { id: 'a', pluginId: 'p', title: 'A', icon: 'Box', component: () => null, generation: 1 },
      { id: 'b', pluginId: 'p', title: 'B', icon: 'Box', component: () => null, generation: 1 }
    ];
    const arranged = arrangePluginNavPanels(panels, ['p/b', 'missing'], new Set(['p/b']));
    expect(arranged.visible.map((p) => p.id)).toEqual(['a']);
    expect(arranged.hidden.map((p) => p.id)).toEqual(['b']);
    expect(arranged.normalizedOrder).toEqual(['p/b', 'missing', 'p/a']);
  });

  it('keeps slot snapshots referentially stable until registrations change', () => {
    clearPluginSlots('stable');
    const emptyHomepage = listHomepageSections();
    const emptyFooter = listSidebarFooterActions();
    expect(listHomepageSections()).toBe(emptyHomepage);
    expect(listSidebarFooterActions()).toBe(emptyFooter);

    interpretPluginApp(
      'stable',
      definePluginApp((app) => {
        app.slots.homepageSection({ id: 'home', title: 'Home', component: () => null });
      })
    );

    const homepage = listHomepageSections();
    expect(homepage).not.toBe(emptyHomepage);
    expect(listHomepageSections()).toBe(homepage);
  });

  it('clears slots without publishing a new snapshot when nothing was registered', () => {
    clearPluginSlots('absent');
    const before = listHomepageSections();

    clearPluginSlots('absent');

    expect(listHomepageSections()).toBe(before);
  });
});
