import {
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  type Dirent
} from 'node:fs';
import { execFile } from 'node:child_process';
import { opendir, realpath, stat as asyncStat, lstat as asyncLstat, open } from 'node:fs/promises';
import { join, relative, extname, resolve, dirname, sep, isAbsolute } from 'node:path';
import type { FsEntry, FsReadResult, FsWriteResult, FsMutateResult, FsReadDataUrlResult, SearchHit, SearchResult, SearchOptions } from '@zana-ai/zcc-domain/product';
import { createRegexScanner } from './regex-worker.js';

const DENY = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.DS_Store',
  '.venv',
  'venv',
  '__pycache__',
  'coverage',
  '.pytest_cache',
  '.cache',
  'target'
]);

const MAX_ENTRIES = 2000;

export function listDir(absPath: string): FsEntry[] {
  let dirents: Dirent[];
  try {
    dirents = readdirSync(absPath, { withFileTypes: true }) as Dirent[];
  } catch {
    return [];
  }

  const out: FsEntry[] = [];
  for (const d of dirents) {
    if (DENY.has(d.name)) continue;
    const full = join(absPath, d.name);
    let kind: 'file' | 'dir';
    if (d.isSymbolicLink()) {
      try {
        kind = statSync(full).isDirectory() ? 'dir' : 'file';
      } catch {
        continue;
      }
    } else {
      kind = d.isDirectory() ? 'dir' : 'file';
    }
    out.push({ name: d.name, kind, path: full });
    if (out.length >= MAX_ENTRIES) break;
  }

  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return out;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

export function readFile(absPath: string): FsReadResult {
  let stats;
  try {
    stats = statSync(absPath);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (!stats.isFile()) return { ok: false, message: 'Not a file' };

  const fullBytes = stats.size;
  const readBytes = Math.min(fullBytes, MAX_FILE_BYTES);
  const buf = Buffer.alloc(readBytes);
  let fd: number | null = null;
  try {
    fd = openSync(absPath, 'r');
    readSync(fd, buf, 0, readBytes, 0);
  } catch (err) {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  closeSync(fd);

  // Heuristic: NUL byte in first 8 KB => binary
  const probe = buf.subarray(0, Math.min(8192, buf.length));
  const binary = probe.includes(0);
  if (binary) {
    return { ok: true, binary: true, bytes: fullBytes };
  }
  return {
    ok: true,
    content: buf.toString('utf8'),
    bytes: fullBytes,
    truncated: fullBytes > MAX_FILE_BYTES,
    binary: false
  };
}

// Cap writes at the same 2MB read cap — anything larger is almost certainly
// a binary or generated artifact that has no business being edited inline.
export function writeFile(absPath: string, content: string): FsWriteResult {
  const buf = Buffer.from(content, 'utf8');
  if (buf.byteLength > MAX_FILE_BYTES) {
    return { ok: false, message: `File too large (${buf.byteLength} > ${MAX_FILE_BYTES})` };
  }
  // Refuse paths that don't already exist as a regular file. The editor only
  // opens files it read first, so this is a sanity check, not a creation API.
  try {
    const st = statSync(absPath);
    if (!st.isFile()) return { ok: false, message: 'Not a regular file' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  try {
    writeFileSync(absPath, buf);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, bytes: buf.byteLength };
}

// --- File CRUD (create / rename / delete) -------------------------------
//
// Every mutating op below is confined to `root` (the project directory). The
// renderer always passes the active project's path as the root, so a buggy or
// adversarial path argument can never escape the project boundary and clobber
// files elsewhere on disk. Confinement resolves symlinks on the *real* root so
// a symlinked project still works, but `..` traversal and symlinks that point
// outside are rejected.

/**
 * Resolve `target` and assert it sits inside `root`. Returns the normalized
 * absolute path on success, or an error message describing why it was refused.
 * `target` need not exist yet (for create ops); we resolve its nearest existing
 * ancestor's real path to defeat symlink escapes on the parent chain.
 *
 * Note: this is a check-then-act guard, so a TOCTOU window exists if a symlink
 * is swapped into the parent chain between confine() and the syscall. We accept
 * that residual risk: this is a local single-user app and the only caller passes
 * the trusted active-project path as `root`.
 */
export function confine(root: string, target: string): { ok: true; path: string } | { ok: false; message: string } {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const resolved = resolve(target);

  // Walk up to the nearest ancestor that exists, realpath it, then re-append
  // the not-yet-created tail. This catches a symlinked parent dir pointing out
  // of the project even when the leaf doesn't exist yet.
  let existing = resolved;
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break; // hit filesystem root
    tail.unshift(existing.slice(parent.length + 1));
    existing = parent;
  }
  let realTarget: string;
  try {
    realTarget = tail.length > 0 ? join(realpathSync(existing), ...tail) : realpathSync(existing);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(prefix)) {
    return { ok: false, message: 'Path is outside the project' };
  }
  return { ok: true, path: realTarget };
}

/** Create an empty file. Refuses to overwrite an existing path. */
export function createFile(root: string, absPath: string): FsMutateResult {
  const c = confine(root, absPath);
  if (!c.ok) return c;
  if (existsSync(c.path)) return { ok: false, message: 'A file or folder with that name already exists' };
  try {
    mkdirSync(dirname(c.path), { recursive: true });
    writeFileSync(c.path, '', { flag: 'wx' });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, path: c.path };
}

/** Create a directory (and any missing parents). */
export function createDir(root: string, absPath: string): FsMutateResult {
  const c = confine(root, absPath);
  if (!c.ok) return c;
  if (existsSync(c.path)) return { ok: false, message: 'A file or folder with that name already exists' };
  try {
    mkdirSync(c.path, { recursive: true });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, path: c.path };
}

/** Rename or move a path. Both source and destination must stay inside root. */
export function renamePath(root: string, fromPath: string, toPath: string): FsMutateResult {
  const from = confine(root, fromPath);
  if (!from.ok) return from;
  const to = confine(root, toPath);
  if (!to.ok) return to;
  if (!existsSync(from.path)) return { ok: false, message: 'Source no longer exists' };
  if (existsSync(to.path)) return { ok: false, message: 'A file or folder with that name already exists' };
  try {
    mkdirSync(dirname(to.path), { recursive: true });
    renameSync(from.path, to.path);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, path: to.path };
}

/** Permanently delete a file or directory (recursive for dirs). */
export function deletePath(root: string, absPath: string): FsMutateResult {
  const c = confine(root, absPath);
  if (!c.ok) return c;
  // Guard against nuking the project root itself.
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (c.path === realRoot) return { ok: false, message: 'Refusing to delete the project root' };
  if (!existsSync(c.path)) return { ok: false, message: 'Path no longer exists' };
  try {
    rmSync(c.path, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, path: c.path };
}

const MAX_WALK_FILES = 8000;
const MAX_WALK_DEPTH = 12;
const MAX_WALK_ENTRIES = 32_000;

export interface WalkedFile {
  /** path relative to root, posix-style */
  rel: string;
  /** absolute path */
  path: string;
}

export interface WalkResult {
  files: WalkedFile[];
  /** true when MAX_WALK_FILES, MAX_WALK_DEPTH or MAX_WALK_ENTRIES cut the listing short */
  truncated: boolean;
}

const GIT_LS_TIMEOUT_MS = 10_000;
const GIT_LS_MAX_BUFFER = 16 * 1024 * 1024;

function outsideRoot(realRoot: string, target: string): boolean {
  const rel = relative(realRoot, target);
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/**
 * List tracked + untracked-but-not-ignored files via git. Returns null when
 * root is not inside a git work tree (or git fails/times out) so the caller can
 * fall back to a filesystem walk. No shell; cwd is the already-resolved root.
 */
async function gitListFiles(root: string, realRoot: string): Promise<WalkResult | null> {
  let stdout: string;
  try {
    ({ stdout } = await new Promise<{ stdout: string }>((resolveP, rejectP) => {
      execFile(
        'git',
        ['ls-files', '-z', '-co', '--exclude-standard'],
        { cwd: root, timeout: GIT_LS_TIMEOUT_MS, maxBuffer: GIT_LS_MAX_BUFFER, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
        (err, out) => (err ? rejectP(err) : resolveP({ stdout: out }))
      );
    }));
  } catch {
    return null;
  }
  const rels = [...new Set(stdout.split('\0').filter(Boolean))]
    .filter((r) => !r.split('/').some((seg) => DENY.has(seg)))
    .map((r) => ({ r, depth: r.split('/').length - 1 }))
    // Shallow files first so the cap never drops them in favour of deep ones.
    .sort((x, y) => x.depth - y.depth);
  const files: WalkedFile[] = [];
  let truncated = false;
  for (const { r, depth } of rels) {
    if (depth > MAX_WALK_DEPTH) { truncated = true; continue; }
    const full = join(root, r);
    try {
      let st = await asyncLstat(full);
      if (st.isSymbolicLink()) {
        const target = await realpath(full);
        if (outsideRoot(realRoot, target)) continue;
        st = await asyncStat(target);
      }
      if (!st.isFile()) continue;
    } catch {
      continue; // deleted-but-tracked or unreadable
    }
    if (files.length >= MAX_WALK_FILES) { truncated = true; break; }
    files.push({ rel: r, path: full });
  }
  return { files, truncated };
}

export async function walkFiles(root: string): Promise<WalkResult> {
  let realRoot: string;
  try { realRoot = await realpath(root); } catch { return { files: [], truncated: false }; }
  const viaGit = await gitListFiles(root, realRoot);
  if (viaGit) return viaGit;
  const out: WalkedFile[] = [];
  let truncated = false;
  // Breadth-first: shallow files survive a cap hit in a deep sibling subtree.
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const visited = new Set<string>();
  let examined = 0;
  walk: while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    try {
      const canonical = await realpath(dir);
      if (outsideRoot(realRoot, canonical) || visited.has(canonical)) continue;
      visited.add(canonical);
      // Stream directory entries and yield during I/O. A file-count cap alone
      // doesn't bound a tree of empty directories or symlink cycles.
      const entries = await opendir(dir);
      for await (const d of entries) {
        if (++examined > MAX_WALK_ENTRIES) { truncated = true; break walk; }
        if (DENY.has(d.name)) continue;
        const full = join(dir, d.name);
        let isDir = d.isDirectory();
        let isFile = d.isFile();
        if (d.isSymbolicLink()) {
          try {
            const target = await realpath(full);
            if (outsideRoot(realRoot, target)) continue;
            const st = await asyncStat(target);
            isDir = st.isDirectory();
            isFile = st.isFile();
          } catch {
            continue;
          }
        }
        if (isDir) {
          if (depth < MAX_WALK_DEPTH) queue.push({ dir: full, depth: depth + 1 });
          else truncated = true;
        } else if (isFile) {
          if (out.length >= MAX_WALK_FILES) { truncated = true; break walk; }
          out.push({ rel: relative(root, full).split('\\').join('/'), path: full });
        }
      }
    } catch {
      // Unreadable or disappearing directories must not abort the whole scan.
    }
  }
  return { files: out, truncated };
}

/**
 * Locate an inbox doc whose reported path doesn't resolve under the project
 * root. Agents frequently `cd` into a subdir, write a file there (or into the
 * `.zcc/library`), then report the path relative to that subdir — so a naive
 * `root + reportedPath` join 404s even though the file exists nearby. This
 * walks a fixed ladder of likely locations and returns the FIRST hit as a
 * project-root-relative posix path, or null when nothing matches.
 *
 * Every candidate is `confine()`d to `root` before it's trusted, so a
 * traversal (`../../.ssh/id_rsa`) or an origin cwd that escaped the project
 * can never produce a hit outside the tree (Rule 2). Pure resolution: it only
 * stats candidates, never reads content.
 *
 * Ladder, best-to-worst:
 *   1. exact `root + reportedPath` (the happy path — returned unchanged)
 *   2. `originCwd + reportedPath` (the agent's real working dir, when captured)
 *   3. unique basename match anywhere under `root` (the walk; ambiguous → skip)
 */
export async function resolveDoc(
  root: string,
  reportedPath: string,
  originCwd?: string
): Promise<{ ok: true; rel: string } | { ok: false }> {
  // Base the returned relative path on the REALPATH'd root: confine() returns a
  // realpath'd absolute (symlinks resolved), so computing `relative()` against a
  // symlinked raw root would yield spurious `../` segments. Fall back to the raw
  // root if realpath fails (matches confine's own tolerance).
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = root;
  }

  const asRel = (abs: string): string | null => {
    const c = confine(root, abs);
    if (!c.ok) return null;
    let st;
    try {
      st = statSync(c.path);
    } catch {
      return null;
    }
    if (!st.isFile()) return null;
    return relative(realRoot, c.path).split('\\').join('/');
  };

  const cleanReported = reportedPath.replace(/^[/\\]+/, '');

  // 1. Exact join against the project root.
  const exact = asRel(join(root, cleanReported));
  if (exact) return { ok: true, rel: exact };

  // 2. Against the agent's captured working directory (a subdir of the project
  //    in the common case). Only meaningful when the origin cwd sits inside the
  //    project — confine() enforces that.
  if (originCwd) {
    const viaCwd = asRel(join(originCwd, cleanReported));
    if (viaCwd) return { ok: true, rel: viaCwd };
  }

  // 3. Unique basename match under the project root. A file the agent wrote in
  //    a subdir (or the library) surfaces here. Ambiguous (multiple files with
  //    the same basename) → decline rather than guess the wrong one.
  const base = cleanReported.split(/[/\\]/).pop() ?? cleanReported;
  if (base) {
    const matches = (await walkFiles(root)).files.filter(
      (f) => (f.rel.split('/').pop() ?? f.rel) === base
    );
    if (matches.length === 1) return { ok: true, rel: matches[0].rel };
  }

  return { ok: false };
}

const SEARCH_MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB
const SEARCH_MAX_HITS = 500;
const SEARCH_MAX_HITS_PER_FILE = 20;
const SEARCH_LINE_TRUNC = 240;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchFiles(
  root: string,
  query: string,
  opts: SearchOptions = {}
): Promise<SearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { hits: [], scanned: 0, truncated: false };
  if (trimmed.length > 4096) return { hits: [], scanned: 0, truncated: true };

  const flags = opts.caseSensitive ? 'g' : 'gi';
  // Only escaped literal expressions run here. User regex compilation and
  // matching both belong to the bounded worker.
  const re = opts.regex ? null : new RegExp(escapeRegex(trimmed), flags);
  const hits: SearchHit[] = [];
  let scanned = 0;
  let truncated = false;
  const scanner = opts.regex ? createRegexScanner() : null;
  if (opts.regex && !scanner) return { hits: [], scanned: 0, truncated: true };
  const deadline = Date.now() + 10_000;

  try {
    if (scanner) {
      try { await scanner.scan('', trimmed, flags); }
      catch (error) { return { hits: [], scanned: 0, truncated: !(error instanceof Error && error.message === 'Invalid search expression') }; }
    }
    const { files, truncated: walkTruncated } = await walkFiles(root);
    if (walkTruncated) truncated = true;
    outer: for (const f of files) {
      if (Date.now() > deadline) { truncated = true; break; }
      let stat;
      try {
        stat = await asyncStat(f.path);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.size > SEARCH_MAX_FILE_BYTES) continue;

      let buf: Buffer;
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(f.path, 'r');
        // Bound the read even if a file grows after stat().
        buf = Buffer.alloc(Math.min(stat.size, SEARCH_MAX_FILE_BYTES));
        let bytesRead = 0;
        while (bytesRead < buf.length) {
          const read = await handle.read(buf, bytesRead, buf.length - bytesRead, bytesRead);
          if (read.bytesRead === 0) break;
          bytesRead += read.bytesRead;
        }
        buf = buf.subarray(0, bytesRead);
      } catch {
        continue;
      } finally { await handle?.close().catch(() => {}); }
      // Skip binary files: NUL byte in first 8 KB.
      const probe = buf.subarray(0, Math.min(8192, buf.length));
      if (probe.includes(0)) continue;

      scanned++;
      const text = buf.toString('utf8');
      if (scanner) {
        try {
          const found = await scanner.scan(text, trimmed, flags);
          for (const hit of found) {
            hits.push({ ...hit, rel: f.rel, path: f.path });
            if (hits.length >= SEARCH_MAX_HITS) { truncated = true; break outer; }
          }
        } catch { truncated = true; break; }
        continue;
      }
      const lines = text.split('\n');
      let perFile = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        re!.lastIndex = 0;
        const m = re!.exec(line);
        if (!m) continue;
        const truncatedLine =
          line.length > SEARCH_LINE_TRUNC ? line.slice(0, SEARCH_LINE_TRUNC) + '…' : line;
        hits.push({
          rel: f.rel,
          path: f.path,
          line: i + 1,
          column: m.index + 1,
          match: m[0],
          preview: truncatedLine
        });
        perFile++;
        if (hits.length >= SEARCH_MAX_HITS) {
          truncated = true;
          break outer;
        }
        if (perFile >= SEARCH_MAX_HITS_PER_FILE) break;
      }
    }
  } finally { scanner?.dispose(); }

  return { hits, scanned, truncated };
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

function mimeFromExt(ext: string): string {
  const lower = ext.toLowerCase();
  if (lower === '.png') return 'image/png';
  if (lower === '.jpg' || lower === '.jpeg') return 'image/jpeg';
  if (lower === '.gif') return 'image/gif';
  if (lower === '.webp') return 'image/webp';
  if (lower === '.svg') return 'image/svg+xml';
  if (lower === '.bmp') return 'image/bmp';
  if (lower === '.ico') return 'image/x-icon';
  if (lower === '.avif') return 'image/avif';
  if (lower === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

export function readDataUrl(absPath: string): FsReadDataUrlResult {
  let stats;
  try {
    stats = statSync(absPath);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  if (!stats.isFile()) return { ok: false, message: 'Not a file' };
  if (stats.size > MAX_IMAGE_BYTES) {
    return { ok: false, message: `File too large (${stats.size} > ${MAX_IMAGE_BYTES})` };
  }

  let buf: Buffer;
  try {
    buf = readFileSync(absPath);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const ext = extname(absPath);
  const mime = mimeFromExt(ext);
  const b64 = buf.toString('base64');
  return { ok: true, dataUrl: `data:${mime};base64,${b64}`, bytes: buf.byteLength };
}
