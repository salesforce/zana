import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConversationThread, createEnvironment, upsertHost } from '@zana-ai/zcc-db';
import { startProductServer, type ProductServer } from './product-server.js';

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
    expect(launch.status).toBe(503);
    await expect(launch.json()).resolves.toMatchObject({ ok: false, code: 'launch-unavailable' });

    const escaped = await fetch(`${server.url}api/v1/terminals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'proj-1', profile: 'claude', cwd: tmpdir() })
    });
    expect(escaped.status).toBe(403);
    await expect(escaped.json()).resolves.toMatchObject({ ok: false, code: 'cwd-escape' });

    const liveThreads = await fetch(`${server.url}api/v1/threads`).then((response) => response.json());
    expect(liveThreads).toEqual({ threads: [] });

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
});
