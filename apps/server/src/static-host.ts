import { createReadStream, existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { handleProductHttp } from './http/product-api.js';
import type { ProductHttpContext } from './http/product-context.js';
import { createProductWebSocketServer, handleProductUpgrade } from './http/product-ws.js';
import { createHostDaemonWebSocketServer, handleHostInternalHttp, handleHostInternalUpgrade } from './http/host-internal.js';

export interface BrowserProjectSummary {
  id: string;
  name: string;
  color?: string;
  tag?: string;
  category?: string;
}

/**
 * Deliberately small, browser-safe startup projection. It must never gain
 * filesystem paths, server/host credentials, or a capability to mutate state.
 */
export interface BrowserBootstrap {
  appVersion: string;
  projects: BrowserProjectSummary[];
}

export interface StaticHost {
  readonly url: string;
  close(): Promise<void>;
}

export interface StartStaticHostOptions {
  /** Absolute directory containing the trusted, already-built renderer assets. */
  rootDir: string;
  host?: string;
  port?: number;
  /** Enables the read-only same-origin browser bootstrap endpoint. */
  browserBootstrap?: () => BrowserBootstrap;
  /**
   * Optional plugin app-asset resolver. When a request matches
   * `/plugins/:id/assets/*`, the host asks this callback for the plugin root
   * and serves a contained file from that tree (never the host-daemon).
   */
  pluginAssetRoot?: (pluginId: string) => string | null;
  /**
   * Loopback product API + `/ws` (renderer) and `/internal/hosts` (daemon enroll).
   * Origin-guarded; host-daemon tokens never reach the renderer.
   */
  product?: ProductHttpContext;
}

function isContained(rootDir: string, candidate: string): boolean {
  return candidate === rootDir || candidate.startsWith(`${rootDir}${sep}`);
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

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
  // URL paths always use '/', even on Windows. Strip the leading separator so
  // resolve cannot reset to a filesystem root.
  const relativePath = decoded.replace(/^\/+/, '');
  const candidate = resolve(rootDir, relativePath || 'index.html');
  return isContained(rootDir, candidate) ? candidate : null;
}

/**
 * Serve the renderer artifact directory, plus the loopback product API when
 * `product` is provided. Bind is loopback-only for any browser-facing surface.
 */
export async function startStaticHost(options: StartStaticHostOptions): Promise<StaticHost> {
  if (options.browserBootstrap && options.host && options.host !== '127.0.0.1' && options.host !== '::1') {
    throw new Error('browser bootstrap is restricted to a loopback host');
  }
  const rootDir = await realpath(resolve(options.rootDir));
  const indexPath = resolve(rootDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`Renderer artifact is missing ${indexPath}`);
  }

  const hostName = options.host ?? '127.0.0.1';
  let expectedOrigin = '';
  const productWss = options.product ? createProductWebSocketServer(options.product) : null;
  const hostWss = options.product ? createHostDaemonWebSocketServer() : null;
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://zcc.local');
    if (options.product && await handleHostInternalHttp(request, response, options.product)) {
      return;
    }
    if (options.product && requestUrl.pathname.startsWith('/api/')) {
      await handleProductHttp(request, response, options.product);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    if (requestUrl.pathname === '/_zcc/health') {
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (requestUrl.pathname === '/_zcc/bootstrap') {
      // This endpoint is a browser projection, not an authentication boundary.
      // Keep it same-origin so another page cannot use a loopback response as a
      // local-data oracle, and expose only the explicitly redacted projection.
      if (!options.browserBootstrap) {
        response.writeHead(404).end();
        return;
      }
      if (request.headers.host !== expectedOrigin.replace(/^http:\/\//, '')) {
        response.writeHead(400).end();
        return;
      }
      if (request.headers.origin && request.headers.origin !== expectedOrigin) {
        response.writeHead(403).end();
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(JSON.stringify(options.browserBootstrap()));
      return;
    }

    const pluginMatch = requestUrl.pathname.match(/^\/plugins\/([a-z0-9][a-z0-9-]*)\/assets\/(.+)$/);
    if (pluginMatch && options.pluginAssetRoot) {
      const pluginRoot = options.pluginAssetRoot(pluginMatch[1]!);
      if (!pluginRoot) {
        response.writeHead(404).end();
        return;
      }
      const pluginFile = pathForRequest(pluginRoot, `/${pluginMatch[2]}`);
      if (!pluginFile) {
        response.writeHead(400).end();
        return;
      }
      try {
        const file = await realpath(pluginFile);
        const containedRoot = await realpath(pluginRoot);
        if (!isContained(containedRoot, file)) {
          response.writeHead(403).end();
          return;
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
          return;
        }
        createReadStream(file).on('error', () => response.destroy()).pipe(response);
      } catch {
        response.writeHead(404).end();
      }
      return;
    }

    const requestedFile = pathForRequest(rootDir, requestUrl.pathname);
    if (!requestedFile) {
      response.writeHead(400).end();
      return;
    }
    let file: string = requestedFile;

    try {
      // A renderer artifact tree is expected to contain no symlinks, but verify
      // that invariant at request time so a compromised build output cannot turn
      // the loopback server into a filesystem oracle.
      file = await realpath(file);
      if (!isContained(rootDir, file)) {
        response.writeHead(403).end();
        return;
      }
      const metadata = await stat(file);
      if (!metadata.isFile()) throw new Error('not a file');
    } catch {
      // The shell has no server-side routes yet. Falling back only for paths
      // without an extension preserves future browser routing without treating
      // missing assets as an application page.
      if (extname(requestUrl.pathname)) {
        response.writeHead(404).end();
        return;
      }
      file = indexPath;
    }

    const immutable = file.includes(`${sep}assets${sep}`);
    const spaPage = file === indexPath;
    response.writeHead(200, {
      'Cache-Control': spaPage ? 'no-store' : immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Type': contentType(file),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY'
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file).on('error', () => response.destroy()).pipe(response);
  });

  if (options.product && (productWss || hostWss)) {
    server.on('upgrade', (request, socket, head) => {
      if (hostWss && handleHostInternalUpgrade(request, socket, head, options.product!, hostWss)) {
        return;
      }
      if (productWss && handleProductUpgrade(request, socket, head, options.product!, productWss)) {
        return;
      }
      socket.destroy();
    });
  }

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port ?? 0, hostName, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Static host did not bind a TCP address');
  }
  const url = `http://${hostName}:${address.port}/`;
  expectedOrigin = url.slice(0, -1);
  if (options.product) {
    try {
      options.product.origins.serverPort = new URL(expectedOrigin).port
        ? Number(new URL(expectedOrigin).port)
        : options.product.origins.serverPort;
    } catch {
      /* keep the configured port */
    }
  }
  return {
    url,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      hostWss?.close();
      productWss?.close();
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    })
  };
}
