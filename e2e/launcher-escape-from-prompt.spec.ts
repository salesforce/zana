/**
 * Esc must close the launch dialog while the prompt box has focus, on every
 * launch tab. Driven through the real DOM (rail "+" beside a project), the way
 * a user opens it. An Esc that closes the `/` typeahead menu must NOT also
 * close the dialog.
 */
import { test, expect } from './fixtures/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true });

test('Esc closes the launch dialog from the focused prompt box on every tab', { timeout: 120_000 }, async ({ app }) => {
  const { window } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-esc-'));
  try {
    await window.evaluate(async (path) => { await window.cc.projects.add(path); }, projectDir);
    const modal = window.locator('[data-testid="launch-modal"]');
    const plus = window.getByRole('button', { name: `New agent in ${basename(projectDir)}` }).first();

    for (const mode of ['agent', 'thread', 'team'] as const) {
      await plus.click();
      await expect(modal).toBeVisible();
      const tab = modal.locator(`[data-launch-mode="${mode}"]`);
      if (mode === 'team' && (await tab.count()) === 0) {
        // The team tab only shows when teams exist or the autonomous-team setting is on; a fresh profile has neither.
        test.info().annotations.push({ type: 'team-tab', description: 'not offered in this profile; skipped' });
        await window.keyboard.press('Escape');
        continue;
      }
      await expect(tab, `the ${mode} launch tab should exist`).toHaveCount(1);
      await tab.click();
      const editor = modal.locator('.ProseMirror, textarea, [contenteditable="true"]').first();
      await editor.click();
      await expect(editor).toBeFocused();
      await window.keyboard.press('Escape');
      await expect(modal, `Esc from the ${mode} prompt box should close the dialog`).toBeHidden();

      // And after typing.
      await plus.click();
      await expect(modal).toBeVisible();
      await modal.locator(`[data-launch-mode="${mode}"]`).click();
      await editor.click();
      await window.keyboard.type('hello');
      await window.keyboard.press('Escape');
      await expect(modal, `Esc after typing in the ${mode} prompt box should close the dialog`).toBeHidden();
    }

    // The first Esc closes an open "/" menu only; the second closes the dialog.
    await plus.click();
    await expect(modal).toBeVisible();
    await modal.locator('[data-launch-mode="agent"]').click();
    await modal.locator('.ProseMirror').first().click();
    // The launcher keeps its draft across close and reopen, so start from an empty box: "/" only opens the menu at the start.
    await window.keyboard.press('Control+A');
    await window.keyboard.press('Backspace');
    await window.keyboard.type('/');
    const menu = window.getByTestId('composer-typeahead-menu');
    await expect(menu).toBeVisible();
    await window.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(modal, 'closing the typeahead menu must not close the dialog').toBeVisible();
    await window.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  } finally {
    // Best-effort: the app may still hold the directory open on Windows.
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* temp dir; the OS reclaims it */ }
  }
});
