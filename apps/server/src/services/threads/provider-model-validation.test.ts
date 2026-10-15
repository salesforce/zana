import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { registerThreadProvider, type ThreadProviderRecord } from './thread-provider-catalog.js';
import { validateProviderModelSelection } from './provider-model-validation.js';

const handles: Array<{ unregister(): void }> = [];
afterEach(() => handles.splice(0).forEach((handle) => handle.unregister()));

function register(): ThreadProviderRecord {
  handles.push(registerThreadProvider('provider-validation', {
    id: 'validation-provider',
    displayName: 'Validation Provider',
    models: { scope: 'workspace' },
    capabilities: {
      supportsServiceTier: false,
      fork: 'none',
      supportsManualCompaction: false,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: ['full'],
      reasoningLevels: ['low', 'medium', 'high']
    }
  }));
  return {} as ThreadProviderRecord;
}

function context(customModels: Array<{ providerId: string; model: string }> = []) {
  const read = vi.fn(async () => ({
    models: [{
      id: 'live', model: 'live', displayName: 'Live', description: 'Live', isDefault: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'medium' as const, description: 'Medium' }],
      defaultReasoningEffort: 'medium' as const
    }],
    selectedOnlyModels: [],
    modelLoadError: null
  }));
  const ctx = {
    modelCatalogs: { read },
    config: { getConfig: () => ({ customModels }) },
    pluginHostArtifacts: { get: () => ({ digest: 'a'.repeat(64), byteLength: 1 }) }
  } as unknown as ProductHttpContext;
  return { ctx, read };
}

describe('validateProviderModelSelection', () => {
  it.each([undefined, 'default'])('preserves provider defaults for model %s without catalog validation', async model => {
    const { ctx, read } = context();
    await expect(validateProviderModelSelection(ctx, {
      hostId: 'host-1', providerId: 'validation-provider', model
    })).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('validates live models and their reasoning levels against the shared catalog', async () => {
    register();
    const { ctx, read } = context();
    await validateProviderModelSelection(ctx, {
      hostId: 'host-1', providerId: 'validation-provider', cwd: '/workspace',
      model: 'live', reasoningLevel: 'medium'
    });
    expect(read).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'workspace', cwd: '/workspace', requiredModel: 'live'
    }));
    await expect(validateProviderModelSelection(ctx, {
      hostId: 'host-1', providerId: 'validation-provider', model: 'live', reasoningLevel: 'high'
    })).rejects.toMatchObject({ code: 'invalid-reasoning-level' });
  });

  it('accepts a bounded custom overlay and rejects unknown models', async () => {
    register();
    const { ctx } = context([{ providerId: 'validation-provider', model: 'custom' }]);
    await expect(validateProviderModelSelection(ctx, {
      hostId: 'host-1', providerId: 'validation-provider', model: 'custom'
    })).resolves.toBeUndefined();
    await expect(validateProviderModelSelection(ctx, {
      hostId: 'host-1', providerId: 'validation-provider', model: 'missing'
    })).rejects.toMatchObject({ code: 'invalid-model' });
  });

  it('does not call a model unavailable when the catalogue failed to load', async () => {
    register();
    const { ctx, read } = context();
    read.mockResolvedValueOnce({ models: [], selectedOnlyModels: [], modelLoadError: { providerId: 'validation-provider', code: 'timeout', detail: 'no such directory' } } as never);
    await expect(validateProviderModelSelection(ctx, {
      hostId: 'host-1', providerId: 'validation-provider', cwd: '/missing', model: 'live'
    })).resolves.toBeUndefined();
  });
});
