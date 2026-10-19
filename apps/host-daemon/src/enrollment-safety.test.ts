import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { writeHostAuth, readHostAuth } from './machine-auth.js';
import { persistHostId } from './identity.js';
import { startEnrolledHostDaemon, sameEnrolledServer } from './enroll-runtime.js';
import { HostAuthenticationError } from './server-socket.js';

const deps = vi.hoisted(() => ({ enroll: vi.fn(), connect: vi.fn(), release: vi.fn() }));
vi.mock('./lock.js', () => ({ acquireDaemonLock: () => deps.release }));
vi.mock('./enroll.js', () => ({ enrollDaemonHost: deps.enroll }));
vi.mock('./server-connection.js', () => ({ startEnrolledHostConnection: deps.connect }));
vi.mock('./workspace-fs-watch.js', () => ({ disposeHostFsWatcher: async () => {} }));
const dirs: string[] = [];
const oldId = '11111111-1111-4111-8111-111111111111';
const newId = '22222222-2222-4222-8222-222222222222';
const url = 'http://127.0.0.1:41000';
const token = 'zcde_' + 'a'.repeat(24);
const hash = createHash('sha256').update(token).digest('hex');
const ready = () => ({ ready: Promise.resolve(), close: vi.fn(async () => {}) });
beforeEach(() => {
  vi.resetAllMocks();
  deps.enroll.mockResolvedValue({ hostId: newId, hostKey: 'new-key' });
  deps.connect.mockImplementation(ready);
});
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(provenance?: 'tunnel' | 'non-tunnel', serverUrl: string | undefined = url) {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-enrollment-safety-')); dirs.push(dataDir);
  writeHostAuth(dataDir, { hostId: oldId, hostKey: 'old-key', hostName: 'box', serverUrl,
    enrollmentId: hash, ...(provenance ? { provenance } : {}) });
  persistHostId(dataDir, oldId);
  const snapshot = () => ['auth.json', 'host.id'].map(file => readFileSync(join(dataDir, file), 'utf8'));
  return { dataDir, snapshot, before: snapshot() };
}
it.each(['tunnel', 'non-tunnel', undefined] as const)('refuses fresh-enroll host ID mismatch, stored provenance=%s', async provenance => {
  const f = fixture(provenance);
  await expect(startEnrolledHostDaemon({ dataDir: f.dataDir, serverUrl: url, token, hostId: newId })).rejects.toThrow('replace-enrollment');
  expect(f.snapshot()).toEqual(f.before); expect(deps.enroll).not.toHaveBeenCalled(); expect(deps.connect).not.toHaveBeenCalled();
});
it.each(['tunnel', 'non-tunnel', undefined] as const)('reuses same-host auth with a fresh Connect token, stored provenance=%s', async provenance => {
  const f = fixture(provenance);
  const daemon = await startEnrolledHostDaemon({ dataDir: f.dataDir, serverUrl: url, hostId: oldId, token: 'zcde_' + 'b'.repeat(24), connectCredential: 'c'.repeat(43) });
  expect(f.snapshot()).toEqual(f.before); expect(deps.enroll).not.toHaveBeenCalled();
  expect(deps.connect).toHaveBeenCalledWith(expect.objectContaining({ hostId: oldId, hostKey: 'old-key' }));
  await daemon.close();
});
it('re-mints a fresh same-host Connect repair only after exact-server authentication rejection', async () => {
  const f = fixture('non-tunnel');
  deps.enroll.mockResolvedValueOnce({ hostId: oldId, hostKey: 'repaired-key' });
  deps.connect.mockImplementationOnce(() => ({ ready: Promise.reject(new HostAuthenticationError('rejected')), close: vi.fn(async () => {}) })).mockImplementationOnce(ready);
  const daemon = await startEnrolledHostDaemon({ dataDir: f.dataDir, serverUrl: url, hostId: oldId, token: 'zcde_' + 'b'.repeat(24), connectCredential: 'c'.repeat(43) });
  expect(deps.enroll).toHaveBeenCalledWith(expect.objectContaining({ hostId: oldId }));
  expect(readHostAuth(f.dataDir)).toMatchObject({ hostId: oldId, hostKey: 'repaired-key' });
  await daemon.close();
});
it.each(['non-tunnel', undefined] as const)('never sends old key to another loopback server, stored provenance=%s', async provenance => {
  const f = fixture(provenance);
  await expect(startEnrolledHostDaemon({ dataDir: f.dataDir, serverUrl: 'http://127.0.0.1:42000', token, provenance: 'tunnel' })).rejects.toThrow('another server');
  expect(deps.connect).not.toHaveBeenCalled(); expect(deps.enroll).not.toHaveBeenCalled(); expect(f.snapshot()).toEqual(f.before);
});
it('keeps explicit tunnel port churn and stored provenance', async () => {
  const f = fixture('tunnel');
  const daemon = await startEnrolledHostDaemon({ dataDir: f.dataDir, serverUrl: 'http://localhost:42000', hostId: oldId });
  expect(deps.enroll).not.toHaveBeenCalled(); expect(readHostAuth(f.dataDir)).toMatchObject({ provenance: 'tunnel', serverUrl: 'http://localhost:42000' });
  await daemon.close(); await daemon.close(); expect(deps.release).toHaveBeenCalledOnce();
});
it('retains exact-URL legacy repair without upgrading provenance', async () => {
  const f = fixture();
  deps.connect.mockImplementationOnce(() => ({ ready: Promise.reject(new HostAuthenticationError('rejected')), close: vi.fn(async () => {}) })).mockImplementationOnce(ready);
  const daemon = await startEnrolledHostDaemon({ dataDir: f.dataDir, serverUrl: url + '/', token, provenance: 'tunnel' });
  expect(readHostAuth(f.dataDir)).toMatchObject({ hostKey: 'new-key' });
  expect(readHostAuth(f.dataDir)?.provenance).toBeUndefined(); await daemon.close();
});
it.each(['enroll', 'hello', 'cancel'] as const)('explicit replacement preserves prior files on %s failure', async failure => {
  const f = fixture('non-tunnel'); const controller = new AbortController();
  if (failure === 'enroll') deps.enroll.mockRejectedValueOnce(new Error('enroll failed'));
  if (failure === 'hello') deps.connect.mockImplementationOnce(() => ({ ready: Promise.reject(new Error('hello failed')), close: vi.fn(async () => {}) }));
  if (failure === 'cancel') deps.enroll.mockImplementationOnce(async () => { controller.abort(); return { hostId: newId, hostKey: 'new-key' }; });
  await expect(startEnrolledHostDaemon({ dataDir: f.dataDir, serverUrl: 'https://different.example', token, hostId: newId,
    provenance: 'non-tunnel', replaceEnrollment: true, signal: controller.signal })).rejects.toThrow();
  expect(f.snapshot()).toEqual(f.before);
  expect(deps.connect.mock.calls.every(([input]) => input.hostKey !== 'old-key')).toBe(true);
});
it('explicit replacement uses only new credentials and commits after hello', async () => {
  const f = fixture();
  deps.connect.mockImplementationOnce(() => { expect(f.snapshot()).toEqual(f.before); return ready(); });
  const daemon = await startEnrolledHostDaemon({ dataDir: f.dataDir, serverUrl: 'https://different.example', token, hostId: newId,
    provenance: 'non-tunnel', replaceEnrollment: true });
  expect(deps.connect).toHaveBeenCalledWith(expect.objectContaining({ hostKey: 'new-key' }));
  expect(readHostAuth(f.dataDir)).toMatchObject({ hostId: newId, provenance: 'non-tunnel' });
  expect(readFileSync(join(f.dataDir, 'host.id'), 'utf8').trim()).toBe(newId); await daemon.close();
});
it('requires a token for explicit replacement without probing old credentials', async () => {
  const f = fixture();
  await expect(startEnrolledHostDaemon({ dataDir: f.dataDir, serverUrl: url, replaceEnrollment: true })).rejects.toThrow('token');
  expect(deps.connect).not.toHaveBeenCalled(); expect(f.snapshot()).toEqual(f.before);
});
it('does not trust a legacy enrollment without a recorded server URL', async () => {
  const f = fixture(); const auth = readHostAuth(f.dataDir)!; delete auth.serverUrl; writeHostAuth(f.dataDir, auth);
  await expect(startEnrolledHostDaemon({ dataDir: f.dataDir, serverUrl: url, token })).rejects.toThrow('another server');
  expect(deps.connect).not.toHaveBeenCalled();
});
it('relaxes only tunnel ports, not protocol or path', () => {
  expect(sameEnrolledServer(url, 'http://127.0.0.1:42000')).toBe(false);
  expect(sameEnrolledServer(url, 'http://127.0.0.1:42000', 'tunnel')).toBe(true);
  expect(sameEnrolledServer(url, 'https://127.0.0.1:42000', 'tunnel')).toBe(false);
  expect(sameEnrolledServer(url, 'http://127.0.0.1:42000/t/other', 'tunnel')).toBe(false);
});
