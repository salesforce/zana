// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  onConfig: null as null | ((next: Record<string, unknown>) => void)
}));
vi.mock('../lib/app-surface.js', () => ({ hasDesktopBridge: () => true }));
vi.mock('../lib/product-client.js', () => ({ product: new Proxy({}, { get: (_target, group) => new Proxy({}, {
  get: (_target, method) => {
    if (method === 'groups') return { list: async () => [], onChanged: () => () => {} };
    if (group === 'config' && method === 'get') return async () => h.config;
    if (group === 'config' && method === 'onChanged') return (fn: (next: Record<string, unknown>) => void) => { h.onConfig = fn; return () => {}; };
    if (String(method).startsWith('on')) return () => () => {};
    if (method === 'history') return async () => ({ entries: [] });
    if (method === 'getReadState') return async () => ({ readIds: {}, migratedFromLocalStorage: true });
    if (method === 'consumeWhatsNew') return async () => null;
    return async () => [];
  }
}) }) }));
import { useData } from '../store.js';
afterEach(() => vi.restoreAllMocks());

const base = { walkthroughCompleted: true, setupDismissed: true };

it.each([
  [undefined, false],
  [false, false],
  [true, true]
] as const)('hydrates closeWrapUpEnabled from %s to %s', async (stored, expected) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.config = { ...base, ...(stored === undefined ? {} : { closeWrapUpEnabled: stored }) };
  await useData.getState().init();
  expect(useData.getState().closeWrapUpEnabled).toBe(expected);
});

it('follows a config change from another window and the Settings setter', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.config = { ...base };
  await useData.getState().init();
  expect(useData.getState().closeWrapUpEnabled).toBe(false);
  h.onConfig!({ ...base, closeWrapUpEnabled: true });
  expect(useData.getState().closeWrapUpEnabled).toBe(true);
  h.onConfig!({ ...base });
  expect(useData.getState().closeWrapUpEnabled).toBe(false);
  useData.getState().setCloseWrapUpEnabled(true);
  expect(useData.getState().closeWrapUpEnabled).toBe(true);
});
