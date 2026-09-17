import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('Docs file preview preserves scroll while the thread receives content', async ({ app }) => {
  const { window } = app;
  const markdown = '# Independent document\n\n' + Array.from({ length: 100 }, (_, i) =>
    `## Section ${i}\n\nParagraph ${i} is unrelated to the running thread.\n\n`
  ).join('');
  await window.getByTestId('nav-home').click();
  const homeComposer = window.locator('.thread-command-composer').first();
  await expect(homeComposer.getByTestId('thread-command-send')).toBeEnabled({ timeout: 30_000 });
  await homeComposer.getByTestId('thread-command-input').fill('Initial scroll test turn');
  await homeComposer.getByTestId('thread-command-send').click();
  const detail = window.getByTestId('thread-detail');
  await expect(detail.getByTestId('thread-timeline')).toContainText('Response to: Initial scroll test turn', { timeout: 30_000 });
  const cwd = await window.evaluate(async () => {
    const id = location.pathname.split('/threads/')[1]?.split('/')[0];
    const { thread } = await (await fetch(`/api/v1/threads/${id}`)).json();
    return thread.cwd as string;
  });
  expect(realpathSync(cwd).startsWith(`${realpathSync(app.home)}/`)).toBe(true);
  const documentPath = join(cwd, 'scroll-regression.md');
  writeFileSync(documentPath, markdown);
  await window.evaluate((documentPath) => {
    const threadId = location.pathname.split('/threads/')[1]?.split('/')[0];
    if (!threadId) throw new Error('No active thread');
    localStorage.setItem(`zcc.secondaryPanel.${threadId}`, JSON.stringify({
      version: 1, isOpen: true, isMaximized: false, widthPx: 450, activeId: 'document',
      tabs: [{ id: 'document', kind: 'file-preview', title: 'scroll-regression.md', path: documentPath }]
    }));
    window.dispatchEvent(new CustomEvent('zcc:secondary-panel-changed', { detail: { threadId } }));
  }, documentPath);
  const opener = detail.getByTestId('thread-file-open-with');
  await expect(opener).toBeVisible({ timeout: 30_000 });
  const docsValue = await opener.locator('option').filter({ hasText: /^Docs$/ }).getAttribute('value');
  expect(docsValue).toBeTruthy();
  await opener.selectOption(docsValue!);
  const preview = detail.getByTestId('thread-file-preview');
  await expect(preview).toContainText('Section 99');
  await preview.evaluate((node) => {
    node.setAttribute('data-scroll-witness', 'original');
    node.scrollTop = 900;
  });
  expect(await preview.evaluate((node) => node.scrollTop)).toBe(900);
  const composer = detail.locator('.thread-command-composer');
  await composer.getByTestId('thread-command-input').fill('delay:2000 Unrelated follow-up');
  await composer.getByTestId('thread-command-send').click();
  await expect(detail.getByTestId('thread-timeline')).toContainText('Response to: delay:2000 Unrelated follow-up', { timeout: 30_000 });
  await expect(preview).toHaveAttribute('data-scroll-witness', 'original');
  expect(await preview.evaluate((node) => node.scrollTop)).toBe(900);
});
