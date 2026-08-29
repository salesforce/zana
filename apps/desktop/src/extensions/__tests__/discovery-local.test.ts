import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The local-authored extension registry (`local.json`) that discovery owns. A
 * "local" extension is an ordinary disk extension PLUS a pointer recording the
 * source working dir the Creator agent builds in. This exercises the round-trip
 * (markLocal → getLocalRecord → clearLocal), the source-stamping in
 * discoverExtensions, and the defensive parse. discovery.ts is electron-free, so
 * no electron mock is needed; the extensions dir is injected via
 * `ZCC_EXTENSIONS_DIR`.
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

describe('local extension registry (local.json)', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-local-'));
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('writes local.json BESIDE the extension dirs, not inside them', async () => {
    const { markLocal } = await importDiscovery();
    const res = await markLocal('acme.tool-a1b2', '/some/scratch/extensions/acme.tool-a1b2');
    expect(res.ok).toBe(true);
    // The pointer file sits at the extensions-dir root — publishing an ext dir
    // carries none of it.
    expect(existsSync(join(extDir, 'local.json'))).toBe(true);
    const parsed = JSON.parse(await readFile(join(extDir, 'local.json'), 'utf-8'));
    expect(parsed['acme.tool-a1b2']).toEqual({
      workingDir: '/some/scratch/extensions/acme.tool-a1b2'
    });
  });

  it('round-trips markLocal → getLocalRecord → clearLocal', async () => {
    const { markLocal, getLocalRecord, clearLocal } = await importDiscovery();

    await markLocal('foo-0001', '/work/foo-0001');
    expect(await getLocalRecord('foo-0001')).toEqual({ workingDir: '/work/foo-0001' });

    // Idempotent overwrite.
    await markLocal('foo-0001', '/work/renamed-0001');
    expect(await getLocalRecord('foo-0001')).toEqual({ workingDir: '/work/renamed-0001' });

    const cleared = await clearLocal('foo-0001');
    expect(cleared.ok).toBe(true);
    expect(await getLocalRecord('foo-0001')).toBeNull();
  });

  it('getLocalRecord returns null for an unknown id', async () => {
    const { getLocalRecord } = await importDiscovery();
    expect(await getLocalRecord('never-registered')).toBeNull();
  });

  it('clearLocal is a no-op success when the file/id is absent', async () => {
    const { clearLocal } = await importDiscovery();
    // No local.json exists yet.
    expect((await clearLocal('nope')).ok).toBe(true);
  });

  it('rejects markLocal with a missing id or dir', async () => {
    const { markLocal } = await importDiscovery();
    expect((await markLocal('', '/x')).ok).toBe(false);
    expect((await markLocal('x', '')).ok).toBe(false);
  });

  it('drops malformed local.json entries instead of throwing', async () => {
    const { getLocalRecord } = await importDiscovery();
    await writeFile(
      join(extDir, 'local.json'),
      JSON.stringify({
        good: { workingDir: '/w/good' },
        noDir: { title: 'x' }, // missing workingDir
        emptyDir: { workingDir: '' }, // empty
        notObj: 'string'
      }),
      'utf-8'
    );
    expect(await getLocalRecord('good')).toEqual({ workingDir: '/w/good' });
    expect(await getLocalRecord('noDir')).toBeNull();
    expect(await getLocalRecord('emptyDir')).toBeNull();
    expect(await getLocalRecord('notObj')).toBeNull();
  });

  it('findLocalRecordByCwd resolves the extension whose workingDir contains cwd', async () => {
    const { markLocal, findLocalRecordByCwd } = await importDiscovery();
    await markLocal('foo-0001', '/work/foo-0001');
    await markLocal('bar-0002', '/work/bar-0002');

    // Exact match.
    expect(await findLocalRecordByCwd('/work/foo-0001')).toEqual({
      id: 'foo-0001',
      record: { workingDir: '/work/foo-0001' }
    });
    // Nested cwd (agent cd'd into a subdir of its own working dir).
    expect(await findLocalRecordByCwd('/work/foo-0001/dist')).toEqual({
      id: 'foo-0001',
      record: { workingDir: '/work/foo-0001' }
    });
    // A sibling dir that merely shares a prefix must NOT match.
    expect(await findLocalRecordByCwd('/work/foo-00019')).toBeNull();
    // Not registered at all.
    expect(await findLocalRecordByCwd('/somewhere/else')).toBeNull();
  });

  it('stamps source:"local" on a discovered extension present in local.json', async () => {
    const { discoverExtensions, markLocal } = await importDiscovery();
    await writeExt('mine-abcd', validManifest('mine-abcd'));
    await writeExt('theirs', validManifest('theirs'));
    await markLocal('mine-abcd', join(extDir, '..', 'work', 'mine-abcd'));

    const found = await discoverExtensions();
    const mine = found.find((e) => e.id === 'mine-abcd');
    const theirs = found.find((e) => e.id === 'theirs');
    expect(mine?.source).toBe('local');
    // A non-local disk extension has no source tag.
    expect(theirs?.source).toBeUndefined();
  });
});
