import { randomBytes } from 'node:crypto';

export const CATALOG_MAX_CHARS = 3900;
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
     ON memory_history(memory_id, version DESC);`
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

export class MemoryStore {
  constructor(db) {
    this.db = db;
  }

  insertHistory(memory, action) {
    this.db
      .prepare(
        `INSERT INTO memory_history (
           memory_id, version, action, snapshot_json, write_reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        memory.id,
        memory.version,
        action,
        JSON.stringify(memorySnapshot(memory)),
        memory.writeReason,
        memory.updatedAt
      );
  }

  add(input) {
    const now = Date.now();
    const record = {
      id: createMemoryId(),
      scope: input.scope,
      projectId: input.projectId,
      name: validateName(input.name),
      summary: validateText('summary', input.summary, 400),
      details: validateText('details', input.details, 16_000),
      kind: isMemoryKind(input.kind) ? input.kind : 'fact',
      tags: validateTags(input.tags),
      importance: Number.isInteger(input.importance) ? input.importance : 50,
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

  list(scope, projectId, limit = 20) {
    const rows =
      scope === 'global'
        ? this.db
            .prepare(
              `SELECT * FROM memories WHERE deleted_at IS NULL AND scope = 'global'
               ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT ?`
            )
            .all(limit)
        : scope === 'project'
          ? this.db
              .prepare(
                `SELECT * FROM memories WHERE deleted_at IS NULL AND scope = 'project' AND project_id = ?
                 ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT ?`
              )
              .all(projectId, limit)
          : this.db
              .prepare(
                `SELECT * FROM memories WHERE deleted_at IS NULL AND (scope = 'global' OR (scope = 'project' AND project_id = ?))
                 ORDER BY pinned DESC, CASE WHEN scope = 'project' THEN 0 ELSE 1 END, importance DESC, updated_at DESC LIMIT ?`
              )
              .all(projectId ?? '', limit);
    return rows.map(parseMemoryRow);
  }

  get(idOrName) {
    const row = this.db
      .prepare(
        `SELECT * FROM memories WHERE deleted_at IS NULL AND (id = ? OR name = ?)
         ORDER BY CASE WHEN scope = 'project' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`
      )
      .get(idOrName, idOrName);
    return row === undefined ? null : parseMemoryRow(row);
  }

  search(query, limit = 20) {
    const needle = `%${query.trim().toLowerCase()}%`;
    return this.db
      .prepare(
        `SELECT * FROM memories WHERE deleted_at IS NULL
         AND (lower(name) LIKE ? OR lower(summary) LIKE ? OR lower(details) LIKE ? OR lower(tags_json) LIKE ?)
         ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT ?`
      )
      .all(needle, needle, needle, needle, limit)
      .map(parseMemoryRow);
  }

  update(id, input) {
    return this.db.transaction(() => {
      const current = this.get(id);
      if (!current) throw new CliError(`memory "${id}" was not found`);
      if (current.version !== input.expectedVersion) {
        throw new CliError(
          `version conflict for ${id}: expected ${input.expectedVersion}, current ${current.version}`
        );
      }
      const updated = {
        ...current,
        summary: input.summary === undefined ? current.summary : validateText('summary', input.summary, 400),
        details: input.details === undefined ? current.details : validateText('details', input.details, 16_000),
        kind: input.kind ?? current.kind,
        tags: input.tags === undefined ? current.tags : validateTags(input.tags),
        importance: input.importance ?? current.importance,
        pinned: input.pinned ?? current.pinned,
        writeReason: validateText('reason', input.writeReason, 500),
        version: current.version + 1,
        updatedAt: Date.now()
      };
      const result = this.db
        .prepare(
          `UPDATE memories SET summary = ?, details = ?, kind = ?, tags_json = ?, importance = ?,
             pinned = ?, write_reason = ?, version = ?, updated_at = ?
           WHERE id = ? AND version = ? AND deleted_at IS NULL`
        )
        .run(
          updated.summary,
          updated.details,
          updated.kind,
          JSON.stringify(updated.tags),
          updated.importance,
          updated.pinned ? 1 : 0,
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

  forget(id, expectedVersion, reason) {
    return this.db.transaction(() => {
      const current = this.get(id);
      if (!current) throw new CliError(`memory "${id}" was not found`);
      if (current.version !== expectedVersion) {
        throw new CliError(
          `version conflict for ${id}: expected ${expectedVersion}, current ${current.version}`
        );
      }
      const writeReason = validateText('reason', reason, 500);
      const updatedAt = Date.now();
      const version = current.version + 1;
      const result = this.db
        .prepare(
          `UPDATE memories SET deleted_at = ?, write_reason = ?, version = ?, updated_at = ?
           WHERE id = ? AND version = ? AND deleted_at IS NULL`
        )
        .run(updatedAt, writeReason, version, updatedAt, id, current.version);
      if (result.changes !== 1) throw new CliError(`memory ${id} changed concurrently; retry`);
      const forgotten = { ...current, writeReason, version, updatedAt };
      this.insertHistory(forgotten, 'forget');
      return forgotten;
    });
  }

  history(id, limit = 20) {
    const capped = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 20;
    return this.db
      .prepare(
        `SELECT h.version, h.action, h.snapshot_json, h.write_reason, h.created_at
         FROM memory_history h
         WHERE h.memory_id = ?
         ORDER BY h.version DESC
         LIMIT ?`
      )
      .all(id, capped)
      .map(parseHistoryRow);
  }
}

export function renderCatalog(store, projectId) {
  const memories = store.list('all', projectId ?? '', 100);
  const header = [
    'Memory index',
    'The entries below are summaries, not full records. Use `zcc memory search <query> --json` and `zcc memory get <id> --json` to read details.',
    'Save durable learning with `zcc memory add`. Use project scope for repository-specific facts and global scope only for user preferences that apply everywhere. Never store secrets, transient status, or rules already in AGENTS.md.',
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
  return `${header}${lines.join('\n')}`;
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

export const MEMORY_USAGE = [
  'Usage:',
  '  zcc memory catalog [--scope all|project|global] [--json]',
  '  zcc memory search <query...> [--json]',
  '  zcc memory get <id-or-name> [--json]',
  '  zcc memory add --scope project|global --name NAME --summary TEXT --details TEXT --reason TEXT [--kind KIND] [--tag TAG]... [--importance 0-100] [--pinned] [--project ID] [--json]',
  '  zcc memory update <id> --expected-version N --reason TEXT [--summary TEXT] [--details TEXT] [--kind KIND] [--tag TAG]... [--pinned true|false] [--json]',
  '  zcc memory forget <id> --expected-version N --reason TEXT [--json]',
  '  zcc memory history <id> [--limit N] [--json]'
].join('\n');
