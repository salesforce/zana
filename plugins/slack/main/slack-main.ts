/**
 * Slack module — main process side.
 *
 * Provides outbound notification capabilities to Slack via webhook or Web API.
 *
 * Slack is now a BUILT-IN core module (registered in MAIN_MODULES). Its `ctx.fetch`
 * is the trusted in-process `builtinFetch` (src/main/modules/registry.ts) and is
 * UNGATED: no `net` permission check, no egress allowlist — it can reach any host.
 * That is the trade-off of being trusted core rather than a sandboxed disk
 * extension, where `ctx.fetch` was brokered and confined to an
 * `egressAllowlist: ['slack.com', 'hooks.slack.com', 'api.slack.com']`. (The body
 * is still capped at 8 MiB, matching the old broker.)
 *
 * Capabilities exposed to the renderer via `ModuleHost.call`:
 *   - notify(text: string) → { ok: boolean; error?: string }
 *   - testConnection()     → { ok: boolean; error?: string }
 *
 * The renderer subscribes to session lifecycle events (`host.on('session:agentStatus')`,
 * `host.on('session:exit')`) and calls `notify` on matches, so this main module
 * never directly observes core state — it's a pure fetch wrapper.
 */

import type { MainModule, MainModuleContext, BrokeredFetchInit } from '@zana-ai/zcc-extension-sdk/main';
import {
  type SlackConfig,
  type SlackBotConfig,
  type PendingLaunch,
  type PendingReply,
  DEFAULT_SLACK_CONFIG,
  DEFAULT_SLACK_BOT_CONFIG,
  MIN_POLL_INTERVAL_MS,
  APPROVE_EMOJI,
  DENY_EMOJI,
  MIN_MCP_POLL_INTERVAL_MS
} from '../shared/types.js';
import type { SlackClient } from './slack-client.js';
import { WebApiSlackClient } from './web-api-client.js';
import { McpSlackClient } from './mcp-client.js';
import { ThreadStore } from './thread-store.js';
import { CommandDispatcher, type LaunchIntent, type ReplyIntent } from './command-dispatcher.js';
import { SlackPollers } from './pollers.js';
import { formatAnswer } from '../shared/notify-format.js';

/** The brokered fetch capability (from `MainModuleContext.fetch`). */
type Fetch = NonNullable<MainModuleContext['fetch']>;

/**
 * Send a Slack notification via webhook or Web API.
 * Prefers webhook (simpler); falls back to Web API if only a bot token is configured.
 */
async function sendSlackNotification(
  fetch: Fetch,
  config: SlackConfig,
  text: string,
  log: MainModuleContext['log']
): Promise<{ ok: boolean; error?: string }> {
  // Prefer webhook (simpler, no channel resolution).
  if (config.webhookUrl) {
    try {
      const init: BrokeredFetchInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      };
      const res = await fetch(config.webhookUrl, init);
      if (res.ok) {
        return { ok: true };
      }
      // Log only the status — the body is the response of an operator-supplied
      // webhookUrl (arbitrary remote content) and must not be echoed into the app log.
      log(`Slack webhook failed: ${res.status}`);
      return { ok: false, error: `Webhook returned ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Slack webhook error: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  // Fallback: Web API with bot token.
  if (config.botToken && config.defaultChannel) {
    try {
      const init: BrokeredFetchInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.botToken}`
        },
        body: JSON.stringify({
          channel: config.defaultChannel,
          text,
          unfurl_links: false,
          unfurl_media: false
        })
      };
      const res = await fetch('https://slack.com/api/chat.postMessage', init);
      if (!res.ok) {
        log(`Slack Web API HTTP error: ${res.status}`);
        return { ok: false, error: `HTTP ${res.status}` };
      }
      let parsed: { ok?: boolean; error?: string } | undefined;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        // Ignore parse errors; check res.ok.
      }
      if (parsed?.ok === true) {
        return { ok: true };
      }
      const errMsg = parsed?.error ?? 'API returned ok:false';
      log(`Slack Web API error: ${errMsg}`);
      return { ok: false, error: errMsg };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Slack Web API error: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  // No valid config.
  return { ok: false, error: 'No webhook URL or bot token configured' };
}

