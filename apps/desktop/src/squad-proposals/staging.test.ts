import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync, symlinkSync, writeFileSync, mkdirSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStagingStore, isStagingId } from './staging.js';

const dirs: string[] = [];
const fresh = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-staging-'))); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('staging store', () => {
  it('writes files privately and reports bytes and paths', async () => {
    const root = join(fresh(), 'a', 'staged');
    const store = createStagingStore({ root });
    const result = await store.write('p1', [{ name: 'plan.md', text: 'héllo' }, { name: 'b.md', text: 'x' }]);
    expect(result.bytes).toBe(7);
    expect(result.paths).toEqual([join(await store.prepareRoot(), 'p1', 'plan.md'), join(await store.prepareRoot(), 'p1', 'b.md')]);
    expect(readFileSync(result.paths[0]!, 'utf8')).toBe('héllo');
    expect(statSync(result.paths[0]!).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, 'p1')).mode & 0o777).toBe(0o700);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(await store.usedBytes()).toBe(7);
  });

  it('is all or nothing: a failed write leaves no folder', async () => {
    const root = join(fresh(), 'staged');
    const store = createStagingStore({ root });
    await expect(store.write('p1', [{ name: 'a.md', text: '1' }, { name: 'a.md', text: '2' }])).rejects.toThrow();
    expect(await store.entries()).toEqual([]);
    expect(await store.usedBytes()).toBe(0);
  });

  it('refuses an existing proposal folder and bad ids', async () => {
    const store = createStagingStore({ root: join(fresh(), 'staged') });
    await store.write('p1', [{ name: 'a.md', text: '1' }]);
    await expect(store.write('p1', [{ name: 'a.md', text: '1' }])).rejects.toThrow();
    for (const bad of ['', '..', 'a/b', '.hidden', 'a\\b']) {
      expect(isStagingId(bad)).toBe(false);
      await expect(store.write(bad, [])).rejects.toThrow('invalid staging id');
      await expect(store.remove(bad)).rejects.toThrow('invalid staging id');
    }
  });

  it('removes a folder, tolerates a missing one, and never follows a link', async () => {
    const base = fresh();
    const store = createStagingStore({ root: join(base, 'staged') });
    await store.write('p1', [{ name: 'a.md', text: '1' }]);
    await store.remove('p1');
    await store.remove('p1');
    expect(existsSync(join(base, 'staged', 'p1'))).toBe(false);
    const outside = join(base, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.md'), 'keep');
    symlinkSync(outside, join(base, 'staged', 'link'));
    await store.remove('link');
    expect(existsSync(join(outside, 'keep.md'))).toBe(true);
    expect(existsSync(join(base, 'staged', 'link'))).toBe(false);
  });

  it('lists proposal folders and temp folders and removes an entry by name', async () => {
    const base = fresh();
    const store = createStagingStore({ root: join(base, 'staged') });
    await store.write('p1', [{ name: 'a.md', text: '12' }]);
    mkdirSync(join(base, 'staged', '.tmp-x-1'));
    writeFileSync(join(base, 'staged', '.tmp-x-1', 'f'), '123');
    utimesSync(join(base, 'staged', '.tmp-x-1'), 1, 1);
    const entries = await store.entries();
    expect(entries.find((e) => e.id === 'p1')).toBeDefined();
    expect(entries.find((e) => e.name === '.tmp-x-1')).toMatchObject({ modifiedAt: 1000 });
    expect(entries.find((e) => e.name === '.tmp-x-1')?.id).toBeUndefined();
    expect(await store.usedBytes()).toBe(5);
    await store.removeEntry('.tmp-x-1');
    expect(await store.usedBytes()).toBe(2);
    for (const bad of ['', '..', 'a/b', 'a\\b']) await expect(store.removeEntry(bad)).rejects.toThrow('invalid staging entry');
  });

  it('does not count a link as bytes', async () => {
    const base = fresh();
    const store = createStagingStore({ root: join(base, 'staged') });
    await store.prepareRoot();
    writeFileSync(join(base, 'big'), 'x'.repeat(100));
    symlinkSync(join(base, 'big'), join(base, 'staged', 'l'));
    expect(await store.usedBytes()).toBe(0);
  });
});
