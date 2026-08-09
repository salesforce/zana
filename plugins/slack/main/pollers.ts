/**
 * The live-bot poll loop, trimmed to ZCC's Phase 1: poll ONE channel for
 * top-level commands, and poll the threads of sessions we launched for
 * follow-ups. No DM channel, no meta-agent threads, no ask-approval intercept.
 *
 * Why polling and not socket-mode: no Bolt app, no public HTTPS endpoint,
 * reuse the bot-token Web API. The "daemon" is just `setInterval`, which the
 * main process already runs (see scheduler.ts). The loop lives only while
 * ZCC is open.
 *
 * Robustness carried over from CU (each guards a real failure mode):
 *  - own-message filter (`ownTs` set + durable `botPrefix`) → no echo loop
 *  - reply budgets (per-thread, per-conversation) → no runaway flood
 *  - 429 cooldown → no rate-limit storm
 *  - auth-failure circuit breaker → stop hammering a revoked token
 *  - injectable clock → tests advance time with a variable, not a real timer
 */

import type { InboundSlackMessage } from '../shared/types.js';
import { SenderGate } from './sender-gate.js';
import { SlackLogicalError, SlackRateLimited, type SlackClient } from './slack-client.js';
import type { ThreadStore } from './thread-store.js';

/** What the pollers hand an inbound, authorized message to. */
export interface Dispatcher {
  dispatch(
    msg: InboundSlackMessage,
    channel: string,
    parentTs: string,
    postReply: (text: string) => Promise<void>
  ): Promise<void>;
}

export interface PollersOptions {
  readonly client: SlackClient;
  readonly threadStore: ThreadStore;
  readonly dispatcher: Dispatcher;
  readonly channel: string;
  readonly pollIntervalMs: number;
  readonly authedUserId: string;
  /** Durable self-filter: text starting with this prefix is treated as a bot post. */
  readonly botPrefix?: string;
  readonly perThreadCap?: number;
  readonly perConversationCap?: number;
  readonly onError?: (err: Error, ctx: string) => void;
  readonly onDrop?: (userId: string, channel: string, messageTs: string) => void;
  /** Clock source (ms). Defaults to Date.now. Tests inject a mutable clock. */
  readonly now?: () => number;
  /**
   * Optional extra work run each poll tick, after channel + threads — used by
   * the approval flow to scan pending prompts for reactions. Guarded by the
   * same stopped/rate-limit checks; a throw routes through the circuit breaker.
   */
  readonly approvalPoll?: () => Promise<void>;
}

export class SlackPollers {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  /**
   * In-flight guard for the interval tick. The three polls are launched
   * (not awaited) by setInterval, so on a slow/hung Slack backend the next
   * tick can fire before the previous one finishes — overlapping pollThreads
   * reads the same `lastThreadTs` and can dispatch a follow-up twice. We skip
   * a tick while the previous one is still running. Reset on stop().
   */
  private polling = false;

  /** Channel cursor; starts 60s back so commands posted during startup aren't lost. */
  private lastChannelTs: string | null = null;
  /** Last-seen ts per thread parent_ts. */
  private readonly lastThreadTs = new Map<string, string>();

  /** Unix-ms until which polls are a no-op (set on 429). */
  private cooldownUntilMs: number | null = null;

  /** Consecutive auth-failure counter; trips the circuit at AUTH_FAILURE_CAP. */
  private authFailureCount = 0;
  private authGaveUp = false;
  private static readonly AUTH_FAILURE_CAP = 5;

  /**
   * Set when the watched channel is unreachable for a STATIC reason (bad id,
   * bot not in channel, archived) — retrying can't fix config, so we stop the
   * loop instead of hammering `conversations.history` every tick forever.
   */
  private misconfigured: string | null = null;

  /** Bounded set of ts values the bot posted, so it never replies to itself. */
  private readonly ownTs = new Set<string>();
  private readonly ownTsOrder: string[] = [];
  private static readonly OWN_TS_CAP = 2000;

