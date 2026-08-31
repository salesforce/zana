import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLUGIN_PANEL_PATH,
  getAgentsRoutePath,
  getExtensionsHubPageRoutePath,
  getExtensionsTabRoutePath,
  getFollowUpsRoutePath,
  getGoalsRoutePath,
  getInboxRoutePath,
  getLocationRoutePath,
  getMcpRoutePath,
  getNavRoutePath,
  getNewThreadRoutePath,
  getPluginBrowseRoutePath,
  getPluginDetailRoutePath,
  getPluginPanelRoutePath,
  getPluginsRoutePath,
  getProjectRoutePath,
  getProjectSettingsRoutePath,
  getProjectWorkspaceRoutePath,
  getRootRoutePath,
  getSchedulerRoutePath,
  getSettingsRoutePath,
  getSettingsTabRoutePath,
  getSkillsRoutePath,
  getSuggestionsRoutePath,
  getThreadRoutePath,
  isExtensionsRoutePath,
  isProjectRoutePath,
  isRoutePath,
  isSettingsRoutePath,
  projectIdFromThreadPath,
  resolveRouteHref,
  threadIdFromPath,
  TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  TOOLS_SKILLS_ROUTE_PATH
} from '../route-paths.js';

describe('route path helpers', () => {
  it('builds encoded settings, project, and plugin URLs', () => {
    expect(getSettingsRoutePath()).toBe('/settings');
    expect(getSettingsRoutePath('global')).toBe('/settings/global');
    expect(getSettingsRoutePath('global', 'appearance')).toBe('/settings/global#appearance');
    expect(getProjectRoutePath('proj/1')).toBe('/projects/proj%2F1');
    expect(getProjectSettingsRoutePath('proj 1')).toBe('/projects/proj%201/settings');
    expect(getProjectWorkspaceRoutePath('p1', 'agents')).toBe('/projects/p1');
    expect(getProjectWorkspaceRoutePath('p1', 'terminals')).toBe('/projects/p1/terminals');
    expect(getPluginDetailRoutePath('github')).toBe('/extensions/plugins/github');
    expect(
      getPluginPanelRoutePath({ pluginId: 'docs', path: DEFAULT_PLUGIN_PANEL_PATH, subPath: 'a/b' })
    ).toBe('/plugins/docs/panel/a/b');
  });

  it('maps extensions tabs onto the plugins/skills/mcp tree', () => {
    expect(getExtensionsTabRoutePath('marketplace')).toBe(TOOLS_PLUGIN_BROWSE_ROUTE_PATH);
    expect(getExtensionsTabRoutePath('installed')).toBe(TOOLS_PLUGINS_ROUTE_PATH);
    expect(getExtensionsTabRoutePath('installed', 'slack')).toBe('/extensions/plugins/slack');
    expect(getExtensionsTabRoutePath('skills')).toBe(TOOLS_SKILLS_ROUTE_PATH);
    expect(getExtensionsTabRoutePath('mcp')).toBe('/extensions/mcp');
    expect(
      getExtensionsHubPageRoutePath({ pluginId: 'plugin-guide', pageId: 'plugin-guide', subPath: 'app-shell' })
    ).toBe('/extensions/pages/plugin-guide/plugin-guide/app-shell');
  });

  it('maps core nav ids and module ids', () => {
    expect(getNavRoutePath('home')).toBe('/');
    expect(getNavRoutePath('inbox')).toBe('/inbox');
    expect(getNavRoutePath('agents')).toBe('/agents');
    expect(getNavRoutePath('extensions')).toBe('/extensions');
    expect(getNavRoutePath('projects')).toBe('/');
    expect(getNavRoutePath('goals')).toBe('/goals');
    expect(getNavRoutePath('custom-mod')).toBe('/plugins/custom-mod/panel');
  });

  it('recognizes extensions, settings, and project paths', () => {
    expect(isExtensionsRoutePath('/extensions')).toBe(true);
    expect(isExtensionsRoutePath('/extensions/plugins/browse')).toBe(true);
    expect(isExtensionsRoutePath('/settings')).toBe(false);
    expect(isSettingsRoutePath('/settings/global')).toBe(true);
    expect(isProjectRoutePath('/projects/p1')).toBe(true);
    expect(isProjectRoutePath('/projects/p1/settings')).toBe(true);
    expect(isProjectRoutePath('/inbox')).toBe(false);
  });

  it('recognizes canonical routes including query and hash suffixes', () => {
    for (const path of [
      '/',
      '/inbox',
      '/settings',
      '/settings/global#appearance',
      '/extensions/plugins/browse',
      '/extensions/pages/plugin-guide/plugin-guide',
      '/projects/p1/terminals?x=1',
      '/plugins/docs/panel',
      '/threads/new',
      '/projects/p1/threads/new',
      '/threads/abc',
      '/projects/p1/threads/abc'
    ]) {
      expect(isRoutePath({ path })).toBe(true);
    }
    expect(isRoutePath({ path: '/not-a-route' })).toBe(false);
    expect(isRoutePath({ path: '/goals#x' })).toBe(true);
    expect(isRoutePath({ path: '/inbox?x=1#y' })).toBe(true);
  });

  it('maps the remaining canonical getters and tab helpers', () => {
    expect(getRootRoutePath()).toBe('/');
    expect(getInboxRoutePath()).toBe('/inbox');
    expect(getAgentsRoutePath()).toBe('/agents');
    expect(getNewThreadRoutePath()).toBe('/threads/new');
    expect(getNewThreadRoutePath('proj/1')).toBe('/projects/proj%2F1/threads/new');
    expect(getThreadRoutePath('abc')).toBe('/threads/abc');
    expect(getThreadRoutePath('abc', 'proj/1')).toBe('/projects/proj%2F1/threads/abc');
    expect(threadIdFromPath('/threads/abc')).toBe('abc');
    expect(threadIdFromPath('/projects/p1/threads/abc')).toBe('abc');
    expect(threadIdFromPath('/threads/new')).toBeUndefined();
    expect(threadIdFromPath('/projects/p1/threads/new')).toBeUndefined();
    expect(projectIdFromThreadPath('/projects/p1/threads/abc')).toBe('p1');
    expect(projectIdFromThreadPath('/threads/abc')).toBeUndefined();
    expect(getFollowUpsRoutePath()).toBe('/followups');
    expect(getSuggestionsRoutePath()).toBe('/suggestions');
    expect(getSchedulerRoutePath()).toBe('/scheduler');
    expect(getGoalsRoutePath()).toBe('/goals');
    expect(getPluginsRoutePath()).toBe(TOOLS_PLUGINS_ROUTE_PATH);
    expect(getPluginBrowseRoutePath()).toBe(TOOLS_PLUGIN_BROWSE_ROUTE_PATH);
    expect(getMcpRoutePath()).toBe('/extensions/mcp');
    expect(getSkillsRoutePath()).toBe('/extensions/skills');
    expect(getSettingsRoutePath('')).toBe('/settings');
    expect(getSettingsTabRoutePath('project')).toBe('/settings');
    expect(getSettingsTabRoutePath('project', 'p1')).toBe('/projects/p1/settings');
    expect(getSettingsTabRoutePath('terminal')).toBe('/settings/terminal');
    expect(
      getPluginPanelRoutePath({ pluginId: 'docs', path: DEFAULT_PLUGIN_PANEL_PATH })
    ).toBe('/plugins/docs/panel');
    expect(
      getPluginPanelRoutePath({ pluginId: 'docs', path: DEFAULT_PLUGIN_PANEL_PATH, subPath: '' })
    ).toBe('/plugins/docs/panel');
    expect(
      getPluginPanelRoutePath({ pluginId: 'docs', path: DEFAULT_PLUGIN_PANEL_PATH, subPath: '//' })
    ).toBe('/plugins/docs/panel');
    expect(
      getLocationRoutePath({ pathname: '/inbox', search: '?a=1', hash: '#h' })
    ).toBe('/inbox?a=1#h');
  });

  it('resolves same-origin route hrefs only', () => {
    expect(
      resolveRouteHref({ currentOrigin: 'http://127.0.0.1:5173', href: '/inbox' })
    ).toEqual({ path: '/inbox' });
    expect(
      resolveRouteHref({
        currentOrigin: 'http://127.0.0.1:5173',
        href: 'http://127.0.0.1:5173/inbox?x=1#y'
      })
    ).toEqual({ path: '/inbox?x=1#y' });
    expect(
      resolveRouteHref({ currentOrigin: 'http://127.0.0.1:5173', href: 'https://example.com/inbox' })
    ).toBeNull();
    expect(resolveRouteHref({ currentOrigin: 'http://127.0.0.1:5173', href: '' })).toBeNull();
    expect(resolveRouteHref({ currentOrigin: 'http://127.0.0.1:5173', href: '//evil.example/inbox' })).toBeNull();
    expect(resolveRouteHref({ currentOrigin: 'http://127.0.0.1:5173', href: 'inbox' })).toBeNull();
    expect(
      resolveRouteHref({ currentOrigin: 'http://127.0.0.1:5173', href: '/not-a-route' })
    ).toBeNull();
    expect(resolveRouteHref({ currentOrigin: 'not-a-origin', href: '/inbox' })).toBeNull();
  });

  it('lets static settings/plugins/browse segments win over params', () => {
    expect(isRoutePath({ path: '/extensions/plugins/browse' })).toBe(true);
    expect(isRoutePath({ path: '/projects/p1/settings' })).toBe(true);
  });
});
