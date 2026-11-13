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
  [undefined, true],
  [true, true],
  [false, false]
] as const)('hydrates terminalCopyOnSelectEnabled from %s to %s', async (stored, expected) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.config = { ...base, ...(stored === undefined ? {} : { terminalCopyOnSelectEnabled: stored }) };
  await useData.getState().init();
  expect(useData.getState().terminalCopyOnSelectEnabled).toBe(expected);
});

it('follows a config change from another window and the Settings setter', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.config = { ...base };
  await useData.getState().init();
  expect(useData.getState().terminalCopyOnSelectEnabled).toBe(true);
  h.onConfig!({ ...base, terminalCopyOnSelectEnabled: false });
  expect(useData.getState().terminalCopyOnSelectEnabled).toBe(false);
  useData.getState().setTerminalCopyOnSelectEnabled(true);
  expect(useData.getState().terminalCopyOnSelectEnabled).toBe(true);
});
