import { createReadStream, existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

export interface StaticHost {
  readonly url: string;
  close(): Promise<void>;
}

export interface StartStaticHostOptions {
  /** Absolute directory containing the trusted, already-built renderer assets. */
  rootDir: string;
  host?: string;
  port?: number;
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
 * Serve only the renderer artifact directory. This is intentionally static:
 * product RPC remains on the authenticated desktop bridge until the server API
 * migration is complete, so a browser origin never gains a mutation endpoint.
 */
export async function startStaticHost(options: StartStaticHostOptions): Promise<StaticHost> {
  const rootDir = await realpath(resolve(options.rootDir));
  const indexPath = resolve(rootDir, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`Renderer artifact is missing ${indexPath}`);
  }

  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    const requestUrl = new URL(request.url ?? '/', 'http://zcc.local');
    if (requestUrl.pathname === '/_zcc/health') {
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
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
    response.writeHead(200, {
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Type': contentType(file),
      'X-Content-Type-Options': 'nosniff'
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file).on('error', () => response.destroy()).pipe(response);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Static host did not bind a TCP address');
  }
  const url = `http://${options.host ?? '127.0.0.1'}:${address.port}/`;
  return {
    url,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    })
  };
}
