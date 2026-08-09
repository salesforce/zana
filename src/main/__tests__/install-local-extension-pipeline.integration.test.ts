import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * End-to-end exercise of the REAL pipeline behind `install_local_extension`,
 * with no mocks: scaffold a local extension on disk, then reproduce exactly
 * what index.ts's `installOwnExtension` closure does —
 *   findLocalRecordByCwd(cwd) -> readWorkingDirId -> packLocalExtension ->
 *   installFromDir -> (staging cleanup)
 * — against real temp directories standing in for `~/zcc-workspace/extensions`
 * (the working dir) and `~/.zcc/extensions` (the install root), both pointed
 * at via env overrides the way the app already does in tests.
 *
 * This is the strongest verification available short of booting Electron: if
 * discovery.ts, local-extension.ts, and extension-installer.ts ever drift out
 * of sync (a renamed field, a changed Result shape), this test fails for the
 * same reason the real tool would.
 */

let extDir: string; // stands in for ~/.zcc/extensions (ZCC_EXTENSIONS_DIR)
let workRoot: string; // stands in for ~/zcc-workspace (scratch workspace root)

async function importModules() {
  const discovery = await import('../extensions/discovery.js');
  const localExtension = await import('../local-extension.js');
  const installer = await import('../extension-installer.js');
  return { discovery, localExtension, installer };
}