/** Status of the live bot, surfaced to the panel. */
interface BotStatus {
  running: boolean;
  authGaveUp: boolean;
  /** Set when the loop stopped because the watched channel is unreachable. */
  misconfigured?: string | null;
  channelId?: string;
  pendingLaunches: number;
  budget?: { conversation: number; threads: number };
  lastError?: string;
}

/**
 * Owns the live-bot poll loop and the renderer launch-bridge queue. One per
 * module instance; `(re)start` rebuilds the loop from the current config so
 * the panel can arm/disarm without an app restart.
 */
class BotRuntime {
  private pollers: SlackPollers | null = null;
  private client: SlackClient | null = null;
  private readonly threadStore: ThreadStore;
  private readonly pending: PendingLaunch[] = [];
  private readonly pendingReplies: PendingReply[] = [];
  private launchSeq = 0;
  private replySeq = 0;
  private lastError: string | undefined;
  /** Bot config snapshot from the last start() — drives reply text + emoji. */
  private botConfig: SlackBotConfig | null = null;
  /**
   * Open approval prompts awaiting a reaction, keyed by session id. `promptTs`
   * is the bot message the user reacts on; cleared once a decision is read or
   * the session exits.
   */
  private readonly pendingApprovals = new Map<
    string,
    { promptTs: string; channel: string; parentTs: string }
  >();
  /**
   * Per-session signature of the LAST turn summary relayed to the thread, so a
   * re-fired idle edge for the SAME turn (the title flickered working↔idle
   * without new work) doesn't double-post. Keyed by session id; cleared on exit
   * next to {@link pendingApprovals}. We dedup on the returned summary text (not
   * the source transcript — slack-main can't read it; see the relay design).
   */
  private readonly relayedSig = new Map<string, string>();

  constructor(
    private readonly fetch: NonNullable<MainModuleContext['fetch']>,
    private readonly storage: MainModuleContext['storage'],
    private readonly log: MainModuleContext['log'],
    private readonly summarizeSession?: MainModuleContext['summarizeSession']
  ) {
    this.threadStore = new ThreadStore(storage);
  }

  /** Build (or rebuild) the poll loop from the saved config. Returns ok/error. */
  async start(): Promise<{ ok: boolean; error?: string }> {
    this.stop();
    const config = (await this.storage.get<SlackConfig>('config')) ?? DEFAULT_SLACK_CONFIG;
    const bot = config.bot;
    const transport = bot?.transport ?? 'mcp';
    if (!bot?.enabled) return { ok: false, error: 'Bot is disabled' };
    if (transport === 'web' && !config.botToken) {
      return { ok: false, error: 'A bot token is required for the Web API transport' };
    }
    if (!bot.channelId) return { ok: false, error: 'No channel id configured' };
    if (!bot.authedUserId) {
      return { ok: false, error: 'No authorized user id — set the Slack user id that drives the bot' };
    }

    await this.threadStore.init();
    this.botConfig = bot;
    // Pick the transport. MCP reuses the local AI Expert Suite gateway (no
    // token); Web API uses the pasted bot token. Both satisfy SlackClient, so
    // the pollers + approval flow are identical either way.
    this.client =
      transport === 'mcp'
        ? new McpSlackClient({ fetch: this.fetch })
        : new WebApiSlackClient({ fetch: this.fetch, botToken: config.botToken! });

    const dispatcher = new CommandDispatcher({
      enqueueLaunch: (intent: LaunchIntent) => this.enqueueLaunch(intent, bot.defaultProjectId),
      enqueueReply: (intent: ReplyIntent) => this.enqueueDispatcherReply(intent),
      statusText: () => this.statusText()
    });

    const authedUserId = bot.authedUserId;
    this.pollers = new SlackPollers({
      client: this.client,
      threadStore: this.threadStore,
      dispatcher,
      channel: bot.channelId,
      // The MCP gateway rate-limits hard, so floor its interval much higher
      // than the Web API's.
      pollIntervalMs: Math.max(
        transport === 'mcp' ? MIN_MCP_POLL_INTERVAL_MS : MIN_POLL_INTERVAL_MS,
        bot.pollIntervalMs
      ),
      authedUserId,
      // Empty prefix would silently disable the cross-restart echo guard (the
      // prefix is the only durable self-filter; ownTs is in-memory). Fall back
      // to the default rather than ship a footgun.
      botPrefix: bot.botPrefix?.trim() || DEFAULT_SLACK_BOT_CONFIG.botPrefix,
      perThreadCap: bot.perThreadCap,
      perConversationCap: bot.perConversationCap,
      onError: (err, where) => {
        this.lastError = `${where}: ${err.message}`;
        this.log(`Slack bot ${where}: ${err.message}`, err);
      },
      onDrop: (userId) => this.log(`Slack bot dropped message from unauthorized user ${userId}`),
      approvalPoll: () => this.scanApprovalReactions(authedUserId)
    });
    this.pollers.start();
    this.lastError = undefined;
    this.log(`Slack bot started on channel ${bot.channelId}`);
    return { ok: true };
  }

