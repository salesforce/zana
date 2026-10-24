#!/usr/bin/env node
/**
 * Fail-closed local verification for pre-push. A verified inert-docs change is
 * the only no-test fast path. Feature branches run change-aware tests in an
 * isolated clone of the exact object being pushed. CI remains merge authority.
 * A free cached clone is reused when it proves clean at that object; otherwise
 * the push gets a fresh disposable clone.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { basename, join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as tinynod from './tinynod-pre-push-review.mjs';

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
const TEST_RUNNER_CONFIG = /(?:^|\/)(?:vitest(?:\.[^/]+)?\.config\.[cm]?[jt]s|tsconfig(?:\.[^/]+)?\.json|vite\.config\.[cm]?[jt]s|electron\.vite\.config\.[cm]?[jt]s)$/;

function git(args, { cwd = process.cwd(), encoding = 'utf8', env = process.env } = {}) {
  return execFileSync('git', args, { cwd, encoding, env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Git hooks inherit repository routing variables. Strip them before spawning
// Git elsewhere so its cwd controls repository selection, not caller worktree.
function withoutGitRouting(env) {
  const stripped = { ...env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete stripped[key];
  return stripped;
}

// Command-line configuration outranks every config file, so no hook in a
// snapshot's .git/hooks, or named by its core.hooksPath, ever runs.
function withHooksDisabled(env, hooksPath) {
  const count = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10) || 0;
  return { ...env, GIT_CONFIG_COUNT: String(count + 1), [`GIT_CONFIG_KEY_${count}`]: 'core.hooksPath', [`GIT_CONFIG_VALUE_${count}`]: hooksPath };
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

// Opt-in phase timing (ZANA_PREPUSH_TIMING=1), so latency changes are measured
// rather than asserted. Off, it adds no output.
export function createPhaseTimer({ env = process.env, log = console.log, now = () => performance.now() } = {}) {
  if (env.ZANA_PREPUSH_TIMING !== '1') return (_phase, fn) => fn();
  return (phase, fn) => {
    const start = now();
    try {
      return fn();
    } finally {
      log(`pre-push: timing ${phase} ${Math.round(now() - start)}ms`);
    }
  };
}

const SNAPSHOT_SLOTS = 2;
// A lock whose owner record cannot be read, or a leftover from an interrupted
// lock or discard, is reclaimed after this long.
const ABANDONED_MS = 60_000;
// Another host's pids cannot be probed, so its locks expire only by age.
const FOREIGN_LOCK_MS = 24 * 60 * 60_000;
const SLOT_NAME = /^[^.]+-\d+$/;
const LEFTOVER = /\.(?:tmp|stale|discard)$/;
// Kept in the slot's Git directory, outside the worktree, so cleaning never removes it.
const DEPENDENCY_RECORD = 'zana-pre-push-dependencies';
const DEPENDENCY_INPUTS = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', ':(glob)**/package.json'];
const KEPT_DEPENDENCIES = /(?:^|\/)node_modules\/$/;
const LARGE_OUTPUT = 64 * 1024 * 1024;

// Failures that a fresh clone would hit too. They fail the push instead of
// discarding the cached snapshot.
class SnapshotVerificationError extends Error {}

function userCacheDirectory(env, platform) {
  if (platform === 'darwin') return join(homedir(), 'Library', 'Caches');
  if (platform === 'win32') return env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  return env.XDG_CACHE_HOME || join(homedir(), '.cache');
}

// Cached snapshots live outside the repository, keyed by its common Git
// directory, so every worktree of one clone shares them.
export function snapshotCacheRoot(root, { env = process.env, platform = process.platform } = {}) {
  if (env.ZANA_PREPUSH_FRESH_SNAPSHOT === '1') return null;
  const common = gitOk(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, env: withoutGitRouting(env) });
  if (!common) return null;
  const repository = createHash('sha256').update(realpathSync(common)).digest('hex').slice(0, 16);
  return join(env.ZANA_PREPUSH_CACHE_DIR || join(userCacheDirectory(env, platform), 'zana-pre-push'), repository);
}

