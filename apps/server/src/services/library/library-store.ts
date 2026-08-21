/**
 * LibraryStore — durable document storage (md, pdf, images, code snippets).
 *
 * Storage is dual-scope (mirrors TemplateStore):
 *  - Global: `~/.zcc/library/` (user-wide, survives project deletion)
 *  - Project: `<project.path>/.zcc/library/` (git-trackable)
 *
 * Each dir contains:
 *  - Real files on disk (actual content: .md, .pdf, .png, etc.)
 *  - One manifest: `index.json` (LibraryManifest) — rolled-up metadata
 *
 * Manifest entries are reconciled on read: missing-file entries are dropped;
 * on-disk files missing from the manifest are surfaced as untracked (kind
 * from ext, no id yet) so nothing is invisible.
 *
 * fs.watch on both dirs + debounced refresh + error/re-attach (copied from
 * template-store.ts). EventEmitter + onChanged full-list pattern (like saved).
 */

import { app, shell } from 'electron';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  rmSync,
  cpSync,
  statSync,
  realpathSync,
  watch,
  type FSWatcher
} from 'node:fs';
import { join, relative, extname, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { confine, readFile as fsReadFile, writeFile as fsWriteFile } from '../projects/fs.js';
import type {
  Project,
  LibraryDoc,
  LibraryManifest,
  LibraryAddInput,
  LibraryScope,
  LibrarySearchHit,
  LibrarySearchResult,
  FsReadResult,
  FsWriteResult,
  FsMutateResult
} from '@zana-ai/zcc-domain/product';

export type { LibraryDoc, LibraryManifest, LibraryAddInput } from '@zana-ai/zcc-domain/product';

const projectLibraryDir = (project: Project) =>
  join(project.path, '.zcc', 'library');

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Derive kind from file extension. */
function kindFromExt(ext: string): LibraryDoc['kind'] {
  const lower = ext.toLowerCase();
  if (lower === '.md' || lower === '.markdown') return 'md';
  if (lower === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(lower)) return 'image';
  if (['.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.sh', '.bash', '.zsh', '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss', '.sql'].includes(lower)) {
    return 'code';
  }
  return 'other';
}

/** Path-traversal guard: reject relPath that escapes the library dir. */
function validateRelPath(relPath: string): void {
  if (!relPath || relPath.trim() === '') {
    throw new Error('relPath is required');
  }
  const normalized = relPath.split('\\').join('/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new Error('relPath must be relative, not absolute');
  }
  if (normalized.includes('..')) {
    throw new Error('relPath must not contain ".." (path traversal)');
  }
}

/**
 * Stricter relPath guard for UNTRUSTED (agent-supplied) writes. On top of the
 * traversal check above, it reserves infrastructure names: any path segment
 * starting with a dot (so an agent can't write `.git/...`, `index.json` is
 * dotless but is explicitly reserved, and future `.zcc/library/.*` control
 * files stay off-limits). Realpath confinement is applied separately by the
 * caller (it needs the resolved library dir) — this is the cheap string gate
 * that runs first. Security-reviewer council condition (b).
 */
function validateAgentRelPath(relPath: string): void {
  validateRelPath(relPath);
  const normalized = relPath.split('\\').join('/');
  const segments = normalized.split('/').filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg.startsWith('.')) {
      throw new Error(`relPath segment "${seg}" is reserved (no dot-prefixed names)`);
    }
  }
  if (segments[segments.length - 1] === 'index.json') {
    throw new Error('relPath "index.json" is reserved (the library manifest)');
  }
}

/**
 * Tolerant manifest reader. Returns empty manifest if the file is missing,
 * corrupt, or has an invalid shape. Never throws to caller.
 */
function readManifest(dir: string): LibraryManifest {
  const path = join(dir, 'index.json');
  if (!existsSync(path)) return { version: 1, docs: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<LibraryManifest>;
    if (!raw || typeof raw !== 'object') return { version: 1, docs: [] };
    if (!Array.isArray(raw.docs)) return { version: 1, docs: [] };
    // Defensive filter: skip docs with missing required fields.
    const docs = raw.docs.filter(
      (d: Partial<LibraryDoc>) =>
        d &&
        typeof d.id === 'string' &&
        typeof d.relPath === 'string' &&
        typeof d.title === 'string' &&
        typeof d.kind === 'string' &&
        typeof d.createdAt === 'number' &&
        typeof d.updatedAt === 'number'
    ) as LibraryDoc[];
    return { version: 1, docs };
  } catch {
    return { version: 1, docs: [] };
  }
}

/**
 * Atomic manifest write: tmp + rename. The dir is already ensured by the
 * caller (add/update/remove).
 *
 * Note on serialization: every mutating method here does a fully SYNCHRONOUS
 * read-modify-write (readManifest → writeFileSync → writeManifest) with no
 * `await` in the window, so Node's single-threaded loop already serializes them
 * — two callers can't interleave a lost update, and no in-process mutex is
 * needed (Rule 4 is satisfied by the append/rewrite being atomic + uninterrupted).
 * The tmp name still gets a unique suffix so a same-millisecond collision with a
 * *separate process* (or a future async refactor) can't clobber an in-flight tmp.
 */
