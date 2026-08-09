import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `addExtensionPermission` widens an extension's DECLARED permission set in its
 * on-disk manifest (the user "add permission" action and the Doctor's repair).
 * It must: validate the token, stay idempotent, preserve every other field, and
 * NEVER grant consent (that's a separate, user-driven step). discovery.ts is
 * electron-free so no mock is needed.
 */
let extDir: string;

async function importDiscovery() {
  return await import('../discovery.js');
}

async function writeManifest(dirName: string, manifest: Record<string, unknown>): Promise<string> {
  const dir = join(extDir, dirName);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'extension.json');
  await writeFile(file, JSON.stringify(manifest, null, 2), 'utf-8');
  return file;
}

function baseManifest(): Record<string, unknown> {
  return {
    id: 'gus',
    version: '0.2.1',
    title: 'GUS',
    icon: 'Ticket',
    engines: { zccApi: '^1.0.0' },
    entry: { renderer: 'renderer.js' },
    permissions: ['exec', 'inbox:push'],
    permissionScopes: { execAllowlist: ['sf'] }
  };
}

async function readManifest(dirName: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(extDir, dirName, 'extension.json'), 'utf-8'));
}

describe('addExtensionPermission', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-addperm-'));
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('appends a known permission and preserves every other field', async () => {
    const { addExtensionPermission } = await importDiscovery();
    await writeManifest('gus', baseManifest());

    const res = await addExtensionPermission('gus', 'external:open');
    expect(res.ok).toBe(true);

    const m = await readManifest('gus');
    expect(m.permissions).toEqual(['exec', 'inbox:push', 'external:open']);
    // Untouched fields survive verbatim.
    expect(m.version).toBe('0.2.1');
    expect(m.title).toBe('GUS');
    expect(m.permissionScopes).toEqual({ execAllowlist: ['sf'] });
  });

  it('is idempotent — adding an already-declared permission is a no-op success', async () => {
    const { addExtensionPermission } = await importDiscovery();
    await writeManifest('gus', baseManifest());

    const res = await addExtensionPermission('gus', 'exec');
    expect(res.ok).toBe(true);

    const m = await readManifest('gus');
    expect(m.permissions).toEqual(['exec', 'inbox:push']); // unchanged, no dupe
  });

  it('rejects an unknown permission token without touching the manifest', async () => {
    const { addExtensionPermission } = await importDiscovery();
    await writeManifest('gus', baseManifest());

    const res = await addExtensionPermission('gus', 'root:everything');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('BAD_PERMISSION');

    const m = await readManifest('gus');
    expect(m.permissions).toEqual(['exec', 'inbox:push']); // untouched
  });

  it('seeds permissions when the manifest declares none', async () => {
    const { addExtensionPermission } = await importDiscovery();
    const { permissions: _omit, ...noPerms } = baseManifest();
    await writeManifest('gus', noPerms);

    const res = await addExtensionPermission('gus', 'external:open');
    expect(res.ok).toBe(true);
    expect((await readManifest('gus')).permissions).toEqual(['external:open']);
  });

  it('fails for a missing extension', async () => {
    const { addExtensionPermission } = await importDiscovery();
    const res = await addExtensionPermission('ghost', 'external:open');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NOT_FOUND');
  });

  it('rejects a path-escaping id (no manifest write outside the extensions dir)', async () => {
    const { addExtensionPermission } = await importDiscovery();
    const res = await addExtensionPermission('../evil', 'external:open');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NOT_FOUND');
  });

  it('does NOT create a consent record (widening never auto-grants)', async () => {
    const { addExtensionPermission } = await importDiscovery();
    const { readConsentMap } = await import('../consent.js');
    await writeManifest('gus', baseManifest());

    await addExtensionPermission('gus', 'external:open');

    const consent = await readConsentMap();
    expect(consent.gus).toBeUndefined();
  });
});
