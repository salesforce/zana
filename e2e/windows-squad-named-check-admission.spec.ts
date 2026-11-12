import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

const WINDOWS_NAMED_CHECK_DIAGNOSTIC = 'Named checks are unsupported on Windows. Remove checks before launching.';
const PLAN = [
  '# Windows admission plan',
  '',
  '### inspect: Inspect fixture <!-- executable-step -->',
  '- Work: Read README.md.',
  '- Mode: read-only',
  '- Verification: README.md exists.',
  ''
].join('\n');

test.use({ e2e: true, initialConfig: {
  teamJobLaunchEnabled: true, composerShowAutonomousTeam: true, sponsorPromptDismissed: true,
  autoRenameTabs: false, tmuxScope: 'off'
} });

test('Windows rejects named checks in the visible Squad preview and direct launch before cohort spawn', async ({ app, home }) => {
  test.skip(process.platform !== 'win32', 'Windows-only named-check admission coverage');
  const { window } = app;
  const projectDir = join(home, 'windows named check project');
  let projectId: string | undefined;
  try {
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'README.md'), 'Windows named-check admission fixture.\n');
    const git = (...args: string[]) => execFileSync('git', args, {
      cwd: projectDir,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, 'gitconfig') }
    });
    git('init', '-b', 'main');
    git('add', 'README.md');
    git('-c', 'user.name=Windows Squad E2E', '-c', 'user.email=windows-squad@example.test', 'commit', '-m', 'Fixture setup');

    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message ?? 'projects.add failed');
      return result.value.id;
    }, projectDir);
    await window.evaluate(async () => {
      for (const persona of [
        { id: 'windows-check-coordinator', name: 'Windows Check Coordinator' },
        { id: 'windows-check-worker', name: 'Windows Check Worker' }
      ]) {
        const result = await window.cc.personas.save({ ...persona, baseProfile: 'claude', permissionMode: 'default', systemPrompt: '' });
        if (!result.ok) throw new Error(JSON.stringify(result));
      }
      const team = await window.cc.teams.save({
        id: 'windows-check-squad', name: 'Windows Check Squad', description: 'Admission-only fixture',
        slots: [{ personaId: 'windows-check-worker', quantity: 1 }], orchestratorPersonaId: 'windows-check-coordinator', defaultPlanning: 'provided'
      });
      if (!team.ok) throw new Error(JSON.stringify(team));
    });
    await window.evaluate(async (id) => {
      await window.cc.namedChecks.set({ kind: 'project', projectId: id }, [{ name: 'verify', command: 'node --version' }]);
    }, projectId);
    expect(await window.evaluate((id) => window.cc.namedChecks.get({ kind: 'project', projectId: id }), projectId)).toEqual([
      { name: 'verify', command: 'node --version' }
    ]);

    const projectRow = window.locator('.project-item').filter({ hasText: 'windows named check project' }).first();
    await expect(projectRow).toBeVisible();
    await projectRow.hover();
    await window.getByRole('button', { name: 'New agent in windows named check project' }).click();
    const modal = window.getByTestId('launch-modal');
    await modal.locator('.launch-segmented').getByRole('button', { name: 'Squad', exact: true }).click();
    await modal.getByLabel('Squad', { exact: true }).click();
    await window.getByRole('listbox', { name: 'Squad' }).getByRole('option', { name: 'Windows Check Squad' }).click();
    await modal.getByTestId('team-command-input').fill(PLAN);
    await modal.getByRole('button', { name: 'Customize launch' }).click();
    await modal.getByLabel('Named checks mode').selectOption('named');
    await modal.getByLabel('Named checks input').fill('verify');

    // Preview IPC intentionally gives the renderer no internal admission detail, but must fail closed.
    await expect(modal.getByLabel('Effective launch settings')).toContainText(
      'Launch preview could not validate the plan, sources, or target. Retry after correcting them.'
    );
    await expect(modal.getByTestId('team-command-send')).toBeDisabled();

    // A direct renderer-to-main admission attempt must expose the precise trusted diagnostic and still start nothing.
    const admitted = await window.evaluate(async ({ projectId, goal }) => window.cc.teams.startJob({
      teamId: 'windows-check-squad', projectId, goal, coordinationMode: 'structured', checks: ['verify']
    }), { projectId, goal: PLAN });
    expect(admitted).toEqual({ ok: false, code: 'ADMISSION_FAILED', message: WINDOWS_NAMED_CHECK_DIAGNOSTIC });
    expect((await window.evaluate(async (id) => (await window.cc.executionBoard.listProject(id)).executions, projectId))).toEqual([]);
    expect(await window.evaluate(async (id) => (await window.cc.terminals.list(id)).filter((session) => session.cohort), projectId)).toEqual([]);
  } finally {
    if (projectId) await window.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => undefined);
    rmSync(projectDir, { recursive: true, force: true });
  }
});
