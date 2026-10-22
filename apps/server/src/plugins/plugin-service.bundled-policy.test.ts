import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginService, loadManifestFromDir } from './plugin-service.js';
import { createPluginStore, pluginStorePath, type InstalledPluginRow, type PluginSourceKind } from './plugin-store.js';

const roots: string[] = [];
const services: ReturnType<typeof createPluginService>[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), 'bundled-policy-')); roots.push(dir); return dir; }
function plugin(dir: string, id = 'tasks', version = '1.0.0') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `zcc-plugin-${id}`, version, engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: `Tasks ${version}`, description: 'Bundled ownership fixture', branding: { icon: 'Puzzle' }, server: `./server-${version}.mjs` }
  }));
  writeFileSync(join(dir, `server-${version}.mjs`), `export default zcc => {
    zcc.rpc.method('save', () => zcc.storage.kv.set('saved', 'keep me'));
    zcc.rpc.method('read', async () => ({ version: '${version}', saved: await zcc.storage.kv.get('saved') }));
  };`);
  return dir;
}
function service(dataDir: string, bundledRoot: string, extra: Partial<Parameters<typeof createPluginService>[0]> = {}) {
  const result = createPluginService({ dataDir, bundledRoot, ...extra }); services.push(result); return result;
}
async function seed(dataDir: string, dir: string, sourceKind: PluginSourceKind) {
  const m = loadManifestFromDir(dir);
  const row: InstalledPluginRow = {
    id: m.id, version: m.version, name: m.name, description: m.description, icon: 'Puzzle', enabled: true, status: 'running', statusDetail: null,
    provenance: sourceKind === 'builtin' ? 'builtin' : 'catalog', sourceKind,
    source: sourceKind === 'builtin' ? `builtin:${m.id}` : 'git:https://example.test/plugin@HEAD', rootDir: dir,
    serverEntry: m.serverEntry, appEntry: m.appEntry, npmResolvedVersion: null, npmIntegrity: null,
    gitResolvedCommit: sourceKind === 'git' ? 'old-commit' : null,
    catalogMarketplace: sourceKind === 'git' ? 'official' : null, catalogEntryId: sourceKind === 'git' ? m.id : null,
    installedAt: 1, updatedAt: 2
  };
  await createPluginStore({ file: pluginStorePath(dataDir) }).upsert(row);
  return row;
}

