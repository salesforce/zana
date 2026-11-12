import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

async function installDesignDocs(win: Page): Promise<void> {
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');
}

async function seedProjectDocs(win: Page, home: string, names: string[]): Promise<void> {
  for (const name of names) {
    const projectPath = join(home, `design-docs-group-${name}`);
    mkdirSync(projectPath, { recursive: true });
    await win.evaluate(async ({ path, title }) => {
      const result = await window.cc.projects.add(path);
      if (!result.ok) throw new Error(result.message);
      await window.cc.pluginApps.callRpc('design-docs', 'create', { title, template: 'technical', projectId: result.value.id });
    }, { path: projectPath, title: `${name} spec` });
  }
}

/** Rendered rectangle of the button's ::after tooltip (anchored to the button's right edge, below it). */
async function tooltipRect(button: Locator) {
  return button.evaluate((el) => {
    const tip = getComputedStyle(el, '::after');
    const px = (value: string) => parseFloat(value) || 0;
    const extra = tip.boxSizing === 'border-box' ? 0
      : px(tip.paddingLeft) + px(tip.paddingRight) + px(tip.borderLeftWidth) + px(tip.borderRightWidth);
    const rect = el.getBoundingClientRect();
    const width = px(tip.width) + extra;
    return { content: tip.content, left: rect.right - width, right: rect.right, width, viewport: window.innerWidth };
  });
}

async function expectTooltipInWindow(button: Locator, text: string): Promise<void> {
  await button.hover();
  await expect.poll(async () => (await tooltipRect(button)).content).toContain(text);
  const tip = await tooltipRect(button);
  expect(tip.width).toBeGreaterThan(0);
  expect(tip.left).toBeGreaterThanOrEqual(0);
  expect(tip.right).toBeLessThanOrEqual(tip.viewport);
}

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('Design Docs list: group toggle flips, collapse-all works, and controls disable instead of vanishing', async ({ app, home }, testInfo) => {
  test.setTimeout(150_000);
  const win = app.window;
  await win.setViewportSize({ width: 1100, height: 800 }).catch(() => undefined);
  await installDesignDocs(win);
  await seedProjectDocs(win, home, ['alpha', 'beta']);

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  const group = win.getByRole('button', { name: 'Group by project' });
  const collapse = win.getByRole('button', { name: /all sections$/ });
  await expect(group).toBeVisible({ timeout: 20_000 });
  await expect(group).toHaveAttribute('aria-pressed', 'true');
  await expect(win.getByText('alpha spec')).toBeVisible();

  // Tooltip is instant (data-tip, not native title) and its full rectangle stays inside the window.
  await expectTooltipInWindow(group, 'Grouped by project');
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
  await expectTooltipInWindow(group, 'Flat list');

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
