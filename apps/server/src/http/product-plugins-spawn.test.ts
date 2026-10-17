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
  { id: 'claude-code', displayName: 'Claude Code', visibility: 'public', capabilities: { permissionModes: ['auto', 'full'], supportsServiceTier: false } }
];

vi.mock('../plugins/plugin-service.js', () => ({
  createPluginService: (options: Record<string, unknown>) => {
    captured.options = options;
    return { stop: () => {} };
  },
  defaultBundledRoot: () => '/bundled',
  toPluginAppSnapshot: () => ({})
}));
vi.mock('../services/threads/conversation-create.js', () => ({ createConversationFromRequest }));
vi.mock('./harness-via-rpc.js', () => ({ harnessEffectiveDefault, harnessVerifyBundle }));
vi.mock('../services/threads/thread-provider-catalog.js', () => ({
  listThreadProviders: () => providers,
  getThreadProvider: (id: string) => providers.find((row) => row.id === id),
  bridgeLaunchForProvider: () => null
}));
vi.mock('../services/interactions/interaction-service.js', () => ({ InteractionService: class {} }));
vi.mock('../services/interactions/interaction-maintenance.js', () => ({ startInteractionMaintenance: () => () => {} }));

const { createAttachedProductPluginService } = await import('./product-plugins.js');
const { ThreadCreateError } = await import('./thread-create.js');

function attach(projectSettings: Record<string, unknown> = {}, acpModes: Array<{ value: string; name: string }> = []) {
  const ctx = {
    db: {},
    dataDir: '/tmp/zcc-spawn-test-missing',
    hostHub: { resolveHostId: (id?: string) => id ?? 'local' },
    modelCatalogs: { read: async () => ({ acpMode: { options: acpModes } }) },
    config: { getConfig: () => ({}) },
    toProjects: () => [{ id: 'p1', name: 'App', hostId: 'host-a' }],
    projectSettings: { get: () => projectSettings },
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
      expect.objectContaining({ id: 'claude-code', available: false })
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
