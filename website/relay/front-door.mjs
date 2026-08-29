import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePairingPath } from './allowlist.mjs';
import { createPairingHub } from './pairing-hub.mjs';
import { bearerToken, relayTokenFromEnv, tokenMatches } from './token.mjs';
import {
  createWsConnection,
  writeHttpError,
  writeServerHandshake
} from './ws-raw.mjs';
import { nextOriginFromEnv, proxyToNext, shouldSpawnNext, spawnNextServer, waitForHttp } from './next-proxy.mjs';

function isWebSocketUpgrade(request) {
  return String(request.headers.upgrade ?? '').toLowerCase() === 'websocket';
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

/**
 * @param {{
 *   port?: number,
 *   host?: string,
 *   token?: string,
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   spawnNext?: boolean,
 *   nextOrigin?: string,
 *   now?: () => number,
 *   joinTtlMs?: number,
 *   maxSessions?: number
 * }} [options]
 */
export async function startFrontDoor(options = {}) {
  const env = options.env ?? process.env;
  const token = options.token ?? relayTokenFromEnv(env);
  const spawn = options.spawnNext ?? shouldSpawnNext(env);
  let nextOrigin = (options.nextOrigin ?? nextOriginFromEnv(env)).replace(/\/$/u, '');
  let spawned = null;
  // Bind $PORT before Next is ready — Heroku kills dynos that do not listen in time.
  let nextReady = !spawn;

  const hub = createPairingHub({
    env,
    now: options.now,
    joinTtlMs: options.joinTtlMs,
    maxSessions: options.maxSessions
  });
  const server = createServer((request, response) => {
    const pathname = normalizePairingPath(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    if (pathname === '/_zcc/relay') {
      sendJson(response, 400, { error: 'websocket_required' });
      return;
    }
    if (hub.handleHttp(request, response)) return;
    if (!nextReady) {
      sendJson(response, 503, { error: 'site_starting' });
      return;
    }
    proxyToNext(request, response, nextOrigin);
  });

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = normalizePairingPath(requestUrl.pathname);
    if (!isWebSocketUpgrade(request)) {
      writeHttpError(socket, 400, 'Bad Request');
      return;
    }
    if (pathname === '/_zcc/relay') {
      const expected = token;
      const received = bearerToken(String(request.headers.authorization ?? ''));
      if (!expected || !received || !tokenMatches(received, expected)) {
        writeHttpError(socket, 401, 'Unauthorized');
        return;
      }
      const reclaimId = String(request.headers['x-zcc-relay-session'] ?? '').trim() || undefined;
      const allowed = hub.canAttach(reclaimId);
      if (!allowed.ok) {
        writeHttpError(socket, allowed.status, allowed.reason);
        return;
      }
      const key = request.headers['sec-websocket-key'];
      if (typeof key !== 'string' || key.length === 0) {
        writeHttpError(socket, 400, 'Bad Request');
        return;
      }
      writeServerHandshake(socket, key);
      const leftover = Buffer.isBuffer(head) ? head : Buffer.alloc(0);
      hub.attach(createWsConnection(socket, { leftover }), reclaimId);
      return;
    }
    const routed = hub.handleUpgrade(request, socket, head);
    if (routed === false) {
      writeHttpError(socket, 404, 'Not Found');
      return;
    }
    if (routed && routed.handled && !routed.entry && routed.status) {
      writeHttpError(socket, routed.status, routed.reason ?? 'Service Unavailable');
    }
  });

  const port = options.port ?? Number(env.PORT ?? 4321);
  const host = options.host ?? '0.0.0.0';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('pairing front door did not bind a TCP address');
  }

  if (spawn) {
    spawned = spawnNextServer({ env, cwd: options.cwd, force: true });
    nextOrigin = spawned.origin;
    void waitForHttp(nextOrigin)
      .then(() => {
        nextReady = true;
      })
      .catch((error) => {
        process.stderr.write(`zcc next: ${error instanceof Error ? error.message : String(error)}\n`);
      });
  }

  return {
    port: address.port,
    url: `http://127.0.0.1:${address.port}/`,
    nextOrigin,
    hasLaptop() {
      return hub.hasLaptop();
    },
    sessionCount() {
      return hub.sessionCount();
    },
    close: async () => {
      hub.dispose();
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
      spawned?.child.kill('SIGTERM');
    }
  };
}

const isMain = Boolean(
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
);
if (isMain) {
  const door = await startFrontDoor();
  process.stdout.write(`zcc front door listening on ${door.url}\n`);
  const shutdown = () => {
    void door.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
