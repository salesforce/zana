/**
 * Slack transport that reuses the local AI Expert Suite MCP gateway instead of
 * a pasted bot token — so the user authenticates Slack once in that app and the
 * bot rides on it (zero token config).
 *
 * HOW IT WORKS (verified 2026-06-14, see memory `aisuite-slack-mcp-reuse`):
 *   - The gateway is a persistent daemon on http://127.0.0.1:29051 exposing an
 *     HTTP MCP endpoint at /mcp/servers/slack (JSON-RPC 2.0). Its bearer token
 *     lives in `~/.aisuite/marketplaces/aisuite/plugins/slack/.mcp.json`. The
 *     token is stable for days but CAN rotate, so we read it fresh from disk on
 *     construction and RE-READ it once on a 401 before giving up.
 *   - Tools map 1:1 to the bot's needs: slack_read_channel, slack_read_thread,
 *     slack_send_message (thread_ts), slack_get_reactions.
 *
 * THE CATCH: the MCP returns HUMAN-FORMATTED MARKDOWN inside a JSON string, not
 * structured Slack JSON. So reads are SCRAPED from labelled lines per
 * `### Result N` block (`Message_ts:`, `From: … (ID: U…)`, `Text:`, and
 * `thread_ts=` lifted from the Permalink). This is brittle by nature — if the
 * gateway changes its formatting, the scraper must follow. It's covered by a
 * test against a captured real response.
 *
 * Rate limits are aggressive (a 2-message read returned MCP error -32005); the
 * caller must poll slower on this transport than on the Web API. We map -32005
 * to {@link SlackRateLimited} so the pollers' existing cooldown kicks in.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

type Fetch = NonNullable<MainModuleContext['fetch']>;

/** Where the gateway writes the Slack MCP endpoint + bearer token. */
const MCP_CONFIG_PATH = join(
  homedir(),
  '.aisuite',
  'marketplaces',
  'aisuite',
  'plugins',
  'slack',
  '.mcp.json'
);

/** MCP -32005 carries a "Too Many Requests" message; default cooldown for it. */
const MCP_RATE_LIMIT_COOLDOWN_S = 30;

export interface McpClientOptions {
  readonly fetch: Fetch;
  /** Override the config path (tests). */
  readonly configPath?: string;
}

/** The endpoint + token read from the gateway's `.mcp.json`. */
interface GatewayConn {
  url: string;
  token: string;
}

export class McpSlackClient implements SlackClient {
  private readonly fetch: Fetch;
  private readonly configPath: string;
  private conn: GatewayConn | null = null;
  private nextId = 1;

  constructor(opts: McpClientOptions) {
    this.fetch = opts.fetch;
    this.configPath = opts.configPath ?? MCP_CONFIG_PATH;
  }

  /**
   * The gateway has no `auth.test` Slack tool exposed the way the Web API does;
   * a successful `initialize` proves the endpoint + token are good. We can't
   * resolve the Slack user id from here — the panel asks the user to paste it
   * (or we leave it for them to set). Returns empty ids on success.
   */
  async authTest(): Promise<AuthTestResult> {
    await this.ensureInitialized(true);
    return { userId: '', user: '', team: '' };
  }

  async readChannel(channel: string, oldestTs?: string): Promise<ReadResult> {
    const text = await this.callTool('slack_read_channel', {
      channel_id: channel,
      limit: 50,
      ...(oldestTs ? { oldest: oldestTs } : {})
    });
    return { messages: parseMessages(text) };
  }

  async readThread(channel: string, parentTs: string, oldestTs?: string): Promise<ReadResult> {
    const text = await this.callTool('slack_read_thread', {
      channel_id: channel,
      message_ts: parentTs,
      limit: 100,
      ...(oldestTs ? { oldest: oldestTs } : {})
    });
    return { messages: parseMessages(text) };
  }

