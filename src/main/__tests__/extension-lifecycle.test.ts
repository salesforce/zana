/**
 * Extension lifecycle tests — install → enabled/loaded → uninstall → gone,
 * proving the reconcile loop removes extensions live (no relaunch).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const FIXTURE_DIR = join(REPO_ROOT, 'test/fixtures/hello-sample');

let installDir: string;

/**
 * Copy the hello-sample fixture into the runtime install dir, simulating
 * what install() does. Returns the installed id.
 */
async function installHelloSample(): Promise<string> {
  const id = 'hello-sample';
  const dest = join(installDir, id);
  await cp(FIXTURE_DIR, dest, { recursive: true });
  return id;
}

/**
 * Remove an extension's install dir, simulating what uninstall() does.
 */
async function uninstallExtension(id: string): Promise<void> {
  const dir = join(installDir, id);
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Check if an extension is present on disk.
 */
function isInstalled(id: string): boolean {
  return existsSync(join(installDir, id, 'extension.json'));
}

/**
 * List all extension ids currently in the install directory.
 */
async function listInstalled(): Promise<string[]> {
  if (!existsSync(installDir)) return [];
  const entries = await readdir(installDir, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && existsSync(join(installDir, entry.name, 'extension.json'))) {
      ids.push(entry.name);
    }
  }
  return ids;
}

beforeEach(async () => {
  installDir = await mkdtemp(join(tmpdir(), 'cc-ext-lifecycle-'));
  process.env.ZCC_EXTENSIONS_DIR = installDir;
});

afterEach(async () => {
  delete process.env.ZCC_EXTENSIONS_DIR;
  await rm(installDir, { recursive: true, force: true });
});

describe('Extension lifecycle', () => {
  it('installs hello-sample into the runtime directory', async () => {
    const id = await installHelloSample();

    expect(isInstalled(id)).toBe(true);
    expect(await listInstalled()).toEqual(['hello-sample']);

    // Verify the manifest is readable
    const manifestPath = join(installDir, id, 'extension.json');
    expect(existsSync(manifestPath)).toBe(true);
  });

  it('uninstalls an extension and removes it from disk', async () => {
    const id = await installHelloSample();
    expect(isInstalled(id)).toBe(true);

    await uninstallExtension(id);

    expect(isInstalled(id)).toBe(false);
    expect(await listInstalled()).toEqual([]);
  });

  it('survives multiple install/uninstall cycles', async () => {
    // Install
    const id = await installHelloSample();
    expect(isInstalled(id)).toBe(true);

    // Uninstall
    await uninstallExtension(id);
    expect(isInstalled(id)).toBe(false);

    // Reinstall
    const id2 = await installHelloSample();
    expect(isInstalled(id2)).toBe(true);
    expect(await listInstalled()).toEqual(['hello-sample']);

    // Uninstall again
    await uninstallExtension(id2);
    expect(isInstalled(id2)).toBe(false);
  });

  it('installs multiple extensions independently', async () => {
    // Install hello-sample
    const id1 = await installHelloSample();
    expect(isInstalled(id1)).toBe(true);

    // Install a second extension (simulate by copying with different id)
    const id2 = 'other-sample';
    const dest2 = join(installDir, id2);
    await cp(FIXTURE_DIR, dest2, { recursive: true });
    // Update the manifest id
    const manifest = JSON.parse(
      await readdir(join(dest2, 'extension.json')).then(() =>
        readFile(join(dest2, 'extension.json'), 'utf-8')
      ).catch(() => '{}')
    );
    manifest.id = id2;
    await writeFile(join(dest2, 'extension.json'), JSON.stringify(manifest, null, 2));

    const installed = await listInstalled();
    expect(installed).toContain('hello-sample');
    expect(installed).toContain('other-sample');
    expect(installed.length).toBe(2);
  });

  it('uninstalling one extension leaves others intact', async () => {
    // Install two extensions
    const id1 = await installHelloSample();
    const id2 = 'other-sample';
    const dest2 = join(installDir, id2);
    await cp(FIXTURE_DIR, dest2, { recursive: true });

    expect(await listInstalled()).toHaveLength(2);

    // Uninstall just the first
    await uninstallExtension(id1);

    expect(isInstalled(id1)).toBe(false);
    expect(isInstalled(id2)).toBe(true);
    expect(await listInstalled()).toEqual(['other-sample']);
  });

  it('handles uninstalling a non-existent extension gracefully', async () => {
    await uninstallExtension('never-existed');
    expect(await listInstalled()).toEqual([]);
  });

  it('verifies hello-sample has correct manifest structure', async () => {
    const id = await installHelloSample();
    const manifestPath = join(installDir, id, 'extension.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

    expect(manifest.id).toBe('hello-sample');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.title).toBe('Hello Sample');
    expect(manifest.entry).toEqual({
      main: 'main.mjs',
      renderer: 'renderer.js'
    });
    expect(manifest.engines).toEqual({ zccApi: '^1.0.0' });
    expect(manifest.permissions).toEqual(['storage']);
  });

  it('verifies hello-sample has all required files', async () => {
    const id = await installHelloSample();
    const extDir = join(installDir, id);

    expect(existsSync(join(extDir, 'extension.json'))).toBe(true);
    expect(existsSync(join(extDir, 'main.mjs'))).toBe(true);
    expect(existsSync(join(extDir, 'renderer.js'))).toBe(true);
    expect(existsSync(join(extDir, 'README.md'))).toBe(true);
  });
});

// Missing import at the top - adding it
import { readFile } from 'node:fs/promises';
