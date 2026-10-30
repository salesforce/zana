import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true } });

test('inset workspace is the standard desktop design and ignores retired opt-outs', async ({ app }) => {
  const { window: page, home } = app;
  const root = join(home, 'inset-workspace');
  mkdirSync(root);
  const threadId = await page.evaluate(async (root) => {
    const project = await window.cc.projects.add(root);
    if (!project.ok) throw new Error(project.message);
    const response = await fetch('/api/v1/threads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Inset workspace check' }) });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, root);
  await page.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, threadId);
  await expect(page.getByRole('heading', { name: 'Inset workspace check', exact: true })).toBeVisible();
  const show = page.getByTestId('thread-secondary-show');
  if (await show.isVisible()) await show.click();

  const shell = page.locator('.app-shell');
  await expect(shell).toHaveClass(/shell-inset/);
  // The shell-level track that hosts the thread (a split workspace or a bare thread view).
  const geometry = () => page.locator('.shell-main').evaluate((main) => {
    const el = [...main.children].find((child) => child.querySelector('.thread-detail-view') || child.matches('.thread-detail-view'))!;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    // Measure against the shell, not window.inner*: the desktop renderer zoom skews viewport units.
    const shellBox = main.closest('.app-shell')!.getBoundingClientRect();
    return { radius: style.borderTopLeftRadius, bottomGap: shellBox.bottom - box.bottom, rightGap: shellBox.right - box.right };
  });
  const inset = await geometry();
  expect(inset.radius).toBe('10px');
  expect(inset.rightGap).toBeGreaterThanOrEqual(6);
  expect(inset.bottomGap).toBeGreaterThanOrEqual(6);

  // The sheet must not take over overflow: long panels keep their own scroller.
  await page.evaluate(() => { history.pushState({}, '', '/settings/experimental'); dispatchEvent(new PopStateEvent('popstate')); });
  const settings = page.locator('.shell-main > .settings-panel');
  await expect(settings).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Inset workspace', exact: true })).toHaveCount(0);
  await expect(settings).toHaveCSS('overflow-y', 'auto');
  await expect.poll(() => settings.evaluate((el) => { el.scrollTop = 200; return el.scrollTop; })).toBeGreaterThan(0);
  await page.evaluate(id => { history.pushState({}, '', `/threads/${id}`); dispatchEvent(new PopStateEvent('popstate')); }, threadId);
  await expect(page.getByRole('heading', { name: 'Inset workspace check', exact: true })).toBeVisible();

  // Older clients may still send the retired opt-out; it must not alter the layout.
  await page.evaluate(() => window.cc.config.set({ insetWorkspaceEnabled: false } as never));
  await expect(shell).toHaveClass(/shell-inset/);
  await page.reload();
  await expect(shell).toHaveClass(/shell-inset/);
  expect((await geometry()).radius).toBe('10px');
});
