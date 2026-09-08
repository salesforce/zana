/**
 * Owner-session execution.start at the real Electron boundary.
 *
 * CLI Agent and Modern are two UI starts of the SAME owner verb. Both must
 * reach `execution.start` on the credentialed loopback MCP route:
 *   - CLI Agent  → live pty session (validateLaunchRouteIdentity pty branch)
 *   - Modern/ACP → live conversation thread (isThreadLive probe)
 * Cohort verbs (`execution.plan.register`) stay pty-only — a Modern thread
 * is a launcher, never a cohort member.
 *
 * This spec drives the route DIRECTLY (stateless tools/call POST), same shape
 * as launch-team-route-identity.spec.ts. It does not spawn a Job Team DAG.
 *
 * `teamJobLaunchEnabled` gates whether `executionService` is wired onto the
 * MCP route AT BOOT. Seed via initialConfig.
 */
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, teamLaunchEnabled: true } });

test.setTimeout(90_000);

interface RpcToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

function parseRpc(bodyText: string): { result?: RpcToolResult; error?: unknown } {
  const trimmed = bodyText.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLines = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter((line) => line.length > 0);
  if (dataLines.length === 0) throw new Error(`unparseable MCP reply: ${bodyText.slice(0, 200)}`);
  return JSON.parse(dataLines[dataLines.length - 1]);
}

async function toolCall(route: string, name: string, args: Record<string, unknown>): Promise<RpcToolResult> {
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  });
  const rpc = parseRpc(await response.text());
  if (rpc.error) throw new Error(`tools/call ${name} rpc error: ${JSON.stringify(rpc.error)}`);
  if (!rpc.result) throw new Error(`tools/call ${name} returned no result`);
  return rpc.result;
}

function resultText(result: RpcToolResult): string {
  return result.content?.find((c) => c.type === 'text')?.text ?? '';
}

test('execution.start honors a live pty session AND a live Modern thread; cohort verbs stay pty-only', async ({
  app
}) => {
  const { window, home } = app;
  const agent = makeFakeAgentBinary();
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-owner-exec-route-'));
  let projectId: string | null = null;
  let sessionId: string | null = null;
  let threadId: string | null = null;

  try {
    await window.evaluate((bin) => window.cc.config.set({
      teamJobLaunchEnabled: true,
      teamLaunchEnabled: true,
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      defaultHarness: 'claude'
    }), agent.path);

    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-owner-worker',
      name: 'E2E Owner Worker',
      description: 'Worker persona for the owner execution route identity spec',
      baseProfile: 'claude',
      permissionMode: 'default',
      systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-owner-team',
      name: 'E2E Owner Route Team',
      description: 'Single-worker team for owner execution.start assertions',
      slots: [{ personaId: 'e2e-owner-worker', quantity: 1 }],
      orchestratorPersonaId: 'e2e-owner-worker'
    }));

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    sessionId = await window.evaluate(async (pid) => {
      const res = await window.cc.terminals.create({ projectId: pid, profile: 'claude', cols: 80, rows: 24, title: 'Owner Exec Probe' });
      if (!res || !('ok' in res) || !res.ok) throw new Error('terminals.create failed: ' + JSON.stringify(res));
      return res.value.id;
    }, projectId);
    expect(sessionId).toBeTruthy();

    const { port } = JSON.parse(readFileSync(join(home, 'electron-user-data', 'mcp-port-dev.json'), 'utf8')) as { port: number };
    const signingKey = readFileSync(join(home, '.zcc', 'control-signing.key'));
    const credentialFor = (id: string): string => createHmac('sha256', signingKey).update(id, 'utf8').digest('hex');
    const routeFor = (id: string): string =>
      `http://127.0.0.1:${port}/mcp/${encodeURIComponent(projectId!)}/${encodeURIComponent(id)}/${encodeURIComponent(credentialFor(id))}`;

    const startArgs = (id: string) => ({
      version: 1,
      teamId: 'e2e-owner-team',
      launchRequestId: `req-${id}`,
      slots: [{ initialTask: 'probe owner execution.start' }]
    });

    const expectStarted = (result: RpcToolResult) => {
      expect(result.isError, resultText(result)).toBeFalsy();
      const value = JSON.parse(resultText(result)) as { id?: string; state?: string };
      expect(value.id).toBeTruthy();
      expect(value.state).toBeTruthy();
    };

    expectStarted(await toolCall(routeFor(sessionId!), 'execution.start', startArgs(sessionId!)));

    threadId = await window.evaluate(async (pid) => {
      const res = await fetch('/api/v1/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: pid, input: 'owner execution route identity probe' })
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error('POST /threads failed: ' + JSON.stringify(body));
      return body.value.id as string;
    }, projectId);
    expect(threadId).toBeTruthy();

    await expect.poll(async () => {
      const result = await toolCall(routeFor(threadId!), 'execution.start', startArgs(threadId!));
      return result.isError ? resultText(result) : 'started';
    }, { timeout: 30_000, intervals: [1000] }).toBe('started');

    const cohort = await toolCall(routeFor(threadId!), 'execution.plan.register', {
      executionId: 'not-a-real-execution',
      workUnits: [{ id: 'unit-1', title: 'Unit', task: 'Do it', dependencies: [] }]
    });
    expect(cohort.isError).toBe(true);
    expect(resultText(cohort)).toContain('not authorized');

    // The agent-facing catalog name (remote MCP server_tool join) must also
    // start. Loopback still speaks execution.start; this asserts the route
    // accepts the owner verb the Modern alias forwards to.
    expectStarted(await toolCall(routeFor(threadId!), 'execution.start', startArgs(`${threadId}-alias`)));

    const deadId = randomUUID();
    const dead = await toolCall(routeFor(deadId), 'execution.start', startArgs(deadId));
    expect(dead.isError).toBe(true);
    expect(resultText(dead)).toContain('not authorized');
  } finally {
    try {
      if (projectId) {
        await window.evaluate(async (pid) => {
          try {
            const sessions = (await window.cc.terminals.list?.(pid)) as Array<{ id: string }> | undefined;
            if (Array.isArray(sessions)) {
              for (const s of sessions) { try { await window.cc.terminals.close(s.id); } catch { /* best-effort */ } }
            }
          } catch { /* best-effort */ }
          try { await window.cc.projects.remove(pid); } catch { /* best-effort */ }
        }, projectId);
      }
    } catch { /* page may already be closed on timeout */ }
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    agent.cleanup();
  }
});
