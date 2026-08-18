import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeliveryStore, deliveryDescriptorDigest } from '../delivery/store.js';

async function fixture(run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-delivery-'));
  try { await run(join(dir, 'delivery.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const descriptor = { version: 1 as const, executionId: 'execution-1', attempt: 1, outputDigest: 'sha256:out', extensionDigest: 'sha256:ext', policyResultDigest: 'sha256:policy', targetId: 'opaque-target', adapterId: 'none', adapterVersion: '1' };

describe('delivery store', () => {
  it('creates idempotent grants and requires current grant at dispatch', async () => fixture(async (filePath) => {
    let id = 0;
    const store = createDeliveryStore({ filePath, now: () => 10, id: () => `id-${++id}` });
    const digest = deliveryDescriptorDigest(descriptor);
    const granted = await store.grant({ executionId: 'execution-1', projectId: 'project-1', descriptorDigest: digest, expiresAt: 20, revocationEpoch: 0 });
    expect((await store.grant({ executionId: 'execution-1', projectId: 'project-1', descriptorDigest: digest, expiresAt: 20, revocationEpoch: 0 })).outcome).toBe('replay');
    const dispatched = await store.dispatch(granted.grant.id, digest, 0);
    await expect(store.dispatch(granted.grant.id, digest, 1)).rejects.toThrow('not current');
    await expect(store.receipt(dispatched.id, 'execution-1', 'project-1', 'receipt-1')).resolves.toMatchObject({ state: 'DELIVERED', receipt: 'receipt-1' });
  }));

  it('rejects expired grants and renews a matching expired descriptor grant', async () => fixture(async (filePath) => {
    let now = 10;
    let id = 0;
    const store = createDeliveryStore({ filePath, now: () => now, id: () => `id-${++id}` });
    const digest = deliveryDescriptorDigest(descriptor);
    await expect(store.grant({ executionId: 'execution-1', projectId: 'project-1', descriptorDigest: digest, expiresAt: 10, revocationEpoch: 0 })).rejects.toThrow('invalid delivery grant');
    const first = await store.grant({ executionId: 'execution-1', projectId: 'project-1', descriptorDigest: digest, expiresAt: 20, revocationEpoch: 0 });
    now = 21;
    const renewed = await store.grant({ executionId: 'execution-1', projectId: 'project-1', descriptorDigest: digest, expiresAt: 30, revocationEpoch: 0 });
    expect(first.grant.id).not.toBe(renewed.grant.id);
  }));
});