// A cached node_modules holds native builds, so only the Node ABI, platform,
// and architecture that built it may reuse it.
export function snapshotKey({ abi = process.versions.modules, platform = process.platform, arch = process.arch } = {}) {
  return `${platform}-${arch}-node${abi}`;
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readLock(lock) {
  try { return JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')); } catch { return null; }
}

function ageOf(path, now) {
  try { return now() - statSync(path).mtimeMs; } catch { return 0; }
}

function lockAbandoned(lock, owner, { host, alive, now }) {
  if (!owner) return ageOf(lock, now) > ABANDONED_MS;
  if (owner.host !== host) return ageOf(lock, now) > FOREIGN_LOCK_MS;
  return !alive(owner.pid);
}

// A lock is published whole: its owner record is written into a private
// directory that is then renamed into place. Renaming onto an existing
// non-empty directory fails, so one push wins a free lock and every lock
// carries a token. An abandoned lock is renamed aside and put back if it
// turns out to be one a concurrent push just published.
function tryLock(lock, { pid, host, alive, now }) {
  const token = randomUUID();
  const draft = `${lock}.${token}.tmp`;
  mkdirSync(draft);
  try {
    writeFileSync(join(draft, 'owner.json'), JSON.stringify({ pid, host, token }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        renameSync(draft, lock);
        return token;
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      }
      const owner = readLock(lock);
      if (attempt > 0 || !lockAbandoned(lock, owner, { host, alive, now })) return null;
      const stale = `${lock}.${randomUUID()}.stale`;
      try { renameSync(lock, stale); } catch { return null; }
      if (readLock(stale)?.token !== owner?.token) {
        try { renameSync(stale, lock); } catch { /* a third push holds the lock; leave it */ }
        return null;
      }
      rmSync(stale, { recursive: true, force: true });
    }
    return null;
  } finally {
    rmSync(draft, { recursive: true, force: true });
  }
}

function releaseLock(lock, token) {
  if (readLock(lock)?.token === token) rmSync(lock, { recursive: true, force: true });
}

// Rename first so a slot disappears at once, then delete best-effort; a
// leftover is swept later rather than failing this push.
function discard(path) {
  const doomed = `${path}.${randomUUID()}.discard`;
  try {
    renameSync(path, doomed);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    // Deleting in place can stop part way; drop the dependency record first so
    // whatever survives is never trusted.
    try {
      rmSync(join(path, '.git', DEPENDENCY_RECORD), { force: true });
      rmSync(path, { recursive: true, force: true });
    } catch { /* swept later */ }
    return;
  }
  try { rmSync(doomed, { recursive: true, force: true }); } catch { /* swept later */ }
}

// Bound disk use: after a Node upgrade, slots built for the old ABI are dead
// weight, and interrupted locks or discards leave debris. Each slot is
// removed only under its own lock.
function pruneCache(cacheRoot, key, lockOptions) {
  for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
    const path = join(cacheRoot, entry.name);
    if (LEFTOVER.test(entry.name)) {
      if (ageOf(path, lockOptions.now) > ABANDONED_MS) rmSync(path, { recursive: true, force: true });
      continue;
    }
    if (!entry.isDirectory() || !SLOT_NAME.test(entry.name) || entry.name.startsWith(`${key}-`)) continue;
    const lock = `${path}.lock`;
    const token = tryLock(lock, lockOptions);
    if (!token) continue;
    try {
      discard(path);
    } finally {
      releaseLock(lock, token);
    }
  }
}

export function acquireSnapshotSlot(cacheRoot, { key = snapshotKey(), slots = SNAPSHOT_SLOTS, pid = process.pid, host = hostname(), alive = processAlive, now = Date.now } = {}) {
  const lockOptions = { pid, host, alive, now };
  mkdirSync(cacheRoot, { recursive: true });
  for (let index = 0; index < slots; index += 1) {
    const path = join(cacheRoot, `${key}-${index}`);
    const lock = `${path}.lock`;
    const token = tryLock(lock, lockOptions);
    if (!token) continue;
    try {
      pruneCache(cacheRoot, key, lockOptions);
    } catch {
      // Pruning is housekeeping; a failure must not cost this push its slot.
    }
    return {
      path,
      owns: () => readLock(lock)?.token === token,
      release: () => {
        // A lock left behind names this process and is reclaimed once it exits.
        try { releaseLock(lock, token); } catch { /* reclaimed later */ }
      },
    };
  }
  return null;
}

function snapshotGit(snapshot, run, env) {
  return (args) => run('git', args, { cwd: snapshot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env, maxBuffer: LARGE_OUTPUT });
}

// A reused snapshot keeps only node_modules. Prove the rest of the tree is
// exactly `oid`: HEAD matches, no index entry hides a change, nothing tracked
// is modified, and nothing untracked or ignored survives except dependency
// directories. Returns the dependency directories that remain.
function cleanReusedSnapshot(snapshot, oid, run, env) {
  const git = snapshotGit(snapshot, run, env);
  if (git(['clean', '-ffdx', '-e', 'node_modules']).status !== 0) throw new Error('could not clean reused snapshot');
  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0 || head.stdout.trim() !== oid) throw new Error(`reused snapshot is not at ${oid}`);
  // assume-unchanged (lowercase tag) and skip-worktree (S) entries hide edits from status.
  const index = git(['ls-files', '-v', '-z']);
  if (index.status !== 0) throw new Error('could not read reused snapshot index');
  const hidden = index.stdout.split('\0').find((entry) => /^(?:[a-z]|S) /.test(entry));
  if (hidden) throw new Error(`reused snapshot index hides changes: ${hidden}`);
  const status = git(['status', '--porcelain=v1', '-z', '--ignored=matching', '--untracked-files=all']);
  if (status.status !== 0) throw new Error('could not read reused snapshot status');
  const kept = [];
  for (const entry of status.stdout.split('\0').filter(Boolean)) {
    const path = entry.slice(3);
    if (!entry.startsWith('!! ') || !KEPT_DEPENDENCIES.test(path)) throw new Error(`reused snapshot is not clean: ${entry}`);
    // A package removed since the last push leaves only its node_modules behind.
    const owner = posix.dirname(path.slice(0, -1));
    if (existsSync(join(snapshot, owner, 'package.json'))) kept.push(path);
    else rmSync(join(snapshot, path), { recursive: true, force: true });
  }
  return kept;
}

