/**
 * Built-Electron production boundary for durable Workflows:
 * install the official plugin, run a named script that fans out hidden fake
 * workers, then assert composer banner / side panel / resume cache / stop.
 *
 * No live model: `ZCC_FAKE_PROVIDER=1` plus `delay:N` tokens in agent prompts.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({
  e2e: true,
  launchEnv: { ZCC_FAKE_PROVIDER: '1' }
});

test.setTimeout(180_000);

const ORCHESTRATION_SOURCE = `export const meta = {
  name: "e2e-orchestration",
  description: "Fan-out then combine with fake workers",
  phases: [{ title: "Explore" }, { title: "Verify" }],
};
const [alpha, beta] = await parallel([
  () => agent("delay:1600 report-alpha", { phase: "Explore", title: "Alpha" }),
  () => agent("delay:1200 report-beta", { phase: "Explore", title: "Beta" }),
]);
phase("Verify");
const combined = await agent("delay:400 combine-results", { phase: "Verify", title: "Combine" });
return { alpha, beta, combined };
`;

const HOLD_SOURCE = `export const meta = {
  name: "e2e-stop",
  description: "Hold so Stop can win",
  phases: [{ title: "Hold" }],
};
return await agent("delay:20000 hold-for-stop", { phase: "Hold", title: "Hold" });
`;

const FORBIDDEN_SOURCE = `export const meta = {
  name: "e2e-forbidden",
  description: "Must be rejected by the sandbox",
};
import fs from "node:fs";
return fs.readFileSync("secret.txt", "utf8");
`;

interface PluginCliResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

interface WorkflowCliContext {
  projectId: string;
  threadId: string;
  cwd: string;
}

async function dismissOverlays(window: Page): Promise<void> {
  const support = window.getByRole('dialog', { name: 'Support Zana' });
  if (await support.isVisible().catch(() => false)) {
    await support.getByRole('button', { name: 'Dismiss' }).click();
  }
  const trust = window.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) {
    await trust.click();
  }
}

async function addProject(window: Page, path: string): Promise<string> {
  const projectId = await window.evaluate(async (projectPath) => {
    const res = await window.cc.projects.add(projectPath);
    const proj = (res && typeof res === 'object' && 'ok' in res
      ? (res as { value: { id: string } }).value
      : res) as { id: string };
    return proj.id;
  }, path);
  expect(projectId).toBeTruthy();
  return projectId;
}

async function installWorkflows(window: Page): Promise<void> {
  const installed = await window.evaluate(async () => {
    return window.cc.extensions.install({ kind: 'bundled', id: 'workflows' });
  });
  expect(installed, `workflows install failed: ${JSON.stringify(installed)}`).toMatchObject({
    ok: true,
    value: { id: 'workflows' }
  });
  await dismissOverlays(window);
  await expect.poll(async () => window.evaluate(async () => {
    const plugins = await window.cc.pluginApps.list();
    const row = plugins.find((plugin) => plugin.id === 'workflows');
    return row
      ? `${row.enabled}:${row.status}:${row.statusDetail ?? ''}:${(row.cliNames ?? []).join(',')}`
      : 'missing';
  }), { timeout: 30_000, intervals: [400, 800] }).toBe('true:running::workflows');
}

async function createFakeOriginThread(
  window: Page,
  projectId: string
): Promise<{ id: string; environmentId: string }> {
  const created = await window.evaluate(async (pid) => {
    const res = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: pid,
        providerId: 'fake',
        permissionMode: 'full',
        model: 'fake-model',
        input: 'origin thread for workflows e2e'
      })
    });
    const json = await res.json() as {
      ok?: boolean;
      thread?: { id?: string; environmentId?: string | null };
      value?: { id?: string; environmentId?: string | null };
      message?: string;
    };
    if (!res.ok || json.ok === false) {
      throw new Error(`POST /threads failed: ${JSON.stringify(json)}`);
    }
    const thread = json.value ?? json.thread;
    if (!thread?.id) throw new Error(`POST /threads missing id: ${JSON.stringify(json)}`);
    return {
      id: thread.id,
      environmentId: thread.environmentId ?? null
    };
  }, projectId);
  await expect.poll(async () => window.evaluate(async (threadId) => {
    const res = await fetch(`/api/v1/threads/${encodeURIComponent(threadId)}`);
    const json = await res.json() as { thread?: { environmentId?: string | null } };
    return json.thread?.environmentId ?? null;
  }, created.id), { timeout: 20_000, intervals: [250, 500] }).toBeTruthy();
  const environmentId = await window.evaluate(async (threadId) => {
    const res = await fetch(`/api/v1/threads/${encodeURIComponent(threadId)}`);
    const json = await res.json() as { thread?: { environmentId?: string | null } };
    return json.thread?.environmentId ?? null;
  }, created.id);
  expect(environmentId).toBeTruthy();
  return { id: created.id, environmentId: environmentId! };
}

async function openThread(window: Page, threadId: string): Promise<void> {
  await window.evaluate((id) => {
    window.history.pushState({}, '', `/threads/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);
  await expect(window.getByTestId('thread-detail')).toBeVisible({ timeout: 20_000 });
}

async function pluginCli(
  window: Page,
  argv: string[],
  ctx: WorkflowCliContext
): Promise<PluginCliResult> {
  return window.evaluate(async ({ argv: nextArgv, projectId, threadId, cwd }) => {
    const res = await fetch('/api/v1/plugins/workflows/cli', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ argv: nextArgv, projectId, threadId, cwd })
    });
    const json = await res.json() as PluginCliResult & { message?: string };
    if (!res.ok) {
      throw new Error(`plugin CLI HTTP ${res.status}: ${JSON.stringify(json)}`);
    }
    return {
      exitCode: json.exitCode,
      stdout: json.stdout ?? '',
      stderr: json.stderr
    };
  }, { argv, ...ctx });
}

function parseCliJson<T>(result: PluginCliResult): T {
  expect(result.exitCode, result.stderr || result.stdout).toBe(0);
  return JSON.parse(result.stdout) as T;
}

function parseCliJsonl(result: PluginCliResult): Array<Record<string, unknown>> {
  expect(result.exitCode, result.stderr || result.stdout).toBe(0);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitForRunStatus(
  window: Page,
  ctx: WorkflowCliContext,
  runId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
  timeoutMs = 45_000
): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> | null = null;
  await expect.poll(async () => {
    const result = await pluginCli(window, ['status', runId], ctx);
    last = JSON.parse(result.stdout) as Record<string, unknown>;
    return String(last.status ?? '');
  }, { timeout: timeoutMs, intervals: [400, 800] }).toBe(status);
  expect(last).toBeTruthy();
  return last!;
}

test('workflows install, fan-out hidden fake workers, resume cache, and stop from the composer banner', async ({
  app
}) => {
  const { window } = app;
  await dismissOverlays(window);
  await expect(window.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({
    timeout: 20_000
  });

  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-workflows-e2e-'));
  let projectId: string | null = null;
  try {
    await installWorkflows(window);
    projectId = await addProject(window, projectDir);
    mkdirSync(join(projectDir, '.zcc', 'workflows'), { recursive: true });
    writeFileSync(join(projectDir, '.zcc', 'workflows', 'e2e-orchestration.js'), ORCHESTRATION_SOURCE);

    const origin = await createFakeOriginThread(window, projectId);
    await openThread(window, origin.id);
    const ctx: WorkflowCliContext = {
      projectId,
      threadId: origin.id,
      cwd: projectDir
    };

    const rejected = await pluginCli(window, ['validate', '--script', FORBIDDEN_SOURCE], ctx);
    expect(rejected.exitCode).not.toBe(0);
    expect(`${rejected.stderr ?? ''}${rejected.stdout}`).toMatch(/import/i);

    const validated = parseCliJson<{ valid: boolean; origin: { kind: string; name?: string } }>(
      await pluginCli(window, ['validate', '--name', 'e2e-orchestration'], ctx)
    );
    expect(validated.valid).toBe(true);
    expect(validated.origin).toMatchObject({ kind: 'name', name: 'e2e-orchestration' });

    const holding = parseCliJson<{ runId: string; status: string }>(
      await pluginCli(window, ['run', '--script', HOLD_SOURCE], ctx)
    );
    expect(holding.runId).toMatch(/^wfr_/);
    await expect.poll(async () => window.evaluate(() => JSON.stringify({
      path: window.location.pathname,
      hostThread: document.querySelector('[data-composer-thread]')?.getAttribute('data-composer-thread') ?? null,
      rootThread: document.querySelector('[data-testid="wf-banner-root"]')?.getAttribute('data-wf-thread') ?? null,
      cards: document.querySelectorAll('.wf-banner-card').length,
      names: [...document.querySelectorAll('.wf-banner-card')].map((node) => node.textContent)
    })), { timeout: 20_000, intervals: [400, 800] }).toMatch(/e2e-stop|"cards":[1-9]/);
    const banner = window.locator('.wf-banner-card').filter({ hasText: 'e2e-stop' });
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await banner.locator('.wf-banner-toggle').click();
    await banner.getByRole('button', { name: 'Stop workflow' }).click();
    const stopped = await waitForRunStatus(window, ctx, holding.runId, 'cancelled', 20_000);
    expect(stopped.status).toBe('cancelled');

    const started = parseCliJson<{ runId: string; name: string }>(
      await pluginCli(window, ['run', '--name', 'e2e-orchestration'], ctx)
    );
    expect(started.name).toBe('e2e-orchestration');
    await expect(window.locator('.wf-banner-card').filter({ hasText: 'e2e-orchestration' })).toBeVisible({
      timeout: 15_000
    });

    const finished = await waitForRunStatus(window, ctx, started.runId, 'succeeded');
    expect(finished).toMatchObject({
      status: 'succeeded',
      name: 'e2e-orchestration',
      calls: { total: 3, succeeded: 3 }
    });
    expect(finished.result).toEqual(expect.objectContaining({
      alpha: expect.stringContaining('report-alpha'),
      beta: expect.stringContaining('report-beta'),
      combined: expect.stringContaining('combine-results')
    }));

    const history = parseCliJsonl(await pluginCli(window, ['history', started.runId, '--limit', '10'], ctx));
    const calls = history.filter((row) => row.type === 'call');
    expect(calls).toHaveLength(3);
    expect(calls.map((row) => row.label)).toEqual(['Alpha', 'Beta', 'Combine']);
    expect(calls.every((row) => row.source === 'live')).toBe(true);
    const childIds = calls.map((row) => String(row.childThreadId ?? '')).filter(Boolean);
    expect(childIds).toHaveLength(3);

    const visibleIds = await window.evaluate(async (project) => {
      const res = await fetch(`/api/v1/threads?projectId=${encodeURIComponent(project)}`);
      const json = await res.json() as { threads?: Array<{ id: string }> };
      return (json.threads ?? []).map((thread) => thread.id);
    }, projectId);
    expect(visibleIds).toContain(origin.id);
    for (const childId of childIds) {
      expect(visibleIds).not.toContain(childId);
      const worker = await window.evaluate(async (threadId) => {
        const res = await fetch(`/api/v1/threads/${encodeURIComponent(threadId)}`);
        const json = await res.json() as {
          thread?: { visibility?: string; originPluginId?: string | null; originKind?: string | null };
        };
        if (!res.ok) throw new Error(`GET worker ${threadId} failed: ${JSON.stringify(json)}`);
        return json.thread;
      }, childId);
      expect(worker).toMatchObject({
        visibility: 'hidden',
        originPluginId: 'workflows'
      });
    }

    await window.getByTestId('thread-secondary-show').click();
    await expect(window.getByTestId('thread-secondary-panel')).toBeVisible();
    await window.getByTestId('thread-secondary-new-tab').click();
    const panelAction = window.getByTestId('thread-new-tab-plugin-workflows-workflow-run');
    await expect(panelAction).toBeVisible({ timeout: 15_000 });
    await panelAction.click();
    const panel = window.getByTestId('thread-plugin-tab');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.wf-title')).toContainText('e2e-orchestration');
    await expect(panel.locator('.wf-phase', { hasText: 'Explore' })).toBeVisible();
    await expect(panel.locator('.wf-phase', { hasText: 'Verify' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Alpha' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Beta' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Combine' })).toBeVisible();

    const resumed = parseCliJson<{ runId: string }>(
      await pluginCli(window, ['run', '--name', 'e2e-orchestration', '--resume', started.runId], ctx)
    );
    expect(resumed.runId).not.toBe(started.runId);
    const resumedStatus = await waitForRunStatus(window, ctx, resumed.runId, 'succeeded', 20_000);
    expect(resumedStatus.resumedFromRunId).toBe(started.runId);
    const resumedHistory = parseCliJsonl(
      await pluginCli(window, ['history', resumed.runId, '--limit', '10'], ctx)
    );
    const resumedCalls = resumedHistory.filter((row) => row.type === 'call');
    expect(resumedCalls).toHaveLength(3);
    expect(resumedCalls.every((row) => row.source === 'cached')).toBe(true);

    const reloaded = await window.evaluate(async () => window.cc.pluginApps.reload('workflows'));
    expect(reloaded).toMatchObject({ ok: true });
    await expect.poll(async () => window.evaluate(async () => {
      const plugins = await window.cc.pluginApps.list();
      return plugins.find((plugin) => plugin.id === 'workflows')?.status ?? 'missing';
    })).toBe('running');
  } finally {
    if (projectId) {
      await window.evaluate(async (pid) => {
        try {
          await window.cc.projects.remove(pid);
        } catch {
          /* best-effort */
        }
      }, projectId).catch(() => undefined);
    }
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});
