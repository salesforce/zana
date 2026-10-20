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
import { HostAuthenticationError } from './server-socket.js';

function openConnection(): { ready: Promise<void>; close: () => Promise<void> } {
  return {
    ready: Promise.resolve(),
    close: async () => undefined
  };
}

function closedConnection(): { ready: Promise<void>; close: () => Promise<void> } {
  return {
    ready: Promise.reject(new HostAuthenticationError('Host server rejected credentials (401)')),
    close: async () => undefined
  };
}

describe('startEnrolledHostDaemon', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(['/trusted/independent-app', '   '])('selects host-owned local app directory %j independently of enrollment', async local => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-enroll-local-app-'));
    vi.stubEnv('ZCC_LOCAL_PEER_APP_DATA_DIR', local);
    vi.stubEnv('ZCC_DATA_DIR', '/trusted/default-app');
    readHostAuth.mockReturnValue({ hostId: '11111111-1111-4111-8111-111111111111', hostKey: 'saved', serverUrl: 'https://remote.example/' });
    startEnrolledHostConnection.mockImplementation(() => openConnection());
    const daemon = await startEnrolledHostDaemon({ dataDir, serverUrl: 'https://remote.example/' });
    expect(startEnrolledHostConnection).toHaveBeenCalledWith(expect.objectContaining({
      dataDir, localPeerAppDataDir: local.trim() || '/trusted/default-app'
    }));
    expect(enrollDaemonHost).not.toHaveBeenCalled();
    expect(writeHostAuth).not.toHaveBeenCalled();
    await daemon.close();
  });

  it('re-enrolls with the loopback token when stored auth cannot open the hub', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-enroll-reauth-'));
    readHostAuth.mockReturnValue({
      hostId: '11111111-1111-4111-8111-111111111111',
      hostKey: 'stale-key',
      serverUrl: 'http://127.0.0.1:8780/',
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

  it('replaces stored auth for a different join host id only with explicit consent', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-enroll-hostid-'));
    readHostAuth.mockReturnValue({
      hostId: '11111111-1111-4111-8111-111111111111',
      hostKey: 'stale-key',
      hostName: 'test-host'
    });
    enrollDaemonHost.mockResolvedValue({
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: '22222222-2222-4222-8222-222222222222',
      hostKey: 'fresh-key'
    });
    startEnrolledHostConnection.mockImplementation(() => openConnection());

    const daemon = await startEnrolledHostDaemon({
      dataDir,
      serverUrl: 'https://zcc.example/t/zcrs_abcdefghijklmnopqr/',
      token: 'enroll-token-enroll-token-enroll',
      replaceEnrollment: true,
      hostId: '22222222-2222-4222-8222-222222222222'
    });
    expect(enrollDaemonHost).toHaveBeenCalledOnce();
    expect(enrollDaemonHost.mock.calls[0][0].hostId).toBe('22222222-2222-4222-8222-222222222222');
    expect(startEnrolledHostConnection).toHaveBeenCalledOnce();
    expect(startEnrolledHostConnection.mock.calls[0][0].hostId).toBe(
      '22222222-2222-4222-8222-222222222222'
    );
    await daemon.close();
  });

  it('does not replace host.id when saving replacement auth fails', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-enroll-persist-'));
    readHostAuth.mockReturnValue({ hostId: '11111111-1111-4111-8111-111111111111', hostKey: 'stale-key', hostName: 'test-host' });
    enrollDaemonHost.mockResolvedValue({ protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: '22222222-2222-4222-8222-222222222222', hostKey: 'fresh-key' });
    startEnrolledHostConnection.mockImplementation(() => openConnection());
    writeHostAuth.mockImplementationOnce(() => { throw new Error('disk full'); });

    await expect(startEnrolledHostDaemon({ dataDir, serverUrl: 'https://zcc.example/', token: 'enroll-token-enroll-token-enroll',
      replaceEnrollment: true, hostId: '22222222-2222-4222-8222-222222222222' })).rejects.toThrow('disk full');
    expect(persistHostId).not.toHaveBeenCalled();
  });
});

it('consumes a Connect repair before reusing auth, then recovers a completed enrollment without rotating again', async () => {
  vi.clearAllMocks();
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-connect-repair-'));
  const hostId = '11111111-1111-4111-8111-111111111111';
  const serverUrl = 'https://shared.zana-ide.com/';
  readHostAuth.mockReturnValue({ hostId, hostKey: 'old-key', hostName: 'test-host', serverUrl });
  enrollDaemonHost.mockResolvedValue({ protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, hostKey: 'new-key' });
  startEnrolledHostConnection.mockImplementation(() => openConnection());
  const options = { dataDir, serverUrl, hostId, token: 'zcde_' + 'a'.repeat(24), connectCredential: 'b'.repeat(43) };
  const first = await startEnrolledHostDaemon({ ...options, replaceEnrollment: true });
  expect(enrollDaemonHost).toHaveBeenCalledOnce();
  expect(startEnrolledHostConnection).toHaveBeenCalledWith(expect.objectContaining({ hostKey: 'new-key' }));
  const saved = writeHostAuth.mock.calls[0]![1];
  expect(saved.enrollmentId).toMatch(/^[a-f0-9]{64}$/);
  await first.close();
  readHostAuth.mockReturnValue(saved); enrollDaemonHost.mockClear();
  const recovered = await startEnrolledHostDaemon(options);
  expect(enrollDaemonHost).not.toHaveBeenCalled();
  await recovered.close();
});

