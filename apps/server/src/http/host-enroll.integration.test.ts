import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  HOST_RPC_PROTOCOL_VERSION,
  type HostRpcRequestMessage
} from '@zana-ai/zcc-contracts/host-rpc';
import { listThreadEvents } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';

let server: ProductServer | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets) socket.close();
  sockets.length = 0;
  await server?.close();
  server = null;
});

async function startServer(projectRoot: string, enrollToken = 'enroll-token-enroll-token-enroll') {
  const dataDir = mkdtempSync(join(tmpdir(), 'zcc-host-hub-'));
  writeFileSync(
    join(dataDir, 'projects.json'),
    JSON.stringify({
      version: 1,
      projects: [{
        id: 'proj-1',
        name: 'Alpha',
        path: projectRoot,
        createdAt: 1,
        lastActiveAt: 1
      }]
    })
  );
  server = await startProductServer({
    dataDir,
    enrollToken,
    origins: { serverPort: 0, devAppPort: 5173 }
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
  handle: (request: HostRpcRequestMessage, reply: (ok: boolean, result?: unknown, error?: { code: string; message: string }) => void) => void
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
        reply(true, { threadId: request.command.threadId, started: true });
        return;
      case 'thread.resize':
        reply(true, { threadId: request.command.threadId, resized: true });
        return;
      case 'environment.destroy':
        reply(true, { environmentId: request.command.environmentId, destroyed: true });
        return;
      case 'host.list_branches':
        reply(true, { branches: ['main'], truncated: false });
        return;
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
      case 'host.read_file':
        reply(true, { content: '# hello\n', encoding: 'utf8' });
        return;
      default:
        reply(false, undefined, { code: 'unknown_command', message: request.command.type });
    }
  };
}

describe('host enroll hub and thread create', () => {
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

  it('creates a thread after enroll and rejects a second host without an explicit hostId', async () => {
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

    const resized = await fetch(`${server!.url}api/v1/threads/${spawned.body.value.id}/resize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cols: 120, rows: 40 })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(resized.status).toBe(200);
    expect(resized.body).toMatchObject({ ok: true, cols: 120, rows: 40 });

    const hostB = await enrollHost(enrollToken, 'beta', instanceB);
    await openHostSocket(hostB, instanceB, defaultRpcHandler(projectRoot));
    await waitForHost(hostB.hostId);

    const ambiguous = await fetch(`${server!.url}api/v1/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', providerId: 'claude', input: ['two hosts'] })
    }).then(async (response) => ({ status: response.status, body: await response.json() }));
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.code).toBe('ambiguous-host');
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

    socket.send(JSON.stringify({
      type: 'host.event',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: enrolled.hostId,
      instanceId,
      events: [{ threadId: spawned.value.id, kind: 'thread.started' }]
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const first = listThreadEvents(server!.ctx.db, spawned.value.id);
    expect(first.map((event) => event.sequence)).toEqual([1]);

    socket.send(JSON.stringify({
      type: 'host.event',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      hostId: enrolled.hostId,
      instanceId: randomUUID(),
      events: [{ threadId: spawned.value.id, kind: 'turn.completed' }]
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listThreadEvents(server!.ctx.db, spawned.value.id).map((event) => event.sequence)).toEqual([1]);
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
      expect(server!.ctx.hostHub.connectedHostIds()).toContain(daemon.hostId);
    } finally {
      await daemon.close();
    }
  });
});
