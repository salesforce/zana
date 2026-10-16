#!/usr/bin/env node
/**
 * Fail-closed local verification for pre-push. A verified inert-docs change is
 * the only no-test fast path. Feature branches run change-aware tests in an
 * isolated clone of the exact object being pushed. CI remains merge authority.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ZERO_OID = /^0+$/;
const GITHUB_REPOSITORY = 'salesforce/zana';
// Known work alias is retained for existing installs. Teams may add aliases
// without weakening host verification through ZANA_GITHUB_SSH_ALIASES.
const DEFAULT_GITHUB_SSH_ALIASES = ['github.com-work-public'];
// Repo agent instructions (AGENTS.md / CLAUDE.md @AGENTS.md stubs) are read only
// by coding agents, never by the product, so root/apps/packages/docs copies are
// inert. plugins/** stays out: plugin dirs are path-installed and shipped.
const INERT_DOC = /^(?:docs\/.+\.md|README\.md|CONTRIBUTING\.md|(?:(?:apps|packages|docs)\/(?:[^/]+\/)*)?(?:AGENTS|CLAUDE)\.md)$/;
const UNSAFE_DOC = /(?:^|\/)(?:SKILL\.md|fixtures?\/|snapshots?\/|test(?:ing)?\/|test-data\/|assets\/|generated\/|builtin-skills\/|__tests__\/)/i;
const DEPENDENCY_INPUT = /^(?:pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|(?:apps|packages|plugins)\/[^/]+\/package\.json)$/;
const TEST_RUNNER_CONFIG = /(?:^|\/)(?:vitest(?:\.[^/]+)?\.config\.[cm]?[jt]s|tsconfig(?:\.[^/]+)?\.json|vite\.config\.[cm]?[jt]s|electron\.vite\.config\.[cm]?[jt]s)$/;

function git(args, { cwd = process.cwd(), encoding = 'utf8' } = {}) {
  return execFileSync('git', args, { cwd, encoding, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitOk(args, options) {
  try { return git(args, options); } catch { return null; }
}

export function parseTuples(input) {
  const tuples = [];
  for (const line of input.split('\n')) {
    if (!line.trim()) continue;
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) return null;
    const [localRef, localOid, remoteRef, remoteOid] = fields;
    if (!localRef || !localOid || !remoteRef || !remoteOid) return null;
    tuples.push({ localRef, localOid, remoteRef, remoteOid });
  }
  return tuples;
}

function sshHostAlias(host, aliases) {
  return aliases[host] === 'github.com' ? 'github.com' : host;
}

/** Recognize only configured GitHub SSH aliases and normal GitHub URL forms. */
export function githubRepository(remoteUrl, aliases = {}) {
  let host;
  let path;
  const ssh = /^(?:ssh:\/\/)?(?:[^@/]+@)?([^/:]+)[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remoteUrl);
  const https = /^https:\/\/([^/]+)\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remoteUrl);
  if (https) [, host, path] = https;
  else if (ssh) [, host, path] = ssh;
  else return null;
  host = sshHostAlias(host, aliases);
  return host === 'github.com' && path === GITHUB_REPOSITORY ? path : null;
}

function protectedRef(ref) {
  return ref === 'refs/heads/main' || ref.startsWith('refs/tags/') || ref.startsWith('refs/heads/release/');
}

function featureRef(ref) {
  return /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) && !protectedRef(ref);
}

export function changedPaths(base, localOid, runGit) {
  const output = runGit(['diff', '--name-status', '--find-renames', base, localOid]);
  return output.split('\n').filter(Boolean).flatMap((line) => {
    const [status, ...paths] = line.split('\t');
    // Renames and copies carry both paths. A runtime source renamed into docs
    // remains runtime-affecting and must not take the inert prose fast path.
    return /^[RC]/.test(status) ? paths : paths.slice(-1);
  }).filter(Boolean);
}

function inertDocs(paths) {
  return paths.length > 0 && paths.every((path) => INERT_DOC.test(path) && !UNSAFE_DOC.test(path));
}

