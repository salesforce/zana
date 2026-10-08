import { describe, expect, it, vi } from 'vitest';

const createHostWatcher = vi.fn(() => ({}));
vi.mock('@zana-ai/zcc-host-watcher', () => ({ createHostWatcher }));

describe('workspace-fs-watch', () => {
  it('shares one watcher until disposed', async () => {
    const { hostFsWatcher, disposeHostFsWatcher } = await import('./workspace-fs-watch.js');
    const first = hostFsWatcher();
    expect(hostFsWatcher()).toBe(first);
    expect(createHostWatcher).toHaveBeenCalledTimes(1);
    await disposeHostFsWatcher();
    expect(hostFsWatcher()).not.toBe(first);
    expect(createHostWatcher).toHaveBeenCalledTimes(2);
  });
});
