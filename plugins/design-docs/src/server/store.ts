import { randomBytes } from 'node:crypto';
import type { PluginDatabase } from '@zana-ai/zcc-plugin-sdk/server';
import {
  isDocStatus,
  type CommentStatus,
  type DesignDocComment,
  type DesignDocDetail,
  type DesignDocFile,
  type DesignDocFileMeta,
  type DesignDocRevision,
  type DesignDocSummary,
  type DesignDocThreadLink,
  type DocActor,
  type DocStatus,
  type RevisionOp,
  type TextEdit,
  type ThreadRole
} from '../shared/contract.js';
import {
  DEFAULT_LIST_LIMIT,
  LARGE_TEXT_FILE_BYTES,
  MAX_BINARY_FILE_BYTES,
  MAX_BINARY_REVISIONS_PER_FILE,
  MAX_COMMENTS_PER_DOC,
  MAX_COMMENT_LENGTH,
  MAX_DOC_BYTES,
  MAX_EDITS_PER_CALL,
  MAX_FILES_PER_DOC,
  MAX_HISTORY_BYTES_PER_DOC,
  MAX_HISTORY_LIMIT,
  MAX_LARGE_TEXT_REVISIONS_PER_FILE,
  MAX_LIST_LIMIT,
  MAX_NOTE_LENGTH,
  MAX_QUOTE_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_TEXT_FILE_BYTES,
  MAX_TEXT_REVISIONS_PER_FILE,
  MAX_THREAD_LINKS_PER_DOC,
  MAX_TITLE_LENGTH
} from '../shared/limits.js';
import { actorLabel, formatBytes } from '../shared/display.js';
import {
  DesignDocPathError,
  comparePaths,
  fileKindOf,
  isBinaryKind,
  normalizeDocPath
} from '../shared/paths.js';
import { DEFAULT_TEMPLATE_ID, renderTemplateFiles, templateById } from '../shared/templates.js';
import { DESIGN_DOC_MIGRATIONS } from './schema.js';

/** An agent whose thread has no title yet. Never stored over a real title. */
export const AGENT_FALLBACK_LABEL = 'Agent';
/** A terminal session (CLI Agent) calling the CLI: there is no thread to link. */
export const CLI_AGENT_LABEL = 'CLI agent';

export type DesignDocErrorCode = 'not_found' | 'conflict' | 'invalid' | 'limit';

export class DesignDocError extends Error {
  constructor(
    readonly code: DesignDocErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DesignDocError';
  }
}

export interface ListFilter {
  /** Docs of this project plus global (project-less) docs. Omit for every doc. */
  projectId?: string | null;
  query?: string;
  /** Also match `query` inside file contents. Default true; typeahead turns it off. */
  contents?: boolean;
  /** `active` hides archived docs; `all` shows everything. Default `all`. */
  status?: DocStatus | 'active' | 'all';
  limit?: number;
}

export interface CreateDocInput {
  title: string;
  summary?: string;
  projectId?: string | null;
  tags?: string[];
  status?: DocStatus;
  template?: string;
  /** Initial files; when given they replace the template's files. */
  files?: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>;
  entryPath?: string;
}

export interface UpdateDocInput {
  title?: string;
  summary?: string;
  status?: DocStatus;
  tags?: string[];
  entryPath?: string;
  projectId?: string | null;
}

export interface WriteFileInput {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
  baseRevision?: number;
  note?: string;
}

export interface WriteResult extends DesignDocFileMeta {
  docId: string;
  created: boolean;
}

interface DocRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: string;
  project_id: string | null;
  tags: string;
  entry_path: string;
  revision: number;
  created_at: number;
  updated_at: number;
  created_by: string;
  updated_by: string;
  file_count?: number;
  open_comments?: number;
}

interface FileRow {
  doc_id: string;
  path: string;
  content: string;
  encoding: string;
  size: number;
  revision: number;
  updated_at: number;
  updated_by: string;
}

interface RevisionRow {
  id: number;
  doc_id: string;
  path: string;
  revision: number;
  op: string;
  content: string;
  encoding: string;
  size: number;
  note: string | null;
  renamed_from: string | null;
  actor: string;
  created_at: number;
}

interface CommentRow {
  id: string;
  doc_id: string;
  path: string | null;
  quote: string | null;
  body: string;
  author: string;
  status: string;
  created_at: number;
  resolved_at: number | null;
  parent_id: string | null;
}

interface ThreadRow {
  thread_id: string;
  title: string;
  role: string;
  last_activity_at: number;
}

const ROLE_RANK: Record<ThreadRole, number> = { assistant: 1, reviewer: 2, editor: 3, author: 4 };

const SUMMARY_COLUMNS = `d.*,
  (SELECT COUNT(*) FROM doc_files f WHERE f.doc_id = d.id) AS file_count,
  (SELECT COUNT(*) FROM doc_comments c WHERE c.doc_id = d.id AND c.status = 'open' AND c.parent_id IS NULL) AS open_comments`;

export interface DesignDocStoreOptions {
  now?: () => number;
  randomId?: (prefix: string) => string;
  /** History kept per doc before the oldest snapshots go; tests lower it. */
  maxHistoryBytes?: number;
}

export class DesignDocStore {
  private readonly now: () => number;
  private readonly randomId: (prefix: string) => string;
  private readonly maxHistoryBytes: number;

  constructor(
    private readonly db: PluginDatabase,
    options: DesignDocStoreOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? ((prefix) => `${prefix}${randomBytes(6).toString('hex')}`);
    this.maxHistoryBytes = options.maxHistoryBytes ?? MAX_HISTORY_BYTES_PER_DOC;
    db.migrate(DESIGN_DOC_MIGRATIONS);
  }

  // ── Docs ──────────────────────────────────────────────────────────────

