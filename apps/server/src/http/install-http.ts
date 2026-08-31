import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAllowedHostInternalHost, requestHostHeader, resolvePublicAppUrl } from './public-app-url.js';
import type { ProductHttpContext } from './product-context.js';
import { createHostArtifactReadStream, resolveHostArtifact } from '../services/hosts/host-artifact.js';

function installScriptPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../assets/install-machine.sh');
}

export function handleInstallHttp(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext
): boolean {
  const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathname = requestUrl.pathname.replace(/\/$/, '') || '/';
  if (
    pathname !== '/install.sh'
    && pathname !== '/install/version'
    && pathname !== '/install/zcc-host.tgz'
  ) {
    return false;
  }

  const publicUrl = resolvePublicAppUrl();
  if (!isAllowedHostInternalHost(requestHostHeader(request), publicUrl)) {
    response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'host is not allowed' }));
    return true;
  }

  const method = (request.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405).end();
    return true;
  }

  if (pathname === '/install.sh') {
    const script = readFileSync(installScriptPath());
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/x-shellscript; charset=utf-8',
      'content-length': String(script.length)
    });
    if (method === 'HEAD') {
      response.end();
      return true;
    }
    response.end(script);
    return true;
  }

  const artifact = resolveHostArtifact();
  if (pathname === '/install/version') {
    const body = JSON.stringify({
      version: artifact.version,
      protocolVersion: artifact.protocolVersion
    });
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body))
    });
    if (method === 'HEAD') {
      response.end();
      return true;
    }
    response.end(body);
    return true;
  }

  const size = statSync(artifact.tarballPath).size;
  response.writeHead(200, {
    'cache-control': 'public, max-age=300',
    'content-type': 'application/gzip',
    'content-length': String(size)
  });
  if (method === 'HEAD') {
    response.end();
    return true;
  }
  createHostArtifactReadStream(artifact.tarballPath).pipe(response);
  return true;
}
