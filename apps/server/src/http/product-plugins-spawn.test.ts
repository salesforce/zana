/**
 * The attached plugin service's `sdk.threads.spawn` bridge: provider
 * resolution (explicit id, `harness: 'project-default'`, legacy fallback) and
 * the permission mode a yolo default implies. Collaborators are mocked so the
 * closure handed to `createPluginService` can be called directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captured: { options?: Record<string, any> } = {};
const createConversationFromRequest = vi.fn(async () => ({ id: 'thread-1' }));
const harnessEffectiveDefault = vi.fn();
const harnessVerifyBundle = vi.fn();
const providers: Array<Record<string, any>> = [
  { id: 'fake', displayName: 'Fake', visibility: 'public', capabilities: { permissionModes: ['auto'] } },
  { id: 'claude-code', displayName: 'Claude Code', visibility: 'public', capabilities: { permissionModes: ['auto', 'full'], supportsServiceTier: false } },
  { id: 'codex', displayName: 'Codex', visibility: 'public', capabilities: { permissionModes: ['auto', 'accept-edits', 'full'], supportsServiceTier: false } }
];
const harnessVerify = vi.fn(async (): Promise<Array<{ family: string; installed: boolean; enabled: boolean }>> => []);
const primaryHost = vi.hoisted(() => ({ id: 'primary-host' }));
vi.mock('@zana-ai/zcc-db', async (original) => ({
  ...await original<typeof import('@zana-ai/zcc-db')>(),
  getPrimaryHost: () => primaryHost
}));

vi.mock('../plugins/plugin-service.js', () => ({
  createPluginService: (options: Record<string, unknown>) => {
    captured.options = options;
    return { stop: () => {} };
  },
  defaultBundledRoot: () => '/bundled',
  toPluginAppSnapshot: () => ({})
}));
vi.mock('../services/threads/conversation-create.js', () => ({ createConversationFromRequest }));
vi.mock('./harness-via-rpc.js', () => ({ harnessEffectiveDefault, harnessVerify, harnessVerifyBundle }));
vi.mock('../services/threads/thread-provider-catalog.js', () => ({
  listThreadProviders: () => providers,
  getThreadProvider: (id: string) => providers.find((row) => row.id === id),
  bridgeLaunchForProvider: () => null
}));
vi.mock('../services/interactions/interaction-service.js', () => ({ InteractionService: class {} }));
vi.mock('../services/interactions/interaction-maintenance.js', () => ({ startInteractionMaintenance: () => () => {} }));

const { createAttachedProductPluginService } = await import('./product-plugins.js');
const { ThreadCreateError } = await import('./thread-create.js');

interface PluginOverrides {
  global?: Record<string, unknown>;
  /** Keyed `${projectId}/${pluginId}`. */
  project?: Record<string, unknown>;
}

function attach(
  projectSettings: Record<string, unknown> = {},
  acpModes: Array<{ value: string; name: string }> = [],
  overrides: PluginOverrides = {}
) {
  const ctx = {
    db: {},
    dataDir: '/tmp/zcc-spawn-test-missing',
    hostHub: { resolveHostId: (id?: string) => id ?? 'local' },
    modelCatalogs: { read: async () => ({ acpMode: { options: acpModes } }) },
    config: {
      getConfig: () => ({}),
      getPluginHarnessRouting: (pluginId: string) => overrides.global?.[pluginId] ?? null
    },
    toProjects: () => [{ id: 'p1', name: 'App', hostId: 'host-a' }, { id: 'home', name: 'Home', quickAgent: true }],
    projectSettings: {
      get: () => projectSettings,
      getPluginHarnessRouting: (id: string, pluginId: string) => overrides.project?.[`${id}/${pluginId}`] ?? null
    },
    pendingInteractions: {}
  };
  createAttachedProductPluginService(ctx as never, { bundledRoot: '/bundled' });
  return captured.options! as { spawnThread(args: Record<string, unknown>): Promise<{ id: string }>; listProviders(args: { environmentId?: string }): Promise<unknown[]> };
}

