import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startProductServer } from './product-server.js';

/**
 * Wiring of the SSH peer-link transport into the product context. The transport itself (sshd probe, authorized_keys,
 * ssh tunnel) is covered by its own unit tests; there is no seam to inject a fake transport into the context, so this
 * file only asserts what must hold without a link: the stores exist only with a key provider, and nothing listens
 * or is written for the peer forwarder until an A-side link asks for it.
 */
const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function start(withKey: boolean) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'peer-link-ctx-')));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const key = randomBytes(32);
  const server = await startProductServer({ dataDir: dir, origins: { serverPort: 0 }, ...(withKey ? { peerKeyProvider: { getKey: async () => key } } : {}) });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await server.close(); } };
  cleanup.push(close);
  return { dir, server, close };
}

it('has no peer links or invitations without a peer key provider', async () => {
  const { server } = await start(false);
  expect(server.ctx.peerLinks).toBeUndefined();
  expect(server.ctx.peerInvitations).toBeUndefined();
});

it('wires peer links and invitations with a key provider but starts no forwarder and writes no forwarder state', async () => {
  const { server, dir } = await start(true);
  expect(server.ctx.peerLinks).toBeDefined();
  expect(server.ctx.peerInvitations).toBeDefined();
  expect(await server.ctx.peerLinks!.links()).toEqual([]);
  // The forwarder lease is lazy: its remembered port file appears only once an A-side link acquired it.
  expect(existsSync(join(dir, 'peer-ssh', 'forwarder.json'))).toBe(false);
  await server.ctx.peerLinks!.sweep();
  expect(existsSync(join(dir, 'peer-ssh', 'forwarder.json'))).toBe(false);
});

it('shuts down cleanly with the transport wired, and a sweep after dispose is a no-op', async () => {
  const { server, close } = await start(true);
  const { peerLinks } = server.ctx;
  await close();
  await peerLinks!.sweep();
  await expect(peerLinks!.links()).rejects.toThrow('peer links disposed');
});
