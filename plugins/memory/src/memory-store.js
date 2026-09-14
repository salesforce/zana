import { randomBytes } from 'node:crypto';

export const CATALOG_MAX_CHARS = 3900;
export const DEFAULT_RESULT_LIMIT = 20;
export const MAX_RESULT_LIMIT = 100;
export const MEMORY_KINDS = ['fact', 'preference', 'decision', 'procedure', 'episode', 'reference'];
export const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export const TAG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/;

export const MEMORY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS memories (
     id TEXT PRIMARY KEY,
     scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
     scope_key TEXT NOT NULL,
     project_id TEXT,
     name TEXT NOT NULL,
     summary TEXT NOT NULL,
     details TEXT NOT NULL,
     kind TEXT NOT NULL,
     tags_json TEXT NOT NULL,
     importance INTEGER NOT NULL CHECK (importance BETWEEN 0 AND 100),
     pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
     source_thread_id TEXT,
     write_reason TEXT NOT NULL,
     version INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     deleted_at INTEGER,
     CHECK ((scope = 'global' AND project_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL))
   );
   CREATE UNIQUE INDEX IF NOT EXISTS memories_active_scope_name
     ON memories(scope_key, name) WHERE deleted_at IS NULL;
   CREATE TABLE IF NOT EXISTS memory_history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     memory_id TEXT NOT NULL,
     version INTEGER NOT NULL,
     action TEXT NOT NULL CHECK (action IN ('create', 'update', 'forget')),
     snapshot_json TEXT NOT NULL,
     write_reason TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     UNIQUE(memory_id, version)
   );
   CREATE INDEX IF NOT EXISTS memory_history_memory
     ON memory_history(memory_id, version DESC);`,
  `ALTER TABLE memories ADD COLUMN last_accessed_at INTEGER;
   ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE memory_history ADD COLUMN source_thread_id TEXT;
   CREATE INDEX IF NOT EXISTS memories_catalog
     ON memories(scope, project_id, deleted_at, pinned, importance, updated_at);
   CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
     memory_id UNINDEXED, name, summary, details, tags
   );
   CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
     INSERT INTO memories_fts(memory_id, name, summary, details, tags)
     VALUES (new.id, new.name, new.summary, new.details, new.tags_json);
   END;
   CREATE TRIGGER IF NOT EXISTS memories_fts_update
     AFTER UPDATE OF name, summary, details, tags_json ON memories BEGIN
     DELETE FROM memories_fts WHERE memory_id = old.id;
     INSERT INTO memories_fts(memory_id, name, summary, details, tags)
     VALUES (new.id, new.name, new.summary, new.details, new.tags_json);
   END;
   CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
     DELETE FROM memories_fts WHERE memory_id = old.id;
   END;
   INSERT INTO memories_fts(memory_id, name, summary, details, tags)
     SELECT id, name, summary, details, tags_json FROM memories
     WHERE id NOT IN (SELECT memory_id FROM memories_fts);`
];

export class CliError extends Error {}

export function isMemoryKind(value) {
  return typeof value === 'string' && MEMORY_KINDS.includes(value);
}

export function unsafeMemoryReason(value) {
  if (/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)) {
    return 'contains invisible or bidirectional control characters';
  }
  if (/<\/?\s*(system|developer|assistant|tool)(?:\s|>)/iu.test(value)) {
    return 'contains a role-like prompt tag';
  }
  if (/\b(ignore|disregard|override)\b.{0,50}\b(previous|prior|system|developer)\b/isu.test(value)) {
    return 'looks like a prompt-injection instruction';
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(value)) {
    return 'contains a private key';
  }
  if (/\b(?:sk-[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9]{20,})\b/iu.test(value)) {
    return 'contains a token-like secret';
  }
  if (/\b[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY)\s*=\s*\S+/u.test(value)) {
    return 'contains a credential assignment';
  }
  return null;
}

export function validateText(label, value, maxChars) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length === 0) throw new CliError(`${label} must not be empty`);
  if (trimmed.length > maxChars) throw new CliError(`${label} must be at most ${maxChars} characters`);
  const unsafe = unsafeMemoryReason(trimmed);
  if (unsafe) throw new CliError(`${label} ${unsafe}; memory was not written`);
  return trimmed;
}

export function validateName(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!NAME_PATTERN.test(normalized)) {
    throw new CliError('name must be 1-80 lowercase letters, digits, dots, underscores, or hyphens');
  }
  return normalized;
}

export function validateTags(values) {
  const tags = [...new Set((values ?? []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))];
  if (tags.length > 20) throw new CliError('at most 20 tags are allowed');
  for (const tag of tags) {
    if (!TAG_PATTERN.test(tag)) {
      throw new CliError(`invalid tag "${tag}"; use lowercase letters, digits, dots, underscores, or hyphens`);
    }
  }
  return tags;
}

export function parseKind(value) {
  const kind = value ?? 'fact';
  if (!isMemoryKind(kind)) {
    throw new CliError(`kind must be one of: ${MEMORY_KINDS.join(', ')}`);
  }
  return kind;
}

export function parseInteger(label, value, options) {
  if (value === undefined && options.defaultValue !== undefined) {
    return options.defaultValue;
  }
  if (value === undefined || !/^-?\d+$/u.test(String(value))) {
    throw new CliError(`${label} must be an integer`);
  }
  const parsed = Number(value);
  if (parsed < options.min || parsed > options.max) {
    throw new CliError(`${label} must be between ${options.min} and ${options.max}`);
  }
  return parsed;
}

export function parseBoolean(label, value) {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new CliError(`${label} must be true or false`);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTags(raw) {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

export function parseMemoryRow(row) {
  if (!isRecord(row)) throw new Error('memory database returned an invalid row');
  return {
    id: String(row.id),
    scope: row.scope === 'project' ? 'project' : 'global',
    projectId: typeof row.project_id === 'string' ? row.project_id : null,
    name: String(row.name),
    summary: String(row.summary),
    details: String(row.details),
    kind: isMemoryKind(row.kind) ? row.kind : 'fact',
    tags: parseTags(row.tags_json),
    importance: Number(row.importance),
    pinned: Number(row.pinned) === 1,
    sourceThreadId: typeof row.source_thread_id === 'string' ? row.source_thread_id : null,
    writeReason: String(row.write_reason),
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

export function toMemorySummary(memory) {
  return {
    id: memory.id,
    scope: memory.scope,
    projectId: memory.projectId,
    name: memory.name,
    summary: memory.summary,
    kind: memory.kind,
    tags: memory.tags,
    importance: memory.importance,
    pinned: memory.pinned,
    version: memory.version,
    updatedAt: memory.updatedAt
  };
}

function memorySnapshot(memory) {
  return {
    id: memory.id,
    scope: memory.scope,
    projectId: memory.projectId,
    name: memory.name,
    summary: memory.summary,
    details: memory.details,
    kind: memory.kind,
    tags: memory.tags,
    importance: memory.importance,
    pinned: memory.pinned,
    sourceThreadId: memory.sourceThreadId,
    writeReason: memory.writeReason,
    version: memory.version,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt
  };
}

function parseHistoryRow(row) {
  if (!isRecord(row)) throw new Error('memory history returned an invalid row');
  let snapshot = null;
  if (typeof row.snapshot_json === 'string') {
    try {
      const parsed = JSON.parse(row.snapshot_json);
      snapshot = isRecord(parsed) ? parsed : null;
    } catch {
      snapshot = null;
    }
  }
  return {
    version: Number(row.version),
    action: row.action === 'update' || row.action === 'forget' ? row.action : 'create',
    snapshot,
    sourceThreadId: typeof row.source_thread_id === 'string' ? row.source_thread_id : null,
    writeReason: String(row.write_reason),
    createdAt: Number(row.created_at)
  };
}

function scopeKey(scope, projectId) {
  return scope === 'global' ? 'global' : `project:${projectId ?? 'missing'}`;
}

function createMemoryId() {
  return `mem_${randomBytes(8).toString('base64url').toLowerCase()}`;
}

function normalizeOneLine(value) {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function scopeSql(scope, projectId, columnPrefix = 'm.') {
  if (scope === 'global') {
    return { sql: `${columnPrefix}scope = 'global'`, params: [] };
  }
  if (scope === 'project') {
    if (!projectId) throw new CliError('project scope requires a project context');
    return {
      sql: `${columnPrefix}scope = 'project' AND ${columnPrefix}project_id = ?`,
      params: [projectId]
    };
  }
  if (!projectId) return { sql: `${columnPrefix}scope = 'global'`, params: [] };
  return {
    sql: `(${columnPrefix}scope = 'global' OR (${columnPrefix}scope = 'project' AND ${columnPrefix}project_id = ?))`,
    params: [projectId]
  };
}

export function searchExpression(query) {
  const tokens = String(query).toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  if (tokens.length === 0) throw new CliError('search query has no searchable terms');
  return [...new Set(tokens)]
    .slice(0, 12)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' OR ');
}

export function readScope(args, defaultScope = 'all') {
  const value = option(args, 'scope') ?? defaultScope;
  if (value !== 'global' && value !== 'project' && value !== 'all') {
    throw new CliError('scope must be global, project, or all');
  }
  return value;
}

export function resolveProjectId(args, ctx) {
  return ctx?.projectId || option(args, 'project') || process.env.ZCC_PROJECT_ID || undefined;
}

export function writeScope(args, ctx) {
  const value = requireOption(args, 'scope');
  if (value === 'global') return { scope: 'global', projectId: null };
  if (value !== 'project') throw new CliError('write scope must be project or global');
  const projectId = resolveProjectId(args, ctx);
  if (!projectId) {
    throw new CliError('project-scoped memory requires a project context, --project <id>, or ZCC_PROJECT_ID');
  }
  return { scope: 'project', projectId };
}

export class MemoryStore {
  constructor(db) {
    this.db = db;
  }

  insertHistory(memory, action) {
    this.db
      .prepare(
        `INSERT INTO memory_history (
           memory_id, version, action, snapshot_json, source_thread_id, write_reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        memory.id,
        memory.version,
        action,
        JSON.stringify(memorySnapshot(memory)),
        memory.sourceThreadId,
        memory.writeReason,
        memory.updatedAt
      );
  }

  add(input) {
    const now = Date.now();
    const importance = Number.isInteger(input.importance) ? input.importance : 50;
    if (importance < 0 || importance > 100) {
      throw new CliError('importance must be between 0 and 100');
    }
    const record = {
      id: createMemoryId(),
      scope: input.scope,
      projectId: input.projectId,
      name: validateName(input.name),
      summary: validateText('summary', input.summary, 400),
      details: validateText('details', input.details, 16_000),
      kind: isMemoryKind(input.kind) ? input.kind : 'fact',
      tags: validateTags(input.tags),
      importance,
      pinned: Boolean(input.pinned),
      sourceThreadId: input.sourceThreadId ?? null,
      writeReason: validateText('reason', input.writeReason, 500),
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    try {
      this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO memories (
               id, scope, scope_key, project_id, name, summary, details, kind,
               tags_json, importance, pinned, source_thread_id, write_reason,
               version, created_at, updated_at, deleted_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
          )
          .run(
            record.id,
            record.scope,
            scopeKey(record.scope, record.projectId),
            record.projectId,
            record.name,
            record.summary,
            record.details,
            record.kind,
            JSON.stringify(record.tags),
            record.importance,
            record.pinned ? 1 : 0,
            record.sourceThreadId,
            record.writeReason,
            record.version,
            record.createdAt,
            record.updatedAt
          );
        this.insertHistory(record, 'create');
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new CliError(`an active ${record.scope} memory named "${record.name}" already exists`);
      }
      throw error;
    }
    return record;
  }

  listAll() {
    return this.db
      .prepare(
        `SELECT * FROM memories WHERE deleted_at IS NULL
         ORDER BY pinned DESC, scope ASC, project_id ASC, importance DESC, updated_at DESC, name ASC`
      )
      .all()
      .map(parseMemoryRow);
  }

  list(scope, projectId, limit = DEFAULT_RESULT_LIMIT) {
    const scoped = scopeSql(scope, projectId ?? undefined);
    const rows = this.db
      .prepare(
        `SELECT m.* FROM memories m
         WHERE m.deleted_at IS NULL AND ${scoped.sql}
         ORDER BY m.pinned DESC,
           CASE WHEN m.scope = 'project' THEN 0 ELSE 1 END,
           m.importance DESC, COALESCE(m.last_accessed_at, 0) DESC,
           m.updated_at DESC, m.name ASC
         LIMIT ?`
      )
      .all(...scoped.params, limit);
    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM memories m
         WHERE m.deleted_at IS NULL AND ${scoped.sql}`
      )
      .get(...scoped.params);
    const total = isRecord(countRow) ? Number(countRow.count) : 0;
    return { memories: rows.map(parseMemoryRow), total };
  }

  getAdmin(id) {
    const row = this.db
      .prepare('SELECT * FROM memories WHERE id = ? AND deleted_at IS NULL')
      .get(id);
    return row === undefined ? null : parseMemoryRow(row);
  }

  get(idOrName, scope = 'all', projectId, touch = true) {
    const scoped = scopeSql(scope, projectId);
    const row = this.db
      .prepare(
        `SELECT m.* FROM memories m
         WHERE m.deleted_at IS NULL AND (m.id = ? OR m.name = ?) AND ${scoped.sql}
         ORDER BY CASE WHEN m.scope = 'project' THEN 0 ELSE 1 END, m.updated_at DESC
         LIMIT 1`
      )
      .get(idOrName, idOrName, ...scoped.params);
    if (row === undefined) return null;
    const memory = parseMemoryRow(row);
    if (touch) {
      this.db
        .prepare('UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?')
        .run(Date.now(), memory.id);
    }
    return memory;
  }

  search(query, scope = 'all', projectId, limit = DEFAULT_RESULT_LIMIT) {
    const scoped = scopeSql(scope, projectId);
    const rows = this.db
      .prepare(
        `SELECT m.* FROM memories_fts f
         JOIN memories m ON m.id = f.memory_id
         WHERE memories_fts MATCH ? AND m.deleted_at IS NULL AND ${scoped.sql}
         ORDER BY bm25(memories_fts), m.pinned DESC, m.importance DESC, m.updated_at DESC
         LIMIT ?`
      )
      .all(searchExpression(query), ...scoped.params, limit);
    return rows.map(parseMemoryRow);
  }

  update(id, input, ctxProjectId) {
    return this.db.transaction(() => {
      const current = this.get(id, 'all', ctxProjectId, false);
      if (!current) throw new CliError(`memory "${id}" was not found in the current scope`);
      if (current.version !== input.expectedVersion) {
        throw new CliError(
          `version conflict for ${id}: expected ${input.expectedVersion}, current ${current.version}`
        );
      }
      const importance = input.importance ?? current.importance;
      if (!Number.isInteger(importance) || importance < 0 || importance > 100) {
        throw new CliError('importance must be between 0 and 100');
      }
      const updated = {
        ...current,
        summary: input.summary === undefined ? current.summary : validateText('summary', input.summary, 400),
        details: input.details === undefined ? current.details : validateText('details', input.details, 16_000),
        kind: input.kind ?? current.kind,
        tags: input.tags === undefined ? current.tags : validateTags(input.tags),
        importance,
        pinned: input.pinned ?? current.pinned,
        sourceThreadId: input.sourceThreadId === undefined ? current.sourceThreadId : input.sourceThreadId,
        writeReason: validateText('reason', input.writeReason, 500),
        version: current.version + 1,
        updatedAt: Date.now()
      };
      const result = this.db
        .prepare(
          `UPDATE memories SET summary = ?, details = ?, kind = ?, tags_json = ?, importance = ?,
             pinned = ?, source_thread_id = ?, write_reason = ?, version = ?, updated_at = ?
           WHERE id = ? AND version = ? AND deleted_at IS NULL`
        )
        .run(
          updated.summary,
          updated.details,
          updated.kind,
          JSON.stringify(updated.tags),
          updated.importance,
          updated.pinned ? 1 : 0,
          updated.sourceThreadId,
          updated.writeReason,
          updated.version,
          updated.updatedAt,
          updated.id,
          current.version
        );
      if (result.changes !== 1) throw new CliError(`memory ${id} changed concurrently; retry`);
      this.insertHistory(updated, 'update');
      return updated;
    });
  }

  forget(id, expectedVersion, reason, sourceThreadId = null, ctxProjectId) {
    return this.db.transaction(() => {
      const current = this.get(id, 'all', ctxProjectId, false);
      if (!current) throw new CliError(`memory "${id}" was not found in the current scope`);
      if (current.version !== expectedVersion) {
        throw new CliError(
          `version conflict for ${id}: expected ${expectedVersion}, current ${current.version}`
        );
      }
      const writeReason = validateText('reason', reason, 500);
      const forgotten = {
        ...current,
        sourceThreadId,
        writeReason,
        version: current.version + 1,
        updatedAt: Date.now()
      };
      const result = this.db
        .prepare(
          `UPDATE memories SET deleted_at = ?, source_thread_id = ?, write_reason = ?,
             version = ?, updated_at = ?
           WHERE id = ? AND version = ? AND deleted_at IS NULL`
        )
        .run(
          forgotten.updatedAt,
          sourceThreadId,
          writeReason,
          forgotten.version,
          forgotten.updatedAt,
          id,
          current.version
        );
      if (result.changes !== 1) throw new CliError(`memory ${id} changed concurrently; retry`);
      this.insertHistory(forgotten, 'forget');
      return forgotten;
    });
  }

  history(id, projectId, limit = DEFAULT_RESULT_LIMIT) {
    const capped = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), MAX_RESULT_LIMIT) : DEFAULT_RESULT_LIMIT;
    const scoped = scopeSql('all', projectId);
    return this.db
      .prepare(
        `SELECT h.version, h.action, h.snapshot_json, h.source_thread_id, h.write_reason, h.created_at
         FROM memory_history h
         JOIN memories m ON m.id = h.memory_id
         WHERE h.memory_id = ? AND ${scoped.sql}
         ORDER BY h.version DESC
         LIMIT ?`
      )
      .all(id, ...scoped.params, capped)
      .map(parseHistoryRow);
  }
}

export function renderCatalog(store, projectId) {
  const { memories, total } = store.list('all', projectId ?? '', MAX_RESULT_LIMIT);
  const header = [
    'Memory index',
    'The entries below are summaries, not full records. Use `zcc memory search <query> --scope all --json` and `zcc memory get <id> --json` to progressively disclose details.',
    'You may proactively save durable learning with `zcc memory add`. Use project scope for repository-specific facts and global scope only for broadly applicable user preferences or workflows. Never store secrets, transient status, guesses, or rules already guaranteed by AGENTS.md.',
    ''
  ].join('\n');
  if (memories.length === 0) return `${header}No memories are stored yet.`;
  const lines = [];
  for (const memory of memories) {
    const tags = memory.tags.length > 0 ? `; ${memory.tags.slice(0, 3).join(',')}` : '';
    const pin = memory.pinned ? '; pinned' : '';
    const line = `- ${memory.id} [${memory.scope}/${memory.kind}${pin}${tags}] ${memory.name}: ${normalizeOneLine(memory.summary)}`;
    const candidate = `${header}${[...lines, line].join('\n')}`;
    if (candidate.length > CATALOG_MAX_CHARS) break;
    lines.push(line);
  }
  let finalLines = lines;
  let footer = '';
  while (true) {
    const finalShown = finalLines.length;
    footer =
      finalShown < total
        ? `\nShowing ${finalShown} of ${total}; run \`zcc memory catalog --scope all --json\` for the rest.`
        : '';
    if (`${header}${finalLines.join('\n')}${footer}`.length <= CATALOG_MAX_CHARS) break;
    finalLines = finalLines.slice(0, -1);
  }
  return `${header}${finalLines.join('\n')}${footer}`;
}

