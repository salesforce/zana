import { describe, it, expect, vi } from 'vitest';
import type { BrokeredFetchResponse } from '@zana-ai/zcc-extension-sdk/main';
import { McpSlackClient, parseMessages, parseReactions, isLoopbackUrl } from './mcp-client.js';
import { SlackRateLimited, SlackLogicalError } from './slack-client.js';

// --- The Markdown scraper (the brittle part) --------------------------------
// These fixtures mirror the REAL gateway response shape captured 2026-06-14:
// `{"results":"# ...\n### Result N of M\nMessage_ts: ...\nFrom: Name (ID: U…)\n
//  Permalink: [link](…/pDIGITS?thread_ts=…)\nText: ...\n---\n### Result …"}`.

describe('parseMessages (gateway Markdown → InboundSlackMessage[])', () => {
  it('extracts ts, user, threadTs, and text from result blocks', () => {
    const body = JSON.stringify({
      results: [
        '# Search Results',
        '',
        '## Messages (2 results)',
        '### Result 1 of 2',
        'Channel: #tmp (ID: C0B4LT43XD4)',
        'From: Example User <user@example.test> (ID: U00000001)',
        'Time: 2026-06-14 10:38:22 CEST',
        'Message_ts: 1781426302.692929',
        'Permalink: [link](https://x.slack.com/archives/C0B4LT43XD4/p1781426302692929?thread_ts=1781425116.230409&cid=C0B4LT43XD4)',
        'Text: ',
        'run fix the failing test',
        '',
        '---',
        '### Result 2 of 2',
        'From: Someone Else (ID: U99ZZZ123)',
        'Message_ts: 1781426000.000100',
        'Permalink: [link](https://x.slack.com/archives/C0/p1781426000000100)',
        'Text: hello world',
        '---'
      ].join('\n')
    });

    const msgs = parseMessages(body);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({
      ts: '1781426302.692929',
      user: 'U00000001',
      threadTs: '1781425116.230409'
    });
    expect(msgs[0].text).toContain('run fix the failing test');
    expect(msgs[1]).toMatchObject({ ts: '1781426000.000100', user: 'U99ZZZ123' });
    expect(msgs[1].threadTs).toBeUndefined(); // no thread_ts in permalink
    expect(msgs[1].text).toBe('hello world');
  });

  it('derives ts from the permalink digits when Message_ts is absent', () => {
    const body = JSON.stringify({
      results: '### Result 1 of 1\nPermalink: [link](https://x.slack.com/archives/C0/p1781426302692929)\nText: hi'
    });
    expect(parseMessages(body)[0].ts).toBe('1781426302.692929');
  });

  it('skips blocks with no resolvable ts (the poll loop keys on ts)', () => {
    const body = JSON.stringify({ results: '### Result 1 of 1\nFrom: X (ID: U1)\nText: no ts here' });
    expect(parseMessages(body)).toHaveLength(0);
  });

  it('handles the raw-markdown (un-enveloped) form too', () => {
    const raw = '### Result 1 of 1\nMessage_ts: 100.5\nText: bare';
    expect(parseMessages(raw)[0]).toMatchObject({ ts: '100.5', text: 'bare' });
  });

  it('returns [] on empty / non-result text', () => {
    expect(parseMessages('')).toEqual([]);
    expect(parseMessages('{"results":"No messages found."}')).toEqual([]);
  });
});

describe('parseReactions', () => {
  it('pairs each emoji with the user ids near it', () => {
    const body = JSON.stringify({
      results: ':white_check_mark: (1): Guillaume (U02D89V1WG4)\n:x: (1): Bob (U99ZZZ123)'
    });
    const r = parseReactions(body);
    expect(r).toEqual([
      { name: 'white_check_mark', users: ['U02D89V1WG4'] },
      { name: 'x', users: ['U99ZZZ123'] }
    ]);
  });

  it('returns [] when there are no reactions', () => {
    expect(parseReactions('{"results":"No reactions on this message."}')).toEqual([]);
  });
});

