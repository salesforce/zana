import { beforeEach, expect, it, vi } from 'vitest';

const enrollDaemonHost = vi.fn(async (input: { fetchFn: typeof fetch; serverUrl: string }) => {
  await input.fetchFn(`${input.serverUrl}/internal/hosts/enroll`, { method: 'POST' });
  return { hostId: 'host-id', hostKey: 'host-key' };
});
const startEnrolledHostConnection = vi.fn(() => ({ ready: Promise.resolve(), close: async () => {} }));
vi.mock('@zana-ai/zcc-host-daemon/enroll', () => ({ enrollDaemonHost }));
vi.mock('@zana-ai/zcc-host-daemon/server-connection', () => ({ startEnrolledHostConnection }));
vi.mock('@zana-ai/zcc-host-daemon/command-dispatch', () => ({ createCommandRuntime: vi.fn(() => ({})) }));
vi.mock('@zana-ai/zcc-host-daemon/peer-forward', () => ({ createStoredLocalPeerAppResolver: vi.fn(() => () => null) }));

const { defaultInstallerConnector } = await import('./introduction-installer.js');
const serverUrl = 'https://peer.connect.example.com';
const credential = 'c'.repeat(43);
const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'));

beforeEach(() => { vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear(); enrollDaemonHost.mockClear(); startEnrolledHostConnection.mockClear(); });

it('presents the Connect peer credential on enroll and passes it to the host connection', async () => {
  await defaultInstallerConnector.enroll({ serverUrl, joinCode: 'zcde_x', hostName: 'Peer', signal: new AbortController().signal, connectCredential: credential });
  const init = fetchSpy.mock.calls[0]![1]!;
  expect(new Headers(init.headers).get('x-zcc-machine-credential')).toBe(credential);
  expect(init).toMatchObject({ redirect: 'error', credentials: 'omit' });
  // The credential is origin-bound: another destination is refused before any request.
  const other = enrollDaemonHost.mock.calls[0]![0].fetchFn;
  expect(() => other('https://evil.example.com/x')).toThrow('Machine request target mismatch');

  defaultInstallerConnector.connect({ serverUrl, hostId: 'h', hostKey: 'k', expectedRemoteInstanceId: 'i', daemonDir: '/tmp/d', localAppDataDir: '/tmp/a', onConnectionChange() {}, connectCredential: credential });
  expect(startEnrolledHostConnection).toHaveBeenCalledWith(expect.objectContaining({ connectCredential: credential, enrollmentCapability: 'peer.forward', expectedRemoteInstanceId: 'i' }));
});

it('keeps direct (non-Connect) peers free of any Connect credential', async () => {
  await defaultInstallerConnector.enroll({ serverUrl, joinCode: 'zcde_x', hostName: 'Peer', signal: new AbortController().signal });
  expect(new Headers(fetchSpy.mock.calls[0]![1]!.headers).get('x-zcc-machine-credential')).toBeNull();
  defaultInstallerConnector.connect({ serverUrl, hostId: 'h', hostKey: 'k', expectedRemoteInstanceId: 'i', daemonDir: '/tmp/d', localAppDataDir: '/tmp/a', onConnectionChange() {} });
  expect(startEnrolledHostConnection).toHaveBeenCalledWith(expect.objectContaining({ connectCredential: undefined }));
});
