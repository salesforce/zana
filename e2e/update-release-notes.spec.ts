import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';

const currentVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

for (const maximized of [false, true]) {
  test(`post-update release notes preserve a ${maximized ? 'maximized' : 'windowed'} window`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'zcc-e2e-post-update-bounds-'));
    const notesDir = join(home, 'release-notes');
    mkdirSync(notesDir);
    writeFileSync(join(notesDir, `${currentVersion}.md`), '# Updated successfully\n\nKeep the previous window size.');
    const opts = {
      // Keep the first renderer: its startup pull consumes the one-shot release notes.
      tutorialDiscovery: true,
      useAppManifest: true,
      env: { ZCC_RELEASE_NOTES_DIR: notesDir },
      initialConfig: {
        sponsorPromptDismissed: true,
        lastSeenVersion: '0.0.1',
        windowBounds: { x: 0, y: 0, width: 1000, height: 650 },
        windowMaximized: maximized
      }
    };
    let app: Awaited<ReturnType<typeof launchApp>> | undefined;
    try {
      app = await launchApp(home, opts);
      const readState = () => app!.electron.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed() && candidate.webContents.getURL().startsWith('http://127.0.0.1:'));
        if (!win) throw new Error('Main window not found');
        return { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), bounds: win.getNormalBounds() };
      });
      const expectedBounds = await app.electron.evaluate(({ screen }) => {
        const area = screen.getPrimaryDisplay().workArea;
        return { x: area.x, y: area.y, width: Math.min(1000, area.width), height: Math.min(650, area.height) };
      });
      const dialog = app.window.getByRole('dialog', { name: `What’s new in v${currentVersion}` });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Keep the previous window size.');
      await expect.poll(readState).toEqual({ maximized, fullscreen: false, bounds: expectedBounds });
      await dialog.getByRole('button', { name: 'Got it', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(readState).toEqual({ maximized, fullscreen: false, bounds: expectedBounds });

      await closeApp(app.electron);
      app = undefined;
      const config = JSON.parse(readFileSync(join(home, '.zcc', 'config.json'), 'utf8'));
      // Startup may clamp an old off-screen position without rewriting it.
      // Verify the effective geometry after relaunch below.
      expect(config.windowMaximized).toBe(maximized);

      // A second restart must retain the same state after the notes were consumed.
      app = await launchApp(home, opts);
      await expect.poll(readState).toEqual({ maximized, fullscreen: false, bounds: expectedBounds });
      await expect(app.window.getByRole('dialog', { name: `What’s new in v${currentVersion}` })).toBeHidden();
    } finally {
      if (app) await closeApp(app.electron);
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}

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
