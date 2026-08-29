import { describe, it, expect } from 'vitest';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemorySuggestionsStore, createSuggestionsStore } from '@zana-ai/zcc-server';

const base = {
  projectId: 'p1',
  title: 'Run tests',
  reason: 'the branch you pushed is green',
  action: { kind: 'start-terminal' as const }
};

describe('suggestions store', () => {
  it('append + read newest-first', async () => {
    const s = createMemorySuggestionsStore();
    await s.append(base);
    await s.append({ ...base, title: 'Second' });
    const { entries } = await s.read();
    expect(entries[0].title).toBe('Second');
  });
  it('requires title + reason + action', async () => {
    const s = createMemorySuggestionsStore();
    await expect(s.append({ ...base, title: '' } as never)).rejects.toThrow();
    await expect(s.append({ projectId: 'p1', title: 'x', reason: 'y' } as never)).rejects.toThrow();
    await expect(s.append({ ...base, projectId: '' } as never)).rejects.toThrow();
    // reason is now mandatory
    await expect(
      s.append({ projectId: 'p1', title: 'x', action: base.action } as never)
    ).rejects.toThrow(/reason is required/);
  });
  it('rejects a standalone nav-only action (open-view / navigate)', async () => {
    const s = createMemorySuggestionsStore();
    await expect(
      s.append({ ...base, action: { kind: 'open-view', nav: 'inbox' } } as never)
    ).rejects.toThrow(/standalone suggestion/);
    await expect(
      s.append({ ...base, action: { kind: 'navigate', projectId: 'p1' } } as never)
    ).rejects.toThrow(/standalone suggestion/);
  });
  it('accepts a combo standalone', async () => {
    const s = createMemorySuggestionsStore();
    const e = await s.append({
      ...base,
      action: {
        kind: 'combo',
        steps: [
          { kind: 'start-agent', prompt: 'review' },
          { kind: 'open-view', nav: 'inbox' }
        ]
      }
    });
    expect(e.action.kind).toBe('combo');
  });
  it('dedupes by (projectId, dedupeKey)', async () => {
    const s = createMemorySuggestionsStore();
    await s.append({ ...base, dedupeKey: 'k' });
    await s.append({ ...base, title: 'Updated', dedupeKey: 'k' });
    const { entries } = await s.read();
    expect(entries.length).toBe(1);
    expect(entries[0].title).toBe('Updated');
    expect(entries[0].occurrences).toBe(2);
  });
  it('read-time-filters expired entries', async () => {
    let now = 1000;
    const s = createMemorySuggestionsStore(() => now);
    await s.append({ ...base, expiresAt: 1500 });
    expect((await s.read()).entries.length).toBe(1);
    now = 2000;
    expect((await s.read()).entries.length).toBe(0);
  });
  it('dismiss removes', async () => {
    const s = createMemorySuggestionsStore();
    const e = await s.append(base);
    expect(await s.delete(e.id)).toBe(true);
    expect((await s.read()).entries.length).toBe(0);
  });
  it('scopes read by projectId', async () => {
    const s = createMemorySuggestionsStore();
    await s.append(base);
    await s.append({ ...base, projectId: 'p2', title: 'Other' });
    expect((await s.read({ projectId: 'p1' })).entries.length).toBe(1);
    expect((await s.read({ projectId: 'p2' })).entries[0].title).toBe('Other');
  });

  it('JSONL store persists atomically and reads back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-suggestions-'));
    const filePath = join(dir, 'entries.jsonl');
    try {
      const s = createSuggestionsStore({ filePath });
      const e = await s.append({ ...base, title: 'Persisted' });
      const raw = await readFile(filePath, 'utf-8');
      expect(raw).toContain('Persisted');
      const { entries } = await s.read();
      expect(entries[0].id).toBe(e.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps valid entries readable when a JSONL line is malformed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-suggestions-torn-'));
    const filePath = join(dir, 'entries.jsonl');
    try {
      const store = createSuggestionsStore({ filePath });
      await store.append({ ...base, title: 'Saved' });
      await appendFile(filePath, '{"id":"torn');
      const { entries } = await store.read();
      expect(entries.map((entry) => entry.title)).toEqual(['Saved']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
