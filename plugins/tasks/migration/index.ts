import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk';
import type { BbPluginApi } from '../compat/server';
import type { TasksApiStore } from '../api';
import { normalizeStore } from './legacy-model';

/** Import the former global KV board once. Keep its source intact for recovery. */
export async function migrateLegacyTasks(zcc: ZccPluginApi, bb: BbPluginApi, store: TasksApiStore): Promise<void> {
  const db = bb.storage.database();
  db.exec('CREATE TABLE IF NOT EXISTS zcc_legacy_import (id INTEGER PRIMARY KEY CHECK (id = 1))');
  if (db.prepare('SELECT id FROM zcc_legacy_import WHERE id = 1').get()) return;
  const raw = await zcc.storage.kv.get('store') ?? await zcc.storage.kv.get('items');
  const legacy = normalizeStore(raw);
  store.transaction(() => {
    if (db.prepare('SELECT id FROM zcc_legacy_import WHERE id = 1').get()) return;
    if (legacy.items.length) {
      const project = store.tasks.createProject({ name: 'Legacy tasks', prefix: 'TSK', color: 'gray' });
      for (const item of [...legacy.items].sort((a, b) => Number(a.key.split('-').at(-1)) - Number(b.key.split('-').at(-1)))) {
        const number = Number(item.key.split('-').at(-1));
        db.prepare('UPDATE projects SET next_task_number = ? WHERE id = ?').run(number, project.id);
        const task = store.tasks.createTask({ projectId: project.id, title: item.title, description: item.description,
          status: item.status, priority: item.priority, dueDate: item.dueDate });
        db.prepare('UPDATE tasks SET created_at = ?, updated_at = ?, position = ? WHERE id = ?')
          .run(new Date(item.createdAt).toISOString(), new Date(item.updatedAt).toISOString(), item.order, task.id);
      }
      db.prepare('UPDATE projects SET next_task_number = MAX(next_task_number, ?) WHERE id = ?').run(legacy.nextSeq, project.id);
    }
    db.prepare('INSERT INTO zcc_legacy_import (id) VALUES (1)').run();
  });
}
