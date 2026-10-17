import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import {
  createStoredLocalPeerAppResolver,
  ownedByCurrentUser,
  PEER_FORWARD_MAX_BYTES,
  PEER_FORWARD_MAX_CONCURRENCY,
  PeerForwarder,
  registerLocalPeerApp
} from './peer-forward.js';
import { startEnrolledHostConnection } from './server-connection.js';
import { dispatchHostCommand } from './command-dispatch.js';
import { WebSocketServer } from 'ws';

const route = '/api/v1/peer/plugin-a/handshake';
const command = {
  protocolVersion: 2 as const, pairId: 'pair-a', senderId: 'sender-a', recipientId: 'recipient-b',
  pluginId: 'plugin-a', scope: 'opaque-repo-1', route, httpMethod: 'POST' as const,
  payloadHash: createHash('sha256').update('{"message":"hello"}').digest('hex'),
  signature: 'a'.repeat(43), nonce: 'n'.repeat(16), issuedAt: Date.now(), epoch: 1,
  type: 'peer.forward' as const, method: 'handshake', body: '{"message":"hello"}', timeoutMs: 1000
};
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
});

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const port = (server.address() as { port: number }).port;
  return { server, port, origin: `http://127.0.0.1:${port}` };
}

function response(url: string, body: BodyInit | null = 'ok', init?: ResponseInit): Response {
  const result = new Response(body, init);
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

function forwarder(fetchFn?: typeof fetch, port: number | null = 18780) {
  const instance = new PeerForwarder({ resolveLocalPeerApp: () => port, fetchFn });
  cleanup.push(() => instance.close());
  return instance;
}

describe('peer forwarding boundary', () => {
  it('streams real >8192 byte request and response to independent local app without enrollment authority', async () => {
    const body = JSON.stringify({ data: '\u00e9'.repeat(20_000) });
    const packet = { ...command, body, payloadHash: createHash('sha256').update(body).digest('hex') };
    const { type: _type, method: _method, body: _body, timeoutMs: _timeout, ...envelope } = packet;
    const received: Buffer[] = [];
    const app = await listen((req, res) => {
      expect(req.url).toBe(route);
      expect(req.method).toBe('POST');
      expect(req.headers).toMatchObject({
        'content-type': 'application/json',
        'x-zcc-peer-envelope': Buffer.from(JSON.stringify(envelope)).toString('base64url')
      });
      expect(Object.keys(req.headers).filter(name => name.startsWith('x-zcc-peer-'))).toEqual(['x-zcc-peer-envelope']);
      expect(JSON.parse(Buffer.from(req.headers['x-zcc-peer-envelope'] as string, 'base64url').toString())).toEqual(envelope);
      expect(req.headers.authorization).toBeUndefined();
      expect(req.headers.cookie).toBeUndefined();
      expect(req.headers['x-zcc-machine-credential']).toBeUndefined();
      req.on('data', chunk => received.push(chunk));
      req.on('end', () => {
        res.writeHead(409, { 'content-type': 'application/json' });
        const bytes = Buffer.from(body);
        for (let offset = 0; offset < bytes.length; offset += 4097) res.write(bytes.subarray(offset, offset + 4097));
        res.end();
      });
    });
    await expect(forwarder(undefined, app.port).forward(packet)).resolves.toEqual({ status: 409, body });
    expect(Buffer.concat(received).toString()).toBe(body);
  });

  const invalidTokens = ['../secret', '.', '..', 'a/b', 'a\\b', '%2f', '%252f', 'a%5cb', 'a?b', 'a#b',
    'a\n', 'a\r', 'a\0', 'a b', '\u00e9', 'e\u0301', 'A', '-a', 'a_b', 'a'.repeat(65)];
  it.each(invalidTokens)('rejects route token %j before resolver/network', async token => {
    const resolve = vi.fn(() => 18780);
    const fetchFn = vi.fn();
    const peer = new PeerForwarder({ resolveLocalPeerApp: resolve, fetchFn });
    for (const field of ['pluginId', 'method']) {
      await expect(peer.forward({ ...command, [field]: token })).rejects.toMatchObject({ code: 'invalid_request' });
    }
    expect(resolve).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    { url: 'http://evil.example' }, { host: '127.0.0.1' }, { port: 1234 }, { headers: { authorization: 'secret' } },
    { type: 'host.read_file' }, { timeoutMs: 30001 }, { timeoutMs: 0 }, { epoch: 0 }, { pairId: 'x\r\nheader' },
    { signature: 'bad' }, { nonce: 'short' }, { senderId: 'x\n' }, { body: '\ud800' },
    { protocolVersion: 1 }, { recipientId: command.senderId }, { recipientId: 'x\n' },
    { scope: '' }, { scope: 'x\n' }, { scope: '\u00e9'.repeat(513) }, { httpMethod: 'GET' },
    { payloadHash: 'A'.repeat(64) }, { issuedAt: -1 }, { issuedAt: 1.5 },
    { route: '/api/v1/peer/plugin-b/handshake' }, { route: '/api/v1/peer/plugin-a/apply' },
    { route: route + '?x=1' }, { pluginId: 'plugin-b' }, { method: 'apply' }, { envelope: command }
  ])('validates strict v2 schema and well-formed body %j', async patch => {
    const resolve = vi.fn(() => 18780);
    const fetchFn = vi.fn();
    const peer = new PeerForwarder({ resolveLocalPeerApp: resolve, fetchFn });
    cleanup.push(() => peer.close());
    await expect(peer.forward({ ...command, ...patch })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(resolve).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('forwards a valid changed method only with its matching canonical route', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => response(String(url)));
    await expect(forwarder(fetchFn).forward({ ...command, method: 'apply', route: '/api/v1/peer/plugin-a/apply' }))
      .resolves.toEqual({ status: 200, body: 'ok' });
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:18780/api/v1/peer/plugin-a/apply', expect.any(Object));
  });

  it('caps request UTF-8 bytes, not UTF-16 characters, and accepts exact byte boundary', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => response(String(url)));
    const peer = forwarder(fetchFn);
    await expect(peer.forward({ ...command, body: '\u00e9'.repeat(PEER_FORWARD_MAX_BYTES / 2 + 1) }))
      .rejects.toMatchObject({ code: 'request_too_large' });
    expect(fetchFn).not.toHaveBeenCalled();
    const body = '\u00e9'.repeat(PEER_FORWARD_MAX_BYTES / 2);
    await expect(peer.forward({ ...command, body, payloadHash: createHash('sha256').update(body).digest('hex') }))
      .resolves.toEqual({ status: 200, body: 'ok' });
    await expect(peer.forward({ ...command, body: 'x'.repeat(PEER_FORWARD_MAX_BYTES + 1) }))
      .rejects.toMatchObject({ code: 'invalid_request' });
  });

  it.each([null, 0, 1023, 65536, 1.5, NaN, '8780', { port: 8780 }, 'http://127.0.0.1:8780'])('rejects absent/invalid trusted port %j', async port => {
    const fetchFn = vi.fn();
    await expect(forwarder(fetchFn, port as number).forward(command)).rejects.toMatchObject({ code: 'peer_app_unavailable' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails closed with no resolver; never guesses 8780 or enrollment URL', async () => {
    await expect(new PeerForwarder().forward(command)).rejects.toMatchObject({ code: 'peer_app_unavailable' });
  });

  it.each([301, 302, 303, 307, 308])('blocks real same-origin HTTP redirect %s before second request', async status => {
    const paths: string[] = [];
    const app = await listen((req, res) => {
      paths.push(req.url!);
      res.writeHead(status, { location: '/secret' }).end();
    });
    await expect(forwarder(undefined, app.port).forward(command)).rejects.toMatchObject({ code: 'peer_forward_failed' });
    expect(paths).toEqual([route]);
  });

  it('blocks external redirect without reaching target', async () => {
    const target = vi.fn((_req: IncomingMessage, res: ServerResponse) => res.end('secret'));
    const external = await listen(target);
    const app = await listen((_req, res) => res.writeHead(302, { location: external.origin + '/secret' }).end());
    await expect(forwarder(undefined, app.port).forward(command)).rejects.toMatchObject({ code: 'peer_forward_failed' });
    expect(target).not.toHaveBeenCalled();
  });

  it.each([
    '', 'http://evil.example/api/v1/peer/plugin-a/handshake', 'http://127.0.0.1:18781/api/v1/peer/plugin-a/handshake',
    'http://localhost:18780/api/v1/peer/plugin-a/handshake', 'http://127.0.0.1:18780/secret',
    'http://127.0.0.1:18780/api/v1/peer/plugin-a/handshake?x=1', 'http://127.0.0.1:18780/api/v1/peer/plugin-a/handshake#x',
    'http://127.0.0.1:18780/api/v1/peer/plugin-a/%68andshake'
  ])('rejects final target mismatch %j and cancels unread body', async url => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetchFn = vi.fn(async () => response(url, body));
    await expect(forwarder(fetchFn).forward(command)).rejects.toMatchObject({ code: 'peer_target_mismatch' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([false, true])('rejects custom transport redirect response (redirected=%s)', async redirected => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const result = response(String(url), 'redirect', { status: redirected ? 200 : 302 });
      Object.defineProperty(result, 'redirected', { value: redirected });
      return result;
    });
    await expect(forwarder(fetchFn).forward(command)).rejects.toMatchObject({ code: 'peer_target_mismatch' });
  });

  it('accepts empty response body, rejects invalid status and invalid UTF-8', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => response(String(url), null, { status: 204 }));
    const peer = forwarder(fetchFn);
    await expect(peer.forward(command)).resolves.toEqual({ status: 204, body: '' });
    fetchFn.mockImplementation(async url => {
      const result = response(String(url));
      Object.defineProperty(result, 'status', { value: 0 });
      return result;
    });
    await expect(peer.forward(command)).rejects.toMatchObject({ code: 'peer_response_invalid' });
    fetchFn.mockImplementation(async url => response(String(url), new Uint8Array([0xff])));
    await expect(peer.forward(command)).rejects.toMatchObject({ code: 'peer_response_invalid' });
  });

  it('caps decoded chunked and gzip responses even without Content-Length', async () => {
    const oversized = Buffer.alloc(PEER_FORWARD_MAX_BYTES + 1, 'x');
    const compressed = gzipSync(oversized);
    expect(compressed.length).toBeLessThan(8192 * 2);
    for (const gzip of [false, true]) {
      const app = await listen((_req, res) => {
        res.writeHead(200, gzip ? { 'content-encoding': 'gzip' } : {});
        const bytes = gzip ? compressed : oversized;
        for (let offset = 0; offset < bytes.length; offset += 64 * 1024) res.write(bytes.subarray(offset, offset + 64 * 1024));
        res.end();
      });
      await expect(forwarder(undefined, app.port).forward(command)).rejects.toMatchObject({ code: 'response_too_large' });
    }
  });

  it('accepts exact response cap, split UTF-8, and cancels as soon as streaming cap exceeds', async () => {
    const app = await listen((_req, res) => res.end(Buffer.alloc(PEER_FORWARD_MAX_BYTES, 'x')));
    const result = await forwarder(undefined, app.port).forward(command);
    expect(result.body.length).toBe(PEER_FORWARD_MAX_BYTES);
    const cancel = vi.fn();
    let count = 0;
    const fetchFn = vi.fn(async (url: string | URL | Request) => response(String(url), new ReadableStream({
      pull(controller) {
        count++;
        controller.enqueue(new Uint8Array(PEER_FORWARD_MAX_BYTES + 1));
      }, cancel
    })));
    await expect(forwarder(fetchFn).forward(command)).rejects.toMatchObject({ code: 'response_too_large' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(count).toBeLessThanOrEqual(2);
    const split = vi.fn(async (url: string | URL | Request) => response(String(url), new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([0xc3]));
      controller.enqueue(new Uint8Array([0xa9]));
      controller.close();
    } })));
    await expect(forwarder(split).forward(command)).resolves.toEqual({ status: 200, body: '\u00e9' });
  });

  it('redacts resolver, fetch and body errors, frees capacity on every failure', async () => {
    const failingResolver = new PeerForwarder({ resolveLocalPeerApp: () => { throw new Error('secret registration'); } });
    await expect(failingResolver.forward(command)).rejects.toMatchObject({ code: 'peer_forward_failed', message: 'peer forwarding failed' });
    const fetchFn = vi.fn(async () => { throw new Error('secret packet'); });
    const peer = forwarder(fetchFn);
    await expect(peer.forward(command)).rejects.toMatchObject({ code: 'peer_forward_failed', message: 'peer forwarding failed' });
    fetchFn.mockImplementation(async (url?: unknown) => response(String(url), new ReadableStream({ start(controller) {
      controller.error(new Error('secret body'));
    } })));
    await expect(peer.forward(command)).rejects.toMatchObject({ code: 'peer_forward_failed', message: 'peer forwarding failed' });
    fetchFn.mockImplementation(async (url?: unknown) => response(String(url)));
    await expect(peer.forward(command)).resolves.toEqual({ status: 200, body: 'ok' });
  });

  it('bounds abort listeners across thousands of tiny chunks and enforces delayed decode deadline', async () => {
    let chunk = 0;
    let add!: ReturnType<typeof vi.spyOn>;
    let remove!: ReturnType<typeof vi.spyOn>;
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      add = vi.spyOn(init!.signal!, 'addEventListener');
      remove = vi.spyOn(init!.signal!, 'removeEventListener');
      return response(String(url), new ReadableStream({ pull(controller) {
        if (chunk++ < 20_000) controller.enqueue(new Uint8Array([120]));
        else controller.close();
      } }));
    });
    await expect(forwarder(fetchFn).forward({ ...command, timeoutMs: 5000 })).resolves.toEqual({ status: 200, body: 'x'.repeat(20_000) });
    // cancelReader was registered before the fetch spy; it is also removed at completion.
    expect(remove.mock.calls.length).toBe(add.mock.calls.length + 1);
    const now = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0)
      .mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(2000);
    try {
      await expect(forwarder(vi.fn(async (url: string | URL | Request) => response(String(url)))).forward(command))
        .rejects.toMatchObject({ code: 'peer_forward_timeout' });
    } finally { now.mockRestore(); }
  });

  it('times out real stalled response body after headers and closes stream', async () => {
    let disconnected = false;
    const app = await listen((_req, res) => {
      res.writeHead(200).flushHeaders();
      res.write('partial');
      res.on('close', () => { disconnected = true; });
    });
    await expect(forwarder(undefined, app.port).forward({ ...command, timeoutMs: 100 }))
      .rejects.toMatchObject({ code: 'peer_forward_timeout' });
    await vi.waitFor(() => expect(disconnected).toBe(true));
  });

  it.each(['resolver', 'headers', 'body'])('deadline covers %s even with non-cooperating injected implementation', async phase => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    let resolveFetch!: (value: Response) => void;
    const peer = new PeerForwarder({
      resolveLocalPeerApp: phase === 'resolver' ? () => new Promise(() => {}) : () => 18780,
      fetchFn: phase === 'headers'
        ? vi.fn(() => new Promise<Response>(resolve => { resolveFetch = resolve; }))
        : vi.fn(async (url: string | URL | Request) => response(String(url), new ReadableStream({ cancel })))
    });
    cleanup.push(() => peer.close());
    const result = expect(peer.forward({ ...command, timeoutMs: 20 })).rejects.toMatchObject({ code: 'peer_forward_timeout' });
    await vi.advanceTimersByTimeAsync(20);
    await result;
    if (phase === 'headers') {
      resolveFetch(response('http://127.0.0.1:18780' + route, new ReadableStream({ cancel })));
      await Promise.resolve();
    }
    if (phase !== 'resolver') expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resolver', 'headers', 'body'])('fences overdue %s when timer callback is starved', async phase => {
    const calls = phase === 'resolver' ? [0, 2000] : phase === 'headers' ? [0, 0, 2000] : [0, 0, 0, 2000];
    const now = vi.spyOn(performance, 'now').mockReturnValue(2000);
    for (const value of calls) now.mockReturnValueOnce(value);
    const cancel = vi.fn();
    const fetchFn = vi.fn(async (url: string | URL | Request) => response(String(url), new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([120]));
    }, cancel })));
    try {
      await expect(forwarder(fetchFn).forward(command)).rejects.toMatchObject({ code: 'peer_forward_timeout' });
      if (phase === 'resolver') expect(fetchFn).not.toHaveBeenCalled();
      else expect(cancel).toHaveBeenCalledOnce();
    } finally { now.mockRestore(); }
  });

  it('enforces host-wide concurrency with no queue and releases slots on cancellation/shutdown', async () => {
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      signals.push(init!.signal!);
      return response(String(url), new ReadableStream());
    });
    const one = forwarder(fetchFn);
    const two = forwarder(fetchFn);
    const abort = new AbortController();
    const pending = Array.from({ length: PEER_FORWARD_MAX_CONCURRENCY }, (_, i) => {
      const peer = i % 2 ? two : one;
      return expect(peer.forward({ ...command, pairId: `pair-${i}` }, i === 0 ? { signal: abort.signal } : {}))
        .rejects.toMatchObject({ code: 'peer_forward_cancelled' });
    });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(PEER_FORWARD_MAX_CONCURRENCY));
    await expect(forwarder(fetchFn).forward(command)).rejects.toMatchObject({ code: 'peer_forward_busy' });
    one.cancelPair('not-active');
    abort.abort();
    await pending[0];
    expect(signals[0].aborted).toBe(true);
    two.cancelPair('pair-1');
    await pending[1];
    one.close();
    two.cancelAll();
    await Promise.all(pending);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    await expect(one.forward(command)).rejects.toMatchObject({ code: 'peer_forward_closed' });
    const live = forwarder(vi.fn(async (url: string | URL | Request) => response(String(url))));
    await expect(live.forward(command)).resolves.toEqual({ status: 200, body: 'ok' });
    const alreadyAborted = AbortSignal.abort();
    await expect(live.forward(command, { signal: alreadyAborted })).rejects.toMatchObject({ code: 'peer_forward_cancelled' });
  });
});

