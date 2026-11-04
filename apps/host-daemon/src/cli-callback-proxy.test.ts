import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { CLI_CALLBACK_MAX_BODY_BYTES, CLI_CALLBACK_MAX_RESPONSE_BYTES, cliCallbackPaths, startCliCallbackProxy, type CliCallbackRequest, type CliCallbackResponse } from './cli-callback-proxy.js';

const grant = { projectId: 'project', sessionId: '11111111-1111-4111-8111-111111111111', credential: 'a'.repeat(64) };
const path = `/mcp/${grant.projectId}/${grant.sessionId}/${grant.credential}`;
const proxies: Awaited<ReturnType<typeof startCliCallbackProxy>>[] = [];
afterEach(async () => { await Promise.all(proxies.splice(0).map(proxy => proxy.close())); });
async function proxy(forward = vi.fn(async (_request: CliCallbackRequest): Promise<CliCallbackResponse> => ({ status: 200, body: Buffer.from('{}'), contentType: 'application/json' })), timeoutMs?: number) {
  const instance = await startCliCallbackProxy({ grant, forward, timeoutMs }); proxies.push(instance); return { ...instance, forward };
}
function post(baseUrl: string, suffix = path, options: { method?: string; headers?: Record<string, string>; body?: string; rawPath?: string; chunks?: string[] } = {}) {
  const url = new URL(baseUrl);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest({ hostname: url.hostname, port: url.port, path: options.rawPath ?? url.pathname + suffix, method: options.method ?? 'POST', setHost: false, headers: { host: url.host, ...options.headers } }, response => {
      let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode!, body }));
    });
    request.on('error', reject);
    for (const chunk of options.chunks ?? []) request.write(chunk);
    request.end(options.body);
  });
}

