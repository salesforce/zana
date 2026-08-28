import { describe, expect, it, vi } from 'vitest';
import { HOST_ARTIFACT_MAX_BYTES } from '@zana-ai/zcc-host-daemon-contract';
import {
  createPluginHostArtifactHttpClient,
  readHostArtifactBytes
} from './plugin-host-artifact-client.js';

const DIGEST = 'ab'.repeat(32);

describe('plugin host artifact HTTP client', () => {
  it('rejects an oversized declared length before download', async () => {
    const fetchFn = vi.fn();
    const client = createPluginHostArtifactHttpClient({
      serverUrl: 'http://127.0.0.1:4100/',
      hostId: 'host-1',
      hostKey: 'key',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(
      client.fetch({
        pluginId: 'provider-acp',
        digest: DIGEST,
        expectedByteLength: HOST_ARTIFACT_MAX_BYTES + 1
      })
    ).rejects.toThrow(/exceeds the/u);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('requires Content-Length and returns the bytes', async () => {
    const bytes = new Uint8Array(Buffer.from('export default 1;\n'));
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`http://127.0.0.1:4100/internal/plugins/provider-acp/host/${DIGEST}`);
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer key',
        'x-zcc-host-id': 'host-1'
      });
      return new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) }
      });
    });
    const client = createPluginHostArtifactHttpClient({
      serverUrl: 'http://127.0.0.1:4100',
      hostId: 'host-1',
      hostKey: 'key',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(
      client.fetch({
        pluginId: 'provider-acp',
        digest: DIGEST,
        expectedByteLength: bytes.byteLength
      })
    ).resolves.toEqual(bytes);
  });

  it('fails when Content-Length is not an integer', async () => {
    const fetchFn = vi.fn(async () => new Response('export default 1;\n', {
      status: 200,
      headers: { 'content-length': 'nope' }
    }));
    const client = createPluginHostArtifactHttpClient({
      serverUrl: 'http://127.0.0.1:4100/',
      hostId: 'host-1',
      hostKey: 'key',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(
      client.fetch({
        pluginId: 'provider-acp',
        digest: DIGEST,
        expectedByteLength: 18
      })
    ).rejects.toThrow(/Content-Length/u);
  });

  it('fails when Content-Length is missing', async () => {
    const fetchFn = vi.fn(async () => new Response('export default 1;\n', { status: 200 }));
    const client = createPluginHostArtifactHttpClient({
      serverUrl: 'http://127.0.0.1:4100/',
      hostId: 'host-1',
      hostKey: 'key',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(
      client.fetch({
        pluginId: 'provider-acp',
        digest: DIGEST,
        expectedByteLength: 18
      })
    ).rejects.toThrow(/Content-Length/u);
  });

  it('cuts off a stream that exceeds the expected length', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      }
    });
    const response = new Response(body, {
      headers: { 'content-length': '4' }
    });
    await expect(readHostArtifactBytes(response, 4)).rejects.toThrow(/received more than 4/u);
  });

  it('fails a non-OK HTTP status', async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 404 }));
    const client = createPluginHostArtifactHttpClient({
      serverUrl: 'http://127.0.0.1:4100/',
      hostId: 'host-1',
      hostKey: 'key',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(
      client.fetch({ pluginId: 'provider-acp', digest: DIGEST, expectedByteLength: 4 })
    ).rejects.toThrow(/fetch failed: 404/u);
  });

  it('fails when Content-Length disagrees with the expected size', async () => {
    const fetchFn = vi.fn(async () => new Response('abcd', {
      status: 200,
      headers: { 'content-length': '8' }
    }));
    const client = createPluginHostArtifactHttpClient({
      serverUrl: 'http://127.0.0.1:4100/',
      hostId: 'host-1',
      hostKey: 'key',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(
      client.fetch({ pluginId: 'provider-acp', digest: DIGEST, expectedByteLength: 4 })
    ).rejects.toThrow(/length mismatch/u);
  });

  it('fails when the body is shorter than Content-Length', async () => {
    const response = new Response(new Uint8Array(2), {
      headers: { 'content-length': '4' }
    });
    await expect(readHostArtifactBytes(response, 4)).rejects.toThrow(/received 2/u);
  });

  it('rejects a Content-Length above the host artifact cap', async () => {
    const fetchFn = vi.fn(async () => new Response('abcd', {
      status: 200,
      headers: { 'content-length': String(HOST_ARTIFACT_MAX_BYTES + 1) }
    }));
    const client = createPluginHostArtifactHttpClient({
      serverUrl: 'http://127.0.0.1:4100/',
      hostId: 'host-1',
      hostKey: 'key',
      fetchFn: fetchFn as unknown as typeof fetch
    });
    await expect(
      client.fetch({ pluginId: 'provider-acp', digest: DIGEST, expectedByteLength: 4 })
    ).rejects.toThrow(/exceeds the/u);
  });

  it('rejects a stream once it exceeds the caller max', async () => {
    const response = new Response(new Uint8Array(8), {
      headers: { 'content-length': '8' }
    });
    await expect(readHostArtifactBytes(response, 8, 4)).rejects.toThrow(/exceeds the 4 byte limit/u);
  });

  it('rejects a response with no body', async () => {
    await expect(
      readHostArtifactBytes({ body: null, headers: new Headers() } as Response, 4)
    ).rejects.toThrow(/received 0/u);
  });
});
