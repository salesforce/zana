import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSeed } from '@zana-ai/zcc-host-daemon/ssh-keys';
import { createPeerSshTransport, PEER_LINK_KEY_GRACE_MS, PEER_LINK_MAX_KEYS, type PeerSshTransportHandle } from './peer-ssh-transport.js';
import type { AuthorizedKeys, PeerSshEndpoint } from './peer-ssh-contract.js';

const endpoint: PeerSshEndpoint = { host: 'alice.local', port: 22, user: 'alice', hostKey: `ssh-ed25519 ${'A'.repeat(68)}` };
const PUB = /^ssh-ed25519 [A-Za-z0-9+/]{68}$/;

let dir: string;
let transport: PeerSshTransportHandle;
const cleanups: Array<() => unknown> = [];

function setup(overrides: { openPeerLink?: ReturnType<typeof vi.fn>; preflight?: ReturnType<typeof vi.fn>; now?: () => number } = {}) {
  const forwarder = { acquire: vi.fn(async () => 45_678), release: vi.fn(async () => undefined) };
  const authorizedKeys: AuthorizedKeys = { upsert: vi.fn(), remove: vi.fn(), reconcile: vi.fn(), list: vi.fn(async () => []) };
  const link = { url: 'http://127.0.0.1:41000/', localPort: 41_000, close: vi.fn(async () => undefined) };
  const openPeerLink = overrides.openPeerLink ?? vi.fn(async () => link);
  const preflight = overrides.preflight ?? vi.fn(async () => undefined);
  const localEndpoint = vi.fn(async () => endpoint);
  transport = createPeerSshTransport({
    directory: join(dir, 'keys'), instanceId: randomUUID(), keyProvider: { getKey: async () => Buffer.alloc(32, 9) },
    tunnels: { openPeerLink } as never, forwarder, authorizedKeys, localEndpoint, preflight, now: overrides.now
  });
  return { forwarder, authorizedKeys, link, openPeerLink, preflight, localEndpoint };
}

beforeEach(async () => { dir = await realpath(await mkdtemp(join(tmpdir(), 'peer-ssh-transport-'))); });
afterEach(async () => {
  transport?.dispose();
  await transport?.whenIdle().catch(() => undefined);
  for (const fn of cleanups.splice(0)) await fn();
  await rm(dir, { recursive: true, force: true });
});