it('forwards every exact granted callback and strips ambient credentials and browser headers', async () => {
  const p = await proxy();
  for (const suffix of cliCallbackPaths(grant)) {
    expect(await post(p.baseUrl, suffix, { body: '{}', headers: { authorization: 'Bearer wrong', cookie: 'private', 'x-zcc-host-id': 'spoof', 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' } })).toEqual({ status: 200, body: '{}' });
  }
  expect(p.forward).toHaveBeenCalledTimes(14);
  const received = p.forward.mock.calls[0]![0];
  expect(received.path).toBe(path); expect(received.body.toString()).toBe('{}');
  expect(received.headers).toEqual({ 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' });
});
it.each(['127.0.0.1', 'localhost', '[::1]'])('accepts only a loopback authority on the bound port: %s', async hostname => {
  const p = await proxy(); expect((await post(p.baseUrl, path, { headers: { host: `${hostname}:${new URL(p.baseUrl).port}` } })).status).toBe(200);
});
it.each([
  { origin: '' }, { 'sec-fetch-site': 'none' }, { host: 'attacker.invalid:80' }, { host: '127.0.0.1:1' },
  { host: '127.0.0.1' }, { host: '@127.0.0.1:80/' }, { host: 'invalid[' }, { host: '' }
])('rejects an untrusted authority or browser request: %j', async headers => {
  const p = await proxy(); expect((await post(p.baseUrl, path, { headers })).status).toBe(403); expect(p.forward).not.toHaveBeenCalled();
});
it.each(['/api/v1/projects', `${path}?other=1`, `${path}/`, path.replace('project', 'another'), path.replace('/mcp/', '/%6dcp/'), `/../${path}`, '/hook/notify/project/other/blocked'])('rejects an ungranted raw callback path: %s', async suffix => {
  const p = await proxy(); expect((await post(p.baseUrl, suffix)).status).toBe(403); expect(p.forward).not.toHaveBeenCalled();
});
it('rejects missing capability, absolute-form targets, and non-POST methods', async () => {
  const p = await proxy();
  expect((await post(p.baseUrl, path, { rawPath: path })).status).toBe(403);
  expect((await post(p.baseUrl, path, { rawPath: p.baseUrl + path })).status).toBe(403);
  expect((await post(p.baseUrl, path, { method: 'GET' })).status).toBe(405);
  expect(p.forward).not.toHaveBeenCalled();
});
it.each(['CONNECT', 'GET'])('rejects %s socket tunneling', async method => {
  const p = await proxy(), url = new URL(p.baseUrl);
  const output = await new Promise<string>((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname); let text = '';
    socket.on('error', reject); socket.on('data', chunk => { text += chunk; }); socket.on('end', () => resolve(text));
    socket.on('connect', () => socket.write(`${method} ${method === 'CONNECT' ? 'elsewhere:80' : url.pathname + path} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: upgrade\r\nUpgrade: websocket\r\n\r\n`));
  });
  expect(output).toContain('405 Method Not Allowed'); expect(p.forward).not.toHaveBeenCalled();
});
it('bounds both advertised and chunked request bodies before forwarding', async () => {
  const p = await proxy();
  expect((await post(p.baseUrl, path, { headers: { 'content-length': String(CLI_CALLBACK_MAX_BODY_BYTES + 1) } })).status).toBe(413);
  expect((await post(p.baseUrl, path, { chunks: ['x'.repeat(CLI_CALLBACK_MAX_BODY_BYTES), 'overflow'] })).status).toBe(413);
  expect(p.forward).not.toHaveBeenCalled();
});
it.each([
  { status: 101, body: Buffer.alloc(0) }, { status: 600, body: Buffer.alloc(0) },
  { status: 200, body: Buffer.alloc(CLI_CALLBACK_MAX_RESPONSE_BYTES + 1) },
  { status: 200, body: Buffer.alloc(0), contentType: 'text/plain\r\nInjected: true' }
])('rejects an invalid upstream response', async result => {
  const p = await proxy(vi.fn(async () => result)); expect((await post(p.baseUrl)).status).toBe(502);
});
it('preserves valid empty responses and contains upstream errors', async () => {
  const forward = vi.fn(async (): Promise<CliCallbackResponse> => ({ status: 204, body: Buffer.alloc(0) }));
  const p = await proxy(forward); expect((await post(p.baseUrl)).status).toBe(204);
  forward.mockRejectedValueOnce(new Error('private error')); expect(await post(p.baseUrl)).toEqual({ status: 502, body: '' });
});
it('aborts a timed out callback and releases global capacity', async () => {
  let signal: AbortSignal | undefined;
  const p = await proxy(vi.fn(request => { signal = request.signal; return new Promise<CliCallbackResponse>(() => {}); }), 15);
  expect((await post(p.baseUrl)).status).toBe(504); expect(signal?.aborted).toBe(true);
});
it('bounds callbacks across proxies and cancels active work on close', async () => {
  const held: Array<{ signal: AbortSignal; resolve: (response: CliCallbackResponse) => void }> = [];
  const forward = vi.fn((request: CliCallbackRequest) => new Promise<CliCallbackResponse>(resolve => held.push({ signal: request.signal, resolve })));
  const p = await proxy(forward), other = await proxy();
  const requests = Array.from({ length: 8 }, () => post(p.baseUrl).catch(() => null));
  await vi.waitFor(() => expect(held).toHaveLength(8));
  expect((await post(other.baseUrl)).status).toBe(429);
  await p.close(); await p.close(); await Promise.all(requests);
  expect(held.every(request => request.signal.aborted)).toBe(true);
  held.forEach(request => request.resolve({ status: 200, body: Buffer.alloc(0) }));
  expect((await post(other.baseUrl)).status).toBe(200);
});
it.each([{ ...grant, projectId: '../outside' }, { ...grant, sessionId: 'wrong' }, { ...grant, credential: 'secret' }])('rejects invalid grants before opening a listener', async invalid => {
  await expect(startCliCallbackProxy({ grant: invalid, forward: vi.fn() })).rejects.toThrow('Invalid CLI callback grant');
});
