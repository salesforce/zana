import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConversationThread, createEnvironment, updateConversationThreadStatus, upsertHost } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';
import { HostUnavailableError } from './host-hub.js';

let server: ProductServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
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

    server = await startProductServer({
      dataDir,
      origins: { serverPort: 0, devAppPort: 5173 }
    });

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
      expect.arrayContaining(['claude-code', 'codex', 'pi', 'acp-cursor'])
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
      expect.arrayContaining(['claude-code', 'codex', 'pi', 'acp-cursor'])
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
    server = await startProductServer({
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
      body: JSON.stringify({ projectId: 'proj-1', profile: 'claude' })
    });
    expect(launch.status).toBe(201);
    const created = await launch.json() as { ok: true; value: { id: string; status: string; pid?: number } };
    expect(created).toMatchObject({
      ok: true,
      value: { projectId: 'proj-1', profile: 'claude', status: 'running', pid: 4242 }
    });
    expect(created.value).not.toHaveProperty('hostId');
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
      hostId: 'host-1',
      command: expect.objectContaining({
        type: 'terminal.start',
        root: realpathSync(projectRoot),
        cwd: realpathSync(projectRoot)
      })
    }));

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
    server = await startProductServer({
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
    const timeline = await fetch(`${server.url}api/v1/threads/${thread.id}/timeline`).then((response) => response.json());
    expect(timeline.threadId).toBe(thread.id);
    expect(timeline.rows).toEqual([]);
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
    server = await startProductServer({
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
      threads: Array<{ id: string; status: string }>;
    };
    expect(body.threads).toEqual([expect.objectContaining({ id: thread.id, status: 'idle' })]);
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
    server = await startProductServer({
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
    server = await startProductServer({
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

  it('transcribes voice over multipart when a host is connected', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-product-voice-'));
    writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ version: 1, projects: [] }));
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ version: 1, theme: 'dark' }));
    server = await startProductServer({
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
    server = await startProductServer({
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
  });
});