  async postThreadReply(channel: string, parentTs: string, text: string): Promise<string> {
    // The gateway's send returns a formatted confirmation, not a clean ts. We
    // don't depend on the returned ts for thread replies (the pollers' ownTs is
    // best-effort; the prefix is the durable self-filter), so return ''.
    await this.callTool('slack_send_message', {
      channel_id: channel,
      thread_ts: parentTs,
      message: text
    });
    return '';
  }

  async getReactions(channel: string, ts: string): Promise<ReactionSummary[]> {
    const text = await this.callTool('slack_get_reactions', {
      channel_id: channel,
      message_ts: ts
    });
    return parseReactions(text);
  }

  // ---- gateway plumbing ----------------------------------------------------

  /** Read endpoint + token from the gateway config; cached after first read. */
  private async loadConn(force = false): Promise<GatewayConn> {
    if (this.conn && !force) return this.conn;
    let raw: string;
    try {
      raw = await readFile(this.configPath, 'utf-8');
    } catch {
      throw new SlackLogicalError('gateway_config_missing', 'loadConn');
    }
    let parsed: { mcpServers?: { slack?: { url?: string; headers?: Record<string, string> } } };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SlackLogicalError('gateway_config_invalid', 'loadConn');
    }
    const slack = parsed.mcpServers?.slack;
    const url = slack?.url;
    const auth = slack?.headers?.['Authorization'] ?? slack?.headers?.['authorization'];
    const token = auth?.replace(/^Bearer\s+/i, '');
    if (!url || !token) throw new SlackLogicalError('gateway_config_incomplete', 'loadConn');
    this.conn = { url, token };
    return this.conn;
  }

  /** MCP `initialize` handshake (cheap; the gateway is stateless per request). */
  private async ensureInitialized(force = false): Promise<void> {
    await this.loadConn(force);
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'zcc-slack-bot', version: '1' }
    });
  }

  /**
   * Call a Slack MCP tool and return the primary text payload. Retries ONCE
   * after re-reading the token on an auth failure (the gateway token can
   * rotate). Maps MCP rate-limit (-32005) → SlackRateLimited.
   */
  private async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      return await this.callToolOnce(name, args);
    } catch (err) {
      if (err instanceof SlackLogicalError && err.code === 'unauthorized') {
        // Token may have rotated — re-read from disk and try once more.
        await this.loadConn(true);
        return this.callToolOnce(name, args);
      }
      throw err;
    }
  }

  private async callToolOnce(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.rpc('tools/call', { name, arguments: args });
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
    const block = Array.isArray(content) ? content.find((c) => c.type === 'text') : undefined;
    return block?.text ?? '';
  }

  /** One JSON-RPC round-trip to the gateway. Throws typed Slack errors. */
  private async rpc(method: string, params: unknown): Promise<unknown> {
    const conn = await this.loadConn();
    // The bearer token is read from a local file and attached below; `conn.url`
    // is read from that SAME file. The gateway is documented as loopback
    // (http://127.0.0.1:29051) — so refuse to ship the token off-box if a
    // tampered/misconfigured config points the url at a non-loopback host.
    if (!isLoopbackUrl(conn.url)) {
      throw new SlackLogicalError('gateway_not_loopback', method);
    }
    const init: BrokeredFetchInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${conn.token}`
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params })
    };
    const res = await this.fetch(conn.url, init);
    if (res.status === 401 || res.status === 403) {
      throw new SlackLogicalError('unauthorized', method);
    }
    if (res.status === 429) {
      throw new SlackRateLimited(MCP_RATE_LIMIT_COOLDOWN_S);
    }
    if (!res.ok) {
      throw new SlackLogicalError(`http_${res.status}`, method);
    }
    const data = parseJsonRpc(res.body);
    if (data.error) {
      // -32005 is the gateway's "Too Many Requests"; treat as rate limit so the
      // pollers' cooldown applies instead of the auth circuit.
      if (data.error.code === -32005 || /too many requests/i.test(data.error.message ?? '')) {
        throw new SlackRateLimited(MCP_RATE_LIMIT_COOLDOWN_S);
      }
      throw new SlackLogicalError(String(data.error.code ?? 'mcp_error'), method);
    }
    return data.result;
  }
}

/**
 * True only when `url` targets the local loopback interface (127.0.0.0/8, ::1,
 * or `localhost`). Used to refuse sending the gateway bearer token to any host
 * that isn't on-box, in case the gateway config is tampered with or
 * misconfigured. A malformed url returns false (fail closed).
 */
export function isLoopbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  // `URL.hostname` keeps the brackets on an IPv6 literal (`[::1]`); strip them.
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === 'localhost' || host === '::1') return true;
  // IPv4 loopback is the whole 127.0.0.0/8 block.
  const m = host.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every((o) => Number(o) <= 255);
}

interface JsonRpcReply {
  result?: unknown;
  error?: { code?: number; message?: string };
}

/**
 * The gateway answers with either a plain JSON body or an SSE stream
 * (`data: {…}` lines). Parse the first JSON-RPC object out of either.
 */
function parseJsonRpc(body: string): JsonRpcReply {
  for (const rawLine of body.split('\n')) {
    const line = rawLine.startsWith('data: ') ? rawLine.slice(6) : rawLine;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as JsonRpcReply;
      if (obj && (obj.result !== undefined || obj.error !== undefined)) return obj;
    } catch {
      // not this line
    }
  }
  return {};
}

// ---- Markdown scrapers -----------------------------------------------------
//
// The gateway returns a formatted-Markdown string inside a JSON envelope, but
// the SHAPE differs by tool (all verified live 2026-06-25):
//   - slack_search_public → {"results":"### Result N of M\nMessage_ts: …\n
//                            From: Name (ID: U…)\nText: …"}
//   - slack_read_channel  → {"messages":"Channel: #x (C…)\n\n=== Message from
//                            Name <email> (U…) at TIME === \nMessage TS: …\n<text>"}
//   - slack_read_thread   → {"messages":"=== THREAD PARENT MESSAGE ===\nFrom:
//                            Name (U…)\nTime: …\nMessage TS: …\n<text>\n
//                            *Sent using* …\nReactions: …\n\n=== THREAD REPLIES
//                            (N total) ===\n--- Reply 1 of N ---\nFrom: …\n
//                            Message TS: …\n<text>"}
//   - slack_get_reactions → {"result":":emoji: × N — Name (U…)"}
// So we (a) unwrap any of the envelope keys, and (b) split on the union of the
// per-message delimiters, KEEPING the delimiter line (the read_channel form
// carries the user id on it). Each block with a resolvable ts is a message;
// everything else (channel preamble, the REPLIES section header) is skipped.

/** Unwrap the `{"<key>": "<markdown>"}` envelope, if present (any read/search/reaction key). */
function unwrapResults(text: string): string {
  const t = text.trim();
  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      for (const key of ['results', 'messages', 'result']) {
        if (typeof obj[key] === 'string') return obj[key] as string;
      }
    } catch {
      // fall through — treat as raw markdown
    }
  }
  return text;
}

/** Slack ts inside a permalink: `…/p1781426302692929` → `1781426302.692929`. */
function tsFromPermalinkDigits(block: string): string | undefined {
  const m = block.match(/\/p(\d{16})/);
  if (!m) return undefined;
  const d = m[1];
  return `${d.slice(0, 10)}.${d.slice(10)}`;
}

/**
 * One message block starts at a `### Result …` (search), any `=== … ===`
 * (read_channel `Message from`, read_thread `PARENT`/`REPLIES`), or a
 * `--- Reply N of M ---` line. Lookahead split keeps that line in the block so
 * read_channel's user id (which lives on the `=== Message from … (U…) ===`
 * header) survives.
 */
