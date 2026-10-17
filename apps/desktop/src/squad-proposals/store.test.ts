import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SquadProposalRecord } from '@zana-ai/zcc-domain/squad-proposal';
import { createSquadProposalStore } from './store.js';

function rec(id: string, over: Partial<SquadProposalRecord> = {}): SquadProposalRecord {
  return {
    id, projectId: 'p1', proposer: { kind: 'pty', id: 's1' }, teamId: 't', goal: 'g', planning: 'provided',
    sources: [], state: 'pending', createdAt: 1, updatedAt: 1, expiresAt: 1000, ...over
  };
}
const dir = () => mkdtempSync(join(tmpdir(), 'squad-proposals-'));

describe('squad proposal store', () => {
  it('round-trips create/get/update across a new instance', async () => {
    const filePath = join(dir(), 'nested', 'squad-proposals.json');
    const a = createSquadProposalStore({ filePath, now: () => 50 });
    await a.create(rec('a'));
    const updated = await a.update('a', (r) => { r.state = 'launched'; r.executionId = 'e1'; });
    expect(updated).toMatchObject({ state: 'launched', executionId: 'e1', updatedAt: 50 });
    const b = createSquadProposalStore({ filePath });
    expect(await b.get('a')).toMatchObject({ state: 'launched', executionId: 'e1' });
    expect(await b.get('missing')).toBeUndefined();
    expect(await b.update('missing', () => undefined)).toBeUndefined();
  });

  it('serialises concurrent updates without losing one', async () => {
    const store = createSquadProposalStore({ filePath: join(dir(), 's.json') });
    await store.create(rec('a', { goal: '0' }));
    await Promise.all(Array.from({ length: 12 }, () => store.update('a', (r) => { r.goal = String(Number(r.goal) + 1); })));
    expect((await store.get('a'))?.goal).toBe('12');
  });

  it('lists only pending records of the project', async () => {
    const store = createSquadProposalStore({ filePath: join(dir(), 's.json') });
    await store.create(rec('a'));
    await store.create(rec('b', { projectId: 'p2' }));
    await store.create(rec('c', { state: 'dismissed' }));
    expect((await store.listPending('p1')).map((r) => r.id)).toEqual(['a']);
  });

  it('renames a corrupt file and starts empty', async () => {
    const d = dir();
    const filePath = join(d, 'squad-proposals.json');
    for (const bad of ['{not json', JSON.stringify({ version: 1, revision: 0, records: [{ id: 1 }] })]) {
      writeFileSync(filePath, bad);
      const store = createSquadProposalStore({ filePath, now: () => 7 });
      expect(await store.get('a')).toBeUndefined();
      expect(existsSync(filePath)).toBe(false);
      await store.create(rec('a'));
      expect((await store.get('a'))?.id).toBe('a');
    }
    expect(readdirSync(d).filter((f) => f.startsWith('squad-proposals.corrupt-'))).toHaveLength(1);
  });

  it('prunes oldest finished records first and keeps pending ones', async () => {
    const store = createSquadProposalStore({ filePath: join(dir(), 's.json'), maxRecords: 3 });
    await store.create(rec('old-pending', { createdAt: 1 }));
    await store.create(rec('done1', { createdAt: 2, state: 'dismissed' }));
    await store.create(rec('done2', { createdAt: 3, state: 'launched' }));
    await store.create(rec('new', { createdAt: 4 }));
    expect(await store.get('done1')).toBeUndefined();
    expect(await store.get('old-pending')).toBeDefined();
    await store.create(rec('p3', { createdAt: 5 }));
    await store.create(rec('p4', { createdAt: 6 }));
    // Only pending records remain: nothing may be evicted even above the cap.
    expect(await store.get('old-pending')).toBeDefined();
    expect((await store.listPending('p1')).length).toBe(4);
  });

  it('expires due pending records only', async () => {
    const store = createSquadProposalStore({ filePath: join(dir(), 's.json') });
    await store.create(rec('due', { expiresAt: 10 }));
    await store.create(rec('later', { expiresAt: 100 }));
    await store.create(rec('done', { expiresAt: 10, state: 'launched' }));
    const expired = await store.expireDue(10);
    expect(expired.map((r) => r.id)).toEqual(['due']);
    expect((await store.get('due'))?.state).toBe('expired');
    expect((await store.get('later'))?.state).toBe('pending');
    expect(await store.expireDue(10)).toEqual([]);
  });
});
