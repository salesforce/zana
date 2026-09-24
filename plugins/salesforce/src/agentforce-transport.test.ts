import { describe, expect, it, vi } from 'vitest';
import { AgentforceTransport } from '../lib/agentforce-transport.js';
import type { ResolvedOrg } from '../lib/types.js';
const org = { instanceUrl: 'https://test.my.salesforce.com', accessToken: 'SECRET' } as ResolvedOrg;
const path = '/einstein/ai-agent/v1.1/preview/sessions';
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
describe('Agentforce bounded transport', () => {
  it('bootstraps only on a Salesforce HTTPS origin, blocks redirects and keeps tokens out of returned data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ access_token: 'JWT' }));
    const transport = new AgentforceTransport(fetcher);
    expect(await transport.bootstrap(org)).toBe('JWT');
    expect(fetcher).toHaveBeenCalledWith('https://test.my.salesforce.com/agentforce/bootstrap/nameduser', expect.objectContaining({ redirect: 'error', headers: { Cookie: 'sid=SECRET', Accept: 'application/json' }, signal: expect.any(AbortSignal) }));
    for (const instanceUrl of ['http://test.my.salesforce.com', 'https://salesforce.com.evil.example', 'https://salesforce.com:444', 'https://me@my.salesforce.com']) await expect(transport.bootstrap({ ...org, instanceUrl })).rejects.toThrow('HTTPS Salesforce');
    fetcher.mockResolvedValueOnce(reply({}, 401));
    await expect(transport.bootstrap(org)).rejects.toThrow('authentication');
  });
  it('walks known hosts only on 404; pinned sends and failed POSTs never replay', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({}, 404)).mockResolvedValueOnce(reply({ sessionId: '1' }));
    const transport = new AgentforceTransport(fetcher);
    expect((await transport.request('JWT', path, { test: true })).host).toBe('test.api.salesforce.com');
    expect(fetcher.mock.calls.map(c => c[0])).toEqual([`https://api.salesforce.com${path}`, `https://test.api.salesforce.com${path}`]);
    fetcher.mockClear().mockResolvedValue(reply({}, 404));
    await expect(transport.request('JWT', path, {}, 'test.api.salesforce.com')).rejects.toThrow('404');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear().mockResolvedValue(reply({}, 500));
    await expect(transport.request('JWT', path, {})).rejects.toThrow('not retried');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(reply({}, 403));
    await expect(transport.request('JWT', '/einstein/platform/v1/models/example/chat-generations', {})).rejects.toThrow('Models API');
    fetcher.mockClear().mockResolvedValue(reply({}, 404));
    await expect(transport.request('JWT', path)).rejects.toThrow('404');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('bounds both declared and streaming bodies; tolerates empty/non-JSON errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('x', { headers: { 'content-length': '3000000' } })).mockResolvedValueOnce(new Response('x'.repeat(2097153))).mockResolvedValueOnce(new Response('<html>', { status: 500 })).mockResolvedValueOnce(new Response(null, { status: 500 }));
    const transport = new AgentforceTransport(fetcher);
    await expect(transport.request('JWT', path)).rejects.toThrow('2 MiB');
    await expect(transport.request('JWT', path)).rejects.toThrow('2 MiB');
    await expect(transport.request('JWT', path)).rejects.toThrow('500');
    await expect(transport.request('JWT', path)).rejects.toThrow('500');
    await expect(transport.request('JWT', '/arbitrary')).rejects.toThrow('Unsupported');
    await expect(transport.request('JWT', path + '?redirect=evil')).rejects.toThrow('Unsupported');
    await expect(transport.request('JWT', path, undefined, 'evil.example' as never)).rejects.toThrow('Unsupported');
  });
  it('passes cancellation through and does not leak credential-bearing network errors as API content', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => { init?.signal?.throwIfAborted(); return reply(null); });
    const transport = new AgentforceTransport(fetcher);
    const c = new AbortController(); c.abort();
    await expect(transport.request('JWT', path, {}, undefined, c.signal)).rejects.toThrow();
    expect((await transport.request('JWT', path)).body).toEqual({});
  });
});
