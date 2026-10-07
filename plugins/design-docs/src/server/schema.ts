/**
 * Append-only migrations for the plugin's own SQLite database. Never edit or
 * reorder an entry: the host records each by index + hash and refuses a
 * mismatch. Add a new statement at the end instead.
 */
export const DESIGN_DOC_MIGRATIONS: readonly string[] = [
  `CREATE TABLE docs (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    project_id TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    entry_path TEXT NOT NULL DEFAULT 'README.md',
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL
  );
  CREATE INDEX docs_by_project ON docs (project_id, updated_at DESC);
  CREATE INDEX docs_by_updated ON docs (updated_at DESC);

  CREATE TABLE doc_files (
    doc_id TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    encoding TEXT NOT NULL DEFAULT 'utf8',
    size INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL,
    PRIMARY KEY (doc_id, path)
  );

  CREATE TABLE doc_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL,
    path TEXT NOT NULL,
    revision INTEGER NOT NULL,
    op TEXT NOT NULL,
    content TEXT NOT NULL,
    encoding TEXT NOT NULL DEFAULT 'utf8',
    size INTEGER NOT NULL,
    note TEXT,
    renamed_from TEXT,
    actor TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX doc_revisions_by_file ON doc_revisions (doc_id, path, id DESC);

  CREATE TABLE doc_comments (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    path TEXT,
    quote TEXT,
    body TEXT NOT NULL,
    author TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX doc_comments_by_doc ON doc_comments (doc_id, created_at);

  CREATE TABLE doc_threads (
    doc_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    last_activity_at INTEGER NOT NULL,
    PRIMARY KEY (doc_id, thread_id)
  );
  CREATE INDEX doc_threads_by_thread ON doc_threads (thread_id);`
];
