import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { readHostAuth, writeHostAuth, enrollDaemonHost, persistHostId, startEnrolledHostConnection } = vi.hoisted(() => ({
  readHostAuth: vi.fn(),
  writeHostAuth: vi.fn(),
  enrollDaemonHost: vi.fn(),
  persistHostId: vi.fn(),
  startEnrolledHostConnection: vi.fn()
}));

vi.mock('./lock.js', () => ({
  acquireDaemonLock: () => () => undefined
}));
vi.mock('./machine-auth.js', () => ({
  readHostAuth,
  writeHostAuth
}));
vi.mock('./enroll.js', () => ({ enrollDaemonHost }));
vi.mock('./identity.js', () => ({
  detectHostName: () => 'test-host',
  persistHostId,
  resolveHostId: () => '11111111-1111-4111-8111-111111111111'
}));
vi.mock('./server-connection.js', () => ({ startEnrolledHostConnection }));

import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { startEnrolledHostDaemon } from './enroll-runtime.js';

function openConnection(): { ready: Promise<void>; close: () => Promise<void> } {
  return {
    ready: Promise.resolve(),
    close: async () => undefined
  };
}

function closedConnection(): { ready: Promise<void>; close: () => Promise<void> } {
  return {
    ready: Promise.reject(new Error('host websocket closed before hello')),
    close: async () => undefined
  };
}

describe('startEnrolledHostDaemon', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('re-enrolls with the loopback token when stored auth cannot open the hub', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-enroll-reauth-'));
    readHostAuth.mockReturnValue({
      hostId: '11111111-1111-4111-8111-111111111111',
      hostKey: 'stale-key',
      hostName: 'test-host'
    });
    enrollDaemonHost.mockResolvedValue({
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: '11111111-1111-4111-8111-111111111111',
      hostKey: 'fresh-key'
    });
    startEnrolledHostConnection
      .mockImplementationOnce(() => closedConnection())
      .mockImplementationOnce(() => openConnection());

    const daemon = await startEnrolledHostDaemon({
      dataDir,
      serverUrl: 'http://127.0.0.1:8780/',
      token: 'enroll-token-enroll-token-enroll'
    });
    expect(enrollDaemonHost).toHaveBeenCalledOnce();
    expect(writeHostAuth).toHaveBeenCalledWith(dataDir, expect.objectContaining({ hostKey: 'fresh-key' }));
    expect(startEnrolledHostConnection).toHaveBeenCalledTimes(2);
    await daemon.close();
  });
});
