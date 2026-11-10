import { afterEach, expect, it, vi } from 'vitest';
import { connect } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorizeRequest, dispatchOp, startControlPlane, type ControlPlaneDeps, type ControlPlaneHandle } from './control-plane.js';

const auth = { token: 'token', nonce: 'nonce' };
const args = { pluginId: 'approval-probe', projectId: 'p-1', threadId: 't-1', invocationId: 'i-1',
  binding: { action: 'agent.activate', target: 'org', targetLabel: 'Sandbox', subject: 'Agent', revision: 'sha' }, title: 'Activate', timeoutMs: 300000 };
let handle: ControlPlaneHandle | undefined;
let dir: string | undefined;
afterEach(async () => { vi.useRealTimers(); await handle?.close(); handle = undefined; if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

it('permits only authenticated product server, not operator, agent, orchestrator or forged source', async () => {
  const verify = (value: unknown) => value === 'product-secret';
  for (const fields of [{}, { callerSessionId: 'agent' }, { callerCredential: 'forged' },
    { callerSessionId: 'orch', callerCredential: 'session-secret' }, { callerSessionId: 'agent', callerCredential: 'product-secret' }]) {
    expect(authorizeRequest({ ...auth, op: 'plugin.toolApproval.request', args: { ...args, source: 'product-server' }, ...fields }, auth,
      () => true, () => true, verify)).toMatchObject({ ok: false, code: 'FORBIDDEN_AGENT' });
  }
  expect(authorizeRequest({ ...auth, op: 'plugin.toolApproval.request', callerCredential: 'product-secret', args }, auth, undefined, undefined, verify)).toMatchObject({ ok: true, caller: 'product-server' });
  const ask = vi.fn(async () => ({ approved: false as const, reason: 'cancelled' as const }));
  const deps = { requestPluginToolApproval: ask } as unknown as ControlPlaneDeps;
  for (const caller of ['agent', 'operator', 'orchestrator'] as const) {
    expect(await dispatchOp('plugin.toolApproval.request', args, deps, { class: caller })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  }
  expect(ask).not.toHaveBeenCalled();
  expect(await dispatchOp('plugin.toolApproval.request', args, deps, { class: 'product-server' })).toEqual({ ok: true, value: { approved: false, reason: 'cancelled' } });
});

it('validates bounds and fails closed without sheet wiring or when sheet errors', async () => {
  for (const changed of [{ ...args, pluginId: 'Bad' }, { ...args, projectId: '' }, { ...args, binding: null }, { ...args, timeoutMs: 300001 }]) {
    expect(await dispatchOp('plugin.toolApproval.request', changed, {} as ControlPlaneDeps, { class: 'product-server' })).toMatchObject({ ok: false, code: 'BAD_ARGS' });
  }
  expect(await dispatchOp('plugin.toolApproval.request', args, {} as ControlPlaneDeps, { class: 'product-server' })).toEqual({ ok: true, value: { approved: false, reason: 'unavailable' } });
  expect(await dispatchOp('plugin.toolApproval.request', args, { requestPluginToolApproval: async () => { throw new Error('offline'); } } as ControlPlaneDeps,
    { class: 'product-server' })).toEqual({ ok: true, value: { approved: false, reason: 'unavailable' } });
});

it('extends authenticated approval beyond default 10 seconds, but not beyond requested five-minute cap', async () => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-approval-control-'));
  const ask = vi.fn(() => new Promise<any>(() => {}));
  handle = await startControlPlane({ socketPath: join(dir, 'control.sock'), tokenPath: join(dir, 'control.token'),
    verifyProductServerCredential: value => value === 'product-secret', requestPluginToolApproval: ask } as any);
  const token = JSON.parse(readFileSync(join(dir, 'control.token'), 'utf8'));
  const socket = connect(token.socket);
  await new Promise<void>(resolve => socket.once('connect', resolve));
  vi.useFakeTimers();
  let response: unknown;
  socket.on('data', chunk => { response = JSON.parse(String(chunk)); });
  socket.write(JSON.stringify({ ...token, callerCredential: 'product-secret', op: 'plugin.toolApproval.request', args }) + '\n');
  await vi.waitFor(() => expect(ask).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(10001);
  expect(response).toBeUndefined();
  await vi.advanceTimersByTimeAsync(300000);
  await vi.waitFor(() => expect(response).toEqual({ ok: true, value: { approved: false, reason: 'timeout' } }));
  socket.destroy();
});

it('keeps unrelated authenticated product operations on the default deadline', async () => {
  dir = mkdtempSync(join(tmpdir(), 'zcc-approval-control-'));
  const invoke = vi.fn(() => new Promise(() => {}));
  handle = await startControlPlane({ socketPath: join(dir, 'control.sock'), tokenPath: join(dir, 'control.token'),
    verifyProductServerCredential: value => value === 'product-secret', invokeSharedProduct: invoke } as unknown as ControlPlaneDeps);
  const token = JSON.parse(readFileSync(join(dir, 'control.token'), 'utf8'));
  vi.useFakeTimers();
  const socket = connect(token.socket);
  try {
    await new Promise<void>(resolve => socket.once('connect', resolve));
    let response: unknown;
    socket.on('data', chunk => { response = JSON.parse(String(chunk)); });
    socket.write(JSON.stringify({ ...token, callerCredential: 'product-secret', op: 'product.invoke', args: { timeoutMs: 300000 } }) + '\n');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(10001);
    await vi.waitFor(() => expect(response).toEqual({ ok: false, code: 'TIMEOUT', message: 'request timed out' }));
  } finally { socket.destroy(); }
});