function writeManifest(dir: string, manifest: LibraryManifest): void {
  ensureDir(dir);
  const path = join(dir, 'index.json');
  const tmp = `${path}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  // Atomic replace: rename overwrites the target in a single fs op (POSIX),
  // so a crash mid-write can never leave a missing/half-written manifest —
  // matches the tmp+rename pattern in saved-store.ts. renameSync overwrites
  // an existing destination on both POSIX and Windows.
  renameSync(tmp, path);
}

/**
 * YAML front-matter round-trip for agent-written markdown docs.
 *
 * Git-trackability (ticket #4): a freshly-cloned project has the doc FILES but
 * not the (gitignored) `index.json` manifest. So an agent-written `.md` carries
 * its own metadata as a front-matter block — `reconcile()` parses it to rebuild
 * the manifest entry losslessly instead of degrading to an untracked
 * (id='', title=filename) row. String values are JSON-encoded so colons/quotes
 * in a title can't break the (deliberately tiny, dependency-free) parser; any
 * malformed block falls back to the untracked defaults — we never throw.
 */
const FRONT_MATTER_FENCE = '---';

/** Upper bound on tags parsed from a front-matter header (DoS guard). */
const MAX_FRONT_MATTER_TAGS = 100;

/**
 * Cap on the size of a file the agent surface will read into memory. Matches
 * the renderer's fs.readFile bound (MAX_FILE_BYTES) so the agent path isn't the
 * weakest link — an oversized doc (which library_write can create) can't OOM
 * the main process on read.
 */
const MAX_AGENT_READ_BYTES = 10 * 1024 * 1024; // 10 MB

// ----- full-text body search bounds ------------------------------------------
// Keep the scan bounded (Rule 5): a growing library must not turn a keystroke
// in the search box into an unbounded read of every doc on the main thread.
/** Skip any single doc larger than this when body-searching. */
const SEARCH_MAX_FILE_BYTES = 1 * 1024 * 1024; // 1 MB
/** Stop after reading this many doc files, whatever's left unscanned. */
const SEARCH_MAX_FILES = 1_000;
/** Cap total hits returned (one per matching doc — first match wins). */
const SEARCH_MAX_HITS = 500;
/** Truncate a snippet line to this many chars. */
const SEARCH_SNIPPET_TRUNC = 200;

/**
 * Body-search a set of already-reconciled docs (as produced by list()/agentList,
 * carrying absPath). Only text kinds (md/code) are read; the front-matter header
 * of a markdown doc is stripped first so metadata terms (id/source/…) can't
 * masquerade as body hits. Returns the FIRST matching line per doc, keyed by
 * absPath. Bounded on file count, per-file size, and total hits.
 */
function searchDocBodies(docs: LibraryDoc[], query: string): LibrarySearchResult {
  const needle = query.trim().toLowerCase();
  if (!needle) return { hits: [], truncated: false };

  const hits: LibrarySearchHit[] = [];
  let filesRead = 0;
  let truncated = false;

  for (const doc of docs) {
    if (!doc.absPath) continue;
    if (doc.kind !== 'md' && doc.kind !== 'code') continue;
    if (filesRead >= SEARCH_MAX_FILES) {
      truncated = true;
      break;
    }
    let raw: string;
    try {
      const st = statSync(doc.absPath);
      if (!st.isFile() || st.size > SEARCH_MAX_FILE_BYTES) continue;
      raw = readFileSync(doc.absPath, 'utf8');
    } catch {
      continue; // unreadable / vanished between list() and search
    }
    filesRead++;
    // Strip a markdown front-matter header so its keys aren't body matches.
    const body = doc.kind === 'md' ? parseFrontMatter(raw)?.body ?? raw : raw;
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(needle)) continue;
      const line = lines[i].trim();
      hits.push({
        absPath: doc.absPath,
        scope: doc.scope,
        line: i + 1,
        preview:
          line.length > SEARCH_SNIPPET_TRUNC ? line.slice(0, SEARCH_SNIPPET_TRUNC) + '…' : line
      });
      break; // first match per doc is enough for a snippet
    }
    if (hits.length >= SEARCH_MAX_HITS) {
      truncated = true;
      break;
    }
  }

  return { hits, truncated };
}

function serializeFrontMatter(
  meta: Pick<LibraryDoc, 'id' | 'title' | 'summary' | 'tags' | 'createdAt'> & {
    sourceKind?: string;
  },
  body: string
): string {
  const lines: string[] = [FRONT_MATTER_FENCE];
  lines.push(`id: ${JSON.stringify(meta.id)}`);
  lines.push(`title: ${JSON.stringify(meta.title)}`);
  if (meta.summary !== undefined) lines.push(`summary: ${JSON.stringify(meta.summary)}`);
  if (meta.tags && meta.tags.length > 0) {
    lines.push(`tags: [${meta.tags.map((t) => JSON.stringify(t)).join(', ')}]`);
  }
  if (meta.sourceKind) lines.push(`source: ${JSON.stringify(meta.sourceKind)}`);
  lines.push(`createdAt: ${meta.createdAt}`);
  lines.push(FRONT_MATTER_FENCE);
  lines.push('');
  return `${lines.join('\n')}${body}`;
}

interface ParsedFrontMatter {
  meta: Partial<Pick<LibraryDoc, 'id' | 'title' | 'summary' | 'tags' | 'createdAt'>> & {
    sourceKind?: string;
  };
  body: string;
}

/** Parse a leading front-matter block. Returns null when there isn't one. */
function parseFrontMatter(raw: string): ParsedFrontMatter | null {
  if (!raw.startsWith(`${FRONT_MATTER_FENCE}\n`)) return null;
  // Find the CLOSING fence: a `\n---` that is on its own line (followed by a
  // newline or EOF). Scanning for the first `\n---` alone would mis-fire when
  // the body's own first line is `---` (a markdown horizontal rule / fence),
  // truncating the header and mangling the body. Skip such non-fence hits.
  const needle = `\n${FRONT_MATTER_FENCE}`;
  let end = raw.indexOf(needle, FRONT_MATTER_FENCE.length);
  while (end >= 0) {
    const after = raw[end + needle.length];
    if (after === undefined || after === '\n') break; // fence on its own line
    end = raw.indexOf(needle, end + needle.length);
  }
  if (end < 0) return null;
  const block = raw.slice(FRONT_MATTER_FENCE.length + 1, end);
  // Body starts after the closing fence's own line.
  const afterFence = raw.indexOf('\n', end + 1);
  const body = afterFence < 0 ? '' : raw.slice(afterFence + 1);
  const meta: ParsedFrontMatter['meta'] = {};
  const decode = (v: string): string => {
    const t = v.trim();
    if (t.startsWith('"')) {
      try {
        return JSON.parse(t) as string;
      } catch {
        return t;
      }
    }
    return t;
  };
  for (const line of block.split('\n')) {
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim();
    if (key === 'id') meta.id = decode(val);
    else if (key === 'title') meta.title = decode(val);
    else if (key === 'summary') meta.summary = decode(val);
    else if (key === 'source') meta.sourceKind = decode(val);
    else if (key === 'createdAt') {
      const n = Number(val);
      if (Number.isFinite(n)) meta.createdAt = n;
    } else if (key === 'tags') {
      const inner = val.replace(/^\[/, '').replace(/\]$/, '').trim();
      // Cap the tag count so a malformed/hostile header (e.g. 100k comma-values)
      // can't force an unbounded split/allocate during reconcile.
      if (inner) {
        meta.tags = inner
          .split(',')
          .slice(0, MAX_FRONT_MATTER_TAGS)
          .map((t) => decode(t))
          .filter((t) => t.length > 0);
      }
    }
  }
  return { meta, body };
}

/**
 * Reconcile manifest + on-disk files:
 *  - Drop manifest entries whose file is gone.
 *  - Surface on-disk files missing from the manifest (untracked), recovering
 *    metadata from front-matter when present (the fresh-clone case).
 */
function reconcile(dir: string, manifest: LibraryManifest): LibraryDoc[] {
  const out: LibraryDoc[] = [];
  const seen = new Set<string>();

  // Manifest entries that still have a file on disk. De-dup by relPath: a
  // hand-corrupted or race-written manifest can hold two entries for the same
  // path — surfacing both would show phantom duplicates that share an absPath
  // (deleting one leaves the other dangling), so the first wins.
  for (const doc of manifest.docs) {
    if (seen.has(doc.relPath)) continue;
    const absPath = join(dir, doc.relPath);
    if (existsSync(absPath)) {
      out.push(doc);
      seen.add(doc.relPath);
    }
  }

  // On-disk files missing from manifest → untracked entries (no id). Walk
  // subdirs too: agents are steered toward findings/ decisions/ thoughts/
  // prefixes, so a shallow scan would miss (and a fresh clone couldn't rebuild)
  // any doc that isn't at the top level. Skip dotdirs (.git etc.) for safety.
  if (!existsSync(dir)) return out;
  // Precompute the canonical library-dir prefix once. Any subdir whose realpath
  // escapes it (a symlink like library/link -> ~/.ssh) is skipped, so walk()
  // never follows a symlink out of the tree and surfaces a foreign file as an
  // untracked doc (whose absPath the renderer would then read for preview).
  let realPrefix: string | null = null;
  try {
    realPrefix = realpathSync(dir) + sep;
  } catch {
    realPrefix = null;
  }
  const walk = (base: string): string[] => {
    const found: string[] = [];
    let names: string[];
    try {
      names = readdirSync(base);
    } catch {
      return found;
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const abs = join(base, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        // Skip a subdir that resolves outside the library dir (symlink escape).
        if (realPrefix) {
          try {
            if (!(realpathSync(abs) + sep).startsWith(realPrefix)) continue;
          } catch {
            continue;
          }
        }
        found.push(...walk(abs));
      } else if (st.isFile()) {
        // Same escape check for a symlinked file (library/x.md -> ~/.ssh/id_rsa):
        // its in-dir absPath would otherwise be handed to the renderer to read,
        // following the link out of the tree.
        if (realPrefix) {
          try {
            if (!realpathSync(abs).startsWith(realPrefix)) continue;
          } catch {
            continue;
          }
        }
        found.push(relative(dir, abs).split('\\').join('/'));
      }
    }
    return found;
  };
  for (const relPath of walk(dir)) {
    if (relPath === 'index.json') continue;
    const absPath = join(dir, relPath);
    let st;
    try {
      st = statSync(absPath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (seen.has(relPath)) continue;
    const name = relPath;
    // Untracked file: surface with kind from ext. For markdown, try to recover
    // the full metadata from a front-matter block (the fresh-clone case, where
    // index.json was never committed) — losslessly rebuilding id/title/tags so
    // a committed doc isn't degraded to a title=filename, id='' row.
    const ext = extname(name);
    const kind = kindFromExt(ext);
    let recovered: LibraryDoc | null = null;
    if (kind === 'md') {
      try {
        const fm = parseFrontMatter(readFileSync(absPath, 'utf8'));
        if (fm && fm.meta.id) {
          recovered = {
            id: fm.meta.id,
            relPath,
            title: fm.meta.title ?? name,
            summary: fm.meta.summary,
            tags: fm.meta.tags,
            kind,
            createdAt: fm.meta.createdAt ?? st.ctimeMs,
            updatedAt: st.mtimeMs,
            bytes: st.size,
            source: fm.meta.sourceKind
              ? { kind: fm.meta.sourceKind as NonNullable<LibraryDoc['source']>['kind'] }
              : undefined
          };
        }
      } catch {
        /* unreadable / malformed front-matter → fall through to untracked */
      }
    }
    out.push(
      recovered ?? {
        id: '',
        relPath,
        title: name,
        kind,
        createdAt: st.ctimeMs,
        updatedAt: st.mtimeMs,
        bytes: st.size
      }
    );
  }

  return out;
}

export interface LibraryStoreOptions {
  /**
   * Override the home directory used for the global library dir
   * (`<homeDir>/.zcc/library`). Defaults to electron's
   * `app.getPath('home')`. Exists so the file-backed path is testable
   * without electron — mirrors the `dir` override on SavedStore.
   */
  homeDir?: string;
}

export class LibraryStore extends EventEmitter {
  private projectsRef: () => Project[];
  private homeDir: string | null;
  private userWatcher: FSWatcher | null = null;
  private projectWatchers: Map<string, FSWatcher> = new Map();
  private debounce: NodeJS.Timeout | null = null;

  constructor(projectsRef: () => Project[], opts: LibraryStoreOptions = {}) {
    super();
    this.projectsRef = projectsRef;
    this.homeDir = opts.homeDir ?? null;
  }

  start() {
    const dir = this.userDir();
    ensureDir(dir);
    this.attachUserWatcher();
    this.attachProjectWatchers();
  }

  stop() {
    if (this.userWatcher) {
      this.userWatcher.close();
      this.userWatcher = null;
    }
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = null;
    }
  }

  userDir(): string {
    return join(this.homeDir ?? app.getPath('home'), '.zcc', 'library');
  }

  projectDir(project: Project): string {
    return projectLibraryDir(project);
  }

  /**
   * List all docs from both scopes, stamped with scope/absPath/projectId.
   * Reconciles on read: drops missing-file entries, surfaces untracked files.
   * Returns newest-first by updatedAt.
   */
  list(): LibraryDoc[] {
    const out: LibraryDoc[] = [];

    // Global scope.
    const globalDir = this.userDir();
    const globalManifest = readManifest(globalDir);
    const globalDocs = reconcile(globalDir, globalManifest);
    for (const doc of globalDocs) {
      out.push({
        ...doc,
        scope: 'global',
        absPath: join(globalDir, doc.relPath)
      });
    }

    // Per-project scope.
    for (const project of this.projectsRef()) {
      const projectDir = projectLibraryDir(project);
      const projectManifest = readManifest(projectDir);
      const projectDocs = reconcile(projectDir, projectManifest);
      for (const doc of projectDocs) {
        out.push({
          ...doc,
          scope: 'project',
          absPath: join(projectDir, doc.relPath),
          projectId: project.id,
          projectName: project.name
        });
      }
    }

    // Sort newest-first by updatedAt.
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  /**
   * Full-text search of document bodies across both scopes. Reads each text doc
   * (md/code) from disk and returns the first matching line per doc as a snippet.
   * Bounded (Rule 5): per-file size, total file count, and total hit caps live
   * in {@link searchDocBodies}. Metadata search (title/summary/tags) stays in the
   * renderer — this is the body-content complement.
   */
  search(query: string): LibrarySearchResult {
    return searchDocBodies(this.list(), query);
  }

  /**
   * Resolve the trusted on-disk library dir for a scope. Global → `~/.zcc/library`;
   * project → `<project.path>/.zcc/library`. The projectId (for project scope) is
   * matched against the registered project list (Rule 1 — main authorizes from the
   * store, never a renderer-supplied path). Throws for an unknown project.
   */
  private dirForScope(scope: LibraryScope, projectId?: string): string {
    if (scope === 'project') {
      if (!projectId) throw new Error('projectId is required for project-scope docs');
      return this.projectDirById(projectId);
    }
    return this.userDir();
  }

  /**
   * Read a library doc's raw content by scope + relPath — the renderer preview /
   * edit seam. This exists because a GLOBAL doc lives in `~/.zcc/library`, OUTSIDE
   * any registered project, so the generic project-confined `fs.readFile` rejects
   * it ("Path is not inside a known project"). Here the trust anchor is the
   * scope's own library dir (Rule 2): we resolve it from the store, confine the
   * relPath inside it (symlink/`..` escapes rejected), and read. The renderer
   * passes only scope + relPath — never an absolute path (Rule 1).
   */
  readContent(scope: LibraryScope, relPath: string, projectId?: string): FsReadResult {
    let absPath: string;
    try {
      const dir = this.dirForScope(scope, projectId);
      const c = confine(dir, join(dir, relPath));
      if (!c.ok) return { ok: false, message: c.message };
      absPath = c.path;
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    return fsReadFile(absPath);
  }

  /**
   * Write a library doc's content by scope + relPath — the renderer edit-save
   * seam, the write twin of {@link readContent}. Same trust model: the target is
   * confined to the scope's own library dir, so a global doc can be saved without
   * routing an absolute path through the project-confined generic `fs.writeFile`.
   * The file must already exist (this is an edit, not a create — matches
   * `fs.writeFile`'s "opened it first" contract). Emits 'changed' so the manifest
   * (mtime/bytes) reconciles.
   */
  writeContent(scope: LibraryScope, relPath: string, content: string, projectId?: string): FsWriteResult {
    let absPath: string;
    try {
      const dir = this.dirForScope(scope, projectId);
      const c = confine(dir, join(dir, relPath));
      if (!c.ok) return { ok: false, message: c.message };
      absPath = c.path;
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    const res = fsWriteFile(absPath, content);
    if (res.ok) this.emit('changed');
    return res;
  }

  /**
   * Create a folder at scope+relPath (and any missing parents) — the folder-tree
   * UI's "New folder" action. Confined to the scope's own library dir (same trust
   * model as read/writeContent); refuses to overwrite an existing file/folder.
   */
  createFolder(scope: LibraryScope, relPath: string, projectId?: string): FsMutateResult {
    try {
      validateRelPath(relPath);
      const dir = this.dirForScope(scope, projectId);
      ensureDir(dir);
      const c = confine(dir, join(dir, relPath));
      if (!c.ok) return { ok: false, message: c.message };
      if (existsSync(c.path)) {
        return { ok: false, message: 'A file or folder with that name already exists' };
      }
      mkdirSync(c.path, { recursive: true });
      this.emit('changed');
      return { ok: true, path: c.path };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Move/rename a file or folder within the library (the folder-tree UI's
   * drag-to-move + rename actions). Source and destination are each resolved
   * via {@link dirForScope} and confined independently (Rule 1/2), so this
   * supports both a same-scope rename AND a cross-scope move (e.g. dragging a
   * project doc into Global, or vice versa). Manifest entries under the moved
   * path (a whole subtree for a folder) are relocated from the source
   * manifest to the destination manifest with their relPath rewritten;
   * untracked files just move on disk and resurface untracked at the new path.
   * Refuses to overwrite an existing destination — matches `fs.ts`'s
   * `renamePath` semantics, the pattern this mirrors.
   */
  moveEntry(
    from: { scope: LibraryScope; relPath: string; projectId?: string },
    to: { scope: LibraryScope; relPath: string; projectId?: string }
  ): FsMutateResult {
    try {
      validateRelPath(from.relPath);
      validateRelPath(to.relPath);
      const fromDir = this.dirForScope(from.scope, from.projectId);
      const toDir = this.dirForScope(to.scope, to.projectId);
      ensureDir(fromDir);
      ensureDir(toDir);
      const fromC = confine(fromDir, join(fromDir, from.relPath));
      if (!fromC.ok) return { ok: false, message: fromC.message };
      const toC = confine(toDir, join(toDir, to.relPath));
      if (!toC.ok) return { ok: false, message: toC.message };
      if (!existsSync(fromC.path)) return { ok: false, message: 'Source no longer exists' };
      if (existsSync(toC.path)) {
        return { ok: false, message: 'A file or folder with that name already exists' };
      }

      const isDir = statSync(fromC.path).isDirectory();
      const sameScope = fromDir === toDir;

      const fromManifest = readManifest(fromDir);
      const toManifest = sameScope ? fromManifest : readManifest(toDir);
      let manifestChanged = false;

      if (isDir) {
        const prefix = from.relPath.endsWith('/') ? from.relPath : `${from.relPath}/`;
        const moved: LibraryDoc[] = [];
        fromManifest.docs = fromManifest.docs.filter((d) => {
          if (d.relPath !== from.relPath && !d.relPath.startsWith(prefix)) return true;
          const rest = d.relPath.slice(from.relPath.length);
          moved.push({ ...d, relPath: `${to.relPath}${rest}` });
          return false;
        });
        if (moved.length > 0) {
          toManifest.docs.push(...moved);
          manifestChanged = true;
        }
      } else {
        const idx = fromManifest.docs.findIndex((d) => d.relPath === from.relPath);
        if (idx >= 0) {
          const [doc] = fromManifest.docs.splice(idx, 1);
          toManifest.docs.push({ ...doc, relPath: to.relPath });
          manifestChanged = true;
        }
      }

      mkdirSync(dirname(toC.path), { recursive: true });
      this.moveOnDisk(fromC.path, toC.path);

      if (manifestChanged) {
        writeManifest(fromDir, fromManifest);
        if (!sameScope) writeManifest(toDir, toManifest);
      }
      this.emit('changed');
      return { ok: true, path: toC.path };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Permanently delete a file or folder at scope+relPath (recursive for a
   * folder), removing any manifest entries under that path. This is a TRUE
   * delete — unlike {@link remove}, which is manifest-only and id-keyed (kept
   * for back-compat with the per-doc "Delete" button) — because a folder-tree
   * "Delete" on a directory has no single id to key off and a real file
   * explorer's delete removes the file, not just its index entry.
   */
  deleteEntry(scope: LibraryScope, relPath: string, projectId?: string): FsMutateResult {
    try {
      validateRelPath(relPath);
      const dir = this.dirForScope(scope, projectId);
      const c = confine(dir, join(dir, relPath));
      if (!c.ok) return { ok: false, message: c.message };
      let realDir: string;
      try {
        realDir = realpathSync(dir);
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
      if (c.path === realDir) return { ok: false, message: 'Refusing to delete the library root' };
      if (!existsSync(c.path)) return { ok: false, message: 'Path no longer exists' };

      const isDir = statSync(c.path).isDirectory();
      const manifest = readManifest(dir);
      let manifestChanged = false;
      if (isDir) {
        const prefix = relPath.endsWith('/') ? relPath : `${relPath}/`;
        const before = manifest.docs.length;
        manifest.docs = manifest.docs.filter(
          (d) => d.relPath !== relPath && !d.relPath.startsWith(prefix)
        );
        manifestChanged = manifest.docs.length !== before;
      } else {
        const idx = manifest.docs.findIndex((d) => d.relPath === relPath);
        if (idx >= 0) {
          manifest.docs.splice(idx, 1);
          manifestChanged = true;
        }
      }
      if (manifestChanged) writeManifest(dir, manifest);

      rmSync(c.path, { recursive: true, force: true });
      this.emit('changed');
      return { ok: true, path: c.path };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Move a path on disk, falling back to copy+delete when a plain rename fails
   * across filesystem boundaries (EXDEV — e.g. a project on a different volume
   * than `~`), which a cross-scope move can hit.
   */
  private moveOnDisk(fromAbs: string, toAbs: string): void {
    try {
      renameSync(fromAbs, toAbs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      cpSync(fromAbs, toAbs, { recursive: true });
      rmSync(fromAbs, { recursive: true, force: true });
    }
  }

  /**
   * Add a new doc. Writes the file (if content given), appends manifest entry,
   * emits 'changed'. Returns the created doc or null on failure.
   */
  add(input: LibraryAddInput): LibraryDoc | null {
    try {
      validateRelPath(input.relPath);
      if (input.scope === 'project' && !input.projectId) {
        throw new Error('projectId is required for project-scope docs');
      }

      const dir =
        input.scope === 'global'
          ? this.userDir()
          : (() => {
              const project = this.projectsRef().find((p) => p.id === input.projectId);
              if (!project) throw new Error(`Project not found: ${input.projectId}`);
              return projectLibraryDir(project);
            })();

      ensureDir(dir);
      const absPath = join(dir, input.relPath);

      // Write file content if given.
      if (input.content !== undefined) {
        const parentDir = join(absPath, '..');
        ensureDir(parentDir);
        writeFileSync(absPath, input.content, 'utf8');
      }

      // Read file stats (size, timestamps) for the manifest entry.
      let bytes = 0;
      let createdAt = Date.now();
      let updatedAt = Date.now();
      if (existsSync(absPath)) {
        const st = statSync(absPath);
        bytes = st.size;
        createdAt = st.ctimeMs;
        updatedAt = st.mtimeMs;
      }

      const ext = extname(input.relPath);
      const kind = kindFromExt(ext);

      const doc: LibraryDoc = {
        id: randomUUID(),
        relPath: input.relPath,
        title: input.title,
        summary: input.summary,
        tags: input.tags,
        kind,
        createdAt,
        updatedAt,
        bytes,
        source: input.source
      };

      // Append to manifest.
      const manifest = readManifest(dir);
      manifest.docs.push(doc);
      writeManifest(dir, manifest);

      this.emit('changed');
      return doc;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[library-store] add failed:', err);
      return null;
    }
  }

  /**
   * Update a doc's metadata (title/summary/tags). Finds the doc in either
   * scope, patches it, rewrites the manifest. Returns the updated doc or null.
   */
  update(
    id: string,
    patch: Partial<Pick<LibraryDoc, 'title' | 'summary' | 'tags'>>
  ): LibraryDoc | null {
    try {
      // Find the doc in global scope.
      const globalDir = this.userDir();
      const globalManifest = readManifest(globalDir);
      const globalIdx = globalManifest.docs.findIndex((d) => d.id === id);
      if (globalIdx >= 0) {
        const doc = globalManifest.docs[globalIdx];
        if (patch.title !== undefined) doc.title = patch.title;
        if (patch.summary !== undefined) doc.summary = patch.summary;
        if (patch.tags !== undefined) doc.tags = patch.tags;
        doc.updatedAt = Date.now();
        writeManifest(globalDir, globalManifest);
        this.emit('changed');
        return doc;
      }

      // Find the doc in project scopes.
      for (const project of this.projectsRef()) {
        const projectDir = projectLibraryDir(project);
        const projectManifest = readManifest(projectDir);
        const projectIdx = projectManifest.docs.findIndex((d) => d.id === id);
        if (projectIdx >= 0) {
          const doc = projectManifest.docs[projectIdx];
          if (patch.title !== undefined) doc.title = patch.title;
          if (patch.summary !== undefined) doc.summary = patch.summary;
          if (patch.tags !== undefined) doc.tags = patch.tags;
          doc.updatedAt = Date.now();
          writeManifest(projectDir, projectManifest);
          this.emit('changed');
          return doc;
        }
      }

      return null;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[library-store] update failed:', err);
      return null;
    }
  }

  /**
   * Remove a doc by id. Removes from manifest (does NOT unlink the file).
   * Returns true if removed, false if not found.
   */
  remove(id: string): boolean {
    try {
      // Try global scope.
      const globalDir = this.userDir();
      const globalManifest = readManifest(globalDir);
      const globalIdx = globalManifest.docs.findIndex((d) => d.id === id);
      if (globalIdx >= 0) {
        globalManifest.docs.splice(globalIdx, 1);
        writeManifest(globalDir, globalManifest);
        this.emit('changed');
        return true;
      }

      // Try project scopes.
      for (const project of this.projectsRef()) {
        const projectDir = projectLibraryDir(project);
        const projectManifest = readManifest(projectDir);
        const projectIdx = projectManifest.docs.findIndex((d) => d.id === id);
        if (projectIdx >= 0) {
          projectManifest.docs.splice(projectIdx, 1);
          writeManifest(projectDir, projectManifest);
          this.emit('changed');
          return true;
        }
      }

      return false;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[library-store] remove failed:', err);
      return false;
    }
  }

  // ----- agent-facing, project-locked surface --------------------------------
  //
  // These back the library_* MCP tools. They differ from add/update/remove
  // above in three council-mandated ways (see docs/zcc-library-agent-access):
  //  1. They are LOCKED to one project (the projectId comes from the MCP URL
  //     route, never agent input) — an agent can never reach global scope or
  //     another project.
  //  2. relPath passes the stricter validateAgentRelPath (no dotfiles / no
  //     index.json) AND a realpath confine() against the resolved library dir,
  //     so symlinked parents can't escape the project.
  //  3. source is host-stamped {kind:'agent', sessionId, projectId}; agent
  //     input can't forge attribution, and writes/removes refuse to touch a doc
  //     authored by user/inbox/schedule.

  /** Resolve a project's library dir, throwing if the project is unknown. */
  private projectDirById(projectId: string): string {
    const project = this.projectsRef().find((p) => p.id === projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return projectLibraryDir(project);
  }

  /**
   * Confine an agent-supplied relPath to a project's library dir. Runs the
   * string gate then the realpath guard (symlink/.. escapes). Returns the
   * absolute target path on success; throws with a clear message otherwise.
   */
  private confineAgentPath(dir: string, relPath: string): string {
    validateAgentRelPath(relPath);
    ensureDir(dir);
    const c = confine(dir, join(dir, relPath));
    if (!c.ok) throw new Error(`relPath rejected: ${c.message}`);
    return c.path;
  }

  /** List one project's docs (project scope only). Newest-first. */
  agentList(projectId: string): LibraryDoc[] {
    const dir = this.projectDirById(projectId);
    const docs = reconcile(dir, readManifest(dir));
    return docs
      .map((d) => ({ ...d, scope: 'project' as LibraryScope, projectId, absPath: join(dir, d.relPath) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Read one project doc's content + metadata by relPath. Null if absent. For
   * markdown the front-matter header is stripped so the agent gets back exactly
   * the body it wrote (round-trip symmetry with agentWrite); metadata recovered
   * from the header backfills a missing manifest entry (fresh-clone case).
   */
  agentRead(projectId: string, relPath: string): (LibraryDoc & { content: string }) | null {
    const dir = this.projectDirById(projectId);
    const absPath = this.confineAgentPath(dir, relPath);
    if (!existsSync(absPath)) return null;
    const manifest = readManifest(dir);
    const entry = manifest.docs.find((d) => d.relPath === relPath);
    const st = statSync(absPath);
    // Bound the read so an oversized doc can't OOM the main process (the agent
    // surface must be no weaker than the renderer's fs.readFile cap).
    if (st.size > MAX_AGENT_READ_BYTES) {
      throw new Error(
        `"${relPath}" is too large to read (${st.size} bytes > ${MAX_AGENT_READ_BYTES} limit)`
      );
    }
    const raw = readFileSync(absPath, 'utf8');
    const isMd = kindFromExt(extname(relPath)) === 'md';
    const fm = isMd ? parseFrontMatter(raw) : null;
    const content = fm ? fm.body : raw;
    const base: LibraryDoc =
      entry ?? {
        id: fm?.meta.id ?? '',
        relPath,
        title: fm?.meta.title ?? relPath,
        summary: fm?.meta.summary,
        tags: fm?.meta.tags,
        kind: kindFromExt(extname(relPath)),
        createdAt: fm?.meta.createdAt ?? st.ctimeMs,
        updatedAt: st.mtimeMs,
        bytes: st.size
      };
    return { ...base, scope: 'project', projectId, absPath, content };
  }

  /**
   * Upsert a project doc by relPath. Creates on first write; on a repeat write
   * to the same relPath it overwrites content (when given) and patches metadata
   * in place (keeping the id/createdAt). Omit `content` to update only metadata.
   * Host-stamps source={kind:'agent', sessionId, projectId}. Refuses to clobber
   * a doc authored by user/inbox/schedule. Returns the doc or throws.
   */
  agentWrite(
    projectId: string,
    sessionId: string | undefined,
    input: { relPath: string; title?: string; content?: string; summary?: string; tags?: string[] }
  ): LibraryDoc {
    const dir = this.projectDirById(projectId);
    const absPath = this.confineAgentPath(dir, input.relPath);
    const isMd = kindFromExt(extname(input.relPath)) === 'md';

    const manifest = readManifest(dir);
    const existing = manifest.docs.find((d) => d.relPath === input.relPath);
    // Agent-only mutation gate. A MISSING source is treated as non-agent: an
    // untracked on-disk file (no manifest entry, or an entry with no source —
    // the fresh-clone/user-authored/non-md case, since index.json is gitignored
    // and only agentWrite stamps front-matter) is NOT the agent's to claim. If
    // the doc were genuinely agent-authored it would carry source.kind='agent'
    // (recovered from front-matter on a fresh clone). Refuse anything else.
    if (existing && existing.source?.kind !== 'agent') {
      throw new Error(
        `"${input.relPath}" was authored by ${existing.source?.kind ?? 'a non-agent source'}; agents may only modify agent-authored docs`
      );
    }
    // A file can exist on disk without a manifest entry (untracked): the
    // fresh-clone case (index.json is gitignored) or a user-dropped file. Refuse
    // to overwrite/rewrite it blind — the agent can't prove it authored it. An
    // agent-authored md carries source.kind='agent' in its front-matter (that's
    // how the fresh-clone rebuild recovers it), so allow only that; anything
    // else (user md with no header, or any non-md file) is foreign.
    if (!existing && existsSync(absPath)) {
      const onDiskFm = isMd ? parseFrontMatter(readFileSync(absPath, 'utf8')) : null;
      if (onDiskFm?.meta.sourceKind !== 'agent') {
        throw new Error(
          `"${input.relPath}" already exists on disk and is not agent-authored; agents may only modify agent-authored docs`
        );
      }
    }

    // Resolve the final metadata first so a markdown file can be written WITH a
    // front-matter header (git-trackable: the file self-describes even with no
    // committed index.json). Non-md content is written verbatim.
    const id = existing?.id ?? randomUUID();
    const createdAt = existing?.createdAt ?? Date.now();
    const title = input.title ?? existing?.title ?? input.relPath;
    const summary = input.summary ?? existing?.summary;
    const tags = input.tags ?? existing?.tags;

    if (input.content !== undefined) {
      ensureDir(dirname(absPath));
      const onDisk = isMd
        ? serializeFrontMatter({ id, title, summary, tags, createdAt, sourceKind: 'agent' }, input.content)
        : input.content;
      writeFileSync(absPath, onDisk, 'utf8');
    } else if (!existing && !existsSync(absPath)) {
      throw new Error(`"${input.relPath}" does not exist yet — pass content to create it`);
    } else if (input.content === undefined && isMd && existsSync(absPath)) {
      // Metadata-only edit of an existing md doc: rewrite the header, keep body.
      const fm = parseFrontMatter(readFileSync(absPath, 'utf8'));
      const body = fm ? fm.body : readFileSync(absPath, 'utf8');
      writeFileSync(
        absPath,
        serializeFrontMatter({ id, title, summary, tags, createdAt, sourceKind: 'agent' }, body),
        'utf8'
      );
    }

    let bytes = 0;
    let updatedAt = Date.now();
    if (existsSync(absPath)) {
      const st = statSync(absPath);
      bytes = st.size;
      updatedAt = st.mtimeMs;
    }
    const source: LibraryDoc['source'] = { kind: 'agent', sessionId, projectId };

    let doc: LibraryDoc;
    if (existing) {
      existing.title = title;
      existing.summary = summary;
      existing.tags = tags;
      existing.bytes = bytes;
      existing.updatedAt = updatedAt;
      existing.source = source;
      doc = existing;
    } else {
      doc = {
        id,
        relPath: input.relPath,
        title,
        summary,
        tags,
        kind: kindFromExt(extname(input.relPath)),
        createdAt,
        updatedAt,
        bytes,
        source
      };
      manifest.docs.push(doc);
    }
    writeManifest(dir, manifest);
    this.emit('changed');
    return doc;
  }

  /**
   * Remove a project doc by relPath (de-index AND unlink the file — agents own
   * what they created, so a true delete is safer than leaving orphans the agent
   * thinks are gone). Refuses to remove a user/inbox/schedule-authored doc.
   * Returns true if something was removed.
   */
  agentRemove(projectId: string, relPath: string): boolean {
    const dir = this.projectDirById(projectId);
    const absPath = this.confineAgentPath(dir, relPath);
    const manifest = readManifest(dir);
    const idx = manifest.docs.findIndex((d) => d.relPath === relPath);
    if (idx >= 0) {
      const entry = manifest.docs[idx];
      // Treat a missing source as non-agent (same gate as agentWrite): a
      // tracked-but-sourceless entry is not the agent's to delete.
      if (entry.source?.kind !== 'agent') {
        throw new Error(
          `"${relPath}" was authored by ${entry.source?.kind ?? 'a non-agent source'}; agents may only remove agent-authored docs`
        );
      }
      manifest.docs.splice(idx, 1);
      writeManifest(dir, manifest);
    } else if (existsSync(absPath)) {
      // Untracked on-disk file (no manifest entry): only an agent-authored md
      // (front-matter source=agent) may be removed. A user-dropped file or any
      // non-md file is foreign — refuse rather than unlink it unconditionally.
      const isMd = kindFromExt(extname(relPath)) === 'md';
      const onDiskFm = isMd ? parseFrontMatter(readFileSync(absPath, 'utf8')) : null;
      if (onDiskFm?.meta.sourceKind !== 'agent') {
        throw new Error(
          `"${relPath}" exists on disk but is not agent-authored; agents may only remove agent-authored docs`
        );
      }
    }
    let unlinked = false;
    if (existsSync(absPath)) {
      rmSync(absPath);
      unlinked = true;
    }
    if (idx >= 0 || unlinked) {
      this.emit('changed');
      return true;
    }
    return false;
  }

  /**
   * Open the library dir in Finder/Explorer. For project scope, needs a
   * projectId; for global, omit it.
   */
  async revealDir(
    scope: LibraryScope,
    projectId?: string
  ): Promise<{ ok: boolean; path: string; message?: string }> {
    try {
      const dir =
        scope === 'global'
          ? this.userDir()
          : (() => {
              if (!projectId) throw new Error('projectId is required for project-scope reveal');
              const project = this.projectsRef().find((p) => p.id === projectId);
              if (!project) throw new Error(`Project not found: ${projectId}`);
              return projectLibraryDir(project);
            })();
      ensureDir(dir);
      await shell.openPath(dir);
      return { ok: true, path: dir };
    } catch (err) {
      return {
        ok: false,
        path: '',
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * Hook for store.addProject / store.removeProject. Re-attach project
   * watchers and emit a changed event so the renderer picks up the new
   * project's docs or drops the removed project's docs.
   */
  rebindProjects() {
    for (const w of this.projectWatchers.values()) w.close();
    this.projectWatchers.clear();
    this.attachProjectWatchers();
    this.scheduleRefresh();
  }

  /**
   * Subscribe to change events. Returns a dispose function.
   */
  onChanged(listener: () => void): () => void {
    this.on('changed', listener);
    return () => this.off('changed', listener);
  }

  // ----- internals -----------------------------------------------------------

  private attachUserWatcher() {
    const dir = this.userDir();
    try {
      const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
      w.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error('[library-store] user watcher error:', err);
        try {
          w.close();
        } catch {
          /* already closed */
        }
        if (this.userWatcher === w) this.userWatcher = null;
        setTimeout(() => {
          if (!this.userWatcher) {
            ensureDir(this.userDir());
            this.attachUserWatcher();
            this.scheduleRefresh();
          }
        }, 2_000);
      });
      this.userWatcher = w;
    } catch {
      // Watcher unsupported on this fs — fall back to refresh-on-demand.
    }
  }

  private attachProjectWatchers() {
    for (const project of this.projectsRef()) {
      const dir = projectLibraryDir(project);
      if (!existsSync(dir)) continue;
      try {
        const w = watch(dir, { persistent: false }, () => this.scheduleRefresh());
        const projectId = project.id;
        w.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error(`[library-store] project ${projectId} watcher error:`, err);
          try {
            w.close();
          } catch {
            /* already closed */
          }
          if (this.projectWatchers.get(projectId) === w) {
            this.projectWatchers.delete(projectId);
          }
          this.scheduleRefresh();
        });
        this.projectWatchers.set(projectId, w);
      } catch {
        // ignore — same fallback as user dir.
      }
    }
  }

  /** Coalesce burst events (editor save = create+rename+modify on most fs). */
  private scheduleRefresh() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.emit('changed');
    }, 150);
  }
}

// ==================== In-memory store (tests) ====================

export function createMemoryLibraryStore(): ILibraryStore {
  const docs: LibraryDoc[] = [];
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  function snapshot(): LibraryDoc[] {
    return [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function list(): LibraryDoc[] {
    return snapshot();
  }

  function search(query: string): LibrarySearchResult {
    const needle = query.trim().toLowerCase();
    if (!needle) return { hits: [], truncated: false };
    const hits: LibrarySearchHit[] = [];
    for (const doc of snapshot()) {
      if (!doc.absPath) continue;
      if (doc.kind !== 'md' && doc.kind !== 'code') continue;
      const body = (doc as { content?: string }).content ?? '';
      const lines = body.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].toLowerCase().includes(needle)) continue;
        hits.push({ absPath: doc.absPath, scope: doc.scope, line: i + 1, preview: lines[i].trim() });
        break;
      }
    }
    return { hits, truncated: false };
  }

  function add(input: LibraryAddInput): LibraryDoc | null {
    try {
      validateRelPath(input.relPath);
      if (input.scope === 'project' && !input.projectId) {
        throw new Error('projectId is required for project-scope docs');
      }
      const ext = extname(input.relPath);
      const kind = kindFromExt(ext);
      const doc: LibraryDoc = {
        id: randomUUID(),
        relPath: input.relPath,
        title: input.title,
        summary: input.summary,
        tags: input.tags,
        kind,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: input.source,
        scope: input.scope,
        absPath: `/fake/${input.relPath}`,
        projectId: input.projectId
      };
      docs.push(doc);
      emitter.emit('changed');
      return doc;
    } catch {
      return null;
    }
  }

  function update(
    id: string,
    patch: Partial<Pick<LibraryDoc, 'title' | 'summary' | 'tags'>>
  ): LibraryDoc | null {
    const doc = docs.find((d) => d.id === id);
    if (!doc) return null;
    if (patch.title !== undefined) doc.title = patch.title;
    if (patch.summary !== undefined) doc.summary = patch.summary;
    if (patch.tags !== undefined) doc.tags = patch.tags;
    doc.updatedAt = Date.now();
    emitter.emit('changed');
    return doc;
  }

  function remove(id: string): boolean {
    const idx = docs.findIndex((d) => d.id === id);
    if (idx < 0) return false;
    docs.splice(idx, 1);
    emitter.emit('changed');
    return true;
  }

  async function revealDir(): Promise<{ ok: boolean; path: string; message?: string }> {
    return { ok: true, path: '/fake/library' };
  }

  function onChanged(listener: () => void): () => void {
    emitter.on('changed', listener);
    return () => emitter.off('changed', listener);
  }

  // Agent-facing surface: project-locked views over the in-memory docs. Mirrors
  // the disk store's guards (validateAgentRelPath, agent-only mutation) minus
  // the realpath confine (no real fs in the memory store).
  function agentList(projectId: string): LibraryDoc[] {
    return docs
      .filter((d) => d.scope === 'project' && d.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function agentRead(projectId: string, relPath: string): (LibraryDoc & { content: string }) | null {
    validateAgentRelPath(relPath);
    const doc = docs.find((d) => d.projectId === projectId && d.relPath === relPath);
    return doc ? { ...doc, content: (doc as { content?: string }).content ?? '' } : null;
  }

  function agentWrite(
    projectId: string,
    sessionId: string | undefined,
    input: { relPath: string; title?: string; content?: string; summary?: string; tags?: string[] }
  ): LibraryDoc {
    validateAgentRelPath(input.relPath);
    const existing = docs.find((d) => d.projectId === projectId && d.relPath === input.relPath);
    if (existing && existing.source?.kind !== 'agent') {
      throw new Error(`"${input.relPath}" was authored by ${existing.source?.kind ?? 'a non-agent source'}`);
    }
    const source: LibraryDoc['source'] = { kind: 'agent', sessionId, projectId };
    if (existing) {
      if (input.title !== undefined) existing.title = input.title;
      if (input.summary !== undefined) existing.summary = input.summary;
      if (input.tags !== undefined) existing.tags = input.tags;
      if (input.content !== undefined) (existing as { content?: string }).content = input.content;
      existing.updatedAt = Date.now();
      existing.source = source;
      emitter.emit('changed');
      return existing;
    }
    const doc: LibraryDoc & { content?: string } = {
      id: randomUUID(),
      relPath: input.relPath,
      title: input.title ?? input.relPath,
      summary: input.summary,
      tags: input.tags,
      kind: kindFromExt(extname(input.relPath)),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source,
      scope: 'project',
      absPath: `/fake/${projectId}/${input.relPath}`,
      projectId,
      content: input.content ?? ''
    };
    docs.push(doc);
    emitter.emit('changed');
    return doc;
  }

  function readContent(scope: LibraryScope, relPath: string, projectId?: string): FsReadResult {
    const doc = docs.find(
      (d) => d.relPath === relPath && (scope === 'project' ? d.projectId === projectId : d.scope !== 'project')
    );
    if (!doc) return { ok: false, message: 'Not a file' };
    const content = (doc as { content?: string }).content ?? '';
    return { ok: true, content, bytes: Buffer.byteLength(content, 'utf8'), binary: false };
  }

  function writeContent(scope: LibraryScope, relPath: string, content: string, projectId?: string): FsWriteResult {
    const doc = docs.find(
      (d) => d.relPath === relPath && (scope === 'project' ? d.projectId === projectId : d.scope !== 'project')
    );
    if (!doc) return { ok: false, message: 'Not a regular file' };
    (doc as { content?: string }).content = content;
    doc.updatedAt = Date.now();
    emitter.emit('changed');
    return { ok: true, bytes: Buffer.byteLength(content, 'utf8') };
  }

  function agentRemove(projectId: string, relPath: string): boolean {
    validateAgentRelPath(relPath);
    const idx = docs.findIndex((d) => d.projectId === projectId && d.relPath === relPath);
    if (idx < 0) return false;
    const entry = docs[idx];
    if (entry.source?.kind !== 'agent') {
      throw new Error(`"${relPath}" was authored by ${entry.source?.kind ?? 'a non-agent source'}`);
    }
    docs.splice(idx, 1);
    emitter.emit('changed');
    return true;
  }

  // Folders are implicit (no real fs) — a "create folder" is a no-op success;
  // the folder becomes visible once a doc is added under it.
  function createFolder(): FsMutateResult {
    return { ok: true };
  }

  function scopeMatches(doc: LibraryDoc, scope: LibraryScope, projectId?: string): boolean {
    return scope === 'project' ? doc.scope === 'project' && doc.projectId === projectId : doc.scope !== 'project';
  }

  function moveEntry(
    from: { scope: LibraryScope; relPath: string; projectId?: string },
    to: { scope: LibraryScope; relPath: string; projectId?: string }
  ): FsMutateResult {
    validateRelPath(from.relPath);
    validateRelPath(to.relPath);
    const prefix = from.relPath.endsWith('/') ? from.relPath : `${from.relPath}/`;
    let moved = false;
    for (const doc of docs) {
      if (!scopeMatches(doc, from.scope, from.projectId)) continue;
      if (doc.relPath === from.relPath) {
        doc.relPath = to.relPath;
      } else if (doc.relPath.startsWith(prefix)) {
        doc.relPath = `${to.relPath}${doc.relPath.slice(from.relPath.length)}`;
      } else {
        continue;
      }
      doc.scope = to.scope === 'project' ? 'project' : 'global';
      doc.projectId = to.scope === 'project' ? to.projectId : undefined;
      doc.updatedAt = Date.now();
      moved = true;
    }
    if (!moved) return { ok: false, message: 'Source no longer exists' };
    emitter.emit('changed');
    return { ok: true };
  }

  function deleteEntry(scope: LibraryScope, relPath: string, projectId?: string): FsMutateResult {
    validateRelPath(relPath);
    const prefix = relPath.endsWith('/') ? relPath : `${relPath}/`;
    const before = docs.length;
    for (let i = docs.length - 1; i >= 0; i--) {
      const doc = docs[i];
      if (!scopeMatches(doc, scope, projectId)) continue;
      if (doc.relPath === relPath || doc.relPath.startsWith(prefix)) docs.splice(i, 1);
    }
    if (docs.length === before) return { ok: false, message: 'Path no longer exists' };
    emitter.emit('changed');
    return { ok: true };
  }

  return {
    list,
    search,
    add,
    update,
    remove,
    revealDir,
    readContent,
    writeContent,
    createFolder,
    moveEntry,
    deleteEntry,
    onChanged,
    agentList,
    agentRead,
    agentWrite,
    agentRemove,
    userDir: () => join(app.getPath('home'), '.zcc', 'library')
  };
}

export interface ILibraryStore {
  start?(): void;
  stop?(): void;
  rebindProjects?(): void;
  list(): LibraryDoc[];
  search(query: string): LibrarySearchResult;
  add(input: LibraryAddInput): LibraryDoc | null;
  update(
    id: string,
    patch: Partial<Pick<LibraryDoc, 'title' | 'summary' | 'tags'>>
  ): LibraryDoc | null;
  remove(id: string): boolean;
  revealDir(
    scope: LibraryScope,
    projectId?: string
  ): Promise<{ ok: boolean; path: string; message?: string }>;
  readContent(scope: LibraryScope, relPath: string, projectId?: string): FsReadResult;
  writeContent(scope: LibraryScope, relPath: string, content: string, projectId?: string): FsWriteResult;
  /** Create a folder at scope+relPath (and missing parents) for the folder-tree UI. */
  createFolder(scope: LibraryScope, relPath: string, projectId?: string): FsMutateResult;
  /** Move/rename a file or folder, possibly across scopes. */
  moveEntry(
    from: { scope: LibraryScope; relPath: string; projectId?: string },
    to: { scope: LibraryScope; relPath: string; projectId?: string }
  ): FsMutateResult;
  /** Permanently delete a file or folder (recursive), removing any manifest entries under it. */
  deleteEntry(scope: LibraryScope, relPath: string, projectId?: string): FsMutateResult;
  /** Absolute path of the global (`~/.zcc/library`) dir — a confinement anchor
   *  for reading global-scope doc assets (e.g. image data URLs) that live
   *  outside any registered project. */
  userDir(): string;
  onChanged(listener: () => void): () => void;
  // Agent-facing, project-locked surface (backs the library_* MCP tools).
  agentList(projectId: string): LibraryDoc[];
  agentRead(projectId: string, relPath: string): (LibraryDoc & { content: string }) | null;
  agentWrite(
    projectId: string,
    sessionId: string | undefined,
    input: { relPath: string; title?: string; content?: string; summary?: string; tags?: string[] }
  ): LibraryDoc;
  agentRemove(projectId: string, relPath: string): boolean;
}
