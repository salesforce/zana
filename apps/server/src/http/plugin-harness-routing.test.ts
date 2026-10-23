import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HarnessFamily, HarnessModelRoutingV1 } from '@zana-ai/zcc-domain/product';
import type { LaunchProvider } from '@zana-ai/zcc-host-daemon/harness/launch-provider';

const threadProviders = new Map<string, Record<string, unknown>>();
const bridgeLaunchForProvider = vi.fn((providerId: string) => ({ bridge: providerId }));

vi.mock('../services/threads/thread-provider-catalog.js', () => ({
  getThreadProvider: (id: string) => threadProviders.get(id),
  bridgeLaunchForProvider
}));
const { providerForFamily } = await import('@zana-ai/zcc-host-daemon/harness/registry');
const harnessDescriptors = vi.fn(async (_hub: unknown, hostId?: string) => [{ id: 'codex', hostId }]);
const harnessVerify = vi.fn(async (_hub: unknown, _hostId?: string): Promise<Array<{ family: string; installed: boolean; enabled: boolean }>> => []);
vi.mock('./harness-via-rpc.js', () => ({ harnessDescriptors, harnessVerify }));
const validateProviderModelSelection = vi.fn(async (_ctx: unknown, _input: Record<string, unknown>) => undefined);
vi.mock('../services/threads/provider-model-validation.js', () => ({ validateProviderModelSelection }));
const { ThreadCreateError } = await import('./thread-create.js');
const {
  checkPluginHarnessRouting,
  pluginDefaultHarness,
  pluginEffectiveHarnessDefault,
  pluginHarnessDescriptors,
  pluginOverrideRow,
  productPluginSpawnRouting,
  readPluginHarnessRouting,
  writePluginHarnessRouting
} = await import('./plugin-harness-routing.js');

const HINT = 'Change it in Settings → AI Harness.';

function threadProvider(id: string, extra: Record<string, unknown> = {}) {
  threadProviders.set(id, {
    id,
    displayName: `${id} thread`,
    pluginId: `provider-${id}`,
    hostEntry: null,
    capabilities: { permissionModes: ['accept-edits', 'auto', 'full'] },
    ...extra
  });
}

function routing(family: string, entry: Record<string, unknown>): HarnessModelRoutingV1 {
  return { schemaVersion: 1, byAdapter: { [family]: entry } } as HarnessModelRoutingV1;
}

interface CtxOptions {
  projects?: Array<Record<string, unknown>>;
  settings?: Record<string, unknown>;
  config?: Record<string, unknown>;
  acpOptions?: Array<{ value: string; name?: string }>;
}

function makeCtx(options: CtxOptions = {}) {
  const projectSettingsGet = vi.fn(() => options.settings ?? {});
  const modelCatalogsRead = vi.fn(async () => (options.acpOptions ? { acpMode: { options: options.acpOptions } } : {}));
  const resolveHostId = vi.fn((hostId?: string) => hostId ?? 'local-host');
  const ctx = {
    toProjects: () => options.projects ?? [],
    projectSettings: { get: projectSettingsGet },
    config: { getConfig: () => options.config ?? {} },
    hostHub: { resolveHostId },
    modelCatalogs: { read: modelCatalogsRead },
    pluginHostArtifacts: { artifacts: true }
  };
  return { ctx: ctx as never, projectSettingsGet, modelCatalogsRead, resolveHostId };
}

beforeEach(() => {
  threadProviders.clear();
  bridgeLaunchForProvider.mockClear();
  validateProviderModelSelection.mockReset();
  harnessVerify.mockReset();
  harnessVerify.mockResolvedValue([]);
});

