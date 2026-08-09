/**
 * Slack Web API client over the brokered `ctx.fetch`.
 *
 * The live bot READS Slack (channel + thread history) and WRITES replies via
 * the Slack Web API with a bot token — NOT the webhook (which is write-only)
 * and NOT the Slack MCP (which is unreachable from the main process; main is
 * an MCP *server*, not a client). This is the same path CU uses for messaging
 * (`web-api-client.ts`), adapted to ZCC's `BrokeredFetchInit`/`Response`
 * signature so it stays inside the `net` permission + slack.com egress
 * allowlist.
 *
 * Error shapes are deliberately the same names the pollers' circuit breaker
 * keys on: `SlackRateLimited` (429 → cooldown) and `SlackLogicalError`
 * (`{ok:false, error}` → auth/thread-gone handling).
 */

import type { BrokeredFetchInit, MainModuleContext } from '@zana-ai/zcc-extension-sdk/main';
import type { InboundSlackMessage } from '../shared/types.js';
import {
  type SlackClient,
  type ReadResult,
  type AuthTestResult,
  type ReactionSummary,
  SlackLogicalError,
  SlackRateLimited
} from './slack-client.js';

// Re-export the shared error/result types so existing importers of this module
// keep working (the canonical definitions now live in slack-client.ts).
export {
  SlackLogicalError,
  SlackRateLimited,
  type ReadResult,
  type AuthTestResult,
  type ReactionSummary
} from './slack-client.js';

type Fetch = NonNullable<MainModuleContext['fetch']>;

const SLACK_API = 'https://slack.com/api';

export interface SlackClientOptions {
  readonly fetch: Fetch;
  readonly botToken: string;
  /** Default retry-after when Slack omits the header on a 429. */
  readonly defaultRetryAfterSeconds?: number;
}

/**
 * Thin, typed wrapper over the Slack Web API. One instance per running bot;
 * holds the token so callers never thread it through.
 */
export class WebApiSlackClient implements SlackClient {
  private readonly fetch: Fetch;
  private readonly token: string;
  private readonly defaultRetryAfter: number;

  constructor(opts: SlackClientOptions) {
    this.fetch = opts.fetch;
    this.token = opts.botToken;
    this.defaultRetryAfter = opts.defaultRetryAfterSeconds ?? 10;
  }

  /** Validate the token and return the bot/user identity. */
  async authTest(): Promise<AuthTestResult> {
    const json = await this.post('auth.test', {});
    return {
      userId: String(json.user_id ?? ''),
      user: String(json.user ?? ''),
      team: String(json.team ?? '')
    };
  }

  /**
   * Read top-level channel messages newer than `oldestTs` (exclusive-ish —
   * Slack treats `oldest` as inclusive, so callers must also drop `<= cursor`).
   */
  async readChannel(channel: string, oldestTs?: string): Promise<ReadResult> {
    const json = await this.post('conversations.history', {
      channel,
      limit: 50,
      ...(oldestTs ? { oldest: oldestTs } : {})
    });
    return { messages: normalizeMessages(json.messages) };
  }

  /** Read replies in a thread newer than `oldestTs`. Includes the parent message. */
  async readThread(channel: string, parentTs: string, oldestTs?: string): Promise<ReadResult> {
    const json = await this.post('conversations.replies', {
      channel,
      ts: parentTs,
      limit: 50,
      ...(oldestTs ? { oldest: oldestTs } : {})
    });
    return { messages: normalizeMessages(json.messages) };
  }

  /** Post a reply in a thread. Returns the new message ts. */
  async postThreadReply(channel: string, parentTs: string, text: string): Promise<string> {
    const json = await this.post('chat.postMessage', {
      channel,
      thread_ts: parentTs,
      text,
      unfurl_links: false,
      unfurl_media: false
    });
    return String(json.ts ?? '');
  }

  /**
   * Read the reactions on a single message. Returns each reaction name with the
   * list of user ids who added it — the approval flow checks whether the authed
   * user reacted ✅/❌ on a prompt message.
   */
  async getReactions(channel: string, ts: string): Promise<ReactionSummary[]> {
    let json: Record<string, any>;
    try {
      json = await this.post('reactions.get', { channel, timestamp: ts, full: true });
    } catch (err) {
      // A prompt with no reactions yet returns `no_reaction` — treat as empty,
      // not an error, so the poll loop doesn't trip its circuit breaker.
      if (err instanceof SlackLogicalError && err.code === 'no_reaction') return [];
      throw err;
    }
    const reactions = json.message?.reactions;
    if (!Array.isArray(reactions)) return [];
    return reactions
      .filter((r) => r && typeof r.name === 'string')
      .map((r) => ({
        name: String(r.name),
        users: Array.isArray(r.users) ? r.users.map(String) : []
      }));
  }

  /**
   * POST a JSON body to a Web API method, parse Slack's `{ok}` envelope, and
   * raise the typed errors the pollers expect. Slack's Web API is happy with
   * a JSON body when the token is in the Authorization header.
   */
  private async post(method: string, body: Record<string, unknown>): Promise<Record<string, any>> {
    const init: BrokeredFetchInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${this.token}`
      },
      body: JSON.stringify(body)
    };
    const res = await this.fetch(`${SLACK_API}/${method}`, init);

    if (res.status === 429) {
      const header = headerCaseInsensitive(res.headers, 'retry-after');
      const secs = Number(header);
      throw new SlackRateLimited(Number.isFinite(secs) && secs > 0 ? secs : this.defaultRetryAfter);
    }
    if (!res.ok) {
      // Transport-level non-200 that isn't a 429. Treat as a logical failure
      // tagged with the HTTP status so the auth circuit doesn't trip on it.
      throw new SlackLogicalError(`http_${res.status}`, method);
    }

    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(res.body) as Record<string, any>;
    } catch {
      throw new SlackLogicalError('invalid_json', method);
    }
    if (parsed.ok !== true) {
      throw new SlackLogicalError(String(parsed.error ?? 'unknown'), method);
    }
    return parsed;
  }
}

/**
 * Look up a header regardless of casing. The brokered fetch response is a plain
 * `Record<string,string>` with no normalization guarantee, so a proxy emitting
 * `Retry-After`/`RETRY-AFTER` must still match.
 */
function headerCaseInsensitive(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** Project raw Slack messages onto the minimal {@link InboundSlackMessage}. */
function normalizeMessages(raw: unknown): InboundSlackMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: InboundSlackMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const ts = (m as { ts?: unknown }).ts;
    if (typeof ts !== 'string') continue;
    out.push({
      ts,
      user: typeof (m as { user?: unknown }).user === 'string' ? (m as { user: string }).user : undefined,
      threadTs:
        typeof (m as { thread_ts?: unknown }).thread_ts === 'string'
          ? (m as { thread_ts: string }).thread_ts
          : undefined,
      text: typeof (m as { text?: unknown }).text === 'string' ? (m as { text: string }).text : undefined
    });
  }
  return out;
}
