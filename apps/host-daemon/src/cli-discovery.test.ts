import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import type { LaunchProvider } from './harness/launch-provider.js';
import { discoverCliOnHost } from './cli-discovery.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'zcc-cli-discovery-'))); roots.push(home);
  const root = join(home, 'project'), cwd = join(root, 'src'); mkdirSync(cwd, { recursive: true });
  const config = { version: 1, theme: 'dark', claudeBinary: '/this-machine/claude' } as AppConfig;
  const roles = vi.fn(async () => [{ id: 'role', label: 'Role', scope: ['local'] }]);
  const models = vi.fn(async () => ['this-machine/model']);
  const provider = { adapter: { descriptor: { id: 'shell' } }, discoverRoleTargets: roles, discoverModelTargets: models } as unknown as LaunchProvider;
  const deps = { providerFor: vi.fn(() => provider), installedHarnessVersion: vi.fn(async () => '1.2.3') };
  const command = { type: 'provider.cli_discovery', root, cwd, profile: 'opencode', query: 'version', nativeAgentDiscoveryEnabled: true };
  return { home, root, cwd, command, config, deps, provider, roles, models,
    run: (patch: object = {}) => discoverCliOnHost({ ...command, ...patch }, config, deps) };
}
it('uses host-local configuration and canonical cwd for all three bounded discovery queries', async () => {
  const f = fixture();
  expect(await f.run()).toEqual({ query: 'version', version: '1.2.3' });
  expect(f.deps.installedHarnessVersion).toHaveBeenCalledExactlyOnceWith({ ...f.config, nativeAgentDiscoveryEnabled: true }, 'opencode');
  expect(await f.run({ query: 'roles' })).toEqual({ query: 'roles', roles: [{ id: 'role', label: 'Role', scope: ['local'] }] });
  expect(f.roles).toHaveBeenCalledExactlyOnceWith({ cwd: f.cwd, config: { ...f.config, nativeAgentDiscoveryEnabled: true } });
  expect(await f.run({ query: 'models' })).toEqual({ query: 'models', models: ['this-machine/model'] });
  expect(f.config).not.toHaveProperty('nativeAgentDiscoveryEnabled');
  await f.run({ profile: 'shell' }); expect(f.deps.installedHarnessVersion).toHaveBeenLastCalledWith(expect.anything(), 'shell');
});
it('preserves absent optional discovery and an unavailable version without fabricating inventory', async () => {
  const f = fixture(); delete f.provider.discoverRoleTargets; delete f.provider.discoverModelTargets;
  f.deps.installedHarnessVersion.mockResolvedValueOnce(undefined as never);
  expect(await f.run()).toEqual({ query: 'version', version: undefined });
  expect(await f.run({ query: 'roles', nativeAgentDiscoveryEnabled: false })).toEqual({ query: 'roles', roles: [] });
  expect(await f.run({ query: 'models' })).toEqual({ query: 'models' });
});
it('does not authorize a harness disabled on the machine that owns discovery', async () => {
  const f = fixture();
  f.config.harnessOpenCodeEnabled = false;
  expect(await f.run()).toEqual({ query: 'version', version: undefined });
  f.config.harnessOpenCodeEnabled = true;
  expect(await f.run()).toEqual({ query: 'version', version: '1.2.3' });
});
it('rejects malformed requests, non-directory roots and symlink escapes before probing', async () => {
  const f = fixture(); const outside = join(f.home, 'outside'); mkdirSync(outside);
  const link = join(f.root, 'escape'); symlinkSync(outside, link);
  const rootLink = join(f.home, 'root-link'); symlinkSync(f.root, rootLink);
  const file = join(f.root, 'file'); writeFileSync(file, 'text');
  for (const patch of [{ profile: 'unknown' }, { env: { KEY: 'secret' } }, { root: 'relative' }, { cwd: 'relative' },
    { root: file }, { root: rootLink }, { root: '/missing-root' }, { cwd: file }, { cwd: link }, { cwd: outside }]) {
    await expect(f.run(patch)).rejects.toThrow();
  }
  expect(f.deps.providerFor).not.toHaveBeenCalled();
});
it('rejects late directory replacements and propagates probe errors', async () => {
  const f = fixture();
  f.deps.installedHarnessVersion.mockRejectedValueOnce(new Error('probe failed'));
  await expect(f.run()).rejects.toThrow('probe failed');
  f.deps.installedHarnessVersion.mockImplementationOnce(async () => {
    renameSync(f.cwd, `${f.cwd}-old`); mkdirSync(f.cwd); return '1.2.3';
  });
  await expect(f.run()).rejects.toThrow('changed');
  f.deps.installedHarnessVersion.mockImplementationOnce(async () => {
    renameSync(f.root, `${f.root}-old`); symlinkSync(`${f.root}-old`, f.root); return '1.2.3';
  });
  await expect(f.run()).rejects.toThrow('changed');
});
it('validates bounded returned inventory and never leaks extra provider metadata', async () => {
  const f = fixture();
  f.roles.mockResolvedValueOnce([{ id: 'x', label: 'X', scope: ['local'], token: 'secret' }] as never);
  await expect(f.run({ query: 'roles' })).rejects.toThrow();
  f.models.mockResolvedValueOnce(Array(10001).fill('m'));
  await expect(f.run({ query: 'models' })).rejects.toThrow();
  f.models.mockResolvedValueOnce(undefined as never);
  expect(await f.run({ query: 'models' })).toEqual({ query: 'models' });
});
