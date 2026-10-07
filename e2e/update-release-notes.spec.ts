import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

// Pre-update release notes at the real Electron boundary: main's updater status
// (here the ZCC_FAKE_UPDATE dev shim) carries normalized notes over IPC, the
// banner offers "What's new", and the What's New modal previews them with the
// install action — before anything is downloaded.
test('update banner previews the offered version’s release notes before installing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'zcc-e2e-update-notes-'));
  const notesDir = join(home, 'release-notes');
  mkdirSync(notesDir, { recursive: true });
  writeFileSync(
    join(notesDir, '2.3.3.md'),
    [
      '# What’s new in 9.9.9',
      '',
      '**Read release notes before you update.** The update banner now links to the notes for the version it offers.',
      '',
      '## New',
      '',
      '- **What’s new, before installing.** Click *What’s new* in the update banner to read the notes from the release feed.',
      '- **Every release you missed.** Skipping several versions shows the notes for each one, newest first.',
      '',
      '## Fixed',
      '',
      '- Release notes no longer require a website visit.'
    ].join('\n')
  );
  const app = await launchApp(home, {
    env: { ZCC_FAKE_UPDATE: '9.9.9', ZCC_RELEASE_NOTES_DIR: notesDir },
    initialConfig: { sponsorPromptDismissed: true }
  });
  try {
    const { window } = app;
    const banner = window.locator('.update-banner');
    await expect(banner).toContainText('Version 9.9.9 is available.', { timeout: 30_000 });
    await banner.getByRole('button', { name: 'What’s new' }).click();

    const dialog = window.getByRole('dialog', { name: 'What’s new in v9.9.9' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Every release you missed.');
    await expect(dialog.getByRole('button', { name: 'Update now' })).toBeVisible();
    await window.screenshot({ path: test.info().outputPath('update-release-notes.png') });
    if (process.env.ZCC_E2E_SCREENSHOT_PATH) await window.screenshot({ path: process.env.ZCC_E2E_SCREENSHOT_PATH });

    await dialog.getByRole('button', { name: 'Later' }).click();
    await expect(dialog).toBeHidden();
    await expect(banner).toContainText('Version 9.9.9 is available.');
  } finally {
    await closeApp(app.electron);
    // Shutdown may finish while an owned child is completing its last write.
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
