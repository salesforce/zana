import { request as httpRequest } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { startCliCallbackProxy, type CliCallbackRequest, type CliCallbackResponse } from './cli-callback-proxy.js';

const grant = { projectId: 'project', sessionId: '11111111-1111-4111-8111-111111111111', credential: 'a'.repeat(64) };
const nativeToolPath = `/hook/nativetool/${grant.projectId}/${grant.sessionId}`;
const proxies: Awaited<ReturnType<typeof startCliCallbackProxy>>[] = [];
afterEach(async () => { await Promise.all(proxies.splice(0).map(proxy => proxy.close())); });

function post(baseUrl: string, suffix: string) {
  const url = new URL(baseUrl);
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest({ hostname: url.hostname, port: url.port, path: url.pathname + suffix, method: 'POST', setHost: false, headers: { host: url.host } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode!));
    });
    request.on('error', reject);
    request.end('{}');
  });
}

it('forwards the enrolled-CLI native tool hook callback instead of rejecting it with 403', async () => {
  const forward = vi.fn(async (_request: CliCallbackRequest): Promise<CliCallbackResponse> => ({ status: 200, body: Buffer.from('{}'), contentType: 'application/json' }));
  const proxy = await startCliCallbackProxy({ grant, forward }); proxies.push(proxy);
  expect(await post(proxy.baseUrl, nativeToolPath)).toBe(200);
  expect(forward).toHaveBeenCalledOnce();
  expect(forward.mock.calls[0]![0].path).toBe(nativeToolPath);
});

it('still rejects another session’s native tool hook path', async () => {
  const forward = vi.fn(async (_request: CliCallbackRequest): Promise<CliCallbackResponse> => ({ status: 200, body: Buffer.from('{}') }));
  const proxy = await startCliCallbackProxy({ grant, forward }); proxies.push(proxy);
  expect(await post(proxy.baseUrl, `/hook/nativetool/${grant.projectId}/22222222-2222-4222-8222-222222222222`)).toBe(403);
  expect(forward).not.toHaveBeenCalled();
});

it('keeps a reserved native tool pool: shared slots full still forwards, a 9th native tool call gets 429', async () => {
  const release: Array<() => void> = [];
  const gate = () => new Promise<CliCallbackResponse>(resolve => release.push(() => resolve({ status: 200, body: Buffer.from('{}') })));
  const forward = vi.fn((_request: CliCallbackRequest) => gate());
  const proxy = await startCliCallbackProxy({ grant, forward }); proxies.push(proxy);
  const mcpPath = `/mcp/${grant.projectId}/${grant.sessionId}/${grant.credential}`;
  const shared = Array.from({ length: 8 }, () => post(proxy.baseUrl, mcpPath));
  await vi.waitFor(() => expect(forward).toHaveBeenCalledTimes(8));
  expect(await post(proxy.baseUrl, mcpPath)).toBe(429);
  const native = Array.from({ length: 8 }, () => post(proxy.baseUrl, nativeToolPath));
  await vi.waitFor(() => expect(forward).toHaveBeenCalledTimes(16));
  expect(await post(proxy.baseUrl, nativeToolPath)).toBe(429);
  release.splice(0).forEach(fn => fn());
  await Promise.all([...shared, ...native]);
  release.splice(0).forEach(fn => fn());
});

it('budgets native tool calls per proxy, so one busy session cannot deny another', async () => {
  const release: Array<() => void> = [];
  const gate = () => new Promise<CliCallbackResponse>(resolve => release.push(() => resolve({ status: 200, body: Buffer.from('{}') })));
  const busy = await startCliCallbackProxy({ grant, forward: vi.fn(gate) }); proxies.push(busy);
  const otherGrant = { ...grant, sessionId: '22222222-2222-4222-8222-222222222222' };
  const other = await startCliCallbackProxy({ grant: otherGrant, forward: async () => ({ status: 200, body: Buffer.from('{}') }) }); proxies.push(other);
  const native = Array.from({ length: 8 }, () => post(busy.baseUrl, nativeToolPath));
  await vi.waitFor(() => expect(release).toHaveLength(8));
  expect(await post(busy.baseUrl, nativeToolPath)).toBe(429);
  expect(await post(other.baseUrl, `/hook/nativetool/${otherGrant.projectId}/${otherGrant.sessionId}`)).toBe(200);
  release.splice(0).forEach(fn => fn());
  await Promise.all(native);
});
