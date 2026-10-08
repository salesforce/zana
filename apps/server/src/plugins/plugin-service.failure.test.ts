import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  scanError: undefined as unknown,
  scanGate: null as null | Promise<void>,
  scanStarted: vi.fn(),
  runtimes: [] as Array<{ options: Parameters<typeof import('./isolated-plugin-runtime.js').createIsolatedPluginRuntime>[0]; dispose: ReturnType<typeof vi.fn> }>
}));
vi.mock('./plugin-file-scan.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./plugin-file-scan.js')>();
  return { ...actual, scanPluginFiles: async (dir: string) => { state.scanStarted(); await state.scanGate; if (state.scanError !== undefined) throw state.scanError; return actual.scanPluginFiles(dir); } };
});
vi.mock('./isolated-plugin-runtime.js', () => ({ createIsolatedPluginRuntime: (options: Parameters<typeof import('./isolated-plugin-runtime.js').createIsolatedPluginRuntime>[0]) => {
  options.api.rpc.method('ping', () => 'alive');
  const dispose = vi.fn(); state.runtimes.push({ options, dispose });
  return { started: Promise.resolve(), dispose };
} }));
import { createPluginService } from './plugin-service.js';

const roots: string[] = [], services: ReturnType<typeof createPluginService>[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), 'plugin-failure-owner-')); roots.push(dir); return dir; }
function fixture(onAppsChanged?: () => void) {
  const dir = root(); mkdirSync(join(dir, 'plugin'));
  const plugin = join(dir, 'plugin');
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'zcc-plugin-failure-fixture', version: '0.1.0', engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' }, zcc: { name: 'Fixture', description: 'Failure fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(plugin, 'server.mjs'), 'export default function () {}');
  const dataDir = root();
  const service = createPluginService({ dataDir, bundledRoot: root(), onAppsChanged }); services.push(service);
  return { service, plugin, dataDir };
}
afterEach(() => { for (const service of services.splice(0)) service.stop(); state.scanError = undefined; state.scanGate = null; state.scanStarted.mockReset(); state.runtimes.length = 0; for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('plugin service responsiveness failures', () => {
  it.each([Error('scan failed'), 'scan failed'])('degrades an initial installation when its bounded scan fails: %s', async error => {
    const { service, plugin } = fixture(); state.scanError = error;
    const row = await service.install(plugin);
    expect(service.get(row.id)).toMatchObject({ status: 'degraded', statusDetail: 'scan failed' });
    expect(state.runtimes).toHaveLength(0);
  });

  it('retains the running generation when a reload scan fails', async () => {
    const { service, plugin } = fixture(); const row = await service.install(plugin);
    state.scanError = Error('reload scan failed');
    await expect(service.reload(row.id)).rejects.toThrow('reload scan failed');
    expect(service.get(row.id)?.status).toBe('running');
    await expect(service.callRpc(row.id, 'ping', {})).resolves.toBe('alive');
    expect(state.runtimes[0].dispose).not.toHaveBeenCalled();
  });

  it('ignores a stale worker failure and degrades the current generation on failure', async () => {
    const changed = vi.fn(), { service, plugin } = fixture(changed); const row = await service.install(plugin);
    const previous = state.runtimes[0]; await service.reload(row.id); const current = state.runtimes[1];
    previous.options.onFailure(Error('stale failure'));
    expect(service.get(row.id)?.status).toBe('running');
    current.options.onFailure(Error('worker unresponsive'));
    await vi.waitFor(() => expect(service.get(row.id)).toMatchObject({ status: 'degraded', statusDetail: 'worker unresponsive' }));
    expect(current.dispose).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(3));
  });

  it('contains a rejected failure notification after persisting the degraded state', async () => {
    vi.useFakeTimers();
    let rejectChanges = false;
    const changed = vi.fn(() => { if (rejectChanges) throw Error('notification failed'); });
    const { service, plugin } = fixture(changed);
    const row = await service.install(plugin); rejectChanges = true;
    state.runtimes[0].options.onFailure(Error('Plugin event loop stopped responding'));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    expect(service.get(row.id)?.status).toBe('degraded');
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(service.get(row.id)?.status).toBe('running'));
    vi.useRealTimers();
  });

  it('restarts a watchdog-stalled plugin once the backoff expires', async () => {
    vi.useFakeTimers();
    const { service, plugin } = fixture();
    const row = await service.install(plugin);
    state.runtimes[0].options.onFailure(Error('Plugin event loop stopped responding'));
    await vi.waitFor(() => expect(service.get(row.id)?.status).toBe('degraded'));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(service.get(row.id)?.status).toBe('running'));
    expect(state.runtimes).toHaveLength(2);
    vi.useRealTimers();
  });

  it('does not activate or notify after stop while startup waits on a scan', async () => {
    const { service: setup, plugin, dataDir } = fixture();
    const row = await setup.install(plugin);
    setup.stop();
    const changed = vi.fn();
    const deferred = Promise.withResolvers<void>();
    state.scanGate = deferred.promise;
    const service = createPluginService({ dataDir, bundledRoot: root(), onAppsChanged: changed });
    services.push(service);
    const starting = service.start();
    await vi.waitFor(() => expect(state.scanStarted).toHaveBeenCalled());
    service.stop();
    deferred.resolve();
    await starting;
    expect(service.snapshot()).toMatchObject([{ id: row.id, status: 'degraded', appUrl: null }]);
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(['disable', 'remove'] as const)('does not undo a plugin %s while startup waits on a scan', async (operation) => {
    const { service: setup, plugin, dataDir } = fixture();
    const row = await setup.install(plugin);
    setup.stop();
    const deferred = Promise.withResolvers<void>();
    state.scanGate = deferred.promise;
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    const starting = service.start();
    await vi.waitFor(() => expect(state.scanStarted).toHaveBeenCalled());
    if (operation === 'disable') await service.disable(row.id);
    else await service.remove(row.id);
    deferred.resolve();
    await starting;
    if (operation === 'disable') expect(service.get(row.id)).toMatchObject({ enabled: false, status: 'disabled' });
    else expect(service.get(row.id)).toBeUndefined();
  });
});
