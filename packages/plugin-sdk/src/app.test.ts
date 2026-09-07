import { describe, expect, it } from 'vitest';
import { definePluginApp, isPluginAppDefinition } from './app.js';
import {
  collectPluginApp,
  PLUGIN_COMPOSER_SCOPE_KINDS,
  threadPanelActionMatchesScope
} from './app-contract.js';
import { shimLegacyExtensionManifest } from './legacy-shim.js';

describe('definePluginApp', () => {
  it('does not recurse when the host runtime points definePluginApp at this function', () => {
    const g = globalThis as { __ZCC_PLUGIN_RUNTIME__?: { definePluginApp: typeof definePluginApp } };
    const previous = g.__ZCC_PLUGIN_RUNTIME__;
    g.__ZCC_PLUGIN_RUNTIME__ = { definePluginApp };
    try {
      const def = definePluginApp((app) => {
        app.slots.navPanel({
          id: 'main',
          title: 'PR Monitor',
          icon: 'GitPullRequest',
          component: () => null
        });
      });
      expect(isPluginAppDefinition(def)).toBe(true);
    } finally {
      g.__ZCC_PLUGIN_RUNTIME__ = previous;
    }
  });

  it('collects v1 slots and stamps generation', () => {
    const def = definePluginApp((app) => {
      app.slots.navPanel({
        id: 'home',
        title: 'Tasks',
        icon: 'ListTodo',
        component: () => null
      });
      app.slots.homepageSection({
        id: 'summary',
        title: 'Open tasks',
        component: () => null
      });
      app.slots.pendingInteraction({
        id: 'confirm',
        component: () => null
      });
    });
    expect(isPluginAppDefinition(def)).toBe(true);
    const set = collectPluginApp('tasks', 3, def);
    expect(set.generation).toBe(3);
    expect(set.navPanels).toHaveLength(1);
    expect(set.navPanels[0]?.pluginId).toBe('tasks');
    expect(set.homepageSections[0]?.id).toBe('summary');
    expect(set.pendingInteractions[0]?.id).toBe('confirm');
  });

  it('throws when callPluginRpc has no host bridge', async () => {
    const { callPluginRpc } = await import('./app.js');
    await expect(callPluginRpc('notes', 'ping')).rejects.toThrow(/plugin host is not available/);
  });

  it('collects provider icons, composer, and content scripts without throwing', () => {
    const def = definePluginApp((app) => {
      app.slots.experimental_providerIcon({
        providerId: 'claude-code',
        icon: () => null
      });
      app.slots.threadPanelAction({
        id: 'board',
        title: 'Tasks',
        component: () => null
      });
      app.slots.messageDirective({
        id: 'task',
        component: () => null
      });
      app.composer.customize({
        id: 'retry',
        actions: [{ id: 'retry-action', component: () => null }]
      });
      app.contentScripts.register({
        id: 'boot',
        mount() {}
      });
    });
    const set = collectPluginApp('provider-claude-code', 1, def);
    expect(set.providerIcons).toHaveLength(1);
    expect(set.providerIcons[0]?.providerId).toBe('claude-code');
    expect(set.threadPanelActions[0]?.id).toBe('board');
    expect(set.threadPanelActions[0]?.scopes).toBeUndefined();
    expect(
      collectPluginApp(
        'tasks',
        1,
        definePluginApp((app) => {
          app.slots.threadPanelAction({
            id: 'live',
            title: 'Live',
            component: () => null,
            scopes: ['thread', 'agent-session']
          });
        })
      ).threadPanelActions[0]?.scopes
    ).toEqual(['thread', 'agent-session']);
    expect(() =>
      collectPluginApp(
        'tasks',
        1,
        definePluginApp((app) => {
          app.slots.threadPanelAction({
            id: 'bad',
            title: 'Bad',
            component: () => null,
            scopes: ['sidebar'] as never
          });
        })
      )
    ).toThrow(/"scopes" must be a non-empty array/);
    expect(set.messageDirectives[0]?.id).toBe('task');
    expect(set.composerCustomizations[0]?.id).toBe('retry');
    expect(set.contentScripts[0]?.id).toBe('boot');
  });

  it('collects composer meta/advanced and accepts the cli-agent scope', () => {
    const def = definePluginApp((app) => {
      app.composer.customize({
        id: 'yolo',
        scopes: ['cli-agent'],
        meta: [{ id: 'yolo-chip', component: () => null }],
        advanced: [{ id: 'extra', component: () => null }]
      });
    });
    const set = collectPluginApp('harness-claude', 1, def);
    expect(set.composerCustomizations[0]?.scopes).toEqual(['cli-agent']);
    expect(set.composerCustomizations[0]?.meta?.[0]?.id).toBe('yolo-chip');
    expect(set.composerCustomizations[0]?.advanced?.[0]?.id).toBe('extra');
    expect(PLUGIN_COMPOSER_SCOPE_KINDS).toContain('cli-agent');
  });

  it('rejects an unknown composer scope', () => {
    expect(() =>
      collectPluginApp(
        'bad',
        1,
        definePluginApp((app) => {
          app.composer.customize({
            id: 'bad-scope',
            scopes: ['sidebar'] as never
          });
        })
      )
    ).toThrow(/invalid scope kind/);
  });

  it('defaults threadPanelAction scopes to thread-only', () => {
    expect(threadPanelActionMatchesScope({}, 'thread')).toBe(true);
    expect(threadPanelActionMatchesScope({}, 'agent-session')).toBe(false);
    expect(threadPanelActionMatchesScope({ scopes: ['agent-session'] }, 'thread')).toBe(false);
    expect(threadPanelActionMatchesScope({ scopes: ['thread', 'agent-session'] }, 'agent-session')).toBe(true);
  });

  it('collects commandPaletteAction and rejects a missing run', () => {
    const def = definePluginApp((app) => {
      app.slots.commandPaletteAction({
        id: 'open',
        title: 'Open PR Monitor',
        run: () => undefined
      });
    });
    const set = collectPluginApp('pr-monitor', 1, def);
    expect(set.commandPaletteActions).toHaveLength(1);
    expect(set.commandPaletteActions[0]?.title).toBe('Open PR Monitor');
    expect(() =>
      collectPluginApp(
        'pr-monitor',
        1,
        definePluginApp((app) => {
          app.slots.commandPaletteAction({
            id: 'open',
            title: 'Broken'
          } as never);
        })
      )
    ).toThrow(/"run" must be a function/);
  });

  it('collects experimental_createProjectAction and rejects a missing run', () => {
    const def = definePluginApp((app) => {
      app.slots.experimental_createProjectAction({
        id: 'dx-project',
        title: 'Salesforce DX project',
        icon: 'Cloud',
        component: () => null,
        run: (ctx) => {
          ctx.openDialog();
        }
      });
    });
    const set = collectPluginApp('salesforce', 1, def);
    expect(set.createProjectActions).toHaveLength(1);
    expect(set.createProjectActions[0]).toMatchObject({
      id: 'dx-project',
      title: 'Salesforce DX project',
      icon: 'Cloud',
      pluginId: 'salesforce'
    });
    expect(typeof set.createProjectActions[0]?.component).toBe('function');
    expect(() =>
      collectPluginApp(
        'salesforce',
        1,
        definePluginApp((app) => {
          app.slots.experimental_createProjectAction({
            id: 'dx-project',
            title: 'Broken'
          } as never);
        })
      )
    ).toThrow(/"run" must be a function/);
    expect(() =>
      collectPluginApp(
        'salesforce',
        1,
        definePluginApp((app) => {
          app.slots.experimental_createProjectAction({
            id: 'dx-project',
            title: 'Broken',
            component: 'not-a-component' as never,
            run: () => undefined
          });
        })
      )
    ).toThrow(/"component" must be a React component function/);
  });

  it('collects projectStatusbarItem and rejects invalid registrations', () => {
    const def = definePluginApp((app) => {
      app.slots.projectStatusbarItem({
        id: 'orgs',
        align: 'right',
        order: 10,
        icon: 'Cloud',
        label: 'prod',
        tooltip: 'Current org',
        component: () => null,
        run: (ctx) => {
          ctx.openMenu([]);
        }
      });
      app.slots.projectStatusbarItem({
        id: 'live',
        align: 'left',
        item: () => null
      });
    });
    const set = collectPluginApp('salesforce', 1, def);
    expect(set.projectStatusbarItems).toHaveLength(2);
    expect(set.projectStatusbarItems[0]).toMatchObject({
      id: 'orgs',
      align: 'right',
      order: 10,
      icon: 'Cloud',
      label: 'prod',
      tooltip: 'Current org',
      pluginId: 'salesforce'
    });
    expect(set.projectStatusbarItems[1]).toMatchObject({ id: 'live', align: 'left' });
    expect(typeof set.projectStatusbarItems[1]?.item).toBe('function');
    expect(
      collectPluginApp(
        'salesforce',
        1,
        definePluginApp((app) => {
          app.slots.projectStatusbarItem({ id: 'plain', label: 'ok' });
        })
      ).projectStatusbarItems[0]?.align
    ).toBe('right');
    expect(() =>
      collectPluginApp(
        'salesforce',
        1,
        definePluginApp((app) => {
          app.slots.projectStatusbarItem({ id: 'missing' } as never);
        })
      )
    ).toThrow(/"label" is required unless "item" is set/);
    expect(() =>
      collectPluginApp(
        'salesforce',
        1,
        definePluginApp((app) => {
          app.slots.projectStatusbarItem({ id: 'bad-align', label: 'x', align: 'center' as never });
        })
      )
    ).toThrow(/"align" must be "left" or "right"/);
    expect(() =>
      collectPluginApp(
        'salesforce',
        1,
        definePluginApp((app) => {
          app.slots.projectStatusbarItem({ id: 'a', label: 'A' });
          app.slots.projectStatusbarItem({ id: 'a', label: 'B' });
        })
      )
    ).toThrow(/duplicate id/);
  });

  it('defaults navPanel path to id and rejects duplicate slot ids', () => {
    const def = definePluginApp((app) => {
      app.slots.navPanel({
        id: 'main',
        title: 'Docs',
        icon: 'Library',
        component: () => null
      });
    });
    const set = collectPluginApp('docs', 1, def);
    expect(set.navPanels[0]?.path).toBe('main');
    expect(() =>
      collectPluginApp(
        'docs',
        2,
        definePluginApp((app) => {
          app.slots.navPanel({
            id: 'main',
            title: 'A',
            icon: 'Box',
            component: () => null
          });
          app.slots.navPanel({
            id: 'main',
            title: 'B',
            icon: 'Box',
            component: () => null
          });
        })
      )
    ).toThrow(/duplicate id/);
  });

  it('collects unlisted navPanels and footer toPluginPanel registrations', () => {
    const def = definePluginApp((app) => {
      app.slots.navPanel({
        id: 'orgs',
        title: 'Salesforce',
        icon: 'Cloud',
        placement: 'unlisted',
        component: () => null
      });
      app.slots.sidebarFooterAction({
        id: 'orgs',
        title: 'Salesforce',
        icon: 'Cloud',
        run: ({ toPluginPanel }) => {
          toPluginPanel('orgs');
        }
      });
    });
    const set = collectPluginApp('salesforce', 1, def);
    expect(set.navPanels[0]?.placement).toBe('unlisted');
    expect(set.sidebarFooterActions[0]?.title).toBe('Salesforce');
  });

  it('rejects unknown navPanel placement', () => {
    expect(() =>
      collectPluginApp(
        'salesforce',
        1,
        definePluginApp((app) => {
          app.slots.navPanel({
            id: 'orgs',
            title: 'Salesforce',
            icon: 'Cloud',
            placement: 'hidden' as 'sidebar',
            component: () => null
          });
        })
      )
    ).toThrow(/unlisted/);
  });
});

