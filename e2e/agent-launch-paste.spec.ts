import { test, expect } from './fixtures/app.js';

test('launching agent after pasting absolute path works', async ({ page, appWorkspace }) => {
  const window = await appWorkspace.start();
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

  const send = modal.getByTestId('legacy-agent-command-send');
  await expect(send).toBeEnabled({ timeout: 15_000 });
  
  // Press Enter first
  await instruction.press('Enter');
  
  const term = window.locator('.xterm-helper-textarea');
  await term.waitFor({ state: 'attached', timeout: 15_000 });
});
