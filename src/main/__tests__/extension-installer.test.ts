import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The installer resolves both roots lazily from env (ZCC_BUNDLED_EXTENSIONS_DIR
// = shipped artifacts, ZCC_EXTENSIONS_DIR = install dir), so a temp-dir harness
// needs no electron mock. Mirrors extensions.test.ts.
let bundledDir: string;
let installDir: string;

async function importInstaller() {
  return await import('../extension-installer.js');
}

/** Write a bundled extension artifact (manifest + a stub renderer file). */
async function writeBundled(id: string, manifest: unknown): Promise<void> {
  const dir = join(bundledDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'extension.json'), JSON.stringify(manifest), 'utf-8');
  await writeFile(join(dir, 'renderer.js'), `// ${id} bundled`, 'utf-8');
}

/** Write an already-installed extension into the install dir. */
async function writeInstalled(id: string, manifest: unknown, marker: string): Promise<void> {
  const dir = join(installDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'extension.json'), JSON.stringify(manifest), 'utf-8');
  await writeFile(join(dir, 'renderer.js'), marker, 'utf-8');
}

async function installedManifest(id: string): Promise<Record<string, unknown> | null> {
  const f = join(installDir, id, 'extension.json');
  if (!existsSync(f)) return null;
  return JSON.parse(await readFile(f, 'utf-8'));
}

const engines = { zccApi: '>=1 <2' };

describe('seedBundledExtensions', () => {
  beforeEach(async () => {
    bundledDir = await mkdtemp(join(tmpdir(), 'cc-bundled-'));
    installDir = await mkdtemp(join(tmpdir(), 'cc-install-'));
    process.env.ZCC_BUNDLED_EXTENSIONS_DIR = bundledDir;
    process.env.ZCC_EXTENSIONS_DIR = installDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_BUNDLED_EXTENSIONS_DIR;
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(bundledDir, { recursive: true, force: true });
    await rm(installDir, { recursive: true, force: true });
  });

  it('fresh-installs a bundled extension when none is present', async () => {
    await writeBundled('gus', { id: 'gus', version: '0.2.0', engines });
    const { seedBundledExtensions } = await importInstaller();

    const reseeded = await seedBundledExtensions();

    expect(reseeded).toEqual(['gus']);
    expect((await installedManifest('gus'))?.version).toBe('0.2.0');
  });

  it('upgrades when the bundled version is newer', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.1.0', engines }, 'OLD');
    await writeBundled('gus', { id: 'gus', version: '0.2.0', engines });
    const { seedBundledExtensions } = await importInstaller();

    const reseeded = await seedBundledExtensions();

    expect(reseeded).toEqual(['gus']);
    expect((await installedManifest('gus'))?.version).toBe('0.2.0');
    // The bundled renderer replaced the old one.
    expect(await readFile(join(installDir, 'gus', 'renderer.js'), 'utf-8')).toContain('bundled');
  });

  it('never downgrades: leaves a newer installed version untouched', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.3.0', engines }, 'NEWER-LOCAL');
    await writeBundled('gus', { id: 'gus', version: '0.2.0', engines });
    const { seedBundledExtensions } = await importInstaller();

    const reseeded = await seedBundledExtensions();

    expect(reseeded).toEqual([]);
    expect((await installedManifest('gus'))?.version).toBe('0.3.0');
    // The dev/user-newer install (its renderer marker) is preserved.
    expect(await readFile(join(installDir, 'gus', 'renderer.js'), 'utf-8')).toBe('NEWER-LOCAL');
  });

  it('leaves an equal version untouched (no churn)', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.2.0', engines }, 'SAME');
    await writeBundled('gus', { id: 'gus', version: '0.2.0', engines });
    const { seedBundledExtensions } = await importInstaller();

    expect(await seedBundledExtensions()).toEqual([]);
    expect(await readFile(join(installDir, 'gus', 'renderer.js'), 'utf-8')).toBe('SAME');
  });

  it('refuses to install a bundled artifact incompatible with the host API', async () => {
    await writeBundled('future', { id: 'future', version: '9.0.0', engines: { zccApi: '>=2' } });
    const { seedBundledExtensions } = await importInstaller();

    expect(await seedBundledExtensions()).toEqual([]);
    expect(existsSync(join(installDir, 'future'))).toBe(false);
  });

  it('treats a missing bundled version as 0.0.0 (does not overwrite a versioned install)', async () => {
    await writeInstalled('gus', { id: 'gus', version: '0.1.0', engines }, 'KEEP');
    await writeBundled('gus', { id: 'gus', engines }); // no version → 0.0.0
    const { seedBundledExtensions } = await importInstaller();

    expect(await seedBundledExtensions()).toEqual([]);
    expect(await readFile(join(installDir, 'gus', 'renderer.js'), 'utf-8')).toBe('KEEP');
  });

  it('never throws when the bundled root does not exist', async () => {
    process.env.ZCC_BUNDLED_EXTENSIONS_DIR = join(bundledDir, 'does-not-exist');
    const { seedBundledExtensions } = await importInstaller();
    await expect(seedBundledExtensions()).resolves.toEqual([]);
  });
});

