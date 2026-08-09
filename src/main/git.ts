import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { mkdirSync } from 'node:fs';
import type {
  GitBranch,
  GitCommit,
  GitCommitPreview,
  GitDiscardResult,
  GitFileCode,
  GitShowResult,
  GitStatus,
  GitWorkflowResult,
  Worktree,
  WorktreeCreateResult
} from '../shared/types.js';

const TIMEOUT_MS = 1500;
const GIT_MUTATION_TIMEOUT_MS = 30_000;
export const GIT_COMMIT_MESSAGE_MAX = 2_000;

async function commitRevision(cwd: string): Promise<string | null> {
  const result = await new Promise<{ ok: boolean; output: Buffer }>((resolve) => {
    execFile('git', ['status', '--porcelain=v2', '--branch', '-z'], {
      cwd, timeout: STATUS_SCOPED_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, encoding: 'buffer'
    }, (error, stdout) => resolve({ ok: !error, output: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? '') }));
  });
  return result.ok ? createHash('sha256').update(result.output).digest('hex') : null;
}

export async function previewProjectCommit(cwd: string, projectId: string, id: string, expiresAt: number): Promise<GitCommitPreview | null> {
  const status = await getGitStatus(cwd);
  if (!status || status.toplevel !== cwd || !status.dirty) return null;
  const revision = await commitRevision(cwd);
  if (!revision) return null;
  return {
    id,
    projectId,
    branch: status.branch,
    revision,
    writeSet: Object.entries(status.files ?? {}).map(([path, code]) => ({ path, code })),
    expiresAt
  };
}

/**
 * A SCOPED status (`getGitStatus` with a pathspec write-set) walks only the
 * named files, but on a huge monorepo even that touches enough index entries
 * that the 1.5s {@link TIMEOUT_MS} is occasionally tight on a cold cache. Give
 * the scoped read a roomier ceiling — it's still bounded (Rule 5), and a scoped
 * walk is dramatically cheaper than the full-tree read it replaces. */
const STATUS_SCOPED_TIMEOUT_MS = 10_000;

/**
 * Hard cap on how many pathspecs we hand `git status` on argv. The write-set is
 * transcript-derived and normally tiny (a handful of files), but a long-lived
 * agent could touch hundreds; we bound the pathspec list so a pathological
 * write-set can't build an unbounded argv (Rule 5). Beyond the cap we fall back
 * to an unscoped full-tree status and let the renderer intersect.  */
const STATUS_MAX_PATHSPECS = 400;

/** `git worktree add` clones the index + can check out a fresh branch — slower
 *  than a status read, so it gets a more generous ceiling than {@link TIMEOUT_MS}
 *  while still bounding a hung git (Rule 5). */
const WORKTREE_ADD_TIMEOUT_MS = 20_000;

/** Hard cap on how many commits `getRecentCommits` will ever read — bounds the
 *  `git log` output regardless of how deep the caller asks (CLAUDE.md rule 5). */
export const GIT_LOG_MAX_COMMITS = 100;

/**
 * Read the most recent commits reachable from HEAD, for the Activity Feed. This
 * is the feed's ONE greenfield git use — the feed is derived on demand, so we
 * shell out to `git log` only when the feed view opens (no interval poll, no
 * `.git/logs/HEAD` watcher — the design council rejected both as a hot loop /
 * flaky-on-network-mounts, and git.ts is otherwise pull-only).
 *
 * Bounded: `limit` is clamped to {@link GIT_LOG_MAX_COMMITS}. Never throws —
 * a non-repo, empty repo, or git error resolves to `[]` so the feed just omits
 * commits. Uses a NUL record separator + Unit-separator fields so subjects with
 * newlines/pipes can't corrupt parsing.
 */
export async function getRecentCommits(cwd: string, limit = 50): Promise<GitCommit[]> {
  if (!cwd || typeof cwd !== 'string' || !isAbsolute(cwd)) return [];
  const toplevel = findToplevel(cwd);
  if (!toplevel) return [];
  const n = Math.max(1, Math.min(GIT_LOG_MAX_COMMITS, Math.floor(limit) || 50));
  // %x1f = Unit Separator between fields, %x00 = NUL between records.
  const format = ['%H', '%h', '%an', '%at', '%s'].join('%x1f') + '%x00';

  return new Promise((resolve) => {
    execFile(
      'git',
      ['log', `--max-count=${n}`, `--pretty=format:${format}`],
      { cwd: toplevel, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        resolve(parseGitLog(String(stdout)));
      }
    );
  });
}

