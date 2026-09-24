import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase, upsertHost } from '@zana-ai/zcc-db';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { createPluginApi } from './plugin-api.js';

it('lists only enrolled host identities and respects cancellation and disposal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-hosts-'));
  const db = openDatabase(join(dir, 'test.sqlite'));
  const handle = createPluginApi('test-hosts', dir, { productContext: { db } as never });
  const bare = createPluginApi('bare-hosts', dir);
  try {
    await expect(handle.api.sdk.hosts.list()).resolves.toEqual([]);
    const host = upsertHost(db, { name: 'Lab desktop', hostKeyHash: 'private-hash', homeDir: '/private/home' });
    const removed = upsertHost(db, { name: 'Removed', hostKeyHash: 'other-hash' });
    db.sqlite.prepare('UPDATE hosts SET destroyed_at = 1 WHERE id = ?').run(removed.id);
    await expect(handle.api.sdk.hosts.list()).resolves.toEqual([{ id: host.id, name: 'Lab desktop' }]);
    const abort = new AbortController();
    abort.abort(new Error('cancelled'));
    await expect(handle.api.sdk.hosts.list({ signal: abort.signal })).rejects.toThrow('cancelled');
    await expect(bare.api.sdk.hosts.list()).rejects.toThrow('not available');
    await handle.dispose();
    await expect(handle.api.sdk.hosts.list()).rejects.toThrow(/stale/);
  } finally {
    await handle.dispose();
    await bare.dispose();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('exposes the same host lookup in the plugin test harness', async () => {
  const fake = createFakePluginHost();
  try {
    fake.harness.sdk.stub('hosts.list', async () => [{ id: 'host-1', name: 'Lab' }]);
    await expect(fake.bb.sdk.hosts.list()).resolves.toEqual([{ id: 'host-1', name: 'Lab' }]);
    const signal = AbortSignal.abort(new Error('cancelled'));
    await expect(fake.bb.sdk.hosts.list({ signal })).rejects.toThrow('cancelled');
    expect(fake.harness.sdk.callsTo('hosts.list')).toHaveLength(1);
    await fake.harness.dispose();
    await expect(fake.bb.sdk.hosts.list()).rejects.toThrow(/stale/);
  } finally {
    await fake.harness.dispose();
  }
});
