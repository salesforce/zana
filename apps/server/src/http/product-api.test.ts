import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationThread, createEnvironment, updateConversationThreadStatus, upsertHost, appendConversationThreadEvent } from '@zana-ai/zcc-db';
import { turnScope } from '@zana-ai/zcc-domain/thread-runtime';
import { EMPTY_THREAD_ACTIVITY } from '@zana-ai/zcc-thread-view';
import { startProductServer, type ProductServer } from './product-server.js';
import { HostUnavailableError } from './host-hub.js';
import { registerThreadProvider } from '../services/threads/thread-provider-catalog.js';

let server: ProductServer | null = null;
const providerHandles: Array<{ unregister(): void }> = [];

function seedTestHostArtifact(product: ProductServer): ProductServer {
  product.ctx.pluginHostArtifacts.set('test', {
    path: '/tmp/host.js',
    digest: 'a'.repeat(64),
    byteLength: 12,
    generation: 'g1'
  });
  return product;
}

async function startTestProductServer(
  options: Parameters<typeof startProductServer>[0]
): Promise<ProductServer> {
  return seedTestHostArtifact(await startProductServer(options));
}

afterEach(async () => {
  await server?.close();
  server = null;
  for (const handle of providerHandles.splice(0)) handle.unregister();
});

describe('product HTTP', () => {
  it('serves health, Origin-guards browsers, and hydrates Home reads', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-http-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-product-project-'));
    writeFileSync(
      join(dataDir, 'projects.json'),
      JSON.stringify({
        version: 1,
        projects: [
          {
            id: 'proj-1',
            name: 'Alpha',
            path: projectRoot,
            createdAt: 1,
            lastActiveAt: 1
          }
        ]
      })
    );
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({ version: 1, theme: 'dark', followUpsEnabled: true })
    );
    mkdirSync(join(dataDir, 'inbox'), { recursive: true });
    writeFileSync(
      join(dataDir, 'inbox', 'entries.jsonl'),
      `${JSON.stringify({
        id: 'inb-1',
        projectId: 'proj-1',
        comments: 'hello',
        ts: 2
      })}\n`
    );
    mkdirSync(join(dataDir, 'followups'), { recursive: true });
    writeFileSync(
      join(dataDir, 'followups', 'fu-1.json'),
      JSON.stringify({
        id: 'fu-1',
        projectId: 'proj-1',
        title: 'Decide',
        status: 'open',
        kind: 'question',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
    );

    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    for (const id of ['claude-code', 'codex', 'pi', 'acp-cursor', 'acp-opencode'] as const) {
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
          composerActions: id === 'claude-code' ? ['plan'] : undefined
        })
      );
    }

    const health = await fetch(`${server.url}api/v1/health`);
    await expect(health.json()).resolves.toEqual({ ok: true });
    expect(health.headers.get('content-type')).toMatch(/application\/json/);

    await expect(
      fetch(`${server.url}api/v1/health`, { headers: { Origin: 'https://evil.example' } }).then(
        (response) => response.status
      )
    ).resolves.toBe(403);

    await expect(
      fetch(`${server.url}api/v1/health`).then((response) => response.status)
    ).resolves.toBe(200);

    const projects = await fetch(`${server.url}api/v1/projects`).then((response) => response.json());
    expect(projects.projects).toEqual([
      expect.objectContaining({ id: 'proj-1', name: 'Alpha' })
    ]);

    const config = await fetch(`${server.url}api/v1/config`).then((response) => response.json());
    expect(config.config.theme).toBe('dark');

    const inbox = await fetch(`${server.url}api/v1/inbox`).then((response) => response.json());
    expect(inbox.entries).toEqual([expect.objectContaining({ id: 'inb-1', comments: 'hello' })]);

    const followups = await fetch(`${server.url}api/v1/follow-ups`).then((response) =>
      response.json()
    );
    expect(followups.followups).toEqual([expect.objectContaining({ id: 'fu-1' })]);

    const patched = await fetch(`${server.url}api/v1/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ followUpsEnabled: false })
    }).then((response) => response.json());
    expect(patched.config.followUpsEnabled).toBe(false);

    const launch = await fetch(`${server.url}api/v1/terminals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', profile: 'claude' })
    });
    expect(launch.status).toBe(502);
    await expect(launch.json()).resolves.toMatchObject({ ok: false, code: 'host_disconnected' });

    const escaped = await fetch(`${server.url}api/v1/terminals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', profile: 'claude', cwd: tmpdir() })
    });
    expect(escaped.status).toBe(403);
    await expect(escaped.json()).resolves.toMatchObject({ ok: false, code: 'cwd-escape' });

    const listed = await fetch(`${server.url}api/v1/threads`).then((response) => response.json());
    expect(listed).toEqual({ threads: [] });

    const execution = await fetch(`${server.url}api/v1/system/execution-options?providerId=claude-code`);
    expect(execution.status).toBe(200);
    const options = await execution.json() as {
      providers: Array<{ id: string; composerActions?: string[] }>;
      models: Array<{ displayName: string; model: string }>;
      selectedOnlyModels?: Array<{ displayName: string; model: string }>;
    };
    expect(options.providers.map((row) => row.id)).toEqual(
      expect.arrayContaining(['claude-code', 'codex', 'pi', 'acp-cursor', 'acp-opencode'])
    );
    expect(options.providers.find((row) => row.id === 'claude-code')?.composerActions).toEqual(['plan']);
    expect(options.models.map((row) => row.displayName)).toEqual(expect.arrayContaining([
      'Fable 5',
      'Opus 5 (1M)',
      'Sonnet 5'
    ]));
    expect(options.selectedOnlyModels?.map((row) => row.displayName)).toEqual(expect.arrayContaining([
      'Opus Alias (1M, Current)',
      'Sonnet Alias (Legacy)',
      'Haiku Alias (Legacy)'
    ]));

    const providers = await fetch(`${server.url}api/v1/threads/providers`).then((response) => response.json());
    expect(providers.providers.map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining(['claude-code', 'codex', 'pi', 'acp-cursor', 'acp-opencode'])
    );

    const fromRenderer = await fetch(`${server.url}api/v1/threads`, {
      headers: { Origin: 'http://127.0.0.1:5173', 'x-zcc-app-surface': 'desktop' }
    });
    expect(fromRenderer.status).toBe(200);
    expect(fromRenderer.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');

    const preflight = await fetch(`${server.url}api/v1/threads`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-zcc-app-surface'
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
  });

  it('launches a terminal through a connected host and drives input/resize/close', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-term-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-product-term-proj-'));
    writeFileSync(
      join(dataDir, 'projects.json'),
      JSON.stringify({
        version: 1,
        projects: [
          {
            id: 'proj-1',
            name: 'Alpha',
            path: projectRoot,
            createdAt: 1,
            lastActiveAt: 1
          }
        ]
      })
    );
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ version: 1, theme: 'dark' }));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });

    const rpc = vi.fn(async (input: { command: { type: string; sessionId?: string } }) => {
      if (input.command.type === 'terminal.start') {
        return { sessionId: input.command.sessionId, started: true, pid: 4242 };
      }
      return { accepted: true };
    });
    server.ctx.hostHub.connectedHostIds = () => ['host-1'];
    server.ctx.hostHub.resolveHostId = () => 'host-1';
    server.ctx.hostHub.callHostOnlineRpc = rpc;

    const launch = await fetch(`${server.url}api/v1/terminals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', profile: 'shell', command: 'npm run dev' })
    });
    expect(launch.status).toBe(201);
    const created = await launch.json() as {
      ok: true;
      value: { id: string; status: string; pid?: number; title?: string; launchCommand?: string };
    };
    expect(created).toMatchObject({
      ok: true,
      value: {
        projectId: 'proj-1',
        profile: 'shell',
        status: 'running',
        pid: 4242,
        title: 'npm run dev',
        launchCommand: 'npm run dev'
      }
    });
    expect(created.value).not.toHaveProperty('hostId');
    expect(created.value).not.toHaveProperty('outputText');
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
      hostId: 'host-1',
      command: expect.objectContaining({
        type: 'terminal.start',
        root: realpathSync(projectRoot),
        cwd: realpathSync(projectRoot),
        command: 'npm run dev'
      })
    }));

    const shown = await fetch(`${server.url}api/v1/terminals/${created.value.id}`).then((response) => response.json());
    expect(shown.session.id).toBe(created.value.id);
    expect(shown.session.launchCommand).toBe('npm run dev');

    const record = server.ctx.terminalSessions.get(created.value.id);
    if (record) {
      record.outputText = 'Local: http://localhost:5173\n';
      record.outputTruncated = false;
    }
    const output = await fetch(`${server.url}api/v1/terminals/${created.value.id}/output`).then((response) => response.json());
    expect(output).toEqual({ text: 'Local: http://localhost:5173\n', truncated: false });

    const listed = await fetch(`${server.url}api/v1/terminals`).then((response) => response.json());
    expect(listed.sessions).toHaveLength(1);
    expect(listed.sessions[0].id).toBe(created.value.id);

    const input = await fetch(`${server.url}api/v1/terminals/${created.value.id}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: 'ls\n' })
    });
    expect(input.status).toBe(200);
    const resize = await fetch(`${server.url}api/v1/terminals/${created.value.id}/resize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cols: 120, rows: 40 })
    });
    expect(resize.status).toBe(200);
    const closed = await fetch(`${server.url}api/v1/terminals/${created.value.id}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(closed.status).toBe(200);
    expect(rpc.mock.calls.map((call) => call[0].command.type)).toEqual([
      'terminal.start',
      'terminal.input',
      'terminal.resize',
      'terminal.stop'
    ]);

    const missing = await fetch(`${server.url}api/v1/terminals/missing-session/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: 'x' })
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ ok: false, code: 'unknown-session' });

    const badInput = await fetch(`${server.url}api/v1/terminals/${created.value.id}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(badInput.status).toBe(400);
    await expect(badInput.json()).resolves.toMatchObject({ ok: false, code: 'invalid-input' });
  });

  it('returns 410 for PTY I/O on the Thread API', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-output-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const host = upsertHost(server.ctx.db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const thread = createConversationThread(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code'
    });
    const output = await fetch(`${server.url}api/v1/threads/${thread.id}/output`);
    expect(output.status).toBe(410);
    const resize = await fetch(`${server.url}api/v1/threads/${thread.id}/resize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cols: 80, rows: 24 })
    });
    expect(resize.status).toBe(410);
    const input = await fetch(`${server.url}api/v1/threads/${thread.id}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: 'x' })
    });
    expect(input.status).toBe(410);
    const timelineResponse = await fetch(`${server.url}api/v1/threads/${thread.id}/timeline`);
    expect(timelineResponse.status).toBe(200);
    const timeline = await timelineResponse.json();
    expect(timeline.threadId).toBe(thread.id);
    expect(timeline.rows).toEqual([]);
    expect(timeline).not.toHaveProperty('events');
    const outlineResponse = await fetch(`${server.url}api/v1/threads/${thread.id}/conversation-outline`);
    expect(outlineResponse.status).toBe(200);
    await expect(outlineResponse.json()).resolves.toMatchObject({ items: [], maxSeq: 0 });
    expect(timeline).toMatchObject({
      activeThinking: null,
      pendingTodos: null,
      goal: null,
      activePromptMode: null,
      activeWorkflows: []
    });
  });

  it('includes idle conversation threads in the unscoped list', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-threads-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const host = upsertHost(server.ctx.db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const thread = createConversationThread(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      title: 'Idle work'
    });
    updateConversationThreadStatus(server.ctx.db, thread.id, 'idle');
    const body = await fetch(`${server.url}api/v1/threads`).then((response) => response.json()) as {
      threads: Array<{ id: string; status: string; lastReadSeq: number | null; maxSeq: number }>;
    };
    expect(body.threads).toEqual([
      expect.objectContaining({
        id: thread.id,
        status: 'idle',
        lastReadSeq: null,
        maxSeq: 0,
        activity: EMPTY_THREAD_ACTIVITY
      })
    ]);
  });

  it('projects running background bash onto thread list activity', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-thread-activity-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const host = upsertHost(server.ctx.db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const thread = createConversationThread(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      title: 'Dev server'
    });
    updateConversationThreadStatus(server.ctx.db, thread.id, 'idle');
    appendConversationThreadEvent(server.ctx.db, {
      threadId: thread.id,
      type: 'item/started',
      payload: {
        type: 'item/started',
        threadId: thread.id,
        providerThreadId: 'provider-1',
        scope: turnScope('turn-1'),
        item: {
          type: 'backgroundTask',
          id: 'task:bash-1',
          taskType: 'local_bash',
          description: 'npm run dev',
          status: 'pending',
          taskStatus: 'running',
          skipTranscript: false
        }
      }
    });
    const body = await fetch(`${server.url}api/v1/threads`).then((response) => response.json()) as {
      threads: Array<{ id: string; activity: { activeBackgroundCommandCount: number } }>;
    };
    expect(body.threads).toEqual([
      expect.objectContaining({
        id: thread.id,
        activity: expect.objectContaining({ activeBackgroundCommandCount: 1 })
      })
    ]);
    const shown = await fetch(`${server.url}api/v1/threads/${thread.id}`).then((response) => response.json()) as {
      thread: { activity: { activeBackgroundCommandCount: number } };
    };
    expect(shown.thread.activity.activeBackgroundCommandCount).toBe(1);
  });

  it('lists lastReadSeq and maxSeq and emits threads:updated on read', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-thread-reads-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const host = upsertHost(server.ctx.db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const thread = createConversationThread(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      title: 'Reads'
    });
    appendConversationThreadEvent(server.ctx.db, { threadId: thread.id, type: 'turn/started' });
    appendConversationThreadEvent(server.ctx.db, { threadId: thread.id, type: 'turn/completed' });

    const listed = await fetch(`${server.url}api/v1/threads`).then((response) => response.json()) as {
      threads: Array<{ id: string; lastReadSeq: number | null; maxSeq: number }>;
    };
    expect(listed.threads).toEqual([
      expect.objectContaining({ id: thread.id, lastReadSeq: null, maxSeq: 2 })
    ]);

    const emit = vi.spyOn(server.ctx.hub, 'emit');
    const read = await fetch(`${server.url}api/v1/threads/${thread.id}/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toMatchObject({ thread: { id: thread.id, lastReadSeq: 2, maxSeq: 2 } });
    expect(emit).toHaveBeenCalledWith('threads:updated', expect.objectContaining({
      id: thread.id,
      lastReadSeq: 2,
      maxSeq: 2
    }));

    const afterRead = await fetch(`${server.url}api/v1/threads`).then((response) => response.json()) as {
      threads: Array<{ id: string; lastReadSeq: number | null; maxSeq: number }>;
    };
    expect(afterRead.threads).toEqual([
      expect.objectContaining({ id: thread.id, lastReadSeq: 2, maxSeq: 2 })
    ]);
  });

  it('renames a thread and marks it unread', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-thread-header-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const host = upsertHost(server.ctx.db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const thread = createConversationThread(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code',
      title: 'Hello'
    });

    const reserve = vi.spyOn(server.ctx.threadTitleNamer, 'reserve');
    const renamed = await fetch(`${server.url}api/v1/threads/${thread.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '  Hello 2  ' })
    });
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({ thread: { id: thread.id, title: 'Hello 2' } });
    expect(reserve).toHaveBeenCalledWith(thread.id);

    const blank = await fetch(`${server.url}api/v1/threads/${thread.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '   ' })
    });
    expect(blank.status).toBe(400);

    const emit = vi.spyOn(server.ctx.hub, 'emit');
    const unread = await fetch(`${server.url}api/v1/threads/${thread.id}/unread`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(unread.status).toBe(200);
    await expect(unread.json()).resolves.toMatchObject({ thread: { id: thread.id, lastReadSeq: 0 } });
    expect(emit).toHaveBeenCalledWith('threads:updated', expect.objectContaining({
      id: thread.id,
      lastReadSeq: 0
    }));

    const missingRename = await fetch(`${server.url}api/v1/threads/missing/`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Nope' })
    });
    expect(missingRename.status).toBe(404);

    const missingUnread = await fetch(`${server.url}api/v1/threads/missing/unread`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(missingUnread.status).toBe(404);
  });

  it('rejects explorer list-dir outside a registered project', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-fs-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-product-fs-proj-'));
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
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const escaped = await fetch(`${server.url}api/v1/fs/list-dir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/etc' })
    });
    expect(escaped.status).toBe(403);
    await expect(escaped.json()).resolves.toMatchObject({ code: 'path-escape' });

    const unknownPaths = await fetch(`${server.url}api/v1/projects/missing/paths`);
    expect(unknownPaths.status).toBe(404);
    await expect(unknownPaths.json()).resolves.toMatchObject({ code: 'unknown-project' });
  });

  it('forwards host file mutations through Host-RPC with defaults', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-files-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const rpc = vi.fn(async (input: { command: { type: string } }) => {
      if (input.command.type === 'host.write_file') {
        return { outcome: 'conflict', currentSha256: 'b'.repeat(64) };
      }
      if (input.command.type === 'host.read_path') {
        return {
          path: '/tmp/note.md',
          content: 'hello',
          contentEncoding: 'utf8',
          sizeBytes: 5,
          sha256: 'a'.repeat(64)
        };
      }
      if (input.command.type === 'host.list_paths') {
        return { paths: [], truncated: false };
      }
      return { ok: true };
    });
    server.ctx.hostHub.resolveHostId = () => 'host-1';
    server.ctx.hostHub.callHostOnlineRpc = rpc;

    const written = await fetch(`${server.url}api/v1/files/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/note.md', content: 'hello' })
    });
    expect(written.status).toBe(200);
    await expect(written.json()).resolves.toEqual({
      outcome: 'conflict',
      currentSha256: 'b'.repeat(64)
    });

    const mkdir = await fetch(`${server.url}api/v1/files/mkdir`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/dir' })
    });
    expect(mkdir.status).toBe(200);

    const listed = await fetch(`${server.url}api/v1/files/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp' })
    });
    expect(listed.status).toBe(200);

    const paths = await fetch(`${server.url}api/v1/files/paths`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp', includeFiles: true, includeDirectories: true })
    });
    expect(paths.status).toBe(200);

    const read = await fetch(`${server.url}api/v1/files/read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/tmp/note.md' })
    });
    expect(read.status).toBe(200);

    const invalid = await fetch(`${server.url}api/v1/files/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'missing path' })
    });
    expect(invalid.status).toBe(400);

    expect(rpc.mock.calls.map((call) => call[0].command.type)).toEqual([
      'host.write_file',
      'host.mkdir',
      'host.list_paths',
      'host.list_paths',
      'host.read_path'
    ]);
    expect(rpc.mock.calls[0]?.[0].command).toMatchObject({
      contentEncoding: 'utf8',
      createParents: false
    });
  });

  it('renames a Codex thread on the live host after the product title write', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-codex-rename-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    providerHandles.push(
      registerThreadProvider('test', {
        id: 'codex',
        displayName: 'Codex',
        capabilities: {
          supportsServiceTier: false,
          fork: 'checkpoint',
          supportsThreadArchive: true,
          supportsThreadRename: true,
          permissionModes: ['full']
        }
      })
    );
    const host = upsertHost(server.ctx.db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj'
    });
    const thread = createConversationThread(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'codex',
      title: 'Hello'
    });
    const rpc = vi.fn(async () => ({ threadId: thread.id, renamed: true }));
    server.ctx.hostHub.callHostOnlineRpc = rpc;

    const renamed = await fetch(`${server.url}api/v1/threads/${thread.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hello 2' })
    });
    expect(renamed.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith({
      hostId: host.id,
      command: {
        type: 'thread.rename',
        threadId: thread.id,
        environmentId: environment.id,
        title: 'Hello 2'
      }
    });
  });

  it('persists workspace order from POST /api/v1/projects/reorder', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-reorder-'));
    const projectA = mkdtempSync(join(tmpdir(), 'zcc-product-reorder-a-'));
    const projectB = mkdtempSync(join(tmpdir(), 'zcc-product-reorder-b-'));
    writeFileSync(
      join(dataDir, 'projects.json'),
      JSON.stringify({
        version: 1,
        projects: [
          { id: 'proj-a', name: 'Alpha', path: projectA, createdAt: 1, lastActiveAt: 1 },
          { id: 'proj-b', name: 'Beta', path: projectB, createdAt: 2, lastActiveAt: 2 }
        ]
      })
    );
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({ version: 1, theme: 'dark', followUpsEnabled: true })
    );
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });

    const listed = await fetch(`${server.url}api/v1/projects`).then((response) => response.json());
    expect(listed.projects.map((project: { id: string }) => project.id)).toEqual(['proj-a', 'proj-b']);

    const reordered = await fetch(`${server.url}api/v1/projects/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedIds: ['proj-b', 'proj-a'] })
    });
    expect(reordered.status).toBe(200);
    const body = await reordered.json() as { projects: Array<{ id: string; sortIndex?: number }> };
    expect(body.projects.map((project) => project.id)).toEqual(['proj-b', 'proj-a']);
    expect(body.projects.map((project) => project.sortIndex)).toEqual([0, 1]);

    const again = await fetch(`${server.url}api/v1/projects`).then((response) => response.json());
    expect(again.projects.map((project: { id: string }) => project.id)).toEqual(['proj-b', 'proj-a']);
  });

  it('stores and serves composer image attachments', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-attach-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-product-attach-proj-'));
    writeFileSync(
      join(dataDir, 'projects.json'),
      JSON.stringify({
        version: 1,
        projects: [{ id: 'proj-1', name: 'Alpha', path: projectRoot, createdAt: 1, lastActiveAt: 1 }]
      })
    );
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ version: 1, theme: 'dark' }));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });

    const form = new FormData();
    form.set('file', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'shot.png');
    const uploaded = await fetch(`${server.url}api/v1/projects/proj-1/attachments`, {
      method: 'POST',
      body: form
    });
    expect(uploaded.status).toBe(201);
    const body = await uploaded.json() as { type: string; path: string; name: string };
    expect(body).toMatchObject({ type: 'localImage', name: 'shot.png' });

    const content = await fetch(
      `${server.url}api/v1/projects/proj-1/attachments/content?path=${encodeURIComponent(body.path)}`
    );
    expect(content.status).toBe(200);
    expect(content.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await content.arrayBuffer());
    expect([...bytes]).toEqual([137, 80, 78, 71]);

    const escaped = await fetch(
      `${server.url}api/v1/projects/proj-1/attachments/content?path=${encodeURIComponent('../secret.png')}`
    );
    expect(escaped.status).toBe(400);

    const missingPath = await fetch(`${server.url}api/v1/projects/proj-1/attachments/content`);
    expect(missingPath.status).toBe(400);

    const unknownGet = await fetch(`${server.url}api/v1/projects/missing/attachments/content?path=shot.png`);
    expect(unknownGet.status).toBe(404);

    const unknownForm = new FormData();
    unknownForm.set('file', new Blob([new Uint8Array([1])], { type: 'image/png' }), 'shot.png');
    const unknownProject = await fetch(`${server.url}api/v1/projects/missing/attachments`, {
      method: 'POST',
      body: unknownForm
    });
    expect(unknownProject.status).toBe(404);

    const jsonRejected = await fetch(`${server.url}api/v1/projects/proj-1/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(jsonRejected.status).toBe(415);

    const missingFile = new FormData();
    missingFile.set('prompt', 'hello');
    const missing = await fetch(`${server.url}api/v1/projects/proj-1/attachments`, {
      method: 'POST',
      body: missingFile
    });
    expect(missing.status).toBe(400);
  });

  it('transcribes voice over multipart when a host is connected', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-voice-'));
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ version: 1, projects: [] }));
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ version: 1, theme: 'dark' }));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });

    const disabled = await fetch(`${server.url}api/v1/system/voice-status`).then((response) => response.json());
    expect(disabled).toEqual({ enabled: false });

    const rpc = vi.fn(async () => ({ model: 'gpt-transcribe', text: 'hello from voice' }));
    server.ctx.hostHub.connectedHostIds = () => ['host-1'];
    server.ctx.hostHub.resolveHostId = () => 'host-1';
    server.ctx.hostHub.callHostOnlineRpc = rpc;

    const enabled = await fetch(`${server.url}api/v1/system/voice-status`).then((response) => response.json());
    expect(enabled).toEqual({ enabled: true });

    const form = new FormData();
    form.set('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), 'recording.webm');
    const transcribed = await fetch(`${server.url}api/v1/system/voice-transcription`, {
      method: 'POST',
      body: form
    });
    expect(transcribed.status).toBe(200);
    await expect(transcribed.json()).resolves.toEqual({ text: 'hello from voice' });
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ type: 'codex.voice.transcribe' })
    }));

    const jsonRejected = await fetch(`${server.url}api/v1/system/voice-transcription`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    expect(jsonRejected.status).toBe(415);

    const missingFile = new FormData();
    missingFile.set('prompt', 'hello');
    const missing = await fetch(`${server.url}api/v1/system/voice-transcription`, {
      method: 'POST',
      body: missingFile
    });
    expect(missing.status).toBe(400);

    server.ctx.hostHub.callHostOnlineRpc = vi.fn(async () => {
      throw Object.assign(new Error('missing'), { code: 'codex_auth_missing' });
    });
    const formAuth = new FormData();
    formAuth.set('file', new Blob([new Uint8Array([1])], { type: 'audio/webm' }), 'recording.webm');
    const authMissing = await fetch(`${server.url}api/v1/system/voice-transcription`, {
      method: 'POST',
      body: formAuth
    });
    expect(authMissing.status).toBe(501);

    server.ctx.hostHub.connectedHostIds = () => [];
    server.ctx.hostHub.resolveHostId = () => {
      throw new HostUnavailableError();
    };
    const formDown = new FormData();
    formDown.set('file', new Blob([new Uint8Array([1])], { type: 'audio/webm' }), 'recording.webm');
    const down = await fetch(`${server.url}api/v1/system/voice-transcription`, {
      method: 'POST',
      body: formDown
    });
    expect(down.status).toBe(503);

    const originForm = new FormData();
    originForm.set('file', new Blob([new Uint8Array([1])], { type: 'audio/webm' }), 'recording.webm');
    const originDenied = await fetch(`${server.url}api/v1/system/voice-transcription`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      body: originForm
    });
    expect(originDenied.status).toBe(403);
  });

  it('serves environment diff file TOC and per-file patches', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-diff-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const host = upsertHost(server.ctx.db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: '/tmp/proj',
      status: 'ready'
    });
    const rpc = vi.fn(async (input: { command: { type: string; paths?: string[] } }) => {
      if (input.command.type === 'workspace.diffFiles') {
        return {
          files: [{
            path: 'src/a.ts',
            previousPath: null,
            statusLetter: 'M',
            additions: 2,
            deletions: 1,
            binary: false,
            origin: 'tracked'
          }],
          shortstat: '1 file changed, 2 insertions(+), 1 deletion(-)',
          mergeBaseRef: null,
          truncated: false
        };
      }
      if (input.command.type === 'workspace.diffPatch') {
        return {
          patches: (input.command.paths ?? ['src/a.ts']).map((path) => ({
            path,
            patch: `diff --git a/${path} b/${path}\n+ok\n`,
            truncated: false
          }))
        };
      }
      throw new Error(`unexpected command ${input.command.type}`);
    });
    server.ctx.hostHub.connectedHostIds = () => [host.id];
    server.ctx.hostHub.resolveHostId = () => host.id;
    server.ctx.hostHub.callHostOnlineRpc = rpc;

    const files = await fetch(`${server.url}api/v1/environments/${environment.id}/diff/files`);
    expect(files.status).toBe(200);
    const filesBody = await files.json() as {
      outcome: string;
      files: Array<{ path: string; changeKind: string; loadMode: string }>;
      initialPatches: Array<{ path: string }>;
    };
    expect(filesBody.outcome).toBe('available');
    expect(filesBody.files[0]).toMatchObject({ path: 'src/a.ts', changeKind: 'modified', loadMode: 'auto' });
    expect(filesBody.initialPatches[0]?.path).toBe('src/a.ts');
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ type: 'workspace.diffFiles' })
    }));

    const patch = await fetch(`${server.url}api/v1/environments/${environment.id}/diff/patch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: ['src/a.ts'] })
    });
    expect(patch.status).toBe(200);
    await expect(patch.json()).resolves.toMatchObject({
      outcome: 'available',
      patches: [{ path: 'src/a.ts', truncated: false }]
    });
  });
});

describe('product HTTP thread reasoning', () => {
  it('imports reasoningLevelSchema so create/send can parse the picker value', () => {
    const source = readFileSync(new URL('./product-api.ts', import.meta.url), 'utf8');
    expect(source).toContain("from '@zana-ai/zcc-domain/thread-runtime'");
    expect(source).toContain('reasoningLevelSchema');
    expect(source).toContain('parseReasoningLevel(body.reasoningLevel)');
    expect(source).toContain("routeParams(path, '/api/v1/threads/:id/plan/cancel')");
    expect(source).toContain('cancelConversationPlan');
  });
});

describe('product HTTP plugins', () => {
  it('lists contributions and dispatches plugin CLI and HTTP', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-plugins-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    server.ctx.plugins = {
      list: () => [{ id: 'hello' }],
      cliContributions: () => [{ pluginId: 'hello', name: 'hello', summary: 'Say hello', commands: [] }],
      runCliCommand: async (_id: string, argv: string[]) => ({
        exitCode: 0,
        stdout: `hello ${argv.join(' ')}\n`,
        stderr: ''
      }),
      dispatchHttp: async (_id: string, request: { path: string }) => ({
        json: { path: request.path }
      }),
      mentionProviders: () => [],
      snapshot: () => []
    } as never;

    const listed = await fetch(`${server.url}api/v1/plugins`);
    await expect(listed.json()).resolves.toEqual({ plugins: [{ id: 'hello' }] });

    const contributions = await fetch(`${server.url}api/v1/plugins/contributions`);
    await expect(contributions.json()).resolves.toEqual({
      cliCommands: [{ pluginId: 'hello', name: 'hello', summary: 'Say hello', commands: [] }],
      mentionProviders: [],
      themes: [],
      pluginSkills: []
    });

    const cli = await fetch(`${server.url}api/v1/plugins/hello/cli`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ argv: ['world'] })
    });
    await expect(cli.json()).resolves.toMatchObject({ exitCode: 0, stdout: 'hello world\n' });

    const http = await fetch(`${server.url}api/v1/plugins/hello/http/ping`);
    await expect(http.json()).resolves.toEqual({ path: '/ping' });
  });

  it('lists enabled plugin skills on contributions and the project command catalog', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-plugin-skills-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    server.ctx.plugins = {
      snapshot: () => [
        {
          id: 'salesforce',
          name: 'Salesforce',
          enabled: true,
          skillNames: ['salesforce-dx', 'salesforce-constitution'],
          themes: []
        },
        {
          id: 'off',
          name: 'Off',
          enabled: false,
          skillNames: ['hidden'],
          themes: []
        }
      ]
    } as never;

    const contributions = await fetch(`${server.url}api/v1/plugins/contributions`);
    await expect(contributions.json()).resolves.toMatchObject({
      pluginSkills: [{
        pluginId: 'salesforce',
        name: 'Salesforce',
        skillNames: ['salesforce-dx', 'salesforce-constitution']
      }]
    });

    const commands = await fetch(`${server.url}api/v1/projects/proj-1/commands`);
    const body = await commands.json() as { commands: Array<{ name: string; pluginId?: string; description?: string }> };
    expect(body.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: '/salesforce-dx',
        pluginId: 'salesforce',
        description: 'Salesforce'
      }),
      expect.objectContaining({
        name: '/salesforce-constitution',
        pluginId: 'salesforce',
        description: 'Salesforce'
      })
    ]));
    expect(body.commands.some((row) => row.name === '/hidden')).toBe(false);
  });

  it('lists redacted plugin-app snapshots and toggles enable/disable', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-plugin-apps-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const enabled = new Map<string, boolean>([['docs', true]]);
    const snapshotRow = {
      id: 'docs',
      name: 'Docs',
      description: 'library',
      icon: 'Library',
      enabled: true,
      provenance: 'builtin' as const,
      status: 'running' as const,
      appEntry: './app.js',
      appUrl: '/plugins/docs/app.js',
      npmResolvedVersion: null,
      gitResolvedCommit: null,
      source: 'builtin:docs',
      projectTab: { label: 'Library', global: true },
      skillNames: [],
      mcpServers: [],
      extra: {},
      themes: []
    };
    server.ctx.plugins = {
      list: () => [{ id: 'docs', rootDir: '/secret/plugins/docs' }],
      snapshot: () => [{ ...snapshotRow, enabled: enabled.get('docs') === true }],
      enable: async (id: string) => {
        if (!enabled.has(id)) throw new Error(`plugin not installed: ${id}`);
        enabled.set(id, true);
        return { id };
      },
      disable: async (id: string) => {
        if (!enabled.has(id)) throw new Error(`plugin not installed: ${id}`);
        enabled.set(id, false);
        return { id };
      }
    } as never;

    const listed = await fetch(`${server.url}api/v1/plugin-apps`);
    const body = await listed.json() as { apps: Array<{ id: string; source?: string; rootDir?: string }> };
    expect(body.apps).toEqual([
      {
        id: 'docs',
        name: 'Docs',
        description: 'library',
        icon: 'Library',
        enabled: true,
        provenance: 'builtin',
        status: 'running',
        appUrl: '/plugins/docs/app.js',
        projectTab: { label: 'Library', global: true },
        skillNames: [],
        mcpServers: []
      }
    ]);
    expect(body.apps[0]).not.toHaveProperty('rootDir');
    expect(body.apps[0]).not.toHaveProperty('source');

    const missingType = await fetch(`${server.url}api/v1/plugin-apps/docs/disable`, {
      method: 'POST'
    });
    expect(missingType.status).toBe(415);

    const disable = await fetch(`${server.url}api/v1/plugin-apps/docs/disable`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
    await expect(disable.json()).resolves.toEqual({ ok: true, value: true });
    const after = await fetch(`${server.url}api/v1/plugin-apps`);
    await expect(after.json()).resolves.toMatchObject({ apps: [{ id: 'docs', enabled: false }] });

    const missing = await fetch(`${server.url}api/v1/plugin-apps/missing/enable`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
    expect(missing.status).toBe(404);
  });

  it('removes a plugin app through POST /plugin-apps/:id/remove', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-plugin-remove-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const apps = new Map([['docs', true]]);
    server.ctx.plugins = {
      snapshot: () =>
        [...apps.keys()].map((id) => ({
          id,
          name: 'Docs',
          description: 'library',
          icon: 'Library',
          enabled: true,
          provenance: 'builtin',
          status: 'running',
          appUrl: '/plugins/docs/app.js'
        })),
      remove: async (id: string) => {
        if (!apps.has(id)) throw new Error(`plugin not installed: ${id}`);
        apps.delete(id);
      }
    } as never;

    const removed = await fetch(`${server.url}api/v1/plugin-apps/docs/remove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    await expect(removed.json()).resolves.toEqual({ ok: true, value: true });
    const after = await fetch(`${server.url}api/v1/plugin-apps`);
    await expect(after.json()).resolves.toEqual({ apps: [] });
  });

  it('calls plugin RPC and reads or writes settings', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-plugin-rpc-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const settings = {
      descriptors: { token: { type: 'string' as const, label: 'Token' } },
      values: { token: 'secret' as string | boolean | undefined }
    };
    server.ctx.plugins = {
      snapshot: () => [],
      callRpc: async (pluginId: string, method: string) => {
        if (pluginId !== 'pr-monitor') throw new Error(`unknown rpc ${pluginId}.${method}`);
        if (method === 'badge') return { count: 3 };
        throw new Error(`unknown rpc ${pluginId}.${method}`);
      },
      getSettings: (pluginId: string) => {
        if (pluginId !== 'pr-monitor') return { descriptors: {}, values: {} };
        return settings;
      },
      setSettings: async (pluginId: string, values: Record<string, string | boolean | undefined>) => {
        if (pluginId !== 'pr-monitor') throw new Error(`plugin not running: ${pluginId}`);
        settings.values = { ...settings.values, ...values };
      }
    } as never;

    const rpc = await fetch(`${server.url}api/v1/plugin-apps/pr-monitor/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'badge' })
    });
    await expect(rpc.json()).resolves.toEqual({ value: { count: 3 } });

    const missingMethod = await fetch(`${server.url}api/v1/plugin-apps/pr-monitor/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(missingMethod.status).toBe(400);

    const unknown = await fetch(`${server.url}api/v1/plugin-apps/missing/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'badge' })
    });
    expect(unknown.status).toBe(404);

    const listed = await fetch(`${server.url}api/v1/plugin-apps/pr-monitor/settings`);
    await expect(listed.json()).resolves.toEqual(settings);

    const written = await fetch(`${server.url}api/v1/plugin-apps/pr-monitor/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { token: 'next' } })
    });
    await expect(written.json()).resolves.toMatchObject({ values: { token: 'next' } });

    const invalid = await fetch(`${server.url}api/v1/plugin-apps/pr-monitor/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { token: 1 } })
    });
    expect(invalid.status).toBe(400);

    const missingValues = await fetch(`${server.url}api/v1/plugin-apps/pr-monitor/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(missingValues.status).toBe(400);

    const notRunning = await fetch(`${server.url}api/v1/plugin-apps/missing/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { token: 'x' } })
    });
    expect(notRunning.status).toBe(404);

    server.ctx.plugins = undefined;
    const unavailable = await fetch(`${server.url}api/v1/plugin-apps/pr-monitor/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'badge' })
    });
    expect(unavailable.status).toBe(503);
    expect((await fetch(`${server.url}api/v1/plugin-apps/pr-monitor/settings`)).status).toBe(503);
    expect(
      (
        await fetch(`${server.url}api/v1/plugin-apps/pr-monitor/settings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ values: {} })
        })
      ).status
    ).toBe(503);
  });

  it('checks catalog plugin updates and applies them', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-plugin-updates-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const updates = [
      { id: 'docs', current: '1.0.0', available: '1.1.0', marketplace: 'official' }
    ];
    const applied: string[] = [];
    server.ctx.plugins = {
      snapshot: () => [],
      checkUpdates: async () => updates,
      applyUpdate: async (id: string) => {
        if (id !== 'docs') throw new Error(`plugin not installed: ${id}`);
        applied.push(id);
        return { id };
      }
    } as never;

    const listed = await fetch(`${server.url}api/v1/plugin-apps/updates`);
    await expect(listed.json()).resolves.toEqual({ updates });

    const apply = await fetch(`${server.url}api/v1/plugin-apps/docs/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
    await expect(apply.json()).resolves.toEqual({ ok: true, value: true });
    expect(applied).toEqual(['docs']);

    const missing = await fetch(`${server.url}api/v1/plugin-apps/missing/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    });
    expect(missing.status).toBe(404);
  });

  it('adds, lists, refreshes, and removes marketplace catalogs', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-mp-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const catalogs: Array<{
      source: string;
      sourceKind: 'https' | 'git' | 'path';
      name: string;
      displayName: string;
      addedAt: number;
      entryCount: number;
      lastRefreshAt: number | null;
      lastAttemptAt: number | null;
      lastError: string | null;
      official: boolean;
    }> = [];
    server.ctx.plugins = {
      listMarketplaces: () => catalogs,
      addMarketplace: async (source: string) => {
        const row = {
          source,
          sourceKind: 'https' as const,
          name: 'community',
          displayName: 'Community',
          addedAt: 1,
          entryCount: 2,
          lastRefreshAt: 1,
          lastAttemptAt: 1,
          lastError: null,
          official: false
        };
        catalogs.splice(0, catalogs.length, row);
        return row;
      },
      refreshMarketplace: async (source: string) => {
        const row = catalogs.find((item) => item.source === source);
        if (!row) throw new Error('missing');
        return { ...row, lastRefreshAt: 2, lastAttemptAt: 2 };
      },
      removeMarketplace: async (source: string) => {
        const index = catalogs.findIndex((item) => item.source === source);
        if (index < 0) return false;
        catalogs.splice(index, 1);
        return true;
      }
    } as never;

    const created = await fetch(`${server.url}api/v1/marketplaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'https://example.test/mp.json' })
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      source: 'https://example.test/mp.json',
      entryCount: 2
    });

    const listed = await fetch(`${server.url}api/v1/marketplaces`);
    await expect(listed.json()).resolves.toEqual({
      catalogs: [expect.objectContaining({ source: 'https://example.test/mp.json' })]
    });

    const refreshed = await fetch(`${server.url}api/v1/marketplaces/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'https://example.test/mp.json' })
    });
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({ lastRefreshAt: 2 });

    const removed = await fetch(`${server.url}api/v1/marketplaces/remove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'https://example.test/mp.json' })
    });
    expect(removed.status).toBe(200);
    await expect(fetch(`${server.url}api/v1/marketplaces`).then((r) => r.json())).resolves.toEqual({
      catalogs: []
    });
  });
});

