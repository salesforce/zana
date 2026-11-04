import { afterEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => vi.fn());
vi.mock('../hook-trust.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hook-trust.js')>()),
  probeCodexHookTrust: probe
}));
vi.mock('../../codex-model-catalog.js', () => ({
  discoverCodexModels: vi.fn(async () => []),
  invalidateCodexModels: vi.fn()
}));

import { codexHarness } from '../registration.js';
import type { CodexProvider } from '../provider.js';

const provider = codexHarness.implementation as CodexProvider;

describe('codex registration hook-trust wiring', () => {
  afterEach(() => {
    provider.setHookTrustMode('bypass');
    vi.restoreAllMocks();
  });

  it('enables scoped trust when the probe verifies the binary', async () => {
    probe.mockResolvedValue({ mode: 'scoped' });
    await codexHarness.refreshCatalog!({ binary: '/bin/codex', normalizedVersion: '0.163.0' });
    expect(probe).toHaveBeenCalledWith('/bin/codex', '/bin/codex:0.163.0');
    expect(provider.currentHookTrustMode).toBe('scoped');
  });

  it('falls back to bypass and warns when the probe does not verify', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    provider.setHookTrustMode('scoped');
    probe.mockResolvedValue({ mode: 'bypass', reason: 'hash mismatch' });
    await codexHarness.refreshCatalog!({ binary: '/bin/codex' });
    expect(provider.currentHookTrustMode).toBe('bypass');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hash mismatch'));
  });
});
