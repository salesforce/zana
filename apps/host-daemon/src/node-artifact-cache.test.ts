import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_ARTIFACT_MAX_BYTES } from '@zana-ai/zcc-host-daemon-contract';
import { ensureCachedNodeArtifact, silentArtifactCacheLogger } from './node-artifact-cache.js';
import { ensureCachedPluginHostArtifact } from './plugin-host-artifact-cache.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('ensureCachedNodeArtifact', () => {
  it('rejects an oversized artifact before fetching', async () => {
    const fetchArtifact = vi.fn(async () => new Uint8Array());
    await expect(
      ensureCachedNodeArtifact({
        cacheDir: '/tmp/unused',
        digest: 'ab'.repeat(32),
        byteLength: HOST_ARTIFACT_MAX_BYTES + 1,
        fileName: 'host.js',
        fetchArtifact,
        logger: silentArtifactCacheLogger
      })
    ).rejects.toThrow(/too large/u);
    expect(fetchArtifact).not.toHaveBeenCalled();
  });

  it('reuses a verified cache entry so a second caller does not fetch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-artifact-cache-'));
    tempDirs.push(dir);
    const bytes = new Uint8Array(Buffer.from('export default 1;\n'));
    const digest = sha256(bytes);
    const fetchArtifact = vi.fn(async () => bytes);
    const first = await ensureCachedNodeArtifact({
      cacheDir: dir,
      digest,
      byteLength: bytes.byteLength,
      fileName: 'host.js',
      fetchArtifact,
      logger: silentArtifactCacheLogger
    });
    const second = await ensureCachedNodeArtifact({
      cacheDir: dir,
      digest,
      byteLength: bytes.byteLength,
      fileName: 'host.js',
      fetchArtifact,
      logger: silentArtifactCacheLogger
    });
    expect(first).toBe(second);
    expect(fetchArtifact).toHaveBeenCalledTimes(1);
    expect(await readFile(first)).toEqual(Buffer.from(bytes));
  });

  it('retries once on mismatch then fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-artifact-mismatch-'));
    tempDirs.push(dir);
    const expected = new Uint8Array(Buffer.from('correct-bytes'));
    const digest = sha256(expected);
    const fetchArtifact = vi.fn(async () => new Uint8Array(Buffer.from('wrong-bytes')));
    await expect(
      ensureCachedNodeArtifact({
        cacheDir: dir,
        digest,
        byteLength: expected.byteLength,
        fileName: 'host.js',
        fetchArtifact,
        logger: silentArtifactCacheLogger
      })
    ).rejects.toThrow(/failed verification after retry/u);
    expect(fetchArtifact).toHaveBeenCalledTimes(2);
  });
});

describe('ensureCachedPluginHostArtifact', () => {
  it('caches under plugin-host-artifacts/<pluginId>/<digest>/host.js', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-plugin-host-cache-'));
    tempDirs.push(dir);
    const bytes = new Uint8Array(Buffer.from('export const bridge = 1;\n'));
    const digest = sha256(bytes);
    const path = await ensureCachedPluginHostArtifact({
      dataDir: dir,
      pluginId: 'provider-acp',
      digest,
      byteLength: bytes.byteLength,
      fetchArtifact: async () => bytes,
      logger: silentArtifactCacheLogger
    });
    expect(path).toBe(join(dir, 'plugin-host-artifacts', 'provider-acp', digest, 'host.js'));
    expect(path).not.toMatch(/\/Users\/.*\/bridge\.ts/u);
  });

  it('uses the silent logger when none is provided', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-plugin-host-silent-'));
    tempDirs.push(dir);
    const bytes = new Uint8Array(Buffer.from('export const silent = 1;\n'));
    const digest = sha256(bytes);
    await expect(
      ensureCachedPluginHostArtifact({
        dataDir: dir,
        pluginId: 'provider-acp',
        digest,
        byteLength: bytes.byteLength,
        fetchArtifact: async () => bytes
      })
    ).resolves.toContain(digest);
  });
});

