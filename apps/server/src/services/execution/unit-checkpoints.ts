import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join as joinPath, relative, resolve as resolvePath, sep } from 'node:path';

/**
 * Per-unit checkpoints (plan step `unit-checkpoints`, AC5).
 *
 * The worker's PostToolUse event carries no pre-write content, so checkpoints are taken against a git
 * BASELINE instead of pre-write snapshots: at claim time the squad worktree's `git status` is recorded
 * (`dirty`, with a hash per path), and a unit's work is measured against git HEAD. Paths that were already
 * dirty when the claim started are labelled and never attributed to or restored for the unit.
 *
 * Checkpointing never creates a commit, stash or branch. Git is only read (`rev-parse`, `status`, `ls-tree`,
 * `cat-file`, `diff`); restoring a file writes bytes taken from HEAD directly, and never touches the index.
 * Git runs off the main event loop (child process), with a timeout, and its output is captured through a
 * uniquely-named 0600 temp file (never trust piped child stdout in Electron main).
 */

/** Files above this are fingerprinted by size and mtime instead of content. */
export const CLAIM_HASH_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_BASELINE_PATHS = 500;
export const MAX_CHECKPOINT_PATHS = 200;
export const MAX_RESTORE_ATTEMPTS = 5;
const GIT_TIMEOUT_MS = 5_000;
const GIT_STATUS_MAX_BYTES = 1024 * 1024;
const GIT_CONTENT_MAX_BYTES = CLAIM_HASH_MAX_BYTES;
const PATCH_MAX_CHARS = 4_096;
/** Total patch text kept in one artifact record; the artifact store caps a record at 64 KiB. */
const ARTIFACT_PATCH_BUDGET = 32 * 1024;
const ARTIFACT_MAX_BYTES = 60 * 1024;
const MAX_PATH_LENGTH = 1_024;
const MAX_REASON = 200;

export interface BaselineEntry { path: string; hash: string }

/** Worktree state recorded when a unit's claim started. */
export interface UnitBaseline {
  claimId: string;
  at: number;
  /** False when git could not report the worktree state: nothing is attributed or restored. */
  ok: boolean;
  head?: string;
  /** Paths already dirty (tracked-modified or untracked) at claim time, with their content hash. */
  dirty: BaselineEntry[];
  /** True when `git status` output or the path count hit a cap: the dirty set is incomplete. */
  truncated?: boolean;
  reason?: string;
}

export type CheckpointState = 'saved' | 'restored' | 'partial' | 'pending' | 'unavailable';
export interface CheckpointSkip { path: string; reason: string }
export interface UnitCheckpoint {
  at: number;
  state: CheckpointState;
  /** Artifact name holding the per-path patches (evidence, not a replayable sequence). */
  artifact?: string;
  restored: string[];
  deleted: string[];
  skipped: CheckpointSkip[];
  /** Paths that were dirty before this unit started and that the unit also touched. Labelled, never restored. */
  preDirty: string[];
  /** Paths that changed during the claim but were not attributed to it (a sibling may have written them). */
  unattributed: string[];
  attempts: number;
  truncated?: boolean;
  reason?: string;
}

export interface ConfinedHash { path: string; hash: string }

/**
 * Confine a worker-supplied path to the claim's worktree (rule 2): realpath the nearest existing
 * ancestor, require it under realpath(root), and return the worktree-relative POSIX path plus a
 * content hash. Undefined when the path escapes, is not a regular file, or cannot be resolved.
 */
export async function confineAndHashClaimWrite(root: string, cwd: string | undefined, rawPath: string): Promise<ConfinedHash | undefined> {
  try {
    const realRoot = await realpath(root);
    const absolute = isAbsolute(rawPath) ? resolvePath(rawPath) : resolvePath(cwd ?? realRoot, rawPath);
    let real: string;
    try { real = await realpath(absolute); }
    catch { real = joinPath(await realpath(dirname(absolute)), absolute.slice(dirname(absolute).length + 1)); }
    const rel = relative(realRoot, real);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
    // Never open a FIFO/device: open() on one can block a threadpool thread indefinitely.
    const pre = await stat(real).catch(() => undefined);
    if (pre && !pre.isFile()) return undefined;
    const handle = await open(real, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile()) return undefined;
      if (info.size > CLAIM_HASH_MAX_BYTES) return { path: rel.split(sep).join('/'), hash: `stat:${info.size}:${Math.floor(info.mtimeMs)}` };
      const hash = createHash('sha256').update(await handle.readFile()).digest('hex');
      return { path: rel.split(sep).join('/'), hash };
    } finally { await handle.close(); }
  } catch { return undefined; }
}