// pnpm decides "up to date" from its own metadata, not from build settings or
// workspace manifests, so kept dependencies are trusted only while every
// dependency input matches the install that produced them.
function dependencyFingerprint(snapshot, run, env) {
  const inputs = snapshotGit(snapshot, run, env)(['ls-files', '-s', '-z', '--', ...DEPENDENCY_INPUTS]);
  if (inputs.status !== 0) throw new Error('could not read reused snapshot dependency inputs');
  return createHash('sha256').update(snapshotKey()).update('\0').update(inputs.stdout).digest('hex');
}

function removeDependencies(snapshot, kept) {
  for (const path of kept) rmSync(join(snapshot, path), { recursive: true, force: true });
}

// Settings a clone writes for itself. Anything else in a reused snapshot's
// config came from a verification run, and could redirect its worktree or
// rewrite what checkout writes (filters, includes, fsmonitor).
const CLONE_CONFIG = /^(?:core\.(?:repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks)|extensions\.objectformat|remote\.origin\.(?:url|fetch)|branch\..+\.(?:remote|merge))$/i;

// A previous verification ran the pushed code inside this snapshot, so before
// any destructive Git command prove its repository is still its own: a real
// .git directory, only clone-written config, no info overrides, and no
// replacement objects.
function isolateReusedSnapshot(snapshot, run, env) {
  if (!lstatSync(join(snapshot, '.git')).isDirectory()) throw new Error('reused snapshot .git is not a directory');
  const git = snapshotGit(snapshot, run, env);
  const config = git(['config', '--local', '--no-includes', '--name-only', '--list', '-z']);
  if (config.status !== 0) throw new Error('could not read reused snapshot config');
  for (const key of new Set(config.stdout.split('\0').filter((name) => name && !CLONE_CONFIG.test(name)))) {
    const unset = git(['config', '--local', '--unset-all', key]);
    if (unset.status !== 0 && unset.status !== 5) throw new Error(`could not reset reused snapshot ${key}`);
  }
  // info/attributes and info/exclude change what checkout writes and what clean keeps.
  rmSync(join(snapshot, '.git', 'info'), { recursive: true, force: true });
  const layout = git(['rev-parse', '--show-toplevel', '--absolute-git-dir']);
  const [top, gitDir] = layout.status === 0 ? layout.stdout.trim().split('\n') : [];
  const own = realpathSync(snapshot);
  if (!top || realpathSync(top) !== own || realpathSync(gitDir) !== join(own, '.git')) throw new Error('reused snapshot repository points outside its slot');
  const replaced = git(['for-each-ref', '--format=%(refname)', 'refs/replace/']);
  if (replaced.status !== 0 || replaced.stdout.trim()) throw new Error('reused snapshot has replacement refs');
}