async function storage() {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-peer-app-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return { dir, marker: join(dir, 'peer-app', 'endpoint.json'), resolve: createStoredLocalPeerAppResolver(dir) };
}
const signal = () => new AbortController().signal;

describe('ownership check', () => {
  it('treats a platform without process.getuid as not mismatched, and otherwise compares uids', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'getuid');
    try {
      Object.defineProperty(process, 'getuid', { value: undefined, configurable: true });
      expect(ownedByCurrentUser(12345)).toBe(true);
      Object.defineProperty(process, 'getuid', { value: () => 1000, configurable: true });
      expect(ownedByCurrentUser(1000)).toBe(true);
      expect(ownedByCurrentUser(0)).toBe(false);
    } finally {
      if (original) Object.defineProperty(process, 'getuid', original); else delete (process as { getuid?: unknown }).getuid;
    }
  });
});

describe('host-owned local app registration', () => {
  it('persists private bounded registration, resolves after restart, fences older disposal', async () => {
    const { dir, marker, resolve } = await storage();
    expect(await resolve(signal())).toBeNull();
    const first = await registerLocalPeerApp(dir, { port: 18780, instanceId: randomUUID() });
    expect((await lstat(join(dir, 'peer-app'))).mode & 0o777).toBe(0o700);
    expect((await lstat(marker)).mode & 0o777).toBe(0o600);
    expect(await resolve(signal())).toBe(18780);
    expect(await createStoredLocalPeerAppResolver(dir)(signal())).toBe(18780);
    const second = await registerLocalPeerApp(dir, { port: 18781, instanceId: randomUUID() });
    await first();
    expect(await resolve(signal())).toBe(18781);
    await second();
    await second();
    expect(await resolve(signal())).toBeNull();
  });

  it('serializes concurrent registrations and never deletes successor', async () => {
    const { dir, resolve } = await storage();
    const [one, two] = await Promise.all([
      registerLocalPeerApp(dir, { port: 18780, instanceId: randomUUID() }),
      registerLocalPeerApp(dir, { port: 18781, instanceId: randomUUID() })
    ]);
    const winningPort = await resolve(signal());
    expect([18780, 18781]).toContain(winningPort);
    await (winningPort === 18781 ? one : two)();
    expect(await resolve(signal())).toBe(winningPort);
    await (winningPort === 18781 ? two : one)();
    expect(await resolve(signal())).toBeNull();
  });

  it.each(['corrupt', 'oversized', 'unknown', 'dead', 'bad-port', 'bad-utf8'])('fails closed for %s registration', async kind => {
    const { dir, marker, resolve } = await storage();
    await registerLocalPeerApp(dir, { port: 18780, instanceId: randomUUID() });
    const current = JSON.parse(await readFile(marker, 'utf8'));
    const contents = kind === 'corrupt' ? '{' : kind === 'oversized' ? ' '.repeat(1025)
      : kind === 'bad-utf8' ? Buffer.from([0xff])
        : JSON.stringify({ ...current, ...(kind === 'unknown' ? { url: 'https://evil.example' }
          : kind === 'dead' ? { pid: 2147483647 } : { port: 80 }) });
    await writeFile(marker, contents);
    expect(await resolve(signal())).toBeNull();
  });

  it('rejects unsafe permissions, symlinks, hardlinks, directories, and writable base', async () => {
    const { dir, marker, resolve } = await storage();
    await registerLocalPeerApp(dir, { port: 18780, instanceId: randomUUID() });
    await chmod(marker, 0o644);
    expect(await resolve(signal())).toBeNull();
    await chmod(marker, 0o600);
    await chmod(join(dir, 'peer-app'), 0o755);
    expect(await resolve(signal())).toBeNull();
    await expect(registerLocalPeerApp(dir, { port: 18780, instanceId: randomUUID() })).rejects.toThrow('untrusted');
    await chmod(join(dir, 'peer-app'), 0o700);
    const bytes = await readFile(marker);
    const external = join(dir, 'outside.json');
    await writeFile(external, bytes, { mode: 0o600 });
    await rm(marker);
    await symlink(external, marker);
    expect(await resolve(signal())).toBeNull();
    await rm(marker);
    const { link } = await import('node:fs/promises');
    await link(external, marker);
    expect(await resolve(signal())).toBeNull();
    await rm(marker);
    await mkdir(marker);
    expect(await resolve(signal())).toBeNull();
    await rm(join(dir, 'peer-app'), { recursive: true });
    const outside = join(dir, 'other');
    await mkdir(outside, { mode: 0o700 });
    await symlink(outside, join(dir, 'peer-app'));
    expect(await resolve(signal())).toBeNull();
    await expect(registerLocalPeerApp(dir, { port: 18780, instanceId: randomUUID() })).rejects.toThrow('untrusted');
    await chmod(dir, 0o777);
    expect(await resolve(signal())).toBeNull();
    await expect(registerLocalPeerApp(dir, { port: 18780, instanceId: randomUUID() })).rejects.toThrow('untrusted');
  });

  it('rejects invalid writes and supports resolver cancellation', async () => {
    const { dir, resolve } = await storage();
    await expect(registerLocalPeerApp(dir, { port: 0, instanceId: randomUUID() })).rejects.toThrow();
    await expect(registerLocalPeerApp(dir, { port: 18780, instanceId: 'bad' })).rejects.toThrow();
    await expect(registerLocalPeerApp(join(dir, 'missing'), { port: 18780, instanceId: randomUUID() })).rejects.toThrow();
    await expect(resolve(AbortSignal.abort())).rejects.toThrow();
    expect(await resolve(signal())).toBeNull();
  });
});

