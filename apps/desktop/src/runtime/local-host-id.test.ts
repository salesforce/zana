import { describe, expect, it, vi } from 'vitest';
import { createLocalHostIdResolver } from './local-host-id.js';

describe('createLocalHostIdResolver', () => {
  it('prefers the enrolled supervisor identity', () => {
    const readPersistedHostId = vi.fn(() => 'persisted');
    const resolve = createLocalHostIdResolver({ supervisorHostId: () => 'enrolled', devAttach: () => true, readPersistedHostId });
    expect(resolve()).toBe('enrolled');
    expect(readPersistedHostId).not.toHaveBeenCalled();
  });

  it('stays undefined outside dev attach until the supervisor enrolls', () => {
    let enrolled: string | undefined;
    const readPersistedHostId = vi.fn(() => 'persisted');
    const resolve = createLocalHostIdResolver({ supervisorHostId: () => enrolled, devAttach: () => false, readPersistedHostId });
    expect(resolve()).toBeUndefined();
    enrolled = 'late';
    expect(resolve()).toBe('late');
    expect(readPersistedHostId).not.toHaveBeenCalled();
  });

  it('reads and caches the attached daemon identity in dev attach', () => {
    const readPersistedHostId = vi.fn(() => 'daemon-host');
    const resolve = createLocalHostIdResolver({ supervisorHostId: () => undefined, devAttach: () => true, readPersistedHostId });
    expect(resolve()).toBe('daemon-host');
    expect(resolve()).toBe('daemon-host');
    expect(readPersistedHostId).toHaveBeenCalledTimes(1);
  });

  it('retries the read while the attached daemon has not persisted an identity', () => {
    const readPersistedHostId = vi.fn<() => string | null>().mockReturnValueOnce(null).mockReturnValue('daemon-host');
    const resolve = createLocalHostIdResolver({ supervisorHostId: () => undefined, devAttach: () => true, readPersistedHostId });
    expect(resolve()).toBeUndefined();
    expect(resolve()).toBe('daemon-host');
  });
});