  stop(): void {
    this.pollers?.stop();
    this.pollers = null;
    this.pendingApprovals.clear();
    this.relayedSig.clear();
  }

  status(): BotStatus {
    const misconfigured = this.pollers?.misconfiguredReason ?? null;
    const gaveUp = this.pollers?.hasGivenUp ?? false;
    return {
      // A pollers instance that tripped its channel-config or auth circuit has
      // stopped its own timer — report it as not-running so the panel doesn't
      // claim "running" for a loop that's actually dead.
      running: this.pollers !== null && !misconfigured && !gaveUp,
      authGaveUp: gaveUp,
      misconfigured,
      pendingLaunches: this.pending.length,
      budget: this.pollers?.budgetUsage,
      lastError: this.lastError
    };
  }

  /**
   * Validate the configured transport. For Web API this also resolves the
   * Slack user id from the token (panel's "Detect from token"). For MCP the
   * gateway hides the Slack identity, so a successful connection returns ok with
   * NO userId — the panel asks the user to enter it manually.
   */
  async authTest(): Promise<{ ok: boolean; userId?: string; team?: string; error?: string }> {
    const config = (await this.storage.get<SlackConfig>('config')) ?? DEFAULT_SLACK_CONFIG;
    const transport = config.bot?.transport ?? 'mcp';
    try {
      if (transport === 'mcp') {
        await new McpSlackClient({ fetch: this.fetch }).authTest();
        return { ok: true }; // connected; user id can't be derived here
      }
      if (!config.botToken) return { ok: false, error: 'No bot token configured' };
      const res = await new WebApiSlackClient({ fetch: this.fetch, botToken: config.botToken }).authTest();
      return { ok: true, userId: res.userId, team: res.team };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** The renderer drains queued launches here (host.launchSession is renderer-only). */
  drainPendingLaunches(): PendingLaunch[] {
    const out = this.pending.splice(0, this.pending.length);
    return out;
  }

  /** The renderer drains queued session replies here (host.replyToSession is renderer-only). */
  drainPendingReplies(): PendingReply[] {
    return this.pendingReplies.splice(0, this.pendingReplies.length);
  }

  /**
   * Renderer reports the outcome of delivering a queued reply. On success we
   * confirm in the session's thread; on failure (session closed) we say so.
   */
  async recordReplied(reply: PendingReply, ok: boolean): Promise<void> {
    if (!this.pollers) return;
    const msg = ok
      ? `Sent *${reply.label}* to the session.`
      : `Couldn't deliver *${reply.label}* — the session may have ended.`;
    await this.pollers.postBotReply(reply.channel, reply.parentTs, msg).catch(() => undefined);
  }

  /**
   * Renderer reports the session it launched for a queued intent. Links the
   * thread so the poll loop follows the session's thread, and posts a note.
   */
  async recordLaunchedSession(launchId: string, sessionId: string | null, channel: string, parentTs: string): Promise<void> {
    await this.threadStore.init();
    if (!sessionId) {
      // Launch failed (no matching project). Do NOT persist a thread row — a
      // null-sessionId row would be polled forever and trap every later
      // hint/cancel in "still starting". Just report the failure in-thread.
      if (this.pollers) {
        await this.pollers
          .postBotReply(channel, parentTs, 'Could not launch a session (no matching project).')
          .catch(() => undefined);
      }
      return;
    }
    // Link so the poll loop follows this session's thread.
    this.threadStore.link(channel, parentTs, sessionId, this.nowMs());
    void launchId;
  }

  /**
   * Phase 2: turn a bot-launched session's thread into a live log. When a
   * session the bot started transitions to `blocked`, finishes a turn (`idle`),
   * or exits, post the update into ITS thread (prefix-stamped + own-ts recorded
   * via the pollers, so it doesn't echo). Returns `{ handled: true }` only for
   * sessions the bot owns — the renderer uses that to suppress the generic
   * channel notify, so a bot session reports once (in-thread) instead of twice.
   */
  async handleSessionEvent(
    event: 'blocked' | 'exit' | 'idle',
    sessionId: string,
    detail?: { code?: number }
  ): Promise<{ handled: boolean }> {
    if (!this.pollers) {
      // eslint-disable-next-line no-console
      console.log(`[slack-relay] ${event} session=${sessionId.slice(0, 8)} → bot not running`);
      return { handled: false };
    }
    await this.threadStore.init();
    const row = this.threadStore.findBySession(sessionId);
    if (!row) {
      // eslint-disable-next-line no-console
      console.log(`[slack-relay] ${event} session=${sessionId.slice(0, 8)} → no thread row (not bot-launched)`);
      return { handled: false }; // not a bot-launched session
    }

    if (event === 'blocked') {
      // Coalesce only while a prompt is still UNANSWERED. A session re-enters
      // "blocked" repeatedly for a single permission prompt — post once for
      // that. But after a reaction resolves the approval (deleted from
      // pendingApprovals), the NEXT blocked edge is a genuinely new prompt and
      // must post again. Keying on pendingApprovals (not an exit-scoped set) is
      // what lets a run needing several approvals get a prompt for each.
      if (this.pendingApprovals.has(sessionId)) return { handled: true };
      // Post the approval prompt and remember its ts so the reaction scan can
      // map a ✅/❌ back to this session. We do NOT seed the reactions — the bot
      // posts as the same user id it authorizes, so a seeded reaction would be
      // indistinguishable from the operator's tap. The text tells them to react.
      const promptTs = await this.pollers
        .postBotReply(
          row.channel,
          row.parentTs,
          'This session needs your input. React :white_check_mark: to approve or :x: to deny — or reply in-thread.'
        )
        .catch(() => undefined);
      if (promptTs) {
        this.pendingApprovals.set(sessionId, {
          promptTs,
          channel: row.channel,
          parentTs: row.parentTs
        });
      }
      return { handled: true };
    }

    if (event === 'idle') {
      // Relay the turn's answer into the thread. No summarizer wired → nothing
      // to say (degrade safely). Every failure below is a silent no-op: the
      // relay is a courtesy, never a source of thread error chatter.
      if (!this.summarizeSession) {
        // eslint-disable-next-line no-console
        console.log(`[slack-relay] idle session=${sessionId.slice(0, 8)} → no summarizeSession capability`);
        return { handled: true };
      }
      const r = await this.summarizeSession(sessionId, { scope: 'lastTurn' }).catch((err) => {
        // eslint-disable-next-line no-console
        console.log(`[slack-relay] idle session=${sessionId.slice(0, 8)} → summarizeSession threw: ${err}`);
        return undefined;
      });
      if (!r?.ok || !r.text) {
        // eslint-disable-next-line no-console
        console.log(
          `[slack-relay] idle session=${sessionId.slice(0, 8)} → summary empty (ok=${r?.ok ?? 'n/a'}, len=${r?.text?.length ?? 0})`
        );
        return { handled: true };
      }
      // Dedup same-turn re-fires by a cheap signature of the summary text.
      const sig = `${r.text.length}:${r.text.slice(-64)}`;
      if (this.relayedSig.get(sessionId) === sig) {
        // eslint-disable-next-line no-console
        console.log(`[slack-relay] idle session=${sessionId.slice(0, 8)} → deduped (same summary already relayed)`);
        return { handled: true };
      }
      const posted = await this.pollers
        .postBotReply(row.channel, row.parentTs, formatAnswer(r.text))
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.log(`[slack-relay] idle session=${sessionId.slice(0, 8)} → postBotReply threw: ${err}`);
          return undefined;
        });
      if (posted !== undefined) {
        this.relayedSig.set(sessionId, sig);
        // eslint-disable-next-line no-console
        console.log(`[slack-relay] idle session=${sessionId.slice(0, 8)} → relayed (${r.text.length} chars)`);
      } else {
        // eslint-disable-next-line no-console
        console.log(`[slack-relay] idle session=${sessionId.slice(0, 8)} → postBotReply returned undefined (not posted)`);
      }
      return { handled: true };
    }

    // exit
    this.pendingApprovals.delete(sessionId);
    this.relayedSig.delete(sessionId);
    const code = detail?.code;
    const icon = code === 0 ? ':white_check_mark:' : ':x:';
    const tail = code === undefined ? '' : ` (exit ${code})`;
    await this.pollers
      .postBotReply(row.channel, row.parentTs, `${icon} Session finished${tail}.`)
      .catch(() => undefined);
    // The session is gone — drop its thread link so pollThreads stops polling a
    // dead thread every tick. (A late in-thread reply would just re-open via the
    // channel poll if the user pings again.)
    this.threadStore.remove(row.channel, row.parentTs);
    return { handled: true };
  }

