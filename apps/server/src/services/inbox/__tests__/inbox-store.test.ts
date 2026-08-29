import { describe, it, expect, beforeEach } from 'vitest';
import { appendFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createInboxStore,
  createMemoryInboxStore,
  type IInboxStore,
  type InboxEntry
} from '@zana-ai/zcc-server';

describe('InboxStore (in-memory)', () => {
  let store: IInboxStore;

  beforeEach(() => {
    store = createMemoryInboxStore();
  });

  it('append with comments only succeeds', async () => {
    const before = Date.now();
    const entry = await store.append({
      projectId: 'proj-1',
      projectLabel: 'demo-project',
      comments: 'hey, can you check the SPY chart?'
    });
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.projectId).toBe('proj-1');
    expect(entry.comments).toBe('hey, can you check the SPY chart?');
    expect(entry.docs).toBeUndefined();
    expect(entry.ts).toBeGreaterThanOrEqual(before);
  });

  it('append with docs only succeeds', async () => {
    const entry = await store.append({
      projectId: 'proj-1',
      docs: [{ path: 'research/macro-2026-05-14.md' }]
    });
    expect(entry.docs).toEqual([{ path: 'research/macro-2026-05-14.md' }]);
    expect(entry.comments).toBeUndefined();
  });

  it('append with both docs and comments succeeds', async () => {
    const entry = await store.append({
      projectId: 'proj-1',
      docs: [{ path: 'a.md' }, { path: 'b.md' }],
      comments: 'two reports, b is more interesting'
    });
    expect(entry.docs).toHaveLength(2);
    expect(entry.comments).toContain('two reports');
  });

  it('append persists an optional sessionId; absent leaves it undefined', async () => {
    const withSession = await store.append({
      projectId: 'proj-1',
      comments: 'agent in tab A',
      sessionId: 'sess-A'
    });
    expect(withSession.sessionId).toBe('sess-A');

    const without = await store.append({ projectId: 'proj-1', comments: 'no session' });
    expect(without.sessionId).toBeUndefined();
  });

  it('append rejects missing projectId', async () => {
    await expect(
      // @ts-expect-error — exercising runtime guard
      store.append({ comments: 'orphan' })
    ).rejects.toThrow(/projectId is required/);
  });

  it('append rejects when docs, comments, and question are all empty', async () => {
    await expect(store.append({ projectId: 'proj-1' })).rejects.toThrow(
      /at least one of docs, comments, or question/
    );
    await expect(
      store.append({ projectId: 'proj-1', docs: [], comments: '   ' })
    ).rejects.toThrow(/at least one of docs, comments, or question/);
  });

  it('append rejects malformed doc entries', async () => {
    await expect(
      store.append({ projectId: 'proj-1', docs: [{ path: '' }] })
    ).rejects.toThrow(/non-empty `path`/);
  });

  it('persists a structured question form on the entry', async () => {
    const entry = await store.append({
      projectId: 'proj-1',
      comments: 'Which approach?',
      question: {
        options: [
          { id: 'A', label: 'Rewrite' },
          { id: 'B', label: 'Patch in place' }
        ],
        allowOther: true
      }
    });
    expect(entry.question?.options).toHaveLength(2);
    expect(entry.question?.options[0]).toEqual({ id: 'A', label: 'Rewrite' });
    expect(entry.question?.allowOther).toBe(true);
    const { entries } = await store.read({ projectId: 'proj-1' });
    expect(entries[0].question?.options[1].label).toBe('Patch in place');
  });

  it('append rejects a question option missing id or label', async () => {
    await expect(
      store.append({
        projectId: 'proj-1',
        // @ts-expect-error — exercising runtime guard
        question: { options: [{ id: 'A' }] }
      })
    ).rejects.toThrow(/question option needs a non-empty id \+ label/);
  });

  it('a question alone (no docs/comments) is valid content', async () => {
    const entry = await store.append({
      projectId: 'proj-1',
      question: { options: [{ id: 'A', label: 'Yes' }] }
    });
    expect(entry.question?.options).toHaveLength(1);
  });

  it('read returns entries newest-first', async () => {
    await store.append({ projectId: 'proj-1', comments: 'first' });
    await store.append({ projectId: 'proj-1', comments: 'second' });
    await store.append({ projectId: 'proj-1', comments: 'third' });
    const { entries, hasMore } = await store.read();
    expect(entries.map((e) => e.comments)).toEqual(['third', 'second', 'first']);
    expect(hasMore).toBe(false);
  });

  it('read respects limit and reports hasMore', async () => {
    for (let i = 0; i < 5; i++) await store.append({ projectId: 'proj-1', comments: `n${i}` });
    const { entries, hasMore } = await store.read({ limit: 3 });
    expect(entries.map((e) => e.comments)).toEqual(['n4', 'n3', 'n2']);
    expect(hasMore).toBe(true);
  });

  it('read filters by projectId', async () => {
    await store.append({ projectId: 'proj-a', comments: 'a1' });
    await store.append({ projectId: 'proj-b', comments: 'b1' });
    await store.append({ projectId: 'proj-a', comments: 'a2' });
    const { entries } = await store.read({ projectId: 'proj-a' });
    expect(entries.map((e) => e.comments)).toEqual(['a2', 'a1']);
  });

  it('read uses `before` cursor to paginate older', async () => {
    const e1 = await store.append({ projectId: 'proj-1', comments: 'first' });
    const e2 = await store.append({ projectId: 'proj-1', comments: 'second' });
    const e3 = await store.append({ projectId: 'proj-1', comments: 'third' });
    const { entries } = await store.read({ before: e3.id, limit: 100 });
    expect(entries.map((e) => e.id)).toEqual([e2.id, e1.id]);
  });

  it('keeps valid entries readable when a JSONL line is malformed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-inbox-torn-'));
    const path = join(dir, 'entries.jsonl');
    try {
      const store = createInboxStore({ filePath: path });
      await store.append({ projectId: 'proj-1', comments: 'saved entry' });
      await appendFile(path, '{"id":"torn');
      const { entries } = await store.read();
      expect(entries.map((entry) => entry.comments)).toEqual(['saved entry']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('delete removes an entry and returns true; missing id returns false', async () => {
    const a = await store.append({ projectId: 'proj-1', comments: 'a' });
    await store.append({ projectId: 'proj-1', comments: 'b' });
    expect(await store.delete(a.id)).toBe(true);
    const { entries } = await store.read();
    expect(entries.map((e) => e.comments)).toEqual(['b']);
    expect(await store.delete('does-not-exist')).toBe(false);
    expect(await store.delete(a.id)).toBe(false);
  });

  it('deleteMany removes the listed ids, keeps the rest, returns the count', async () => {
    const a = await store.append({ projectId: 'p', comments: 'a' });
    const b = await store.append({ projectId: 'p', comments: 'b' });
    const c = await store.append({ projectId: 'p', comments: 'c' });
    const removed = await store.deleteMany([a.id, c.id]);
    expect(removed).toBe(2);
    const { entries } = await store.read();
    expect(entries.map((e) => e.id)).toEqual([b.id]);
  });

  it('deleteMany ignores unknown ids and returns 0 for an empty list', async () => {
    const a = await store.append({ projectId: 'p', comments: 'a' });
    expect(await store.deleteMany([])).toBe(0);
    expect(await store.deleteMany(['nope'])).toBe(0);
    expect(await store.deleteMany([a.id, 'nope'])).toBe(1);
  });

  it('deleteMany fires onRemoved once per actually-removed id', async () => {
    const seen: string[] = [];
    store.onRemoved((id) => seen.push(id));
    const a = await store.append({ projectId: 'p', comments: 'a' });
    const b = await store.append({ projectId: 'p', comments: 'b' });
    await store.deleteMany([a.id, b.id, 'ghost']);
    expect(seen.sort()).toEqual([a.id, b.id].sort());
  });

  it('onRemoved fires on successful delete, dispose stops further notifications', async () => {
    const seen: string[] = [];
    const dispose = store.onRemoved((id) => seen.push(id));
    const a = await store.append({ projectId: 'proj-1', comments: 'a' });
    const b = await store.append({ projectId: 'proj-1', comments: 'b' });
    await store.delete(a.id);
    await store.delete(b.id);
    expect(seen).toEqual([a.id, b.id]);
    dispose();
    const c = await store.append({ projectId: 'proj-1', comments: 'c' });
    await store.delete(c.id);
    expect(seen).toHaveLength(2);
  });

  it('onAppended fires on append, dispose stops further notifications', async () => {
    const seen: InboxEntry[] = [];
    const dispose = store.onAppended((e) => seen.push(e));
    await store.append({ projectId: 'proj-1', comments: 'a' });
    await store.append({ projectId: 'proj-1', comments: 'b' });
    expect(seen).toHaveLength(2);
    dispose();
    await store.append({ projectId: 'proj-1', comments: 'c' });
    expect(seen).toHaveLength(2);
  });

  it('coalesces repeated keyed pushes into one entry with bumped occurrences', async () => {
    const appended: InboxEntry[] = [];
    const updated: InboxEntry[] = [];
    store.onAppended((e) => appended.push(e));
    store.onUpdated((e) => updated.push(e));

    const first = await store.append({
      projectId: 'p',
      comments: 'run 1',
      scheduled: true,
      notify: 'quiet',
      origin: { claudeSessionId: 'first-conv', profile: 'claude' },
      dedupeKey: 'sched:p:t1'
    });
    const second = await store.append({
      projectId: 'p',
      comments: 'run 2',
      origin: { claudeSessionId: 'second-conv', profile: 'claude' },
      dedupeKey: 'sched:p:t1'
    });

    // Same id — folded in place, not a new row.
    expect(second.id).toBe(first.id);
    expect(second.occurrences).toBe(2);
    expect(second.comments).toBe('run 2');
    // Preserved fields from the first push survive a content-only refresh.
    expect(second.scheduled).toBe(true);
    expect(second.notify).toBe('quiet');
    // Resume target refreshes to the LATEST session that pushed under the key.
    expect(second.origin?.claudeSessionId).toBe('second-conv');

    // Only ONE entry on the feed; events split appended vs updated.
    const { entries } = await store.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].occurrences).toBe(2);
    expect(appended).toHaveLength(1);
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe(first.id);
  });

  it('does not coalesce across different keys or projects', async () => {
    await store.append({ projectId: 'p', comments: 'a', dedupeKey: 'k1' });
    await store.append({ projectId: 'p', comments: 'b', dedupeKey: 'k2' });
    await store.append({ projectId: 'q', comments: 'c', dedupeKey: 'k1' });
    const { entries } = await store.read();
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => (e.occurrences ?? 1) === 1)).toBe(true);
  });

  it('un-keyed pushes never coalesce, even with identical content', async () => {
    await store.append({ projectId: 'p', comments: 'dup' });
    await store.append({ projectId: 'p', comments: 'dup' });
    const { entries } = await store.read();
    expect(entries).toHaveLength(2);
  });

  it('coalesces THREE pushes with same dedupeKey (regression for dedupeKey preservation)', async () => {
    const first = await store.append({
      projectId: 'p',
      comments: 'run 1',
      dedupeKey: 'job:p1'
    });
    const second = await store.append({
      projectId: 'p',
      comments: 'run 2',
      dedupeKey: 'job:p1'
    });
    const third = await store.append({
      projectId: 'p',
      comments: 'run 3',
      dedupeKey: 'job:p1'
    });

    // All three should coalesce to the same ID
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(third.occurrences).toBe(3);

    // Should still be only ONE entry
    const { entries } = await store.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(first.id);
    expect(entries[0].occurrences).toBe(3);
    expect(entries[0].comments).toBe('run 3');
    expect(entries[0].dedupeKey).toBe('job:p1');
  });

  it('persists an optional subject; absent leaves it undefined', async () => {
    const withSubject = await store.append({
      projectId: 'p',
      comments: 'body',
      subject: 'Migration audit'
    });
    expect(withSubject.subject).toBe('Migration audit');
    const without = await store.append({ projectId: 'p', comments: 'no subject' });
    expect(without.subject).toBeUndefined();
  });

  it('normalizes a subject: trims, collapses newlines to one line, caps length', async () => {
    const trimmed = await store.append({ projectId: 'p', comments: 'x', subject: '  spaced  ' });
    expect(trimmed.subject).toBe('spaced');

    const multiline = await store.append({
      projectId: 'p',
      comments: 'x',
      subject: 'line one\nline two\t\tmore'
    });
    expect(multiline.subject).toBe('line one line two more');

    const huge = await store.append({ projectId: 'p', comments: 'x', subject: 'z'.repeat(500) });
    expect(huge.subject).toHaveLength(200);

    // A whitespace-only subject is dropped rather than persisted as ''.
    const blank = await store.append({ projectId: 'p', comments: 'x', subject: '   ' });
    expect(blank.subject).toBeUndefined();
  });

  it('a subject does NOT satisfy the at-least-one-content rule', async () => {
    await expect(
      store.append({ projectId: 'p', subject: 'just a heading' })
    ).rejects.toThrow(/at least one of docs, comments, or question/);
  });

  it('carries subject forward across a coalesced refresh, and a later push overrides it', async () => {
    const first = await store.append({
      projectId: 'p',
      comments: 'run 1',
      subject: 'Nightly audit',
      dedupeKey: 'sched:p:t1'
    });
    // Occurrence #2 omits subject — it must survive from occurrence #1.
    const second = await store.append({
      projectId: 'p',
      comments: 'run 2',
      dedupeKey: 'sched:p:t1'
    });
    expect(second.id).toBe(first.id);
    expect(second.subject).toBe('Nightly audit');
    // Occurrence #3 supplies its own subject — it wins.
    const third = await store.append({
      projectId: 'p',
      comments: 'run 3',
      subject: 'Nightly audit (rerun)',
      dedupeKey: 'sched:p:t1'
    });
    expect(third.subject).toBe('Nightly audit (rerun)');
  });

  it('persists + normalizes an optional intent, caps it, and never satisfies the content rule', async () => {
    const withIntent = await store.append({
      projectId: 'p',
      comments: 'body',
      intent: '  Unblock the release  cut\n(waiting on a version bump)  '
    });
    // Trimmed + newlines/runs collapsed to a single line.
    expect(withIntent.intent).toBe('Unblock the release cut (waiting on a version bump)');

    const without = await store.append({ projectId: 'p', comments: 'no intent' });
    expect(without.intent).toBeUndefined();

    // Capped at a slightly-more-generous limit than subject.
    const huge = await store.append({ projectId: 'p', comments: 'x', intent: 'z'.repeat(500) });
    expect(huge.intent).toHaveLength(280);

    // Whitespace-only intent drops to undefined rather than persisting ''.
    const blank = await store.append({ projectId: 'p', comments: 'x', intent: '   ' });
    expect(blank.intent).toBeUndefined();

    // An intent is CONTEXT, not content — it can't satisfy the at-least-one rule.
    await expect(
      store.append({ projectId: 'p', intent: 'just context' })
    ).rejects.toThrow(/at least one of docs, comments, or question/);
  });

  it('carries intent forward across a coalesced refresh, and a later push overrides it', async () => {
    const first = await store.append({
      projectId: 'p',
      comments: 'run 1',
      intent: 'Ship the migration',
      dedupeKey: 'sched:p:intent'
    });
    const second = await store.append({
      projectId: 'p',
      comments: 'run 2',
      dedupeKey: 'sched:p:intent'
    });
    expect(second.id).toBe(first.id);
    expect(second.intent).toBe('Ship the migration');
    const third = await store.append({
      projectId: 'p',
      comments: 'run 3',
      intent: 'Ship the migration (retry)',
      dedupeKey: 'sched:p:intent'
    });
    expect(third.intent).toBe('Ship the migration (retry)');
  });

  it('persists the report flag and carries it forward across a coalesced refresh', async () => {
    const first = await store.append({
      projectId: 'p',
      comments: 'run 1',
      report: true,
      dedupeKey: 'sched:p:report'
    });
    expect(first.report).toBe(true);
    // A later occurrence that omits the flag must not silently demote the entry.
    const second = await store.append({
      projectId: 'p',
      comments: 'run 2',
      dedupeKey: 'sched:p:report'
    });
    expect(second.id).toBe(first.id);
    expect(second.report).toBe(true);
  });

  it('leaves an unflagged push without a report flag', async () => {
    const entry = await store.append({ projectId: 'p', comments: 'just a status' });
    expect(entry.report).toBeUndefined();
  });
});