/** Parse the NUL-record / Unit-separated `git log` output. Pure; exported for tests. */
export function parseGitLog(out: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const record of out.split('\0')) {
    const rec = record.trim();
    if (!rec) continue;
    const fields = rec.split('\x1f');
    if (fields.length < 5) continue;
    const [hash, shortHash, author, atRaw, subject] = fields;
    const atSec = parseInt(atRaw, 10);
    if (!hash || !Number.isFinite(atSec)) continue;
    commits.push({
      hash,
      shortHash,
      author,
      ts: atSec * 1000,
      subject: subject.trim()
    });
  }
  return commits;
}

function findToplevel(start: string): string | null {
  let dir = start;
  while (true) {
    if (existsSync(`${dir}/.git`)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the repository's *common* git directory for `cwd` — the shared
 * `.git` that all worktrees of one repo point at. Two paths belong to the same
 * repository iff their common-dirs realpath-match, which is exactly the test we
 * need to recognize a worktree of a registered project as a trusted sibling
 * (CLAUDE.md #2 extends the trust anchor to a worktree of a registered project).
 * Returns the realpath'd absolute common-dir, or null when `cwd` isn't in a repo.
 */
export async function gitCommonDir(cwd: string): Promise<string | null> {
  if (!cwd || typeof cwd !== 'string' || !isAbsolute(cwd)) return null;
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const raw = String(stdout).trim();
        if (!raw) {
          resolve(null);
          return;
        }
        try {
          resolve(realpathSync(raw));
        } catch {
          resolve(raw);
        }
      }
    );
  });
}

/**
 * Enumerate the linked worktrees of the repository containing `cwd` via
 * `git worktree list --porcelain -z`. The first entry is always the main working
 * tree (flagged `isMain`). Used by the Explorer's worktree switcher so a user
 * can flip the file tree + git panel between a repo's checkouts. `.git`-as-a-file
 * (the worktree case) is handled transparently by git itself, so no special
 * casing is needed here.
 */
export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  if (!cwd || typeof cwd !== 'string' || !isAbsolute(cwd)) return [];
  const toplevel = findToplevel(cwd);
  if (!toplevel) return [];

  return new Promise((resolve) => {
    execFile(
      'git',
      ['worktree', 'list', '--porcelain', '-z'],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        resolve(parseWorktreePorcelain(String(stdout)));
      }
    );
  });
}

export function parseWorktreePorcelain(out: string): Worktree[] {
  const trees: Worktree[] = [];
  let cur: Worktree | null = null;
  const flush = () => {
    if (cur) trees.push(cur);
    cur = null;
  };
  // `-z` terminates every field with NUL and separates records with an extra
  // NUL, so paths containing newlines remain one intact field.
  for (const field of out.split('\0')) {
    if (field === '') {
      flush();
      continue;
    }
    if (field.startsWith('worktree ')) {
      flush();
      const path = field.slice('worktree '.length);
      let realPath = path;
      try {
        realPath = realpathSync(path);
      } catch {
        /* worktree dir gone — keep the raw path so the user can see it */
      }
      cur = {
        path: realPath,
        head: null,
        branch: null,
        detached: false,
        bare: false,
        isMain: trees.length === 0
      };
      continue;
    }
    if (!cur) continue;
    if (field.startsWith('HEAD ')) {
      cur.head = field.slice('HEAD '.length);
    } else if (field.startsWith('branch ')) {
      // "branch refs/heads/<name>"
      cur.branch = field.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (field === 'detached') {
      cur.detached = true;
    } else if (field === 'bare') {
      cur.bare = true;
    }
  }
  flush();
  return trees;
}

/**
 * Enumerate the local branches of the repository containing `cwd` via
 * `git for-each-ref refs/heads`. Used by the Explorer's switcher so a user can
 * see EVERY local branch — not just the ones that happen to have a worktree.
 * The renderer joins each branch against {@link listWorktrees} to badge which
 * checkout (if any) a branch is assigned to.
 *
 * `%(HEAD)` yields `*` for the branch checked out in `cwd`'s working tree.
 * Bounded (`GIT_BRANCH_MAX`), never throws — a non-repo or git error resolves
 * to `[]` so the switcher just omits the branch section.
 */
export const GIT_BRANCH_MAX = 500;

export async function listBranches(cwd: string): Promise<GitBranch[]> {
  if (!cwd || typeof cwd !== 'string' || !isAbsolute(cwd)) return [];
  const toplevel = findToplevel(cwd);
  if (!toplevel) return [];

  return new Promise((resolve) => {
    execFile(
      'git',
      [
        'for-each-ref',
        `--count=${GIT_BRANCH_MAX}`,
        '--sort=-committerdate',
        // "<HEAD marker>\t<short name>" — TAB can't appear in a ref name.
        '--format=%(HEAD)%09%(refname:short)',
        'refs/heads'
      ],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        resolve(parseBranchList(String(stdout)));
      }
    );
  });
}

