import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeedStore, MAX_FEED_ENTRIES_PER_PROJECT, activityFile } from '../feed-store.js';
import type { FeedEventInput, Project } from '../../shared/types.js';

function project(path: string): Project {
  return {
    id: 'p1',
    name: 'Proj One',
    path,
    createdAt: 0,
    lastActiveAt: 0
  };
}

function input(over: Partial<FeedEventInput> = {}): FeedEventInput {
  return {
    projectId: 'p1',
    kind: 'commit',
    ts: 1_700_000_000_000,
    title: 'feat: a commit',
    dedupeKey: 'commit:abc',
    ...over
  };
}

describe('FeedStore', () => {
  let dir: string;
  let proj: Project;
  let store: FeedStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zcc-feed-'));
    proj = project(dir);
    store = new FeedStore((id) => (id === 'p1' ? proj : undefined));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends and lists newest-first, persisting to <project>/.zcc/activity.jsonl', async () => {
    store.append(input({ ts: 100, dedupeKey: 'a', title: 'first' }));
    store.append(input({ ts: 300, dedupeKey: 'b', title: 'third' }));
    store.append(input({ ts: 200, dedupeKey: 'c', title: 'second' }));

    const events = store.list('p1');
    expect(events.map((e) => e.title)).toEqual(['third', 'second', 'first']);

    expect(existsSync(activityFile(proj))).toBe(true);
    const raw = await readFile(activityFile(proj), 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(3);
  });

  it('is idempotent by dedupeKey — re-appending the same key is a no-op', () => {
    expect(store.append(input({ dedupeKey: 'k1' }))).not.toBeNull();
    expect(store.append(input({ dedupeKey: 'k1', title: 'changed' }))).toBeNull();
    expect(store.list('p1')).toHaveLength(1);
    expect(store.list('p1')[0]!.title).toBe('feat: a commit');
  });

  it('emits "changed" with the projectId on a real append', () => {
    const seen: string[] = [];
    store.on('changed', (id: string) => seen.push(id));
    store.append(input({ dedupeKey: 'x' }));
    store.append(input({ dedupeKey: 'x' })); // dup → no emit
    expect(seen).toEqual(['p1']);
  });

  it('appendMany batches, skips duplicates, and reports the count added', () => {
    store.append(input({ dedupeKey: 'dup', ts: 1 }));
    const added = store.appendMany('p1', [
      input({ dedupeKey: 'dup', ts: 1 }), // already present
      input({ dedupeKey: 'new1', ts: 2 }),
      input({ dedupeKey: 'new2', ts: 3 }),
      input({ dedupeKey: 'new2', ts: 3 }) // dup within the batch
    ]);
    expect(added).toBe(2);
    expect(store.list('p1')).toHaveLength(3);
  });

  it('enforces the per-project retention cap (drops oldest)', () => {
    const overflow = MAX_FEED_ENTRIES_PER_PROJECT + 25;
    const inputs = Array.from({ length: overflow }, (_, i) =>
      input({ dedupeKey: `k${i}`, ts: i, title: `c${i}` })
    );
    store.appendMany('p1', inputs);
    const events = store.list('p1');
    expect(events).toHaveLength(MAX_FEED_ENTRIES_PER_PROJECT);
    // Newest-first + capped ⇒ the highest ts survives, the lowest is dropped.
    expect(events[0]!.title).toBe(`c${overflow - 1}`);
    expect(events.some((e) => e.title === 'c0')).toBe(false);
  });

  it('reloads persisted events from disk into a fresh store instance', () => {
    store.append(input({ dedupeKey: 'persist-me', title: 'survives' }));
    const reopened = new FeedStore((id) => (id === 'p1' ? proj : undefined));
    expect(reopened.list('p1').map((e) => e.title)).toEqual(['survives']);
  });

  it('returns [] and no-ops for an unknown project', () => {
    expect(store.list('nope')).toEqual([]);
    expect(store.append(input({ projectId: 'nope' }))).toBeNull();
  });
});
