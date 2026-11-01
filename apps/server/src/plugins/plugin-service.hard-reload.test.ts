import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPluginService, type PluginServiceOptions } from './plugin-service.js';
import { createPluginStore, pluginStorePath } from './plugin-store.js';
import { createPluginActivationStore } from './plugin-activation-store.js';
import * as recovery from './plugin-recovery-runtime.js';
import { getThreadProvider } from '../services/threads/thread-provider-catalog.js';

const roots: string[] = [], services: ReturnType<typeof createPluginService>[] = [];
function root() { const path = mkdtempSync(join(tmpdir(), 'plugin-service-recovery-')); roots.push(path); return path; }
function pkg(id: string, version = '1.0.0', engines = '>=1.0.0') {
  return { name: `zcc-plugin-${id}`, version, engines: { zcc: engines, zccPluginSdk: '>=0.1.0' },
    zcc: { name: id, description: 'Recovery fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } };
}
const good = `export default zcc => {
  zcc.settings.define({ name: { type: 'string', label: 'Name' }, token: { type: 'string', label: 'Token', secret: true } });
  zcc.rpc.method('save', () => zcc.storage.kv.set('value', 'preserved'));
  zcc.rpc.method('read', async () => ({ saved: await zcc.storage.kv.get('value'), clean: true }));
};`;
function plugin(path: string, id = 'tasks', server = good) {
  mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'package.json'), JSON.stringify(pkg(id)));
  writeFileSync(join(path, 'server.mjs'), server); return path;
}
function fixture(options: Partial<PluginServiceOptions> = {}) {
  const dataDir = options.dataDir ?? root(), bundledRoot = options.bundledRoot ?? root();
  plugin(join(bundledRoot, 'tasks'));
  const opts = { dataDir, bundledRoot, hostVersion: '2.3.1', activationStabilizationMs: 0, ...options };
  const service = createPluginService(opts); services.push(service);
  return { service, dataDir, bundledRoot, opts };
}
async function finish(service: ReturnType<typeof createPluginService>) {
  await service.hardReload();
  await vi.waitFor(() => expect(service.recoveryStatus().phase).toBe('complete'), { timeout: 10_000 });
  return service.recoveryStatus();
}
beforeEach(() => { vi.stubEnv('ZCC_OFFICIAL_MARKETPLACE_URL', 'off'); vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', 'off'); vi.stubEnv('ZCC_COMMUNITY_MARKETPLACE_SOURCE', 'off'); });
afterEach(() => { services.splice(0).forEach(s => s.stop()); roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('repairs corrupt managed bundled code offline, preserves settings/secrets/KV, and keeps the clean runtime on restart and reload', async () => {
  const { service, bundledRoot, opts } = fixture();
  plugin(join(bundledRoot, 'tasks'));
  await service.install('builtin:tasks');
  await service.callRpc('tasks', 'save', {});
  await service.setSettings('tasks', { name: 'keep', token: 'secret-fixture' });
  await finish(service);
  writeFileSync(join(service.get('tasks')!.rootDir, 'server.mjs'), 'corrupted plugin code');
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  const result = await finish(service);
  expect(result).toMatchObject({ restored: ['tasks'], failed: [], skipped: [] });
  const cleanRoot = service.get('tasks')!.rootDir;
  expect(cleanRoot).toContain('generations');
  expect(service.get('tasks')?.bundledRecoveryVersion).toBe('2.3.1');
  expect(service.getSettings('tasks').values).toEqual({ name: 'keep', token: 'secret-fixture' });
  await expect(service.callRpc('tasks', 'read', {})).resolves.toEqual({ saved: 'preserved', clean: true });
  await service.reload('tasks');
  expect(service.get('tasks')?.rootDir).toBe(cleanRoot);
  service.stop();
  const restarted = createPluginService(opts); services.push(restarted);
  await restarted.start();
  expect(restarted.get('tasks')?.rootDir).toBe(cleanRoot);
  await expect(restarted.callRpc('tasks', 'read', {})).resolves.toEqual({ saved: 'preserved', clean: true });
  expect(readFileSync(join(bundledRoot, 'tasks/server.mjs'), 'utf8')).toBe(good);
  expect(network).not.toHaveBeenCalled();
});

it('replaces a disabled local bundled override even after development mode is turned off and leaves local-only plugins alone', async () => {
  let development = true;
  const { service } = fixture({ getAppConfig: () => ({ pluginDevelopmentEnabled: development }) });
  const local = plugin(root()); await service.install(local); await service.disable('tasks');
  await service.install(plugin(root(), 'local-fixture'));
  development = false;
  const result = await finish(service);
  expect(result).toMatchObject({ restored: ['tasks'], failed: [], skipped: [{ id: 'local-fixture' }] });
  expect(service.get('tasks')).toMatchObject({ enabled: false, status: 'disabled', sourceKind: 'builtin' });
  expect(readFileSync(join(local, 'server.mjs'), 'utf8')).toBe(good);
});

it('rolls back storage and settings when the app bundle initializer fails', async () => {
  const bad = `export default async zcc => { await zcc.storage.kv.set('value', 'corrupted'); throw new Error('bad candidate'); };`;
  const { service, bundledRoot } = fixture();
  plugin(join(bundledRoot, 'tasks')); await service.install('builtin:tasks');
  await service.callRpc('tasks', 'save', {}); await service.setSettings('tasks', { name: 'keep' });
  await finish(service);
  writeFileSync(join(bundledRoot, 'tasks/server.mjs'), bad);
  const result = await finish(service);
  expect(result.failed).toEqual([{ id: 'tasks', message: expect.stringContaining('rolled back') }]);
  expect(result.restored).toEqual([]);
  await expect(service.callRpc('tasks', 'read', {})).resolves.toEqual({ saved: 'preserved', clean: true });
  expect(service.getSettings('tasks').values.name).toBe('keep');
});

it.each([
  [{ tasks: { pkg: pkg('different') } }, 'identity'],
  [{ tasks: { pkg: pkg('tasks', '9.0.0', '>=99.0.0') } }, 'requires zcc'],
  [{}, 'Reinstall Zana']
])('keeps the current generation after invalid app resources: %s', async (payload, message) => {
  const { service, bundledRoot } = fixture();
  await service.install('builtin:tasks');
  await finish(service);
  const before = service.get('tasks')!.rootDir;
  if ('tasks' in payload) {
    writeFileSync(join(bundledRoot, 'tasks/package.json'), JSON.stringify(payload.tasks.pkg));
  } else rmSync(join(bundledRoot, 'tasks'), { recursive: true });
  expect((await finish(service)).failed[0]?.message).toContain(message);
  expect(service.get('tasks')?.rootDir).toBe(before);
});

it('deduplicates concurrent recovery requests and exposes immutable progress snapshots', async () => {
  const { service, bundledRoot, opts } = fixture(); plugin(join(bundledRoot, 'tasks')); await service.install('builtin:tasks');
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const copy = recovery.copyBundledPluginRuntime;
  vi.spyOn(recovery, 'copyBundledPluginRuntime').mockImplementationOnce(async args => { await gate; return copy(args); });
  const first = await service.hardReload(), next = await service.hardReload();
  expect(first.phase).toBe('running'); expect(next.phase).toBe('running');
  first.failed.push({ id: 'injected', message: 'ignored' });
  expect(service.recoveryStatus().failed).toEqual([]);
  release(); await vi.waitFor(() => expect(service.recoveryStatus().phase).toBe('complete'));
});

it('restores an unchanged remote Git version from its recorded source and retains enabled state', async () => {
  let clones = 0;
  const commit = 'a'.repeat(40);
  const { service } = fixture({ cloneGit: async (_url, dir) => { clones++; plugin(dir, 'remote-fixture'); return { commit, refKind: 'branch' }; },
    updateResolver: { gitRefs: async () => `${commit}\tHEAD\n`, gitManifest: async () => ({ id: 'remote-fixture', version: '1.0.0', engines: {} }) } });
  await service.install('git:https://example.test/remote');
  const before = service.get('remote-fixture')!.rootDir;
  expect((await finish(service)).restored).toEqual(['remote-fixture']);
  expect(clones).toBe(2);
  expect(service.get('remote-fixture')?.rootDir).not.toBe(before);
});

it('redownloads an exact Git commit and refuses mutations after stopping', async () => {
  const { service } = fixture({ cloneGit: async (_url, dir) => { plugin(dir, 'remote-fixture'); return { commit: 'a'.repeat(40), refKind: 'commit' }; } });
  await service.install(`git:https://example.test/remote@${'a'.repeat(40)}`);
  expect((await finish(service)).restored).toEqual(['remote-fixture']);
  service.stop(); await expect(service.hardReload()).rejects.toThrow('stopped');
});

it('bounds installed inventory and does not run recovery on a corrupt registry', async () => {
  const { service, dataDir } = fixture();
  writeFileSync(pluginStorePath(dataDir), JSON.stringify({ version: 1, plugins: Array.from({ length: 257 }, (_, i) => ({ id: `fixture-${i}` })) }));
  await expect(service.hardReload()).rejects.toThrow('at most 256');
  writeFileSync(pluginStorePath(dataDir), '{bad registry');
  await expect(service.hardReload()).rejects.toThrow();
  expect(readdirSync(join(dataDir, 'plugins'))).not.toContain('generations');
});

it.each(['exact', 'range'] as const)('redownloads npm %s sources with integrity validation and no install scripts', async kind => {
  const installs: string[][] = [];
  const integrity = 'sha512-fixture';
  const { service } = fixture({ spawnNpm: async (args, dir) => {
    installs.push(args);
    const version = args[1]!.includes('1.2.0') ? '1.2.0' : '1.0.0';
    const packageRoot = plugin(join(dir, 'node_modules/remote-fixture'), 'remote-fixture');
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify(pkg('remote-fixture', version)));
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/remote-fixture': { integrity } } }));
    return { code: 0, stdout: '', stderr: '' };
  }, updateResolver: { npmVersions: async () => ['1.2.0', '2.0.0'].map(version => ({ version, engines: {}, dist: { integrity } })) } });
  await service.install(`npm:remote-fixture@${kind === 'exact' ? '1.0.0' : '^1.0.0'}`);
  expect((await finish(service)).restored).toEqual(['remote-fixture']);
  expect(service.get('remote-fixture')?.version).toBe(kind === 'exact' ? '1.0.0' : '1.2.0');
  expect(installs).toHaveLength(2);
  expect(installs.every(args => args.includes('--ignore-scripts'))).toBe(true);
  expect(installs[1]).toContain('--cache');
  expect(installs[1]).toContain('--prefer-online');
});

it('does not resurrect a plugin removed while its bundled files are copied', async () => {
  const { service, bundledRoot, opts } = fixture(); plugin(join(bundledRoot, 'tasks')); await service.install('builtin:tasks');
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const copy = recovery.copyBundledPluginRuntime;
  vi.spyOn(recovery, 'copyBundledPluginRuntime').mockImplementationOnce(async args => { await gate; return copy(args); });
  await service.hardReload(); await service.remove('tasks'); release();
  await vi.waitFor(() => expect(service.recoveryStatus().phase).toBe('complete'));
  expect(service.get('tasks')).toBeUndefined();
  expect(service.recoveryStatus().restored).toEqual([]);
  expect(service.recoveryStatus().failed[0]?.message).toContain('lifecycle changed');
});

it('relinquishes recovery overrides when the app version changes', async () => {
  const { service, bundledRoot, opts } = fixture(); plugin(join(bundledRoot, 'tasks')); await service.install('builtin:tasks');
  await finish(service); service.stop();
  const next = createPluginService({ ...opts, hostVersion: '2.3.2' }); services.push(next);
  await next.start();
  expect(next.get('tasks')?.rootDir).toBe(join(bundledRoot, 'tasks'));
  expect(next.get('tasks')?.bundledRecoveryVersion).toBeUndefined();
});

it.each(['previous', 'candidate', 'unmarked candidate', 'unresolved candidate', 'retargeted candidate'] as const)('blocks an interrupted bundled %s generation while an unattributed journal is damaged', async selected => {
  const { service, dataDir, bundledRoot, opts } = fixture();
  plugin(join(bundledRoot, 'tasks')); await service.install('builtin:tasks');
  await service.callRpc('tasks', 'save', {});
  expect((await finish(service)).restored).toEqual(['tasks']);
  plugin(join(bundledRoot, 'docs'), 'docs'); await service.install('builtin:docs');
  const previous = service.get('tasks')!;
  const candidate = { ...previous, rootDir: join(dataDir, 'plugins/generations', randomUUID(), 'builtin') };
  if (selected === 'unmarked candidate' || selected === 'unresolved candidate') delete candidate.bundledRecoveryVersion;
  plugin(candidate.rootDir);
  const marker = join(dataDir, 'unrecovered-code-ran');
  writeFileSync(join((selected === 'previous' ? previous : candidate).rootDir, 'server.mjs'),
    `import { writeFileSync } from 'node:fs';\n${good.replace('export default zcc => {', `export default zcc => { writeFileSync(${JSON.stringify(marker)}, 'unsafe');`)}`);
  const activations = createPluginActivationStore(dataDir);
  const journal = await activations.prepare(previous, candidate, 0);
  const savedRoot = selected === 'retargeted candidate' ? join(root(), 'retargeted-runtime') : `${candidate.rootDir}-saved`;
  if (selected === 'unresolved candidate' || selected === 'retargeted candidate') {
    renameSync(candidate.rootDir, savedRoot);
    symlinkSync(selected === 'retargeted candidate' ? savedRoot : join(dataDir, 'missing-runtime'), candidate.rootDir);
  }
  const damaged = join(dataDir, 'plugin-activations', randomUUID()); mkdirSync(damaged);
  writeFileSync(join(damaged, 'journal.json'), 'broken');
  await createPluginStore({ file: pluginStorePath(dataDir) }).upsert(selected === 'previous' ? previous : candidate);
  writeFileSync(join(dataDir, 'plugins/tasks/kv.json'), JSON.stringify({ value: 'interrupted' }));
  service.stop();
  const restarted = createPluginService(opts); services.push(restarted); await restarted.start();
  expect(restarted.get('tasks')).toMatchObject({ status: 'degraded', statusDetail: expect.stringContaining('Repair the journal directory') });
  expect(existsSync(marker)).toBe(false);
  expect(restarted.agentContributions().find(row => row.id === 'tasks')).toMatchObject({ enabled: false, skillsRootPaths: [], mcpServers: [] });
  expect(restarted.get('docs')?.status).toBe('running');
  expect(restarted.agentContributions().find(row => row.id === 'docs')?.enabled).toBe(true);
  await expect(restarted.callRpc('docs', 'read', {})).resolves.toMatchObject({ clean: true });
  for (const action of ['enable', 'disable', 'reload', 'remove'] as const) {
    await expect(restarted[action]('tasks')).rejects.toThrow('Repair the journal directory');
  }
  await expect(restarted.setSettings('tasks', { name: 'unsafe' })).rejects.toThrow('Repair the journal directory');
  expect(JSON.parse(readFileSync(join(dataDir, 'plugins/tasks/kv.json'), 'utf8')).value).toBe('interrupted');
  expect(existsSync(join(dataDir, 'plugin-activations', journal.id, 'journal.json'))).toBe(true);
  expect(readFileSync(join(damaged, 'journal.json'), 'utf8')).toBe('broken');
  if (selected === 'unresolved candidate' || selected === 'retargeted candidate') {
    rmSync(candidate.rootDir); renameSync(savedRoot, candidate.rootDir);
  }
  rmSync(damaged, { recursive: true });
  await restarted.reload('tasks');
  await expect(restarted.callRpc('tasks', 'read', {})).resolves.toMatchObject({ saved: 'preserved', clean: true });
  expect(await activations.list()).toEqual([]);
});

it('restores provider availability when startup finds a corrupt managed host artifact', async () => {
  const { service, bundledRoot, opts } = fixture();
  const source = join(bundledRoot, 'tasks');
  const metadata = pkg('tasks');
  writeFileSync(join(source, 'package.json'), JSON.stringify({ ...metadata, zcc: { ...metadata.zcc, host: './host.mjs' } }));
  writeFileSync(join(source, 'server.mjs'), `export default zcc => {
    zcc.agents.experimental_registerProvider({ id: 'recovery-provider-fixture', displayName: 'Fixture',
      capabilities: { fork: 'none', permissionModes: ['full'] },
      models: { scope: 'host', fallback: [] }
    });
  };`);
  mkdirSync(join(source, 'dist'));
  const artifact = 'export default {};';
  writeFileSync(join(source, 'dist/host.js'), artifact);
  writeFileSync(join(source, 'dist/host.meta.json'), JSON.stringify({ artifactDigest: createHash('sha256').update(artifact).digest('hex') }));
  await service.install('builtin:tasks');
  expect(getThreadProvider('recovery-provider-fixture')?.unavailableReason).toBeUndefined();
  expect((await finish(service)).restored).toEqual(['tasks']);
  writeFileSync(join(service.get('tasks')!.rootDir, 'dist/host.js'), 'corrupted managed host');
  service.stop();
  const restarted = createPluginService(opts); services.push(restarted);
  await restarted.start();
  expect(getThreadProvider('recovery-provider-fixture')?.unavailableReason).toBeTruthy();
  expect(await finish(restarted)).toMatchObject({ restored: ['tasks'], failed: [] });
  expect(getThreadProvider('recovery-provider-fixture')?.unavailableReason).toBeUndefined();
});