interface GitResult { code: number; stdout: Buffer; truncated: boolean }

/** Test seam: replaces the git child process. Returns undefined when git cannot run or timed out. */
export type GitRunner = (cwd: string, args: readonly string[], opts: { timeoutMs: number; maxBytes: number }) => Promise<GitResult | undefined>;

/** Run `git` read-only, off the event loop, capturing stdout through a 0600 temp file. Never throws. */
export const runGit: GitRunner = async (cwd, args, opts) => {
  const file = joinPath(tmpdir(), `zcc-ckpt-${randomUUID()}.out`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(file, 'wx+', 0o600);
    const fd = handle.fd;
    const code = await new Promise<number | null>((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const done = (value: number | null) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(value); } };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn('git', ['--no-optional-locks', '--literal-pathspecs', '-C', cwd, ...args], {
          stdio: ['ignore', fd, 'ignore'], windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
        });
      } catch { done(null); return; }
      timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } done(null); }, opts.timeoutMs);
      child.once('error', () => done(null));
      child.once('close', (exit) => done(exit));
    });
    if (code === null) return undefined;
    const size = (await handle.stat()).size;
    const length = Math.min(size, opts.maxBytes);
    const stdout = Buffer.alloc(length);
    if (length > 0) await handle.read(stdout, 0, length, 0);
    return { code, stdout, truncated: size > opts.maxBytes };
  } catch { return undefined; }
  finally {
    await handle?.close().catch(() => undefined);
    await unlink(file).catch(() => undefined);
  }
};

interface GitDeps { git?: GitRunner; now?: () => number }

async function headOf(root: string, git: GitRunner): Promise<string | undefined> {
  const out = await git(root, ['rev-parse', '--verify', 'HEAD'], { timeoutMs: GIT_TIMEOUT_MS, maxBytes: 256 });
  const head = out && out.code === 0 ? out.stdout.toString('utf8').trim() : '';
  return /^[0-9a-f]{40,64}$/.test(head) ? head : undefined;
}

/** `git status` paths of the worktree, hashed. `undefined` when git failed. */
async function scanDirty(root: string, git: GitRunner): Promise<{ entries: BaselineEntry[]; truncated: boolean } | undefined> {
  const out = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { timeoutMs: GIT_TIMEOUT_MS, maxBytes: GIT_STATUS_MAX_BYTES });
  if (!out || out.code !== 0) return undefined;
  const tokens = out.stdout.toString('utf8').split('\0');
  // A truncated buffer can end mid-entry; drop the last token.
  if (out.truncated) tokens.pop();
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.length < 4) continue;
    const xy = token.slice(0, 2);
    if (xy.includes('R') || xy.includes('C')) i += 1; // rename/copy: the next token is the original path
    const path = token.slice(3);
    if (path && path.length <= MAX_PATH_LENGTH) paths.push(path);
  }
  let truncated = out.truncated;
  const bounded = paths.length > MAX_BASELINE_PATHS ? (truncated = true, paths.slice(0, MAX_BASELINE_PATHS)) : paths;
  const entries: BaselineEntry[] = [];
  for (const path of bounded) {
    const hashed = await confineAndHashClaimWrite(root, root, path);
    // A path git lists that is gone, escapes the tree through a symlink, or is not a regular file is
    // recorded by name with a sentinel so it is still labelled pre-dirty and never restored.
    entries.push(hashed && hashed.path === path ? { path, hash: hashed.hash } : { path, hash: 'unresolved' });
  }
  return { entries, truncated };
}

/**
 * Record the squad worktree's state at claim time. Bounded, confined, off the event loop with a timeout.
 * Never throws: when git is missing or fails the baseline is `ok: false` and checkpoints only record evidence.
 */
export async function captureBaseline(root: string, claimId: string, deps: GitDeps = {}): Promise<UnitBaseline> {
  const git = deps.git ?? runGit;
  const at = (deps.now ?? Date.now)();
  try {
    const head = await headOf(root, git);
    const scan = head ? await scanDirty(root, git) : undefined;
    if (!head || !scan) return { claimId, at, ok: false, dirty: [], reason: head ? 'git-status-failed' : 'git-unavailable' };
    return { claimId, at, ok: true, head, dirty: scan.entries, ...(scan.truncated ? { truncated: true } : {}) };
  } catch {
    return { claimId, at, ok: false, dirty: [], reason: 'git-unavailable' };
  }
}

