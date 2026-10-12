import { test, expect } from './fixtures/app.js';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('global and focused project menus open the checkout in external editors through Electron', async ({ app, home }, testInfo) => {
  test.skip(process.platform === 'win32', 'POSIX editor launch fixtures');
  const win = app.window;
  const projectPath = join(home, 'editor project with spaces');
  mkdirSync(projectPath);
  const canonicalProjectPath = realpathSync(projectPath);
  const log = join(home, 'editor-open.log');
  const binaries = Object.fromEntries(['cursor', 'code', 'intellij'].map(target => {
    const binary = join(home, `fake-${target}`);
    writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' '${target}' "$@" >> "$HOME/editor-open.log"\n`, { mode: 0o700 });
    return [target, binary];
  }));
  await win.evaluate(async ({ path, binaries }) => {
    await window.cc.config.set({ editorCursorBinary: binaries.cursor, editorCodeBinary: binaries.code, editorIntellijBinary: binaries.intellij });
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
  }, { path: projectPath, binaries });
  await win.getByTestId('nav-inbox').click();
  const globalRow = win.locator('.sidebar--global .project-item').filter({ hasText: 'editor project with spaces' });
  await expect(globalRow).toBeVisible();
  await globalRow.click({ button: 'right' });
  const menu = win.locator('.project-menu');
  await expect(menu.getByRole('button', { name: 'Open in Cursor', exact: true })).toBeVisible();
  if (process.env.ZCC_PROJECT_MENU_SCREENSHOTS === '1') {
    await win.screenshot({ path: testInfo.outputPath('project-menu-global.png'), animations: 'disabled' });
  }
  await menu.getByRole('button', { name: 'Open in Cursor', exact: true }).click();
  await expect.poll(() => { try { return readFileSync(log, 'utf8'); } catch { return ''; } }).toBe(`cursor\n-n\n${canonicalProjectPath}\n`);
  await expect(menu).toHaveCount(0);

  await globalRow.getByRole('button', { name: 'Open editor project with spaces', exact: true }).click();
  const focusedRail = win.getByTestId('project-session-rail');
  await expect(focusedRail).toBeVisible();
  // Desktop single-project views name the project in the titlebar, which owns
  // its actions menu; the rail no longer repeats a project row.
  await expect(focusedRail.locator('.project-item')).toHaveCount(0);
  const focusedRow = win.getByTestId('titlebar-project');
  await expect(focusedRow).toHaveText('editor project with spaces');
  await focusedRow.click({ button: 'right' });
  await expect(menu.getByRole('button', { name: 'Open in VS Code', exact: true })).toBeVisible();
  if (process.env.ZCC_PROJECT_MENU_SCREENSHOTS === '1') {
    await win.screenshot({ path: testInfo.outputPath('project-menu-focused.png'), animations: 'disabled' });
  }
  await menu.getByRole('button', { name: 'Open in VS Code', exact: true }).click();
  await expect.poll(() => readFileSync(log, 'utf8')).toContain(`code\n-n\n${canonicalProjectPath}\n`);
  await win.getByRole('button', { name: 'Project actions for editor project with spaces' }).focus();
  await win.keyboard.press('Enter');
  // The first action receives focus; Tab reaches the remaining editors.
  await expect(menu.getByRole('button', { name: 'Open in Cursor' })).toBeFocused();
  await menu.getByRole('button', { name: 'Open in IntelliJ IDEA' }).click();
  await expect.poll(() => readFileSync(log, 'utf8')).toContain(`intellij\n${canonicalProjectPath}\n`);
  await focusedRow.click({ button: 'right' });
  const bounds = await menu.boundingBox();
  const viewport = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(bounds!.x).toBeGreaterThanOrEqual(8);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 7);
  await win.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await focusedRow.click({ button: 'right' });
  await menu.getByRole('button', { name: 'Project settings…' }).click();
  await expect(win.getByRole('heading', { name: 'Project settings', exact: true })).toBeVisible();
});