function prepareSnapshot({ snapshot, oid, root, run, log, env, time, mode, reused }) {
  if (!existsSync(join(snapshot, '.git'))) {
    const clone = time('clone', () => run('git', ['clone', '--no-local', '--no-checkout', root, snapshot], { stdio: 'inherit', env }));
    if (clone.status !== 0) throw new Error('could not create isolated push snapshot');
    // A clone made from a linked worktree inherits `core.worktree`, which points
    // at its source checkout. Remove it before checkout so Git writes only into
    // this snapshot.
    const unsetWorktree = run('git', ['config', '--unset-all', 'core.worktree'], { cwd: snapshot, stdio: 'ignore', env });
    if (unsetWorktree.status !== 0 && unsetWorktree.status !== 5) throw new Error('could not isolate snapshot worktree');
  } else if (reused) {
    isolateReusedSnapshot(snapshot, run, env);
    // Checkout and status trust cached file stats, which an edit that keeps a
    // file's size and mtime defeats. Without an index, checkout rewrites every
    // tracked file from the pushed object.
    rmSync(join(snapshot, '.git', 'index'), { force: true });
  }
  // A reused snapshot also refreshes branches and tags, so it sees the same
  // refs a fresh clone of root would.
  const refresh = reused ? ['--force', '--prune', root, oid, '+refs/heads/*:refs/remotes/origin/*', '+refs/tags/*:refs/tags/*'] : [root, oid];
  const fetch = time('fetch', () => run('git', ['fetch', '--no-tags', ...refresh], { cwd: snapshot, stdio: 'inherit', env }));
  if (fetch.status !== 0) throw new Error(`could not fetch pushed object ${oid}`);
  const checkout = time('checkout', () => run('git', ['checkout', '--detach', ...(reused ? ['--force'] : []), oid], { cwd: snapshot, stdio: 'inherit', env }));
  if (checkout.status !== 0) throw new Error(`could not check out pushed object ${oid}`);
  const install = () => time('install', () => run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: snapshot, stdio: 'inherit', env }));
  log(`pre-push: ${mode} (est. install)`);
  if (!reused) {
    if (install().status !== 0) throw new SnapshotVerificationError('snapshot dependency install failed');
    return;
  }
  const kept = time('clean', () => cleanReusedSnapshot(snapshot, oid, run, env));
  const fingerprint = dependencyFingerprint(snapshot, run, env);
  const record = join(snapshot, '.git', DEPENDENCY_RECORD);
  let recorded = null;
  try { recorded = readFileSync(record, 'utf8'); } catch { /* never installed, or interrupted */ }
  if (recorded !== fingerprint) {
    if (kept.length) log('pre-push: dependency inputs changed since the last install; reinstalling from scratch');
    removeDependencies(snapshot, kept);
  }
  // No record while installing: an interrupted install is never trusted.
  rmSync(record, { force: true });
  if (install().status !== 0) {
    // pnpm stops rather than purge modules it cannot reconcile without a TTY.
    // Retry once from scratch; a second failure is the pushed commit's own.
    log('pre-push: install failed in reused snapshot; retrying from scratch');
    if (snapshotGit(snapshot, run, env)(['clean', '-ffdx']).status !== 0) throw new Error('could not clean reused snapshot');
    if (install().status !== 0) throw new SnapshotVerificationError('snapshot dependency install failed');
  }
  writeFileSync(record, fingerprint);
}

function claimSlot(cacheRoot, acquire, log) {
  if (!cacheRoot) return null;
  try {
    const slot = acquire(cacheRoot);
    if (!slot) log('pre-push: no free cached snapshot; using a fresh clone');
    return slot;
  } catch (cause) {
    log(`pre-push: snapshot cache unavailable (${cause.message}); using a fresh clone`);
    return null;
  }
}

// Returns `{ result }` when the cached snapshot produced a trustworthy result,
// or null when the caller must verify in a fresh clone instead.
function verifyInSlot(slot, { oid, prepare, log }, verify) {
  try {
    log(`pre-push: snapshot ${oid.slice(0, 12)} in ${slot.path} (reused)`);
    try {
      prepare(slot.path, true);
    } catch (cause) {
      if (cause instanceof SnapshotVerificationError) throw cause;
      log(`pre-push: reused snapshot unusable (${cause.message}); using a fresh clone`);
      discard(slot.path);
      return null;
    }
    // A lock reclaimed by a racing push means another push may have changed
    // this tree; never report a result from it.
    if (!slot.owns()) {
      log(`pre-push: lost the lock on ${slot.path}; using a fresh clone`);
      return null;
    }
    const result = verify(slot.path);
    if (slot.owns()) return { result };
    log(`pre-push: lost the lock on ${slot.path} during verification; verifying again in a fresh clone`);
    return null;
  } finally {
    slot.release();
  }
}

