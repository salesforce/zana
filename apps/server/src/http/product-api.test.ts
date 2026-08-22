import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
  });
});
