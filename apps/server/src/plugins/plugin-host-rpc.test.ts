import { expect, it, vi } from 'vitest';
import { callPluginHostRpc, disposePluginHostWorkers, validatePluginHostValue } from './plugin-host-rpc.js';
import { z } from 'zod';
const artifact = { path: '/never-sent', generation: 'g1', digest: 'a'.repeat(64), byteLength: 12 };
function fixture() {
  const call = vi.fn().mockResolvedValue({ output: 'result' });
  const ctx = { hostHub: { resolveHostId: vi.fn((id?: string) => id ?? 'primary'), callHostOnlineRpc: call, connectedHostIds: () => ['a', 'b'] } } as any;
  return { call, ctx, args: { pluginId: 'test', artifact, method: 'echo', input: { value: 1 }, hostId: 'b' } };
}
it('uses the selected host and server artifact generation, without leaking paths', async () => {
  const { ctx, args, call } = fixture();
  expect(await callPluginHostRpc(ctx, args)).toBe('result');
  expect(call).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'b', command: expect.objectContaining({ type: 'plugin.host.call', pluginId: 'test', generation: 'g1', input: { value: 1 }, artifact: { digest: artifact.digest, byteLength: 12 } }) }));
  expect(JSON.stringify(call.mock.calls)).not.toContain('/never-sent');
  ctx.hostHub.resolveHostId.mockImplementation(() => { throw new Error('offline'); });
  await expect(callPluginHostRpc(ctx, args)).rejects.toThrow('offline'); expect(call).toHaveBeenCalledTimes(1);
});
it('forwards a server-resolved projectRoot, and omits it entirely when absent', async () => {
  const { ctx, args, call } = fixture();
  await callPluginHostRpc(ctx, { ...args, projectRoot: '/confined/project-root' });
  expect(call.mock.calls[0][0]).toMatchObject({ command: { projectRoot: '/confined/project-root' } });
  await callPluginHostRpc(ctx, args);
  expect(call.mock.calls[1][0].command).not.toHaveProperty('projectRoot');
});
it('bounds inputs and deadlines and never sends an already-aborted call', async () => {
  const { ctx, args, call } = fixture();
  await expect(callPluginHostRpc(ctx, { ...args, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
  await expect(callPluginHostRpc(ctx, { ...args, input: 'x'.repeat(8 * 1024 * 1024) })).rejects.toThrow('8 MiB');
  await expect(callPluginHostRpc(ctx, { ...args, timeoutMs: Infinity })).rejects.toThrow('deadline');
  expect(call).not.toHaveBeenCalled();
  expect(await callPluginHostRpc(ctx, { ...args, hostId: undefined, input: undefined, timeoutMs: 100 })).toBe('result');
  expect(call.mock.calls[0][0]).toMatchObject({ hostId: 'primary', timeoutMs: 6100, command: { input: null, timeoutMs: 100 } });
});
it('cancels the same call on the same host and disposes only its generation', async () => {
  const { ctx, args, call } = fixture();
  let finish!: (value: unknown) => void;
  call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController(), pending = callPluginHostRpc(ctx, { ...args, signal: controller.signal });
  controller.abort(); finish({ output: 'late' });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(call.mock.calls[1][0]).toMatchObject({ hostId: 'b', command: { type: 'plugin.host.cancel', callId: call.mock.calls[0][0].command.callId } });
  call.mockRejectedValue(new Error('offline'));
  await disposePluginHostWorkers(ctx, 'test', 'g1');
  expect(call.mock.calls.slice(-2).map(([arg]) => [arg.hostId, arg.command])).toEqual(['a', 'b'].map(host => [host, { type: 'plugin.host.dispose', pluginId: 'test', generation: 'g1' }]));
});
it('validates declared schemas on both directions', async () => {
  expect(await validatePluginHostValue(z.string(), 'yes')).toBe('yes');
  await expect(validatePluginHostValue(z.string(), 3)).rejects.toThrow('validation');
  await expect(validatePluginHostValue(null, 3)).rejects.toThrow('schema');
});