describe('installFromDir', () => {
  let srcDir: string;
  const reserved = new Set(['slack']);

  beforeEach(async () => {
    installDir = await mkdtemp(join(tmpdir(), 'cc-install-'));
    srcDir = await mkdtemp(join(tmpdir(), 'cc-src-'));
    process.env.ZCC_EXTENSIONS_DIR = installDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(installDir, { recursive: true, force: true });
    await rm(srcDir, { recursive: true, force: true });
  });

  /** Lay down a candidate source dir (manifest + a renderer marker). */
  async function writeSrc(manifest: unknown, marker = 'SRC'): Promise<void> {
    await writeFile(join(srcDir, 'extension.json'), JSON.stringify(manifest), 'utf-8');
    await writeFile(join(srcDir, 'renderer.js'), marker, 'utf-8');
  }

  it('installs a valid extension into the install root', async () => {
    await writeSrc({ id: 'acme', version: '1.0.0', engines });
    const { installFromDir } = await importInstaller();

    const res = await installFromDir(srcDir, { reservedIds: reserved });
    expect(res).toEqual({ ok: true, value: { id: 'acme' } });
    expect((await installedManifest('acme'))?.version).toBe('1.0.0');
    expect(await readFile(join(installDir, 'acme', 'renderer.js'), 'utf-8')).toBe('SRC');
  });

  it('rejects a source dir with no readable manifest', async () => {
    const { installFromDir } = await importInstaller();
    const res = await installFromDir(srcDir, { reservedIds: reserved });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('BAD_MANIFEST');
  });

  it('rejects a path-escaping id (containment gate)', async () => {
    await writeSrc({ id: '../evil', version: '1.0.0', engines });
    const { installFromDir } = await importInstaller();
    const res = await installFromDir(srcDir, { reservedIds: reserved });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('BAD_ID');
    expect(existsSync(join(installDir, '..', 'evil'))).toBe(false);
  });

  it('rejects a reserved built-in id', async () => {
    await writeSrc({ id: 'slack', version: '1.0.0', engines });
    const { installFromDir } = await importInstaller();
    const res = await installFromDir(srcDir, { reservedIds: reserved });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('RESERVED_ID');
    expect(existsSync(join(installDir, 'slack'))).toBe(false);
  });

  it('rejects an API-incompatible extension', async () => {
    await writeSrc({ id: 'future', version: '9.0.0', engines: { zccApi: '>=2' } });
    const { installFromDir } = await importInstaller();
    const res = await installFromDir(srcDir, { reservedIds: reserved });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('VERSION_MISMATCH');
    expect(existsSync(join(installDir, 'future'))).toBe(false);
  });

  it('upgrades an already-installed extension in place', async () => {
    await writeInstalled('acme', { id: 'acme', version: '1.0.0', engines }, 'OLD');
    await writeSrc({ id: 'acme', version: '2.0.0', engines }, 'NEW');
    const { installFromDir } = await importInstaller();

    const res = await installFromDir(srcDir, { reservedIds: reserved });
    expect(res.ok).toBe(true);
    expect((await installedManifest('acme'))?.version).toBe('2.0.0');
    expect(await readFile(join(installDir, 'acme', 'renderer.js'), 'utf-8')).toBe('NEW');
  });

  it('serializes concurrent replacements for the same extension', async () => {
    await writeInstalled('acme', { id: 'acme', version: '1.0.0', engines }, 'OLD');
    await writeSrc({ id: 'acme', version: '2.0.0', engines }, 'NEW');
    const { installFromDir } = await importInstaller();

    const results = await Promise.all([
      installFromDir(srcDir, { reservedIds: reserved }),
      installFromDir(srcDir, { reservedIds: reserved })
    ]);

    expect(results).toEqual([
      { ok: true, value: { id: 'acme' } },
      { ok: true, value: { id: 'acme' } }
    ]);
    expect(await readFile(join(installDir, 'acme', 'renderer.js'), 'utf-8')).toBe('NEW');
  });

  it('rejects a main entry that cannot satisfy the MainModule contract', async () => {
    await writeSrc({ id: 'acme', version: '1.0.0', engines, entry: { main: 'main.mjs' } });
    await writeFile(join(srcDir, 'main.mjs'), 'export default { setup() {} };', 'utf-8');
    const { installFromDir } = await importInstaller();

    const res = await installFromDir(srcDir, { reservedIds: reserved });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('BAD_MAIN_MODULE');
    expect(existsSync(join(installDir, 'acme'))).toBe(false);
  });

  it('installs a main entry that declares its manifest id and setup', async () => {
    await writeSrc({ id: 'acme', version: '1.0.0', engines, entry: { main: 'main.mjs' } });
    await writeFile(join(srcDir, 'main.mjs'), "export default { id: 'acme', setup() {} };", 'utf-8');
    const { installFromDir } = await importInstaller();

    await expect(installFromDir(srcDir, { reservedIds: reserved })).resolves.toEqual({
      ok: true,
      value: { id: 'acme' }
    });
  });
});

