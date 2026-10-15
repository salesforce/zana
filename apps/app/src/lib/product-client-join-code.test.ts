import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('./fetch-with-app-surface.js', () => ({ fetchWithAppSurface: fetchMock, apiJson: vi.fn() }));

import { requestPreferredJoinCode } from './product-client.js';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('requestPreferredJoinCode', () => {
  afterEach(() => fetchMock.mockReset());

  it('returns the issued code with its pairing URL', async () => {
    fetchMock.mockResolvedValue(json(201, { joinCode: 'c', hostId: 'h', expiresAt: 1, pairingServerUrl: 'https://r/t/x' }));
    await expect(requestPreferredJoinCode()).resolves.toEqual({
      ok: true,
      join: { joinCode: 'c', hostId: 'h', expiresAt: 1, pairingServerUrl: 'https://r/t/x' }
    });
  });

  it('surfaces 409 relay refusals as typed results', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { error: 'relay_unavailable', reason: 'offline' }));
    await expect(requestPreferredJoinCode()).resolves.toEqual({ ok: false, error: 'relay_unavailable', reason: 'offline' });
    fetchMock.mockResolvedValueOnce(json(409, { error: 'relay_changed' }));
    await expect(requestPreferredJoinCode()).resolves.toEqual({ ok: false, error: 'relay_changed' });
  });

  it('throws for unknown 409 bodies and other failures', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { error: 'other' }));
    await expect(requestPreferredJoinCode()).rejects.toMatchObject({ status: 409, code: 'other' });
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(requestPreferredJoinCode()).rejects.toMatchObject({ status: 500, message: '500' });
    fetchMock.mockResolvedValueOnce(json(400, { message: 'bad' }));
    await expect(requestPreferredJoinCode()).rejects.toMatchObject({ message: 'bad' });
  });
});
