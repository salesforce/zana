import { test, expect } from './fixtures/app.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

test('Explorer copies a relative path and collapses all folders', async ({ app, home }) => {
  const { window } = app;
  const root = join(home, 'explorer copy collapse');
  mkdirSync(join(root, 'src', 'lib'), { recursive: true });
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'src', 'lib', 'util.ts'), 'export const u = 1;\n');
  writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n');
  await window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
  }, root);

  const heading = window.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await window.getByRole('button', { name: 'Open explorer copy collapse', exact: true }).click();
  await window.getByTestId('project-nav-explorer').click();

  // File icons render extension text, so match rows by path rather than text.
  const row = (name: string) => window.locator(`.tree-row[data-path$="/${name}"]`);
  await row('src').click();
  await row('lib').click();
  await expect(row('util.ts')).toBeVisible();

  // The desktop session denies Chromium's clipboard, so read the system clipboard from main.
  await app.electron.evaluate(({ clipboard }) => clipboard.writeText(''));
  await row('util.ts').click({ button: 'right' });
  await window.getByText('Copy relative path').click();
  await expect.poll(() => app.electron.evaluate(({ clipboard }) => clipboard.readText())).toBe('src/lib/util.ts');

  await row('docs').click();
  await expect(row('guide.md')).toBeVisible();
  await window.getByRole('button', { name: 'Collapse all folders' }).click();
  await expect(row('util.ts')).toHaveCount(0);
  await expect(row('guide.md')).toHaveCount(0);
  await expect(row('src')).toBeVisible();
  await expect(row('docs')).toBeVisible();
});