beforeEach(() => { vi.stubEnv('ZCC_OFFICIAL_MARKETPLACE_URL', 'off'); vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', 'off'); });
afterEach(() => { services.splice(0).forEach(s => s.stop()); roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.unstubAllEnvs(); });

describe('bundled plugin policy through PluginService', () => {
  it.each(['git', 'npm', 'catalog'] as const)('rejects an actual bundled identity delivered by %s and cleans staging', async kind => {
    const dataDir = root(), bundled = root(); plugin(join(bundled, 'tasks'));
    const cloneGit = vi.fn(async (_url: string, dest: string) => { plugin(dest); return { commit: 'new-commit' }; });
    const spawnNpm = vi.fn(async (_args: string[], dest: string) => { plugin(join(dest, 'node_modules', 'innocent-name')); return { code: 0, stdout: '', stderr: '' }; });
    const subject = service(dataDir, bundled, { cloneGit, spawnNpm, fetchJson: async () => ({ schemaVersion: 1, name: 'test', displayName: 'Test', plugins: [
      { id: 'innocent-name', displayName: 'Alias', description: 'Alias', author: { name: 'Test' }, source: { git: { url: 'https://example.test/plugin', ref: 'HEAD' } } }
    ] }) });
    if (kind === 'catalog') await subject.addMarketplace('https://example.test/catalog.json');
    const source = kind === 'git' ? 'git:https://example.test/plugin' : kind === 'npm' ? 'npm:innocent-name' : 'innocent-name@test';
    await expect(subject.install(source)).rejects.toThrow(/reserved.*builtin:tasks/);
    expect(subject.get('tasks')).toBeUndefined();
    const generations = join(dataDir, 'plugins', 'generations');
    expect(readdirSync(generations)).toEqual([]);
  });

  it('installs bare official names offline and refuses standalone updates', async () => {
    const bundled = root(); plugin(join(bundled, 'tasks'));
    const fetchJson = vi.fn(), cloneGit = vi.fn(), subject = service(root(), bundled, { fetchJson, cloneGit });
    expect(await subject.install('tasks')).toMatchObject({ id: 'tasks', sourceKind: 'builtin', status: 'running' });
    expect(subject.snapshot()[0]?.updatePolicy).toBe('bundled');
    await expect(subject.applyUpdate('tasks')).rejects.toThrow(/updates with Zana releases/);
    expect(await subject.checkUpdates()).toEqual([]);
    expect(fetchJson).not.toHaveBeenCalled(); expect(cloneGit).not.toHaveBeenCalled();
  });

  it('requires managed development for local bundled overrides and permits their reload', async () => {
    const dir = plugin(root()), bundled = root(); plugin(join(bundled, 'tasks'));
    await expect(service(root(), bundled).install(dir)).rejects.toThrow(/Local development requires/);
    const subject = service(root(), bundled, { watchBuiltinPluginSources: true });
    await subject.install(dir); await subject.reload('tasks');
    expect(subject.get('tasks')).toMatchObject({ sourceKind: 'path', rootDir: dir, status: 'running', statusDetail: null });
    expect(subject.snapshot()[0]?.updatePolicy).toBe('local');
    expect(existsSync(dir)).toBe(true);
  });

  it('does not trust a corrupt bundled manifest merely because its directory name is official', async () => {
    const bundled = root(); plugin(join(bundled, 'tasks'), 'unrelated');
    const subject = service(root(), bundled);
    await expect(subject.install('builtin:tasks')).rejects.toThrow(/identity mismatch/);
    expect(subject.list()).toEqual([]);
  });

  it('reconciles version and runtime entries at startup while preserving storage and disabled state', async () => {
    const dataDir = root(), oldBundle = root(), newBundle = root();
    plugin(join(oldBundle, 'tasks')); plugin(join(newBundle, 'tasks'), 'tasks', '2.0.0');
    const first = service(dataDir, oldBundle);
    await first.install('builtin:tasks'); await first.callRpc('tasks', 'save', {}); await first.disable('tasks'); first.stop();
    const before = first.get('tasks')!;
    const next = service(dataDir, newBundle);
    await next.start();
    expect(next.get('tasks')).toMatchObject({ version: '2.0.0', name: 'Tasks 2.0.0', serverEntry: './server-2.0.0.mjs', rootDir: join(newBundle, 'tasks'), enabled: false, status: 'disabled', installedAt: before.installedAt });
    await next.enable('tasks');
    await expect(next.callRpc('tasks', 'read', {})).resolves.toEqual({ version: '2.0.0', saved: 'keep me' });
    await next.remove('tasks'); await next.reconcileBuiltins(); expect(next.get('tasks')).toBeUndefined();
  });

  it('reloads the running bundled generation when reconciliation changes its metadata', async () => {
    const bundled = root(), dir = plugin(join(bundled, 'tasks')), subject = service(root(), bundled);
    await subject.install('builtin:tasks'); plugin(dir, 'tasks', '2.0.0');
    await subject.reconcileBuiltins();
    expect(subject.get('tasks')?.version).toBe('2.0.0');
    await expect(subject.callRpc('tasks', 'read', {})).resolves.toMatchObject({ version: '2.0.0' });
  });

  it('retains pre-policy remote code and data without attempting an unsafe migration or remote update', async () => {
    const dataDir = root(), bundled = root(), existing = plugin(join(dataDir, 'plugins', 'generations', 'legacy', 'git'), 'tasks', '3.0.0');
    plugin(join(bundled, 'tasks'), 'tasks', '1.0.0');
    const saved = await seed(dataDir, existing, 'git'), cloneGit = vi.fn(), fetchJson = vi.fn();
    const subject = service(dataDir, bundled, { cloneGit, fetchJson });
    await subject.start(); await subject.callRpc('tasks', 'save', {});
    expect(subject.get('tasks')).toMatchObject({ rootDir: existing, version: '3.0.0', status: 'running', statusDetail: expect.stringContaining('remote updates are blocked') });
    expect(subject.snapshot()[0]?.statusDetail).toContain('migrate');
    expect(subject.snapshot()[0]?.updatePolicy).toBe('migration-required');
    expect(await subject.checkUpdates()).toEqual([]);
    await expect(subject.reload('tasks')).rejects.toThrow(/reserved/);
    await expect(subject.applyUpdate('tasks')).rejects.toThrow(/remote updates are blocked/);
    await expect(subject.install(existing)).rejects.toThrow(/reserved/);
    await expect(subject.install('builtin:tasks')).rejects.toThrow(/Migration required/);
    expect(subject.get('tasks')?.installedAt).toBe(saved.installedAt);
    await expect(subject.callRpc('tasks', 'read', {})).resolves.toEqual({ version: '3.0.0', saved: 'keep me' });
    expect(cloneGit).not.toHaveBeenCalled(); expect(fetchJson).not.toHaveBeenCalled();
    await subject.disable('tasks'); expect(subject.snapshot()[0]?.statusDetail).toContain('migrate');
    expect(readFileSync(join(existing, 'package.json'), 'utf8')).toContain('3.0.0');
  });

  it('retains a working builtin when a replacement manifest is invalid or incompatible', async () => {
    const dataDir = root(), oldBundle = root(), newBundle = root(), existing = plugin(join(oldBundle, 'tasks'));
    await seed(dataDir, existing, 'builtin');
    const dir = plugin(join(newBundle, 'tasks'), 'unrelated');
    const subject = service(dataDir, newBundle); await subject.reconcileBuiltins();
    expect(subject.get('tasks')?.rootDir).toBe(existing);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); pkg.name = 'zcc-plugin-tasks'; pkg.engines.zcc = '>=999.0.0';
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    await subject.reconcileBuiltins(); expect(subject.get('tasks')?.rootDir).toBe(existing);
  });

  it('retains migration guidance when an older independent installation has missing code', async () => {
    const dataDir = root(), bundled = root(), existing = plugin(root());
    plugin(join(bundled, 'tasks')); await seed(dataDir, existing, 'git');
    rmSync(existing, { recursive: true, force: true });
    const subject = service(dataDir, bundled); await subject.start();
    expect(subject.get('tasks')).toMatchObject({ rootDir: existing, status: 'degraded' });
    expect(subject.snapshot()[0]?.statusDetail).toContain('Back up and migrate');
    await expect(subject.install('builtin:tasks')).rejects.toThrow(/Migration required/);
  });

  it('keeps unrelated internal catalog plugins installable', async () => {
    const subject = service(root(), root(), { cloneGit: async (_url, dest) => { plugin(dest, 'private-notes'); return { commit: 'private' }; }, fetchJson: async () => ({ schemaVersion: 1, name: 'internal', displayName: 'Internal', plugins: [
      { id: 'private-notes', displayName: 'Private', description: 'Private', author: { name: 'Internal' }, source: { git: { url: 'https://example.test/private' } } }
    ] }) });
    await subject.addMarketplace('https://example.test/internal', { official: true });
    expect(await subject.install('private-notes@internal')).toMatchObject({ id: 'private-notes', sourceKind: 'git', status: 'running', statusDetail: null });
  });
});
