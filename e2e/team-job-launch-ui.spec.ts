import { test, expect } from './fixtures/app';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true });

test('launching a team job through the UI', async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-launch-job-proj-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  try {
    await window.evaluate(() => window.cc.config.set({
      teamJobLaunchEnabled: true,
      teamLaunchEnabled: true
    }));

    await window.evaluate(() => window.cc.personas.save({
      id: 'test-persona',
      name: 'Test Persona',
      description: 'Test',
      baseProfile: 'shell',
      permissionMode: 'ask',
      systemPrompt: ''
    }));

    await window.evaluate(() => window.cc.teams.save({
      id: 'test-team',
      name: 'Test Team',
      description: 'Test Team',
      slots: [{ personaId: 'builtin:software-engineer' }],
      orchestratorPersonaId: undefined
    }));

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string; };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    await window.locator('[data-testid="nav-projects"]').click();
    await window.locator('button[aria-label="Reload project list"]').click();

    await window.locator('[data-testid="nav-agents"]').click();

    const newBtn = window.locator('[data-testid="agents-new"]');
    const newEmptyBtn = window.locator('[data-testid="agents-new-empty"]');
    if (await newBtn.count()) {
      await newBtn.click();
    } else {
      await newEmptyBtn.click();
    }

    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal).toBeVisible();

    // Select 'Launch as job'
    await modal.getByRole('button', { name: 'Launch as job' }).click();

    // Fill goal
    const instruction = modal.locator('[data-testid="launch-instruction"]');
    await instruction.fill('run some job test');
    await expect(instruction).toHaveValue('run some job test');

    // Pick target project
    const targetProject = modal.getByRole('button', { name: 'Target project' });
    await targetProject.click();
    await window.getByRole('listbox', { name: 'Target project' }).getByRole('option', { name: projectName, exact: true }).click();
    
    // Pick team
    const teamHarness = modal.locator('.launch-persona', { hasText: 'Test Team' }).first();
    await teamHarness.click();

    // Launch
    await modal.getByRole('button', { name: 'Launch job' }).click();

    const err = modal.locator('.launch-error-text');
    if (await err.count() > 0) {
      console.log('Error:', await err.textContent());
    }

    // Modal should close
    await expect(modal).toBeHidden();
    
    // Agents board should appear and have our job card (which is rendered in Working lane)
    await expect(window.locator('.lane-working').first()).toBeVisible();

  } finally {
    if (projectId) {
      await window.evaluate(async (pid) => {
        try {
          await window.cc.projects.remove(pid);
        } catch {}
      }, projectId);
    }
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {}
  }
});
