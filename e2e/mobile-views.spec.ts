import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, type Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test.beforeEach(async ({ home }) => {
  const project = join(home, 'responsive-project');
  mkdirSync(join(project, 'docs'), { recursive: true });
  mkdirSync(join(home, '.zcc', 'inbox'), { recursive: true });
  mkdirSync(join(home, '.zcc', 'saved'), { recursive: true });
  const comments = 'A report with a long reference: ' + 'mobile-layout-'.repeat(16) +
    '\n\n' + Array.from({ length: 18 }, (_, i) => `Paragraph ${i + 1}: This report should remain readable on a phone, with all actions reachable.`).join('\n\n');
  writeFileSync(join(project, 'docs', 'report.md'), '# Responsive report\n\n' + comments);
  writeFileSync(join(project, 'docs', 'results.md'), '# Verification results\n\nThe second document is readable.');
  writeFileSync(join(home, '.zcc', 'projects.json'), JSON.stringify({ version: 1, projects: [{
    id: 'responsive-project', name: 'Mobile interface verification', path: project,
    createdAt: Date.now(), lastActiveAt: Date.now(), tag: 'responsive'
  }] }));
  writeFileSync(join(home, '.zcc', 'inbox', 'entries.jsonl'), Array.from({ length: 12 }, (_, i) => JSON.stringify({
    id: `responsive-${i}`, projectId: 'responsive-project', ts: Date.now() - i * 1000,
    subject: `Responsive report ${i + 1}`, comments, report: true,
    ...(i === 0 ? { docs: [{ path: 'docs/report.md' }, { path: 'docs/results.md' }] } : {})
  })).join('\n') + '\n');
  writeFileSync(join(home, '.zcc', 'saved', 'saved-responsive.json'), JSON.stringify({
    id: 'saved-responsive', projectId: 'responsive-project', savedAt: Date.now(),
    title: 'Saved responsive report', comments
  }));
});

async function capture(page: Page) {
  return page.locator('.shell-main').evaluate((root) => {
    const viewport = innerWidth;
    return [...root.querySelectorAll<HTMLElement>('*')].filter((el) => {
      if (el.closest('.aurora-grid, .zcc-kanban')) return false;
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' &&
        (box.right > viewport + 2 || box.left < -2);
    }).slice(0, 30).map((el) => ({ tag: el.tagName, class: el.className,
      text: el.textContent?.slice(0, 60), width: Math.round(el.getBoundingClientRect().width),
      right: Math.round(el.getBoundingClientRect().right) }));
  });
}

