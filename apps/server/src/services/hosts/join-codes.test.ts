import { describe, expect, it } from 'vitest';
import {
  JOIN_CODE_PREFIX,
  JOIN_CODE_TTL_MS,
  createJoinCodeStore
} from './join-codes.js';

describe('join codes', () => {
  it('mints a hostId without requiring a later peek to keep the code', () => {
    const store = createJoinCodeStore();
    const issued = store.mint(1_000);
    expect(issued.joinCode.startsWith(JOIN_CODE_PREFIX)).toBe(true);
    expect(issued.hostId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(issued.expiresAt).toBe(1_000 + JOIN_CODE_TTL_MS);
    expect(store.peek(issued.joinCode, 1_000)?.hostId).toBe(issued.hostId);
  });

  it('redeems once and rejects expiry', () => {
    const store = createJoinCodeStore();
    const issued = store.mint(10);
    expect(store.redeem(issued.joinCode, 11)?.hostId).toBe(issued.hostId);
    expect(store.redeem(issued.joinCode, 12)).toBeNull();
    const expired = store.mint(10);
    expect(store.redeem(expired.joinCode, 10 + JOIN_CODE_TTL_MS)).toBeNull();
    expect(store.peek('missing', 10)).toBeNull();
  });

  it('mints a join code bound to an existing hostId', () => {
    const store = createJoinCodeStore();
    const hostId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const issued = store.mintForHost(hostId, 50);
    expect(issued.hostId).toBe(hostId);
    expect(store.redeem(issued.joinCode, 51)?.hostId).toBe(hostId);
  });

  it('rejects a non-UUID hostId for re-enroll', () => {
    const store = createJoinCodeStore();
    expect(() => store.mintForHost('not-a-uuid')).toThrow(/UUID/);
  });
});

it('persists only hashes, consumes once across reopened stores, and invalidates repair attempts', async () => {
  const { openDatabase } = await import('@zana-ai/zcc-db');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const dir = mkdtempSync(join(tmpdir(), 'durable-host-joins-')), file = join(dir, 'state.sqlite');
  let db = openDatabase(file);
  try {
    const issued = createJoinCodeStore(db).mint(1000);
    const id = createHash('sha256').update(issued.joinCode).digest('hex');
    expect(JSON.stringify(db.sqlite.prepare('SELECT * FROM host_join_codes').all())).not.toContain(issued.joinCode);
    db.close(); db = openDatabase(file);
    const first = createJoinCodeStore(db), second = createJoinCodeStore(db);
    expect(second.status(id, 1001)).toMatchObject({ hostId: issued.hostId, redeemedAt: null });
    expect(first.redeem(issued.joinCode, 1001)).toEqual(issued);
    expect(second.redeem(issued.joinCode, 1002)).toBeNull();
    expect(second.recovered(issued.joinCode, 1003)).toEqual(issued);
    expect(second.status(id, 1003)?.redeemedAt).toBe(1001);
    first.mintForHost(issued.hostId, 1004);
    expect(second.recovered(issued.joinCode, 1004)).toBeNull();
    expect(second.status(id, 1004)).toBeNull();
    first.invalidateHost(issued.hostId);
    expect(db.sqlite.prepare('SELECT * FROM host_join_codes').all()).toEqual([]);
    expect(first.status('invalid')).toBeNull();
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('bounds pending grants, prunes expired codes, and permits repair at capacity', () => {
  const store = createJoinCodeStore();
  const first = store.mint(1);
  for (let n = 1; n < 500; n++) store.mint(1);
  expect(() => store.mint(2)).toThrow('Too many');
  expect(store.mintForHost(first.hostId, 2).hostId).toBe(first.hostId);
  expect(store.mint(JOIN_CODE_TTL_MS + 3)).toBeTruthy();
  expect(store.recovered(first.joinCode, JOIN_CODE_TTL_MS + 3)).toBeNull();
});

describe('join code inspect', () => {
  it('reports each rejection reason and success without mutating state', () => {
    const store = createJoinCodeStore();
    const issued = store.mint(1_000);
    expect(store.inspect(issued.joinCode, undefined, 1_001)).toEqual({ ok: true, hostId: issued.hostId, expiresAt: issued.expiresAt });
    expect(store.inspect(issued.joinCode, issued.hostId, 1_001).ok).toBe(true);
    expect(store.inspect(issued.joinCode, '22222222-2222-4222-8222-222222222222', 1_001)).toEqual({ ok: false, reason: 'host_mismatch', hostId: issued.hostId });
    expect(store.inspect(issued.joinCode, undefined, 1_000 + JOIN_CODE_TTL_MS)).toEqual({ ok: false, reason: 'expired', hostId: issued.hostId });
    expect(store.inspect('nope', undefined, 1_001)).toEqual({ ok: false, reason: 'missing' });
    expect(store.inspect('', undefined, 1_001)).toEqual({ ok: false, reason: 'missing' });
    store.redeem(issued.joinCode, 1_002);
    expect(store.inspect(issued.joinCode, undefined, 1_003)).toEqual({ ok: false, reason: 'redeemed', hostId: issued.hostId });
  });

  it('collapses invalidated codes into missing because invalidation deletes the row', () => {
    const store = createJoinCodeStore();
    const issued = store.mint(1_000);
    store.invalidateHost(issued.hostId);
    expect(store.inspect(issued.joinCode, undefined, 1_001)).toEqual({ ok: false, reason: 'missing' });
  });
});