describe('product HTTP CLI skills', () => {
  it('lists empty status and requires hostIds on install', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-cli-skills-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const listed = await fetch(`${server.url}api/v1/system/cli-skills`);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({ machines: [] });

    const missing = await fetch(`${server.url}api/v1/system/cli-skills/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    expect(missing.status).toBe(400);
  });
});

describe('product HTTP pending interactions', () => {
  it('returns 404 for interactions on an unknown thread', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-pint-'));
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    await expect(
      fetch(`${server.url}api/v1/threads/missing-thread/interactions`).then((response) => response.status)
    ).resolves.toBe(404);
  });
});

describe('product HTTP thread file preview', () => {
  it('confines a workspace file, rejects escapes, and opens a PTY panel owner', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-preview-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'zcc-product-preview-proj-'));
    writeFileSync(
      join(dataDir, 'projects.json'),
      JSON.stringify({
        version: 1,
        projects: [
          {
            id: 'proj-1',
            name: 'Alpha',
            path: projectRoot,
            createdAt: 1,
            lastActiveAt: 1
          }
        ]
      })
    );
    server = await startTestProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });
    const host = upsertHost(server.ctx.db, { name: 'laptop', hostKeyHash: 'h'.repeat(64) });
    const environment = createEnvironment(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      path: projectRoot
    });
    const thread = createConversationThread(server.ctx.db, {
      projectId: 'proj-1',
      hostId: host.id,
      environmentId: environment.id,
      providerId: 'claude-code'
    });

    const emitted: unknown[] = [];
    const orig = server.ctx.hub.emit.bind(server.ctx.hub);
    vi.spyOn(server.ctx.hub, 'emit').mockImplementation((type, payload) => {
      if (type === 'threads:open') emitted.push(payload);
      orig(type, payload);
    });

    const opened = await fetch(`${server.url}api/v1/threads/${thread.id}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: { source: 'workspace', path: 'src/a.ts', lineNumber: 4 }
      })
    });
    expect(opened.status).toBe(200);
    await expect(opened.json()).resolves.toMatchObject({
      path: 'src/a.ts',
      source: 'workspace'
    });
    expect(emitted[0]).toMatchObject({
      type: 'thread-open',
      threadId: thread.id,
      projectId: 'proj-1',
      split: 'right',
      file: { source: 'workspace', path: 'src/a.ts', lineNumber: 4 }
    });

    const escaped = await fetch(`${server.url}api/v1/threads/${thread.id}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: { source: 'workspace', path: '../secret.txt' }
      })
    });
    expect(escaped.status).toBe(403);
    await expect(escaped.json()).resolves.toMatchObject({ ok: false, code: 'path-escape' });

    const missing = await fetch(`${server.url}api/v1/threads/missing/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: { source: 'workspace', path: 'src/a.ts' }
      })
    });
    expect(missing.status).toBe(404);

    const pty = await fetch(`${server.url}api/v1/threads/sess-pty/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: 'proj-1',
        file: { source: 'workspace', path: 'README.md' }
      })
    });
    expect(pty.status).toBe(200);
    await expect(pty.json()).resolves.toMatchObject({
      path: 'README.md',
      source: 'workspace'
    });
    expect(emitted.at(-1)).toMatchObject({
      type: 'thread-open',
      threadId: 'sess-pty',
      projectId: 'proj-1',
      file: { source: 'workspace', path: 'README.md', lineNumber: null }
    });
  });
});
