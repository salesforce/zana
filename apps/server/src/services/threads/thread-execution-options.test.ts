import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HarnessVerifyResult } from '@zana-ai/zcc-domain/product';
import {
  buildThreadExecutionOptions,
  classifyModelListError,
  modelListErrorDetail,
  overlayCustomModels,
  isThreadProviderOffered,
  modelsForThreadProvider,
  pluginHostModelCatalog,
  resolvePluginDefaultExecutionOptions,
  selectedOnlyModelsForThreadProvider,
  threadProviderFamily
} from './thread-execution-options.js';
import type { PluginProviderHandle } from '@zana-ai/zcc-plugin-sdk/server';
import { registerThreadProvider } from './thread-provider-catalog.js';

// Providers are no longer statically seeded in the catalog; plugins register
// them at boot. Register the bundled providers the assertions rely on so the
// catalog matches a booted app.
const BUNDLED_PROVIDERS = [
  {
    pluginId: 'provider-claude-code',
    declaration: {
      id: 'claude-code',
      displayName: 'Claude Code',
      capabilities: {
        supportsServiceTier: false,
        supportsNativeUserQuestion: true,
        fork: 'checkpoint',
        supportsManualCompaction: true,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        supportsWorkflows: true,
        permissionModes: ['accept-edits', 'auto', 'full'],
        reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'ultracode', 'max']
      },
      composerActions: ['plan']
    }
  },
  {
    pluginId: 'provider-codex',
    declaration: {
      id: 'codex',
      displayName: 'Codex',
      capabilities: {
        supportsServiceTier: true,
        fork: 'checkpoint',
        supportsManualCompaction: true,
        supportsThreadArchive: true,
        supportsThreadRename: true,
        permissionModes: ['accept-edits', 'auto', 'full'],
        reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
      },
      composerActions: ['plan', 'goal']
    }
  },
  {
    pluginId: 'provider-pi',
    declaration: {
      id: 'pi',
      displayName: 'Pi',
      capabilities: {
        supportsServiceTier: false,
        fork: 'checkpoint',
        supportsManualCompaction: true,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['full'],
        reasoningLevels: ['none', 'low', 'medium', 'high', 'xhigh', 'max']
      },
      composerActions: []
    }
  },
  {
    pluginId: 'provider-acp',
    declaration: {
      id: 'acp-cursor',
      displayName: 'Cursor',
      capabilities: {
        supportsServiceTier: true,
        fork: 'tip',
        supportsManualCompaction: false,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['accept-edits', 'full'],
        reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max']
      },
      composerActions: []
    }
  },
  {
    pluginId: 'provider-acp',
    declaration: {
      id: 'acp-opencode',
      displayName: 'OpenCode',
      visibility: 'installed' as const,
      capabilities: {
        supportsServiceTier: true,
        fork: 'tip',
        supportsManualCompaction: true,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['accept-edits', 'full'],
        reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max']
      },
      composerActions: []
    }
  },
  {
    pluginId: 'provider-acp',
    declaration: {
      id: 'acp-omp',
      displayName: 'OMP',
      visibility: 'installed' as const,
      capabilities: {
        supportsServiceTier: false,
        fork: 'tip',
        supportsManualCompaction: false,
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['accept-edits', 'full']
      },
      composerActions: []
    }
  }
];

let providerHandles: PluginProviderHandle[] = [];

beforeEach(() => {
  providerHandles = BUNDLED_PROVIDERS.map((entry) =>
    registerThreadProvider(entry.pluginId, entry.declaration, 'src/bridge/bridge.ts')
  );
});

afterEach(() => {
  for (const handle of providerHandles) handle.unregister();
  providerHandles = [];
});

function verify(
  family: HarnessVerifyResult['family'],
  overrides: Partial<HarnessVerifyResult> = {}
): HarnessVerifyResult {
  return {
    family,
    label: family,
    binary: family,
    enabled: true,
    alwaysEnabled: family === 'claude',
    installed: true,
    installHint: '',
    ...overrides
  };
}

describe('threadProviderFamily', () => {
  it('does not substitute another provider catalog for an unknown requested provider', () => {
    const options = buildThreadExecutionOptions({ providerId: 'missing-plugin', availability: [] });
    expect(options.providers.length).toBeGreaterThan(0);
    expect(options.models).toEqual([]);
    expect(options.selectedOnlyModels).toEqual([]);
    expect(options.modelLoadError).toMatchObject({ providerId: 'missing-plugin', code: 'provider_unavailable' });
  });

  it('maps thread ids onto PTY harness families and skips fake', () => {
    expect(threadProviderFamily('claude-code')).toBe('claude');
    expect(threadProviderFamily('acp-cursor')).toBe('cursor');
    expect(threadProviderFamily('acp-opencode')).toBe('opencode');
    expect(threadProviderFamily('acp-grok')).toBe('grok');
    expect(threadProviderFamily('acp-mastracode')).toBe('mastracode');
    expect(threadProviderFamily('codex')).toBe('codex');
    expect(threadProviderFamily('pi')).toBe('pi');
    expect(threadProviderFamily('fake')).toBeNull();
  });
});

