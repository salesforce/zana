import { beforeEach, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { bindIpcCtx } from './ctx.js';

vi.mock('electron', () => ({ ipcMain: {} }));
vi.mock('@zana-ai/zcc-server/services/mcp/mcp', () => ({}));
vi.mock('@zana-ai/zcc-server/services/mcp/mcp-catalogue', () => ({}));
vi.mock('@zana-ai/zcc-server/services/extensions/plugins', () => ({}));
vi.mock('./plugin-apps-loopback.js', () => ({ callPluginRpcOnProductServer: vi.fn() }));
import { callPluginRpcOnProductServer } from './plugin-apps-loopback.js';
import { registerPluginsIpc } from './plugins.js';

// Mirrors host.ts safeHandle: log (the noise under test) then delegate to onError.
const logMainError = vi.fn();
const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
const callPluginRpc = vi.fn();
function bind(runtimeSupervisor: unknown) {
  bindIpcCtx({
    runtimeSupervisor,
    safeHandle: (channel: string, handler: (...a: any[]) => any, onError: (e: unknown) => unknown) =>
      handlers.set(channel, async (...args: any[]) => {
        try { return await handler(...args); } catch (err) { logMainError(`ipc ${channel}`, err); return onError(err); }
      })
  } as any);
  registerPluginsIpc();
}
beforeEach(() => { vi.clearAllMocks(); handlers.clear(); bind({ callPluginRpc }); });

const domain = (code: string, message = `bad ${code}`) => Object.assign(new Error(message), { code });

it('resolves expected domain errors as an envelope without logging a main error', async () => {
  callPluginRpc.mockRejectedValueOnce(domain('invalid', 'a design doc must keep at least one file'));
  await expect(handlers.get(IPC.pluginApps.callRpc)!('docs', 'rm', {})).resolves.toEqual({
    __zccRpcError: { message: 'a design doc must keep at least one file', code: 'invalid' }
  });
  callPluginRpc.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 404 }));
  await expect(handlers.get(IPC.pluginApps.callRpc)!('docs', 'rm', {})).resolves.toEqual({ __zccRpcError: { message: 'nope', code: 'not_found' } });
  expect(logMainError).not.toHaveBeenCalled();
  expect(callPluginRpc).toHaveBeenCalledWith('docs', 'rm', {});
});

it('still throws and logs unexpected errors, and returns plain values untouched', async () => {
  const boom = new Error('database exploded');
  callPluginRpc.mockRejectedValueOnce(boom);
  await expect(handlers.get(IPC.pluginApps.callRpc)!('docs', 'rm')).rejects.toBe(boom);
  expect(logMainError).toHaveBeenCalledWith(`ipc ${IPC.pluginApps.callRpc}`, boom);
  callPluginRpc.mockResolvedValueOnce({ count: 2 });
  await expect(handlers.get(IPC.pluginApps.callRpc)!('docs', 'count')).resolves.toEqual({ count: 2 });
});

it('uses the loopback product server when no runtime supervisor is bound', async () => {
  handlers.clear(); bind(undefined);
  vi.mocked(callPluginRpcOnProductServer).mockRejectedValueOnce(domain('conflict'));
  await expect(handlers.get(IPC.pluginApps.callRpc)!('docs', 'save')).resolves.toEqual({ __zccRpcError: { message: 'bad conflict', code: 'conflict' } });
  vi.mocked(callPluginRpcOnProductServer).mockResolvedValueOnce('ok');
  await expect(handlers.get(IPC.pluginApps.callRpc)!('docs', 'save')).resolves.toBe('ok');
  expect(logMainError).not.toHaveBeenCalled();
});
