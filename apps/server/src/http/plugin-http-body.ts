import type { IncomingMessage } from 'node:http';
export const PLUGIN_HTTP_BODY_MAX_BYTES = 25 * 1024 * 1024;
export class PluginHttpBodyTooLarge extends Error {
  constructor() { super('plugin upload exceeds 25 MiB'); }
}
/** Preserve file bytes regardless of MIME; ordinary JSON handlers also receive parsed body. */
export async function readPluginHttpBody(request: IncomingMessage): Promise<{ body: unknown; rawBody: Uint8Array }> {
  if (Number(request.headers['content-length']) > PLUGIN_HTTP_BODY_MAX_BYTES) throw new PluginHttpBodyTooLarge();
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > PLUGIN_HTTP_BODY_MAX_BYTES) throw new PluginHttpBodyTooLarge();
    chunks.push(bytes);
  }
  const rawBody = Buffer.concat(chunks);
  let body: unknown = undefined;
  if ((request.headers['content-type'] ?? '').includes('application/json')) {
    try { body = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {}; } catch { /* Raw upload may declare JSON without containing valid JSON. */ }
  }
  return { body, rawBody };
}