function verifyFresh({ oid, prepare, log }, verify) {
  const snapshot = mkdtempSync(join(tmpdir(), 'zana-pre-push-'));
  try {
    log(`pre-push: snapshot ${oid.slice(0, 12)} in ${snapshot}`);
    prepare(snapshot, false);
    return verify(snapshot);
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

export function withSnapshot({
  oid,
  mode = 'full',
  root = process.cwd(),
  run = spawnCommand,
  log = console.log,
  env: sourceEnv = process.env,
  time = createPhaseTimer({ env: sourceEnv, log }),
  cacheRoot = snapshotCacheRoot(root, { env: sourceEnv }),
  acquire = acquireSnapshotSlot,
}, verify) {
  if (!oid) throw new Error('no pushed object available for snapshot verification');
  const noHooks = mkdtempSync(join(tmpdir(), 'zana-pre-push-hooks-'));
  try {
    const env = withHooksDisabled(withoutGitRouting(sourceEnv), noHooks);
    const context = { oid, log, prepare: (snapshot, reused) => prepareSnapshot({ snapshot, oid, root, run, log, env, time, mode, reused }) };
    const slot = claimSlot(cacheRoot, acquire, log);
    const cached = slot ? verifyInSlot(slot, context, verify) : null;
    return cached ? cached.result : verifyFresh(context, verify);
  } finally {
    rmSync(noHooks, { recursive: true, force: true });
  }
}

function needsBroadChangedTests(paths) {
  return paths.some((path) => TEST_RUNNER_CONFIG.test(path));
}

function testInputs(paths) {
  return paths.filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !path.endsWith('.d.ts') && !path.startsWith('e2e/'));
}

function isTestFile(path) {
  return /(?:^|\.)test\.[cm]?[jt]sx?$|(?:^|\.)spec\.[cm]?[jt]sx?$/.test(path);
}

// Vitest's import graph can span most of the monorepo through shared helpers.
// Pre-push stays bounded by running changed tests and direct colocated tests;
// CI remains responsible for transitive and full-suite coverage.
export function selectedTestFiles(inputs, root) {
  const tests = new Set(inputs.filter(isTestFile));
  for (const input of inputs.filter((path) => !isTestFile(path))) {
    const name = basename(input).replace(/\.[cm]?[jt]sx?$/, '');
    // Git paths use '/'; keep them that way on Windows so vitest gets repo-style paths.
    for (const directory of [posix.dirname(input), posix.join(posix.dirname(input), '__tests__')]) {
      const absoluteDirectory = join(root, directory);
      if (!existsSync(absoluteDirectory)) continue;
      for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !isTestFile(entry.name)) continue;
        const testName = entry.name.replace(/(?:\.coverage)?\.(?:test|spec)\.[cm]?[jt]sx?$/, '');
        if (testName === name) {
          tests.add(posix.join(directory, entry.name));
        }
      }
    }
  }
  return [...tests].sort();
}

// pnpm is usually a .cmd shim on Windows. spawnSync can start one only through
// cmd.exe, which would reparse arguments (test paths with spaces, &, |). Resolve
// the script the shim runs and start it with this node, so arguments pass verbatim.
export function windowsPnpm(path = process.env.PATH ?? '') {
  for (const directory of path.split(';').map((entry) => entry.replaceAll('"', '')).filter(Boolean)) {
    const exe = join(directory, 'pnpm.exe');
    if (existsSync(exe)) return [exe];
    const shim = join(directory, 'pnpm.cmd');
    if (!existsSync(shim)) continue;
    const script = readFileSync(shim, 'utf8').match(/"%~?dp0%?\\([^"%]+\.[cm]?js)"/i)?.[1];
    if (script) return [process.execPath, join(directory, ...script.split('\\'))];
  }
  return ['pnpm'];
}

export function spawnCommand(command, args, options, platform = process.platform) {
  if (command !== 'pnpm' || platform !== 'win32') return spawnSync(command, args, options);
  const [resolved, ...prefix] = windowsPnpm();
  return spawnSync(resolved, [...prefix, ...args], options);
}