describe('InboxStore (JSONL persistence)', () => {
  let dir: string;
  let path: string;
  let store: IInboxStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zcc-inbox-'));
    path = join(dir, 'entries.jsonl');
    store = createInboxStore({ filePath: path });
  });

  it('persists across new store instances on the same file', async () => {
    await store.append({
      projectId: 'proj-1',
      docs: [{ path: 'report.md' }],
      comments: 'final draft'
    });
    const fresh = createInboxStore({ filePath: path });
    const { entries } = await fresh.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].docs).toEqual([{ path: 'report.md' }]);
    expect(entries[0].comments).toBe('final draft');
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a subject through serialize/parse and carries it across a coalesced refresh', async () => {
    await store.append({ projectId: 'p', comments: 'body', subject: 'Deploy status' });
    const fresh = createInboxStore({ filePath: path });
    const { entries } = await fresh.read();
    expect(entries[0].subject).toBe('Deploy status');

    // Coalesce carry-forward survives a fresh store re-read from disk too.
    await store.append({ projectId: 'p', comments: 'r1', subject: 'Nightly', dedupeKey: 'k' });
    await store.append({ projectId: 'p', comments: 'r2', dedupeKey: 'k' });
    const fresh2 = createInboxStore({ filePath: path });
    const merged = (await fresh2.read()).entries.find((e) => e.dedupeKey === 'k');
    expect(merged?.subject).toBe('Nightly');
    expect(merged?.occurrences).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty when file does not exist', async () => {
    const missing = createInboxStore({ filePath: join(dir, 'absent.jsonl') });
    const { entries, hasMore } = await missing.read();
    expect(entries).toEqual([]);
    expect(hasMore).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it('delete rewrites the JSONL atomically; missing entries do not corrupt the file', async () => {
    const a = await store.append({ projectId: 'proj-1', comments: 'a' });
    const b = await store.append({ projectId: 'proj-1', comments: 'b' });
    const c = await store.append({ projectId: 'proj-1', comments: 'c' });
    expect(await store.delete(b.id)).toBe(true);

    // Re-open from disk — verify only a and c survive, in original order.
    const fresh = createInboxStore({ filePath: path });
    const { entries } = await fresh.read();
    expect(entries.map((e) => e.id)).toEqual([c.id, a.id]);

    // Deleting a non-existent id on disk is a no-op (returns false; file
    // contents unchanged).
    expect(await store.delete('does-not-exist')).toBe(false);
    const fresh2 = createInboxStore({ filePath: path });
    const { entries: again } = await fresh2.read();
    expect(again.map((e) => e.id)).toEqual([c.id, a.id]);
    await rm(dir, { recursive: true, force: true });
  });

  it('delete leaves no tmp file on the side', async () => {
    const a = await store.append({ projectId: 'proj-1', comments: 'a' });
    await store.delete(a.id);
    const entries = await readdir(dir);
    expect(entries).toContain('entries.jsonl');
    expect(entries).not.toContain('entries.jsonl.tmp');
    await rm(dir, { recursive: true, force: true });
  });

  it('deleteMany rewrites the JSONL atomically, keeping only un-listed entries', async () => {
    const a = await store.append({ projectId: 'p', comments: 'a' });
    const b = await store.append({ projectId: 'p', comments: 'b' });
    const c = await store.append({ projectId: 'p', comments: 'c' });
    expect(await store.deleteMany([a.id, c.id])).toBe(2);
    const fresh = createInboxStore({ filePath: path });
    const { entries } = await fresh.read();
    expect(entries.map((e) => e.id)).toEqual([b.id]);
    const onDisk = await readdir(dir);
    expect(onDisk).not.toContain('entries.jsonl.tmp');
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips sessionId through the JSONL file', async () => {
    await store.append({ projectId: 'p', comments: 'from tab A', sessionId: 'sess-A' });
    await store.append({ projectId: 'p', comments: 'no session' });
    const fresh = createInboxStore({ filePath: path });
    const { entries } = await fresh.read();
    // newest-first: the session-less entry, then the one with a session.
    expect(entries[0].sessionId).toBeUndefined();
    expect(entries[1].sessionId).toBe('sess-A');
    await rm(dir, { recursive: true, force: true });
  });

  it('append writes a JSON line per entry and read parses it back', async () => {
    await store.append({ projectId: 'p', comments: 'one' });
    await store.append({ projectId: 'p', comments: 'two' });
    const fresh = createInboxStore({ filePath: path });
    const { entries } = await fresh.read();
    expect(entries.map((e) => e.comments)).toEqual(['two', 'one']);
    await rm(dir, { recursive: true, force: true });
  });

  it('coalesces keyed pushes on disk: one line, bumped occurrences, re-fronted', async () => {
    const updated: InboxEntry[] = [];
    store.onUpdated((e) => updated.push(e));
    // An un-keyed entry between two keyed ones must NOT block the coalesce,
    // and the merged entry must move to the newest position.
    const a = await store.append({ projectId: 'p', comments: 'r1', dedupeKey: 'k' });
    await store.append({ projectId: 'p', comments: 'middle' });
    await store.append({ projectId: 'p', comments: 'r2', dedupeKey: 'k' });

    // Re-open from disk: exactly two lines survive (merged keyed + middle),
    // and the merged entry is newest with occurrences=2 and the latest body.
    const fresh = createInboxStore({ filePath: path });
    const { entries } = await fresh.read();
    expect(entries.map((e) => e.comments)).toEqual(['r2', 'middle']);
    expect(entries[0].id).toBe(a.id);
    expect(entries[0].occurrences).toBe(2);
    expect(updated).toHaveLength(1);

    // No leftover tmp files from the rewrite.
    const onDisk = await readdir(dir);
    expect(onDisk.filter((f) => f.startsWith('entries.jsonl.tmp'))).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it('coalesces THREE keyed pushes on disk (regression for dedupeKey preservation)', async () => {
    const first = await store.append({
      projectId: 'p',
      comments: 'run 1',
      dedupeKey: 'job:p1'
    });
    const second = await store.append({
      projectId: 'p',
      comments: 'run 2',
      dedupeKey: 'job:p1'
    });
    const third = await store.append({
      projectId: 'p',
      comments: 'run 3',
      dedupeKey: 'job:p1'
    });

    // All three should coalesce to the same ID
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(third.occurrences).toBe(3);

    // Re-open from disk: only ONE entry with occurrences=3
    const fresh = createInboxStore({ filePath: path });
    const { entries } = await fresh.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(first.id);
    expect(entries[0].occurrences).toBe(3);
    expect(entries[0].comments).toBe('run 3');
    expect(entries[0].dedupeKey).toBe('job:p1');
    await rm(dir, { recursive: true, force: true });
  });

  it('concurrent un-awaited appends never drop the newest entries (racing compaction)', async () => {
    // Regression for the data-loss bug: with a small cap, fire many appends
    // WITHOUT awaiting each so their appendFile + compaction read-modify-write
    // cycles overlap. Pre-fix, append B's write could land mid-compaction of
    // append A, and A would rewrite from a stale snapshot — silently dropping B
    // even though B's `appended` event already fired. The in-process mutex must
    // serialize the file mutations so this can't happen.
    const cap = 5;
    const total = 30;
    // quietMaxEntries: 0 — all entries are manual (protected); isolates the
    // protected cap so the tight cap+slack bound below holds.
    const store = createInboxStore({ filePath: path, maxEntries: cap, quietMaxEntries: 0 });

    const pending = [];
    for (let i = 0; i < total; i++) {
      pending.push(store.append({ projectId: 'p', comments: `n${i}` }));
    }
    const settled = await Promise.all(pending);
    // Every append resolved with the entry it claimed to persist.
    expect(settled).toHaveLength(total);

    // Re-open from disk (no shared in-memory state) and inspect the survivors.
    const fresh = createInboxStore({ filePath: path });
    const { entries } = await fresh.read({ limit: 1000 });
    const onDiskComments = entries.map((e) => e.comments);

    // (a) The file stays bounded near the cap — compaction ran, didn't run away.
    const slack = Math.max(1, Math.floor(cap * 0.1));
    expect(entries.length).toBeGreaterThanOrEqual(cap);
    expect(entries.length).toBeLessThanOrEqual(cap + slack);

    // (a, key assertion) The NEWEST `cap` entries are ALL present, newest-first,
    // and in contiguous order — none were dropped by a racing compaction.
    const newest = [];
    for (let i = total - 1; i >= total - cap; i--) newest.push(`n${i}`);
    expect(onDiskComments.slice(0, cap)).toEqual(newest);
    // The oldest entry was legitimately evicted by retention, not lost to a race.
    expect(onDiskComments).not.toContain('n0');

    // (b) No leftover tmp files (unique-suffixed `entries.jsonl.tmp-...`).
    const filesOnDisk = await readdir(dir);
    expect(filesOnDisk).toContain('entries.jsonl');
    expect(filesOnDisk.filter((f) => f.startsWith('entries.jsonl.tmp'))).toEqual([]);

    await rm(dir, { recursive: true, force: true });
  });
});

