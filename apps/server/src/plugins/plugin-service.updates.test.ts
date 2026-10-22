import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginService, toPluginAppSnapshot, type PluginServiceOptions } from './plugin-service.js';
import { createPluginStore, pluginStorePath, type InstalledPluginRow } from './plugin-store.js';
import { PLUGIN_UPDATE_CHECK_INTERVAL_MS } from './plugin-updates.js';

const roots: string[] = [], services: ReturnType<typeof createPluginService>[] = [];
const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
function root() { const dir = mkdtempSync(join(tmpdir(), 'plugin-update-test-')); roots.push(dir); return dir; }
function writePlugin(dir: string, id: string, version = '1.0.0') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version,
    zcc: { name: id, description: 'Update fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(dir, 'server.mjs'), 'export default () => {};');
}
function fixture(extra: Partial<PluginServiceOptions> = {}) {
  const dataDir = extra.dataDir ?? root();
  let commit = a;
  const cloneGit = vi.fn(async (_url: string, dest: string, spec: string) => {
    const selected = spec.startsWith('commit:') ? spec.slice(7) : commit;
    writePlugin(dest, 'sample', selected === a ? '1.0.0' : '1.1.0');
    return { commit: selected, refKind: 'branch' as const };
  });
  const gitRefs = vi.fn(async () => `${commit}\tHEAD\n`);
  const subject = createPluginService({ dataDir, bundledRoot: root(), cloneGit, updateResolver: { gitRefs }, ...extra });
  services.push(subject);
  return { subject, dataDir, cloneGit, gitRefs, advance: (next = b) => { commit = next; } };
}
beforeEach(() => { vi.stubEnv('ZCC_OFFICIAL_MARKETPLACE_URL', 'off'); vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', 'off'); });
afterEach(() => { services.splice(0).forEach(s => s.stop()); roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); vi.unstubAllEnvs(); });

describe('independent plugin updates through PluginService', () => {
  it('checks without activating code, reloads installed bytes, and applies the exact commit preserving disabled state', async () => {
    const f = fixture();
    await f.subject.install('git:https://example.test/repo@HEAD', { enable: false });
    const installed = f.subject.get('sample')!;
    f.advance();
    expect(await f.subject.checkUpdates()).toEqual([{ id: 'sample', current: '1.0.0', available: '1.1.0', marketplace: '' }]);
    expect(f.subject.get('sample')!.rootDir).toBe(installed.rootDir);
    expect(f.subject.snapshot()[0]).toMatchObject({ updatePolicy: 'independent', availableVersion: '1.1.0', updateCheck: { outcome: 'available' } });
    expect(toPluginAppSnapshot(f.subject.snapshot()[0])).toMatchObject({ updatePolicy: 'independent' });
    f.cloneGit.mockClear();
    await f.subject.reload('sample'); expect(f.cloneGit).not.toHaveBeenCalled();
    await f.subject.applyUpdate('sample');
    expect(f.subject.get('sample')).toMatchObject({ version: '1.1.0', gitResolvedCommit: b, enabled: false, source: 'git:https://example.test/repo@HEAD', sourceIntent: { selector: { ref: 'HEAD' }, refKind: 'branch' } });
    expect(existsSync(installed.rootDir)).toBe(false);
    expect(f.subject.snapshot()[0].availableVersion).toBeUndefined();
  });
  it('persists checks across restart and only rechecks when overdue', async () => {
    let clock = 1000;
    const f = fixture({ now: () => clock });
    await f.subject.install('git:https://example.test/repo', { enable: false }); f.advance(); await f.subject.checkUpdates();
    f.subject.stop();
    const gitRefs = vi.fn(async () => `${b}\tHEAD\n`);
    const next = fixture({ dataDir: f.dataDir, now: () => clock, cloneGit: f.cloneGit, updateResolver: { gitRefs } });
    await next.subject.start();
    expect(next.subject.snapshot().find(row => row.id === 'sample')).toMatchObject({ availableVersion: '1.1.0', updateCheck: { checkedAt: clock } });
    expect(gitRefs).not.toHaveBeenCalled();
    clock += PLUGIN_UPDATE_CHECK_INTERVAL_MS;
    await next.subject.checkUpdates(); expect(gitRefs).toHaveBeenCalledTimes(1);
  });
  it('automatically checks never-checked sources on startup', async () => {
    const f = fixture(); await f.subject.install('git:https://example.test/repo', { enable: false }); f.advance();
    await f.subject.start();
    await vi.waitFor(() => expect(f.subject.snapshot().find(row => row.id === 'sample')?.updateCheck?.outcome).toBe('available'));
  });
  it('keeps recorded catalog source intent after the catalog is removed', async () => {
    const f = fixture({ fetchJson: async () => ({ schemaVersion: 1, name: 'test', displayName: 'Test', plugins: [{
      id: 'sample', displayName: 'Sample', description: 'Sample', author: { name: 'Example' },
      source: { git: { url: 'https://example.test/original', ref: 'HEAD', subdir: 'plugins/sample' } }
    }] }), cloneGit: async (_url, dest, spec) => {
      writePlugin(join(dest, 'plugins/sample'), 'sample', spec.startsWith('commit:') ? '1.1.0' : '1.0.0');
      return { commit: spec.startsWith('commit:') ? spec.slice(7) : a, refKind: 'branch' };
    } });
    await f.subject.addMarketplace('https://example.test/catalog.json');
    await f.subject.install('sample@test', { enable: false });
    await f.subject.removeMarketplace('https://example.test/catalog.json'); f.advance();
    await f.subject.applyUpdate('sample');
    expect(f.subject.get('sample')).toMatchObject({ provenance: 'catalog', catalogMarketplace: 'test', gitResolvedCommit: b,
      sourceIntent: { url: 'https://example.test/original', subdir: 'plugins/sample' } });
    expect(f.subject.get('sample')!.rootDir).toMatch(/plugins[/\\]sample$/);
  });
  it('does not activate a candidate that changed after the operator saw the check', async () => {
    const f = fixture(); await f.subject.install('git:https://example.test/repo', { enable: false }); f.advance(); await f.subject.checkUpdates();
    f.advance(c); await expect(f.subject.applyUpdate('sample')).rejects.toThrow(/available release changed/);
    expect(f.subject.get('sample')!.gitResolvedCommit).toBe(a);
    await f.subject.applyUpdate('sample'); expect(f.subject.get('sample')!.gitResolvedCommit).toBe(c);
  });
  it('retains the installed artifact when reloading its now-incompatible manifest fails', async () => {
    const f = fixture(); await f.subject.install('git:https://example.test/repo', { enable: false });
    const dir = f.subject.get('sample')!.rootDir, pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    pkg.engines = { zcc: '>=999' }; writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    await expect(f.subject.reload('sample')).rejects.toThrow(/requires/); expect(existsSync(dir)).toBe(true);
  });
  it('does not resurrect an uninstalled plugin when a source check completes', async () => {
    const f = fixture(); await f.subject.install('git:https://example.test/repo', { enable: false });
    let finish!: (value: string) => void;
    f.gitRefs.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const checking = f.subject.checkUpdates(); await f.subject.remove('sample'); finish(`${b}\tHEAD\n`);
    expect(await checking).toEqual([]); expect(f.subject.get('sample')).toBeUndefined();
  });
  it('coalesces overlapping sweeps and bounds concurrency to four', async () => {
    const dataDir = root(), store = createPluginStore({ file: pluginStorePath(dataDir) });
    for (let i = 0; i < 6; i++) await store.upsert({ id: `sample-${i}`, version: '1.0.0', sourceKind: 'git', source: `git:https://example.test/repo-${i}@HEAD`, gitResolvedCommit: a } as InstalledPluginRow);
    const releases: Array<() => void> = []; let active = 0, maximum = 0;
    const gitRefs = vi.fn(async () => { active++; maximum = Math.max(maximum, active); await new Promise<void>(resolve => releases.push(resolve)); active--; return `${a}\tHEAD\n`; });
    const f = fixture({ dataDir, updateResolver: { gitRefs } });
    const first = f.subject.checkUpdates(), second = f.subject.checkUpdates(); expect(first).toBe(second);
    expect(gitRefs).toHaveBeenCalledTimes(4); releases.splice(0).forEach(release => release());
    await vi.waitFor(() => expect(gitRefs).toHaveBeenCalledTimes(6)); releases.splice(0).forEach(release => release());
    expect(await first).toEqual([]); expect(maximum).toBe(4);
  });
  it('persists individual source failures and keeps other checks working', async () => {
    const f = fixture({ updateResolver: { gitRefs: async () => { throw new Error('Git source is unavailable'); } } });
    await f.subject.install('git:https://example.test/repo', { enable: false });
    expect(await f.subject.checkUpdates()).toEqual([]);
    const snapshot = f.subject.snapshot()[0]!;
    expect(toPluginAppSnapshot(snapshot)).toMatchObject({ updateCheck: { outcome: 'unavailable', detail: 'Git source is unavailable' } });
    expect(JSON.stringify(toPluginAppSnapshot(snapshot))).not.toContain('https://example.test');
    await expect(f.subject.applyUpdate('sample')).rejects.toThrow(/unavailable/);
  });
  it('skips local installs and exact pins during update-all', async () => {
    const f = fixture(); const path = root(); writePlugin(path, 'local'); await f.subject.install(path, { enable: false });
    await f.subject.install(`git:https://example.test/repo@${a}`, { enable: false });
    expect(await f.subject.applyAllUpdates()).toEqual({ updated: [], failed: [] });
    expect(f.gitRefs).not.toHaveBeenCalled();
    await expect(f.subject.applyUpdate('local')).rejects.toThrow(/no independent/);
    await expect(f.subject.applyUpdate('missing')).rejects.toThrow(/not installed/);
  });
  it('updates npm using the recorded selector and exact checked integrity', async () => {
    let tamper = false;
    const f = fixture({ spawnNpm: async (args, dest) => {
      if (args[0] === 'view') return { code: 0, stdout: JSON.stringify({ version: '1.1.0', 'dist.integrity': 'sha512-good', engines: {} }), stderr: '' };
      const version = args[1]!.endsWith('@1.1.0') ? '1.1.0' : '1.0.0';
      writePlugin(join(dest, 'node_modules', 'zcc-plugin-sample'), 'sample', version);
      writeFileSync(join(dest, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/zcc-plugin-sample': { integrity: tamper ? 'sha512-bad' : 'sha512-good' } } }));
      return { code: 0, stdout: '', stderr: '' };
    } });
    await f.subject.install('npm:zcc-plugin-sample@^1.0.0', { enable: false }); const old = f.subject.get('sample')!;
    tamper = true; await expect(f.subject.applyUpdate('sample')).rejects.toThrow(/integrity changed/);
    expect(f.subject.get('sample')).toEqual(old);
    tamper = false; expect(await f.subject.applyAllUpdates()).toEqual({ updated: ['sample'], failed: [] });
    expect(f.subject.get('sample')).toMatchObject({ source: 'npm:zcc-plugin-sample@^1.0.0', npmResolvedVersion: '1.1.0', npmIntegrity: 'sha512-good', sourceIntent: { spec: '^1.0.0', specKind: 'range' } });
    expect(readdirSync(join(f.dataDir, 'plugins/generations'))).toHaveLength(1);
  });

  it('continues update-all after an individual source fails and reports that failure', async () => {
    let ready = false;
    const f = fixture({ cloneGit: async (url, dest, spec) => {
      const id = url.endsWith('/other') ? 'other' : 'sample';
      writePlugin(dest, id, spec.startsWith('commit:') ? '1.1.0' : '1.0.0');
      return { commit: spec.startsWith('commit:') ? b : a, refKind: 'branch' };
    }, updateResolver: { gitRefs: async url => {
      if (url.endsWith('/sample')) throw new Error('Git source is unavailable');
      return `${ready ? b : a}\tHEAD\n`;
    } } });
    await f.subject.install('git:https://example.test/sample', { enable: false });
    await f.subject.install('git:https://example.test/other', { enable: false }); ready = true;
    expect(await f.subject.applyAllUpdates()).toEqual({ updated: ['other'], failed: [{ id: 'sample', message: 'Git source is unavailable' }] });
    expect(f.subject.get('sample')!.version).toBe('1.0.0'); expect(f.subject.get('other')!.version).toBe('1.1.0');
  });

  it('resolves Git range installs using their prefix and keeps the selected tag and subdirectory', async () => {
    const f = fixture({ cloneGit: async (_url, dest, spec) => {
      expect(spec).toBe(`commit:${b}`);
      writePlugin(join(dest, 'plugins/sample'), 'sample', '1.1.0'); return { commit: b, refKind: 'commit' };
    }, updateResolver: { gitRefs: async () => `${b}\trefs/tags/sample-v1.1.0\n${c}\trefs/tags/other-v2.0.0\n` } });
    await f.subject.install('git:https://example.test/repo@semver:^1.0.0#subdir=plugins%2Fsample&tagPrefix=sample-', { enable: false });
    expect(f.subject.get('sample')).toMatchObject({ version: '1.1.0', sourceIntent: { subdir: 'plugins/sample', resolvedTag: 'sample-v1.1.0', selector: { kind: 'range', range: '^1.0.0', tagPrefix: 'sample-' } } });
  });

  it('rejects a materialized commit that differs from the checked candidate and removes staging', async () => {
    const f = fixture({ updateResolver: { gitRefs: async () => `${b}\tHEAD\n`, gitManifest: async () => ({ id: 'sample', version: '1.1.0', engines: {} }) },
      cloneGit: async (_url, dest) => { writePlugin(dest, 'sample'); return { commit: a, refKind: 'branch' }; } });
    await f.subject.install('git:https://example.test/repo', { enable: false });
    await expect(f.subject.applyUpdate('sample')).rejects.toThrow(/commit changed/);
    expect(f.subject.get('sample')!.gitResolvedCommit).toBe(a); expect(readdirSync(join(f.dataDir, 'plugins/generations'))).toHaveLength(1);
  });

  it('reports non-Error failures safely and exposes incompatible release reasons', async () => {
    const f = fixture({ updateResolver: { gitRefs: async () => { throw 'offline'; } } });
    await f.subject.install('git:https://example.test/repo', { enable: false }); await f.subject.checkUpdates();
    expect(f.subject.snapshot()[0].updateCheck).toMatchObject({ outcome: 'unavailable', detail: 'Plugin source check failed' });
    const other = fixture({ updateResolver: { gitRefs: async () => `${b}\tHEAD\n`, gitManifest: async () => ({ id: 'sample', version: '1.1.0', engines: { zcc: '>=999' } }) } });
    await other.subject.install('git:https://example.test/repo', { enable: false }); await other.subject.checkUpdates();
    expect(other.subject.snapshot()[0].updateCheck).toMatchObject({ outcome: 'incompatible', blocked: { version: '1.1.0' } });
    await expect(other.subject.applyUpdate('sample')).rejects.toThrow(/incompatible/);
  });

  it('treats malformed and failed npm metadata as unavailable while retaining the installed generation', async () => {
    let mode = 'invalid';
    const f = fixture({ spawnNpm: async (args, dest) => {
      if (args[0] === 'view') return { code: mode === 'failed' ? 1 : 0, stdout: 'invalid metadata', stderr: '' };
      writePlugin(join(dest, 'node_modules/zcc-plugin-sample'), 'sample'); return { code: 0, stdout: '', stderr: '' };
    } });
    await f.subject.install('npm:zcc-plugin-sample', { enable: false });
    await f.subject.checkUpdates(); expect(f.subject.snapshot()[0].updateCheck).toMatchObject({ outcome: 'unavailable', detail: 'npm returned malformed package metadata' });
    mode = 'failed'; await f.subject.checkUpdates();
    expect(f.subject.snapshot()[0].updateCheck?.detail).toMatch(/registry is unavailable/);
    expect(f.subject.get('sample')!.version).toBe('1.0.0');
  });
});
