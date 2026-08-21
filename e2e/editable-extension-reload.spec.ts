/**
 * Editable extension E2E: drive the visible folder-import control in a booted
 * Electron app, then prove a source dist/ edit is automatically reinstalled
 * while a shell session remains rooted in that imported source directory.
 */
import { test, expect } from './fixtures/app.js';
import { stubOpenDialog } from './sdk/native-dialog.js';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ID = 'editable-e2e-a1b2';

function writeExtension(dir: string, marker: string): void {
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'extension.json'),
    JSON.stringify({
      id: ID,
      version: '1.0.0',
      title: 'Editable E2E',
      icon: 'Sparkles',
      entry: { renderer: 'dist/renderer.js' },
      engines: { zccApi: '^1.0.0' },
      permissions: [],
      projectTab: { label: 'Editable E2E', icon: 'Sparkles', global: true }
    })
  );
  writeFileSync(
    join(dir, 'dist', 'renderer.js'),
    `export default { activate({ React }) { return { panel: () => React.createElement('div', { className: 'editable-e2e-panel' }, '${marker}') }; } };\n`
  );
}

test('imported editable folder automatically reloads a rebuilt dist while its shell session is open', async ({ app, home }) => {
  const source = mkdtempSync(join(tmpdir(), 'zcc-editable-e2e-'));
  const installedRenderer = join(home, '.zcc', 'extensions', ID, 'dist', 'renderer.js');
  let sessionId: string | undefined;

  try {
    writeExtension(source, 'initial-marker');
    // This is the user-facing path: Settings → Extensions → Import editable folder.
    await app.window.locator('.nav-item', { hasText: 'Settings' }).first().click();
    await app.window
      .locator('.settings-section-item')
      .filter({ has: app.window.locator('.project-name', { hasText: 'Extensions' }) })
      .click();
    const importButton = app.window.getByRole('button', { name: 'Open existing extension' });
    await expect(importButton).toBeVisible();
    await importButton.click();
    const dialog = app.window.locator('[role="dialog"][aria-label="Open an existing extension"]');
    await expect(dialog).toBeVisible();
    await stubOpenDialog(app.electron, [[source]]);
    await dialog.getByRole('button', { name: 'Choose folder…' }).click();
    await expect.poll(() => app.window.evaluate(async (id) => {
      const list = await window.cc.extensions.list();
      return list.some((entry) => entry.id === id && entry.source === 'local');
    }, ID)).toBe(true);

    const imported = await app.window.evaluate(async (id) => {
      const list = await window.cc.extensions.list();
      const entry = list.find((item) => item.id === id);
      if (!entry) throw new Error('Imported extension was not listed');
      const info = await window.cc.extensions.localInfo(id);
      if (!info.ok) throw new Error(info.message);
      return { source: entry.source, projectId: info.value.projectId, manifest: entry.manifest };
    }, ID);
    expect(imported.source).toBe('local');
    expect(imported.manifest?.projectTab?.global).toBe(true);
    expect(readFileSync(installedRenderer, 'utf8')).toContain('initial-marker');
    const consent = app.window.locator('.consent-overlay');
    if (await consent.isVisible().catch(() => false)) {
      await consent.getByRole('button', { name: 'Allow' }).click();
      await expect(consent).toBeHidden();
    }
    // Ensure the renderer receives a fresh extension-list event before asserting
    // the dynamically imported panel. No rescan occurs after the source edit.
    const rescan = await app.window.evaluate(() => window.cc.extensions.rescan());
    expect(rescan.ok).toBe(true);
    const extensionNav = app.window.locator('.nav-item', { hasText: 'Editable E2E' }).first();
    await expect(extensionNav).toBeVisible();
    await extensionNav.click();
    await expect(app.window.locator('.editable-e2e-panel')).toHaveText('initial-marker');

    // A source-rooted session is the bounded condition that arms auto-reload.
    const created = await app.window.evaluate(
      ({ projectId, cwd }) => window.cc.terminals.create({ projectId, profile: 'shell', cols: 80, rows: 24, cwd }),
      { projectId: imported.projectId, cwd: source }
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.message);
    sessionId = created.value.id;

    writeExtension(source, 'reloaded-marker');
    await expect.poll(() => readFileSync(installedRenderer, 'utf8'), { timeout: 10_000 }).toContain('reloaded-marker');
    await expect(app.window.locator('.editable-e2e-panel')).toHaveText('reloaded-marker', { timeout: 10_000 });
  } finally {
    if (sessionId) await app.window.evaluate((id) => window.cc.terminals.close(id), sessionId).catch(() => {});
    rmSync(source, { recursive: true, force: true });
  }
});
