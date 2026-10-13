import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

// The desktop session denies Chromium's clipboard permission, so a copy that
// relies on navigator.clipboard alone fails here while passing in jsdom.
test('Design Docs list menu copies the chat reference and id to the system clipboard', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');

  const projectPath = join(home, 'design-docs-menu-project');
  mkdirSync(projectPath, { recursive: true });
  const docId = await win.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    const doc = await window.cc.pluginApps.callRpc('design-docs', 'create', {
      title: 'Menu copy doc',
      template: 'technical',
      projectId: result.value.id
    }) as { id: string };
    return doc.id;
  }, projectPath);
  const clipboard = () => app.electron.evaluate(({ clipboard }) => clipboard.readText());
  await app.electron.evaluate(({ clipboard }) => clipboard.writeText(''));

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  const row = win.getByText('Menu copy doc').first();

  await row.click({ button: 'right' });
  await win.getByRole('menuitem', { name: /Copy chat reference/ }).click();
  await expect(win.getByText('Copied reference')).toBeVisible();
  await expect.poll(clipboard).toBe(`::design-doc{id="${docId}"}`);

  await row.click({ button: 'right' });
  await win.getByRole('menuitem', { name: /Copy id/ }).click();
  await expect.poll(clipboard).toBe(docId);
  await expect(win.getByText(/Could not copy/)).toHaveCount(0);
});