describe('isThreadProviderOffered', () => {
  it('hides an uninstalled or Settings-disabled harness and treats a missing probe as installed', () => {
    expect(isThreadProviderOffered({ id: 'codex' }, [verify('codex', { installed: false })])).toBe(false);
    expect(isThreadProviderOffered({ id: 'codex' }, [verify('codex', { enabled: false })])).toBe(false);
    expect(isThreadProviderOffered({ id: 'codex' }, [])).toBe(true);
    expect(isThreadProviderOffered({ id: 'codex' }, [verify('codex')])).toBe(true);
    expect(isThreadProviderOffered({ id: 'acp-opencode', visibility: 'installed' }, [verify('opencode', { installed: false })])).toBe(false);
    expect(isThreadProviderOffered({ id: 'acp-opencode', visibility: 'installed' }, [verify('opencode')])).toBe(true);
    expect(isThreadProviderOffered(
      { id: 'acp-opencode', visibility: 'installed' },
      [verify('opencode')],
      { 'acp-opencode': false }
    )).toBe(true);
    expect(isThreadProviderOffered(
      { id: 'acp-opencode', visibility: 'installed' },
      [verify('opencode', { enabled: false })],
      { 'acp-opencode': true }
    )).toBe(false);
    expect(isThreadProviderOffered(
      { id: 'acp-opencode', visibility: 'installed' },
      [verify('opencode', { installed: false })],
      { 'acp-opencode': true }
    )).toBe(true);
    expect(isThreadProviderOffered(
      { id: 'acp-opencode', visibility: 'installed' },
      [verify('opencode', { installed: false })],
      { 'acp-opencode': false }
    )).toBe(false);
    expect(isThreadProviderOffered({ id: 'acp-omp', visibility: 'installed' }, [])).toBe(false);
    expect(isThreadProviderOffered({ id: 'acp-omp', visibility: 'installed' }, [], { 'acp-omp': false })).toBe(false);
    expect(isThreadProviderOffered({ id: 'acp-omp', visibility: 'installed' }, [], { 'acp-omp': true })).toBe(true);
    expect(isThreadProviderOffered({ id: 'acp-grok', visibility: 'installed' }, [verify('grok')])).toBe(true);
    expect(isThreadProviderOffered({ id: 'acp-grok', visibility: 'installed' }, [verify('grok', { enabled: false })])).toBe(false);
    expect(isThreadProviderOffered({ id: 'acp-grok', visibility: 'installed' }, [], { 'acp-grok': false })).toBe(false);
    expect(isThreadProviderOffered({ id: 'acp-mastracode', visibility: 'installed' }, [verify('mastracode')])).toBe(true);
    expect(isThreadProviderOffered({ id: 'acp-mastracode', visibility: 'installed' }, [verify('mastracode', { enabled: false })])).toBe(false);
    expect(isThreadProviderOffered({ id: 'acp-mastracode', visibility: 'installed' }, [], { 'acp-mastracode': false })).toBe(false);
    expect(isThreadProviderOffered({ id: 'fake' }, [verify('codex', { installed: false })])).toBe(true);
  });
});

