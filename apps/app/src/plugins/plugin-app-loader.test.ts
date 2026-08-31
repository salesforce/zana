import { afterEach, describe, expect, it } from 'vitest';
import { listHomepageSections, listNavPanels, listPendingInteractionSlots } from './plugin-slots.js';
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
    expect(usePluginAppModules.getState().modules[0]?.panel).toBeUndefined();
    expect(listNavPanels().some((panel) => panel.pluginId === 'broken')).toBe(false);
  });

  it('does not activate a leftover extension.json RendererEntry as a plugin app', async () => {
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
            activate: () => ({ panel: Panel, settingsPanel: Panel })
          }
        })
      }
    );

    expect(usePluginAppModules.getState().modules).toEqual([]);
    expect(listNavPanels().some((panel) => panel.pluginId === 'gus')).toBe(false);
  });

  it('does not treat a leftover activate() as a failed plugin-app import', async () => {
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

    expect(usePluginAppModules.getState().modules).toEqual([]);
    expect(usePluginAppModules.getState().modules.some((module) => module.loadError)).toBe(false);
  });

  it('does not create a nav module for a slot-only plugin app', async () => {
    await reconcilePluginApps(
      [{
        id: 'ask-user-question',
        name: 'Ask user question',
        description: '',
        icon: 'CircleHelp',
        enabled: true,
        provenance: 'builtin',
        status: 'running',
        appUrl: '/plugins/ask-user-question/assets/app.js?v=1'
      }],
      {
        importer: async () => ({
          default: {
            __zccPluginApp: true,
            setup(app: { slots: { pendingInteraction(registration: object): void } }) {
              app.slots.pendingInteraction({ id: 'ask-user-question', component: () => null });
            }
          }
        })
      }
    );

    expect(usePluginAppModules.getState().modules).toEqual([]);
    expect(listNavPanels()).toEqual([]);
    expect(listPendingInteractionSlots().map((slot) => slot.pluginId)).toEqual(['ask-user-question']);
  });

  it('does not re-import a plugin whose appUrl is unchanged', async () => {
    const urls: string[] = [];
    const importer = async (url: string) => {
      urls.push(url);
      return {
        default: {
          __zccPluginApp: true,
          setup(app: { slots: { navPanel(registration: object): void } }) {
            app.slots.navPanel({ id: 'main', title: 'Tasks', icon: 'ListTodo', component: () => null });
          }
        }
      };
    };
    const entry = {
      id: 'tasks',
      name: 'Tasks',
      description: '',
      icon: 'ListTodo',
      enabled: true,
      provenance: 'builtin' as const,
      status: 'running' as const,
      appUrl: '/plugins/tasks/assets/app.js?v=1'
    };
    await reconcilePluginApps([entry], { importer });
    await reconcilePluginApps([{ ...entry }], { importer });
    expect(urls).toEqual(['/plugins/tasks/assets/app.js?v=1']);
    await reconcilePluginApps([{ ...entry, appUrl: '/plugins/tasks/assets/app.js?v=2' }], { importer });
    expect(urls).toEqual(['/plugins/tasks/assets/app.js?v=1', '/plugins/tasks/assets/app.js?v=2']);
  });
});
