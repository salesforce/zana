import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_NEXT_PORT = 4322;

export function nextOriginFromEnv(env = process.env) {
  const explicit = env.ZCC_NEXT_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/$/u, '');
  const port = Number(env.ZCC_NEXT_PORT ?? DEFAULT_NEXT_PORT);
  return `http://127.0.0.1:${Number.isFinite(port) ? port : DEFAULT_NEXT_PORT}`;
}

export function shouldSpawnNext(env = process.env) {
  if (env.ZCC_SKIP_NEXT === '1') return false;
  if (env.ZCC_NEXT_ORIGIN?.trim()) return false;
  return true;
}

export function spawnNextServer(options = {}) {
  const env = options.env ?? process.env;
  if (!options.force && !shouldSpawnNext(env)) return null;
  const cwd = options.cwd ?? process.cwd();
  const serverJs = options.serverJs ?? join(cwd, 'server.js');
  if (!existsSync(serverJs)) {
    throw new Error(`Next standalone server.js is missing at ${serverJs}`);
  }
  const origin = nextOriginFromEnv(env);
  const url = new URL(origin);
  const child = spawn(process.execPath, [serverJs], {
    cwd,
    env: {
      ...env,
      PORT: url.port || '4322',
      HOSTNAME: '127.0.0.1'
    },
    stdio: ['ignore', 'inherit', 'inherit']
  });
  return { child, origin };
}

export async function waitForHttp(origin, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'timeout';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, { method: 'GET', redirect: 'manual' });
      await response.arrayBuffer().catch(() => undefined);
      if (response.status > 0) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Next did not become ready at ${origin}: ${lastError}`);
}

/**
 * Reverse-proxy an HTTP request to the Next standalone listener.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {string} origin
 */
export function proxyToNext(request, response, origin) {
  const target = new URL(request.url ?? '/', `${origin}/`);
  const headers = { ...request.headers };
  delete headers.connection;
  const upstream = httpRequest(
    target,
    {
      method: request.method,
      headers
    },
    (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    }
  );
  upstream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    response.end('Bad gateway');
  });
  request.pipe(upstream);
}
