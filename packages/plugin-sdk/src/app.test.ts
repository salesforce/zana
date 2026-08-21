import { describe, expect, it } from 'vitest';
import { definePluginApp, isPluginAppDefinition } from './app.js';
import { collectPluginApp } from './app-contract.js';
import { shimLegacyExtensionManifest } from './legacy-shim.js';

describe('definePluginApp', () => {
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
    });
    expect(isPluginAppDefinition(def)).toBe(true);
    const set = collectPluginApp('tasks', 3, def);
    expect(set.generation).toBe(3);
    expect(set.navPanels).toHaveLength(1);
    expect(set.navPanels[0]?.pluginId).toBe('tasks');
    expect(set.homepageSections[0]?.id).toBe('summary');
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