describe('productPluginSpawnRouting', () => {
  it('returns null unless the spawn inherits the project harness', async () => {
    const { ctx, projectSettingsGet } = makeCtx({ projects: [{ id: 'p1' }], settings: { harnessRouting: routing('codex', { modelTargetId: 'gpt-5.4' }) } });
    await expect(productPluginSpawnRouting(ctx, { projectId: 'p1', providerId: 'codex' })).resolves.toBeNull();
    expect(projectSettingsGet).not.toHaveBeenCalled();
  });

  it('layers project settings (read via ctx.projectSettings.get) over global config', async () => {
    threadProvider('codex', { displayName: 'Codex Thread' });
    const { ctx, projectSettingsGet } = makeCtx({
      projects: [{ id: 'p1', path: '/repo' }],
      config: { harnessRouting: routing('codex', { modelTargetId: 'gpt-5.4-mini' }) },
      settings: { harnessRouting: routing('codex', { modelTargetId: 'gpt-5.4' }) }
    });
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', providerId: 'codex', harness: { family: 'codex', profile: 'codex' }
    })).resolves.toEqual({ model: 'gpt-5.4', applied: [{ field: 'model', value: 'gpt-5.4', source: 'project' }] });
    expect(projectSettingsGet).toHaveBeenCalledWith('p1');
  });

  it('uses global config only when the project is unknown', async () => {
    threadProvider('codex');
    const { ctx, projectSettingsGet } = makeCtx({
      config: { harnessRouting: routing('codex', { modelTargetId: 'gpt-5.4-mini' }) },
      settings: { harnessRouting: routing('codex', { modelTargetId: 'gpt-5.4' }) }
    });
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'missing', providerId: 'codex', harness: { family: 'codex', profile: 'codex' }
    })).resolves.toEqual({ model: 'gpt-5.4-mini', applied: [{ field: 'model', value: 'gpt-5.4-mini', source: 'global' }] });
    expect(projectSettingsGet).not.toHaveBeenCalled();
  });

  it('maps an inherited autonomous execution state to full permission', async () => {
    threadProvider('claude-code', { displayName: 'Claude Code' });
    const { ctx } = makeCtx({
      projects: [{ id: 'p1' }],
      settings: { harnessRouting: routing('claude', { executionState: 'autonomous' }) }
    });
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', providerId: 'claude-code', harness: { family: 'claude', profile: 'claude' }
    })).resolves.toEqual({ permissionMode: 'full', applied: [{ field: 'execution', value: 'autonomous', source: 'project' }] });
  });

  it('reads session modes from the project host catalog only when needed (local project)', async () => {
    threadProvider('claude-code', { models: { scope: 'host' } });
    const { ctx, modelCatalogsRead, resolveHostId } = makeCtx({
      projects: [{ id: 'p1', path: '/repo', hostId: 'h-proj' }],
      settings: { executionState: 'plan' },
      acpOptions: [{ value: 'default' }, { value: 'plan', name: 'Plan' }]
    });
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', providerId: 'claude-code', harness: { family: 'claude', profile: 'claude' }
    })).resolves.toEqual({ acpMode: 'plan', applied: [{ field: 'execution', value: 'plan', source: 'project' }] });
    expect(resolveHostId).toHaveBeenCalledWith('h-proj');
    expect(bridgeLaunchForProvider).toHaveBeenCalledWith('claude-code', { artifacts: true });
    expect(modelCatalogsRead).toHaveBeenCalledWith({
      hostId: 'h-proj',
      providerId: 'claude-code',
      scope: 'host',
      bridgeLaunch: { bridge: 'claude-code' },
      cwd: '/repo'
    });
  });

  it('reads session modes for a remote project without cwd, with the explicit host and default scope', async () => {
    threadProvider('claude-code', { composerActions: ['plan'] });
    const { ctx, modelCatalogsRead } = makeCtx({
      projects: [{ id: 'p1', path: '/remote/repo', remote: true, hostId: 'h-proj' }],
      settings: { executionState: 'plan' }
    });
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', hostId: 'h-explicit', providerId: 'claude-code', harness: { family: 'claude', profile: 'claude' }
    })).resolves.toEqual({ slashPlan: true, applied: [{ field: 'execution', value: 'plan', source: 'project' }] });
    expect(modelCatalogsRead).toHaveBeenCalledWith({
      hostId: 'h-explicit', providerId: 'claude-code', scope: 'workspace', bridgeLaunch: { bridge: 'claude-code' }
    });
  });

  it('rejects a plugin-supplied hostId the host hub does not know, before reading any catalog', async () => {
    threadProvider('claude-code');
    const { ctx, modelCatalogsRead, resolveHostId } = makeCtx({
      projects: [{ id: 'p1', path: '/repo', hostId: 'h-proj' }],
      settings: { executionState: 'plan' }
    });
    resolveHostId.mockImplementation((hostId?: string) => {
      if (hostId && hostId !== 'h-proj') throw new Error(`Unknown host: ${hostId}`);
      return hostId ?? 'local-host';
    });
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', hostId: 'h-ghost', providerId: 'claude-code', harness: { family: 'claude', profile: 'claude' }
    })).rejects.toThrow('Unknown host: h-ghost');
    expect(resolveHostId).toHaveBeenCalledWith('h-ghost');
    expect(modelCatalogsRead).not.toHaveBeenCalled();
  });

  it('resolves with remote scope for a remote project', async () => {
    threadProvider('acp-cursor', { displayName: 'Cursor' });
    const { ctx } = makeCtx({
      projects: [{ id: 'p1', remote: true }],
      settings: { harnessRouting: routing('cursor', { modelTargetId: 'auto' }) }
    });
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', providerId: 'acp-cursor', harness: { family: 'cursor', profile: 'cursor' }
    })).rejects.toThrow(`Cursor cannot apply the AI harness override: Cursor model target is unavailable for remote launches. ${HINT}`);
  });

  it('uses no permission modes and the provider id as label when the thread provider is not loaded', async () => {
    const { ctx } = makeCtx();
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', providerId: 'claude-code', harness: { family: 'claude', profile: 'claude-yolo' }
    })).rejects.toThrow(`claude-code cannot apply the AI harness override: the full permission mode is not supported by this thread provider. ${HINT}`);
  });

  it('passes the provider seam through to resolution', async () => {
    threadProvider('codex');
    const real = providerForFamily('codex')!;
    const provider = Object.create(real, {
      validateRoutingCombination: { value: () => 'seam says no' }
    }) as LaunchProvider;
    const { ctx } = makeCtx();
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', providerId: 'codex', harness: { family: 'codex', profile: 'codex' }, provider
    })).rejects.toThrow(`codex thread cannot apply the AI harness override: seam says no. ${HINT}`);
  });
});

