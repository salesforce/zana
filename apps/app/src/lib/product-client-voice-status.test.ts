import { afterEach, describe, expect, it, vi } from 'vitest';

const apiJson = vi.hoisted(() => vi.fn());
vi.mock('./fetch-with-app-surface.js', () => ({ fetchWithAppSurface: vi.fn(), apiJson }));

import { fetchVoiceStatus } from './product-client.js';

describe('fetchVoiceStatus', () => {
  afterEach(() => apiJson.mockReset());

  it('returns the server voice readiness, including why it is unavailable', async () => {
    apiJson.mockResolvedValue({ enabled: false, reason: 'auth_missing' });
    await expect(fetchVoiceStatus()).resolves.toEqual({ enabled: false, reason: 'auth_missing' });
    expect(apiJson).toHaveBeenCalledWith('/system/voice-status');
  });

  it('propagates a failed lookup so callers can keep their last known status', async () => {
    apiJson.mockRejectedValue(new Error('offline'));
    await expect(fetchVoiceStatus()).rejects.toThrow('offline');
  });
});