describe('ensureCachedNodeArtifact extra paths', () => {
  it('rejects a malformed digest', async () => {
    await expect(
      ensureCachedNodeArtifact({
        cacheDir: '/tmp/unused',
        digest: 'not-a-digest',
        byteLength: 4,
        fileName: 'host.js',
        fetchArtifact: async () => new Uint8Array(),
        logger: silentArtifactCacheLogger
      })
    ).rejects.toThrow(/Invalid artifact digest/u);
  });

  it('retries when the payload length disagrees then succeeds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-artifact-len-'));
    tempDirs.push(dir);
    const bytes = new Uint8Array(Buffer.from('right-size-payload'));
    const digest = sha256(bytes);
    const fetchArtifact = vi.fn()
      .mockResolvedValueOnce(new Uint8Array(Buffer.from('short')))
      .mockResolvedValueOnce(bytes);
    const path = await ensureCachedNodeArtifact({
      cacheDir: dir,
      digest,
      byteLength: bytes.byteLength,
      fileName: 'host.js',
      fetchArtifact,
      logger: silentArtifactCacheLogger
    });
    expect(fetchArtifact).toHaveBeenCalledTimes(2);
    expect(await readFile(path)).toEqual(Buffer.from(bytes));
  });

  it('prunes a previous digest after a new one is cached', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-artifact-prune-'));
    tempDirs.push(dir);
    const firstBytes = new Uint8Array(Buffer.from('first-host-js'));
    const secondBytes = new Uint8Array(Buffer.from('second-host-js'));
    const first = await ensureCachedNodeArtifact({
      cacheDir: dir,
      digest: sha256(firstBytes),
      byteLength: firstBytes.byteLength,
      fileName: 'host.js',
      fetchArtifact: async () => firstBytes,
      logger: silentArtifactCacheLogger
    });
    const second = await ensureCachedNodeArtifact({
      cacheDir: dir,
      digest: sha256(secondBytes),
      byteLength: secondBytes.byteLength,
      fileName: 'host.js',
      fetchArtifact: async () => secondBytes,
      logger: silentArtifactCacheLogger
    });
    await expect(readFile(first)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(second)).toEqual(Buffer.from(secondBytes));
  });

  it('replaces a corrupt cache entry instead of using it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-artifact-corrupt-'));
    tempDirs.push(dir);
    const bytes = new Uint8Array(Buffer.from('good-host-js'));
    const digest = sha256(bytes);
    await mkdir(join(dir, digest), { recursive: true });
    await writeFile(join(dir, digest, 'host.js'), 'corrupt');
    const fetchArtifact = vi.fn(async () => bytes);
    const path = await ensureCachedNodeArtifact({
      cacheDir: dir,
      digest,
      byteLength: bytes.byteLength,
      fileName: 'host.js',
      fetchArtifact,
      logger: silentArtifactCacheLogger
    });
    expect(fetchArtifact).toHaveBeenCalledTimes(1);
    expect(await readFile(path)).toEqual(Buffer.from(bytes));
  });

  it('coalesces concurrent fetches for the same digest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-artifact-coalesce-'));
    tempDirs.push(dir);
    const bytes = new Uint8Array(Buffer.from('shared-host-js'));
    const digest = sha256(bytes);
    let resolveFetch: (value: Uint8Array) => void = () => undefined;
    const fetchArtifact = vi.fn(
      () => new Promise<Uint8Array>((resolve) => {
        resolveFetch = resolve;
      })
    );
    const firstPromise = ensureCachedNodeArtifact({
      cacheDir: dir,
      digest,
      byteLength: bytes.byteLength,
      fileName: 'host.js',
      fetchArtifact,
      logger: silentArtifactCacheLogger
    });
    const secondPromise = ensureCachedNodeArtifact({
      cacheDir: dir,
      digest,
      byteLength: bytes.byteLength,
      fileName: 'host.js',
      fetchArtifact,
      logger: silentArtifactCacheLogger
    });
    await vi.waitFor(() => expect(fetchArtifact).toHaveBeenCalledTimes(1));
    resolveFetch(bytes);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toBe(second);
    expect(fetchArtifact).toHaveBeenCalledTimes(1);
  });
});