function parseBranchList(out: string): GitBranch[] {
  const branches: GitBranch[] = [];
  for (const line of out.split('\n')) {
    if (line === '') continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const name = line.slice(tab + 1).trim();
    if (!name) continue;
    branches.push({ name, current: line.slice(0, tab) === '*' });
  }
  return branches;
}

/**
 * Sanitize an arbitrary label (usually the launch's prompt-derived title, or a
 * user-typed branch) into a git-legal, filesystem-safe branch/dir slug. Kept
 * conservative on purpose — this feeds BOTH a `git branch` ref name and a
 * directory name under the managed worktree root, so it must satisfy the
 * stricter of the two (`git check-ref-format` rules) and never contain a path
 * separator that could escape the managed root. Invalid runs become underscores
 * to keep renderer/main normalization identical. Returns null for empty output.
 *
 * Pure + exported for tests.
 */
export function sanitizeBranchSlug(label: string | undefined): string | null {
  if (!label || typeof label !== 'string') return null;
  const slug = label
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return slug.length > 0 ? slug : null;
}

const worktreeOperations = new Map<string, Promise<void>>();

export async function withWorktreeLock<T>(
  projectPath: string,
  branchName: string,
  operation: () => Promise<T>
): Promise<T> {
  const toplevel = findToplevel(projectPath);
  if (!toplevel) return operation();
  const key = `${toplevel}\0${branchName}`;
  const previous = worktreeOperations.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  worktreeOperations.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (worktreeOperations.get(key) === current) worktreeOperations.delete(key);
  }
}

/**
 * Whether `cwd` sits inside a (non-bare) git working tree. Used to gate the
 * worktree-isolation launch option — a non-repo project can't be isolated, so
 * the launcher/main degrade to the plain project root. Never throws.
 */
export async function isGitRepo(cwd: string): Promise<boolean> {
  if (!cwd || typeof cwd !== 'string' || !isAbsolute(cwd)) return false;
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-parse', '--is-inside-work-tree'],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (err, stdout) => resolve(!err && String(stdout).trim() === 'true')
    );
  });
}

/**
 * Create (or adopt) an isolated linked worktree of the repo containing
 * `projectPath`, checked out on its own branch, and return its realpath'd path.
 *
 * The checkout lands at `<targetDir>` — the CALLER owns the location (main
 * builds it under the app-managed `~/zcc-worktrees` root so it never pollutes
 * the user's tree and can be pruned as a unit). We `mkdir -p` the PARENT only;
 * `git worktree add` insists on creating the leaf itself.
 *
 * Branch handling, in order:
 *   - a fresh branch `branchName` off the repo's current HEAD (`add -b`), OR
 *   - if that branch already exists (a re-launch on the same feature), adopt the
 *     EXISTING checkout for it when one is registered (`reused: true`), otherwise
 *     check the existing branch out into the new dir (`add` without `-b`).
 *
 * Never throws — every git/fs failure resolves to `{ ok:false, reason }` so a
 * launch can fall back to the project root. Bounded by
 * {@link WORKTREE_ADD_TIMEOUT_MS} (Rule 5).
 */
/**
 * Whether a local branch ref `<name>` exists in the repo at `toplevel`. Uses
 * `git show-ref --verify --quiet refs/heads/<name>` (exit 0 = exists). Never
 * throws — resolves false on any error. Distinct from "checked out in a
 * worktree": a branch can exist as a ref with no working tree.
 */
