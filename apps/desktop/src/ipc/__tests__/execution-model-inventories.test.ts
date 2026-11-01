import { beforeEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { IPC } from '@zana-ai/zcc-desktop-contract';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, { run: (...args: unknown[]) => unknown; fallback: () => unknown }>(),
  verifyState: { cache: undefined as undefined | { expiresAt: number; result: unknown } },
  config: vi.fn(),
  verify: vi.fn(),
  refresh: vi.fn(),
  discover: vi.fn(),
  descriptors: vi.fn(),
}));

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../ctx.js', () => ({ ctx: {
  safeHandle: (channel: string, run: (...args: unknown[]) => unknown, fallback: () => unknown) => {
    mocks.handlers.set(channel, { run, fallback });
  },
} }));
vi.mock('../shared.js', () => ({ harnessVerifyState: mocks.verifyState }));
vi.mock('@zana-ai/zcc-host-daemon/harness-auth', () => ({ getHarnessAuthStatus: vi.fn(), setHarnessAuth: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/harness/effective-default', () => ({ resolveEffectiveHarnessDefault: vi.fn() }));
vi.mock('@zana-ai/zcc-host-daemon/harness/harness-verify', () => ({ verifyHarnesses: mocks.verify }));
vi.mock('@zana-ai/zcc-host-daemon/harness/registry', () => ({
  harnessAdapterDescriptorsFromVerify: mocks.descriptors,
  refreshDynamicHarnessCatalogs: mocks.refresh,
  discoverHarnessModelInventories: mocks.discover,
  registrationFor: vi.fn(),
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { getConfig: mocks.config } }));

import { registerExecutionIpc } from '../execution.js';

describe('main-owned harness descriptor model inventories', () => {
  const availability = [{ family: 'opencode', installed: true, enabled: true }];
  const config = { harnesses: { byId: { opencode: { binary: '/trusted/opencode' } } } };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.handlers.clear();
    mocks.verifyState.cache = undefined;
    mocks.config.mockReturnValue(config);
    mocks.verify.mockResolvedValue(availability);
    mocks.refresh.mockResolvedValue(undefined);
    registerExecutionIpc();
  });

  it('awaits verified catalog refresh before discovering models with main config and HOME', async () => {
    let finishRefresh!: () => void;
    mocks.refresh.mockReturnValue(new Promise<void>(resolve => { finishRefresh = resolve; }));
    const inventory = [{ family: 'opencode', models: ['native/model'] }];
    const result = [{ id: 'opencode', models: [{ id: 'native/model' }] }];
    mocks.discover.mockResolvedValue(inventory);
    mocks.descriptors.mockReturnValue(result);

    const pending = mocks.handlers.get(IPC.harness.descriptors)!.run('/renderer/supplied/path');
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith(availability));
    expect(mocks.discover).not.toHaveBeenCalled();
    finishRefresh();

    await expect(pending).resolves.toBe(result);
    expect(mocks.verify).toHaveBeenCalledWith(config);
    expect(mocks.discover).toHaveBeenCalledWith(availability, { cwd: homedir(), config });
    expect(mocks.descriptors).toHaveBeenCalledWith(availability, inventory);
  });

  it('refreshes model inventories on each request even while executable verification is cached', async () => {
    const firstInventory = [{ family: 'opencode', models: ['native/old'] }];
    const nextInventory = [{ family: 'opencode', models: [] }];
    const nextConfig = { harnesses: { byId: { opencode: { binary: '/trusted/replacement' } } } };
    mocks.discover.mockResolvedValueOnce(firstInventory).mockResolvedValueOnce(nextInventory);
    const handler = mocks.handlers.get(IPC.harness.descriptors)!;
    await handler.run();
    mocks.config.mockReturnValue(nextConfig);
    await handler.run();

    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.discover).toHaveBeenCalledTimes(2);
    expect(mocks.discover).toHaveBeenLastCalledWith(availability, { cwd: homedir(), config: nextConfig });
    expect(mocks.descriptors).toHaveBeenLastCalledWith(availability, nextInventory);
  });

  it('does not assemble stale descriptors when discovery fails and registers an empty safe fallback', async () => {
    mocks.discover.mockRejectedValue(new Error('host discovery unavailable'));
    const handler = mocks.handlers.get(IPC.harness.descriptors)!;

    await expect(handler.run()).rejects.toThrow('host discovery unavailable');
    expect(mocks.descriptors).not.toHaveBeenCalled();
    expect(handler.fallback()).toEqual([]);
  });
});
