import { describe, expect, it } from 'vitest';
import {
  normalizeSkillsRootPaths,
  readPluginManifest,
  DEFAULT_PLUGIN_SKILLS_ROOT
} from './plugin-manifest.js';

function baseZcc(over: Record<string, unknown> = {}) {
  return {
    name: 'tasks',
    version: '0.1.0',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: {
      name: 'Tasks',
      description: 'Track work.',
      branding: { icon: 'ListTodo' },
      server: './server.ts',
      app: './app.tsx',
      ...over
    }
  };
}

describe('readPluginManifest', () => {
  it('derives id and entry paths from package.json', () => {
    const manifest = readPluginManifest({
      ...baseZcc({ projectTab: { label: 'Tasks', global: false } })
    });
    expect(manifest.id).toBe('tasks');
    expect(manifest.serverEntry).toBe('./server.ts');
    expect(manifest.appEntry).toBe('./app.tsx');
    expect(manifest.projectTab?.global).toBe(false);
  });

  it('defaults skills roots to ["skills"] when omitted', () => {
    const manifest = readPluginManifest(baseZcc());
    expect(manifest.skillsRootPaths).toEqual([DEFAULT_PLUGIN_SKILLS_ROOT]);
    expect(manifest.skillNames).toEqual([]);
    expect(manifest.mcpServers).toEqual([]);
    expect(manifest.extra).toEqual({});
  });

  it('treats an empty skills array as opt-out', () => {
    const manifest = readPluginManifest(baseZcc({ skills: [] }));
    expect(manifest.skillsRootPaths).toEqual([]);
  });

  it('strips a trailing /* from a skills root', () => {
    expect(normalizeSkillsRootPaths(['skills/*'])).toEqual(['skills']);
    const manifest = readPluginManifest(baseZcc({ skills: ['skills/*'] }));
    expect(manifest.skillsRootPaths).toEqual(['skills']);
  });

  it('parses mcpServers map and extra bag', () => {
    const manifest = readPluginManifest(
      baseZcc({
        skills: ['skills'],
        mcpServers: {
          library: {
            type: 'stdio',
            command: 'node',
            args: ['./dist/mcp-server.mjs'],
            alwaysOn: true
          }
        },
        extra: { notes: 'Host MCP library_search lives on the route, not here.' }
      })
    );
    expect(manifest.mcpServers).toEqual([
      {
        name: 'library',
        type: 'stdio',
        command: 'node',
        args: ['./dist/mcp-server.mjs'],
        alwaysOn: true
      }
    ]);
    expect(manifest.extra).toEqual({
      notes: 'Host MCP library_search lives on the route, not here.'
    });
  });

  it('rejects a zcc block with neither server nor app', () => {
    expect(() =>
      readPluginManifest({
        name: 'empty',
        version: '1.0.0',
        zcc: { name: 'Empty', description: 'x', branding: { icon: 'Box' } }
      })
    ).toThrow(/server or zcc.app/);
  });

  it('rejects an unknown key outside extra', () => {
    expect(() => readPluginManifest(baseZcc({ foo: 'bar' }))).toThrow();
  });

  it('rejects a path-looking stdio command', () => {
    expect(() =>
      readPluginManifest(
        baseZcc({
          mcpServers: {
            evil: { type: 'stdio', command: '../../usr/bin/curl' }
          }
        })
      )
    ).toThrow(/basename/);
  });

  it('rejects a non-stdio server without url', () => {
    expect(() =>
      readPluginManifest(
        baseZcc({
          mcpServers: {
            remote: { type: 'streamable-http' }
          }
        })
      )
    ).toThrow(/url/);
  });

  it('rejects extra with too many keys', () => {
    const extra: Record<string, string> = {};
    for (let i = 0; i < 33; i += 1) extra[`k${i}`] = 'x';
    expect(() => readPluginManifest(baseZcc({ extra }))).toThrow(/at most 32/);
  });

  it('parses zcc.themes', () => {
    const manifest = readPluginManifest(
      baseZcc({
        themes: [{ id: 'dim', name: 'Dim', css: './themes/dim.css' }]
      })
    );
    expect(manifest.themes).toEqual([{ id: 'dim', name: 'Dim', css: './themes/dim.css' }]);
  });
});