export interface CheckpointTouched { path: string; hash: string }
export interface CheckpointUnitInput {
  id: string;
  state: 'COMPLETED' | 'FAILED';
  touched: readonly CheckpointTouched[];
  baseline?: UnitBaseline;
}
export interface CheckpointSibling {
  id: string;
  touched: readonly CheckpointTouched[];
  /** True when the sibling's claim window overlaps this unit's (still claimed, or settled after this unit started). */
  concurrent: boolean;
}

interface PathEntry {
  path: string;
  source: 'tool' | 'inferred';
  /** Last-write hash when known (tool source). */
  lastWriteHash?: string;
  preDirty: boolean;
}

export interface CheckpointPatch {
  path: string;
  source: 'tool' | 'inferred';
  status: 'modified' | 'created' | 'deleted' | 'unknown';
  preDirty: boolean;
  hash?: string;
  patch?: string;
  patchTruncated?: boolean;
  patchOmitted?: boolean;
}

export interface CheckpointResult {
  checkpoint: Omit<UnitCheckpoint, 'artifact' | 'attempts'>;
  /** JSON for the per-unit artifact record. */
  artifactContent: string;
}

/** Serialize the artifact body under the artifact store's record cap: drop patch text, then trailing entries, if needed. */
function artifactJson(unit: CheckpointUnitInput, patches: CheckpointPatch[]): string {
  const render = (list: CheckpointPatch[], truncated: boolean) => JSON.stringify({
    version: 1, unitId: unit.id, state: unit.state, baselineHead: unit.baseline?.head, baselineAt: unit.baseline?.at,
    ...(truncated ? { patchesTruncated: true } : {}), patches: list
  });
  let text = render(patches, false);
  if (Buffer.byteLength(text, 'utf8') <= ARTIFACT_MAX_BYTES) return text;
  let list = patches.map(({ patch: _patch, patchTruncated: _truncated, ...rest }) => ({ ...rest, patchOmitted: true }));
  text = render(list, false);
  while (Buffer.byteLength(text, 'utf8') > ARTIFACT_MAX_BYTES && list.length > 0) {
    list = list.slice(0, Math.floor(list.length / 2));
    text = render(list, true);
  }
  return text;
}

function cap(value: string, max: number): string { return value.length > max ? value.slice(0, max) : value; }

async function inHead(root: string, path: string, git: GitRunner): Promise<{ tracked: boolean; mode?: string } | undefined> {
  const out = await git(root, ['ls-tree', '-z', 'HEAD', '--', path], { timeoutMs: GIT_TIMEOUT_MS, maxBytes: 4_096 });
  if (!out || out.code !== 0) return undefined;
  const text = out.stdout.toString('utf8');
  if (!text) return { tracked: false };
  const match = text.match(/^(\d{6}) \w+ [0-9a-f]+\t/);
  return match ? { tracked: true, mode: match[1]! } : undefined;
}

async function patchText(root: string, path: string, tracked: boolean, git: GitRunner): Promise<{ text: string; truncated: boolean } | undefined> {
  const args = tracked
    ? ['diff', '--no-color', '--no-ext-diff', '--no-textconv', 'HEAD', '--', path]
    : ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-index', '--', '/dev/null', path];
  const out = await git(root, args, { timeoutMs: GIT_TIMEOUT_MS, maxBytes: PATCH_MAX_CHARS * 2 });
  // `--no-index` exits 1 when the files differ; that is the normal result.
  if (!out || out.code > 1) return undefined;
  const text = out.stdout.toString('utf8');
  return { text: cap(text, PATCH_MAX_CHARS), truncated: out.truncated || text.length > PATCH_MAX_CHARS };
}

