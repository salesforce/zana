import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runJoinStandalone } from '../../../host-daemon/src/join-standalone.mjs';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer | null = null;
let running: { close(): Promise<void> } | null = null;

afterEach(async () => {
  await running?.close();
  running = null;
  await server?.close();
  server = null;
});

describe('join-standalone pairing', () => {
  it('enrolls a join code, opens the host websocket, and reports connected', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-join-standalone-server-'));
    server = await startProductServer({
      dataDir,
      enrollToken: 'enroll-token-enroll-token-enroll',
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const minted = await fetch(`${server.url}api/v1/hosts/join-codes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }).then((response) => response.json()) as { joinCode: string; hostId: string };

    const machineDir = mkdtempSync(join(tmpdir(), 'zcc-join-standalone-machine-'));
    const port = 42000 + Math.floor(Math.random() * 1000);
    running = await runJoinStandalone([
      'join',
      '--join-code', minted.joinCode,
      '--host-id', minted.hostId,
      '--server-url', server.url.replace(/\/$/, ''),
      '--host-daemon-port', String(port)
    ], { ...process.env, ZCC_DATA_DIR: machineDir });

    const deadline = Date.now() + 15_000;
    let connected = false;
    while (Date.now() < deadline) {
      try {
        const status = await fetch(`http://127.0.0.1:${port}/status`).then((response) => response.json()) as {
          connected?: boolean;
          hostId?: string;
        };
        if (status.connected === true && status.hostId === minted.hostId) {
          connected = true;
          break;
        }
      } catch {
        /* status server not up yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const listed = await fetch(`${server.url}api/v1/hosts`).then((response) => response.json()) as Array<{
      id: string;
      status: string;
    }>;
    expect(connected).toBe(true);
    expect(listed.find((row) => row.id === minted.hostId)?.status).toBe('connected');
    expect(JSON.parse(readFileSync(join(machineDir, 'auth.json'), 'utf8')).hostId).toBe(minted.hostId);
  }, 20_000);
});
