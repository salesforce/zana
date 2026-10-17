import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { EnrolledPeerChannels, channelHash, type EnrolledPeerChannel } from './enrolled-peer-channels.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.mocked(fs.rename).mockReset();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'peer-channels-'))); roots.push(root);
  const channels = new EnrolledPeerChannels(join(root, 'channels'), randomUUID(), { getKey: async () => Buffer.alloc(32, 7) });
  const channel = (hostKey = randomBytes(32).toString('base64url'), hostId = randomUUID()): EnrolledPeerChannel =>
    ({ remoteInstanceId: remote, hostId, hostKey, capability: 'peer.forward' });
  const remote = randomUUID();
  return { channels, channel, remote };
}

it('restores the persisted generation instead of deleting it when a re-registration write fails', async () => {
  const f = await fixture();
  const original = f.channel();
  await f.channels.register(original);
  vi.mocked(fs.rename).mockRejectedValueOnce(new Error('disk failure'));
  await expect(f.channels.register(f.channel(undefined, original.hostId))).rejects.toThrow('disk failure');
  // The still-persisted channel keeps a live commit guard without waiting for a remote() refresh.
  expect(f.channels.current(f.remote)).toEqual({ hostId: original.hostId, keyHash: channelHash(original), capability: 'peer.forward' });
  expect(await f.channels.remote(f.remote)).toEqual(original);
});

it('fails closed when a first registration fails and nothing is persisted', async () => {
  const f = await fixture();
  vi.mocked(fs.rename).mockRejectedValueOnce(new Error('disk failure'));
  await expect(f.channels.register(f.channel())).rejects.toThrow('disk failure');
  expect(f.channels.current(f.remote)).toBeNull();
});

it('unregister keeps an in-flight newer generation but removes the persisted enrollment', async () => {
  const f = await fixture();
  const original = f.channel();
  await f.channels.register(original);
  // A newer registration publishes its generation synchronously, then queues behind the delayed cleanup.
  const removing = f.channels.unregister(f.remote, original.hostId);
  const rotated = f.channel(undefined, original.hostId);
  const registering = f.channels.register(rotated);
  expect(await removing).toBe(true);
  expect(f.channels.current(f.remote)?.keyHash).toBe(channelHash(rotated));
  await registering;
  expect(f.channels.current(f.remote)).toEqual({ hostId: rotated.hostId, keyHash: channelHash(rotated), capability: 'peer.forward' });
  expect(await f.channels.remote(f.remote)).toEqual(rotated);
  // A plain unregister with no registration in flight still clears the generation.
  expect(await f.channels.unregister(f.remote, original.hostId)).toBe(true);
  expect(f.channels.current(f.remote)).toBeNull();
  expect(await f.channels.unregister(f.remote, original.hostId)).toBe(false);
});