// --- REAL gateway read/reaction formats (captured live 2026-06-25) ----------
// The original fixtures above mirror `slack_search_public` output (`### Result
// N of M` inside a `{"results": …}` envelope). But the live bot calls
// slack_read_channel / slack_read_thread / slack_get_reactions, whose output is
// SHAPED DIFFERENTLY — captured verbatim from the AI Expert Suite gateway:
//   - read_channel:  {"messages":"… === Message from Name <email> (U…) at TIME === \n
//                     Message TS: <ts>\n<text>"}
//   - read_thread:   {"messages":"=== THREAD PARENT MESSAGE ===\nFrom: … (U…)\n
//                     Time: …\nMessage TS: <ts>\n<text>\n*Sent using* …\n
//                     Reactions: …\n\n=== THREAD REPLIES (N total) ===\n
//                     --- Reply 1 of N ---\nFrom: … (U…)\nMessage TS: <ts>\n<text>"}
//   - get_reactions: {"result":":emoji: × N — Name (U…)"}
// (envelope key is `messages` / `result`, NOT `results`.)
describe('parseMessages (REAL slack_read_channel format)', () => {
  it('extracts ts + user + text from the "=== Message from … ===" header form', () => {
    const body = JSON.stringify({
      messages: [
        'Channel: #zana (C0BD8JWDLCR)',
        '',
        '=== Message from Jane Doe <jdoe@example.com> (U02MV792NH3) at 2026-06-25 19:07:02 IDT === ',
        'Message TS: 1782403622.683679',
        'run fix the build'
      ].join('\n'),
      pagination_info: 'There are no more messages available.\n'
    });
    const msgs = parseMessages(body);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ ts: '1782403622.683679', user: 'U02MV792NH3' });
    expect(msgs[0].text).toBe('run fix the build');
  });
});

describe('parseMessages (REAL slack_read_thread format)', () => {
  it('extracts both the parent and a reply, stripping the trailer/metadata lines', () => {
    const body = JSON.stringify({
      messages: [
        '=== THREAD PARENT MESSAGE ===',
        'From: Jane Doe <jdoe@example.com> (U02MV792NH3)',
        'Time: 2026-06-25 19:15:06 IDT',
        'Message TS: 1782404106.483349',
        'zcc-bot parent',
        '*Sent using* <@U095RFJ8GTH|Slack MCP App>',
        'Reactions: white_check_mark (1)',
        '',
        '=== THREAD REPLIES (1 total) ===',
        '',
        '--- Reply 1 of 1 ---',
        'From: Jane Doe <jdoe@example.com> (U02MV792NH3)',
        'Time: 2026-06-25 19:15:19 IDT',
        'Message TS: 1782404119.236149',
        'hint use the other config',
        '*Sent using* <@U095RFJ8GTH|Slack MCP App>'
      ].join('\n'),
      pagination_info: 'There are no more messages in this thread.\n'
    });
    const msgs = parseMessages(body);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ ts: '1782404106.483349', user: 'U02MV792NH3' });
    expect(msgs[0].text).toBe('zcc-bot parent'); // no "*Sent using*" / "Reactions:" bleed
    expect(msgs[1]).toMatchObject({ ts: '1782404119.236149', user: 'U02MV792NH3' });
    expect(msgs[1].text).toBe('hint use the other config');
  });

  it('returns just the parent when the thread has no replies', () => {
    const body = JSON.stringify({
      messages: [
        '=== THREAD PARENT MESSAGE ===',
        'From: Jane Doe <jdoe@example.com> (U02MV792NH3)',
        'Time: 2026-06-25 18:57:59 IDT',
        'Message TS: 1782403079.507679',
        'Help',
        '',
        'No thread messsages'
      ].join('\n'),
      pagination_info: 'There are no more messages in this thread.\n'
    });
    const msgs = parseMessages(body);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ ts: '1782403079.507679', text: 'Help' });
  });
});

describe('parseReactions (REAL slack_get_reactions format)', () => {
  it('pairs the emoji with the reacting user from the "× N — Name (U…)" form', () => {
    const body = JSON.stringify({
      result: 'Reactions on message:\n\n:white_check_mark: × 1 — Jane Doe (U02MV792NH3)'
    });
    expect(parseReactions(body)).toEqual([
      { name: 'white_check_mark', users: ['U02MV792NH3'] }
    ]);
  });

  it('returns [] for the "No reactions found" sentinel', () => {
    expect(parseReactions(JSON.stringify({ result: 'No reactions found on this message.' }))).toEqual([]);
  });
});