describe('plugin-keyed harness overrides', () => {
  const projects = [
    { id: 'p1', path: '/repo', hostId: 'h1' },
    { id: 'home', path: '/home', quickAgent: true },
    { id: 'r1', path: '/remote', remote: true }
  ];

  function overrideCtx(list: Array<Record<string, unknown>> = projects) {
    const global = new Map<string, unknown>();
    const perProject = new Map<string, unknown>();
    const ctx = {
      toProjects: () => list,
      hostHub: { resolveHostId: (hostId?: string) => hostId ?? 'local-host' },
      modelCatalogs: { read: vi.fn(async () => ({})) },
      pluginHostArtifacts: {},
      config: {
        getConfig: () => ({}),
        getPluginHarnessRouting: vi.fn((pluginId: string) => global.get(pluginId) ?? null),
        setPluginHarnessRouting: vi.fn((pluginId: string, value: unknown) => { global.set(pluginId, value); })
      },
      projectSettings: {
        getPluginHarnessRouting: vi.fn((id: string, pluginId: string) => perProject.get(`${id}/${pluginId}`) ?? null),
        setPluginHarnessRouting: vi.fn(async (id: string, pluginId: string, value: unknown) => { perProject.set(`${id}/${pluginId}`, value); })
      }
    };
    return { ctx: ctx as never, raw: ctx, global, perProject };
  }

  it('descriptors use the project host, an explicit host, or the local host', async () => {
    const { ctx } = overrideCtx();
    const hub = (ctx as { hostHub: unknown }).hostHub;
    await pluginHarnessDescriptors(ctx, { projectId: 'p1' });
    expect(harnessDescriptors).toHaveBeenLastCalledWith(hub, 'h1');
    await pluginHarnessDescriptors(ctx, { projectId: 'p1', hostId: 'h2' });
    expect(harnessDescriptors).toHaveBeenLastCalledWith(hub, 'h2');
    await pluginHarnessDescriptors(ctx);
    expect(harnessDescriptors).toHaveBeenLastCalledWith(hub, undefined);
    await expect(pluginHarnessDescriptors(ctx, { projectId: 'nope' })).rejects.toThrow('unknown project');
  });

  it('accepts a valid override and rejects bad shapes, scopes, families and targets', async () => {
    const { ctx } = overrideCtx();
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, routing('codex', { modelTargetId: 'gpt-5.4' }))).resolves.toEqual({ ok: true });
    await expect(checkPluginHarnessRouting(ctx, { kind: 'project', projectId: 'p1' }, routing('codex', {}))).resolves.toEqual({ ok: true });
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, { schemaVersion: 2, byAdapter: {} }))
      .resolves.toMatchObject({ ok: false, reason: expect.stringContaining('invalid harness routing: schemaVersion') });
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, routing('codex', { bogus: 1 })))
      .resolves.toMatchObject({ ok: false, reason: expect.stringContaining('invalid harness routing') });
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, routing('nope', {})))
      .resolves.toMatchObject({ ok: false, reason: expect.stringContaining('invalid harness routing') });
    await expect(checkPluginHarnessRouting(ctx, { kind: 'project', projectId: 'zz' }, routing('codex', {})))
      .resolves.toEqual({ ok: false, reason: 'unknown project' });
    await expect(checkPluginHarnessRouting(ctx, { kind: 'bogus' } as never, routing('codex', {})))
      .resolves.toEqual({ ok: false, reason: 'invalid harness override scope' });
    await expect(checkPluginHarnessRouting(ctx, null as never, routing('codex', {})))
      .resolves.toEqual({ ok: false, reason: 'invalid harness override scope' });
    await expect(checkPluginHarnessRouting(overrideCtx([]).ctx, { kind: 'default-project' }, routing('codex', {})))
      .resolves.toEqual({ ok: false, reason: 'no Default Project is registered' });
  });

  it('runs the launch resolvers so unknown targets are rejected at save time', async () => {
    const { ctx } = overrideCtx();
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, routing('codex', { providerTargetId: 'no-such-provider' })))
      .resolves.toEqual({ ok: false, reason: 'codex: Unknown provider target for Codex.' });
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, routing('codex', { executionTargetId: 'no-such-target' })))
      .resolves.toEqual({ ok: false, reason: 'codex: Unknown execution target for Codex.' });
    const codexTarget = 'codex.execution.plan';
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, routing('codex', { executionTargetId: codexTarget }))).resolves.toEqual({ ok: true });
  });

  it('reports an unregistered family and an adapter combination error', async () => {
    const { ctx } = overrideCtx();
    const codex = providerForFamily('codex')!;
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, routing('codex', {}), () => undefined))
      .resolves.toEqual({ ok: false, reason: 'codex: unknown harness' });
    const combined = { ...codex, adapter: codex.adapter, validateRoutingCombination: () => 'role and state conflict' } as LaunchProvider;
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, routing('codex', {}), () => combined))
      .resolves.toEqual({ ok: false, reason: 'codex: role and state conflict' });
  });

  it('accepts a harness choice with or without rows and rejects one that cannot run plugin agents', async () => {
    const { ctx } = overrideCtx();
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, { schemaVersion: 1, byAdapter: {}, defaultHarness: 'codex' }))
      .resolves.toEqual({ ok: true });
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, { ...routing('codex', { modelTargetId: 'gpt-5.4' }), defaultHarness: 'codex' }))
      .resolves.toEqual({ ok: true });
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, { schemaVersion: 1, byAdapter: {}, defaultHarness: 'nope' }))
      .resolves.toMatchObject({ ok: false, reason: expect.stringContaining('invalid harness routing: defaultHarness') });
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, { schemaVersion: 1, byAdapter: {}, defaultHarness: 'codex' }, () => undefined))
      .resolves.toEqual({ ok: false, reason: 'codex: this harness cannot run plugin agents' });
  });

  it('rejects at save a row the thread provider cannot honor', async () => {
    threadProvider('codex', { displayName: 'Codex Thread', capabilities: { permissionModes: ['accept-edits'] } });
    const { ctx } = overrideCtx();
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, routing('codex', { executionState: 'autonomous' }))).resolves.toEqual({
      ok: false,
      reason: 'codex: Codex Thread cannot apply the AI harness override: the full permission mode is not supported by this thread provider.'
    });
    expect(validateProviderModelSelection).not.toHaveBeenCalled();
  });

  it('checks the resolved model against the thread provider catalog on the scope host', async () => {
    threadProvider('codex', { displayName: 'Codex Thread' });
    const { ctx } = overrideCtx();
    await expect(checkPluginHarnessRouting(ctx, { kind: 'project', projectId: 'p1' }, routing('codex', { modelTargetId: 'gpt-5.4' })))
      .resolves.toEqual({ ok: true });
    expect(validateProviderModelSelection).toHaveBeenLastCalledWith(ctx, { hostId: 'h1', providerId: 'codex', model: 'gpt-5.4', cwd: '/repo' });
    await checkPluginHarnessRouting(ctx, { kind: 'project', projectId: 'r1' }, routing('codex', { modelTargetId: 'gpt-5.4' }));
    expect(validateProviderModelSelection).toHaveBeenLastCalledWith(ctx, { hostId: 'local-host', providerId: 'codex', model: 'gpt-5.4' });

    validateProviderModelSelection.mockRejectedValueOnce(new ThreadCreateError(400, 'invalid-model', 'model is not available for Codex Thread: gpt-5.4'));
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, routing('codex', { modelTargetId: 'gpt-5.4' })))
      .resolves.toEqual({ ok: false, reason: 'codex: model is not available for Codex Thread: gpt-5.4' });
  });

  it('falls back to the launch-resolver check when the catalog cannot be read', async () => {
    threadProvider('codex');
    const { ctx } = overrideCtx();
    validateProviderModelSelection.mockRejectedValueOnce(new Error('host offline'));
    await expect(checkPluginHarnessRouting(ctx, { kind: 'global' }, routing('codex', { modelTargetId: 'gpt-5.4' })))
      .resolves.toEqual({ ok: true });
  });

  it('reads and writes only the bound plugin key in the resolved scope', async () => {
    const { ctx, raw, global, perProject } = overrideCtx();
    const value = routing('codex', { modelTargetId: 'gpt-5.4' });
    await writePluginHarnessRouting(ctx, 'plug-a', { kind: 'global' }, value);
    await writePluginHarnessRouting(ctx, 'plug-a', { kind: 'default-project' }, value);
    await writePluginHarnessRouting(ctx, 'plug-a', { kind: 'project', projectId: 'r1' }, value);
    expect(global.get('plug-a')).toEqual(value);
    expect(perProject.get('home/plug-a')).toEqual(value);
    expect(perProject.get('r1/plug-a')).toEqual(value);
    expect(readPluginHarnessRouting(ctx, 'plug-a', { kind: 'default-project' })).toEqual(value);
    expect(readPluginHarnessRouting(ctx, 'plug-a', { kind: 'global' })).toEqual(value);
    expect(readPluginHarnessRouting(ctx, 'plug-b', { kind: 'project', projectId: 'p1' })).toBeNull();
    await writePluginHarnessRouting(ctx, 'plug-a', { kind: 'global' }, null);
    expect(raw.config.setPluginHarnessRouting).toHaveBeenLastCalledWith('plug-a', null);
  });

  it('write rejects invalid values, unknown scopes and malformed plugin ids without storing', async () => {
    const { ctx, raw } = overrideCtx();
    await expect(writePluginHarnessRouting(ctx, 'plug-a', { kind: 'global' }, routing('codex', { providerTargetId: 'no-such-provider' })))
      .rejects.toThrow('codex: Unknown provider target');
    await expect(writePluginHarnessRouting(ctx, 'plug-a', { kind: 'project', projectId: 'zz' }, null)).rejects.toThrow('unknown project');
    await expect(writePluginHarnessRouting(ctx, '../x', { kind: 'global' }, null)).rejects.toThrow('invalid plugin id');
    expect(() => readPluginHarnessRouting(ctx, '', { kind: 'global' })).toThrow('invalid plugin id');
    expect(raw.config.setPluginHarnessRouting).not.toHaveBeenCalled();
    expect(raw.projectSettings.setPluginHarnessRouting).not.toHaveBeenCalled();
  });
});