  list(filter: ListFilter = {}): DesignDocSummary[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId !== undefined) {
      if (filter.projectId === null) {
        where.push('d.project_id IS NULL');
      } else {
        where.push('(d.project_id = ? OR d.project_id IS NULL)');
        params.push(filter.projectId);
      }
    }
    const status = filter.status ?? 'all';
    if (status === 'active') where.push(`d.status <> 'archived'`);
    else if (status !== 'all') {
      if (!isDocStatus(status)) throw new DesignDocError('invalid', `unknown status ${JSON.stringify(status)}`);
      where.push('d.status = ?');
      params.push(status);
    }
    const query = typeof filter.query === 'string' ? filter.query.trim() : '';
    if (query) {
      // LIKE ignores ASCII case by itself. Keep the query as typed: lowercasing
      // it in JS would miss "Été", which SQLite cannot fold.
      const like = `%${escapeLike(query)}%`;
      const contents =
        filter.contents === false
          ? ''
          : ` OR EXISTS (SELECT 1 FROM doc_files f WHERE f.doc_id = d.id AND f.encoding = 'utf8'
          AND f.content LIKE ? ESCAPE '\\')`;
      where.push(`(d.title LIKE ? ESCAPE '\\' OR d.summary LIKE ? ESCAPE '\\'
        OR d.slug LIKE ? ESCAPE '\\' OR d.tags LIKE ? ESCAPE '\\'${contents})`);
      params.push(like, like, like, like);
      if (contents) params.push(like);
    }
    const limit = clampLimit(filter.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const sql = `SELECT ${SUMMARY_COLUMNS} FROM docs d
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY d.updated_at DESC, d.id LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit) as DocRow[];
    return rows.map(toSummary);
  }

  /** Look up a doc by id or slug; `null` when absent. */
  find(ref: unknown): DesignDocSummary | null {
    const row = this.findRow(ref);
    return row ? toSummary(row) : null;
  }

  /** Like `find`, but throws a `not_found` error the agent can act on. */
  summary(ref: unknown): DesignDocSummary {
    return toSummary(this.requireRow(ref));
  }

  get(ref: unknown): DesignDocDetail {
    const row = this.requireRow(ref);
    const files = (
      this.db
        .prepare(
          'SELECT doc_id, path, encoding, size, revision, updated_at, updated_by FROM doc_files WHERE doc_id = ?'
        )
        .all(row.id) as FileRow[]
    )
      .map(toFileMeta)
      .sort((a, b) => comparePaths(a.path, b.path));
    const comments = toComments(
      this.db.prepare('SELECT * FROM doc_comments WHERE doc_id = ? ORDER BY created_at, rowid').all(row.id) as CommentRow[]
    );
    const threads = (
      this.db
        .prepare(
          'SELECT thread_id, title, role, last_activity_at FROM doc_threads WHERE doc_id = ? ORDER BY last_activity_at DESC'
        )
        .all(row.id) as ThreadRow[]
    ).map(toThreadLink);
    return { ...toSummary(row), files, comments, threads };
  }

  create(input: CreateDocInput, actor: DocActor): DesignDocDetail {
    const title = cleanTitle(input.title);
    const summary = cleanSummary(input.summary ?? '');
    const tags = cleanTags(input.tags ?? []);
    const status = input.status ?? 'draft';
    if (!isDocStatus(status)) throw new DesignDocError('invalid', `unknown status ${JSON.stringify(status)}`);

    let files: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>;
    let templateEntry: string | undefined;
    if (input.files && input.files.length > 0) {
      files = input.files;
    } else {
      const template = templateById(input.template ?? DEFAULT_TEMPLATE_ID);
      if (!template) {
        throw new DesignDocError('invalid', `unknown template ${JSON.stringify(input.template)}`);
      }
      files = renderTemplateFiles(template, { title, summary });
      templateEntry = template.entryPath;
    }
    if (files.length > MAX_FILES_PER_DOC) {
      throw new DesignDocError('limit', `a design doc holds at most ${MAX_FILES_PER_DOC} files`);
    }
    const prepared = files.map((file) => prepareContent(file.path, file.content, file.encoding));
    const seen = new Set<string>();
    for (const file of prepared) {
      const key = file.path.toLowerCase();
      if (seen.has(key)) throw new DesignDocError('invalid', `duplicate file path ${file.path}`);
      seen.add(key);
    }
    const total = prepared.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_DOC_BYTES) {
      throw new DesignDocError('limit', `a design doc holds at most ${formatBytes(MAX_DOC_BYTES)}`);
    }
    // A site opens on its home page; a written doc on its README.
    const entryPath = input.entryPath
      ? normalizePath(input.entryPath)
      : (templateEntry ??
        prepared.find((file) => file.path.toLowerCase() === 'readme.md')?.path ??
        prepared.find((file) => file.path.toLowerCase() === 'index.html')?.path ??
        prepared.find((file) => fileKindOf(file.path) === 'markdown')?.path ??
        prepared[0]!.path);
    if (!prepared.some((file) => file.path === entryPath)) {
      throw new DesignDocError('invalid', `entryPath ${entryPath} is not one of the doc's files`);
    }

