import { test, expect } from './fixtures/app.js';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const exists = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

// An empty SHELL reads as unset. The CI e2e image has no zsh, so before the
// default-shell lookup this terminal spawned a missing /bin/zsh and exited.
test.use({ e2e: true, initialConfig: { tmuxScope: 'off' }, launchEnv: { SHELL: '' } });
test.skip(process.platform === 'win32', 'Windows keeps its previous default shell');

test('with SHELL unset, a new terminal runs the first shell that exists', async ({ app }) => {
  const { window: page } = app;
  const config = await page.evaluate(() => window.cc.config.get());
  expect(config.shell).not.toBe('');
  expect(exists(config.shell), `default shell ${config.shell} must exist`).toBe(true);
  if (!exists('/bin/zsh')) expect(config.shell).not.toBe('/bin/zsh');

  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-terminal-default-shell-'));
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
    await expect(page.locator('.term .xterm').first()).toBeVisible();
    sessionId = await page.evaluate(async (id) => {
      const shell = (await window.cc.terminals.list(id)).find((session) => session.profile === 'shell' && session.status !== 'exited');
      if (!shell) throw new Error('Missing shell created through the project UI');
      return shell.id;
    }, projectId);
    // The shell prints the joined marker only if it really runs the command.
    await page.evaluate((id) => window.cc.terminals.write(id, "echo DEFAULT_SHELL_''READY\r"), sessionId);
    await expect.poll(() => page.evaluate((id) => window.cc.terminals.backlog(id), sessionId!)).toContain('DEFAULT_SHELL_READY');
  } finally {
    if (sessionId) await page.evaluate((id) => window.cc.terminals.close(id), sessionId).catch(() => {});
    await page.evaluate((id) => window.cc.projects.remove(id), projectId).catch(() => {});
    rmSync(projectDir, { recursive: true, force: true });
  }
});