describe('InboxStore retention cap', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zcc-inbox-cap-'));
    path = join(dir, 'entries.jsonl');
  });

  it('bounds the file near the cap and always keeps the newest entries', async () => {
    // cap 10 → slack = max(1, floor(1)) = 1 → compacts once count > 11. Amortized
    // compaction lets the file oscillate within [cap, cap+slack], so we assert
    // the BOUND (never runs away) and that the newest entries are retained —
    // not an exact length, which would pin down the amortization timing.
    // quietMaxEntries: 0 isolates the protected cap — every entry here is manual
    // (protected), so this asserts the protected tier's bound on its own.
    const store = createInboxStore({ filePath: path, maxEntries: 10, quietMaxEntries: 0 });
    for (let i = 0; i < 25; i++) await store.append({ projectId: 'p', comments: `n${i}` });

    const fresh = createInboxStore({ filePath: path });
    const { entries } = await fresh.read({ limit: 100 });
    expect(entries.length).toBeGreaterThanOrEqual(10);
    expect(entries.length).toBeLessThanOrEqual(11); // cap + slack
    // Newest-first, and the newest 10 are all present (oldest were dropped).
    expect(entries[0].comments).toBe('n24');
    const kept = entries.map((e) => e.comments);
    for (let i = 24; i >= 15; i--) expect(kept).toContain(`n${i}`);
    expect(kept).not.toContain('n0');
    await rm(dir, { recursive: true, force: true });
  });

  it('lets the file overshoot the cap by the slack before trimming (amortized)', async () => {
    // cap 10, slack 1 → threshold 11. Exactly 11 appends must NOT trigger a
    // compaction yet (overshoot is allowed); the 12th does.
    const store = createInboxStore({ filePath: path, maxEntries: 10, quietMaxEntries: 0 });
    for (let i = 0; i < 11; i++) await store.append({ projectId: 'p', comments: `n${i}` });
    let onDisk = (await createInboxStore({ filePath: path }).read({ limit: 100 })).entries;
    expect(onDisk).toHaveLength(11);

    await store.append({ projectId: 'p', comments: 'n11' });
    onDisk = (await createInboxStore({ filePath: path }).read({ limit: 100 })).entries;
    expect(onDisk).toHaveLength(10);
    expect(onDisk[0].comments).toBe('n11');
    await rm(dir, { recursive: true, force: true });
  });

  it('maxEntries <= 0 disables retention (unbounded)', async () => {
    const store = createInboxStore({ filePath: path, maxEntries: 0 });
    for (let i = 0; i < 50; i++) await store.append({ projectId: 'p', comments: `n${i}` });
    const { entries } = await createInboxStore({ filePath: path }).read({ limit: 1000 });
    expect(entries).toHaveLength(50);
    await rm(dir, { recursive: true, force: true });
  });

  it('seeds its count from an existing file so a fresh process still trims', async () => {
    // Pre-fill past the cap with one store, then open a SECOND store (fresh
    // in-memory hint = null) and append once: it must measure from disk and
    // compact, not assume an empty file.
    const seed = createInboxStore({ filePath: path, maxEntries: 1000 }); // no trim
    for (let i = 0; i < 20; i++) await seed.append({ projectId: 'p', comments: `s${i}` });

    const reopened = createInboxStore({ filePath: path, maxEntries: 10, quietMaxEntries: 0 });
    await reopened.append({ projectId: 'p', comments: 'newest' });

    const { entries } = await createInboxStore({ filePath: path }).read({ limit: 100 });
    expect(entries).toHaveLength(10);
    expect(entries[0].comments).toBe('newest');
    await rm(dir, { recursive: true, force: true });
  });

  it('leaves no tmp file after a compaction', async () => {
    const store = createInboxStore({ filePath: path, maxEntries: 5, quietMaxEntries: 0 });
    for (let i = 0; i < 30; i++) await store.append({ projectId: 'p', comments: `n${i}` });
    const onDisk = await readdir(dir);
    expect(onDisk).toContain('entries.jsonl');
    expect(onDisk).not.toContain('entries.jsonl.tmp');
    await rm(dir, { recursive: true, force: true });
  });
});