    const id = this.randomId('dd_');
    const at = this.now();
    const actorJson = JSON.stringify(actor);
    this.db.transaction(() => {
      const slug = this.uniqueSlug(slugify(title));
      this.db
        .prepare(
          `INSERT INTO docs (id, slug, title, summary, status, project_id, tags, entry_path, revision,
            created_at, updated_at, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
        )
        .run(
          id,
          slug,
          title,
          summary,
          status,
          input.projectId ?? null,
          JSON.stringify(tags),
          entryPath,
          at,
          at,
          actorJson,
          actorJson
        );
      for (const file of prepared) {
        this.insertFile(id, file, 1, at, actorJson);
        this.recordRevision(id, file.path, 1, 'create', file, actorJson, at, { note: 'Created' });
      }
      if (actor.threadId) this.linkThreadRow(id, actor.threadId, actor.label, 'author', at);
    });
    return this.get(id);
  }

  update(ref: unknown, patch: UpdateDocInput, actor: DocActor): DesignDocSummary {
    const row = this.requireRow(ref);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(cleanTitle(patch.title));
    }
    if (patch.summary !== undefined) {
      sets.push('summary = ?');
      params.push(cleanSummary(patch.summary));
    }
    if (patch.status !== undefined) {
      if (!isDocStatus(patch.status)) {
        throw new DesignDocError('invalid', `unknown status ${JSON.stringify(patch.status)}`);
      }
      sets.push('status = ?');
      params.push(patch.status);
    }
    if (patch.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(cleanTags(patch.tags)));
    }
    if (patch.entryPath !== undefined) {
      const entryPath = normalizePath(patch.entryPath);
      if (!this.fileRow(row.id, entryPath)) {
        throw new DesignDocError('invalid', `entryPath ${entryPath} is not one of the doc's files`);
      }
      sets.push('entry_path = ?');
      params.push(entryPath);
    }
    if (patch.projectId !== undefined) {
      sets.push('project_id = ?');
      params.push(patch.projectId);
    }
    if (sets.length === 0) return toSummary(this.requireRow(row.id));
    this.db.transaction(() => {
      this.db.prepare(`UPDATE docs SET ${sets.join(', ')} WHERE id = ?`).run(...params, row.id);
      this.touch(row.id, actor);
    });
    return toSummary(this.requireRow(row.id));
  }

  remove(ref: unknown): void {
    const row = this.requireRow(ref);
    this.db.transaction(() => {
      for (const table of ['doc_files', 'doc_revisions', 'doc_comments', 'doc_threads']) {
        this.db.prepare(`DELETE FROM ${table} WHERE doc_id = ?`).run(row.id);
      }
      this.db.prepare('DELETE FROM docs WHERE id = ?').run(row.id);
    });
  }

  // ── Files ─────────────────────────────────────────────────────────────

  readFile(ref: unknown, rawPath: unknown): DesignDocFile {
    const row = this.requireRow(ref);
    const path = normalizePath(rawPath);
    const file = this.fileRow(row.id, path);
    if (!file) throw this.missingFile(row.id, path);
    return { ...toFileMeta(file), content: file.content, encoding: file.encoding === 'base64' ? 'base64' : 'utf8' };
  }

  /** Every file with content, sorted, for bundles and exports. */
  readAllFiles(ref: unknown): DesignDocFile[] {
    const row = this.requireRow(ref);
    return (this.db.prepare('SELECT * FROM doc_files WHERE doc_id = ?').all(row.id) as FileRow[])
      .map((file) => ({
        ...toFileMeta(file),
        content: file.content,
        encoding: file.encoding === 'base64' ? ('base64' as const) : ('utf8' as const)
      }))
      .sort((a, b) => comparePaths(a.path, b.path));
  }

  writeFile(ref: unknown, input: WriteFileInput, actor: DocActor): WriteResult {
    const row = this.requireRow(ref);
    const prepared = prepareContent(input.path, input.content, input.encoding);
    const note = cleanNote(input.note);
    return this.db.transaction(() => {
      const existing = this.fileRow(row.id, prepared.path);
      checkBaseRevision(prepared.path, existing, input.baseRevision);
      if (!existing) this.assertCanAdd(row.id, prepared.path);
      this.assertDocBudget(row.id, prepared.size - (existing?.size ?? 0));
      const at = this.now();
      const actorJson = JSON.stringify(actor);
      let revision: number;
      if (existing) {
        if (existing.content === prepared.content && existing.encoding === prepared.encoding) {
          return { ...toFileMeta(existing), docId: row.id, created: false };
        }
        revision = existing.revision + 1;
        this.db
          .prepare(
            `UPDATE doc_files SET content = ?, encoding = ?, size = ?, revision = ?, updated_at = ?, updated_by = ?
              WHERE doc_id = ? AND path = ?`
          )
          .run(prepared.content, prepared.encoding, prepared.size, revision, at, actorJson, row.id, prepared.path);
      } else {
        revision = this.nextRevisionFor(row.id, prepared.path);
        this.insertFile(row.id, prepared, revision, at, actorJson);
      }
      this.recordRevision(row.id, prepared.path, revision, existing ? 'write' : 'create', prepared, actorJson, at, {
        note
      });
      this.touch(row.id, actor, at);
      if (actor.threadId) this.linkThreadRow(row.id, actor.threadId, actor.label, 'editor', at);
      const meta = toFileMeta(this.fileRow(row.id, prepared.path)!);
      return { ...meta, docId: row.id, created: !existing };
    });
  }

  /** Several files as one change: every write lands, or none does. */
  writeFiles(ref: unknown, files: WriteFileInput[], actor: DocActor): WriteResult[] {
    const row = this.requireRow(ref);
    return this.db.transaction(() => files.map((file) => this.writeFile(row.id, file, actor)));
  }

  /** Exact-match string edits, applied in order — the same contract as an agent Edit tool. */
  editFile(
    ref: unknown,
    input: { path: string; edits: TextEdit[]; baseRevision?: number; note?: string },
    actor: DocActor
  ): WriteResult {
    const row = this.requireRow(ref);
    const path = normalizePath(input.path);
    if (!Array.isArray(input.edits) || input.edits.length === 0) {
      throw new DesignDocError('invalid', 'edits must be a non-empty array');
    }
    if (input.edits.length > MAX_EDITS_PER_CALL) {
      throw new DesignDocError('limit', `at most ${MAX_EDITS_PER_CALL} edits per call`);
    }
    return this.db.transaction(() => {
      const existing = this.fileRow(row.id, path);
      if (!existing) throw this.missingFile(row.id, path);
      if (existing.encoding === 'base64') {
        throw new DesignDocError('invalid', `${path} is a binary file; write it whole instead of editing`);
      }
      checkBaseRevision(path, existing, input.baseRevision);
      const content = applyEdits(existing.content, input.edits, path);
      return this.writeFile(
        row.id,
        { path, content, baseRevision: existing.revision, note: input.note },
        actor
      );
    });
  }