export function parseArgv(argv) {
  const positionals = [];
  const options = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.add(name);
      continue;
    }
    const values = options.get(name) ?? [];
    values.push(next);
    options.set(name, values);
    index += 1;
  }
  return { positionals, options, flags };
}

export function option(args, name) {
  const values = args.options.get(name);
  return values?.[values.length - 1];
}

export function requireOption(args, name) {
  const value = option(args, name);
  if (value === undefined) throw new CliError(`missing required --${name}`);
  return value;
}

export const MEMORY_USAGE = [
  'Usage:',
  '  zcc memory catalog [--scope all|project|global] [--limit N] [--json]',
  '  zcc memory search <query...> [--scope all|project|global] [--limit N] [--json]',
  '  zcc memory get <id-or-name> [--scope all|project|global] [--json]',
  '  zcc memory add --scope project|global --name NAME --summary TEXT --details TEXT --reason TEXT [--kind KIND] [--tag TAG]... [--importance 0-100] [--pinned] [--project ID] [--json]',
  '  zcc memory update <id> --expected-version N --reason TEXT [--summary TEXT] [--details TEXT] [--kind KIND] [--tag TAG]... [--importance 0-100] [--pinned true|false] [--json]',
  '  zcc memory forget <id> --expected-version N --reason TEXT [--json]',
  '  zcc memory history <id> [--limit N] [--json]'
].join('\n');
