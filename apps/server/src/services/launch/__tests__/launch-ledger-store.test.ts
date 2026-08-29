import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createLaunchLedgerStore,
  canTransitionLaunchLedger
} from '../ledger-store.js';
import { atomicDurableWrite } from '../../harness-routing/storage.js';
import { createExecutionConsentStore } from '@zana-ai/zcc-host-daemon/harness/execution-consent-store';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-launch-ledger-'));
  try { await run(join(dir, 'ledger.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

describe('launch ledger store', () => {
  it('serializes concurrent idempotency claims so one wins and exact replay returns prior entry', async () => fixture(async (filePath) => {
    let next = 0;
    const store = createLaunchLedgerStore({ filePath, now: () => 10, id: () => `entry-${++next}` });
    const results = await Promise.all([
      store.claim({ idempotencyKey: 'run:key', launchDigest: 'same', authorizationId: 'a1' }),
      store.claim({ idempotencyKey: 'run:key', launchDigest: 'same', authorizationId: 'a1' })
    ]);
    expect(results.filter((r) => r.outcome === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'replay')).toHaveLength(1);
    expect(results[0].entry.id).toBe(results[1].entry.id);
  }));

  it('rejects same idempotency key with a different digest', async () => fixture(async (filePath) => {
    const store = createLaunchLedgerStore({ filePath, id: () => 'entry-1' });
    await store.claim({ idempotencyKey: 'key', launchDigest: 'one', authorizationId: 'a1' });
    expect(await store.claim({ idempotencyKey: 'key', launchDigest: 'two', authorizationId: 'a2' })).toMatchObject({ outcome: 'conflict' });
  }));

  it('persists principal and complete authorization binding for audit/recovery', async () => fixture(async (filePath) => {
    const store = createLaunchLedgerStore({ filePath, id: () => 'entry-1' });
    const binding = {
      consumerKind: 'team-slot' as const, personaId: 'reviewer', teamId: 'squad', slotId: 'reviewer:0',
      evidenceDigest: 'evidence', initialTaskDigest: 'task', consentReservation: { id: 'reservation', scope: 'project' },
      scope: 'local' as const, storeRevision: 'stores', projectIdentityDigest: 'project', autonomous: true, expiresAt: 2_000
    };
    await store.claim({
      idempotencyKey: 'key', launchDigest: 'digest', authorizationId: 'auth',
      principal: { kind: 'team', id: 'run' }, binding
    });
    expect(await store.get('entry-1')).toMatchObject({ principal: { kind: 'team', id: 'run' }, binding });
  }));

  it('enforces explicit transitions and keeps terminal states immutable', async () => fixture(async (filePath) => {
    const store = createLaunchLedgerStore({ filePath, id: () => 'entry-1' });
    const claimed = await store.claim({ idempotencyKey: 'key', launchDigest: 'one', authorizationId: 'a1' });
    await store.transition(claimed.entry.id, 'committing');
    await store.transition(claimed.entry.id, 'launched');
    await store.transition(claimed.entry.id, 'exited');
    await expect(store.transition(claimed.entry.id, 'failed')).rejects.toThrow(/invalid launch ledger transition/);
    expect(canTransitionLaunchLedger('authorized', 'committing')).toBe(true);
    expect(canTransitionLaunchLedger('authorized', 'launched')).toBe(false);
    expect(canTransitionLaunchLedger('denied', 'committing')).toBe(false);
  }));

  it('retains at most configured newest entries', async () => fixture(async (filePath) => {
    let id = 0;
    const store = createLaunchLedgerStore({ filePath, maxEntries: 20, id: () => `entry-${++id}` });
    for (let i = 0; i < 25; i++) await store.claim({ idempotencyKey: `key-${i}`, launchDigest: `d-${i}`, authorizationId: `a-${i}` });
    const entries = await store.list();
    expect(entries).toHaveLength(20);
    expect(entries[0].idempotencyKey).toBe('key-5');
  }));

  it('fails closed on corrupt input without overwriting it', async () => fixture(async (filePath) => {
    await writeFile(filePath, '{not-json', 'utf8');
    const store = createLaunchLedgerStore({ filePath });
    await expect(store.list()).rejects.toThrow(/corrupt launch ledger/);
    await expect(store.claim({ idempotencyKey: 'key', launchDigest: 'd', authorizationId: 'a' })).rejects.toThrow(/corrupt launch ledger/);
    expect(await readFile(filePath, 'utf8')).toBe('{not-json');
  }));

  it('reconciles every nonterminal startup entry to interrupted and never respawns', async () => fixture(async (filePath) => {
    let id = 0;
    const initial = createLaunchLedgerStore({ filePath, id: () => `entry-${++id}`, now: () => 10 });
    const authorized = await initial.claim({ idempotencyKey: 'a', launchDigest: 'a', authorizationId: 'a' });
    const committing = await initial.claim({ idempotencyKey: 'b', launchDigest: 'b', authorizationId: 'b' });
    await initial.transition(committing.entry.id, 'committing');
    const launched = await initial.claim({ idempotencyKey: 'c', launchDigest: 'c', authorizationId: 'c' });
    await initial.transition(launched.entry.id, 'committing');
    await initial.transition(launched.entry.id, 'launched');

    const restarted = createLaunchLedgerStore({ filePath, now: () => 20 });
    const reconciled = await restarted.reconcileStartup();
    expect(reconciled.map((entry) => entry.id).sort()).toEqual([authorized.entry.id, committing.entry.id, launched.entry.id].sort());
    expect(reconciled.every((entry) => entry.state === 'interrupted')).toBe(true);
    expect((await restarted.get(launched.entry.id))?.state).toBe('interrupted');
  }));

  it('persists launch identity and reconciles consent plus persistent session before interrupting', async () => fixture(async (filePath) => {
    const initial = createLaunchLedgerStore({ filePath, id: () => 'entry-1', now: () => 10 });
    const claimed = await initial.claim({
      idempotencyKey: 'key', launchDigest: 'digest', authorizationId: 'auth',
      sessionId: 'session-1', consentReservationId: 'reservation-1'
    });
    await initial.transition(claimed.entry.id, 'committing');

    const calls: string[] = [];
    const restarted = createLaunchLedgerStore({ filePath, now: () => 20 });
    await restarted.reconcileStartup({
      consumeConsent: async (id) => { calls.push(`consume:${id}`); },
      reapSession: async (id) => { calls.push(`reap:${id}`); }
    });
    expect(calls).toEqual(['consume:reservation-1', 'reap:session-1']);
    expect(await restarted.get(claimed.entry.id)).toMatchObject({
      state: 'interrupted', sessionId: 'session-1', consentReservationId: 'reservation-1'
    });
  }));

  it('fails closed after restart between ledger ownership and consent consumption', async () => fixture(async (filePath) => {
    const consentPath = join(dirname(filePath), 'consent.json');
    let id = 0;
    const consent = createExecutionConsentStore({ filePath: consentPath, id: () => `consent-${++id}` });
    const binding = {
      adapterId: 'codex', targetId: 'target', targetDigest: 'target-digest',
      evidenceDigest: 'evidence-digest', projectId: 'p1', launchScope: 'local' as const
    };
    await consent.grant({ ...binding, scope: 'one-launch' });
    const reserved = await consent.reserve({ ...binding, scope: 'one-launch', idempotencyKey: 'launch:one-launch' });
    if (reserved.outcome !== 'reserved') throw new Error('expected reservation');

    const beforeCrash = createLaunchLedgerStore({ filePath, id: () => 'entry-1' });
    await beforeCrash.claim({
      idempotencyKey: 'launch', launchDigest: 'digest', authorizationId: 'auth',
      sessionId: 'session-1', consentReservationId: reserved.reservation.id
    });

    const restartedConsent = createExecutionConsentStore({ filePath: consentPath });
    const restartedLedger = createLaunchLedgerStore({ filePath });
    await restartedLedger.reconcileStartup({
      consumeConsent: (reservationId) => restartedConsent.consume(reservationId)
    });
    expect(await restartedConsent.reserve({
      ...binding, scope: 'one-launch', idempotencyKey: 'launch-2:one-launch'
    })).toEqual({ outcome: 'denied' });
  }));

  it('migrates draft array ledger to versioned durable state without losing entries', async () => fixture(async (filePath) => {
    await writeFile(filePath, JSON.stringify([{
      id: 'legacy-1', idempotencyKey: 'key', launchDigest: 'digest', authorizationId: 'auth',
      state: 'authorized', createdAt: 1, updatedAt: 1
    }]), 'utf8');
    const store = createLaunchLedgerStore({ filePath, now: () => 2 });
    await store.reconcileStartup();
    expect(await store.get('legacy-1')).toMatchObject({ state: 'interrupted', revision: 1 });
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
      version: 1, revision: 1, entries: [expect.objectContaining({ id: 'legacy-1' })]
    });
  }));

  it('enforces expected-state CAS on transitions', async () => fixture(async (filePath) => {
    const store = createLaunchLedgerStore({ filePath, id: () => 'entry-1' });
    const claimed = await store.claim({ idempotencyKey: 'key', launchDigest: 'digest', authorizationId: 'auth' });
    await store.transition(claimed.entry.id, 'committing', 'authorized');
    await expect(store.transition(claimed.entry.id, 'launched', 'authorized')).rejects.toThrow(/CAS rejected/);
    expect((await store.get(claimed.entry.id))?.state).toBe('committing');
  }));

  it('serializes separate store instances against same durable file', async () => fixture(async (filePath) => {
    const first = createLaunchLedgerStore({ filePath, id: () => 'entry-1' });
    const second = createLaunchLedgerStore({ filePath, id: () => 'entry-2' });
    const results = await Promise.all([
      first.claim({ idempotencyKey: 'key', launchDigest: 'digest', authorizationId: 'auth-1' }),
      second.claim({ idempotencyKey: 'key', launchDigest: 'digest', authorizationId: 'auth-2' })
    ]);
    expect(results.map(({ outcome }) => outcome).sort()).toEqual(['claimed', 'replay']);
    expect(await first.list()).toHaveLength(1);
  }));

  it('fails CAS instead of replacing an external edit between read and durable rename', async () => fixture(async (filePath) => {
    const initial = createLaunchLedgerStore({ filePath, id: () => 'entry-1' });
    const claimed = await initial.claim({ idempotencyKey: 'key', launchDigest: 'digest', authorizationId: 'auth' });
    let raced = false;
    const store = createLaunchLedgerStore({
      filePath,
      durableWrite: (target, bytes, options) => atomicDurableWrite(target, bytes, {
        ...options,
        beforeRename: () => {
          if (raced) return;
          raced = true;
          writeFileSync(target, '{"external":true}', 'utf8');
        }
      })
    });
    await expect(store.transition(claimed.entry.id, 'committing', 'authorized')).rejects.toThrow(/file changed/);
    expect(await readFile(filePath, 'utf8')).toBe('{"external":true}');
  }));
});