  deleteFile(
    ref: unknown,
    rawPath: unknown,
    actor: DocActor,
    options: { baseRevision?: number; note?: string } = {}
  ): void {
    const row = this.requireRow(ref);
    const path = normalizePath(rawPath);
    this.db.transaction(() => {
      const existing = this.fileRow(row.id, path);
      if (!existing) throw this.missingFile(row.id, path);
      checkBaseRevision(path, existing, options.baseRevision);
      const count = this.fileCount(row.id);
      if (count <= 1) throw new DesignDocError('invalid', 'a design doc must keep at least one file');
      const at = this.now();
      const actorJson = JSON.stringify(actor);
      this.db.prepare('DELETE FROM doc_files WHERE doc_id = ? AND path = ?').run(row.id, path);
      this.recordRevision(row.id, path, existing.revision + 1, 'delete', existing, actorJson, at, {
        note: cleanNote(options.note)
      });
      if (row.entry_path === path) {
        const next = this.firstFilePath(row.id);
        this.db.prepare('UPDATE docs SET entry_path = ? WHERE id = ?').run(next, row.id);
      }
      this.touch(row.id, actor, at);
      if (actor.threadId) this.linkThreadRow(row.id, actor.threadId, actor.label, 'editor', at);
    });
  }

  renameFile(
    ref: unknown,
    rawFrom: unknown,
    rawTo: unknown,
    actor: DocActor,
    options: { baseRevision?: number; note?: string } = {}
  ): WriteResult {
    const row = this.requireRow(ref);
    const from = normalizePath(rawFrom);
    const to = normalizePath(rawTo);
    if (from === to) throw new DesignDocError('invalid', 'renameTo must differ from path');
    return this.db.transaction(() => {
      const existing = this.fileRow(row.id, from);
      if (!existing) throw this.missingFile(row.id, from);
      checkBaseRevision(from, existing, options.baseRevision);
      if (isBinaryKind(fileKindOf(from)) !== isBinaryKind(fileKindOf(to))) {
        throw new DesignDocError('invalid', `cannot rename ${from} to ${to}: the file type would change encoding`);
      }
      const clash = this.caseInsensitiveClash(row.id, to, from);
      if (clash) throw new DesignDocError('conflict', `${clash} already exists in this design doc`);
      const at = this.now();
      const actorJson = JSON.stringify(actor);
      const note = cleanNote(options.note);
      const deletedRevision = existing.revision + 1;
      this.db.prepare('DELETE FROM doc_files WHERE doc_id = ? AND path = ?').run(row.id, from);
      this.recordRevision(row.id, from, deletedRevision, 'delete', existing, actorJson, at, {
        note: note ?? `Renamed to ${to}`
      });
      const revision = this.nextRevisionFor(row.id, to);
      const moved = { path: to, content: existing.content, encoding: existing.encoding, size: existing.size };
      this.insertFile(row.id, moved, revision, at, actorJson);
      this.recordRevision(row.id, to, revision, 'rename', moved, actorJson, at, { note, renamedFrom: from });
      // Comments follow the file so they stay anchored (and filterable) after a move.
      this.db.prepare('UPDATE doc_comments SET path = ? WHERE doc_id = ? AND path = ?').run(to, row.id, from);
      if (row.entry_path === from) {
        this.db.prepare('UPDATE docs SET entry_path = ? WHERE id = ?').run(to, row.id);
      }
      this.touch(row.id, actor, at);
      if (actor.threadId) this.linkThreadRow(row.id, actor.threadId, actor.label, 'editor', at);
      return { ...toFileMeta(this.fileRow(row.id, to)!), docId: row.id, created: true };
    });
  }

  // ── History ───────────────────────────────────────────────────────────

  history(ref: unknown, options: { path?: string; limit?: number } = {}): DesignDocRevision[] {
    const row = this.requireRow(ref);
    const limit = clampLimit(options.limit, 50, MAX_HISTORY_LIMIT);
    const columns = 'id, doc_id, path, revision, op, size, note, renamed_from, actor, created_at';
    const rows = options.path
      ? (this.db
          .prepare(`SELECT ${columns} FROM doc_revisions WHERE doc_id = ? AND path = ? ORDER BY id DESC LIMIT ?`)
          .all(row.id, normalizePath(options.path), limit) as RevisionRow[])
      : (this.db
          .prepare(`SELECT ${columns} FROM doc_revisions WHERE doc_id = ? ORDER BY id DESC LIMIT ?`)
          .all(row.id, limit) as RevisionRow[]);
    return rows.map(toRevision);
  }

  revisionContent(ref: unknown, revisionId: unknown): DesignDocRevision & { content: string; encoding: 'utf8' | 'base64' } {
    const row = this.requireRow(ref);
    const revision = this.revisionRow(row.id, revisionId);
    return {
      ...toRevision(revision),
      content: revision.content,
      encoding: revision.encoding === 'base64' ? 'base64' : 'utf8'
    };
  }

  /**
   * Write a past snapshot back as the newest revision (recreating a deleted
   * file). `baseRevision` is the file's revision the caller saw, 0 if absent.
   */
  restoreRevision(ref: unknown, revisionId: unknown, actor: DocActor, options: { baseRevision?: number } = {}): WriteResult {
    const row = this.requireRow(ref);
    const revision = this.revisionRow(row.id, revisionId);
    return this.writeFile(
      row.id,
      {
        path: revision.path,
        content: revision.content,
        encoding: revision.encoding === 'base64' ? 'base64' : 'utf8',
        baseRevision: options.baseRevision,
        note: `Restored revision ${revision.revision}`
      },
      actor
    );
  }

  // ── Comments ──────────────────────────────────────────────────────────

