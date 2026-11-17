import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { destroyHost, openDatabase, upsertHost, type ZccDatabase } from '@zana-ai/zcc-db';
import { writeHostAuth } from '@zana-ai/zcc-host-daemon/machine-auth';
import { desktopHostEnrollment } from './desktop-host-enrollment.js';

let dataDir: string, db: ZccDatabase;
const productInstanceId = '33333333-3333-4333-8333-333333333333';
const serverUrl = 'http://127.0.0.1:42123/';
const hostKeyHash = createHash('sha256').update('saved-key').digest('hex');
beforeEach(() => { dataDir = mkdtempSync(join(tmpdir(), 'zcc-desktop-enrollment-')); db = openDatabase(join(dataDir, 'runtime.sqlite')); });
afterEach(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
const snapshot = () => desktopHostEnrollment({ dataDir, db, productInstanceId }, serverUrl);
function host(enrollmentCapability: 'execution' | 'peer.forward' = 'execution') {
  const row = upsertHost(db, { name: 'Mac', hostKeyHash, enrollmentCapability, isPrimary: false });
  writeHostAuth(dataDir, { hostId: row.id, hostKey: 'saved-key', hostName: 'Mac', serverUrl: 'http://127.0.0.1:8780' });
  return row;
}
it('returns the persistent identity and actual listener for a fresh desktop', () => {
  expect(snapshot()).toEqual({ serverInstanceId: productInstanceId, serverUrl, host: null });
});
it('attests only the server registry record, without sending a saved key', () => {
  const row = host();
  expect(snapshot()).toEqual({ serverInstanceId: productInstanceId, serverUrl, host: { hostId: row.id, hostKeyHash } });
  expect(JSON.stringify(snapshot())).not.toContain('saved-key');
  upsertHost(db, { id: row.id, name: row.name, hostKeyHash: 'a'.repeat(64) });
  expect(snapshot().host?.hostKeyHash).toBe('a'.repeat(64));
});
it('does not attest removed or forward-only hosts', () => {
  const row = host(); destroyHost(db, row.id); expect(snapshot().host).toBeNull();
  host('peer.forward'); expect(snapshot().host).toBeNull();
});
it('does not attest a host from another server registry', () => {
  writeHostAuth(dataDir, { hostId: productInstanceId, hostKey: 'saved-key', hostName: 'Mac' });
  expect(snapshot().host).toBeNull();
});
