import { describe, expect, it } from 'vitest';
import { createEventSink } from './event-sink.js';

describe('event sink', () => {
  it('posts host events without a sequence field', async () => {
    const posted: unknown[] = [];
    const sink = createEventSink({
      isSessionOpen: () => true,
      postEvents: async (events) => {
        posted.push(...events);
      },
      debounceMs: 1
    });
    sink.emit({ threadId: '11111111-1111-4111-8111-111111111111', kind: 'thread.started' });
    await sink.flush();
    expect(posted).toEqual([
      expect.objectContaining({ kind: 'thread.started' })
    ]);
    expect(posted[0]).not.toHaveProperty('sequence');
  });

  it('retries a failed post while the session stays open', async () => {
    const posted: unknown[] = [];
    let fail = true;
    const sink = createEventSink({
      isSessionOpen: () => true,
      postEvents: async (events) => {
        if (fail) throw new Error('transient');
        posted.push(...events);
      },
      debounceMs: 1
    });
    sink.emit({ threadId: '11111111-1111-4111-8111-111111111111', kind: 'turn.completed' });
    await sink.flush();
    expect(posted).toHaveLength(0);
    fail = false;
    await sink.flush();
    expect(posted).toEqual([expect.objectContaining({ kind: 'turn.completed' })]);
  });
});