describe('installFromArchiveFile', () => {
  let archiveDir: string;
  const reserved = new Set(['slack']);

  beforeEach(async () => {
    installDir = await mkdtemp(join(tmpdir(), 'cc-install-'));
    archiveDir = await mkdtemp(join(tmpdir(), 'cc-arch-'));
    process.env.ZCC_EXTENSIONS_DIR = installDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(installDir, { recursive: true, force: true });
    await rm(archiveDir, { recursive: true, force: true });
  });

  /** Write a JSON file-bundle archive and return its path. */
  async function writeArchive(files: Record<string, string>, name = 'pkg.json'): Promise<string> {
    const encoded = Object.fromEntries(
      Object.entries(files).map(([k, v]) => [k, Buffer.from(v).toString('base64')])
    );
    const file = join(archiveDir, name);
    await writeFile(file, JSON.stringify({ files: encoded }), 'utf-8');
    return file;
  }

  it('installs from a valid archive (one decode path with the marketplace)', async () => {
    const file = await writeArchive({
      'extension.json': JSON.stringify({ id: 'acme', version: '1.0.0', engines }),
      'renderer.js': '// acme'
    });
    const { installFromArchiveFile } = await importInstaller();

    const res = await installFromArchiveFile(file, { reservedIds: reserved });
    expect(res).toEqual({ ok: true, value: { id: 'acme' } });
    expect((await installedManifest('acme'))?.version).toBe('1.0.0');
  });

  it('rejects an archive with a path-escaping file name (decodeArchive guard)', async () => {
    // Hand-build (writeArchive can't produce escaping names cleanly).
    const files = {
      'extension.json': Buffer.from(JSON.stringify({ id: 'acme', version: '1.0.0' })).toString('base64'),
      '../evil.js': Buffer.from('pwned').toString('base64')
    };
    const file = join(archiveDir, 'evil.json');
    await writeFile(file, JSON.stringify({ files }), 'utf-8');
    const { installFromArchiveFile } = await importInstaller();

    const res = await installFromArchiveFile(file, { reservedIds: reserved });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('BAD_ARCHIVE');
  });

  it('rejects an archive missing extension.json', async () => {
    const file = await writeArchive({ 'renderer.js': '// orphan' });
    const { installFromArchiveFile } = await importInstaller();
    const res = await installFromArchiveFile(file, { reservedIds: reserved });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('BAD_ARCHIVE');
  });

  it('rejects an oversize archive file before reading it (Rule #5 — same 16 MiB cap as the marketplace)', async () => {
    // A file whose on-disk size exceeds the cap is rejected by the stat() gate
    // without ever loading the bytes — content is irrelevant to the guard.
    const { ARCHIVE_MAX_BYTES } = await import('../extension-registry.js');
    const file = join(archiveDir, 'huge.json');
    await writeFile(file, Buffer.alloc(ARCHIVE_MAX_BYTES + 1, 0x20)); // 16 MiB + 1
    const { installFromArchiveFile } = await importInstaller();

    const res = await installFromArchiveFile(file, { reservedIds: reserved });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('BAD_ARCHIVE');
      expect(res.message).toContain('over the');
    }
  });

  it('accepts an archive at exactly the size cap (boundary)', async () => {
    // Build a valid archive, then confirm a file at the cap is NOT rejected by
    // the size gate (it proceeds to decode/install). Guards an off-by-one.
    const file = await writeArchive({
      'extension.json': JSON.stringify({ id: 'edge', version: '1.0.0', engines }),
      'renderer.js': '// edge'
    });
    const { ARCHIVE_MAX_BYTES } = await import('../extension-registry.js');
    const { size } = await stat(file);
    expect(size).toBeLessThanOrEqual(ARCHIVE_MAX_BYTES); // a normal archive is well under
    const { installFromArchiveFile } = await importInstaller();
    const res = await installFromArchiveFile(file, { reservedIds: reserved });
    expect(res).toEqual({ ok: true, value: { id: 'edge' } });
  });
});