  /** Test-only: run one approval reaction scan synchronously (no timer). */
  async scanApprovalsForTest(): Promise<void> {
    if (this.botConfig?.authedUserId) await this.scanApprovalReactions(this.botConfig.authedUserId);
  }

  /**
   * Approval reaction scan (run each poll tick). For every open approval, read
   * the reactions on its prompt message; if the authed user added an approve or
   * deny emoji, enqueue the corresponding reply into the session and confirm
   * in-thread. First decision wins; the approval is then closed.
   */
  private async scanApprovalReactions(authedUserId: string): Promise<void> {
    if (!this.client || this.pendingApprovals.size === 0) return;
    const cfg = this.botConfig;
    if (!cfg) return;

    for (const [sessionId, appr] of Array.from(this.pendingApprovals)) {
      const reactions = await this.client.getReactions(appr.channel, appr.promptTs);
      const reacted = (names: string[]) =>
        reactions.some((r) => names.includes(r.name) && r.users.includes(authedUserId));
      const approved = reacted(APPROVE_EMOJI);
      const denied = reacted(DENY_EMOJI);
      if (!approved && !denied) continue;

      // Approve wins a simultaneous ✅+❌ (conservative: only deny on a clean ❌).
      const decision = approved ? 'approve' : 'deny';
      const text = approved ? cfg.approveReply : cfg.denyReply;
      this.pendingApprovals.delete(sessionId);
      this.enqueueReply(sessionId, text, appr.channel, appr.parentTs, `${decision} (reacted)`);
    }
  }

