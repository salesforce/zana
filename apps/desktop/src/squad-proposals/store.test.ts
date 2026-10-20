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

  it.each([
    ['a source without its byte count', { sources: [{ path: '/p/plan.md', relPath: 'plan.md' }] }],
    ['a source with a negative size', { sources: [{ path: '/p/plan.md', relPath: 'plan.md', bytes: -1 }] }],
    ['a plan step without dependencies', { planSteps: [{ id: 'u1', title: 'One', writeScope: [] }] }],
    ['a proposer without an id', { proposer: { kind: 'pty' } }],
    ['a launched record without its execution', { state: 'launched' }],
    ['an empty goal', { goal: '' }],
    ['a non-finite timestamp', { expiresAt: null }]
  ])('treats a ledger holding %s as damaged', async (_name, patch) => {
    const d = dir();
    const filePath = join(d, 'squad-proposals.json');
    writeFileSync(filePath, JSON.stringify({ version: 1, revision: 0, records: [rec('ok'), { ...rec('bad'), ...patch }] }));
    const store = createSquadProposalStore({ filePath, now: () => 9 });
    expect(await store.get('ok')).toBeUndefined();
    expect(readdirSync(d)).toContain('squad-proposals.corrupt-9.json');
  });

  it('keeps records written under other input caps (a later release or a downgrade)', async () => {
    const filePath = join(dir(), 'squad-proposals.json');
    const sources = Array.from({ length: 20 }, (_, i) => ({ path: `/p/f${i}.md`, relPath: `f${i}.md`, bytes: 5 * 1024 * 1024 }));
    writeFileSync(filePath, JSON.stringify({ version: 1, revision: 0, records: [rec('a', { goal: 'x'.repeat(5000), title: 'y'.repeat(600), sources })] }));
    expect(await createSquadProposalStore({ filePath }).get('a')).toMatchObject({ id: 'a' });
  });

  it('keeps a ledger whose records carry keys this version does not know', async () => {
    const filePath = join(dir(), 'squad-proposals.json');
    writeFileSync(filePath, JSON.stringify({ version: 1, revision: 0, records: [{ ...rec('a'), futureField: { x: 1 } }] }));
    expect(await createSquadProposalStore({ filePath }).get('a')).toMatchObject({ id: 'a', futureField: { x: 1 } });
  });

  it('refuses to write a record that would damage the ledger, and keeps the others', async () => {
    const store = createSquadProposalStore({ filePath: join(dir(), 's.json') });
    await store.create(rec('a'));
    await expect(store.create(rec('b', { sources: [{ path: '', relPath: '', bytes: 0 }] }))).rejects.toThrow('invalid squad proposal record b');
    await expect(store.update('a', (r) => { r.state = 'launched'; })).rejects.toThrow('invalid squad proposal record a');
    expect(await store.get('a')).toMatchObject({ state: 'pending' });
    expect(await store.get('b')).toBeUndefined();
  });

  it('prunes oldest finished records first and keeps pending ones', async () => {
    const store = createSquadProposalStore({ filePath: join(dir(), 's.json'), maxRecords: 3 });
    await store.create(rec('old-pending', { createdAt: 1 }));
    await store.create(rec('done1', { createdAt: 2, state: 'dismissed' }));
    await store.create(rec('done2', { createdAt: 3, state: 'launched', executionId: 'e2' }));
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
    await store.create(rec('done', { expiresAt: 10, state: 'launched', executionId: 'e1' }));
    const expired = await store.expireDue(10);
    expect(expired.map((r) => r.id)).toEqual(['due']);
    expect((await store.get('due'))?.state).toBe('expired');
    expect((await store.get('later'))?.state).toBe('pending');
    expect(await store.expireDue(10)).toEqual([]);
  });
});
