#!/usr/bin/env node
/**
 * Pairing-only helper for tests. The install tarball is the esbuild bundle of
 * join-cli (see scripts/build-join.mjs), not this file. This module enrolls,
 * opens the host websocket, and serves local /status with Node builtins only.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { homedir, hostname } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROTOCOL_VERSION = 21;

function readFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

function parseArgv(argv, env = process.env) {
  const args = argv[0] === 'join' ? argv.slice(1) : argv;
  const serverUrl = (readFlag(args, '--server-url') ?? env.ZCC_SERVER_URL ?? '').replace(/\/$/, '');
  const portRaw = readFlag(args, '--host-daemon-port') ?? env.ZCC_HOST_DAEMON_PORT ?? '38888';
  const port = Number(portRaw);
  if (!serverUrl) throw new Error('join requires --server-url');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('join requires a valid --host-daemon-port');
  }
  return {
    joinCode: readFlag(args, '--join-code'),
    hostId: readFlag(args, '--host-id'),
    serverUrl,
    hostDaemonPort: port,
    dataDir: env.ZCC_DATA_DIR ?? ''
  };
}

function authPath(dataDir) {
  return join(dataDir, 'auth.json');
}

function readAuth(dataDir) {
  try {
    const parsed = JSON.parse(readFileSync(authPath(dataDir), 'utf8'));
    if (!parsed.hostId || !parsed.hostKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeAuth(dataDir, auth) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(authPath(dataDir), `${JSON.stringify(auth, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}

function startStatus(port, state) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/status' && url.pathname !== '/status/') {
      response.writeHead(404).end();
      return;
    }
    const body = JSON.stringify(state());
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    });
    response.end(body);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

async function enroll(options) {
  const instanceId = randomUUID();
  const existing = readAuth(options.dataDir);
  if (existing) {
    return { ...existing, instanceId };
  }
  if (!options.joinCode) {
    throw new Error('host enroll token is missing and auth.json is absent');
  }
  const response = await fetch(new URL('/internal/hosts/enroll', `${options.serverUrl}/`), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.joinCode}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      hostName: hostname() || 'zcc-host',
      instanceId,
      homeDir: homedir(),
      ...(options.hostId ? { hostId: options.hostId } : {})
    })
  });
  if (response.status !== 201) {
    const detail = await response.text();
    throw new Error(`Failed to enroll daemon host: ${response.status}${detail ? ` ${detail}` : ''}`);
  }
  const body = await response.json();
  const auth = {
    hostId: body.hostId,
    hostKey: body.hostKey,
    hostName: hostname() || 'zcc-host'
  };
  writeAuth(options.dataDir, auth);
  return { ...auth, instanceId };
}

function connectWs(options, auth, onOpen) {
  const wsUrl = new URL('/internal/hosts/ws', options.serverUrl.replace(/^http/, 'ws'));
  wsUrl.searchParams.set('hostId', auth.hostId);
  wsUrl.searchParams.set('hostKey', auth.hostKey);
  const backoff = [250, 500, 1_000, 2_000, 5_000];
  let attempt = 0;
  let closed = false;
  let socket = null;
  let heartbeat = null;
  let reconnectTimer = null;

  const connect = () => {
    if (closed) return;
    const next = new WebSocket(wsUrl);
    socket = next;
    next.addEventListener('open', () => {
      attempt = 0;
      next.send(JSON.stringify({
        type: 'host.hello',
        protocolVersion: PROTOCOL_VERSION,
        hostId: auth.hostId,
        instanceId: auth.instanceId
      }));
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (next.readyState === WebSocket.OPEN) {
          next.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, 15_000);
      onOpen();
    });
    next.addEventListener('close', () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (closed) return;
      const delay = backoff[Math.min(attempt, backoff.length - 1)];
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    });
    // Do not close() from `error`: Node's undici WebSocket re-dispatches error from close().
  };

  connect();
  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeat) clearInterval(heartbeat);
      socket?.close();
    }
  };
}

export async function runJoinStandalone(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgv(argv, env);
  if (!options.dataDir) {
    throw new Error('ZCC_DATA_DIR is required for an isolated machine install');
  }
  let connected = false;
  let hostId = options.hostId ?? null;
  const status = startStatus(options.hostDaemonPort, () => ({
    hostId,
    serverUrl: options.serverUrl,
    connected,
    protocolVersion: PROTOCOL_VERSION,
    autoUpdate: argv.includes('--auto-update') || env.ZCC_HOST_AUTO_UPDATE === '1'
  }));
  let auth;
  try {
    auth = await enroll(options);
  } catch (error) {
    status.close();
    throw error;
  }
  hostId = auth.hostId;
  const session = connectWs(options, auth, () => {
    connected = true;
  });
  process.stdout.write(`zcc-host-daemon joined hostId=${auth.hostId}\n`);
  return {
    hostId: auth.hostId,
    async close() {
      connected = false;
      session.close();
      await new Promise((resolve, reject) => {
        status.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

const launchedDirectly = (process.argv[1] ?? '').endsWith('join-standalone.mjs')
  || (process.argv[1] ?? '').endsWith('join.mjs');

if (launchedDirectly && process.argv.includes('join')) {
  const running = await runJoinStandalone();
  const shutdown = () => {
    void running.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
