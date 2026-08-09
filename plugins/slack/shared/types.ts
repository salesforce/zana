/**
 * Shared Slack types — used by both the main capability (notification sender)
 * and the renderer panel (settings UI). Plain data only; safe to import from
 * either process.
 */

/** Slack notification configuration stored in extension storage. */
export interface SlackConfig {
  /** Incoming webhook URL (for simple notifications). */
  webhookUrl?: string;
  /** Bot token (for richer Web API notifications; optional alternative to webhook). */
  botToken?: string;
  /** Default channel (e.g. "#zcc-notifications"). */
  defaultChannel?: string;
  /** Which lifecycle events to notify on. */
  notifyOn: {
    /** Session transitions to "blocked" (needs user input). */
    sessionBlocked: boolean;
    /** Session exits (done/error). */
    sessionExit: boolean;
    /** Scheduled run completes. */
    scheduledComplete: boolean;
  };
  /** Debounce window (ms) — group rapid-fire events. */
  debounceMs: number;
  /** Live-bot (Tier C) configuration. Off by default. */
  bot: SlackBotConfig;
}

/**
 * Tier-C "live bot" configuration. The bot polls a single channel via the
 * Slack Web API (bot token, NOT the webhook) and reacts to commands from a
 * single authorized user. It lives only while ZCC is running — there is no
 * daemon — so the loop starts/stops with the app (and the `enabled` toggle).
 */
export interface SlackBotConfig {
  /** Master switch. When false, no poll loop is started. */
  enabled: boolean;
  /**
   * Which Slack transport the bot uses:
   *   - 'mcp' — route through the local AI Expert Suite MCP gateway, reusing its
   *     Slack auth (no token to paste). Needs that app's daemon running; polls
   *     slower (the gateway rate-limits hard). Default.
   *   - 'web' — direct Slack Web API with a pasted bot token. Self-contained,
   *     no external daemon, bot identity.
   */
  transport: 'mcp' | 'web';
  /** Channel id (C…/G…) the bot watches. NOT a `#name` — must be the id. */
  channelId?: string;
  /**
   * The ONLY Slack user id (U…) allowed to drive the bot. Every other sender
   * is silently dropped (single-user security invariant, ported from CU).
   * Resolve it from the bot token with the `botAuthTest` capability.
   */
  authedUserId?: string;
  /** Poll interval (ms). Floored at MIN_POLL_INTERVAL_MS. Default 3000 (matches CU's ADR-0012). */
  pollIntervalMs: number;
  /**
   * Durable self-filter prefix the bot stamps on every message it posts, so a
   * bot reply that lands in a fresh poll (after an app restart, when the
   * in-memory own-ts set is gone) isn't mistaken for user input → echo loop.
   */
  botPrefix: string;
  /** Project the bot launches `run <prompt>` sessions into. Defaults to active project. */
  defaultProjectId?: string;
  /** Hard cap on bot replies in one thread before standing down. */
  perThreadCap: number;
  /** Hard cap on bot replies across the whole channel before standing down. */
  perConversationCap: number;
  /**
   * What gets typed into the session when you react ✅ on its approval prompt —
   * i.e. what you'd type at Claude's permission menu to approve. Default "1"
   * (the "Yes" option). Sent followed by Enter.
   */
  approveReply: string;
  /**
   * What gets typed when you react ❌ to deny. Default "3" — Claude's "No, and
   * tell Claude what to do differently" option. Adjust if your prompt differs.
   */
  denyReply: string;
}

/** Floor for the poll interval — below this Slack rate limits bite. */
export const MIN_POLL_INTERVAL_MS = 2000;

/**
 * Higher poll floor for the MCP transport — the AI Expert Suite gateway
 * rate-limits aggressively (a 2-message read can return Too Many Requests), so
 * the 3s default that's fine for the Web API would trip it constantly.
 */
export const MIN_MCP_POLL_INTERVAL_MS = 10_000;

/** Default bot config for a fresh install (disabled). */
export const DEFAULT_SLACK_BOT_CONFIG: SlackBotConfig = {
  enabled: false,
  transport: 'mcp',
  pollIntervalMs: 3000,
  botPrefix: ':robot_face:',
  perThreadCap: 50,
  perConversationCap: 100,
  approveReply: '1',
  denyReply: '3'
};

/** Emoji names (no colons) that count as approve / deny on an approval prompt. */
export const APPROVE_EMOJI = ['white_check_mark', 'heavy_check_mark', '+1', 'thumbsup'];
export const DENY_EMOJI = ['x', 'no_entry', 'no_entry_sign', '-1', 'thumbsdown'];

/** Default config for a fresh install. */
export const DEFAULT_SLACK_CONFIG: SlackConfig = {
  notifyOn: {
    sessionBlocked: true,
    sessionExit: true,
    scheduledComplete: false
  },
  debounceMs: 5000,
  bot: DEFAULT_SLACK_BOT_CONFIG
};

/**
 * A message read back from a Slack channel/thread poll. The minimal projection
 * the gate, dispatcher, and pollers rely on — mirrors CU's `SlackMessage`.
 */
export interface InboundSlackMessage {
  /** Author user id (U…). Absent on some system/bot subtypes. */
  user?: string;
  /** Message timestamp ("1712345678.123456") — Slack's per-message id. */
  ts: string;
  /** Parent thread ts when this is a threaded reply; equals `ts` for parents. */
  threadTs?: string;
  /** Message body. */
  text?: string;
}

/** Parsed inbound command. `kind: 'unknown'` carries the raw text for help. */
export type BotCommand =
  | { kind: 'run'; prompt: string }
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'cancel' }
  | { kind: 'hint'; text: string }
  | { kind: 'empty' }
  | { kind: 'unknown'; raw: string };

/**
 * A pending session launch the poll loop (main process) recorded for the
 * renderer to execute — `host.launchSession` is renderer-only, so `run` queues
 * an intent here and the always-mounted panel drains it. See the launch-bridge
 * in SlackPanel.tsx.
 */
export interface PendingLaunch {
  /** Stable id so the renderer can ack exactly one launch. */
  id: string;
  /** The prompt to open the Claude session with. */
  prompt: string;
  /** Project to launch into (resolved at enqueue time; may be undefined → active). */
  projectId?: string;
  /** Channel + parent ts of the Slack message that requested the launch. */
  channel: string;
  parentTs: string;
}

/**
 * A pending text reply into a running session the loop recorded for the
 * renderer to execute — `host.replyToSession` is renderer-only, same bridge
 * shape as {@link PendingLaunch}. Produced by an approval reaction, a `hint`,
 * or a `cancel`.
 */
export interface PendingReply {
  /** Stable id so the renderer can ack exactly one reply. */
  id: string;
  /** Target session. */
  sessionId: string;
  /** Text to type into the session. */
  text: string;
  /**
   * When true, the text is delivered RAW (no trailing Enter) via
   * `host.writeToSession` — for control keys like Esc (`cancel`). When false/
   * absent it's submitted as a line via `host.replyToSession` (hint, approvals).
   */
  raw?: boolean;
  /** Channel + thread to post the outcome confirmation into. */
  channel: string;
  parentTs: string;
  /** Short human label of what was sent, for the in-thread confirmation. */
  label: string;
}
