// Revisiting the Inbox must not re-run a failed AI summary on every visit, and a
// selected entry must paint its cached document instead of a loading skeleton.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, launchEnv: { ZCC_FAKE_PROVIDER: '1' }, initialConfig: { sponsorPromptDismissed: true, tmuxScope: 'off' } });

/** Record every "Loading document" skeleton that appears from now on. */
async function watchForSkeletons(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __loading: string[] };
    w.__loading = [];
    const scan = (text: string) => { if (text.includes('Loading document')) w.__loading.push(text.slice(0, 80)); };
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(node => {
          scan(node.textContent ?? '');
          if (node instanceof Element) node.querySelectorAll('[aria-label]').forEach(el => scan(el.getAttribute('aria-label') ?? ''));
        });
        if (record.type === 'attributes' && record.target instanceof Element) scan(record.target.getAttribute('aria-label') ?? '');
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] });
  });
}

test('Inbox revisits neither re-run a failed summary nor flash a document skeleton', async ({ app }) => {
  test.setTimeout(120_000);
  const { window: page, electron, home } = app;
  const projectPath = join(home, 'revisit-project');
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(projectPath, 'report.md'), '# Revisit report\n\nSynthetic document body.\n');
  const projectId = await page.evaluate(async (path) => {
    const result = await window.cc.projects.add(path);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, projectPath);
  mkdirSync(join(home, '.zcc', 'inbox'), { recursive: true });
  writeFileSync(join(home, '.zcc', 'inbox', 'entries.jsonl'), `${JSON.stringify({
    id: 'revisit-report', projectId, ts: Date.now(), subject: 'Revisit stability report', comments: 'Attached document', report: true, docs: [{ path: 'report.md' }]
  })}\n`);
  await page.reload();

  // Count summary calls, and make every document read slow enough that an
  // uncached revisit would have to paint the (200 ms delayed) loading skeleton.
  await electron.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers;
    const g = globalThis as unknown as { __summarizeCalls: number };
    g.__summarizeCalls = 0;
    const summarize = handlers.get('inbox:summarize')!;
    handlers.set('inbox:summarize', (...args: unknown[]) => { g.__summarizeCalls++; return summarize(...args); });
    const readFile = handlers.get('fs:readFile')!;
    handlers.set('fs:readFile', async (...args: unknown[]) => {
      await new Promise(resolve => setTimeout(resolve, 600));
      return readFile(...args);
    });
  });
  const summarizeCalls = () => electron.evaluate(() => (globalThis as unknown as { __summarizeCalls: number }).__summarizeCalls);

  // 1. Overview revisits: the E2E Claude stub makes every summary fail, which
  //    the old code retried on every mount.
  await page.getByTestId('nav-inbox').click();
  await expect.poll(summarizeCalls, { timeout: 15_000 }).toBe(1);
  for (let visit = 0; visit < 3; visit++) {
    await page.getByTestId('nav-agents').click();
    await page.getByTestId('nav-inbox').click();
    await page.waitForTimeout(750);
  }
  expect(await summarizeCalls()).toBe(1);

  // 2. Document revisits: the first open pays the slow read, later ones paint from cache.
  const row = page.locator('.inbox-row').filter({ hasText: 'Revisit stability report' });
  await row.click();
  await expect(page.locator('.inbox-detail')).toContainText('Synthetic document body', { timeout: 10_000 });
  for (let visit = 0; visit < 3; visit++) {
    await page.getByTestId('nav-agents').click();
    await watchForSkeletons(page);
    await page.getByTestId('nav-inbox').click();
    await expect(page.locator('.inbox-detail')).toContainText('Synthetic document body');
    // Outlast the slow background revalidation.
    await page.waitForTimeout(1_000);
    expect(await page.evaluate(() => (window as unknown as { __loading: string[] }).__loading)).toEqual([]);
  }
});
