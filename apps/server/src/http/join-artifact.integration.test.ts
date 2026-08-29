import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveHostArtifact } from '../services/hosts/host-artifact.js';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer | null = null;
let child: ReturnType<typeof spawn> | null = null;

afterEach(async () => {
  if (child?.pid) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    child = null;
  }
  await server?.close();
  server = null;
});

describe('packed join artifact RPC', () => {
  it('enrolls and answers host.browse_directory', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-join-bundle-server-'));
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

    const artifact = resolveHostArtifact({ ...process.env, ZCC_HOST_ARTIFACT: '' });
    const unpack = mkdtempSync(join(tmpdir(), 'zcc-join-bundle-unpack-'));
    expect(spawnSync('tar', ['-xzf', artifact.tarballPath, '-C', unpack]).status).toBe(0);

    const machineDir = mkdtempSync(join(tmpdir(), 'zcc-join-bundle-machine-'));
    const listedRoot = join(machineDir, 'listed');
    mkdirSync(listedRoot);
    writeFileSync(join(listedRoot, 'hello.txt'), 'hi\n');
    const port = 43000 + Math.floor(Math.random() * 1000);
    child = spawn(process.execPath, [
      join(unpack, 'join.mjs'),
      'join',
      '--join-code', minted.joinCode,
      '--host-id', minted.hostId,
      '--server-url', server.url.replace(/\/$/, ''),
      '--host-daemon-port', String(port)
    ], {
      env: { ...process.env, ZCC_DATA_DIR: machineDir },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const childErr: Buffer[] = [];
    child.stderr?.on('data', (chunk) => childErr.push(Buffer.from(chunk)));

    const deadline = Date.now() + 20_000;
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
    expect(connected, Buffer.concat(childErr).toString('utf8') || 'join.mjs did not report connected').toBe(true);

    const listing = await fetch(
      `${server.url}api/v1/hosts/${minted.hostId}/directory?path=${encodeURIComponent(listedRoot)}`
    ).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(listing.status).toBe(200);
    expect(listing.body).toMatchObject({
      directory: listedRoot,
      entries: expect.arrayContaining([
        expect.objectContaining({ kind: 'file', name: 'hello.txt' })
      ])
    });
  }, 30_000);
});
