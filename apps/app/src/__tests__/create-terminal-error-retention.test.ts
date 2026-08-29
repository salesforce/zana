import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useData, useUi } from '../store.js';

const spawn = vi.fn();

vi.mock('../lib/product-client.js', () => ({
  product: {
    threads: { spawn: (...args: unknown[]) => spawn(...args) }
  }
}));

beforeEach(() => {
  spawn.mockReset();
  useData.setState({ terminals: {}, projects: [{ id: 'project-1', name: 'P', path: '/tmp/p', createdAt: 1, lastActiveAt: 1 }] });
  useUi.setState({ toasts: [] });
});

describe('useData.createTerminal error retention', () => {
  it('reports a rejected launch to its caller while retaining the global toast', async () => {
    spawn.mockResolvedValue({ ok: false, code: 'LAUNCH_CONFLICT', message: 'Harness choices conflict' });
    const onError = vi.fn();

    const session = await useData.getState().createTerminal('project-1', 'claude', 80, 24, { onError });

    expect(session).toBeNull();
    expect(onError).toHaveBeenCalledWith('Harness choices conflict');
    expect(useUi.getState().toasts.at(-1)?.message).toBe('Harness choices conflict');
  });

  it('reports thrown preload errors to its caller', async () => {
    spawn.mockRejectedValue(new Error('IPC unavailable'));
    const onError = vi.fn();

    const session = await useData.getState().createTerminal('project-1', 'claude', 80, 24, { onError });

    expect(session).toBeNull();
    expect(onError).toHaveBeenCalledWith('IPC unavailable');
  });
});
