/**
 * MODERN owner completes the same durable Job Team as the CLI Agent and Job Team
 * UI surfaces — but through the REAL Modern plumbing, deterministically, with NO
 * model spend and NO external skill.
 *
 * Why this spec exists (the "tests pass but live Modern fails" gap):
 *   - `owner-execution-route-identity.spec.ts` hand-rolls the HMAC credential and
 *     POSTs the loopback MCP route directly with a NON-ACP thread. It bypasses the
 *     real forwarder AND the ACP conversation-thread path, so it cannot catch a
 *     forwarder- or live-thread-identity regression.
 *   - `live-modern-opencode-execution.spec.ts` is `test.skip` unless
 *     `ZCC_LIVE_OPENCODE=1`, so in CI it reads as green while never running.
 * The observed live failure ("execution.start unavailable: session MCP is not
 * authorized for this live session") lives on the path NEITHER test exercises.
 *
 * What this drives (the exact production Modern chain, minus the model):
 *   real ACP conversation thread (owner) → the ACP dynamic-tool entry
 *   `/internal/hosts/tool-call` → server-runtime `invokeAgentTool` → the Modern
 *   team-launch FORWARDER (`modern-team-launch-tools.ts`) → control-credentialed
 *   loopback MCP route in Electron-main → `validateLaunchRouteIdentity` /
 *   `isThreadLiveInProject` (the idle-owner liveness that broke) → `execution.start`.
 * The fake coordinator binary then runs the full 4-unit DAG to COMPLETED.
 *
 * The TEST plays the owner's `execution_start` call itself, POSTing from Node
 * context (no browser `Origin` header — the host-internal guard rejects a browser
 * fetch) with the self-host credentials the daemon minted at enroll
 * (`~/.zcc/auth.json`). The ACP thread need only be a LIVE owner; it never runs a
 * turn, so no OpenCode model is spent. `execution_start` returning `success:true`
 * is the assertion that reproduces the live regression.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { answerJobBlockerThroughUi } from './sdk/job-team-scenario.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureBin = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bin');

// The same 4-unit DAG the fake coordinator's owner() sends over MCP, duplicated
// here as plain data because in this spec the TEST is the owner (the ACP thread
// never runs the coordinator — the host tool-call bridge submits the request).
const PLAN = [
  { id: 'home', title: 'Write Home', task: 'Create home.txt containing HOME: ready', dependencies: [], files: ['home.txt'], verification: ['home.txt present'] },
  { id: 'about', title: 'Write About', task: 'Create about.txt containing ABOUT: ready', dependencies: [], files: ['about.txt'], verification: ['about.txt present'] },
  { id: 'navigation-label', title: 'Ask Navigation Label', task: 'Raise a durable human question with two label choices', dependencies: ['home', 'about'], readOnly: true, verification: ['durable question answered'] },
  { id: 'assemble', title: 'Assemble Result', task: 'Write result.txt from both worker outputs and the chosen label', dependencies: ['navigation-label'], files: ['result.txt'], verification: ['cat result.txt'] }
];

test.use({
  e2e: true,
  initialConfig: { teamJobLaunchEnabled: true, harnessOpenCodeEnabled: true },
  // The polyglot fake `opencode` (e2e/fixtures/bin/opencode) speaks the ACP
  // bridge so the owner thread reaches a LIVE status with no model call.
  launchEnv: {
    PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
    FAKE_ACP_MODEL_CONFIG: '1',
    FAKE_ACP_MODE_CONFIG: '1',
    FAKE_ACP_MODE_OPTIONS: 'build:Build,plan:Plan'
  }
});
test.setTimeout(120_000);

test('Modern owner starts a durable Job Team through the host tool-call bridge and completes', async ({ app }) => {
  const { window, home } = app;
  const diagnostics: string[] = [];
  window.on('console', (message) => diagnostics.push(`[renderer:${message.type()}] ${message.text()}`));
  app.electron.process()?.stderr?.on('data', (chunk) => diagnostics.push(`[main] ${String(chunk)}`));
  const agent = makeJobTeamCoordinatorBinary();
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-modern-owner-job-team-'));
  let projectId: string | null = null;

  try {
    await window.evaluate((bin) => window.cc.config.set({
      teamJobLaunchEnabled: true,
      sponsorPromptDismissed: true,
      claudeBinary: bin,          // workers + orchestrator spawn as claude cohort ptys
      harnessOpenCodeEnabled: true,
      opencodeBinary: undefined   // resolve the fake `opencode` from PATH
    }), agent.path);
    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-orchestrator', name: 'E2E Orchestrator', description: 'Durable test coordinator',
      baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-worker', name: 'E2E Worker', description: 'Durable test worker',
      baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-job-team', name: 'E2E Job Team', description: 'Modern owner durable team',
      slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator'
    }));

    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
      return result.value.id;
    }, projectDir);

    // Create a REAL ACP (Modern) conversation thread as the owner. `plan` is a
    // generic ACP session mode; `fake/default` is the fake agent's own model.
    const threadId = await window.evaluate(async ({ projectId }) => {
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId, providerId: 'acp-opencode', model: 'fake/default',
          acpMode: 'plan', permissionMode: 'full',
          input: 'Stand by; the owner-session execution start is submitted out of band.'
        })
      });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(JSON.stringify(body));
      return body.value.id as string;
    }, { projectId });

    // Wait until the thread reaches a settled live owner status before we submit
    // the owner call. NOTE: `isThreadLiveInProject` treats `error` as live too (a
    // failed PAST turn is not thread death — the user keeps driving it), so an
    // errored owner is still authorized for execution.start; that regression is
    // covered by thread-liveness.test.ts. Here we only wait for the fresh spawn
    // to come up, so we accept the healthy set and let a stuck `error`/`missing`
    // fail the poll loudly rather than masking a spawn failure.
    await expect.poll(async () => window.evaluate(async (id) => {
      const response = await fetch(`/api/v1/threads/${encodeURIComponent(id)}`);
      const body = await response.json();
      return (body.thread?.status ?? 'missing') as string;
    }, threadId), { timeout: 30_000, intervals: [500] }).toMatch(/^(starting|active|idle|stopping)$/);

    // Submit the owner's execution_start through the SAME host tool-call bridge a
    // real ACP dynamic tool uses. From Node context (no browser Origin header),
    // authenticated with the daemon's own self-host credentials.
    const rendererOrigin = new URL(window.url()).origin;
    const auth = JSON.parse(readFileSync(join(home, '.zcc', 'auth.json'), 'utf8')) as { hostId: string; hostKey: string };
    const toolCall = await fetch(`${rendererOrigin}/internal/hosts/tool-call`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${auth.hostKey}`,
        'x-zcc-host-id': auth.hostId
      },
      body: JSON.stringify({
        sessionId: threadId,
        threadId,
        providerThreadId: threadId,
        turnId: 'e2e-modern-turn-1',
        callId: 'e2e-modern-call-1',
        tool: 'execution_start',
        arguments: {
          version: 1,
          teamId: 'e2e-job-team',
          launchRequestId: `e2e-modern-owner-job-${Date.now()}`,
          jobTitle: 'Modern durable job',
          summary: 'Full Job Team route started by a Modern owner.',
          workUnits: PLAN,
          slots: [
            { initialTask: 'Coordinate the durable execution.' },
            { initialTask: 'Run assigned work from the durable execution.' },
            { initialTask: 'Run assigned work from the durable execution.' }
          ]
        }
      })
    });
    const toolBody = await toolCall.json() as { success?: boolean; contentItems?: Array<{ text?: string }> };
    const toolText = (toolBody.contentItems ?? []).map((item) => item.text ?? '').join('\n');
    // The regression gate: a "session MCP is not authorized for this live session"
    // failure surfaces here as HTTP 200 with success:false (or a non-200 identity
    // rejection). Either fails this assertion with the underlying message.
    expect(toolCall.status, `tool-call HTTP ${toolCall.status}: ${toolText}`).toBe(200);
    expect(toolBody.success, `execution_start failed: ${toolText}\n${diagnostics.join('\n')}`).toBe(true);

    await expect.poll(async () => window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'Modern durable job')?.executionId ?? '';
    }, projectId!), { timeout: 30_000, intervals: [500] }).not.toBe('');
    const executionId = await window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'Modern durable job')!.executionId;
    }, projectId!);

    try {
      await answerJobBlockerThroughUi({ window, projectId: projectId!, executionId, jobTitle: 'Modern durable job' });
    } catch (error) {
      const snapshot = await window.evaluate(async ({ projectId, executionId }) =>
        window.cc.executionBoard.snapshot(projectId, executionId, 0), { projectId: projectId!, executionId });
      const log = existsSync(join(projectDir, '.fake-coordinator.log'))
        ? readFileSync(join(projectDir, '.fake-coordinator.log'), 'utf8')
        : 'no fake coordinator log';
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(snapshot)}\n${log}\n${diagnostics.join('\n')}`);
    }
    await expect.poll(() => existsSync(join(projectDir, 'result.txt')), { timeout: 15_000 }).toBe(true);
    expect(readFileSync(join(projectDir, 'result.txt'), 'utf8')).toContain('LABEL: About Atlas');
  } finally {
    if (projectId) {
      await window.evaluate(async (projectId) => {
        for (const session of await window.cc.terminals.list(projectId)) {
          try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
        }
        try { await window.cc.projects.remove(projectId); } catch { /* best-effort */ }
      }, projectId).catch(() => undefined);
    }
    rmSync(projectDir, { recursive: true, force: true });
    agent.cleanup();
  }
});
