import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDatabase, upsertHost, destroyHost } from '@zana-ai/zcc-db';
import { proveMutualEnrollment } from './enrollment-proof.js';

const roots: string[] = [], dbs: ReturnType<typeof openDatabase>[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'enrollment-proof-')); roots.push(root);
  const db = openDatabase(join(root, 'zcc.sqlite')); dbs.push(db);
  const reciprocalHostKey = 'a'.repeat(64), outgoingHostKey = 'b'.repeat(64);
  upsertHost(db, { id: 'host-a', name: 'A', hostKeyHash: hash(reciprocalHostKey), isPrimary: false });
  return { db, localInstanceId: 'app-b', verifiedDestinationInstanceId: 'app-b', senderInstanceId: 'app-a', nonce: 'c'.repeat(48),
    outgoingHostId: 'host-b', outgoingHostKey, reciprocalHostId: 'host-a', reciprocalHostKey };
}
it('proves both existing credentials and exact verified destination, without exposing keys', () => {
  const input = fixture(), proof = proveMutualEnrollment(input);
  expect(proof.sealedProof).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(JSON.stringify(proof)).not.toContain(hash(input.reciprocalHostKey));
  expect(JSON.stringify(proof)).not.toContain(input.outgoingHostKey);
  expect(JSON.stringify(proof)).not.toContain(input.reciprocalHostKey);
});
it.each([{ verifiedDestinationInstanceId: 'app-c' }, { senderInstanceId: 'app-b' }, { outgoingHostKey: 'short' },
  { reciprocalHostKey: 'short' }, { reciprocalHostId: 'missing' }, { reciprocalHostKey: 'x'.repeat(64) }, { nonce: 'invalid' }])('rejects invalid proof inputs %j', patch => {
  expect(() => proveMutualEnrollment({ ...fixture(), ...patch })).toThrow();
});
it('proves forward-only reciprocal enrollment and denies revoked ones', () => {
  const input = fixture();
  upsertHost(input.db, { id: 'host-a', name: 'A', hostKeyHash: hash(input.reciprocalHostKey), enrollmentCapability: 'peer.forward' });
  expect(() => proveMutualEnrollment(input)).not.toThrow();
  destroyHost(input.db, 'host-a');
  expect(() => proveMutualEnrollment(input)).toThrow('reciprocal enrollment unavailable');
});
