import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '../compat/testing';
import { createStore } from '../api';
import { migrateLegacyTasks } from './index';

describe('existing Zana tasks', () => {
  it('preserves keys, gaps, dates, status and sequence exactly once, retaining the source', async () => {
    const { bb, zcc, harness } = createFakePluginHost();
    try {
      const item = { id: 'old-id', key: 'TSK-4', title: 'Keep this', description: 'User notes', status: 'in_progress',
        priority: 'high', dueDate: '2026-12-01', order: 9, createdAt: 1000, updatedAt: 2000 };
      const raw = { version: 2, nextSeq: 9, items: [item] };
      await zcc.storage.kv.set('store', raw);
      const store = createStore(bb);
      await migrateLegacyTasks(zcc, bb, store);
      await migrateLegacyTasks(zcc, bb, store);
      const projects = store.tasks.listProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({ name: 'Legacy tasks', prefix: 'TSK', nextTaskNumber: 9, linkedBbProjectId: null });
      expect(store.tasks.listTasks()).toMatchObject([{ key: 'TSK-4', title: item.title, description: item.description,
        status: item.status, priority: item.priority, dueDate: item.dueDate, position: item.order,
        createdAt: new Date(1000).toISOString(), updatedAt: new Date(2000).toISOString() }]);
      expect(store.tasks.createTask({ projectId: projects[0]!.id, title: 'Next' }).key).toBe('TSK-9');
      expect(await zcc.storage.kv.get('store')).toEqual(raw);
    } finally { await harness.dispose(); }
  });
  it('does not add an empty tracker to a fresh installation', async () => {
    const { bb, zcc, harness } = createFakePluginHost();
    try { const store = createStore(bb); await migrateLegacyTasks(zcc, bb, store); expect(store.tasks.listProjects()).toEqual([]); }
    finally { await harness.dispose(); }
  });
  it('rolls back the entire migration on failure and retries from the retained source', async () => {
    const { bb, zcc, harness } = createFakePluginHost();
    try {
      await zcc.storage.kv.set('items', [{ id: 'old', title: 'Older task', done: false }]);
      const store = createStore(bb);
      const create = store.tasks.createTask;
      store.tasks.createTask = () => { throw new Error('disk full'); };
      await expect(migrateLegacyTasks(zcc, bb, store)).rejects.toThrow('disk full');
      expect(store.tasks.listProjects()).toEqual([]);
      store.tasks.createTask = create;
      await migrateLegacyTasks(zcc, bb, store);
      expect(store.tasks.listTasks()).toHaveLength(1);
    } finally { await harness.dispose(); }
  });
});
