/**
 * LIVE-ONLY, MANUAL/OPT-IN check — real OpenCode CLI, real model spend.
 * Gated on ZCC_LIVE_OPENCODE=1; SKIPPED by default, including in CI. A skip
 * here proves nothing about the Modern path's health — it only means this
 * opt-in check did not run.
 *
 * ALWAYS-ON deterministic coverage of this same Modern path (real Modern
 * host tool-call bridge + forwarder, full DAG to COMPLETED, no model spend)
 * lives in e2e/modern-owner-job-team-run.spec.ts — that is the test CI
 * actually relies on for regression protection.
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { answerJobBlockerThroughUi } from './sdk/job-team-scenario.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({
  e2e: true,
  seedOpenCodeAuth: true,
  initialConfig: {
    harnessOpenCodeEnabled: true,
    harnessRouting: {
      schemaVersion: 1,
      byAdapter: { opencode: { modelTargetId: 'llmgw/claude-sonnet-5' } }
    },
    teamJobLaunchEnabled: true,
    teamLaunchEnabled: true
  }
});

test.setTimeout(10 * 60_000);

test('real Modern OpenCode thread completes a durable Job Team through its advertised dynamic tool', async ({ app }) => {
  test.skip(
    process.env.ZCC_LIVE_OPENCODE !== '1',
    'LIVE-ONLY opt-in check, not a CI signal: requires ZCC_LIVE_OPENCODE=1 plus an installed, ' +
      'authenticated OpenCode CLI (real model spend). Deterministic always-on coverage of this ' +
      'same Modern path lives in e2e/modern-owner-job-team-run.spec.ts.'
  );
  const { window, home } = app;
  const stderr: string[] = [];
  app.electron.process()?.stderr?.on('data', (chunk) => stderr.push(String(chunk)));
  const agent = makeJobTeamCoordinatorBinary();
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-modern-job-team-'));
  let projectId: string | null = null;

  try {
    await window.evaluate((bin) => window.cc.config.set({
      claudeBinary: bin,
      harnessOpenCodeEnabled: true,
      sponsorPromptDismissed: true,
      teamJobLaunchEnabled: true,
      teamLaunchEnabled: true
    }), agent.path);

    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-modern-orchestrator', name: 'E2E Modern Orchestrator',
      description: 'Deterministic Modern Job Team coordinator', baseProfile: 'claude',
      permissionMode: 'default', systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.personas.save({
      id: 'e2e-modern-worker', name: 'E2E Modern Worker',
      description: 'Deterministic Modern Job Team worker', baseProfile: 'claude',
      permissionMode: 'default', systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.teams.save({
      id: 'e2e-modern-team', name: 'E2E Modern Team',
      description: 'Modern owner durable team',
      slots: [{ personaId: 'e2e-modern-worker', quantity: 2 }],
      orchestratorPersonaId: 'e2e-modern-orchestrator'
    }));

    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
      return result.value.id;
    }, projectDir);

    const threadId = await window.evaluate(async ({ projectId }) => {
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId, providerId: 'acp-opencode', model: 'llmgw/claude-sonnet-5', permissionMode: 'full',
          input: 'Call zcc_execution_start immediately with exactly this JSON: {"version":1,"teamId":"e2e-modern-team","launchRequestId":"live-modern-job-team-1","jobTitle":"Modern durable job","summary":"Full Job Team route started by a Modern owner.","slots":[{"initialTask":"Coordinate the durable execution."},{"initialTask":"Run assigned work from the durable execution."},{"initialTask":"Run assigned work from the durable execution."}]}. Do not inspect files, explain, or simulate the call.'
        })
      });
      const body = await response.json();
      if (!response.ok || !body?.ok) throw new Error(JSON.stringify(body));
      return body.value.id as string;
    }, { projectId });

    const executionId = await expect.poll(() => {
      const file = join(home, 'electron-user-data', 'squad-executions.json');
      if (!existsSync(file)) return '';
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
        records?: Array<{ id: string; callerPrincipalId?: string; teamLaunchRequestId?: string }>;
      };
      return parsed.records?.find((record) =>
        record.callerPrincipalId === threadId && record.teamLaunchRequestId === 'live-modern-job-team-1')?.id ?? '';
    }, { timeout: 60_000, intervals: [2_000] }).not.toBe('').then(async () => {
      const file = join(home, 'electron-user-data', 'squad-executions.json');
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
        records: Array<{ id: string; callerPrincipalId?: string; teamLaunchRequestId?: string }>;
      };
      return parsed.records.find((record) =>
        record.callerPrincipalId === threadId && record.teamLaunchRequestId === 'live-modern-job-team-1')!.id;
    }).catch(async (error) => {
      const timeline = await window.evaluate(async (id) =>
        fetch(`/api/v1/threads/${encodeURIComponent(id)}/timeline`).then((response) => response.json()), threadId);
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(timeline)}\n${stderr.join('')}`);
    });

    try {
      await answerJobBlockerThroughUi({ window, projectId, executionId, jobTitle: 'Modern durable job' });
    } catch (error) {
      const snapshot = await window.evaluate(async ({ projectId, executionId }) =>
        window.cc.executionBoard.snapshot(projectId, executionId, 0), { projectId, executionId });
      const log = existsSync(join(projectDir, '.fake-coordinator.log'))
        ? readFileSync(join(projectDir, '.fake-coordinator.log'), 'utf8') : 'no fake coordinator log';
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(snapshot)}\n${log}\n${stderr.join('')}`);
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
