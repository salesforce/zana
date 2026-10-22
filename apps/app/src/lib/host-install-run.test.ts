import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostBootstrapEvent } from '@zana-ai/zcc-desktop-contract';

const ui = vi.hoisted(() => ({
  openHostInstallDrawer: vi.fn(),
  appendHostInstallLogs: vi.fn(),
  applyHostInstallEvent: vi.fn(),
  finishHostInstallDrawer: vi.fn()
}));
vi.mock('../store.js', () => ({ useUi: { getState: () => ui } }));
vi.mock('../components/composer-host-status.js', () => ({
  bootstrapOutcome: (events: Array<{ ok?: boolean; pairingCommand?: string }>) => events[0] ?? { ok: true },
  composerBootstrapErrorMessage: () => 'bootstrap failed'
}));

async function load() {
  vi.resetModules();
  return import('./host-install-run.js');
}

describe('host install run', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retains the exact repair target through retries and never reuses it for a different drawer', async () => {
    const { runHostInstallWithDrawer, retryLastHostInstall, lastHostInstallRepairTarget } = await load();
    expect(lastHostInstallRepairTarget(null)).toBeNull();
    await runHostInstallWithDrawer({ kind: 'fix', target: 'box', repairTarget: { hostId: 'host-1' }, run: async () => [{ ok: false }] as never });
    await retryLastHostInstall();
    expect(lastHostInstallRepairTarget('box')).toEqual({ hostId: 'host-1' });
    expect(lastHostInstallRepairTarget('other')).toBeNull();
    await runHostInstallWithDrawer({ kind: 'install', target: 'box', run: async () => [{ ok: false }] as never });
    expect(lastHostInstallRepairTarget('box')).toBeNull();
  });

  it('retryLastHostInstall returns null before any run', async () => {
    const { retryLastHostInstall } = await load();
    await expect(retryLastHostInstall()).resolves.toBeNull();
    expect(ui.openHostInstallDrawer).not.toHaveBeenCalled();
  });

  it('retries the most recent run through the drawer', async () => {
    const { runHostInstallWithDrawer, retryLastHostInstall } = await load();
    const run = vi.fn(async (onEvent: (event: HostBootstrapEvent) => void) => {
      onEvent({} as HostBootstrapEvent);
      return [{ ok: true }] as unknown as HostBootstrapEvent[];
    });
    await runHostInstallWithDrawer({ kind: 'install', target: 'box', startLogs: ['go'], run } as never);
    await expect(retryLastHostInstall()).resolves.toEqual([{ ok: true }]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(ui.appendHostInstallLogs).toHaveBeenCalledWith(['go']);
    expect(ui.finishHostInstallDrawer).toHaveBeenLastCalledWith({ ok: true });
  });

  it('reports failed outcomes with and without a pairing command', async () => {
    const { runHostInstallWithDrawer } = await load();
    await runHostInstallWithDrawer({ kind: 'install', target: 'a', run: async () => [{ ok: false, pairingCommand: 'pair x' }] as never } as never);
    expect(ui.finishHostInstallDrawer).toHaveBeenLastCalledWith({ ok: false, message: 'bootstrap failed', pairingCommand: 'pair x' });
    await runHostInstallWithDrawer({ kind: 'install', target: 'a', run: async () => [{ ok: false }] as never } as never);
    expect(ui.finishHostInstallDrawer).toHaveBeenLastCalledWith({ ok: false, message: 'bootstrap failed' });
  });

  it('finishes the drawer and rethrows when run throws', async () => {
    const { runHostInstallWithDrawer } = await load();
    await expect(runHostInstallWithDrawer({ kind: 'install', target: 'a', run: async () => { throw new Error('boom'); } } as never)).rejects.toThrow('boom');
    expect(ui.finishHostInstallDrawer).toHaveBeenLastCalledWith({ ok: false, message: 'boom' });
    await expect(runHostInstallWithDrawer({ kind: 'install', target: 'a', run: async () => { throw 'x'; } } as never)).rejects.toBe('x');
    expect(ui.finishHostInstallDrawer).toHaveBeenLastCalledWith({ ok: false, message: 'Host install failed' });
  });

  it('runs onSettled after finishing the drawer, and replays it on retry', async () => {
    const { runHostInstallWithDrawer, retryLastHostInstall } = await load();
    const order: string[] = [];
    ui.finishHostInstallDrawer.mockImplementation(() => { order.push('finish'); });
    const onSettled = vi.fn(async () => { order.push('settled'); });
    const first = [{ ok: true }] as unknown as HostBootstrapEvent[];
    const second = [{ ok: false }] as unknown as HostBootstrapEvent[];
    const run = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await runHostInstallWithDrawer({ kind: 'fix', target: 'box', run, onSettled } as never);
    expect(onSettled).toHaveBeenLastCalledWith(first);
    expect(order).toEqual(['finish', 'settled']);
    await retryLastHostInstall();
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenLastCalledWith(second);
  });

  it('does not run onSettled when run throws', async () => {
    const { runHostInstallWithDrawer } = await load();
    const onSettled = vi.fn();
    await expect(runHostInstallWithDrawer({ kind: 'install', target: 'a', run: async () => { throw new Error('boom'); }, onSettled } as never)).rejects.toThrow('boom');
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('propagates onSettled errors without re-finishing the drawer as failed', async () => {
    const { runHostInstallWithDrawer } = await load();
    ui.finishHostInstallDrawer.mockReset();
    await expect(runHostInstallWithDrawer({ kind: 'install', target: 'a', run: async () => [{ ok: true }] as never, onSettled: () => { throw new Error('post'); } } as never)).rejects.toThrow('post');
    expect(ui.finishHostInstallDrawer).toHaveBeenCalledTimes(1);
    expect(ui.finishHostInstallDrawer).toHaveBeenLastCalledWith({ ok: true });
  });
});
