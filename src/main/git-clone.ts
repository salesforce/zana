import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

/**
 * Import-from-Git: parse a repo URL, `git clone` it into the clone root, and
 * hand the resulting local path back to the caller (which registers it as a
 * project via the normal `store.addProject` path). Pure scripting — no LLM —
 * so the mechanical "URL → working folder" step is deterministic and testable.
 *
 * Auth is intentionally NOT handled here: we lean on the user's existing git
 * setup (ssh keys, credential helper, `gh auth`). A private repo clones iff
 * their git can already clone it; auth failures surface as plain errors.
 */

/** Generous ceiling — a big repo over a slow link can take a while, but we
 *  don't want a hung clone to wedge forever. */
const CLONE_TIMEOUT_MS = 10 * 60 * 1000;

export interface NormalizedRepo {
  /** The URL/spec we hand to `git clone` verbatim. */
  cloneUrl: string;
  /** Derived folder/project name, e.g. `omnigent`. Always a safe single segment. */
  repoName: string;
}

// Control chars (0x00-0x1f) + DEL (0x7f); rejected/stripped everywhere a value
// flows into a path or argv. Built via RegExp(string) with unicode escapes so
// the source file holds no literal control bytes.
const CONTROL_CLASS = '[\\u0000-\\u001f\\u007f]';
const CONTROL_CHARS = new RegExp(CONTROL_CLASS);
const CONTROL_CHARS_G = new RegExp(CONTROL_CLASS, 'g');
const activeCloneDestinations = new Set<string>();

/**
 * Strip a derived repo name down to a safe single path segment: no separators,
 * no leading dot/dash, no control chars. Guards against a crafted URL smuggling
 * `../` or an argv-flag-shaped name into the destination path.
 */
function safeSegment(raw: string): string {
  return raw
    .replace(CONTROL_CHARS_G, '')
    .replace(/[/\\]/g, '') // path separators
    .replace(/^[.\-]+/, '') // leading dot/dash
    .trim();
}

/**
 * Validate a git ref (branch, tag, or full/short SHA) before it flows into a
 * `git checkout`/`--branch` argv. THIS IS LOAD-BEARING: unlike `git clone`, a
 * `git checkout <ref>` cannot use `--` to terminate options without turning the
 * ref into a *pathspec* (`checkout -- <ref>` checks out a file named <ref> and
 * silently ignores the intended rev), so `safeRef` is the SOLE Rule-1 guard on
 * the checkout path. Rejects: empty, leading `-` (argv-flag injection),
 * whitespace / control chars, over-length, and git revision metacharacters that
 * would let a crafted ref address something other than a plain named rev
 * (`..` range, `~`/`^` ancestry, `@{` reflog, `:` rev:path, glob `? * [`, and
 * `\`). Returns the ref unchanged on success; throws otherwise.
 */
