import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPluginService } from './plugin-service.js';

const h = vi.hoisted(() => ({
  watchers: [] as Array<{ callback: (event: string, filename: string | null) => void; close: ReturnType<typeof vi.fn> }>,
  loops: [] as Array<{ deps: any; handleChange: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>
}));
vi.mock('node:fs', async original => ({
  ...await original<typeof import('node:fs')>(),
  watch: vi.fn((_root, _options, callback) => {
    const watcher = { callback, close: vi.fn() };
    h.watchers.push(watcher);
    return watcher;
  })
}));
vi.mock('@zana-ai/zcc-plugin-build', async original => ({
  ...await original<typeof import('@zana-ai/zcc-plugin-build')>(),
  createPluginDevLoop: vi.fn(deps => {
    const loop = { deps, handleChange: vi.fn(), dispose: vi.fn() };
    h.loops.push(loop);
    return loop;
  })
}));

const roots: string[] = [];
const services: ReturnType<typeof createPluginService>[] = [];
function root() { const dir = mkdtempSync(join(tmpdir(), 'plugin-development-')); roots.push(dir); return dir; }
function plugin(dir: string, id = 'tasks') {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `zcc-plugin-${id}`, version: '1.0.0',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: id, description: 'development fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
  writeFileSync(join(dir, 'server.mjs'), `export default zcc => { zcc.rpc.method('read', () => 'running'); };`);
  return dir;
}
function fixture(startupDefault = false, initial: boolean | undefined = undefined) {
  const bundled = root(); plugin(join(bundled, 'tasks'));
  const config = { pluginDevelopmentEnabled: initial };
  const changed = vi.fn();
  const subject = createPluginService({ dataDir: root(), bundledRoot: bundled,
    watchBuiltinPluginSources: startupDefault, getAppConfig: () => config, onAppsChanged: changed });
  services.push(subject);
  return { subject, bundled, config, changed };
}
beforeEach(() => {
  h.watchers.length = 0; h.loops.length = 0;
  vi.stubEnv('ZCC_OFFICIAL_MARKETPLACE_URL', 'off'); vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', 'off');
});
afterEach(() => {
  services.splice(0).forEach(s => s.stop());
  roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
  vi.unstubAllEnvs();
});

it.each([[false, undefined, false], [true, undefined, true], [true, false, false], [false, true, true]] as const)(
  'uses the saved preference before the startup default (%s, %s)', async (startup, saved, allowed) => {
    const { subject } = fixture(startup, saved), local = plugin(root());
    if (allowed) {
      await subject.install(local);
      await expect(subject.reload('tasks')).resolves.toMatchObject({ sourceKind: 'path', status: 'running' });
    } else await expect(subject.install(local)).rejects.toThrow('Settings > Development');
  }
);

it('applies local override policy immediately and keeps the current plugin running when disabled', async () => {
  const { subject, config, changed } = fixture(), local = plugin(root());
  await subject.start();
  config.pluginDevelopmentEnabled = true; await subject.refreshDevelopmentMode();
  await subject.install(local);
  expect(subject.snapshot().find(row => row.id === 'tasks')?.statusDetail).toBeNull();
  config.pluginDevelopmentEnabled = false; await subject.refreshDevelopmentMode();
  await expect(subject.reload('tasks')).rejects.toThrow('Settings > Development');
  await expect(subject.callRpc('tasks', 'read', {})).resolves.toBe('running');
  expect(subject.snapshot().find(row => row.id === 'tasks')?.statusDetail).toContain('bundled plugin id');
  config.pluginDevelopmentEnabled = true; await subject.refreshDevelopmentMode();
  expect(subject.snapshot().find(row => row.id === 'tasks')?.statusDetail).toBeNull();
  expect(changed).toHaveBeenCalled();
});

it('starts and disposes source watchers once per toggle, ignores stale callbacks, and cleans up on shutdown', async () => {
  const { subject, config } = fixture();
  await subject.install('builtin:tasks'); await subject.start();
  expect(h.watchers).toHaveLength(0);
  config.pluginDevelopmentEnabled = true;
  await Promise.all([subject.refreshDevelopmentMode(), subject.refreshDevelopmentMode()]);
  expect(h.watchers).toHaveLength(1);
  expect(await h.loops[0].deps.targets()).toEqual({ hasApp: false, hasServer: true, hasHost: false });
  h.watchers[0].callback('change', 'server.ts');
  expect(h.loops[0].handleChange).toHaveBeenCalledWith('server.ts');
  h.watchers[0].callback('change', null); h.watchers[0].callback('change', '');
  expect(h.loops[0].handleChange).toHaveBeenCalledTimes(1);
  config.pluginDevelopmentEnabled = false; await subject.refreshDevelopmentMode();
  expect(h.watchers[0].close).toHaveBeenCalledOnce(); expect(h.loops[0].dispose).toHaveBeenCalledOnce();
  h.watchers[0].callback('change', 'server.ts');
  expect(h.loops[0].handleChange).toHaveBeenCalledTimes(1);
  const reload = vi.spyOn(subject, 'reload');
  await h.loops[0].deps.reloadPlugin(); expect(reload).not.toHaveBeenCalled();
  config.pluginDevelopmentEnabled = true; await subject.refreshDevelopmentMode();
  expect(h.watchers).toHaveLength(2);
  h.watchers[0].callback('change', 'server.ts');
  expect(h.loops[0].handleChange).toHaveBeenCalledTimes(1);
  await h.loops[0].deps.reloadPlugin(); expect(reload).not.toHaveBeenCalled();
  await h.loops[1].deps.reloadPlugin(); expect(reload).toHaveBeenCalledWith('tasks');
  expect(h.watchers).toHaveLength(2);
  subject.stop(); subject.stop();
  expect(h.watchers[1].close).toHaveBeenCalledOnce(); expect(h.loops[1].dispose).toHaveBeenCalledOnce();
  await h.loops[1].deps.reloadPlugin(); expect(reload).toHaveBeenCalledTimes(1);
  await expect(subject.refreshDevelopmentMode()).rejects.toThrow('stopped');
});

it('watches newly installed builtins, releases watchers for local replacements and removal', async () => {
  const { subject, config } = fixture(false, true);
  await subject.start();
  await subject.install('builtin:tasks'); expect(h.watchers).toHaveLength(1);
  await subject.install(plugin(root())); expect(h.watchers[0].close).toHaveBeenCalledOnce();
  await subject.install('builtin:tasks'); expect(h.watchers).toHaveLength(2);
  await subject.remove('tasks'); expect(h.watchers[1].close).toHaveBeenCalledOnce();
  config.pluginDevelopmentEnabled = false; await subject.refreshDevelopmentMode();
});

it('can save development mode before startup without creating duplicate watchers', async () => {
  const { subject, config } = fixture();
  await subject.install('builtin:tasks');
  config.pluginDevelopmentEnabled = true; await subject.refreshDevelopmentMode();
  expect(h.watchers).toHaveLength(0);
  await subject.start(); await subject.refreshDevelopmentMode();
  expect(h.watchers).toHaveLength(1);
});

it('never permits remote packages to claim a bundled identity with the saved switch on', async () => {
  const subject = createPluginService({ dataDir: root(), bundledRoot: root(),
    getAppConfig: () => ({ pluginDevelopmentEnabled: true }),
    cloneGit: async (_url, dir) => { plugin(dir); return { commit: 'fixture' }; } });
  services.push(subject);
  await expect(subject.install('git:https://example.test/tasks')).rejects.toThrow('reserved');
  expect(subject.get('tasks')).toBeUndefined();
});
