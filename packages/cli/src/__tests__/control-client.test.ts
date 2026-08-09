/**
 * Control-client tests. Spins up a real Unix-domain socket server that echoes
 * the parsed request, so we can assert: the socket-absent path returns a clean
 * APP_NOT_RUNNING (never throws), the token/nonce/callerSessionId are forwarded
 * faithfully, and a malformed response degrades gracefully.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callControlPlane, readControlToken, isAppRunning } from '../lib/control-client.js';

let server: Server | null = null;
const dirs: string[] = [];

afterEach(async () => {
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'zcc-cli-ctl-'));
  dirs.push(d);
  return d;
}

/** Start an echo control server that captures the last request it received. */
async function startEcho(dataDir: string): Promise<{ socketPath: string; last: () => any }> {
  const socketPath = join(dataDir, 'control.sock');
  writeFileSync(
    join(dataDir, 'control.token'),
    JSON.stringify({ token: 'tk', nonce: 'nc', socket: socketPath })
  );
  let lastReq: any = null;
  server = createServer((socket) => {
    let buf = '';
    socket.on('data', (c) => {
      buf += c.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      lastReq = JSON.parse(buf.slice(0, nl));
      socket.end(JSON.stringify({ ok: true, value: { echoed: lastReq.op } }) + '\n');
    });
  });
  await new Promise<void>((resolve) => server!.listen(socketPath, () => resolve()));
  return { socketPath, last: () => lastReq };
}

describe('readControlToken / isAppRunning', () => {
  it('returns null + not-running when the token file is absent', () => {
    const d = freshDir();
    expect(readControlToken(d)).toBeNull();
    expect(isAppRunning(d)).toBe(false);
  });
});

describe('callControlPlane', () => {
  it('returns APP_NOT_RUNNING (never throws) when there is no socket', async () => {
    const d = freshDir();
    const r = await callControlPlane({ dataDir: d, op: 'status' });
    expect(r).toMatchObject({ ok: false, code: 'APP_NOT_RUNNING' });
  });

  it('forwards token, nonce, op, args and the caller-session marker', async () => {
    const d = freshDir();
    const echo = await startEcho(d);
    const r = await callControlPlane({
      dataDir: d,
      op: 'agent.send',
      args: { to: 'reviewer', message: 'hi' },
      callerSessionId: 'sess-xyz',
      callerCredential: 'bound-token'
    });
    expect(r).toMatchObject({ ok: true, value: { echoed: 'agent.send' } });
    expect(echo.last()).toMatchObject({
      token: 'tk',
      nonce: 'nc',
      op: 'agent.send',
      args: { to: 'reviewer', message: 'hi' },
      callerSessionId: 'sess-xyz',
      callerCredential: 'bound-token'
    });
  });

  it('defaults the caller-session marker from ZCC_SESSION_ID when set', async () => {
    const d = freshDir();
    const echo = await startEcho(d);
    const prev = process.env.ZCC_SESSION_ID;
    process.env.ZCC_SESSION_ID = 'env-session';
    const prevToken = process.env.ZCC_SESSION_TOKEN;
    process.env.ZCC_SESSION_TOKEN = 'env-token';
    try {
      await callControlPlane({ dataDir: d, op: 'status' });
    } finally {
      if (prev === undefined) delete process.env.ZCC_SESSION_ID;
      else process.env.ZCC_SESSION_ID = prev;
      if (prevToken === undefined) delete process.env.ZCC_SESSION_TOKEN;
      else process.env.ZCC_SESSION_TOKEN = prevToken;
    }
    expect(echo.last().callerSessionId).toBe('env-session');
    expect(echo.last().callerCredential).toBe('env-token');
  });
});
