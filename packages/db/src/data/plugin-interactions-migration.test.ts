import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../connection.js';

it('installs durable plugin interaction storage once when upgrading a prior database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-plugin-interactions-'));
  const file = join(dir, 'runtime.sqlite');
  let db = openDatabase(file);
  try {
    db.sqlite.exec(`
      DROP INDEX plugin_interactions_pending_expiry_idx;
      DROP INDEX plugin_interactions_plugin_project_status_idx;
      DROP INDEX plugin_interactions_terminal_retention_idx;
      DROP TABLE plugin_interactions;
      DELETE FROM runtime_schema_migrations WHERE version = 27;
    `);
    db.close();
    db = openDatabase(file);
    db.sqlite.prepare(`INSERT INTO plugin_interactions (
      id, plugin_id, project_id, correlation_id, kind, payload_json, status,
      generation, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('int_1', 'probe', 'project_1', 'correlation_1', 'prompt', '{}', 'pending', 1, 1, 1);
    db.close();
    db = openDatabase(file);

    expect(
      db.sqlite.prepare('SELECT version FROM runtime_schema_migrations WHERE version = 27').get(),
    ).toEqual({ version: 27 });
    expect(
      db.sqlite.prepare('SELECT status FROM plugin_interactions WHERE id = ?').get('int_1'),
    ).toEqual({ status: 'pending' });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
