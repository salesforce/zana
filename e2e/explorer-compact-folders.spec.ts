import { test, expect } from './fixtures/app.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

test('Explorer shows single-child folder chains as one row', async ({ app, home }) => {
  const { window } = app;
  const root = join(home, 'explorer compact');
  mkdirSync(join(root, 'src', 'main', 'java'), { recursive: true });
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'src', 'main', 'java', 'App.java'), 'class App {}\n');
  writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n');
  await window.evaluate(async path => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
  }, root);

  const heading = window.getByTestId('sidebar-projects-heading');
  if (await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await window.getByRole('button', { name: 'Open explorer compact', exact: true }).click();
  await window.getByTestId('project-nav-explorer').click();

  const row = (name: string) => window.locator(`.tree-row[data-path$="/${name}"]`);
  await row('src').click();
  // The chain collapses into one row labelled src/main/java and its file is visible.
  await expect(window.locator('.tree-row .tree-name', { hasText: 'src/main/java' })).toBeVisible();
  await expect(row('App.java')).toBeVisible();
  await expect(row('main')).toHaveCount(0);

  // A folder with several children stays a plain row.
  await row('docs').click();
  await expect(row('guide.md')).toBeVisible();

  // Collapsing the chain's last folder hides its file but keeps the compact row.
  await row('java').click();
  await expect(row('App.java')).toHaveCount(0);
  await expect(window.locator('.tree-row .tree-name', { hasText: 'src/main/java' })).toBeVisible();
});