test('Main views and populated Inbox fit phone and tablet screens', async ({ app }, testInfo) => {
  test.setTimeout(240_000);
  await app.window.evaluate(async () => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'responsive-project', providerId: 'fake', input: 'Responsive agent delay:500' })
    });
    if (!response.ok) throw new Error(await response.text());
    for (const name of ['Responsive daily review', 'Responsive weekly summary']) {
      const result = await window.cc.scheduler.create({ name, projectId: 'responsive-project', profile: 'shell', every: '1d', enabled: false, inboxLevel: 'silent' });
      if (!result.ok) throw new Error(result.message);
    }
  });
  const reservation = createServer();
  await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const serverUrl = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pair = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Responsive views' } });
    const credential = await pair.json();
    expect((await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
    const page = await context.newPage();
    const audit: Record<string, unknown> = {};
    for (const width of [320, 390, 820]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path, selector] of [
        ['home', '/', '.home-panel'],
        ['inbox', '/inbox', '.inbox-view'],
        ['agents', '/agents', '.agents-board'],
        ['scheduler', '/scheduler', '.scheduler-panel'],
        ['new-schedule', '/schedules/new', '.schedule-detail-pane'],
        ['plugins', '/extensions/plugins', '.extensions-panel'],
        ['plugin-browse', '/extensions/plugins/browse', '.extensions-panel'],
        ['skills', '/extensions/skills', '.settings-panel'],
        ['mcp', '/extensions/mcp', '.settings-panel'],
        ['settings', '/settings/global', '.settings-panel'],
        ['machines', '/settings/machines', '.settings-panel'],
        ['agent-settings', '/settings/agents', '.settings-panel'],
        ['project', '/projects/responsive-project', '.agents-board'],
        ['goals', '/goals', '.settings-panel'],
        ['followups', '/followups', '.settings-panel'],
        ['new-thread', '/threads/new', '.new-thread-view']
      ]) {
        await page.goto(serverUrl + path, { waitUntil: 'domcontentloaded' });
        await expect(page.locator(selector).first()).toBeVisible();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile', 'true');
        await page.screenshot({ path: testInfo.outputPath(`${width}-${name}.png`) });
        audit[`${width}-${name}`] = await capture(page);
        expect.soft(audit[`${width}-${name}`], `${width}px ${name} overflow`).toEqual([]);
        writeFileSync(testInfo.outputPath('responsive-audit.json'), JSON.stringify(audit, null, 2));
        if (name === 'inbox') {
          await page.locator('.inbox-filter-input').fill('Responsive report 1');
          await page.locator('.inbox-row').filter({ has: page.getByText('Responsive report 1', { exact: true }) }).click();
          await expect(page.locator('.inbox-detail-title')).toHaveText('Responsive report 1');
          await expect(page.locator('.inbox-list-pane')).toBeHidden();
          const labelBox = await page.locator('.inbox-detail-label').boundingBox();
          expect(labelBox!.width).toBeGreaterThan(100);
          expect(labelBox!.height).toBeLessThan(44);
          await page.screenshot({ path: testInfo.outputPath(`${width}-inbox-detail.png`) });
          audit[`${width}-inbox-detail`] = await capture(page);
          expect.soft(audit[`${width}-inbox-detail`]).toEqual([]);
          await page.locator('.inbox-docs-fileitem').filter({ hasText: 'results.md' }).click();
          await expect(page.locator('.inbox-doc-preview')).toContainText('The second document is readable.');
          await page.screenshot({ path: testInfo.outputPath(`${width}-inbox-documents.png`) });
          expect.soft(await capture(page), `${width}px inbox documents`).toEqual([]);
          await page.getByRole('button', { name: 'Inbox', exact: true }).click();
          await expect(page.locator('.inbox-filter-input')).toHaveValue('Responsive report 1');
          await page.getByRole('button', { name: 'Clear filter', exact: true }).click();
          await page.getByRole('tab', { name: /^Saved/ }).click();
          await expect(page.locator('.saved-row')).toBeVisible();
          await page.locator('.saved-row').click();
          await page.screenshot({ path: testInfo.outputPath(`${width}-inbox-saved.png`) });
          audit[`${width}-inbox-saved`] = await capture(page);
          await page.getByRole('button', { name: 'Saved reports', exact: true }).click();
          await expect(page.locator('.saved-row')).toBeVisible();
          await page.getByRole('tab', { name: /^Feed/ }).click();
          await page.getByRole('button', { name: 'Inbox overview', exact: true }).click();
          await expect(page.locator('.inbox-overview')).toBeVisible();
          await page.getByRole('button', { name: 'Inbox', exact: true }).click();
          await expect(page.locator('.inbox-list-pane')).toBeVisible();
          const lastReport = page.locator('.inbox-row').filter({ has: page.getByText('Responsive report 1', { exact: true }) });
          await lastReport.scrollIntoViewIfNeeded();
          const listScroll = await page.locator('.inbox-list-pane .list-body').evaluate(el => el.scrollTop);
          await lastReport.click();
          await expect.poll(() => page.locator('.inbox-view-detail').evaluate(el => el.scrollTop)).toBe(0);
          for (const action of await page.locator('.inbox-detail-header button').all()) {
            const box = await action.boundingBox();
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.width).toBeGreaterThanOrEqual(44);
          }
          await page.getByRole('button', { name: 'Inbox', exact: true }).click();
          expect(await page.locator('.inbox-list-pane .list-body').evaluate(el => el.scrollTop)).toBeCloseTo(listScroll, 0);
        }
        if (name === 'agents') {
          await page.getByRole('button', { name: 'List view', exact: true }).click();
          await expect(page.locator('.agent-monitor-row').first()).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`${width}-agents-list.png`) });
          audit[`${width}-agents-list`] = await capture(page);
          const list = await page.locator('.agent-monitor-list').boundingBox();
          const detail = await page.locator('.agent-monitor-main').boundingBox();
          expect(detail!.width).toBeGreaterThanOrEqual(width - 32);
          expect(detail!.y).toBeGreaterThanOrEqual(list!.y + list!.height - 1);
          await page.getByRole('button', { name: 'Board view', exact: true }).click();
          const board = page.locator('.zcc-kanban');
          await expect(board).toBeVisible();
          await board.hover();
          await page.mouse.wheel(600, 0);
          await expect.poll(() => board.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
        }
        if (name === 'scheduler') {
          await page.getByRole('region', { name: 'All schedules' }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: testInfo.outputPath(`${width}-scheduler-inventory.png`) });
          expect.soft(await capture(page), `${width}px scheduler inventory`).toEqual([]);
        }
      }
    }
    await page.goto(serverUrl + '/inbox');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-mobile', 'false');
    await expect(page.locator('.inbox-list-pane')).toBeVisible();
    await expect(page.locator('.inbox-view-detail')).toBeVisible();
    writeFileSync(testInfo.outputPath('responsive-audit.json'), JSON.stringify(audit, null, 2));
  } finally {
    await browser.close();
    await gateway.close();
  }
});
