import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectCatalogue, resolveProjectCatalogueSource } from './project-catalogue.js';
import { machineProjectPageSchema } from '@zana-ai/zcc-contracts/machine-projects';

let root: string;
const catalogues: ProjectCatalogue[] = [];
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'machine-catalogue-'))); });
afterEach(async () => { await Promise.all(catalogues.splice(0).map(row => row.close())); vi.restoreAllMocks(); vi.useRealTimers(); await fs.rm(root, { recursive: true, force: true }); });
function catalogue(source = root, changed = vi.fn()) { const result = new ProjectCatalogue(join(root, 'daemon'), source, changed); catalogues.push(result); return result; }
async function folder(name: string) { const path = join(root, name); await fs.mkdir(path); return path; }
const source = (projects: unknown) => fs.writeFile(join(root, 'projects.json'), JSON.stringify({ version: 1, projects }));

it('resolves the project source for explicit, old installed, and app/dev daemon layouts', () => {
  expect(resolveProjectCatalogueSource('/home/me/.zcc-machines/instance', { ZCC_DATA_DIR: '/home/me/.zcc-machines/instance' }, '/home/me')).toBe('/home/me/.zcc');
  expect(resolveProjectCatalogueSource('/home/me/.zcc-machines/instance', { ZCC_PROJECT_CATALOGUE_DATA_DIR: ' /custom/app ' }, '/home/me')).toBe('/custom/app');
  expect(resolveProjectCatalogueSource('/home/me/.zcc-dev', { ZCC_DATA_DIR: '/home/me/.zcc-dev' }, '/home/me')).toBe('/home/me/.zcc-dev');
  expect(resolveProjectCatalogueSource('/tmp/daemon', {}, '/home/me')).toBe('/home/me/.zcc');
});

it('keeps canonical identities across concurrent writers, aliases and daemon restarts', async () => {
  const path = await folder('repo'), alias = join(root, 'alias'); await fs.symlink(path, alias);
  const first = catalogue(), second = catalogue();
  const [a, b] = await Promise.all([first.register([{ path, name: 'API' }]), second.register([{ path: alias }])]);
  expect(a[0].id).toBe(b[0].id);
  expect((await catalogue().page(0, 100)).projects).toEqual(a);
  expect((await fs.stat(first.file)).mode & 0o777).toBe(0o600);
  expect((await fs.readdir(join(root, 'daemon'))).filter(name => name.includes('.tmp-'))).toEqual([]);
});
it('imports only local named projects, publishes changes and retains missing registrations', async () => {
  const path = await folder('api'), changed = vi.fn(), registry = catalogue(root, changed);
  await source([{ path, name: 'API' }, { path, name: 'Foreign', hostId: randomUUID() }, { path, name: 'SSH', remote: {} }, { path, quickAgent: true }, null, { path: 'relative', name: 'No' }, { path: join(root, 'absent'), name: 'Absent' }]);
  const first = machineProjectPageSchema.parse(await registry.page(0, 100));
  expect(first.projects.map(row => row.name)).toEqual(['API']);
  await registry.refresh(); expect(changed).toHaveBeenCalledOnce();
  await source([{ path, name: 'Renamed API' }]);
  const renamed = await registry.page(0, 100); expect(renamed.projects[0]).toEqual({ ...first.projects[0], name: 'Renamed API' });
  await fs.rm(path, { recursive: true });
  const missing = await registry.page(0, 100);
  expect(missing.projects).toEqual(renamed.projects); expect(missing.revision).not.toBe(renamed.revision);
  await source([]); expect((await registry.page(0, 100)).projects).toEqual(renamed.projects);
});
it('pages a bounded snapshot and rejects invalid registrations without partial writes', async () => {
  const registry = catalogue();
  const paths = await Promise.all(Array.from({ length: 12 }, (_, i) => folder(`repo-${i}`)));
  await registry.register(paths.map(path => ({ path })));
  const first = await registry.page(0, 10), last = await registry.page(10, 10);
  expect(first.projects).toHaveLength(10); expect(first.nextOffset).toBe(10); expect(last.projects).toHaveLength(2); expect(last.nextOffset).toBeNull();
  expect(last.revision).toBe(first.revision);
  for (const inputs of [[], Array(101).fill({ path: root }), [{ path: 'relative' }], [{ path: join(root, 'missing') }]]) await expect(registry.register(inputs)).rejects.toThrow();
  const file = join(root, 'file'); await fs.writeFile(file, ''); await expect(registry.register([{ path: file }])).rejects.toThrow('unavailable');
  expect((await registry.page(0, 100)).projects).toHaveLength(12);
});
it('preserves corrupt and oversized catalogues and retries failed source reads', async () => {
  const registry = catalogue(); await fs.mkdir(join(root, 'daemon'));
  await fs.writeFile(registry.file, 'broken'); await expect(registry.page(0, 100)).rejects.toThrow();
  expect(await fs.readFile(registry.file, 'utf8')).toBe('broken');
  await fs.rm(registry.file);
  await fs.writeFile(join(root, 'projects.json'), '{'); await expect(registry.refresh()).rejects.toThrow();
  await source([]); await registry.refresh();
  await fs.writeFile(registry.file, ' '.repeat(8 * 1024 * 1024 + 1)); await expect(registry.page(0, 100)).rejects.toThrow('size limit');
  await fs.rm(registry.file); await source(Array(1001).fill({})); await expect(registry.refresh()).rejects.toThrow('oversized');
});
it('cleans temporary files on failed rename and polls with a single disposable timer', async () => {
  const path = await folder('api'), registry = catalogue();
  const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk full'));
  await expect(registry.register([{ path }])).rejects.toThrow('disk full');
  expect((await fs.readdir(join(root, 'daemon'))).filter(name => name.includes('.tmp-'))).toEqual([]);
  rename.mockRestore();
  await source([{ path, name: 'API' }]);
  await registry.refresh();
  vi.useFakeTimers(); const refresh = vi.spyOn(registry, 'refresh'); registry.start(); registry.start();
  expect(vi.getTimerCount()).toBe(1); await registry.close(); expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(20_000); expect(refresh).toHaveBeenCalledTimes(1);
  await registry.refresh();
});
it('refuses catalogue overflow and source permission failures', async () => {
  const registry = catalogue(), path = await folder('last'); await fs.mkdir(join(root, 'daemon'));
  await fs.writeFile(registry.file, JSON.stringify({ version: 1, projects: Array.from({ length: 1000 }, (_, i) => ({ id: randomUUID(), path: `/repo-${i}`, name: `Repo ${i}` })) }));
  await expect(registry.register([{ path }])).rejects.toThrow('full');
  const stat = vi.spyOn(fs, 'stat').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
  await expect(registry.refresh()).rejects.toThrow('denied'); stat.mockRestore();
});
