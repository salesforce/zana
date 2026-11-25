/**
 * Skip impact on the Squad launch card, at the real Electron boundary.
 *
 * A Modern thread proposes a Squad launch from a plan shaped like the 4dfef173 run: two roots feed one unit, a
 * chain hangs off it, and the last unit waits for everything. The composer's "Review plan" disclosure must list,
 * per unit, how many later units a failure would skip, expand to name them, and mark the riskiest units.
 *
 * Zero model spend: the proposer is the fake ACP agent (e2e/fixtures/bin).
 */
import { test, expect } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const fixtureBin = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bin');
const TITLE = 'Skip impact review';
const FAKE_ACP_PREFIX = 'FAKE_ACP: ';
const CHAIN = ['surface-sync-error', 'unify-classification', 'sync-diagnostics', 'diagnose-live-stall', 'sync-runbook'];
const DOWNSTREAM_OF_ROOT = [...CHAIN, 'verify-all'];

const step = (id: string, depends: string[]) => [
  `### ${id}: Step ${id} <!-- executable-step -->`,
  '- **Work:** do the work',
  `- **Depends on:** ${depends.length ? depends.join(', ') : 'None'}`,
  '- **Mode:** read-only',
  '- **Verification:** done',
  ''
].join('\n');

const PLAN_MD = [
  '# Sync plan', '',
  step('conflict-review-ui', []),
  step('ui-rename', []),
  step('surface-sync-error', ['conflict-review-ui', 'ui-rename']),
  step('unify-classification', ['surface-sync-error']),
  step('sync-diagnostics', ['unify-classification']),
  step('diagnose-live-stall', ['sync-diagnostics']),
  step('sync-runbook', ['diagnose-live-stall']),
  step('verify-all', ['conflict-review-ui', 'ui-rename', ...CHAIN])
].join('\n');

async function setUp(window: Page, projectDir: string, agentPath: string): Promise<string> {
  await window.evaluate((bin) => window.cc.config.set({
    teamJobLaunchEnabled: true, sponsorPromptDismissed: true, claudeBinary: bin, harnessOpenCodeEnabled: true, opencodeBinary: undefined
  }), agentPath);
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-orchestrator', name: 'E2E Orchestrator', description: 'Durable test coordinator',
    baseProfile: 'claude', permissionMode: 'default', systemPrompt: '', deniedTools: ['Write', 'Edit']
  }));
  await window.evaluate(() => window.cc.personas.save({
    id: 'e2e-worker', name: 'E2E Worker', description: 'Durable test worker', baseProfile: 'claude', permissionMode: 'default', systemPrompt: ''
  }));
  await window.evaluate(() => window.cc.teams.save({
    id: 'e2e-job-team', name: 'E2E Job Team', description: 'Skip impact team',
    slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator', defaultPlanning: 'provided'
  }));
  return window.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
    return result.value.id;
  }, projectDir);
}

async function startThread(window: Page, projectId: string): Promise<string> {
  await expect.poll(async () => window.evaluate(async () => {
    const response = await fetch('/api/v1/threads/providers');
    return (await response.json()).providers.map((provider: { id: string }) => provider.id);
  }), { timeout: 30_000, intervals: [500] }).toContain('acp-opencode');
  const threadId = await window.evaluate(async ({ projectId, input }) => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, providerId: 'acp-opencode', model: 'fake/default', acpMode: 'plan', permissionMode: 'full', input })
    });
    const body = await response.json();
    if (!response.ok || !body?.ok) throw new Error(JSON.stringify(body));
    return body.value.id as string;
  }, { projectId, input: `${FAKE_ACP_PREFIX}stand by; the Squad proposal is submitted out of band.` });
  await expect.poll(async () => window.evaluate(async (id) =>
    ((await (await fetch(`/api/v1/threads/${encodeURIComponent(id)}`)).json()).thread?.status ?? 'missing') as string, threadId),
  { timeout: 30_000, intervals: [500] }).toBe('idle');
  return threadId;
}

/** Calls a thread's tool through the host tool-call bridge; a "not ready" refusal ran nothing and is retried. */
function hostToolCaller(window: Page, home: string, threadId: string) {
  const origin = new URL(window.url()).origin;
  const auth = JSON.parse(readFileSync(join(home, '.zcc', 'auth.json'), 'utf8')) as { hostId: string; hostKey: string };
  let n = 0;
  return async (tool: string, args: Record<string, unknown>) => {
    const deadline = Date.now() + 90_000;
    for (;;) {
      n += 1;
      const response = await fetch(`${origin}/internal/hosts/tool-call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.hostKey}`, 'x-zcc-host-id': auth.hostId },
        body: JSON.stringify({ sessionId: threadId, threadId, providerThreadId: threadId, turnId: `e2e-turn-${n}`, callId: `e2e-call-${n}`, tool, arguments: args })
      });
      const body = await response.json() as { success?: boolean; contentItems?: Array<{ text?: string }> };
      const text = (body.contentItems ?? []).map((item) => item.text ?? '').join('\n');
      if (!text.includes('plugin tool policy not ready') || Date.now() > deadline) return { success: body.success, text };
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  };
}