export function safeRef(raw: string): string {
  const ref = (raw ?? '').trim();
  if (!ref) throw new Error('Empty git ref');
  if (ref.length > 256) throw new Error('git ref too long');
  if (ref.startsWith('-')) throw new Error('Invalid git ref');
  if (/\s/.test(ref) || CONTROL_CHARS.test(ref)) throw new Error('Invalid git ref');
  // Revision metacharacters — see doc comment. `..` covers both range `a..b`
  // and the parent-traversal `..`; the rest are single chars.
  if (/\.\.|[~^:?*[\\]|@\{/.test(ref)) throw new Error('Invalid git ref');
  return ref;
}

/**
 * Normalize the common ways a user pastes a repo reference into a `git clone`
 * spec + a derived folder name. Accepts:
 *   - https://github.com/owner/repo[.git][/]
 *   - http(s) on any host (gitlab, bitbucket, a self-hosted GHE instance, …)
 *   - git@host:owner/repo.git   (scp-style ssh)
 *   - ssh://git@host/owner/repo.git
 *   - owner/repo                (shorthand → defaults to GitHub https)
 * Throws on anything we can't confidently turn into a clone spec.
 */
export function normalizeRepoUrl(input: string): NormalizedRepo {
  const raw = (input ?? '').trim();
  if (!raw) throw new Error('Enter a repository URL');
  if (raw.length > 2048) throw new Error('URL too long');
  // An argv-flag-shaped spec would be read as an option by `git clone`.
  if (raw.startsWith('-')) throw new Error('Invalid repository URL');
  // A clone spec never contains whitespace or control chars.
  if (/\s/.test(raw) || CONTROL_CHARS.test(raw)) throw new Error('Invalid repository URL');

  const lastSegment = (s: string): string => {
    const tail = s.split('/').filter(Boolean).pop() ?? '';
    return tail.replace(/\.git$/i, '');
  };

  // scp-style ssh: git@github.com:owner/repo.git
  const scp = raw.match(/^[^@\s]+@[^:\s]+:(.+)$/);
  if (scp) {
    const name = safeSegment(lastSegment(scp[1]));
    if (!name) throw new Error('Could not derive a repo name from that URL');
    return { cloneUrl: raw, repoName: name };
  }

  // Explicit scheme (https / http / ssh / git).
  if (/^(https?|ssh|git):\/\//i.test(raw)) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error('Invalid repository URL');
    }
    const scheme = parsed.protocol.replace(':', '').toLowerCase();
    if (!['https', 'http', 'ssh', 'git'].includes(scheme)) {
      throw new Error(`Unsupported URL scheme: ${scheme}`);
    }
    const name = safeSegment(lastSegment(parsed.pathname));
    if (!name) throw new Error('Could not derive a repo name from that URL');
    return { cloneUrl: raw, repoName: name };
  }

  // Shorthand owner/repo → GitHub https. Exactly two non-empty segments, no host.
  const short = raw.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (short && !raw.includes('//')) {
    const name = safeSegment(short[2]);
    if (!name) throw new Error('Could not derive a repo name from that URL');
    return { cloneUrl: `https://github.com/${short[1]}/${name}.git`, repoName: name };
  }

  throw new Error('Unrecognized repository URL');
}

export interface CloneResult {
  ok: boolean;
  /** Absolute path of the cloned working tree, on success. */
  path?: string;
  /** Folder name actually used. */
  repoName?: string;
  /** True when we didn't clone — the same repo already sat at `dest`, so we
   *  reused the existing working tree and the caller just needs to register
   *  it as a project. */
  reused?: boolean;
  code?: 'DEST_EXISTS' | 'CLONE_FAILED' | 'BAD_INPUT';
  message?: string;
  /** The URL actually handed to `git clone` (post-normalization). Used by
   *  callers to record credential-stripped provenance. */
  cloneUrl?: string;
  /** The commit SHA the working tree is checked out at, when a `ref` was
   *  requested (via `rev-parse HEAD` after checkout). */
  resolvedSha?: string;
}

export interface CloneOptions {
  url: string;
  /** Override the derived folder name. Sanitized to a single safe segment. */
  name?: string;
  /** Base directory to clone into. Must be absolute. */
  destBase: string;
  /** Optional branch, tag, or commit SHA to check out. Validated by `safeRef`.
   *  A branch/tag is pinned via shallow `--branch`; a raw SHA (which shallow
   *  can't select) falls back to a full clone + detached checkout. */
  ref?: string;
  /** Clone with `--depth 1` (single-commit history). Opt-in so the shared
   *  project-clone path keeps full history; the extension-install path sets it.
   *  Ignored when `ref` is a raw SHA (forces the full-clone fallback). */
  shallow?: boolean;
  /** Live progress lines from `git clone --progress` (stderr). */
  onProgress?: (line: string) => void;
}

/** Run a git subcommand in `dir`, resolving stdout (trimmed) or '' on error. */
function gitCapture(dir: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, ...args],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || '').trim() });
      }
    );
  });
}

/** True when `dir` exists and contains at least one entry (or a file sits in
 *  the way). */
function isNonEmptyDir(dir: string): boolean {
  try {
    if (!statSync(dir).isDirectory()) return true; // a file in the way also blocks
    return readdirSync(dir).length > 0;
  } catch {
    return false; // doesn't exist
  }
}

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Normalize a git remote/clone URL for comparison: lowercase host, drop a
 * trailing `.git`, strip credentials and a trailing slash, and fold scp-style
 * `git@host:owner/repo` into `host/owner/repo`. Lets us tell "the folder that's
 * already here is this very repo" apart from "a different repo by the same name"
 * without caring about https-vs-ssh or `.git` suffix cosmetics.
 */
