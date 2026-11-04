import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium, type WebSocketRoute } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { startMobileGateway } from '../apps/server/src/mobile/gateway.js';
import { DEFAULT_PR_MONITOR_SETTINGS } from '../plugins/pr-monitor/lib/types.js';

// Diagnostic audit: measurements record existing defects rather than certifying
// responsive layout. The isolated app owns all seeded data and plugin installs.
test.use({ initialConfig: { sponsorPromptDismissed: true }, launchEnv: { ZCC_FAKE_PROVIDER: '1' } });
test.beforeEach(async ({ home }) => {
  mkdirSync(join(home, '.zcc', 'library'), { recursive: true });
  writeFileSync(join(home, '.zcc', 'library', 'mobile-audit.md'), '# Mobile document\n\nA readable document.\n\n' + 'Long document paragraph. '.repeat(60));
  const root = join(home, '.zcc', 'plugins', 'tasks');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'kv.json'), JSON.stringify({ store: { version: 2, nextSeq: 8, items: [{
    id: 'audit-task', key: 'TSK-4', title: 'Review a longer task title on a small mobile screen', description: 'Task details should use the available width.',
    status: 'in_review', priority: 'high', dueDate: null, order: 1, createdAt: 1000, updatedAt: 2000,
  }] } }));
});