const BLOCK_DELIMITER = /(?=^(?:###\s+Result\b|===|---\s+Reply\b))/m;

/**
 * Parse a channel/thread/search read into {@link InboundSlackMessage}[]. Each
 * message needs at minimum a `ts`; without it we skip the block (the poll loop
 * keys everything on ts) — which is also how non-message blocks (preamble, the
 * `=== THREAD REPLIES (N total) ===` header) get dropped.
 */
export function parseMessages(text: string): InboundSlackMessage[] {
  const md = unwrapResults(text);
  const out: InboundSlackMessage[] = [];
  for (const block of md.split(BLOCK_DELIMITER)) {
    // ts: reads use `Message TS:` (space), search uses `Message_ts:`; else the
    // permalink digits.
    const ts = matchLine(block, /^Message[ _]ts:\s*(\S+)/im) ?? tsFromPermalinkDigits(block);
    if (!ts) continue;
    // user id: search wraps it `(ID: U…)`; reads carry a bare `(U…)` (on the
    // `Message from`/`From:` line). First parenthesised U-id wins.
    const user = block.match(/\(ID:\s*(U[A-Z0-9]+)/)?.[1] ?? block.match(/\((U[A-Z0-9]{6,})\)/)?.[1];
    // `thread_ts=…` appears in the permalink query when the message is threaded.
    const threadTs = block.match(/thread_ts=(\d+\.\d+)/)?.[1];
    const text = extractText(block);
    out.push({
      ts,
      user: user || undefined,
      threadTs: threadTs || undefined,
      text: text || undefined
    });
  }
  return out;
}

/**
 * Pull the message body from a block. Search blocks use an explicit `Text:`
 * label; read blocks put the body on the line(s) AFTER `Message TS:`, ending at
 * the gateway's trailer/sentinel lines (`*Sent using*`, `Reactions:`, the
 * `No thread messages` empty-thread note, or the next block header).
 */
function extractText(block: string): string | undefined {
  const labelled = block.match(/^Text:\s*([\s\S]*?)(?=\n[A-Z][A-Za-z_]*:|\n*$)/m);
  if (labelled) return labelled[1].trim() || undefined;
  const afterTs = block.match(/^Message[ _]ts:[^\n]*\n([\s\S]*)/im);
  if (!afterTs) return undefined;
  const lines: string[] = [];
  for (const line of afterTs[1].split('\n')) {
    if (/^\*Sent using\*/.test(line)) break;
    if (/^Reactions:/.test(line)) break;
    if (/^No thread mess/i.test(line)) break;
    if (/^===/.test(line) || /^---\s+Reply\b/.test(line)) break;
    lines.push(line);
  }
  return lines.join('\n').trim() || undefined;
}

/**
 * Parse a `slack_get_reactions` response. The reactions tool returns lines like
 * `:white_check_mark: (2): Alice (U1), Bob (U2)` — we extract the emoji name and
 * the user ids. Tolerant of formatting: any `:name:` followed by `(ID: U…)` ids.
 */
export function parseReactions(text: string): ReactionSummary[] {
  const md = unwrapResults(text);
  const out: ReactionSummary[] = [];
  // Match an emoji token, then collect U-ids appearing before the next emoji token.
  const emojiRe = /:([a-z0-9_+-]+):/gi;
  const tokens: Array<{ name: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = emojiRe.exec(md))) tokens.push({ name: m[1], index: m.index });
  for (let i = 0; i < tokens.length; i++) {
    const start = tokens[i].index;
    const end = i + 1 < tokens.length ? tokens[i + 1].index : md.length;
    const segment = md.slice(start, end);
    const users = Array.from(segment.matchAll(/\b(U[A-Z0-9]{6,})\b/g)).map((u) => u[1]);
    if (users.length > 0) out.push({ name: tokens[i].name, users });
  }
  return out;
}

function matchLine(block: string, re: RegExp): string | undefined {
  return block.match(re)?.[1];
}

function matchBlock(block: string, re: RegExp): string | undefined {
  return block.match(re)?.[1];
}