  addComment(
    ref: unknown,
    input: { body: string; path?: string | null; quote?: string | null },
    actor: DocActor
  ): DesignDocComment {
    const row = this.requireRow(ref);
    const body = cleanCommentBody(input.body);
    const path = input.path ? normalizePath(input.path) : null;
    if (path && !this.fileRow(row.id, path)) throw this.missingFile(row.id, path);
    const quote = typeof input.quote === 'string' && input.quote.trim() ? input.quote.trim().slice(0, MAX_QUOTE_LENGTH) : null;
    const id = this.randomId('c_');
    const at = this.now();
    this.db.transaction(() => {
      this.insertComment(row.id, { id, parentId: null, path, quote, body }, actor, at);
      this.touchReview(row.id);
      if (actor.threadId) this.linkThreadRow(row.id, actor.threadId, actor.label, 'reviewer', at);
    });
    return this.commentById(row.id, id);
  }

  /** Answer a comment in its thread; returns the comment with every reply. */
  addReply(ref: unknown, commentId: unknown, rawBody: unknown, actor: DocActor): DesignDocComment {
    const row = this.requireRow(ref);
    const body = cleanCommentBody(rawBody);
    const at = this.now();
    let rootId = '';
    this.db.transaction(() => {
      rootId = this.rootComment(row, commentId).id;
      this.insertComment(row.id, { id: this.randomId('c_'), parentId: rootId, path: null, quote: null, body }, actor, at);
      this.touchReview(row.id);
      if (actor.threadId) this.linkThreadRow(row.id, actor.threadId, actor.label, 'reviewer', at);
    });
    return this.commentById(row.id, rootId);
  }

  /** Resolve or reopen a comment; `note` is added as a reply in the same step. */
  setCommentStatus(
    ref: unknown,
    commentId: unknown,
    status: CommentStatus,
    actor: DocActor,
    note?: string | null
  ): DesignDocComment {
    const row = this.requireRow(ref);
    if (status !== 'open' && status !== 'resolved') {
      throw new DesignDocError('invalid', `unknown comment status ${JSON.stringify(status)}`);
    }
    const reply = typeof note === 'string' && note.trim() ? cleanCommentBody(note) : null;
    const at = this.now();
    let rootId = '';
    this.db.transaction(() => {
      rootId = this.rootComment(row, commentId).id;
      this.db
        .prepare('UPDATE doc_comments SET status = ?, resolved_at = ? WHERE doc_id = ? AND id = ?')
        .run(status, status === 'resolved' ? at : null, row.id, rootId);
      if (reply) {
        this.insertComment(row.id, { id: this.randomId('c_'), parentId: rootId, path: null, quote: null, body: reply }, actor, at);
      }
      this.touchReview(row.id);
      if (actor.threadId) this.linkThreadRow(row.id, actor.threadId, actor.label, 'reviewer', at);
    });
    return this.commentById(row.id, rootId);
  }

  /** Delete a reply, or a comment together with its replies. */
  deleteComment(ref: unknown, commentId: unknown, actor: DocActor): void {
    const row = this.requireRow(ref);
    const id = String(commentId ?? '');
    this.db.transaction(() => {
      const result = this.db.prepare('DELETE FROM doc_comments WHERE doc_id = ? AND id = ?').run(row.id, id);
      if (result.changes === 0) throw new DesignDocError('not_found', `comment ${id} not found in ${row.slug}`);
      this.db.prepare('DELETE FROM doc_comments WHERE doc_id = ? AND parent_id = ?').run(row.id, id);
      this.touchReview(row.id);
    });
  }

  // ── Agent threads ─────────────────────────────────────────────────────

  linkThread(ref: unknown, threadId: string, title: string, role: ThreadRole): void {
    const row = this.requireRow(ref);
    this.db.transaction(() => this.linkThreadRow(row.id, threadId, title, role, this.now()));
  }

  unlinkThread(ref: unknown, threadId: string): void {
    const row = this.requireRow(ref);
    this.db.prepare('DELETE FROM doc_threads WHERE doc_id = ? AND thread_id = ?').run(row.id, threadId);
  }

  /** Refresh a linked thread's title/activity; returns the docs it is linked to. */
  touchThread(threadId: string, title: string | null): string[] {
    const docIds = this.docsForThread(threadId);
    if (docIds.length === 0) return docIds;
    const at = this.now();
    const cleanTitle = title?.trim().slice(0, MAX_TITLE_LENGTH) ?? '';
    this.db
      .prepare(
        `UPDATE doc_threads SET last_activity_at = ?, title = CASE WHEN ? <> '' THEN ? ELSE title END WHERE thread_id = ?`
      )
      .run(at, cleanTitle, cleanTitle, threadId);
    return docIds;
  }

  /** Drop a deleted thread from every doc; returns the docs it was linked to. */
  forgetThread(threadId: string): string[] {
    const docIds = this.docsForThread(threadId);
    if (docIds.length) this.db.prepare('DELETE FROM doc_threads WHERE thread_id = ?').run(threadId);
    return docIds;
  }

