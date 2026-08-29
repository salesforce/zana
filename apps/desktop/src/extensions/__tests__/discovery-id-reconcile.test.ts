import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Isolation finding B: discovery must reconcile `manifest.id` (the SDK
 * namespace) with the on-disk directory name (the runtime moduleId), and reject
 * an id that collides with a reserved built-in. discovery.ts is electron-free,
 * so no electron mock is needed.
 */
let extDir: string;

async function importDiscovery() {
  return await import('../discovery.js');
}

/** Write a minimal-but-valid manifest into `<extDir>/<dirName>/extension.json`. */
async function writeExt(
  dirName: string,
  manifest: Record<string, unknown>
): Promise<void> {
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

describe('discovery id reconciliation (isolation finding B)', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-disc-'));
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('accepts an extension whose manifest id matches its directory name', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('acme.tool', validManifest('acme.tool'));

    const found = await discoverExtensions();
    const e = found.find((x) => x.id === 'acme.tool');
    expect(e).toBeTruthy();
    expect(e?.error).toBeUndefined();
    expect(e?.loaded).toBe(true);
    expect(e?.manifest?.id).toBe('acme.tool');
  });

  it('skips an extension whose manifest id != directory name', async () => {
    const { discoverExtensions } = await importDiscovery();
    // dir is "renamed-folder" but the manifest still claims the old id.
    await writeExt('renamed-folder', validManifest('acme.tool'));

    const found = await discoverExtensions();
    const e = found.find((x) => x.id === 'renamed-folder');
    expect(e).toBeTruthy();
    expect(e?.error).toBe('bad-manifest');
    expect(e?.loaded).toBe(false);
    // Stripped to a non-candidate: no manifest, no consent decision.
    expect(e?.manifest).toBeNull();
    expect(e?.needsConsent).toBeNull();
  });

  it('skips an extension whose id collides with a reserved built-in', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('reserved-id', validManifest('reserved-id'));

    const found = await discoverExtensions(() => {}, new Set(['reserved-id']));
    const e = found.find((x) => x.id === 'reserved-id');
    expect(e).toBeTruthy();
    expect(e?.error).toBe('bad-manifest');
    expect(e?.loaded).toBe(false);
    expect(e?.manifest).toBeNull();
  });

  it('has an empty default reserved set — MAIN_MODULES is empty', async () => {
    const { discoverExtensions, RESERVED_BUILTIN_IDS } = await importDiscovery();
    expect(RESERVED_BUILTIN_IDS).toEqual([]);
    await writeExt('slack', validManifest('slack'));

    const found = await discoverExtensions();
    const e = found.find((x) => x.id === 'slack');
    expect(e?.error).toBeUndefined();
    expect(e?.loaded).toBe(true);
  });

  it('honours a caller-supplied reservedIds set (index.ts forwards its builtinIds)', async () => {
    const { discoverExtensions } = await importDiscovery();
    // id matches dir, but the caller reserves it.
    await writeExt('custom-builtin', validManifest('custom-builtin'));

    const found = await discoverExtensions(() => {}, new Set(['custom-builtin']));
    const e = found.find((x) => x.id === 'custom-builtin');
    expect(e?.error).toBe('bad-manifest');
    expect(e?.loaded).toBe(false);
  });

  it('does NOT reserve an arbitrary disk-extension id by default', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('alpha', validManifest('alpha'));

    const found = await discoverExtensions();
    const e = found.find((x) => x.id === 'alpha');
    expect(e?.error).toBeUndefined();
    expect(e?.loaded).toBe(true);
  });

  it('does NOT reserve "zana" by default', async () => {
    const { discoverExtensions, RESERVED_BUILTIN_IDS } = await importDiscovery();
    expect(RESERVED_BUILTIN_IDS).not.toContain('zana');
    await writeExt('zana', validManifest('zana'));

    const found = await discoverExtensions();
    const e = found.find((x) => x.id === 'zana');
    expect(e?.error).toBeUndefined();
    expect(e?.loaded).toBe(true);
  });
});
