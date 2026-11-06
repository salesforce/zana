import { test, expect } from './fixtures/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

for (const threadTabsEnabled of [false, true]) {
test.describe(`thread tabs ${threadTabsEnabled ? 'on' : 'off'}`, () => {
test.use({ e2e: true, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true, threadTabsEnabled } });

test('Ctrl/Cmd+, twice from a focused project terminal returns to the live terminal', async ({ app }) => {
  const { window: page } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-settings-terminal-'));
  const projectId = await page.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, projectDir);
  let sessionId: string | undefined;
  try {
    const heading = page.getByTestId('sidebar-projects-heading');
    if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
    await page.getByRole('button', { name: `Open ${basename(projectDir)}`, exact: true }).click();
    await page.getByTestId('project-nav-terminals').click();
    await page.locator('.empty-project').getByRole('button', { name: 'New terminal', exact: true }).click();
    const terminal = page.locator('.term .xterm').first();
    await expect(terminal).toBeVisible();
    sessionId = await page.evaluate(async (id) => {
      const shell = (await window.cc.terminals.list(id)).find((s) => s.profile === 'shell' && s.status !== 'exited');
      if (!shell) throw new Error('Missing shell created through the project UI');
      return shell.id;
    }, projectId);
    await page.evaluate((id) => window.cc.terminals.write(id, 'echo BEFORE_SETTINGS\r'), sessionId);
    await expect.poll(() => page.evaluate((id) => window.cc.terminals.backlog(id), sessionId!)).toContain('BEFORE_SETTINGS\r\n');
    const startUrl = page.url();

    await terminal.click();
    await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Comma');
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/settings$`));
    await expect(page.getByRole('heading', { name: 'Project settings' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Comma');
    await expect(page).toHaveURL(startUrl);

    await expect(terminal).toBeVisible();
    const box = await terminal.boundingBox();
    expect(box && box.width > 50 && box.height > 50).toBe(true);
    await terminal.click();
    await page.keyboard.type('echo TERMINAL_STILL_LIVE');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate((id) => window.cc.terminals.backlog(id), sessionId!)).toContain('TERMINAL_STILL_LIVE\r\n');
  } finally {
    if (sessionId) await page.evaluate((id) => window.cc.terminals.close(id), sessionId).catch(() => {});
    await page.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => {});
    // The shell can still hold its cwd for a moment after close on Windows.
    rmSync(projectDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
});
}
