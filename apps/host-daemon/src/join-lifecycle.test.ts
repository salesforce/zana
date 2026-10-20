import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({
  start: vi.fn(), status: vi.fn(), update: vi.fn(), confirm: vi.fn(), spawn: vi.fn()
}));
vi.mock('./enroll-runtime.js', () => ({ startEnrolledHostDaemon: deps.start, assertEnrollmentSafe: vi.fn() }));
vi.mock('./local-status.js', () => ({ startLocalStatusServer: deps.status }));
vi.mock('./protocol-self-update.js', () => ({ handleProtocolMismatch: deps.update, confirmHostUpdate: deps.confirm, rollbackHostUpdate: vi.fn() }));
vi.mock('@zana-ai/zcc-process-utils', () => ({ installRuntimeLog: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: deps.spawn }));
import { runJoin, restartHostProcess, checkEnrollmentOnly } from './join-cli.js';
const options = { dataDir: '/isolated', hostDaemonPort: 38888, serverUrl: 'http://127.0.0.1:1', joinCode: 'test', autoUpdate: true };
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs(); });
function fixture() {
  let status: () => { connected: boolean };
  const statusClose = vi.fn((callback: () => void) => callback());
  deps.status.mockImplementation((_port, read) => { status = read; return { close: statusClose }; });
  const close = vi.fn(async () => {}), daemon = { hostId: 'host', close };
  deps.start.mockResolvedValue(daemon); deps.confirm.mockResolvedValue(undefined); deps.update.mockResolvedValue('updated');
  return { readStatus: () => status!(), statusClose, close };
}
describe('enrollment pre-flight', () => {
  it('requires a data dir and delegates to the safety assertion', () => {
    const assertSafe = vi.fn();
    expect(() => checkEnrollmentOnly({ ...options, dataDir: '' }, assertSafe)).toThrow('ZCC_DATA_DIR');
    expect(assertSafe).not.toHaveBeenCalled();
    checkEnrollmentOnly(options, assertSafe);
    expect(assertSafe).toHaveBeenCalledWith(options);
  });
  it('propagates a refusal so the installer leaves the running daemon alone', () => {
    expect(() => checkEnrollmentOnly(options, () => { throw new Error('refused'); })).toThrow('refused');
  });
  it('defaults an unspecified provenance to non-tunnel without replacement consent', async () => {
    fixture();
    const running = await runJoin(options, vi.fn());
    expect(deps.start.mock.calls[0][0]).toMatchObject({ provenance: 'non-tunnel' });
    expect(deps.start.mock.calls[0][0].replaceEnrollment).toBeUndefined();
    await running.close();
  });
});
describe('join lifecycle', () => {
  it('forwards explicit provenance and replacement consent, then clears restart consent', async () => {
    fixture(); vi.stubEnv('ZCC_HOST_REPLACE_ENROLLMENT', '1');
    const argv = process.argv;
    try {
      process.argv = [...argv, '--replace-enrollment'];
      const running = await runJoin({ ...options, provenance: 'tunnel', replaceEnrollment: true });
      expect(deps.start.mock.calls[0][0]).toMatchObject({ provenance: 'tunnel', replaceEnrollment: true });
      expect(process.argv).not.toContain('--replace-enrollment');
      expect(process.env.ZCC_HOST_REPLACE_ENROLLMENT).toBeUndefined();
      await running.close();
    } finally { process.argv = argv; }
  });
  it('reflects disconnect and successful reconnect in the status endpoint', async () => {
    const f = fixture(), running = await runJoin(options, vi.fn());
    const events = deps.start.mock.calls[0]![0];
    expect(f.readStatus().connected).toBe(true);
    events.onConnectionChange(false); expect(f.readStatus().connected).toBe(false);
    events.onConnectionChange(true); expect(f.readStatus().connected).toBe(true);
    await running.close(); await running.close();
    expect(f.close).toHaveBeenCalledTimes(1); expect(f.statusClose).toHaveBeenCalledTimes(1);
  });
  it('closes both listeners before restarting after a protocol mismatch and coalesces callbacks', async () => {
    const f = fixture();
    const restart = vi.fn(async () => { expect(f.close).toHaveBeenCalled(); expect(f.statusClose).toHaveBeenCalled(); });
    const running = await runJoin(options, restart);
    const events = deps.start.mock.calls[0]![0]; events.onSocketClose(4001); events.onSocketClose(4002);
    await vi.waitFor(() => expect(restart).toHaveBeenCalledTimes(1)); expect(deps.update).toHaveBeenCalledTimes(1);
    events.onSocketClose(4001); expect(deps.update).toHaveBeenCalledTimes(1);
  });
  it('retains the current process when update is unavailable', async () => {
    fixture(); deps.update.mockResolvedValue('failed'); const restart = vi.fn();
    const running = await runJoin(options, restart); deps.start.mock.calls[0]![0].onSocketClose(4001);
    await Promise.resolve(); await Promise.resolve(); expect(restart).not.toHaveBeenCalled(); await running.close();
  });
  it('closes status and attempts update on an initial incompatible handshake', async () => {
    const f = fixture(); deps.start.mockRejectedValue(new Error('409 incompatible host-rpc protocol version'));
    const restart = vi.fn(async () => {});
    await expect(runJoin(options, restart)).rejects.toThrow('409');
    expect(restart).toHaveBeenCalledTimes(1); expect(f.statusClose).toHaveBeenCalledTimes(1);
  });
  it('cancels an offline startup and releases its listener before a successful protocol restart', async () => {
    const f = fixture();
    deps.start.mockImplementation(input => new Promise((_resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(new Error('closed')));
      queueMicrotask(() => input.onSocketClose(4001));
    }));
    const restart = vi.fn(async () => { expect(f.statusClose).toHaveBeenCalledOnce(); });
    const running = await runJoin(options, restart);
    expect(restart).toHaveBeenCalledOnce();
    expect(deps.start.mock.calls[0][0]).toMatchObject({ keepRetryingStartup: true });
    await running.close();
  });
  it.each([false, true])('stops replaced ownership without a supervisor restart loop, managed=%s', async managed => {
    vi.stubEnv('ZCC_HOST_SERVICE_MANAGED', managed ? '1' : '0');
    const f = fixture(); const restart = vi.fn();
    const running = await runJoin(options, restart);
    deps.start.mock.calls[0][0].onSocketClose(4003);
    await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce());
    if (managed) expect(f.statusClose).not.toHaveBeenCalled();
    await running.close();
    expect(f.close).toHaveBeenCalledTimes(managed ? 2 : 1);
    expect(f.statusClose).toHaveBeenCalledOnce();
    expect(restart).not.toHaveBeenCalled();
  });
  it.each([true, false])('restarts through the correct owner, service managed=%s', async managed => {
    vi.stubEnv('ZCC_HOST_SERVICE_MANAGED', managed ? '1' : '');
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const unref = vi.fn();
    deps.spawn.mockImplementation(() => ({ once(event: string, callback: () => void) { if (event === 'spawn') queueMicrotask(callback); }, unref }));
    await restartHostProcess();
    expect(deps.spawn).toHaveBeenCalledTimes(managed ? 0 : 1);
    expect(process.exit).toHaveBeenCalledWith(0);
    if (!managed) expect(unref).toHaveBeenCalled();
  });
});


