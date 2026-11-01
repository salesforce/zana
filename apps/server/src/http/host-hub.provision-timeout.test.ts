import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { openDatabase, upsertHost } from '@zana-ai/zcc-db';
import { HOST_RPC_PROTOCOL_VERSION, type HostRpcCommand } from '@zana-ai/zcc-contracts/host-rpc';
import { createHostHub } from './host-hub.js';
import { createProductHub } from './product-hub.js';

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(close => close()); vi.useRealTimers(); });

function fixture() {
  vi.useFakeTimers();
  const dir = mkdtempSync(join(tmpdir(), 'zcc-provision-timeout-'));
  const db = openDatabase(join(dir, 'test.sqlite'));
  const hub = createHostHub(db, createProductHub());
  const hostId = '11111111-1111-4111-8111-111111111111', instanceId = '22222222-2222-4222-8222-222222222222';
  upsertHost(db, { id: hostId, name: 'Test', hostKeyHash: 'a'.repeat(64) });
  const sent: Array<{ type: string; requestId?: string }> = [];
  const socket = Object.assign(new EventEmitter(), { readyState: 1, OPEN: 1, send: (text: string) => sent.push(JSON.parse(text)), close() {}, terminate() {} });
  hub.acceptHello(socket as never, hostId, { type: 'host.hello', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, instanceId });
  function receive(message: Record<string, unknown>) { socket.emit('message', Buffer.from(JSON.stringify({ protocolVersion: HOST_RPC_PROTOCOL_VERSION, ...message }))); }
  receive({ type: 'host.ready', hostId, instanceId, runtime: { threads: [], loadedEnvironments: [] } });
  cleanup.push(() => { hub.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  // Keep the real lease logic running while advancing through long provisioning.
  async function advance(ms: number) {
    while (ms > 0) {
      const step = Math.min(ms, 5_000);
      await vi.advanceTimersByTimeAsync(step);
      hub.getSession(hostId)!.lastHeartbeatAt = Date.now();
      ms -= step;
    }
  }
  return { hub, hostId, sent, receive, advance };
}
const command: HostRpcCommand = {
  type: 'environment.provision', environmentId: '33333333-3333-4333-8333-333333333333',
  workspaceProvisionType: 'managed-worktree', sourcePath: '/source', targetPath: '/target',
  branchName: 'zcc/test', baseBranch: 'main', setupTimeoutMs: 15 * 60_000
};

it('waits past the ordinary RPC and setup budgets for worktree preparation, then accepts completion', async () => {
  const { hub, hostId, sent, receive, advance } = fixture();
  let settled = false;
  const pending = hub.callHostOnlineRpc({ hostId, command }).finally(() => { settled = true; });
  // Attach rejection handling before advancing time, including on the old implementation.
  const outcome = pending.catch(error => error);
  await advance(15 * 60_000 + 1_000);
  expect(settled).toBe(false);
  const request = sent.find(row => row.type === 'host-rpc.request')!;
  const result = { environmentId: command.environmentId, path: '/target', isGitRepo: true, isWorktree: true, branchName: 'zcc/test', defaultBranch: 'main', transcript: [] };
  receive({ type: 'host-rpc.response', requestId: request.requestId, commandType: command.type, ok: true, result });
  expect(await outcome).toEqual(result);
});

it('still times out managed provisioning within a bounded preparation allowance', async () => {
  const { hub, hostId, advance } = fixture();
  const outcome = hub.callHostOnlineRpc({ hostId, command }).catch(error => error);
  await advance(command.setupTimeoutMs + 120_000);
  expect(await outcome).toMatchObject({ message: 'host rpc timed out: environment.provision' });
});

it.each([
  { command: { type: 'host.browse_directory' } as HostRpcCommand, timeoutMs: undefined, duration: 30_000 },
  { command: { type: 'environment.provision', environmentId: command.environmentId, workspaceProvisionType: 'personal', targetPath: '/target' } as HostRpcCommand, timeoutMs: undefined, duration: 30_000 },
  { command, timeoutMs: 1_000, duration: 1_000 }
])('preserves ordinary deadlines and explicit overrides ($duration ms)', async ({ command: rpc, timeoutMs, duration }) => {
  const { hub, hostId, advance } = fixture();
  const outcome = hub.callHostOnlineRpc({ hostId, command: rpc, timeoutMs }).catch(error => error);
  await advance(duration);
  expect(await outcome).toMatchObject({ message: `host rpc timed out: ${rpc.type}` });
});
