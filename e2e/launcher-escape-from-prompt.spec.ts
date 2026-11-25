/**
 * Esc must close the launch dialog while the prompt box has focus, on every
 * launch tab. Driven through the real DOM (rail "+" beside a project), the way
 * a user opens it.
 */
import { test, expect } from './fixtures/app.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true });

test('Esc closes the launch dialog from the focused prompt box on every tab', { timeout: 90_000 }, async ({ app }) => {
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
      if (await tab.count() === 0) { await window.keyboard.press('Escape'); await expect(modal).toBeHidden(); continue; }
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
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