async function branchRefExists(toplevel: string, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${name}`],
      { cwd: toplevel, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (err) => resolve(!err)
    );
  });
}

export async function createWorktree(
  projectPath: string,
  targetDir: string,
  branchName: string,
  managedRoot?: string
): Promise<WorktreeCreateResult> {
  if (!isAbsolute(projectPath) || !isAbsolute(targetDir)) {
    return { ok: false, reason: 'invalid path' };
  }
  const toplevel = findToplevel(projectPath);
  if (!toplevel) return { ok: false, reason: 'not a git repo' };
  if (await hasDeclaredSubmodules(toplevel)) {
    return {
      ok: false,
      reason: 'repositories with submodules are not supported for managed worktrees'
    };
  }

  return withWorktreeLock(projectPath, branchName, () =>
    createWorktreeUnlocked(toplevel, targetDir, branchName, managedRoot)
  );
}

async function hasDeclaredSubmodules(toplevel: string): Promise<boolean> {
  if (!existsSync(join(toplevel, '.gitmodules'))) return false;
  return new Promise((resolve) => {
    execFile(
      'git',
      ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\..*\.path$'],
      { cwd: toplevel, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (err, stdout) => resolve(!err && String(stdout).trim().length > 0)
    );
  });
}

function isWithinPath(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function createWorktreeUnlocked(
  toplevel: string,
  targetDir: string,
  branchName: string,
  managedRoot?: string
): Promise<WorktreeCreateResult> {
  // Re-launch on an existing branch: if that branch is already checked out in a
  // registered worktree, adopt it rather than failing (git refuses to check one
  // branch out into two worktrees). This makes "isolate on branch X" idempotent.
  const existing = await listWorktrees(toplevel);
  const already = existing.find((w) => !w.isMain && w.branch === branchName);
  if (already) {
    let expected = targetDir;
    try {
      expected = realpathSync(targetDir);
    } catch {
      /* expected managed leaf may not exist yet */
    }
    if (already.path !== expected) {
      return { ok: false, reason: 'branch is checked out outside its managed destination' };
    }
    return { ok: true, path: already.path, branch: branchName, reused: true };
  }

  // Parent must exist; the leaf must NOT (git creates it).
  try {
    mkdirSync(dirname(targetDir), { recursive: true });
    if (managedRoot) {
      mkdirSync(managedRoot, { recursive: true, mode: 0o700 });
      if (lstatSync(managedRoot).isSymbolicLink()) {
        return { ok: false, reason: 'managed worktree root cannot be a symlink' };
      }
      const realRoot = realpathSync(managedRoot);
      const realParent = realpathSync(dirname(targetDir));
      if (!isWithinPath(realParent, realRoot)) {
        return { ok: false, reason: 'managed worktree destination escaped its root' };
      }
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  // Does a branch ref by this name already exist? `listWorktrees` only reports
  // branches that ARE checked out somewhere, so a plain (un-checked-out) branch
  // ref wouldn't show there — check the ref directly, or `add -b` would fail
  // with "a branch named X already exists".
  const branchExists = await branchRefExists(toplevel, branchName);
  // `-b` mints a new branch; without it we check out the existing one.
  const args = branchExists
    ? ['worktree', 'add', targetDir, branchName]
    : ['worktree', 'add', '-b', branchName, targetDir];

  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: toplevel, timeout: WORKTREE_ADD_TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            reason: String(stderr || (err as Error).message).trim() || 'git worktree add failed'
          });
          return;
        }
        let real = targetDir;
        try {
          real = realpathSync(targetDir);
        } catch {
          /* leaf should exist now; keep raw path if realpath somehow fails */
        }
        if (managedRoot) {
          try {
            if (!isWithinPath(real, realpathSync(managedRoot))) {
              resolve({ ok: false, reason: 'created worktree escaped its managed root' });
              return;
            }
          } catch (cause) {
            resolve({ ok: false, reason: cause instanceof Error ? cause.message : String(cause) });
            return;
          }
        }
        resolve({ ok: true, path: real, branch: branchName, reused: false });
      }
    );
  });
}

/**
 * Remove a linked worktree (and its administrative entry) from the repo
 * containing `projectPath`. `force` passes `--force`, which lets git drop a
 * worktree with uncommitted/untracked changes — the caller decides whether that
 * is appropriate (a clean checkout prunes without it; a dirty one needs it).
 * Never throws.
 */
export async function removeWorktree(
  projectPath: string,
  worktreePath: string,
  force = false
): Promise<{ ok: boolean; message?: string }> {
  if (!isAbsolute(projectPath) || !isAbsolute(worktreePath)) {
    return { ok: false, message: 'invalid path' };
  }
  const toplevel = findToplevel(projectPath);
  if (!toplevel) return { ok: false, message: 'not a git repo' };
  const args = ['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath];
  return runGit(toplevel, args);
}

/**
 * Assess whether an isolated worktree is safe to prune on session close.
 *
 * A worktree launched for a now-finished agent is discardable ONLY when it left
 * no work behind: a clean working tree (no staged/unstaged/untracked changes)
 * AND no commits unique to its branch (nothing ahead of the base it forked
 * from). Anything else means the agent produced work the user hasn't merged, so
 * we KEEP the checkout and surface it rather than silently deleting it.
 *
 *   - `dirty`   — uncommitted or untracked changes are present.
 *   - `commits` — number of commits on this branch not reachable from its
 *                 upstream/base (best-effort; 0 when it can't be determined).
 *   - `prunable`— `!dirty && commits === 0` — safe to remove without `--force`.
 *
 * Never throws; an unreadable/absent worktree resolves to a conservative
 * "keep it" verdict (`prunable: false`) so we never delete on a bad read.
 */
export async function worktreeState(
  worktreePath: string
): Promise<{ dirty: boolean; commits: number; prunable: boolean }> {
  const keep = { dirty: true, commits: 0, prunable: false };
  if (!worktreePath || typeof worktreePath !== 'string' || !isAbsolute(worktreePath)) {
    return keep;
  }
  const status = await getGitStatus(worktreePath);
  if (!status) return keep;
  const dirty = status.dirty;
  // A fresh `git worktree add -b` branch has no upstream, so `status.ahead` is 0
  // even when it carries new commits — count commits unique to THIS branch (not
  // reachable from any other local/remote ref) instead. `status.branch` is the
  // ref to exclude from the "everything else" set; a detached HEAD (null) can't
  // be reasoned about, so treat it conservatively as carrying unique work.
  const commits =
    status.branch == null ? 1 : await countUniqueCommits(worktreePath, status.branch);
  return { dirty, commits, prunable: !dirty && commits === 0 };
}

/**
 * Count commits reachable from the worktree's branch but NOT from any OTHER
 * local branch or remote ref — i.e. work that lives only here. `git rev-list
 * --branches --remotes` would include the branch's own ref (making the count
 * always 0), so we `--exclude` the current branch before the globs. The
 * `--branches` glob matches against the ref name WITHOUT its `refs/heads/`
 * prefix, so the exclude pattern is the bare branch name (not the full ref).
 * Best-effort: any failure resolves to 0 (treat as no unique work); the dirty
 * check in {@link worktreeState} is the primary guard. Never throws.
 */
async function countUniqueCommits(worktreePath: string, branch: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['rev-list', '--count', 'HEAD', '--not', `--exclude=${branch}`, '--branches', '--remotes'],
      { cwd: worktreePath, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(0);
          return;
        }
        const n = parseInt(String(stdout).trim(), 10);
        resolve(Number.isFinite(n) && n > 0 ? n : 0);
      }
    );
  });
}

/**
 * Read the git status of the repo containing `cwd`.
 *
 * `scope`, when supplied, is a set of ABSOLUTE paths the caller cares about
 * (the agent's transcript write-set). It is passed to git as a pathspec list,
 * which changes the read in three load-bearing ways:
 *
 *  1. **Untracked files are enumerated individually.** git's default untracked
 *     handling (`-unormal`) COLLAPSES a directory of new files into a single
 *     `?? dir/` entry — a directory path that never string-matches the
 *     individual file paths in the write-set, so the renderer's intersection
 *     silently drops every file the agent CREATED (the modal then reads
 *     "hasn't changed any files" while the transcript-only sidebar is full).
 *     Naming the files as pathspecs forces git to report each one (proven
 *     cheaper than `-uall`, which walks the whole tree and times out on a big
 *     monorepo).
 *  2. **The walk is scoped, so it's fast** — an unscoped status on a 5k-entry
 *     monorepo runs multiple seconds and blows {@link TIMEOUT_MS}; the scoped
 *     walk stays well under {@link STATUS_SCOPED_TIMEOUT_MS}.
 *  3. It still respects `.gitignore` and worst-of-XY exactly as before.
 *
 * Two guards on the scope (both verified against real git behavior):
 *  - **Confine to the repo first.** A pathspec that lies OUTSIDE the repo makes
 *     git `fatal:` and abort the ENTIRE status (returning null → blank panel).
 *     A write-set legitimately contains out-of-repo paths (an agent that also
 *     wrote to `~/.claude/.../memory/`), so we drop any path not under
 *     `toplevel` before passing it. This doubles as Rule 1/2 confinement of the
 *     renderer-supplied paths.
 *  - **`--literal-pathspecs`** so a `:(magic)`-looking path can't be
 *     reinterpreted as a pathspec directive.
 *
 * `scope === undefined`/`null` (a shell session, or too many paths to bound the
 * argv) falls back to the historical full-tree read.
 */
export async function getGitStatus(
  cwd: string,
  scope?: readonly string[] | null
): Promise<GitStatus | null> {
  if (!cwd || typeof cwd !== 'string' || !isAbsolute(cwd)) return null;
  const toplevel = findToplevel(cwd);
  if (!toplevel) return null;

  // Confine the scope to the repo (see doc comment): out-of-repo pathspecs
  // fatal-abort git, and this is where we re-authorize the renderer-supplied
  // paths (Rule 1/2). A path equal to `toplevel` itself is the whole repo, so
  // keep it; anything not prefixed by `toplevel/` is dropped.
  const confined =
    scope && scope.length
      ? scope.filter(
          (p) =>
            typeof p === 'string' &&
            isAbsolute(p) &&
            (p === toplevel || p.startsWith(`${toplevel}/`))
        )
      : [];
  // A non-empty scope whose paths are ALL outside this repo means the agent
  // touched nothing here — return the branch but no files rather than falling
  // back to the whole (possibly dirty) tree, which would mislead.
  if (scope && scope.length && confined.length === 0) {
    const bare = await getGitStatus(cwd);
    return bare ? { ...bare, files: {}, dirty: false } : null;
  }
  const useScope = confined.length > 0 && confined.length <= STATUS_MAX_PATHSPECS;

  // `git status` has no `--pathspec-from-file`, so pathspecs go on argv after
  // `--`. The confined list is capped at STATUS_MAX_PATHSPECS, which bounds the
  // argv length (Rule 5). `--literal-pathspecs` stops a `:(magic)`-looking path
  // from being reinterpreted as a pathspec directive.
  const args = useScope
    ? ['--literal-pathspecs', 'status', '--porcelain=v2', '--branch', '-z', '--', ...confined]
    : ['status', '--porcelain=v2', '--branch', '-z'];
  const timeout = useScope ? STATUS_SCOPED_TIMEOUT_MS : TIMEOUT_MS;

  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const status = parsePorcelainV2(stdout, toplevel);
        resolve(status);
      }
    );
  });
}

// Cap the HEAD blob we'll ship to the renderer so a giant tracked binary or
// minified bundle doesn't blow up the diff view.
const SHOW_MAX_BYTES = 2 * 1024 * 1024;

export async function showHead(absPath: string): Promise<GitShowResult> {
  if (!absPath || typeof absPath !== 'string' || !isAbsolute(absPath)) {
    return { ok: false, message: 'Invalid path' };
  }
  const toplevel = findToplevel(absPath);
  if (!toplevel) return { ok: false, message: 'Not in a git repo' };
  const rel = relative(toplevel, absPath).split('\\').join('/');
  if (!rel || rel.startsWith('..')) {
    return { ok: false, message: 'Path is outside the repo' };
  }

  return new Promise((resolve) => {
    execFile(
      'git',
      ['show', `HEAD:${rel}`],
      {
        cwd: toplevel,
        timeout: TIMEOUT_MS,
        maxBuffer: SHOW_MAX_BYTES,
        encoding: 'buffer'
      },
      (err, stdout, stderr) => {
        if (err) {
          // git exits non-zero when the path doesn't exist at HEAD (e.g. newly
          // added file). Fall through and surface that as `notInHead` so the
          // renderer can show "added" instead of an opaque error.
          const msg = String(stderr || (err as Error).message);
          if (/exists on disk, but not in 'HEAD'|does not exist|bad revision/i.test(msg)) {
            resolve({ ok: true, notInHead: true });
            return;
          }
          resolve({ ok: false, message: msg.trim() || 'git show failed' });
          return;
        }
        const buf = stdout as unknown as Buffer;
        const probe = buf.subarray(0, Math.min(8192, buf.length));
        if (probe.includes(0)) {
          resolve({ ok: true, binary: true });
          return;
        }
        resolve({ ok: true, content: buf.toString('utf8') });
      }
    );
  });
}

function runGit(toplevel: string, args: string[]): Promise<{ ok: boolean; message?: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: toplevel, timeout: TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          const msg = String(stderr || (err as Error).message).trim();
          resolve({ ok: false, message: msg || 'git command failed' });
          return;
        }
        resolve({ ok: true });
      }
    );
  });
}

function runGitMutation(cwd: string, args: string[]): Promise<GitWorkflowResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: GIT_MUTATION_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const output = String(stderr || stdout || '').trim();
        if (err) {
          resolve({ ok: false, message: output || 'git command failed' });
          return;
        }
        resolve({ ok: true, message: output });
      }
    );
  });
}

/**
 * Commit the complete working-tree state for an already authorized repository
 * root. The caller must derive `cwd` from main-owned project state. `execFile`
 * keeps the user-authored message data-only; it is never interpreted by a shell.
 */
export async function commitProjectChanges(cwd: string, message: string, preview: GitCommitPreview): Promise<GitWorkflowResult> {
  const normalized = typeof message === 'string' ? message.trim() : '';
  if (!normalized) return { ok: false, message: 'Enter a commit message.' };
  if (normalized.length > GIT_COMMIT_MESSAGE_MAX) {
    return { ok: false, message: `Commit message must be ${GIT_COMMIT_MESSAGE_MAX} characters or fewer.` };
  }
  if (normalized.includes('\0') || normalized.includes('\r')) {
    return { ok: false, message: 'Commit message contains unsupported characters.' };
  }
  const status = await getGitStatus(cwd);
  if (!status) return { ok: false, message: 'Project is not a Git repository.' };
  if (status.toplevel !== cwd) return { ok: false, message: 'Project root must match the repository root.' };
  if (!status.dirty) return { ok: false, message: 'There are no changes to commit.' };
  const revision = await commitRevision(cwd);
  if (!revision || revision !== preview.revision) {
    return { ok: false, message: 'Project changes changed after confirmation. Review the fresh preview and confirm again.' };
  }
  const paths = preview.writeSet.map((item) => relative(cwd, item.path).split('\\').join('/'));
  if (paths.length === 0 || paths.some((path) => !path || path === '..' || path.startsWith('../') || isAbsolute(path))) {
    return { ok: false, message: 'The confirmed write-set is invalid. Review the fresh preview and confirm again.' };
  }
  const add = await runGitMutation(cwd, ['add', '--all', '--', ...paths]);
  if (!add.ok) return add;
  const commit = await runGitMutation(cwd, ['commit', '-m', normalized]);
  if (!commit.ok) return commit;
  return { ok: true, message: commit.message || 'Changes committed.', branch: status.branch ?? undefined };
}

/** Push only a branch with a configured upstream; never guesses a remote/ref. */
export async function pushProjectBranch(cwd: string): Promise<GitWorkflowResult> {
  const status = await getGitStatus(cwd);
  if (!status) return { ok: false, message: 'Project is not a Git repository.' };
  if (status.toplevel !== cwd) return { ok: false, message: 'Project root must match the repository root.' };
  if (!status.branch || status.detached) return { ok: false, message: 'Cannot push a detached HEAD.' };
  const upstream = await runGitMutation(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (!upstream.ok) {
    return { ok: false, message: `Branch ${status.branch} has no upstream. Configure one before pushing.`, branch: status.branch };
  }
  const pushed = await runGitMutation(cwd, ['push']);
  return { ...pushed, message: pushed.ok ? (pushed.message || `Pushed ${status.branch}.`) : pushed.message, branch: status.branch };
}

// Discard local changes to a single file. Behaviour depends on the file's
// current git state — untracked files are unlinked, staged-add files are
// unstaged + unlinked, and tracked changes (modified/deleted/renamed) are
// restored from HEAD.
export async function discardChanges(absPath: string): Promise<GitDiscardResult> {
  if (!absPath || typeof absPath !== 'string' || !isAbsolute(absPath)) {
    return { ok: false, message: 'Invalid path' };
  }
  const toplevel = findToplevel(absPath);
  if (!toplevel) return { ok: false, message: 'Not in a git repo' };
  const rel = relative(toplevel, absPath).split('\\').join('/');
  if (!rel || rel.startsWith('..')) {
    return { ok: false, message: 'Path is outside the repo' };
  }

  // Probe per-file status so we know which dance to do.
  const statusResult = await new Promise<{ xy: string | null; err?: string }>((resolve) => {
    execFile(
      'git',
      ['status', '--porcelain=v2', '-z', '--', rel],
      { cwd: toplevel, timeout: TIMEOUT_MS, maxBuffer: 1 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ xy: null, err: String(stderr || (err as Error).message).trim() });
          return;
        }
        // First entry is enough — we asked for one path. Parse the leading
        // record's xy if it's a "1" or "2" line; "?" => untracked.
        const out = String(stdout);
        const first = out.split('\0').find((p) => p.length > 0);
        if (!first) {
          resolve({ xy: null });
          return;
        }
        if (first.startsWith('? ')) {
          resolve({ xy: '??' });
          return;
        }
        if (first.startsWith('1 ') || first.startsWith('2 ')) {
          resolve({ xy: first.slice(2, 4) });
          return;
        }
        resolve({ xy: null });
      }
    );
  });

  if (statusResult.err) return { ok: false, message: statusResult.err };
  const xy = statusResult.xy;
  if (!xy) return { ok: false, message: 'No changes to discard' };

  // Untracked → just delete the working-tree file.
  if (xy === '??') {
    try {
      unlinkSync(absPath);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  // Staged-add (A in X column) → unstage, then unlink. `git checkout HEAD --`
  // won't work because the file doesn't exist at HEAD.
  if (xy[0] === 'A') {
    const reset = await runGit(toplevel, ['reset', 'HEAD', '--', rel]);
    if (!reset.ok) return reset;
    try {
      if (existsSync(absPath)) unlinkSync(absPath);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  // Everything else (M, D, R, T in either column) → restore from HEAD. This
  // also unstages any staged changes for the file in one shot.
  return runGit(toplevel, ['checkout', 'HEAD', '--', rel]);
}

function parsePorcelainV2(out: string, toplevel: string): GitStatus {
  let branch: string | null = null;
  let detached = false;
  let ahead = 0;
  let behind = 0;
  let dirty = false;
  const files: Record<string, GitFileCode> = {};

  // Worst-of-XY: when staged and unstaged statuses differ, surface the more
  // important one. Order: M < A < R < D so deletes/renames win over edits,
  // additions win over modifications.
  const rank: Record<string, number> = { M: 1, A: 2, R: 3, D: 4 };
  const recordFile = (abs: string, code: GitFileCode) => {
    const prev = files[abs];
    if (!prev) {
      files[abs] = code;
      return;
    }
    if ((rank[code] ?? 0) > (rank[prev] ?? 0)) files[abs] = code;
  };

  const xyToCode = (xy: string): GitFileCode | null => {
    // xy is two chars: staged + unstaged. '.' means unchanged.
    const X = xy[0];
    const Y = xy[1];
    const pick = (c: string): GitFileCode | null => {
      if (c === 'M' || c === 'T') return 'M';
      if (c === 'A') return 'A';
      if (c === 'D') return 'D';
      if (c === 'R' || c === 'C') return 'R';
      return null;
    };
    return pick(Y) ?? pick(X);
  };

  // -z separates entries with NUL. Header lines start with '#' and are line-based
  // (newline-terminated within their own segment); entry records start with
  // '1', '2', '?', or 'u'. Rename entries (type '2') contain an additional NUL.
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith('# branch.head ')) {
      const name = p.slice('# branch.head '.length).trim();
      if (name === '(detached)') {
        detached = true;
        branch = null;
      } else {
        branch = name;
      }
      continue;
    }
    if (p.startsWith('# branch.oid ')) {
      // ignore; only useful when detached, and we don't surface SHA yet
      continue;
    }
    if (p.startsWith('# branch.ab ')) {
      const m = p.match(/# branch\.ab \+(\d+) -(\d+)/);
      if (m) {
        ahead = parseInt(m[1], 10) || 0;
        behind = parseInt(m[2], 10) || 0;
      }
      continue;
    }
    if (p.startsWith('#')) continue;

    const c = p.charCodeAt(0);
    if (c === 49 /* '1' */) {
      // "1 XY <sub> <mH> <mI> <mW> <hH> <hI> <path>"
      dirty = true;
      const xy = p.slice(2, 4);
      const code = xyToCode(xy);
      const path = p.split(' ').slice(8).join(' ');
      if (code && path) recordFile(join(toplevel, path), code);
      continue;
    }
    if (c === 50 /* '2' */) {
      // "2 XY <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>"
      // followed by a NUL then "<orig-path>".
      dirty = true;
      const xy = p.slice(2, 4);
      const code = xyToCode(xy);
      const path = p.split(' ').slice(9).join(' ');
      if (code && path) recordFile(join(toplevel, path), code);
      i++; // consume original-path field
      continue;
    }
    if (c === 63 /* '?' */) {
      // "? <path>"
      dirty = true;
      const path = p.slice(2);
      if (path) recordFile(join(toplevel, path), '?');
      continue;
    }
    if (c === 117 /* 'u' */) {
      // "u XY <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
      dirty = true;
      const path = p.split(' ').slice(10).join(' ');
      if (path) recordFile(join(toplevel, path), 'C');
      continue;
    }
  }

  return { branch, detached, ahead, behind, dirty, toplevel, files };
}
