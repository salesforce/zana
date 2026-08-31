import { afterEach, describe, expect, it } from 'vitest';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { extensionsHubRedirectForPath, hrefForPluginNavPanel } from './plugin-nav-href.js';
import { clearPluginSlots, interpretPluginApp } from './plugin-slots.js';

afterEach(() => {
  clearPluginSlots('guide');
  clearPluginSlots('tasks');
});

describe('hrefForPluginNavPanel', () => {
  it('routes extensions-placed panels through the Plugins hub', () => {
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
    expect(hrefForPluginNavPanel('guide', 'guide', 'app-shell')).toBe(
      '/extensions/pages/guide/guide/app-shell'
    );
  });

  it('keeps sidebar panels on /plugins', () => {
    interpretPluginApp(
      'tasks',
      definePluginApp((app) => {
        app.slots.navPanel({
          id: 'main',
          title: 'Tasks',
          icon: 'ListTodo',
          path: 'panel',
          component: () => null
        });
      })
    );
    expect(hrefForPluginNavPanel('tasks', 'panel')).toBe('/plugins/tasks/panel');
  });
});

describe('extensionsHubRedirectForPath', () => {
  it('redirects split plugin URLs for hub-placed panels, including subPaths', () => {
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
    expect(extensionsHubRedirectForPath('/plugins/guide/guide')).toBe('/extensions/pages/guide/guide');
    expect(extensionsHubRedirectForPath('/plugins/guide/guide/app-shell')).toBe(
      '/extensions/pages/guide/guide/app-shell'
    );
    expect(extensionsHubRedirectForPath('/plugins/tasks/panel')).toBeNull();
    expect(extensionsHubRedirectForPath('/agents')).toBeNull();
  });
});
