import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import {
  HOST_RPC_PROTOCOL_VERSION,
  type HostRpcRequestMessage
} from '@zana-ai/zcc-contracts/host-rpc';
import {
  getConversationThread,
  listConversationThreadEvents
} from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';
import type { ProductHttpContext } from './product-context.js';
import { registerThreadProvider } from '../services/threads/thread-provider-catalog.js';

let server: ProductServer | null = null;
const sockets: WebSocket[] = [];
const providerHandles: Array<{ unregister(): void }> = [];

beforeEach(() => {
  for (const id of ['claude-code', 'acp-opencode'] as const) {
    providerHandles.push(
      registerThreadProvider('test', {
        id,
        displayName: id,
        capabilities: {
          supportsServiceTier: false,
          fork: 'checkpoint',
          supportsThreadArchive: false,
          supportsThreadRename: false,
          permissionModes: ['full']
        },
        composerActions: []
      })
    );
  }
});

afterEach(async () => {
  for (const handle of providerHandles.splice(0)) handle.unregister();
  for (const socket of sockets) socket.close();
  sockets.length = 0;
  await server?.close();
  server = null;
});

async function startServer(
  projectRoot: string,
  enrollToken = 'enroll-token-enroll-token-enroll',
  extras?: { quickAgent?: boolean; name?: string }
) {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-host-hub-'));
  writeFileSync(
    join(dataDir, 'projects.json'),
    JSON.stringify({
      version: 1,
      projects: [{
        id: 'proj-1',
        name: extras?.name ?? 'Alpha',
        path: projectRoot,
        createdAt: 1,
        lastActiveAt: 1,
        ...(extras?.quickAgent ? { quickAgent: true } : {})
      }]
    })
  );
  server = await startProductServer({
    dataDir,
    enrollToken,
    origins: { serverPort: 0, devAppPort: 5173 }
  });
  server.ctx.pluginHostArtifacts.set('test', {
    path: '/tmp/host.js',
    digest: 'a'.repeat(64),
    byteLength: 12,
    generation: 'g1'
  });
  return { dataDir, enrollToken };
}

async function enrollHost(token: string, hostName: string, instanceId: string, hostId?: string) {
  const response = await fetch(`${server!.url}internal/hosts/enroll`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostName,
      instanceId,
      ...(hostId ? { hostId } : {})
    })
  });
  expect(response.status).toBe(201);
  return await response.json() as { hostId: string; hostKey: string };
}

function openHostSocket(
  enrolled: { hostId: string; hostKey: string },
  instanceId: string,
  handle: (request: HostRpcRequestMessage, reply: (ok: boolean, result?: unknown, error?: { code: string; message: string }) => void) => void,
  activeThreadIds: string[] = []
): Promise<WebSocket> {
  const url = new URL('internal/hosts/ws', server!.url.replace(/^http/, 'ws'));
  const socket = new WebSocket(url, {
    headers: {
      authorization: `Bearer ${enrolled.hostKey}`,
      'x-zcc-host-id': enrolled.hostId
    }
  });
  sockets.push(socket);
  socket.on('message', (raw) => {
    if (JSON.parse(String(raw)).type === 'host.hello-ok') socket.send(JSON.stringify({ type: 'host.ready', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: enrolled.hostId, instanceId, runtime: { threads: activeThreadIds.map(threadId => ({ threadId, status: 'active' })), loadedEnvironments: activeThreadIds.map(id => getConversationThread(server!.ctx.db, id)!.environmentId) } }));
    const parsed = JSON.parse(String(raw)) as HostRpcRequestMessage;
    if (parsed.type !== 'host-rpc.request') return;
    handle(parsed, (ok, result, error) => {
      socket.send(JSON.stringify({
        type: 'host-rpc.response',
        protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        requestId: parsed.requestId,
        ok,
        commandType: parsed.command.type,
        result,
        error
      }));
    });
  });
  return new Promise((resolve, reject) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'host.hello',
        protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        hostId: enrolled.hostId,
        instanceId
      }));
      resolve(socket);
    });
    socket.on('error', reject);
  });
}

async function waitForHost(hostId: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server?.ctx.hostHub.connectedHostIds().includes(hostId)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`host ${hostId} did not connect`);
}

async function waitForThreadStatus(threadId: string, status: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (getConversationThread(server!.ctx.db, threadId)?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`thread ${threadId} did not reach status ${status}`);
}

