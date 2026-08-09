/**
 * Local git-daemon serving a bare repo over `git://127.0.0.1:<port>` — the
 * offline stand-in for a real remote the install-from-git flow clones from.
 *
 * WHY a daemon and not a `file://` path: the app's `normalizeRepoUrl`
 * (src/main/git-clone.ts) deliberately REJECTS `file://` and bare local paths as
 * a clone spec, but ACCEPTS the `git://` scheme (its allowlist is
 * https/http/ssh/git). So a `git daemon --export-all` on an ephemeral port gives
 * us a URL the real app accepts and clones — no network, no app-code test seam,
 * exercising the SAME clone → locate → scrub → installFromDir → consent path a
 * user hits with a github URL.
 *
 * Isolation: everything lives under a caller-owned throwaway dir; `close()`
 * kills the daemon. The daemon binds 127.0.0.1 only.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';

/** One extension's source, either copied from a fixture dir or spelled inline. */
export interface GitRepoSpec {
  /** Repo folder name as served (the `<repoName>.git` path segment). */
  repoName: string;
  /** Copy this dir's contents in as the repo tree (e.g. a fixture extension). */
  fromDir?: string;
  /** Or write these files verbatim (relPath → contents). Merged over `fromDir`. */
  files?: Record<string, string>;
  /** Extra commit made and tagged; lets a spec pin `ref`. */
  tag?: string;
}

export interface GitDaemon {
  /** The `git://` base, e.g. git://127.0.0.1:9418 (no trailing slash). */
  baseUrl: string;
  /** Full clone URL for a repo, e.g. git://127.0.0.1:9418/gus.git. */
  urlFor(repoName: string): string;
  /** The source (non-bare) worktree, so a spec can commit an update + re-serve. */
  sourceDir(repoName: string): string;
  /**
   * Commit the current source tree of `repoName` and push it into the served
   * bare repo — used by the update-from-repo test to publish new bytes.
   */
  publishUpdate(repoName: string, message?: string): void;
  close(): Promise<void>;
}

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  env.GIT_AUTHOR_NAME = 'E2E';
  env.GIT_AUTHOR_EMAIL = 'e2e@example.com';
  env.GIT_COMMITTER_NAME = 'E2E';
  env.GIT_COMMITTER_EMAIL = 'e2e@example.com';
  return env;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, env: gitEnv(), stdio: 'ignore' });
}

/** Grab an ephemeral free TCP port on 127.0.0.1 (daemon binds it right after). */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Stand up a git daemon under `workDir` (throwaway, caller-owned) serving every
 * repo in `specs`. Returns once the daemon answers a clone.
 */
export async function startGitDaemon(workDir: string, specs: GitRepoSpec[]): Promise<GitDaemon> {
  const srcRoot = join(workDir, 'src');
  const bareRoot = join(workDir, 'bare');
  mkdirSync(srcRoot, { recursive: true });
  mkdirSync(bareRoot, { recursive: true });

  const sourceDirs = new Map<string, string>();

  for (const spec of specs) {
    const src = join(srcRoot, spec.repoName);
    mkdirSync(src, { recursive: true });
    if (spec.fromDir) cpSync(spec.fromDir, src, { recursive: true });
    for (const [rel, contents] of Object.entries(spec.files ?? {})) {
      const dest = join(src, rel);
      mkdirSync(join(dest, '..'), { recursive: true });
      writeFileSync(dest, contents);
    }
    git(src, 'init', '-q', '-b', 'main');
    git(src, 'add', '.');
    git(src, 'commit', '-qm', 'initial');
    if (spec.tag) git(src, 'tag', spec.tag);
    // Bare mirror the daemon actually exports.
    const bare = join(bareRoot, `${spec.repoName}.git`);
    execFileSync('git', ['clone', '-q', '--bare', src, bare], { env: gitEnv(), stdio: 'ignore' });
    sourceDirs.set(spec.repoName, src);
  }

  const port = await freePort();
  // --export-all removes the need for a per-repo `git-daemon-export-ok` marker.
  const child: ChildProcess = spawn(
    'git',
    [
      'daemon',
      '--reuseaddr',
      '--listen=127.0.0.1',
      `--port=${port}`,
      `--base-path=${bareRoot}`,
      '--export-all',
      bareRoot,
    ],
    { env: gitEnv(), stdio: 'ignore' }
  );

  const baseUrl = `git://127.0.0.1:${port}`;
  const urlFor = (repoName: string) => `${baseUrl}/${repoName}.git`;

  // Poll until the daemon answers `ls-remote` on the first repo — the daemon
  // takes a beat to bind after spawn.
  const first = specs[0]?.repoName;
  if (first) {
    let up = false;
    for (let i = 0; i < 40; i++) {
      try {
        execFileSync('git', ['ls-remote', urlFor(first)], { env: gitEnv(), stdio: 'ignore' });
        up = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!up) {
      child.kill('SIGKILL');
      throw new Error('git daemon never became reachable');
    }
  }

  return {
    baseUrl,
    urlFor,
    sourceDir: (repoName: string) => {
      const d = sourceDirs.get(repoName);
      if (!d) throw new Error(`unknown repo ${repoName}`);
      return d;
    },
    publishUpdate: (repoName: string, message = 'update') => {
      const src = sourceDirs.get(repoName);
      if (!src) throw new Error(`unknown repo ${repoName}`);
      git(src, 'add', '.');
      git(src, 'commit', '-qm', message);
      const bare = join(bareRoot, `${repoName}.git`);
      if (!existsSync(bare)) throw new Error(`no bare repo for ${repoName}`);
      git(src, 'push', '-q', bare, 'main');
    },
    close: () =>
      new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill('SIGKILL');
        // Fallback in case the process was already gone.
        setTimeout(resolve, 1000);
      }),
  };
}
