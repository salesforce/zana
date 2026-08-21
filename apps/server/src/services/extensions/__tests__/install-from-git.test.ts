/**
 * Unit coverage for `installFromGit` + its helpers (`locateManifestDir`,
 * `stageInstallable`, `stripCreds`) — the Track A install path. No network: the
 * clone step is DI'd (`normalizeRepoUrl` rejects `file://`/local paths, so real
 * cloning is exercised only in the e2e suite). The fake clone materializes a
 * working tree on disk exactly as `cloneProject` would, so the locator + scrub +
 * `installFromDir` seam run for real against `ZCC_EXTENSIONS_DIR`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CloneOptions, CloneResult } from '../../projects/git-clone.js';

let installDir: string;
let tempDir: string;

async function importInstaller() {
  return await import('../extension-installer.js');
}

const engines = { zccApi: '>=1 <2' };
const RESERVED = new Set(['slack']);
const installOpts = { reservedIds: RESERVED };

function goodManifest(id: string): Record<string, unknown> {
  return {
    id,
    version: '0.1.0',
    title: 'T',
    icon: 'Puzzle',
    entry: { renderer: 'dist/renderer.js' },
    engines
  };
}

/**
 * Build a fake `clone` dep that, when called, writes `tree` (a map of relPath →
 * contents) under `<destBase>/<repoName>` — mimicking `cloneProject` — and
 * returns a matching CloneResult. Records the CloneOptions it was called with.
 */
function fakeClone(
  tree: Record<string, string>,
  opts?: { repoName?: string; resolvedSha?: string; cloneUrl?: string; result?: Partial<CloneResult> }
): { clone: (o: CloneOptions) => Promise<CloneResult>; calls: CloneOptions[] } {
  const calls: CloneOptions[] = [];
  const repoName = opts?.repoName ?? 'repo';
  const clone = async (o: CloneOptions): Promise<CloneResult> => {
    calls.push(o);
    if (opts?.result && opts.result.ok === false) {
      return { ok: false, code: opts.result.code ?? 'CLONE_FAILED', message: opts.result.message };
    }
    const path = join(o.destBase, repoName);
    for (const [rel, contents] of Object.entries(tree)) {
      const abs = join(path, rel);
      await mkdir(join(abs, '..'), { recursive: true });
      await writeFile(abs, contents, 'utf-8');
    }
    return {
      ok: true,
      path,
      repoName,
      cloneUrl: opts?.cloneUrl ?? o.url,
      ...(opts?.resolvedSha ? { resolvedSha: opts.resolvedSha } : {})
    };
  };
  return { clone, calls };
}

