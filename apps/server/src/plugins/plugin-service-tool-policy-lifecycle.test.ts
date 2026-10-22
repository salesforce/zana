import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPluginService } from './plugin-service.js';
import { createPluginStore, pluginStorePath } from './plugin-store.js';
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
  it('persists unknown only during activation and seals a no-handler plugin as false for independent readers', async () => {
    const dataDir = root();
    const pluginDir = writePlugin(join(root(), 'no-policy'), 'no-policy',
      `export default async function plugin() { await new Promise(resolve => setTimeout(resolve, 100)); }\n`);
    const service = createPluginService({ dataDir, bundledRoot: root() });
    services.push(service);
    const observer = createPluginStore({ file: pluginStorePath(dataDir) });
    const installing = service.install(pluginDir);
    await expect.poll(() => observer.get('no-policy')?.toolPolicy).toBe('unknown');
    await expect(service.decideToolPolicy(request())).resolves.toMatchObject({ action: 'deny' });
    await installing;
    expect(observer.get('no-policy')).toMatchObject({ enabled: true, status: 'running', toolPolicy: 'false' });
    await expect(service.decideToolPolicy(request({ invocationId: 'sealed' }))).resolves.toEqual({ action: 'allow' });
    await service.disable('no-policy');
    expect(observer.get('no-policy')).toMatchObject({ enabled: false, status: 'disabled', toolPolicy: 'false' });
  });

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

  describe('toolPolicyReadiness', () => {
    const policyServer = (delayMs = 0) => `export default async function plugin(zcc) {
      ${delayMs ? `await new Promise((resolve) => setTimeout(resolve, ${delayMs}));` : ''}
      zcc.hooks.onToolPolicy(() => ({ action: 'allow' }));
    }\n`;

    it('is ready with no server plugins', async () => {
      const service = createPluginService({ dataDir: root(), bundledRoot: root() });
      services.push(service);
      await service.start();
      await expect(service.toolPolicyReadiness()).resolves.toEqual({ ready: true, required: [] });
    });

    it('waits for an in-flight start and never reports a torn pre-activation row', async () => {
      const dataDir = root();
      const pluginDir = writePlugin(join(root(), 'slow-ready'), 'slow-ready', policyServer(150), { toolPolicy: true });
      const first = createPluginService({ dataDir, bundledRoot: root() });
      await first.install(pluginDir);
      first.stop();
      const service = createPluginService({ dataDir, bundledRoot: root() });
      services.push(service);
      const starting = service.start();
      let settled = false;
      void starting.then(() => { settled = true; });
      const readiness = service.toolPolicyReadiness();
      let resolvedEarly = false;
      void readiness.then(() => { resolvedEarly = !settled; });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(settled).toBe(false);
      expect(resolvedEarly).toBe(false);
      const result = await readiness;
      expect(settled).toBe(true);
      expect(result).toEqual({
        ready: true,
        required: [{ pluginId: 'slow-ready', toolPolicy: 'true', status: 'running', sealed: true }]
      });
    });

    it('reports not ready with the blocked entry while a plugin is mid-install (no start in flight)', async () => {
      const dataDir = root();
      const pluginDir = writePlugin(join(root(), 'mid-install'), 'mid-install', policyServer(150), { toolPolicy: true });
      const service = createPluginService({ dataDir, bundledRoot: root() });
      services.push(service);
      const installing = service.install(pluginDir);
      await expect.poll(() => service.get('mid-install')?.toolPolicy).toBe('true');
      const result = await service.toolPolicyReadiness();
      expect(result.ready).toBe(false);
      expect(result.required).toHaveLength(1);
      expect(result.required[0]).toMatchObject({ pluginId: 'mid-install', sealed: false });
      expect(result.reason).toContain('mid-install (true, ');
      expect(result.reason).toContain('unsealed');
      await installing;
      await expect(service.toolPolicyReadiness()).resolves.toMatchObject({ ready: true });
    });

    it('requires an enabled server plugin whose policy is unknown and reports it as blocked', async () => {
      const dataDir = root();
      const pluginDir = writePlugin(join(root(), 'undeclared'), 'undeclared',
        `export default async function plugin() { await new Promise((resolve) => setTimeout(resolve, 150)); }\n`);
      const service = createPluginService({ dataDir, bundledRoot: root() });
      services.push(service);
      const installing = service.install(pluginDir);
      await expect.poll(() => service.get('undeclared')?.toolPolicy).toBe('unknown');
      const result = await service.toolPolicyReadiness();
      expect(result).toMatchObject({ ready: false, required: [{ pluginId: 'undeclared', toolPolicy: 'unknown', sealed: false }] });
      expect(result.reason).toMatch(/^undeclared \(unknown, \w+, unsealed\)$/);
      await installing;
    });

    it('does not require a plugin sealed as declared-false', async () => {
      const dataDir = root();
      const pluginDir = writePlugin(join(root(), 'no-policy-ready'), 'no-policy-ready',
        `export default function plugin() {}\n`, { toolPolicy: false });
      const service = createPluginService({ dataDir, bundledRoot: root() });
      services.push(service);
      await service.install(pluginDir);
      await expect(service.toolPolicyReadiness()).resolves.toEqual({ ready: true, required: [] });
    });

    it('excludes disabled plugins', async () => {
      const dataDir = root();
      const pluginDir = writePlugin(join(root(), 'to-disable'), 'to-disable', policyServer(), { toolPolicy: true });
      const service = createPluginService({ dataDir, bundledRoot: root() });
      services.push(service);
      await service.install(pluginDir);
      await expect(service.toolPolicyReadiness()).resolves.toMatchObject({ ready: true, required: [{ pluginId: 'to-disable' }] });
      await service.disable('to-disable');
      await expect(service.toolPolicyReadiness()).resolves.toEqual({ ready: true, required: [] });
    });

    it('is not ready when a declared-true plugin never registers a handler', async () => {
      const dataDir = root();
      const pluginDir = writePlugin(join(root(), 'no-handler'), 'no-handler', `export default function plugin() {}\n`, { toolPolicy: true });
      const service = createPluginService({ dataDir, bundledRoot: root() });
      services.push(service);
      await service.install(pluginDir);
      const result = await service.toolPolicyReadiness();
      expect(result.ready).toBe(false);
      expect(result.required).toMatchObject([{ pluginId: 'no-handler', toolPolicy: 'true', status: 'degraded', sealed: false }]);
      expect(result.reason).toContain('no-handler (true, degraded, unsealed)');
    });

    it('reports an unavailable inventory for a corrupt registry', async () => {
      const dataDir = root();
      mkdirSync(join(dataDir, 'plugins'), { recursive: true });
      writeFileSync(join(dataDir, 'plugins', 'installed.json'), '{not-json');
      const service = createPluginService({ dataDir, bundledRoot: root() });
      services.push(service);
      const result = await service.toolPolicyReadiness();
      expect(result).toMatchObject({ ready: false, required: [] });
      expect(result.reason).toContain(TOOL_POLICY_INVENTORY_UNAVAILABLE_REASON);
    });

    it('reports an unavailable inventory when the registry goes missing after it existed', async () => {
      const dataDir = root();
      const pluginDir = writePlugin(join(root(), 'vanish'), 'vanish', policyServer(), { toolPolicy: true });
      const service = createPluginService({ dataDir, bundledRoot: root() });
      services.push(service);
      await service.install(pluginDir);
      rmSync(pluginStorePath(dataDir));
      const result = await service.toolPolicyReadiness();
      expect(result).toMatchObject({ ready: false, required: [] });
      expect(result.reason).toContain(TOOL_POLICY_INVENTORY_UNAVAILABLE_REASON);
      expect(result.reason).toContain('missing after it existed');
    });

    it('is not ready once the service is stopped', async () => {
      const service = createPluginService({ dataDir: root(), bundledRoot: root() });
      services.push(service);
      await service.start();
      service.stop();
      await expect(service.toolPolicyReadiness()).resolves.toEqual({ ready: false, required: [], reason: 'plugin service is stopped' });
    });

    it('tolerates a failed start and still answers from the registry', async () => {
      const dataDir = root();
      mkdirSync(join(dataDir, 'plugins'), { recursive: true });
      writeFileSync(join(dataDir, 'plugins', 'installed.json'), '{not-json');
      const service = createPluginService({ dataDir, bundledRoot: root() });
      services.push(service);
      void service.start().catch(() => undefined);
      await expect(service.toolPolicyReadiness()).resolves.toMatchObject({ ready: false, required: [] });
    });
  });
});
