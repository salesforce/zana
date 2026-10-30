import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPluginService } from './plugin-service.js';
import { createPluginStore, pluginStorePath, type InstalledPluginRow } from './plugin-store.js';

vi.mock('./builtin-registry.js', async original => ({
  ...await original<typeof import('./builtin-registry.js')>(), BUILTIN_PLUGINS: [], OFFICIAL_PLUGINS: []
}));
const roots: string[] = [];
const services: ReturnType<typeof createPluginService>[] = [];
afterEach(() => {
  services.splice(0).forEach(service => service.stop());
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
  vi.unstubAllEnvs();
});

async function fixture(enabled = true, missing = false) {
  for (const name of ['ZCC_OFFICIAL_MARKETPLACE_URL', 'ZCC_COMMUNITY_MARKETPLACE_SOURCE', 'ZCC_INTERNAL_MARKETPLACE_SOURCE']) vi.stubEnv(name, 'off');
  const root = mkdtempSync(join(tmpdir(), 'external-plugin-'));
  roots.push(root);
  const previous = join(root, 'previous');
  if (!missing) writePlugin(previous, 'export default zcc => zcc.rpc.method("version", () => "old");');
  const state = join(root, 'plugins/salesforce');
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, 'kv.json'), JSON.stringify({ target: 'dev', saved: { scenario: true } }));
  writeFileSync(join(state, 'settings.json'), JSON.stringify({ defaultOrg: 'dev' }));
  const row: InstalledPluginRow = {
    id: 'salesforce', name: 'Salesforce', description: '', icon: 'Cloud', version: '0.0.1',
    enabled, status: 'disabled', statusDetail: null, provenance: 'builtin', sourceKind: 'builtin',
    source: 'builtin:salesforce', rootDir: previous, serverEntry: './server.mjs', appEntry: null,
    npmResolvedVersion: null, npmIntegrity: null, gitResolvedCommit: null,
    catalogMarketplace: null, catalogEntryId: null, installedAt: 12, updatedAt: 13, toolPolicy: 'true'
  };
  const store = createPluginStore({ file: pluginStorePath(root) });
  await store.upsert(row);
  return { root, previous, state, row, store };
}
function writePlugin(root: string, server: string, id = 'salesforce') {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version: '0.1.0', zcc: { name: id, description: 'Fixture', branding: { icon: 'Cloud' }, server: './server.mjs' } }));
  writeFileSync(join(root, 'server.mjs'), server);
}
function service(root: string, cloneGit: NonNullable<Parameters<typeof createPluginService>[0]['cloneGit']>) {
  const instance = createPluginService({ dataDir: root, bundledRoot: join(root, 'empty'), cloneGit, activationStabilizationMs: 0 });
  services.push(instance);
  return instance;
}
describe('bundled to independent migration', () => {
  it.each([true, false])('preserves data, identity and enabled=%s through restart', async enabled => {
    const f = await fixture(enabled);
    const clone = vi.fn(async (url: string, dest: string, ref: string) => {
      expect(url).toBe('https://github.com/grebmann1/zcc-plugin-salesforce.git');
      expect(ref).toBe('runtime');
      writePlugin(dest, 'export default zcc => zcc.rpc.method("version", () => "new");');
      return { commit: 'a'.repeat(40), refKind: 'branch' as const };
    });
    const app = service(f.root, clone);
    await app.start();
    expect(app.get('salesforce')).toMatchObject({ id: 'salesforce', enabled, sourceKind: 'git', installedAt: 12, toolPolicy: 'true', catalogMarketplace: 'official' });
    expect(JSON.parse(readFileSync(join(f.state, 'kv.json'), 'utf8'))).toEqual({ target: 'dev', saved: { scenario: true } });
    expect(JSON.parse(readFileSync(join(f.state, 'settings.json'), 'utf8'))).toEqual({ defaultOrg: 'dev' });
    if (enabled) await expect(app.callRpc('salesforce', 'version', {})).resolves.toBe('new');
    app.stop();
    await service(f.root, clone).start();
    expect(clone).toHaveBeenCalledTimes(1);
  });
  it('can migrate when the previous app bundle is gone', async () => {
    const f = await fixture(false, true);
    const app = service(f.root, async (_, dest) => { writePlugin(dest, 'export default () => {};'); return { commit: 'a'.repeat(40) }; });
    await app.start();
    expect(app.get('salesforce')?.sourceKind).toBe('git');
    expect(existsSync(join(f.state, 'kv.json'))).toBe(true);
  });
  it('keeps the old installation and data when offline, then retries', async () => {
    const f = await fixture();
    let offline = true;
    const app = service(f.root, async (_, dest) => {
      if (offline) throw Error('offline');
      writePlugin(dest, 'export default () => {};'); return { commit: 'a'.repeat(40) };
    });
    await app.start();
    expect(app.get('salesforce')).toMatchObject({ sourceKind: 'builtin', status: 'running' });
    expect(app.get('salesforce')?.rootDir).not.toBe(f.previous);
    offline = false;
    await app.reconcileBuiltins();
    expect(app.get('salesforce')?.sourceKind).toBe('git');
  });
  it('restores saved data and old code if candidate activation writes then fails', async () => {
    const f = await fixture();
    const app = service(f.root, async (_, dest) => {
      writePlugin(dest, 'export default async zcc => { await zcc.storage.kv.set("target", "wrong"); throw Error("bad-candidate"); };');
      return { commit: 'a'.repeat(40) };
    });
    await app.start();
    expect(app.get('salesforce')?.sourceKind).toBe('builtin');
    expect(JSON.parse(readFileSync(join(f.state, 'kv.json'), 'utf8')).target).toBe('dev');
    await expect(app.callRpc('salesforce', 'version', {})).resolves.toBe('old');
  });
  it('rejects a mismatched remote manifest without changing the registration', async () => {
    const f = await fixture(false);
    const app = service(f.root, async (_, dest) => { writePlugin(dest, 'export default () => {};', 'wrong'); return { commit: 'a'.repeat(40) }; });
    await app.start();
    expect(app.get('salesforce')?.sourceKind).toBe('builtin');
    expect(app.get('wrong')).toBeUndefined();
  });
  it('redirects the legacy bundled install command to the trusted independent source', async () => {
    const f = await fixture(false);
    await f.store.remove('salesforce');
    const clone = vi.fn(async (url: string, dest: string, ref: string) => {
      expect(url).toBe('https://github.com/grebmann1/zcc-plugin-salesforce.git');
      expect(ref).toBe('runtime');
      writePlugin(dest, 'export default () => {};'); return { commit: 'a'.repeat(40) };
    });
    const app = service(f.root, clone);
    await app.start();
    await app.install('builtin:salesforce');
    expect(app.get('salesforce')?.sourceKind).toBe('git');
    await app.remove('salesforce');
    await app.reconcileBuiltins();
    expect(app.get('salesforce')).toBeUndefined();
    expect(clone).toHaveBeenCalledTimes(1);
  });
  it('does not install for a fresh profile or reintroduce a removed plugin', async () => {
    const f = await fixture(false);
    await f.store.remove('salesforce');
    const clone = vi.fn();
    await service(f.root, clone).start();
    expect(clone).not.toHaveBeenCalled();
  });
  it('retains a managed runtime across an offline upgrade that removes the previous bundle', async () => {
    const f = await fixture();
    const offline = vi.fn(async () => { throw Error('offline'); });
    const first = service(f.root, offline);
    await first.start();
    const cached = first.get('salesforce')!.rootDir;
    first.stop();
    rmSync(f.previous, { recursive: true });
    const second = service(f.root, offline);
    await second.start();
    expect(second.get('salesforce')).toMatchObject({ rootDir: cached, status: 'running', sourceKind: 'builtin' });
    await expect(second.callRpc('salesforce', 'version', {})).resolves.toBe('old');
  });

  it.each([true, false])('locates a moved path plugin and preserves enabled=%s and data', async enabled => {
    const f = await fixture(enabled, true);
    await f.store.upsert({ ...f.row, sourceKind: 'path', provenance: 'direct', source: `path:${f.previous}` });
    const moved = join(f.root, 'moved');
    writePlugin(moved, 'export default zcc => zcc.rpc.method("version", () => "moved");');
    const app = service(f.root, vi.fn()); await app.start();
    expect(app.snapshot()[0].sourceRecovery).toEqual({ canLocate: true, canSwitchOfficial: true });
    await app.repair('salesforce', moved);
    expect(app.get('salesforce')).toMatchObject({ sourceKind: 'path', source: `path:${moved}`, enabled, installedAt: 12 });
    expect(app.snapshot()[0].sourceRecovery).toBeUndefined();
    expect(JSON.parse(readFileSync(join(f.state, 'kv.json'), 'utf8')).target).toBe('dev');
    expect(existsSync(join(moved, 'package.json'))).toBe(true);
    app.stop(); const restarted = service(f.root, vi.fn()); await restarted.start();
    if (enabled) await expect(restarted.callRpc('salesforce', 'version', {})).resolves.toBe('moved');
  });

  it('switches a missing local source to its official distribution without deleting local files', async () => {
    const f = await fixture(true, true);
    mkdirSync(f.previous); writeFileSync(join(f.previous, 'notes.txt'), 'keep');
    await f.store.upsert({ ...f.row, sourceKind: 'path', source: `path:${f.previous}` });
    const app = service(f.root, async (_, dest) => { writePlugin(dest, 'export default () => {};'); return { commit: 'a'.repeat(40) }; });
    await app.start(); await app.repair('salesforce');
    expect(app.get('salesforce')).toMatchObject({ sourceKind: 'git', catalogMarketplace: 'official', enabled: true });
    expect(readFileSync(join(f.previous, 'notes.txt'), 'utf8')).toBe('keep');
    expect(JSON.parse(readFileSync(join(f.state, 'kv.json'), 'utf8')).target).toBe('dev');
  });

  it('rejects a wrong folder and refuses to replace a healthy developer installation', async () => {
    const f = await fixture(true, true);
    await f.store.upsert({ ...f.row, sourceKind: 'path', source: `path:${f.previous}` });
    const app = service(f.root, vi.fn()); await app.start();
    const moved = join(f.root, 'wrong'); writePlugin(moved, 'throw Error("must not run")', 'wrong');
    await expect(app.repair('salesforce', moved)).rejects.toThrow('not plugin salesforce');
    expect(app.get('wrong')).toBeUndefined();
    await expect(app.repair('absent', moved)).rejects.toThrow('not installed');
    writePlugin(f.previous, 'export default () => {};');
    await expect(app.repair('salesforce')).rejects.toThrow('no longer available');
  });

  it.each(['locate', 'official'])('restores saved data after failed %s recovery and permits another attempt', async action => {
    const f = await fixture(true, true);
    await f.store.upsert({ ...f.row, sourceKind: 'path', source: `path:${f.previous}` });
    const broken = 'export default async zcc => { await zcc.storage.kv.set("target", "wrong"); throw Error("bad-repair"); };';
    const moved = join(f.root, 'moved'); writePlugin(moved, broken);
    const app = service(f.root, async (_, dest) => { writePlugin(dest, broken); return { commit: 'a'.repeat(40) }; });
    await app.start();
    await expect(app.repair('salesforce', action === 'locate' ? moved : undefined)).rejects.toThrow('rolled back');
    expect(JSON.parse(readFileSync(join(f.state, 'kv.json'), 'utf8')).target).toBe('dev');
    expect(app.snapshot()[0].sourceRecovery).toEqual({ canLocate: true, canSwitchOfficial: true });
    writePlugin(moved, 'export default () => {};');
    await app.repair('salesforce', moved);
    expect(app.get('salesforce')?.status).toBe('running');
  });

  it.each([true, false])('boots a skipped-transition upgrade offline using a compiled fallback, enabled=%s', async enabled => {
    const f = await fixture(enabled, true);
    const fallback = join(f.root, 'empty/migration-runtimes/salesforce');
    writePlugin(fallback, 'export default zcc => zcc.rpc.method("version", () => "fallback");');
    const offline = vi.fn(async () => { throw Error('offline'); });
    const app = service(f.root, offline); await app.start();
    expect(app.get('salesforce')).toMatchObject({ sourceKind: 'builtin', enabled, installedAt: 12, status: enabled ? 'running' : 'disabled' });
    expect(app.get('salesforce')!.rootDir).not.toBe(fallback);
    if (enabled) await expect(app.callRpc('salesforce', 'version', {})).resolves.toBe('fallback');
    expect(JSON.parse(readFileSync(join(f.state, 'kv.json'), 'utf8')).target).toBe('dev');
    app.stop(); rmSync(fallback, { recursive: true });
    const restarted = service(f.root, offline); await restarted.start();
    if (enabled) await expect(restarted.callRpc('salesforce', 'version', {})).resolves.toBe('fallback');
  });

  it('does not accept a fallback with a different identity', async () => {
    const f = await fixture(true, true);
    writePlugin(join(f.root, 'empty/migration-runtimes/salesforce'), 'throw Error("must not run")', 'wrong');
    const clone = vi.fn(); const app = service(f.root, clone); await app.start();
    expect(app.get('salesforce')).toMatchObject({ sourceKind: 'builtin', status: 'degraded' });
    expect(app.get('wrong')).toBeUndefined(); expect(clone).not.toHaveBeenCalled();
  });

  it('never seeds the compatibility fallback for a fresh profile', async () => {
    const f = await fixture(); await f.store.remove('salesforce');
    writePlugin(join(f.root, 'empty/migration-runtimes/salesforce'), 'throw Error("must not run")');
    const clone = vi.fn(); const app = service(f.root, clone); await app.start();
    expect(app.get('salesforce')).toBeUndefined(); expect(clone).not.toHaveBeenCalled();
  });

});