describe('bundled join CLI entry', () => {
  it.each([HOST_RPC_PROTOCOL_VERSION, HOST_RPC_PROTOCOL_VERSION + 1])('probes protocol %s by exit status', async protocol => {
    const argv = process.argv;
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      process.argv = [process.execPath, '/isolated/join.mjs', '--check-protocol', String(protocol)];
      vi.resetModules(); await import('./join-cli.js');
      expect(process.exit).toHaveBeenCalledWith(protocol === HOST_RPC_PROTOCOL_VERSION ? 0 : 1);
    } finally { process.argv = argv; }
  });
  it('refreshes the standalone PID and removes its record on graceful exit', async () => {
    fixture();
    const dir = mkdtempSync(join(tmpdir(), 'zcc-join-entry-')), argv = process.argv;
    const before = new Map(['SIGINT', 'SIGTERM', 'exit'].map(event => [event, process.listeners(event)]));
    vi.stubEnv('ZCC_DATA_DIR', dir); vi.stubEnv('ZCC_HOST_SERVICE_MANAGED', '0');
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      process.argv = [process.execPath, join(dir, 'join.mjs'), 'join', '--server-url', 'http://127.0.0.1:1'];
      vi.resetModules(); await import('./join-cli.js');
      expect(readFileSync(join(dir, 'host-daemon.pid'), 'utf8')).toBe(String(process.pid));
      const stop = process.listeners('SIGTERM').find(fn => !before.get('SIGTERM')!.includes(fn));
      stop!('SIGTERM');
      await vi.waitFor(() => expect(deps.status.mock.results.at(-1)!.value.close).toHaveBeenCalledOnce());
      const cleanup = process.listeners('exit').find(fn => !before.get('exit')!.includes(fn));
      cleanup!(0);
      expect(() => readFileSync(join(dir, 'host-daemon.pid'))).toThrow();
    } finally {
      process.argv = argv;
      for (const [event, listeners] of before) for (const fn of process.listeners(event)) if (!listeners.includes(fn)) process.removeListener(event, fn);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
