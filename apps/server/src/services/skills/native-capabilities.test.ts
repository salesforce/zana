import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  disabled: vi.fn(),
  manual: new Set<string>(),
  injected: vi.fn(),
  primary: { id: 'local' },
  environment: vi.fn()
}));
vi.mock('@zana-ai/zcc-db', () => ({
  getPrimaryHost: () => mocks.primary,
  getEnvironment: (...args: unknown[]) => mocks.environment(...args)
}));
vi.mock('../../plugins/plugin-host-rpc.js', () => ({
  callPluginHostRpc: (...args: unknown[]) => mocks.resolve(...args)
}));
vi.mock('./skill-settings.js', () => ({
  skillOverrideStates: async () =>
    new Map([
      ...[...mocks.manual].map((name) => [name, 'manual'] as const),
      ...[...((await mocks.disabled()) as Set<string>)].map((name) => [name, 'off'] as const)
    ])
}));
vi.mock('./injected-skill-entries.js', () => ({
  listInjectedSkillEntries: (...args: unknown[]) => mocks.injected(...args)
}));
import { listNativeCapabilities } from './native-capabilities.js';
import { registerThreadProvider } from '../threads/thread-provider-catalog.js';
import { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';
const handles: Array<{ unregister(): void }> = [];
function provider(id = 'claude-code', extra = {}) {
  handles.push(
    registerThreadProvider('test-provider', {
      id,
      displayName: 'Test provider',
      capabilities: {} as any,
      experimental_nativeSkillRoots: { user: ['.agent/skills'], project: ['.agent/skills'] },
      experimental_resolvesNativeRoots: true,
      ...extra
    })
  );
}
function context(hostId = 'local') {
  const call = vi.fn().mockResolvedValue({ commands: [] });
  const artifacts = new PluginHostArtifactRegistry();
  artifacts.set('test-provider', {
    path: '/never-send',
    byteLength: 1,
    digest: 'a'.repeat(64),
    generation: 'g1'
  });
  return {
    call,
    ctx: {
      db: {},
      toProjects: () => [{ id: 'p', path: '/project', hostId }],
      hostHub: {
        resolveHostId: (id: string) => id,
        ensureHostSessionReady: vi.fn(),
        callHostOnlineRpc: call
      },
      pluginHostArtifacts: artifacts
    } as any
  };
}
const row = (name: string, extra = {}) => ({
  name,
  source: 'skill',
  origin: 'user',
  filePath: `/home/.agent/skills/${name}/SKILL.md`,
  qualifiedName: name,
  namePrefix: '',
  linked: false,
  description: null,
  argumentHint: null,
  userInvocable: true,
  ...extra
});
beforeEach(() => {
  mocks.resolve.mockReset().mockResolvedValue({ skills: [], commands: [] });
  mocks.disabled.mockReset().mockResolvedValue(new Set());
  mocks.manual.clear();
  mocks.injected.mockReset().mockReturnValue([]);
  mocks.environment.mockReset();
});
afterEach(() => {
  handles.splice(0).forEach((handle) => handle.unregister());
});
it('uses registered project and execution host, preserves IDs, and filters author/override restrictions', async () => {
  provider();
  const { ctx, call } = context();
  mocks.disabled.mockResolvedValue(new Set(['disabled']));
  call.mockResolvedValue({
    commands: [
      row('review', { qualifiedName: 'folder', disableModelInvocation: true, linked: true }),
      row('hidden', { userInvocable: false }),
      row('disabled'),
      row('grill-me', { source: 'command', filePath: '/home/.agent/commands/grill-me.md' })
    ]
  });
  const result = await listNativeCapabilities(ctx, { projectId: 'p', providerId: 'claude' });
  expect(result.commands.map((row) => row.name)).toEqual(['/review', '/grill-me']);
  expect(result.skills[0]).toMatchObject({
    id: 'user:folder',
    kind: 'skill',
    linked: true,
    disableModelInvocation: true,
    path: '/home/.agent/skills/review',
    hostId: 'local'
  });
  expect(result.skills.at(-1)).toMatchObject({ kind: 'command', toggle: { supported: false } });
  expect(call).toHaveBeenCalledWith(
    expect.objectContaining({
      hostId: 'local',
      command: expect.objectContaining({ cwd: '/project', providerId: 'claude-code' })
    })
  );
  expect(mocks.resolve.mock.calls[0][1]).toMatchObject({
    input: { cwd: '/project', providerId: 'claude-code' },
    hostId: 'local',
    projectRoot: '/project'
  });
});
it('classifies namespaces explicitly, deduplicates suggestions and prefers skills', async () => {
  provider('custom');
  const { ctx, call } = context();
  call.mockResolvedValue({
    commands: [
      row('same', { source: 'command' }),
      row('same'),
      row('same', { origin: 'project' }),
      row('plug:check', { namePrefix: 'plug:', qualifiedName: 'check' }),
      row('git:commit', { source: 'command', namePrefix: '' }),
      { ...row('no-file'), filePath: undefined }
    ]
  });
  const result = await listNativeCapabilities(ctx, { projectId: 'p', providerId: 'custom' });
  expect(result.commands.filter((row) => row.name === '/same')).toEqual([
    expect.objectContaining({ source: 'skill' })
  ]);
  expect(result.skills.find((row) => row.name === 'check')).toMatchObject({
    source: 'plugin',
    pluginName: 'plug',
    id: 'custom:plugin:plug/check'
  });
  expect(result.skills.find((row) => row.name === 'git:commit')).toMatchObject({ source: 'user' });
});
it('lists global roots on the primary host and remote entries stay read-only', async () => {
  provider('custom');
  const { ctx, call } = context('remote');
  call.mockResolvedValue({
    commands: [row('review', { origin: 'project' })],
    diagnostics: ['Truncated']
  });
  const result = await listNativeCapabilities(ctx, { projectId: 'p' });
  expect(result.skills[0]).toMatchObject({
    projectId: 'p',
    hostId: 'remote',
    toggle: { supported: false }
  });
  expect(mocks.disabled).not.toHaveBeenCalled();
  expect(result.diagnostics).toEqual(['Test provider: Truncated']);
  await listNativeCapabilities(ctx);
  expect(call.mock.calls.at(-1)?.[0]).toMatchObject({ hostId: 'local', command: { cwd: null } });
});
it('confines recorded thread environments to project/host ownership', async () => {
  provider();
  const { ctx, call } = context();
  mocks.environment.mockReturnValue({
    projectId: 'p',
    hostId: 'remote',
    status: 'ready',
    path: '/worktree'
  });
  await listNativeCapabilities(ctx, { projectId: 'p', hostId: 'remote', environmentId: 'env' });
  expect(call.mock.calls[0][0]).toMatchObject({ hostId: 'remote', command: { cwd: '/worktree' } });
  mocks.environment.mockReturnValue({
    projectId: 'other',
    hostId: 'remote',
    status: 'ready',
    path: '/secret'
  });
  await expect(
    listNativeCapabilities(ctx, { projectId: 'p', hostId: 'remote', environmentId: 'env' })
  ).rejects.toMatchObject({ code: 'environment-unavailable' });
  await expect(listNativeCapabilities(ctx, { projectId: 'unknown' })).rejects.toMatchObject({
    code: 'unknown-project'
  });
  await expect(listNativeCapabilities(ctx, { hostId: 'remote' })).rejects.toMatchObject({
    code: 'invalid-scope'
  });
  ctx.toProjects = () => [{ id: 'p', remote: true }];
  await expect(listNativeCapabilities(ctx, { projectId: 'p' })).rejects.toMatchObject({
    code: 'host-unavailable'
  });
});
it('reports resolver, missing artifact, and scan failures without replacing them with an empty success', async () => {
  provider();
  const { ctx, call } = context();
  mocks.resolve.mockRejectedValue(new Error('Malformed config'));
  expect((await listNativeCapabilities(ctx)).diagnostics.join(' ')).toContain('Malformed config');
  expect(call).toHaveBeenCalled();
  ctx.pluginHostArtifacts.delete('test-provider');
  expect((await listNativeCapabilities(ctx)).diagnostics.join(' ')).toContain('unavailable');
  call.mockRejectedValue(new Error('Offline'));
  expect((await listNativeCapabilities(ctx)).diagnostics.join(' ')).toContain('Offline');
});
it('fresh listings observe changed provider config and ignore providers without native roots', async () => {
  provider('custom');
  provider('empty', {
    experimental_nativeSkillRoots: undefined,
    experimental_resolvesNativeRoots: false
  });
  const { ctx } = context();
  await listNativeCapabilities(ctx, { providerId: 'custom' });
  await listNativeCapabilities(ctx, { providerId: 'custom' });
  expect(mocks.resolve).toHaveBeenCalledTimes(2);
  expect((await listNativeCapabilities(ctx, { providerId: 'empty' })).skills).toEqual([]);
});

it('honors execution-host overrides remotely without consulting server settings', async () => {
  provider();
  const { ctx, call } = context('remote');
  mocks.resolve.mockResolvedValue({
    skills: [],
    commands: [],
    disabledSkillNames: ['disabled', 'plug:check']
  });
  call.mockResolvedValue({
    commands: [
      row('disabled'),
      row('allowed'),
      row('plug:check', { namePrefix: 'plug:' }),
      row('disabled', { source: 'command' })
    ]
  });
  const result = await listNativeCapabilities(ctx, { projectId: 'p' });
  expect(result.commands.map((row) => row.name)).toEqual(['/allowed', '/disabled']);
  expect(result.skills[0]).toMatchObject({
    enabled: false,
    toggle: { enabled: false, supported: false }
  });
  expect(result.skills.find((row) => row.name === 'check')?.enabled).toBe(false);
  expect(mocks.disabled).not.toHaveBeenCalled();
  expect(call.mock.calls[0][0].command.nativeRoots.resolved).toEqual({ skills: [], commands: [] });
});

it('reports tri-state load policy for settings-backed skills and appends ZCC-injected rows', async () => {
  provider();
  const { ctx, call } = context();
  ctx.dataDir = '/zcc-data';
  mocks.manual.add('quiet');
  mocks.disabled.mockResolvedValue(new Set(['gone']));
  mocks.injected.mockReturnValue([{ id: 'zcc:gus/gus-work', name: 'gus-work', allHarnesses: true }]);
  call.mockResolvedValue({
    commands: [row('loud'), row('quiet'), row('gone'), row('pinned', { disableModelInvocation: true })]
  });
  const result = await listNativeCapabilities(ctx, { projectId: 'p' });
  const byName = Object.fromEntries(result.skills.map((skill) => [skill.name, skill]));
  expect(mocks.injected).toHaveBeenCalledWith('/zcc-data', 'local');
  expect(byName['gus-work']).toMatchObject({ allHarnesses: true });
  expect(byName.loud.toggle).toMatchObject({ supported: true, state: 'on', states: ['on', 'manual', 'off'] });
  expect(byName.quiet.toggle).toMatchObject({ state: 'manual', enabled: true });
  expect(byName.gone.toggle).toMatchObject({ state: 'off', enabled: false });
  expect(byName.pinned.toggle).toMatchObject({ state: 'manual', states: ['manual', 'off'] });
  expect(result.commands.map((command) => command.name)).toEqual(['/loud', '/quiet', '/pinned']);
});