describe('installFromGit', () => {
  beforeEach(async () => {
    installDir = await mkdtemp(join(tmpdir(), 'cc-git-install-'));
    tempDir = await mkdtemp(join(tmpdir(), 'cc-git-temp-'));
    process.env.ZCC_EXTENSIONS_DIR = installDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(installDir, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
  });

  it('installs an extension whose manifest is at the repo root', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone({
      'extension.json': JSON.stringify(goodManifest('mytool')),
      'dist/renderer.js': '// mytool'
    });

    const res = await installFromGit('https://github.com/owner/repo', {}, installOpts, { clone });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.id).toBe('mytool');
    expect((await readFile(join(installDir, 'mytool', 'extension.json'), 'utf-8'))).toContain(
      '"mytool"'
    );
    expect(await readFile(join(installDir, 'mytool', 'dist', 'renderer.js'), 'utf-8')).toBe(
      '// mytool'
    );
  });

  it('locates a manifest one level down (single subdir)', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone({
      'pkg/extension.json': JSON.stringify(goodManifest('subtool')),
      'pkg/dist/renderer.js': '// subtool',
      'README.md': 'top-level readme, no manifest'
    });

    const res = await installFromGit('https://github.com/owner/repo', {}, installOpts, { clone });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.id).toBe('subtool');
  });

  it('honors an explicit subdir', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone({
      'a/extension.json': JSON.stringify(goodManifest('atool')),
      'a/dist/renderer.js': '// a',
      'b/extension.json': JSON.stringify(goodManifest('btool')),
      'b/dist/renderer.js': '// b'
    });

    const res = await installFromGit(
      'https://github.com/owner/repo',
      { subdir: 'b' },
      installOpts,
      { clone }
    );

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.id).toBe('btool');
  });

  it('fails AMBIGUOUS_MANIFEST when >1 subdir has a manifest and no subdir given', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone({
      'a/extension.json': JSON.stringify(goodManifest('atool')),
      'b/extension.json': JSON.stringify(goodManifest('btool'))
    });

    const res = await installFromGit('https://github.com/owner/repo', {}, installOpts, { clone });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('AMBIGUOUS_MANIFEST');
    // Fail-closed: nothing installed.
    expect(await readdir(installDir)).toEqual([]);
  });

  it('fails MANIFEST_NOT_FOUND when no manifest exists anywhere at depth 1', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone({
      'src/index.ts': 'export {}',
      'README.md': 'no manifest'
    });

    const res = await installFromGit('https://github.com/owner/repo', {}, installOpts, { clone });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('MANIFEST_NOT_FOUND');
  });

  it('fails BAD_SUBDIR when the subdir escapes the clone root', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone({ 'extension.json': JSON.stringify(goodManifest('x')) });

    const res = await installFromGit(
      'https://github.com/owner/repo',
      { subdir: '../../etc' },
      installOpts,
      { clone }
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('BAD_SUBDIR');
  });

  it('passes the ref through to the clone dep', async () => {
    const { installFromGit } = await importInstaller();
    const { clone, calls } = fakeClone({
      'extension.json': JSON.stringify(goodManifest('reftool')),
      'dist/renderer.js': '// x'
    });

    await installFromGit('https://github.com/owner/repo', { ref: 'v1.2.3' }, installOpts, { clone });

    expect(calls[0].ref).toBe('v1.2.3');
    expect(calls[0].shallow).toBe(true);
  });

  it('maps a BAD_INPUT clone failure to BAD_SOURCE', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone({}, { result: { ok: false, code: 'BAD_INPUT' } });

    const res = await installFromGit('--upload-pack=evil', {}, installOpts, { clone });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('BAD_SOURCE');
  });

  it('maps a generic clone failure to CLONE_FAILED', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone({}, { result: { ok: false, code: 'CLONE_FAILED' } });

    const res = await installFromGit('https://github.com/owner/nope', {}, installOpts, { clone });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('CLONE_FAILED');
  });

  it('refuses a tree containing a symlink (UNSAFE_TREE)', async () => {
    const { installFromGit } = await importInstaller();
    // Fake clone that writes a manifest AND a symlink escaping the tree.
    const calls: CloneOptions[] = [];
    const clone = async (o: CloneOptions): Promise<CloneResult> => {
      calls.push(o);
      const path = join(o.destBase, 'repo');
      await mkdir(join(path, 'dist'), { recursive: true });
      await writeFile(join(path, 'extension.json'), JSON.stringify(goodManifest('evil')), 'utf-8');
      await writeFile(join(path, 'dist', 'renderer.js'), '// x', 'utf-8');
      await symlink('/etc/passwd', join(path, 'leak'));
      return { ok: true, path, repoName: 'repo', cloneUrl: o.url };
    };

    const res = await installFromGit('https://github.com/owner/repo', {}, installOpts, { clone });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('UNSAFE_TREE');
    expect(existsSync(join(installDir, 'evil'))).toBe(false);
  });

  it('excludes .git/ from the installed tree', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone({
      'extension.json': JSON.stringify(goodManifest('clean')),
      'dist/renderer.js': '// clean',
      '.git/config': '[core]',
      '.git/HEAD': 'ref: refs/heads/main'
    });

    const res = await installFromGit('https://github.com/owner/repo', {}, installOpts, { clone });

    expect(res.ok).toBe(true);
    expect(existsSync(join(installDir, 'clean', '.git'))).toBe(false);
  });

  it('records credential-stripped provenance with ref + sha', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone(
      {
        'extension.json': JSON.stringify(goodManifest('prov')),
        'dist/renderer.js': '// x'
      },
      { resolvedSha: 'abc123', cloneUrl: 'https://user:token@github.com/owner/repo.git' }
    );

    const res = await installFromGit(
      'https://user:token@github.com/owner/repo.git',
      { ref: 'main' },
      installOpts,
      { clone }
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.provenance.url).toBe('https://github.com/owner/repo.git');
      expect(res.value.provenance.url).not.toContain('token');
      expect(res.value.provenance.ref).toBe('main');
      expect(res.value.provenance.sha).toBe('abc123');
    }
  });

  it('still runs the installFromDir gate: a reserved id is rejected', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone({
      'extension.json': JSON.stringify(goodManifest('slack')),
      'dist/renderer.js': '// x'
    });

    const res = await installFromGit('https://github.com/owner/repo', {}, installOpts, { clone });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('RESERVED_ID');
  });

  it('still runs the installFromDir gate: an incompatible api range is rejected', async () => {
    const { installFromGit } = await importInstaller();
    const { clone } = fakeClone({
      'extension.json': JSON.stringify({ ...goodManifest('future'), engines: { zccApi: '>=2' } }),
      'dist/renderer.js': '// x'
    });

    const res = await installFromGit('https://github.com/owner/repo', {}, installOpts, { clone });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('VERSION_MISMATCH');
  });

  it('cleans up the temp clone + staging dir on success', async () => {
    const { installFromGit } = await importInstaller();
    const before = await readdir(tempDir);
    const { clone } = fakeClone({
      'extension.json': JSON.stringify(goodManifest('tidy')),
      'dist/renderer.js': '// x'
    });

    await installFromGit('https://github.com/owner/repo', {}, installOpts, { clone, tempBase: tempDir });

    const after = await readdir(tempDir);
    const leaked = after.filter(
      (n) =>
        (n.startsWith('zcc-ext-git-') || n.startsWith('zcc-ext-stage-')) &&
        !before.includes(n)
    );
    expect(leaked).toEqual([]);
  });

  it('cleans up the temp clone dir on failure too', async () => {
    const { installFromGit } = await importInstaller();
    const before = await readdir(tempDir);
    const { clone } = fakeClone({ 'README.md': 'no manifest' });

    await installFromGit('https://github.com/owner/repo', {}, installOpts, { clone, tempBase: tempDir });

    const after = await readdir(tempDir);
    const leaked = after.filter(
      (n) => n.startsWith('zcc-ext-git-') && !before.includes(n)
    );
    expect(leaked).toEqual([]);
  });
});

describe('stripCreds', () => {
  it('removes user:token from an https url without lowercasing the path', async () => {
    const { stripCreds } = await importInstaller();
    expect(stripCreds('https://user:tok@github.com/Owner/Repo.git')).toBe(
      'https://github.com/Owner/Repo.git'
    );
  });

  it('preserves the SSH login user on an scp-style spec (it is not a secret)', async () => {
    const { stripCreds } = await importInstaller();
    // `git@host:owner/repo` — the `git@` login identity must survive so a later
    // update-from-repo can still parse the stored url via normalizeRepoUrl.
    // Dropping it stored `github.com:owner/repo.git`, which no longer matches the
    // scp regex and broke the update path (reviewer LOW finding).
    expect(stripCreds('git@github.com:owner/repo.git')).toBe('git@github.com:owner/repo.git');
  });

  it('is a no-op for a bare url', async () => {
    const { stripCreds } = await importInstaller();
    expect(stripCreds('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
  });
});
