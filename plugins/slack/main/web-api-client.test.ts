import { describe, it, expect, vi } from 'vitest';
import type { BrokeredFetchResponse } from '@zana-ai/zcc-extension-sdk/main';
import { WebApiSlackClient, SlackLogicalError, SlackRateLimited } from './web-api-client.js';

function res(partial: Partial<BrokeredFetchResponse>): BrokeredFetchResponse {
  return { status: 200, ok: true, headers: {}, body: '{"ok":true}', ...partial };
}

function clientWith(fetch: ReturnType<typeof vi.fn>) {
  return new WebApiSlackClient({ fetch: fetch as never, botToken: 'xoxb-test' });
}

describe('WebApiSlackClient', () => {
  it('sends the token as a bearer header', async () => {
    const fetch = vi.fn().mockResolvedValue(res({ body: '{"ok":true,"user_id":"U1","team":"T"}' }));
    await clientWith(fetch).authTest();
    const init = fetch.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer xoxb-test');
    expect(fetch.mock.calls[0][0]).toBe('https://slack.com/api/auth.test');
  });

  it('parses conversations.history into inbound messages', async () => {
    const fetch = vi.fn().mockResolvedValue(
      res({
        body: JSON.stringify({
          ok: true,
          messages: [
            { ts: '2.0', user: 'U1', text: 'hi' },
            { ts: '1.0', user: 'U2', text: 'older', thread_ts: '0.5' },
            { bogus: true }
          ]
        })
      })
    );
    const out = await clientWith(fetch).readChannel('C1', '0.0');
    expect(out.messages).toEqual([
      { ts: '2.0', user: 'U1', text: 'hi', threadTs: undefined },
      { ts: '1.0', user: 'U2', text: 'older', threadTs: '0.5' }
    ]);
  });

  it('maps {ok:false} to SlackLogicalError with the code', async () => {
    const fetch = vi.fn().mockResolvedValue(res({ body: '{"ok":false,"error":"channel_not_found"}' }));
    await expect(clientWith(fetch).readChannel('C1')).rejects.toMatchObject({
      name: 'SlackLogicalError',
      code: 'channel_not_found'
    });
  });

  it('maps 429 to SlackRateLimited with retry-after', async () => {
    const fetch = vi.fn().mockResolvedValue(res({ status: 429, ok: false, headers: { 'retry-after': '7' } }));
    const err = await clientWith(fetch).readChannel('C1').catch((e) => e);
    expect(err).toBeInstanceOf(SlackRateLimited);
    expect((err as SlackRateLimited).retryAfterSeconds).toBe(7);
  });

  it('reads retry-after regardless of header casing', async () => {
    const fetch = vi.fn().mockResolvedValue(res({ status: 429, ok: false, headers: { 'Retry-After': '12' } }));
    const err = await clientWith(fetch).readChannel('C1').catch((e) => e);
    expect((err as SlackRateLimited).retryAfterSeconds).toBe(12);
  });

  it('maps non-200 non-429 to a logical http_ error', async () => {
    const fetch = vi.fn().mockResolvedValue(res({ status: 500, ok: false }));
    await expect(clientWith(fetch).readChannel('C1')).rejects.toMatchObject({
      name: 'SlackLogicalError',
      code: 'http_500'
    });
  });

  it('getReactions returns names with their user lists', async () => {
    const fetch = vi.fn().mockResolvedValue(
      res({
        body: JSON.stringify({
          ok: true,
          message: { reactions: [{ name: 'white_check_mark', users: ['U1', 'U2'] }, { name: 'eyes', users: ['U3'] }] }
        })
      })
    );
    const out = await clientWith(fetch).getReactions('C1', '5.0');
    expect(out).toEqual([
      { name: 'white_check_mark', users: ['U1', 'U2'] },
      { name: 'eyes', users: ['U3'] }
    ]);
  });

  it('getReactions treats no_reaction as empty, not an error', async () => {
    const fetch = vi.fn().mockResolvedValue(res({ body: '{"ok":false,"error":"no_reaction"}' }));
    await expect(clientWith(fetch).getReactions('C1', '5.0')).resolves.toEqual([]);
  });

  it('postThreadReply passes thread_ts and returns the new ts', async () => {
    const fetch = vi.fn().mockResolvedValue(res({ body: '{"ok":true,"ts":"9.9"}' }));
    const ts = await clientWith(fetch).postThreadReply('C1', 'P1', 'hello');
    expect(ts).toBe('9.9');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ channel: 'C1', thread_ts: 'P1', text: 'hello' });
  });
});

// The SlackLogicalError export is used directly in pollers; smoke-check shape.
it('SlackLogicalError carries name+code', () => {
  const e = new SlackLogicalError('invalid_auth', 'auth.test');
  expect(e.name).toBe('SlackLogicalError');
  expect(e.code).toBe('invalid_auth');
});
