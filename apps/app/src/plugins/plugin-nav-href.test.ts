import { afterEach, describe, expect, it } from 'vitest';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { extensionsHubRedirectForPath, hrefForPluginNavPanel, hrefForPluginProjectTab, projectMenuNavigateContext, createProjectActionContext } from './plugin-nav-href.js';
import { clearPluginSlots, interpretPluginApp, listProjectTabs } from './plugin-slots.js';

afterEach(() => {
  clearPluginSlots('guide');
  clearPluginSlots('tasks');
  clearPluginSlots('salesforce');
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

describe('hrefForPluginProjectTab', () => {
  it('routes a second project tab through pluginId:tabId', () => {
    interpretPluginApp(
      'salesforce',
      definePluginApp((app) => {
        app.slots.projectTab({ id: 'salesforce', label: 'Salesforce', icon: 'Cloud', component: () => null });
        app.slots.projectTab({ id: 'soql', label: 'SOQL', icon: 'Database', component: () => null });
      })
    );
    expect(hrefForPluginProjectTab('salesforce', 'proj-1', 'salesforce')).toBe('/projects/proj-1/salesforce');
    expect(hrefForPluginProjectTab('salesforce', 'proj-1', 'soql')).toBe(
      '/projects/proj-1/salesforce%3Asoql'
    );
    expect(listProjectTabs()).toHaveLength(2);
    const navigated: string[] = [];
    const ctx = projectMenuNavigateContext('salesforce', 'proj-1', (to) => {
      navigated.push(to);
    });
    ctx.toProject('proj-1', { tabId: 'soql' });
    expect(navigated).toEqual(['/projects/proj-1/salesforce%3Asoql']);
    clearPluginSlots('salesforce');
  });
});

describe('createProjectActionContext', () => {
  it('opens a project tab through toProject', () => {
    interpretPluginApp(
      'salesforce',
      definePluginApp((app) => {
        app.slots.projectTab({ id: 'salesforce', label: 'Salesforce', icon: 'Cloud', component: () => null });
      })
    );
    const navigated: string[] = [];
    const ctx = createProjectActionContext('salesforce', {
      pickDirectory: async () => '/tmp',
      addProject: async () => ({ id: 'proj-1' }),
      cloneRoot: async () => '/workspace',
      navigate: (to) => {
        navigated.push(to);
      },
      openDialog: () => true
    });
    ctx.toProject('proj-1', { tabId: 'salesforce' });
    expect(navigated).toEqual(['/projects/proj-1/salesforce']);
    clearPluginSlots('salesforce');
  });
});

