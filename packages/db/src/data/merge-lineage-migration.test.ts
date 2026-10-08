import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../connection.js';
import { createConversationThread, getConversationThread } from './conversation-threads.js';
import { upsertHost } from './hosts.js';
import { createEnvironment } from './environments.js';

it.each(['fresh', 'v26', 'main27', 'main28', 'candidate27'])('preserves data and both schemas when upgrading %s', lineage => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-merge-migration-'));
  const file = join(dir, 'runtime.sqlite');
  let db = openDatabase(file);
  try {
    const host = upsertHost(db, { name: 'host', hostKeyHash: 'hash' });
    const environment = createEnvironment(db, { projectId: 'project', hostId: host.id });
    const thread = createConversationThread(db, { projectId: 'project', hostId: host.id, environmentId: environment.id, providerId: 'fake' });
    if (lineage !== 'fresh') db.sqlite.exec('DELETE FROM runtime_schema_migrations WHERE version = 29');
    if (lineage === 'v26' || lineage === 'candidate27') {
      db.sqlite.exec(`DROP TABLE plugin_interactions; DROP TABLE dispatch_admission_generations;
        DELETE FROM runtime_schema_migrations WHERE version >= ${lineage === 'v26' ? 27 : 28};`);
    }
    if (lineage === 'main27') db.sqlite.exec('DROP TABLE dispatch_admission_generations; DELETE FROM runtime_schema_migrations WHERE version = 28');
    if (lineage !== 'fresh' && lineage !== 'candidate27') db.sqlite.exec('DROP INDEX thread_events_user_history_idx; DROP INDEX threads_visible_project_idx');
    const insertInteraction = () => db.sqlite.prepare(`INSERT INTO plugin_interactions
      (id, plugin_id, project_id, correlation_id, kind, payload_json, status, generation, created_at, updated_at)
      VALUES ('retained', 'probe', 'project', 'correlation', 'prompt', '{}', 'pending', 1, 1, 1)`).run();
    if (lineage === 'main27' || lineage === 'main28' || lineage === 'fresh') insertInteraction();
    db.close();
    db = openDatabase(file);
    expect(getConversationThread(db, thread.id)?.id).toBe(thread.id);
    expect(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name IN ('plugin_interactions', 'dispatch_admission_generations', 'thread_events_user_history_idx', 'threads_visible_project_idx') ORDER BY name").all())
      .toEqual(['dispatch_admission_generations', 'plugin_interactions', 'thread_events_user_history_idx', 'threads_visible_project_idx'].map(name => ({ name })));
    if (lineage === 'v26' || lineage === 'candidate27') insertInteraction();
    expect(db.sqlite.prepare('SELECT version FROM runtime_schema_migrations WHERE version >= 27 ORDER BY version').all())
      .toEqual([{ version: 27 }, { version: 28 }, { version: 29 }, { version: 30 }]);
    db.close();
    db = openDatabase(file);
    expect(db.sqlite.prepare("SELECT status FROM plugin_interactions WHERE id = 'retained'").get()).toEqual({ status: 'pending' });
    expect(getConversationThread(db, thread.id)?.id).toBe(thread.id);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
