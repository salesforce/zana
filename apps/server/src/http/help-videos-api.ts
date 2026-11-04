import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { HelpVideoCatalogueService } from '../services/help-video-catalogue.js';
import { videoByteRange } from './video-preview.js';
import { sendJson } from './json.js';

/** Called after the product API origin guard, including for remote browser clients. */
export async function handleHelpVideosApi(
  request: IncomingMessage, response: ServerResponse,
  service: HelpVideoCatalogueService | undefined, path: string, method: string
): Promise<boolean> {
  if (!path.startsWith('/api/v1/help/videos')) return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') { sendJson(response, 403, { error: 'foreign-origin' }); return true; }
  if (method !== 'GET' && method !== 'HEAD') { sendJson(response, 405, { error: 'method-not-allowed' }); return true; }
  if (!service) { sendJson(response, 503, { error: 'videos-unavailable' }); return true; }
  if (path === '/api/v1/help/videos') {
    const videos = await service.list();
    if (method === 'HEAD') response.writeHead(200).end();
    else sendJson(response, 200, { videos });
    return true;
  }
  const match = /^\/api\/v1\/help\/videos\/assets\/([a-f0-9]{64}\.(?:mp4|jpg|vtt))$/.exec(path);
  if (!match) { sendJson(response, 404, { error: 'unknown-video-asset' }); return true; }
  try {
    const file = await service.asset(match[1]);
    if (!file) { sendJson(response, 404, { error: 'unknown-video-asset' }); return true; }
    const range = videoByteRange(request.headers.range, file.size);
    const headers = {
      'content-type': file.type, 'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin'
    };
    if (!range) {
      response.writeHead(416, { ...headers, 'content-range': `bytes */${file.size}`, 'content-length': '0' }).end();
    } else {
      response.writeHead(request.headers.range ? 206 : 200, {
        ...headers, 'content-length': String(range.end - range.start + 1),
        ...(request.headers.range ? { 'content-range': `bytes ${range.start}-${range.end}/${file.size}` } : {})
      });
      if (method === 'HEAD') response.end();
      else {
        const handle = await open(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try { await pipeline(handle.createReadStream({ ...range, autoClose: false }), response); }
        finally { await handle.close(); }
      }
    }
  } catch {
    if (response.headersSent) response.destroy();
    else sendJson(response, 503, { error: 'video-unavailable' });
  }
  return true;
}
