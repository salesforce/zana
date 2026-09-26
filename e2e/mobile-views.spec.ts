import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, type Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';

test.use({ initialConfig: { sponsorPromptDismissed: true, agentsBoardView: 'flow', classicSessionViewEnabled: false }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test.beforeEach(async ({ home }) => {
  const project = join(home, 'responsive-project');
  mkdirSync(join(project, 'docs'), { recursive: true });
  mkdirSync(join(home, '.zcc', 'inbox'), { recursive: true });
  mkdirSync(join(home, '.zcc', 'saved'), { recursive: true });
  writeFileSync(join(project, 'mobile-agent.cjs'), `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('2.1.220 (Claude Code)'); process.exit(0); }
process.stdout.write('\\x1b]2;✳ Mobile terminal\\x07MOBILE_TERMINAL_READY\\r\\n');
process.stdin.resume();
setInterval(() => {}, 1000);
`, { mode: 0o755 });
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
      if (el.closest('.aurora-grid, .zcc-kanban, .mobile-agent-lanes')) return false;
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
  const seed = await app.window.evaluate(async () => {
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'responsive-project', providerId: 'fake', input: 'Responsive agent 1 delay:500' })
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()).thread as { id: string; environmentId: string };
  });
  await expect.poll(() => app.window.evaluate(async (id) => {
    return (await (await fetch(`/api/v1/threads/${id}`)).json()).thread.status;
  }, seed.id)).toBe('idle');
  await app.window.evaluate(async (environmentId) => {
    for (let i = 1; i < 8; i++) {
      const response = await fetch('/api/v1/threads', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'responsive-project', providerId: 'fake', environment: { kind: 'reuse', environmentId }, input: `Responsive agent ${i + 1} reviewing a longer task title on a small phone screen delay:500` })
      });
      if (!response.ok) throw new Error(await response.text());
    }
    for (const name of ['Responsive daily review', 'Responsive weekly summary']) {
      const result = await window.cc.scheduler.create({ name, projectId: 'responsive-project', profile: 'shell', every: '1d', enabled: false, inboxLevel: 'silent' });
      if (!result.ok) throw new Error(result.message);
    }
  }, seed.environmentId);
  await app.window.evaluate(async () => {
    const response = await fetch('/api/v1/terminals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'responsive-project', profile: 'claude', title: 'Mobile terminal', command: './mobile-agent.cjs', cols: 80, rows: 24 })
    });
    if (!response.ok) throw new Error(await response.text());
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
          await expect(page.getByRole('button', { name: 'Flow view', exact: true })).toHaveCount(0);
          if (width === 320) {
            await expect(page.getByRole('button', { name: 'Board view', exact: true })).toHaveAttribute('aria-pressed', 'true');
          }
          await page.getByRole('button', { name: 'List view', exact: true }).click();
          await expect(page.locator('.agent-monitor-row').first()).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`${width}-agents-list.png`) });
          audit[`${width}-agents-list`] = await capture(page);
          await expect(page.locator('.agent-monitor-main')).toHaveCount(0);
          await expect(page.getByTestId('agent-monitor-thread')).toHaveCount(0);
          await expect(page.getByTestId('agent-session-view')).toHaveCount(0);
          const list = page.locator('.agent-monitor-list');
          expect((await list.boundingBox())!.height).toBeGreaterThan(600);
          const lastThread = list.locator('[data-kind="thread"]').last();
          await lastThread.scrollIntoViewIfNeeded();
          const listScroll = await list.evaluate(el => el.scrollTop);
          await lastThread.click();
          await expect(list).toBeHidden();
          await expect(page.getByTestId('agent-monitor-thread')).toBeVisible();
          await expect(page.getByTestId('thread-timeline')).toContainText('Response to:');
          expect((await page.locator('.agent-monitor-main').boundingBox())!.width).toBeGreaterThanOrEqual(width - 32);
          await page.screenshot({ path: testInfo.outputPath(`${width}-agents-list-thread.png`) });
          await page.getByRole('button', { name: 'Back to agents', exact: true }).click();
          await expect(list).toBeVisible();
          await expect(page.getByTestId('agent-monitor-thread')).toHaveCount(0);
          expect(await list.evaluate(el => el.scrollTop)).toBeCloseTo(listScroll, 0);
          const terminalRow = list.locator('.agent-monitor-row').filter({ hasText: 'Mobile terminal' });
          await expect(terminalRow).toHaveCount(1);
          await expect(terminalRow).toBeVisible();
          await terminalRow.click();
          await expect(list).toBeHidden();
          await expect(page.getByTestId('agent-session-view')).toBeVisible();
          await expect(page.locator('#cc-terminal-anchor-agent-monitor .xterm')).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`${width}-agents-list-terminal.png`) });
          await page.getByRole('button', { name: 'Back to agents', exact: true }).click();
          await expect(page.locator('.agent-monitor-main')).toHaveCount(0);
          await expect(list).toBeVisible();
          await page.getByRole('button', { name: 'Board view', exact: true }).click();
          const board = page.getByTestId('mobile-agent-board');
          await expect(board).toBeVisible();
          await expect(page.locator('.zcc-kanban')).toHaveCount(0);
          await expect(board.getByRole('tabpanel')).toHaveCount(1);
          await expect(board.locator('.agent-card').first()).toBeVisible();
          const card = board.locator('.agent-card').first();
          expect((await card.boundingBox())!.width).toBeGreaterThanOrEqual(width - 32);
          await expect(card).toHaveAttribute('draggable', 'false');
          const populatedTab = await board.getByRole('tab', { selected: true }).getAttribute('id');
          for (const tab of await board.getByRole('tab').all()) {
            await tab.scrollIntoViewIfNeeded();
            expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            await tab.click();
            await expect(tab).toHaveAttribute('aria-selected', 'true');
            await expect(board.getByRole('tabpanel')).toHaveCount(1);
          }
          await board.getByRole('tab', { name: /^Needs you/ }).click();
          await expect(board.getByText('No agents in this column')).toBeVisible();
          await page.locator(`[id="${populatedTab}"]`).click();
          await page.screenshot({ path: testInfo.outputPath(`${width}-agents-board.png`) });
          expect.soft(await capture(page), `${width}px agents board`).toEqual([]);
          const panel = board.getByRole('tabpanel');
          await panel.hover();
          await page.mouse.wheel(0, 600);
          await expect.poll(() => panel.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
          expect((await board.getByRole('tab', { selected: true }).boundingBox())!.y).toBeLessThan(300);
          // Even when desktop prefers inspectors, mobile cards open the page.
          for (const kind of ['thread', 'terminal'] as const) {
            const agentCard = kind === 'thread'
              ? board.locator('.agent-card[data-kind="thread"]').first()
              : board.locator('.agent-card').filter({ hasText: 'Mobile terminal' });
            for (const tab of await board.getByRole('tab').all()) {
              await tab.click();
              await expect(tab).toHaveAttribute('aria-selected', 'true');
              if (await agentCard.count()) break;
            }
            await agentCard.click();
            await expect(page).toHaveURL(kind === 'thread' ? /\/threads\/[^/]+$/ : /\/sessions\/[^/]+$/);
            await expect(page.locator('.agent-terminal-modal, .modal-backdrop')).toHaveCount(0);
            const detail = page.getByTestId(kind === 'thread' ? 'thread-detail' : 'agent-session-view');
            await expect(detail).toBeVisible();
            expect((await detail.boundingBox())!.width).toBeGreaterThanOrEqual(width - 32);
            await expect(page.getByRole('button', { name: 'Full screen', exact: true })).toHaveCount(0);
            await page.screenshot({ path: testInfo.outputPath(`${width}-agents-board-${kind}-page.png`) });
            await page.goBack();
            await expect(page).toHaveURL(serverUrl + '/agents');
            await expect(board).toBeVisible();
          }
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
    await page.goto(serverUrl + '/agents');
    await page.getByRole('button', { name: 'Board view', exact: true }).click();
    await expect(page.locator('.zcc-kanban')).toBeVisible();
    await expect(page.getByTestId('mobile-agent-board')).toHaveCount(0);
    // Desktop keeps its inspector preference. Crossing the mobile breakpoint
    // promotes an already-open inspector and clears it before returning.
    for (const kind of ['thread', 'terminal'] as const) {
      const card = kind === 'thread'
        ? page.locator('.zcc-kanban .agent-card[data-kind="thread"]').first()
        : page.locator('.zcc-kanban .agent-card').filter({ hasText: 'Mobile terminal' });
      await card.click();
      await expect(page.getByTestId(kind === 'thread' ? 'thread-modal' : 'agent-terminal-modal')).toBeVisible();
      await expect(page).toHaveURL(serverUrl + '/agents');
      await page.setViewportSize({ width: 390, height: 900 });
      await expect(page).toHaveURL(kind === 'thread' ? /\/threads\/[^/]+$/ : /\/sessions\/[^/]+$/);
      await expect(page.locator('.agent-terminal-modal, .modal-backdrop')).toHaveCount(0);
      await page.goBack();
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(page.locator('.zcc-kanban')).toBeVisible();
      await expect(page.locator('.agent-terminal-modal')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await expect(page.locator('.agent-monitor-list')).toBeVisible();
    await expect(page.locator('.agent-monitor-main')).toBeVisible();
    const desktopList = await page.locator('.agent-monitor-list').boundingBox();
    const desktopDetail = await page.locator('.agent-monitor-main').boundingBox();
    expect(desktopDetail!.x).toBeGreaterThanOrEqual(desktopList!.x + desktopList!.width - 1);
    await expect(page.getByRole('button', { name: 'Back to agents', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Flow view', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(page.getByRole('button', { name: 'Flow view', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('mobile-agent-board')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('button', { name: 'Flow view', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.squad-flow, .squad-flow-empty').first()).toBeVisible();
    writeFileSync(testInfo.outputPath('responsive-audit.json'), JSON.stringify(audit, null, 2));
  } finally {
    await browser.close();
    await gateway.close();
  }
});
