import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { IPC, type CcApi } from '@zana-ai/zcc-desktop-contract';

const electron = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  exposeInMainWorld: vi.fn()
}));

vi.mock('electron', () => ({
  ipcRenderer: { invoke: electron.invoke, on: electron.on, off: electron.off, setMaxListeners: vi.fn() },
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  webFrame: { getZoomFactor: vi.fn(() => 1) },
  webUtils: { getPathForFile: vi.fn() }
}));

const identity = { marketplaceSource: 'https://example.test/marketplace.json', packId: 'team-tools' };
const request = { identity, planId: '56649d45-2711-4baf-93d8-5a3ae534e3ee', pluginIds: ['team-search'] };
const installation = { identity, displayName: 'Team tools', members: [{ pluginId: 'team-search', status: 'installed' }] };
const operations = [
  { name: 'list', channel: IPC.pluginPacks.list, args: [], invoke: (cc: CcApi) => cc.pluginPacks.list(), value: [{ identity, pack: { id: identity.packId } }] },
  { name: 'plan', channel: IPC.pluginPacks.plan, args: [identity], invoke: (cc: CcApi) => cc.pluginPacks.plan(identity), value: { identity, planId: request.planId, members: [] } },
  { name: 'install', channel: IPC.pluginPacks.install, args: [request], invoke: (cc: CcApi) => cc.pluginPacks.install(request), value: installation },
  { name: 'listInstalled', channel: IPC.pluginPacks.listInstalled, args: [], invoke: (cc: CcApi) => cc.pluginPacks.listInstalled(), value: [installation] },
  { name: 'forget', channel: IPC.pluginPacks.forget, args: [identity], invoke: (cc: CcApi) => cc.pluginPacks.forget(identity), value: true }
];

let cc: CcApi;
beforeAll(async () => {
  await import('./preload.js');
  const exposure = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'cc');
  expect(exposure).toBeDefined();
  cc = exposure![1] as CcApi;
});

beforeEach(() => electron.invoke.mockReset());

it.each(operations)('forwards pluginPacks.$name to its IPC channel and returns the host result', async operation => {
  electron.invoke.mockResolvedValueOnce(operation.value);
  await expect(operation.invoke(cc)).resolves.toBe(operation.value);
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(operation.channel, ...operation.args);
});

it.each(operations)('propagates pluginPacks.$name rejection so the UI can report the failure', async operation => {
  const error = new Error(`${operation.name}: host unavailable`);
  electron.invoke.mockRejectedValueOnce(error);
  await expect(operation.invoke(cc)).rejects.toBe(error);
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(operation.channel, ...operation.args);
});
