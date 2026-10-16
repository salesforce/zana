import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPluginService } from './plugin-service.js';
import {
  TOOL_POLICY_INVENTORY_UNAVAILABLE_REASON,
  TOOL_POLICY_NOT_READY_REASON
} from './plugin-tool-policy-state.js';

const roots: string[] = [];
const services: ReturnType<typeof createPluginService>[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-tool-policy-life-'));
  roots.push(dir);
  return dir;
}

function writePlugin(dir: string, id: string, server: string, extra: Record<string, unknown> = {}): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `zcc-plugin-${id}`,
      version: '0.1.0',
      engines: { zcc: '>=1.0.0', zccPluginSdk: '>=0.1.0' },
      zcc: {
        name: id,
        description: `${id} plugin`,
        branding: { icon: 'Puzzle' },
        server: './server.mjs',
        ...extra
      }
    })
  );
  writeFileSync(join(dir, 'server.mjs'), server);
  return dir;
}

function request(over: Record<string, string> = {}) {
  return {
    invocationId: 'inv-1',
    threadId: 't1',
    projectId: 'p1',
    providerId: 'claude-code',
    toolName: 'bash',
    input: {},
    ...over
  };
}

describe('plugin tool policy lifecycle', () => {
  it('denies while an enabled unknown server plugin is still starting', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'slow-policy'),
      'slow-policy',
      `export default async function plugin(zcc) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        zcc.hooks.onToolPolicy(() => ({ action: 'deny', reason: 'late' }));
      }\n`
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    const installing = service.install(pluginDir);
    await expect.poll(() => service.get('slow-policy')?.toolPolicy).toBe('unknown');
    await expect(service.decideToolPolicy(request())).resolves.toMatchObject({
      action: 'deny',
      reason: expect.stringContaining(TOOL_POLICY_NOT_READY_REASON)
    });
    await installing;
    await expect(service.decideToolPolicy(request({ invocationId: 'inv-2' }))).resolves.toEqual({
      action: 'deny',
      reason: 'late'
    });
  });

  it('releases obligation after disable', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'policy'),
      'policy',
      `export default function plugin(zcc) {
        zcc.hooks.onToolPolicy(() => ({ action: 'deny', reason: 'blocked' }));
      }\n`,
      { toolPolicy: true }
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    await service.install(pluginDir);
    await expect(service.decideToolPolicy(request())).resolves.toEqual({ action: 'deny', reason: 'blocked' });
    await service.disable('policy');
    await expect(service.decideToolPolicy(request({ invocationId: 'inv-2' }))).resolves.toEqual({
      action: 'allow'
    });
  });

  it('denies a declared true plugin that never registers a handler', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'missing-handler'),
      'missing-handler',
      `export default function plugin() {}\n`,
      { toolPolicy: true }
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    const row = await service.install(pluginDir);
    expect(row.status).toBe('degraded');
    await expect(service.decideToolPolicy(request())).resolves.toMatchObject({
      action: 'deny',
      reason: expect.stringContaining(TOOL_POLICY_NOT_READY_REASON)
    });
  });

  it('releases obligation after remove', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'removable-policy'),
      'removable-policy',
      `export default function plugin(zcc) {
        zcc.hooks.onToolPolicy(() => ({ action: 'deny', reason: 'blocked' }));
      }\n`,
      { toolPolicy: true }
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    await service.install(pluginDir);
    await service.remove('removable-policy');
    await expect(service.decideToolPolicy(request())).resolves.toEqual({ action: 'allow' });
  });

  it('turns a stale cached allow into a sticky deny', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'allow-policy'),
      'allow-policy',
      `export default function plugin(zcc) {
        zcc.hooks.onToolPolicy(() => ({ action: 'allow' }));
      }\n`,
      { toolPolicy: true }
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    await service.install(pluginDir);
    await expect(service.decideToolPolicy(request())).resolves.toEqual({ action: 'allow' });
    await service.disable('allow-policy');
    await expect(service.decideToolPolicy(request())).resolves.toEqual({
      action: 'deny',
      reason: 'plugin tool policy changed'
    });
    await expect(service.decideToolPolicy(request())).resolves.toEqual({
      action: 'deny',
      reason: 'plugin tool policy changed'
    });
  });

  it('denies after service shutdown while a declared policy remains enabled', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'shutdown-policy'),
      'shutdown-policy',
      `export default function plugin(zcc) {
        zcc.hooks.onToolPolicy(() => ({ action: 'allow' }));
      }\n`,
      { toolPolicy: true }
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    await service.install(pluginDir);
    service.stop();
    await expect(service.decideToolPolicy(request())).resolves.toMatchObject({
      action: 'deny',
      reason: expect.stringContaining(TOOL_POLICY_NOT_READY_REASON)
    });
  });

  it('denies when the persisted inventory is corrupt', async () => {
    const dataDir = root();
    mkdirSync(join(dataDir, 'plugins'), { recursive: true });
    writeFileSync(join(dataDir, 'plugins', 'installed.json'), '{not-json');
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    await expect(service.decideToolPolicy(request())).resolves.toEqual({
      action: 'deny',
      reason: TOOL_POLICY_INVENTORY_UNAVAILABLE_REASON
    });
  });

  it('rejects a false declaration that registers a policy handler', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'false-declaration'),
      'false-declaration',
      `export default function plugin(zcc) {
        zcc.hooks.onToolPolicy(() => ({ action: 'allow' }));
      }\n`,
      { toolPolicy: false }
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    const row = await service.install(pluginDir);
    expect(row).toMatchObject({ status: 'degraded', toolPolicy: 'true' });
    await expect(service.decideToolPolicy(request())).resolves.toMatchObject({
      action: 'deny',
      reason: expect.stringContaining(TOOL_POLICY_NOT_READY_REASON)
    });
  });

  it.each([
    [`return invalid`, `zcc.hooks.onToolPolicy(() => ({ action: 'wait' }));`],
    [`throw`, `zcc.hooks.onToolPolicy(() => { throw new Error('boom'); });`]
  ])('fails closed when a handler %s', async (_label, registration) => {
    const pluginDir = writePlugin(
      join(root(), 'bad-decision'),
      'bad-decision',
      `export default function plugin(zcc) { ${registration} }\n`,
      { toolPolicy: true }
    );
    const service = createPluginService({ dataDir: root(), bundledRoot: root() });
    services.push(service);
    await service.install(pluginDir);
    await expect(service.decideToolPolicy(request())).resolves.toEqual({
      action: 'deny',
      reason: 'Plugin tool policy unavailable: bad-decision'
    });
  });

  it('fails closed when policy state changes while a handler is evaluating', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'slow-allow'),
      'slow-allow',
      `export default function plugin(zcc) {
        zcc.hooks.onToolPolicy(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { action: 'allow' };
        });
      }\n`,
      { toolPolicy: true }
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    await service.install(pluginDir);
    const decision = service.decideToolPolicy(request());
    await service.disable('slow-allow');
    await expect(decision).resolves.toMatchObject({ action: 'deny' });
  });

  it('retains a sealed policy handler after a reload candidate fails', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'reload-policy'),
      'reload-policy',
      `export default function plugin(zcc) {
        zcc.hooks.onToolPolicy(() => ({ action: 'deny', reason: 'original' }));
      }\n`,
      { toolPolicy: true }
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    await service.install(pluginDir);
    writeFileSync(join(pluginDir, 'server.mjs'), `export default function() { throw new Error('reload failed'); }\n`);
    await expect(service.reload('reload-policy')).rejects.toThrow('reload failed');
    await expect(service.decideToolPolicy(request())).resolves.toEqual({
      action: 'deny',
      reason: 'original'
    });
  });

  it('promotes a reload candidate that registers a replacement handler', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'replacement-policy'),
      'replacement-policy',
      `export default function plugin(zcc) {
        zcc.hooks.onToolPolicy(() => ({ action: 'deny', reason: 'original' }));
      }\n`,
      { toolPolicy: true }
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    await service.install(pluginDir);
    writeFileSync(join(pluginDir, 'server.mjs'), `export default function plugin(zcc) {
      zcc.hooks.onToolPolicy(() => ({ action: 'deny', reason: 'replacement' }));
    }\n`);
    await service.reload('replacement-policy');
    await expect(service.decideToolPolicy(request())).resolves.toEqual({ action: 'deny', reason: 'replacement' });
  });

  it('keeps an inventory-blocked denial for repeated invocation ids', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(
      join(root(), 'cache-policy'),
      'cache-policy',
      `export default function plugin(zcc) {
        zcc.hooks.onToolPolicy(() => ({ action: 'allow' }));
      }\n`,
      { toolPolicy: true }
    );
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    const installing = service.install(pluginDir);
    await expect.poll(() => service.get('cache-policy')?.toolPolicy).toBe('true');
    await expect(service.decideToolPolicy(request())).resolves.toMatchObject({
      action: 'deny',
      reason: expect.stringContaining(TOOL_POLICY_NOT_READY_REASON)
    });
    await installing;
    await expect(service.decideToolPolicy(request())).resolves.toMatchObject({
      action: 'deny',
      reason: expect.stringContaining(TOOL_POLICY_NOT_READY_REASON)
    });
  });
});