  private enqueueLaunch(intent: LaunchIntent, defaultProjectId?: string): string {
    const id = `launch-${++this.launchSeq}`;
    this.pending.push({
      id,
      prompt: intent.prompt,
      projectId: defaultProjectId,
      channel: intent.channel,
      parentTs: intent.parentTs
    });
    return id;
  }

  /** Queue a text reply into a session for the renderer reply-bridge to send. */
  private enqueueReply(
    sessionId: string,
    text: string,
    channel: string,
    parentTs: string,
    label: string,
    raw = false
  ): string {
    const id = `reply-${++this.replySeq}`;
    this.pendingReplies.push({ id, sessionId, text, channel, parentTs, label, raw });
    return id;
  }

  /**
   * Resolve a dispatcher reply intent (`hint`/`cancel`, which arrive keyed by
   * the thread they were typed in) to the thread's linked session, then queue
   * it. Posts a hint in-thread when the thread isn't a session thread.
   */
  private enqueueDispatcherReply(intent: ReplyIntent): void {
    const row = this.threadStore.get(intent.channel, intent.parentTs);
    if (!row) {
      // Not a thread for a session I launched.
      void this.pollers
        ?.postBotReply(
          intent.channel,
          intent.parentTs,
          'That only works in a thread for a session I launched.'
        )
        .catch(() => undefined);
      return;
    }
    if (!row.sessionId) {
      // The launch for this thread is still resolving (sessionId not linked yet).
      void this.pollers
        ?.postBotReply(intent.channel, intent.parentTs, "The session is still starting — try again in a moment.")
        .catch(() => undefined);
      return;
    }
    this.enqueueReply(
      row.sessionId,
      intent.text,
      intent.channel,
      intent.parentTs,
      intent.label,
      intent.raw
    );
  }

  private statusText(): string {
    const s = this.status();
    const lines = [
      `:robot_face: *ZCC bot* — ${s.running ? 'running' : 'stopped'}${s.authGaveUp ? ' (auth circuit tripped)' : ''}`,
      `Threads tracked: ${this.threadStore.list().length} · pending launches: ${s.pendingLaunches}`
    ];
    if (s.budget) lines.push(`Replies this session: ${s.budget.conversation}`);
    if (s.lastError) lines.push(`Last error: ${s.lastError}`);
    return lines.join('\n');
  }