async function writeAtomic(absolute: string, bytes: Buffer, mode: number): Promise<void> {
  const tmp = `${absolute}.${randomUUID().slice(0, 8)}.zcc-ckpt.tmp`;
  try {
    await writeFile(tmp, bytes, { mode, flag: 'wx' });
    await rename(tmp, absolute);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

/**
 * Build the unit's checkpoint: per-path patches against HEAD, labelled pre-dirty paths, and (for a FAILED
 * unit with `restore` true) a guarded restore. A path is restored only when ALL hold: git baseline is complete,
 * HEAD has not moved, the path was clean at claim time, no sibling touched it, and the file's current hash still
 * equals the unit's last write. Paths found only by diffing (shell writes) are reported with a patch, never restored. A file absent from HEAD is deleted (the unit created it); otherwise HEAD's bytes
 * are written back atomically. Everything else is skipped and reported. Never throws.
 */
export async function buildUnitCheckpoint(
  root: string,
  unit: CheckpointUnitInput,
  siblings: readonly CheckpointSibling[],
  options: { restore: boolean } & GitDeps
): Promise<CheckpointResult> {
  const git = options.git ?? runGit;
  const at = (options.now ?? Date.now)();
  const restored: string[] = [];
  const deleted: string[] = [];
  const skipped: CheckpointSkip[] = [];
  const preDirty: string[] = [];
  const unattributed: string[] = [];
  const patches: CheckpointPatch[] = [];
  const skip = (path: string, reason: string) => { if (skipped.length < MAX_CHECKPOINT_PATHS) skipped.push({ path: cap(path, MAX_PATH_LENGTH), reason }); };
  const finish = (state: CheckpointState, extra: { truncated?: boolean; reason?: string } = {}): CheckpointResult => {
    // Incomplete evidence (skips, truncation, failed scan) is never reported as a clean result.
    const incomplete = skipped.length > 0 || extra.truncated === true;
    const finalState: CheckpointState = (state === 'restored' || state === 'saved') && incomplete ? 'partial' : state;
    return {
      checkpoint: {
        at, state: finalState, restored, deleted, skipped, preDirty, unattributed,
        ...(extra.truncated ? { truncated: true } : {}), ...(extra.reason ? { reason: cap(extra.reason, MAX_REASON) } : {})
      },
      artifactContent: artifactJson(unit, patches)
    };
  };
  try {
    const baseline = unit.baseline;
    const baselineUsable = baseline !== undefined && baseline.ok && !baseline.truncated;
    const dirtyAtClaim = new Map((baseline?.dirty ?? []).map((entry) => [entry.path, entry.hash]));
    const otherTouched = new Map<string, string[]>();
    for (const sibling of siblings) for (const entry of sibling.touched) {
      const ids = otherTouched.get(entry.path) ?? [];
      ids.push(sibling.id);
      otherTouched.set(entry.path, ids);
    }
    const entries = new Map<string, PathEntry>();
    for (const touched of unit.touched.slice(0, MAX_CHECKPOINT_PATHS)) {
      entries.set(touched.path, { path: touched.path, source: 'tool', lastWriteHash: touched.hash, preDirty: dirtyAtClaim.has(touched.path) });
    }
    let truncated = unit.touched.length > MAX_CHECKPOINT_PATHS;
    const head = baselineUsable ? await headOf(root, git) : undefined;
    const headMoved = baselineUsable && head !== baseline!.head;
    const concurrentSibling = siblings.some((sibling) => sibling.concurrent);

    // Bash and apply_patch writes show no tool path: take what changed since the baseline.
    if (baselineUsable) {
      const now = await scanDirty(root, git);
      if (!now) skip('*', 'git-status-failed');
      else {
        if (now.truncated) truncated = true;
        for (const entry of now.entries) {
          if (entries.has(entry.path) || dirtyAtClaim.get(entry.path) === entry.hash) continue;
          if (otherTouched.has(entry.path) || concurrentSibling) {
            if (unattributed.length < MAX_CHECKPOINT_PATHS) unattributed.push(entry.path);
            continue;
          }
          if (entries.size >= MAX_CHECKPOINT_PATHS) { truncated = true; break; }
          entries.set(entry.path, { path: entry.path, source: 'inferred', preDirty: dirtyAtClaim.has(entry.path) });
        }
      }
    }

    const realRoot = await realpath(root).catch(() => undefined);
    if (!realRoot) {
      for (const entry of entries.values()) skip(entry.path, 'worktree-unavailable');
      return finish('unavailable', { truncated, reason: 'worktree-unavailable' });
    }

    let patchBudget = ARTIFACT_PATCH_BUDGET;
    const wantRestore = options.restore && unit.state === 'FAILED';
    for (const entry of entries.values()) {
      const current = await confineAndHashClaimWrite(root, realRoot, entry.path);
      const confined = current !== undefined && current.path === entry.path;
      const headInfo = baselineUsable ? await inHead(root, entry.path, git) : undefined;
      const patch: CheckpointPatch = {
        path: entry.path, source: entry.source, preDirty: entry.preDirty,
        status: !headInfo ? 'unknown' : !confined ? (headInfo.tracked ? 'deleted' : 'unknown') : headInfo.tracked ? 'modified' : 'created',
        ...(confined ? { hash: current.hash } : {})
      };
      if (entry.preDirty) preDirty.push(entry.path);
      if (headInfo && confined) {
        const text = patchBudget > 0 ? await patchText(root, entry.path, headInfo.tracked, git) : undefined;
        if (text && text.text.length <= patchBudget) {
          patch.patch = text.text;
          if (text.truncated) patch.patchTruncated = true;
          patchBudget -= text.text.length;
        } else patch.patchOmitted = true;
      } else patch.patchOmitted = true;
      patches.push(patch);
      if (!wantRestore) continue;

      // ---- guarded restore (FAILED only) ----
      if (!baselineUsable) { skip(entry.path, baseline?.truncated ? 'baseline-incomplete' : 'no-baseline'); continue; }
      if (headMoved) { skip(entry.path, 'head-moved'); continue; }
      if (entry.preDirty) { skip(entry.path, 'pre-dirty'); continue; }
      const sharedWith = otherTouched.get(entry.path);
      if (sharedWith) { skip(entry.path, `shared-with:${cap(sharedWith.join(','), 80)}`); continue; }
      // A path seen only through a post-hoc diff cannot be told apart from a person's or another tool's edit in the
      // same checkout, so it is reported with its patch and never rewritten.
      if (entry.source === 'inferred') { skip(entry.path, 'unattributed-write'); continue; }
      if (!headInfo) { skip(entry.path, 'head-lookup-failed'); continue; }
      if (headInfo.tracked && headInfo.mode !== '100644' && headInfo.mode !== '100755') { skip(entry.path, 'unsupported-mode'); continue; }
      if (!confined) {
        // Gone already: a created file the unit removed needs nothing; a tracked file it deleted is rewritten below.
        // Only a path that is truly absent counts; one that merely fails confinement (symlink escape) is left alone.
        const gone = await lstat(joinPath(realRoot, ...entry.path.split('/'))).then(() => false, (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
        const parentOk = await realpath(dirname(joinPath(realRoot, ...entry.path.split('/')))).then((dir) => dir === realRoot || dir.startsWith(realRoot + sep), () => false);
        if (!gone || !parentOk) { skip(entry.path, 'unconfined'); continue; }
        if (!headInfo.tracked) { deleted.push(entry.path); continue; }
      } else if (entry.source === 'tool' && current.hash !== entry.lastWriteHash) {
        skip(entry.path, 'changed-after-last-write');
        continue;
      }
      const absolute = joinPath(realRoot, ...entry.path.split('/'));
      try {
        if (!headInfo.tracked) {
          await unlink(absolute);
          deleted.push(entry.path);
        } else {
          const blob = await git(root, ['cat-file', 'blob', `${baseline!.head}:${entry.path}`], { timeoutMs: GIT_TIMEOUT_MS, maxBytes: GIT_CONTENT_MAX_BYTES });
          if (!blob || blob.code !== 0) { skip(entry.path, 'head-content-unavailable'); continue; }
          if (blob.truncated) { skip(entry.path, 'too-large'); continue; }
          // Re-check right before writing: a sibling may have written since the hash above.
          const again = await confineAndHashClaimWrite(root, realRoot, entry.path);
          if (again?.hash !== current?.hash) { skip(entry.path, 'changed-during-restore'); continue; }
          if (await headOf(root, git) !== baseline!.head) { skip(entry.path, 'head-moved'); continue; }
          const mode = headInfo.mode === '100755' ? 0o755 : (await stat(absolute).then((info) => info.mode & 0o777).catch(() => 0o644));
          await writeAtomic(absolute, blob.stdout, mode);
          restored.push(entry.path);
        }
      } catch (error) {
        skip(entry.path, `restore-failed:${cap(error instanceof Error ? error.message : String(error), 80)}`);
      }
    }
    if (!baselineUsable) {
      return finish('unavailable', { truncated, reason: baseline?.reason ?? (baseline?.truncated ? 'baseline-incomplete' : 'no-baseline') });
    }
    return finish(wantRestore ? 'restored' : 'saved', { truncated });
  } catch (error) {
    return finish('unavailable', { reason: `checkpoint-failed:${error instanceof Error ? error.message : String(error)}` });
  }
}
