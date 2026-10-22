import { test, expect } from './fixtures/app.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

const quickOpenChord = process.platform === 'darwin' ? 'Meta+E' : 'Control+E';

test('Quick Open focuses its input on the first open and Esc clears, then closes', async ({ app, home }) => {
  const { window } = app;
  const root = join(home, 'quick-open-focus');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{ "name": "quick-open-focus" }\n');
  writeFileSync(join(root, 'src', 'index.ts'), 'export {};\n');
  await window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
  }, root);

  const heading = window.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await window.getByRole('button', { name: 'Open quick-open-focus', exact: true }).click();
  const explorerNav = window.getByTestId('project-nav-explorer');
  await explorerNav.focus();

  // First open in this renderer: nothing is cached, so the input mounts while
  // the project is still being indexed.
  await window.keyboard.press(quickOpenChord);
  const input = window.getByRole('textbox', { name: 'Find file in quick-open-focus' });
  await expect(input).toBeFocused();
  await window.keyboard.type('index');
  await expect(input).toHaveValue('index');
  await expect(window.locator('.palette-item')).toHaveText(['src/index.ts']);

  await window.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();

  await window.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(explorerNav).toBeFocused();

  // From the command palette: the palette closes and Quick Open opens in one
  // update, and Esc hands focus back to what had it before the palette.
  await window.keyboard.press('ControlOrMeta+p');
  const paletteInput = window.getByRole('combobox', { name: 'Search commands and destinations' });
  await expect(paletteInput).toBeFocused();
  await paletteInput.fill('Find file in quick-open-focus');
  await expect(window.getByRole('option', { selected: true })).toContainText('Find file in quick-open-focus');
  await window.keyboard.press('Enter');
  await expect(window.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
  await expect(input).toBeFocused();
  await window.keyboard.type('index');
  await expect(window.locator('.palette-item')).toHaveText(['src/index.ts']);
  await window.keyboard.press('Escape');
  await window.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(explorerNav).toBeFocused();

  // Choosing a file opens it in the Explorer.
  await window.keyboard.press(quickOpenChord);
  await expect(input).toBeFocused();
  await window.keyboard.type('package');
  await window.keyboard.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(window.locator('.explorer-viewer-monaco .monaco-editor')).toContainText('quick-open-focus');
});