  private nowMs(): number {
    return Date.now();
  }
}

export const slackMainModule: MainModule = {
  id: 'slack',
  setup(ctx) {
    const { log, storage } = ctx;
    const fetch = ctx.fetch;
    if (!fetch) {
      throw new Error('slack: ctx.fetch capability is unavailable; cannot reach Slack.');
    }

    const bot = new BotRuntime(fetch, storage, log, ctx.summarizeSession);
    // Keep a handle for teardown.
    (slackMainModule as unknown as { _bot?: BotRuntime })._bot = bot;

    // Arm the bot at boot if it was left enabled. Fire-and-forget; errors are
    // surfaced via botStatus, never crash setup. `storage.get` may be sync
    // (built-in) or async (disk extension) — Promise.resolve normalizes both.
    void Promise.resolve(storage.get<SlackConfig>('config')).then((cfg) => {
      if (cfg?.bot?.enabled) {
        void bot.start().then((r) => {
          if (!r.ok) log(`Slack bot not started at boot: ${r.error}`);
        });
      }
    });

    return {
      /**
       * Send a Slack notification. Called by the renderer when a lifecycle event fires.
       * Reads the config from storage, validates it, and POSTs to Slack.
       */
      async notify(text: string): Promise<{ ok: boolean; error?: string }> {
        if (typeof text !== 'string' || !text.trim()) {
          return { ok: false, error: 'Empty message text' };
        }
        const config = (await storage.get<SlackConfig>('config')) ?? DEFAULT_SLACK_CONFIG;
        return sendSlackNotification(fetch, config, text, log);
      },

      /**
       * Test the Slack connection by sending a ping message.
       * Used by the settings panel's "Test Connection" button.
       */
      async testConnection(): Promise<{ ok: boolean; error?: string }> {
        const config = (await storage.get<SlackConfig>('config')) ?? DEFAULT_SLACK_CONFIG;
        if (!config.webhookUrl && !config.botToken) {
          return { ok: false, error: 'No webhook URL or bot token configured' };
        }
        return sendSlackNotification(
          fetch,
          config,
          ':wave: ZCC Slack extension test notification',
          log
        );
      },

      /** Start (or restart) the live bot from the saved config. */
      startBot(): Promise<{ ok: boolean; error?: string }> {
        return bot.start();
      },

      /** Stop the live bot. */
      stopBot(): { ok: boolean } {
        bot.stop();
        return { ok: true };
      },

      /** Current bot status for the settings panel. */
      botStatus(): BotStatus {
        return bot.status();
      },

      /** Validate the bot token and resolve the authed Slack user id. */
      botAuthTest(): Promise<{ ok: boolean; userId?: string; team?: string; error?: string }> {
        return bot.authTest();
      },

      /** Renderer launch-bridge: pull queued `run` intents to execute. */
      drainPendingLaunches(): PendingLaunch[] {
        return bot.drainPendingLaunches();
      },

      /** Renderer launch-bridge: report the session launched for an intent. */
      recordLaunchedSession(
        launchId: string,
        sessionId: string | null,
        channel: string,
        parentTs: string
      ): Promise<void> {
        return bot.recordLaunchedSession(launchId, sessionId, channel, parentTs);
      },

      /** Renderer reply-bridge: pull queued session replies (approvals/hints/cancel) to send. */
      drainPendingReplies(): PendingReply[] {
        return bot.drainPendingReplies();
      },

      /** Renderer reply-bridge: report whether a queued reply was delivered. */
      recordReplied(reply: PendingReply, ok: boolean): Promise<void> {
        return bot.recordReplied(reply, ok);
      },

      /**
       * Phase 2 lifecycle bridge. The renderer forwards a session's
       * blocked/idle/exit transition; if the session was bot-launched we post
       * into its thread and return `{handled:true}` so the renderer skips the
       * generic channel notify (no double-post).
       */
      sessionEvent(
        event: 'blocked' | 'exit' | 'idle',
        sessionId: string,
        detail?: { code?: number }
      ): Promise<{ handled: boolean }> {
        return bot.handleSessionEvent(event, sessionId, detail);
      }
    };
  },
  teardown() {
    (slackMainModule as unknown as { _bot?: BotRuntime })._bot?.stop();
  }
};
