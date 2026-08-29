import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `removeExtensionPermission` narrows an extension's DECLARED permission set in
 * its on-disk manifest — the inverse of `addExtensionPermission`. It must:
 * drop the token, stay idempotent (absent/unknown token → no-op success),
 * preserve every other field, and confine to the extensions dir. The paired
 * `pruneConsentedPermission` (consent.ts) narrows the approved snapshot so a
 * later re-add re-prompts — the load-bearing re-prompt-on-readd guarantee,
 * exercised in the round-trip test below.
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

describe('removeExtensionPermission', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-rmperm-'));
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('drops a declared permission and preserves every other field', async () => {
    const { removeExtensionPermission } = await importDiscovery();
    await writeManifest('gus', baseManifest());

    const res = await removeExtensionPermission('gus', 'exec');
    expect(res.ok).toBe(true);

    const m = await readManifest('gus');
    expect(m.permissions).toEqual(['inbox:push']);
    expect(m.version).toBe('0.2.1');
    expect(m.title).toBe('GUS');
    // Scope block is left verbatim (narrowing the token doesn't prune scopes).
    expect(m.permissionScopes).toEqual({ execAllowlist: ['sf'] });
  });

  it('is idempotent — removing an absent token is a no-op success', async () => {
    const { removeExtensionPermission } = await importDiscovery();
    await writeManifest('gus', baseManifest());

    const res = await removeExtensionPermission('gus', 'net');
    expect(res.ok).toBe(true);
    expect((await readManifest('gus')).permissions).toEqual(['exec', 'inbox:push']);
  });

  it('treats an unknown/stale token as a harmless narrowing (no validity check)', async () => {
    const { removeExtensionPermission } = await importDiscovery();
    await writeManifest('gus', { ...baseManifest(), permissions: ['exec', 'root:legacy'] });

    const res = await removeExtensionPermission('gus', 'root:legacy');
    expect(res.ok).toBe(true);
    expect((await readManifest('gus')).permissions).toEqual(['exec']);
  });

  it('fails for a missing extension', async () => {
    const { removeExtensionPermission } = await importDiscovery();
    const res = await removeExtensionPermission('ghost', 'exec');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NOT_FOUND');
  });

  it('rejects a path-escaping id (no manifest write outside the extensions dir)', async () => {
    const { removeExtensionPermission } = await importDiscovery();
    const res = await removeExtensionPermission('../evil', 'exec');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NOT_FOUND');
  });
});

describe('pruneConsentedPermission + re-prompt-on-readd round-trip', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-prune-'));
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('narrows the approved snapshot silently, then re-prompts on re-add', async () => {
    const { grantConsent, pruneConsentedPermission, consentStateFor, readConsentMap } =
      await import('../consent.js');

    // Approve two permissions.
    await grantConsent('gus', ['net', 'storage']);

    // Prune one → the record stays, narrowed.
    const pruned = await pruneConsentedPermission('gus', 'net');
    expect(pruned.ok).toBe(true);
    const map = await readConsentMap();
    expect(map.gus.permissions).toEqual(['storage']);

    // The remaining declared set is still fully consented — no re-prompt.
    expect(consentStateFor(['storage'], map, 'gus')).toEqual({
      consented: true,
      needsConsent: null
    });

    // Re-declaring `net` must re-prompt (widened) — the stale snapshot no longer
    // covers it, so the re-prompt-on-readd guarantee holds.
    const state = consentStateFor(['storage', 'net'], map, 'gus');
    expect(state.needsConsent).toBe('widened');
  });

  it('is a no-op success when the record or token is absent', async () => {
    const { pruneConsentedPermission } = await import('../consent.js');
    expect((await pruneConsentedPermission('never', 'net')).ok).toBe(true);
    expect((await pruneConsentedPermission('', 'net')).ok).toBe(false);
  });
});