describe('InboxStore tiered retention', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zcc-inbox-tier-'));
    path = join(dir, 'entries.jsonl');
  });

  const quiet = (comments: string) => ({
    projectId: 'p',
    comments,
    scheduled: true,
    notify: 'quiet' as const
  });

  it('a flood of quiet notices never evicts a protected (manual) entry', async () => {
    // Seed a known mix with retention OFF (no trim), then reopen with tiered
    // caps and append ONCE to force exactly one compaction — deterministic, no
    // amortization-timing guesswork. One protected entry + a flood of quiet.
    const seed = createInboxStore({ filePath: path, maxEntries: 0 });
    const important = await seed.append({ projectId: 'p', comments: 'BLOCKED: need input' });
    for (let i = 0; i < 40; i++) await seed.append(quiet(`run ${i}`));

    const store = createInboxStore({ filePath: path, maxEntries: 3, quietMaxEntries: 2 });
    await store.append(quiet('run 40')); // hint seeds from disk (42) > threshold → compact

    const { entries } = await createInboxStore({ filePath: path }).read({ limit: 100 });
    const ids = entries.map((e) => e.id);
    // The protected entry survived the flood — the whole point of tiering.
    expect(ids).toContain(important.id);
    // Quiet tier trimmed to exactly its own cap (2), independent of the flood…
    const quietKept = entries.filter((e) => e.scheduled && e.notify !== 'loud');
    expect(quietKept).toHaveLength(2);
    // …and they're the NEWEST two quiet notices.
    expect(quietKept.map((e) => e.comments).sort()).toEqual(['run 39', 'run 40'].sort());
    await rm(dir, { recursive: true, force: true });
  });

  it('caps the two tiers independently and keeps the newest of each', async () => {
    // Seed an interleaved mix with retention off, then force one compaction.
    const seed = createInboxStore({ filePath: path, maxEntries: 0 });
    await seed.append({ projectId: 'p', comments: 'm0' });
    await seed.append(quiet('q0'));
    await seed.append({ projectId: 'p', comments: 'm1' });
    await seed.append(quiet('q1'));
    await seed.append({ projectId: 'p', comments: 'm2' });
    await seed.append(quiet('q2'));

    const store = createInboxStore({ filePath: path, maxEntries: 2, quietMaxEntries: 2 });
    await store.append({ projectId: 'p', comments: 'm3' }); // 7 lines on disk → compact

    const { entries } = await createInboxStore({ filePath: path }).read({ limit: 100 });
    const comments = entries.map((e) => e.comments).sort();
    // Newest 2 protected (m2,m3) + newest 2 quiet (q1,q2) survive; m0,m1,q0 gone.
    expect(comments).toEqual(['m2', 'm3', 'q1', 'q2'].sort());
    await rm(dir, { recursive: true, force: true });
  });

  it('emits onPruned with the ids retention evicted', async () => {
    const seed = createInboxStore({ filePath: path, maxEntries: 0 });
    const m0 = await seed.append({ projectId: 'p', comments: 'm0' });
    const m1 = await seed.append({ projectId: 'p', comments: 'm1' });
    await seed.append({ projectId: 'p', comments: 'm2' });

    const store = createInboxStore({ filePath: path, maxEntries: 2, quietMaxEntries: 0 });
    const pruned: string[][] = [];
    store.onPruned((ids) => pruned.push(ids));
    await store.append({ projectId: 'p', comments: 'm3' }); // 4 lines, cap 2 → evict m0,m1

    expect(pruned).toHaveLength(1);
    expect(pruned[0].sort()).toEqual([m0.id, m1.id].sort());
    await rm(dir, { recursive: true, force: true });
  });

  it('a loud scheduled entry is protected, not counted against the quiet cap', async () => {
    const seed = createInboxStore({ filePath: path, maxEntries: 0 });
    const loud = await seed.append({
      projectId: 'p',
      comments: 'LOUD alert',
      scheduled: true,
      notify: 'loud'
    });
    for (let i = 0; i < 20; i++) await seed.append(quiet(`q${i}`));

    const store = createInboxStore({ filePath: path, maxEntries: 5, quietMaxEntries: 1 });
    await store.append(quiet('q20')); // 22 lines → compact

    const { entries } = await createInboxStore({ filePath: path }).read({ limit: 100 });
    // The loud entry survived (protected tier), despite a quiet flood + cap of 1.
    expect(entries.map((e) => e.id)).toContain(loud.id);
    // Quiet tier trimmed to exactly 1; the loud one is NOT counted against it —
    // it lives in the protected tier.
    expect(entries.filter((e) => e.notify === 'quiet')).toHaveLength(1);
    await rm(dir, { recursive: true, force: true });
  });
});
