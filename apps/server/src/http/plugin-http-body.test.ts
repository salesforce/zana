import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { readPluginHttpBody, PLUGIN_HTTP_BODY_MAX_BYTES } from './plugin-http-body';
function request(chunks: (Buffer | string)[], headers: Record<string, string> = {}) {
  return Object.assign(Readable.from(chunks), { headers }) as IncomingMessage;
}
describe('plugin file transport', () => {
  it('retains exact binary data larger than an Electron pipe buffer', async () => {
    const bytes = Buffer.from(Array.from({ length: 26 * 1024 }, (_, i) => i % 256));
    const result = await readPluginHttpBody(request([bytes.subarray(0, 8192), bytes.subarray(8192)]));
    expect(Buffer.from(result.rawBody)).toEqual(bytes); expect(result.body).toBeUndefined();
  });
  it('keeps JSON file bytes, while exposing the parsed body to ordinary routes', async () => {
    const text = '{ "hello": "world" }\n';
    expect(await readPluginHttpBody(request([text], { 'content-type': 'application/json' }))).toEqual({ body: { hello: 'world' }, rawBody: Buffer.from(text) });
    expect((await readPluginHttpBody(request([], { 'content-type': 'application/json' }))).body).toEqual({});
    expect((await readPluginHttpBody(request(['broken'], { 'content-type': 'application/json' }))).body).toBeUndefined();
  });
  it('rejects oversized announced and streamed bodies', async () => {
    await expect(readPluginHttpBody(request([], { 'content-length': String(PLUGIN_HTTP_BODY_MAX_BYTES + 1) }))).rejects.toThrow('25 MiB');
    await expect(readPluginHttpBody(request([Buffer.alloc(PLUGIN_HTTP_BODY_MAX_BYTES), 'x']))).rejects.toThrow('25 MiB');
  });
});
