import { test, expect } from './fixtures/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test('launching agent after pasting absolute path works', async ({ app }) => {
  const window = app.window;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-launch-paste-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;
  try {
  projectId = await window.evaluate(async (path) => {
    const res = await window.cc.projects.add(path);
    const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
      id: string;
    };
    return proj.id;
  }, projectDir);
  expect(projectId).toBeTruthy();

  await window.locator('[data-testid="nav-agents"]').click();
  await window.locator('[data-testid="agents-board-new-thread"]').first().click();
  const modal = window.locator('[data-testid="launch-modal"]');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'CLI Agent' }).click();

  const instruction = modal.getByTestId('legacy-agent-command-input');
  await instruction.waitFor({ state: 'visible' });
  await instruction.focus();
  
  const pasteText = "Read /tmp/issue.md and then ask me a question about it";
  await instruction.fill(pasteText);
  await expect(instruction).toContainText('issue.md');

  // Wait for the menu to definitively NOT be there
  await expect(modal.getByTestId('composer-typeahead-menu')).toHaveCount(0);

  const targetProject = modal.getByRole('button', { name: 'Project' });
  await targetProject.click();
  await window
    .getByRole('listbox', { name: 'Project' })
    .getByRole('option', { name: projectName, exact: true })
    .click();
  await expect(targetProject).toContainText(projectName);

  const send = modal.getByTestId('legacy-agent-command-send');
  await expect(send).toBeEnabled({ timeout: 15_000 });
  
  // Press Enter first
  await instruction.press('Enter');
  
  const term = window.locator('.xterm-helper-textarea');
  await term.waitFor({ state: 'attached', timeout: 15_000 });
  } finally {
    if (projectId && !window.isClosed()) {
      await window
        .evaluate(async (pid) => {
          try {
            await window.cc.projects.remove(pid);
          } catch {
            /* best-effort */
          }
        }, projectId)
        .catch(() => undefined);
    }
    rmSync(projectDir, { recursive: true, force: true });
  }
});
