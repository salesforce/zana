import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

/**
 * Renderer plugin bundles are addressed as `/plugins/:id/assets/*` so the
 * same-origin static host and the Vite-dev product server can share one URL.
 * SPA routes under `/plugins/:id/:panel` must not match this pattern.
 */
export const PLUGIN_ASSET_PATH = /^\/plugins\/([a-z0-9][a-z0-9-]*)\/assets\/(.+)$/;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function isContained(rootDir: string, candidate: string): boolean {
  return candidate === rootDir || candidate.startsWith(`${rootDir}${sep}`);
}

function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function pathForRequest(rootDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relativePath = decoded.replace(/^\/+/, '');
  const candidate = resolve(rootDir, relativePath || 'index.html');
  return isContained(rootDir, candidate) ? candidate : null;
}

export function isPluginAssetPath(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://zcc.local').pathname;
  } catch {
    pathname = url.split('?')[0] ?? '';
  }
  return PLUGIN_ASSET_PATH.test(pathname);
}

/**
 * Serve a contained file from a plugin root when the request is a plugin-asset
 * GET/HEAD. Returns true when the request was handled (including 4xx).
 */
export async function tryServePluginAsset(
  request: IncomingMessage,
  response: ServerResponse,
  resolveRoot: (pluginId: string) => string | null
): Promise<boolean> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  let pathname: string;
  try {
    pathname = new URL(request.url ?? '/', 'http://zcc.local').pathname;
  } catch {
    return false;
  }
  const match = pathname.match(PLUGIN_ASSET_PATH);
  if (!match) return false;

  const pluginRoot = resolveRoot(match[1]!);
  if (!pluginRoot) {
    response.writeHead(404).end();
    return true;
  }
  const pluginFile = pathForRequest(pluginRoot, `/${match[2]}`);
  if (!pluginFile) {
    response.writeHead(400).end();
    return true;
  }
  try {
    const file = await realpath(pluginFile);
    const containedRoot = await realpath(pluginRoot);
    if (!isContained(containedRoot, file)) {
      response.writeHead(403).end();
      return true;
    }
    const metadata = await stat(file);
    if (!metadata.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': contentType(file),
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') {
      response.end();
      return true;
    }
    createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
  return true;
}
