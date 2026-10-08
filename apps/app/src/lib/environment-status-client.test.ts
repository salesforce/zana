import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceStatus } from '@zana-ai/zcc-domain';
import { createEnvironmentStatusClient, ENVIRONMENT_STATUS_REUSE_MS } from './environment-status-client.js';

const status = (branchName: string) => ({ branchName } as unknown as WorkspaceStatus);

function setup(fetchStatus = vi.fn(async (id: string) => status(id))) {
  let clock = 10_000;
  let hidden = false;
  const client = createEnvironmentStatusClient({
    fetchStatus,
    now: () => clock,
    isHidden: () => hidden,
    reuseMs: 1_000,
    minBackoffMs: 2_000,
    maxBackoffMs: 8_000
  });
  return {
    client,
    fetchStatus,
    advance: (ms: number) => { clock += ms; },
    hide: (value: boolean) => { hidden = value; }
  };
}

describe('environment status client', () => {
  it('joins concurrent callers and reuses a recent result', async () => {
    const { client, fetchStatus, advance } = setup();
    const [a, b] = await Promise.all([client.status('e1'), client.status('e1')]);
    expect(a).toBe(b);
    advance(999);
    expect(await client.status('e1')).toBe(a);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    advance(1);
    await client.status('e1');
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps environments separate', async () => {
    const { client, fetchStatus } = setup();
    expect((await client.status('e1')).branchName).toBe('e1');
    expect((await client.status('e2')).branchName).toBe('e2');
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('serves the last result without a request while the window is hidden', async () => {
    const { client, fetchStatus, advance, hide } = setup();
    const first = await client.status('e1');
    hide(true);
    advance(60_000);
    expect(await client.status('e1')).toBe(first);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    hide(false);
    await client.status('e1');
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it('still fetches while hidden when nothing is cached', async () => {
    const { client, fetchStatus, hide } = setup();
    hide(true);
    await client.status('e1');
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially after failures and resets on success', async () => {
    const fetchStatus = vi.fn<(id: string) => Promise<WorkspaceStatus>>().mockRejectedValue(new Error('timeout'));
    const { client, advance } = setup(fetchStatus);
    await expect(client.status('e1')).rejects.toThrow('timeout');
    advance(1_999);
    await expect(client.status('e1')).rejects.toThrow('timeout');
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    advance(1);
    await expect(client.status('e1')).rejects.toThrow('timeout');
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    advance(3_999); // second failure: 4s
    await expect(client.status('e1')).rejects.toThrow();
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    advance(1);
    await expect(client.status('e1')).rejects.toThrow();
    advance(8_000); // third failure: 8s; fourth would be capped at 8s
    await expect(client.status('e1')).rejects.toThrow();
    advance(8_000);
    fetchStatus.mockResolvedValueOnce(status('ok'));
    expect((await client.status('e1')).branchName).toBe('ok');
    expect(fetchStatus).toHaveBeenCalledTimes(5);
    advance(1_000);
    fetchStatus.mockRejectedValueOnce(new Error('again'));
    await expect(client.status('e1')).rejects.toThrow('again');
    advance(2_000); // back to the minimum delay after a success
    fetchStatus.mockResolvedValueOnce(status('ok2'));
    expect((await client.status('e1')).branchName).toBe('ok2');
  });

  it('refetches after invalidate and ignores a superseded request', async () => {
    let resolveOld!: (value: WorkspaceStatus) => void;
    const fetchStatus = vi.fn<(id: string) => Promise<WorkspaceStatus>>()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(status('new'));
    const { client } = setup(fetchStatus);
    const old = client.status('e1');
    client.invalidate('e1');
    const fresh = await client.status('e1');
    resolveOld(status('old'));
    expect((await old).branchName).toBe('old');
    expect(fresh.branchName).toBe('new');
    expect(await client.status('e1')).toBe(fresh);
  });

  it('ignores a failure from a superseded request', async () => {
    let rejectOld!: (error: Error) => void;
    const fetchStatus = vi.fn<(id: string) => Promise<WorkspaceStatus>>()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }))
      .mockResolvedValue(status('new'));
    const { client } = setup(fetchStatus);
    const old = client.status('e1');
    client.invalidate('e1');
    await client.status('e1');
    rejectOld(new Error('late'));
    await expect(old).rejects.toThrow('late');
    expect((await client.status('e1')).branchName).toBe('new');
  });

  it('bounds the number of cached environments', async () => {
    const { client, fetchStatus } = setup();
    for (let index = 0; index <= 64; index++) await client.status(`e${index}`);
    await client.status('e0');
    expect(fetchStatus).toHaveBeenCalledTimes(66);
  });

  it('defaults to document visibility and a short reuse window', async () => {
    const fetchStatus = vi.fn(async () => status('x'));
    const client = createEnvironmentStatusClient({ fetchStatus });
    await client.status('e1');
    await client.status('e1');
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(ENVIRONMENT_STATUS_REUSE_MS).toBeLessThanOrEqual(3_000);
  });
});
