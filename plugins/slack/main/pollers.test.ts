import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlackPollers, type Dispatcher } from './pollers.js';
import { SlackLogicalError, SlackRateLimited, type ReadResult } from './web-api-client.js';
import type { InboundSlackMessage } from '../shared/types.js';
import type { ThreadRecord } from './thread-store.js';

/** A fake Slack client recording posts and serving canned reads. */
class FakeClient {
  channelMessages: InboundSlackMessage[] = [];
  threadMessages = new Map<string, InboundSlackMessage[]>();
  posts: Array<{ channel: string; parentTs: string; text: string }> = [];
  /** Queue of errors to throw on the next read (FIFO). */
  errorQueue: unknown[] = [];
  private tsSeq = 100;

  async readChannel(_channel: string, _oldest?: string): Promise<ReadResult> {
    if (this.errorQueue.length) throw this.errorQueue.shift();
    return { messages: this.channelMessages };
  }
  async readThread(_channel: string, parentTs: string, _oldest?: string): Promise<ReadResult> {
    if (this.errorQueue.length) throw this.errorQueue.shift();
    return { messages: this.threadMessages.get(parentTs) ?? [] };
  }
  async postThreadReply(channel: string, parentTs: string, text: string): Promise<string> {
    this.posts.push({ channel, parentTs, text });
    return String(++this.tsSeq);
  }
  async postMessage(): Promise<string> {
    return String(++this.tsSeq);
  }
  async addReaction(): Promise<void> {}
  async authTest() {
    return { userId: 'U1', user: 'bot', team: 'T' };
  }
}

/** A minimal thread store backed by an array. */
class FakeThreadStore {
  rows: ThreadRecord[] = [];
  removed: string[] = [];
  list(): ThreadRecord[] {
    return this.rows;
  }
  get(channel: string, parentTs: string): ThreadRecord | undefined {
    return this.rows.find((r) => r.channel === channel && r.parentTs === parentTs);
  }
  remove(channel: string, parentTs: string): void {
    this.removed.push(parentTs);
    this.rows = this.rows.filter((r) => !(r.channel === channel && r.parentTs === parentTs));
  }
}

function makePollers(opts: {
  client: FakeClient;
  store: FakeThreadStore;
  dispatcher: Dispatcher;
  now: () => number;
  onError?: (e: Error, c: string) => void;
  botPrefix?: string;
  perThreadCap?: number;
  perConversationCap?: number;
}) {
  return new SlackPollers({
    client: opts.client as never,
    threadStore: opts.store as never,
    dispatcher: opts.dispatcher,
    channel: 'C1',
    pollIntervalMs: 3000,
    authedUserId: 'U1',
    botPrefix: opts.botPrefix ?? ':robot_face:',
    perThreadCap: opts.perThreadCap,
    perConversationCap: opts.perConversationCap,
    now: opts.now,
    onError: opts.onError
  });
}

