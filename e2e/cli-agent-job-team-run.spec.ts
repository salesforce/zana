/** CLI Agent owner starts and completes the same durable Job Team scenario as direct Job Team UI. */
import { test, expect, launchApp } from './fixtures/app.js';
import { makeJobTeamCoordinatorBinary } from './sdk/harness.js';
import { answerJobBlockerThroughUi } from './sdk/job-team-scenario.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test.use({ e2e: true, initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true } });
test.setTimeout(120_000);

test('CLI Agent starts a durable Job Team, surfaces its question, and completes', async ({ home }) => {
  const catalogDir = mkdtempSync(join(tmpdir(), 'zcc-job-team-catalog-'));
  symlinkSync(fileURLToPath(new URL('./fixtures/claude-model-cli.cjs', import.meta.url)), join(catalogDir, 'claude'));
  // The picker discovers models through the SDK. Its PATH points only at our
  // deterministic catalog fixture; the PTY uses the coordinator configured below.
  const app = await launchApp(home, {
    e2e: true,
    allowLiveClaude: true,
    env: { PATH: `${catalogDir}${delimiter}${process.env.PATH ?? ''}` },
    initialConfig: { teamJobLaunchEnabled: true, sponsorPromptDismissed: true }
  });
  const { window } = app;
  const diagnostics: string[] = [];
  window.on('console', (message) => diagnostics.push(`[renderer:${message.type()}] ${message.text()}`));
  app.electron.process()?.stderr?.on('data', (chunk) => diagnostics.push(`[main] ${String(chunk)}`));
  const agent = makeJobTeamCoordinatorBinary();
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-cli-job-team-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  try {
    await window.evaluate((bin) => window.cc.config.set({
      teamJobLaunchEnabled: true,
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      defaultHarness: 'claude'
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
      id: 'e2e-job-team', name: 'E2E Job Team', description: 'CLI owner durable team',
      slots: [{ personaId: 'e2e-worker', quantity: 2 }], orchestratorPersonaId: 'e2e-orchestrator'
    }));

    // Refresh cached harness verification after replacing the Claude binary.
    // CLI Agent hides or rejects an unverified launch even when config is current.
    await window.getByRole('link', { name: 'Settings' }).click();
    await window.locator('.settings-section-item').filter({ hasText: 'AI Harness' }).click();
    // AI Harness reuses the boot-time probe; re-probe explicitly after replacing the CLI.
    await window.getByRole('button', { name: 'Check status' }).click();
    const claudeSettings = window.locator('#settings-anchor-harness-claude');
    await expect(claudeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);
    await window.locator('.settings-app-back').click();

    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
      return result.value.id;
    }, projectDir);

    const projectRow = window.locator('.project-item').filter({ hasText: projectName }).first();
    await expect(projectRow).toBeVisible({ timeout: 15_000 });
    await projectRow.hover();
    await window.getByRole('button', { name: `New agent in ${projectName}` }).click();
    const modal = window.getByTestId('launch-modal');
    await modal.getByRole('button', { name: 'CLI Agent' }).click();
    // Modern startup can remember Codex before this modal mounts. The shared
    // picker deliberately honors that explicit choice over defaultHarness.
    // Select this fixture's provider through the UI instead of relying on timing.
    await modal.getByTestId('model-reasoning-picker-trigger').click();
    const picker = window.getByTestId('model-reasoning-picker-menu');
    await picker.getByRole('tab', { name: 'Claude Code', exact: true }).click();
    await picker.locator('[data-testid^="model-reasoning-model-"]').first().click();
    const instruction = modal.getByTestId('legacy-agent-command-input');
    await instruction.click();
    await instruction.fill('E2E start Job Team');
    await expect(instruction).toContainText('E2E start Job Team');
    await expect(modal.getByRole('button', { name: 'Project', exact: true })).toContainText(projectName);
    const send = modal.getByTestId('legacy-agent-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();
    const launched = await expect.poll(async () => window.evaluate(async (projectId) =>
      (await window.cc.terminals.list(projectId)).some((session) => session.profile.startsWith('claude') && session.title.includes('E2E start Job Team'))
    , projectId!), { timeout: 15_000, intervals: [500] }).toBe(true).then(() => true, () => false);
    if (!launched) throw new Error(`CLI Agent did not launch\n${diagnostics.join('\n')}`);
    await expect(modal).toBeHidden();

    await expect.poll(async () => window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent durable job')?.executionId ?? '';
    }, projectId!), { timeout: 30_000, intervals: [500] }).not.toBe('');
    const executionId = await window.evaluate(async (projectId) => {
      const page = await window.cc.executionBoard.listProject(projectId);
      return page.executions.find((execution) => execution.jobTitle === 'CLI Agent durable job')!.executionId;
    }, projectId!);

    try {
      await answerJobBlockerThroughUi({ window, projectId: projectId!, executionId, jobTitle: 'CLI Agent durable job' });
    } catch (error) {
      const snapshot = await window.evaluate(async ({ projectId, executionId }) =>
        window.cc.executionBoard.snapshot(projectId, executionId, 0), { projectId: projectId!, executionId });
      const log = existsSync(join(projectDir, '.fake-coordinator.log'))
        ? readFileSync(join(projectDir, '.fake-coordinator.log'), 'utf8')
        : 'no fake coordinator log';
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(snapshot)}\n${log}`);
    }
    await expect.poll(() => existsSync(join(projectDir, 'result.txt')), { timeout: 15_000 }).toBe(true);
    expect(readFileSync(join(projectDir, 'result.txt'), 'utf8')).toContain('LABEL: About Atlas');
  } catch (error) {
    const logPath = join(projectDir, '.fake-coordinator.log');
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-16_384) : 'no fake coordinator log';
    const sessions = projectId ? await window.evaluate(async id => (await window.cc.terminals.list(id)).map(row => ({ id: row.id, profile: row.profile, status: row.status, exitCode: row.exitCode, cwd: row.cwd })), projectId).catch(() => []) : [];
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nSessions: ${JSON.stringify(sessions)}\n${log}\n${diagnostics.join('\n').slice(-16_384)}`);
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
    await app.electron.close();
    rmSync(catalogDir, { recursive: true, force: true });
  }
});