  private docsForThread(threadId: string): string[] {
    return (
      this.db.prepare('SELECT doc_id FROM doc_threads WHERE thread_id = ?').all(threadId) as Array<{ doc_id: string }>
    ).map((row) => row.doc_id);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private findRow(ref: unknown): DocRow | null {
    if (typeof ref !== 'string' || !ref.trim()) return null;
    const value = ref.trim();
    return (
      (this.db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM docs d WHERE d.id = ? OR d.slug = ? LIMIT 1`).get(
        value,
        value.toLowerCase()
      ) as DocRow | undefined) ?? null
    );
  }

  private requireRow(ref: unknown): DocRow {
    const row = this.findRow(ref);
    if (!row) {
      throw new DesignDocError(
        'not_found',
        `design doc ${JSON.stringify(ref)} not found; list docs to get a valid id or slug`
      );
    }
    return row;
  }

  private fileRow(docId: string, path: string): FileRow | null {
    return (
      (this.db.prepare('SELECT * FROM doc_files WHERE doc_id = ? AND path = ?').get(docId, path) as
        | FileRow
        | undefined) ?? null
    );
  }

  private fileCount(docId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM doc_files WHERE doc_id = ?').get(docId) as { n: number }).n;
  }

  private firstFilePath(docId: string): string {
    const paths = (this.db.prepare('SELECT path FROM doc_files WHERE doc_id = ?').all(docId) as Array<{ path: string }>)
      .map((file) => file.path)
      .sort(comparePaths);
    return (
      paths.find((path) => path.toLowerCase() === 'readme.md') ??
      paths.find((path) => fileKindOf(path) === 'markdown') ??
      paths[0]!
    );
  }

  private missingFile(docId: string, path: string): DesignDocError {
    const available = (
      this.db.prepare('SELECT path FROM doc_files WHERE doc_id = ? ORDER BY path LIMIT 40').all(docId) as Array<{
        path: string;
      }>
    ).map((file) => file.path);
    return new DesignDocError('not_found', `${path} not found; files: ${available.join(', ') || '(none)'}`);
  }

  private caseInsensitiveClash(docId: string, path: string, except?: string): string | null {
    const clash = this.db
      .prepare('SELECT path FROM doc_files WHERE doc_id = ? AND lower(path) = lower(?) AND path <> ? LIMIT 1')
      .get(docId, path, except ?? '') as { path: string } | undefined;
    return clash?.path ?? null;
  }

  private assertCanAdd(docId: string, path: string): void {
    const clash = this.caseInsensitiveClash(docId, path);
    if (clash) throw new DesignDocError('conflict', `${clash} already exists with different letter case`);
    if (this.fileCount(docId) >= MAX_FILES_PER_DOC) {
      throw new DesignDocError('limit', `a design doc holds at most ${MAX_FILES_PER_DOC} files`);
    }
  }

  private assertDocBudget(docId: string, delta: number): void {
    if (delta <= 0) return;
    const total = (
      this.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM doc_files WHERE doc_id = ?').get(docId) as { n: number }
    ).n;
    if (total + delta > MAX_DOC_BYTES) {
      throw new DesignDocError('limit', `a design doc holds at most ${formatBytes(MAX_DOC_BYTES)} of files`);
    }
  }

  /** A recreated path continues the numbering it had before it was deleted. */
  private nextRevisionFor(docId: string, path: string): number {
    const last = this.db
      .prepare('SELECT MAX(revision) AS n FROM doc_revisions WHERE doc_id = ? AND path = ?')
      .get(docId, path) as { n: number | null };
    return (last.n ?? 0) + 1;
  }

  private insertFile(
    docId: string,
    file: { path: string; content: string; encoding: string; size: number },
    revision: number,
    at: number,
    actorJson: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO doc_files (doc_id, path, content, encoding, size, revision, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(docId, file.path, file.content, file.encoding, file.size, revision, at, actorJson);
  }

  private recordRevision(
    docId: string,
    path: string,
    revision: number,
    op: RevisionOp,
    file: { content: string; encoding: string; size: number },
    actorJson: string,
    at: number,
    extra: { note?: string | null; renamedFrom?: string | null } = {}
  ): void {
    this.db
      .prepare(
        `INSERT INTO doc_revisions (doc_id, path, revision, op, content, encoding, size, note, renamed_from, actor, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        docId,
        path,
        revision,
        op,
        file.content,
        file.encoding,
        file.size,
        extra.note ?? null,
        extra.renamedFrom ?? null,
        actorJson,
        at
      );
    const keep =
      file.encoding === 'base64'
        ? MAX_BINARY_REVISIONS_PER_FILE
        : file.size > LARGE_TEXT_FILE_BYTES
          ? MAX_LARGE_TEXT_REVISIONS_PER_FILE
          : MAX_TEXT_REVISIONS_PER_FILE;
    this.db
      .prepare(
        `DELETE FROM doc_revisions WHERE doc_id = ? AND path = ? AND id NOT IN (
          SELECT id FROM doc_revisions WHERE doc_id = ? AND path = ? ORDER BY id DESC LIMIT ?)`
      )
      .run(docId, path, docId, path, keep);
    this.pruneHistoryBytes(docId);
  }

  private pruneHistoryBytes(docId: string): void {
    const total = (
      this.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM doc_revisions WHERE doc_id = ?').get(docId) as {
        n: number;
      }
    ).n;
    if (total <= this.maxHistoryBytes) return;
    // Keep each path's newest snapshot: it is the one just recorded, the only
    // copy of a deleted file, and what later revision numbers continue from.
    const rows = this.db
      .prepare(
        `SELECT id, size FROM doc_revisions r WHERE doc_id = ? AND id <> (
          SELECT MAX(id) FROM doc_revisions WHERE doc_id = r.doc_id AND path = r.path) ORDER BY id ASC`
      )
      .all(docId) as Array<{ id: number; size: number }>;
    let excess = total - this.maxHistoryBytes;
    const drop = this.db.prepare('DELETE FROM doc_revisions WHERE id = ?');
    for (const row of rows) {
      if (excess <= 0) break;
      drop.run(row.id);
      excess -= row.size;
    }
  }

  private touch(docId: string, actor: DocActor, at = this.now()): void {
    this.db
      .prepare('UPDATE docs SET revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(at, JSON.stringify(actor), docId);
  }

  /** Review activity changes the doc but not its content, so "last edited by" stays put. */
  private touchReview(docId: string): void {
    this.db.prepare('UPDATE docs SET revision = revision + 1 WHERE id = ?').run(docId);
  }

  private linkThreadRow(docId: string, threadId: string, title: string, role: ThreadRole, at: number): void {
    const existing = this.db
      .prepare('SELECT role, title FROM doc_threads WHERE doc_id = ? AND thread_id = ?')
      .get(docId, threadId) as { role: ThreadRole; title: string } | undefined;
    const nextRole = existing && (ROLE_RANK[existing.role] ?? 0) >= ROLE_RANK[role] ? existing.role : role;
    const fresh = title.trim();
    const nextTitle = (fresh === AGENT_FALLBACK_LABEL ? '' : fresh) || existing?.title || fresh;
    this.db
      .prepare(
        `INSERT INTO doc_threads (doc_id, thread_id, title, role, last_activity_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (doc_id, thread_id) DO UPDATE SET title = excluded.title, role = excluded.role,
          last_activity_at = excluded.last_activity_at`
      )
      .run(docId, threadId, nextTitle.slice(0, MAX_TITLE_LENGTH), nextRole, at);
    this.db
      .prepare(
        `DELETE FROM doc_threads WHERE doc_id = ? AND thread_id NOT IN (
          SELECT thread_id FROM doc_threads WHERE doc_id = ? ORDER BY last_activity_at DESC LIMIT ?)`
      )
      .run(docId, docId, MAX_THREAD_LINKS_PER_DOC);
  }

  private revisionRow(docId: string, revisionId: unknown): RevisionRow {
    const id = Number(revisionId);
    const row = Number.isInteger(id)
      ? (this.db.prepare('SELECT * FROM doc_revisions WHERE doc_id = ? AND id = ?').get(docId, id) as
          | RevisionRow
          | undefined)
      : undefined;
    if (!row) throw new DesignDocError('not_found', `revision ${String(revisionId)} not found`);
    return row;
  }

  private commentById(docId: string, id: string): DesignDocComment {
    const rows = this.db
      .prepare('SELECT * FROM doc_comments WHERE doc_id = ? AND (id = ? OR parent_id = ?) ORDER BY created_at, rowid')
      .all(docId, id, id) as CommentRow[];
    return toComments(rows)[0]!;
  }

  /** The top-level comment `commentId` names; replies are refused with a pointer to their thread. */
  private rootComment(row: DocRow, commentId: unknown): CommentRow {
    const id = String(commentId ?? '');
    const comment = this.db.prepare('SELECT * FROM doc_comments WHERE doc_id = ? AND id = ?').get(row.id, id) as
      | CommentRow
      | undefined;
    if (!comment) throw new DesignDocError('not_found', `comment ${id} not found in ${row.slug}`);
    if (comment.parent_id) {
      throw new DesignDocError('invalid', `${id} is a reply; use its comment ${comment.parent_id} instead`);
    }
    return comment;
  }

  private insertComment(
    docId: string,
    comment: { id: string; parentId: string | null; path: string | null; quote: string | null; body: string },
    actor: DocActor,
    at: number
  ): void {
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM doc_comments WHERE doc_id = ?').get(docId) as { n: number };
    if (count.n >= MAX_COMMENTS_PER_DOC) {
      throw new DesignDocError(
        'limit',
        `a design doc holds at most ${MAX_COMMENTS_PER_DOC} comments and replies; delete resolved ones first`
      );
    }
    this.db
      .prepare(
        `INSERT INTO doc_comments (id, doc_id, parent_id, path, quote, body, author, status, created_at, resolved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL)`
      )
      .run(comment.id, docId, comment.parentId, comment.path, comment.quote, comment.body, JSON.stringify(actor), at);
  }

  private uniqueSlug(base: string): string {
    const taken = new Set(
      (
        this.db.prepare(`SELECT slug FROM docs WHERE slug = ? OR slug LIKE ? ESCAPE '\\'`).all(
          base,
          `${escapeLike(base)}-%`
        ) as Array<{ slug: string }>
      ).map((row) => row.slug)
    );
    if (!taken.has(base)) return base;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────

export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'design-doc';
}

export function applyEdits(content: string, edits: TextEdit[], path: string): string {
  let next = content;
  edits.forEach((edit, index) => {
    const label = edits.length > 1 ? ` (edit ${index + 1})` : '';
    if (!edit || typeof edit.oldText !== 'string' || typeof edit.newText !== 'string') {
      throw new DesignDocError('invalid', `each edit needs string oldText and newText${label}`);
    }
    if (!edit.oldText) throw new DesignDocError('invalid', `oldText must not be empty${label}`);
    if (edit.oldText === edit.newText) throw new DesignDocError('invalid', `oldText and newText are identical${label}`);
    const count = countOccurrences(next, edit.oldText);
    if (count === 0) {
      throw new DesignDocError(
        'conflict',
        `oldText not found in ${path}${label}; re-read the file and match its text exactly, including whitespace`
      );
    }
    if (count > 1 && !edit.replaceAll) {
      throw new DesignDocError(
        'conflict',
        `oldText matches ${count} places in ${path}${label}; include more surrounding text or set replaceAll`
      );
    }
    next = edit.replaceAll ? next.split(edit.oldText).join(edit.newText) : next.replace(edit.oldText, () => edit.newText);
  });
  return next;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function normalizePath(raw: unknown): string {
  try {
    return normalizeDocPath(raw);
  } catch (error) {
    if (error instanceof DesignDocPathError) throw new DesignDocError('invalid', error.message);
    throw error;
  }
}

function prepareContent(
  rawPath: unknown,
  content: unknown,
  encoding: 'utf8' | 'base64' | undefined
): { path: string; content: string; encoding: 'utf8' | 'base64'; size: number } {
  const path = normalizePath(rawPath);
  if (typeof content !== 'string') throw new DesignDocError('invalid', `content for ${path} must be a string`);
  const binary = isBinaryKind(fileKindOf(path));
  const effective = encoding ?? (binary ? 'base64' : 'utf8');
  if (binary && effective !== 'base64') {
    throw new DesignDocError('invalid', `${path} is a binary file; send its bytes base64-encoded`);
  }
  if (!binary && effective !== 'utf8') {
    throw new DesignDocError('invalid', `${path} is a text file; send it as UTF-8 text`);
  }
  if (effective === 'base64') {
    const compact = content.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
      throw new DesignDocError('invalid', `content for ${path} is not valid base64`);
    }
    const size = Buffer.from(compact, 'base64').length;
    if (size > MAX_BINARY_FILE_BYTES) {
      throw new DesignDocError('limit', `${path} exceeds the ${formatBytes(MAX_BINARY_FILE_BYTES)} binary file limit`);
    }
    return { path, content: compact, encoding: 'base64', size };
  }
  const size = Buffer.byteLength(content, 'utf8');
  if (size > MAX_TEXT_FILE_BYTES) {
    throw new DesignDocError(
      'limit',
      `${path} exceeds the ${formatBytes(MAX_TEXT_FILE_BYTES)} file limit; split it into several files`
    );
  }
  return { path, content, encoding: 'utf8', size };
}

function checkBaseRevision(path: string, existing: FileRow | null, baseRevision: number | undefined): void {
  if (baseRevision === undefined || baseRevision === null) return;
  if (!Number.isInteger(baseRevision) || baseRevision < 0) {
    throw new DesignDocError('invalid', 'baseRevision must be a non-negative integer');
  }
  const current = existing?.revision ?? 0;
  if (current !== baseRevision) {
    throw new DesignDocError(
      'conflict',
      existing
        ? `${path} changed since revision ${baseRevision} (now ${current}, last edited by ${actorLabel(parseActor(existing.updated_by))}); re-read it and reapply your change`
        : `${path} does not exist (expected revision ${baseRevision}); re-read the doc`
    );
  }
}

function cleanTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!title) throw new DesignDocError('invalid', 'title is required');
  if (title.length > MAX_TITLE_LENGTH) {
    throw new DesignDocError('invalid', `title must be at most ${MAX_TITLE_LENGTH} characters`);
  }
  return title;
}

function cleanSummary(value: unknown): string {
  const summary = typeof value === 'string' ? value.trim() : '';
  if (summary.length > MAX_SUMMARY_LENGTH) {
    throw new DesignDocError('invalid', `summary must be at most ${MAX_SUMMARY_LENGTH} characters`);
  }
  return summary;
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new DesignDocError('invalid', 'tags must be an array of strings');
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new DesignDocError('invalid', 'tags must be an array of strings');
    const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag) continue;
    if (tag.length > MAX_TAG_LENGTH) {
      throw new DesignDocError('invalid', `tag ${JSON.stringify(tag)} is longer than ${MAX_TAG_LENGTH} characters`);
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > MAX_TAGS) throw new DesignDocError('invalid', `at most ${MAX_TAGS} tags`);
  return tags;
}

function cleanNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const note = value.replace(/\s+/g, ' ').trim();
  return note ? note.slice(0, MAX_NOTE_LENGTH) : null;
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const number = typeof value === 'number' ? Math.floor(value) : Number.NaN;
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(number, max);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function parseActor(raw: string): DocActor {
  try {
    const value = JSON.parse(raw) as Partial<DocActor>;
    return {
      kind: value.kind === 'agent' ? 'agent' : 'user',
      label: typeof value.label === 'string' && value.label ? value.label : 'Unknown',
      threadId: typeof value.threadId === 'string' ? value.threadId : null
    };
  } catch {
    return { kind: 'user', label: 'Unknown', threadId: null };
  }
}

function parseTags(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

function toSummary(row: DocRow): DesignDocSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    status: isDocStatus(row.status) ? row.status : 'draft',
    projectId: row.project_id,
    tags: parseTags(row.tags),
    entryPath: row.entry_path,
    fileCount: Number(row.file_count ?? 0),
    openComments: Number(row.open_comments ?? 0),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: parseActor(row.created_by),
    updatedBy: parseActor(row.updated_by)
  };
}

