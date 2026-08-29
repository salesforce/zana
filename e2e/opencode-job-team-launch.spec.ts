import { test, expect } from './fixtures/app';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true, initialConfig: { teamLaunchEnabled: true } });

test('Job Team binds OpenCode kickoff without Claude-only argv flags', async ({ app }) => {
  const { window } = app;
  const root = mkdtempSync(join(tmpdir(), 'zcc-opencode-job-team-'));
  const projectDir = join(root, 'project');
  const binary = join(root, 'fake-opencode');
  const invocations = join(root, 'invocations');
  mkdirSync(projectDir);
  writeFileSync(binary, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "1.18.10"; exit 0; fi
if [ "$1" = "agent" ] && [ "$2" = "list" ]; then echo "build (primary)"; exit 0; fi
if [ "$1" = "debug" ] && [ "$2" = "agent" ]; then echo '{"hidden":false}'; exit 0; fi
printf '<%s>\\n' "$@" >> '${invocations}'
cat
`);
  chmodSync(binary, 0o755);
  let projectId = '';

  try {
    projectId = await window.evaluate(async (path) => {
      const result = await window.cc.projects.add(path) as { value?: { id: string }; id?: string };
      return result.value?.id ?? result.id ?? '';
    }, projectDir);
    expect(projectId).toBeTruthy();
    await window.evaluate(async (bin) => {
      await window.cc.config.set({ harnessOpenCodeEnabled: true, opencodeBinary: bin });
      await window.cc.personas.save({ id: 'opencode-job-worker', name: 'OpenCode Job Worker', baseProfile: 'opencode' });
      await window.cc.personas.save({ id: 'opencode-job-coordinator', name: 'OpenCode Job Coordinator', baseProfile: 'opencode' });
      await window.cc.teams.save({
        id: 'opencode-job-team', name: 'OpenCode Job Team',
        slots: [{ personaId: 'opencode-job-worker' }],
        orchestratorPersonaId: 'opencode-job-coordinator'
      });
    }, binary);

    await window.locator('[data-testid="nav-projects"]').click();
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('[data-testid="nav-agents"]').click();
    const newButton = window.locator('[data-testid="agents-new"]');
    if (await newButton.count()) await newButton.click();
    else await window.locator('[data-testid="agents-new-empty"]').click();
    const modal = window.locator('[data-testid="launch-modal"]');
    await modal.getByRole('button', { name: 'Job Team' }).click();
    await modal.locator('[data-testid="launch-instruction"]').fill('Verify OpenCode Job Team launch.');
    await modal.getByRole('button', { name: 'Target project' }).click();
    await window.getByRole('listbox', { name: 'Target project' })
      .getByRole('option', { name: basename(projectDir), exact: true }).click();
    await modal.locator('.launch-persona', { hasText: 'OpenCode Job Team' }).click();
    await modal.getByRole('button', { name: 'Launch job team' }).click();

    await expect.poll(() => existsSync(invocations) ? readFileSync(invocations, 'utf8') : '')
      .toContain('--prompt');
    const argv = readFileSync(invocations, 'utf8');
    expect(argv).toContain('Job Team worker standby');
    expect(argv).toContain('Verify OpenCode Job Team launch.');
    expect(argv).not.toContain('--allowedTools');
    expect(argv).not.toContain('--disallowedTools');
  } finally {
    if (projectId) await window.evaluate((id) => window.cc.projects.remove(id).catch(() => {}), projectId);
    await window.evaluate(() => window.cc.config.set({ harnessOpenCodeEnabled: undefined, opencodeBinary: undefined })).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