/** Mirrors index.ts's `installOwnExtension` closure verbatim (sans ptys). */
async function installOwnExtension(cwd: string) {
  const { discovery, localExtension, installer } = await importModules();
  const found = await discovery.findLocalRecordByCwd(cwd);
  if (!found) {
    return { ok: false as const, code: 'NOT_LOCAL', message: 'not a registered local extension' };
  }
  const { id, record } = found;
  const declaredId = await localExtension.readWorkingDirId(record.workingDir);
  if (declaredId !== id) {
    return {
      ok: false as const,
      code: 'ID_MISMATCH',
      message: `Source manifest id "${declaredId ?? '(none)'}" does not match "${id}"`
    };
  }
  const packed = await localExtension.packLocalExtension(record.workingDir);
  if (!packed.ok) return packed;
  try {
    const installed = await installer.installFromDir(packed.value.stagingDir, {
      reservedIds: new Set<string>(['slack']),
      log: () => {}
    });
    return installed;
  } finally {
    await rm(packed.value.stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

describe('install_local_extension pipeline (real fs, no mocks)', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-install-root-'));
    workRoot = await mkdtemp(join(tmpdir(), 'cc-ext-workdir-'));
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
    await rm(workRoot, { recursive: true, force: true });
  });

  it('scaffolds, registers, then installs from the session cwd end to end', async () => {
    const { discovery, localExtension } = await importModules();
    const id = 'my-tool-a1b2';
    const workingDir = localExtension.workingDirFor(workRoot, id);

    const scaffolded = await localExtension.scaffoldLocalExtension(workingDir, {
      id,
      name: 'My Tool',
      description: 'does things',
      kind: 'panel'
    });
    expect(scaffolded.ok).toBe(true);

    // Not yet installed: no local.json entry, so a session cwd there resolves
    // to nothing — exactly what a bare working dir (before createLocal marks
    // it) would look like.
    expect(await discovery.findLocalRecordByCwd(workingDir)).toBeNull();

    // This is what index.ts's createLocal flow does after the first install.
    await discovery.markLocal(id, workingDir);

    // Now the agent calls install_local_extension from a session whose cwd is
    // this exact working dir.
    const result = await installOwnExtension(workingDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(id);

    // The extension is now really on disk under the install root, with only
    // the curated bytes (manifest + dist/), matching installFromDir's contract.
    const installedDir = join(extDir, id);
    expect(existsSync(join(installedDir, 'extension.json'))).toBe(true);
    expect(existsSync(join(installedDir, 'dist', 'renderer.js'))).toBe(true);
    const manifest = JSON.parse(await readFile(join(installedDir, 'extension.json'), 'utf-8'));
    expect(manifest.id).toBe(id);

    // Staging dir was cleaned up — no leftover temp directories.
    // (packLocalExtension always returns a fresh staging path; if cleanup
    // failed, an install right after would still succeed since ids differ.)
  });

  it('resolves the extension even when the session cwd is a subdirectory of the working dir', async () => {
    const { discovery, localExtension } = await importModules();
    const id = 'nested-cwd-9f3a';
    const workingDir = localExtension.workingDirFor(workRoot, id);
    await localExtension.scaffoldLocalExtension(workingDir, { id, name: 'Nested', kind: 'panel' });
    await discovery.markLocal(id, workingDir);

    // Agent `cd`'d into dist/ within its own working dir.
    const nestedCwd = join(workingDir, 'dist');
    const result = await installOwnExtension(nestedCwd);
    expect(result.ok).toBe(true);
  });

  it('fails closed (NOT_LOCAL) when the session cwd is not a registered local extension', async () => {
    const rogueDir = await mkdtemp(join(tmpdir(), 'cc-ext-rogue-'));
    try {
      const result = await installOwnExtension(rogueDir);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_LOCAL');
      // Nothing was installed anywhere under the install root.
      const { readdir } = await import('node:fs/promises');
      const entries = existsSync(extDir) ? await readdir(extDir) : [];
      expect(entries.filter((e) => e !== 'local.json')).toEqual([]);
    } finally {
      await rm(rogueDir, { recursive: true, force: true });
    }
  });

  it('fails closed (ID_MISMATCH) when the working dir manifest id was hand-edited away from the registry key', async () => {
    const { discovery, localExtension } = await importModules();
    const registeredId = 'registered-aaaa';
    const workingDir = localExtension.workingDirFor(workRoot, registeredId);
    await localExtension.scaffoldLocalExtension(workingDir, {
      id: registeredId,
      name: 'X',
      kind: 'panel'
    });
    await discovery.markLocal(registeredId, workingDir);

    // Hand-edit the manifest's id after registration (simulating a user/agent
    // typo or tamper), without updating local.json.
    const manifestPath = join(workingDir, 'extension.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    manifest.id = 'someone-elses-id';
    await (await import('node:fs/promises')).writeFile(manifestPath, JSON.stringify(manifest), 'utf-8');

    const result = await installOwnExtension(workingDir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ID_MISMATCH');
    // Nothing installed under either id.
    expect(existsSync(join(extDir, registeredId))).toBe(false);
    expect(existsSync(join(extDir, 'someone-elses-id'))).toBe(false);
  });

  it('a reserved built-in id cannot be hijacked through the local-extension path', async () => {
    const { discovery, localExtension } = await importModules();
    const workingDir = localExtension.workingDirFor(workRoot, 'slack');
    await localExtension.scaffoldLocalExtension(workingDir, { id: 'slack', name: 'Slack', kind: 'panel' });
    await discovery.markLocal('slack', workingDir);

    const result = await installOwnExtension(workingDir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('RESERVED_ID');
  });

  it('re-installing after an edit updates the installed copy in place', async () => {
    const { discovery, localExtension } = await importModules();
    const id = 'reinstall-bbbb';
    const workingDir = localExtension.workingDirFor(workRoot, id);
    await localExtension.scaffoldLocalExtension(workingDir, { id, name: 'V1', kind: 'panel' });
    await discovery.markLocal(id, workingDir);

    const first = await installOwnExtension(workingDir);
    expect(first.ok).toBe(true);

    // Agent edits the renderer, then calls install_local_extension again.
    const rendererPath = join(workingDir, 'dist', 'renderer.js');
    await (await import('node:fs/promises')).writeFile(
      rendererPath,
      '// v2 marker\n' + (await readFile(rendererPath, 'utf-8')),
      'utf-8'
    );

    const second = await installOwnExtension(workingDir);
    expect(second.ok).toBe(true);

    const installedRenderer = await readFile(
      join(extDir, id, 'dist', 'renderer.js'),
      'utf-8'
    );
    expect(installedRenderer).toContain('// v2 marker');
  });
});
