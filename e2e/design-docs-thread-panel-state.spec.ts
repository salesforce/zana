/**
 * A Design Docs tab in a thread's side panel keeps its place when the user
 * visits another tab, after an app reload, and starts fresh once closed.
 * Nested `/threads/:id` URLs are driven through history + popstate (see
 * thread-secondary-panel.spec.ts).
 */
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({ initialConfig: { sponsorPromptDismissed: true } });

const OWNER = 'e2e-docs-state';

async function dismissTutorialHint(win: Page): Promise<void> {
  const hint = win.getByRole('button', { name: 'Dismiss tutorial hint', exact: true });
  await win.removeLocatorHandler(hint);
  if (await hint.isVisible()) await hint.click();
  await win.addLocatorHandler(hint, async button => { await button.click(); }, { times: 1 });
}

async function openThread(win: Page): Promise<void> {
  await expect(win.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 20_000 });
  await win.evaluate((owner) => {
    window.history.pushState({}, '', `/threads/${owner}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, OWNER);
  await expect(win.getByTestId('thread-detail')).toBeVisible({ timeout: 15_000 });
}

const tab = (win: Page, title: string) => win.locator('.thread-secondary-tab-label', { hasText: title });

test('Design Docs thread tab keeps its doc across tab switches, reloads and closing', async ({ app }) => {
  const win = app.window;
  await dismissTutorialHint(win);
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');
  await win.evaluate(async () => {
    await window.cc.pluginApps.callRpc('design-docs', 'create', { title: 'Keep my place', template: 'technical' });
  });

  // Seed a panel with a Design Docs tab (opened on the picker) beside the Info pin.
  await win.evaluate((owner) => {
    localStorage.setItem(`zcc.secondaryPanel.${owner}`, JSON.stringify({
      version: 1, isOpen: true, isMaximized: false, widthPx: 560, activeId: 'plugin:docs',
      tabs: [
        { id: 'plugin:docs', kind: 'plugin', title: 'Design Docs', moduleId: 'design-docs', actionId: 'design-doc', params: null }
      ]
    }));
  }, OWNER);
  await openThread(win);

  const panel = win.getByTestId('thread-secondary-panel');
  await expect(panel.getByText('Keep my place')).toBeVisible({ timeout: 30_000 });
  await panel.getByText('Keep my place').click();
  await expect(panel.getByTitle('Files in this doc')).toBeVisible({ timeout: 30_000 });

  // 1. Switch away and back: same doc, not the picker.
  await panel.getByTestId('thread-info-pin').click();
  await expect(win.getByTestId('thread-info-environment')).toBeVisible();
  await expect(panel.getByTitle('Files in this doc')).toBeHidden();
  await tab(win, 'Design Docs').click();
  await expect(panel.getByTitle('Files in this doc')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'All design docs' })).toBeVisible();

  // 2. Reload: the saved location is restored from the persisted tab.
  await expect.poll(() => win.evaluate((owner) => {
    const state = JSON.parse(localStorage.getItem(`zcc.secondaryPanel.${owner}`) ?? '{}') as { tabs?: Array<{ id: string; tabState?: { docId?: string } }> };
    return Boolean(state.tabs?.find((row) => row.id === 'plugin:docs')?.tabState?.docId);
  }, OWNER)).toBe(true);
  await win.reload();
  await openThread(win);
  await expect(win.getByTestId('thread-secondary-panel').getByTitle('Files in this doc')).toBeVisible({ timeout: 30_000 });

  // 3. Close and reopen: the new tab starts on the picker with no leftover state.
  await win.getByRole('button', { name: 'Close Design Docs' }).click();
  await expect(tab(win, 'Design Docs')).toHaveCount(0);
  const leftover = await win.evaluate((owner) => localStorage.getItem(`zcc.secondaryPanel.${owner}`)?.includes('tabState') ?? false, OWNER);
  expect(leftover).toBe(false);
});
