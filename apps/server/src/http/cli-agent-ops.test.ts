import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { asControlResult, callControlAsProductServer, cliAgentPresentationStatus, sessionToCliAgent, createCliAgentOpsViaControl, PRODUCT_SERVER_CREDENTIAL_ENV } from './cli-agent-ops.js';

describe('cli-agent-ops helpers', () => {
  it('passes through a control-plane result', () => {
    expect(asControlResult({ ok: true, value: { id: 's1' } })).toEqual({ ok: true, value: { id: 's1' } });
    expect(asControlResult({ ok: false, code: 'NOT_FOUND', message: 'gone' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('projects a terminal session into the CLI Agent record', () => {
    expect(sessionToCliAgent({
      id: 's1',
      projectId: 'p1',
      profile: 'claude',
      title: 'hello',
      pid: 9
    }, 'idle')).toEqual({
      id: 's1',
      projectId: 'p1',
      profile: 'claude',
      title: 'hello',
      status: 'idle',
      pid: 9
    });
  });
  it('preserves the execution owner on machine-owned session records', () => {
    expect(sessionToCliAgent({ id: 's1', projectId: 'p1', hostId: 'owner', profile: 'shell', title: 'Terminal' }, 'running'))
      .toMatchObject({ hostId: 'owner', projectId: 'p1' });
  });

  it('prefers an exited terminal over a dropped agent-status row', () => {
    expect(cliAgentPresentationStatus({ status: 'exited' }, 'unknown')).toBe('exited');
    expect(cliAgentPresentationStatus({ status: 'running' }, 'idle')).toBe('idle');
    expect(cliAgentPresentationStatus({ status: 'running' }, undefined)).toBe('running');
  });
});

it('forwards machine intent and each operation through the authenticated desktop socket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-cli-ops-'));
  const socketPath = join(dir, 's');
  const calls: any[] = [];
  const server = createServer(socket => socket.once('data', data => {
    calls.push(JSON.parse(data.toString()));
    socket.end('{"ok":true,"value":true}\n');
  }));
  vi.stubEnv(PRODUCT_SERVER_CREDENTIAL_ENV, 'product-only');
  try {
    await new Promise<void>(resolve => server.listen(socketPath, resolve));
    writeFileSync(join(dir, 'control.token'), JSON.stringify({ token: 'fixture', nonce: 'nonce', socket: socketPath }));
    const ops = createCliAgentOpsViaControl(dir);
    await ops.create({ projectId: 'p', hostId: 'enrolled-primary', profile: 'shell' });
    await ops.status('s'); await ops.list('p'); await ops.list(); await ops.get('s'); await ops.reply('s', 'again'); await ops.close('s');
    expect(calls.map(({ op, args }) => ({ op, args }))).toEqual([
      { op: 'term.create', args: { projectId: 'p', hostId: 'enrolled-primary', profile: 'shell' } },
      { op: 'session.status', args: { sessionId: 's' } }, { op: 'term.list', args: { projectId: 'p' } },
      { op: 'term.list', args: {} }, { op: 'term.get', args: { sessionId: 's' } },
      { op: 'term.reply', args: { sessionId: 's', text: 'again' } }, { op: 'term.close', args: { sessionId: 's' } }
    ]);
    expect(calls.every(call => call.callerCredential === 'product-only')).toBe(true);
  } finally {
    vi.unstubAllEnvs(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each(['chunked', 'end-json', 'bad-json', 'bad-end', 'oversized', 'timeout'])('bounds and validates %s control replies', async mode => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-cli-response-'));
  const socketPath = join(dir, 's');
  const server = createServer(socket => {
    socket.on('error', () => {});
    socket.once('data', () => {
      if (mode === 'chunked') { socket.write('{"ok":'); setImmediate(() => socket.end('true,"value":9}\n')); }
      if (mode === 'end-json') socket.end('{"ok":true,"value":9}');
      if (mode === 'bad-json') socket.end('broken\n');
      if (mode === 'bad-end') socket.end('broken');
      if (mode === 'oversized') socket.end('x'.repeat(256 * 1024 + 1));
    });
  });
  vi.stubEnv(PRODUCT_SERVER_CREDENTIAL_ENV, '');
  try {
    await new Promise<void>(resolve => server.listen(socketPath, resolve));
    writeFileSync(join(dir, 'control.token'), JSON.stringify({ token: 'fixture', nonce: 'nonce', socket: socketPath }));
    const result = await callControlAsProductServer(dir, 'term.get', { sessionId: 's' }, 100);
    expect(result).toMatchObject(['chunked', 'end-json'].includes(mode)
      ? { ok: true, value: 9 } : { ok: false, code: 'host_disconnected' });
  } finally {
    vi.unstubAllEnvs(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

it('fails closed when the desktop credential file is missing, malformed, or points to an absent socket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-cli-token-'));
  try {
    for (const value of [undefined, 'broken', '{}', JSON.stringify({ token: 'x', nonce: 'y', socket: join(dir, 'missing') })]) {
      if (value) writeFileSync(join(dir, 'control.token'), value);
      await expect(callControlAsProductServer(dir, 'term.create', {})).resolves.toMatchObject({ ok: false, code: 'host_disconnected' });
    }
    for (const value of [null, {}, 'response']) expect(asControlResult(value)).toMatchObject({ ok: false });
    expect(cliAgentPresentationStatus({}, undefined)).toBe('unknown');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


it('skips desktop invalidation for a standalone server', async () => {
  vi.stubEnv(PRODUCT_SERVER_CREDENTIAL_ENV, '');
  try { await expect(createCliAgentOpsViaControl('/not-used').invalidateModelCatalog!('codex')).resolves.toBeUndefined(); }
  finally { vi.unstubAllEnvs(); }
});

it('discovers scoped CLI peers and forwards signed-origin peer delivery through main', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-peer-ops-'));
  const socketPath = join(dir, 's');
  const calls: any[] = [];
  let fail = false;
  const server = createServer(socket => socket.once('data', data => {
    const call = JSON.parse(data.toString()); calls.push(call);
    socket.end(JSON.stringify(fail ? { ok: false, code: 'SEND_FAILED', message: 'gone' } : { ok: true, value: call.op === 'agent.list' ? [
      { sessionId: 's1', projectId: 'p1', displayName: 'Title', handle: 'reviewer', role: 'QA', capabilities: ['tests'], state: 'working' },
      { sessionId: 's2', projectId: 'p2' }, { sessionId: 's3', projectId: 'p1', teamLaunchId: 'private-squad' }
    ] : { id: 'm1', delivered: false } }) + '\n');
  }));
  try {
    await new Promise<void>(resolve => server.listen(socketPath, resolve));
    writeFileSync(join(dir, 'control.token'), JSON.stringify({ token: 'fixture', nonce: 'nonce', socket: socketPath }));
    const ops = createCliAgentOpsViaControl(dir);
    expect(await ops.peers!('p1')).toEqual([{ sessionId: 's1', projectId: 'p1', kind: 'cli-agent', displayName: 'Title', handle: 'reviewer', role: 'QA', capabilities: ['tests'], status: 'working' }]);
    expect(await ops.peers!()).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: 's2', displayName: 's2', status: 'unknown' })]));
    const input = { to: 's1', projectId: 'p1', fromSessionId: 'thread-1', fromHandle: 'Builder', message: 'review' };
    expect(await ops.sendPeer!(input)).toEqual({ ok: true, id: 'm1', delivered: false });
    expect(calls.at(-1)).toMatchObject({ op: 'agent.peer.send', args: input });
    fail = true;
    expect(await ops.peers!()).toEqual([]);
    expect(await ops.sendPeer!(input)).toEqual({ ok: false, error: 'gone' });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true });
  }
});

it.each([true, false])('awaits desktop model invalidation and reports failure (ok=%s)', async (ok) => {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-mc-'));
  const socketPath = join(dir, 's');
  const calls: unknown[] = [];
  const server = createServer(socket => {
    socket.once('data', data => {
      calls.push(JSON.parse(data.toString()));
      socket.end(JSON.stringify(ok ? { ok: true, value: null } : { ok: false, code: 'UNAVAILABLE', message: 'cache unavailable' }) + '\n');
    });
  });
  vi.stubEnv(PRODUCT_SERVER_CREDENTIAL_ENV, 'fixture-secret');
  try {
    await new Promise<void>(resolve => server.listen(socketPath, resolve));
    writeFileSync(join(dir, 'control.token'), JSON.stringify({ token: 'fixture', nonce: 'nonce', socket: socketPath }));
    const request = createCliAgentOpsViaControl(dir).invalidateModelCatalog!('acp-opencode');
    if (ok) await expect(request).resolves.toBeUndefined();
    else await expect(request).rejects.toThrow('Desktop model cache could not be refreshed: cache unavailable');
    expect(calls).toEqual([{ token: 'fixture', nonce: 'nonce', callerCredential: 'fixture-secret',
      op: 'harness.models.invalidate', args: { providerId: 'acp-opencode' } }]);
  } finally {
    vi.unstubAllEnvs();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
