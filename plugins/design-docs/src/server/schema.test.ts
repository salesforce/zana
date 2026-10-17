import { describe, expect, it } from 'vitest';
import { applyPluginSqliteMigrations } from '../../../../apps/server/src/plugins/plugin-database-migrations.js';
import { DESIGN_DOC_MIGRATIONS } from './schema.js';
import { repairLegacyPeerSyncMigrationIndexes } from './store.js';
import { createTestDatabase } from './test-db.js';

function migrate(db: ReturnType<typeof createTestDatabase>, statements: readonly string[]): void {
  applyPluginSqliteMigrations(db.runScript, db.prepare, db.transaction, statements);
}

describe('DESIGN_DOC_MIGRATIONS', () => {
  it('upgrades the peer-first development lineage without replaying migrations', () => {
    const db = createTestDatabase();
    const peerFirstMigrations = [...DESIGN_DOC_MIGRATIONS.slice(0, 2), ...DESIGN_DOC_MIGRATIONS.slice(3, -1)];
    migrate(db, peerFirstMigrations);
    db.prepare(`INSERT INTO docs (id, slug, title, created_at, updated_at, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run('doc-1', 'legacy', 'Legacy doc', 1, 1, 'you', 'you');

    repairLegacyPeerSyncMigrationIndexes(db);
    migrate(db, DESIGN_DOC_MIGRATIONS);
    migrate(db, DESIGN_DOC_MIGRATIONS);

    expect(db.prepare('SELECT title, pinned_at, alternative_to FROM docs WHERE id = ?').get('doc-1')).toEqual({
      title: 'Legacy doc', pinned_at: null, alternative_to: null
    });
    expect(db.prepare('SELECT id FROM _zcc_migrations ORDER BY id').all()).toEqual(
      DESIGN_DOC_MIGRATIONS.map((_, id) => ({ id }))
    );
  });

  it('keeps the released navigation-first lineage stable', () => {
    const db = createTestDatabase();
    migrate(db, DESIGN_DOC_MIGRATIONS);
    db.prepare(`INSERT INTO docs (id, slug, title, created_at, updated_at, created_by, updated_by, pinned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('doc-1', 'released', 'Released doc', 1, 1, 'you', 'you', 1);

    repairLegacyPeerSyncMigrationIndexes(db);
    migrate(db, DESIGN_DOC_MIGRATIONS);

    expect(db.prepare('SELECT title, pinned_at FROM docs WHERE id = ?').get('doc-1')).toEqual({
      title: 'Released doc', pinned_at: 1
    });
    expect(db.prepare('SELECT id FROM _zcc_migrations ORDER BY id').all()).toEqual(
      DESIGN_DOC_MIGRATIONS.map((_, id) => ({ id }))
    );
  });

  it('advances the old path and file id generations when a doc_files row is updated in place', () => {
    const db = createTestDatabase();
    migrate(db, DESIGN_DOC_MIGRATIONS);
    db.prepare(`INSERT INTO docs (id, slug, title, created_at, updated_at, created_by, updated_by)
      VALUES ('d', 's', 't', 1, 1, 'you', 'you')`).run();
    db.prepare(`INSERT INTO doc_files (doc_id, path, content, encoding, size, revision, updated_at, updated_by, sync_id)
      VALUES ('d', 'old.md', 'x', 'utf8', 1, 3, 1, 'you', 'f-old')`).run();
    db.prepare("UPDATE doc_files SET path = 'new.md', sync_id = 'f-new', revision = 4 WHERE doc_id = 'd'").run();
    expect(db.prepare("SELECT generation FROM sync_file_generations WHERE path = 'old.md'").get()).toEqual({ generation: 4 });
    expect(db.prepare("SELECT generation FROM sync_file_generations WHERE path = 'new.md'").get()).toEqual({ generation: 4 });
    expect(db.prepare("SELECT generation FROM sync_file_identity_generations WHERE file_id = 'f-old'").get()).toEqual({ generation: 4 });
  });
});
