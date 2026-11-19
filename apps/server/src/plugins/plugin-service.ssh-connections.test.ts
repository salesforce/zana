import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as pluginApi from './plugin-api.js';
import { createPluginService } from './plugin-service.js';
import { createPluginStore, pluginStorePath } from './plugin-store.js';

const roots: string[] = [];
const services: ReturnType<typeof createPluginService>[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'ssh-provider-service-')); roots.push(dir); return dir; };
beforeEach(() => {
  vi.stubEnv('ZCC_OFFICIAL_MARKETPLACE_URL', 'off');
  vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', 'off');
});
afterEach(() => {
  services.splice(0).forEach(service => service.stop());
  roots.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});

const source = `export default api => {
  let prepared = [];
  api.sshConnections.register({
    owns: remote => remote.host === 'managed',
    prepare: remote => { prepared.push(remote); return {status: 'ready'}; }
  });
  api.rpc.method('prepared', () => prepared);
};`;
function plugin(id: string, body = source) {
  const dir = join(directory(), id); mkdirSync(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `zcc-plugin-${id}`, version: '0.1.0',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: id, description: 'SSH connection fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' }
  }));
  writeFileSync(join(dir, 'server.mjs'), body);
  return dir;
}
function fixture() {
  const dataDir = directory();
  const service = createPluginService({ dataDir, bundledRoot: directory() }); services.push(service);
  const onProvider = vi.fn();
  const prepare = (host = 'managed') => service.prepareSshConnection({ host, user: 'dev' }, new AbortController().signal, onProvider);
  return { service, dataDir, onProvider, prepare };
}

it('selects active registered providers and excludes disabled and ordinary plugins across reloads', async () => {
  const f = fixture();
  await f.service.install(plugin('inactive'), { enable: false });
  await f.service.install(plugin('ordinary', 'export default () => {};'));
  await f.service.install(plugin('manager'));
  await f.prepare('unmanaged'); expect(f.onProvider).not.toHaveBeenCalled();
  await f.prepare(); expect(f.onProvider).toHaveBeenCalledExactlyOnceWith('manager');
  await expect(f.service.callRpc('manager', 'prepared', {})).resolves.toEqual([{ host: 'managed', user: 'dev' }]);
  await f.service.disable('manager'); f.onProvider.mockClear();
  await f.prepare(); expect(f.onProvider).not.toHaveBeenCalled();
  await f.service.enable('manager');
  await f.prepare(); expect(f.onProvider).toHaveBeenCalledExactlyOnceWith('manager');
  await expect(f.service.callRpc('manager', 'prepared', {})).resolves.toHaveLength(1);
});

it('does not select a disposed generation while its live inventory entry is still present', async () => {
  const handles: pluginApi.PluginHandle[] = [];
  const original = pluginApi.createPluginApi;
  vi.spyOn(pluginApi, 'createPluginApi').mockImplementation((...args) => {
    const handle = original(...args); handles.push(handle); return handle;
  });
  const f = fixture(); await f.service.install(plugin('retiring'));
  await f.prepare(); expect(f.onProvider).toHaveBeenCalledOnce();
  await handles[0].dispose(); f.onProvider.mockClear();
  await f.prepare(); expect(f.onProvider).not.toHaveBeenCalled();
  await f.service.reload('retiring');
  await f.prepare(); expect(f.onProvider).toHaveBeenCalledExactlyOnceWith('retiring');
});

it('falls back to the plugin ID for legacy inventory without a display name', async () => {
  const f = fixture(); const row = await f.service.install(plugin('legacy-name'));
  await createPluginStore({ file: pluginStorePath(f.dataDir) }).upsert({ ...row, name: '' });
  await f.service.reload('legacy-name');
  await f.prepare(); expect(f.onProvider).toHaveBeenCalledExactlyOnceWith('legacy-name');
});
