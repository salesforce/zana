import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { getHost } from '@zana-ai/zcc-db';
import { handleHostInternalHttp } from './host-internal.js';
import { PluginHostArtifactRegistry } from '../plugins/plugin-host-artifact-registry.js';
import type { ProductHttpContext } from './product-context.js';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(),
  getHost: vi.fn(),
  upsertHost: vi.fn()
}));

vi.mock('./host-hub.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./host-hub.js')>();
  return {
    ...actual,
    hostKeyMatches: () => true
  };
});

vi.mock('./public-app-url.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./public-app-url.js')>();
  return {
    ...actual,
    isAllowedHostInternalHost: () => true
  };
});

const DIGEST_A = 'ab'.repeat(32);
const DIGEST_B = 'cd'.repeat(32);

function getRequest(url: string): IncomingMessage {
  const stream = Readable.from([]);
  return Object.assign(stream, {
    method: 'GET',
    url,
    headers: {
      authorization: 'Bearer host-key-host-key-host-key-host',
      'x-zcc-host-id': 'host-1'
    }
  }) as IncomingMessage;
}

function captureResponse(): {
  response: ServerResponse;
  status: () => number;
  headers: () => Record<string, string>;
  body: () => Promise<Buffer>;
} {
  const stream = new PassThrough();
  let status = 0;
  let headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    chunks.push(Buffer.from(chunk));
  });
  const response = Object.assign(stream, {
    writeHead(code: number, nextHeaders?: Record<string, string>) {
      status = code;
      headers = nextHeaders ?? {};
      return response;
    },
    getHeader() {
      return undefined;
    }
  }) as unknown as ServerResponse;
  return {
    response,
    status: () => status,
    headers: () => headers,
    body: () => Buffer.concat(chunks)
  };
}

function ctxWithArtifact(artifact: {
  path: string;
  digest: string;
  byteLength: number;
}): ProductHttpContext {
  const pluginHostArtifacts = new PluginHostArtifactRegistry();
  pluginHostArtifacts.set('provider-acp', {
    ...artifact,
    generation: 'g1'
  });
  vi.mocked(getHost).mockReturnValue({ id: 'host-1', hostKeyHash: 'hash' } as never);
  return {
    pluginHostArtifacts,
    config: { getConfig: () => ({}) },
    db: {},
    joinCodes: { peek: () => null }
  } as unknown as ProductHttpContext;
}

describe('host internal plugin host artifact route', () => {
  it('streams the host.js bytes for a matching digest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-route-'));
    const bytes = Buffer.from('export default "acp";\n');
    const path = join(dir, 'host.js');
    await writeFile(path, bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const captured = captureResponse();
    const handled = await handleHostInternalHttp(
      getRequest(`/internal/plugins/provider-acp/host/${digest}`),
      captured.response,
      ctxWithArtifact({ path, digest, byteLength: bytes.byteLength })
    );
    expect(handled).toBe(true);
    const body = captured.body();
    expect(captured.status()).toBe(200);
    expect(captured.headers()['content-length']).toBe(String(bytes.byteLength));
    expect(captured.headers()['etag']).toBe(`"${digest}"`);
    expect(body.equals(bytes)).toBe(true);
  });

  it('answers HEAD without a body', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-head-route-'));
    const bytes = Buffer.from('export default "acp";\n');
    const path = join(dir, 'host.js');
    await writeFile(path, bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const stream = Readable.from([]);
    const request = Object.assign(stream, {
      method: 'HEAD',
      url: `/internal/plugins/provider-acp/host/${digest}`,
      headers: {
        authorization: 'Bearer host-key-host-key-host-key-host',
        'x-zcc-host-id': 'host-1'
      }
    }) as IncomingMessage;
    const captured = captureResponse();
    const handled = await handleHostInternalHttp(
      request,
      captured.response,
      ctxWithArtifact({ path, digest, byteLength: bytes.byteLength })
    );
    expect(handled).toBe(true);
    expect(captured.status()).toBe(200);
    expect(captured.body().length).toBe(0);
  });

  it('returns 401 without host credentials', async () => {
    const stream = Readable.from([]);
    const request = Object.assign(stream, {
      method: 'GET',
      url: `/internal/plugins/provider-acp/host/${DIGEST_A}`,
      headers: {}
    }) as IncomingMessage;
    const captured = captureResponse();
    await handleHostInternalHttp(
      request,
      captured.response,
      ctxWithArtifact({ path: '/tmp/missing.js', digest: DIGEST_A, byteLength: 1 })
    );
    expect(captured.status()).toBe(401);
  });

  it('returns indistinguishable 404 for a malformed digest', async () => {
    const captured = captureResponse();
    await handleHostInternalHttp(
      getRequest('/internal/plugins/provider-acp/host/not-a-digest'),
      captured.response,
      ctxWithArtifact({ path: '/tmp/host.js', digest: DIGEST_A, byteLength: 1 })
    );
    expect(captured.status()).toBe(404);
  });

  it('returns indistinguishable 404 for a stale digest', async () => {
    const captured = captureResponse();
    await handleHostInternalHttp(
      getRequest(`/internal/plugins/provider-acp/host/${DIGEST_B}`),
      captured.response,
      ctxWithArtifact({ path: '/tmp/host.js', digest: DIGEST_A, byteLength: 1 })
    );
    expect(captured.status()).toBe(404);
  });

  it('returns indistinguishable 404 when the file is missing', async () => {
    const captured = captureResponse();
    await handleHostInternalHttp(
      getRequest(`/internal/plugins/provider-acp/host/${DIGEST_A}`),
      captured.response,
      ctxWithArtifact({ path: '/tmp/zcc-missing-host.js', digest: DIGEST_A, byteLength: 12 })
    );
    expect(captured.status()).toBe(404);
  });

  it('returns 405 for POST', async () => {
    const stream = Readable.from([]);
    const request = Object.assign(stream, {
      method: 'POST',
      url: `/internal/plugins/provider-acp/host/${DIGEST_A}`,
      headers: {
        authorization: 'Bearer host-key-host-key-host-key-host',
        'x-zcc-host-id': 'host-1'
      }
    }) as IncomingMessage;
    const captured = captureResponse();
    await handleHostInternalHttp(
      request,
      captured.response,
      ctxWithArtifact({ path: '/tmp/host.js', digest: DIGEST_A, byteLength: 1 })
    );
    expect(captured.status()).toBe(405);
  });

  it('does not claim an unrelated plugins path', async () => {
    const captured = captureResponse();
    const handled = await handleHostInternalHttp(
      getRequest('/internal/plugins/provider-acp/other'),
      captured.response,
      ctxWithArtifact({ path: '/tmp/host.js', digest: DIGEST_A, byteLength: 1 })
    );
    expect(handled).toBe(false);
  });
});