  /** Reply budgets. */
  private readonly perThreadCap: number;
  private readonly perConversationCap: number;
  private readonly threadReplyCount = new Map<string, number>();
  private conversationReplyCount = 0;
  private readonly budgetNoticePosted = new Set<string>();

  private readonly gate: SenderGate;

  constructor(private readonly opts: PollersOptions) {
    this.perThreadCap = opts.perThreadCap ?? 50;
    this.perConversationCap = opts.perConversationCap ?? 100;
    this.lastChannelTs = (this.now() / 1000 - 60).toFixed(6);
    this.gate = new SenderGate({
      authedUserId: opts.authedUserId,
      onDrop: opts.onDrop,
      ...(opts.now !== undefined ? { now: opts.now } : {})
    });
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  /** True once the auth circuit has tripped (exposed for status reporting). */
  get hasGivenUp(): boolean {
    return this.authGaveUp;
  }

  /** Non-null when the loop stopped due to a static channel-config problem. */
  get misconfiguredReason(): string | null {
    return this.misconfigured;
  }

  /** Snapshot of reply budget usage (for status reporting). */
  get budgetUsage(): { conversation: number; threads: number } {
    return { conversation: this.conversationReplyCount, threads: this.threadReplyCount.size };
  }

  start(): void {
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.runTick();
    }, this.opts.pollIntervalMs);
    void this.runTick();
  }

  /** Test-only: run one guarded poll cycle synchronously (no timer). */
  tickForTest(): Promise<void> {
    return this.runTick();
  }

  /**
   * One poll cycle, guarded so a slow tick can't overlap the next. If the
   * previous cycle is still in flight we SKIP this one (the cadence stays the
   * same; we just don't stack). `Promise.allSettled` so one poll's rejection
   * can't strand the flag — each poll already routes its own errors through the
   * circuit breaker.
   */
  private async runTick(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await Promise.allSettled([this.pollChannel(), this.pollThreads(), this.pollApprovals()]);
    } finally {
      this.polling = false;
    }
  }

  /** Run the optional approval scan under the same guards as the other polls. */
  async pollApprovals(): Promise<void> {
    if (this.stopped || this.isRateLimited() || !this.opts.approvalPoll) return;
    try {
      await this.opts.approvalPoll();
      this.observeSuccess();
    } catch (err) {
      this.observeError(err);
      this.opts.onError?.(err as Error, 'pollApprovals');
    }
  }

  stop(): void {
    this.stopped = true;
    this.polling = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Record a ts the bot posted so polls skip it, and tally it against the
   * reply budgets. `threadKey` is the parent ts when the post was a thread
   * reply; omit for a top-level post.
   */
  noteOwnPost(ts: string, threadKey?: string): void {
    if (ts && !this.ownTs.has(ts)) {
      this.ownTs.add(ts);
      this.ownTsOrder.push(ts);
      if (this.ownTsOrder.length > SlackPollers.OWN_TS_CAP) {
        const evict = this.ownTsOrder.shift();
        if (evict) this.ownTs.delete(evict);
      }
    }
    this.conversationReplyCount += 1;
    if (threadKey) {
      this.threadReplyCount.set(threadKey, (this.threadReplyCount.get(threadKey) ?? 0) + 1);
    }
  }

  /** Poll the watched channel for new top-level commands. */
  async pollChannel(): Promise<void> {
    if (this.stopped || this.isRateLimited()) return;
    try {
      const r = await this.opts.client.readChannel(this.opts.channel, this.lastChannelTs ?? undefined);
      this.observeSuccess();
      for (const m of r.messages) {
        if (!m.ts) continue;
        if (this.lastChannelTs && !isLaterTs(m.ts, this.lastChannelTs)) continue;
        this.lastChannelTs = maxTs(this.lastChannelTs, m.ts);
        // Filter order is load-bearing (see CU): own-ts first (authoritative),
        // then sender gate (audits foreign senders before any text heuristic),
        // then bot-prefix (catches own posts that lost ownTs across restart).
        if (this.isOwn(m.ts)) continue;
        if (!this.gate.check(m, this.opts.channel)) continue;
        if (this.hasBotPrefix(m.text)) continue;
        // Thread replies belong to pollThreads.
        if (m.threadTs && m.threadTs !== m.ts) continue;
        // Already handled: a thread is linked at this ts (we launched from it).
        // Guards against a restart re-reading the startup lookback window and
        // re-dispatching — and thus re-launching — an already-processed command.
        if (this.opts.threadStore.get(this.opts.channel, m.ts)) continue;

        const budgetReason = this.replyBudgetReason(undefined);
        if (budgetReason) {
          await this.emitBudgetNotice(`conv:${this.opts.channel}`, m.ts, budgetReason);
          continue;
        }
        await this.opts.dispatcher.dispatch(m, this.opts.channel, m.ts, async (text) => {
          await this.replyInThread(m.ts, text);
        });
      }
    } catch (err) {
      // Static channel-config failure — the id is wrong, the bot isn't in the
      // channel, or it's archived. Retrying every tick can't fix config, so
      // stop the loop and surface why (mirrors the auth circuit).
      if (
        isLogical(err, 'channel_not_found') ||
        isLogical(err, 'not_in_channel') ||
        isLogical(err, 'is_archived')
      ) {
        this.misconfigured = (err as SlackLogicalError).code;
        this.opts.onError?.(
          new Error(`watched channel unreachable (${this.misconfigured}); stopping bot until reconfigured`),
          'channel-misconfigured'
        );
        this.stop();
        return;
      }
      this.observeError(err);
      this.opts.onError?.(err as Error, 'pollChannel');
    }
  }

  /** Poll the threads of sessions we launched for follow-up messages. */
  async pollThreads(): Promise<void> {
    if (this.stopped || this.isRateLimited()) return;
    for (const row of this.opts.threadStore.list()) {
      if (this.stopped) return;
      try {
        const last = this.lastThreadTs.get(row.parentTs);
        const r = await this.opts.client.readThread(row.channel, row.parentTs, last ?? undefined);
        this.observeSuccess();
        for (const m of r.messages) {
          if (!m.ts) continue;
          if (last && !isLaterTs(m.ts, last)) continue;
          this.lastThreadTs.set(row.parentTs, maxTs(last, m.ts) ?? m.ts);
          if (m.ts === row.parentTs) continue; // the parent is always echoed back
          if (this.isOwn(m.ts)) continue;
          if (!this.gate.check(m, row.channel)) continue;
          if (this.hasBotPrefix(m.text)) continue;

          const budgetReason = this.replyBudgetReason(row.parentTs);
          if (budgetReason) {
            await this.emitBudgetNotice(`thread:${row.parentTs}`, row.parentTs, budgetReason, row.channel);
            continue;
          }
          await this.opts.dispatcher.dispatch(m, row.channel, row.parentTs, async (text) => {
            await this.replyInThread(row.parentTs, text, row.channel);
          });
        }
      } catch (err) {
        this.observeError(err);
        // Dead thread/channel — stop polling it so we don't spew every tick.
        if (isLogical(err, 'thread_not_found') || isLogical(err, 'channel_not_found')) {
          this.opts.threadStore.remove(row.channel, row.parentTs);
          this.lastThreadTs.delete(row.parentTs);
        }
        this.opts.onError?.(err as Error, 'pollThreads');
      }
    }
  }

  /**
   * Post a bot reply into a tracked thread, with the prefix stamp + own-ts
   * record. Any code that writes into a followed thread MUST go through this
   * (not the raw client) or the message will echo back as user input on the
   * next poll — the bot posts as the same user id it authorizes, so the sender
   * gate won't stop it; only the prefix + ownTs do.
   */
  async postBotReply(channel: string, parentTs: string, text: string): Promise<string | undefined> {
    return this.replyInThread(parentTs, text, channel);
  }

  /**
   * Post a thread reply, stamping the prefix and recording our own ts. Returns
   * the new message ts on success (the approval flow needs it to map a later
   * reaction back to the prompt), or undefined if the post failed.
   */
  private async replyInThread(
    parentTs: string,
    text: string,
    channel?: string
  ): Promise<string | undefined> {
    const ch = channel ?? this.opts.channel;
    const body = this.stampPrefix(text);
    try {
      const ts = await this.opts.client.postThreadReply(ch, parentTs, body);
      this.noteOwnPost(ts, parentTs);
      return ts;
    } catch (err) {
      this.observeError(err);
      this.opts.onError?.(err as Error, 'postThreadReply');
      return undefined;
    }
  }

  private async emitBudgetNotice(
    noticeKey: string,
    parentTs: string,
    reason: string,
    channel?: string
  ): Promise<void> {
    if (this.budgetNoticePosted.has(noticeKey)) return; // one-time per exhausted bucket
    this.budgetNoticePosted.add(noticeKey);
    await this.replyInThread(parentTs, reason, channel);
  }

  private replyBudgetReason(threadTs: string | undefined): string | null {
    if (this.conversationReplyCount >= this.perConversationCap) {
      return `:no_entry: Reply budget exhausted — ${this.perConversationCap} replies in this channel. Restart ZCC to reset.`;
    }
    if (threadTs) {
      const count = this.threadReplyCount.get(threadTs) ?? 0;
      if (count >= this.perThreadCap) {
        return `:no_entry: Thread budget exhausted — ${this.perThreadCap} replies here. Start a new thread.`;
      }
    }
    return null;
  }

  private stampPrefix(text: string): string {
    const p = this.opts.botPrefix;
    if (!p) return text;
    return text.startsWith(p) ? text : `${p} ${text}`;
  }

  private isOwn(ts: string | undefined): boolean {
    return ts !== undefined && this.ownTs.has(ts);
  }

  private hasBotPrefix(text: string | undefined): boolean {
    const p = this.opts.botPrefix;
    if (!p || !text) return false;
    return text.startsWith(p);
  }

  private isRateLimited(): boolean {
    if (this.cooldownUntilMs === null) return false;
    if (this.now() >= this.cooldownUntilMs) {
      this.cooldownUntilMs = null;
      return false;
    }
    return true;
  }

  private observeError(err: unknown): void {
    if (err instanceof SlackRateLimited) {
      this.cooldownUntilMs = this.now() + err.retryAfterSeconds * 1000;
      return;
    }
    if (isAuthError(err)) {
      this.authFailureCount += 1;
      if (this.authFailureCount >= SlackPollers.AUTH_FAILURE_CAP && !this.authGaveUp) {
        this.authGaveUp = true;
        this.opts.onError?.(
          new Error('slack auth repeatedly failed; stopping bot until reconfigured'),
          'auth-backoff'
        );
        this.stop();
      }
    }
    // Transient (network) errors don't touch the auth counter.
  }

  private observeSuccess(): void {
    this.authFailureCount = 0;
  }
}

function isLogical(err: unknown, code: string): boolean {
  return err instanceof SlackLogicalError && err.code === code;
}

function isAuthError(err: unknown): boolean {
  return (
    err instanceof SlackLogicalError &&
    ['token_expired', 'invalid_auth', 'account_inactive', 'not_authed'].includes(err.code)
  );
}

/** Compare Slack timestamps (dotted floats) — later ts is larger. */
function isLaterTs(a: string, b: string): boolean {
  return Number.parseFloat(a) > Number.parseFloat(b);
}

function maxTs(a: string | null | undefined, b: string): string {
  if (!a) return b;
  return isLaterTs(b, a) ? b : a;
}