test('Audit installed plugin pages on phone and tablet widths', async ({ app }, testInfo) => {
  test.setTimeout(240_000);
  expect(await app.window.locator('.app-shell').evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--shell-trailing-reserve')))).toBe(36);
  const ids = ['docs', 'tasks', 'pr-monitor', 'plugin-guide', 'custom-instructions', 'ask-user-question', 'secrets', 'monaco-editor', 'pdf-preview'];
  for (const id of ids) {
    expect(await app.window.evaluate(id => window.cc.extensions.install({ kind: 'bundled', id }), id)).toMatchObject({ ok: true });
  }
  await expect.poll(() => app.window.evaluate(async () => (await window.cc.pluginApps.list()).filter(p => p.status === 'running').length)).toBeGreaterThanOrEqual(ids.length);
  await app.window.evaluate(async settings => {
    await window.cc.pluginApps.callRpc('pr-monitor', 'storageSet', { key: 'settings', value: settings });
    const now = Date.now();
    const prs = ['failed', 'green', 'pending', 'review-required'].map((status, i) => ({
      url: `https://github.com/acme/mobile-review/pull/${40 + i}`, repo: 'acme/mobile-review', number: 40 + i,
      title: `Verify ${status} pull requests stay readable on a phone`, status, checks: [],
      body: 'Details should remain readable. '.repeat(15), addedAt: now, lastChecked: now, lastStatusChange: now, lastSeenAt: 0, source: 'manual',
    }));
    await window.cc.pluginApps.callRpc('pr-monitor', 'storageSet', { key: 'prs', value: Object.fromEntries(prs.map(pr => [pr.url, pr])) });
  }, { ...DEFAULT_PR_MONITOR_SETTINGS, autoSyncEnabled: false, authorDiscovered: true, orgDiscovered: true });
  const reservation = createServer();
  await new Promise<void>(r => reservation.listen(0, '127.0.0.1', r));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(r => reservation.close(() => r()));
  const serverUrl = `http://127.0.0.1:${port}`;
  const gateway = await startMobileGateway({ upstream: new URL(app.window.url()).origin, publicUrl: serverUrl, port });
  const browser = await chromium.launch();
  const audit: Record<string, unknown> = {};
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pair = await context.request.post(`${serverUrl}/_mobile/pair`, { data: { code: gateway.pair().code, label: 'Plugin audit' } });
    const credential = await pair.json();
    expect((await context.request.post(`${serverUrl}/_mobile/session`, { headers: { authorization: `Bearer ${credential.credential}` } })).ok()).toBe(true);
    const page = await context.newPage();
    let socket: WebSocketRoute | undefined;
    await page.routeWebSocket('**/ws', ws => { socket = ws; ws.connectToServer(); });
    await page.goto(serverUrl + '/');
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await drawer.getByRole('button', { name: 'More', exact: true }).click();
    await expect(drawer.getByTestId('nav-docs')).toBeVisible();
    await drawer.getByTestId('nav-docs').click();
    await expect(page.locator('.library-panel')).toBeVisible();
    await expect(page.locator('.tree-row.file').first()).toBeVisible();
    // The Library reads scoped snapshots, rather than the legacy GET /library.
    // Verify a real content change reaches the UI after the invalidation.
    writeFileSync(join(app.home, '.zcc', 'library', 'refreshed-audit.md'), '# Refreshed audit document\n');
    const [refresh] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/library/documents'
        && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'snapshot', { timeout: 15_000 }),
      Promise.resolve().then(() => socket!.send(JSON.stringify({ type: 'library:changed', payload: {} }))),
    ]);
    expect(refresh.ok()).toBe(true);
    await expect(page.getByRole('button', { name: 'refreshed-audit.md', exact: true })).toBeVisible();
    await expect(page.locator('.tree-row.file').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Renderer crashed' })).toHaveCount(0);
    async function capture(name: string) {
      for (const slot of await page.locator('.module-panel-slot').all()) {
        if (await slot.isVisible()) await expect(slot).toHaveCSS('padding-right', '0px');
      }
      audit[`${page.viewportSize()!.width}-${name}`] = await page.locator('.shell-main').evaluate(root => {
        const visible = [...root.querySelectorAll<HTMLElement>('*')].filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden' && rect.bottom > 0 && rect.top < innerHeight;
        });
        const box = (el: HTMLElement) => ({ text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 90), class: String(el.className), width: Math.round(el.getBoundingClientRect().width), height: Math.round(el.getBoundingClientRect().height), font: getComputedStyle(el).fontSize });
        return {
          url: location.pathname,
          clippedCandidates: visible.filter(el => { const r = el.getBoundingClientRect(); return r.right > innerWidth + 2 || r.left < -2; }).slice(0, 25).map(box),
          smallControls: visible.filter(el => el.matches('button, input, select, textarea, [role="button"]') && (el.getBoundingClientRect().height < 44 || el.getBoundingClientRect().width < 44)).slice(0, 35).map(box),
          panes: visible.filter(el => el.matches('.explorer-tree, .library-viewer, .bb-tasks > aside, .bb-tasks > main, .prm-header, .prm-board-card, .sf-workbench')).slice(0, 12).map(box),
        };
      });
      await page.screenshot({ path: testInfo.outputPath(`${page.viewportSize()!.width}-${name}.png`), animations: 'disabled' });
      if (page.viewportSize()!.width === 390) {
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
        await page.screenshot({ path: testInfo.outputPath(`390-${name}-light.png`), animations: 'disabled' });
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      }
    }
    for (const width of [320, 390, 820]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, path, selector] of [
        ['docs', '/plugins/docs/panel', '.library-panel'],
        ['tasks', '/plugins/tasks/tasks', '.bb-tasks'],
        ['pr-monitor', '/plugins/pr-monitor/main', '.prm-panel'],
        ['plugin-guide', '/extensions/pages/plugin-guide/plugin-guide', '.plugin-guide-scroll'],
        ...ids.filter(id => !['docs', 'tasks', 'pr-monitor', 'plugin-guide'].includes(id)).map(id => [`settings-${id}`, `/extensions/plugins/${id}?view=installed`, '.extensions-panel']),
      ]) {
        await page.evaluate(path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')); }, path);
        try { await expect(page.locator(selector).first()).toBeVisible({ timeout: 5_000 }); }
        catch { audit[`${width}-${name}-load`] = { selector, text: (await page.locator('body').innerText()).slice(0, 700) }; }
        await capture(name);
        console.log(`Audited ${width}px ${name}`);
        if (name === 'docs' && await page.locator('.tree-row.file').count()) {
          await page.locator('.tree-row.file').first().click();
          await expect(page.locator('.library-md-pane')).toBeVisible();
          await expect(page.locator('.library-panel .explorer-tree')).toBeHidden();
          expect((await page.locator('.library-viewer').boundingBox())!.width).toBeGreaterThanOrEqual(width - 2);
          await capture('docs-reading');
        }
        if (name === 'pr-monitor' && await page.locator('.prm-board-card').count()) {
          await page.locator('.prm-board-card').first().click();
          await expect(page.getByRole('dialog')).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`${width}-pr-details.png`), animations: 'disabled' });
          await page.keyboard.press('Escape');
        }
      }
    }
  } finally {
    writeFileSync(testInfo.outputPath('plugin-audit.json'), JSON.stringify(audit, null, 2));
    await browser.close();
    await gateway.close();
  }
});
