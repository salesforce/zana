import { afterEach, describe, expect, it, vi } from 'vitest';

const apiJson = vi.hoisted(() => vi.fn());
vi.mock('./fetch-with-app-surface.js', () => ({ fetchWithAppSurface: vi.fn(), apiJson }));

import { peerConnections } from './product-client.js';

describe('peerConnections client', () => {
  afterEach(() => apiJson.mockReset());

  it('lists connections', async () => {
    apiJson.mockResolvedValue({ connections: [] });
    await expect(peerConnections.list()).resolves.toEqual({ connections: [] });
    expect(apiJson).toHaveBeenCalledWith('/peer-connections');
  });

  it('checks remote login', async () => {
    apiJson.mockResolvedValue({ ok: true });
    await expect(peerConnections.checkRemoteLogin()).resolves.toEqual({ ok: true });
    expect(apiJson).toHaveBeenLastCalledWith('/peer-connections/remote-login', { method: 'POST' });
  });

  it('creates a connection', async () => {
    apiJson.mockResolvedValue({ invitationId: 'i1', code: '123' });
    await expect(peerConnections.create()).resolves.toEqual({ invitationId: 'i1', code: '123' });
    expect(apiJson).toHaveBeenLastCalledWith('/peer-connections', { method: 'POST' });
  });

  it('joins with a token in the body', async () => {
    apiJson.mockResolvedValue({ id: 'c1' });
    await peerConnections.join('tok&1');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-connections/join', {
      method: 'POST',
      body: JSON.stringify({ token: 'tok&1' })
    });
  });

  it('joins with an empty token', async () => {
    apiJson.mockResolvedValue({ id: 'c1' });
    await peerConnections.join('');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-connections/join', {
      method: 'POST',
      body: JSON.stringify({ token: '' })
    });
  });

  it('approves, encoding the invitation id and sending the code', async () => {
    apiJson.mockResolvedValue({ id: 'c1' });
    await peerConnections.approve('inv/1', 'code 2');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-connections/inv%2F1/approve', {
      method: 'POST',
      body: JSON.stringify({ code: 'code 2' })
    });
  });

  it('denies, encoding the invitation id', async () => {
    apiJson.mockResolvedValue({ id: 'c1' });
    await peerConnections.deny('inv 1');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-connections/inv%201/deny', { method: 'POST' });
  });

  it('cancels, encoding the invitation id', async () => {
    apiJson.mockResolvedValue({ id: 'c1' });
    await peerConnections.cancel('inv/1');
    expect(apiJson).toHaveBeenLastCalledWith('/peer-connections/inv%2F1', { method: 'DELETE' });
  });

  it('propagates failures', async () => {
    apiJson.mockRejectedValue(new Error('409'));
    await expect(peerConnections.create()).rejects.toThrow('409');
  });
});
