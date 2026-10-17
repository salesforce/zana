import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { consumeAuthenticatedNonce, PeerReplayWindow, PEER_FUTURE_SKEW_MS, PEER_REQUEST_TTL_MS, validateReplayState } from './peer-replay-window.js';

const directories: string[] = [];
const key = Buffer.alloc(32, 17);
const nonce = { pairId: 'pair-a', senderId: 'instance-a', epoch: 1, nonce: 'n'.repeat(24), issuedAt: 1_000_000 };
async function fixture(maxNonces?: number) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'peer-replay-')));
  directories.push(directory);
  let now = nonce.issuedAt;
  const options = { directory, localInstanceId: 'instance-b', keyProvider: { getKey: async () => key }, now: () => now, maxNonces };
  return { directory, restart: () => new PeerReplayWindow(options), time: (value: number) => { now = value; } };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('PeerReplayWindow', () => {
  it('fails closed for unsigned compatibility calls and missing durable storage', async () => {
    expect(new PeerReplayWindow().consume('pair-a', nonce.nonce, nonce.issuedAt)).toBe(false);
    await expect(new PeerReplayWindow().consumeAuthenticated(nonce)).rejects.toThrow('unavailable');
  });

  it('persists authenticated nonce before success and rejects it after real disk restart', async () => {
    const f = await fixture();
    expect(await f.restart().consumeAuthenticated(nonce)).toBe(true);
    expect(await f.restart().consumeAuthenticated(nonce)).toBe(false);
    f.time(nonce.issuedAt + PEER_REQUEST_TTL_MS);
    expect(await f.restart().consumeAuthenticated(nonce)).toBe(false);
    expect(await f.restart().consumeAuthenticated({ ...nonce, issuedAt: nonce.issuedAt + PEER_REQUEST_TTL_MS })).toBe(true);
  });

  it('does not reset clock or accept old packets when wall clock rolls back after restart', async () => {
    const f = await fixture();
    expect(await f.restart().consumeAuthenticated(nonce)).toBe(true);
    f.time(nonce.issuedAt - 1);
    expect(await f.restart().consumeAuthenticated({ ...nonce, nonce: 'x'.repeat(24) })).toBe(false);
  });

  it('bounds capacity without evicting live entries; permits prune only past signed expiry', async () => {
    const f = await fixture(1), window = f.restart();
    expect(await window.consumeAuthenticated(nonce)).toBe(true);
    expect(await window.consumeAuthenticated({ ...nonce, nonce: 'x'.repeat(24) })).toBe(false);
    f.time(nonce.issuedAt + PEER_REQUEST_TTL_MS);
    expect(await window.consumeAuthenticated({ ...nonce, nonce: 'x'.repeat(24), issuedAt: nonce.issuedAt + PEER_REQUEST_TTL_MS })).toBe(true);
  });

  it('serializes concurrent duplicate consumes across separate instances', async () => {
    const f = await fixture();
    expect((await Promise.all(Array.from({ length: 12 }, () => f.restart().consumeAuthenticated(nonce)))).filter(Boolean)).toHaveLength(1);
  });

  it('rejects corruption, missing initialized snapshot and unavailable/wrong keys', async () => {
    const f = await fixture();
    await f.restart().consumeAuthenticated(nonce);
    const path = join(f.directory, 'replay-v2.bin'), bytes = await readFile(path);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    await writeFile(path, bytes);
    await expect(f.restart().consumeAuthenticated(nonce)).rejects.toThrow('corrupt');
    await rm(path);
    await expect(f.restart().consumeAuthenticated(nonce)).rejects.toThrow('missing after initialization');
    const options = { directory: f.directory, localInstanceId: 'instance-b', keyProvider: { getKey: async () => null } };
    await expect(new PeerReplayWindow(options).consumeAuthenticated(nonce)).rejects.toThrow('unavailable');
  });

  it('enforces exact age/future limits, identities, safe timestamps, epoch, and strict nonce shape', () => {
    const now = nonce.issuedAt, state = () => ({ clock: 0, nonces: [] });
    for (const patch of [
      { issuedAt: now - PEER_REQUEST_TTL_MS }, { issuedAt: now + PEER_FUTURE_SKEW_MS + 1 },
      { issuedAt: NaN }, { issuedAt: -1 }, { issuedAt: Number.MAX_SAFE_INTEGER + 1 },
      { epoch: 0 }, { epoch: 1.1 }, { pairId: '../escape' }, { senderId: '' }, { nonce: 'short' }, { extra: true }
    ]) expect(consumeAuthenticatedNonce(state(), { ...nonce, ...patch }, now)).toBe(false);
    expect(consumeAuthenticatedNonce(state(), { ...nonce, issuedAt: now - PEER_REQUEST_TTL_MS + 1 }, now)).toBe(true);
    expect(consumeAuthenticatedNonce(state(), { ...nonce, issuedAt: now + PEER_FUTURE_SKEW_MS }, now)).toBe(true);
    expect(consumeAuthenticatedNonce(state(), nonce, NaN)).toBe(false);
    expect(() => new PeerReplayWindow({ directory: '/tmp/x', localInstanceId: 'b', keyProvider: { getKey: async () => key }, maxNonces: 0 })).toThrow('capacity');
  });

  it('validates persisted replay state and distinct pair/sender/epoch nonce namespaces', () => {
    const state = { clock: nonce.issuedAt, nonces: [] as typeof nonce[] };
    expect(consumeAuthenticatedNonce(state, nonce, nonce.issuedAt)).toBe(true);
    expect(consumeAuthenticatedNonce(state, { ...nonce, epoch: 2 }, nonce.issuedAt)).toBe(true);
    expect(consumeAuthenticatedNonce(state, { ...nonce, pairId: 'pair-b' }, nonce.issuedAt)).toBe(true);
    expect(consumeAuthenticatedNonce(state, { ...nonce, senderId: 'instance-c' }, nonce.issuedAt)).toBe(true);
    expect(() => validateReplayState(state)).not.toThrow();
    for (const invalid of [{ clock: -1, nonces: [] }, { clock: 0, nonces: [nonce] },
      { clock: nonce.issuedAt, nonces: [nonce, nonce] }, { clock: 0, nonces: Array(10_001).fill(nonce) }]) {
      expect(() => validateReplayState(invalid)).toThrow('invalid');
    }
  });
});
