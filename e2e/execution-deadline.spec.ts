import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/app';
import { makeFakeAgentBinary } from './sdk/harness';

test.use({ e2e: true, initialConfig: { teamLaunchEnabled: true } });

function toolText(result: unknown): string {
  return ((result as { content?: Array<{ text?: string }> }).content?.[0]?.text) ?? '';
}

async function clientFor(window: Page, sessionId: string): Promise<Client> {
  let route: string | null = null;
  await expect.poll(async () => {
    route = await window.evaluate((id) => window.__zccTest?.mcpRoute(id) ?? null, sessionId);
    return route;
  }, { timeout: 10_000, message: `MCP route for ${sessionId}` }).not.toBeNull();
  if (!route) throw new Error(`missing MCP route for ${sessionId}`);
  const client = new Client({ name: 'execution-deadline-e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(route)));
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  if ((result as { isError?: boolean }).isError) throw new Error(toolText(result));
  return JSON.parse(toolText(result)) as Record<string, any>;
}

test('built Electron deadline stops durable execution and tears down only its cohort', async ({ app }) => {
  test.setTimeout(45_000);
  const startedAt = performance.now();
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-execution-deadline-'));
  const fake = makeFakeAgentBinary({ profile: 'claude', sequence: 'working-hold' });
  const clients: Client[] = [];
  let projectId = '';
  let ownerId = '';
  try {
    await window.evaluate(async (bin) => {
      await window.cc.config.set({ claudeBinary: bin });
      await window.cc.personas.save({ id: 'e2e-deadline-worker', name: 'Deadline Worker', baseProfile: 'claude', permissionMode: 'acceptEdits' });
      await window.cc.personas.save({ id: 'e2e-deadline-coordinator', name: 'Deadline Coordinator', baseProfile: 'claude', permissionMode: 'acceptEdits' });
      await window.cc.teams.save({
        id: 'e2e-deadline-team', name: 'Deadline Team',
        slots: [{ personaId: 'e2e-deadline-worker' }],
        orchestratorPersonaId: 'e2e-deadline-coordinator'
      });
    }, fake.path);
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectDir);
    expect(projectId).toBeTruthy();
    ownerId = await window.evaluate(async (project) => {
      const result = await window.cc.terminals.create({ projectId: project, profile: 'claude', cols: 80, rows: 24, title: 'Unrelated deadline owner' }) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectId);
    expect(ownerId).toBeTruthy();
    const owner = await clientFor(window, ownerId);
    clients.push(owner);

    const execution = await call(owner, 'execution.start', {
      version: 1,
      teamId: 'e2e-deadline-team',
      launchRequestId: 'e2e-deadline-run',
      jobTitle: 'Deadline cancellation regression',
      deadlineMs: 3_000,
      slots: [{ initialTask: 'hold until deadline' }, { initialTask: 'coordinate until deadline' }]
    });
    expect(execution.state).toBe('RUNNING');
    const lifecycle = await call(owner, 'get_team_launch', { launchRequestId: execution.teamLaunchRequestId });
    const cohortIds = (lifecycle.workers as Array<{ sessionId: string }>).map(({ sessionId }) => sessionId);
    expect(cohortIds).toHaveLength(2);

    await new Promise((resolve) => setTimeout(resolve, 4_500));

    const sessionsAfterDeadline = await window.evaluate((project) => window.cc.terminals.list(project), projectId);
    expect(sessionsAfterDeadline.map(({ id }) => id)).toContain(ownerId);
    expect(sessionsAfterDeadline.filter(({ id }) => cohortIds.includes(id))).toHaveLength(0);
    const durable = await window.evaluate(({ project, executionId }) => window.cc.executionBoard.snapshot(project, executionId), {
      project: projectId,
      executionId: execution.id as string
    });
    expect(durable?.execution).toMatchObject({ executionId: execution.id, state: 'STOPPED' });
    expect(durable?.events).toContainEqual(expect.objectContaining({ severity: 'warning', summary: 'Execution timed out' }));

    const durationSeconds = (performance.now() - startedAt) / 1_000;
    console.log(`execution deadline focused duration: ${durationSeconds.toFixed(3)}s`);
    expect(durationSeconds).toBeLessThan(30);
  } finally {
    await Promise.all(clients.map((client) => client.close().catch(() => {})));
    await window.evaluate(async ({ project, owner }) => {
      if (owner) await window.cc.terminals.close(owner).catch(() => {});
      if (project) await window.cc.projects.remove(project).catch(() => {});
    }, { project: projectId, owner: ownerId }).catch(() => {});
    fake.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
});
