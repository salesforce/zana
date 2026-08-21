import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { atomicDurableWrite } from '@zana-ai/zcc-server/services/harness-routing/storage';
import { createExecutionConsentStore, type ExecutionConsentBinding } from '../execution-consent-store.js';

const binding: ExecutionConsentBinding = {
  adapterId: 'codex',
  targetId: 'codex.execution.accept-edits',
  targetDigest: 'target-v1:abc',
  evidenceDigest: 'evidence-v1:def',
  projectId: 'p1',
  launchScope: 'local'
};

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-consent-'));
  try { await run(join(dir, 'consent.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

describe('execution consent store', () => {
  it('requires exact adapter, target, target digest, evidence, project, and scope bindings', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath, id: () => 'grant-1' });
    await store.grant({ ...binding, scope: 'project' });
    expect(await store.reserve({ ...binding, scope: 'project', idempotencyKey: 'ok' })).toMatchObject({ outcome: 'reserved' });
    for (const patch of [
      { adapterId: 'claude-code' }, { targetId: 'other' }, { targetDigest: 'changed' },
      { evidenceDigest: 'changed' }, { projectId: 'p2' }, { launchScope: 'remote' as const }
    ]) {
      expect(await store.reserve({ ...binding, scope: 'project', idempotencyKey: JSON.stringify(patch), ...patch })).toEqual({ outcome: 'denied' });
    }
  }));

  it('makes reserve idempotent and lets only one concurrent claim win', async () => fixture(async (filePath) => {
    let id = 0;
    const store = createExecutionConsentStore({ filePath, id: () => `id-${++id}` });
    await store.grant({ ...binding, scope: 'one-launch' });
    const first = await store.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-1' });
    const replay = await store.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-1' });
    expect(first).toMatchObject({ outcome: 'reserved' });
    expect(replay).toEqual(first);
    expect(await store.reserve({ ...binding, targetDigest: 'changed', scope: 'one-launch', idempotencyKey: 'launch-1' })).toEqual({ outcome: 'denied' });
    if (first.outcome !== 'reserved') throw new Error('expected reservation');
    const claims = await Promise.all([store.claim(first.reservation.id), store.claim(first.reservation.id)]);
    expect(claims.filter((claim) => claim.outcome === 'claimed')).toHaveLength(1);
    expect(claims.filter((claim) => claim.outcome === 'denied')).toHaveLength(1);
    expect(await store.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-2' })).toEqual({ outcome: 'denied' });
  }));

  it('serializes competing one-launch reservations so only one wins', async () => fixture(async (filePath) => {
    let id = 0;
    const store = createExecutionConsentStore({ filePath, id: () => `id-${++id}` });
    await store.grant({ ...binding, scope: 'one-launch' });
    const reservations = await Promise.all([
      store.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-a' }),
      store.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-b' })
    ]);
    expect(reservations.filter((reservation) => reservation.outcome === 'reserved')).toHaveLength(1);
    expect(reservations.filter((reservation) => reservation.outcome === 'denied')).toHaveLength(1);
  }));

  it('serializes separate store instances against the same durable file', async () => fixture(async (filePath) => {
    let id = 0;
    const options = { filePath, id: () => `id-${++id}` };
    const firstStore = createExecutionConsentStore(options);
    const secondStore = createExecutionConsentStore(options);
    await firstStore.grant({ ...binding, scope: 'one-launch' });
    const reservations = await Promise.all([
      firstStore.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-a' }),
      secondStore.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-b' })
    ]);
    expect(reservations.filter((reservation) => reservation.outcome === 'reserved')).toHaveLength(1);
    expect(reservations.filter((reservation) => reservation.outcome === 'denied')).toHaveLength(1);
  }));

  it('keeps an unclaimed reservation durable across restart and retention pressure', async () => fixture(async (filePath) => {
    let id = 0;
    const initial = createExecutionConsentStore({ filePath, id: () => `id-${++id}`, maxReservations: 0 });
    await initial.grant({ ...binding, scope: 'one-launch' });
    const reserved = await initial.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-1' });
    if (reserved.outcome !== 'reserved') throw new Error('expected reservation');

    const restarted = createExecutionConsentStore({ filePath, id: () => `id-${++id}`, maxReservations: 0 });
    expect(await restarted.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-1' })).toEqual(reserved);
    expect(await restarted.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-2' })).toEqual({ outcome: 'denied' });
    await restarted.release(reserved.reservation.id);
    expect(await restarted.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-2' })).toMatchObject({ outcome: 'reserved' });
  }));

  it('replays a durable reservation after response loss', async () => fixture(async (filePath) => {
    let id = 0;
    const initial = createExecutionConsentStore({ filePath, id: () => `id-${++id}` });
    await initial.grant({ ...binding, scope: 'one-launch' });
    const lossy = createExecutionConsentStore({
      filePath,
      id: () => `id-${++id}`,
      durableWrite: (target, bytes, options) => {
        atomicDurableWrite(target, bytes, options);
        throw new Error('response lost after durable reservation');
      }
    });
    await expect(lossy.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-1' }))
      .rejects.toThrow('response lost after durable reservation');

    const restarted = createExecutionConsentStore({ filePath, id: () => `id-${++id}` });
    const replay = await restarted.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-1' });
    expect(replay).toMatchObject({
      outcome: 'reserved',
      reservation: { id: 'id-2', idempotencyKey: 'launch-1' }
    });
    expect(await restarted.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-2' })).toEqual({ outcome: 'denied' });
  }));

  it('keeps one-launch consent consumed when process fails after durable claim', async () => fixture(async (filePath) => {
    let id = 0;
    const initial = createExecutionConsentStore({ filePath, id: () => `id-${++id}` });
    await initial.grant({ ...binding, scope: 'one-launch' });
    const reserved = await initial.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-1' });
    if (reserved.outcome !== 'reserved') throw new Error('expected reservation');

    const crashing = createExecutionConsentStore({
      filePath,
      id: () => `id-${++id}`,
      durableWrite: (target, bytes, options) => {
        atomicDurableWrite(target, bytes, options);
        throw new Error('crash after durable rename');
      }
    });
    await expect(crashing.claim(reserved.reservation.id)).rejects.toThrow('crash after durable rename');

    const restarted = createExecutionConsentStore({ filePath, id: () => `id-${++id}` });
    expect(await restarted.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-2' })).toEqual({ outcome: 'denied' });
    const state = await restarted.list();
    expect(state.grants[0].consumedAt).toEqual(expect.any(Number));
    expect(state.reservations[0].claimedAt).toEqual(expect.any(Number));
  }));

  it('idempotently consumes a ledger-owned expired reservation after restart', async () => fixture(async (filePath) => {
    let now = 100;
    let id = 0;
    const initial = createExecutionConsentStore({ filePath, now: () => now, id: () => `id-${++id}`, reservationTtlMs: 10 });
    await initial.grant({ ...binding, scope: 'one-launch' });
    const reserved = await initial.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-1' });
    if (reserved.outcome !== 'reserved') throw new Error('expected reservation');
    now = 200;

    const restarted = createExecutionConsentStore({ filePath, now: () => now });
    expect(await restarted.consume(reserved.reservation.id)).toMatchObject({ outcome: 'consumed' });
    expect(await restarted.consume(reserved.reservation.id)).toMatchObject({ outcome: 'consumed' });
    expect(await restarted.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-2' })).toEqual({ outcome: 'denied' });
  }));

  it('leaves reservation claimable when durable claim fails before rename', async () => fixture(async (filePath) => {
    let id = 0;
    const initial = createExecutionConsentStore({ filePath, id: () => `id-${++id}` });
    await initial.grant({ ...binding, scope: 'one-launch' });
    const reserved = await initial.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch-1' });
    if (reserved.outcome !== 'reserved') throw new Error('expected reservation');

    const failing = createExecutionConsentStore({
      filePath,
      durableWrite: () => { throw new Error('disk full'); }
    });
    await expect(failing.claim(reserved.reservation.id)).rejects.toThrow('disk full');
    const restarted = createExecutionConsentStore({ filePath });
    expect(await restarted.claim(reserved.reservation.id)).toMatchObject({ outcome: 'claimed' });
    expect((await readdir(dirname(filePath))).filter((name) => name.includes('.tmp-'))).toEqual([]);
  }));

  it('releases reservations and expires stale reservations and grants', async () => fixture(async (filePath) => {
    let now = 100;
    let id = 0;
    const store = createExecutionConsentStore({ filePath, now: () => now, id: () => `id-${++id}`, reservationTtlMs: 10 });
    await store.grant({ ...binding, scope: 'one-launch', expiresAt: 200 });
    const first = await store.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'one' });
    if (first.outcome !== 'reserved') throw new Error('expected reservation');
    await store.release(first.reservation.id);
    expect(await store.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'two' })).toMatchObject({ outcome: 'reserved' });
    now = 111;
    expect(await store.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'three' })).toMatchObject({ outcome: 'reserved' });
    now = 201;
    expect(await store.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'four' })).toEqual({ outcome: 'denied' });
  }));

  it('keeps project grants reusable while enforcing project scope', async () => fixture(async (filePath) => {
    let id = 0;
    const store = createExecutionConsentStore({ filePath, id: () => `id-${++id}` });
    await store.grant({ ...binding, scope: 'project' });
    for (const key of ['a', 'b']) {
      const reserved = await store.reserve({ ...binding, scope: 'project', idempotencyKey: key });
      if (reserved.outcome !== 'reserved') throw new Error('expected reservation');
      expect(await store.claim(reserved.reservation.id)).toMatchObject({ outcome: 'claimed' });
    }
    expect(await store.reserve({ ...binding, projectId: 'p2', scope: 'project', idempotencyKey: 'other-project' })).toEqual({ outcome: 'denied' });
  }));

  it('ignores legacy global grants and removes them on the next durable write', async () => fixture(async (filePath) => {
    await writeFile(filePath, JSON.stringify({
      version: 1,
      grants: [
        { id: 'legacy-global', ...binding, scope: 'global', createdAt: 1 },
        { id: 'project-grant', ...binding, scope: 'project', createdAt: 1 }
      ],
      reservations: [
        { id: 'legacy-reservation', grantId: 'legacy-global', idempotencyKey: 'legacy', createdAt: 1, expiresAt: 10_000 },
        { id: 'project-reservation', grantId: 'project-grant', idempotencyKey: 'project', createdAt: 1, expiresAt: 10_000, claimedAt: 2 }
      ]
    }), 'utf8');
    const store = createExecutionConsentStore({ filePath, now: () => 100, id: () => 'new-project-grant' });

    expect(await store.list()).toEqual({
      grants: [expect.objectContaining({ id: 'project-grant', scope: 'project' })],
      reservations: [expect.objectContaining({ id: 'project-reservation', grantId: 'project-grant' })]
    });
    expect(await store.reserve({
      ...binding, scope: 'global', idempotencyKey: 'legacy-reuse'
    } as unknown as Parameters<typeof store.reserve>[0])).toEqual({ outcome: 'denied' });

    await store.grant({ ...binding, scope: 'project' });
    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as { grants: Array<{ scope: string }>; reservations: Array<{ grantId: string }> };
    expect(persisted.grants.map(({ scope }) => scope)).toEqual(['project', 'project']);
    expect(persisted.reservations.map(({ grantId }) => grantId)).toEqual(['project-grant']);
  }));

  it('rejects unsupported scopes instead of persisting them', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath });
    await expect(store.grant({ ...binding, scope: 'global' } as unknown as Parameters<typeof store.grant>[0]))
      .rejects.toThrow('unsupported execution consent scope');
    expect(await store.reserve({ ...binding, scope: 'global', idempotencyKey: 'global' } as unknown as Parameters<typeof store.reserve>[0]))
      .toEqual({ outcome: 'denied' });
    expect(await store.list()).toEqual({ grants: [], reservations: [] });
  }));

  it('revokes grants and fails closed without leaking malformed contents', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath, id: () => 'grant-1' });
    const grant = await store.grant({ ...binding, scope: 'project' });
    await store.revoke(grant.id);
    expect(await store.reserve({ ...binding, scope: 'project', idempotencyKey: 'after-revoke' })).toEqual({ outcome: 'denied' });
    await writeFile(filePath, '{secret malformed content', 'utf8');
    await expect(store.list()).rejects.toThrow('corrupt execution consent store');
    await expect(store.grant({ ...binding, scope: 'project' })).rejects.toThrow('corrupt execution consent store');
    await expect(store.reserve({ ...binding, scope: 'project', idempotencyKey: 'corrupt' })).rejects.toThrow('corrupt execution consent store');
    await expect(store.list()).rejects.not.toThrow('secret malformed content');
    expect(await readFile(filePath, 'utf8')).toBe('{secret malformed content');
  }));

  it('atomically revokes only a project-scoped grant with matching project identity', async () => fixture(async (filePath) => {
    const store = createExecutionConsentStore({ filePath, id: () => 'grant-1' });
    const grant = await store.grant({ ...binding, scope: 'project' });

    expect(await store.revokeProject(grant.id, 'p2')).toBe(false);
    expect(await store.reserve({ ...binding, scope: 'project', idempotencyKey: 'still-active' }))
      .toMatchObject({ outcome: 'reserved' });
    expect(await store.revokeProject(grant.id, 'p1')).toBe(true);
    expect(await store.reserve({ ...binding, scope: 'project', idempotencyKey: 'revoked' }))
      .toEqual({ outcome: 'denied' });
  }));
});
