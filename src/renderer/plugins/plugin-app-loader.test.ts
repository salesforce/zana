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
          icon: 'ListTodo',
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
      [{ id: 'tasks', name: 'Tasks', icon: 'ListTodo', status: 'running', appUrl: '/plugins/tasks/assets/app.js?v=1' }],
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

    await reconcilePluginApps([{ id: 'tasks', name: 'Tasks', icon: 'ListTodo', status: 'disabled', appUrl: null }]);

    expect(usePluginAppModules.getState().modules).toEqual([]);
    expect(listNavPanels().some((panel) => panel.pluginId === 'tasks')).toBe(false);
  });

  it('surfaces an import failure without leaving stale slot registrations', async () => {
    await reconcilePluginApps(
      [{ id: 'broken', name: 'Broken', icon: 'Bug', status: 'running', appUrl: '/plugins/broken/assets/app.js?v=1' }],
      { importer: async () => { throw new Error('bundle exploded'); } }
    );

    expect(usePluginAppModules.getState().modules[0]).toMatchObject({ id: 'broken', loadError: 'bundle exploded' });
    expect(listNavPanels().some((panel) => panel.pluginId === 'broken')).toBe(false);
  });
});
