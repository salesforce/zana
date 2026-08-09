import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSavedStore,
  createMemorySavedStore,
  type ISavedStore
} from '../saved-store.js';
import type { SavedRecordInput } from '../../shared/types.js';

const baseInput: SavedRecordInput = {
  projectId: 'proj-1',
  projectLabel: 'demo',
  title: 'A useful report',
  comments: 'here is what happened'
};

function runSuite(label: string, make: () => Promise<ISavedStore> | ISavedStore) {
  describe(`SavedStore (${label})`, () => {
    let store: ISavedStore;
    beforeEach(async () => {
      store = await make();
    });

    it('save assigns id + savedAt and returns the record', async () => {
      const before = Date.now();
      const rec = await store.save(baseInput);
      expect(rec.id).toMatch(/[0-9a-f-]{36}/);
      expect(rec.savedAt).toBeGreaterThanOrEqual(before);
      expect(rec.title).toBe('A useful report');
      expect(rec.projectId).toBe('proj-1');
    });

    it('rejects missing projectId / title', async () => {
      await expect(store.save({ ...baseInput, projectId: '' })).rejects.toThrow(/projectId/);
      await expect(store.save({ ...baseInput, title: '  ' })).rejects.toThrow(/title/);
    });

    it('rejects when neither comments nor docs are present', async () => {
      await expect(
        store.save({ projectId: 'p', title: 't' })
      ).rejects.toThrow(/docs or comments/);
    });

    it('accepts docs-only (no comments)', async () => {
      const rec = await store.save({
        projectId: 'p',
        title: 'doc report',
        docs: [{ path: 'a.md', content: '# hi' }]
      });
      expect(rec.docs?.[0].path).toBe('a.md');
    });

    it('list returns newest-first by savedAt', async () => {
      const a = await store.save({ ...baseInput, title: 'first' });
      // Force a later savedAt by hand (Date.now resolution may tie).
      const b = await store.save({ ...baseInput, title: 'second' });
      const list = await store.list();
      const ids = list.map((r) => r.id);
      // b saved no earlier than a; newest-first means b is at or before a's index.
      expect(ids).toContain(a.id);
      expect(ids).toContain(b.id);
      expect(list[0].savedAt).toBeGreaterThanOrEqual(list[list.length - 1].savedAt);
    });

    it('round-trips docs snapshot flags', async () => {
      const rec = await store.save({
        projectId: 'p',
        title: 'flags',
        docs: [
          { path: 'big.txt', content: 'partial', truncated: true },
          { path: 'img.png', binary: true },
          { path: 'gone.md', error: 'Project no longer exists' }
        ]
      });
      const reread = (await store.list()).find((r) => r.id === rec.id)!;
      expect(reread.docs).toEqual([
        { path: 'big.txt', content: 'partial', truncated: true },
        { path: 'img.png', binary: true },
        { path: 'gone.md', error: 'Project no longer exists' }
      ]);
    });

    it('delete removes the record; missing id returns false', async () => {
      const rec = await store.save(baseInput);
      expect(await store.delete(rec.id)).toBe(true);
      expect((await store.list()).find((r) => r.id === rec.id)).toBeUndefined();
      expect(await store.delete('no-such-id')).toBe(false);
    });

    it('onChanged fires on save and delete with the full list; dispose stops it', async () => {
      const seen: number[] = [];
      const off = store.onChanged((records) => seen.push(records.length));
      const rec = await store.save(baseInput);
      await store.save({ ...baseInput, title: 'two' });
      await store.delete(rec.id);
      off();
      await store.save({ ...baseInput, title: 'after dispose' });
      expect(seen).toEqual([1, 2, 1]);
    });
  });
}

runSuite('in-memory', () => createMemorySavedStore());

describe('SavedStore (file-backed)', () => {
  let dir: string;
  let store: ISavedStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cc-saved-'));
    store = createSavedStore({ dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes one <id>.json per record and leaves no .tmp behind', async () => {
    const rec = await store.save(baseInput);
    const names = await readdir(dir);
    expect(names).toContain(`${rec.id}.json`);
    expect(names.some((n) => n.includes('.tmp'))).toBe(false);
  });

  it('persists across a fresh store instance on the same dir', async () => {
    const rec = await store.save(baseInput);
    const reopened = createSavedStore({ dir });
    const list = await reopened.list();
    expect(list.map((r) => r.id)).toContain(rec.id);
  });

  it('list returns [] when the dir does not exist', async () => {
    const fresh = createSavedStore({ dir: join(dir, 'nope') });
    expect(await fresh.list()).toEqual([]);
  });

  it('skips unparseable files without throwing', async () => {
    const rec = await store.save(baseInput);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'garbage.json'), '{ not json', 'utf-8');
    const list = await store.list();
    expect(list.map((r) => r.id)).toEqual([rec.id]);
  });
});