describe('plugin override in spawn resolution', () => {
  const projects = [{ id: 'p1', path: '/repo' }, { id: 'home', path: '/home', quickAgent: true }];
  const v = (model: string) => routing('codex', { modelTargetId: model });

  function chainCtx(stored: { global?: unknown; project?: Record<string, unknown> }) {
    return {
      config: { getPluginHarnessRouting: vi.fn(() => stored.global ?? null) },
      projectSettings: { getPluginHarnessRouting: vi.fn((id: string) => stored.project?.[id] ?? null) }
    } as never;
  }

  const find = (id?: string) => projects.find((row) => row.id === id) as never;
  const row = (model: string) => ({ modelTargetId: model });
  const choice = (family: string, value: Partial<HarnessModelRoutingV1> = {}) => ({ schemaVersion: 1, byAdapter: {}, ...value, defaultHarness: family });

  it('walks Project → Default Project → Global for a project spawn', () => {
    const rowOf = (stored: Parameters<typeof chainCtx>[0]) => pluginOverrideRow(chainCtx(stored), 'plug', find('p1'), projects as never, 'codex');
    expect(rowOf({ global: v('g'), project: { p1: v('p'), home: v('d') } })).toEqual(row('p'));
    expect(rowOf({ global: v('g'), project: { home: v('d') } })).toEqual(row('d'));
    expect(rowOf({ global: v('g') })).toEqual(row('g'));
    expect(rowOf({})).toBeUndefined();
  });

  it('skips the project scope for a doc-less spawn (Default Project or unknown project)', () => {
    const ctx = chainCtx({ global: v('g'), project: { p1: v('p'), home: v('d') } });
    expect(pluginOverrideRow(ctx, 'plug', projects[1] as never, projects as never, 'codex')).toEqual(row('d'));
    expect(pluginOverrideRow(ctx, 'plug', undefined, projects as never, 'codex')).toEqual(row('d'));
    expect(pluginOverrideRow(chainCtx({ global: v('g'), project: { p1: v('p') } }), 'plug', undefined, [] as never, 'codex')).toEqual(row('g'));
  });

  it('resolves each family from the narrowest scope that has a row for it', () => {
    const ctx = chainCtx({
      global: { schemaVersion: 1, byAdapter: { codex: row('g'), claude: row('opus') } },
      project: { p1: routing('claude', { modelTargetId: 'sonnet' }) }
    });
    expect(pluginOverrideRow(ctx, 'plug', find('p1'), projects as never, 'claude')).toEqual(row('sonnet'));
    expect(pluginOverrideRow(ctx, 'plug', find('p1'), projects as never, 'codex')).toEqual(row('g'));
    expect(pluginOverrideRow(ctx, 'plug', find('p1'), projects as never, 'cursor')).toBeUndefined();
  });

  it('takes the harness choice from the narrowest scope that sets one, independent of rows', () => {
    const ctx = chainCtx({ global: choice('claude'), project: { p1: v('p'), home: choice('codex') } });
    expect(pluginDefaultHarness(ctx, 'plug', find('p1'), projects as never)).toBe('codex');
    expect(pluginDefaultHarness(chainCtx({ global: choice('claude'), project: { p1: choice('cursor') } }), 'plug', find('p1'), projects as never)).toBe('cursor');
    expect(pluginDefaultHarness(chainCtx({ global: choice('claude'), project: { p1: choice('cursor') } }), 'plug', undefined, projects as never)).toBe('claude');
    expect(pluginDefaultHarness(chainCtx({ global: v('g') }), 'plug', find('p1'), projects as never)).toBeUndefined();
  });

  describe('pluginEffectiveHarnessDefault', () => {
    const projectDefault = { ok: true, family: 'claude', profile: 'claude', source: 'project' } as const;

    function defaultCtx(stored: Parameters<typeof chainCtx>[0]) {
      return {
        ...(chainCtx(stored) as object),
        toProjects: () => [{ id: 'p1', path: '/repo', hostId: 'h1' }, { id: 'home', path: '/home', quickAgent: true }],
        hostHub: { hub: true }
      } as never;
    }

    it('uses the fallback when the plugin chose no harness', async () => {
      const fallback = vi.fn(async () => projectDefault);
      await expect(pluginEffectiveHarnessDefault(defaultCtx({ global: v('g') }), { pluginId: 'plug', projectId: 'p1' }, fallback))
        .resolves.toBe(projectDefault);
      expect(harnessVerify).not.toHaveBeenCalled();
    });

    it('runs on the chosen harness when it is installed and enabled on the project host', async () => {
      harnessVerify.mockResolvedValue([{ family: 'codex', installed: true, enabled: true }]);
      const fallback = vi.fn(async () => projectDefault);
      const codex = providerForFamily('codex')!;
      await expect(pluginEffectiveHarnessDefault(defaultCtx({ global: choice('claude'), project: { p1: choice('codex') } }), { pluginId: 'plug', projectId: 'p1' }, fallback))
        .resolves.toEqual({ ok: true, family: 'codex', profile: codex.adapter.descriptor.defaultProfileId ?? 'codex', source: 'plugin-override' });
      expect(harnessVerify).toHaveBeenLastCalledWith({ hub: true }, 'h1');
      expect(fallback).not.toHaveBeenCalled();
      await pluginEffectiveHarnessDefault(defaultCtx({ global: choice('codex') }), { pluginId: 'plug', projectId: 'p1', hostId: 'h2' }, fallback);
      expect(harnessVerify).toHaveBeenLastCalledWith({ hub: true }, 'h2');
    });

    it('falls back to the family id as profile when the adapter names no default profile', async () => {
      harnessVerify.mockResolvedValue([{ family: 'codex', installed: true, enabled: true }]);
      const codex = providerForFamily('codex')!;
      const bare = { ...codex, adapter: { ...codex.adapter, descriptor: { ...codex.adapter.descriptor, defaultProfileId: undefined } } } as LaunchProvider;
      await expect(pluginEffectiveHarnessDefault(defaultCtx({ global: choice('codex') }), { pluginId: 'plug', projectId: 'p1' }, vi.fn(), () => bare))
        .resolves.toMatchObject({ ok: true, profile: 'codex' });
    });

    it('fails closed when the chosen harness is unregistered, missing or disabled', async () => {
      const fallback = vi.fn(async () => projectDefault);
      await expect(pluginEffectiveHarnessDefault(defaultCtx({ global: choice('codex') }), { pluginId: 'plug', projectId: 'p1' }, fallback, () => undefined))
        .resolves.toEqual({ ok: false, code: 'UNAVAILABLE_DEFAULT', message: "this plugin's harness (codex) is not registered" });
      await expect(pluginEffectiveHarnessDefault(defaultCtx({ global: choice('codex') }), { pluginId: 'plug', projectId: 'p1' }, fallback))
        .resolves.toEqual({ ok: false, code: 'UNAVAILABLE_DEFAULT', message: "this plugin's harness (codex) is disabled or unavailable" });
      harnessVerify.mockResolvedValue([{ family: 'codex', installed: true, enabled: false }]);
      await expect(pluginEffectiveHarnessDefault(defaultCtx({ global: choice('codex') }), { pluginId: 'plug', projectId: 'missing' }, fallback))
        .resolves.toMatchObject({ ok: false, message: "this plugin's harness (codex) is disabled or unavailable" });
      expect(harnessVerify).toHaveBeenLastCalledWith({ hub: true }, undefined);
      expect(fallback).not.toHaveBeenCalled();
    });
  });

  function spawnCtx(stored: { global?: unknown; project?: Record<string, unknown> }, settings: Record<string, unknown> = {}, config: Record<string, unknown> = {}) {
    const { ctx } = makeCtx({ projects, settings, config });
    const raw = ctx as unknown as Record<string, Record<string, unknown>>;
    raw.config!.getPluginHarnessRouting = () => stored.global ?? null;
    raw.projectSettings!.getPluginHarnessRouting = (id: string) => stored.project?.[id] ?? null;
    return ctx;
  }

  it('applies the plugin row as a whole value over inherited settings, labelled plugin', async () => {
    threadProvider('codex');
    const ctx = spawnCtx(
      { global: routing('codex', { modelTargetId: 'gpt-5.4-mini' }) },
      { harnessRouting: routing('codex', { modelTargetId: 'gpt-5.4', executionState: 'accept-edits' }) }
    );
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', providerId: 'codex', pluginId: 'plug', harness: { family: 'codex', profile: 'codex' }
    })).resolves.toEqual({ model: 'gpt-5.4-mini', applied: [{ field: 'model', value: 'gpt-5.4-mini', source: 'plugin' }] });
  });

  it('falls back to inherited settings when the plugin has no row for the family', async () => {
    threadProvider('codex');
    const ctx = spawnCtx(
      { global: routing('claude', { modelTargetId: 'opus' }) },
      { harnessRouting: routing('codex', { modelTargetId: 'gpt-5.4' }) }
    );
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', providerId: 'codex', pluginId: 'plug', harness: { family: 'codex', profile: 'codex' }
    })).resolves.toEqual({ model: 'gpt-5.4', applied: [{ field: 'model', value: 'gpt-5.4', source: 'project' }] });
  });

  it('applies a wider-scope row for a family the narrower scope does not set', async () => {
    threadProvider('codex');
    const ctx = spawnCtx(
      { global: routing('codex', { modelTargetId: 'gpt-5.4-mini' }), project: { p1: routing('claude', { modelTargetId: 'opus' }) } },
      { harnessRouting: routing('codex', { modelTargetId: 'gpt-5.4' }) }
    );
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', providerId: 'codex', pluginId: 'plug', harness: { family: 'codex', profile: 'codex' }
    })).resolves.toEqual({ model: 'gpt-5.4-mini', applied: [{ field: 'model', value: 'gpt-5.4-mini', source: 'plugin' }] });
  });

  it('points an unusable plugin row at the plugin settings', async () => {
    threadProvider('codex');
    const ctx = spawnCtx({ project: { home: routing('codex', { providerTargetId: 'nope' }) } });
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', providerId: 'codex', pluginId: 'plug', harness: { family: 'codex', profile: 'codex' }
    })).rejects.toThrow(/Unknown provider target for Codex\. Change it in this plugin's AI Harness settings\.$/);
  });

  it('rethrows non-harness failures from a plugin row unchanged', async () => {
    threadProvider('codex');
    const ctx = spawnCtx({ global: routing('codex', { executionState: 'plan' }) });
    const raw = ctx as unknown as { modelCatalogs: { read: () => Promise<never> } };
    raw.modelCatalogs.read = async () => { throw new Error('catalog down'); };
    await expect(productPluginSpawnRouting(ctx, {
      projectId: 'p1', providerId: 'codex', pluginId: 'plug', harness: { family: 'codex', profile: 'codex' }
    })).rejects.toThrow(/^catalog down$/);
  });
});