const lastRequest = () => (createConversationFromRequest.mock.calls.at(-1) as unknown as [unknown, Record<string, unknown>])[1];

describe('attached plugin service: threads.spawn provider resolution', () => {
  beforeEach(() => {
    createConversationFromRequest.mockClear();
    harnessEffectiveDefault.mockReset();
    harnessVerifyBundle.mockReset();
  });
  afterEach(() => {
    captured.options = undefined;
  });

  it('spawns on the project default harness and applies a yolo profile as full permission', async () => {
    harnessEffectiveDefault.mockResolvedValue({ ok: true, family: 'claude', profile: 'claude-yolo', source: 'project-default' });
    const service = attach();
    await expect(service.spawnThread({ projectId: 'p1', prompt: 'go', harness: 'project-default' })).resolves.toEqual({ id: 'thread-1' });
    expect(harnessEffectiveDefault).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'host-a', project: expect.objectContaining({ id: 'p1' }) }));
    expect(lastRequest()).toMatchObject({ projectId: 'p1', providerId: 'claude-code', permissionMode: 'full' });

    // An explicit permission mode from the plugin still wins over the profile's.
    await service.spawnThread({ projectId: 'p1', prompt: 'go', harness: 'project-default', permissionMode: 'auto' });
    expect(lastRequest()).toMatchObject({ providerId: 'claude-code', permissionMode: 'auto' });
  });

  it('never falls back to the first provider when the project default is unusable', async () => {
    harnessEffectiveDefault.mockResolvedValue({ ok: false, code: 'UNAVAILABLE_DEFAULT', message: 'Default harness unavailable' });
    const service = attach();
    await expect(service.spawnThread({ projectId: 'p1', prompt: 'go', harness: 'project-default' })).rejects.toThrow(
      'No usable AI harness: Default harness unavailable. Choose an installed, enabled harness in Settings → AI Harness.'
    );
    expect(createConversationFromRequest).not.toHaveBeenCalled();
  });

  it('uses the primary host for an unbound local project with multiple connected machines', async () => {
    harnessEffectiveDefault.mockResolvedValue({ ok: true, family: 'codex', profile: 'codex', source: 'project-default' });
    const service = attach();
    await service.spawnThread({ projectId: 'home', prompt: 'Review', harness: 'project-default' });
    expect(harnessEffectiveDefault).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'primary-host' }));
    expect(lastRequest()).toMatchObject({ hostId: 'primary-host', providerId: 'codex' });
    await service.spawnThread({ projectId: 'home', hostId: 'explicit', prompt: 'Review', harness: 'project-default' });
    expect(harnessEffectiveDefault).toHaveBeenLastCalledWith(expect.objectContaining({ hostId: 'explicit' }));
    expect(lastRequest()).toMatchObject({ hostId: 'explicit' });
  });

  it('keeps explicit and legacy resolution without consulting the harness default', async () => {
    const service = attach();
    await service.spawnThread({ projectId: 'p1', prompt: 'go', providerId: 'claude-code', hostId: 'host-b' });
    expect(lastRequest()).toMatchObject({ providerId: 'claude-code', hostId: 'host-b' });
    expect(lastRequest()).not.toHaveProperty('permissionMode');
    await service.spawnThread({ projectId: 'p1', prompt: 'go' });
    expect(lastRequest()).toMatchObject({ providerId: 'fake' });
    await expect(service.spawnThread({ projectId: 'p1', prompt: 'go', providerId: 'nope' })).rejects.toThrow('unknown thread provider: nope');
    expect(harnessEffectiveDefault).not.toHaveBeenCalled();
  });

  it('reports provider availability from the host probe', async () => {
    harnessVerifyBundle.mockResolvedValue({
      availability: [{ family: 'claude', label: 'Claude', binary: 'claude', enabled: true, installed: false, installHint: '' }],
      extraInstalled: {}
    });
    const service = attach();
    await expect(service.listProviders({})).resolves.toEqual([
      expect.objectContaining({ id: 'fake', available: true }),
      expect.objectContaining({ id: 'claude-code', available: false }),
      expect.objectContaining({ id: 'codex', available: true })
    ]);
  });

  describe('AI harness overrides on an inheriting spawn', () => {
    const modelOverride = { harnessRouting: { schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'sonnet' } } } };
    beforeEach(() => {
      harnessEffectiveDefault.mockResolvedValue({ ok: true, family: 'claude', profile: 'claude', source: 'project-default' });
    });
    afterEach(() => {
      createConversationFromRequest.mockImplementation(async () => ({ id: 'thread-1' }));
    });

    it('applies the project model override, but an explicit model wins', async () => {
      const service = attach(modelOverride);
      await service.spawnThread({ projectId: 'p1', prompt: 'go', harness: 'project-default' });
      expect(lastRequest()).toMatchObject({ providerId: 'claude-code', model: 'sonnet' });
      await service.spawnThread({ projectId: 'p1', prompt: 'go', harness: 'project-default', model: 'opus' });
      expect(lastRequest()).toMatchObject({ model: 'opus' });
    });

    it('names the override when the thread catalog rejects its model', async () => {
      createConversationFromRequest.mockRejectedValue(new ThreadCreateError(400, 'invalid-model', 'Unknown model sonnet.'));
      const service = attach(modelOverride);
      await expect(service.spawnThread({ projectId: 'p1', prompt: 'go', harness: 'project-default' })).rejects.toThrow(
        'Unknown model sonnet. (from the project AI harness override). Change it in Settings → AI Harness.'
      );
    });

    it('passes other create failures, and rejections of an explicit model, through unchanged', async () => {
      const service = attach(modelOverride);
      createConversationFromRequest.mockRejectedValue(new ThreadCreateError(400, 'invalid-model', 'Unknown model opus.'));
      await expect(service.spawnThread({ projectId: 'p1', prompt: 'go', harness: 'project-default', model: 'opus' }))
        .rejects.toThrow(/^Unknown model opus\.$/);
      createConversationFromRequest.mockRejectedValue(new ThreadCreateError(404, 'project-not-found', 'Project missing.'));
      await expect(service.spawnThread({ projectId: 'p1', prompt: 'go', harness: 'project-default' }))
        .rejects.toThrow(/^Project missing\.$/);
      const plain = attach();
      createConversationFromRequest.mockRejectedValue(new ThreadCreateError(400, 'invalid-model', 'Unknown model x.'));
      await expect(plain.spawnThread({ projectId: 'p1', prompt: 'go', harness: 'project-default' }))
        .rejects.toThrow(/^Unknown model x\.$/);
    });

    it('a plugin override replaces the inherited project override; explicit args still win', async () => {
      const plugin = { schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'opus' } } };
      const service = attach(modelOverride, [], { project: { 'home/plug': plugin } });
      await service.spawnThread({ pluginId: 'plug', projectId: 'p1', prompt: 'go', harness: 'project-default' });
      expect(lastRequest()).toMatchObject({ model: 'opus' });
      await service.spawnThread({ pluginId: 'plug', projectId: 'p1', prompt: 'go', harness: 'project-default', model: 'haiku' });
      expect(lastRequest()).toMatchObject({ model: 'haiku' });
      // Another plugin's override is never applied.
      await service.spawnThread({ pluginId: 'other', projectId: 'p1', prompt: 'go', harness: 'project-default' });
      expect(lastRequest()).toMatchObject({ model: 'sonnet' });
    });

    describe("the plugin's own harness choice", () => {
      const runsOn = (family: string, byAdapter: Record<string, unknown> = {}) => ({ schemaVersion: 1, byAdapter, defaultHarness: family });
      beforeEach(() => {
        harnessVerify.mockReset();
        harnessVerify.mockResolvedValue([
          { family: 'claude', installed: true, enabled: true },
          { family: 'codex', installed: true, enabled: true }
        ]);
      });

      it('spawns on the chosen harness, not the project default, with that harness row applied', async () => {
        const service = attach(modelOverride, [], {
          global: { plug: runsOn('codex', { codex: { modelTargetId: 'gpt-5.4' } }) }
        });
        await service.spawnThread({ pluginId: 'plug', projectId: 'p1', prompt: 'go', harness: 'project-default' });
        expect(lastRequest()).toMatchObject({ providerId: 'codex', model: 'gpt-5.4' });
        expect(harnessEffectiveDefault).not.toHaveBeenCalled();
        expect(harnessVerify).toHaveBeenCalledWith(expect.anything(), 'host-a');
        // Other plugins keep running on the project default harness.
        await service.spawnThread({ pluginId: 'other', projectId: 'p1', prompt: 'go', harness: 'project-default' });
        expect(lastRequest()).toMatchObject({ providerId: 'claude-code', model: 'sonnet' });
      });

      it("a project's choice wins over the plugin Default", async () => {
        const service = attach({}, [], {
          global: { plug: runsOn('codex') },
          project: { 'p1/plug': runsOn('claude') }
        });
        await service.spawnThread({ pluginId: 'plug', projectId: 'p1', prompt: 'go', harness: 'project-default' });
        expect(lastRequest()).toMatchObject({ providerId: 'claude-code' });
        // A doc without a project skips the project tier and runs on the Default choice.
        await service.spawnThread({ pluginId: 'plug', projectId: 'home', prompt: 'go', harness: 'project-default' });
        expect(lastRequest()).toMatchObject({ providerId: 'codex' });
        expect(harnessEffectiveDefault).not.toHaveBeenCalled();
      });

      it('fails closed when the chosen harness is not installed, never falling back to the project default', async () => {
        harnessVerify.mockResolvedValue([{ family: 'codex', installed: false, enabled: true }]);
        const service = attach({}, [], { global: { plug: runsOn('codex') } });
        await expect(service.spawnThread({ pluginId: 'plug', projectId: 'p1', prompt: 'go', harness: 'project-default' }))
          .rejects.toThrow("this plugin's harness (codex) is disabled or unavailable");
        expect(createConversationFromRequest).not.toHaveBeenCalled();
        expect(harnessEffectiveDefault).not.toHaveBeenCalled();
      });
    });

    it('points a rejected plugin-override model at the plugin settings', async () => {
      const plugin = { schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'opus' } } };
      createConversationFromRequest.mockRejectedValue(new ThreadCreateError(400, 'invalid-model', 'Unknown model opus.'));
      const service = attach({}, [], { global: { plug: plugin } });
      await expect(service.spawnThread({ pluginId: 'plug', projectId: 'p1', prompt: 'go', harness: 'project-default' })).rejects.toThrow(
        "Unknown model opus. (from the plugin AI harness override). Change it in this plugin's AI Harness settings."
      );
    });

    it('applies a plan execution state as the native plan session mode, else as /plan', async () => {
      const plan = { harnessRouting: { schemaVersion: 1, byAdapter: { claude: { executionState: 'plan' } } } };
      await attach(plan, [{ value: 'planning', name: 'Plan' }]).spawnThread({ projectId: 'p1', prompt: 'go', harness: 'project-default' });
      expect(lastRequest()).toMatchObject({ acpMode: 'planning', input: ['go'] });

      providers[1]!.composerActions = ['plan'];
      try {
        await attach(plan).spawnThread({ projectId: 'p1', prompt: 'go', harness: 'project-default' });
      } finally {
        delete providers[1]!.composerActions;
      }
      expect(lastRequest()).not.toHaveProperty('acpMode');
      expect((lastRequest().input as string[])[0]).toMatch(/^\/plan\b/);
    });
  });
});
