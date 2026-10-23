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
  ['Win32', undefined, true],
  ['Linux x86_64', undefined, false],
  ['Win32', false, false],
  ['Linux x86_64', true, true]
] as const)('hydrates terminalCtrlVPasteEnabled on %s from %s to %s', async (platform, stored, expected) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  h.config = { ...base, ...(stored === undefined ? {} : { terminalCtrlVPasteEnabled: stored }) };
  await useData.getState().init();
  expect(useData.getState().terminalCtrlVPasteEnabled).toBe(expected);
});

it('follows a config change from another window and the Settings setter', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
  h.config = { ...base };
  await useData.getState().init();
  expect(useData.getState().terminalCtrlVPasteEnabled).toBe(true);
  h.onConfig!({ ...base, terminalCtrlVPasteEnabled: false });
  expect(useData.getState().terminalCtrlVPasteEnabled).toBe(false);
  useData.getState().setTerminalCtrlVPasteEnabled(true);
  expect(useData.getState().terminalCtrlVPasteEnabled).toBe(true);
});
