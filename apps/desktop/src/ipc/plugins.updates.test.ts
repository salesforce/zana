import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';

vi.mock('electron', () => ({ ipcMain: {} }));
vi.mock('@zana-ai/zcc-server/services/mcp/mcp', () => ({ listMcpServers: vi.fn(), setMcpServerEnabled: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/mcp/mcp-catalogue', () => ({ listMcpServersAll: vi.fn(), setMcpServerEnabledById: vi.fn(), revealMcpServer: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/extensions/plugins', () => ({ listPlugins: vi.fn(), revealPlugin: vi.fn(), setPluginEnabled: vi.fn() }));
vi.mock('./plugin-apps-loopback.js', () => ({ applyAllPluginUpdatesOnProductServer: vi.fn(), checkPluginUpdatesFromProductServer: vi.fn() }));
import { applyAllPluginUpdatesOnProductServer, checkPluginUpdatesFromProductServer } from './plugin-apps-loopback.js';
import { registerPluginsIpc } from './plugins.js';

const handlers = new Map<string, (...args: any[]) => any>();
const failures = new Map<string, (error: unknown) => unknown>();
const supervisor = { updateAllPlugins: vi.fn(), outdatedPlugins: vi.fn() };
const value = { updated: ['fixture'], failed: [{ id: 'offline', message: 'source unavailable' }] };
function bind(attached: boolean) {
  bindIpcCtx({
    safeHandle: (channel: string, handler: (...args: any[]) => any, failure: (error: unknown) => unknown) => {
      handlers.set(channel, handler); failures.set(channel, failure);
    }, runtimeSupervisor: attached ? supervisor : undefined
  } as any);
  registerPluginsIpc();
}
beforeEach(() => { vi.resetAllMocks(); handlers.clear(); failures.clear(); });

it.each([true, false])('routes bulk updates through the selected runtime (attached=%s)', async attached => {
  supervisor.updateAllPlugins.mockResolvedValueOnce(value);
  vi.mocked(applyAllPluginUpdatesOnProductServer).mockResolvedValueOnce({ ok: true, value });
  bind(attached);
  await expect(handlers.get(IPC.pluginApps.applyAllUpdates)!()).resolves.toEqual({ ok: true, value });
  expect(attached ? supervisor.updateAllPlugins : applyAllPluginUpdatesOnProductServer).toHaveBeenCalledOnce();
  expect(attached ? applyAllPluginUpdatesOnProductServer : supervisor.updateAllPlugins).not.toHaveBeenCalled();
});

it.each([new Error('runtime stopped'), 'offline'])('preserves bulk update failures: %s', async error => {
  bind(true);
  supervisor.updateAllPlugins.mockRejectedValueOnce(error);
  const result = { ok: false, code: 'WRITE_FAILED', message: error instanceof Error ? error.message : error };
  await expect(handlers.get(IPC.pluginApps.applyAllUpdates)!()).resolves.toEqual(result);
  expect(failures.get(IPC.pluginApps.applyAllUpdates)!(error)).toEqual(result);
});

it.each([true, false])('uses the selected runtime for update checks (attached=%s)', async attached => {
  const updates = [{ id: 'fixture', current: '1.0.0', available: '1.1.0', marketplace: '' }];
  supervisor.outdatedPlugins.mockResolvedValueOnce(updates);
  vi.mocked(checkPluginUpdatesFromProductServer).mockResolvedValueOnce(updates);
  bind(attached);
  await expect(handlers.get(IPC.pluginApps.checkUpdates)!()).resolves.toEqual(updates);
  const error = new Error('registry unavailable');
  expect(() => failures.get(IPC.pluginApps.checkUpdates)!(error)).toThrow(error);
});
