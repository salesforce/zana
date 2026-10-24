import { mkdtempSync, readFileSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { PROTOCOL_VERSION, runJoinStandalone } from '../../../host-daemon/src/join-standalone.js';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer | null = null;
let running: { close(): Promise<void> } | null = null;
const peerRuns: Array<{ close(): Promise<void> }> = [];
const peerServers: ProductServer[] = [];
const peerRoots: string[] = [];

afterEach(async () => {
  await running?.close();
  running = null;
  await server?.close();
  server = null;
  for (const joined of peerRuns.splice(0)) await joined.close();
  for (const app of peerServers.splice(0)) await app.close();
  for (const root of peerRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('join-standalone pairing', () => {
  it(`ships host-rpc protocol ${HOST_RPC_PROTOCOL_VERSION}`, () => {
    expect(PROTOCOL_VERSION).toBe(HOST_RPC_PROTOCOL_VERSION);
  });

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

  it('two independent apps activate and revoke real peer links through standalone control and v2 forwarding', async () => {
    const app = async () => {
      const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-standalone-peer-app-')));
      peerRoots.push(dir);
      const server = await startProductServer({ dataDir: dir, origins: { serverPort: 0 },
        peerKeyProvider: { getKey: async () => key } });
      peerServers.push(server);
      return { dir, server };
    };
    const key = randomBytes(32), a = await app(), b = await app();
    const enroll = async (owner: typeof a, local: typeof b) => {
      const issued = owner.server.ctx.joinCodes.mint();
      const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-standalone-peer-host-')));
      peerRoots.push(dir);
      const listener = createServer();
      await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
      const port = (listener.address() as { port: number }).port;
      await new Promise<void>(resolve => listener.close(() => resolve()));
      peerRuns.push(await runJoinStandalone(['join', '--join-code', issued.joinCode,
        '--host-id', issued.hostId, '--server-url', owner.server.url, '--host-daemon-port', String(port)],
      { ...process.env, ZCC_DATA_DIR: dir, ZCC_LOCAL_PEER_APP_DATA_DIR: local.dir }));
      await vi.waitFor(async () => expect(await local.server.ctx.peerChannels.remote(owner.server.ctx.productInstanceId)).not.toBeNull());
      return issued.hostId;
    };
    const ab = await enroll(a, b), ba = await enroll(b, a);
    const proposal = { pairId: randomUUID(), proposalId: randomUUID(), localInstanceId: a.server.ctx.productInstanceId,
      remoteInstanceId: b.server.ctx.productInstanceId, targetHostId: ab, pluginId: 'test-plugin', scope: 'opaque-scope', epoch: 1 };
    const { localInstanceId: _local, ...wire } = proposal;
    const activated = await fetch(`${a.server.url}api/v1/peer-links`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'activate', proposal: wire }) });
    expect(activated.status).toBe(200);
    expect(await b.server.ctx.peerPairs.grant(proposal.pairId)).toMatchObject({ targetHostId: ba });
    const dispatchPeer = vi.fn(async (_plugin: string, _method: string, request: { body: unknown }) => request.body);
    b.server.ctx.plugins = { dispatchPeer, stop() {} } as never;
    const body = JSON.stringify({ text: 'x'.repeat(24_000) });
    const envelope = (await a.server.ctx.peerPairs.signRequest(proposal.pairId,
      { pluginId: proposal.pluginId, scope: proposal.scope, method: 'echo', body: Buffer.from(body) }))!;
    const echoed = await a.server.ctx.hostHub.callHostOnlineRpc<{ status: number; body: string }>({ hostId: ab,
      command: { type: 'peer.forward', ...envelope, method: 'echo', body, timeoutMs: 10_000 } });
    expect(echoed.status).toBe(200);
    expect(JSON.parse(echoed.body).result).toEqual(JSON.parse(body));
    expect(dispatchPeer).toHaveBeenCalledOnce();
    await a.server.ctx.peerAuthority.revoke(proposal.pairId);
    await a.server.ctx.peerAuthority.recover();
    expect(await b.server.ctx.peerPairs.grant(proposal.pairId)).toBeNull();
  }, 40_000);
});
