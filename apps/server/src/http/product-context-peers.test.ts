import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createProductHttpContext, type ProductHttpContext } from './product-context.js';

const roots: string[] = [], contexts: ProductHttpContext[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) { ctx.hostHub.close(); ctx.dispose(); await ctx.whenIdle(); ctx.db.close(); }
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const root = () => { const dir = mkdtempSync(join(tmpdir(), 'zcc-peer-context-')); roots.push(dir); return dir; };
const grant = () => ({ pairId: randomUUID(), remoteInstanceId: randomUUID(), pluginId: 'test-plugin', scope: 'test-scope', targetHostId: randomUUID(), proposalId: randomUUID() });
it('pairs use durable product identity, injected protected key, and no invented transfer authority', async () => {
  const dir = root(), key = randomBytes(32), dispose = vi.fn();
  const create = () => { const ctx = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 }, peerKeyProvider: { getKey: async () => key, dispose } }); contexts.push(ctx); return ctx; };
  const ctx = create(), input = grant(), pair = await ctx.peerPairs.create(input);
  expect(pair.localInstanceId).toBe(ctx.productInstanceId);
  await expect(ctx.peerPairs.exportCredential(pair.pairId, {})).rejects.toThrow('peer credential unavailable');
  ctx.dispose();
  expect(dispose).toHaveBeenCalledOnce();
  await expect(ctx.peerPairs.grant(pair.pairId)).rejects.toThrow('peer pair store disposed');
  const restarted = create();
  expect(restarted.productInstanceId).toBe(ctx.productInstanceId);
  // Product-created grants without a persisted authority/generation binding cannot authorize data-plane reads.
  await expect(restarted.peerPairs.grant(pair.pairId)).resolves.toBeNull();
});
it('transient OS key startup failure retries without permanently disposing pair store', async () => {
  const key = randomBytes(32), dir = root(); let available = false;
  const provider = { getKey: vi.fn(async () => available ? key : null) };
  const ctx = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 }, peerKeyProvider: provider }); contexts.push(ctx);
  await vi.waitFor(() => expect(provider.getKey).toHaveBeenCalled());
  await expect(ctx.peerAuthority.recover()).rejects.toThrow('encryption key');
  available = true;
  ctx.hub.emit('hosts:changed', []);
  await expect(ctx.peerAuthority.recover()).resolves.toEqual({ pending: 0, blocked: 0 });
  const input = grant();
  await expect(ctx.peerPairs.propose(input)).resolves.toMatchObject({ pairId: input.pairId });
  expect(await ctx.peerPairs.grant(input.pairId)).toBeNull();
});
it('corrupt authority startup never silently resets or retries into an enabled store', async () => {
  const dir = root(), key = randomBytes(32), provider = { getKey: async () => key };
  const first = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 }, peerKeyProvider: provider }); contexts.push(first);
  await first.peerAuthority.revoke('absent-pair');
  first.dispose(); first.hostHub.close();
  const file = join(dir, 'peer-authority', 'authority-v1.bin'), damaged = readFileSync(file); damaged[damaged.length - 1]! ^= 1;
  writeFileSync(file, damaged);
  const restarted = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 }, peerKeyProvider: provider }); contexts.push(restarted);
  await vi.waitFor(async () => { await expect(restarted.peerPairs.grant('absent-pair')).rejects.toThrow('disposed'); });
  restarted.hub.emit('hosts:changed', []);
  await expect(restarted.peerAuthority.recover()).rejects.toThrow('corrupt');
  await expect(restarted.peerPairs.create(grant())).rejects.toThrow('disposed');
  expect(readFileSync(file)).toEqual(damaged);
});
it.each(['absent', 'unavailable', 'short', 'throws'])('peer storage fails closed when host key is %s', async mode => {
  const dir = root(), ctx = createProductHttpContext({ dataDir: dir, origins: { serverPort: 0 },
    peerKeyProvider: mode === 'absent' ? undefined : { getKey: async () => {
      if (mode === 'throws') throw new Error('secret backend detail');
      return mode === 'short' ? randomBytes(31) : null;
    } } }); contexts.push(ctx);
  await expect(ctx.peerPairs.create(grant())).rejects.toThrow(/peer encryption key/);
  expect(existsSync(join(dir, 'peer-pairs'))).toBe(false);
});
