import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('Design Docs list: group toggle flips, collapse-all works, and controls disable instead of vanishing', async ({ app, home }, testInfo) => {
  test.setTimeout(150_000);
  const win = app.window;
  await win.setViewportSize({ width: 1100, height: 800 }).catch(() => undefined);
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');

  for (const name of ['alpha', 'beta']) {
    const projectPath = join(home, `design-docs-group-${name}`);
    mkdirSync(projectPath, { recursive: true });
    await win.evaluate(async ({ path, title }) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      await window.cc.pluginApps.callRpc('design-docs', 'create', { title, template: 'technical', projectId: result.value.id });
    }, { path: projectPath, title: `${name} spec` });
  }

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  const group = win.getByRole('button', { name: 'Group by project' });
  const collapse = win.getByRole('button', { name: /all sections$/ });
  await expect(group).toBeVisible({ timeout: 20_000 });
  await expect(group).toHaveAttribute('aria-pressed', 'true');
  await expect(win.getByText('alpha spec')).toBeVisible();

  // Tooltip is visible, not clipped by the window, and instant (data-tip, not native title).
  await group.hover();
  const tip = await group.evaluate((el) => {
    const style = getComputedStyle(el, '::after');
    return { content: style.content, left: el.getBoundingClientRect().right, win: window.innerWidth };
  });
  expect(tip.content).toContain('Grouped by project');
  expect(tip.left).toBeLessThanOrEqual(tip.win);
  await testInfo.attach('grouped', { body: await win.screenshot(), contentType: 'image/png' });

  // Collapse all hides every row; the same button then expands them.
  await expect(collapse).toBeEnabled();
  await collapse.click();
  await expect(win.getByText('alpha spec')).toHaveCount(0);
  await expect(win.getByRole('button', { name: 'Expand all sections' })).toBeVisible();
  await win.getByRole('button', { name: 'Expand all sections' }).click();
  await expect(win.getByText('alpha spec')).toBeVisible();

  // Flat mode keeps both buttons: toggle un-pressed, collapse-all disabled.
  await group.click();
  await expect(group).toHaveAttribute('aria-pressed', 'false');
  await expect(collapse).toBeDisabled();
  await expect(win.getByText('alpha spec')).toBeVisible();
  await testInfo.attach('flat', { body: await win.screenshot(), contentType: 'image/png' });
  await group.hover();
  await expect.poll(() => group.evaluate((el) => getComputedStyle(el, '::after').content)).toContain('Flat list');

  // Search disables collapse-all even when grouped.
  await group.click();
  await win.getByLabel('Search design docs').fill('alpha');
  await expect(collapse).toBeDisabled();
  await win.getByLabel('Search design docs').fill('');

  // A project filter keeps both buttons and disables them.
  await win.getByRole('button', { name: 'Filter by project' }).click();
  await win.getByRole('option', { name: /alpha/i }).click();
  await expect(group).toBeDisabled();
  await expect(collapse).toBeDisabled();
});