test.describe('Squad launch skip impact', () => {
  test.use({
    e2e: true,
    initialConfig: { teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, harnessOpenCodeEnabled: true, sponsorPromptDismissed: true, autoRenameTabs: false },
    launchEnv: {
      PATH: `${fixtureBin}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_ACP_MODEL_CONFIG: '1',
      FAKE_ACP_MODE_CONFIG: '1',
      FAKE_ACP_MODE_OPTIONS: 'build:Build,plan:Plan',
      FAKE_ACP_PROMPT_PREFIX: FAKE_ACP_PREFIX,
      ...(process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {})
    }
  });
  test.setTimeout(300_000);

  test('the launch card lists what each unit would skip and marks the riskiest units', async ({ app, home }) => {
    const { window } = app;
    const agent = makeJobTeamCoordinatorBinary();
    const projectDir = mkdtempSync(join(tmpdir(), 'zcc-squad-skip-impact-'));
    let projectId: string | null = null;
    try {
      projectId = await setUp(window, projectDir, agent.path);
      const callTool = hostToolCaller(window, home, await startThread(window, projectId));
      const notes = join(home, 'zcc-notes');
      mkdirSync(notes, { recursive: true });
      writeFileSync(join(notes, 'sync-plan.md'), PLAN_MD);

      // squad_plan_check carries the same data to the agent.
      const check = await callTool('squad_plan_check', { path: join(notes, 'sync-plan.md'), teamId: 'e2e-job-team' });
      expect(check.success, check.text).toBe(true);
      const checked = JSON.parse(check.text) as { ok: boolean; steps: Array<{ id: string; skippedIfFails: string[] }> };
      expect(checked.ok).toBe(true);
      expect(checked.steps.find((s) => s.id === 'conflict-review-ui')?.skippedIfFails).toEqual(DOWNSTREAM_OF_ROOT);

      const proposed = await callTool('squad_propose', { teamId: 'e2e-job-team', goal: 'Run the sync plan.', sources: [join(notes, 'sync-plan.md')], title: TITLE });
      expect(proposed.success, proposed.text).toBe(true);

      await window.getByTestId('nav-inbox').or(window.getByTestId('project-nav-inbox')).click();
      const row = window.locator('.inbox-list-pane').getByRole('button').filter({ hasText: `Squad launch ready: ${TITLE}` }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();
      await window.getByRole('button', { name: 'Review Squad launch' }).click();
      const modal = window.getByTestId('launch-modal');
      await expect(modal).toBeVisible();

      // Collapsed by default inside the plan review disclosure: the card is not buried.
      const review = modal.getByTestId('team-composer-plan-review');
      await review.locator('summary').first().click();
      const impact = modal.getByTestId('plan-skip-impact');
      await expect(impact).toBeVisible();
      await expect(impact.locator('xpath=self::details[not(@open)]')).toHaveCount(1);
      await expect(impact).toContainText('If a step fails (2 steps are risky)');
      await impact.locator('summary').click();

      // Per unit counts; the two roots skip the most and are marked risky, a leaf is not listed.
      await expect(modal.getByTestId('plan-skip-count-conflict-review-ui')).toHaveText('skips 6');
      await expect(modal.getByTestId('plan-skip-count-ui-rename')).toHaveText('skips 6');
      await expect(modal.getByTestId('plan-skip-count-sync-runbook')).toHaveText('skips 1');
      await expect(modal.getByTestId('plan-skip-risky-conflict-review-ui')).toBeVisible();
      await expect(modal.getByTestId('plan-skip-risky-ui-rename')).toBeVisible();
      await expect(modal.getByTestId('plan-skip-risky-sync-runbook')).toHaveCount(0);
      await expect(modal.getByTestId('plan-skip-row-verify-all')).toHaveCount(0);

      // Expanding a unit names its dependents.
      const toggle = modal.getByRole('button', { name: /^conflict-review-ui: .*skips 6/ });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const list = modal.getByTestId('plan-skip-list-conflict-review-ui');
      for (const id of DOWNSTREAM_OF_ROOT) await expect(list).toContainText(id);
      await expect(list.locator('li')).toHaveCount(6);
    } finally {
      if (projectId) {
        await window.evaluate(async (id) => {
          for (const session of await window.cc.terminals.list(id)) {
            try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
          }
          try { await window.cc.projects.remove(id); } catch { /* best-effort */ }
        }, projectId).catch(() => undefined);
      }
      rmSync(projectDir, { recursive: true, force: true });
      agent.cleanup();
    }
  });
});