export function canonicalRemote(url: string): string {
  let s = (url ?? '').trim();
  if (!s) return '';
  // scp-style → pseudo-path so the rest of the normalization applies uniformly.
  const scp = s.match(/^[^@\s]+@([^:\s]+):(.+)$/);
  if (scp) s = `${scp[1]}/${scp[2]}`;
  s = s
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') // scheme://
    .replace(/^[^@/]+@/, '') // user[:pass]@
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return s;
}

/**
 * Read the `origin` remote of the git work tree at `dir`. Returns '' if `dir`
 * isn't a git repo, has no origin, or git isn't reachable.
 */
function readOriginRemote(dir: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, 'remote', 'get-url', 'origin'],
      { timeout: 10_000 },
      (err, stdout) => resolve(err ? '' : String(stdout).trim())
    );
  });
}

/**
 * Clone `url` into `destBase/<name>`. Returns the local path on success. On
 * failure, removes a partial clone we created so a retry starts clean. Never
 * clobbers a pre-existing non-empty directory: if that folder is already the
 * same repo (origin matches `url`) we skip the clone and return it with
 * `reused: true` so the caller just registers it; otherwise we return
 * DEST_EXISTS so the caller can offer "open the existing folder" rather than
 * destroying it.
 */
export async function cloneProject(opts: CloneOptions): Promise<CloneResult> {
  let repo: NormalizedRepo;
  try {
    repo = normalizeRepoUrl(opts.url);
  } catch (err) {
    return {
      ok: false,
      code: 'BAD_INPUT',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  const destBase = opts.destBase;
  if (!destBase || !isAbsolute(destBase)) {
    return { ok: false, code: 'BAD_INPUT', message: 'Clone destination must be an absolute path' };
  }

  const overrideName = opts.name ? safeSegment(opts.name) : '';
  const folderName = overrideName || repo.repoName;
  if (!folderName) {
    return { ok: false, code: 'BAD_INPUT', message: 'Invalid project name' };
  }

  // Validate the ref up-front (before any argv is built) — it flows into
  // `--branch`/`checkout`, and checkout can't use `--` to fence it (see safeRef).
  let ref: string | undefined;
  if (opts.ref != null && opts.ref !== '') {
    try {
      ref = safeRef(opts.ref);
    } catch (err) {
      return { ok: false, code: 'BAD_INPUT', message: err instanceof Error ? err.message : String(err) };
    }
  }

  // Canonicalize the configured root before examining an existing destination.
  // This prevents an intermediate symlink from moving host-owned Git operations
  // somewhere other than the configured clone root.
  let cloneRoot: string;
  try {
    mkdirSync(destBase, { recursive: true });
    cloneRoot = realpathSync(destBase);
  } catch (err) {
    return {
      ok: false,
      code: 'CLONE_FAILED',
      message: `Couldn't create clone directory: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  const dest = join(cloneRoot, folderName);
  if (!isWithin(dest, cloneRoot)) {
    return { ok: false, code: 'BAD_INPUT', message: 'Clone destination escapes the clone root' };
  }
  // A one-process destination lock stops two agents from racing through the
  // destination check and one failed clone cleaning up the other's worktree.
  if (activeCloneDestinations.has(dest)) {
    return { ok: false, code: 'CLONE_FAILED', message: `A clone is already in progress at ${dest}` };
  }
  activeCloneDestinations.add(dest);
  try {
    // A pre-existing destination must never redirect a host-owned clone outside
    // the configured root. Git follows symlinks, so reject the leaf outright.
    try {
      if (lstatSync(dest).isSymbolicLink()) {
        return { ok: false, code: 'BAD_INPUT', message: 'Clone destination cannot be a symbolic link' };
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return {
          ok: false,
          code: 'BAD_INPUT',
          message: `Couldn't inspect clone destination: ${err instanceof Error ? err.message : String(err)}`
        };
      }
    }
    if (isNonEmptyDir(dest)) {
      // A folder is already sitting where we'd clone. If it's the *same* repo
      // (its origin matches the URL we were asked to clone), there's nothing to
      // clone — just reuse it and let the caller register the project. Only a
      // folder whose origin differs (or isn't a git repo at all) is a real
      // collision worth refusing, so we don't clobber unrelated work.
      const origin = await readOriginRemote(dest);
      if (origin && canonicalRemote(origin) === canonicalRemote(repo.cloneUrl)) {
        return { ok: true, path: dest, repoName: folderName, reused: true, cloneUrl: repo.cloneUrl };
      }
      return {
        ok: false,
        code: 'DEST_EXISTS',
        path: dest,
        repoName: folderName,
        message: `A folder already exists at ${dest}`
      };
    }

    // A single `git clone` attempt. `--` terminates option parsing so a hostile
    // spec can't inject flags, even though normalizeRepoUrl already rejects
    // leading-dash inputs. Progress (git writes it to stderr) is streamed to the
    // caller line-by-line.
    const runClone = (extraArgs: string[]): Promise<CloneResult> =>
      new Promise<CloneResult>((resolve) => {
        const child = execFile(
          'git',
          ['clone', '--progress', ...extraArgs, '--', repo.cloneUrl, dest],
          { timeout: CLONE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
          (err, _stdout, stderr) => {
            if (err) {
              const msg = String(stderr || (err as Error).message)
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .pop();
              resolve({ ok: false, code: 'CLONE_FAILED', message: msg || 'git clone failed' });
              return;
            }
            resolve({ ok: true, path: dest, repoName: folderName, cloneUrl: repo.cloneUrl });
          }
        );
        if (opts.onProgress && child.stderr) {
          let buf = '';
          child.stderr.on('data', (chunk: Buffer) => {
            buf += chunk.toString('utf8');
            // git uses \r to redraw the same progress line; split on both.
            const lines = buf.split(/[\r\n]/);
            buf = lines.pop() ?? '';
            for (const line of lines) {
              const t = line.trim();
              if (t) opts.onProgress?.(t);
            }
          });
        }
      });

    // Remove a partial clone (only inside our own clone root) so a retry / fallback
    // starts from a clean slate.
    const cleanupPartial = (): void => {
      if (existsSync(dest) && isWithin(dest, cloneRoot)) {
        try {
          rmSync(dest, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    };

    let result: CloneResult;
    if (ref && opts.shallow) {
      // Shallow can only fetch a *named* ref (branch/tag), not an arbitrary SHA.
      // Try the fast path; if `--branch <ref>` fails (ref is a SHA, or the shallow
      // fetch is rejected), fall back to a full clone + detached checkout below.
      result = await runClone(['--depth', '1', '--branch', ref]);
      if (!result.ok) {
        cleanupPartial();
        result = await runClone([]); // full clone, then checkout the ref
      }
    } else if (opts.shallow && !ref) {
      result = await runClone(['--depth', '1']);
    } else {
      // Full clone: no ref (default branch) or a ref that needs an arbitrary rev.
      result = await runClone([]);
    }

    if (!result.ok) {
      cleanupPartial();
      return result;
    }

    // Post-clone checkout for a requested ref. When we took the shallow
    // `--branch` fast path the tree is already at `ref`, but a detached checkout
    // is idempotent and also resolves the SHA, so we run it uniformly whenever a
    // ref was requested. NO `--`: that would treat `ref` as a pathspec (see
    // safeRef) — `ref` is already validated.
    if (ref) {
      const co = await gitCapture(dest, ['-c', 'advice.detachedHead=false', 'checkout', '--detach', ref]);
      if (!co.ok) {
        cleanupPartial();
        return { ok: false, code: 'CLONE_FAILED', message: co.err || `could not check out ${ref}` };
      }
      const head = await gitCapture(dest, ['rev-parse', 'HEAD']);
      if (head.ok && head.out) result.resolvedSha = head.out;
    }

    return result;
  } finally {
    activeCloneDestinations.delete(dest);
  }
}
