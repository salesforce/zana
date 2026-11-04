import { describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { createCommandRuntime, dispatchHostCommand } from './command-dispatch.js';
import { providerFor } from './harness/registry.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

describe('provider status live inventory opt-in', () => {
  it('probes only on descriptor requests and uses host-owned config and HOME', async () => {
    const config = { version: 1, harnesses: { byId: { opencode: { binary: '/configured/opencode' } } } } as AppConfig;
    const status = { providers: [{ family: 'opencode', label: 'OpenCode', binary: '/configured/opencode',
      enabled: true, installed: true, alwaysEnabled: false, installHint: 'install' }] };
    const discover = vi.spyOn(providerFor('opencode'), 'discoverModelTargets').mockResolvedValue(['native/model']);
    try {
      const runtime = createCommandRuntime({ loadConfig: () => config, verifyProviders: async () => status });
      expect(await dispatchHostCommand(runtime, { type: 'provider.status' })).toBe(status);
      expect(discover).not.toHaveBeenCalled();
      expect(await dispatchHostCommand(runtime, { type: 'provider.status', includeModelInventory: true })).toEqual({
        ...status, modelInventories: [{ family: 'opencode', models: ['native/model'] }]
      });
      expect(discover).toHaveBeenCalledWith({ cwd: homedir(), config });
    } finally {
      discover.mockRestore();
    }
  });
});
