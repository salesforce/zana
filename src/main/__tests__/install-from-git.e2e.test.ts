/**
 * Offline end-to-end for the git-install path. `normalizeRepoUrl` rejects
 * `file://`/local specs, so a full real clone is exercised here via the DI clone
 * seam running a raw `git clone -- <barePath>` against a bare repo we build on
 * disk. Everything downstream — locateManifestDir, stageInstallable (symlink/.git
 * scrub), installFromDir (manifest/id/api/reserved gates + atomic replaceDir into
 * ZCC_EXTENSIONS_DIR), and temp cleanup — runs for real. No network.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { CloneOptions, CloneResult } from '../git-clone.js';

const execFileP = promisify(execFile);

// See git-worktree.test.ts: scrub inherited GIT_* so the suite behaves the same
// standalone and under this repo's pre-push hook.
beforeAll(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
});

function cleanGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  env.GIT_AUTHOR_NAME = 'T';
  env.GIT_AUTHOR_EMAIL = 't@example.com';
  env.GIT_COMMITTER_NAME = 'T';
  env.GIT_COMMITTER_EMAIL = 't@example.com';
  return env;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd, env: cleanGitEnv() });
  return stdout.trim();
}

/**
 * A real clone dep: ignores normalizeRepoUrl (we pass an absolute bare-repo path
 * as the "url") and runs `git clone -- <path> <dest>`, mirroring cloneProject's
 * contract (clones into destBase/<repoName>, returns { path, cloneUrl,
 * resolvedSha } and honors `ref` via a detached checkout). Offline.
 */
function realBareClone(barePath: string): (o: CloneOptions) => Promise<CloneResult> {
  return async (o: CloneOptions): Promise<CloneResult> => {
    const dest = join(o.destBase, 'repo');
    try {
      await mkdir(o.destBase, { recursive: true });
      await execFileP('git', ['clone', '--', barePath, dest], { env: cleanGitEnv() });
      if (o.ref) {
        await git(dest, '-c', 'advice.detachedHead=false', 'checkout', '--detach', o.ref);
      }
      const sha = await git(dest, 'rev-parse', 'HEAD');
      return { ok: true, path: dest, repoName: 'repo', cloneUrl: o.url, resolvedSha: sha };
    } catch (err) {
      return { ok: false, code: 'CLONE_FAILED', message: err instanceof Error ? err.message : String(err) };
    }
  };
}

const RESERVED = new Set(['slack']);
const installOpts = { reservedIds: RESERVED };

function manifest(id: string, version = '1.0.0'): Record<string, unknown> {
  return {
    id,
    version,
    title: 'E2E Tool',
    icon: 'Puzzle',
    entry: { renderer: 'dist/renderer.js' },
    engines: { zccApi: '>=1 <2' }
  };
}