const SLACK_BRIDGE = 'plugins/slack-bridge-2ff2/';

// The Slack bridge tests read git-ignored runtime assets (mermaid.min.js) that
// a fresh snapshot does not have, so build them before any run that includes them.
function prepareSlackAssets(snapshot, run, log, mode) {
  log(`pre-push: ${mode} (est. Slack runtime assets)`);
  const assets = run('pnpm', ['--filter', 'zcc-plugin-slack-bridge-2ff2', 'package'], { cwd: snapshot, stdio: 'inherit' });
  if (assets.status !== 0) throw new Error('snapshot Slack runtime asset preparation failed');
}

export function runFullVerification({ oid, root = process.cwd(), run = spawnCommand, log = console.log, env = process.env, cacheRoot, review }) {
  const time = createPhaseTimer({ env, log });
  return withSnapshot({ oid, mode: 'full', root, run, log, env, time, cacheRoot }, (snapshot) => {
    review?.start(snapshot, oid);
    time('slack-assets', () => prepareSlackAssets(snapshot, run, log, 'full'));
    log('pre-push: full (est. verify:full)');
    const result = time('verify:full', () => run('pnpm', ['verify:full'], { cwd: snapshot, stdio: 'inherit' }));
    if (result.status !== 0) throw new Error('verification failed: pnpm verify:full');
  });
}