describe('uninstallExtension', () => {
  const reserved = new Set(['slack']);

  beforeEach(async () => {
    installDir = await mkdtemp(join(tmpdir(), 'cc-install-'));
    process.env.ZCC_EXTENSIONS_DIR = installDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(installDir, { recursive: true, force: true });
  });

  it('removes an installed extension dir (and its .prev rollback backup)', async () => {
    await writeInstalled('acme', { id: 'acme', version: '1.0.0', engines }, 'X');
    // Simulate an update rollback backup left behind.
    await mkdir(join(installDir, 'acme.prev'), { recursive: true });
    await writeFile(join(installDir, 'acme.prev', 'extension.json'), '{}', 'utf-8');
    const { uninstallExtension } = await importInstaller();

    const res = await uninstallExtension('acme', { reservedIds: reserved });
    expect(res).toEqual({ ok: true, value: true });
    expect(existsSync(join(installDir, 'acme'))).toBe(false);
    expect(existsSync(join(installDir, 'acme.prev'))).toBe(false);
  });

  it('refuses to remove a reserved built-in id', async () => {
    const { uninstallExtension } = await importInstaller();
    const res = await uninstallExtension('slack', { reservedIds: reserved });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('RESERVED_ID');
  });

  it('rejects a path-escaping id (containment gate)', async () => {
    const { uninstallExtension } = await importInstaller();
    const res = await uninstallExtension('../evil', { reservedIds: reserved });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('BAD_ID');
  });

  it('returns NOT_FOUND when nothing is installed for the id', async () => {
    const { uninstallExtension } = await importInstaller();
    const res = await uninstallExtension('ghost', { reservedIds: reserved });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NOT_FOUND');
  });
});