/**
 * Pure selection policy. `hasObject`, `mergeBase`, and `isAncestor` are injected
 * so tests can exercise force/new-branch behavior without a network or repo.
 */
export function selectPush({ tuples, remoteUrl, aliases = {}, hasObject, mergeBase, isAncestor, changed }) {
  if (!tuples?.length) return { action: 'abort', reason: 'missing or malformed pre-push ref tuples' };
  if (!githubRepository(remoteUrl, aliases)) return { action: 'full', reason: 'remote is not verified GitHub salesforce/zana' };
  const paths = new Set();
  const oids = new Set();
  const bases = new Set();
  for (const tuple of tuples) {
    if (ZERO_OID.test(tuple.localOid)) continue; // deletion contributes no tests
    if (protectedRef(tuple.remoteRef)) return { action: 'full', reason: `protected ref ${tuple.remoteRef}` };
    if (!featureRef(tuple.localRef) || !featureRef(tuple.remoteRef)) return { action: 'full', reason: `unknown ref ${tuple.localRef} -> ${tuple.remoteRef}` };
    if (ZERO_OID.test(tuple.remoteOid)) {
      if (!hasObject('origin/main')) return { action: 'full', reason: 'new branch has no local origin/main base' };
      const base = mergeBase('origin/main', tuple.localOid);
      if (!base) return { action: 'full', reason: 'new branch has no sound merge base' };
      bases.add(base);
      for (const path of changed(base, tuple.localOid)) paths.add(path);
    } else {
      if (!hasObject(tuple.remoteOid)) return { action: 'full', reason: `remote base ${tuple.remoteOid} is unavailable locally` };
      if (!isAncestor(tuple.remoteOid, tuple.localOid)) return { action: 'full', reason: `non-ancestor update for ${tuple.remoteRef}` };
      bases.add(tuple.remoteOid);
      for (const path of changed(tuple.remoteOid, tuple.localOid)) paths.add(path);
    }
    oids.add(tuple.localOid);
  }
  if (!oids.size) return { action: 'skip', reason: 'ref deletion only', paths: [] };
  if (oids.size !== 1) return { action: 'full', reason: 'multiple distinct pushed commits require separate snapshots', oids: [...oids] };
  if (bases.size !== 1) return { action: 'full', reason: 'multiple remote bases require full verification', oids: [...oids] };
  const resultPaths = [...paths].sort();
  const oid = [...oids][0];
  const base = [...bases][0];
  if (inertDocs(resultPaths)) return { action: 'skip', reason: 'verified inert prose only', paths: resultPaths, oid, base };
  if (!resultPaths.length) return { action: 'full', reason: 'empty diff cannot establish safe selection', paths: resultPaths, oid, base, feature: true };
  return { action: 'fast', reason: 'feature branch change-aware verification', paths: resultPaths, oid, base, feature: true };
}

export function configuredAliases(run, configured = process.env.ZANA_GITHUB_SSH_ALIASES) {
  const aliases = {};
  const hosts = configured ? configured.split(',').map((host) => host.trim()).filter(Boolean) : DEFAULT_GITHUB_SSH_ALIASES;
  for (const host of hosts) {
    const result = run('ssh', ['-G', host], { encoding: 'utf8' });
    if (result?.status !== 0) continue;
    const hostname = /^hostname\s+(.+)$/m.exec(result.stdout)?.[1];
    if (hostname) aliases[host] = hostname;
  }
  return aliases;
}

