/**
 * Advisory tinynod review for pre-push. Everything here is best effort: a
 * review that cannot run, times out, or produces unreadable output is reported
 * and the push proceeds. Side effects (filesystem, process spawning, signals,
 * clocks) are injected so the policy is testable without tinynod or a network.
 */
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { homedir, hostname, constants as osConstants, tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

const ZERO_OID = /^0+$/;
const MIN_VERSION = [2, 5, 0];
const VERSION_TIMEOUT_MS = 5_000;
const REVIEW_BUDGET_MS = 300_000;
const KILL_GRACE_MS = 10_000;
const POLL_MS = 100;
const MAX_STDOUT = 8 * 1024 * 1024;
const MAX_STDERR = 1024 * 1024;
const STDERR_TAIL = 4 * 1024;
const HISTORY_KEEP = 50;
const LOCK_NAME = 'zana-tinynod-review.lock';
const LEDGER_NAME = 'zana-tinynod-history.json';
// An owner record that cannot be read, or a leftover from an interrupted lock,
// is reclaimed after this long. Another host's pids cannot be probed, so its
// locks expire only by age.
const ABANDONED_MS = 60_000;
const FOREIGN_LOCK_MS = 24 * 60 * 60_000;
const ABORT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const GIT_ROUTING = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_PREFIX'];

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function parseBool(value) {
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

/**
 * Bypass beats the environment switch, which beats the developer's git config.
 * An unrecognized value turns the review off with a warning rather than guessing.
 */
export function resolveEnablement({ env = process.env, readConfig = () => null } = {}) {
  const skip = String(env.TINYNOD_SKIP_HOOK ?? '').trim().toLowerCase();
  if (skip === '1' || skip === 'true') return { enabled: false, source: 'TINYNOD_SKIP_HOOK' };
  // An empty or blank env value counts as unset; git config is read only when needed.
  const sources = [
    ['ZANA_TINYNOD_REVIEW', () => env.ZANA_TINYNOD_REVIEW],
    ['git config zana.tinynod.enabled', readConfig],
  ];
  for (const [source, read] of sources) {
    const value = read();
    if (value === undefined || value === null) continue;
    if (source === 'ZANA_TINYNOD_REVIEW' && String(value).trim() === '') continue;
    const parsed = parseBool(value);
    if (parsed === null) return { enabled: false, source, warning: `invalid value ${JSON.stringify(String(value))} for ${source}; tinynod review is off` };
    return { enabled: parsed, source };
  }
  return { enabled: false, source: 'default' };
}

/** Read `zana.tinynod.enabled` from the developer's repository, or null when unset. */
export function readGitEnablement(root, { run = spawnSync, env = process.env } = {}) {
  const clean = { ...env };
  for (const key of GIT_ROUTING) delete clean[key];
  const result = run('git', ['config', '--get', 'zana.tinynod.enabled'], { cwd: root, encoding: 'utf8', env: clean });
  return result?.status === 0 ? result.stdout.trim() : null;
}

/**
 * Review base for one pushed tuple: the remote tip when it is an ancestor of
 * the pushed commit, otherwise the merge base with origin/main.
 */
export function deriveReviewBase(tuple, { hasObject, mergeBase, isAncestor }) {
  if (!ZERO_OID.test(tuple.remoteOid) && hasObject(tuple.remoteOid) && isAncestor(tuple.remoteOid, tuple.localOid)) {
    return { base: tuple.remoteOid };
  }
  if (!hasObject('origin/main')) return { skip: 'no local origin/main to derive a review base' };
  const base = mergeBase('origin/main', tuple.localOid);
  return base ? { base } : { skip: 'no merge base with origin/main' };
}

function protectedRef(ref) {
  return ref === 'refs/heads/main' || ref.startsWith('refs/tags/') || ref.startsWith('refs/heads/release/');
}

/**
 * Pure target selection: one pushed commit against one base, or a skip reason.
 * `checks.remoteVerified` says the remote is the verified GitHub repository.
 */
export function deriveReviewTarget(tuples, checks) {
  if (!tuples?.length) return { skip: 'missing or malformed pre-push ref tuples' };
  if (!checks.remoteVerified) return { skip: 'remote is not verified GitHub salesforce/zana' };
  const oids = new Set();
  const bases = new Set();
  for (const tuple of tuples) {
    if (ZERO_OID.test(tuple.localOid)) continue; // deletion has nothing to review
    if (protectedRef(tuple.remoteRef)) return { skip: `protected ref ${tuple.remoteRef}` };
    const derived = deriveReviewBase(tuple, checks);
    if (derived.skip) return { skip: derived.skip };
    oids.add(tuple.localOid);
    bases.add(derived.base);
  }
  if (!oids.size) return { skip: 'ref deletion only' };
  if (oids.size !== 1) return { skip: 'multiple distinct pushed commits' };
  if (bases.size !== 1) return { skip: 'multiple review bases' };
  return { oid: [...oids][0], base: [...bases][0] };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readOwner(lock, fs) {
  try { return JSON.parse(fs.readFileSync(join(lock, 'owner.json'), 'utf8')); } catch { return null; }
}

function ageOf(path, fs, now) {
  try { return now() - fs.statSync(path).mtimeMs; } catch { return 0; }
}

function lockAbandoned(lock, owner, { fs, host, alive, now }) {
  if (!owner) return ageOf(lock, fs, now) > ABANDONED_MS;
  if (owner.host !== host) return ageOf(lock, fs, now) > FOREIGN_LOCK_MS;
  return !alive(owner.pid);
}

/**
 * Published whole: the owner record is written into a private directory that
 * is renamed into place, so exactly one process wins a free lock and every
 * lock carries a token. An abandoned lock is renamed aside and put back if it
 * turns out to be one a concurrent process just published. Returns null when
 * another live review holds the lock.
 */
export function acquireReviewLock(commonDir, { fs = nodeFs, pid = process.pid, host = hostname(), alive = processAlive, now = Date.now } = {}) {
  const lock = join(commonDir, LOCK_NAME);
  const options = { fs, host, alive, now };
  const token = randomUUID();
  const draft = `${lock}.${token}.tmp`;
  fs.mkdirSync(draft);
  try {
    fs.writeFileSync(join(draft, 'owner.json'), JSON.stringify({ pid, host, token }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        fs.renameSync(draft, lock);
        return {
          path: lock,
          token,
          owns: () => readOwner(lock, fs)?.token === token,
          release: () => {
            // A lock left behind names this process and is reclaimed once it exits.
            try { if (readOwner(lock, fs)?.token === token) fs.rmSync(lock, { recursive: true, force: true }); } catch { /* reclaimed later */ }
          },
        };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      }
      const owner = readOwner(lock, fs);
      if (attempt > 0 || !lockAbandoned(lock, owner, options)) return null;
      const stale = `${lock}.${randomUUID()}.stale`;
      try { fs.renameSync(lock, stale); } catch { return null; }
      if (readOwner(stale, fs)?.token !== owner?.token) {
        try { fs.renameSync(stale, lock); } catch { /* a third process holds the lock; leave it */ }
        return null;
      }
      fs.rmSync(stale, { recursive: true, force: true });
    }
    return null;
  } finally {
    fs.rmSync(draft, { recursive: true, force: true });
  }
}

function killGroup(child, signal, kill) {
  if (!child?.pid) return;
  try { kill(-child.pid, signal); } catch {
    try { kill(child.pid, signal); } catch { /* already gone */ }
  }
}

/**
 * Stops the review child's process group, deletes its temp files, and releases
 * the lock when the push is interrupted or the process exits early. Cleanup
 * runs once; `dispose` detaches the handlers after a normal completion.
 */
export function installAbortCleanup({ proc = process, kill = process.kill.bind(process), fs = nodeFs } = {}) {
  const state = { child: null, files: new Set(), lock: null, done: false };
  const cleanup = () => {
    if (state.done) return;
    state.done = true;
    killGroup(state.child, 'SIGKILL', kill);
    for (const file of state.files) {
      try { fs.rmSync(file, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    try { state.lock?.release(); } catch { /* reclaimed later */ }
  };
  const handlers = ABORT_SIGNALS.map((signal) => [signal, () => {
    cleanup();
    proc.exit(128 + (osConstants.signals[signal] ?? 0));
  }]);
  handlers.push(['exit', cleanup]);
  for (const [event, handler] of handlers) proc.on(event, handler);
  return {
    track: (path) => { state.files.add(path); },
    untrack: (path) => { state.files.delete(path); },
    setChild: (child) => { state.child = child; },
    setLock: (lock) => { state.lock = lock; },
    cleanup,
    dispose: () => {
      state.done = true;
      for (const [event, handler] of handlers) proc.removeListener(event, handler);
    },
  };
}

/**
 * Environment for the review: quiet logging that never writes to a shared log
 * file, and `insteadOf` rewrites appended after any existing GIT_CONFIG_* pairs
 * so a configured SSH alias identifies the same GitHub repository as its host
 * and the snapshot's origin resolves to the developer's remote URL.
 */
export function withRepoIdentityEnv(env = process.env, aliases = {}, { developerOrigin, slotOrigin } = {}) {
  const next = { ...env, LOG_LEVEL: 'warn' };
  delete next.LOG_FILE;
  for (const key of GIT_ROUTING) delete next[key];
  let count = Number.parseInt(next.GIT_CONFIG_COUNT ?? '0', 10) || 0;
  const add = (key, value) => {
    next[`GIT_CONFIG_KEY_${count}`] = key;
    next[`GIT_CONFIG_VALUE_${count}`] = value;
    count += 1;
  };
  for (const [alias, host] of Object.entries(aliases)) {
    if (host !== 'github.com' || alias === host) continue;
    add('url.git@github.com:.insteadOf', `git@${alias}:`);
    add('url.ssh://git@github.com/.insteadOf', `ssh://git@${alias}/`);
  }
  // The snapshot clone's origin is the developer checkout, so tinynod would not
  // find per-repo settings keyed by the real remote. Rewrite the clone's origin
  // back to the developer's remote URL.
  if (developerOrigin && slotOrigin && developerOrigin !== slotOrigin) add(`url.${developerOrigin}.insteadOf`, slotOrigin);
  next.GIT_CONFIG_COUNT = String(count);
  return next;
}

function versionAtLeast(version, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] !== minimum[index]) return version[index] > minimum[index];
  }
  return true;
}

export function checkTinynodVersion({ run = spawnSync, command = 'tinynod', env = process.env } = {}) {
  const quoted = JSON.stringify(command);
  const minimum = MIN_VERSION.join('.');
  const result = run(command, ['--version'], { encoding: 'utf8', timeout: VERSION_TIMEOUT_MS, env });
  if (result?.error?.code === 'ENOENT') return { ok: false, reason: `tinynod not found (${quoted})` };
  if (result?.error?.code === 'ETIMEDOUT' || result?.signal === 'SIGTERM') {
    return { ok: false, reason: `tinynod --version timed out after ${VERSION_TIMEOUT_MS / 1000}s (${quoted})` };
  }
  if (result?.error || result?.status !== 0) return { ok: false, reason: `tinynod --version failed (${quoted})` };
  const text = String(result.stdout ?? '').trim();
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (!match) return { ok: false, reason: `tinynod --version printed an unrecognized version ${JSON.stringify(text)}` };
  const version = match.slice(1).map(Number);
  if (!versionAtLeast(version, MIN_VERSION)) return { ok: false, reason: `tinynod ${version.join('.')} is older than the required ${minimum}` };
  return { ok: true, version: version.join('.') };
}

/**
 * A private, checkout-free clone of the pushed commit for the review to read.
 * The review can outlive verification, which releases or deletes its snapshot,
 * so it must not run inside it. The caller removes the returned directory.
 */
export function createReviewTree({ root, oid, env = process.env, tmp = tmpdir(), fs = nodeFs, run = spawnSync }) {
  const dir = fs.mkdtempSync(join(tmp, 'zana-tinynod-tree-'));
  const clean = { ...env };
  for (const key of GIT_ROUTING) delete clean[key];
  const git = (args, cwd) => run('git', args, { cwd, env: clean, encoding: 'utf8' })?.status === 0;
  if (!git(['clone', '--quiet', '--shared', '--no-checkout', root, dir], root) || !git(['update-ref', '--no-deref', 'HEAD', oid], dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('could not create a private review checkout');
  }
  return dir;
}

/**
 * Starts the review detached into its own process group, with output going to
 * owner-only temp files so a chatty review can neither block on a pipe nor
 * leak its output to other users.
 */
export function startReview({ base, cwd, env = process.env, command = 'tinynod', spawn = nodeSpawn, fs = nodeFs, tmp = tmpdir(), now = Date.now }) {
  const dir = fs.mkdtempSync(join(tmp, 'zana-tinynod-'));
  const stdoutPath = join(dir, 'stdout');
  const stderrPath = join(dir, 'stderr');
  const review = { dir, stdoutPath, stderrPath, child: null, exited: false, exitCode: null, spawnError: null, startedAt: now() };
  let outFd;
  let errFd;
  try {
    outFd = fs.openSync(stdoutPath, 'w', 0o600);
    errFd = fs.openSync(stderrPath, 'w', 0o600);
    review.child = spawn(command, ['review', '--base', base, '--format', 'json'], { cwd, env, detached: true, stdio: ['ignore', outFd, errFd] });
    review.child.on('error', (error) => { review.spawnError = error; review.exited = true; });
    review.child.on('exit', (code, signal) => { review.exitCode = code ?? signal; review.exited = true; });
    review.child.unref?.();
  } catch (error) {
    review.spawnError = error;
    review.exited = true;
  } finally {
    for (const fd of [outFd, errFd]) {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
  return review;
}

function sizeOf(path, fs) {
  try { return fs.statSync(path).size; } catch { return 0; }
}

function readTail(path, fs, max) {
  try {
    const size = sizeOf(path, fs);
    const length = Math.min(size, max);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(path, 'r');
    try { fs.readSync(fd, buffer, 0, length, size - length); } finally { fs.closeSync(fd); }
    return buffer.toString('utf8');
  } catch { return ''; }
}

const defaultSleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * Waits for the review within its budget, polling file sizes so runaway output
 * is cut off. A review that overruns gets SIGTERM, then SIGKILL after a grace
 * period. Temp files are removed before returning.
 */
export async function finishReview(review, { budgetMs = REVIEW_BUDGET_MS, graceMs = KILL_GRACE_MS, pollMs = POLL_MS, sleep = defaultSleep, now = Date.now, kill = process.kill.bind(process), fs = nodeFs } = {}) {
  let timedOut = false;
  let tooLarge = false;
  const deadline = review.startedAt + budgetMs;
  const exceeded = () => sizeOf(review.stdoutPath, fs) > MAX_STDOUT || sizeOf(review.stderrPath, fs) > MAX_STDERR;
  while (!review.exited) {
    if (exceeded()) { tooLarge = true; break; }
    if (now() >= deadline) { timedOut = true; break; }
    await sleep(pollMs);
  }
  if (!review.exited && !review.spawnError) {
    killGroup(review.child, 'SIGTERM', kill);
    const killAt = now() + graceMs;
    while (!review.exited && now() < killAt) await sleep(pollMs);
    if (!review.exited) killGroup(review.child, 'SIGKILL', kill);
  }
  if (!tooLarge && exceeded()) tooLarge = true;
  const stdout = tooLarge || review.spawnError ? '' : readTail(review.stdoutPath, fs, MAX_STDOUT).trim();
  const stderrTail = readTail(review.stderrPath, fs, Math.min(STDERR_TAIL, MAX_STDERR)).trim();
  try { fs.rmSync(review.dir, { recursive: true, force: true }); } catch { /* swept with the temp directory */ }
  return { stdout, stderrTail, timedOut, tooLarge, spawnError: review.spawnError, exitCode: review.exitCode };
}

const MAX_JSON_CANDIDATES = 20;

function tryParseObject(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

// Whole output first, then a bounded number of lines that start a JSON object,
// so log-heavy output cannot cause quadratic re-parsing.
function parseReviewJson(stdout) {
  const whole = tryParseObject(stdout);
  if (whole) return whole;
  const lines = stdout.split('\n');
  let tried = 0;
  for (let index = 0; index < lines.length && tried < MAX_JSON_CANDIDATES; index += 1) {
    if (!lines[index].startsWith('{')) continue;
    tried += 1;
    const parsed = tryParseObject(lines.slice(index).join('\n')) ?? tryParseObject(lines[index]);
    if (parsed) return parsed;
  }
  return null;
}

const PARTIAL_SUMMARY = /^Partial review: \d+ of \d+/;
const warning = (reason, message) => ({ status: 'warning', reason, message });

/**
 * Advisory classification from the parsed JSON, never the exit code: tinynod
 * may exit non-zero for findings, and neither outcome blocks the push.
 */
export function classifyReview({ stdout = '', stderrTail = '', timedOut = false, tooLarge = false, spawnError = null, base = null } = {}) {
  if (spawnError) return warning('spawn_error', `could not start tinynod: ${spawnError.message}`);
  if (tooLarge) return warning('too_large', 'review output too large');
  if (timedOut) return warning('timeout', `review timed out after ${REVIEW_BUDGET_MS / 1000}s; run it manually: tinynod review --base ${base ?? '<base>'} --format json`);
  const payload = parseReviewJson(stdout);
  if (!payload) return warning('unparseable', `review produced no JSON result${stderrTail ? `: ${stderrTail.split('\n').pop()}` : ''}`);
  if (payload.error) return warning('review_error', `review reported an error: ${typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error)}`);
  if (payload.status === 'no_changes' || payload.noChanges === true) return { status: 'no_changes', message: 'no changes to review', findings: [], payload };
  if (typeof payload.failed !== 'boolean') return warning('unknown_shape', 'review result has an unrecognized shape');
  // tinynod reports its findings as `comments`; `findings` is accepted too.
  const findings = [payload.comments, payload.findings].find(Array.isArray) ?? [];
  if (PARTIAL_SUMMARY.test(String(payload.summary ?? '')) || payload.partial === true || payload.status === 'partial') {
    return { status: 'partial', message: `partial review, ${findings.length} finding${findings.length === 1 ? '' : 's'}`, findings, payload };
  }
  if (findings.length) return { status: 'findings', message: `${findings.length} finding${findings.length === 1 ? '' : 's'}`, findings, payload };
  if (payload.failed) return { status: 'findings', message: 'review flagged findings at or above its failure severity but listed no comments', findings: [], payload };
  return { status: 'clean', message: 'no findings', findings: [], payload };
}

function historyFileOf(payload) {
  const candidate = payload?.historyPath ?? payload?.historyFile ?? payload?.history?.path ?? payload?.history?.file;
  return typeof candidate === 'string' && candidate ? candidate : null;
}

/**
 * Ledger record for a review's history: the review file, its sibling comments
 * file, and their directory. Null when the review reported no history file.
 */
export function ledgerEntryFor({ payload, oid, base, now = Date.now }) {
  const file = historyFileOf(payload);
  if (!file) return null;
  const commentsFile = file.replace(/-review\.json$/, '-comments.json');
  return { file, commentsFile: commentsFile === file ? null : commentsFile, dir: dirname(file), oid, base, at: now() };
}

function readLedger(path, fs) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry?.file === 'string' && Number.isFinite(entry.at)) : [];
  } catch { return []; }
}

function confinedRealpath(file, root, fs) {
  try {
    const real = fs.realpathSync(file);
    return real !== root && real.startsWith(root + sep) ? real : null;
  } catch { return null; }
}

// Deletes one ledgered entry: its review and comments files, then its directory
// when nothing else is left in it. Every path must resolve inside the history root.
// Returns false when a delete failed, so the caller keeps the entry for a retry.
// Paths outside the root are never deleted and are dropped from the ledger.
function deleteHistoryEntry(old, root, fs, warn) {
  let settled = true;
  for (const file of [old.file, old.commentsFile]) {
    const real = typeof file === 'string' && confinedRealpath(file, root, fs);
    if (!real) continue;
    try { fs.rmSync(real, { recursive: true, force: true }); } catch (error) {
      settled = false;
      warn(`pre-push: could not delete tinynod history ${JSON.stringify(file)}: ${error.message}`);
    }
  }
  const dir = typeof old.dir === 'string' ? old.dir : dirname(old.file);
  const realDir = confinedRealpath(dir, root, fs);
  if (!realDir) return settled;
  try { if (fs.readdirSync(realDir).length === 0) fs.rmdirSync(realDir); } catch { /* shared or already gone */ }
  return settled;
}

/**
 * Appends this review's history to the ledger and deletes ledgered entries
 * beyond the newest 50. Only paths that resolve inside the history directory
 * are deleted, so a ledger entry can never reach outside it. The caller holds
 * the review lock, which serializes ledger updates across pushes. Failures
 * warn and never affect the push.
 */
export function recordAndPruneHistory({ commonDir, entry, historyRoot = join(homedir(), '.tinynod', 'history'), keep = HISTORY_KEEP, fs = nodeFs, warn = console.error }) {
  try {
    const ledgerPath = join(commonDir, LEDGER_NAME);
    const ledger = readLedger(ledgerPath, fs).filter((existing) => existing.file !== entry?.file);
    if (entry) ledger.push(entry);
    ledger.sort((left, right) => right.at - left.at);
    const kept = ledger.slice(0, keep);
    const root = (() => { try { return fs.realpathSync(historyRoot); } catch { return null; } })();
    // Without a resolvable history root nothing can be deleted yet, so keep every entry.
    for (const old of ledger.slice(keep)) if (!root || !deleteHistoryEntry(old, root, fs, warn)) kept.push(old);
    const temp = `${ledgerPath}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(kept, null, 2), { mode: 0o600 });
    fs.renameSync(temp, ledgerPath);
  } catch (error) {
    warn(`pre-push: could not update tinynod history ledger: ${error.message}`);
  }
}
