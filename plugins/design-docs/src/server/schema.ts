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
  CREATE INDEX doc_threads_by_thread ON doc_threads (thread_id);`,
  // Replies: a comment with a parent_id belongs to that root comment's thread.
  `ALTER TABLE doc_comments ADD COLUMN parent_id TEXT;
  CREATE INDEX doc_comments_by_parent ON doc_comments (doc_id, parent_id);`,
  // Doc list navigation: pinned docs sort first; an alternative nests under the doc it competes with.
  `ALTER TABLE docs ADD COLUMN pinned_at INTEGER;
  ALTER TABLE docs ADD COLUMN alternative_to TEXT;`,
  // Peer-sync state is additive. Local docs continue to operate without a peer group.
  `CREATE TABLE sync_repositories (
    repo_id TEXT PRIMARY KEY,
    replica_id TEXT NOT NULL UNIQUE,
    group_id TEXT,
    roster_epoch INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sync_group_members (
    repo_id TEXT NOT NULL,
    replica_id TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    sponsor_replica_id TEXT,
    joined_at INTEGER NOT NULL,
    removed_at INTEGER,
    PRIMARY KEY (repo_id, replica_id)
  );
  CREATE TABLE sync_operations (
    repo_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    replica_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    doc_id TEXT NOT NULL,
    parents_json TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    origin TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (repo_id, op_id),
    UNIQUE (repo_id, replica_id, sequence)
  );
  CREATE TABLE sync_intents (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    frozen_head TEXT NOT NULL,
    member_replica_id TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (repo_id, doc_id, frozen_head, member_replica_id)
  );
  CREATE TABLE sync_receipts (
    repo_id TEXT NOT NULL,
    member_replica_id TEXT NOT NULL,
    frozen_head TEXT NOT NULL,
    scope_hash TEXT NOT NULL,
    stage TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (repo_id, member_replica_id, frozen_head)
  );
  CREATE INDEX sync_operations_by_doc ON sync_operations (repo_id, doc_id, sequence);
  CREATE INDEX sync_intents_ready ON sync_intents (repo_id, state, created_at);`,
  `ALTER TABLE doc_files ADD COLUMN sync_id TEXT;
   ALTER TABLE doc_revisions ADD COLUMN sync_id TEXT;
   CREATE TABLE sync_versions (
     repo_id TEXT NOT NULL, head_id TEXT NOT NULL, doc_id TEXT NOT NULL,
     payload_hash TEXT NOT NULL, closure_json TEXT NOT NULL, bytes INTEGER NOT NULL,
     PRIMARY KEY (repo_id, head_id)
   );
   CREATE TABLE sync_doc_heads (
     repo_id TEXT NOT NULL, doc_id TEXT NOT NULL, head_id TEXT NOT NULL,
     PRIMARY KEY (repo_id, doc_id)
   );
   CREATE TABLE sync_doc_references (
     doc_id TEXT PRIMARY KEY, project_json TEXT NOT NULL, threads_json TEXT NOT NULL
   );
   CREATE TABLE sync_checkpoints (
     repo_id TEXT NOT NULL, sender_replica_id TEXT NOT NULL, session_id TEXT NOT NULL,
     scope_hash TEXT NOT NULL, receipt_json TEXT NOT NULL,
     PRIMARY KEY (repo_id, sender_replica_id, session_id)
   );
   CREATE TABLE sync_conflicts (
     repo_id TEXT NOT NULL, doc_id TEXT NOT NULL, local_head TEXT NOT NULL, remote_head TEXT NOT NULL,
     PRIMARY KEY (repo_id, doc_id, local_head, remote_head)
   );
   CREATE TABLE sync_outgoing_sessions (
     intent_id TEXT PRIMARY KEY, offer_json TEXT NOT NULL
   );
   CREATE TABLE sync_history_projections (
     repo_id TEXT NOT NULL, history_id TEXT NOT NULL, doc_id TEXT NOT NULL,
     payload_hash TEXT NOT NULL,
     PRIMARY KEY (repo_id, history_id)
   );
   UPDATE sync_intents SET state = 'blocked' WHERE frozen_head NOT IN (SELECT head_id FROM sync_versions);
   DELETE FROM sync_receipts;`,
  `CREATE TABLE sync_transfers (
     direction TEXT NOT NULL, repo_id TEXT NOT NULL, sender_replica_id TEXT NOT NULL,
     session_id TEXT NOT NULL, intent_id TEXT, header_json TEXT NOT NULL,
     PRIMARY KEY (direction, repo_id, sender_replica_id, session_id),
     UNIQUE (direction, intent_id)
   );
   CREATE TABLE sync_transfer_chunks (
     direction TEXT NOT NULL, repo_id TEXT NOT NULL, sender_replica_id TEXT NOT NULL,
     session_id TEXT NOT NULL, blob_hash TEXT NOT NULL, chunk_index INTEGER NOT NULL,
     content BLOB NOT NULL,
     PRIMARY KEY (direction, repo_id, sender_replica_id, session_id, blob_hash, chunk_index)
    );`,
  `CREATE TABLE sync_group_control (
     singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
     local_peer_id TEXT, roster_json TEXT, consent_json TEXT
   );
   INSERT INTO sync_group_control (singleton) VALUES (1);
   CREATE TABLE sync_group_admissions (
     request_id TEXT PRIMARY KEY, request_json TEXT NOT NULL, receipt_json TEXT NOT NULL
   );
   CREATE TABLE sync_group_jobs (
     id TEXT PRIMARY KEY, peer_id TEXT NOT NULL, kind TEXT NOT NULL,
     roster_epoch INTEGER NOT NULL, payload_json TEXT NOT NULL,
     state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
     next_at INTEGER NOT NULL DEFAULT 0, error TEXT
   );
    CREATE INDEX sync_group_jobs_ready ON sync_group_jobs (state, next_at);`,
  `CREATE TABLE sync_file_generations (
      doc_id TEXT NOT NULL, path TEXT NOT NULL, generation INTEGER NOT NULL, file_id TEXT,
      PRIMARY KEY (doc_id, path)
    );
    CREATE TABLE sync_file_identity_generations (
      doc_id TEXT NOT NULL, file_id TEXT NOT NULL, generation INTEGER NOT NULL,
      PRIMARY KEY (doc_id, file_id)
    );
    INSERT INTO sync_file_generations SELECT doc_id, path, MAX(revision), NULL FROM doc_revisions GROUP BY doc_id, path;
    INSERT INTO sync_file_generations SELECT doc_id, path, revision, sync_id FROM doc_files WHERE true
      ON CONFLICT (doc_id, path) DO UPDATE SET generation = MAX(generation, excluded.generation), file_id = excluded.file_id;
    INSERT INTO sync_file_identity_generations SELECT doc_id, sync_id, revision FROM doc_files WHERE sync_id IS NOT NULL;
    CREATE TRIGGER sync_file_generation_insert AFTER INSERT ON doc_files BEGIN
      INSERT INTO sync_file_generations VALUES (NEW.doc_id, NEW.path, NEW.revision, NEW.sync_id)
        ON CONFLICT (doc_id, path) DO UPDATE SET generation = MAX(generation, excluded.generation), file_id = excluded.file_id;
      INSERT INTO sync_file_identity_generations SELECT NEW.doc_id, NEW.sync_id, NEW.revision WHERE NEW.sync_id IS NOT NULL
        ON CONFLICT (doc_id, file_id) DO UPDATE SET generation = MAX(generation, excluded.generation);
    END;
    CREATE TRIGGER sync_file_generation_update AFTER UPDATE ON doc_files BEGIN
      INSERT INTO sync_file_generations VALUES (NEW.doc_id, NEW.path, NEW.revision, NEW.sync_id)
        ON CONFLICT (doc_id, path) DO UPDATE SET generation = MAX(generation, excluded.generation), file_id = excluded.file_id;
      INSERT INTO sync_file_identity_generations SELECT NEW.doc_id, NEW.sync_id, NEW.revision WHERE NEW.sync_id IS NOT NULL
        ON CONFLICT (doc_id, file_id) DO UPDATE SET generation = MAX(generation, excluded.generation);
    END;
    CREATE TRIGGER sync_file_generation_delete AFTER DELETE ON doc_files BEGIN
      INSERT INTO sync_file_generations VALUES (OLD.doc_id, OLD.path, OLD.revision + 1, OLD.sync_id)
        ON CONFLICT (doc_id, path) DO UPDATE SET generation = MAX(generation + 1, excluded.generation), file_id = excluded.file_id;
      INSERT INTO sync_file_identity_generations SELECT OLD.doc_id, OLD.sync_id, OLD.revision + 1 WHERE OLD.sync_id IS NOT NULL
        ON CONFLICT (doc_id, file_id) DO UPDATE SET generation = MAX(generation + 1, excluded.generation);
    END;
    CREATE TABLE sync_retry (
      intent_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
      last_attempt INTEGER NOT NULL DEFAULT 0, error TEXT
    );
    CREATE TABLE sync_peer_known (
      repo_id TEXT NOT NULL, member_replica_id TEXT NOT NULL, head_id TEXT NOT NULL,
      PRIMARY KEY (repo_id, member_replica_id, head_id)
    );
    CREATE TABLE sync_history_order (
      doc_id TEXT NOT NULL, history_id TEXT NOT NULL, position INTEGER NOT NULL,
      PRIMARY KEY (doc_id, history_id)
    );
    ALTER TABLE sync_transfers ADD COLUMN state TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE sync_transfers ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE sync_blobs (hash TEXT PRIMARY KEY, content BLOB NOT NULL, bytes INTEGER NOT NULL);
    CREATE TABLE sync_version_formats (
      repo_id TEXT NOT NULL, head_id TEXT NOT NULL, format INTEGER NOT NULL,
      PRIMARY KEY (repo_id, head_id)
    );
    CREATE TABLE sync_version_blobs (
      repo_id TEXT NOT NULL, head_id TEXT NOT NULL, blob_hash TEXT NOT NULL,
      PRIMARY KEY (repo_id, head_id, blob_hash)
    );
    CREATE TABLE sync_manual_sessions (
      session_id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, member_replica_id TEXT NOT NULL,
      direction TEXT NOT NULL, state TEXT NOT NULL, heads_json TEXT NOT NULL, created_at INTEGER NOT NULL
    );`,
  // Append-only evidence of copied-database quarantines; never rewritten by later joins.
  `CREATE TABLE sync_restore_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
      previous_peer_id TEXT NOT NULL, current_peer_id TEXT NOT NULL,
      repo_id TEXT NOT NULL, previous_replica_id TEXT NOT NULL, new_replica_id TEXT NOT NULL,
      roster_json TEXT
    );`,
  // Closure-only compaction keeps every operation row; protocol rows gate delta-only retention.
  `ALTER TABLE sync_versions ADD COLUMN compacted INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE sync_peer_protocols (
      repo_id TEXT NOT NULL, member_replica_id TEXT NOT NULL, protocol_version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, PRIMARY KEY (repo_id, member_replica_id)
    );`,
  // A rename or identity change applied in place must also retire the old path and file id, not only record the new ones.
  `DROP TRIGGER sync_file_generation_update;
    CREATE TRIGGER sync_file_generation_update AFTER UPDATE ON doc_files BEGIN
      INSERT INTO sync_file_generations SELECT OLD.doc_id, OLD.path, OLD.revision + 1, OLD.sync_id WHERE OLD.path IS NOT NEW.path
        ON CONFLICT (doc_id, path) DO UPDATE SET generation = MAX(generation + 1, excluded.generation), file_id = excluded.file_id;
      INSERT INTO sync_file_identity_generations SELECT OLD.doc_id, OLD.sync_id, OLD.revision + 1
        WHERE OLD.sync_id IS NOT NULL AND OLD.sync_id IS NOT NEW.sync_id
        ON CONFLICT (doc_id, file_id) DO UPDATE SET generation = MAX(generation + 1, excluded.generation);
      INSERT INTO sync_file_generations VALUES (NEW.doc_id, NEW.path, NEW.revision, NEW.sync_id)
        ON CONFLICT (doc_id, path) DO UPDATE SET generation = MAX(generation, excluded.generation), file_id = excluded.file_id;
      INSERT INTO sync_file_identity_generations SELECT NEW.doc_id, NEW.sync_id, NEW.revision WHERE NEW.sync_id IS NOT NULL
        ON CONFLICT (doc_id, file_id) DO UPDATE SET generation = MAX(generation, excluded.generation);
    END;`
];
