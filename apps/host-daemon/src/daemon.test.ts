import { createHmac, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { startHostDaemon, type HostDaemon } from './daemon.js';
import { canonicalJson } from '@zana-ai/zcc-contracts/canonical-json';

let daemon: HostDaemon | null = null;

afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

function command() {
  return {
    kind: 'launch' as const,
    commandId: randomUUID(),
    projectId: randomUUID(),
    sessionId: randomUUID(),
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    launch: { argv: [process.execPath, '-e', 'process.stdout.write("ok")'], cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' } }
  };
}

describe('host daemon', () => {
  it('only executes authenticated, server-signed commands', async () => {
    const token = 't'.repeat(32);
    const signingKey = 's'.repeat(32);
    daemon = await startHostDaemon({ token, signingKey });
    const launch = command();
    const signature = createHmac('sha256', signingKey).update(canonicalJson(launch)).digest('hex');

    const denied = await fetch(`${daemon.url}/commands`, { method: 'POST', body: '{}' });
    expect(denied.status).toBe(401);

    const response = await fetch(`${daemon.url}/commands`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: launch, signature })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ kind: 'accepted', commandId: launch.commandId }),
        expect.objectContaining({ kind: 'output', data: 'ok' }),
        expect.objectContaining({ kind: 'exited', code: 0 })
      ])
    });
  });

  it('accepts terminal commands only when the server signature is valid', async () => {
    const token = 't'.repeat(32);
    const signingKey = 's'.repeat(32);
    const terminalManager = {
      handle: (input: unknown) => [{ kind: 'accepted', commandId: (input as { commandId: string }).commandId }]
    } as never;
    daemon = await startHostDaemon({ token, signingKey, terminalManager });
    const terminal = {
      kind: 'start', commandId: randomUUID(), sessionId: randomUUID(), projectId: randomUUID(), launchEpoch: 0,
      deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      launch: { argv: ['zsh'], cwd: process.cwd(), env: { PATH: process.env.PATH ?? '' }, cols: 120, rows: 40, mode: 'local-pty' }
    };
    const signature = createHmac('sha256', signingKey).update(canonicalJson(terminal)).digest('hex');

    const response = await fetch(`${daemon.url}/terminals`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: terminal, signature })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ events: [{ kind: 'accepted', commandId: terminal.commandId }] });
  });
});