function defaultRpcHandler(projectRoot: string) {
  return (
    request: HostRpcRequestMessage,
    reply: (ok: boolean, result?: unknown, error?: { code: string; message: string }) => void
  ) => {
    switch (request.command.type) {
      case 'provider.status':
        reply(true, {
          providers: [{
            family: 'claude',
            label: 'Claude Code',
            binary: process.execPath,
            enabled: true,
            alwaysEnabled: true,
            installed: true,
            installHint: 'ok'
          }]
        });
        return;
      case 'environment.provision': {
        const command = request.command;
        const path = command.workspaceProvisionType === 'unmanaged'
          ? command.path
          : command.targetPath;
        reply(true, {
          environmentId: command.environmentId,
          path,
          isGitRepo: true,
          isWorktree: command.workspaceProvisionType === 'managed-worktree',
          branchName: command.workspaceProvisionType === 'managed-worktree' ? command.branchName : 'main',
          defaultBranch: 'main',
          transcript: []
        });
        return;
      }
      case 'thread.start':
        reply(true, { threadId: request.command.threadId, started: true, providerThreadId: `prov-${request.command.threadId}` });
        return;
      case 'turn.submit':
        reply(true, { threadId: request.command.threadId, accepted: true });
        return;
      case 'thread.resume':
        reply(true, { threadId: request.command.threadId, resumed: true, providerThreadId: request.command.providerThreadId });
        return;
      case 'thread.stop':
        reply(true, { threadId: request.command.threadId, stopped: true });
        return;
      case 'interactive.resolve':
        reply(true, { interactionId: request.command.interactionId, delivered: true });
        return;
      case 'environment.destroy':
        reply(true, { environmentId: request.command.environmentId, destroyed: true });
        return;
      case 'project.clone_default_path':
        reply(true, { path: join(projectRoot, 'checkouts', request.command.projectSlug) });
        return;
      case 'host.list_branches':
        reply(true, { branches: ['main'], truncated: false });
        return;
      case 'host.read_path': {
        try {
          const content = readFileSync(request.command.path, 'utf8');
          reply(true, { path: request.command.path, content, contentEncoding: 'utf8', sizeBytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') });
        } catch { reply(false, undefined, { code: 'path_not_found', message: 'File does not exist' }); }
        return;
      }
      case 'host.list_files':
        reply(true, {
          files: [{
            root: request.command.roots[0],
            relPath: 'note.md',
            bytes: 7,
            kind: 'file'
          }]
        });
        return;
      case 'host.list_dir': {
        const prefix = request.command.relPath
          ? `${request.command.root}/${request.command.relPath}`
          : request.command.root;
        reply(true, {
          entries: [{ name: 'note.md', kind: 'file', path: `${prefix}/note.md` }]
        });
        return;
      }
      case 'host.browse_directory':
        reply(true, {
          directory: request.command.path ?? projectRoot,
          parent: null,
          entries: [{ name: 'note.md', kind: 'file', path: `${request.command.path ?? projectRoot}/note.md` }]
        });
        return;
      case 'host.read_file':
        reply(true, { content: '# hello\n', encoding: 'utf8' });
        return;
      default:
        reply(false, undefined, { code: 'unknown_command', message: request.command.type });
    }
  };
}

describe('host enroll hub and thread create', () => {
  it('persists each terminal once per batch and preserves interleaved Unicode cursors, exit ordering and dedupe', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-terminal-coalesce-'));
    const { enrollToken } = await startServer(root);
    const instanceId = randomUUID(), enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    const socket = await openHostSocket(enrolled, instanceId, defaultRpcHandler(root));
    await waitForHost(enrolled.hostId);
    const a = randomUUID(), b = randomUUID();
    for (const id of [a, b]) server!.ctx.terminalSessions.set(id, { id, projectId: 'proj-1', title: id, profile: 'shell', cwd: root, status: 'running', createdAt: 1, hostId: enrolled.hostId, daemonInstanceId: instanceId, outputText: id === a ? 'A' : '', outputEndOffset: id === a ? 1 : 0 });
    const persist = vi.spyOn(server!.ctx.terminalSessions, 'set'), publish = vi.spyOn(server!.ctx.hub, 'emit');
    const batch = { type: 'host.event', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: enrolled.hostId, instanceId, batchId: randomUUID(), events: [
      { terminalId: a, kind: 'terminal.output', payload: { data: '🙂' } },
      { terminalId: a, kind: 'terminal.output', payload: { data: 'B' } },
      { terminalId: b, kind: 'terminal.output', payload: { data: 'Z' } },
      { terminalId: a, kind: 'terminal.output', payload: { data: 'C' } },
      { terminalId: a, kind: 'terminal.exited', payload: { exitCode: -1, reason: 'capacity' } },
      { terminalId: randomUUID(), kind: 'terminal.output', payload: { data: 'unowned' } }
    ] };
    const send = () => new Promise<any>(resolve => {
      const listener = (raw: WebSocket.RawData) => { const ack = JSON.parse(String(raw)); if (ack.type === 'host.event-ack') { socket.off('message', listener); resolve(ack); } };
      socket.on('message', listener); socket.send(JSON.stringify(batch));
    });
    expect(await send()).toMatchObject({ accepted: 5, rejected: [{ index: 5, reason: 'unknown_terminal' }] });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(server!.ctx.terminalSessions.get(a)).toMatchObject({ outputText: 'A🙂BC', outputEndOffset: 5, status: 'exited' });
    const notices = publish.mock.calls.filter(([kind]) => kind.startsWith('terminals:'));
    expect(notices).toEqual([
      ['terminals:data', { sessionId: a, data: '🙂B', startOffset: 1, endOffset: 4 }],
      ['terminals:data', { sessionId: b, data: 'Z', startOffset: 0, endOffset: 1 }],
      ['terminals:data', { sessionId: a, data: 'C', startOffset: 4, endOffset: 5 }],
      ['terminals:exit', { sessionId: a, code: -1, reason: 'capacity' }],
      ['terminals:updated', { sessionId: a }]
    ]);
    await send(); expect(persist).toHaveBeenCalledTimes(2);
    persist.mockRestore(); publish.mockRestore(); socket.close();
  });
  it('recovers terminal ownership and deduplicates acknowledged history after a server restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-terminal-recovery-'));
    const { dataDir, enrollToken } = await startServer(root);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    let socket = await openHostSocket(enrolled, instanceId, defaultRpcHandler(root));
    await waitForHost(enrolled.hostId);
    const started = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['hi'] })
    }).then(response => response.json()) as { value: { id: string } };
    const threadId = started.value.id;
    const before = listConversationThreadEvents(server!.ctx.db, threadId).length;
    const terminalId = randomUUID();
    server!.ctx.terminalSessions.set(terminalId, { id: terminalId, projectId: 'proj-1', title: 'Owned', profile: 'shell', cwd: root, status: 'running', createdAt: 1, hostId: enrolled.hostId, daemonInstanceId: instanceId });
    const batch = { type: 'host.event', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: enrolled.hostId, instanceId, batchId: randomUUID(), events: [
      { terminalId, kind: 'terminal.output', payload: { data: 'once\n' } },
      { threadId, kind: 'thread.started' },
      { threadId, kind: 'thread.event', payload: { type: 'turn/diff/updated', diff: 'never store' } },
      { threadId, kind: 'thread.event', payload: { type: 'turn/diff/updated', diff: 'never store either' } },
      { threadId, kind: 'thread.event', payload: { type: 'item/completed', threadId, scope: { kind: 'turn', turnId: 'retained' },
        item: { type: 'commandExecution', id: 'retained-command', command: 'echo', cwd: '/', status: 'completed', approvalStatus: 'not-requested', aggregatedOutput: 'x'.repeat(100_000), exitCode: 0 } } }
    ] };
    const send = (body = batch) => new Promise<any>(resolve => {
      const listener = (raw: WebSocket.RawData) => { const value = JSON.parse(String(raw)); if (value.type === 'host.event-ack') { socket.off('message', listener); resolve(value); } };
      socket.on('message', listener); socket.send(JSON.stringify(body));
    });
    expect(await send()).toMatchObject({ batchId: batch.batchId, accepted: 5 });
    expect(await send()).toMatchObject({ batchId: batch.batchId, accepted: 5 });
    expect(server!.ctx.terminalSessions.get(terminalId)?.outputText).toBe('once\n');
    expect(listConversationThreadEvents(server!.ctx.db, threadId)).toHaveLength(before + 2);
    expect(JSON.stringify(listConversationThreadEvents(server!.ctx.db, threadId))).not.toContain('x'.repeat(5000));
    expect(server!.ctx.db.sqlite.prepare('SELECT length(value) AS size FROM conversation_event_outputs').all()).toEqual([{ size: 100_000 }]);
    await server!.close();
    server = await startProductServer({ dataDir, enrollToken, origins: { serverPort: 0, devAppPort: 5173 } });
    socket = await openHostSocket(enrolled, instanceId, defaultRpcHandler(root), [threadId]);
    await waitForHost(enrolled.hostId);
    expect(await send()).toMatchObject({ accepted: 5 });
    expect(server.ctx.terminalSessions.get(terminalId)).toMatchObject({ status: 'running', outputText: 'once\n', outputEndOffset: 5, daemonInstanceId: instanceId });
    expect(listConversationThreadEvents(server.ctx.db, threadId)).toHaveLength(before + 2);
    // An identical retry is accepted; an identity reused for different content
    // closes the socket without applying a second mutation.
    const closed = new Promise<number>(resolve => socket.once('close', resolve));
    socket.send(JSON.stringify({ ...batch, events: [{ terminalId, kind: 'terminal.output', payload: { data: 'wrong' } }] }));
    expect(await closed).toBe(1011);
    socket = await openHostSocket(enrolled, randomUUID(), defaultRpcHandler(root));
    await waitForHost(enrolled.hostId);
    expect(server.ctx.terminalSessions.get(terminalId)).toMatchObject({ status: 'exited', exitCode: -1, outputText: 'once\n' });
  });
  it('rolls back cached output and publishes nothing if the durable batch commit fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'zcc-batch-rollback-'));
    const { enrollToken } = await startServer(root);
    const instanceId = randomUUID(), enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    let socket = await openHostSocket(enrolled, instanceId, defaultRpcHandler(root));
    await waitForHost(enrolled.hostId);
    const terminalId = randomUUID();
    const record = { id: terminalId, projectId: 'proj-1', title: 'Owned', profile: 'shell' as const, cwd: root, status: 'running' as const, createdAt: 1, hostId: enrolled.hostId, daemonInstanceId: instanceId };
    server!.ctx.terminalSessions.set(terminalId, record);
    const publish = vi.spyOn(server!.ctx.hub, 'emit');
    server!.ctx.db.sqlite.exec("CREATE TEMP TRIGGER fail_batch BEFORE INSERT ON host_event_receipts BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
    const batch = { type: 'host.event', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: enrolled.hostId, instanceId, batchId: randomUUID(), events: [{ terminalId, kind: 'terminal.output', payload: { data: 'one' } }] };
    const closed = new Promise<number>(resolve => socket.once('close', resolve));
    socket.send(JSON.stringify(batch)); expect(await closed).toBe(1011);
    expect(server!.ctx.terminalSessions.get(terminalId)).toBe(record);
    expect(record).not.toHaveProperty('outputText');
    expect(record).not.toHaveProperty('outputEndOffset');
    expect(publish.mock.calls.filter(([type]) => type === 'terminals:data')).toEqual([]);
    expect(server!.ctx.db.sqlite.prepare('SELECT record_json FROM product_terminal_sessions WHERE id = ?').get(terminalId)).toEqual({ record_json: JSON.stringify(record) });
    server!.ctx.db.sqlite.exec('DROP TRIGGER fail_batch');
    socket = await openHostSocket(enrolled, instanceId, defaultRpcHandler(root));
    await waitForHost(enrolled.hostId);
    const acknowledged = new Promise<any>(resolve => socket.once('message', data => resolve(JSON.parse(String(data)))));
    socket.send(JSON.stringify(batch)); expect(await acknowledged).toMatchObject({ accepted: 1 });
    expect(server!.ctx.terminalSessions.get(terminalId)).toMatchObject({ outputText: 'one', outputEndOffset: 3 });
    expect(publish.mock.calls.filter(([type]) => type === 'terminals:data')).toHaveLength(1);
  });
  it('accepts terminal output only from its registered execution host', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-terminal-owner-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceA = randomUUID(), instanceB = randomUUID();
    const a = await enrollHost(enrollToken, 'alpha', instanceA), b = await enrollHost(enrollToken, 'beta', instanceB);
    const aSocket = await openHostSocket(a, instanceA, defaultRpcHandler(projectRoot));
    const bSocket = await openHostSocket(b, instanceB, defaultRpcHandler(projectRoot));
    await waitForHost(a.hostId); await waitForHost(b.hostId);
    const id = randomUUID();
    server!.ctx.terminalSessions.set(id, { id, projectId: 'proj-1', title: 'Owned', profile: 'shell', cwd: projectRoot, status: 'running', createdAt: 1, hostId: a.hostId });
    const send = (socket: WebSocket, hostId: string, instanceId: string, kind: 'terminal.output' | 'terminal.exited') => new Promise<any>(resolve => {
      const listener = (raw: WebSocket.RawData) => { const value = JSON.parse(String(raw)); if (value.type === 'host.event-ack') { socket.off('message', listener); resolve(value); } };
      socket.on('message', listener);
      socket.send(JSON.stringify({ type: 'host.event', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId, instanceId, events: [{ terminalId: id, kind, payload: { data: 'owned output', exitCode: 9 } }] }));
    });
    expect(await send(bSocket, b.hostId, instanceB, 'terminal.output')).toMatchObject({ accepted: 0, rejected: [{ reason: 'unknown_terminal' }] });
    expect(await send(bSocket, b.hostId, instanceB, 'terminal.exited')).toMatchObject({ accepted: 0 });
    expect(server!.ctx.terminalSessions.get(id)).toMatchObject({ status: 'running' });
    expect(server!.ctx.terminalSessions.get(id)?.outputText).toBeUndefined();
    expect(await send(aSocket, a.hostId, instanceA, 'terminal.output')).toMatchObject({ accepted: 1 });
    expect(server!.ctx.terminalSessions.get(id)?.outputText).toBe('owned output');
  });
  it('waits for host.ready before publishing the machine and releasing queued work', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'hello-ok', instanceId);
    server!.ctx.pluginHostArtifacts.set('machine-proof', { path: '/private/not-sent', digest: 'a'.repeat(64), byteLength: 1, generation: 'current-generation' });
    const acks: Array<{ type?: string; hostId?: string }> = [];
    const url = new URL('internal/hosts/ws', server!.url.replace(/^http/, 'ws'));
    const socket = new WebSocket(url, {
      headers: {
        authorization: `Bearer ${enrolled.hostKey}`,
        'x-zcc-host-id': enrolled.hostId
      }
    });
    sockets.push(socket);
    socket.on('message', (raw) => {
      acks.push(JSON.parse(String(raw)) as { type?: string; hostId?: string });
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => {
        socket.send(JSON.stringify({
          type: 'host.hello',
          protocolVersion: HOST_RPC_PROTOCOL_VERSION,
          hostId: enrolled.hostId,
          instanceId
        }));
        resolve();
      });
      socket.on('error', reject);
    });
    await expect.poll(() => acks.some(row => row.type === 'host.hello-ok')).toBe(true);
    expect(server!.ctx.hostHub.connectedHostIds()).not.toContain(enrolled.hostId);
    socket.send(JSON.stringify({ type: 'host.ready', protocolVersion: HOST_RPC_PROTOCOL_VERSION, hostId: enrolled.hostId, instanceId, runtime: { threads: [], loadedEnvironments: [] } }));
    await waitForHost(enrolled.hostId);
    await server!.ctx.hostHub.waitUntilConnected(enrolled.hostId, 1_000);
    await expect.poll(
      () => acks.some((row) => row.type === 'host.hello-ok' && row.hostId === enrolled.hostId)
    ).toBe(true);
    expect(acks.find(row => row.type === 'host.hello-ok')).toMatchObject({ pluginHostGenerations: expect.arrayContaining([{ pluginId: 'machine-proof', generation: 'current-generation' }]) });
    expect(JSON.stringify(acks)).not.toContain('/private/not-sent');
  });

  it('rejects browser Origin on enroll and fails create when no host is connected', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    await expect(
      fetch(`${server!.url}internal/hosts/enroll`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${enrollToken}`,
          'content-type': 'application/json',
          origin: 'http://localhost:5173'
        },
        body: JSON.stringify({
          protocolVersion: HOST_RPC_PROTOCOL_VERSION,
          hostName: 'browser',
          instanceId: randomUUID()
        })
      }).then((response) => response.status)
    ).resolves.toBe(403);

    const created = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['hi'] })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(created.status).toBe(503);
    expect(created.body.code).toBe('host-unavailable');

    const harness = await fetch(`${server!.url}api/v1/harness/effective-default?projectId=proj-1`)
      .then((response) => response.json());
    expect(harness).toMatchObject({ ok: false, code: 'UNAVAILABLE_DEFAULT' });
  });

  it('keeps default launches on the registered primary after another machine joins', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceA = randomUUID();
    const instanceB = randomUUID();
    const hostA = await enrollHost(enrollToken, 'alpha', instanceA);
    await openHostSocket(hostA, instanceA, defaultRpcHandler(projectRoot));
    await waitForHost(hostA.hostId);

    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['ship it'] })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(spawned.status).toBe(201);
    expect(spawned.body.ok).toBe(true);
    expect(spawned.body.value.hostId).toBe(hostA.hostId);

    const sent = await fetch(`${server!.url}api/v1/threads/${spawned.body.value.id}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: ['follow up'], mode: 'auto' })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(sent.status).toBe(200);
    expect(sent.body.ok).toBe(true);

    const resumed = await fetch(`${server!.url}api/v1/threads/${spawned.body.value.id}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(resumed.status).toBe(200);

    const hostB = await enrollHost(enrollToken, 'beta', instanceB);
    await openHostSocket(hostB, instanceB, defaultRpcHandler(projectRoot));
    await waitForHost(hostB.hostId);

    const defaulted = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['two hosts'] })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(defaulted.status).toBe(201);
    expect(defaulted.body.value.hostId).toBe(hostA.hostId);
  });

  it('provisions a personal workspace when Default Project runs on another machine', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot, 'enroll-token-enroll-token-enroll', {
      quickAgent: true,
      name: 'Default Project'
    });
    const instanceA = randomUUID();
    const instanceB = randomUUID();
    const hostA = await enrollHost(enrollToken, 'alpha', instanceA);
    await openHostSocket(hostA, instanceA, defaultRpcHandler(projectRoot));
    await waitForHost(hostA.hostId);

    const hostB = await enrollHost(enrollToken, 'limited-pony', instanceB);
    const bCommands: HostRpcRequestMessage[] = [];
    await openHostSocket(hostB, instanceB, (request, reply) => {
      bCommands.push(request);
      defaultRpcHandler(projectRoot)(request, reply);
    });
    await waitForHost(hostB.hostId);

    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-1',
        providerId: 'claude',
        input: ['hello'],
        hostId: hostB.hostId,
        environment: { kind: 'unmanaged' },
        cwd: projectRoot
      })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(spawned.status).toBe(201);
    const provision = bCommands.find((row) => row.command.type === 'environment.provision');
    expect(provision?.command).toMatchObject({ workspaceProvisionType: 'personal' });
    const targetPath = (provision?.command as { targetPath?: string }).targetPath;
    expect(targetPath?.startsWith(`${join(projectRoot, 'personal-workspaces')}/`)).toBe(true);
    await vi.waitFor(() => {
      const start = bCommands.find((row) => row.command.type === 'thread.start');
      expect(start?.command).toMatchObject({ type: 'thread.start' });
      expect((start?.command as { cwd?: string }).cwd).toBeUndefined();
    });
  });

  it('rejects a local project folder on another machine', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceA = randomUUID();
    const instanceB = randomUUID();
    const hostA = await enrollHost(enrollToken, 'alpha', instanceA);
    await openHostSocket(hostA, instanceA, defaultRpcHandler(projectRoot));
    await waitForHost(hostA.hostId);
    const hostB = await enrollHost(enrollToken, 'limited-pony', instanceB);
    await openHostSocket(hostB, instanceB, defaultRpcHandler(projectRoot));
    await waitForHost(hostB.hostId);

    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-1',
        providerId: 'claude',
        input: ['hello'],
        hostId: hostB.hostId
      })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(spawned.status).toBe(400);
    expect(spawned.body.code).toBe('host-workspace-mismatch');
  });

  it('provisions a managed worktree environment under the host data dir', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken, dataDir } = await startServer(projectRoot);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);

    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-1',
        providerId: 'claude',
        input: ['ship it'],
        environment: { kind: 'worktree', branchSlug: 'feat' }
      })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(spawned.status).toBe(201);
    expect(spawned.body.value.cwd).toContain(`${dataDir}/worktrees/`);
    expect(spawned.body.value.isWorktree).toBe(true);
    expect(spawned.body.value.branchName).toMatch(/^zcc\/feat-/);

    const archived = await fetch(`${server!.url}api/v1/threads/${spawned.body.value.id}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(archived.status).toBe(200);
  });

  it('assigns server-side event sequence and rejects a stale instanceId', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    const socket = await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);

    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['hi'] })
    }).then((response) => response.json()) as { value: { id: string } };
    const before = listConversationThreadEvents(server!.ctx.db, spawned.value.id).length;

    socket.send(JSON.stringify({
      type: 'host.event',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: enrolled.hostId,
      instanceId,
      events: [{ threadId: spawned.value.id, kind: 'thread.started' }]
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const first = listConversationThreadEvents(server!.ctx.db, spawned.value.id);
    expect(first).toHaveLength(before + 1);
    expect(first.map((event) => event.sequence)).toEqual(first.map((_, index) => index + 1));

    socket.send(JSON.stringify({
      type: 'host.event',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: enrolled.hostId,
      instanceId: randomUUID(),
      events: [{ threadId: spawned.value.id, kind: 'turn.completed' }]
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listConversationThreadEvents(server!.ctx.db, spawned.value.id)).toHaveLength(before + 1);
  });

  it.each(['completed', 'failed', 'interrupted'] as const)('preserves a fast turn result when session startup acknowledges late: %s', async status => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    const socket = await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);
    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['hi'] })
    }).then(response => response.json()) as { value: { id: string } };
    const threadId = spawned.value.id;
    const send = (events: unknown[]) => socket.send(JSON.stringify({
      type: 'host.event', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: enrolled.hostId, instanceId, events
    }));
    send([{ threadId, kind: 'turn.completed', payload: {
      type: 'turn/completed', scope: { kind: 'turn', turnId: 'fast' }, status
    } }]);
    await waitForThreadStatus(threadId, status === 'failed' ? 'error' : 'idle');
    send([{ threadId, kind: 'thread.started' }]);
    await vi.waitFor(() => expect(listConversationThreadEvents(server!.ctx.db, threadId).at(-1)?.type).toBe('thread.started'));
    expect(getConversationThread(server!.ctx.db, threadId)?.status).toBe(status === 'failed' ? 'error' : 'idle');
    send([{ threadId, kind: 'thread.event', payload: {
      type: 'turn/started', scope: { kind: 'turn', turnId: 'followup' }
    } }]);
    await waitForThreadStatus(threadId, 'active');
  });

  it.each(['completed', 'failed', 'interrupted'] as const)(
    'keeps a parent active after a distant child %s event, including after host reconnect', async (status) => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
      const { enrollToken } = await startServer(projectRoot);
      const instanceId = randomUUID();
      const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
      let socket = await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
      await waitForHost(enrolled.hostId);
      const spawned = await fetch(`${server!.url}api/v1/threads`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['hi'] })
      }).then((response) => response.json()) as { value: { id: string } };
      const threadId = spawned.value.id;
      const send = (events: unknown[]) => socket.send(JSON.stringify({
        type: 'host.event', protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        hostId: enrolled.hostId, instanceId, events
      }));
      const started = (turnId: string, parentToolCallId?: string) => ({
        threadId, kind: 'thread.event', payload: {
          type: 'turn/started', scope: { kind: 'turn', turnId }, parentToolCallId
        }
      });
      send([started('root'), started('child', 'delegation-1')]);
      const output = Array.from({ length: 350 }, (_, i) => ({
        threadId, kind: 'thread.event', payload: {
          type: 'item/agentMessage/delta', scope: { kind: 'turn', turnId: 'root' },
          itemId: 'message', delta: `output ${i}`
        }
      }));
      send(output.slice(0, 200));
      send(output.slice(200));
      await vi.waitFor(() => {
        expect(listConversationThreadEvents(server!.ctx.db, threadId).length).toBeGreaterThanOrEqual(352);
      });
      socket.close();
      await vi.waitFor(() => expect(server!.ctx.hostHub.connectedHostIds()).not.toContain(enrolled.hostId));
      socket = await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot), [threadId]);
      await waitForHost(enrolled.hostId);
      const completion = (turnId: string, completionStatus: string) => ({
        threadId, kind: 'turn.completed', payload: {
          type: 'turn/completed', scope: { kind: 'turn', turnId }, status: completionStatus
        }
      });
      send([completion('child', status)]);
      await vi.waitFor(() => {
        expect(listConversationThreadEvents(server!.ctx.db, threadId).at(-1)?.payload).toMatchObject({
          type: 'turn/completed', scope: { turnId: 'child' }
        });
      });
      const response = await fetch(`${server!.url}api/v1/threads/${threadId}`).then((r) => r.json());
      expect(response.thread.status).toBe('active');
      send([completion('root', 'completed')]);
      await waitForThreadStatus(threadId, 'idle');
    }
  );

  it('persists a later provider session identity from host events', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    const socket = await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);

    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['hi'] })
    }).then((response) => response.json()) as { value: { id: string; providerThreadId: string | null } };
    expect(spawned.value.id).toBeTruthy();
    await vi.waitFor(() => {
      expect(getConversationThread(server!.ctx.db, spawned.value.id)?.providerThreadId).toMatch(/^prov-/);
    });

    socket.send(JSON.stringify({
      type: 'host.event',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: enrolled.hostId,
      instanceId,
      events: [{
        threadId: spawned.value.id,
        kind: 'thread.event',
        payload: {
          type: 'thread/identity',
          threadId: spawned.value.id,
          providerThreadId: 'prov-replaced'
        }
      }]
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stored = getConversationThread(server!.ctx.db, spawned.value.id);
    expect(stored?.providerThreadId).toBe('prov-replaced');
  });

  it('lists library files through host rpc and rejects a path escape on the server', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    mkdirSync(join(projectRoot, '.zcc', 'library'), { recursive: true });
    writeFileSync(join(projectRoot, '.zcc', 'library', 'note.md'), '# hello\n');
    const { enrollToken, dataDir } = await startServer(projectRoot);
    mkdirSync(join(dataDir, 'library'), { recursive: true });
    writeFileSync(join(dataDir, 'library', 'note.md'), '# hello\n');
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    await openHostSocket(enrolled, instanceId, defaultRpcHandler(join(dataDir, 'library')));
    await waitForHost(enrolled.hostId);

    const listed = await fetch(`${server!.url}api/v1/library`).then((response) => response.json());
    expect(listed.docs).toEqual([expect.objectContaining({
      relPath: 'note.md',
      absPath: join(dataDir, 'library', 'note.md')
    }), expect.objectContaining({
      scope: 'project', projectId: 'proj-1', relPath: 'note.md',
      absPath: join(projectRoot, '.zcc', 'library', 'note.md')
    })]);

    const escaped = await fetch(
      `${server!.url}api/v1/library/content?scope=global&relPath=${encodeURIComponent('../secret')}`
    );
    expect(escaped.status).toBe(403);

    const dir = await fetch(`${server!.url}api/v1/fs/list-dir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: projectRoot })
    }).then((response) => response.json());
    expect(dir.entries).toEqual([
      expect.objectContaining({ name: 'note.md', kind: 'file' })
    ]);
    await expect(
      fetch(`${server!.url}api/v1/fs/list-dir`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/etc' })
      }).then((response) => response.status)
    ).resolves.toBe(403);
  });

  it('interrupts live conversation threads when the host instance restarts', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    const socket = await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);

    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['keep working'] })
    }).then((response) => response.json()) as { value: { id: string } };
    expect(getConversationThread(server!.ctx.db, spawned.value.id)?.status).toBe('active');

    socket.send(JSON.stringify({
      type: 'host.event',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: enrolled.hostId,
      instanceId,
      events: [{
        threadId: spawned.value.id,
        kind: 'thread.event',
        payload: {
          type: 'turn/started',
          threadId: spawned.value.id,
          scope: { kind: 'turn', turnId: 'turn-live' },
          providerThreadId: 'prov-live'
        }
      }]
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const restarted = randomUUID();
    await openHostSocket(enrolled, restarted, defaultRpcHandler(projectRoot));
    await waitForThreadStatus(spawned.value.id, 'error');
    expect(listConversationThreadEvents(server!.ctx.db, spawned.value.id).map((event) => event.type)).toEqual(
      expect.arrayContaining(['turn/completed', 'system/error', 'system/thread/interrupted'])
    );
  });

  it('keeps a live conversation thread active when the same host instance reconnects', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);

    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['still running'] })
    }).then((response) => response.json()) as { value: { id: string } };
    expect(getConversationThread(server!.ctx.db, spawned.value.id)?.status).toBe('active');

    await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot), [spawned.value.id]);
    await waitForHost(enrolled.hostId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getConversationThread(server!.ctx.db, spawned.value.id)?.status).toBe('active');
  });

  it('enrolls the host-daemon runtime against the product hub', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken, dataDir } = await startServer(projectRoot);
    const { startEnrolledHostDaemon } = await import('@zana-ai/zcc-host-daemon/enroll-runtime');
    const daemon = await startEnrolledHostDaemon({
      dataDir,
      serverUrl: server!.url,
      token: enrollToken
    });
    try {
      await waitForHost(daemon.hostId);
      expect(server!.ctx.hostHub.connectedHostIds()).toContain(daemon.hostId);
      const listed = await fetch(`${server!.url}api/v1/hosts`).then((response) => response.json()) as Array<{
        id: string;
        status: string;
        lastSeenAt: number | null;
      }>;
      const row = listed.find((host) => host.id === daemon.hostId);
      expect(row?.status).toBe('connected');
      expect(row?.lastSeenAt).toEqual(expect.any(Number));
      expect(Date.now() - (row?.lastSeenAt ?? 0)).toBeLessThan(10_000);
    } finally {
      await daemon.close();
    }
  });

  it('registers a pending interaction over host-key HTTP and resolves it over host-rpc', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);

    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['approve me'] })
    }).then((response) => response.json()) as { value: { id: string; hostId: string } };

    const registered = await fetch(`${server!.url}internal/hosts/interactive-request`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${enrolled.hostKey}`,
        'content-type': 'application/json',
        'x-zcc-host-id': enrolled.hostId
      },
      body: JSON.stringify({
        sessionId: instanceId,
        interaction: {
          threadId: spawned.value.id,
          turnId: 'turn-ask',
          providerId: 'claude-code',
          providerThreadId: `prov-${spawned.value.id}`,
          providerRequestId: 'req-1',
          payload: {
            kind: 'approval',
            reason: 'Needs approval',
            availableDecisions: ['allow_once', 'deny'],
            subject: {
              kind: 'command',
              itemId: 'item-1',
              command: 'git status',
              cwd: projectRoot,
              actions: [],
              sessionGrant: null
            }
          }
        }
      })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(registered.status).toBe(200);
    expect(registered.body.outcome).toBe('created');

    const listed = await fetch(`${server!.url}api/v1/threads/${spawned.value.id}/interactions`)
      .then((response) => response.json()) as Array<{ id: string; status: string }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe('pending');

    const queued = await fetch(`${server!.url}api/v1/threads/${spawned.value.id}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: ['follow up'], mode: 'auto' })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(queued.status).toBe(200);
    expect(queued.body.ok).toBe(true);

    const resolved = await fetch(`${server!.url}api/v1/threads/${spawned.value.id}/interactions/${listed[0]!.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'deny' })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('resolved');
  });

  it('rejects browser Origin and a mismatched host key on interactive-request', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);
    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['hi'] })
    }).then((response) => response.json()) as { value: { id: string } };

    await expect(
      fetch(`${server!.url}internal/hosts/interactive-request`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${enrolled.hostKey}`,
          'content-type': 'application/json',
          origin: 'http://localhost:5173',
          'x-zcc-host-id': enrolled.hostId
        },
        body: JSON.stringify({ sessionId: instanceId, interaction: { threadId: spawned.value.id } })
      }).then((response) => response.status)
    ).resolves.toBe(403);

    await expect(
      fetch(`${server!.url}internal/hosts/interactive-request`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer wrong-host-key-wrong-host-key',
          'content-type': 'application/json',
          'x-zcc-host-id': enrolled.hostId
        },
        body: JSON.stringify({ sessionId: instanceId, interaction: { threadId: spawned.value.id } })
      }).then((response) => response.status)
    ).resolves.toBe(401);

    const other = await enrollHost(enrollToken, 'beta', randomUUID());
    await expect(
      fetch(`${server!.url}internal/hosts/interactive-request`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${other.hostKey}`,
          'content-type': 'application/json',
          'x-zcc-host-id': other.hostId
        },
        body: JSON.stringify({
          sessionId: instanceId,
          interaction: {
            threadId: spawned.value.id,
            turnId: 'turn-ask',
            providerId: 'claude-code',
            providerThreadId: `prov-${spawned.value.id}`,
            providerRequestId: 'req-mismatch',
            payload: {
              kind: 'approval',
              reason: 'Needs approval',
              availableDecisions: ['deny'],
              subject: {
                kind: 'command',
                itemId: 'item-mismatch',
                command: 'git status',
                cwd: '/tmp',
                actions: [],
                sessionGrant: null
              }
            }
          }
        })
      }).then((response) => response.status)
    ).resolves.toBe(403);
  });

  it('does not interrupt a pending interaction on same-instance reconnect, and does on a new instance', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);
    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['hold'] })
    }).then((response) => response.json()) as { value: { id: string } };

    const payload = {
      sessionId: instanceId,
      interaction: {
        threadId: spawned.value.id,
        turnId: 'turn-ask',
        providerId: 'claude-code',
        providerThreadId: `prov-${spawned.value.id}`,
        providerRequestId: 'req-reconnect',
        payload: {
          kind: 'approval',
          reason: 'Needs approval',
          availableDecisions: ['deny'],
          subject: {
            kind: 'command',
            itemId: 'item-1',
            command: 'ls',
            cwd: projectRoot,
            actions: [],
            sessionGrant: null
          }
        }
      }
    };
    const created = await fetch(`${server!.url}internal/hosts/interactive-request`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${enrolled.hostKey}`,
        'content-type': 'application/json',
        'x-zcc-host-id': enrolled.hostId
      },
      body: JSON.stringify(payload)
    }).then((response) => response.json()) as { interactionId: string; outcome: string };
    expect(created.outcome).toBe('created');

    await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stillPending = await fetch(`${server!.url}api/v1/threads/${spawned.value.id}/interactions`)
      .then((response) => response.json()) as Array<{ status: string }>;
    expect(stillPending.map((row) => row.status)).toEqual(['pending']);

    const restarted = randomUUID();
    await openHostSocket(enrolled, restarted, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const listed = await fetch(`${server!.url}api/v1/threads/${spawned.value.id}/interactions`)
        .then((response) => response.json()) as unknown[];
      if (listed.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const afterRestart = await fetch(`${server!.url}api/v1/threads/${spawned.value.id}/interactions`)
      .then((response) => response.json()) as unknown[];
    expect(afterRestart).toEqual([]);
  });

  it('dispatches plugin tool calls over host-key HTTP', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-proj-'));
    const { enrollToken } = await startServer(projectRoot);
    const instanceId = randomUUID();
    const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
    await openHostSocket(enrolled, instanceId, defaultRpcHandler(projectRoot));
    await waitForHost(enrolled.hostId);

    const spawned = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['hello'] })
    }).then((response) => response.json()) as { value: { id: string; hostId: string } };

    server!.ctx.plugins = {
      invokeAgentTool: async ({ name, input, ctx }) => ({
        success: true,
        contentItems: [{
          type: 'inputText',
          text: JSON.stringify({ name, input, threadId: ctx.threadId, projectId: ctx.projectId })
        }]
      }),
      decideToolPolicy: async () => ({ action: 'allow' })
    } as ProductHttpContext['plugins'];

    const invoked = await fetch(`${server!.url}internal/hosts/tool-call`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${enrolled.hostKey}`,
        'content-type': 'application/json',
        'x-zcc-host-id': enrolled.hostId
      },
      body: JSON.stringify({
        sessionId: instanceId,
        threadId: spawned.value.id,
        providerThreadId: `prov-${spawned.value.id}`,
        turnId: 'turn-1',
        callId: 'call-1',
        tool: 'sf_soql',
        arguments: { query: 'SELECT Id FROM Account' }
      })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(invoked.status).toBe(200);
    expect(invoked.body.success).toBe(true);
    expect(invoked.body.contentItems[0].text).toContain('sf_soql');
    expect(invoked.body.contentItems[0].text).toContain(spawned.value.id);

    const rejected = await fetch(`${server!.url}internal/hosts/tool-call`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${enrolled.hostKey}`,
        'content-type': 'application/json',
        origin: 'http://localhost:5173',
        'x-zcc-host-id': enrolled.hostId
      },
      body: JSON.stringify({
        sessionId: instanceId,
        threadId: spawned.value.id,
        providerThreadId: 'prov-1',
        turnId: 'turn-1',
        callId: 'call-1',
        tool: 'sf_soql'
      })
    }).then((response) => response.status);
    expect(rejected).toBe(403);
  });
});

it('rejects pending RPCs on connection replacement and ignores late messages from the old socket', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-host-replace-'));
  const { enrollToken } = await startServer(projectRoot);
  const instanceId = randomUUID();
  const enrolled = await enrollHost(enrollToken, 'alpha', instanceId);
  await openHostSocket(enrolled, instanceId, () => {});
  await waitForHost(enrolled.hostId);
  const old = server!.ctx.hostHub.getSession(enrolled.hostId)!.socket;
  const pending = server!.ctx.hostHub.callHostOnlineRpc({ hostId: enrolled.hostId, command: { type: 'host.list_branches', workspacePath: projectRoot, workspaceProvisionType: 'unmanaged' } });
  const rejected = expect(pending).rejects.toThrow('disconnected');
  let request: HostRpcRequestMessage | undefined;
  let answer: ((ok: boolean, result?: unknown) => void) | undefined;
  await openHostSocket(enrolled, instanceId, (next, reply) => { request = next; answer = reply; });
  await expect.poll(() => server!.ctx.hostHub.getSession(enrolled.hostId)?.socket !== old).toBe(true);
  await rejected;
  const current = server!.ctx.hostHub.callHostOnlineRpc({ hostId: enrolled.hostId, command: { type: 'host.list_branches', workspacePath: projectRoot, workspaceProvisionType: 'unmanaged' } });
  await expect.poll(() => Boolean(request)).toBe(true);
  // Simulate already-buffered data being delivered after a replacement socket
  // has acquired this host identity; it must not settle the new request.
  old.emit('message', Buffer.from(JSON.stringify({ type: 'host-rpc.response', protocolVersion: HOST_RPC_PROTOCOL_VERSION, requestId: request!.requestId, commandType: 'host.list_branches', ok: true, result: { branches: ['forged-old'], truncated: false } })));
  answer!(true, { branches: ['current'], truncated: false });
  expect(await current).toEqual({ branches: ['current'], truncated: false });
});
