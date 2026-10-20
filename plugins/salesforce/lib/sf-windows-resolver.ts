import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Windows-only Salesforce CLI launch resolution.
 *
 * On Windows `sf` is an `sf.cmd` batch shim. Spawning plain `sf` without a
 * shell cannot start it at all, and running it through cmd.exe re-parses `%*`
 * inside the batch file, where an argument with quotes (a Preview utterance,
 * an SDK caller's value) can escape its quoting. So we find the install the
 * shim belongs to and run its bundled `node.exe` on the CLI entry directly,
 * with no shell involved.
 *
 * Layouts are recognised by directory structure; shim text is never executed:
 * - installer: `<root>\bin\sf.cmd` with `<root>\client\bin\{node.exe,run.js}`;
 *   when the auto-updater has staged a client under
 *   `%LOCALAPPDATA%\sf\client\<version>\bin`, the shim redirects there. The
 *   version is the one `client\bin\sf.cmd` forwards to (it changes on
 *   `sf update --version`), used only if it names a complete staged client;
 *   otherwise the newest complete staged version wins;
 * - npm: `<prefix>\sf.cmd` with `<prefix>\node_modules\@salesforce\cli\bin\run.js`,
 *   run by `<prefix>\node.exe` or the first `node.exe` on PATH.
 * The entry may be `run.js` or, on older installs, an extensionless `run`.
 * Each launch carries the `SF_BINPATH` / `SF_REDIRECTED` values its shims set.
 * Only absolute PATH entries are considered. A shim that matches neither layout
 * (for example a wrapper that forwards to another `sf.cmd`) is skipped and the
 * search continues down PATH. The Electron binary is never used as Node.
 */

export interface SfLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ResolverFs {
  isFile(file: string): boolean;
  readdir(dir: string): string[];
  readText(file: string): string;
}

export const NODE_FS: ResolverFs = {
  isFile: (file) => {
    try { return statSync(file).isFile(); } catch { return false; }
  },
  readdir: (dir) => {
    try { return readdirSync(dir); } catch { return []; }
  },
  readText: (file) => {
    try { return readFileSync(file, 'utf8'); } catch { return ''; }
  }
};

const { join, isAbsolute } = path.win32;
const STAGED_VERSION = /^(\d+)\.(\d+)\.(\d+)/;
// `"%~dp0..\2.153.5-577d18f\bin\sf.cmd" %*` in the updater's client\bin\sf.cmd.
const STAGED_TARGET = /%~dp0\.\.\\([^\\"%]+)\\bin\\sf\.cmd/i;
const ENTRIES = ['run.js', 'run'];

export function resolveWindowsSf(env: NodeJS.ProcessEnv, fs: ResolverFs = NODE_FS): SfLaunch | null {
  const dirs = pathDirs(env);
  for (const dir of dirs) {
    if (fs.isFile(join(dir, 'sf.exe'))) return { command: join(dir, 'sf.exe'), args: [], env: {} };
    if (!fs.isFile(join(dir, 'sf.cmd'))) continue;
    const launch = installerLaunch(dir, env, fs) ?? npmLaunch(dir, dirs, fs);
    if (launch) return launch;
  }
  return null;
}

function pathDirs(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATH ?? env.Path ?? '';
  return raw.split(';').map((entry) => entry.trim().replace(/^"(.*)"$/, '$1')).filter((entry) => entry && isAbsolute(entry));
}

function entryIn(dir: string, fs: ResolverFs): string | undefined {
  return ENTRIES.map((name) => join(dir, name)).find((file) => fs.isFile(file));
}

function clientLaunch(binDir: string, env: Record<string, string>, fs: ResolverFs): SfLaunch | null {
  const node = join(binDir, 'node.exe');
  const run = entryIn(binDir, fs);
  return fs.isFile(node) && run ? { command: node, args: ['--no-deprecation', run], env } : null;
}

function installerLaunch(dir: string, env: NodeJS.ProcessEnv, fs: ResolverFs): SfLaunch | null {
  const shimEnv = { SF_BINPATH: join(dir, 'sf.cmd') };
  const bundled = clientLaunch(dir, shimEnv, fs) ?? clientLaunch(join(dir, '..', 'client', 'bin'), shimEnv, fs);
  if (!bundled) return null;
  return stagedLaunch(env, fs) ?? bundled;
}

function stagedLaunch(env: NodeJS.ProcessEnv, fs: ResolverFs): SfLaunch | null {
  const local = env.LOCALAPPDATA;
  if (!local || !isAbsolute(local)) return null;
  const clientRoot = join(local, 'sf', 'client');
  const shim = join(clientRoot, 'bin', 'sf.cmd');
  if (!fs.isFile(shim)) return null;
  const stagedEnv = { SF_REDIRECTED: '1', SF_BINPATH: join(clientRoot, 'bin', 'sf') };
  const versions = fs.readdir(clientRoot)
    .map((name) => ({ name, version: STAGED_VERSION.exec(name)?.slice(1).map(Number) }))
    .filter((entry): entry is { name: string; version: number[] } => !!entry.version)
    .sort((a, b) => compareVersions(b.version, a.version));
  const target = STAGED_TARGET.exec(fs.readText(shim))?.[1]?.toLowerCase();
  const current = versions.find(({ name }) => name.toLowerCase() === target);
  for (const { name } of current ? [current, ...versions] : versions) {
    const launch = clientLaunch(join(clientRoot, name, 'bin'), stagedEnv, fs);
    if (launch) return launch;
  }
  return null;
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

function npmLaunch(dir: string, dirs: string[], fs: ResolverFs): SfLaunch | null {
  const run = entryIn(join(dir, 'node_modules', '@salesforce', 'cli', 'bin'), fs);
  if (!run) return null;
  const node = [dir, ...dirs].map((entry) => join(entry, 'node.exe')).find((file) => fs.isFile(file));
  return node ? { command: node, args: ['--no-deprecation', run], env: {} } : null;
}
