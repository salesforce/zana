import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createAgentMessageLog,
  AGENT_MESSAGE_MAX_MESSAGES,
  type IAgentMessageLog
} from './agent-message-log.js';

// The trim slack isn't exported (private impl detail); mirror its value here so
// the tests can drive the log just past the trim threshold deterministically.
const TRIM_SLACK = 500;

function base(to: string, body: string, from = 'sess-A') {
  return {
    fromSessionId: from,
    fromHandle: from === 'sess-A' ? 'reviewer' : from,
    toSessionId: to,
    toHandle: to,
    projectId: 'p1',
    body
  };
}

describe('AgentMessageLog', () => {
  let log: IAgentMessageLog;

  beforeEach(() => {
    log = createAgentMessageLog();
  });

  it('append stamps id + ts and leaves a message undelivered by default', () => {
    const before = Date.now();
    const m = log.append(base('sess-B', 'hello'));
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.ts).toBeGreaterThanOrEqual(before);
    expect(m.deliveredAt).toBeUndefined();
    expect(m.body).toBe('hello');
  });

  it('append can mark a message delivered up front (synchronous inject)', () => {
    const m = log.append({ ...base('sess-B', 'hi'), deliveredAt: Date.now() });
    expect(m.deliveredAt).toBeDefined();
    // ...so it should NOT come back from a pull.
    expect(log.pull('sess-B')).toHaveLength(0);
  });

  it('pull returns only undelivered messages for the target, oldest first', () => {
    log.append(base('sess-B', 'one'));
    log.append(base('sess-C', 'not yours'));
    log.append(base('sess-B', 'two'));
    const pending = log.pull('sess-B');
    expect(pending.map((m) => m.body)).toEqual(['one', 'two']);
  });

  it('markDelivered drains messages from subsequent pulls', () => {
    const m1 = log.append(base('sess-B', 'one'));
    log.append(base('sess-B', 'two'));
    log.markDelivered([m1.id]);
    expect(log.pull('sess-B').map((m) => m.body)).toEqual(['two']);
  });

  it('pull honors a since cursor', () => {
    const m1 = log.append(base('sess-B', 'one'));
    log.append(base('sess-B', 'two'));
    expect(log.pull('sess-B', m1.id).map((m) => m.body)).toEqual(['two']);
  });

  it('history returns everything (delivered or not), scoped by project', () => {
    const m1 = log.append(base('sess-B', 'one'));
    log.append({ ...base('sess-B', 'other-proj'), projectId: 'p2' });
    log.markDelivered([m1.id]);
    expect(log.history('p1').map((m) => m.body)).toEqual(['one']); // includes delivered
    expect(log.history('p2').map((m) => m.body)).toEqual(['other-proj']);
    expect(log.history()).toHaveLength(2);
  });

  it('prune drops messages older than maxAge, keeps newer, and reports removed ids', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-16T10:00:00Z'));
      const old1 = log.append(base('sess-B', 'old-one'));
      const old2 = log.append(base('sess-C', 'old-two'));
      // 90 minutes later, two fresh messages and a 1h prune.
      vi.setSystemTime(new Date('2026-06-16T11:30:00Z'));
      log.append(base('sess-B', 'fresh-one'));
      log.append(base('sess-B', 'fresh-two'));

      const removed = log.prune(60 * 60 * 1000); // 1h
      expect(new Set(removed)).toEqual(new Set([old1.id, old2.id]));
      expect(log.history().map((m) => m.body)).toEqual(['fresh-one', 'fresh-two']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('prune is a no-op (no event, empty result) when nothing is stale', () => {
    log.append(base('sess-B', 'one'));
    const pruned: string[][] = [];
    log.onPruned((ids) => pruned.push(ids));
    expect(log.prune(60 * 60 * 1000)).toEqual([]);
    expect(pruned).toHaveLength(0);
    expect(log.prune(0)).toEqual([]); // disabled retention
  });

  it('onPruned fires with the removed ids and unsubscribes cleanly', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-16T10:00:00Z'));
      const m = log.append(base('sess-B', 'old'));
      const seen: string[][] = [];
      const dispose = log.onPruned((ids) => seen.push(ids));
      vi.setSystemTime(new Date('2026-06-16T12:00:00Z'));
      log.prune(60 * 60 * 1000);
      expect(seen).toEqual([[m.id]]);
      dispose();
      vi.setSystemTime(new Date('2026-06-16T13:00:00Z'));
      log.append(base('sess-B', 'newer-but-now-old'));
      vi.setSystemTime(new Date('2026-06-16T15:00:00Z'));
      log.prune(60 * 60 * 1000);
      expect(seen).toEqual([[m.id]]); // no more after dispose
    } finally {
      vi.useRealTimers();
    }
  });

  it('count cap trims to exactly the newest MAX_MESSAGES past the trim threshold, dropping the oldest', () => {
    const pruned: string[][] = [];
    log.onPruned((ids) => pruned.push(ids));

    // Append one past the trim threshold (MAX + SLACK) to trigger a single trim.
    const total = AGENT_MESSAGE_MAX_MESSAGES + TRIM_SLACK + 1;
    const appended = [];
    for (let i = 0; i < total; i += 1) {
      appended.push(log.append(base('sess-B', `m${i}`)));
    }

    const history = log.history();
    // Exactly MAX_MESSAGES newest remain.
    expect(history).toHaveLength(AGENT_MESSAGE_MAX_MESSAGES);
    expect(history[0].body).toBe(`m${total - AGENT_MESSAGE_MAX_MESSAGES}`);
    expect(history[history.length - 1].body).toBe(`m${total - 1}`);

    // The trim fired once and evicted exactly the oldest overflow ids, in order.
    const overflow = total - AGENT_MESSAGE_MAX_MESSAGES; // TRIM_SLACK + 1
    expect(pruned).toHaveLength(1);
    expect(pruned[0]).toEqual(appended.slice(0, overflow).map((m) => m.id));
  });

  it('does not prune while at or below the trim threshold (no pruned event)', () => {
    const pruned: string[][] = [];
    log.onPruned((ids) => pruned.push(ids));

    // Right at the threshold (MAX + SLACK) — the guard is strictly greater-than.
    for (let i = 0; i < AGENT_MESSAGE_MAX_MESSAGES + TRIM_SLACK; i += 1) {
      log.append(base('sess-B', `m${i}`));
    }
    expect(pruned).toHaveLength(0);
    expect(log.history()).toHaveLength(AGENT_MESSAGE_MAX_MESSAGES + TRIM_SLACK);
  });

  it('after a cap-trim, pull with a since-cursor that was trimmed away returns all undelivered messages', () => {
    const total = AGENT_MESSAGE_MAX_MESSAGES + TRIM_SLACK + 1;
    // The first appended message is guaranteed to be evicted by the trim.
    const firstEvicted = log.append(base('sess-B', 'evicted-cursor'));
    for (let i = 1; i < total; i += 1) {
      log.append(base('sess-B', `m${i}`));
    }
    // The cursor id no longer exists → fallback returns ALL undelivered for target.
    const pending = log.pull('sess-B', firstEvicted.id);
    expect(pending).toHaveLength(AGENT_MESSAGE_MAX_MESSAGES);
    // ...identical to a cursorless pull (nothing silently dropped).
    expect(pending.map((m) => m.id)).toEqual(log.pull('sess-B').map((m) => m.id));
  });

  it('onAppended fires per append and unsubscribes cleanly', () => {
    const seen: string[] = [];
    const dispose = log.onAppended((m) => seen.push(m.body));
    log.append(base('sess-B', 'one'));
    log.append(base('sess-B', 'two'));
    expect(seen).toEqual(['one', 'two']);
    dispose();
    log.append(base('sess-B', 'three'));
    expect(seen).toEqual(['one', 'two']); // no more after dispose
  });
});