describe('SlackPollers.pollChannel', () => {
  let client: FakeClient;
  let store: FakeThreadStore;
  let dispatched: Array<{ text?: string; parentTs: string }>;
  let dispatcher: Dispatcher;

  beforeEach(() => {
    client = new FakeClient();
    store = new FakeThreadStore();
    dispatched = [];
    dispatcher = {
      dispatch: vi.fn(async (msg, _channel, parentTs) => {
        dispatched.push({ text: msg.text, parentTs });
      })
    };
  });

  it('dispatches a new authorized top-level message', async () => {
    client.channelMessages = [{ ts: '1000.1', user: 'U1', text: 'run x' }];
    const p = makePollers({ client, store, dispatcher, now: () => 1_000_000 });
    await p.pollChannel();
    expect(dispatched).toEqual([{ text: 'run x', parentTs: '1000.1' }]);
  });

  it('drops messages from unauthorized users (sender gate)', async () => {
    client.channelMessages = [{ ts: '1000.1', user: 'U2', text: 'run x' }];
    const p = makePollers({ client, store, dispatcher, now: () => 1_000_000 });
    await p.pollChannel();
    expect(dispatched).toHaveLength(0);
  });

  it('skips its own posts via the bot prefix (echo guard)', async () => {
    client.channelMessages = [{ ts: '1000.1', user: 'U1', text: ':robot_face: I did a thing' }];
    const p = makePollers({ client, store, dispatcher, now: () => 1_000_000 });
    await p.pollChannel();
    expect(dispatched).toHaveLength(0);
  });

  it('skips thread replies (those belong to pollThreads)', async () => {
    client.channelMessages = [{ ts: '1000.2', user: 'U1', text: 'reply', threadTs: '999.0' }];
    const p = makePollers({ client, store, dispatcher, now: () => 1_000_000 });
    await p.pollChannel();
    expect(dispatched).toHaveLength(0);
  });

  it('advances the cursor so the same message is not dispatched twice', async () => {
    client.channelMessages = [{ ts: '1000.1', user: 'U1', text: 'run x' }];
    const p = makePollers({ client, store, dispatcher, now: () => 1_000_000 });
    await p.pollChannel();
    await p.pollChannel();
    expect(dispatched).toHaveLength(1);
  });

  it('skips a top-level command whose ts already has a linked thread (restart dedup)', async () => {
    // Simulates a restart: the command at 1000.1 was already launched (thread
    // linked) before the crash; the 60s lookback re-reads it but must not relaunch.
    store.rows = [{ channel: 'C1', parentTs: '1000.1', sessionId: 'S1', createdAt: 0 }];
    client.channelMessages = [{ ts: '1000.1', user: 'U1', text: 'run x' }];
    const p = makePollers({ client, store, dispatcher, now: () => 1_000_000 });
    await p.pollChannel();
    expect(dispatched).toHaveLength(0);
  });
});

describe('SlackPollers.pollThreads', () => {
  it('follows replies in tracked session threads', async () => {
    const client = new FakeClient();
    const store = new FakeThreadStore();
    store.rows = [{ channel: 'C1', parentTs: 'P1', sessionId: 'S1', createdAt: 0 }];
    client.threadMessages.set('P1', [
      { ts: 'P1', user: 'U1', text: 'parent' }, // parent skipped
      { ts: '1001.0', user: 'U1', text: 'status' }
    ]);
    const dispatched: string[] = [];
    const dispatcher: Dispatcher = {
      dispatch: vi.fn(async (msg) => {
        dispatched.push(msg.text ?? '');
      })
    };
    const p = makePollers({ client, store, dispatcher, now: () => 1_000_000 });
    await p.pollThreads();
    expect(dispatched).toEqual(['status']);
  });

  it('removes a dead thread on thread_not_found', async () => {
    const client = new FakeClient();
    const store = new FakeThreadStore();
    store.rows = [{ channel: 'C1', parentTs: 'P1', sessionId: 'S1', createdAt: 0 }];
    client.errorQueue = [new SlackLogicalError('thread_not_found', 'conversations.replies')];
    const dispatcher: Dispatcher = { dispatch: vi.fn() };
    const p = makePollers({ client, store, dispatcher, now: () => 1_000_000, onError: vi.fn() });
    await p.pollThreads();
    expect(store.removed).toContain('P1');
  });
});

