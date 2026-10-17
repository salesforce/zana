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
const { productPluginSpawnRouting } = await import('./plugin-harness-routing.js');

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
