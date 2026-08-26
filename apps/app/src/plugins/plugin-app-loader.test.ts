import { afterEach, describe, expect, it } from 'vitest';
import { listHomepageSections, listNavPanels } from './plugin-slots.js';
import { reconcilePluginApps, usePluginAppModules } from './plugin-app-loader.js';

afterEach(async () => {
  await reconcilePluginApps([]);
});

describe('server plugin app loader', () => {
  it('registers a running app and exposes its nav module', async () => {
    await reconcilePluginApps(
      [
        {
          id: 'tasks',
          name: 'Tasks',
          description: 'Track work items',
          icon: 'ListTodo',
          enabled: true,
          provenance: 'builtin',
          status: 'running',
          appUrl: '/plugins/tasks/assets/dist/app.js?v=1'
        }
      ],
      {
        importer: async () => ({
          default: {
            __zccPluginApp: true,
            setup(app: { slots: { navPanel(registration: object): void; homepageSection(registration: object): void } }) {
              app.slots.navPanel({ id: 'main', title: 'Tasks', icon: 'ListTodo', component: () => null });
              app.slots.homepageSection({ id: 'summary', title: 'Summary', component: () => null });
            }
          }
        })
      }
    );

    expect(usePluginAppModules.getState().modules.map((module) => module.id)).toEqual(['tasks']);
    expect(listNavPanels().map((panel) => panel.pluginId)).toContain('tasks');
    expect(listHomepageSections().map((section) => section.pluginId)).toContain('tasks');
  });

  it('clears prior slots when a plugin stops running', async () => {
    await reconcilePluginApps(
      [{ id: 'tasks', name: 'Tasks', description: '', icon: 'ListTodo', enabled: true, provenance: 'builtin', status: 'running', appUrl: '/plugins/tasks/assets/app.js?v=1' }],
      {
        importer: async () => ({
          default: {
            __zccPluginApp: true,
            setup(app: { slots: { navPanel(registration: object): void } }) {
              app.slots.navPanel({ id: 'main', title: 'Tasks', icon: 'ListTodo', component: () => null });
            }
          }
        })
      }
    );

    await reconcilePluginApps([{ id: 'tasks', name: 'Tasks', description: '', icon: 'ListTodo', enabled: false, provenance: 'builtin', status: 'disabled', appUrl: null }]);

    expect(usePluginAppModules.getState().modules).toEqual([]);
    expect(listNavPanels().some((panel) => panel.pluginId === 'tasks')).toBe(false);
  });

  it('surfaces an import failure without leaving stale slot registrations', async () => {
    await reconcilePluginApps(
      [{ id: 'broken', name: 'Broken', description: '', icon: 'Bug', enabled: true, provenance: 'direct', status: 'running', appUrl: '/plugins/broken/assets/app.js?v=1' }],
      { importer: async () => { throw new Error('bundle exploded'); } }
    );

    expect(usePluginAppModules.getState().modules[0]).toMatchObject({ id: 'broken', loadError: 'bundle exploded' });
    expect(listNavPanels().some((panel) => panel.pluginId === 'broken')).toBe(false);
  });

  it('activates a legacy RendererEntry bundle instead of treating it as a missing plugin app', async () => {
    const Panel = () => null;
    await reconcilePluginApps(
      [{
        id: 'gus',
        name: 'GUS',
        description: 'GUS',
        icon: 'Ticket',
        enabled: true,
        provenance: 'direct',
        status: 'running',
        appUrl: '/plugins/gus/assets/renderer.js?v=1'
      }],
      {
        importer: async () => ({
          default: {
            activate: () => ({ panel: Panel })
          }
        })
      }
    );

    const loaded = usePluginAppModules.getState().modules[0];
    expect(loaded.id).toBe('gus');
    expect(loaded.title).toBe('GUS');
    expect(loaded.loadError).toBeUndefined();
    expect(loaded.panel).toBe(Panel);
    expect(listNavPanels().some((panel) => panel.pluginId === 'gus')).toBe(false);
  });

  it('surfaces a legacy activate() that contributes nothing', async () => {
    await reconcilePluginApps(
      [{
        id: 'empty',
        name: 'Empty',
        description: '',
        icon: 'Puzzle',
        enabled: true,
        provenance: 'direct',
        status: 'running',
        appUrl: '/plugins/empty/assets/renderer.js?v=1'
      }],
      {
        importer: async () => ({
          default: { activate: () => ({}) }
        })
      }
    );

    expect(usePluginAppModules.getState().modules[0]).toMatchObject({
      id: 'empty',
      loadError: 'activate() returned nothing usable (no panel, settingsPanel, commands, or navBadge).'
    });
  });
});
