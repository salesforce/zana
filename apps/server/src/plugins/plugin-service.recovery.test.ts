import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPluginService, type PluginServiceOptions } from './plugin-service.js';
import { createPluginActivationStore } from './plugin-activation-store.js';
import { createPluginStore, pluginStorePath } from './plugin-store.js';
import { PluginHostArtifactRegistry } from './plugin-host-artifact-registry.js';
import { createSqliteDatabase } from '@zana-ai/zcc-db';
import * as pluginApi from './plugin-api.js';

const roots: string[] = [], subjects: ReturnType<typeof createPluginService>[] = [];
const oldCommit = 'a'.repeat(40), newCommit = 'b'.repeat(40);
function root() { const dir = mkdtempSync(join(tmpdir(), 'plugin-recovery-')); roots.push(dir); return dir; }
const source = `export default async api => {
  const settings = api.settings.define({ name: {type:'string',label:'Name',default:'default'}, token: {type:'string',label:'Token',secret:true} });
  const db = api.storage.database(); db.migrate(['CREATE TABLE records(value TEXT)']);
  api.rpc.method('seed', async () => { db.prepare('INSERT INTO records VALUES (?)').run('before'); await api.storage.kv.set('saved','before'); await api.storage.kv.set('schedule:job:last','before'); });
  api.rpc.method('read', async () => ({version: VERSION, rows:db.prepare('SELECT value FROM records').all(), saved:await api.storage.kv.get('saved'), schedule:await api.storage.kv.get('schedule:job:last'), settings:await settings.get()}));
  api.rpc.method('slow', async () => { await new Promise(resolve=>setTimeout(resolve,150)); return 'finished'; });
  api.onDispose(() => { throw Error('best effort plugin cleanup'); });
  MIGRATION
};`;
function plugin(dir: string, version: string, migration = '') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'zcc-plugin-sample', version,
    zcc: { name: 'Recovery fixture', description: 'Recovery fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(dir, 'server.mjs'), source.replace('VERSION', JSON.stringify(version)).replace('MIGRATION', migration));
}
function fixture(extra: Partial<PluginServiceOptions> = {}, migration = '') {
  const dataDir = extra.dataDir ?? root(); let commit = oldCommit;
  const subject = createPluginService({ dataDir, bundledRoot: root(), activationStabilizationMs: 20,
    cloneGit: async (_url, dest, spec) => { const selected = spec.startsWith('commit:') ? spec.slice(7) : commit;
      plugin(dest, selected === oldCommit ? '1.0.0' : '2.0.0', selected === oldCommit ? '' : migration);
      return { commit: selected, refKind: 'branch' }; },
    updateResolver: { gitRefs: async () => `${commit}\tHEAD\n`, gitManifest: async () => ({ id: 'sample', version: '2.0.0', engines: {} }) }, ...extra });
  subjects.push(subject);
  return { dataDir, subject, advance: () => { commit = newCommit; }, rpc: (method: string) => subject.callRpc('sample', method, {}) };
}
beforeEach(() => { vi.stubEnv('ZCC_OFFICIAL_MARKETPLACE_URL', 'off'); vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', 'off'); });
afterEach(async () => { subjects.splice(0).forEach(subject => subject.stop()); await new Promise(resolve => setTimeout(resolve, 30)); roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('rolls back a failed factory migration and keeps the old generation usable with all owned state restored', async () => {
  const f = fixture({}, `db.prepare("UPDATE records SET value='after'").run(); await api.storage.kv.set('saved','after'); await api.storage.kv.set('schedule:job:last','after'); throw Error('migration failed');`);
  const previous = await f.subject.install('git:https://example.test/sample');
  await f.rpc('seed'); await f.subject.setSettings('sample', { name: 'before', token: 'secret-before' });
  const before = await f.rpc('read'); f.advance();
  await expect(f.subject.applyUpdate('sample')).rejects.toThrow('was rolled back: migration failed');
  expect(await f.rpc('read')).toEqual(before);
  expect(f.subject.get('sample')).toMatchObject({ version: '1.0.0', enabled: true, status: 'running', lastActivationFailure: { version: '2.0.0', detail: 'migration failed' } });
  expect(f.subject.snapshot()[0].statusDetail).toContain('migration failed');
  expect(existsSync(previous.rootDir)).toBe(true);
  expect(readdirSync(join(f.dataDir, 'plugins/generations'))).toHaveLength(1);
  expect(readdirSync(join(f.dataDir, 'plugin-activations'))).toEqual([]);
});

it('commits a successful migration only after stabilization and removes the prior generation', async () => {
  const f = fixture({}, `await api.storage.kv.set('saved','after');`);
  const previous = await f.subject.install('git:https://example.test/sample'); await f.rpc('seed'); f.advance();
  await f.subject.applyUpdate('sample');
  expect(await f.rpc('read')).toMatchObject({ version: '2.0.0', saved: 'after', rows: [{ value: 'before' }] });
  expect(existsSync(previous.rootDir)).toBe(false); expect(readdirSync(join(f.dataDir, 'plugin-activations'))).toEqual([]);
});

it('recovers a worker crash during the stabilization window', async () => {
  const f = fixture({ activationStabilizationMs: 250 }, `await api.storage.kv.set('saved','after'); setTimeout(()=>{ throw Error('late crash'); },25);`);
  await f.subject.install('git:https://example.test/sample'); await f.rpc('seed'); f.advance();
  await expect(f.subject.applyUpdate('sample')).rejects.toThrow('was rolled back'); expect(await f.rpc('read')).toMatchObject({ version: '1.0.0', saved: 'before' });
});

it('refuses to snapshot unsafe storage, resumes the previous plugin, and cleans the candidate', async () => {
  const f = fixture(); const previous = await f.subject.install('git:https://example.test/sample');
  symlinkSync(previous.rootDir, join(f.dataDir, 'plugins/sample/secrets')); f.advance();
  await expect(f.subject.applyUpdate('sample')).rejects.toThrow('symlinks');
  expect(await f.rpc('read')).toMatchObject({ version: '1.0.0' });
  expect(readdirSync(join(f.dataDir, 'plugins/generations'))).toHaveLength(1);
});

it('defers updates during a live plugin call or host call and leaves the running generation intact', async () => {
  const registry = new PluginHostArtifactRegistry(); const f = fixture({ pluginHostArtifacts: registry });
  await f.subject.install('git:https://example.test/sample'); f.advance(); await f.subject.checkUpdates();
  const pending = f.rpc('slow'); await expect(f.subject.applyUpdate('sample')).rejects.toThrow('active call'); expect(await pending).toBe('finished');
  const release = registry.acquire('sample'); await expect(f.subject.applyUpdate('sample')).rejects.toThrow('active host call'); release();
  expect(await f.rpc('read')).toMatchObject({ version: '1.0.0' }); expect(readdirSync(join(f.dataDir, 'plugins/generations'))).toHaveLength(1);
  await f.subject.applyUpdate('sample'); expect(await f.rpc('read')).toMatchObject({ version: '2.0.0' });
});

it.each(['disable', 'remove'] as const)('serializes %s with activation without resurrection or re-enabling', async operation => {
  const f = fixture({ activationStabilizationMs: 60_000 }, `await api.storage.kv.set('migration','entered');`);
  await f.subject.install('git:https://example.test/sample'); f.advance();
  const outcome = f.subject.applyUpdate('sample').then(() => null, error => error as Error);
  await vi.waitFor(() => expect(f.subject.get('sample')?.version).toBe('2.0.0'), { timeout: 15_000 });
  await expect(f.rpc('seed')).rejects.toThrow('update in progress');
  await f.subject[operation]('sample'); expect((await outcome)?.message).toContain('lifecycle changed');
  if (operation === 'remove') expect(f.subject.get('sample')).toBeUndefined();
  else expect(f.subject.get('sample')).toMatchObject({ enabled: false, version: '1.0.0', status: 'disabled' });
});

it('direct remote reinstall cannot bypass checked activation', async () => {
  const f = fixture(); await f.subject.install('git:https://example.test/sample'); f.advance();
  await expect(f.subject.install('git:https://example.test/sample')).rejects.toThrow('use zcc plugin update sample');
  expect(await f.rpc('read')).toMatchObject({ version: '1.0.0' }); expect(readdirSync(join(f.dataDir, 'plugins/generations'))).toHaveLength(1);
});

it('preserves a managed generation while another installed plugin references its subdirectory', async () => {
  const f = fixture(); const previous = await f.subject.install('git:https://example.test/sample');
  const child = join(previous.rootDir, 'child'); mkdirSync(child);
  writeFileSync(join(child, 'package.json'), JSON.stringify({ name: 'zcc-plugin-child', version: '1.0.0', zcc: { name: 'Child', description: 'Shared generation', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(child, 'server.mjs'), 'export default () => {};');
  await f.subject.install(child); f.advance(); await f.subject.applyUpdate('sample');
  expect(existsSync(previous.rootDir)).toBe(true); expect(f.subject.get('child')?.status).toBe('running');
  await f.subject.remove('child'); expect(existsSync(previous.rootDir)).toBe(false);
  expect(await f.rpc('read')).toMatchObject({ version: '2.0.0' });
});

it('awaits shutdown writers before restoring an interrupted activation', async () => {
  const f = fixture({ activationStabilizationMs: 60_000 }, `await api.storage.kv.set('saved','after');`);
  await f.subject.install('git:https://example.test/sample'); await f.rpc('seed'); f.advance();
  const outcome = f.subject.applyUpdate('sample').then(() => null, error => error as Error);
  await vi.waitFor(() => expect(f.subject.get('sample')?.version).toBe('2.0.0'), { timeout: 15_000 });
  f.subject.stop(); expect((await outcome)?.message).toContain('rolled back');
  expect(JSON.parse(readFileSync(join(f.dataDir, 'plugins/sample/kv.json'), 'utf8')).saved).toBe('before');
  expect(f.subject.get('sample')?.version).toBe('1.0.0');
  expect(await createPluginActivationStore(f.dataDir).list()).toEqual([]);
});

it('preserves open provider sessions and releases admission when sessions close or the reference query fails', async () => {
  const db = createSqliteDatabase(':memory:');
  db.exec('CREATE TABLE threads(id TEXT, provider_id TEXT, status TEXT); CREATE TABLE thread_open_sessions(thread_id TEXT);');
  const registry = new PluginHostArtifactRegistry();
  const f = fixture({ pluginHostArtifacts: registry, productContext: { db: { sqlite: db } } as PluginServiceOptions['productContext'] }, `api.agents.experimental_registerProvider({id:'recovery-provider',displayName:'Recovery',capabilities:{},models:{scope:'host',fallback:[]}});`);
  try {
    // Register in the original generation as well as the candidate.
    const installed = await f.subject.install('git:https://example.test/sample');
    const file = join(installed.rootDir, 'server.mjs'); writeFileSync(file, readFileSync(file, 'utf8').replace('db.migrate', "api.agents.experimental_registerProvider({id:'recovery-provider',displayName:'Recovery',capabilities:{},models:{scope:'host',fallback:[]}}); db.migrate"));
    await f.subject.reload('sample'); f.advance();
    db.exec("INSERT INTO threads VALUES ('thread','recovery-provider','idle'); INSERT INTO thread_open_sessions VALUES ('thread');");
    await expect(f.subject.applyUpdate('sample')).rejects.toThrow('open provider sessions');
    expect(await f.rpc('read')).toMatchObject({ version: '1.0.0' });
    db.exec("DELETE FROM thread_open_sessions; UPDATE threads SET status='active';");
    await expect(f.subject.applyUpdate('sample')).rejects.toThrow('open provider sessions');
    db.exec("UPDATE threads SET status='idle'; DROP TABLE thread_open_sessions;");
    await expect(f.subject.applyUpdate('sample')).rejects.toThrow('thread_open_sessions');
    registry.beginUpdate('sample')(); // A failed query must reopen host admission.
    db.exec('CREATE TABLE thread_open_sessions(thread_id TEXT);');
    await f.subject.applyUpdate('sample'); expect(await f.rpc('read')).toMatchObject({ version: '2.0.0' });
  } finally { f.subject.stop(); db.close(); }
});

it.each([false, true])('fails closed when host teardown cannot prove quiescence (candidate=%s)', async candidateFails => {
  const original = pluginApi.createPluginApi; let calls = 0;
  vi.spyOn(pluginApi, 'createPluginApi').mockImplementation((...args) => {
    const handle = original(...args); calls++;
    if (calls === (candidateFails ? 2 : 1)) handle.onQuiesce(() => { throw Error('writer teardown failed'); });
    return handle;
  });
  const f = fixture({}, `await api.storage.kv.set('saved','after');throw Error('failed migration');`);
  await f.subject.install('git:https://example.test/sample'); await f.rpc('seed'); f.advance();
  await expect(f.subject.applyUpdate('sample')).rejects.toThrow(/quiesced|restart/);
  await expect(f.subject.disable('sample')).rejects.toThrow('requires a restart');
  const journals = await createPluginActivationStore(f.dataDir).list();
  expect(journals).toHaveLength(candidateFails ? 1 : 0);
  expect(JSON.parse(readFileSync(join(f.dataDir, 'plugins/sample/kv.json'), 'utf8')).saved).toBe(candidateFails ? 'after' : 'before');
});

it('isolates damaged recovery, starts unrelated code and retries a repaired snapshot without restarting', async () => {
  const f = fixture(); const previous = await f.subject.install('git:https://example.test/sample', { enable: false });
  const unrelated = join(root(), 'unrelated'); plugin(unrelated, '1.0.0');
  const manifest = JSON.parse(readFileSync(join(unrelated, 'package.json'), 'utf8')); manifest.name = 'zcc-plugin-unrelated';
  writeFileSync(join(unrelated, 'package.json'), JSON.stringify(manifest)); await f.subject.install(unrelated);
  const owned = join(f.dataDir, 'plugins/sample'); mkdirSync(owned); writeFileSync(join(owned, 'kv.json'), 'before');
  const candidate = { ...previous, version: '2.0.0', rootDir: join(f.dataDir, 'plugins/generations', randomUUID(), 'git') }; plugin(candidate.rootDir, '2.0.0');
  const transactions = createPluginActivationStore(f.dataDir); const journal = await transactions.prepare(previous, candidate, 0);
  const otherRoot = join(f.dataDir, 'plugins/generations', randomUUID(), 'git'); plugin(otherRoot, '1.0.0');
  const otherManifest = JSON.parse(readFileSync(join(otherRoot, 'package.json'), 'utf8')); otherManifest.name = 'zcc-plugin-independent';
  writeFileSync(join(otherRoot, 'package.json'), JSON.stringify(otherManifest));
  const independent = { ...previous, id: 'independent', rootDir: otherRoot, enabled: true };
  await createPluginStore({ file: pluginStorePath(f.dataDir) }).upsert(independent);
  writeFileSync(join(f.dataDir, 'plugin-activations', journal.id, 'snapshot/kv.json'), 'tampered');
  writeFileSync(join(owned, 'kv.json'), 'live'); f.subject.stop();
  const next = fixture({ dataDir: f.dataDir }); await next.subject.start();
  expect(next.subject.get('sample')).toMatchObject({ status: 'degraded', statusDetail: expect.stringContaining('snapshot is damaged') });
  expect(next.subject.agentContributions().find(row => row.id === 'sample')).toMatchObject({ enabled: false, skillsRootPaths: [], mcpServers: [] });
  expect(next.subject.get('unrelated')?.status).toBe('running');
  expect(next.subject.get('independent')?.status).toBe('running');
  await expect(next.subject.enable('sample')).rejects.toThrow('Repair the recovery snapshot');
  const concurrent = await Promise.allSettled([next.subject.enable('sample'), next.subject.reload('unrelated'), next.subject.enable('sample')]);
  expect(concurrent.map(result => result.status)).toEqual(['rejected', 'fulfilled', 'rejected']);
  expect(readFileSync(join(owned, 'kv.json'), 'utf8')).toBe('live'); expect(await transactions.list()).toHaveLength(1);
  writeFileSync(join(f.dataDir, 'plugin-activations', journal.id, 'snapshot/kv.json'), 'before');
  await next.subject.reload('sample');
  expect(next.subject.get('sample')).toMatchObject({ version: '1.0.0', enabled: false });
  expect(readFileSync(join(owned, 'kv.json'), 'utf8')).toBe('before'); expect(await transactions.list()).toEqual([]);
});

it('starts and toggles plugins in the presence of harmless OS metadata', async () => {
  const f = fixture(); await f.subject.install('git:https://example.test/sample'); f.subject.stop();
  mkdirSync(join(f.dataDir, 'plugin-activations'), { recursive: true }); writeFileSync(join(f.dataDir, 'plugin-activations/.DS_Store'), 'Finder');
  const next = fixture({ dataDir: f.dataDir }); await next.subject.start();
  expect(next.subject.get('sample')?.status).toBe('running');
  await next.subject.disable('sample'); await next.subject.enable('sample'); await next.subject.reload('sample');
  expect(await next.rpc('read')).toMatchObject({ version: '1.0.0' });
});

it('preserves unknown journals, blocks managed code, and recovers after journal repair', async () => {
  const f = fixture(); const previous = await f.subject.install('git:https://example.test/sample', { enable: false });
  const candidate = { ...previous, version: '2.0.0', rootDir: join(f.dataDir, 'plugins/generations', randomUUID(), 'git') }; plugin(candidate.rootDir, '2.0.0', 'throw Error("must never run");');
  const transactions = createPluginActivationStore(f.dataDir), journal = await transactions.prepare(previous, candidate, 0);
  const file = join(f.dataDir, 'plugin-activations', journal.id, 'journal.json'); writeFileSync(file, 'broken');
  await createPluginStore({ file: pluginStorePath(f.dataDir) }).upsert({ ...candidate, enabled: true }); f.subject.stop();
  const next = fixture({ dataDir: f.dataDir }); await next.subject.start();
  expect(next.subject.get('sample')).toMatchObject({ status: 'degraded', statusDetail: expect.stringContaining(journal.id) });
  expect(next.subject.agentContributions().find(row => row.id === 'sample')?.enabled).toBe(false);
  expect(existsSync(candidate.rootDir)).toBe(true); expect(readFileSync(file, 'utf8')).toBe('broken');
  await expect(next.subject.reload('sample')).rejects.toThrow('Repair the journal directory');
  writeFileSync(file, JSON.stringify(journal));
  await next.subject.enable('sample'); expect(next.subject.get('sample')?.status).toBe('running');
  expect(await transactions.list()).toEqual([]); expect(existsSync(candidate.rootDir)).toBe(false);
});

it('contains an unsafe generation directory and retries after its repair', async () => {
  const f = fixture(); await f.subject.install('git:https://example.test/sample', { enable: false }); f.subject.stop();
  const generations = join(f.dataDir, 'plugins/generations'), saved = join(f.dataDir, 'saved-generations');
  renameSync(generations, saved); symlinkSync(saved, generations);
  const next = fixture({ dataDir: f.dataDir }); await next.subject.start();
  expect(next.subject.get('sample')?.statusDetail).toContain('plugins/generations');
  rmSync(generations); renameSync(saved, generations);
  await next.subject.start(); await next.subject.enable('sample');
  expect(await next.rpc('read')).toMatchObject({ version: '1.0.0' });
});

it('retries a failed startup through management after a transient dependency is repaired', async () => {
  const f = fixture(); await f.subject.install('git:https://example.test/sample', { enable: false }); f.subject.stop();
  let fail = false;
  const next = fixture({ dataDir: f.dataDir, getAppConfig: () => { if (fail) throw Error('temporary config unavailable'); return {}; } });
  fail = true; await expect(next.subject.start()).rejects.toThrow('temporary config unavailable');
  fail = false; await next.subject.enable('sample');
  expect(next.subject.get('sample')?.status).toBe('running');
});

it('contains activation-directory symlinks and retries after their removal', async () => {
  const f = fixture(); await f.subject.install('git:https://example.test/sample', { enable: false }); f.subject.stop();
  const outside = root(), activations = join(f.dataDir, 'plugin-activations'); symlinkSync(outside, activations);
  writeFileSync(join(outside, 'untouched'), 'private');
  const next = fixture({ dataDir: f.dataDir }); await next.subject.start();
  expect(next.subject.get('sample')?.statusDetail).toContain('must not be a symlink');
  expect(readFileSync(join(outside, 'untouched'), 'utf8')).toBe('private');
  rmSync(activations); await next.subject.enable('sample'); expect(next.subject.get('sample')?.status).toBe('running');
});

it('refuses ambiguous recovery ordering for multiple journals belonging to one plugin', async () => {
  const f = fixture(); const previous = await f.subject.install('git:https://example.test/sample', { enable: false });
  const candidate = { ...previous, version: '2.0.0', rootDir: join(f.dataDir, 'plugins/generations', randomUUID(), 'git') }; plugin(candidate.rootDir, '2.0.0');
  const transactions = createPluginActivationStore(f.dataDir);
  await transactions.prepare(previous, candidate, 0); await transactions.prepare(previous, candidate, 1); f.subject.stop();
  const next = fixture({ dataDir: f.dataDir }); await next.subject.start();
  expect(next.subject.get('sample')?.statusDetail).toContain('Multiple pending'); expect(await transactions.list()).toHaveLength(2);
  expect(existsSync(candidate.rootDir)).toBe(true);
});

it.each(['activating', 'restoring'] as const)('recovers an interrupted %s transaction before running any plugin code', async phase => {
  const f = fixture(); const previous = await f.subject.install('git:https://example.test/sample', { enable: false });
  const owned = join(f.dataDir, 'plugins/sample'); mkdirSync(owned); writeFileSync(join(owned, 'kv.json'), '{"saved":"before"}');
  const candidate = { ...previous, version: '2.0.0', rootDir: join(f.dataDir, 'plugins/generations', randomUUID(), 'git') }; plugin(candidate.rootDir, '2.0.0', 'throw Error("must never run");');
  const transactions = createPluginActivationStore(f.dataDir); let journal = await transactions.prepare(previous, candidate, 0);
  if (phase === 'restoring') journal = await transactions.phase(journal, phase);
  writeFileSync(join(owned, 'kv.json'), '{"saved":"after"}'); await createPluginStore({ file: pluginStorePath(f.dataDir) }).upsert(candidate); f.subject.stop();
  const next = fixture({ dataDir: f.dataDir }); await next.subject.start();
  expect(next.subject.get('sample')).toMatchObject({ version: '1.0.0', enabled: false, lastActivationFailure: { detail: expect.stringContaining('Interrupted') } });
  expect(JSON.parse(readFileSync(join(owned, 'kv.json'), 'utf8'))).toEqual({ saved: 'before' }); expect(existsSync(candidate.rootDir)).toBe(false);
  expect(await transactions.list()).toEqual([]);
});

it.each(['committed', 'restored', 'removed', 'reinstalled'] as const)('finishes durable %s recovery without reverting a newer decision', async decision => {
  const f = fixture(); const previous = await f.subject.install('git:https://example.test/sample', { enable: false });
  const candidate = { ...previous, version: '2.0.0', rootDir: join(f.dataDir, 'plugins/generations', randomUUID(), 'git') }; plugin(candidate.rootDir, '2.0.0');
  const transactions = createPluginActivationStore(f.dataDir), journal = await transactions.prepare(previous, candidate, 0);
  const registry = createPluginStore({ file: pluginStorePath(f.dataDir) });
  if (decision === 'committed') { await registry.upsert(candidate); await transactions.phase(journal, 'committed'); }
  if (decision === 'restored') await transactions.phase(journal, 'restored');
  if (decision === 'removed') await registry.remove('sample');
  if (decision === 'reinstalled') await registry.upsert({ ...previous, installedAt: 100 });
  f.subject.stop(); const next = fixture({ dataDir: f.dataDir }); await next.subject.start();
  expect(await transactions.list()).toEqual([]);
  expect(next.subject.get('sample')?.version).toBe(decision === 'removed' ? undefined : decision === 'committed' ? '2.0.0' : '1.0.0');
});