// --- Transport plumbing -----------------------------------------------------

function res(partial: Partial<BrokeredFetchResponse>): BrokeredFetchResponse {
  return { status: 200, ok: true, headers: {}, body: '{"jsonrpc":"2.0","id":1,"result":{}}', ...partial };
}

/** A McpSlackClient wired to a fake fetch + an in-memory gateway config. */
function clientWith(fetch: ReturnType<typeof vi.fn>, configPath = '/fake/.mcp.json') {
  return new McpSlackClient({ fetch: fetch as never, configPath });
}

describe('McpSlackClient transport', () => {
  // The client reads the gateway config from disk; point it at a temp file.
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cfg-'));
  const cfgPath = path.join(cfgDir, '.mcp.json');
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      mcpServers: {
        slack: { url: 'http://127.0.0.1:29051/mcp/servers/slack', headers: { Authorization: 'Bearer TOK123' } }
      }
    })
  );

  it('sends the gateway token + parses a tools/call result', async () => {
    const fetch = vi.fn().mockResolvedValue(
      res({
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: '{"results":"### Result 1 of 1\\nMessage_ts: 5.5\\nText: hi"}' }] }
        })
      })
    );
    const c = clientWith(fetch, cfgPath);
    const out = await c.readChannel('C1', '0.0');
    expect(out.messages[0]).toMatchObject({ ts: '5.5', text: 'hi' });
    // token forwarded as bearer
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer TOK123');
    // hit the gateway url
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:29051/mcp/servers/slack');
  });

  it('maps MCP -32005 to SlackRateLimited', async () => {
    const fetch = vi.fn().mockResolvedValue(
      res({ body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Too Many Requests' } }) })
    );
    await expect(clientWith(fetch, cfgPath).readChannel('C1')).rejects.toBeInstanceOf(SlackRateLimited);
  });

  it('throws gateway_config_missing when the config file is absent', async () => {
    const fetch = vi.fn();
    await expect(clientWith(fetch, '/no/such/.mcp.json').readChannel('C1')).rejects.toMatchObject({
      name: 'SlackLogicalError',
      code: 'gateway_config_missing'
    });
  });

  it('refuses to send the bearer token to a non-loopback gateway url', async () => {
    const offBoxCfg = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cfg-offbox-'));
    const offBoxPath = path.join(offBoxCfg, '.mcp.json');
    fs.writeFileSync(
      offBoxPath,
      JSON.stringify({
        mcpServers: {
          slack: { url: 'http://evil.example.com/mcp/servers/slack', headers: { Authorization: 'Bearer TOK123' } }
        }
      })
    );
    const fetch = vi.fn();
    await expect(clientWith(fetch, offBoxPath).readChannel('C1')).rejects.toMatchObject({
      name: 'SlackLogicalError',
      code: 'gateway_not_loopback'
    });
    // The token-bearing fetch must never have fired.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('parses an SSE-framed reply (data: lines)', async () => {
    const fetch = vi.fn().mockResolvedValue(
      res({
        body:
          'event: message\n' +
          'data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"results\\":\\"### Result 1 of 1\\\\nMessage_ts: 9.9\\\\nText: yo\\"}"}]}}\n\n'
      })
    );
    const out = await clientWith(fetch, cfgPath).readThread('C1', 'P1');
    expect(out.messages[0]).toMatchObject({ ts: '9.9', text: 'yo' });
  });
});

describe('isLoopbackUrl', () => {
  it('accepts loopback hosts', () => {
    expect(isLoopbackUrl('http://127.0.0.1:29051/mcp/servers/slack')).toBe(true);
    expect(isLoopbackUrl('http://127.5.6.7/x')).toBe(true); // whole 127/8 block
    expect(isLoopbackUrl('http://localhost:29051/mcp')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:29051/mcp')).toBe(true);
  });

  it('rejects non-loopback and malformed urls', () => {
    expect(isLoopbackUrl('http://example.com/mcp')).toBe(false);
    expect(isLoopbackUrl('https://169.254.169.254/latest')).toBe(false);
    expect(isLoopbackUrl('http://127.0.0.1.evil.com/mcp')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});
