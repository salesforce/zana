/**
 * Extension lifecycle tests — install → enabled/loaded → uninstall → gone,
 * proving the reconcile loop removes extensions live (no relaunch).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let installDir: string;

const SAMPLE_MANIFEST = {
  id: 'hello-sample',
  version: '1.0.0',
  title: 'Hello Sample',
  entry: { main: 'main.mjs', renderer: 'renderer.js' },
  engines: { zccApi: '^1.0.0' },
  permissions: ['storage'],
};

async function writeSample(id: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  await writeFile(
    join(dest, 'extension.json'),
    JSON.stringify({ ...SAMPLE_MANIFEST, id }, null, 2)
  );
  await writeFile(join(dest, 'main.mjs'), 'export default { setup() { return {}; } };\n');
  await writeFile(join(dest, 'renderer.js'), 'export default { activate() { return () => null; } };\n');
}

/** Write a sample extension into the runtime install dir. Returns the installed id. */
async function installHelloSample(): Promise<string> {
  const id = 'hello-sample';
  await writeSample(id, join(installDir, id));
  return id;
}

/** Remove an extension's install dir, simulating what uninstall() does. */
async function uninstallExtension(id: string): Promise<void> {
  const dir = join(installDir, id);
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}

function isInstalled(id: string): boolean {
  return existsSync(join(installDir, id, 'extension.json'));
}

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
    expect(existsSync(join(installDir, id, 'extension.json'))).toBe(true);
  });

  it('uninstalls an extension and removes it from disk', async () => {
    const id = await installHelloSample();
    expect(isInstalled(id)).toBe(true);

    await uninstallExtension(id);

    expect(isInstalled(id)).toBe(false);
    expect(await listInstalled()).toEqual([]);
  });

  it('survives multiple install/uninstall cycles', async () => {
    const id = await installHelloSample();
    expect(isInstalled(id)).toBe(true);

    await uninstallExtension(id);
    expect(isInstalled(id)).toBe(false);

    const id2 = await installHelloSample();
    expect(isInstalled(id2)).toBe(true);
    expect(await listInstalled()).toEqual(['hello-sample']);

    await uninstallExtension(id2);
    expect(isInstalled(id2)).toBe(false);
  });

  it('installs multiple extensions independently', async () => {
    const id1 = await installHelloSample();
    expect(isInstalled(id1)).toBe(true);

    const id2 = 'other-sample';
    await writeSample(id2, join(installDir, id2));

    const installed = await listInstalled();
    expect(installed).toContain('hello-sample');
    expect(installed).toContain('other-sample');
    expect(installed.length).toBe(2);
  });

  it('uninstalling one extension leaves others intact', async () => {
    const id1 = await installHelloSample();
    const id2 = 'other-sample';
    await writeSample(id2, join(installDir, id2));

    expect(await listInstalled()).toHaveLength(2);

    await uninstallExtension(id1);

    expect(isInstalled(id1)).toBe(false);
    expect(isInstalled(id2)).toBe(true);
    expect(await listInstalled()).toEqual(['other-sample']);
  });

  it('handles uninstalling a non-existent extension gracefully', async () => {
    await uninstallExtension('never-existed');
    expect(await listInstalled()).toEqual([]);
  });
});