describe('installFromGit e2e (real bare repo, offline)', () => {
  let workspace: string; // holds source repo + bare repo + install dir
  let installDir: string;
  let sourceRepo: string;
  let bareRepo: string;

  async function importInstaller() {
    return await import('../extension-installer.js');
  }

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'cc-git-e2e-'));
    installDir = join(workspace, 'install');
    sourceRepo = join(workspace, 'src');
    bareRepo = join(workspace, 'bare.git');
    await mkdir(installDir, { recursive: true });
    process.env.ZCC_EXTENSIONS_DIR = installDir;

    // Build a real source repo: manifest + dist/renderer.js, tag v1.0.0.
    await mkdir(join(sourceRepo, 'dist'), { recursive: true });
    await writeFile(join(sourceRepo, 'extension.json'), JSON.stringify(manifest('e2e-tool')), 'utf-8');
    await writeFile(join(sourceRepo, 'dist', 'renderer.js'), '// v1\n', 'utf-8');
    await git(sourceRepo, 'init', '-b', 'main');
    await git(sourceRepo, 'add', '.');
    await git(sourceRepo, 'commit', '-m', 'v1');
    await git(sourceRepo, 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
    // Bare clone the caller drives installFromGit against.
    await execFileP('git', ['clone', '--bare', sourceRepo, bareRepo], { env: cleanGitEnv() });
  });

  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(workspace, { recursive: true, force: true });
  });

  it('clones, stages, and installs into ZCC_EXTENSIONS_DIR with matching bytes', async () => {
    const { installFromGit } = await importInstaller();
    const before = await readdir(workspace);

    const res = await installFromGit(bareRepo, {}, installOpts, {
      clone: realBareClone(bareRepo),
      tempBase: workspace
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.id).toBe('e2e-tool');

    const installed = join(installDir, 'e2e-tool');
    expect(existsSync(installed)).toBe(true);
    expect(await readFile(join(installed, 'dist', 'renderer.js'), 'utf-8')).toBe('// v1\n');
    // .git never lands in the install.
    expect(existsSync(join(installed, '.git'))).toBe(false);

    // Temp clone dir cleaned up.
    const after = await readdir(workspace);
    const leaked = after.filter(
      (n) =>
        (n.startsWith('zcc-ext-git-') || n.startsWith('zcc-ext-stage-')) &&
        !before.includes(n)
    );
    expect(leaked).toEqual([]);
  });

  it('records provenance with the resolved sha', async () => {
    const { installFromGit } = await importInstaller();
    const res = await installFromGit(bareRepo, { ref: 'v1.0.0' }, installOpts, {
      clone: realBareClone(bareRepo)
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.provenance.ref).toBe('v1.0.0');
      expect(res.value.provenance.sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('a non-existent repo path → CLONE_FAILED, install root untouched', async () => {
    const { installFromGit } = await importInstaller();
    const missing = join(workspace, 'does-not-exist.git');
    const res = await installFromGit(missing, {}, installOpts, { clone: realBareClone(missing) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('CLONE_FAILED');
    expect(await readdir(installDir)).toEqual([]);
  });

  it('update path: a new upstream commit reinstalls the new bytes in place', async () => {
    const { installFromGit } = await importInstaller();

    // Initial install.
    const first = await installFromGit(bareRepo, {}, installOpts, { clone: realBareClone(bareRepo) });
    expect(first.ok).toBe(true);
    const installed = join(installDir, 'e2e-tool');
    expect(await readFile(join(installed, 'dist', 'renderer.js'), 'utf-8')).toBe('// v1\n');

    // New commit upstream (bump version so installFromDir accepts the upgrade),
    // pushed into the bare repo.
    await writeFile(join(sourceRepo, 'dist', 'renderer.js'), '// v2\n', 'utf-8');
    await writeFile(join(sourceRepo, 'extension.json'), JSON.stringify(manifest('e2e-tool', '1.1.0')), 'utf-8');
    await git(sourceRepo, 'add', '.');
    await git(sourceRepo, 'commit', '-m', 'v2');
    await git(sourceRepo, 'push', bareRepo, 'main');

    // Re-run installFromGit — upgrades in place.
    const second = await installFromGit(bareRepo, {}, installOpts, { clone: realBareClone(bareRepo) });
    expect(second.ok).toBe(true);
    expect(await readFile(join(installed, 'dist', 'renderer.js'), 'utf-8')).toBe('// v2\n');
  });

  it('a repo with the manifest in a subfolder installs via the subdir arg', async () => {
    const { installFromGit } = await importInstaller();

    // Build a second bare repo whose manifest lives under packages/tool/.
    const src2 = join(workspace, 'src2');
    await mkdir(join(src2, 'packages', 'tool', 'dist'), { recursive: true });
    await writeFile(
      join(src2, 'packages', 'tool', 'extension.json'),
      JSON.stringify(manifest('sub-tool')),
      'utf-8'
    );
    await writeFile(join(src2, 'packages', 'tool', 'dist', 'renderer.js'), '// sub\n', 'utf-8');
    await writeFile(join(src2, 'README.md'), '# monorepo\n', 'utf-8');
    await git(src2, 'init', '-b', 'main');
    await git(src2, 'add', '.');
    await git(src2, 'commit', '-m', 'init');
    const bare2 = join(workspace, 'bare2.git');
    await execFileP('git', ['clone', '--bare', src2, bare2], { env: cleanGitEnv() });

    const res = await installFromGit(bare2, { subdir: 'packages/tool' }, installOpts, {
      clone: realBareClone(bare2)
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.id).toBe('sub-tool');
    expect(await readFile(join(installDir, 'sub-tool', 'dist', 'renderer.js'), 'utf-8')).toBe('// sub\n');
  });
});
