/**
 * Tests for slack main module — notification formatting and fetch logic.
 */

import { describe, it, expect, vi } from 'vitest';
import type { MainModuleContext, BrokeredFetchResponse } from '@zana-ai/zcc-extension-sdk/main';
import { slackMainModule } from './slack-main.js';
import { DEFAULT_SLACK_CONFIG } from '../shared/types.js';

describe('slack main module', () => {
  it('exports a MainModule with id "slack"', () => {
    expect(slackMainModule.id).toBe('slack');
    expect(typeof slackMainModule.setup).toBe('function');
  });

  it('notify sends via webhook when configured', async () => {
    const mockFetch = vi.fn<
      Parameters<NonNullable<MainModuleContext['fetch']>>,
      Promise<BrokeredFetchResponse>
    >();
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      headers: {},
      body: 'ok'
    });

    const mockStorage = {
      get: vi.fn().mockResolvedValue({
        ...DEFAULT_SLACK_CONFIG,
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL'
      }),
      set: vi.fn()
    };

    const ctx: MainModuleContext = {
      storage: mockStorage,
      log: vi.fn(),
      fetch: mockFetch
    };

    const caps = await slackMainModule.setup(ctx);
    const result = await caps.notify('Test notification');

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('https://hooks.slack.com/services/TEST/WEBHOOK/URL', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Test notification' })
    });
  });

  it('notify fails gracefully when webhook returns non-200', async () => {
    const mockFetch = vi.fn<
      Parameters<NonNullable<MainModuleContext['fetch']>>,
      Promise<BrokeredFetchResponse>
    >();
    mockFetch.mockResolvedValue({
      status: 500,
      ok: false,
      headers: {},
      body: 'Internal Server Error'
    });

    const mockStorage = {
      get: vi.fn().mockResolvedValue({
        ...DEFAULT_SLACK_CONFIG,
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL'
      }),
      set: vi.fn()
    };

    const ctx: MainModuleContext = {
      storage: mockStorage,
      log: vi.fn(),
      fetch: mockFetch
    };

    const caps = await slackMainModule.setup(ctx);
    const result = await caps.notify('Test notification');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  it('notify rejects empty messages', async () => {
    const ctx: MainModuleContext = {
      storage: { get: vi.fn(), set: vi.fn() },
      log: vi.fn(),
      fetch: vi.fn()
    };

    const caps = await slackMainModule.setup(ctx);
    const result = await caps.notify('');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Empty message');
  });

  it('testConnection sends a ping message', async () => {
    const mockFetch = vi.fn<
      Parameters<NonNullable<MainModuleContext['fetch']>>,
      Promise<BrokeredFetchResponse>
    >();
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      headers: {},
      body: 'ok'
    });

    const mockStorage = {
      get: vi.fn().mockResolvedValue({
        ...DEFAULT_SLACK_CONFIG,
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL'
      }),
      set: vi.fn()
    };

    const ctx: MainModuleContext = {
      storage: mockStorage,
      log: vi.fn(),
      fetch: mockFetch
    };

    const caps = await slackMainModule.setup(ctx);
    const result = await caps.testConnection();

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
      expect.objectContaining({
        method: 'POST'
      })
    );
    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1]?.body ?? '{}');
    expect(body.text).toContain('test notification');
  });

  it('throws when ctx.fetch is unavailable', async () => {
    const ctx: MainModuleContext = {
      storage: { get: vi.fn(), set: vi.fn() },
      log: vi.fn()
      // no fetch capability
    };

    await expect(() => slackMainModule.setup(ctx)).toThrow('ctx.fetch capability is unavailable');
  });

  describe('live bot lifecycle', () => {
    const ctxWith = (config: unknown): MainModuleContext => ({
      storage: { get: vi.fn().mockResolvedValue(config), set: vi.fn() },
      log: vi.fn(),
      fetch: vi.fn().mockResolvedValue({ status: 200, ok: true, headers: {}, body: '{"ok":true}' })
    });

    it('exposes bot capabilities and reports stopped by default', async () => {
      const caps = await slackMainModule.setup(ctxWith({ ...DEFAULT_SLACK_CONFIG }));
      expect(typeof caps.startBot).toBe('function');
      expect(typeof caps.stopBot).toBe('function');
      expect(typeof caps.botStatus).toBe('function');
      const status = (await caps.botStatus()) as { running: boolean };
      expect(status.running).toBe(false);
    });

    it('web transport refuses without a bot token', async () => {
      const caps = await slackMainModule.setup(
        ctxWith({
          ...DEFAULT_SLACK_CONFIG,
          bot: { ...DEFAULT_SLACK_CONFIG.bot, enabled: true, transport: 'web' }
        })
      );
      const res = (await caps.startBot()) as { ok: boolean; error?: string };
      expect(res.ok).toBe(false);
      expect(res.error).toContain('bot token');
    });

    it('web transport starts with full config, then stopBot stops it', async () => {
      const caps = await slackMainModule.setup(
        ctxWith({
          ...DEFAULT_SLACK_CONFIG,
          botToken: 'xoxb-test',
          bot: {
            ...DEFAULT_SLACK_CONFIG.bot,
            enabled: true,
            transport: 'web',
            channelId: 'C1',
            authedUserId: 'U1'
          }
        })
      );
      const started = (await caps.startBot()) as { ok: boolean };
      expect(started.ok).toBe(true);
      expect(((await caps.botStatus()) as { running: boolean }).running).toBe(true);
      await caps.stopBot();
      expect(((await caps.botStatus()) as { running: boolean }).running).toBe(false);
    });

    it('mcp transport starts WITHOUT a bot token (reuses the gateway)', async () => {
      const caps = await slackMainModule.setup(
        ctxWith({
          ...DEFAULT_SLACK_CONFIG,
          // no botToken
          bot: {
            ...DEFAULT_SLACK_CONFIG.bot,
            enabled: true,
            transport: 'mcp',
            channelId: 'C1',
            authedUserId: 'U1'
          }
        })
      );
      const started = (await caps.startBot()) as { ok: boolean; error?: string };
      expect(started.ok).toBe(true); // no "bot token required" gate on the mcp path
      await caps.stopBot();
    });

    it('drainPendingLaunches starts empty', async () => {
      const caps = await slackMainModule.setup(ctxWith({ ...DEFAULT_SLACK_CONFIG }));
      expect(await caps.drainPendingLaunches()).toEqual([]);
    });
  });

  describe('Phase 2: session lifecycle → thread', () => {
    /** A started bot with one linked thread (channel C1, parent P1, session S1). */
    async function startedBotWithThread(
      summarizeSession?: MainModuleContext['summarizeSession']
    ) {
      const fetch = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: {}, body: '{"ok":true,"ts":"9.9"}' });
      const ctx: MainModuleContext = {
        storage: {
          get: vi.fn().mockResolvedValue({
            ...DEFAULT_SLACK_CONFIG,
            botToken: 'xoxb-test',
            bot: { ...DEFAULT_SLACK_CONFIG.bot, enabled: true, transport: 'web', channelId: 'C1', authedUserId: 'U1' }
          }),
          set: vi.fn()
        },
        log: vi.fn(),
        fetch,
        summarizeSession
      };
      const caps = await slackMainModule.setup(ctx);
      await caps.startBot();
      await caps.recordLaunchedSession('launch-1', 'S1', 'C1', 'P1');
      // Posts from the bot go to chat.postMessage; isolate those.
      const postMessages = () =>
        fetch.mock.calls
          .filter((c) => String(c[0]).endsWith('/chat.postMessage'))
          .map((c) => JSON.parse(c[1].body));
      return { caps, postMessages };
    }

    it('posts into the session thread when a bot session blocks', async () => {
      const { caps, postMessages } = await startedBotWithThread();
      const res = (await caps.sessionEvent('blocked', 'S1')) as { handled: boolean };
      expect(res.handled).toBe(true);
      const posts = postMessages();
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ channel: 'C1', thread_ts: 'P1' });
      expect(posts[0].text).toContain('needs your input');
      expect(posts[0].text).toContain(':robot_face:'); // prefix stamped (anti-echo)
    });

    it('coalesces repeated blocked events while the prompt is unanswered', async () => {
      const { caps, postMessages } = await startedBotWithThread();
      await caps.sessionEvent('blocked', 'S1');
      await caps.sessionEvent('blocked', 'S1');
      expect(postMessages()).toHaveLength(1); // same open prompt → one post

      // Exit clears the open approval, posts a finished notice, AND drops the
      // thread link (the session is gone — see M6 cleanup).
      await caps.sessionEvent('exit', 'S1', { code: 0 });
      const posts = postMessages();
      expect(posts).toHaveLength(2);
      expect(posts[1].text).toContain('finished');
      expect(posts[1].text).toContain(':white_check_mark:');

      // A blocked after exit is for a now-unlinked (dead) session → no post.
      const res = (await caps.sessionEvent('blocked', 'S1')) as { handled: boolean };
      expect(res.handled).toBe(false);
      expect(postMessages()).toHaveLength(2);
    });

    it('marks a non-zero exit with the error icon', async () => {
      const { caps, postMessages } = await startedBotWithThread();
      await caps.sessionEvent('exit', 'S1', { code: 1 });
      const posts = postMessages();
      expect(posts[0].text).toContain(':x:');
      expect(posts[0].text).toContain('exit 1');
    });

    it('does NOT handle a session it did not launch', async () => {
      const { caps, postMessages } = await startedBotWithThread();
      const res = (await caps.sessionEvent('blocked', 'UNKNOWN')) as { handled: boolean };
      expect(res.handled).toBe(false);
      expect(postMessages()).toHaveLength(0);
    });

    it('does not handle events when the bot is stopped', async () => {
      const caps = await slackMainModule.setup({
        storage: { get: vi.fn().mockResolvedValue({ ...DEFAULT_SLACK_CONFIG }), set: vi.fn() },
        log: vi.fn(),
        fetch: vi.fn().mockResolvedValue({ status: 200, ok: true, headers: {}, body: '{"ok":true}' })
      });
      const res = (await caps.sessionEvent('blocked', 'S1')) as { handled: boolean };
      expect(res.handled).toBe(false);
    });

    it('relays an LLM turn summary into the thread on the first idle edge', async () => {
      const summarize = vi.fn(async () => ({ ok: true, text: 'Finished the refactor. Delete the old file?' }));
      const { caps, postMessages } = await startedBotWithThread(summarize);
      const res = (await caps.sessionEvent('idle', 'S1')) as { handled: boolean };
      expect(res.handled).toBe(true);
      expect(summarize).toHaveBeenCalledWith('S1', { scope: 'lastTurn' });
      const posts = postMessages();
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ channel: 'C1', thread_ts: 'P1' });
      expect(posts[0].text).toContain('Finished the refactor. Delete the old file?');
      expect(posts[0].text).toContain(':robot_face:'); // prefix stamped by postBotReply
    });

    it('skips a duplicate same-turn idle (dedup on the summary signature)', async () => {
      const summarize = vi.fn(async () => ({ ok: true, text: 'Same turn summary.' }));
      const { caps, postMessages } = await startedBotWithThread(summarize);
      await caps.sessionEvent('idle', 'S1');
      await caps.sessionEvent('idle', 'S1');
      expect(postMessages()).toHaveLength(1); // identical summary → one post
    });

    it('relays a genuinely new turn (different summary) again', async () => {
      const summarize = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, text: 'First turn.' })
        .mockResolvedValueOnce({ ok: true, text: 'Second, different turn.' });
      const { caps, postMessages } = await startedBotWithThread(summarize);
      await caps.sessionEvent('idle', 'S1');
      await caps.sessionEvent('idle', 'S1');
      expect(postMessages()).toHaveLength(2);
    });

    it('posts nothing when the summarizer returns {ok:false}', async () => {
      const summarize = vi.fn(async () => ({ ok: false }));
      const { caps, postMessages } = await startedBotWithThread(summarize);
      const res = (await caps.sessionEvent('idle', 'S1')) as { handled: boolean };
      expect(res.handled).toBe(true); // a bot session — handled, just nothing to say
      expect(postMessages()).toHaveLength(0);
    });

    it('does not relay idle for a session it did not launch', async () => {
      const summarize = vi.fn(async () => ({ ok: true, text: 'irrelevant' }));
      const { caps, postMessages } = await startedBotWithThread(summarize);
      const res = (await caps.sessionEvent('idle', 'UNKNOWN')) as { handled: boolean };
      expect(res.handled).toBe(false);
      expect(summarize).not.toHaveBeenCalled();
      expect(postMessages()).toHaveLength(0);
    });

    it('clears dedup state on exit so a relaunched/repeated turn relays again', async () => {
      const summarize = vi.fn(async () => ({ ok: true, text: 'Recurring summary.' }));
      const { caps, postMessages } = await startedBotWithThread(summarize);
      await caps.sessionEvent('idle', 'S1');
      expect(postMessages().filter((p) => p.text.includes('Recurring summary.'))).toHaveLength(1);
      await caps.sessionEvent('exit', 'S1', { code: 0 }); // clears relayedSig + thread link
      // Re-link the (same id) thread as if relaunched, then the same summary relays again.
      await caps.recordLaunchedSession('launch-2', 'S1', 'C1', 'P1');
      await caps.sessionEvent('idle', 'S1');
      expect(postMessages().filter((p) => p.text.includes('Recurring summary.'))).toHaveLength(2);
    });

    it('no-ops idle when no summarizer was wired (degrades safely)', async () => {
      const { caps, postMessages } = await startedBotWithThread(); // no summarizeSession
      const res = (await caps.sessionEvent('idle', 'S1')) as { handled: boolean };
      expect(res.handled).toBe(true);
      expect(postMessages()).toHaveLength(0);
    });
  });

  describe('Phase 3: approval reactions + reply bridge', () => {
    /**
     * A started bot whose Slack fetch is programmable: chat.postMessage returns
     * an incrementing ts (so the approval prompt has a known ts), and
     * reactions.get returns whatever `reactionState` currently holds.
     */
    async function startedBot() {
      let postSeq = 0;
      const reactionState: { reactions: Array<{ name: string; users: string[] }> } = { reactions: [] };
      const fetch = vi.fn(async (url: string) => {
        if (String(url).endsWith('/chat.postMessage')) {
          postSeq += 1;
          return { status: 200, ok: true, headers: {}, body: JSON.stringify({ ok: true, ts: `ts-${postSeq}` }) };
        }
        if (String(url).endsWith('/reactions.get')) {
          return { status: 200, ok: true, headers: {}, body: JSON.stringify({ ok: true, message: reactionState }) };
        }
        return { status: 200, ok: true, headers: {}, body: '{"ok":true}' };
      });
      const ctx: MainModuleContext = {
        storage: {
          get: vi.fn().mockResolvedValue({
            ...DEFAULT_SLACK_CONFIG,
            botToken: 'xoxb-test',
            bot: { ...DEFAULT_SLACK_CONFIG.bot, enabled: true, transport: 'web', channelId: 'C1', authedUserId: 'U1' }
          }),
          set: vi.fn()
        },
        log: vi.fn(),
        fetch
      };
      const caps = await slackMainModule.setup(ctx);
      await caps.startBot();
      await caps.recordLaunchedSession('launch-1', 'S1', 'C1', 'P1');
      return { caps, reactionState };
    }

    it('a ✅ reaction on the approval prompt enqueues an approve reply', async () => {
      const { caps, reactionState } = await startedBot();
      await caps.sessionEvent('blocked', 'S1'); // posts the prompt
      reactionState.reactions = [{ name: 'white_check_mark', users: ['U1'] }];
      await flushApprovalScan(caps);
      const replies = (await caps.drainPendingReplies()) as Array<{ sessionId: string; text: string; label: string }>;
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ sessionId: 'S1', text: '1' });
      expect(replies[0].label).toContain('approve');
    });

    it('a ❌ reaction enqueues a deny reply', async () => {
      const { caps, reactionState } = await startedBot();
      await caps.sessionEvent('blocked', 'S1');
      reactionState.reactions = [{ name: 'x', users: ['U1'] }];
      await flushApprovalScan(caps);
      const replies = (await caps.drainPendingReplies()) as Array<{ text: string; label: string }>;
      expect(replies).toHaveLength(1);
      expect(replies[0].text).toBe('3');
      expect(replies[0].label).toContain('deny');
    });

    it('ignores reactions from someone other than the authed user', async () => {
      const { caps, reactionState } = await startedBot();
      await caps.sessionEvent('blocked', 'S1');
      reactionState.reactions = [{ name: 'white_check_mark', users: ['U999'] }];
      await flushApprovalScan(caps);
      expect(await caps.drainPendingReplies()).toEqual([]);
    });

    it('resolves only once — a second scan after decision queues nothing more', async () => {
      const { caps, reactionState } = await startedBot();
      await caps.sessionEvent('blocked', 'S1');
      reactionState.reactions = [{ name: 'white_check_mark', users: ['U1'] }];
      await flushApprovalScan(caps);
      await caps.drainPendingReplies(); // consume the first
      await flushApprovalScan(caps); // reaction still present, but approval closed
      expect(await caps.drainPendingReplies()).toEqual([]);
    });

    it('re-prompts for a second approval after the first is resolved (C1 regression)', async () => {
      const { caps, reactionState } = await startedBot();
      // Prompt #1
      await caps.sessionEvent('blocked', 'S1');
      reactionState.reactions = [{ name: 'white_check_mark', users: ['U1'] }];
      await flushApprovalScan(caps);
      const first = (await caps.drainPendingReplies()) as unknown[];
      expect(first).toHaveLength(1); // approved → reply queued, approval cleared

      // Session resumes, then hits a SECOND permission prompt → fresh blocked edge.
      reactionState.reactions = []; // reactions are per-message; the new prompt has none yet
      const res = (await caps.sessionEvent('blocked', 'S1')) as { handled: boolean };
      expect(res.handled).toBe(true);
      // Must post a NEW prompt (not suppressed by the first approval).
      reactionState.reactions = [{ name: 'x', users: ['U1'] }];
      await flushApprovalScan(caps);
      const second = (await caps.drainPendingReplies()) as Array<{ text: string }>;
      expect(second).toHaveLength(1);
      expect(second[0].text).toBe('3'); // denied the second time
    });

    it('recordReplied confirms in-thread on success', async () => {
      const { caps } = await startedBot();
      await caps.recordReplied(
        { id: 'reply-1', sessionId: 'S1', text: '1', channel: 'C1', parentTs: 'P1', label: 'approve (reacted)' },
        true
      );
      // No throw is the contract here; the post is best-effort.
    });
  });

  // A7 regression fence. A1 adds `resolveProjectRoot?` to MainModuleContext and
  // A3 wires it into the built-in ctx at registry.ts setupAll. Slack rides that
  // identical ctx, so these tests prove the new optional member is INERT for
  // slack: present and tolerated, but never read — and that the poll loop still
  // tears down cleanly. resolveProjectRoot is treated as optional throughout
  // (present-or-undefined, never called), so this block is green pre- and
  // post-A3.
  describe('A7: rides the widened MainModuleContext', () => {
    it('a: setup tolerates a ctx carrying resolveProjectRoot; notify still POSTs', async () => {
      const mockFetch = vi.fn<
        Parameters<NonNullable<MainModuleContext['fetch']>>,
        Promise<BrokeredFetchResponse>
      >();
      mockFetch.mockResolvedValue({ status: 200, ok: true, headers: {}, body: 'ok' });

      const ctx: MainModuleContext = {
        storage: {
          get: vi.fn().mockResolvedValue({
            ...DEFAULT_SLACK_CONFIG,
            webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL'
          }),
          set: vi.fn()
        },
        log: vi.fn(),
        fetch: mockFetch,
        // The new (A1) optional member, present on the widened ctx.
        resolveProjectRoot: vi.fn()
      };

      const caps = await slackMainModule.setup(ctx);
      expect(typeof caps.notify).toBe('function');
      expect(typeof caps.startBot).toBe('function');
      expect(typeof caps.botStatus).toBe('function');

      const result = await caps.notify('A7 inert-member check');
      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('https://hooks.slack.com/services/TEST/WEBHOOK/URL', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'A7 inert-member check' })
      });
    });

    it('b: slack never invokes resolveProjectRoot across its capabilities (Rule 6)', async () => {
      const resolveProjectRoot = vi.fn();
      const ctx: MainModuleContext = {
        storage: {
          get: vi.fn().mockResolvedValue({
            ...DEFAULT_SLACK_CONFIG,
            botToken: 'xoxb-test',
            bot: {
              ...DEFAULT_SLACK_CONFIG.bot,
              enabled: true,
              transport: 'web',
              channelId: 'C1',
              authedUserId: 'U1'
            }
          }),
          set: vi.fn()
        },
        log: vi.fn(),
        fetch: vi.fn().mockResolvedValue({ status: 200, ok: true, headers: {}, body: '{"ok":true}' }),
        resolveProjectRoot
      };

      const caps = await slackMainModule.setup(ctx);
      await caps.notify('hello');
      await caps.testConnection();
      await caps.startBot();
      await caps.botStatus();
      await caps.stopBot();

      // Slack stays a pure fetch/webhook wrapper — it never reaches for a
      // project-scoped root. Locks Rule 6 against ctx-shape churn.
      expect(resolveProjectRoot).not.toHaveBeenCalled();
    });

    it('c: poll-loop survives teardown and teardown is idempotent (Rule 3)', async () => {
      const ctx: MainModuleContext = {
        storage: {
          get: vi.fn().mockResolvedValue({
            ...DEFAULT_SLACK_CONFIG,
            botToken: 'xoxb-test',
            bot: {
              ...DEFAULT_SLACK_CONFIG.bot,
              enabled: true,
              transport: 'web',
              channelId: 'C1',
              authedUserId: 'U1'
            }
          }),
          set: vi.fn()
        },
        log: vi.fn(),
        fetch: vi.fn().mockResolvedValue({ status: 200, ok: true, headers: {}, body: '{"ok":true}' }),
        resolveProjectRoot: vi.fn()
      };

      const caps = await slackMainModule.setup(ctx);
      const started = (await caps.startBot()) as { ok: boolean };
      expect(started.ok).toBe(true);
      expect(((await caps.botStatus()) as { running: boolean }).running).toBe(true);

      // teardown() releases the live-bot poll loop without throwing; the SAME
      // caps' botStatus (closing over the bot) must now report stopped.
      expect(() => slackMainModule.teardown?.()).not.toThrow();
      expect(((await caps.botStatus()) as { running: boolean }).running).toBe(false);

      // Idempotent: a second teardown is a no-op, never throws.
      expect(() => slackMainModule.teardown?.()).not.toThrow();
    });
  });
});

/** Run one approval reaction scan synchronously via the runtime's test hook. */
async function flushApprovalScan(caps: Record<string, any>): Promise<void> {
  const bot = (slackMainModule as unknown as { _bot?: { scanApprovalsForTest?: () => Promise<void> } })._bot;
  await bot?.scanApprovalsForTest?.();
  void caps;
}
