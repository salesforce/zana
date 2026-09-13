/**
 * Electron production-boundary: launch a CLI Agent via product HTTP
 * (POST /api/v1/cli-agents), not Playwright clicks, and assert working → idle.
 */
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });

test.use({
  e2e: true,
  launchEnv: { ZCC_SERVER_PORT: '8780' },
  initialConfig: { claudeBinary: agent.path, defaultHarness: 'claude' }
});

test.afterAll(() => agent.cleanup());

const PRODUCT_URL = 'http://127.0.0.1:8780';

async function waitForProduct(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${PRODUCT_URL}/api/v1/health`);
      if (response.ok) {
        const body = await response.json() as { ok?: boolean };
        if (body.ok === true) return;
      }
    } catch {
      /* still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('product HTTP did not become ready on 8780');
}

test('HTTP CLI Agent launch reaches idle without native confirm', async ({ app }) => {
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-cli-agent-http-'));
  try {
    const { window } = app;
    await expect(window.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 20_000 });
    await waitForProduct();
    const createdProject = await fetch(`${PRODUCT_URL}/api/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: projectDir })
    });
    expect(createdProject.ok).toBe(true);
    const projectBody = await createdProject.json() as { project: { id: string } };
    const launched = await fetch(`${PRODUCT_URL}/api/v1/cli-agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: projectBody.project.id,
        profile: 'claude',
        prompt: 'reply with PONG and stop',
        title: '[zcc-live:e2e] http launch'
      })
    });
    const body = await launched.json() as { session: { id: string; status: string }; message?: string };
    expect(launched.status, body.message ?? JSON.stringify(body)).toBe(201);
    expect(body.session.id).toBeTruthy();
    const deadline = Date.now() + 45_000;
    let status = body.session.status;
    while (Date.now() < deadline) {
      const shown = await fetch(`${PRODUCT_URL}/api/v1/cli-agents/${encodeURIComponent(body.session.id)}`);
      expect(shown.ok).toBe(true);
      const row = await shown.json() as { session: { status: string } };
      status = row.session.status;
      if (status === 'working') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(['working', 'idle', 'done']).toContain(status);
    while (Date.now() < deadline) {
      const shown = await fetch(`${PRODUCT_URL}/api/v1/cli-agents/${encodeURIComponent(body.session.id)}`);
      const row = await shown.json() as { session: { status: string } };
      status = row.session.status;
      if (status === 'idle' || status === 'done' || status === 'exited') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(['idle', 'done', 'exited']).toContain(status);
    await fetch(`${PRODUCT_URL}/api/v1/cli-agents/${encodeURIComponent(body.session.id)}/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
