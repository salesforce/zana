import { randomBytes } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PLUGIN_STORAGE_EPOCHS, PluginStorageEpochs } from './plugin-storage-epochs.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(key: Buffer | null = randomBytes(32)) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'plugin-epochs-')));
  roots.push(root);
  const directory = join(root, 'epochs');
  const open = () => new PluginStorageEpochs({ directory, instanceId: 'instance-a', keyProvider: { getKey: async () => key } });
  return { root, directory, open };
}

describe('PluginStorageEpochs', () => {
  it('starts at zero and advances by compare-and-set, durably and per plugin', async () => {
    const f = await fixture();
    const epochs = f.open();
    expect(await epochs.current('design-docs')).toBe(0);
    expect(await epochs.advance('design-docs', 0)).toBe(1);
    expect(await epochs.advance('design-docs', 1)).toBe(2);
    expect(await epochs.current('other')).toBe(0);
    await expect(epochs.advance('design-docs', 1)).rejects.toThrow('storage epoch mismatch');
    await epochs.whenIdle();
    epochs.dispose();
    // A restart reads the same counter.
    const reopened = f.open();
    expect(await reopened.current('design-docs')).toBe(2);
    await expect(epochs.current('design-docs')).rejects.toThrow('disposed');
  });

  it('reports the fence unavailable without a key and rejects advances', async () => {
    const f = await fixture(null);
    const epochs = f.open();
    expect(await epochs.current('design-docs')).toBeNull();
    await expect(epochs.advance('design-docs', 0)).rejects.toThrow('key');
  });

  it('fails closed when the counter file is removed after initialization', async () => {
    const f = await fixture();
    const epochs = f.open();
    await epochs.advance('design-docs', 0);
    await rm(join(f.directory, 'storage-epochs-v1.bin'));
    await expect(epochs.current('design-docs')).rejects.toThrow('missing after initialization');
  });

  it('rejects stale callers, invalid input, and an unbounded plugin set', async () => {
    const f = await fixture();
    const epochs = f.open();
    await expect(epochs.advance('design-docs', 0, () => false)).rejects.toThrow('stale');
    expect(await epochs.current('design-docs')).toBe(0);
    await expect(epochs.advance('design-docs', -1)).rejects.toThrow('invalid storage epoch');
    await expect(epochs.advance('design-docs', 1.5)).rejects.toThrow('invalid storage epoch');
    await expect(epochs.current('../escape')).rejects.toThrow('invalid plugin storage epoch key');
    await expect(epochs.advance('__proto__', 0)).rejects.toThrow('invalid plugin storage epoch key');
    for (let i = 0; i < MAX_PLUGIN_STORAGE_EPOCHS; i++) await epochs.advance(`p${i}`, 0);
    await expect(epochs.advance('one-more', 0)).rejects.toThrow('capacity');
    // Known plugins keep advancing at capacity.
    expect(await epochs.advance('p0', 1)).toBe(2);
  });

  it('rejects an advance from an epoch the counter never reached', async () => {
    const f = await fixture();
    const epochs = f.open();
    await expect(epochs.advance('design-docs', Number.MAX_SAFE_INTEGER)).rejects.toThrow('storage epoch mismatch');
  });
});