describe('shimLegacyExtensionManifest', () => {
  it('projects extension.json into a package.json zcc block', () => {
    const pkg = shimLegacyExtensionManifest(
      {
        id: 'zana',
        version: '0.1.0',
        title: 'Zana',
        icon: 'Ticket',
        entry: { main: 'main.mjs', renderer: 'renderer.js' },
        projectTab: { global: false, label: 'Zana' }
      },
      'zana'
    );
    expect(pkg.name).toBe('zcc-plugin-zana');
    expect(pkg.zcc.server).toBe('main.mjs');
    expect(pkg.zcc.app).toBe('renderer.js');
    expect(pkg.zcc.projectTab?.global).toBe(false);
    expect(pkg.zcc.skills).toEqual([]);
  });

  it('maps extension.json skill paths to BB directory roots and mcpServers to a map', () => {
    const pkg = shimLegacyExtensionManifest(
      {
        id: 'acme',
        title: 'Acme',
        icon: 'Box',
        entry: { renderer: 'renderer.js' },
        skills: [{ path: 'skills/foo/SKILL.md', slug: 'foo' }],
        mcpServers: [
          { name: 'tools', type: 'stdio', command: 'acme-bin', alwaysOn: true }
        ]
      },
      'acme'
    );
    expect(pkg.zcc.skills).toEqual(['skills']);
    expect(pkg.zcc.mcpServers).toEqual({
      tools: { type: 'stdio', command: 'acme-bin', alwaysOn: true }
    });
  });
});
