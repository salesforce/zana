/**
 * @vitest-environment happy-dom
 */
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { providerCliStatus } = vi.hoisted(() => ({ providerCliStatus: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({
  product: { hosts: { providerCliStatus, installProviderCli: vi.fn() } }
}));

import { useComposerProviderCli } from './use-composer-provider-cli.js';

const codexMissing = { codex: { displayName: 'Codex', installed: false, versionUnsupported: false } };

function renderCli(initialProps: { hostConnected: boolean }) {
  return renderHook(({ hostConnected }) => useComposerProviderCli({
    enabled: true, hostId: 'h1', providerId: 'codex', hostConnected
  }), { initialProps });
}

describe('useComposerProviderCli', () => {
  afterEach(() => {
    cleanup();
    providerCliStatus.mockReset();
  });

  it('keeps an offline host out of the error and rechecks on reconnect', async () => {
    providerCliStatus.mockRejectedValueOnce(
      Object.assign(new Error('host h1 is not connected'), { status: 503, code: 'host-unavailable' })
    );
    const { result, rerender } = renderCli({ hostConnected: false });
    await waitFor(() => expect(providerCliStatus).toHaveBeenCalledTimes(1));
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBeNull();

    providerCliStatus.mockResolvedValue(codexMissing);
    rerender({ hostConnected: true });
    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(providerCliStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.displayName).toBe('Codex');
    expect(result.current.error).toBeNull();
  });

  it('still reports other status failures', async () => {
    providerCliStatus.mockRejectedValueOnce(Object.assign(new Error('rpc exploded'), { status: 502 }));
    const { result } = renderCli({ hostConnected: true });
    await waitFor(() => expect(result.current.error).toBe('rpc exploded'));
  });

  it('falls back to a generic message for non-Error failures', async () => {
    providerCliStatus.mockRejectedValueOnce('nope');
    const { result } = renderCli({ hostConnected: true });
    await waitFor(() => expect(result.current.error).toBe('Could not check provider CLI status'));
  });

  it('skips the check without a host', async () => {
    const { result } = renderHook(() => useComposerProviderCli({ enabled: true, hostId: undefined, providerId: 'codex' }));
    await waitFor(() => expect(result.current.status).toBeNull());
    expect(providerCliStatus).not.toHaveBeenCalled();
  });
});
