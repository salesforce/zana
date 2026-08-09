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
    const { discoverExtensions, RESERVED_BUILTIN_IDS } = await importDiscovery();
    const builtin = RESERVED_BUILTIN_IDS[0]; // 'slack' (the sole reserved built-in)
    // Folder name == id, so the only reason to reject is the built-in collision.
    await writeExt(builtin, validManifest(builtin));

    const found = await discoverExtensions();
    const e = found.find((x) => x.id === builtin);
    expect(e).toBeTruthy();
    expect(e?.error).toBe('bad-manifest');
    expect(e?.loaded).toBe(false);
    expect(e?.manifest).toBeNull();
  });

  it('reserves "slack" by default — it was promoted to a built-in module', async () => {
    const { discoverExtensions, RESERVED_BUILTIN_IDS } = await importDiscovery();
    // slack is now in MAIN_MODULES (promoted from a disk extension), so a disk
    // folder named `slack` must not be allowed to shadow the built-in.
    expect(RESERVED_BUILTIN_IDS).toContain('slack');
    await writeExt('slack', validManifest('slack'));

    const found = await discoverExtensions();
    const e = found.find((x) => x.id === 'slack');
    expect(e?.error).toBe('bad-manifest');
    expect(e?.loaded).toBe(false);
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

  it('does NOT reserve "zana" by default — the zana disk extension loads', async () => {
    const { discoverExtensions, RESERVED_BUILTIN_IDS } = await importDiscovery();
    // zana left MAIN_MODULES; it now ships as a full disk extension (dir zana,
    // id zana) reaching its data through the host MCP pool. It must not be
    // rejected as a reserved-id collision.
    expect(RESERVED_BUILTIN_IDS).not.toContain('zana');
    await writeExt('zana', validManifest('zana'));

    const found = await discoverExtensions();
    const e = found.find((x) => x.id === 'zana');
    expect(e?.error).toBeUndefined();
    expect(e?.loaded).toBe(true);
  });
});
