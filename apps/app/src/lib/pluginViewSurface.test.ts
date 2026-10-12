/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePluginViewSearch } from './pluginViewSurface.js';

const target = { pluginId: 'salesforce', tabId: 'studio', projectId: 'p-1' };
const query = (extra = '') => `?surface=plugin-view&projectId=p-1&pluginId=salesforce&tabId=studio${extra}`;

describe('parsePluginViewSearch', () => {
  it('reads a plugin view target', () => {
    expect(parsePluginViewSearch(query('&x=1'))).toEqual(target);
  });

  it.each([
    '',
    '?projectId=p-1&pluginId=salesforce&tabId=studio',
    '?surface=popover&projectId=p-1&pluginId=salesforce&tabId=studio',
    '?surface=plugin-view&projectId=p-1&pluginId=Salesforce&tabId=studio',
    '?surface=plugin-view&projectId=p-1&pluginId=salesforce&tabId=a/b',
    '?surface=plugin-view&projectId=%20&pluginId=salesforce&tabId=studio',
    '?surface=plugin-view&pluginId=salesforce&tabId=studio'
  ])('ignores %j', (search) => {
    expect(parsePluginViewSearch(search)).toBeNull();
  });
});

describe('getPluginViewTarget', () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    vi.resetModules();
  });

  async function load() {
    return import('./pluginViewSurface.js');
  }

  it('is null in an ordinary window', async () => {
    const surface = await load();
    expect(surface.getPluginViewTarget()).toBeNull();
    expect(surface.isPluginViewSurface()).toBe(false);
  });

  it('reads the query and remembers it for a reload without one', async () => {
    window.history.replaceState(null, '', `/${query()}`);
    const first = await load();
    expect(first.getPluginViewTarget()).toEqual(target);
    expect(first.isPluginViewSurface()).toBe(true);

    window.history.replaceState(null, '', '/projects/p-1');
    vi.resetModules();
    expect((await load()).getPluginViewTarget()).toEqual(target);
  });

  it('ignores a tampered remembered target', async () => {
    window.sessionStorage.setItem('zcc.pluginViewTarget', JSON.stringify({ ...target, tabId: '../x' }));
    expect((await load()).getPluginViewTarget()).toBeNull();
    window.sessionStorage.setItem('zcc.pluginViewTarget', '{not json');
    vi.resetModules();
    expect((await load()).getPluginViewTarget()).toBeNull();
  });
});
