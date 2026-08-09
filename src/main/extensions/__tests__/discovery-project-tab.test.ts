import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `projectTab` opt-in: discovery must parse the manifest's optional `projectTab`
 * block (placement opt-in for a per-project tab) and project it through to the
 * renderer-safe `ExtensionManifestView`. A malformed block is sanitized
 * (bad fields dropped), and a non-object is treated as "no project tab".
 * discovery.ts is electron-free, so no electron mock is needed.
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

function base(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: 'X',
    icon: 'Box',
    engines: { zccApi: '^1.0.0' },
    entry: { renderer: 'renderer.js' },
    ...extra
  };
}

describe('discovery projectTab parsing + projection', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-ptab-'));
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
  });

  it('carries a well-formed projectTab through to the manifest view', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('acme.tab', base('acme.tab', { projectTab: { label: 'Tab', icon: 'Bot', order: 50 } }));

    const found = await discoverExtensions();
    const e = found.find((x) => x.id === 'acme.tab');
    expect(e?.manifest?.projectTab).toEqual({ label: 'Tab', icon: 'Bot', order: 50 });
  });

  it('carries projectTab.global=false (project-tab-only opt-out of the sidebar)', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('acme.scoped', base('acme.scoped', { projectTab: { label: 'Scoped', global: false } }));

    const found = await discoverExtensions();
    const tab = found.find((x) => x.id === 'acme.scoped')?.manifest?.projectTab;
    expect(tab?.global).toBe(false);
  });

  it('drops a non-boolean projectTab.global (defaults to dual-surface)', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('acme.badglobal', base('acme.badglobal', { projectTab: { global: 'no' } }));

    const found = await discoverExtensions();
    const tab = found.find((x) => x.id === 'acme.badglobal')?.manifest?.projectTab;
    expect(tab?.global).toBeUndefined();
  });

  it('opts in with an empty object (sidebar-only otherwise)', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('acme.bare', base('acme.bare', { projectTab: {} }));
    await writeExt('acme.none', base('acme.none'));

    const found = await discoverExtensions();
    // Present (opted in) but all fields default at render time.
    expect(found.find((x) => x.id === 'acme.bare')?.manifest?.projectTab).toEqual({
      label: undefined,
      icon: undefined,
      order: undefined
    });
    // Absent => sidebar-only.
    expect(found.find((x) => x.id === 'acme.none')?.manifest?.projectTab).toBeUndefined();
  });

  it('sanitizes malformed projectTab fields (wrong types dropped)', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt(
      'acme.bad',
      base('acme.bad', { projectTab: { label: 42, icon: '', order: 'high' } })
    );

    const found = await discoverExtensions();
    const tab = found.find((x) => x.id === 'acme.bad')?.manifest?.projectTab;
    expect(tab).toEqual({ label: undefined, icon: undefined, order: undefined });
  });

  it('treats a non-object projectTab as no project tab', async () => {
    const { discoverExtensions } = await importDiscovery();
    await writeExt('acme.str', base('acme.str', { projectTab: 'yes' }));

    const found = await discoverExtensions();
    expect(found.find((x) => x.id === 'acme.str')?.manifest?.projectTab).toBeUndefined();
  });
});