function toFileMeta(row: FileRow): DesignDocFileMeta {
  return {
    path: row.path,
    kind: fileKindOf(row.path),
    size: row.size,
    revision: row.revision,
    updatedAt: row.updated_at,
    updatedBy: parseActor(row.updated_by)
  };
}

function toRevision(row: RevisionRow): DesignDocRevision {
  return {
    id: row.id,
    path: row.path,
    revision: row.revision,
    op: (['create', 'write', 'delete', 'rename'] as const).includes(row.op as RevisionOp)
      ? (row.op as RevisionOp)
      : 'write',
    size: row.size,
    note: row.note,
    renamedFrom: row.renamed_from,
    actor: parseActor(row.actor),
    createdAt: row.created_at
  };
}

/** Group rows (ordered oldest first) into top-level comments with their replies. */
function toComments(rows: CommentRow[]): DesignDocComment[] {
  const roots = new Map<string, DesignDocComment>();
  for (const row of rows) {
    if (row.parent_id) continue;
    roots.set(row.id, {
      id: row.id,
      docId: row.doc_id,
      path: row.path,
      quote: row.quote,
      body: row.body,
      author: parseActor(row.author),
      status: row.status === 'resolved' ? 'resolved' : 'open',
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      replies: []
    });
  }
  for (const row of rows) {
    if (!row.parent_id) continue;
    roots
      .get(row.parent_id)
      ?.replies.push({ id: row.id, body: row.body, author: parseActor(row.author), createdAt: row.created_at });
  }
  return [...roots.values()];
}

function cleanCommentBody(value: unknown): string {
  const body = typeof value === 'string' ? value.trim() : '';
  if (!body) throw new DesignDocError('invalid', 'comment body is required');
  if (body.length > MAX_COMMENT_LENGTH) {
    throw new DesignDocError('limit', `comment body must be at most ${MAX_COMMENT_LENGTH} characters`);
  }
  return body;
}

function toThreadLink(row: ThreadRow): DesignDocThreadLink {
  const role = row.role as ThreadRole;
  return {
    threadId: row.thread_id,
    title: row.title,
    role: role in ROLE_RANK ? role : 'assistant',
    lastActivityAt: row.last_activity_at
  };
}