function guardTests(snapshot, run) {
  const result = run('fd', ['-e', 'ts', 'guard\\.test'], { cwd: snapshot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error('could not list source-text guard tests');
  return result.stdout.trim().split('\n').filter(Boolean).sort();
}

export function runFastVerification({ oid, base, paths = [], root = process.cwd(), run = spawnCommand, log = console.log, env = process.env, cacheRoot, review }) {
  if (!base) throw new Error('no base object available for fast verification');
  const time = createPhaseTimer({ env, log });
  return withSnapshot({ oid, mode: 'fast', root, run, log, env, time, cacheRoot }, (snapshot) => {
    review?.start(snapshot, oid);
    log('pre-push: fast (est. typecheck)');
    const typecheck = time('typecheck', () => run('pnpm', ['run', 'typecheck'], { cwd: snapshot, stdio: 'inherit' }));
    if (typecheck.status !== 0) throw new Error('verification failed: pnpm run typecheck');
    const inputs = testInputs(paths);
    if (needsBroadChangedTests(paths)) {
      time('slack-assets', () => prepareSlackAssets(snapshot, run, log, 'fast'));
      log(`pre-push: fast (est. vitest --changed ${base.slice(0, 12)})`);
      const changed = time('tests', () => run('pnpm', ['exec', 'vitest', 'run', '--changed', base], { cwd: snapshot, stdio: 'inherit' }));
      if (changed.status !== 0) throw new Error('verification failed: vitest --changed');
    } else {
      const tests = selectedTestFiles(inputs, snapshot);
      if (tests.some((test) => test.startsWith(SLACK_BRIDGE))) time('slack-assets', () => prepareSlackAssets(snapshot, run, log, 'fast'));
      if (tests.length) {
        log(`pre-push: fast (est. ${tests.length} changed or colocated test${tests.length === 1 ? '' : 's'})`);
        const testRun = time('tests', () => run('pnpm', ['exec', 'vitest', 'run', ...tests], { cwd: snapshot, stdio: 'inherit' }));
        if (testRun.status !== 0) throw new Error('verification failed: selected vitest tests');
      }
    }
    const guards = guardTests(snapshot, run);
    if (guards.length) {
      log(`pre-push: fast (est. ${guards.length} source-text guard tests)`);
      const guardRun = time('guards', () => run('pnpm', ['exec', 'vitest', 'run', ...guards], { cwd: snapshot, stdio: 'inherit' }));
      if (guardRun.status !== 0) throw new Error('verification failed: source-text guard tests');
    }
  });
}

const REVIEW_FINDINGS_SHOWN = 10;
const DOCS_ONLY_REASON = 'verified inert prose only';

function describeFinding(finding) {
  if (!finding || typeof finding !== 'object') return `  [unknown] ${String(finding)}`;
  const place = [finding.filePath ?? finding.file ?? finding.path, finding.lineNumber ?? finding.line].filter((part) => part !== undefined && part !== null).join(':');
  const text = finding.comment ?? finding.title ?? finding.message ?? '';
  return `  [${finding.severity ?? 'unknown'}] ${place ? `${place} ` : ''}${String(text).split('\n')[0]}`.trimEnd();
}

/**
 * Advisory tinynod review of the pushed commit. Returns a session the
 * verifiers start inside the snapshot, or null when the review is off, not
 * applicable, or cannot run. Nothing here can fail or block a push: every
 * problem is logged and the mandatory verification proceeds unchanged.
 */
export function prepareTinynodReview({ tuples, selection, root, env = process.env, aliases = {}, checks, log = console.log, error = console.error, adapter = {} }) {
  const a = { ...tinynod, ...adapter };
  try {
    const enablement = a.resolveEnablement({ env, readConfig: () => a.readGitEnablement(root, { env }) });
    if (enablement.warning) error(`pre-push: tinynod review: ${enablement.warning}`);
    if (!enablement.enabled) return null;
    if (selection.action === 'abort') return null;
    if (selection.action === 'skip') {
      log(`pre-push: tinynod review skipped: ${selection.reason === DOCS_ONLY_REASON ? 'docs-only push (no snapshot)' : selection.reason}`);
      return null;
    }
    const target = a.deriveReviewTarget(tuples, checks);
    if (target.skip) {
      log(`pre-push: tinynod review skipped: ${target.skip}`);
      return null;
    }
    const version = a.checkTinynodVersion({ env });
    if (!version.ok) {
      log(`pre-push: tinynod review skipped: ${version.reason}`);
      return null;
    }
    const common = gitOk(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, env: withoutGitRouting(env) });
    if (!common) {
      log('pre-push: tinynod review skipped: no git common directory');
      return null;
    }
    const lock = a.acquireReviewLock(common);
    if (!lock) {
      log('pre-push: tinynod review skipped: another review is running for this repository');
      return null;
    }
    const developerOrigin = gitOk(['remote', 'get-url', 'origin'], { cwd: root, env: withoutGitRouting(env) });
    return createReviewSession({ a, target, root, common, lock, developerOrigin, env: a.withRepoIdentityEnv(env, aliases), log, error });
  } catch (cause) {
    error(`pre-push: tinynod review unavailable: ${cause.message}`);
    return null;
  }
}

// Stops a review's process group and removes its capture files without waiting.
function stopReview(review) {
  try { process.kill(-review.child?.pid, 'SIGKILL'); } catch { /* already exited */ }
  rmSync(review.dir, { recursive: true, force: true });
}

// Prints the verdict and findings, then records the review's history.
function reportReview({ a, outcome, target, common, log, error }) {
  const verdict = a.classifyReview({ ...outcome, base: target.base });
  log(`pre-push: tinynod review (advisory) ${verdict.status}: ${verdict.message}`);
  const findings = verdict.findings ?? [];
  for (const finding of findings.slice(0, REVIEW_FINDINGS_SHOWN)) log(describeFinding(finding));
  if (findings.length > REVIEW_FINDINGS_SHOWN) log(`  ... ${findings.length - REVIEW_FINDINGS_SHOWN} more`);
  if (!verdict.payload) return;
  const entry = a.ledgerEntryFor({ payload: verdict.payload, oid: target.oid, base: target.base });
  if (entry) a.recordAndPruneHistory({ commonDir: common, entry, warn: error });
}

function createReviewSession({ a, target, root, common, lock, developerOrigin, env, log, error }) {
  const cleanup = a.installAbortCleanup();
  cleanup.setLock(lock);
  let review = null;
  let tree = null;
  const dropTree = () => {
    if (!tree) return;
    cleanup.untrack(tree);
    rmSync(tree, { recursive: true, force: true });
    tree = null;
  };
  const discardReview = () => {
    if (!review) return;
    cleanup.cleanup();
    review = null;
  };
  let finished = false;
  const close = () => {
    finished = true;
    dropTree();
    cleanup.dispose();
    lock.release();
  };
  return {
    // The same push can verify twice (a lost snapshot lock re-verifies in a
    // fresh clone), so a second start replaces the first review. The snapshot
    // only marks when verification begins; the review does not run in it.
    start(_snapshot, oid) {
      if (finished || oid !== target.oid) return;
      try {
        if (review) {
          cleanup.untrack(review.dir);
          stopReview(review);
        }
        dropTree();
        tree = a.createReviewTree({ root, oid: target.oid, env });
        cleanup.track(tree);
        const slotOrigin = gitOk(['remote', 'get-url', 'origin'], { cwd: tree, env: withoutGitRouting(env) });
        review = a.startReview({ base: target.base, cwd: tree, env: a.withRepoIdentityEnv(env, {}, { developerOrigin, slotOrigin }) });
        cleanup.setChild(review.child);
        cleanup.track(review.dir);
        log(`pre-push: tinynod review started (base ${target.base.slice(0, 12)}, head ${target.oid.slice(0, 12)})`);
      } catch (cause) {
        error(`pre-push: tinynod review could not start (base ${target.base.slice(0, 12)}, head ${target.oid.slice(0, 12)}): ${cause.message}`);
        review = null;
      }
    },
    // Verification failed: the review no longer matters.
    abort() {
      if (finished) return;
      discardReview();
      close();
    },
    async finish() {
      if (finished) return;
      try {
        if (!review) return;
        // Verification ran in a blocking call; let pending child events land
        // before the budget is judged.
        await new Promise((resolveTick) => setImmediate(resolveTick));
        reportReview({ a, outcome: await a.finishReview(review), target, common, log, error });
      } catch (cause) {
        error(`pre-push: tinynod review failed to finish (base ${target.base.slice(0, 12)}, head ${target.oid.slice(0, 12)}): ${cause.message}`);
      } finally {
        review = null;
        close();
      }
    },
  };
}

export function runPrePush({ input = readFileSync(0, 'utf8'), remoteUrl, root = process.cwd(), log = console.log, error = console.error, select = selectPush, verify = runFullVerification, fastVerify = runFastVerification, run = spawnCommand, review = () => null } = {}) {
  if (!remoteUrl) {
    error('pre-push: Git did not provide remote URL; aborting push.');
    return 1;
  }
  const tuples = parseTuples(input);
  const runGit = (args) => gitOk(args, { cwd: root });
  const aliases = configuredAliases(run);
  const checks = {
    hasObject: (object) => runGit(['cat-file', '-e', `${object}^{commit}`]) !== null,
    mergeBase: (left, right) => runGit(['merge-base', left, right]),
    isAncestor: (left, right) => runGit(['merge-base', '--is-ancestor', left, right]) !== null,
  };
  let selection = select({
    tuples,
    remoteUrl,
    aliases,
    ...checks,
    changed: (base, oid) => changedPaths(base, oid, runGit),
  });
  log(`pre-push: ${selection.action}; ${selection.reason}`);
  if (selection.paths?.length) log(`pre-push: selected paths:\n${selection.paths.map((path) => `  ${path}`).join('\n')}`);
  const session = selection.action === 'abort' ? null : review({
    tuples, selection, root, aliases, log, error,
    checks: { ...checks, remoteVerified: githubRepository(remoteUrl, aliases) !== null },
  });
  const withReview = session ? { review: session } : {};
  if (selection.action === 'abort') return 1;
  if (selection.action === 'skip') return 0;
  const time = createPhaseTimer({ log });
  try {
    if (selection.action === 'fast') {
      time('total', () => fastVerify({ oid: selection.oid, base: selection.base, paths: selection.paths, root, log, run, ...withReview }));
      return 0;
    }
    const oids = selection.oids ?? (selection.oid ? [selection.oid] : [...new Set((tuples ?? [])
      .filter((tuple) => !ZERO_OID.test(tuple.localOid)).map((tuple) => tuple.localOid))]);
    if (!oids.length) throw new Error('no pushed object available for full verification');
    time('total', () => { for (const oid of oids) verify({ oid, root, log, ...withReview }); });
    return 0;
  } catch (cause) {
    session?.abort();
    error(`pre-push: ${cause.message}`);
    return 1;
  }
}

/**
 * Runs the sync push policy, then waits for the advisory review (if one was
 * started) and reports it. The exit code is decided before the review is
 * awaited and is never changed by it.
 */
export async function runPrePushWithReview(options = {}) {
  const sessions = [];
  const prepare = options.review ?? prepareTinynodReview;
  const code = runPrePush({ ...options, review: (context) => {
    const session = prepare(context);
    if (session) sessions.push(session);
    return session;
  } });
  for (const session of sessions) {
    try { await session.finish(); } catch (cause) { (options.error ?? console.error)(`pre-push: tinynod review failed to finish: ${cause.message}`); }
  }
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runPrePushWithReview({ remoteUrl: process.argv[3] });
}