it('does not rotate credentials on a transient failure even when a join token is present', async () => {
  vi.clearAllMocks();
  readHostAuth.mockReturnValue({ hostId: '11111111-1111-4111-8111-111111111111', hostKey: 'existing-key', serverUrl: 'https://example.com/' });
  startEnrolledHostConnection.mockReturnValue({ ready: Promise.reject(new Error('Host server connection timed out')), close: vi.fn(async () => {}) });
  await expect(startEnrolledHostDaemon({ dataDir: mkdtempSync(join(tmpdir(), 'zcc-enroll-outage-')), serverUrl: 'https://example.com/', token: 'unused-join-token' })).rejects.toThrow('timed out');
  expect(enrollDaemonHost).not.toHaveBeenCalled();
  expect(writeHostAuth).not.toHaveBeenCalled();
});

it.each([false, true])('keeps saved credentials while startup is offline, cancellation=%s', async cancel => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    readHostAuth.mockReturnValue({ hostId: '11111111-1111-4111-8111-111111111111', hostKey: 'saved', serverUrl: 'http://127.0.0.1:1' });
    let resolve!: () => void, reject!: (error: Error) => void;
    const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const close = vi.fn(async () => { reject(new Error('closed')); });
    startEnrolledHostConnection.mockReturnValue({ ready, close });
    const controller = new AbortController();
    const starting = startEnrolledHostDaemon({ dataDir: mkdtempSync(join(tmpdir(), 'zcc-offline-')),
      serverUrl: 'http://127.0.0.1:1', keepRetryingStartup: true, signal: controller.signal });
    void starting.catch(() => {});
    try {
      await vi.advanceTimersByTimeAsync(180000);
      expect(close).not.toHaveBeenCalled();
      expect(enrollDaemonHost).not.toHaveBeenCalled();
      if (cancel) {
        controller.abort(); await expect(starting).rejects.toThrow('closed');
      } else {
        resolve(); const daemon = await starting;
        expect(startEnrolledHostConnection).toHaveBeenCalledWith(expect.objectContaining({ keepRetryingStartup: true, hostKey: 'saved' }));
        await daemon.close();
      }
    } finally { vi.useRealTimers(); }
  });

describe('enrollment across tunnel restarts', () => {
  const hostId = '11111111-1111-4111-8111-111111111111';
  const start = (serverUrl: string) => startEnrolledHostDaemon({ dataDir: mkdtempSync(join(tmpdir(), 'zcc-enroll-port-')), serverUrl, token: 'unused-join-token' });

  it('keeps an enrollment when the owner is reached on another loopback tunnel port, and records the new URL', async () => {
    vi.clearAllMocks();
    readHostAuth.mockReturnValue({ hostId, hostKey: 'k', hostName: 'h', serverUrl: 'http://127.0.0.1:41000', provenance: 'tunnel' });
    startEnrolledHostConnection.mockImplementation(() => openConnection());
    const daemon = await start('http://127.0.0.1:38892');
    expect(enrollDaemonHost).not.toHaveBeenCalled();
    expect(writeHostAuth).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ hostKey: 'k', serverUrl: 'http://127.0.0.1:38892' }));
    await daemon.close();
  });

  it('never re-enrolls over stored auth when another loopback port rejects the stored key', async () => {
    vi.clearAllMocks();
    readHostAuth.mockReturnValue({ hostId, hostKey: 'k', hostName: 'h', serverUrl: 'http://127.0.0.1:41000', provenance: 'tunnel' });
    startEnrolledHostConnection.mockImplementation(() => closedConnection());
    await expect(start('http://127.0.0.1:38892')).rejects.toThrow('Existing machine enrollment belongs to another server');
    expect(enrollDaemonHost).not.toHaveBeenCalled();
    expect(writeHostAuth).not.toHaveBeenCalled();
  });

  it('still re-enrolls on an auth rejection from the exact enrolled URL', async () => {
    vi.clearAllMocks();
    readHostAuth.mockReturnValue({ hostId, hostKey: 'k', hostName: 'h', serverUrl: 'http://127.0.0.1:41000/' });
    enrollDaemonHost.mockResolvedValue({ protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, hostKey: 'fresh' });
    startEnrolledHostConnection.mockImplementationOnce(() => closedConnection()).mockImplementationOnce(() => openConnection());
    const daemon = await start('http://127.0.0.1:41000');
    expect(enrollDaemonHost).toHaveBeenCalledOnce();
    expect(writeHostAuth).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ hostKey: 'fresh' }));
    await daemon.close();
  });

  it('fails closed on a legacy enrollment without provenance when the loopback port changed', async () => {
    vi.clearAllMocks();
    readHostAuth.mockReturnValue({ hostId, hostKey: 'k', hostName: 'h', serverUrl: 'http://127.0.0.1:41000' });
    await expect(start('http://127.0.0.1:38892')).rejects.toThrow('belongs to another server');
    expect(enrollDaemonHost).not.toHaveBeenCalled();
    expect(writeHostAuth).not.toHaveBeenCalled();
  });

  it('still refuses an enrollment that belongs to a different server', async () => {
    vi.clearAllMocks();
    readHostAuth.mockReturnValue({ hostId, hostKey: 'k', hostName: 'h', serverUrl: 'https://other.example' });
    await expect(start('http://127.0.0.1:38892')).rejects.toThrow('belongs to another server');
    readHostAuth.mockReturnValue({ hostId, hostKey: 'k', hostName: 'h', serverUrl: 'http://127.0.0.1:41000' });
    await expect(start('https://other.example')).rejects.toThrow('belongs to another server');
    await expect(start('not a url')).rejects.toThrow('belongs to another server');
  });
});
