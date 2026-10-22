import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AsyncJsonStore, openAsyncJsonStore } from './async-json-store';
const dirs: string[] = [], stores: { dispose(): Promise<void> }[] = [];
async function fixture(maxBytes?: number) { const dir = await mkdtemp(join(tmpdir(), 'json-store-')); dirs.push(dir); const file = join(dir, 'kv.json'); const store = new AsyncJsonStore(file, maxBytes); stores.push(store); return { dir, file, store }; }
afterEach(async () => { await Promise.all(stores.splice(0).map(s => s.dispose())); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
it('serializes concurrent writes atomically, supports read/list/delete/clear and reload', async () => {
  const { file, dir, store } = await fixture();
  expect(await store.get('missing')).toBeUndefined();
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.set(`p:${i}`, i)));
  expect(await store.list('p:')).toHaveLength(20); expect(await store.get('p:2')).toBe(2);
  expect(Object.keys(JSON.parse(await readFile(file, 'utf8')))).toHaveLength(20);
  expect(await readdir(dir)).toEqual(['kv.json']); await store.delete('p:2'); expect(await store.get('p:2')).toBeUndefined();
  await store.dispose(); const next = new AsyncJsonStore(file); stores.push(next); expect(await next.get('p:1')).toBe(1);
  await next.clear(); expect(await next.list()).toEqual([]); await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('preserves corrupt and oversized legacy documents and enforces growth quotas', async () => {
  const { file, store } = await fixture(30); await writeFile(file, '{bad');
  await expect(store.get('a')).rejects.toThrow(); expect(await readFile(file, 'utf8')).toBe('{bad');
  await writeFile(file, JSON.stringify({ old: 'x'.repeat(100) })); expect(await store.get('old')).toHaveLength(100);
  await expect(store.set('new', 2)).rejects.toThrow('quota'); await store.delete('old'); await store.set('new', 2);
  await expect(store.set('x'.repeat(257), 1)).rejects.toThrow('key');
  await expect(store.set('large', 'x'.repeat(1024 * 1024))).rejects.toThrow('value');
});
it('shares writers across hot reload generations and rejects stale leases', async () => {
  const { file } = await fixture(); const a = openAsyncJsonStore(file), b = openAsyncJsonStore(file); stores.push(a, b);
  await Promise.all([a.set('a', 1), b.set('b', 2)]); await a.dispose(); expect(() => a.get('a')).toThrow('disposed');
  expect(await b.get('a')).toBe(1); const closing = b.dispose(); const c = openAsyncJsonStore(file); stores.push(c);
  await c.set('c', 3); await closing; expect(await c.list()).toEqual(['a', 'b', 'c']); await c.delete('a'); await c.clear(); expect(await c.list()).toEqual([]);
});
it('drains admitted writes before final lease teardown and a replacement lease opens', async () => {
  const { file } = await fixture(); const a = openAsyncJsonStore(file); stores.push(a);
  const writes = Array.from({ length: 20 }, (_, i) => a.set(String(i), i));
  const closing = a.dispose({ drain: true }); const b = openAsyncJsonStore(file); stores.push(b);
  await Promise.all(writes); await closing;
  expect(await b.list()).toHaveLength(20); expect(await b.get('19')).toBe(19);
  await b.dispose({ drain: true }); expect(() => b.set('stale', 1)).toThrow('disposed');
});
it('bounds pending calls and rejects disposed operations', async () => {
  const { store } = await fixture(); const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => store.set(String(i), i)));
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(8);
  await store.dispose(); await expect(store.get('a')).rejects.toThrow('disposed');
});
it('keeps the caller event loop live while reading a large legacy store', async () => {
  const { file, store } = await fixture(); await writeFile(file, JSON.stringify({ old: 'x'.repeat(12 * 1024 * 1024) }));
  let ticks = 0; const timer = setInterval(() => ticks++, 1);
  try { expect(await store.list()).toEqual(['old']); expect(ticks).toBeGreaterThan(5); } finally { clearInterval(timer); }
});

it('queues namespaces behind the global worker cap while allowing other timers to run', async () => {
  const { dir } = await fixture(); const many = Array.from({ length: 6 }, (_, i) => new AsyncJsonStore(join(dir, `store-${i}.json`))); stores.push(...many);
  let ticks = 0; const timer = setInterval(() => ticks++, 10);
  try { await Promise.all(many.map((store, i) => store.set('id', i))); expect(ticks).toBeGreaterThan(10); expect(await Promise.all(many.map(store => store.get('id')))).toEqual([0, 1, 2, 3, 4, 5]); }
  finally { clearInterval(timer); }
});
it('recovers after an uncloneable input and allows explicit clearing of corrupt storage', async () => {
  const { store, file } = await fixture(); await expect(store.set('bad', () => {})).rejects.toThrow(); await store.set('valid', 1); expect(await store.get('valid')).toBe(1);
  await store.dispose(); await writeFile(file, '{invalid'); const next = new AsyncJsonStore(file); stores.push(next); await next.clear(); expect(await next.list()).toEqual([]);
});
