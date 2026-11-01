import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
afterEach(() => { for (const service of services.splice(0)) service.stop(); state.scanError = undefined; state.scanGate = null; state.scanStarted.mockReset(); state.runtimes.length = 0; for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); vi.useRealTimers(); });

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

  it('bounds failed watchdog recovery to three attempts with backoff and allows a manual retry', async () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const { service, plugin } = fixture(changed);
    const row = await service.install(plugin);
    state.scanError = Error('recovery scan failed');
    state.runtimes[0].options.onFailure(Error('Plugin event loop stopped responding'));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));

    for (const [index, delay] of [1_000, 2_000, 4_000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 100);
      expect(state.scanStarted).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(index + 3));
      expect(state.scanStarted).toHaveBeenCalledTimes(index + 2);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.scanStarted).toHaveBeenCalledTimes(4);
    expect(service.get(row.id)?.status).toBe('degraded');

    state.scanError = undefined;
    await service.reload(row.id);
    expect(service.get(row.id)?.status).toBe('running');
    state.scanError = Error('recovery scan failed again');
    state.runtimes.at(-1)!.options.onFailure(Error('Plugin event loop stopped responding'));
    await vi.waitFor(() => expect(service.get(row.id)?.status).toBe('degraded'));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(state.scanStarted).toHaveBeenCalledTimes(6));
  });

  it.each(['disable', 'remove', 'stop'] as const)('cancels pending watchdog recovery on %s', async operation => {
    vi.useFakeTimers();
    const { service, plugin } = fixture();
    const row = await service.install(plugin);
    state.runtimes[0].options.onFailure(Error('Plugin event loop stopped responding'));
    await vi.waitFor(() => expect(service.get(row.id)?.status).toBe('degraded'));
    if (operation === 'stop') service.stop();
    else await service[operation](row.id);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.runtimes).toHaveLength(1);
  });

  it('also bounds recovery when materializing the plugin throws before activation', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const changed = vi.fn();
    const { service, plugin } = fixture(changed);
    const row = await service.install(plugin);
    renameSync(join(plugin, 'package.json'), join(plugin, 'package.saved'));
    state.runtimes[0].options.onFailure(Error('Plugin event loop stopped responding'));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    for (const [index, delay] of [1_000, 2_000, 4_000].entries()) {
      await vi.advanceTimersByTimeAsync(delay);
      await vi.waitFor(() => expect(errors).toHaveBeenCalledTimes(index + 1));
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(errors).toHaveBeenCalledTimes(3);
    expect(state.runtimes).toHaveLength(1);
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

  it('does not undo disable during first builtin auto-install', async () => {
    const { dataDir } = fixture();
    const bundled = root();
    const builtin = join(bundled, 'custom-instructions');
    mkdirSync(builtin);
    writeFileSync(join(builtin, 'package.json'), JSON.stringify({ name: '@zcc-ext/custom-instructions', version: '0.1.0',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: { name: 'Instructions', description: 'Startup fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
    writeFileSync(join(builtin, 'server.mjs'), 'export default function () {}');
    const deferred = Promise.withResolvers<void>();
    state.scanGate = deferred.promise;
    const service = createPluginService({ dataDir, bundledRoot: bundled });
    services.push(service);
    const starting = service.start();
    await vi.waitFor(() => expect(service.get('custom-instructions')?.toolPolicy).toBe('unknown'));
    await vi.waitFor(() => expect(state.scanStarted).toHaveBeenCalled());
    const disabled = vi.fn();
    const disabling = service.disable('custom-instructions').then(disabled);
    try {
      // Disable invalidates the pending load immediately, then waits behind
      // the installation's lifecycle lock before persisting the final state.
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(disabled).not.toHaveBeenCalled();
    } finally { deferred.resolve(); }
    await Promise.all([starting, disabling]);
    expect(service.get('custom-instructions')).toMatchObject({ enabled: false, status: 'disabled' });
    expect(state.runtimes).toHaveLength(0);
  });
});
