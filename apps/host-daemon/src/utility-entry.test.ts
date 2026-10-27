import { afterEach, expect, it, vi } from 'vitest';
import { SERVER_RUNTIME_PROTOCOL_VERSION as protocolVersion } from '@zana-ai/zcc-contracts/runtime';
const deps = vi.hoisted(() => ({ start: vi.fn(), enroll: vi.fn(), manager: vi.fn(), log: vi.fn(), path: vi.fn(), shutdownCommands: vi.fn() }));
vi.mock('@zana-ai/zcc-process-utils', () => ({ installRuntimeLog: deps.log }));
vi.mock('@zana-ai/zcc-agent-process-utils', () => ({ shutdownPortableCommands: deps.shutdownCommands }));
vi.mock('./daemon.js', () => ({ startHostDaemon: deps.start }));
vi.mock('./local-pty-host.js', () => ({ createLocalPtyTerminalManager: deps.manager }));
vi.mock('./enroll-runtime.js', () => ({ startEnrolledHostDaemon: deps.enroll }));
vi.mock('./env.js', () => ({ ensureProcessPath: deps.path }));
const originalPort = (process as any).parentPort;
const originalExitListeners = process.listeners('exit');
afterEach(() => {
  (process as any).parentPort = originalPort;
  for (const listener of process.listeners('exit')) if (!originalExitListeners.includes(listener)) process.off('exit', listener);
  vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllEnvs();
});
async function fixture() {
  let handler!: (event: { data: unknown }) => Promise<void>;
  const postMessage = vi.fn();
  (process as any).parentPort = { on: (_event: string, fn: typeof handler) => { handler = fn; }, postMessage };
  vi.resetModules(); await import('./utility-entry.js');
  return { send: (data: unknown) => handler({ data }), postMessage };
}
it('requires authenticated utility transport', async () => {
  (process as any).parentPort = undefined; vi.resetModules();
  await expect(import('./utility-entry.js')).rejects.toThrow('Electron utility process');
});
it('forwards explicit provenance and replacement only on authenticated enrollment messages', async () => {
  const f = await fixture(), close = vi.fn(async () => {});
  deps.enroll.mockResolvedValue({ hostId: 'product-host', close });
  for (const data of [null, 'enroll', { type: 'enroll', protocolVersion: 0 }, { type: 'enroll', protocolVersion }]) await f.send(data);
  expect(deps.enroll).not.toHaveBeenCalled();
  await f.send({ type: 'enroll', protocolVersion, serverUrl: 'http://127.0.0.1:1', token: 'fixture', dataDir: '/fixture', provenance: 'tunnel', replaceEnrollment: true });
  expect(deps.enroll).toHaveBeenCalledWith({ serverUrl: 'http://127.0.0.1:1', token: 'fixture', dataDir: '/fixture', provenance: 'tunnel', replaceEnrollment: true, stealLock: true });
  await f.send({ type: 'relaunch', protocolVersion, serverUrl: 'http://127.0.0.1:1', token: 'fixture', dataDir: '/fixture' });
  expect(deps.enroll.mock.calls[1][0]).toMatchObject({ provenance: 'non-tunnel', replaceEnrollment: false });
  expect(close).toHaveBeenCalledOnce();
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  await f.send({ type: 'stop', protocolVersion }); expect(close).toHaveBeenCalledTimes(2);
  expect(f.postMessage).toHaveBeenCalledWith({ type: 'stopped', protocolVersion });
});
it.each([new Error('refused'), 'refused'])('reports enrollment and relaunch failures (%s)', async error => {
  const f = await fixture(); deps.enroll.mockRejectedValue(error);
  for (const type of ['enroll', 'relaunch']) {
    await f.send({ type, protocolVersion, serverUrl: 'http://127.0.0.1:1', token: 'fixture', dataDir: '/fixture' });
    expect(f.postMessage).toHaveBeenLastCalledWith({ type: 'error', protocolVersion, message: 'refused' });
  }
});
it('starts private terminal transport and releases it on stop and process exit', async () => {
  const f = await fixture(), close = vi.fn(async () => {}), managerClose = vi.fn(); let emit!: (event: unknown) => void;
  deps.manager.mockImplementation(callback => { emit = callback; return { close: managerClose }; });
  deps.start.mockResolvedValue({ url: 'http://127.0.0.1:2', close });
  vi.stubEnv('PATH', 'fixture-path'); vi.stubEnv('ZCC_GH_BINARY', 'fixture-gh');
  await f.send({ type: 'start', protocolVersion, token: 'fixture', signingKey: 'fixture-signing', hostId: 'private', dataDir: '/fixture', path: '/fixture/bin', ghBinary: '/fixture/gh' });
  expect(deps.log).toHaveBeenCalled(); expect(process.env.PATH).toBe('/fixture/bin'); expect(process.env.ZCC_GH_BINARY).toBe('/fixture/gh');
  emit({ type: 'test' }); expect(f.postMessage).toHaveBeenLastCalledWith({ type: 'terminal-event', protocolVersion, event: { type: 'test' } });
  process.listeners('exit').find(listener => !originalExitListeners.includes(listener))!(0); expect(managerClose).toHaveBeenCalledOnce();
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  await f.send({ type: 'stop', protocolVersion }); expect(close).toHaveBeenCalledOnce();
});
it('reaps probes before waiting on enrollment cleanup, only for an authenticated final stop', async () => {
  const f = await fixture();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const close = vi.fn(() => blocked);
  deps.enroll.mockResolvedValue({ hostId: 'host', close });
  const enroll = { type: 'enroll', protocolVersion, serverUrl: 'http://127.0.0.1:1', token: 'fixture', dataDir: '/fixture' };
  await f.send(enroll);
  await f.send({ type: 'stop', protocolVersion: 0 });
  expect(deps.shutdownCommands).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  // Relaunch keeps the utility process usable and must not permanently close
  // its command gate. This enrollment has nothing to drain yet.
  close.mockResolvedValueOnce(undefined);
  await f.send({ ...enroll, type: 'relaunch' });
  expect(deps.shutdownCommands).not.toHaveBeenCalled();
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  const stopped = f.send({ type: 'stop', protocolVersion });
  expect(deps.shutdownCommands).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledTimes(2);
  expect(deps.shutdownCommands.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[1]!);
  expect(process.exit).not.toHaveBeenCalled();
  release();
  await stopped;
  expect(process.exit).toHaveBeenCalledWith(0);
});
it.each([new Error('start failed'), 'start failed'])('reports private startup failure (%s)', async error => {
  const f = await fixture(); deps.manager.mockReturnValue({ close: vi.fn() }); deps.start.mockRejectedValue(error);
  await f.send({ type: 'start', protocolVersion, token: 'fixture', signingKey: 'fixture', hostId: 'private' });
  expect(deps.path).toHaveBeenCalled(); expect(f.postMessage).toHaveBeenLastCalledWith({ type: 'error', protocolVersion, message: 'start failed' });
});