describe('SlackPollers circuit breakers', () => {
  it('stops polling after a 429 until the cooldown elapses', async () => {
    let now = 1_000_000;
    const client = new FakeClient();
    const readSpy = vi.spyOn(client, 'readChannel');
    client.errorQueue = [new SlackRateLimited(5)];
    const store = new FakeThreadStore();
    const dispatcher: Dispatcher = { dispatch: vi.fn() };
    const p = makePollers({ client, store, dispatcher, now: () => now, onError: vi.fn() });

    await p.pollChannel(); // throws 429, sets cooldown to now+5000
    expect(readSpy).toHaveBeenCalledTimes(1);

    now = 1_002_000; // still inside cooldown
    await p.pollChannel();
    expect(readSpy).toHaveBeenCalledTimes(1); // skipped

    now = 1_006_000; // past cooldown
    await p.pollChannel();
    expect(readSpy).toHaveBeenCalledTimes(2);
  });

  it('stops + flags misconfigured on channel_not_found (no endless retry)', async () => {
    const client = new FakeClient();
    const readSpy = vi.spyOn(client, 'readChannel');
    client.errorQueue = [new SlackLogicalError('channel_not_found', 'conversations.history')];
    const store = new FakeThreadStore();
    const dispatcher: Dispatcher = { dispatch: vi.fn() };
    const onError = vi.fn();
    const p = makePollers({ client, store, dispatcher, now: () => 1_000_000, onError });

    await p.pollChannel(); // channel_not_found → stop the loop
    expect(p.misconfiguredReason).toBe('channel_not_found');
    expect(onError.mock.calls.some((c) => c[1] === 'channel-misconfigured')).toBe(true);

    // Loop is stopped — a subsequent poll is a no-op, NOT another read.
    await p.pollChannel();
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it('trips the auth circuit after repeated auth failures and stops', async () => {
    const client = new FakeClient();
    const authErr = () => new SlackLogicalError('invalid_auth', 'conversations.history');
    client.errorQueue = [authErr(), authErr(), authErr(), authErr(), authErr()];
    const store = new FakeThreadStore();
    const dispatcher: Dispatcher = { dispatch: vi.fn() };
    const onError = vi.fn();
    const p = makePollers({ client, store, dispatcher, now: () => 1_000_000, onError });

    for (let i = 0; i < 5; i++) await p.pollChannel();

    expect(p.hasGivenUp).toBe(true);
    expect(onError.mock.calls.some((c) => c[1] === 'auth-backoff')).toBe(true);
  });

  it('resets the auth counter on a successful poll', async () => {
    const client = new FakeClient();
    client.errorQueue = [
      new SlackLogicalError('invalid_auth', 'x'),
      new SlackLogicalError('invalid_auth', 'x')
      // then success
    ];
    client.channelMessages = [];
    const store = new FakeThreadStore();
    const dispatcher: Dispatcher = { dispatch: vi.fn() };
    const p = makePollers({ client, store, dispatcher, now: () => 1_000_000, onError: vi.fn() });

    await p.pollChannel(); // fail 1
    await p.pollChannel(); // fail 2
    await p.pollChannel(); // success → reset
    await p.pollChannel(); // success
    expect(p.hasGivenUp).toBe(false);
  });
});

describe('SlackPollers tick overlap guard', () => {
  it('skips a second tick while the first is still in flight', async () => {
    const store = new FakeThreadStore();
    const dispatcher: Dispatcher = { dispatch: vi.fn() };

    // A client whose readChannel blocks on a deferred so the first tick stays
    // unresolved while we fire a second one.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let reads = 0;
    const client = {
      async readChannel(): Promise<ReadResult> {
        reads += 1;
        await gate;
        return { messages: [] };
      },
      async readThread(): Promise<ReadResult> {
        return { messages: [] };
      },
      async postThreadReply(): Promise<string> {
        return '1';
      },
      async getReactions() {
        return [];
      }
    };

    const p = makePollers({ client: client as never, store, dispatcher, now: () => 1_000_000 });

    const first = p.tickForTest(); // begins, blocks inside readChannel
    await Promise.resolve(); // let the first tick reach the await
    await p.tickForTest(); // second tick: guard should make it a no-op

    expect(reads).toBe(1); // the second tick did NOT start another read

    release();
    await first;

    // After the first cycle completes the guard is clear → a new tick runs.
    await p.tickForTest();
    expect(reads).toBe(2);
  });
});

describe('SlackPollers reply budget', () => {
  it('posts a one-time exhaustion notice past the conversation cap', async () => {
    const client = new FakeClient();
    const store = new FakeThreadStore();
    const dispatcher: Dispatcher = { dispatch: vi.fn() };
    // Cap of 1: after one reply the budget is spent.
    const p = makePollers({
      client,
      store,
      dispatcher,
      now: () => 1_000_000,
      perConversationCap: 1
    });

    // Simulate one prior reply to spend the budget.
    p.noteOwnPost('200.0');

    client.channelMessages = [{ ts: '1000.1', user: 'U1', text: 'run x' }];
    await p.pollChannel();
    // Over budget → not dispatched, a single notice posted instead.
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(client.posts.filter((p) => p.text.includes('budget exhausted'))).toHaveLength(1);

    // Next poll with a new message: still no second notice.
    client.channelMessages = [{ ts: '1000.2', user: 'U1', text: 'run y' }];
    await p.pollChannel();
    expect(client.posts.filter((p) => p.text.includes('budget exhausted'))).toHaveLength(1);
  });
});