describe('buildThreadExecutionOptions', () => {
  it('omits Codex from provider tabs when the CLI is not installed', () => {
    const body = buildThreadExecutionOptions({
      availability: [
        verify('claude'),
        verify('codex', { installed: false }),
        verify('pi'),
        verify('cursor')
      ]
    });
    expect(body.providers.map((row) => row.id)).not.toContain('codex');
    expect(body.providers.map((row) => row.id)).toContain('claude-code');
    expect(body.providers.every((row) => row.available)).toBe(true);
    expect(body.providers.find((row) => row.id === 'claude-code')?.composerActions).toEqual(['plan']);
  });

  it('hides installed-only extra ACP agents until their CLI probe succeeds', () => {
    const hidden = buildThreadExecutionOptions({
      availability: [verify('claude'), verify('codex'), verify('pi'), verify('cursor')],
      extraInstalled: { 'acp-omp': false }
    });
    expect(hidden.providers.map((row) => row.id)).not.toContain('acp-omp');
    const shown = buildThreadExecutionOptions({
      availability: [verify('claude'), verify('codex'), verify('pi'), verify('cursor')],
      extraInstalled: { 'acp-omp': true }
    });
    expect(shown.providers.map((row) => row.id)).toContain('acp-omp');
  });

  it('exposes slash Plan for Claude and Plan plus Goal for Codex', () => {
    const body = buildThreadExecutionOptions({
      availability: [verify('claude'), verify('codex'), verify('pi'), verify('cursor')]
    });
    expect(body.providers.find((row) => row.id === 'claude-code')?.composerActions).toEqual(['plan']);
    expect(body.providers.find((row) => row.id === 'codex')?.composerActions).toEqual(['plan', 'goal']);
    expect(body.providers.find((row) => row.id === 'pi')?.composerActions).toEqual([]);
  });

  it('does not invent models for a requested uninstalled provider before live discovery', () => {
    const body = buildThreadExecutionOptions({
      providerId: 'codex',
      availability: [
        verify('claude'),
        verify('codex', { installed: false }),
        verify('pi'),
        verify('cursor')
      ]
    });
    expect(body.providers.map((row) => row.id)).not.toContain('codex');
    expect(body.models).toEqual([]);
  });

  it('has no core-owned Claude fallback catalog', () => {
    const models = modelsForThreadProvider('claude-code', []);
    expect(models).toEqual([]);
  });

  it('does not invent Claude aliases before live discovery', () => {
    const body = buildThreadExecutionOptions({
      providerId: 'claude-code',
      availability: [verify('claude')]
    });
    expect(body.selectedOnlyModels).toEqual([]);
    expect(selectedOnlyModelsForThreadProvider('codex')).toEqual([]);
  });

  it('reports auth_required without synthesizing a Codex catalog', () => {
    const body = buildThreadExecutionOptions({
      providerId: 'codex',
      availability: [verify('codex')],
      listError: 'auth_required'
    });
    expect(body.modelLoadError).toEqual({ providerId: 'codex', code: 'auth_required', detail: null });
    expect(body.models).toEqual([]);
  });

  it('prefers a live host catalog over the static fallback', () => {
    const body = buildThreadExecutionOptions({
      providerId: 'codex',
      availability: [verify('codex')],
      listed: {
        models: [{
          id: 'gpt-5.5',
          model: 'gpt-5.5',
          displayName: 'GPT-5.5',
          description: 'Live Codex model',
          supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
          defaultReasoningEffort: 'medium',
          isDefault: true
        }],
        selectedOnlyModels: []
      }
    });
    expect(body.models).toHaveLength(1);
    expect(body.models[0]?.description).toBe('Live Codex model');
  });

  it('merges bounded custom models without replacing live rows', () => {
    const provider = { id: 'codex', capabilities: { reasoningLevels: ['low', 'medium', 'high'] } } as never;
    const live = {
      models: [{
        id: 'live', model: 'live', displayName: 'Live', description: 'Live',
        supportedReasoningEfforts: [{ reasoningEffort: 'medium' as const, description: 'Medium' }],
        defaultReasoningEffort: 'medium' as const, isDefault: true
      }],
      selectedOnlyModels: []
    };
    const result = overlayCustomModels(live, {
      customModels: [
        { providerId: 'codex', model: 'custom/new', displayName: 'Custom New' },
        { providerId: 'claude-code', model: 'wrong-provider' },
        { providerId: 'codex', model: 'live' }
      ]
    }, provider);
    expect(result.models.map((row) => row.model)).toEqual(['live', 'custom/new']);
    expect(result.models[1]).toMatchObject({ displayName: 'Custom New', isDefault: false });
  });
});

describe('execution-options API wiring', () => {
  it('serves GET /system/execution-options from harnessVerify and the catalog', () => {
    const source = readFileSync(new URL('../../http/product-api.ts', import.meta.url), 'utf8');
    expect(source).toContain("/api/v1/system/execution-options");
    expect(source).toContain('buildThreadExecutionOptions');
    expect(source).toContain('harnessVerify');
    expect(source).toContain('ctx.modelCatalogs.read');
    expect(source).toContain('parseReasoningLevel(body.reasoningLevel)');
    expect(source).toContain('readLastThreadExecution');
    expect(source).toContain('listError');
    const store = readFileSync(new URL('./provider-model-catalog-store.ts', import.meta.url), 'utf8');
    expect(store).toContain("type: 'provider.list_models'");
    expect(store).toContain('timeoutMs: 45_000');
    expect(source).toContain('probeInstalledProviderHealth');
    expect(source).toContain('mergeHealthIntoExtraInstalled');
    const probe = readFileSync(new URL('./provider-health-probe.ts', import.meta.url), 'utf8');
    expect(probe).toContain("type: 'provider.health'");
    expect(probe).toContain('mergeHealthIntoExtraInstalled');
  });
});

