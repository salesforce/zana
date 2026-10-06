import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { buildPluginHost } from '@zana-ai/zcc-plugin-build';
import { createPluginService } from './plugin-service.js';
import { PluginHostArtifactRegistry } from './plugin-host-artifact-registry.js';

const dirs: string[] = [];
const services: ReturnType<typeof createPluginService>[] = [];
const directory = () => { const path = mkdtempSync(join(tmpdir(), 'zcc-plugin-service-coverage-')); dirs.push(path); return path; };
afterEach(() => {
  services.splice(0).forEach(service => service.stop());
  dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
});

it('never accepts unregistered project roots for project host calls', async () => {
  const pluginDir = join(directory(), 'scoped');
  mkdirSync(pluginDir);
  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({
    name: 'zcc-plugin-scoped', version: '0.1.0',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: 'Scoped', description: 'Scoped host calls', branding: { icon: 'Puzzle' }, server: './server.mjs', host: './host.ts' }
  }));
  writeFileSync(join(pluginDir, 'server.mjs'), `export default function(zcc) {
    zcc.rpc.method('callProject', request => zcc.host.projectCall(request));
  }`);
  writeFileSync(join(pluginDir, 'host.ts'), `export default function(api) { api.methods.register('read', () => 'read'); }`);
  await buildPluginHost(pluginDir, '1.0.0');
  const hostArtifacts = new PluginHostArtifactRegistry();
  const callHostOnlineRpc = vi.fn(async () => ({ output: { source: 'host' } }));
  const projectRoot = directory();
  const ctx = {
    projects: { list: () => [{ id: 'registered', path: projectRoot }, { id: 'unavailable', path: join(projectRoot, 'missing') }] },
    hostHub: { resolveHostId: () => 'host-1', callHostOnlineRpc }
  };
  const service = createPluginService({ dataDir: directory(), bundledRoot: directory(), pluginHostArtifacts: hostArtifacts, productContext: ctx as never });
  services.push(service);
  await service.install(pluginDir);
  await expect(service.callRpc('scoped', 'callProject', { projectId: 'forged', method: 'read' })).rejects.toThrow('unrecognized projectId');
  await expect(service.callRpc('scoped', 'callProject', { projectId: 'unavailable', method: 'read' })).rejects.toThrow('project root is unavailable');
  expect(callHostOnlineRpc).not.toHaveBeenCalled();
  await expect(service.callRpc('scoped', 'callProject', { projectId: 'registered', method: 'read' })).resolves.toEqual({ result: { source: 'host' } });
  expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({ command: expect.objectContaining({ projectRoot: realpathSync(projectRoot) }) }));
  await expect(service.callRpc('scoped', 'callProject', { projectId: '', method: 'read' })).rejects.toThrow('invalid project host call');
});

it('returns registered availability reasons and proceeds when admission plugins have no veto', async () => {
  const pluginDir = join(directory(), 'availability');
  mkdirSync(pluginDir);
  writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({
    name: 'zcc-plugin-availability', version: '0.1.0',
    engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
    zcc: { name: 'Availability', description: 'Tab availability', branding: { icon: 'Puzzle' }, server: './server.mjs' }
  }));
  writeFileSync(join(pluginDir, 'server.mjs'), `export default function(zcc) {
    zcc.ui.registerProjectTabAvailability({ tabId: 'main', evaluate: ({ projectId }) => ({ available: projectId === 'yes', reason: 'configured' }) });
    zcc.hooks.on(() => ({ action: 'proceed' }));
    zcc.hooks.onToolPolicy(() => ({ action: 'allow' }));
  }`);
  const service = createPluginService({ dataDir: directory(), bundledRoot: directory() });
  services.push(service);
  await service.install(pluginDir);
  await expect(service.evaluateProjectTabAvailability({ pluginId: 'availability', tabId: 'main', projectId: 'yes' }))
    .resolves.toEqual({ available: true, reason: 'configured' });
  await expect(service.evaluateProjectTabAvailability({ pluginId: 'availability', tabId: 'main', projectId: 'no' }))
    .resolves.toEqual({ available: false, reason: 'configured' });
  await expect(service.admitDispatch({ dispatchId: 'd', threadId: 't', projectId: 'p', generation: 1 }))
    .resolves.toEqual({ action: 'proceed' });
  await expect(service.decideToolPolicy({ invocationId: 'i', threadId: 't', projectId: 'p', providerId: 'codex', toolName: 'Read', input: {} }))
    .resolves.toEqual({ action: 'allow' });
});
