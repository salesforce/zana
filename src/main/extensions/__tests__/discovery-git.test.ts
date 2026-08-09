import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The git-provenance registry (`git.json`) that discovery owns — the twin of
 * `local.json`. A git-installed extension is an ordinary disk extension PLUS a
 * pointer recording the credential-stripped clone url/ref/sha it came from. This
 * exercises the round-trip (markGit → getGitRecord → clearGit), the
 * source:'git' + remoteOrigin stamping in discoverExtensions, the defensive
 * parse, and — load-bearing for Rule 4 — that two OVERLAPPING markGit writes
 * don't lose an entry (the serialization the in-process mutex provides).
 */
let extDir: string;

async function importDiscovery() {
  return await import('../discovery.js');
}

async function writeExt(dirName: string, manifest: Record<string, unknown>): Promise<void> {
  const dir = join(extDir, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'extension.json'), JSON.stringify(manifest), 'utf-8');
}

function validManifest(id: string): Record<string, unknown> {
  return {
    id,
    title: 'X',
    icon: 'Box',
    engines: { zccApi: '^1.0.0' },
    entry: { renderer: 'renderer.js' }
  };
}

describe('git extension registry (git.json)', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-git-'));
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('writes git.json BESIDE the extension dirs, not inside them', async () => {
    const { markGit } = await importDiscovery();
    const res = await markGit('acme.tool-a1b2', {
      url: 'https://github.com/acme/tool.git',
      ref: 'v1.0.0',
      sha: 'abc123',
      installedAt: '2026-07-24T00:00:00.000Z'
    });
    expect(res.ok).toBe(true);
    expect(existsSync(join(extDir, 'git.json'))).toBe(true);
    const parsed = JSON.parse(await readFile(join(extDir, 'git.json'), 'utf-8'));
    expect(parsed['acme.tool-a1b2']).toEqual({
      url: 'https://github.com/acme/tool.git',
      ref: 'v1.0.0',
      sha: 'abc123',
      installedAt: '2026-07-24T00:00:00.000Z'
    });
  });

  it('round-trips markGit → getGitRecord → clearGit', async () => {
    const { markGit, getGitRecord, clearGit } = await importDiscovery();

    await markGit('foo-0001', { url: 'https://github.com/o/foo.git', ref: 'main' });
    expect(await getGitRecord('foo-0001')).toEqual({
      url: 'https://github.com/o/foo.git',
      ref: 'main'
    });

    // Idempotent overwrite — the update-from-repo path refreshes sha/installedAt.
    await markGit('foo-0001', { url: 'https://github.com/o/foo.git', sha: 'deadbeef' });
    expect(await getGitRecord('foo-0001')).toEqual({
      url: 'https://github.com/o/foo.git',
      sha: 'deadbeef'
    });

    const cleared = await clearGit('foo-0001');
    expect(cleared.ok).toBe(true);
    expect(await getGitRecord('foo-0001')).toBeNull();
  });

  it('getGitRecord returns null for an unknown id', async () => {
    const { getGitRecord } = await importDiscovery();
    expect(await getGitRecord('never-installed')).toBeNull();
  });

  it('clearGit is a no-op success when the file/id is absent', async () => {
    const { clearGit } = await importDiscovery();
    expect((await clearGit('nope')).ok).toBe(true);
  });

  it('rejects markGit with a missing id or url', async () => {
    const { markGit } = await importDiscovery();
    expect((await markGit('', { url: 'https://x' })).ok).toBe(false);
    expect((await markGit('x', { url: '' })).ok).toBe(false);
  });

  it('drops malformed git.json entries instead of throwing', async () => {
    const { getGitRecord } = await importDiscovery();
    await writeFile(
      join(extDir, 'git.json'),
      JSON.stringify({
        good: { url: 'https://github.com/o/good.git', ref: 'main' },
        noUrl: { ref: 'main' }, // missing url
        emptyUrl: { url: '' }, // empty
        notObj: 'string'
      }),
      'utf-8'
    );
    expect(await getGitRecord('good')).toEqual({ url: 'https://github.com/o/good.git', ref: 'main' });
    expect(await getGitRecord('noUrl')).toBeNull();
    expect(await getGitRecord('emptyUrl')).toBeNull();
    expect(await getGitRecord('notObj')).toBeNull();
  });

  it('serializes overlapping markGit writes (Rule 4 — no lost entry)', async () => {
    const { markGit, getGitRecord } = await importDiscovery();
    // Fire many overlapping RMW writes to DISTINCT ids concurrently. Without the
    // mutex, each reads the map before the others rename, and all but the last
    // are silently dropped. With serialization every id survives.
    const ids = Array.from({ length: 20 }, (_, i) => `race-${i.toString().padStart(2, '0')}`);
    await Promise.all(
      ids.map((id) => markGit(id, { url: `https://github.com/o/${id}.git` }))
    );
    for (const id of ids) {
      expect(await getGitRecord(id), `${id} must survive`).toEqual({
        url: `https://github.com/o/${id}.git`
      });
    }
  });

  it('stamps source:"git" + remoteOrigin on a discovered extension in git.json', async () => {
    const { discoverExtensions, markGit } = await importDiscovery();
    await writeExt('remote-tool', validManifest('remote-tool'));
    await writeExt('local-only', validManifest('local-only'));
    await markGit('remote-tool', {
      url: 'https://github.com/acme/remote-tool.git',
      ref: 'v2.0.0',
      sha: 'cafe'
    });

    const found = await discoverExtensions();
    const remote = found.find((e) => e.id === 'remote-tool');
    const other = found.find((e) => e.id === 'local-only');

    expect(remote?.source).toBe('git');
    // remoteOrigin carries url + ref (not the sha) for the consent screen.
    expect(remote?.remoteOrigin).toEqual({
      url: 'https://github.com/acme/remote-tool.git',
      ref: 'v2.0.0'
    });
    // A plain disk extension has no source tag or remoteOrigin.
    expect(other?.source).toBeUndefined();
    expect(other?.remoteOrigin).toBeUndefined();
  });

  it('stamps consentedPermissions on a widened entry so the overlay can show the delta', async () => {
    const { discoverExtensions } = await importDiscovery();
    const { grantConsent } = await import('../consent.js');
    // A candidate that declares two perms but has only ever approved one.
    await writeExt('widget', {
      ...validManifest('widget'),
      permissions: ['storage', 'net']
    });
    await grantConsent('widget', ['storage']);

    const found = await discoverExtensions();
    const widget = found.find((e) => e.id === 'widget');
    // The re-prompt fires (net is newly declared)…
    expect(widget?.needsConsent).toBe('widened');
    // …and the approved snapshot rides along so the overlay marks `net` NEW and
    // `storage` already-approved.
    expect(widget?.consentedPermissions).toEqual(['storage']);
  });

  it('leaves consentedPermissions undefined for a never-approved (new) extension', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('fresh', { ...validManifest('fresh'), permissions: ['storage'] });
    const found = await discoverExtensions();
    const fresh = found.find((e) => e.id === 'fresh');
    expect(fresh?.needsConsent).toBe('new');
    expect(fresh?.consentedPermissions).toBeUndefined();
  });

  it('lets local provenance win when an id appears in both maps', async () => {
    const { discoverExtensions, markGit, markLocal } = await importDiscovery();
    await writeExt('dual', validManifest('dual'));
    await markGit('dual', { url: 'https://github.com/o/dual.git' });
    await markLocal('dual', join(extDir, '..', 'work', 'dual'));

    const found = await discoverExtensions();
    const dual = found.find((e) => e.id === 'dual');
    expect(dual?.source).toBe('local');
    // No remote-origin badge when local wins.
    expect(dual?.remoteOrigin).toBeUndefined();
  });
});