export function withSnapshot({ oid, root = process.cwd(), run = spawnSync, log = console.log }, verify) {
  if (!oid) throw new Error('no pushed object available for snapshot verification');
  const snapshot = mkdtempSync(join(tmpdir(), 'zana-pre-push-'));
  // Git hooks inherit repository routing variables. Strip them before spawning
  // snapshot Git so its cwd controls repository selection, not caller worktree.
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete env[key];
  try {
    log(`pre-push: snapshot ${oid.slice(0, 12)} in ${snapshot}`);
    const clone = run('git', ['clone', '--no-local', '--no-checkout', root, snapshot], { stdio: 'inherit', env });
    if (clone.status !== 0) throw new Error('could not create isolated push snapshot');
    // A clone made from a linked worktree inherits `core.worktree`, which points
    // at its source checkout. Remove it before checkout so Git writes only into
    // this disposable snapshot.
    const unsetWorktree = run('git', ['config', '--unset-all', 'core.worktree'], { cwd: snapshot, stdio: 'ignore', env });
    if (unsetWorktree.status !== 0 && unsetWorktree.status !== 5) throw new Error('could not isolate snapshot worktree');
    const fetch = run('git', ['fetch', '--no-tags', root, oid], { cwd: snapshot, stdio: 'inherit', env });
    if (fetch.status !== 0) throw new Error(`could not fetch pushed object ${oid}`);
    const checkout = run('git', ['checkout', '--detach', oid], { cwd: snapshot, stdio: 'inherit', env });
    if (checkout.status !== 0) throw new Error(`could not check out pushed object ${oid}`);
    return verify(snapshot);
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

function packageDependencyFields(packageJson) {
  const manifest = JSON.parse(packageJson);
  return JSON.stringify({
    packageManager: manifest.packageManager,
    dependencies: manifest.dependencies,
    devDependencies: manifest.devDependencies,
    optionalDependencies: manifest.optionalDependencies,
    peerDependencies: manifest.peerDependencies
  });
}

function dependencyInputsChanged(base, paths, root) {
  if (paths.includes('package.json')) {
    const baseManifest = gitOk(['show', `${base}:package.json`], { cwd: root });
    try {
      if (!baseManifest || packageDependencyFields(baseManifest) !== packageDependencyFields(readFileSync(join(root, 'package.json'), 'utf8'))) return true;
    } catch {
      return true;
    }
  }
  return paths.some((path) => DEPENDENCY_INPUT.test(path));
}

function linkInstalledDependencies(snapshot, root) {
  const installed = join(root, 'node_modules');
  if (!existsSync(installed) || !existsSync(snapshot)) return false;
  symlinkSync(installed, join(snapshot, 'node_modules'), 'dir');
  return true;
}

function needsBroadChangedTests(paths) {
  return paths.some((path) => TEST_RUNNER_CONFIG.test(path));
}

function testInputs(paths) {
  return paths.filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !path.endsWith('.d.ts') && !path.startsWith('e2e/'));
}

export function runFullVerification({ oid, root = process.cwd(), run = spawnSync, log = console.log }) {
  return withSnapshot({ oid, root, run, log }, (snapshot) => {
    log('pre-push: full (est. install)');
    const install = run('pnpm', ['install', '--frozen-lockfile'], { cwd: snapshot, stdio: 'inherit' });
    if (install.status !== 0) throw new Error('snapshot dependency install failed');
    log('pre-push: full (est. Slack runtime assets)');
    const assets = run('pnpm', ['--filter', 'zcc-plugin-slack-bridge-2ff2', 'package'], { cwd: snapshot, stdio: 'inherit' });
    if (assets.status !== 0) throw new Error('snapshot Slack runtime asset preparation failed');
    log('pre-push: full (est. verify:full)');
    const result = run('pnpm', ['verify:full'], { cwd: snapshot, stdio: 'inherit' });
    if (result.status !== 0) throw new Error('verification failed: pnpm verify:full');
  });
}

function guardTests(snapshot, run) {
  const result = run('fd', ['-e', 'ts', 'guard\\.test'], { cwd: snapshot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error('could not list source-text guard tests');
  return result.stdout.trim().split('\n').filter(Boolean).sort();
}

export function runFastVerification({ oid, base, paths = [], root = process.cwd(), run = spawnSync, log = console.log }) {
  if (!base) throw new Error('no base object available for fast verification');
  return withSnapshot({ oid, root, run, log }, (snapshot) => {
    const reuseInstalledDependencies = !dependencyInputsChanged(base, paths, snapshot) && linkInstalledDependencies(snapshot, root);
    if (reuseInstalledDependencies) {
      log('pre-push: fast (reusing installed dependencies)');
    } else {
      log('pre-push: fast (est. install)');
      const install = run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: snapshot, stdio: 'inherit' });
      if (install.status !== 0) throw new Error('snapshot dependency install failed');
    }
    if (paths.some((path) => path.startsWith('plugins/slack-bridge-2ff2/'))) {
      log('pre-push: fast (est. Slack runtime assets)');
      const assets = run('pnpm', ['--filter', 'zcc-plugin-slack-bridge-2ff2', 'package'], { cwd: snapshot, stdio: 'inherit' });
      if (assets.status !== 0) throw new Error('snapshot Slack runtime asset preparation failed');
    }
    log('pre-push: fast (est. typecheck)');
    const typecheck = run('pnpm', ['run', 'typecheck'], { cwd: snapshot, stdio: 'inherit' });
    if (typecheck.status !== 0) throw new Error('verification failed: pnpm run typecheck');
    const inputs = testInputs(paths);
    if (needsBroadChangedTests(paths)) {
      log(`pre-push: fast (est. vitest --changed ${base.slice(0, 12)})`);
      const changed = run('pnpm', ['exec', 'vitest', 'run', '--changed', base], { cwd: snapshot, stdio: 'inherit' });
      if (changed.status !== 0) throw new Error('verification failed: vitest --changed');
    } else if (inputs.length) {
      log(`pre-push: fast (est. vitest related ${inputs.length} input${inputs.length === 1 ? '' : 's'})`);
      const related = run('pnpm', ['exec', 'vitest', 'related', ...inputs, '--run', '--passWithNoTests'], { cwd: snapshot, stdio: 'inherit' });
      if (related.status !== 0) throw new Error('verification failed: vitest related');
    }
    const guards = guardTests(snapshot, run);
    if (guards.length) {
      log(`pre-push: fast (est. ${guards.length} source-text guard tests)`);
      const guardRun = run('pnpm', ['exec', 'vitest', 'run', ...guards], { cwd: snapshot, stdio: 'inherit' });
      if (guardRun.status !== 0) throw new Error('verification failed: source-text guard tests');
    }
  });
}

export function runPrePush({ input = readFileSync(0, 'utf8'), remoteUrl, root = process.cwd(), log = console.log, error = console.error, select = selectPush, verify = runFullVerification, fastVerify = runFastVerification, run = spawnSync } = {}) {
  if (!remoteUrl) {
    error('pre-push: Git did not provide remote URL; aborting push.');
    return 1;
  }
  const tuples = parseTuples(input);
  const runGit = (args) => gitOk(args, { cwd: root });
  let selection = select({
    tuples,
    remoteUrl,
    aliases: configuredAliases(run),
    hasObject: (object) => runGit(['cat-file', '-e', `${object}^{commit}`]) !== null,
    mergeBase: (left, right) => runGit(['merge-base', left, right]),
    isAncestor: (left, right) => runGit(['merge-base', '--is-ancestor', left, right]) !== null,
    changed: (base, oid) => changedPaths(base, oid, runGit),
  });
  log(`pre-push: ${selection.action}; ${selection.reason}`);
  if (selection.paths?.length) log(`pre-push: selected paths:\n${selection.paths.map((path) => `  ${path}`).join('\n')}`);
  if (selection.action === 'abort') return 1;
  if (selection.action === 'skip') return 0;
  try {
    if (selection.action === 'fast') {
      fastVerify({ oid: selection.oid, base: selection.base, paths: selection.paths, root, log, run });
      return 0;
    }
    const oids = selection.oids ?? (selection.oid ? [selection.oid] : [...new Set((tuples ?? [])
      .filter((tuple) => !ZERO_OID.test(tuple.localOid)).map((tuple) => tuple.localOid))]);
    if (!oids.length) throw new Error('no pushed object available for full verification');
    for (const oid of oids) verify({ oid, root, log });
    return 0;
  } catch (cause) {
    error(`pre-push: ${cause.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runPrePush({ remoteUrl: process.argv[3] });
}
