// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => ({ value: {} as Record<string, unknown>, changed: null as null | ((value: any) => void) }));
vi.mock('../lib/app-surface.js', () => ({ hasDesktopBridge: () => true }));
vi.mock('../lib/product-client.js', () => ({ product: new Proxy({}, { get: (_target, group) => new Proxy({}, {
  get: (_target, method) => {
    if (method === 'groups') return { list: async () => [], onChanged: () => () => {} };
    if (group === 'config' && method === 'get') return async () => config.value;
    if (group === 'config' && method === 'onChanged') return (listener: any) => { config.changed = listener; return () => {}; };
    if (String(method).startsWith('on')) return () => () => {};
    if (method === 'history') return async () => ({ entries: [] });
    if (method === 'getReadState') return async () => ({ readIds: {}, migratedFromLocalStorage: true });
    if (method === 'consumeWhatsNew') return async () => null;
    return async () => [];
  }
}) }) }));
import { useData, useUi } from '../store.js';
afterEach(() => vi.restoreAllMocks());

it.each(['board', 'list', 'flow', 'plugin:city/world', 'invalid', undefined])('hydrates only valid saved Agents views: %s', async preferred => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  config.value = { agentsBoardView: preferred, walkthroughCompleted: true, setupDismissed: true };
  useUi.setState({ agentsBoardView: 'board' });
  await useData.getState().init();
  expect(useData.getState().configLoaded).toBe(true);
  expect(useUi.getState().agentsBoardView).toBe(['board', 'list', 'flow', 'plugin:city/world'].includes(preferred ?? '') ? preferred : 'board');
});


it.each([undefined, true, false])('hydrates thread tabs with default enabled: %s', async enabled => {
  config.value = { threadTabsEnabled: enabled, walkthroughCompleted: true, setupDismissed: true };
  await useData.getState().init();
  expect(useData.getState().threadTabsEnabled).toBe(enabled ?? true);
  config.changed?.({ ...config.value, threadTabsEnabled: false });
  expect(useData.getState().threadTabsEnabled).toBe(false);
  config.changed?.({ ...config.value, threadTabsEnabled: true });
  expect(useData.getState().threadTabsEnabled).toBe(true);
  useData.getState().setThreadTabsEnabled(false);
  expect(useData.getState().threadTabsEnabled).toBe(false);
});

it.each([undefined, true, false])('hydrates the inset workspace with default disabled: %s', async enabled => {
  config.value = { insetWorkspaceEnabled: enabled, walkthroughCompleted: true, setupDismissed: true };
  await useData.getState().init();
  expect(useData.getState().insetWorkspaceEnabled).toBe(enabled ?? false);
  config.changed?.({ ...config.value, insetWorkspaceEnabled: true });
  expect(useData.getState().insetWorkspaceEnabled).toBe(true);
  useData.getState().setInsetWorkspaceEnabled(false);
  expect(useData.getState().insetWorkspaceEnabled).toBe(false);
});

it.each([undefined, true, false])('hydrates dockable thread tools with default enabled: %s', async enabled => {
  config.value = { dockableThreadToolsEnabled: enabled, walkthroughCompleted: true, setupDismissed: true };
  await useData.getState().init();
  expect(useData.getState().dockableThreadToolsEnabled).toBe(enabled ?? true);
  config.changed?.({ ...config.value, dockableThreadToolsEnabled: false });
  expect(useData.getState().dockableThreadToolsEnabled).toBe(false);
  config.changed?.({ ...config.value, dockableThreadToolsEnabled: true });
  expect(useData.getState().dockableThreadToolsEnabled).toBe(true);
  useData.getState().setDockableThreadToolsEnabled(false);
  expect(useData.getState().dockableThreadToolsEnabled).toBe(false);
});
