import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';

/**
 * Stream one content-addressed host.js to an enrolled daemon. Digest is the
 * capability; a stale registry entry that no longer matches the file is an
 * indistinguishable 404.
 */
export async function sendHostArtifactFile(
  response: ServerResponse,
  args: { path: string; byteLength: number; digest: string; headOnly?: boolean }
): Promise<boolean> {
  const stats = await stat(args.path).catch(() => null);
  if (stats === null || !stats.isFile() || stats.size !== args.byteLength) {
    return false;
  }
  const headers = {
    'cache-control': 'private, immutable, max-age=31536000',
    'content-length': String(args.byteLength),
    'content-type': 'text/javascript; charset=utf-8',
    etag: `"${args.digest}"`
  };
  if (args.headOnly) {
    response.writeHead(200, headers);
    response.end();
    return true;
  }
  response.writeHead(200, headers);
  await pipeline(createReadStream(args.path), response);
  return true;
}