describe('enrollment runtime peer wiring', () => {
  it('routes A RPC to independent B registration, cancels on disconnect and closes on shutdown', async () => {
    const { dir } = await storage();
    let bRequests = 0;
    const b = await listen((_req, res) => {
      bRequests++;
      if (bRequests === 1) res.end('b'.repeat(16384));
      else res.writeHead(200).flushHeaders();
    });
    await registerLocalPeerApp(dir, { port: b.port, instanceId: randomUUID() });
    const aHttp = vi.fn((_req: IncomingMessage, res: ServerResponse) => res.end('wrong app A'));
    const a = await listen(aHttp);
    const wss = new WebSocketServer({ server: a.server });
    cleanup.push(() => { for (const ws of wss.clients) ws.terminate(); wss.close(); });
    let remote!: import('ws').WebSocket;
    const hostId = randomUUID();
    const messages: Array<{ requestId?: string; ok?: boolean; result?: unknown }> = [];
    wss.on('connection', ws => {
      remote = ws;
      ws.on('message', data => {
        const message = JSON.parse(String(data));
        messages.push(message);
        if (message.type === 'host.hello') ws.send(JSON.stringify({
          type: 'host.hello-ok', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, pluginHostGenerations: []
        }));
        if (message.type === 'host.ready') ws.send(JSON.stringify({
          type: 'host.ready-ok', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, instanceId: message.instanceId
        }));
      });
    });
    // No runtime injection: exercise production resolver wiring and unwrapped local fetch.
    const connection = startEnrolledHostConnection({
      serverUrl: a.origin + '/t/remote-a', hostId, hostKey: 'enrollment-secret',
      dataDir: dir, localPeerAppDataDir: dir, connectCredential: 'c'.repeat(43)
    });
    cleanup.push(() => connection.close());
    await connection.ready;
    remote.send(JSON.stringify({ type: 'host-rpc.request', protocolVersion: HOST_RPC_PROTOCOL_VERSION, requestId: 'peer', command }));
    await vi.waitFor(() => expect(messages.find(message => message.requestId === 'peer'))
      .toMatchObject({ ok: true, result: { status: 200, body: 'b'.repeat(16384) } }));
    expect(aHttp).not.toHaveBeenCalled();
    const pending = expect(dispatchHostCommand(connection.runtime, command)).rejects.toMatchObject({ code: 'peer_forward_cancelled' });
    await vi.waitFor(() => expect(bRequests).toBe(2));
    remote.terminate();
    await pending;
    const closing = expect(dispatchHostCommand(connection.runtime, command)).rejects.toMatchObject({ code: 'peer_forward_cancelled' });
    await vi.waitFor(() => expect(bRequests).toBe(3));
    await connection.close();
    await closing;
    await expect(dispatchHostCommand(connection.runtime, command)).rejects.toMatchObject({ code: 'peer_forward_closed' });

    const missing = startEnrolledHostConnection({ serverUrl: a.origin, hostId, hostKey: 'secret', dataDir: dir });
    cleanup.push(() => missing.close());
    await missing.ready;
    await expect(dispatchHostCommand(missing.runtime, command)).rejects.toMatchObject({ code: 'peer_app_unavailable' });
    expect(bRequests).toBe(3);
    await missing.close();
    const injected = startEnrolledHostConnection({
      serverUrl: a.origin, hostId, hostKey: 'secret', dataDir: dir,
      localPeerAppDataDir: join(dir, 'nonexistent'), resolveLocalPeerApp: () => b.port
    });
    cleanup.push(() => injected.close());
    await injected.ready;
    const injectedRequest = expect(dispatchHostCommand(injected.runtime, command)).rejects.toMatchObject({ code: 'peer_forward_cancelled' });
    await vi.waitFor(() => expect(bRequests).toBe(4));
    await injected.close();
    await injectedRequest;
  });
});