describe('peer ssh transport', () => {
  it('passes the local endpoint, forwarder and authorized keys through', async () => {
    const fx = setup();
    expect(await transport.localEndpoint(new AbortController().signal)).toBe(endpoint);
    expect(fx.localEndpoint).toHaveBeenCalledOnce();
    expect(transport.forwarder).toBe(fx.forwarder);
    expect(transport.authorizedKeys).toBe(fx.authorizedKeys);
  });

  it('keeps one stable valid public key per link and distinct keys across links', async () => {
    setup();
    const a = randomUUID(), b = randomUUID();
    const first = await transport.linkKey(a);
    expect(first).toMatch(PUB);
    expect(await transport.linkKey(a)).toBe(first);
    expect(await transport.linkKey(b)).not.toBe(first);
  });

  describe('reconcileLinkKeys', () => {
    it('drops seeds with no live link once past the grace period and keeps live and young ones', async () => {
      const clock = { t: 1_000_000 };
      setup({ now: () => clock.t });
      const live = randomUUID(), orphan = randomUUID(), young = randomUUID();
      const liveKey = await transport.linkKey(live);
      const orphanKey = await transport.linkKey(orphan);
      clock.t += PEER_LINK_KEY_GRACE_MS + 1;
      const youngKey = await transport.linkKey(young);
      await transport.reconcileLinkKeys!(new Set([live]));
      expect(await transport.linkKey(live)).toBe(liveKey);
      expect(await transport.linkKey(young)).toBe(youngKey);
      expect(await transport.linkKey(orphan)).not.toBe(orphanKey);
    });

    it('keeps a seed minted moments ago even when no record exists yet (redeem in flight)', async () => {
      setup();
      const id = randomUUID();
      const key = await transport.linkKey(id);
      await transport.reconcileLinkKeys!(new Set());
      expect(await transport.linkKey(id)).toBe(key);
    });

    it('frees capacity taken by leaked seeds', async () => {
      const clock = { t: 5_000_000 };
      setup({ now: () => clock.t });
      for (let i = 0; i < PEER_LINK_MAX_KEYS; i++) await transport.linkKey(randomUUID());
      await expect(transport.linkKey(randomUUID())).rejects.toThrow('peer link key capacity');
      clock.t += PEER_LINK_KEY_GRACE_MS + 1;
      await transport.reconcileLinkKeys!(new Set());
      await expect(transport.linkKey(randomUUID())).resolves.toMatch(PUB);
    });

    it('dropLinkKey also forgets the timestamp', async () => {
      const clock = { t: 7_000_000 };
      setup({ now: () => clock.t });
      const id = randomUUID();
      const first = await transport.linkKey(id);
      await transport.dropLinkKey(id);
      expect(await transport.linkKey(id)).not.toBe(first);
    });
  });

  it('opens a tunnel with the bootstrap seed and the forwarder port as reversePort', async () => {
    const fx = setup();
    const seed = generateSeed(), id = randomUUID();
    const tunnel = await transport.openTunnel(id, { endpoint, identity: { seed }, listenPort: 40_000, targetPort: 40_001, localPort: 41_000 }, vi.fn());
    expect(fx.preflight).toHaveBeenCalledWith('alice.local', 22, expect.any(AbortSignal));
    expect(fx.forwarder.acquire).toHaveBeenCalledWith(id);
    expect(fx.openPeerLink).toHaveBeenCalledWith(expect.objectContaining({ seed, listenPort: 40_000, targetPort: 40_001, reversePort: 45_678, localPort: 41_000,
      endpoint: { host: 'alice.local', port: 22, user: 'alice', hostKey: endpoint.hostKey } }), expect.any(Function));
    expect(tunnel).toMatchObject({ url: 'http://127.0.0.1:41000/', localPort: 41_000 });
    await tunnel.close();
    expect(fx.link.close).toHaveBeenCalledOnce();
  });

  it('opens with this link own key for {linkKey:true} and omits localPort when unset; state callback is forwarded', async () => {
    const onState = vi.fn();
    const openPeerLink = vi.fn(async (_input: unknown, cb: (up: boolean, failure?: string) => void) => { cb(false, 'ssh_unreachable'); return { url: 'http://127.0.0.1:41001/', localPort: 41_001, close: vi.fn() }; });
    setup({ openPeerLink });
    const id = randomUUID();
    await transport.openTunnel(id, { endpoint, identity: { linkKey: true }, listenPort: 40_000, targetPort: 40_001 }, onState);
    const input = openPeerLink.mock.calls[0]![0] as Record<string, unknown>;
    expect('localPort' in input).toBe(false);
    expect(typeof input.seed).toBe('string');
    // The same seed backs the public key the inviter authorized.
    expect(await transport.linkKey(id)).toMatch(PUB);
    expect(onState).toHaveBeenCalledWith(false, 'ssh_unreachable');
  });

  it('fails preflight with the exact ssh code and acquires nothing', async () => {
    const fx = setup({ preflight: vi.fn(async () => { throw new Error('ssh_unreachable'); }) });
    await expect(transport.openTunnel(randomUUID(), { endpoint, identity: { seed: generateSeed() }, listenPort: 40_000, targetPort: 40_001 }, vi.fn()))
      .rejects.toThrow(/^ssh_unreachable$/);
    expect(fx.forwarder.acquire).not.toHaveBeenCalled();
    expect(fx.forwarder.release).not.toHaveBeenCalled();
    expect(fx.openPeerLink).not.toHaveBeenCalled();
  });

  it('releases the forwarder when the tunnel fails; ssh codes pass, foreign text never leaks', async () => {
    const codes = vi.fn().mockRejectedValueOnce(new Error('ssh_auth_refused')).mockRejectedValueOnce(new Error('secret key=abc host=h'));
    const fx = setup({ openPeerLink: codes });
    const input = { endpoint, identity: { seed: generateSeed() }, listenPort: 40_000, targetPort: 40_001 };
    const id = randomUUID();
    await expect(transport.openTunnel(id, input, vi.fn())).rejects.toThrow(/^ssh_auth_refused$/);
    expect(fx.forwarder.release).toHaveBeenCalledWith(id);
    const leaked = await transport.openTunnel(id, input, vi.fn()).catch((error: Error) => error);
    expect((leaked as Error).message).toBe('peer link step failed');
    expect(fx.forwarder.release).toHaveBeenCalledTimes(2);
  });

  it('maps a non-Error rejection to the generic message', async () => {
    setup({ openPeerLink: vi.fn(async () => { throw 'boom'; }) });
    await expect(transport.openTunnel(randomUUID(), { endpoint, identity: { seed: generateSeed() }, listenPort: 40_000, targetPort: 40_001 }, vi.fn()))
      .rejects.toThrow('peer link step failed');
  });

  it('drops the seed and releases the forwarder; dropping an unknown link is a no-op', async () => {
    const fx = setup();
    const id = randomUUID();
    const before = await transport.linkKey(id);
    await transport.dropLinkKey(id);
    expect(fx.forwarder.release).toHaveBeenCalledWith(id);
    expect(await transport.linkKey(id)).not.toBe(before);
    await transport.dropLinkKey(randomUUID());
  });

  it('still drops the seed when the forwarder release fails', async () => {
    const fx = setup();
    fx.forwarder.release.mockRejectedValueOnce(new Error('x'));
    const id = randomUUID();
    const before = await transport.linkKey(id);
    await transport.dropLinkKey(id);
    expect(await transport.linkKey(id)).not.toBe(before);
  });

  it('caps the number of stored link keys', async () => {
    setup();
    for (let i = 0; i < PEER_LINK_MAX_KEYS; i++) await transport.linkKey(randomUUID());
    await expect(transport.linkKey(randomUUID())).rejects.toThrow('peer link key capacity');
  });

  it('refuses after dispose', async () => {
    setup();
    transport.dispose();
    await expect(transport.linkKey(randomUUID())).rejects.toThrow();
  });
});