describe('classifyModelListError', () => {
  it('maps Cursor/Codex/OpenCode login failures onto auth_required', () => {
    expect(classifyModelListError(Object.assign(new Error('ACP agent is not authenticated.'), { code: 'auth_required' }))).toBe('auth_required');
    expect(classifyModelListError(new Error("Error: Authentication required. Run 'agent login'"))).toBe('auth_required');
    expect(classifyModelListError(new Error('Run `codex login` on this host'))).toBe('auth_required');
    expect(classifyModelListError(new Error('Run `opencode auth login` to continue'))).toBe('auth_required');
    expect(classifyModelListError(new Error('opencode login required'))).toBe('auth_required');
    expect(classifyModelListError(new Error('spawn cursor-agent ENOENT'))).toBe('missing_executable');
    expect(classifyModelListError(new Error('bb could not find the Codex CLI on this machine.'))).toBe('missing_executable');
    expect(classifyModelListError(Object.assign(new Error('CLI missing'), { code: -32004 }))).toBe('missing_executable');
    expect(classifyModelListError(new Error('host rpc timed out: provider.list_models'))).toBe('timeout');
    expect(classifyModelListError(new Error('bridge crashed'))).toBe('failed');
  });
});

describe('plugin host default execution options', () => {
  const previousFake = process.env.ZCC_FAKE_PROVIDER;

  beforeEach(() => {
    process.env.ZCC_FAKE_PROVIDER = '1';
  });

  afterEach(() => {
    if (previousFake === undefined) delete process.env.ZCC_FAKE_PROVIDER;
    else process.env.ZCC_FAKE_PROVIDER = previousFake;
  });

  it('exposes the fake static catalog instead of the provider id', () => {
    const catalog = pluginHostModelCatalog('fake');
    expect(catalog.models.map((row) => row.model)).toEqual(['fake-model']);
    expect(catalog.models[0]?.isDefault).toBe(true);
    expect(catalog.models[0]?.supportedReasoningEfforts.map((effort) => effort.reasoningEffort)).toEqual([
      'low',
      'medium',
      'high'
    ]);
    expect(catalog.modelLoadError).toBeNull();
  });

  it('picks a fake-legal model, reasoning level, and permission mode', () => {
    expect(resolvePluginDefaultExecutionOptions({
      providerId: 'fake',
      lastModel: null,
      lastReasoningLevel: null
    })).toEqual({
      model: 'fake-model',
      reasoningLevel: 'medium',
      permissionMode: 'full'
    });
  });

  it('keeps a prior model when it is still in the catalog', () => {
    expect(resolvePluginDefaultExecutionOptions({
      providerId: 'fake',
      lastModel: 'fake-model',
      lastReasoningLevel: 'low'
    })).toEqual({
      model: 'fake-model',
      reasoningLevel: 'low',
      permissionMode: 'full'
    });
  });

  it('keeps the prior selection when discovery has no usable catalog', () => {
    expect(resolvePluginDefaultExecutionOptions({
      providerId: 'fake',
      lastModel: 'offline-model',
      lastReasoningLevel: 'high',
      catalog: { models: [] }
    })).toEqual({
      model: 'offline-model',
      reasoningLevel: 'high',
      permissionMode: 'full'
    });
  });

  it('does not inherit an unsupported model, reasoning level, or accept-edits permission', () => {
    expect(resolvePluginDefaultExecutionOptions({
      providerId: 'fake',
      lastModel: 'fake',
      lastReasoningLevel: 'none'
    })).toEqual({
      model: 'fake-model',
      reasoningLevel: 'medium',
      permissionMode: 'full'
    });
  });
});


it('offers Default alongside one provider-defined tier and removes tiers under the instance policy', () => {
  const provider = registerThreadProvider('tier-test', { id: 'tier-test', displayName: 'Tier test', serviceTiers: [{ id: 'economy', label: 'Economy' }], capabilities: { supportsServiceTier: true, fork: 'none', permissionModes: ['full'], reasoningLevels: [] } });
  try {
    const options = buildThreadExecutionOptions({ availability: [] });
    expect(options.providers.find(row => row.id === 'tier-test')?.serviceTiers).toEqual([{ id: 'default', label: 'Default' }, { id: 'economy', label: 'Economy' }]);
    expect(buildThreadExecutionOptions({ availability: [], providerServiceTiersDisabled: true }).providers.find(row => row.id === 'tier-test')?.serviceTiers).toEqual([]);
  } finally { provider.unregister(); }
});
